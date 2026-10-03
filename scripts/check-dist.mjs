// Read-only release gate: inspect the assembled package, never source secrets.
import { existsSync, readdirSync, lstatSync, readFileSync } from 'node:fs'
import { resolve, join, relative, basename } from 'node:path'
import { fileURLToPath } from 'node:url'

const forbiddenDirs = new Set(['.git', '.github', 'node_modules', 'session', 'auth_info_baileys', 'database', 'graphify-out', '.codex', '.claude', '.wrangler', '.playwright-cli', 'output', 'polar-license-api'])
export const requiredFiles = ['index.js', 'start.js', 'package.json', 'package-lock.json', 'src/handler.js', 'src/config.js', 'src/sqliteCompat.js', 'src/ffmpegPath.js', 'patches/baileys.cjs', 'scripts/check-install.mjs', 'scripts/check-runtime.mjs', 'scripts/smoke-dist.mjs', 'web/jogos/index.html']
const privateConfigs = new Set(['bot.json', 'ia.json', 'apis.json', 'grupos.json', 'loja.json', 'licenca-bind.json', 'licenca-inst.json'])
export function checkDistribution(root) {
  root = resolve(root)
  const errors = []
  if (!existsSync(root)) return ['Pacote inexistente']
  if (!lstatSync(root).isDirectory()) return ['O pacote deve ser uma pasta real']
  function walk(dir) {
    for (const item of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, item.name)
      const rel = relative(root, full).replaceAll('\\', '/')
      const name = item.name.toLowerCase()
      // The destination repository already contains its own .git metadata.
      if (dir === root && name === '.git') continue
      if (item.isSymbolicLink()) { errors.push(`Ligação simbólica: ${rel}`); continue }
      if (item.isDirectory()) {
        if (forbiddenDirs.has(name)) errors.push(`Pasta privada: ${rel}`)
        else walk(full)
      } else if (/^\.env(?:\.|$)/.test(name) || /\.(?:bak|pem|key|db|sqlite|sqlite3|jsonl|log)$/.test(name)
          || /^(?:preparacao-|pesquisa-).*\.md$/.test(name) || name === 'security_best_practices_report.md'
          || (basename(dir).toLowerCase() === 'config' && privateConfigs.has(name))) {
        errors.push(`Ficheiro privado: ${rel}`)
      }
    }
  }
  walk(root)
  for (const required of requiredFiles) {
    try { if (!lstatSync(join(root, required)).isFile()) throw new Error('not-file') }
    catch { errors.push(`Ficheiro obrigatório ausente: ${required}`) }
  }
  if (existsSync(join(root, 'package.json'))) {
    try {
      const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
      if (pkg.type !== 'module' || pkg.scripts?.start !== 'node start.js' || !pkg.dependencies?.['@whiskeysockets/baileys']) {
        errors.push('package.json incompatível com o arranque do Polar')
      }
    } catch { errors.push('package.json inválido') }
  }
  return errors
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) {
    console.error('Indica a pasta do pacote final. Não usar a pasta de trabalho.')
    process.exitCode = 1
  } else {
    const errors = checkDistribution(process.argv[2])
    if (errors.length) {
      console.error('Publicação bloqueada:\n' + errors.join('\n'))
      process.exitCode = 1
    } else console.log('Pacote validado: estrutura presente e nenhum caminho privado detetado.')
  }
}
