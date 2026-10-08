import type { BinInfo, Material, PickupItemType, Severity, WasteCategory } from './types';

export const WASTE_CATEGORIES: readonly WasteCategory[] = [
  'wet',
  'dry',
  'sanitary',
  'special_care',
  'e_waste',
];

/**
 * Disposal guidance per stream, following the Solid Waste Management Rules 2026
 * (wet, dry, sanitary, special care) and the E-Waste (Management) Rules 2022.
 */
export const BINS: Record<WasteCategory, BinInfo> = {
  wet: {
    category: 'wet',
    label: 'Green bin · Wet waste',
    labelHi: 'हरा डिब्बा · गीला कचरा',
    colour: '#2E8B57',
    instruction: 'Kitchen and garden waste. Drain liquids and keep plastic out.',
    instructionHi: 'रसोई और बगीचे का कचरा। तरल निकाल दें और प्लास्टिक न डालें।',
  },
  dry: {
    category: 'dry',
    label: 'Blue bin · Dry waste',
    labelHi: 'नीला डिब्बा · सूखा कचरा',
    colour: '#2563EB',
    instruction: 'Keep it clean and dry. Recyclables can go to a kabadiwala.',
    instructionHi: 'साफ़ और सूखा रखें। रीसायकल होने वाली चीज़ें कबाड़ीवाले को दें।',
  },
  sanitary: {
    category: 'sanitary',
    label: 'Sanitary waste · Wrap and mark',
    labelHi: 'सैनिटरी कचरा · लपेटकर निशान लगाएँ',
    colour: '#DC2626',
    instruction: 'Wrap in paper or a pouch, mark it, and hand it over separately.',
    instructionHi: 'काग़ज़ या पाउच में लपेटें, निशान लगाएँ और अलग से दें।',
  },
  special_care: {
    category: 'special_care',
    label: 'Special-care waste · Keep separate',
    labelHi: 'विशेष देखभाल कचरा · अलग रखें',
    colour: '#B45309',
    instruction:
      'Paint, bulbs, medicines, thermometers. Keep sealed and give at a collection point.',
    instructionHi: 'पेंट, बल्ब, दवाइयाँ, थर्मामीटर। बंद रखें और संग्रह केंद्र पर दें।',
  },
  e_waste: {
    category: 'e_waste',
    label: 'E-waste · Do not bin',
    labelHi: 'ई-कचरा · डिब्बे में न डालें',
    colour: '#7C3AED',
    instruction: 'Give it to an authorised recycler. Request a pickup below.',
    instructionHi: 'अधिकृत रीसाइक्लर को दें। नीचे पिकअप बुक करें।',
  },
};

export const CATEGORY_LABELS: Record<WasteCategory, { en: string; hi: string }> = {
  wet: { en: 'Wet waste', hi: 'गीला कचरा' },
  dry: { en: 'Dry waste', hi: 'सूखा कचरा' },
  sanitary: { en: 'Sanitary waste', hi: 'सैनिटरी कचरा' },
  special_care: { en: 'Special-care waste', hi: 'विशेष देखभाल कचरा' },
  e_waste: { en: 'E-waste', hi: 'ई-कचरा' },
};

export const MATERIALS: readonly Material[] = [
  'organic',
  'plastic',
  'paper',
  'cardboard',
  'metal',
  'glass',
  'textile',
  'electronics',
  'battery',
  'hazardous',
  'sanitary',
  'mixed',
  'other',
];

export const MATERIAL_LABELS: Record<Material, { en: string; hi: string }> = {
  organic: { en: 'Organic', hi: 'जैविक' },
  plastic: { en: 'Plastic', hi: 'प्लास्टिक' },
  paper: { en: 'Paper', hi: 'काग़ज़' },
  cardboard: { en: 'Cardboard', hi: 'गत्ता' },
  metal: { en: 'Metal', hi: 'धातु' },
  glass: { en: 'Glass', hi: 'काँच' },
  textile: { en: 'Clothes', hi: 'कपड़े' },
  electronics: { en: 'Electronics', hi: 'इलेक्ट्रॉनिक्स' },
  battery: { en: 'Batteries', hi: 'बैटरी' },
  hazardous: { en: 'Hazardous', hi: 'ख़तरनाक' },
  sanitary: { en: 'Sanitary', hi: 'सैनिटरी' },
  mixed: { en: 'Mixed', hi: 'मिश्रित' },
  other: { en: 'Other', hi: 'अन्य' },
};

/** Dry materials a kabadiwala typically buys. */
export const RECYCLABLE_MATERIALS: readonly Material[] = [
  'plastic',
  'paper',
  'cardboard',
  'metal',
  'glass',
  'textile',
];

export const E_WASTE_MATERIALS: readonly Material[] = ['electronics', 'battery'];

export const PICKUP_MATERIALS: Record<PickupItemType, readonly Material[]> = {
  dry: RECYCLABLE_MATERIALS,
  e_waste: E_WASTE_MATERIALS,
};

export function isRecyclable(category: WasteCategory, material: Material): boolean {
  if (category === 'e_waste') return true;
  return category === 'dry' && RECYCLABLE_MATERIALS.includes(material);
}

/** Recyclables and e-waste get a "Request pickup" button. */
export function isPickupEligible(category: WasteCategory, material: Material): boolean {
  return isRecyclable(category, material);
}

export function pickupItemTypeFor(category: WasteCategory): PickupItemType {
  return category === 'e_waste' ? 'e_waste' : 'dry';
}

export const SEVERITY_RANK: Record<Severity, number> = { high: 3, medium: 2, low: 1 };

/** Below this confidence the UI asks for a retake or a manual choice instead of guessing. */
export const LOW_CONFIDENCE_THRESHOLD = 0.6;
