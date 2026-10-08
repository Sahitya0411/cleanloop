import { z } from 'zod';
import type { Lang, Material, WasteCategory } from '@cleanloop/shared';
import { MATERIALS, WASTE_CATEGORIES } from '@cleanloop/shared';

export const SortOutputSchema = z.object({
  isWasteItem: z.boolean(),
  itemName: z.string().trim().min(1).max(80),
  category: z.enum(WASTE_CATEGORIES as [WasteCategory, ...WasteCategory[]]),
  material: z.enum(MATERIALS as [Material, ...Material[]]),
  tip: z.string().trim().max(200),
  confidence: z.coerce.number().min(0).max(1),
});
export type SortOutput = z.infer<typeof SortOutputSchema>;

export const SeverityOutputSchema = z.object({
  isBinOrDump: z.boolean(),
  severity: z.enum(['low', 'medium', 'high']),
  reason: z.string().trim().max(240),
  hazards: z.array(z.string().trim().max(40)).max(6).default([]),
  confidence: z.coerce.number().min(0).max(1),
});
export type SeverityOutput = z.infer<typeof SeverityOutputSchema>;

const languageLine = (lang: Lang) =>
  lang === 'hi'
    ? 'Write itemName, tip and reason in simple Hindi (Devanagari). Keep enum values in English.'
    : 'Write itemName, tip and reason in simple English.';

export function sortSystemPrompt(lang: Lang): string {
  return [
    'You help households in Delhi, India put each item in the right bin.',
    'Classify the single main item in the photo under the Solid Waste Management Rules 2026 four-stream segregation, with e-waste kept separate:',
    '- wet: food scraps, peels, cooked food, tea leaves, flowers, garden waste.',
    '- dry: plastic, paper, cardboard, metal, glass, cloth, rubber, wood, packaging (including multi-layer wrappers).',
    '- sanitary: used diapers, sanitary pads, tampons, condoms, used tissues, bandages.',
    '- special_care: household hazardous items: paint and solvent cans, bulbs and tube lights, mercury thermometers, expired medicines, pesticides, aerosol cans, syringes.',
    '- e_waste: anything with a plug, battery or circuit: phones, chargers, cables, laptops, batteries, small appliances.',
    'Pick the material that best describes the item for recycling.',
    'The tip is one short, practical sentence for this exact item (for example: rinse it, remove the cap, flatten it, wrap it).',
    'confidence is your probability (0 to 1) that the category is correct. Use a low value when the photo is blurry, shows several unrelated items, or shows no waste item at all; set isWasteItem to false in the last case.',
    languageLine(lang),
    'Always answer by calling the record_sort tool exactly once.',
  ].join('\n');
}

export function severitySystemPrompt(lang: Lang): string {
  return [
    'You triage citizen photos of garbage bins and dumping spots for a municipal ward officer in Delhi, India.',
    'isBinOrDump is true only if the photo shows a garbage bin, dhalao, collection point, or waste dumped in a public place.',
    'Severity rubric:',
    '- low: bin full but contained, little or no waste on the ground.',
    '- medium: waste overflowing around the bin, or a small dump (a few bags) on the roadside.',
    '- high: a large dump, waste blocking a road, footpath or drain, burning waste, animals feeding, or medical/hazardous waste visible.',
    'reason is one sentence an officer can act on (what is visible and where it spills).',
    'hazards lists short tags that apply, from: burning, animals, blocking_road, blocking_drain, medical_waste, hazardous_waste, near_school, waterlogging.',
    'confidence is your probability (0 to 1) that the severity is correct.',
    languageLine(lang),
    'Always answer by calling the record_severity tool exactly once.',
  ].join('\n');
}

export const SORT_TOOL = {
  name: 'record_sort',
  description: 'Record the waste classification of the main item in the photo.',
  input_schema: {
    type: 'object' as const,
    properties: {
      isWasteItem: {
        type: 'boolean',
        description: 'False if the photo does not show a household waste item.',
      },
      itemName: { type: 'string', description: 'Short name of the item, e.g. "Plastic bottle".' },
      category: { type: 'string', enum: [...WASTE_CATEGORIES] },
      material: { type: 'string', enum: [...MATERIALS] },
      tip: { type: 'string', description: 'One short disposal tip for this item.' },
      confidence: { type: 'number', minimum: 0, maximum: 1 },
    },
    required: ['isWasteItem', 'itemName', 'category', 'material', 'tip', 'confidence'],
    additionalProperties: false,
  },
};

export const SEVERITY_TOOL = {
  name: 'record_severity',
  description: 'Record the triage result for a photo of a garbage bin or dump.',
  input_schema: {
    type: 'object' as const,
    properties: {
      isBinOrDump: { type: 'boolean' },
      severity: { type: 'string', enum: ['low', 'medium', 'high'] },
      reason: { type: 'string' },
      hazards: { type: 'array', items: { type: 'string' } },
      confidence: { type: 'number', minimum: 0, maximum: 1 },
    },
    required: ['isBinOrDump', 'severity', 'reason', 'hazards', 'confidence'],
    additionalProperties: false,
  },
};

/** Pulls the first JSON object out of free text, for models that answer without the tool. */
export function extractJsonObject(text: string): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return undefined;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return undefined;
  }
}
