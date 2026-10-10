import type { Material, WasteCategory } from '@cleanloop/shared';
import type { AiOptions, ImageInput, SeverityAiResult, SortAiResult, WasteAi } from './types';

interface MockItem {
  keywords: string[];
  itemName: string;
  itemNameHi: string;
  category: WasteCategory;
  material: Material;
  tip: string;
  tipHi: string;
  confidence: number;
}

// Local development has no model, so the file name picks the answer. Name a photo
// "banana.jpg" or "battery.png" to demo each stream; anything else is a bottle.
const ITEMS: MockItem[] = [
  {
    keywords: ['banana', 'peel', 'food', 'fruit', 'vegetable', 'tea'],
    itemName: 'Banana peel',
    itemNameHi: 'केले का छिलका',
    category: 'wet',
    material: 'organic',
    tip: 'Put it in the green bin or your compost pit.',
    tipHi: 'इसे हरे डिब्बे या खाद के गड्ढे में डालें।',
    confidence: 0.94,
  },
  {
    keywords: ['phone', 'laptop', 'charger', 'cable', 'ewaste', 'e-waste'],
    itemName: 'Old phone charger',
    itemNameHi: 'पुराना फ़ोन चार्जर',
    category: 'e_waste',
    material: 'electronics',
    tip: 'Do not bin it. Request an e-waste pickup.',
    tipHi: 'इसे डिब्बे में न डालें। ई-कचरा पिकअप बुक करें।',
    confidence: 0.91,
  },
  {
    keywords: ['battery', 'cell'],
    itemName: 'AA battery',
    itemNameHi: 'AA बैटरी',
    category: 'e_waste',
    material: 'battery',
    tip: 'Tape the ends and give it to an e-waste recycler.',
    tipHi: 'सिरों पर टेप लगाएँ और ई-कचरा रीसाइक्लर को दें।',
    confidence: 0.9,
  },
  {
    keywords: ['bulb', 'paint', 'medicine', 'tablet', 'thermometer'],
    itemName: 'CFL bulb',
    itemNameHi: 'सीएफ़एल बल्ब',
    category: 'special_care',
    material: 'hazardous',
    tip: 'Keep it unbroken in a box and give it at a collection point.',
    tipHi: 'इसे बिना तोड़े डिब्बे में रखें और संग्रह केंद्र पर दें।',
    confidence: 0.88,
  },
  {
    keywords: ['diaper', 'pad', 'sanitary', 'tissue'],
    itemName: 'Used diaper',
    itemNameHi: 'इस्तेमाल किया डायपर',
    category: 'sanitary',
    material: 'sanitary',
    tip: 'Wrap it in newspaper and mark it before handing over.',
    tipHi: 'अख़बार में लपेटें और देने से पहले निशान लगाएँ।',
    confidence: 0.9,
  },
  {
    keywords: ['box', 'cardboard', 'carton'],
    itemName: 'Cardboard box',
    itemNameHi: 'गत्ते का डिब्बा',
    category: 'dry',
    material: 'cardboard',
    tip: 'Flatten it and keep it dry; a kabadiwala will buy it.',
    tipHi: 'इसे चपटा करके सूखा रखें; कबाड़ीवाला इसे ख़रीद लेगा।',
    confidence: 0.93,
  },
  {
    keywords: ['can', 'tin', 'metal'],
    itemName: 'Aluminium can',
    itemNameHi: 'एल्युमिनियम कैन',
    category: 'dry',
    material: 'metal',
    tip: 'Rinse and squash it.',
    tipHi: 'धोकर पिचका दें।',
    confidence: 0.92,
  },
  {
    keywords: ['blurry', 'unknown', 'selfie'],
    itemName: 'Unclear photo',
    itemNameHi: 'अस्पष्ट फ़ोटो',
    category: 'dry',
    material: 'mixed',
    tip: 'Try again with the item filling the frame.',
    tipHi: 'वस्तु को फ़्रेम में भरकर फिर से कोशिश करें।',
    confidence: 0.32,
  },
];

const DEFAULT_ITEM: MockItem = {
  keywords: [],
  itemName: 'Plastic bottle',
  itemNameHi: 'प्लास्टिक की बोतल',
  category: 'dry',
  material: 'plastic',
  tip: 'Rinse it and remove the cap before putting it in the blue bin.',
  tipHi: 'नीले डिब्बे में डालने से पहले धोकर ढक्कन हटा दें।',
  confidence: 0.89,
};

export class MockAi implements WasteAi {
  async classify(_image: ImageInput, opts: AiOptions): Promise<SortAiResult> {
    const hint = (opts.hint ?? '').toLowerCase();
    const item = ITEMS.find((i) => i.keywords.some((k) => hint.includes(k))) ?? DEFAULT_ITEM;
    const hi = opts.lang === 'hi';
    return {
      isWasteItem: item.confidence >= 0.5,
      itemName: hi ? item.itemNameHi : item.itemName,
      category: item.category,
      material: item.material,
      tip: hi ? item.tipHi : item.tip,
      confidence: item.confidence,
      source: 'mock',
    };
  }

  async assessSeverity(_image: ImageInput, opts: AiOptions): Promise<SeverityAiResult> {
    const hint = (opts.hint ?? '').toLowerCase();
    if (/(selfie|cat|dog|flower)/.test(hint)) {
      return {
        isBinOrDump: false,
        severity: 'low',
        reason: 'No bin or garbage is visible.',
        hazards: [],
        confidence: 0.8,
        source: 'mock',
      };
    }
    if (/(small|full|low)/.test(hint)) {
      return {
        isBinOrDump: true,
        severity: 'low',
        reason: 'Bin is full but the waste is contained.',
        hazards: [],
        confidence: 0.82,
        source: 'mock',
      };
    }
    if (/(dump|fire|burn|drain)/.test(hint)) {
      return {
        isBinOrDump: true,
        severity: 'high',
        reason: 'Large roadside dump spilling into the drain.',
        hazards: ['blocking_drain', 'animals'],
        confidence: 0.9,
        source: 'mock',
      };
    }
    return {
      isBinOrDump: true,
      severity: 'medium',
      reason: 'Bin is overflowing with bags spilling onto the footpath.',
      hazards: [],
      confidence: 0.86,
      source: 'mock',
    };
  }
}
