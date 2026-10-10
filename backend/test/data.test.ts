import { ConditionalCheckFailedException, DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  BatchWriteCommand,
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { beforeEach, describe, expect, it } from 'vitest';
import { DynamoKv } from '../src/data/dynamo-kv';
import { ConditionFailedError } from '../src/data/kv';
import { MemoryKv } from '../src/data/memory-kv';
import { Repo } from '../src/data/repo';
import { stops } from './fixtures';

describe('MemoryKv', () => {
  let kv: MemoryKv;
  beforeEach(async () => {
    kv = new MemoryKv();
    for (const sk of ['A#1', 'A#2', 'B#1', 'A#3']) {
      await kv.put({ pk: 'P', sk, gsi1pk: 'G', gsi1sk: sk.split('#').reverse().join('#'), n: sk });
    }
  });

  it('queries by prefix and range, in order, with limit and reverse', async () => {
    expect((await kv.query('P', { skPrefix: 'A#' })).map((i) => i.sk)).toEqual([
      'A#1',
      'A#2',
      'A#3',
    ]);
    expect((await kv.query('P', { skFrom: 'A#2', skTo: 'B#1' })).map((i) => i.sk)).toEqual([
      'A#2',
      'A#3',
      'B#1',
    ]);
    expect((await kv.query('P', { reverse: true, limit: 2 })).map((i) => i.sk)).toEqual([
      'B#1',
      'A#3',
    ]);
    expect((await kv.queryIndex('gsi1', 'G', { skPrefix: '1#' })).map((i) => i.sk)).toEqual([
      'A#1',
      'B#1',
    ]);
  });

  it('enforces conditions and reports changes', async () => {
    const changes: string[] = [];
    kv.onChange((before, after) => changes.push(`${before?.n ?? '-'}>${after?.n ?? '-'}`));
    await expect(kv.put({ pk: 'P', sk: 'A#1' }, { ifNotExists: true })).rejects.toBeInstanceOf(
      ConditionFailedError,
    );
    await expect(kv.update('P', 'nope', { n: 1 })).rejects.toBeInstanceOf(ConditionFailedError);
    await expect(
      kv.update('P', 'A#1', { n: 'x' }, { expect: { n: 'wrong' } }),
    ).rejects.toBeInstanceOf(ConditionFailedError);
    const updated = await kv.update(
      'P',
      'A#1',
      { n: 'x', extra: undefined },
      { expect: { n: 'A#1' }, remove: ['gsi1pk'] },
    );
    expect(updated.n).toBe('x');
    expect(updated.gsi1pk).toBeUndefined();
    expect(changes).toEqual(['A#1>x']);
  });

  it('supports insert-or-replace-if', async () => {
    await kv.put({ pk: 'P', sk: 'A#1', n: 'y' }, { ifNotExists: true, orIfEquals: { n: 'A#1' } });
    expect((await kv.get('P', 'A#1'))!.n).toBe('y');
    await expect(
      kv.put({ pk: 'P', sk: 'A#1', n: 'z' }, { ifNotExists: true, orIfEquals: { n: 'A#1' } }),
    ).rejects.toBeInstanceOf(ConditionFailedError);
    await kv.put({ pk: 'P', sk: 'NEW' }, { ifNotExists: true, orIfEquals: { n: 'x' } });
    expect(await kv.get('P', 'NEW')).toBeDefined();
  });

  it('returns copies, not live references', async () => {
    const item = (await kv.get('P', 'A#1'))!;
    item.n = 'mutated';
    expect((await kv.get('P', 'A#1'))!.n).toBe('A#1');
  });
});

describe('Repo on MemoryKv', () => {
  it('round-trips stops and finds a lane history through the GSI', async () => {
    const repo = new Repo(new MemoryKv());
    await repo.putStops(stops(['done', 'pending']));
    expect(await repo.listStops('r1', '2026-10-10')).toHaveLength(2);
    expect(await repo.laneStops('a', '2026-10-01', '2026-10-10')).toHaveLength(1);
    expect(await repo.laneStops('a', '2026-10-11', '2026-10-12')).toHaveLength(0);
    await expect(
      repo.updateStop('r1', '2026-10-10', 1, { status: 'skipped' }, 'pending'),
    ).rejects.toBeInstanceOf(ConditionFailedError);
    const s = await repo.updateStop('r1', '2026-10-10', 2, { status: 'done' }, 'pending');
    expect(s.status).toBe('done');
    expect(s).not.toHaveProperty('pk');
  });
});

describe('DynamoKv', () => {
  const ddb = mockClient(DynamoDBDocumentClient);
  let kv: DynamoKv;
  beforeEach(() => {
    ddb.reset();
    kv = new DynamoKv('Table', new DynamoDBClient({ region: 'ap-south-1' }));
  });

  it('builds a conditional update expression', async () => {
    ddb.on(UpdateCommand).resolves({ Attributes: { pk: 'P', sk: 'S', status: 'done' } });
    await kv.update(
      'P',
      'S',
      { status: 'done', skip: undefined },
      { expect: { status: 'pending' }, remove: ['x'] },
    );
    const input = ddb.commandCalls(UpdateCommand)[0]!.args[0].input;
    expect(input.UpdateExpression).toBe('SET #a0 = :v0 REMOVE #a1');
    expect(input.ConditionExpression).toBe('attribute_exists(pk) AND #a2 = :v2');
    expect(input.ExpressionAttributeNames).toEqual({
      '#a0': 'status',
      '#a1': 'x',
      '#a2': 'status',
    });
    expect(input.ExpressionAttributeValues).toEqual({ ':v0': 'done', ':v2': 'pending' });
  });

  it('builds insert-or-replace-if conditions and reads the base table consistently', async () => {
    ddb.on(PutCommand).resolves({});
    await kv.put({ pk: 'P', sk: 'S' }, { ifNotExists: true, orIfEquals: { status: 'planned' } });
    const put = ddb.commandCalls(PutCommand)[0]!.args[0].input;
    expect(put.ConditionExpression).toBe('attribute_not_exists(pk) OR (#c0 = :c0)');
    expect(put.ExpressionAttributeValues).toEqual({ ':c0': 'planned' });
    ddb.on(QueryCommand).resolves({ Items: [] });
    await kv.query('P');
    await kv.queryIndex('gsi1', 'G');
    const [base, index] = ddb.commandCalls(QueryCommand).map((c) => c.args[0].input);
    expect(base!.ConsistentRead).toBe(true);
    expect(index!.ConsistentRead).toBeUndefined();
  });

  it('maps conditional failures to ConditionFailedError', async () => {
    ddb
      .on(PutCommand)
      .rejects(new ConditionalCheckFailedException({ message: 'no', $metadata: {} }));
    await expect(kv.put({ pk: 'P', sk: 'S' }, { ifNotExists: true })).rejects.toBeInstanceOf(
      ConditionFailedError,
    );
  });

  it('follows pagination and honours the limit', async () => {
    ddb
      .on(QueryCommand)
      .resolvesOnce({ Items: [{ sk: '1' }, { sk: '2' }], LastEvaluatedKey: { pk: 'P', sk: '2' } })
      .resolvesOnce({ Items: [{ sk: '3' }] });
    const items = await kv.query('P', { skPrefix: 'S#' });
    expect(items).toHaveLength(3);
    const first = ddb.commandCalls(QueryCommand)[0]!.args[0].input;
    expect(first.KeyConditionExpression).toBe('#pk = :pk AND begins_with(#sk, :prefix)');
  });

  it('uses BETWEEN for ranges and the index key names', async () => {
    ddb.on(QueryCommand).resolves({ Items: [] });
    await kv.queryIndex('gsi1', 'G', { skFrom: 'a', skTo: 'b', reverse: true });
    const input = ddb.commandCalls(QueryCommand)[0]!.args[0].input;
    expect(input.IndexName).toBe('gsi1');
    expect(input.ExpressionAttributeNames).toEqual({ '#pk': 'gsi1pk', '#sk': 'gsi1sk' });
    expect(input.KeyConditionExpression).toBe('#pk = :pk AND #sk BETWEEN :from AND :to');
    expect(input.ScanIndexForward).toBe(false);
  });

  it('retries unprocessed batch items', async () => {
    ddb
      .on(BatchWriteCommand)
      .resolvesOnce({
        UnprocessedItems: { Table: [{ PutRequest: { Item: { pk: 'P', sk: '1' } } }] },
      })
      .resolves({});
    await kv.batchPut([
      { pk: 'P', sk: '1' },
      { pk: 'P', sk: '2' },
    ]);
    expect(ddb.commandCalls(BatchWriteCommand)).toHaveLength(2);
  });
});
