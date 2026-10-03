// Update only the provisioned polar-testes service, never other services.
// Group promotion requires the explicit --native-buttons-groups option.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, lstatSync, symlinkSync, renameSync } from 'node:fs'
import { join, resolve } from 'node:path'
const [archive, hash, releaseName, ...options] = process.argv.slice(2)
const allowedOptions = ['--native-buttons-alo', '--native-buttons-groups', '--fresh-dependencies']
if (options.some(option => !allowedOptions.includes(option)) || new Set(options).size !== options.length
  || options.filter(option => option.startsWith('--native-buttons-')).length > 1) throw new Error('Unknown test option')
const nativeFlag = options.find(option => option.startsWith('--native-buttons-'))
const freshDependencies = options.includes('--fresh-dependencies')
const promoteGroups = nativeFlag === '--native-buttons-groups'
if (process.platform !== 'linux' || process.getuid?.() !== 0) throw new Error('Linux administrator required')
const tar = resolve(archive ?? '')
if (!/^\/tmp\/polar-upload-[A-Za-z0-9]+\/polar-fixed\.tgz$/.test(tar) || !/^[a-f0-9]{64}$/.test(hash ?? '') || !/^20\d{6}-[A-Za-z0-9]{6,16}$/.test(releaseName ?? '')) throw new Error('Invalid target')
if (createHash('sha256').update(readFileSync(tar)).digest('hex') !== hash) throw new Error('Checksum mismatch')
const unitPath = '/etc/systemd/system/polar-testes.service'
const unit = readFileSync(unitPath, 'utf8')
const old = unit.match(/^WorkingDirectory=(\/opt\/polar-testes\/releases\/20\d{6}-[A-Za-z0-9]{6,16})$/m)?.[1]
if (!old || !unit.includes('\nUser=polar-testes\n') || !unit.includes(`ExecStart=/usr/bin/node ${old}/index.js\n`) || !unit.includes('ReadWritePaths=/var/lib/polar-testes\n')) throw new Error('Unexpected service: not modified')
const release = join('/opt/polar-testes/releases', releaseName)
let replacement = unit.replace(`WorkingDirectory=${old}`, `WorkingDirectory=${release}`).replace(`ExecStart=/usr/bin/node ${old}/index.js`, `ExecStart=/usr/bin/node ${release}/index.js`)
const envPath = '/etc/polar-testes/instance.env'
let previousEnv, replacementEnv
if (nativeFlag) {
  if (!/^EnvironmentFile=\/etc\/polar-testes\/instance\.env$/m.test(unit) || [...unit.matchAll(/^EnvironmentFile=/gm)].length !== 1) throw new Error('Unexpected environment file')
  if (lstatSync(envPath).isSymbolicLink()) throw new Error('Unexpected environment symlink')
  previousEnv = readFileSync(envPath, 'utf8')
  const isolated = /^POLAR_TEST_GROUP=alo\r?$/m.test(previousEnv)
  const groupMode = /^POLAR_TEST_GROUP=\r?$/m.test(previousEnv) && /^POLAR_GROUP_SCOPE=all\r?$/m.test(previousEnv)
  if (!(isolated || (promoteGroups && groupMode)) || !/^POLAR_INSTANCIA=alo-teste\r?$/m.test(previousEnv)) throw new Error('Native buttons require the isolated alo instance or its explicit group promotion')
  replacement = replacement.replace(/^Environment=POLAR_NATIVE_BUTTONS_TEST=.*\n/gm, '')
    .replace(`WorkingDirectory=${release}\n`, `WorkingDirectory=${release}\nEnvironment=POLAR_NATIVE_BUTTONS_TEST=${promoteGroups ? '0' : '1'}\n`)
  if (promoteGroups) {
    // systemd EnvironmentFile overrides Environment, regardless of unit order.
    // Keep identity, licence, panel token and all unrelated settings verbatim.
    replacementEnv = previousEnv.replace(/^(?:POLAR_TEST_GROUP|POLAR_GROUP_SCOPE|POLAR_NATIVE_BUTTONS(?:_TEST)?)=.*(?:\r?\n|$)/gm, '')
    if (replacementEnv && !replacementEnv.endsWith('\n')) replacementEnv += '\n'
    replacementEnv += 'POLAR_TEST_GROUP=\nPOLAR_GROUP_SCOPE=all\nPOLAR_NATIVE_BUTTONS=1\nPOLAR_NATIVE_BUTTONS_TEST=0\n'
  }
}
if (existsSync(release) || (!freshDependencies && !existsSync(join(old, 'node_modules')))) throw new Error('Release exists or dependencies missing')
const paths = execFileSync('tar', ['-tzf', tar], { encoding: 'utf8' }).split('\n').filter(Boolean)
if (paths.some(p => p.startsWith('/') || p.split('/').includes('..') || /^(?:\.\/)?(?:node_modules|session|sessoes|database)(?:\/|$)/.test(p))) throw new Error('Unsafe archive entry')
const archiveTypes = execFileSync('tar', ['-tvzf', tar], { encoding: 'utf8' }).split('\n').filter(Boolean)
if (archiveTypes.some(line => !/^[d-]/.test(line))) throw new Error('Archive contains links or special entries')
// Validate the release while the current service continues running.
mkdirSync(release, { recursive: false, mode: 0o755 })
execFileSync('tar', ['-xzf', tar, '--no-same-owner', '-C', release])
function verify(dir) { for (const entry of readdirSync(dir, { withFileTypes: true })) { const p = join(dir, entry.name); if (lstatSync(p).isSymbolicLink()) throw new Error('Unexpected symlink'); if (entry.isDirectory()) verify(p) } }
verify(release)
// Changed dependencies require an explicit clean installation, as the service
// account, while the previous release stays online. Never overwrite its modules.
if (!freshDependencies) {
  if (!readFileSync(join(old, 'package-lock.json')).equals(readFileSync(join(release, 'package-lock.json')))) throw new Error('Dependency change requires a fresh installation')
  symlinkSync(join(old, 'node_modules'), join(release, 'node_modules'), 'dir')
}
execFileSync('chown', ['-R', 'polar-testes:polar-testes', release])
if (freshDependencies) {
  execFileSync('runuser', ['-u', 'polar-testes', '--', 'npm', 'ci', '--omit=dev', '--ignore-scripts', '--no-fund', '--no-audit'],
    { cwd: release, stdio: 'inherit', timeout: 180000 })
  execFileSync('runuser', ['-u', 'polar-testes', '--', 'node', 'patches/baileys.cjs'],
    { cwd: release, stdio: 'inherit', timeout: 60000 })
}
for (const args of [['scripts/check-runtime.mjs'], ['scripts/smoke-dist.mjs', '.', '--installed']]) {
  execFileSync('runuser', ['-u', 'polar-testes', '--', 'node', ...args], { cwd: release, stdio: 'inherit', timeout: 60000, env: { ...process.env, POLAR_DIR: '/var/lib/polar-testes', POLAR_INSTANCIA: 'alo-teste' } })
}
writeFileSync(`${unitPath}.${releaseName}.bak`, unit, { mode: 0o600, flag: 'wx' })
const stagedEnv = `${envPath}.${releaseName}.next`
if (promoteGroups) {
  writeFileSync(`${envPath}.${releaseName}.bak`, previousEnv, { mode: 0o600, flag: 'wx' })
  writeFileSync(stagedEnv, replacementEnv, { mode: 0o600, flag: 'wx' })
}
let envChanged = false
try {
  execFileSync('systemctl', ['stop', 'polar-testes.service'])
  if (promoteGroups) { renameSync(stagedEnv, envPath); envChanged = true }
  writeFileSync(unitPath, replacement, { mode: 0o644 })
  execFileSync('systemctl', ['daemon-reload'])
  // After daemon-reload a stopped unit may be unloaded; start loads it again.
  try { execFileSync('systemctl', ['reset-failed', 'polar-testes.service'], { stdio: 'ignore' }) } catch { /* not loaded or not failed */ }
  execFileSync('systemctl', ['start', 'polar-testes.service'])
  execFileSync('systemctl', ['is-active', '--quiet', 'polar-testes.service'])
} catch (updateError) {
  try {
    execFileSync('systemctl', ['stop', 'polar-testes.service'])
    if (envChanged) {
      writeFileSync(stagedEnv, previousEnv, { mode: 0o600, flag: 'wx' })
      renameSync(stagedEnv, envPath)
    }
    writeFileSync(unitPath, unit, { mode: 0o644 })
    execFileSync('systemctl', ['daemon-reload'])
    try { execFileSync('systemctl', ['reset-failed', 'polar-testes.service'], { stdio: 'ignore' }) } catch { /* not loaded or not failed */ }
    execFileSync('systemctl', ['start', 'polar-testes.service'])
    execFileSync('systemctl', ['is-active', '--quiet', 'polar-testes.service'])
  } catch (rollbackError) {
    throw new AggregateError([updateError, rollbackError], 'Update and prior-service recovery failed')
  }
  throw new Error('Update failed; prior test service restored', { cause: updateError })
}
console.log(`Only polar-testes updated${promoteGroups ? ' with explicit all-group scope' : ''}; previous release, service and scope backups retained. Existing WhatsApp session preserved.`)
