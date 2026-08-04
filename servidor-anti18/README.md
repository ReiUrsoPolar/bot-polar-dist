# Servidor anti +18

Verifica imagens na **tua VPS**. Instalas aqui uma vez e todos os bots usam —
nenhum cliente instala nada, e afinar os limiares chega a toda a gente sem
ninguém atualizar o bot.

## Instalar

```bash
git clone https://github.com/ReiUrsoPolar/bot-polar-dist.git t
mv t/servidor-anti18 ~/servidor-anti18 && rm -rf t
cd ~/servidor-anti18
npm install                 # ~345 MB, uma vez
```

## Arrancar

```bash
ANTI18_TOKEN=$(openssl rand -hex 24) node servidor.mjs
```

Guarda esse token — é o que os bots vão usar. Sem ele o servidor não arranca, de
propósito: um endereço aberto seria CPU tua a classificar imagens de estranhos.

Para ficar sempre a correr (systemd):

```ini
[Unit]
Description=Anti +18
After=network.target

[Service]
WorkingDirectory=/caminho/para/servidor-anti18
Environment=ANTI18_TOKEN=o-teu-segredo
ExecStart=/usr/bin/node servidor.mjs
Restart=always

[Install]
WantedBy=multi-user.target
```

## Ligar os bots — automático, uma vez só

Diz ao Worker onde está o servidor. A partir daí **todos** os bots licenciados
verificam imagens sozinhos: o cliente não configura nada, nem sequer sabe que
isto existe.

```bash
wrangler secret put ANTI18_URL      # https://a-tua-vps:8787  (sem barra no fim)
wrangler secret put ANTI18_TOKEN    # o mesmo segredo do arranque
wrangler deploy
```

O bot manda os bytes ao Worker autenticado com a licença; o Worker é que junta o
token e fala contigo. O token nunca entra no bot — se entrasse, qualquer um o
extraía do dist e usava a tua VPS à borla.

Confirma num grupo com `!anti18`: deve dizer *"Fotos e figurinhas — automático,
já incluído"*.

### Servidor próprio (opcional)

Quem quiser apontar a um servidor **dele** em vez do teu:

```
!anti18 servidor https://o-dominio-dele:8787 o-segredo-dele
```

O bot testa a ligação antes de guardar. Se falhar, não guarda nada e diz porquê.

## Ver se está bem

```bash
curl -H "X-Anti18-Token: o-teu-segredo" http://localhost:8787/saude
```

```json
{"ok":true,"analisadas":128,"adultos":3,"erros":0,"ligadoHa":"3600s",
 "msPorImagem":420,"backend":"tensorflow"}
```

`msPorImagem` é medido, não declarado — é a única forma honesta de saber se o
backend nativo está mesmo a ser usado.

## Se estiver lento

`backend: "cpu"` e `msPorImagem` acima de ~1500 significa TensorFlow em
JavaScript puro. O backend nativo é ~5x mais rápido:

```bash
cd ~/servidor-anti18 && npm install @tensorflow/tfjs-node && systemctl restart anti18
```

Se a compilação falhar (precisa de ferramentas de build), não faz mal — o
servidor continua a funcionar com o que tem. Depois de reiniciar, confirma no
`/saude` que `backend` passou a `tensorflow` **e** que `msPorImagem` desceu. Se o
backend mudou mas o tempo não, o npm instalou duas cópias do `tfjs-core` e o
nsfwjs está a usar a antiga:

```bash
cd ~/servidor-anti18 && rm -rf node_modules package-lock.json && npm install
```

## Afinar

Variáveis de ambiente, se os veredictos não te agradarem:

| Variável | Padrão | O que faz |
|---|---|---|
| `ANTI18_LIMIAR_PORN` | `0.70` | acima disto, é pornografia |
| `ANTI18_LIMIAR_HENTAI` | `0.75` | mais alto porque anime normal confunde-se |
| `ANTI18_LIMIAR_SOMADO` | `0.85` | porn+hentai juntos, quando o modelo se divide |
| `ANTI18_LIMITE_MIN` | `120` | pedidos por minuto por IP |
| `PORT` | `8787` | porta |
| `ANTI18_HOST` | `0.0.0.0` | interface. Atrás de proxy põe `127.0.0.1` |

**Subir** os números = apaga menos, deixa passar mais.
**Descer** = apaga mais, com mais risco de apagar o que não devia.

A categoria *Sexy* nunca conta. É onde caem biquínis, roupa interior e ginásio —
apagar isso faz o admin desligar o filtro, e um filtro desligado não protege
ninguém.

## O que deves saber antes de usar

**As imagens dos grupos dos teus clientes passam por aqui.** Não são guardadas —
são classificadas em memória e deitadas fora — mas passam pela tua máquina. Se
vendes o bot a terceiros, diz-lhes.

**Põe-no atrás de HTTPS** se for acessível pela internet. Sem isso, o token e as
imagens viajam em claro. Com Caddy chega isto:

```
anti18.o-teu-dominio.com {
  reverse_proxy localhost:8787
}
```

E depois `ANTI18_HOST=127.0.0.1` no serviço — senão a porta em claro continua
alcançável pelo IP e o HTTPS é decorativo.
