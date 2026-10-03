// Disposable build; --full covers every source JS without starting WhatsApp.
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { prepareCandidate } from './prepare-candidate.mjs'
import { checkDistribution } from './check-dist.mjs'
const root = fileURLToPath(new URL('../', import.meta.url))
const cli = process.argv[2]
if (!cli) throw new Error('Indica o caminho do executável javascript-obfuscator já instalado.')
const workflow = readFileSync(join(root, '.github/workflows/build-dist.yml'), 'utf8')
const match = workflow.match(/cat > \/tmp\/obf\.json << 'OBFEOF'\s*([\s\S]*?)\s*OBFEOF/)
if (!match) throw new Error('Configuração de ofuscação não encontrada')
const config = JSON.parse(match[1])
const complete = process.argv.includes('--package')
const out = complete ? prepareCandidate(root).root : mkdtempSync(join(tmpdir(), 'polar-obfuscated-'))
if (!complete) {
  mkdirSync(join(out, 'src'))
  writeFileSync(join(out, 'package.json'), JSON.stringify({ type: 'module' }))
}
const reportDir = mkdtempSync(join(tmpdir(), 'polar-build-report-'))
const configPath = join(reportDir, 'obf.json')
writeFileSync(configPath, JSON.stringify(config))
console.log('Cópia temporária: ' + out)
function run(args) {
  const r = spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8', timeout: 180000, maxBuffer: 8 * 1024 * 1024 })
  if (r.error || r.status !== 0) {
    console.error(r.error?.message || r.stderr || r.stdout)
    process.exit(r.status || 1)
  }
}
function sourceFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name)
    if (entry.isSymbolicLink()) throw new Error('Ligação simbólica recusada: ' + entry.name)
    return entry.isDirectory() ? sourceFiles(path) : entry.name.endsWith('.js') ? [relative(root, path)] : []
  })
}
const full = complete || process.argv.includes('--full')
const files = full ? [...sourceFiles(join(root, 'src')), 'index.js']
  : ['antiFlood.js', 'antiStatus.js', 'geminiProvider.js', 'serviceCircuit.js'].map(name => join('src', name))
for (const [i, name] of files.entries()) {
  mkdirSync(dirname(join(out, name)), { recursive: true })
  console.log(`[${i + 1}/${files.length}] ${name}`)
  run([cli, join(root, name), '--output', join(out, name), '--config', configPath])
  run(['--check', join(out, name)])
}
run([join(root, 'scripts/smoke-dist.mjs'), out])
if (complete) {
  const errors = checkDistribution(out)
  if (errors.length) throw new Error(errors.join('\n'))
}
writeFileSync(join(reportDir, 'validation.json'), JSON.stringify({ root: out, completePackage: complete, files, syntax: 'passed', smoke: 'passed', whatsappTested: false, published: false }, null, 2))
console.log('Relatório: ' + join(reportDir, 'validation.json'))
console.log(`${files.length} ficheiros ofuscados e sintaxe validada. Smoke limitado aos módulos puros; WhatsApp não testado. Não publica.`)
