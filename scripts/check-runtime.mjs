// Check installed modules in a disposable build, without importing index/handler.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'
const root = resolve(process.argv[2] || '.')
const require = createRequire(join(root, 'package.json'))
const baileys = await import(pathToFileURL(require.resolve('@whiskeysockets/baileys')).href)
assert.equal(typeof baileys.makeWASocket, 'function')
console.log('Baileys carrega; nenhuma ligação/socket criado.')
let Database, engine
try {
  Database = require('better-sqlite3')
  const probe = new Database(':memory:')
  probe.close()
  engine = 'better-sqlite3'
} catch {
  Database = (await import(pathToFileURL(join(root, 'src/sqliteCompat.js')).href)).default
  engine = 'node:sqlite (alternativa)'
}
const db = new Database(':memory:')
try {
  db.exec('CREATE TABLE probe (value INTEGER)')
  db.prepare('INSERT INTO probe VALUES (?)').run(42)
  assert.equal(db.prepare('SELECT value FROM probe').get().value, 42)
} finally { db.close() }
console.log('SQLite em memória aprovado: ' + engine)
const { FFMPEG_PATH } = await import(pathToFileURL(join(root, 'src/ffmpegPath.js')).href)
const ffmpeg = spawnSync(FFMPEG_PATH, ['-version'], { encoding: 'utf8', timeout: 15000 })
assert.equal(ffmpeg.status, 0, 'FFmpeg não executa: ' + (ffmpeg.error?.code || ffmpeg.status))
console.log('FFmpeg executa corretamente.')
const sharp = (await import(pathToFileURL(require.resolve('sharp')).href)).default
const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#ffffff' } }).png().toBuffer()
assert.ok(png.length > 50)
console.log('Sharp/libvips converte uma imagem sintética corretamente.')
console.log('Runtime básico aprovado. Não testa credenciais, APIs, envio de mensagens ou arranque completo.')
