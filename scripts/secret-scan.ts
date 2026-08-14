// secret-scan - fails loudly if credentials appear anywhere in the repo.
// Usage: bun run scripts/secret-scan.ts
// Pattern prefixes are assembled at runtime so this file never matches itself.

import { Glob } from 'bun'

const GH = 'github' + '_pat_'
const CF = 'cf' + 'ut_'
const SB = 's' + 'bp_'

const PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: 'github-pat', re: new RegExp(GH + '[A-Za-z0-9_]{20,}') },
  { name: 'cloudflare-user-token', re: new RegExp(CF + '[A-Za-z0-9]{20,}') },
  { name: 'supabase-key', re: new RegExp(SB + '[a-f0-9]{20,}') },
  { name: 'jwt-like', re: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/ },
  { name: 'aws-access-key', re: /AKIA[0-9A-Z]{16}/ },
  { name: 'private-key-block', re: /-----BEGIN (RSA|EC|OPENSSH|PGP) PRIVATE KEY-----/ },
]

const SKIP_DIRS = new Set(['node_modules', '.next', '.git'])
const glob = new Glob('**/*.{ts,tsx,js,json,md,sh,yml,yaml,env}')
const cwd = process.cwd()
let found = 0

for await (const file of glob.scan(cwd)) {
  const parts = file.split('/')
  if (parts.some((p) => SKIP_DIRS.has(p))) continue
  let text: string
  try {
    text = await Bun.file(file).text()
  } catch {
    continue
  }
  for (const p of PATTERNS) {
    if (p.re.test(text)) {
      found += 1
      console.error('SECRET-PATTERN FOUND:', p.name, 'in', file)
    }
  }
}

if (found > 0) {
  console.error('secret-scan: FAILED (' + found + ' findings)')
  process.exit(1)
}
console.log('secret-scan: clean')
