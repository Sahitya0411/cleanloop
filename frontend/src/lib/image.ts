import type { UploadPurpose } from '@cleanloop/shared';
import { ApiError, api } from './api';

const MAX_SIDE = 1600;
const QUALITY = 0.82;

/**
 * Shrinks a phone photo to at most 1600px on its long side as JPEG. Smaller uploads
 * are faster on mobile data and cheaper to send to the model.
 */
export async function compressImage(input: Blob): Promise<Blob> {
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return input;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(input, { imageOrientation: 'from-image' });
  } catch {
    return input;
  }
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return input;
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', QUALITY),
  );
  return blob ?? input;
}

/** Compresses, then uploads straight to S3 with a presigned POST. Returns the object key. */
export async function uploadPhoto(purpose: UploadPurpose, photo: Blob): Promise<string> {
  const jpeg = await compressImage(photo);
  const contentType =
    jpeg.type === 'image/png' || jpeg.type === 'image/webp' ? jpeg.type : 'image/jpeg';
  const ticket = await api.uploadTicket(purpose, contentType);
  if (jpeg.size > ticket.maxBytes) throw new ApiError(413, 'too_large', 'That photo is too large.');
  const form = new FormData();
  for (const [k, v] of Object.entries(ticket.fields)) form.append(k, v);
  form.append('file', jpeg, 'photo.jpg');
  let res: Response;
  try {
    res = await fetch(ticket.url, { method: 'POST', body: form });
  } catch {
    throw new ApiError(0, 'network', 'Upload failed. Check your internet and try again.');
  }
  if (!res.ok) throw new ApiError(res.status, 'upload_failed', 'Upload failed. Please try again.');
  return ticket.key;
}
