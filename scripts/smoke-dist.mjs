import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { EventEmitter } from 'node:events'
// Mesmo um módulo de moderação pode carregar configuração/DB indiretamente.
// Nunca gerar dados dentro do pacote que se vai verificar/publicar.
process.env.POLAR_DIR = mkdtempSync(join(tmpdir(), 'polar-dist-smoke-'))
process.env.POLAR_INSTANCIA = 'dist-smoke-only'
const root = resolve(process.argv[2] || '.')
const mod = name => import(pathToFileURL(resolve(root, 'src', name)).href)
const { aplicarFusoHorario, formatarHoraBot } = await mod('horario.js')
assert.equal(aplicarFusoHorario(), 'America/Sao_Paulo')
const timeProbe = new Date('2026-10-04T01:02:03Z')
assert.equal(formatarHoraBot(timeProbe), '22:02:03')
assert.equal(timeProbe.getHours(), 22)
assert.equal(timeProbe.getDate(), 3)
assert.equal(timeProbe.toISOString(), '2026-10-04T01:02:03.000Z')
console.log('Smoke OK: fuso de Brasília, viragem do dia e instantes UTC preservados.')
const { criarAntiFlood, normalizarEventoReacao, tipoFlood } = await mod('antiFlood.js')
const flood = criarAntiFlood({ now: () => 1000000 })
for (let i = 0; i < 3; i++) {
  const result = flood.avaliar({ grupo: 'test@g.us', sender: '123', config: { ativo: true, limite: 3 }, msg: { key: { id: String(i) }, messageTimestamp: 1000, message: { stickerMessage: {} } } })
  assert.equal(Boolean(result), i === 2)
}
const reactionGuard = criarAntiFlood({ now: () => 1000000 })
const reactionTarget = { id: 'raffle', remoteJid: 'test@g.us', participant: '9@lid', fromMe: true }
const reactionEvent = id => ({ key: reactionTarget, reaction: {
  key: { id, remoteJid: 'test@g.us', participant: '1@lid', fromMe: false },
  text: '👍', senderTimestampMs: 1000000,
} })
const reactionConfig = { ativo: true, limite: 4, janela: 10, acao: 'ban' }
for (let i = 0; i < 12; i++) {
  const msg = normalizarEventoReacao(reactionEvent('reaction-' + i))
  assert.equal(msg.key.participant, '1@lid')
  assert.equal(msg.key.fromMe, false)
  const result = reactionGuard.avaliarReacao({ grupo: 'test@g.us', sender: '1@lid', msg, config: reactionConfig })
  if (i < 11) assert.equal(result, null)
  else { assert.equal(result.acao, 'observar'); assert.equal(result.alertar, true) }
}
const duplicateReaction = reactionGuard.avaliarReacao({ grupo: 'test@g.us', sender: '1@lid',
  msg: normalizarEventoReacao(reactionEvent('reaction-11')), config: reactionConfig })
assert.equal(duplicateReaction.acao, 'observar')
assert.equal(duplicateReaction.alertar, false)
const missingStamp = reactionEvent('no-stamp')
delete missingStamp.reaction.senderTimestampMs
assert.equal(normalizarEventoReacao(missingStamp).messageTimestamp, undefined)
assert.equal(reactionGuard.avaliarReacao({ grupo: 'test@g.us', sender: '1@lid',
  msg: normalizarEventoReacao(missingStamp), config: reactionConfig }), null)
const { classificarStatus, politicaStatus } = await mod('antiStatus.js')
assert.equal(classificarStatus({ groupStatusMentionMessage: {} }), 'status')
assert.equal(classificarStatus({ viewOnceMessage: { message: { imageMessage: {} } } }), 'viewonce')
assert.equal(classificarStatus({ extendedTextMessage: { contextInfo: { quotedMessage: { groupStatusMentionMessage: {} } } } }), null)
assert.equal(politicaStatus({ antistatus: 'ban', antiviewonce: 'off' }, 'viewonce'), 'off')
const { geminiRequestConfig, geminiText } = await mod('geminiProvider.js')
const request = geminiRequestConfig({ geminiApiKey: 'test-only', geminiModel: 'gemini-test' })
assert.equal(request.options.headers['x-goog-api-key'], 'test-only')
assert.equal(request.url.includes('test-only'), false)
assert.equal(geminiText({ candidates: [{ content: { parts: [{ text: 'OK' }] } }] }), 'OK')
assert.throws(() => geminiText({}), /gemini_empty_response/)
const { createServiceCircuit } = await mod('serviceCircuit.js')
let now = 100
const circuit = createServiceCircuit({ threshold: 1, cooldownMs: 10, now: () => now })
assert.equal(circuit.acquire(), true)
circuit.failure()
assert.equal(circuit.acquire(), false)
now += 11
assert.equal(circuit.acquire(), true)
assert.equal(circuit.acquire(), false)
circuit.success()
assert.equal(circuit.acquire(), true)
const { criarEditGuard } = await mod('editGuard.js')
const editGuard = criarEditGuard({ now: () => 1001000 })
const editKey = { id: 'original', remoteJid: 'test@g.us', participant: '1@lid', fromMe: false }
editGuard.guardar({ key: editKey, messageTimestamp: 1000 })
const edited = editGuard.aceitar({ key: editKey, update: { messageTimestamp: 1001, message: { editedMessage: { message: { conversation: String.fromCharCode(0x200B).repeat(35) } } } } })
assert.ok(edited)
const { avaliarEdicao, criarModeracaoEdicoes } = await mod('moderacaoEdicoes.js')
assert.equal(avaliarEdicao({ msg: edited }).regra, 'invisivel')
const operations = []
const moderation = criarModeracaoEdicoes({ now: () => 1001000 })
await moderation.moderar({
  sock: { sendMessage: async (jid, data) => { operations.push(data) } },
  msg: edited, body: '', grupo: {}, global: {}, from: editKey.remoteJid,
  sender: editKey.participant, senderNum: '1', senderM: editKey.participant,
  participants: [], groupMeta: { participants: [] }, isBotAdmin: true,
  addWarning: () => { throw new Error('unexpected warning') },
  removeMember: () => { throw new Error('unexpected removal') },
})
assert.equal(operations.filter(data => data.delete).length, 1)
assert.equal(operations.filter(data => data.text).length, 1)
const { inspecionarConteudo, textoParaModeracao } = await mod('messageInspection.js')
const { avaliarInvisivel } = await mod('antiinvisivel.js')
const hiddenText = String.fromCharCode(0x200B).repeat(40)
const largeCard = text => ({ interactiveMessage: { body: { text }, footer: { text: 'Normal '.repeat(6000) } } })
assert.equal(avaliarInvisivel({ message: largeCard(hiddenText) }, '').tipo, 'texto-invisivel')
assert.equal(avaliarInvisivel({ message: { conversation: 'Normal ' + String.fromCharCode(0x115F).repeat(50) } }, '').tipo, 'enchimento-invisivel')
assert.equal(avaliarInvisivel({ message: { conversation: hiddenText.repeat(820) + 'Legível '.repeat(6000) } }, '').fantasma, false)
assert.equal(avaliarInvisivel({ message: { conversation: '👩🏽‍💻❤️'.repeat(50) } }, '').fantasma, false)
const cardEdits = criarEditGuard({ now: () => 1001000 })
cardEdits.guardar({ key: editKey, messageTimestamp: 1000 })
const editCard = text => ({ key: editKey, update: { messageTimestamp: 1001, message: { editedMessage: { message: largeCard(text) } } } })
assert.ok(cardEdits.aceitar(editCard('Normal')))
assert.equal(avaliarEdicao({ msg: cardEdits.aceitar(editCard(hiddenText)) }).regra, 'invisivel')
assert.equal(cardEdits.aceitar(editCard(hiddenText)), null)
console.log('Smoke OK: anti-invisível com evidência por campo, Unicode contextual e edições autenticadas. Sem envios WhatsApp.')
assert.deepEqual(inspecionarConteudo({ extendedTextMessage: { contextInfo: { quotedMessage: { extendedTextMessage: { contextInfo: { mentionedJid: ['1@lid'] } } } } } }).mencoes, [])
const activeUrl = 'https://example.com/smoke-only'
const card = { interactiveMessage: { body: { text: 'Site' }, nativeFlowMessage: { buttons: [
  { name: 'cta_url', buttonParamsJson: JSON.stringify({ display_text: 'Abrir', url: activeUrl }) },
] } } }
assert.ok(textoParaModeracao(card).includes(activeUrl))
assert.equal(textoParaModeracao({ interactiveMessage: { nativeFlowMessage: { buttons: [
  { name: 'cta_copy', buttonParamsJson: JSON.stringify({ copy_code: activeUrl }) },
] } } }).includes(activeUrl), false)
assert.equal(textoParaModeracao({ extendedTextMessage: { text: 'Normal', contextInfo: { quotedMessage: card } } }), 'Normal')
assert.ok(textoParaModeracao({ contactMessage: { displayName: activeUrl, vcard: 'not-a-url' } }).includes(activeUrl))
assert.ok(textoParaModeracao({ documentMessage: { fileName: activeUrl } }).includes(activeUrl))
assert.equal(avaliarEdicao({ msg: { message: card }, grupo: { antilink: true }, hasLink: text => text.includes(activeUrl) }).regra, 'link')
for (const type of ['commentMessage', 'questionMessage', 'questionReplyMessage']) {
  assert.equal(tipoFlood({ [type]: { message: { conversation: 'Smoke' } } }), type)
}
const authors = criarEditGuard({ now: () => 1001000 })
for (const participant of ['1@lid', '2@lid']) {
  authors.guardar({ key: { ...editKey, participant }, messageTimestamp: 1000 })
}
assert.equal(authors.size, 2)
for (const participant of ['1@lid', '2@lid']) {
  const result = authors.aceitar({ key: { ...editKey, participant }, update: {
    messageTimestamp: 1001, message: { editedMessage: { message: { conversation: 'Smoke ' + participant } } },
  } })
  assert.equal(result.key.participant, participant)
}
console.log('Smoke OK: antiflood, reações deduplicadas, edições por autor, campos ativos, anti-status, Gemini e circuito de falhas.')
const { necessitaEmparelhamento } = await mod('pairingState.js')
const signedFields = Object.fromEntries(['details', 'accountSignatureKey', 'accountSignature', 'deviceSignature'].map(key => [key, 'dGVzdA==']))
assert.equal(necessitaEmparelhamento({ creds: { registered: false, me: { id: '111:7@s.whatsapp.net' }, account: signedFields } }), false)
assert.equal(necessitaEmparelhamento({ creds: { registered: true, me: { id: '111:7@s.whatsapp.net' } } }), true)
const { inteiroArgumento } = await mod('commandArguments.js')
assert.equal(inteiroArgumento('3', 1, 10), 3)
for (const value of ['3abc', '3.5', '1e1', '03', '-1']) assert.equal(inteiroArgumento(value, 1, 10), null)
const { indiceBackup, criarConfirmacoesBackup, validarBackupGrupos, configBackupSemSegredos, validarBackupSQLite } = await mod('backupSafety.js')
assert.equal(indiceBackup('1', 2), 0)
assert.equal(indiceBackup('1abc', 2), -1)
assert.equal(validarBackupGrupos({ config: {}, grupos: { '123456789@g.us': { regras: 'smoke' } } }).length, 1)
assert.deepEqual(configBackupSemSegredos({ ia: { geminiApiKey: 'not-a-real-key', nome: 'smoke' } }), { ia: { geminiApiKey: '***', nome: 'smoke' } })
const confirmations = criarConfirmacoesBackup()
const confirmation = confirmations.preparar('owner', 'chat', 'restore', { nome: 'test.db' })
assert.equal(confirmations.consumir('other', 'chat', 'restore', confirmation), null)
assert.deepEqual(confirmations.consumir('owner', 'chat', 'restore', confirmation), { nome: 'test.db' })
assert.equal(confirmations.consumir('owner', 'chat', 'restore', confirmation), null)
const { criarReservasIA } = await mod('aiFallback.js')
const reserveCalls = []
const reserves = criarReservasIA({ config: () => ({ iaProvider: 'gemini', groqApiKey: 'smoke-only' }), invoke: async name => { reserveCalls.push(name); return 'OK' } })
assert.deepEqual(await reserves.tentar('gemini', {}, new Error('offline')), { provider: 'groq', text: 'OK' })
assert.equal(await reserves.tentar('gemini', {}, new Error('IA_DAILY_LIMIT')), null)
assert.deepEqual(reserveCalls, ['groq'])
console.log('Smoke OK: argumentos estritos, confirmação/validação de backups e reserva IA limitada (sem API externa).')
const { criarEscopoTeste } = await mod('testScope.js')
const groupDestinations = []
const scopedSocket = {
  ev: new EventEmitter(),
  groupFetchAllParticipating: async () => ({ '120000100@g.us': { subject: 'alo' }, '120000999@g.us': { subject: 'outro' } }),
  sendMessage: async jid => { groupDestinations.push(jid) },
}
const allGroups = criarEscopoTeste(scopedSocket, { nome: '', modo: 'all' })
assert.equal(allGroups.ativo, true)
assert.equal(Object.keys(await allGroups.atualizar()).length, 2)
for (const jid of ['120000100@g.us', '120000999@g.us']) await scopedSocket.sendMessage(jid, {})
for (const jid of ['123@s.whatsapp.net', 'status@broadcast', 'abc@g.us']) await assert.rejects(scopedSocket.sendMessage(jid, {}), /GROUP_SCOPE/)
assert.equal(groupDestinations.length, 2)
console.log('Smoke OK: escopo de vários grupos; privados e status bloqueados, sem rede.')
if (process.argv.includes('--installed')) {
const { criarMenusBotoesNativos, instalarBotoesNativos, botoesNativosAtivos } = await mod('menuBotoesNativos.js')
const oldNativeFlag = process.env.POLAR_NATIVE_BUTTONS
try {
  process.env.POLAR_NATIVE_BUTTONS = '1'
  instalarBotoesNativos(scopedSocket, allGroups)
  assert.equal(botoesNativosAtivos(scopedSocket, '120000999@g.us'), true)
  assert.equal(botoesNativosAtivos(scopedSocket, '123@s.whatsapp.net'), false)
} finally {
  if (oldNativeFlag === undefined) delete process.env.POLAR_NATIVE_BUTTONS
  else process.env.POLAR_NATIVE_BUTTONS = oldNativeFlag
}
const native = criarMenusBotoesNativos({ permite: () => true })
let nativeCard, nativeMessageId
const fakeSock = { user: { id: '111:7@s.whatsapp.net' }, relayMessage: async (jid, message, options) => {
  nativeCard = message.documentWithCaptionMessage.message.interactiveMessage
  nativeMessageId = options.messageId
  return options.messageId
} }
assert.equal(await native.enviar(fakeSock, '120000100@g.us', [{ texto: 'IA', id: '!menuia' }]), true)
const nativeId = JSON.parse(nativeCard.nativeFlowMessage.buttons[0].buttonParamsJson).id
assert.equal(native.resolver({ key: { id: 'click', remoteJid: '120000100@g.us', participant: '222@lid' },
  message: { templateButtonReplyMessage: { selectedId: nativeId, contextInfo: { stanzaId: nativeMessageId } } },
}, fakeSock).message.conversation, '!menuia')
const ctaSmoke = criarMenusBotoesNativos({ permite: () => true })
assert.equal(await ctaSmoke.enviar(fakeSock, '120000100@g.us', [
  { texto: 'Site', url: 'https://thekhempire.com' }, { texto: 'Copiar', copiar: 'smoke-only' },
  { texto: 'Ligar', telefone: '+351911111111' },
]), true)
assert.deepEqual(nativeCard.nativeFlowMessage.buttons.map(button => button.name), ['cta_url', 'cta_copy', 'cta_call'])
// The distributed/obfuscated factory must retain header media + body + buttons.
const mediaSmoke = criarMenusBotoesNativos({ permite: () => true, prepararMidia: async content => ({
  [content.video ? 'videoMessage' : 'imageMessage']: { directPath: '/smoke-only', mediaKey: Buffer.alloc(32), gifPlayback: content.gifPlayback === true },
}) })
fakeSock.waUploadToServer = () => { throw new Error('Smoke must not upload') }
assert.equal(await mediaSmoke.enviar(fakeSock, '120000101@g.us', [{ texto: 'Menu', id: '!menu' }], undefined,
  { video: Buffer.from('smoke-only'), gifPlayback: true, texto: 'Decorado ❄️' }), true)
assert.equal(nativeCard.header.hasMediaAttachment, true)
assert.equal(nativeCard.header.videoMessage.gifPlayback, true)
assert.equal(nativeCard.body.text, 'Decorado ❄️')
const { DIVERSOS_CMDS } = await mod('commands/diversos.js')
for (const name of ['site', 'sites', 'sitemiddle']) assert.ok(DIVERSOS_CMDS.includes(name))
const { modoBotoes, comContextoBotoes, comandoBotoes } = await mod('botoesPreferencias.js')
assert.equal(modoBotoes(fakeSock, { device: 'ios' }, {}), 'texto')
assert.equal(modoBotoes(comContextoBotoes(fakeSock, { key: { id: 'A'.repeat(32) } }), {}, {}), 'rapido')
assert.equal(modoBotoes(fakeSock, { device: 'android' }, { botoesDesligados: true }), 'texto')
let deniedPreference = false
await comandoBotoes({ body: '!botoesoff', msg: { key: { remoteJid: '999@s.whatsapp.net' } }, sock: fakeSock,
  cfg: { prefix: '!', numeroDono: '351911111111' }, reply: text => { deniedPreference = text.includes('Só o dono') },
  save: () => { throw new Error('Unauthorized button switch') },
})
assert.equal(deniedPreference, true)
const { criarFilaEnvio } = await mod('sendQueue.js')
const queue = criarFilaEnvio({ gate: async () => {} })
await queue.esperar(); queue.fechar()
await assert.rejects(queue.esperar(), /substituída/)
const { chaveCacheIA } = await mod('aiPrivacy.js')
assert.notEqual(chaveCacheIA('nome', '1'), chaveCacheIA('nome', '2'))
const { executarIAComLimites, passoIA } = await mod('aiBudget.js')
assert.equal(await executarIAComLimites('smoke', () => passoIA(() => 42)), 42)
const { converterUmaVez } = await mod('mediaSafety.js')
assert.equal((await converterUmaVez(Buffer.from('input'), {}, async () => Buffer.from('output'))).toString(), 'output')
const { default: database } = await mod('database.js')
const { addCoins, getCoins } = await mod('rpg.js')
const { transferirMoedas } = await mod('economia.js')
addCoins('smoke-a', 100)
assert.equal(transferirMoedas('smoke-a', 'smoke-b', 25), true)
assert.equal(getCoins('smoke-b'), 25)
const { distribuirBonusVip } = await mod('scheduledState.js')
assert.equal(distribuirBonusVip('smoke-a', 'test@g.us', 'smoke-day'), true)
assert.equal(distribuirBonusVip('smoke-a', 'test@g.us', 'smoke-day'), false)
const { carregarPlugins, pluginDe } = await mod('plugins.js')
await carregarPlugins()
assert.ok(pluginDe('jogosweb'))
const { default: games } = await import(pathToFileURL(resolve(root, 'src/plugins/jogosweb.js')).href)
let sentGames = 0
const { saveConfig } = await mod('config.js')
// Check the real obfuscated package, without source-based discovery or network.
const { parDaChave } = await mod('jidIdentity.js')
const { updateContactsMap, resolvePhone, resolveUserKey, resolveDisplay, checkIsOwner } = await mod('auth.js')
const { resolverComando } = await mod('comandosLista.js')
updateContactsMap([{ id: '880999:2@lid', phoneNumber: '351919000999@s.whatsapp.net' }])
assert.equal(resolvePhone('880999:3@lid'), '351919000999')
assert.equal(resolveUserKey('880997:2@lid'), '880997')
assert.equal(resolveDisplay('880997:2@lid'), 'membro')
assert.equal(checkIsOwner('351919000998@lid', '351919000998'), false)
assert.equal(parDaChave({ fromMe: true, remoteJid: '880998@lid', remoteJidAlt: '351919000998@s.whatsapp.net' }), null)
for (const [name, target] of Object.entries({ addparceiro: 'addparceria', antifake: 'antifalso', palavradodia: 'palavra', perfil: 'perfil', verdademito: 'verdadeomito' })) assert.equal(resolverComando(name), target)
const { filtrarComandosMenu } = await mod('menuLimpo.js')
assert.equal(filtrarComandosMenu('❄️ Polar\n• !menu\n• !naoexistesmoke\n• !customsmoke', '!', ['customsmoke']), '❄️ Polar\n• !menu\n• !customsmoke')
console.log('Smoke OK: JID/LID tipados, permissões sem colisão e menus/aliases reais, sem rede.')
saveConfig({ jogosWebAtivo: true })
await games.executar({ sock: { sendMessage: async (_, content) => {
  sentGames++; assert.ok(Buffer.isBuffer(content.document)); assert.ok(content.document.includes(Buffer.from('<title>Jogos Polar</title>')))
} }, msg: {}, ctx: { from: 'test@g.us' }, reply: () => { throw new Error('Unexpected game URL') } })
assert.equal(sentGames, 1)
// Exercita também o restauro ofuscado completo, apenas nesta BD descartável.
// O módulo fica fechado após restaurar, tal como no bot antes de reiniciar.
const { grupos, backupDatabase, restoreDatabase } = await mod('database.js')
grupos.set('123456789@g.us', { regras: 'antes' })
const snapshot = backupDatabase()
assert.equal(validarBackupSQLite(snapshot), true)
grupos.set('123456789@g.us', { regras: 'depois' })
assert.equal(restoreDatabase(snapshot), true)
const { DIR_BD } = await mod('caminhos.js')
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite')
const restored = new DatabaseSync(join(DIR_BD, 'polar.db'), { readOnly: true })
try { assert.equal(JSON.parse(restored.prepare('SELECT data FROM grupos WHERE id = ?').get('123456789@g.us').data).regras, 'antes') }
finally { restored.close() }
console.log('Smoke OK: fila, privacidade/limites IA, conversão, economia, agenda e plugin HTML no pacote real. Sem sessão WhatsApp ou API externa.')
console.log('Smoke OK: snapshot, restauro atómico e reabertura da BD descartável; dados anteriores recuperados.')
}
