import type { AttributeValue } from '@aws-sdk/client-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import type { DynamoDBBatchResponse, DynamoDBStreamEvent } from 'aws-lambda';
import type { Stop } from '@cleanloop/shared';
import { stripKeys } from '../data/kv';
import { processStopChange } from '../domain/collection';
import { awsContext } from './aws-context';

type Image = Record<string, AttributeValue>;

/**
 * DynamoDB Streams -> lane alerts. The event source mapping filters to STOP items,
 * so this only runs when a driver taps Done or Skip.
 */
export async function handler(event: DynamoDBStreamEvent): Promise<DynamoDBBatchResponse> {
  const ctx = awsContext();
  const batchItemFailures: { itemIdentifier: string }[] = [];
  for (const record of event.Records) {
    const newImage = record.dynamodb?.NewImage as Image | undefined;
    const oldImage = record.dynamodb?.OldImage as Image | undefined;
    if (!newImage) continue;
    const afterRaw = unmarshall(newImage);
    if (afterRaw.entity !== 'STOP') continue;
    try {
      const after = stripKeys<Stop>(afterRaw);
      const before = oldImage ? stripKeys<Stop>(unmarshall(oldImage)) : undefined;
      await processStopChange(ctx, before, after);
    } catch (err) {
      ctx.log.error('stream record failed', {
        error: err instanceof Error ? err.message : String(err),
        sequence: record.dynamodb?.SequenceNumber,
      });
      if (record.dynamodb?.SequenceNumber) {
        batchItemFailures.push({ itemIdentifier: record.dynamodb.SequenceNumber });
      }
    }
  }
  return { batchItemFailures };
}
