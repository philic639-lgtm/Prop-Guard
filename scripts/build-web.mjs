// Production web build (used by Vercel and `npm run build:web`):
//   1. copy the free on-device OCR engine into public/ocr (scripts/ocr-assets.mjs)
//   2. export the web app to dist/, serving the OCR files from the site itself
//      (EXPO_PUBLIC_OCR_ASSETS_URL=/ocr unless already set) instead of a third-party CDN.
//      The OCR model is fetched as `eng.traineddata.wasm` (EXPO_PUBLIC_OCR_RESTRICTED_HOST=true):
//      a host that adds `Content-Encoding: gzip` to `.gz` files would make the browser
//      decompress the model early and break screenshot reading; the .wasm copy avoids that.
//   --clear: EXPO_PUBLIC_* values are inlined when a file is transformed, and a cached transform
//   from an earlier build keeps the OLD value (e.g. a key added after the first build stays
//   missing). Clearing the bundler cache makes every build use the current environment.
// Cross-platform (no shell syntax), so it runs the same on Vercel, macOS and Windows.
import { spawnSync } from 'node:child_process';

const run = (cmd, args, env) => {
  const r = spawnSync(cmd, args, { stdio: 'inherit', env: { ...process.env, ...env }, shell: process.platform === 'win32' });
  if (r.status !== 0) process.exit(r.status ?? 1);
};

run(process.execPath, ['scripts/ocr-assets.mjs']);
run('npx', ['expo', 'export', '--platform', 'web', '--output-dir', 'dist', '--clear'], {
  EXPO_PUBLIC_OCR_ASSETS_URL: process.env.EXPO_PUBLIC_OCR_ASSETS_URL || '/ocr',
  EXPO_PUBLIC_OCR_RESTRICTED_HOST: process.env.EXPO_PUBLIC_OCR_RESTRICTED_HOST || 'true',
});
