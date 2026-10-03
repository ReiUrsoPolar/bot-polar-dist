#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════════════
// SCANNER ANTI-SEGREDOS — protege a VENDA DO ARQUIVO
// ══════════════════════════════════════════════════════════════════════
// O arquivo vendido é gerado por `git archive HEAD`, por isso QUALQUER
// segredo que entre num commit vai dentro do bot do cliente. Este scanner
// varre o código e os configs versionados; se encontrar um segredo, sai
// com código 1 e o CI cancela a publicação do dist.
//
// Uso: node scripts/scan-secrets.mjs   (corre na raiz do repo)
import { readFileSync, readdirSync, statSync } from 'fs'
import { join, extname, relative } from 'path'

const ROOT = process.cwd()

// Pastas/ficheiros que NUNCA devem ser varridos (não vão para o arquivo,
// ou são falsos positivos conhecidos como este próprio scanner).
const SKIP_DIRS  = new Set(['node_modules', '.git', '.tmp', 'session', 'database', 'auth_info_baileys', 'dist'])
const SKIP_FILES = new Set(['scan-secrets.mjs', 'package-lock.json'])
const EXT_OK     = new Set(['.js', '.mjs', '.cjs', '.json', '.ts', '.env', '.sh'])

// Padrões de segredos reais. Cada um tem um nome para a mensagem de erro.
const PADROES = [
  { nome: 'GitHub PAT (ghp_)',        re: /\bghp_[A-Za-z0-9]{30,}\b/ },
  { nome: 'GitHub fine-grained (github_pat_)', re: /\bgithub_pat_[A-Za-z0-9_]{50,}\b/ },
  { nome: 'Mercado Pago access token', re: /\bAPP_USR-\d{6,}-\d{6}-[a-f0-9]{32}-\d{6,}\b/ },
  { nome: 'Mercado Pago (prod/test)',  re: /\b(?:APP_USR|TEST)-[A-Za-z0-9-]{40,}\b/ },
  { nome: 'Groq API key',             re: /\bgsk_[A-Za-z0-9]{40,}\b/ },
  { nome: 'OpenAI/Anthropic key',     re: /\bsk-(?:ant-)?[A-Za-z0-9-]{30,}\b/ },
  { nome: 'Google API key',           re: /\bAIza[0-9A-Za-z_-]{30,}\b/ },
  { nome: 'Chave privada PEM',        re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  // Creator token do Polar: 64 hex atribuídos a uma variável com "creator"/"token"
  { nome: 'Creator token Polar',      re: /creator[_a-z]*token['"\s:=]+['"][a-f0-9]{48,}['"]/i },
]

// Linhas que são claramente placeholders/instruções → ignorar.
const FALSO_POSITIVO = /(exemplo|example|placeholder|<seu|teu token|cole aqui|paste here|xxxx|\.\.\.|via-worker)/i

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue
    const full = join(dir, name)
    let st; try { st = statSync(full) } catch { continue }
    if (st.isDirectory()) { yield* walk(full); continue }
    if (SKIP_FILES.has(name)) continue
    if (!EXT_OK.has(extname(name)) && name !== '.env') continue
    yield full
  }
}

const achados = []
for (const file of walk(ROOT)) {
  let conteudo
  try { conteudo = readFileSync(file, 'utf8') } catch { continue }
  const linhas = conteudo.split('\n')
  for (let i = 0; i < linhas.length; i++) {
    const linha = linhas[i]
    if (FALSO_POSITIVO.test(linha)) continue
    for (const { nome, re } of PADROES) {
      if (re.test(linha)) {
        achados.push({ file: relative(ROOT, file), linha: i + 1, nome })
      }
    }
  }
}

if (achados.length) {
  console.error('\n❌ SEGREDO(S) DETETADO(S) — o build foi CANCELADO para não vazar no arquivo de venda:\n')
  for (const a of achados) {
    console.error(`  • ${a.nome}`)
    console.error(`    ${a.file}:${a.linha}  →  [conteúdo ocultado]`)
  }
  console.error('\nRemove o segredo do código (usa secrets/config gitignored) e tenta de novo.\n')
  process.exit(1)
}

console.log('✅ Scanner anti-segredos: nada encontrado no código versionado.')
