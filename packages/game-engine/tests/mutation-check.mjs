import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const engine = fileURLToPath(new URL('../', import.meta.url))
const sandbox = mkdtempSync(join(tmpdir(), 'nim-relay-mutations-'))
const mutations = [
  { name: 'SplitMix64 increment', file: 'src/prng/index.ts', from: '0x9e3779b97f4a7c15n', to: '0x9e3779b97f4a7c17n', reason: 'seed-derived corridor and cycle schedule change' },
  { name: 'Q16.16 multiplication', file: 'src/fixed-point/index.ts', from: '* integer(b) / 65536n', to: '* integer(b) / 65535n', reason: 'canonical velocity and target rounding change' },
  { name: 'Stabilize safe-zone scoring', file: 'src/scoring/index.ts', from: 'm.safeTicks * 6000', to: 'm.safeTicks * 5000', reason: 'safe-zone score contribution changes' },
]
function run() {
  return spawnSync(process.execPath, [resolve(engine, 'node_modules/vitest/vitest.mjs'), 'run', '--root', sandbox, 'src/replay/corpus.test.ts'], { cwd: sandbox, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } })
}
try {
  cpSync(join(engine, 'src'), join(sandbox, 'src'), { recursive: true })
  cpSync(join(engine, 'tests/corpus'), join(sandbox, 'tests/corpus'), { recursive: true })
  cpSync(join(engine, 'package.json'), join(sandbox, 'package.json'))
  symlinkSync(join(engine, 'node_modules'), join(sandbox, 'node_modules'), 'dir')
  const baseline = run()
  if (baseline.status !== 0) throw new Error(`Baseline failed:\n${baseline.stdout}\n${baseline.stderr}`)
  console.log('Baseline: 201 corpus checks passed in an isolated source copy.')
  for (const mutation of mutations) {
    const path = join(sandbox, mutation.file)
    const original = readFileSync(path, 'utf8')
    if (!original.includes(mutation.from)) throw new Error(`Missing mutation target: ${mutation.name}`)
    let broken
    try {
      writeFileSync(path, original.replace(mutation.from, mutation.to))
      broken = run()
    } finally {
      writeFileSync(path, original)
    }
    const output = `${broken.stdout}\n${broken.stderr}`
    if (broken.status === 0 || !output.includes('AssertionError') || !output.includes('resultHash')) throw new Error(`Mutation was not caught by replay snapshots: ${mutation.name}\n${output}`)
    const summary = output.split('\n').find(line => /Tests\s+\d+ failed/.test(line))?.trim() ?? 'snapshot assertion failures'
    console.log(`DETECTED ${mutation.name}: ${mutation.reason}; ${summary}`)
    const restored = run()
    if (restored.status !== 0) throw new Error(`Restore failed: ${mutation.name}\n${restored.stdout}\n${restored.stderr}`)
    console.log(`RESTORED ${mutation.name}: 201 corpus checks passed.`)
  }
} finally {
  rmSync(sandbox, { recursive: true, force: true })
}
