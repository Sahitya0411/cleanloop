import { GetObjectCommand, PutObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { UploadTicket } from '@cleanloop/shared';
import type { Storage } from './types';

export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
const UPLOAD_TTL_SECONDS = 300;
const VIEW_TTL_SECONDS = 3600;

export class S3Storage implements Storage {
  constructor(
    private client: S3Client,
    readonly bucket: string,
  ) {}

  /** Presigned POST so S3 itself enforces the size limit and image content type. */
  async uploadTicket(key: string, contentType: string): Promise<UploadTicket> {
    const { url, fields } = await createPresignedPost(this.client, {
      Bucket: this.bucket,
      Key: key,
      Conditions: [
        ['content-length-range', 1, MAX_UPLOAD_BYTES],
        ['eq', '$Content-Type', contentType],
      ],
      Fields: { 'Content-Type': contentType },
      Expires: UPLOAD_TTL_SECONDS,
    });
    return { key, url, fields, maxBytes: MAX_UPLOAD_BYTES };
  }

  async read(key: string): Promise<{ bytes: Uint8Array; contentType: string }> {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    if (!res.Body) throw new Error(`Empty object ${key}`);
    return {
      bytes: await res.Body.transformToByteArray(),
      contentType: res.ContentType ?? 'image/jpeg',
    };
  }

  viewUrl(key: string): Promise<string> {
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucket, Key: key }), {
      expiresIn: VIEW_TTL_SECONDS,
    });
  }

  async write(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: bytes,
        ContentType: contentType,
      }),
    );
  }
}
