#!/data/data/com.termux/files/usr/bin/bash
# termux.sh — o mesmo que `bash start.sh`.
#
# Este ficheiro tinha a sua própria versão do arranque: instalava o node, o
# ffmpeg e o git, instalava as dependências sem build nativo e corria o bot. Só
# que corria `node index.js` directamente — sem actualização automática e sem
# voltar a levantar o bot quando ele caísse. Quem seguia as instruções do
# Termux ficava com um bot pior do que quem corria o start.sh, e nem sabia.
#
# Agora está tudo num sítio só: o start.sh instala o Node se faltar (é o único
# passo que tem mesmo de ser em bash) e o start.js trata do resto, incluindo o
# ffmpeg e o git do Termux.
#
# Continua aqui porque há instruções e vídeos que mandam correr `bash termux.sh`.

cd "$(dirname "$0")" || exit 1
exec bash start.sh "$@"
