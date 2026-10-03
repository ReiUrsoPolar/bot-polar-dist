// Test with disposable instance data, not the owner's live config/database.
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('../', import.meta.url))
const data = mkdtempSync(join(tmpdir(), 'polar-check-'))
const env = { ...process.env, POLAR_DIR: data, POLAR_INSTANCIA: 'test-only' }
console.log('Dados descartáveis de teste: ' + data)
for (const [tool, args] of [
  ['node_modules/eslint/bin/eslint.js', ['.']],
  ['node_modules/vitest/vitest.mjs', ['run', ...process.argv.slice(2)]],
]) {
  const result = spawnSync(process.execPath, [tool, ...args], {cwd:root,env,stdio:'inherit'})
  if (result.status !== 0 || result.error) process.exit(result.status || 1)
}
console.log('Verificação local concluída; não publica nem confirma operações reais no WhatsApp.')
