import { ConditionalCheckFailedException, DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  BatchWriteCommand,
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
  type QueryCommandInput,
} from '@aws-sdk/lib-dynamodb';
import type { IndexName, Item, KvStore, PutOptions, QueryOptions, UpdateOptions } from './kv';
import { ConditionFailedError } from './kv';

const BATCH_SIZE = 25;

export class DynamoKv implements KvStore {
  private doc: DynamoDBDocumentClient;

  constructor(
    private tableName: string,
    client: DynamoDBClient = new DynamoDBClient({}),
  ) {
    this.doc = DynamoDBDocumentClient.from(client, {
      marshallOptions: { removeUndefinedValues: true },
    });
  }

  async get<T = Item>(pk: string, sk: string): Promise<T | undefined> {
    // Strongly consistent: callers often read right after a conditional write.
    const res = await this.doc.send(
      new GetCommand({ TableName: this.tableName, Key: { pk, sk }, ConsistentRead: true }),
    );
    return res.Item as T | undefined;
  }

  async put(item: Item, opts?: PutOptions): Promise<void> {
    let condition: string | undefined;
    const names: Record<string, string> = {};
    const values: Record<string, unknown> = {};
    if (opts?.ifNotExists) {
      condition = 'attribute_not_exists(pk)';
      const equals = Object.entries(opts.orIfEquals ?? {});
      if (equals.length) {
        const clauses = equals.map(([attr, value], i) => {
          names[`#c${i}`] = attr;
          values[`:c${i}`] = value;
          return `#c${i} = :c${i}`;
        });
        condition += ` OR (${clauses.join(' AND ')})`;
      }
    }
    try {
      await this.doc.send(
        new PutCommand({
          TableName: this.tableName,
          Item: item,
          ConditionExpression: condition,
          ExpressionAttributeNames: Object.keys(names).length ? names : undefined,
          ExpressionAttributeValues: Object.keys(values).length ? values : undefined,
        }),
      );
    } catch (err) {
      if (err instanceof ConditionalCheckFailedException) throw new ConditionFailedError();
      throw err;
    }
  }

  async update<T = Item>(
    pk: string,
    sk: string,
    patch: Record<string, unknown>,
    opts: UpdateOptions = {},
  ): Promise<T> {
    const names: Record<string, string> = {};
    const values: Record<string, unknown> = {};
    const sets: string[] = [];
    const conditions = ['attribute_exists(pk)'];
    let n = 0;
    for (const [attr, value] of Object.entries(patch)) {
      if (value === undefined) continue;
      names[`#a${n}`] = attr;
      values[`:v${n}`] = value;
      sets.push(`#a${n} = :v${n}`);
      n++;
    }
    const removes = (opts.remove ?? []).map((attr) => {
      names[`#a${n}`] = attr;
      return `#a${n++}`;
    });
    for (const [attr, value] of Object.entries(opts.expect ?? {})) {
      names[`#a${n}`] = attr;
      values[`:v${n}`] = value;
      conditions.push(`#a${n} = :v${n}`);
      n++;
    }
    const parts: string[] = [];
    if (sets.length) parts.push(`SET ${sets.join(', ')}`);
    if (removes.length) parts.push(`REMOVE ${removes.join(', ')}`);
    if (!parts.length) {
      const current = await this.get<T>(pk, sk);
      if (!current) throw new ConditionFailedError('Item does not exist');
      return current;
    }
    try {
      const res = await this.doc.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: { pk, sk },
          UpdateExpression: parts.join(' '),
          ConditionExpression: conditions.join(' AND '),
          ExpressionAttributeNames: names,
          ExpressionAttributeValues: Object.keys(values).length ? values : undefined,
          ReturnValues: 'ALL_NEW',
        }),
      );
      return res.Attributes as T;
    } catch (err) {
      if (err instanceof ConditionalCheckFailedException) throw new ConditionFailedError();
      throw err;
    }
  }

  async delete(pk: string, sk: string): Promise<void> {
    await this.doc.send(new DeleteCommand({ TableName: this.tableName, Key: { pk, sk } }));
  }

  query<T = Item>(pk: string, opts: QueryOptions = {}): Promise<T[]> {
    return this.runQuery<T>('pk', 'sk', undefined, pk, opts);
  }

  queryIndex<T = Item>(index: IndexName, pk: string, opts: QueryOptions = {}): Promise<T[]> {
    return this.runQuery<T>(`${index}pk`, `${index}sk`, index, pk, opts);
  }

  private async runQuery<T>(
    pkAttr: string,
    skAttr: string,
    indexName: string | undefined,
    pk: string,
    opts: QueryOptions,
  ): Promise<T[]> {
    const names: Record<string, string> = { '#pk': pkAttr };
    const values: Record<string, unknown> = { ':pk': pk };
    let condition = '#pk = :pk';
    if (opts.skPrefix !== undefined || opts.skFrom !== undefined || opts.skTo !== undefined) {
      names['#sk'] = skAttr;
    }
    if (opts.skFrom !== undefined && opts.skTo !== undefined) {
      condition += ' AND #sk BETWEEN :from AND :to';
      values[':from'] = opts.skFrom;
      values[':to'] = opts.skTo;
    } else if (opts.skFrom !== undefined) {
      condition += ' AND #sk >= :from';
      values[':from'] = opts.skFrom;
    } else if (opts.skTo !== undefined) {
      condition += ' AND #sk <= :to';
      values[':to'] = opts.skTo;
    }
    // DynamoDB allows one sort-key condition; a prefix combined with a range is
    // applied as a filter on the results instead.
    const prefixAsFilter =
      opts.skPrefix !== undefined && (opts.skFrom !== undefined || opts.skTo !== undefined);
    if (opts.skPrefix !== undefined && !prefixAsFilter) {
      condition += ' AND begins_with(#sk, :prefix)';
      values[':prefix'] = opts.skPrefix;
    }

    const out: T[] = [];
    let startKey: Record<string, unknown> | undefined;
    do {
      const input: QueryCommandInput = {
        TableName: this.tableName,
        IndexName: indexName,
        KeyConditionExpression: condition,
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
        ScanIndexForward: !opts.reverse,
        // GSIs are eventually consistent only; the base table can read its own writes.
        ConsistentRead: indexName ? undefined : true,
        ExclusiveStartKey: startKey,
        Limit: opts.limit && !prefixAsFilter ? opts.limit - out.length : undefined,
      };
      const res = await this.doc.send(new QueryCommand(input));
      for (const item of res.Items ?? []) {
        if (prefixAsFilter && !String(item[skAttr]).startsWith(opts.skPrefix!)) continue;
        out.push(item as T);
      }
      startKey = res.LastEvaluatedKey;
    } while (startKey && (!opts.limit || out.length < opts.limit));
    return opts.limit ? out.slice(0, opts.limit) : out;
  }

  async batchPut(items: Item[]): Promise<void> {
    for (let i = 0; i < items.length; i += BATCH_SIZE) {
      let pending = items.slice(i, i + BATCH_SIZE).map((Item) => ({ PutRequest: { Item } }));
      for (let attempt = 0; pending.length && attempt < 6; attempt++) {
        const res = await this.doc.send(
          new BatchWriteCommand({ RequestItems: { [this.tableName]: pending } }),
        );
        pending = (res.UnprocessedItems?.[this.tableName] ?? []) as typeof pending;
        if (pending.length) await new Promise((r) => setTimeout(r, 100 * 2 ** attempt));
      }
      if (pending.length) throw new Error(`batchPut: ${pending.length} items left unprocessed`);
    }
  }
}
