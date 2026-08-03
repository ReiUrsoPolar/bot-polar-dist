#!/bin/bash

CYAN='\033[1;36m'
GREEN='\033[1;32m'
YELLOW='\033[1;33m'
RED='\033[1;31m'
NC='\033[0m'

echo -e "${CYAN}"
echo "  ██████╗  ██████╗ ██╗      █████╗ ██████╗ "
echo "  ██╔══██╗██╔═══██╗██║     ██╔══██╗██╔══██╗"
echo "  ██████╔╝██║   ██║██║     ███████║██████╔╝ "
echo "  ██╔═══╝ ██║   ██║██║     ██╔══██║██╔══██╗ "
echo "  ██║     ╚██████╔╝███████╗██║  ██║██║  ██║ "
echo "  ╚═╝      ╚═════╝ ╚══════╝╚═╝  ╚═╝╚═╝  ╚═╝"
echo -e "${NC}"

# Repositório público de distribuição
DIST_REPO="ReiUrsoPolar/bot-polar-dist"
DIST_BRANCH="main"

# ── Auto-atualizar ────────────────────────────────────────────────────
auto_atualizar() {
  echo -e "${YELLOW}  ↻  A verificar atualizações...${NC}"

  REPO_URL="https://github.com/${DIST_REPO}.git"

  if git rev-parse --git-dir > /dev/null 2>&1; then
    # Garantir que o remote aponta sempre para o repo PÚBLICO
    REMOTE_ATUAL=$(git remote get-url origin 2>/dev/null || echo "")
    if [ "$REMOTE_ATUAL" != "$REPO_URL" ]; then
      git remote set-url origin "$REPO_URL" 2>/dev/null || true
      echo -e "${YELLOW}  ↻  Remote corrigido para repo público.${NC}"
    fi

    # Modo git: fetch + reset --hard (funciona mesmo com histórico força-empurrado)
    # Não usar git pull — bot-polar-dist tem histórico diferente do bot-polar (force push)
    ANTES=$(git rev-parse HEAD 2>/dev/null)
    git fetch --quiet origin "$DIST_BRANCH" 2>/dev/null
    DEPOIS=$(git rev-parse "origin/${DIST_BRANCH}" 2>/dev/null)

    if [ -z "$DEPOIS" ]; then
      echo -e "${RED}  ✗  Não foi possível contactar o GitHub (sem rede?).${NC}"
      return 1
    fi

    if [ "$ANTES" != "$DEPOIS" ]; then
      git reset --hard "origin/${DIST_BRANCH}" 2>/dev/null || true
      echo -e "${GREEN}  ✓  Atualizado! (${ANTES:0:7} → ${DEPOIS:0:7})${NC}"
      echo -e "${CYAN}  📋 O que foi atualizado:${NC}"
      git log --oneline -10 2>/dev/null | while IFS= read -r linha; do
        echo -e "     ${CYAN}•${NC} ${linha}"
      done
      return 0   # houve atualização
    else
      echo -e "${GREEN}  ✓  Já na versão mais recente. (${DEPOIS:0:7})${NC}"
      return 1   # sem alterações
    fi
  else
    # Modo download: baixar zip do repo público
    echo -e "${YELLOW}  ↓  Git não configurado — a baixar do GitHub...${NC}"
    TMP_ZIP="/tmp/polar-upd-$$.zip"
    TMP_DIR="/tmp/polar-upd-$$"
    ZIP_URL="https://github.com/${DIST_REPO}/archive/refs/heads/${DIST_BRANCH}.zip"

    if curl -sL --max-time 60 -o "$TMP_ZIP" "$ZIP_URL" 2>/dev/null; then
      mkdir -p "$TMP_DIR"
      if unzip -q -o "$TMP_ZIP" -d "$TMP_DIR" 2>/dev/null; then
        # A PRIMEIRA entrada podia ser um ficheiro — o .gitattributes vem antes
        # por ordem alfabética — e a cópia ia buscar a pasta errada, dando
        # "ENOTDIR: not a directory". Escolhe-se a primeira que É mesmo pasta.
        EXTRACTED=""
        for _e in "$TMP_DIR"/*; do
          [ -d "$_e" ] && { EXTRACTED=$(basename "$_e"); break; }
        done
        if [ -n "$EXTRACTED" ]; then
          if command -v rsync >/dev/null 2>&1; then
            # -a inclui preservar dono/grupo/permissões (-o -g -p). Num painel o
            # processo não pode fazer isso e o rsync rebenta com:
            #   rename "patches/.baileys.cjs.XXXX" -> "patches/baileys.cjs":
            #   Operation not permitted (1)
            # …e sai com o código 23, dando a actualização como falhada mesmo
            # tendo copiado tudo. Copia-se o conteúdo, não os atributos.
            rsync -rlt --omit-dir-times --no-perms --no-owner --no-group \
              --exclude='config/bot.json' \
              --exclude='config/ia.json' \
              --exclude='config/apis.json' \
              --exclude='config/grupos.json' \
              --exclude='config/licenca-bind.json' \
              --exclude='config/licenca-inst.json' \
              --exclude='session/' \
              --exclude='auth_info_baileys/' \
              --exclude='database/' \
              --exclude='node_modules/' \
              "$TMP_DIR/$EXTRACTED/" ./
          else
            # Painéis mínimos não trazem rsync — sem isto a atualização por
            # download falhava em silêncio e o bot ficava para trás para sempre.
            # O rm -rf antes do cp também resolve o destino com o TIPO trocado
            # (pasta onde devia estar ficheiro), que rebentava a cópia com ENOTDIR.
            for item in "$TMP_DIR/$EXTRACTED"/* "$TMP_DIR/$EXTRACTED"/.[!.]*; do
              [ -e "$item" ] || continue
              nome=$(basename "$item")
              case "$nome" in
                session|auth_info_baileys|database|node_modules|.tmp) continue ;;
                config)
                  mkdir -p ./config
                  for cf in "$item"/*; do
                    [ -e "$cf" ] || continue
                    cnome=$(basename "$cf")
                    case "$cnome" in
                      bot.json|ia.json|apis.json|grupos.json|licenca-bind.json|licenca-inst.json|loja.json|menus|msgs) continue ;;
                    esac
                    rm -rf "./config/$cnome" && cp -r "$cf" "./config/$cnome"
                  done
                  continue ;;
              esac
              rm -rf "./$nome" && cp -r "$item" "./$nome"
            done
          fi
          # Forçar timestamp de package.json para agora para que verificar_deps detete a mudança
          touch package.json 2>/dev/null || true
          echo -e "${GREEN}  ✓  Atualizado via download!${NC}"
          # Mostrar último commit via API (melhor esforço)
          COMMIT_INFO=$(curl -s --max-time 10 \
            "https://api.github.com/repos/${DIST_REPO}/commits/${DIST_BRANCH}" \
            2>/dev/null | python3 -c \
            "import sys,json; d=json.load(sys.stdin); print(d['commit']['message'].split('\n')[0])" \
            2>/dev/null)
          [ -n "$COMMIT_INFO" ] && echo -e "     ${CYAN}•${NC} ${COMMIT_INFO}"
          rm -rf "$TMP_ZIP" "$TMP_DIR"
          return 0
        fi
      fi
      rm -rf "$TMP_ZIP" "$TMP_DIR"
    fi

    echo -e "${RED}  ✗  Não foi possível verificar atualizações (sem rede?).${NC}"
    return 1
  fi
}

# Hash SÓ das dependências (não do package.json inteiro). Assim, updates que
# só mudam scripts/version/postinstall (código) NÃO disparam uma reinstalação
# do node_modules — que no host podia levar à recompilação/limpeza do módulo.
# Só uma mudança real em dependencies/optionalDependencies volta a instalar.
pkg_deps_hash() {
  node -e "const p=require('./package.json');process.stdout.write(JSON.stringify([p.dependencies||{},p.optionalDependencies||{}]))" 2>/dev/null | md5sum | cut -d' ' -f1
}

# ── Verificar e instalar dependências ────────────────────────────────
instalar_deps() {
  echo -e "${YELLOW}  ↓  A instalar/atualizar dependências...${NC}"
  # --ignore-scripts: NÃO correr scripts de build (npm rebuild/node-gyp) dentro do
  # sandbox systemd — o SystemCallFilter bloqueia syscalls de compilação →
  # "Bad system call" → loop de crash. O painel recompila o better-sqlite3 fora
  # do sandbox. O patch do Baileys é aplicado à parte por aplicar_patches().
  npm install --ignore-scripts --no-fund --no-audit --prefer-offline 2>&1 | grep -v "^npm warn" | grep -v "^$"
  binario_sqlite   # buscar já o .node certo, senão o painel compila do zero
  echo -e "${GREEN}  ✓  Dependências prontas!${NC}\n"
}

# ── Binário pré-compilado do better-sqlite3 ──────────────────────────
# O install script do módulo é `prebuild-install || node-gyp rebuild`, e o
# --ignore-scripts acima bloqueia OS DOIS — o módulo fica sem binário nenhum e
# o painel tem de o COMPILAR do zero a cada arranque (minutos, e frágil).
#
# O prebuild-install apenas DESCARREGA o .node já compilado para o ABI deste
# Node: não usa node-gyp, make nem compilador, por isso passa no sandbox do
# systemd. Compilar fica como último recurso (exit 7), não como norma.
binario_sqlite() {
  [ -d node_modules/better-sqlite3 ] || return 0
  # Já funciona? não mexer.
  node -e "new (require('./node_modules/better-sqlite3'))(':memory:').close()" 2>/dev/null && return 0

  local NODE_V ABI PKG_V
  NODE_V=$(node -p "process.version" 2>/dev/null)
  ABI=$(node -p "process.versions.modules" 2>/dev/null)
  PKG_V=$(node -p "require('./node_modules/better-sqlite3/package.json').version" 2>/dev/null)
  echo -e "${YELLOW}  ↓  better-sqlite3 ${PKG_V} sem binário para Node ${NODE_V} (ABI ${ABI}) — a obter o pré-compilado...${NC}"

  # 1ª via: o prebuild-install que vem com o próprio módulo.
  local SAIDA=""
  if [ -x node_modules/.bin/prebuild-install ]; then
    SAIDA=$( ( cd node_modules/better-sqlite3 && ../../node_modules/.bin/prebuild-install -r node --tag-prefix v ) 2>&1 )
  elif [ -x node_modules/better-sqlite3/node_modules/.bin/prebuild-install ]; then
    SAIDA=$( ( cd node_modules/better-sqlite3 && ./node_modules/.bin/prebuild-install -r node --tag-prefix v ) 2>&1 )
  else
    # 2ª via: buscar a ferramenta ao registo (o --ignore-scripts pode tê-la deixado de fora).
    SAIDA=$( ( cd node_modules/better-sqlite3 && npx --yes prebuild-install@7 -r node --tag-prefix v ) 2>&1 )
  fi

  if node -e "new (require('./node_modules/better-sqlite3'))(':memory:').close()" 2>/dev/null; then
    echo -e "${GREEN}  ✓  Binário pronto — sem recompilação.${NC}"
    return 0
  fi

  # NÃO engolir o erro: sem isto era impossível perceber porque falhava.
  echo -e "${RED}  ✗  Não consegui obter binário pronto para Node ${NODE_V} (ABI ${ABI}).${NC}"
  echo -e "${YELLOW}     Motivo:${NC}"
  echo "$SAIDA" | grep -viE "^$" | tail -6 | sed 's/^/       /'
  echo -e "${YELLOW}     → O painel vai compilar do zero (demora). Se isto se repetir, o better-sqlite3${NC}"
  echo -e "${YELLOW}       ${PKG_V} pode não publicar binário para este Node — baixar a versão do Node${NC}"
  echo -e "${YELLOW}       no painel (ex.: 20 ou 22) resolve.${NC}"
  return 1
}

verificar_deps() {
  if [ ! -d "node_modules" ]; then
    echo -e "${YELLOW}  ↗  Primeira instalação detectada.${NC}"
    echo -e "${YELLOW}  ⏳  Este processo pode demorar entre 3 a 10 minutos${NC}"
    echo -e "${YELLOW}     (a compilar módulos nativos — não feches o painel).${NC}\n"
    instalar_deps
    pkg_deps_hash > node_modules/.pkg_hash 2>/dev/null || true
    return
  fi

  # Comparar hash SÓ das dependências (não do package.json inteiro nem do
  # timestamp): updates de código/scripts não reinstalam o node_modules.
  HASH_ATUAL=$(pkg_deps_hash)
  HASH_ANTERIOR=$(cat node_modules/.pkg_hash 2>/dev/null | cut -d' ' -f1)

  if [ -n "$HASH_ATUAL" ] && [ "$HASH_ATUAL" != "$HASH_ANTERIOR" ]; then
    echo -e "${YELLOW}  ↗  Dependências alteradas — a sincronizar...${NC}"
    instalar_deps
    pkg_deps_hash > node_modules/.pkg_hash 2>/dev/null || true
    return
  fi

  # Dependências OK — verificar só better-sqlite3.
  NODE_VER=$(node -e "process.stdout.write(process.version)")
  # ABRE um DB em memória — força o carregamento do binário nativo (.node).
  # require() sozinho não carrega o .node, por isso não detetava um build partido.
  SQLITE_OK=$(node -e "try{new (require('./node_modules/better-sqlite3'))(':memory:').close();process.stdout.write('ok')}catch(e){process.stdout.write('no')}" 2>/dev/null)
  if [ "$SQLITE_OK" != "ok" ]; then
    # 1ª tentativa: descarregar o binário já compilado para este Node (rápido,
    # sem compilador). Resolve o caso normal — ABI diferente depois de o painel
    # atualizar o Node, ou node_modules instalado com --ignore-scripts.
    if binario_sqlite; then
      echo -e "${GREEN}  ✓  Dependências OK (Node ${NODE_VER})${NC}\n"
      return 0
    fi
    # Último recurso: NÃO compilar dentro do sandbox systemd (make/node-gyp
    # bloqueados → "Bad system call" → loop de crash). Sai com código 7 para o
    # painel recompilar fora do sandbox e reiniciar o bot.
    echo -e "${YELLOW}  ↗  better-sqlite3 precisa de recompilação (Node ${NODE_VER}) — a deixar o painel recompilar fora do sandbox...${NC}"
    exit 7
  else
    echo -e "${GREEN}  ✓  Dependências OK (Node ${NODE_VER})${NC}\n"
  fi
}

# ── Patch ao Baileys: null-guard me.lid (entrega no PV) ──────────────
# Corre SEMPRE após instalar/atualizar deps e ANTES de arrancar o bot, para
# garantir que o messages-send.js fica corrigido mesmo quando o npm install não
# correu (package.json sem alterações). É idempotente (não repete se já aplicado).
aplicar_patches() {
  [ -f "patches/baileys.cjs" ] && node patches/baileys.cjs 2>/dev/null || true
}

# ── Arranque: atualizar + instalar deps ──────────────────────────────
auto_atualizar
verificar_deps
aplicar_patches

# ── Auto-restart com atualização automática em cada reinício ─────────
while true; do
  node index.js
  EXIT_CODE=$?

  echo -e "\n${YELLOW}  ⚠  Bot encerrado (código ${EXIT_CODE}). A atualizar e reiniciar...${NC}\n"

  auto_atualizar
  verificar_deps
  aplicar_patches

  sleep 2
done
