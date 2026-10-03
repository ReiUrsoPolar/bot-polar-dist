// Read-only preflight. Resolve packages without executing them or starting the bot.
import { readFileSync, statSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

export function checkInstall(root) {
  root = resolve(root)
  const errors = [], warnings = []
  let pkg
  try { pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) }
  catch { return { errors: ['package.json ausente ou inválido'], warnings } }
  for (const name of ['index.js', 'start.js', 'src/handler.js', 'src/config.js', 'patches/baileys.cjs']) {
    try { if (!statSync(join(root, name)).isFile()) throw new Error('not-file') }
    catch { errors.push(`Ficheiro necessário ausente: ${name}`) }
  }
  const require = createRequire(join(root, 'package.json'))
  for (const name of Object.keys(pkg.dependencies || {})) {
    try { require.resolve(name) }
    catch { errors.push(`Dependência não encontrada: ${name}`) }
  }
  for (const name of Object.keys(pkg.optionalDependencies || {})) {
    try { require.resolve(name) }
    catch { warnings.push(`Dependência opcional não encontrada: ${name}`) }
  }
  return { errors, warnings }
}

export function reportInstall(root = process.cwd()) {
  const result = checkInstall(root)
  console.log(`Diagnóstico local — Node ${process.version} (${process.platform})`)
  for (const warning of result.warnings) console.log('AVISO: ' + warning)
  for (const error of result.errors) console.error('ERRO: ' + error)
  if (!result.errors.length) console.log('Ficheiros essenciais e dependências obrigatórias encontrados.')
  console.log('Não instala, não atualiza, não lê credenciais e não liga ao WhatsApp. Não verifica APIs nem binários nativos.')
  return result.errors.length ? 1 : 0
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = reportInstall(process.argv[2])
}
