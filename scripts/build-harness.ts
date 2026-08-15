// Build the browser render-harness bundle (public/render-harness.js).
// IIFE so it self-registers window.runRender when loaded by render-harness.html.
import { build } from 'bun'

const result = await build({
  entrypoints: ['./browser/render-harness.ts'],
  outdir: './public',
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
console.log('render-harness bundle built -> public/render-harness.js')
