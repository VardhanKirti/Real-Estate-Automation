import type { PoolAd } from '@/lib/creative-engine/schemas';

/** Deterministic pool for CREATIVE_ENGINE_DRY and tests — shaped exactly like a
 *  WallAd + research fields, so every downstream step runs unchanged.
 *  Neutral on purpose (S03 Q-ENG-8): the same fictional desk-lamp world as the
 *  sample, so a dry session never invents a claim about anyone's business. */
export const DRY_POOL: PoolAd[] = [
  { id: 'dry-ad-1', brand: 'Northwind Tools', brandId: 'b1', thumbnail: null, video: null, image: null, format: 'video', live: true, daysRunning: 74, hook: 'I stopped working at midnight because my lamp told me to', hookSource: 'spoken', transcript: [{ t: 0, s: 'I stopped working at midnight because my lamp told me to.' }, { t: 4, s: 'It dims a little every half hour after nine.' }], drivers: { curiosity: 8.1, relief: 6.4, status: 5.2, fear: 2.1 }, ctaType: 'LEARN_MORE', linkUrl: null, probes: ['lamp that dims at night'], duplicates: 6 },
  { id: 'dry-ad-2', brand: 'Kestrel Systems', brandId: 'b2', thumbnail: null, video: null, image: null, format: 'video', live: true, daysRunning: 41, hook: 'This lamp has a bedtime', hookSource: 'spoken', transcript: [{ t: 0, s: 'This lamp has a bedtime.' }], drivers: { relief: 7.7, curiosity: 5.9, greed: 4.3 }, ctaType: 'SHOP_NOW', linkUrl: null, probes: ['lamp that dims at night', 'eye strain at night'], duplicates: 3 },
  { id: 'dry-ad-3', brand: 'Orbit Labs', brandId: 'b3', thumbnail: null, video: null, image: null, format: 'image', live: true, daysRunning: 33, hook: 'The calmest desk on the internet', hookSource: 'text', transcript: [], drivers: { status: 8.8, curiosity: 6.2 }, ctaType: 'SHOP_NOW', linkUrl: null, probes: ['desk setup upgrade'], duplicates: 1 },
  { id: 'dry-ad-4', brand: 'Northwind Tools', brandId: 'b1', thumbnail: null, video: null, image: null, format: 'video', live: true, daysRunning: 29, hook: 'My eyes stopped hurting in a week', hookSource: 'spoken', transcript: [{ t: 0, s: 'My eyes stopped hurting in a week.' }], drivers: { relief: 8.9, curiosity: 4.4 }, ctaType: 'LEARN_MORE', linkUrl: null, probes: ['eye strain at night'], duplicates: 2 },
  { id: 'dry-ad-5', brand: 'Pinion', brandId: 'b4', thumbnail: null, video: null, image: null, format: 'video', live: false, daysRunning: 22, hook: 'Your desk knows you are tired before you do', hookSource: 'spoken', transcript: [{ t: 0, s: 'Your desk knows you are tired before you do.' }], drivers: { curiosity: 7.0, fear: 5.5 }, ctaType: null, linkUrl: null, probes: ['lamp that dims at night'], duplicates: null },
];
