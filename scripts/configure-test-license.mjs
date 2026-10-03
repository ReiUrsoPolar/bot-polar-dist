// Configure only the already provisioned, stopped VPS test instance.
import { execFileSync } from 'node:child_process'
import { readFileSync, copyFileSync, openSync, writeFileSync, fsyncSync, closeSync, renameSync, chmodSync, realpathSync, constants } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
if (process.platform !== 'linux' || process.getuid?.() !== 0) throw new Error('Linux administrator required')
const patchPath = resolve(process.argv[2] ?? '')
if (!/^\/tmp\/polar-upload-[A-Za-z0-9]+\/bot-config-patch\.json$/.test(patchPath)) throw new Error('Unexpected private input')
const unit = readFileSync('/etc/systemd/system/polar-testes.service', 'utf8')
const release = unit.match(/^WorkingDirectory=(\/opt\/polar-testes\/releases\/20\d{6}-[A-Za-z0-9]{6,16})$/m)?.[1]
if (!release || !unit.includes('\nUser=polar-testes\n') || !unit.includes('ReadWritePaths=/var/lib/polar-testes\n')) throw new Error('Unexpected test service')
const status = execFileSync('systemctl', ['show', 'polar-testes.service', '--property=ActiveState', '--value'], { encoding: 'utf8' }).trim()
if (!['inactive', 'failed'].includes(status)) throw new Error('Stop the test service before modifying its licence')
const root = '/var/lib/polar-testes', configPath = join(root, 'config/bot.json')
if (realpathSync(root) !== root || realpathSync(configPath) !== configPath) throw new Error('Unexpected data path')
const patch = JSON.parse(readFileSync(patchPath, 'utf8'))
if (Object.keys(patch).sort().join(',') !== 'licencaKey,licencaNome' || patch.licencaNome !== 'VPS-ALO-TESTE-20261002' || typeof patch.licencaKey !== 'string') throw new Error('Unexpected patch fields')
const config = JSON.parse(readFileSync(configPath, 'utf8'))
if (String(config.numeroDono).replace(/\D/g, '') !== '351913579908') throw new Error('Owner mismatch: not changed')
process.env.POLAR_DIR = root
const { validarChave } = await import(pathToFileURL(join(release, 'src/licenca.js')).href)
const verified = validarChave(patch.licencaKey)
if (!verified.valida) throw new Error('Licence signature not accepted by installed bot')
const response = await fetch('https://polar-license-api.polarvendas.workers.dev/api/license/' + verified.keyId, { headers: { Authorization: 'Bearer ' + patch.licencaKey, 'X-Polar-Ts': String(Date.now()) }, signal: AbortSignal.timeout(10000), redirect: 'error' })
if (!response.ok) throw new Error('Online licence verification failed: ' + response.status)
const online = await response.json()
if (online.revogada !== false || online.keyId !== verified.keyId || online.botPhone !== '351910981784' || online.donoPhone !== '351913579908') throw new Error('Online licence record does not match this test instance')
const backup = configPath + '.before-license-' + randomUUID()
copyFileSync(configPath, backup, constants.COPYFILE_EXCL); chmodSync(backup, 0o600)
const temp = configPath + '.' + randomUUID() + '.tmp'
const descriptor = openSync(temp, 'wx', 0o600)
try { writeFileSync(descriptor, JSON.stringify({ ...config, ...patch }, null, 2) + '\n'); fsyncSync(descriptor) } finally { closeSync(descriptor) }
renameSync(temp, configPath)
execFileSync('chown', ['polar-testes:polar-testes', configPath])
const readback = JSON.parse(readFileSync(configPath, 'utf8'))
if (readback.licencaKey !== patch.licencaKey || readback.licencaNome !== patch.licencaNome) throw new Error('Config readback mismatch')
console.log('Internal test licence configured; signed and online verified. Original owner, settings and private backup preserved. No client licence modified.')
