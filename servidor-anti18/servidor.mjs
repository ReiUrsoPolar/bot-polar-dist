#!/usr/bin/env node
// servidor-anti18 — verificador de imagens +18 para os bots
//
// Corre na TUA VPS. Instala-se aqui UMA vez (~345 MB) e todos os bots usam por
// HTTP — nenhum cliente instala nada, e uma correcção aqui chega a todos sem
// ninguém actualizar o bot.
//
// Arrancar:
//   npm install
//   ANTI18_TOKEN=umsegredolongo node servidor.mjs
//
// O bot liga-se com:
//   !anti18 servidor https://o-teu-dominio:8787 umsegredolongo
//
// Segurança: exige o token em todos os pedidos. Sem ele, qualquer pessoa que
// descubra o endereço gastava o teu CPU a classificar imagens dela.

import { createServer } from 'http'
import * as tf from '@tensorflow/tfjs'
import * as nsfw from 'nsfwjs'
import sharp from 'sharp'

const PORTA = Number(process.env.PORT || process.env.ANTI18_PORT || 8787)
const TOKEN = process.env.ANTI18_TOKEN || ''
const MAX_BYTES = 8 * 1024 * 1024      // 8 MB: acima disto não é foto de grupo

if (!TOKEN) {
  console.error('✗ Falta ANTI18_TOKEN. Define um segredo longo antes de arrancar:')
  console.error('  ANTI18_TOKEN=$(openssl rand -hex 24) node servidor.mjs')
  process.exit(1)
}
if (TOKEN.length < 16) {
  console.error('✗ ANTI18_TOKEN demasiado curto (mín. 16 caracteres).')
  process.exit(1)
}

// ── Limiares ──────────────────────────────────────────────────────────
// Iguais aos do bot, e pelas mesmas razões:
// "Sexy" NÃO conta — é onde caem biquínis, roupa interior e ginásio. Apagar
// isso faz o admin desligar o filtro, e desligado não protege nada.
// Hentai exige mais que Porn porque anime normal confunde-se.
const LIMIARES = {
  porn  : Number(process.env.ANTI18_LIMIAR_PORN   || 0.70),
  hentai: Number(process.env.ANTI18_LIMIAR_HENTAI || 0.75),
  somado: Number(process.env.ANTI18_LIMIAR_SOMADO || 0.85),
}

function decidir(previsoes) {
  const p = {}
  for (const x of previsoes) p[x.className.toLowerCase()] = x.probability
  const porn = p.porn ?? 0, hentai = p.hentai ?? 0
  if (porn >= LIMIARES.porn)   return 'adulto'
  if (hentai >= LIMIARES.hentai) return 'adulto'
  if (porn + hentai >= LIMIARES.somado) return 'adulto'
  return 'seguro'
}

console.log('a carregar o modelo…')
const modelo = await nsfw.load()
console.log('✓ modelo pronto')

// ── Contadores (para o /saude) ────────────────────────────────────────
let _total = 0, _adultos = 0, _erros = 0
const _arranque = Date.now()

// Trava simples por IP: um bot mal configurado em ciclo não te derruba a VPS.
const _porIp = new Map()
const LIMITE_MIN = Number(process.env.ANTI18_LIMITE_MIN || 120)
function podeIp(ip) {
  const agora = Date.now(), janela = 60_000
  const e = _porIp.get(ip)
  if (!e || agora - e.desde > janela) { _porIp.set(ip, { desde: agora, n: 1 }); return true }
  e.n++
  if (_porIp.size > 500) for (const [k, v] of _porIp) if (agora - v.desde > janela) _porIp.delete(k)
  return e.n <= LIMITE_MIN
}

function json(res, codigo, corpo) {
  const txt = JSON.stringify(corpo)
  res.writeHead(codigo, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(txt) })
  res.end(txt)
}

// Comparação em tempo constante — não deixa adivinhar o token pelo tempo.
function tokenIgual(a, b) {
  if (typeof a !== 'string' || a.length !== b.length) return false
  let d = 0
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return d === 0
}

const servidor = createServer(async (req, res) => {
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '?'
  const url = new URL(req.url, 'http://x')

  if (url.pathname === '/saude') {
    return json(res, 200, {
      ok: true,
      analisadas: _total,
      adultos: _adultos,
      erros: _erros,
      ligadoHa: Math.round((Date.now() - _arranque) / 1000) + 's',
      limiares: LIMIARES,
    })
  }

  if (url.pathname !== '/verificar' || req.method !== 'POST') {
    return json(res, 404, { ok: false, erro: 'usa POST /verificar' })
  }

  const enviado = req.headers['x-anti18-token'] || url.searchParams.get('token') || ''
  if (!tokenIgual(String(enviado), TOKEN)) return json(res, 401, { ok: false, erro: 'token inválido' })
  if (!podeIp(ip)) return json(res, 429, { ok: false, erro: 'demasiados pedidos' })

  const pedacos = []
  let tamanho = 0
  try {
    for await (const p of req) {
      tamanho += p.length
      if (tamanho > MAX_BYTES) { req.destroy(); return json(res, 413, { ok: false, erro: 'imagem grande demais' }) }
      pedacos.push(p)
    }
  } catch {
    return json(res, 400, { ok: false, erro: 'falha a ler o corpo' })
  }

  const buffer = Buffer.concat(pedacos)
  if (!buffer.length) return json(res, 400, { ok: false, erro: 'corpo vazio' })

  let tensor = null
  try {
    const { data, info } = await sharp(buffer)
      .resize(224, 224, { fit: 'fill' }).removeAlpha().raw()
      .toBuffer({ resolveWithObject: true })
    tensor = tf.tensor3d(new Uint8Array(data), [info.height, info.width, 3], 'int32')
    const previsoes = await modelo.classify(tensor)
    const veredicto = decidir(previsoes)

    _total++
    if (veredicto === 'adulto') _adultos++

    return json(res, 200, {
      ok: true,
      veredicto,
      previsoes: previsoes.map(p => ({ classe: p.className, prob: Number(p.probability.toFixed(4)) })),
    })
  } catch (e) {
    _erros++
    // Formato que o sharp não lê (vídeo, ficheiro corrompido) — não é erro do
    // servidor. O bot trata ok:false como "não sei" e NÃO apaga nada.
    return json(res, 200, { ok: false, erro: 'não consegui ler a imagem' })
  } finally {
    try { tensor?.dispose() } catch {}
  }
})

servidor.listen(PORTA, () => {
  console.log(`✓ anti +18 a ouvir na porta ${PORTA}`)
  console.log(`  saúde: http://localhost:${PORTA}/saude`)
})
