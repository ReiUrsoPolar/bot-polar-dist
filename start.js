#!/usr/bin/env node
// start.js — arrancar o bot em qualquer sistema.
//
// PORQUÊ ESTE FICHEIRO
//
// O `npm start` chamava `bash start.sh`. No Windows não há bash: quem comprava
// o bot descarregava o zip, escrevia `npm start` e não acontecia nada. Ficava
// com um produto pago que não arranca e sem forma de perceber porquê.
//
// Isto faz o mesmo que o start.sh — actualizar, instalar dependências, aplicar
// o patch do Baileys e manter o bot de pé — mas só com o Node, que já é preciso
// de qualquer maneira. O start.sh fica para quem já o usa (painéis, systemd).
//
//   node start.js        ← Windows, Linux, macOS, Termux
//
// Nunca toca no config, na sessão do WhatsApp nem na base de dados.

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, cpSync, readdirSync, statSync, mkdtempSync, renameSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'

const DIST_REPO   = 'ReiUrsoPolar/bot-polar-dist'
const DIST_BRANCH = 'main'

const C = {
  ciano: '\x1b[1;36m', verde: '\x1b[1;32m', amarelo: '\x1b[1;33m',
  vermelho: '\x1b[1;31m', cinza: '\x1b[0;90m', fim: '\x1b[0m',
}
const log  = (cor, txt) => console.log(`${cor}${txt}${C.fim}`)

const EH_TERMUX = !!process.env.TERMUX_VERSION || existsSync('/data/data/com.termux')

// O que é do cliente e NUNCA é substituído por uma actualização. Um update que
// apague isto custa-lhe a sessão do WhatsApp e a configuração toda.
const INTOCAVEIS = new Set([
  'node_modules', 'database', 'session', 'auth_info_baileys', '.tmp', '.git',
])
const CONFIG_INTOCAVEL = new Set([
  'bot.json', 'ia.json', 'apis.json', 'grupos.json',
  'licenca-bind.json', 'licenca-inst.json', 'loja.json', 'menus', 'msgs',
])

function temComando(cmd) {
  const r = spawnSync(cmd, ['--version'], { encoding: 'utf8' })
  // Só o ENOENT diz "não existe". Ir pelo código de saída dava falsos negativos
  // — o ffmpeg, por exemplo, não conhece o --version e sai com erro na mesma.
  return !r.error
}
// O npm e o npx são ficheiros .cmd no Windows, e o Node só os corre através da
// shell. Passar a linha inteira (em vez de comando + lista de argumentos) evita
// o aviso DEP0190 do Node, que aparecia no ecrã do cliente a cada arranque.
function correrShell(linha, opts = {}) {
  return spawnSync(linha, { stdio: 'inherit', shell: true, ...opts })
}

function banner() {
  log(C.ciano, `
  ██████╗  ██████╗ ██╗      █████╗ ██████╗
  ██╔══██╗██╔═══██╗██║     ██╔══██╗██╔══██╗
  ██████╔╝██║   ██║██║     ███████║██████╔╝
  ██╔═══╝ ██║   ██║██║     ██╔══██║██╔══██╗
  ██║     ╚██████╔╝███████╗██║  ██║██║  ██║
  ╚═╝      ╚═════╝ ╚══════╝╚═╝  ╚═╝╚═╝  ╚═╝`)
  console.log(`${C.cinza}  ${process.platform} · Node ${process.version}${EH_TERMUX ? ' · Termux' : ''}${C.fim}\n`)
}

// ── Actualizar ────────────────────────────────────────────────────────
// Com git é limpo e rápido. Sem git (o caso normal de quem só descompactou o
// zip) descarrega-se o tar.gz e copia-se por cima, saltando o que é do cliente.
export function atualizarGitSeguro({ cwd = process.cwd(), repo = DIST_REPO, branch = DIST_BRANCH, executar = spawnSync } = {}) {
  if (!/^[\w-]+\/[\w.-]+$/.test(repo) || !/^[\w][\w./-]*$/.test(branch) || branch.includes('..')) {
    return { estado: 'bloqueado', motivo: 'Repositório ou branch inválido.' }
  }
  const git = args => executar('git', args, { cwd, encoding: 'utf8', timeout: 60000, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } })
  const ok = r => !r.error && r.status === 0
  const valor = r => String(r.stdout || '').trim()
  const head = git(['rev-parse', '--verify', 'HEAD'])
  if (!ok(head)) return { estado: 'indisponivel' }
  const remoto = git(['remote', 'get-url', 'origin'])
  const permitidos = [`https://github.com/${repo}.git`, `https://github.com/${repo}`, `git@github.com:${repo}.git`]
  if (!ok(remoto) || !permitidos.includes(valor(remoto))) {
    return { estado: 'bloqueado', motivo: 'Este clone não aponta para a distribuição esperada. O repositório foi preservado.' }
  }
  const status = git(['status', '--porcelain', '--untracked-files=all'])
  if (!ok(status) || valor(status)) return { estado: 'bloqueado', motivo: 'Existem alterações locais ou não foi possível verificá-las. Guarda-as antes de atualizar.' }
  const fetch = git(['fetch', '--quiet', 'origin', branch])
  if (!ok(fetch)) return { estado: 'sem_rede', motivo: 'Não foi possível obter a atualização; a versão atual foi mantida.' }
  const alvo = git(['rev-parse', '--verify', 'FETCH_HEAD^{commit}'])
  const antes = valor(head), depois = valor(alvo)
  if (!ok(alvo) || !/^[a-f0-9]{40,64}$/.test(depois)) return { estado: 'bloqueado', motivo: 'A versão recebida não é válida.' }
  if (antes === depois) return { estado: 'atualizado', antes, depois }
  if (!ok(git(['merge-base', '--is-ancestor', antes, depois]))) return { estado: 'bloqueado', motivo: 'O histórico divergiu. É necessária uma atualização assistida, sem apagar alterações.' }
  // Sem reset --hard: o Git também verifica alterações surgidas depois do status.
  const merge = git(['merge', '--ff-only', '--no-edit', depois])
  if (!ok(merge)) {
    const erro = new Error('O Git não concluiu a atualização. Arranque interrompido; verifica o estado da instalação antes de reiniciar.')
    erro.updateRecoveryRequired = true
    throw erro
  }
  return { estado: 'instalado', antes, depois }
}

function autoAtualizar() {
  log(C.amarelo, '  ↻  A verificar atualizações...')
  if (existsSync('.git') && temComando('git')) {
    const r = atualizarGitSeguro()
    if (r.estado === 'instalado') { log(C.verde, `  ✓  Atualizado! (${r.antes.slice(0, 7)} → ${r.depois.slice(0, 7)})`); return true }
    if (r.estado === 'atualizado') log(C.verde, '  ✓  Já estás na versão mais recente.')
    else log(C.amarelo, `  ⚠  ${r.motivo || 'Git indisponível; atualização não aplicada.'}`)
    return false
  }
  return atualizarPorDownload()
}

function atualizarPorDownload() {
  // O tar existe no Windows 10+, no Linux e no Termux. O unzip não — por isso
  // usa-se o tar.gz e não o zip.
  if (!temComando('tar')) {
    log(C.amarelo, '  ⚠  Sem git nem tar — não dá para atualizar sozinho.')
    log(C.cinza,   '     O bot arranca na mesma. Para atualizar, descarrega o zip novo do site.')
    return false
  }
  const base = join(tmpdir(), `polar-upd-${process.pid}`)
  const tgz  = join(base, 'pacote.tar.gz')
  try {
    mkdirSync(base, { recursive: true })
    log(C.amarelo, '  ↓  A descarregar a versão mais recente...')
    const r = spawnSync('curl', ['-sL', '--max-time', '90', '-o', tgz,
      `https://codeload.github.com/${DIST_REPO}/tar.gz/refs/heads/${DIST_BRANCH}`])
    if (r.status !== 0 || !existsSync(tgz)) throw new Error('descarga falhou')

    // Nome RELATIVO e cwd, nunca "C:\...": no Windows com o Git instalado o
    // `tar` que está no PATH é o do MSYS, que lê "C:\pasta" como um servidor
    // remoto ("Cannot connect to C:") e falha sempre. Sem caminho absoluto,
    // funciona tanto com esse como com o tar da Microsoft.
    const t = spawnSync('tar', ['-xzf', 'pacote.tar.gz'], { cwd: base, encoding: 'utf8' })
    if (t.status !== 0) {
      throw new Error(String(t.stderr ?? '').split('\n')[0] || 'não consegui abrir o ficheiro')
    }
    // O tar.gz do GitHub traz tudo dentro de uma pasta "<repo>-<branch>".
    const dentro = readdirSync(base).map(n => join(base, n)).filter(p => statSync(p).isDirectory())[0]
    if (!dentro) throw new Error('arquivo vazio')

    const _falhados = copiarPorCima(dentro, process.cwd())
    if (_falhados?.length) {
      // O bot está actualizado e coerente; o que falhou são extras (patches,
      // README…). Dizer quais, em vez de fingir que correu tudo bem.
      log(C.amarelo, `  ⚠  Actualizado, mas ${_falhados.length} item(ns) não foram substituídos:`)
      for (const x of _falhados.slice(0, 5)) log(C.cinza, `     · ${x}`)
    } else {
      log(C.verde, '  ✓  Atualizado!')
    }
    return true
  } catch (e) {
    if (e.updateRecoveryRequired) throw e
    log(C.vermelho, `  ✗  Não consegui atualizar (${e.message}). O bot arranca na versão actual.`)
    return false
  } finally {
    try { rmSync(base, { recursive: true, force: true }) } catch {}   // leva o tgz dentro
  }
}

/** Copia a versão nova por cima, deixando intacto tudo o que é do cliente. */
// O CÓDIGO DO BOT É COPIADO PRIMEIRO, E UMA FALHA NUM EXTRA NÃO PÁRA TUDO.
//
// Isto percorria a pasta por ordem alfabética e rebentava à primeira falha:
//
//   config → index.js → package.json → patches → src → start.js
//
// Num painel onde a pasta `patches` estava só de leitura, o cpSync dava EPERM
// exactamente a meio: o index.js JÁ era o novo e o src/ ainda era o antigo. O
// bot ficava com um index.js a importar módulos que não existiam e não
// arrancava de todo — muito pior do que não ter actualizado.
//
// Visto em produção:
//   ✗ Não consegui atualizar (EPERM ... '/home/server/patches')
//   ERROR [ERR_MODULE_NOT_FOUND]: Cannot find module '/home/server/src/plugins.js'
//
// Agora o `src` e o `index.js` vão à frente e sempre juntos. Assim, mesmo que
// tudo o resto falhe, o bot fica coerente — e a actualização seguinte apanha
// o que faltou. É o que faz isto recuperar sozinho.
// O start.js está aqui de propósito. Sem ele, uma correcção NESTE ficheiro
// nunca chegava a quem já ficou preso: o start.js antigo copia por ordem
// alfabética, rebenta no 'patches' e nunca chega ao 's' de start.js — logo
// repete o mesmo erro em todos os arranques, para sempre.
const PRIMEIRO = ['src', 'index.js', 'start.js', 'package.json']

// Prepara tudo antes de substituir. O backup fica no mesmo disco para usar
// rename, sem apagar os originais antes de a cópia terminar. Não é proteção
// contra corte de energia; cobre falhas de cópia e substituição reportadas pelo SO.
export function substituirConjunto(origem, destino, nomes, copiar, mover = renameSync) {
  destino = resolve(destino)
  const area = mkdtempSync(join(destino, '.polar-update-'))
  const novos = join(area, 'new'), antigos = join(area, 'old')
  mkdirSync(novos)
  mkdirSync(antigos)
  const alterados = []
  let conservar = false
  try {
    for (const nome of nomes) copiar(join(origem, nome), join(novos, nome))
    for (const nome of nomes) {
      const para = join(destino, nome), backup = join(antigos, nome)
      const estado = { nome, guardado: false, instalado: false }
      alterados.push(estado)
      if (existsSync(para)) { mover(para, backup); estado.guardado = true }
      mover(join(novos, nome), para)
      estado.instalado = true
    }
  } catch (erro) {
    const falhas = []
    for (const estado of alterados.reverse()) {
      try {
        const para = join(destino, estado.nome)
        if (estado.instalado) mover(para, join(novos, estado.nome))
        if (estado.guardado) mover(join(antigos, estado.nome), para)
      } catch { falhas.push(estado.nome) }
    }
    if (falhas.length) {
      conservar = true
      const falha = new Error(`Reposição incompleta (${falhas.join(', ')}). Arranque interrompido. Cópia de recuperação: ${area}`)
      falha.updateRecoveryRequired = true
      throw falha
    }
    throw erro
  } finally {
    if (!conservar) { try { rmSync(area, { recursive: true, force: true }) } catch {} }
  }
}

// O  entra por parâmetro para os testes poderem forçar uma falha numa
// entrada específica — sem isso, a garantia mais importante deste ficheiro (que
// uma falha não deixa o bot misturado) não era testável.
export function copiarPorCima(origem, destino, copiar = null) {
  const _cp = copiar ?? ((de, para) => cpSync(de, para, { recursive: true, force: true }))
  const entradas = readdirSync(origem).filter(n => !INTOCAVEIS.has(n))
  // os críticos primeiro, pela ordem em que estão em PRIMEIRO
  entradas.sort((a, b) => {
    const ia = PRIMEIRO.indexOf(a), ib = PRIMEIRO.indexOf(b)
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib)
  })

  const falhados = []
  // src/index/start/package são preparados e substituídos como um conjunto.
  substituirConjunto(origem, destino, entradas.filter(n => PRIMEIRO.includes(n)), _cp)
  for (const nome of entradas) {
    if (PRIMEIRO.includes(nome)) continue
    const de = join(origem, nome), para = join(destino, nome)
    try {
      if (nome === 'config') {
        // A pasta config tem ficheiros nossos (defaults) e ficheiros DELE.
        mkdirSync(para, { recursive: true })
        for (const cf of readdirSync(de)) {
          if (CONFIG_INTOCAVEL.has(cf)) continue
          try { _cp(join(de, cf), join(para, cf)) }
          catch (e) { falhados.push(`config/${cf}: ${e.code ?? e.message}`) }
        }
        continue
      }
      // force+recursive resolve também o caso de o destino ter o tipo trocado
      // (pasta onde devia estar ficheiro), que rebentava a cópia.
      substituirConjunto(origem, destino, [nome], _cp)
    } catch (e) {
      // Uma entrada problemática não pode impedir o resto — sobretudo agora
      // que os críticos já foram copiados.
      falhados.push(`${nome}: ${e.code ?? e.message}`)
      if (e.updateRecoveryRequired) throw e
      if (PRIMEIRO.includes(nome)) throw e   // estes são o bot: sem eles não vale a pena seguir
    }
  }
  return falhados
}

// ── Dependências ──────────────────────────────────────────────────────
// Só o hash das DEPENDÊNCIAS, não do package.json inteiro: uma actualização
// que mude apenas scripts ou versão não obriga a reinstalar tudo.
function hashDeps() {
  try {
    const p = JSON.parse(readFileSync('package.json', 'utf8'))
    return createHash('md5').update(JSON.stringify([p.dependencies ?? {}, p.optionalDependencies ?? {}])).digest('hex')
  } catch { return '' }
}
function sqliteFunciona() {
  const r = spawnSync(process.execPath,
    ['-e', "new (require('./node_modules/better-sqlite3'))(':memory:').close()"], { encoding: 'utf8' })
  return r.status === 0
}
export function sqliteDisponivel(executar = spawnSync) {
  const r = executar(process.execPath, ['--input-type=module', '-e',
    "let DB; try { DB = (await import('better-sqlite3')).default; new DB(':memory:').close(); } catch { DB = (await import('./src/sqliteCompat.js')).default; const db = new DB(':memory:'); db.prepare('SELECT 1').get(); db.close(); }"],
  { encoding: 'utf8', timeout: 15000 })
  return !r.error && r.status === 0
}
export function instalarDeps({ instalar = correrShell, preparar = binarioSqlite, verificar = sqliteDisponivel } = {}) {
  log(C.amarelo, '  ↓  A instalar/atualizar dependências...')
  // --ignore-scripts: dentro de painéis com sandbox, compilar módulos nativos
  // rebenta ("Bad system call"). O binário do sqlite vem pronto logo a seguir.
  const resultado = instalar('npm install --omit=dev --ignore-scripts --no-fund --no-audit --prefer-offline')
  if (resultado.error || resultado.status !== 0) {
    throw new Error('A instalação das dependências falhou. Verifica a ligação e o erro do npm acima; o bot não foi iniciado.')
  }
  if (!verificar()) preparar()
  if (!verificar()) throw new Error('SQLite indisponível. Usa Node 22.13+ ou 24, ou instala o binário better-sqlite3 compatível com o host.')
  log(C.verde, '  ✓  Dependências prontas!\n')
}
function binarioSqlite() {
  if (!existsSync(join('node_modules', 'better-sqlite3'))) return true
  if (sqliteFunciona()) return true
  log(C.amarelo, `  ↓  A obter o binário do better-sqlite3 para o Node ${process.version}...`)
  correrShell('npx --yes prebuild-install@7 -r node --tag-prefix v',
    { cwd: join('node_modules', 'better-sqlite3'), stdio: 'ignore' })
  if (sqliteFunciona()) { log(C.verde, '  ✓  Binário pronto — sem recompilação.'); return true }
  return false
}
function verificarDeps() {
  const marca = join('node_modules', '.pkg_hash')
  if (!existsSync('node_modules')) {
    log(C.amarelo, '  ↗  Primeira instalação — isto pode demorar alguns minutos.\n')
    instalarDeps()
    try { writeFileSync(marca, hashDeps()) } catch {}
    return
  }
  const agora = hashDeps()
  let antes = ''
  try { antes = readFileSync(marca, 'utf8').trim() } catch {}
  if (agora && agora !== antes) {
    log(C.amarelo, '  ↗  Dependências alteradas — a sincronizar...')
    instalarDeps()
    try { writeFileSync(marca, agora) } catch {}
    return
  }
  if (!sqliteDisponivel() && !(binarioSqlite() && sqliteDisponivel())) {
    // Num painel, quem recompila fora do sandbox é o painel: sai com 7, que é
    // o código que ele conhece.
    log(C.amarelo, '  ↗  O better-sqlite3 precisa de recompilação — a deixar o painel tratar disso...')
    process.exit(7)
  }
  log(C.verde, `  ✓  Dependências OK (Node ${process.version})\n`)
}

/** Espera sem gastar CPU e sem depender de nada instalado. */
function dormir(ms) {
  spawnSync(process.execPath, ['-e', `setTimeout(()=>{},${Math.max(0, ms | 0)})`])
}

/**
 * No Termux faltam programas do sistema que o bot usa. O ffmpeg é o caso que
 * dá erro estranho: o pacote npm traz um binário x86 que simplesmente não corre
 * em Android, e sem o do sistema os comandos de áudio e vídeo falham sem
 * explicação nenhuma.
 */
function prepararTermux() {
  if (!EH_TERMUX) return
  const falta = ['ffmpeg', 'git'].filter(c => !temComando(c))
  if (!falta.length) return
  log(C.amarelo, `  ↓  A instalar ${falta.join(' e ')} (só na primeira vez)...`)
  correrShell('pkg update -y', { stdio: 'ignore' })
  correrShell(`pkg install -y ${falta.join(' ')}`)
}

function aplicarPatches() {
  const p = join('patches', 'baileys.cjs')
  if (existsSync(p)) spawnSync(process.execPath, [p], { stdio: 'ignore' })
}

/**
 * O Node desta hospedagem chega para correr o bot?
 *
 * Isto é a causa do "o bot funciona numa host e na outra não". Com Node antigo
 * a validação da licença rebenta (usa Ed25519 por JWK e Buffer 'base64url', que
 * só existem em Node moderno) e o bot dizia "chave corrompida" — o cliente lia
 * aquilo, achava que a chave estava má e vinha reclamar da licença, quando o
 * problema era a hospedagem. O Baileys 7 também exige Node 20+.
 *
 * Melhor dizê-lo aqui, em três linhas claras, do que deixá-lo descobrir pelo
 * caminho errado.
 */
function verificarNode() {
  const maior = parseInt(process.versions.node.split('.')[0], 10)
  if (maior >= 20) return
  console.log('')
  log(C.vermelho, '  ╭────────────────────────────────────────────────────────╮')
  log(C.vermelho, '  │   ✖  HOSPEDAGEM INCOMPATÍVEL — Node demasiado antigo   │')
  log(C.vermelho, '  ╰────────────────────────────────────────────────────────╯')
  console.log('')
  log(C.amarelo, `     Esta hospedagem tem Node ${process.version} — o bot precisa de Node 20+.`)
  log(C.verde,   '     A TUA LICENÇA ESTÁ BOA. O problema é a hospedagem.')
  console.log('')
  log(C.cinza,   '     Como resolver:')
  log(C.cinza,   '       1. Pede à tua host para pôr Node 20 (ou mais recente)')
  log(C.cinza,   '       2. Ou, se tiveres acesso:  nvm install 20 && nvm use 20')
  log(C.cinza,   '       3. Ou muda para uma hospedagem com Node atual')
  console.log('')
  process.exit(1)
}

// ── Arranque ──────────────────────────────────────────────────────────
function principal() {
  banner()
  verificarNode()   // antes de tudo: sem Node 20+ nada disto funciona
  if (!existsSync('index.js')) {
    log(C.vermelho, '  ✗  Não encontro o index.js.')
    log(C.cinza,    '     Corre este comando DENTRO da pasta do bot (a que tem o index.js).')
    process.exit(1)
  }
  prepararTermux()      // antes de tudo: sem ffmpeg e git, o resto tropeça
  autoAtualizar()
  verificarDeps()
  aplicarPatches()

  let seguidas = 0
  for (;;) {
    const inicio = Date.now()
    const r = spawnSync(process.execPath, ['index.js'], { stdio: 'inherit' })
    // Ctrl+C é uma ordem de quem está a ver: não se reinicia por cima dela.
    if (r.signal === 'SIGINT' || r.signal === 'SIGTERM') { console.log('\n  Até já.'); process.exit(0) }

    // Um bot que morre nos primeiros segundos não vai melhorar se lhe voltarmos
    // a pegar 2 segundos depois: é licença, config ou rede. Sem esta travagem,
    // o start.sh ficava a reinstalar e a descarregar do GitHub de 2 em 2
    // segundos, para sempre, com a mensagem do erro a passar rápido demais
    // para se ler.
    const durou = Date.now() - inicio
    seguidas = durou < 15_000 ? seguidas + 1 : 0
    const espera = seguidas ? Math.min(60, 2 ** seguidas) : 2

    log(C.amarelo, `\n  ⚠  Bot encerrado (código ${r.status ?? r.signal}).`)
    if (seguidas >= 3) {
      log(C.vermelho, `  ✗  Já falhou ${seguidas} vezes logo no arranque.`)
      log(C.cinza,    '     Lê a mensagem aqui em cima — costuma ser a licença ou o número do dono.')
    }
    log(C.amarelo, `  ↻  A tentar de novo daqui a ${espera}s...\n`)

    autoAtualizar()
    verificarDeps()
    aplicarPatches()
    dormir(espera * 1000)
  }
}

// Só arranca quando é ESTE o ficheiro corrido. Assim os testes podem importar a
// cópia — a parte que mexe nos ficheiros do cliente — sem levantar um bot.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes('--check')) {
    const { reportInstall } = await import('./scripts/check-install.mjs')
    process.exitCode = reportInstall()
  } else {
    try { principal() }
    catch (e) { log(C.vermelho, `  ✗  ${e.message}`); process.exitCode = 1 }
  }
}
