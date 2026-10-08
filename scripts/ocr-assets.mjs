// Copy the free OCR engine (tesseract.js worker + WASM core + English model)
// into public/ocr so the web app can serve it from its own host instead of
// the jsDelivr CDN. Then build with EXPO_PUBLIC_OCR_ASSETS_URL=/ocr.
//   npm run ocr:assets && EXPO_PUBLIC_OCR_ASSETS_URL=/ocr npx expo export --platform web
import { copyFileSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const out = join(process.cwd(), 'public', 'ocr');
const worker = join(dirname(require.resolve('tesseract.js/package.json')), 'dist', 'worker.min.js');
const core = dirname(require.resolve('tesseract.js-core/package.json'));
const lang = join(dirname(require.resolve('@tesseract.js-data/eng/package.json')), '4.0.0_best_int', 'eng.traineddata.gz');

mkdirSync(join(out, 'core'), { recursive: true });
mkdirSync(join(out, 'lang'), { recursive: true });
copyFileSync(worker, join(out, 'worker.min.js'));
// LSTM-only builds (what Prop Guard uses), with and without SIMD.
for (const f of readdirSync(core)) if (/lstm\.wasm\.js$/.test(f)) copyFileSync(join(core, f), join(out, 'core', f));
copyFileSync(lang, join(out, 'lang', 'eng.traineddata.gz'));
console.log(`OCR assets copied to ${out}`);
