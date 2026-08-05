#!/data/data/com.termux/files/usr/bin/bash
# ─────────────────────────────────────────────────────────────────────────
# Polar Bot no Termux (Android)
#
#   bash termux.sh
#
# O start.sh normal é o atualizador de painel (git, rsync, prebuild) e não serve
# no telemóvel. Aqui é o essencial: instalar dependências e arrancar.
#
# O único módulo nativo do bot é o better-sqlite3, que raramente compila no
# Termux. Instala-se SEM os scripts de build (--ignore-scripts) e o bot cai
# sozinho para o SQLite embutido no Node — não é preciso compilar nada.
# ─────────────────────────────────────────────────────────────────────────
set -e
cd "$(dirname "$0")"

echo "🐧 Polar Bot — arranque no Termux"

# 1) Pacotes do sistema (Node e ffmpeg). O ffmpeg do Termux substitui o binário
#    x86 do @ffmpeg-installer, que não corre em Android.
need_pkg() { command -v "$1" >/dev/null 2>&1; }
if ! need_pkg node || ! need_pkg ffmpeg || ! need_pkg git; then
  echo "  ↓ A instalar node, ffmpeg e git…"
  pkg update -y >/dev/null 2>&1 || true
  pkg install -y nodejs ffmpeg git
fi

echo "  node $(node -v) · ffmpeg $(ffmpeg -version 2>/dev/null | head -1 | awk '{print $3}')"

# 2) Dependências do bot, sem compilar nativos.
if [ ! -d node_modules ] || [ package.json -nt node_modules ]; then
  echo "  ↓ A instalar dependências (sem build nativo)…"
  npm install --ignore-scripts --no-fund --no-audit
fi

# 3) Patch do Baileys (o --ignore-scripts não corre o postinstall). No Baileys 7
#    não faz nada, mas é inofensivo.
node patches/baileys.cjs || true

# 4) Arrancar. O QR aparece aqui no terminal — lê-o com o WhatsApp.
echo "  ▶ A arrancar o bot…"
exec node index.js
