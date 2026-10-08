import { Asset } from 'expo-asset';

import { imageId, type ImportImage } from '@/services/accountImport/images';

/**
 * SYNTHETIC dashboard screenshots for trying the importer (Demo Mode / preview).
 * Mock-ups of common layouts — not real firm screenshots, not real accounts.
 * They run through the real OCR and extraction, nothing is pre-filled.
 */
const SAMPLES = [
  { key: 'lucid', name: 'Lucid-style dashboard (sample)', mod: require('../../../assets/samples/account-lucid.png'), w: 900, h: 720 },
  { key: 'lucid-details', name: 'Lucid-style account details (sample)', mod: require('../../../assets/samples/account-lucid-details.png'), w: 756, h: 720 },
  { key: 'topstep', name: 'Topstep-style table (sample)', mod: require('../../../assets/samples/account-topstep.png'), w: 908, h: 720 },
  { key: 'generic', name: 'Generic dashboard (sample)', mod: require('../../../assets/samples/account-generic.png'), w: 868, h: 720 },
  { key: 'blurry', name: 'Blurry phone photo (sample)', mod: require('../../../assets/samples/account-blurry.png'), w: 330, h: 150 },
] as const;

export type SampleKey = (typeof SAMPLES)[number]['key'];
export const SAMPLE_SETS: { label: string; keys: SampleKey[] }[] = [
  { label: 'Lucid dashboard', keys: ['lucid'] },
  { label: 'Lucid + details page', keys: ['lucid', 'lucid-details'] },
  { label: 'Topstep-style', keys: ['topstep'] },
  { label: 'Generic layout', keys: ['generic'] },
  { label: 'Blurry photo', keys: ['blurry'] },
];

export async function sampleImages(keys: SampleKey[]): Promise<(ImportImage & { sample: true })[]> {
  const out: (ImportImage & { sample: true })[] = [];
  for (const k of keys) {
    const s = SAMPLES.find((x) => x.key === k)!;
    const a = Asset.fromModule(s.mod);
    if (!a.localUri && !a.uri.startsWith('http') && !a.uri.startsWith('/')) await a.downloadAsync();
    out.push({ id: imageId(), uri: a.localUri ?? a.uri, name: s.name, width: a.width ?? s.w, height: a.height ?? s.h, sample: true });
  }
  return out;
}
