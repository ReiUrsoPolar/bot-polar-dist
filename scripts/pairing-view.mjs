// Private owner view through an SSH tunnel. The panel token stays server-side.
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
const require = createRequire(import.meta.url)
const QRCode = require('qrcode-terminal/vendor/QRCode/index.js')
const level = require('qrcode-terminal/vendor/QRCode/QRErrorCorrectLevel.js')

export const html = `<!doctype html><html lang="pt"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Polar — mensagens</title><style>
*{box-sizing:border-box}body{font:15px system-ui;margin:0;padding:24px;color:#e8edf8;background:#101624}main{max-width:1000px;margin:auto}h1{font-size:27px;margin:0 0 12px}h2{font-size:17px;margin:0;overflow-wrap:anywhere}p{line-height:1.6}button,select{font:inherit;padding:10px 14px;border:1px solid #44516a;border-radius:8px;background:#202b40;color:inherit}button{cursor:pointer}#state{font-weight:650}#connection{padding:20px;border:1px solid #35425b;border-radius:14px;background:#182238}#qr{background:white;max-width:320px;margin:20px auto}#qr:empty{display:none}svg{width:100%;display:block}.toolbar{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin:22px 0}.toolbar select{max-width:100%}small,.meta{color:#a8b5ce}.chat{margin-bottom:18px;border:1px solid #35425b;border-radius:12px;overflow:hidden}.chat h2{background:#202b40;padding:12px 16px}.message{padding:12px 16px;border-top:1px solid #303d55}.sent{border-left:3px solid #52b3a1}.received{border-left:3px solid #648bf2}.meta{font-size:12px;display:flex;gap:10px;flex-wrap:wrap;overflow-wrap:anywhere}.body{white-space:pre-wrap;overflow-wrap:anywhere;margin:7px 0 0}.sender{font-weight:650;color:#e8edf8}#empty{padding:24px;text-align:center;border:1px dashed #44516a;border-radius:12px}#notice{min-height:24px}#feed{max-height:70vh;overflow:auto}@media(max-width:600px){body{padding:14px}.message{padding:12px}.meta{gap:6px}}</style>
<main><h1>Polar · mensagens</h1><section id="connection"><p id="state" role="status">A verificar ligação…</p><p id="pairing" hidden>No WhatsApp, abre <b>Dispositivos associados → Associar dispositivo</b> e lê o QR.</p><div id="qr"></div><small id="connectionNote">Ligação privada à VPS.</small></section>
<div class="toolbar"><label for="chatFilter">Conversa</label><select id="chatFilter"><option value="">Todas as conversas</option></select><button id="refresh" type="button">Atualizar</button><small id="count">0 mensagens</small></div><p id="notice" role="status"></p><p id="empty">As novas mensagens aparecem aqui depois de o bot as receber ou enviar.</p><div id="feed"></div><p><small>Consulta apenas. Comandos e ações desta instância continuam limitados ao grupo «alo». Mostra até 200 mensagens recentes, com texto até 2000 caracteres; imagens, áudio e outros anexos aparecem só pelo tipo. O histórico começa quando o bot arranca e fica em memória até reiniciar. Atualização a cada 2 segundos.</small></p></main><script src="/view.js"></script></html>`

// All message/sender/group text goes through textContent, never HTML parsing.
export const script = `(()=>{
const el=id=>document.getElementById(id), events=new Map();let cursor=0,stream='',busy=false,firstRender=true;
function node(tag,text,cls){const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n}
function render(){
 const messages=[...events.values()].sort((a,b)=>b.seq-a.seq), selected=el('chatFilter').value, groups=new Map(), feed=el('feed');
 const previousTop=Number(feed.scrollTop)||0, previousHeight=Number(feed.scrollHeight)||0;
 for(const m of messages){if(!groups.has(m.chatId))groups.set(m.chatId,{name:m.chatNome||m.chatId,items:[],last:0});const g=groups.get(m.chatId);g.items.push(m);g.last=m.seq;if(m.chatNome)g.name=m.chatNome}
 el('chatFilter').replaceChildren(node('option','Todas as conversas'));el('chatFilter').firstChild.value='';
 for(const [id,g] of groups){const option=node('option',g.name);option.value=id;el('chatFilter').append(option)}
 const defaultChat=firstRender?[...groups].find(([,g])=>g.name.trim().toLowerCase()==='alo')?.[0]:'';
 el('chatFilter').value=groups.has(selected)?selected:(defaultChat||'');if(defaultChat)firstRender=false;const filter=el('chatFilter').value, sections=[];
 for(const [id,g] of [...groups].sort((a,b)=>b[1].last-a[1].last)){
  if(filter&&id!==filter)continue;const section=node('section',undefined,'chat');section.append(node('h2',g.name+(g.items[0].grupo?' · grupo':' · privado')));
  for(const m of g.items){const card=node('article',undefined,'message '+(m.direcao==='enviada'?'sent':'received')),meta=node('div',undefined,'meta');
   const date=new Date(m.em);meta.append(node('span',m.remetente||m.remetenteId||'Desconhecido','sender'),node('span',m.direcao==='enviada'?'Enviada':'Recebida'),node('span',Number.isNaN(date.getTime())?'':date.toLocaleString('pt-PT')),node('span',m.tipo),node('span',m.estado));
   card.append(meta,node('p',m.texto||'['+m.tipo+']','body'));section.append(card)}sections.push(section)
 }
 feed.replaceChildren(...sections);feed.scrollTop=previousTop>20?Math.max(0,previousTop+(Number(feed.scrollHeight)||0)-previousHeight):0;
 el('empty').hidden=sections.length>0;
 const visible=messages.filter(m=>!filter||m.chatId===filter), participants=new Set(visible.filter(m=>m.direcao==='recebida').map(m=>m.remetenteId).filter(Boolean));
 el('count').textContent=visible.length+' mensagens · '+participants.size+' participantes · mais recentes primeiro';
}
async function readMessages(after){const r=await fetch('/messages?after='+after,{cache:'no-store'});if(!r.ok)throw Error();return r.json()}
async function update(){if(busy)return;busy=true;try{
 const r=await fetch('/status',{cache:'no-store'});if(!r.ok)throw Error();const state=await r.json();
 el('state').textContent=state.conexao==='ligado'?'WhatsApp ligado. A acompanhar as mensagens.':state.conexao==='qr'?'Lê o QR abaixo para ligar o WhatsApp.':'Estado: '+state.conexao;
 el('pairing').hidden=state.conexao!=='qr';el('qr').innerHTML=state.conexao==='qr'?(state.svg||''):'';
 el('connectionNote').textContent=state.conexao==='ligado'?'Já está ligado; não precisas de associar outro dispositivo.':'Ligação privada à VPS.';
 let data=await readMessages(cursor), changed=!stream;if(stream&&data.fluxo!==stream){events.clear();cursor=0;changed=true;data=await readMessages(0)}stream=data.fluxo;
 for(const message of data.mensagens){const key=message.chatId+':'+(message.id||'seq-'+message.seq);events.delete(key);events.set(key,message);changed=true}cursor=data.cursor;
 while(events.size>200)events.delete(events.keys().next().value);if(changed)render();el('notice').textContent=data.truncado?'Foram mostradas as 200 mensagens mais recentes.':'';
 }catch{el('notice').textContent='Painel indisponível. A tentar novamente…'}finally{busy=false}}
el('refresh').onclick=update;el('chatFilter').onchange=()=>{firstRender=false;render()};update();setInterval(update,2000);
})();`

function svgQr(text) {
  const qr = new QRCode(-1, level.M); qr.addData(text); qr.make()
  const n = qr.getModuleCount(); let d = ''
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + 4} ${r + 4}h1v1h-1z`
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n + 8} ${n + 8}" role="img" aria-label="QR de emparelhamento" shape-rendering="crispEdges"><path fill="white" d="M0 0h${n + 8}v${n + 8}H0z"/><path fill="black" d="${d}"/></svg>`
}

const text = (value, max) => typeof value === 'string' ? value.slice(0, max) : ''
const integer = value => Number.isSafeInteger(value) && value >= 0 ? value : 0
function publicMessages(data) {
  return {
    fluxo: text(data?.fluxo, 128), cursor: integer(data?.cursor), limite: 200, truncado: data?.truncado === true,
    mensagens: (Array.isArray(data?.mensagens) ? data.mensagens.slice(-200) : []).map(m => ({
      seq: integer(m?.seq), id: text(m?.id, 128), chatId: text(m?.chatId, 120), chatNome: text(m?.chatNome, 160), grupo: m?.grupo === true,
      remetenteId: text(m?.remetenteId, 120), remetente: text(m?.remetente, 160), direcao: m?.direcao === 'enviada' ? 'enviada' : 'recebida',
      tipo: text(m?.tipo, 40), texto: text(m?.texto, 2000), em: Number.isFinite(m?.em) ? m.em : 0, estado: text(m?.estado, 40),
    })),
  }
}

export function criarHandlerVisualizacao({ token, authority = '127.0.0.1:8877', upstream = 'http://127.0.0.1:9317', fetchImpl = fetch }) {
  if (typeof token !== 'string' || token.trim().length < 16) throw new Error('Token de painel em falta')
  return async (req, res) => {
    const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'" }
    const send = (status, content, type = 'text/plain') => { res.writeHead(status, { ...headers, 'Content-Type': type + '; charset=utf-8' }); res.end(content) }
    if (req.headers.host !== authority || req.headers.origin && req.headers.origin !== `http://${authority}` || req.headers['sec-fetch-site'] && !['same-origin', 'none'].includes(req.headers['sec-fetch-site'])) return send(403, 'Acesso local apenas')
    if (req.method !== 'GET') return send(405, 'GET apenas')
    let url
    try { url = new URL(req.url, `http://${authority}`) } catch { return send(400, 'Pedido inválido') }
    if (url.pathname === '/') return send(200, html, 'text/html')
    if (url.pathname === '/view.js') return send(200, script, 'text/javascript')
    if (!['/status', '/messages'].includes(url.pathname)) return send(404, 'Não encontrado')
    const after = integer(Number(url.searchParams.get('after') || 0))
    try {
      const response = await fetchImpl(`${upstream}${url.pathname === '/status' ? '/estado' : '/mensagens?depois=' + after}`, { headers: { 'x-polar-token': token.trim() }, signal: AbortSignal.timeout(4000) })
      if (!response.ok) throw new Error('Painel não disponível')
      const state = await response.json()
      if (url.pathname === '/messages') return send(200, JSON.stringify(publicMessages(state)), 'application/json')
      const conexao = ['iniciando', 'qr', 'conectando', 'ligado', 'desligado'].includes(state.conexao) ? state.conexao : 'iniciando'
      return send(200, JSON.stringify({ conexao, svg: conexao === 'qr' && typeof state.qr === 'string' && state.qr.length <= 4096 ? svgQr(state.qr) : null }), 'application/json')
    } catch { return send(503, 'Painel não disponível') }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const flag = name => process.argv[process.argv.indexOf(name) + 1]
  const tokenFile = process.argv.includes('--token-file') ? flag('--token-file') : null
  const token = tokenFile ? readFileSync(tokenFile, 'utf8').split(/\r?\n/).find(line => line.startsWith('POLAR_PAINEL_TOKEN='))?.slice(19) : process.env.POLAR_PAINEL_TOKEN
  const server = createServer(criarHandlerVisualizacao({ token }))
  server.listen(8877, '127.0.0.1', () => console.log('Painel privado: http://127.0.0.1:8877/'))
}
