// Build the browser render-harness bundle into browser/render-harness.js so it sits
// NEXT TO browser/render-harness.html (the page references ./render-harness.js,
// and the Playwright spec loads the page over file://).
import { build } from 'bun'

const result = await build({
  entrypoints: ['./browser/render-harness.ts'],
  outdir: './browser',
  naming: 'render-harness.js',
  target: 'browser',
  format: 'iife',
  minify: true,
  sourcemap: 'none',
})

if (!result.success) {
  console.error('render-harness build failed:', result.logs)
  process.exit(1)
}
console.log('render-harness bundle built -> browser/render-harness.js')
