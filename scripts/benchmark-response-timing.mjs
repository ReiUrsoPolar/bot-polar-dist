// Local simulation only: no configuration, live session, or WhatsApp connection.
// Replays the old cosmetic formulas with midpoint jitter and a fixed mock network.
import { performance } from 'node:perf_hooks'
import { criarFilaEnvio } from '../src/sendQueue.js'
import { enviarComPresenca } from '../src/responseTiming.js'
import ping from '../src/plugins/ping.js'

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const networkMs = 50
const oldTyping = text => Math.min(400 + text.length * 22 + 200, 2600)
const oldReplyPause = text => 280 + Math.min(Math.floor(text.length * 1.2), 600) + 160
function fixture(old) {
  let lastAdmission = 0, sent = 0
  const queue = criarFilaEnvio({ gate: async () => {
    // Same idle/burst-free admission base for both: normal midpoint 325 ms.
    await sleep(Math.max(0, lastAdmission + 325 - performance.now()))
    lastAdmission = performance.now()
  } })
  const sock = { sendPresenceUpdate: async () => {} }
  const send = text => queue.executar(async () => {
    if (old) await sleep(oldTyping(text))
    return enviarComPresenca(sock, 'simulation@g.us', { text }, async () => {
      await sleep(networkMs); sent++
    })
  }, { key: 'simulation@g.us' })
  return {
    send,
    reply: async text => { if (old) await sleep(oldReplyPause(text)); return send(text) },
    stats: () => ({ sends: sent }),
  }
}
async function measure(label, old, command) {
  const instance = fixture(old), start = performance.now()
  if (command === 'menu-direct') await instance.send('x'.repeat(2000))
  else if (command === 'reply-long') await instance.reply('x'.repeat(2000))
  else if (old) {
    const pingStart = Date.now()
    await instance.send('🏓 A calcular...')
    await instance.reply(`🏓 *Pong!* ⚡ *${Date.now() - pingStart}ms*`)
  } else await ping.executar({ ctx: { processamentoIniciadoEm: start }, reply: instance.reply })
  return { case: label, msUntilFinalReply: Math.round(performance.now() - start), ...instance.stats() }
}
const results = []
for (const command of ['ping', 'menu-direct', 'reply-long']) {
  results.push(await measure(command + '-before', true, command))
  results.push(await measure(command + '-after', false, command))
}
console.log(JSON.stringify({ simulation: true, transportDelayMs: networkMs, admissionBaseMs: 325, results }, null, 2))
