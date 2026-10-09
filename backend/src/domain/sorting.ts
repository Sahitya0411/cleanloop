import type { Lang, Material, SortResult, WasteCategory } from '@cleanloop/shared';
import { LOW_CONFIDENCE_THRESHOLD, isPickupEligible, isRecyclable, round } from '@cleanloop/shared';
import type { AppContext } from '../services/types';
import type { AuthUser } from './common';
import { assertOwnUpload, loadImage, newId, notFound, photoUrl } from './common';

/** Snap to Sort: photo in S3 -> Bedrock (or Rekognition) -> bin + tip. */
export async function sortPhoto(
  ctx: AppContext,
  user: AuthUser,
  input: { photoKey: string; lang: Lang; fileName?: string },
): Promise<SortResult> {
  assertOwnUpload(input.photoKey, user.userId, 'sort');
  const image = await loadImage(ctx, input.photoKey);
  const createdAt = ctx.now().toISOString();

  let result: SortResult;
  try {
    const ai = await ctx.ai.classify(image, { lang: input.lang, hint: input.fileName });
    const lowConfidence = !ai.isWasteItem || ai.confidence < LOW_CONFIDENCE_THRESHOLD;
    result = {
      id: newId('srt'),
      itemName: ai.itemName,
      category: ai.category,
      material: ai.material,
      tip: ai.tip,
      confidence: round(ai.confidence, 2),
      lowConfidence,
      recyclable: isRecyclable(ai.category, ai.material),
      pickupEligible: !lowConfidence && isPickupEligible(ai.category, ai.material),
      source: ai.source,
      photoKey: input.photoKey,
      createdAt,
    };
    ctx.metrics.count('ItemsSorted');
    if (lowConfidence) ctx.metrics.count('LowConfidenceSorts');
  } catch (err) {
    // No provider answered: ask the resident to choose rather than guessing.
    ctx.log.error('classification failed', { error: String(err) });
    ctx.metrics.count('SortFailures');
    result = {
      id: newId('srt'),
      itemName: input.lang === 'hi' ? 'पहचान नहीं हो सकी' : "Couldn't identify",
      category: 'dry',
      material: 'mixed',
      tip: '',
      confidence: 0,
      lowConfidence: true,
      recyclable: false,
      pickupEligible: false,
      source: 'manual',
      photoKey: input.photoKey,
      createdAt,
    };
  }
  await ctx.repo.putSort(user.userId, result);
  return { ...result, photoUrl: await photoUrl(ctx, result.photoKey) };
}

/** The resident's own choice after a low-confidence result. */
export async function chooseManually(
  ctx: AppContext,
  user: AuthUser,
  input: { sortId: string; category: WasteCategory; material?: Material; itemName?: string },
): Promise<SortResult> {
  const existing = await ctx.repo.getSort(user.userId, input.sortId);
  if (!existing) throw notFound('Sort result');
  const material: Material =
    input.material ??
    (input.category === 'wet'
      ? 'organic'
      : input.category === 'e_waste'
        ? 'electronics'
        : input.category === 'sanitary'
          ? 'sanitary'
          : input.category === 'special_care'
            ? 'hazardous'
            : existing.material);
  const updated: SortResult = {
    ...existing,
    itemName: input.itemName?.trim() || existing.itemName,
    category: input.category,
    material,
    confidence: 1,
    lowConfidence: false,
    recyclable: isRecyclable(input.category, material),
    pickupEligible: isPickupEligible(input.category, material),
    source: 'manual',
  };
  await ctx.repo.updateSort(user.userId, updated);
  ctx.metrics.count('ManualSorts');
  return { ...updated, photoUrl: await photoUrl(ctx, updated.photoKey) };
}
