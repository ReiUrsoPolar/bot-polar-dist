# Correr o Polar Bot no Termux (Android)

Dá para correr o bot no telemóvel, sem VPS. É mais lento e o Android pode matar o
processo em segundo plano, mas funciona.

## Passos

1. Instala o **Termux** (da F-Droid, não da Play Store — a da Play está desatualizada).

2. No Termux:

```bash
pkg update -y && pkg install -y nodejs ffmpeg git
git clone https://github.com/ReiUrsoPolar/bot-polar-dist.git polar
cd polar
bash termux.sh
```

3. Aparece um **QR Code** no terminal — lê-o com o WhatsApp (Aparelhos ligados →
   Ligar um aparelho).

O `termux.sh` trata de tudo: instala as dependências e arranca. Nas próximas
vezes é só `cd polar && bash termux.sh`.

## Porque é que funciona sem compilar nada

O único módulo nativo do bot é o **better-sqlite3**, que quase nunca compila no
Termux. Por isso instala-se **sem** os scripts de build (`--ignore-scripts`) e o
bot cai sozinho para o **SQLite embutido no Node** (`node:sqlite`) — mesma base
de dados, sem compilar. Vais ver no arranque:

```
better-sqlite3 indisponível (Termux?) — a usar o SQLite embutido no Node
```

Isso é normal, não é erro.

O `ffmpeg` (para áudios/figurinhas) usa o do sistema — por isso o `pkg install
ffmpeg` acima.

## Manter vivo em segundo plano

O Android mata processos parados. Para o bot aguentar:

```bash
termux-wake-lock          # impede o Android de o suspender
```

E desliga a otimização de bateria do Termux nas definições do Android.

## O que NÃO funciona no telemóvel

- O **verificador anti +18 local** (nsfwjs/tensorflow) — são ~345 MB de módulos
  nativos que não instalam no Termux. Mas o anti +18 **automático** (pelo nosso
  servidor) continua a funcionar na mesma, porque a análise é feita fora do
  telemóvel.
