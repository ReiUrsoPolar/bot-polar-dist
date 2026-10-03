// Local-only candidate. Mirrors workflow exclusions; never publishes or starts WhatsApp.
import { mkdtempSync, readdirSync, mkdirSync, copyFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkDistribution } from './check-dist.mjs'

export function excludedFromCandidate(path, patterns) {
  return patterns.some(pattern => {
    const value = pattern.replace(/\/$/, '')
    const regex = new RegExp('^' + value.split('*').map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$')
    return value.includes('/') ? regex.test(path) : path.split('/').some(part => regex.test(part))
  })
}

export function prepareCandidate(source) {
  source = resolve(source)
  const workflow = readFileSync(join(source, '.github/workflows/build-dist.yml'), 'utf8')
  const patterns = [...workflow.matchAll(/--exclude='([^']+)'/g)].map(m => m[1])
  if (!patterns.includes('config/bot.json') || !patterns.includes('.env*')) throw new Error('Exclusões de distribuição ausentes')
  const root = mkdtempSync(join(tmpdir(), 'polar-candidate-'))
  let files = 0
  function copy(dir, rel = '') {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = rel ? `${rel}/${entry.name}` : entry.name
      if (excludedFromCandidate(path, patterns)) continue
      if (entry.isSymbolicLink()) throw new Error(`Ligação simbólica recusada: ${path}`)
      const target = join(root, path)
      if (entry.isDirectory()) { mkdirSync(target); copy(join(dir, entry.name), path) }
      else if (entry.isFile()) { copyFileSync(join(dir, entry.name), target); files++ }
      else throw new Error(`Tipo de ficheiro recusado: ${path}`)
    }
  }
  copy(source)
  const errors = checkDistribution(root)
  if (errors.length) throw new Error(errors.join('\n'))
  return { root, files, published: false, obfuscated: false }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(prepareCandidate(process.argv[2] || '.'), null, 2))
}
