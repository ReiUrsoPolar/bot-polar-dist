#!/bin/bash
# start.sh — o arranque em bash (painéis, systemd, Termux).
#
# A lógica toda — actualizar, instalar dependências, aplicar o patch do Baileys
# e manter o bot de pé — vive no start.js, que corre em Windows, Linux, macOS e
# Termux. Este ficheiro só trata do que tem de acontecer ANTES de haver Node,
# que é a única coisa que o start.js não pode fazer por si.
#
# Antes havia aqui uma segunda cópia de tudo, em bash, e as duas começaram logo
# a divergir: a travagem do ciclo de reinícios foi só para o start.js, e esta
# continuava a reinstalar tudo de 2 em 2 segundos quando o bot não arrancava.
#
# O `exec` faz com que o código de saída do node seja o deste script — o painel
# continua a receber o 7 quando é preciso recompilar o better-sqlite3.

cd "$(dirname "$0")" || exit 1

if ! command -v node >/dev/null 2>&1; then
  # No Termux o Node não vem instalado, e sem ele isto não arranca de todo.
  # Como aqui ainda estamos em bash, dá para o instalar — é o que o termux.sh
  # fazia, e é a razão de ele ter existido.
  if [ -n "$TERMUX_VERSION" ] || [ -d /data/data/com.termux ]; then
    echo "  ↓  A instalar o Node (primeira vez no Termux)…"
    pkg update -y >/dev/null 2>&1 || true
    pkg install -y nodejs || { echo "  ✗  Não consegui instalar o Node."; exit 1; }
  else
    echo "  ✗  O Node.js não está instalado."
    echo "     Instala-o em https://nodejs.org e corre isto outra vez."
    exit 1
  fi
fi

# O start.js também verifica a versão do Node — mas escrito em JavaScript
# moderno, um Node muito antigo nem consegue lê-lo: morre com um SyntaxError
# que não diz nada a ninguém. Aqui, ainda em bash, dá para o dizer em condições.
NODE_MAIOR=$(node -p "process.versions.node.split('.')[0]" 2>/dev/null || echo 0)
case "$NODE_MAIOR" in ''|*[!0-9]*) NODE_MAIOR=0 ;; esac
if [ "$NODE_MAIOR" -lt 20 ]; then
  echo ""
  echo "  ✖  HOSPEDAGEM INCOMPATÍVEL — o Node desta host é demasiado antigo."
  echo "     Tem Node v${NODE_MAIOR} e o bot precisa de Node 20 ou superior."
  echo ""
  echo "     A TUA LICENÇA ESTÁ BOA — o problema é a hospedagem."
  echo "     Pede ao suporte da host para atualizar o Node (ou muda de host)."
  echo ""
  exit 1
fi

exec node start.js "$@"
