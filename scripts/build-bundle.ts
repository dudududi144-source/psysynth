// Build the ESM bundle: public/psysynth.js (single file, no globals, es2020).
// Usage: bun run scripts/build-bundle.ts
// Size budget: < 60KB minified (enforced manually in CI output).

import { build } from 'bun'

const result = await build({
  entrypoints: ['./src/psy-synth/index.ts'],
  outdir: './public',
  naming: 'psysynth.js',
  target: 'browser',
  format: 'esm',
  minify: true,
  sourcemap: 'external',
})

if (!result.success) {
  console.error('psysynth bundle build failed:', result.logs)
  process.exit(1)
}
console.log('psysynth bundle built -> public/psysynth.js')
