#!/usr/bin/env node
// check-internal-bundle.mjs — prove the internal build is AWS-free and branded (req #4076).
//
//   node scripts/check-internal-bundle.mjs [--no-build] [--out DIR] [--name NAME]
//
// Builds `vite build --mode internal` into DIR (default .tmp/internal-build),
// then asserts over EVERY emitted file:
//   1. no `amazonaws`, `cognito` or `darwin.one` (case-insensitive) — the
//      requirement's census, run over the whole output rather than "what
//      executes", so a dead string is a failure too and nobody has to judge;
//   2. index.html's <title> and manifest.json's names are the product name
//      (`--name`, default: the build's VITE_PRODUCT_NAME, i.e. Topology);
//   3. the default build's markers are gone (no `<title>Darwin`).
// `--no-build` checks an existing DIR (the rename rehearsal builds with an env
// override and checks with `--name`). Exit 0 = pass, 1 = a finding, 2 = misuse.

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { loadEnv } from 'vite'

const darwinRoot = path.resolve(import.meta.dirname, '..')
const args = process.argv.slice(2)
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined }
const outDir = path.resolve(darwinRoot, flag('--out') || '.tmp/internal-build')
const expectedName = flag('--name')
  || process.env.VITE_PRODUCT_NAME
  || loadEnv('internal', darwinRoot, 'VITE_').VITE_PRODUCT_NAME
if (!expectedName) { console.error('no product name to expect'); process.exit(2) }

if (!args.includes('--no-build')) {
  execFileSync('npx', ['vite', 'build', '--mode', 'internal', '--outDir', outDir, '--emptyOutDir'],
    { cwd: darwinRoot, stdio: ['ignore', 'ignore', 'inherit'] })
}

const FORBIDDEN = /amazonaws|cognito|darwin\.one|googleapis|gstatic/gi
const findings = []
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)])

let scanned = 0
for (const file of walk(outDir)) {
  if (!/\.(js|mjs|css|html|json|txt|map|svg|webmanifest)$/i.test(file)) continue
  scanned++
  const text = fs.readFileSync(file, 'utf8')
  for (const m of text.matchAll(FORBIDDEN)) {
    const at = m.index
    findings.push(`${path.relative(outDir, file)}: '${m[0]}' … ${JSON.stringify(text.slice(Math.max(0, at - 60), at + 60))}`)
    if (findings.length > 40) break
  }
}

const html = fs.readFileSync(path.join(outDir, 'index.html'), 'utf8')
const title = html.match(/<title>([^<]*)<\/title>/)?.[1]
if (title !== expectedName) findings.push(`index.html <title> is ${JSON.stringify(title)}, expected ${JSON.stringify(expectedName)}`)
if (html.includes('%PRODUCT_')) findings.push('index.html has an unfilled %PRODUCT_*% placeholder')
const manifest = JSON.parse(fs.readFileSync(path.join(outDir, 'manifest.json'), 'utf8'))
if (manifest.short_name !== expectedName) findings.push(`manifest.json short_name is ${JSON.stringify(manifest.short_name)}`)
if (!String(manifest.name).startsWith(expectedName)) findings.push(`manifest.json name is ${JSON.stringify(manifest.name)}`)

console.log(`internal bundle: ${outDir}`)
console.log(`scanned=${scanned} product_name=${expectedName} title=${title}`)
if (findings.length) {
  console.log(`status=fail findings=${findings.length}`)
  for (const f of findings) console.log(`  ${f}`)
  process.exit(1)
}
console.log('status=ok — no amazonaws|cognito|darwin.one|googleapis|gstatic anywhere in the build output')
