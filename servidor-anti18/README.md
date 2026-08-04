# Servidor anti +18

Verifica imagens na **tua VPS**. Instalas aqui uma vez e todos os bots usam —
nenhum cliente instala nada, e afinar os limiares chega a toda a gente sem
ninguém atualizar o bot.

## Instalar

```bash
cd servidor-anti18
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

## Ligar um bot

No WhatsApp, como dono:

```
!anti18 servidor https://o-teu-dominio:8787 o-teu-segredo
```

O bot testa a ligação antes de guardar. Se falhar, não guarda nada e diz porquê.

## Ver se está bem

```bash
curl -H "X-Anti18-Token: o-teu-segredo" http://localhost:8787/saude
```

```json
{"ok":true,"analisadas":128,"adultos":3,"erros":0,"ligadoHa":"3600s"}
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
imagens viajam em claro.
