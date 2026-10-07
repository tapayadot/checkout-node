import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

// Exercise the exact validation code run by the job with OIDC permissions.
const workflow = fs.readFileSync(new URL('../.github/workflows/publish.yml', import.meta.url), 'utf8')
const step = workflow.split('      - name: Verify release artifact\n')[1]
const match = step?.match(/          node --input-type=module <<'JS'\n([\s\S]*?)\n          JS/)
assert.ok(match, 'Release artifact verification must exist in the publish workflow')
const verifier = match[1].replace(/^ {10}/gm, '')

const manifest = {
  name: '@tapayadot/checkout',
  version: '0.2.0',
  repository: { url: 'git+https://github.com/tapayadot/checkout-node.git' },
  publishConfig: { access: 'public' },
  dependencies: { zod: '4.6.5' },
  scripts: { build: 'tsc' },
}

function verify(t, change = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tapaya-release-check-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const fixture = path.join(root, 'fixture')
  fs.mkdirSync(path.join(fixture, 'package/dist/client'), { recursive: true })
  const files = {
    'package/LICENSE': 'License',
    'package/README.md': 'Readme',
    'package/dist/index.d.ts': 'export {}',
    'package/dist/index.js': 'throw new Error("Artifact code must not execute")',
    'package/dist/browser.d.ts': 'export {}',
    'package/dist/browser.js': 'throw new Error("Artifact code must not execute")',
    ...Object.fromEntries(['errors', 'index', 'react', 'types', 'version'].flatMap((name) => [
      [`package/dist/client/${name}.d.ts`, 'export {}'],
      [`package/dist/client/${name}.js`, 'throw new Error("Artifact code must not execute")'],
    ])),
    'package/package.json': JSON.stringify({ ...manifest, ...change.manifest }),
    ...change.files,
  }
  for (const [name, contents] of Object.entries(files)) {
    fs.writeFileSync(path.join(fixture, name), contents)
  }
  if (change.symlink) {
    const entry = path.join(fixture, 'package/dist/index.js')
    fs.unlinkSync(entry)
    fs.symlinkSync('../README.md', entry)
  }
  fs.mkdirSync(path.join(root, 'release'))
  const archive = path.join(root, 'release/checkout.tgz')
  execFileSync('tar', ['-czf', archive, '-C', fixture, ...Object.keys(files)])
  const digest = createHash('sha256').update(fs.readFileSync(archive)).digest('hex')
  return spawnSync(process.execPath, ['--input-type=module'], {
    cwd: root,
    input: verifier,
    encoding: 'utf8',
    env: { ...process.env, EXPECTED_VERSION: manifest.version, EXPECTED_SHA256: change.digest ?? digest },
  })
}

test('accept a valid artifact without executing its JavaScript', (t) => {
  const result = verify(t)
  assert.equal(result.status, 0, result.stderr)
})

for (const [name, change, message] of [
  ['a substituted artifact', { digest: '0'.repeat(64) }, 'Release artifact digest mismatch'],
  ['a different package', { manifest: { name: '@other/package' } }, '@tapayadot/checkout'],
  ['a different version', { manifest: { version: '0.1.1' } }, manifest.version],
  ['an install script', { manifest: { scripts: { postinstall: 'echo unexpected' } } }, 'Unexpected package script'],
  ['an unpinned dependency', { manifest: { dependencies: { zod: '^4.6.5' } } }, 'Runtime dependencies must use exact versions'],
  ['a registry override', { manifest: { publishConfig: { access: 'public', registry: 'https://other.example' } } }, 'registry'],
  ['an unexpected file', { files: { 'package/.npmrc': 'registry=https://other.example' } }, 'Unexpected files'],
  ['a symbolic link', { symlink: true }, 'only regular files'],
]) {
  test(`reject ${name}`, (t) => {
    const result = verify(t, change)
    assert.notEqual(result.status, 0)
    assert.ok(result.stderr.includes(message), result.stderr)
  })
}
