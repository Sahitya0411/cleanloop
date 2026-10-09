import type { Material, Severity, WasteCategory } from '@cleanloop/shared';
import type { SeverityOutput, SortOutput } from './ai-schema';

export interface Label {
  name: string;
  confidence: number; // 0-100, as Rekognition returns it
}

interface SortRule {
  category: WasteCategory;
  material: Material;
  tip: string;
  labels: string[];
}

// Ordered from most to least specific: on a tie the earlier rule wins.
const SORT_RULES: SortRule[] = [
  {
    category: 'e_waste',
    material: 'battery',
    tip: 'Tape the terminals and hand it to an e-waste recycler.',
    labels: ['battery', 'batteries'],
  },
  {
    category: 'e_waste',
    material: 'electronics',
    tip: 'Do not bin it. Request an e-waste pickup.',
    labels: [
      'electronics',
      'mobile phone',
      'phone',
      'cell phone',
      'laptop',
      'computer',
      'computer keyboard',
      'keyboard',
      'mouse',
      'headphones',
      'cable',
      'wire',
      'charger',
      'remote control',
      'monitor',
      'television',
      'tv',
      'camera',
      'hardware',
      'circuit board',
      'printer',
      'electrical device',
    ],
  },
  {
    category: 'special_care',
    material: 'hazardous',
    tip: 'Keep it sealed and separate; give it at a special-care collection point.',
    labels: [
      'light bulb',
      'lightbulb',
      'paint',
      'paint container',
      'spray can',
      'aerosol',
      'medication',
      'pill',
      'pills',
      'syringe',
      'thermometer',
      'chemical',
      'tube light',
    ],
  },
  {
    category: 'sanitary',
    material: 'sanitary',
    tip: 'Wrap it in paper, mark it and keep it out of the dry bin.',
    labels: [
      'diaper',
      'sanitary napkin',
      'napkin',
      'tissue',
      'bandage',
      'face mask',
      'mask',
      'toilet paper',
    ],
  },
  {
    category: 'wet',
    material: 'organic',
    tip: 'Drain any liquid and put it in the green bin, or compost it.',
    labels: [
      'food',
      'fruit',
      'vegetable',
      'banana',
      'apple',
      'orange',
      'peel',
      'plant',
      'leaf',
      'flower',
      'bread',
      'egg',
      'produce',
      'meal',
      'citrus fruit',
      'compost',
      'rice',
    ],
  },
  {
    category: 'dry',
    material: 'glass',
    tip: 'Rinse it; wrap broken glass before binning.',
    labels: ['glass', 'jar', 'wine bottle', 'beer bottle'],
  },
  {
    category: 'dry',
    material: 'metal',
    tip: 'Rinse and squash it to save space.',
    labels: ['tin', 'can', 'aluminium', 'aluminum', 'metal', 'canned goods', 'foil'],
  },
  {
    category: 'dry',
    material: 'cardboard',
    tip: 'Flatten it and keep it dry.',
    labels: ['cardboard', 'carton', 'box'],
  },
  {
    category: 'dry',
    material: 'paper',
    tip: 'Keep it dry; a kabadiwala will buy it.',
    labels: ['paper', 'newspaper', 'book', 'magazine', 'envelope'],
  },
  {
    category: 'dry',
    material: 'textile',
    tip: 'Donate if wearable; otherwise keep dry for recycling.',
    labels: ['clothing', 'apparel', 'shirt', 't-shirt', 'fabric', 'shoe', 'footwear', 'jeans'],
  },
  {
    category: 'dry',
    material: 'plastic',
    tip: 'Rinse it and remove the cap before putting it in the blue bin.',
    labels: [
      'plastic',
      'bottle',
      'water bottle',
      'plastic bag',
      'bag',
      'cup',
      'container',
      'packaging',
      'wrapper',
    ],
  },
];

/** Rekognition knows objects, not bins, so its confidence is capped below Bedrock's. */
const MAX_FALLBACK_CONFIDENCE = 0.75;

export function sortFromLabels(labels: Label[]): SortOutput {
  let best: { rule: SortRule; label: Label } | undefined;
  for (const rule of SORT_RULES) {
    for (const label of labels) {
      if (!rule.labels.includes(label.name.toLowerCase())) continue;
      if (!best || label.confidence > best.label.confidence) best = { rule, label };
    }
  }
  if (!best) {
    return {
      isWasteItem: labels.length > 0,
      itemName: labels[0]?.name ?? 'Unknown item',
      category: 'dry',
      material: 'mixed',
      tip: 'We could not tell what this is. Pick the right bin below.',
      confidence: 0.2,
    };
  }
  return {
    isWasteItem: true,
    itemName: best.label.name,
    category: best.rule.category,
    material: best.rule.material,
    tip: best.rule.tip,
    confidence: Math.min(MAX_FALLBACK_CONFIDENCE, (best.label.confidence / 100) * 0.8),
  };
}

const TRASH = [
  'garbage',
  'trash',
  'litter',
  'rubbish',
  'waste',
  'dump',
  'landfill',
  'garbage can',
  'trash can',
  'dumpster',
  'bin',
  'plastic bag',
];
const MESSY = ['litter', 'rubbish', 'dump', 'landfill', 'pollution'];
const HAZARD_LABELS: Record<string, string[]> = {
  burning: ['fire', 'flame', 'smoke', 'bonfire'],
  animals: ['dog', 'cow', 'cattle', 'animal', 'pig', 'rat', 'crow', 'bird'],
  waterlogging: ['puddle', 'flood', 'sewer', 'drain'],
};

export function severityFromLabels(labels: Label[]): SeverityOutput {
  const has = (names: string[], min = 70) =>
    labels.filter((l) => names.includes(l.name.toLowerCase()) && l.confidence >= min);
  const trash = has(TRASH);
  const messy = has(MESSY, 75);
  const hazards = Object.entries(HAZARD_LABELS)
    .filter(([, names]) => has(names, 75).length > 0)
    .map(([tag]) => tag);

  let severity: Severity = 'low';
  if (hazards.includes('burning') || (messy.length >= 2 && trash.length >= 4)) severity = 'high';
  else if (messy.length >= 1 || trash.length >= 3) severity = 'medium';

  const top = trash[0];
  return {
    isBinOrDump: trash.length > 0,
    severity,
    reason: top
      ? `Detected ${trash
          .map((l) => l.name.toLowerCase())
          .slice(0, 3)
          .join(', ')}${hazards.length ? ` with ${hazards.join(', ')}` : ''}.`
      : 'No bin or garbage detected in the photo.',
    hazards,
    confidence: top ? Math.min(0.7, (top.confidence / 100) * 0.75) : 0.3,
  };
}
