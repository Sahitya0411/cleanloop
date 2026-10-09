import { DetectLabelsCommand, type RekognitionClient } from '@aws-sdk/client-rekognition';
import { severityFromLabels, sortFromLabels, type Label } from '../core/rekognition-map';
import type { ImageInput, SeverityAiResult, SortAiResult, WasteAi } from './types';

/** Fallback when Bedrock is unavailable: object labels mapped to bins with rules. */
export class RekognitionAi implements WasteAi {
  constructor(private client: RekognitionClient) {}

  private async labels(image: ImageInput): Promise<Label[]> {
    const res = await this.client.send(
      new DetectLabelsCommand({
        Image: image.bucket
          ? { S3Object: { Bucket: image.bucket, Name: image.key } }
          : { Bytes: image.bytes },
        MaxLabels: 30,
        MinConfidence: 55,
      }),
    );
    return (res.Labels ?? [])
      .filter((l) => l.Name)
      .map((l) => ({ name: l.Name!, confidence: l.Confidence ?? 0 }));
  }

  async classify(image: ImageInput): Promise<SortAiResult> {
    return { ...sortFromLabels(await this.labels(image)), source: 'rekognition' };
  }

  async assessSeverity(image: ImageInput): Promise<SeverityAiResult> {
    return { ...severityFromLabels(await this.labels(image)), source: 'rekognition' };
  }
}
