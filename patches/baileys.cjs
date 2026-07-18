// patches/baileys.cjs — correção aplicada automaticamente ao Baileys após instalar.
// CommonJS (.cjs) para o Node carregar como CJS mesmo com package.json "type":"module".
// NÃO é ofuscado pelo CI (só src/ e index.js são) — fica legível de propósito.
'use strict';
const { readFileSync, writeFileSync } = require('fs');

const MSG_SEND = 'node_modules/@whiskeysockets/baileys/lib/Socket/messages-send.js';

// A partir do Baileys 7.0 o crash `me.lid.split()` DEIXOU de existir (o 7.0
// reescreveu o addressing com LID nativo). Nessas versões este patch é
// desnecessário — saímos em silêncio para não assustar com "padrão não encontrado".
try {
  const _v = require('@whiskeysockets/baileys/package.json').version || '';
  if (/^[7-9]\./.test(_v) || /^\d{2,}\./.test(_v)) {
    console.log('[patch] Baileys ' + _v + ' — me.lid null-guard já não é necessário (LID nativo). Nada a fazer.');
    process.exit(0);
  }
} catch {}

function applyPatch(file, description, oldStr, newStr) {
  try {
    let c = readFileSync(file, 'utf8');
    if (c.includes(newStr)) {
      console.log('[patch] Já aplicado: ' + description);
      return;
    }
    if (!c.includes(oldStr)) {
      console.log('[patch] Padrão não encontrado (versão diferente?): ' + description);
      return;
    }
    writeFileSync(file, c.replace(oldStr, newStr), 'utf8');
    console.log('[patch] Aplicado: ' + description);
  } catch (e) {
    console.log('[patch] Ignorado ' + description + ':', e.message);
  }
}

// ── FIX: crash "Cannot read properties of null (reading 'split')" no PV ───────
// Ao responder a um @lid no privado, o Baileys cifra a mensagem também para os
// PRÓPRIOS dispositivos LID do bot e faz `creds.me.lid.split(':')`. Em contas
// Privacy Mode `me.lid` pode ser null/undefined → o `.split` rebenta e o ENVIO
// INTEIRO falha (o sintoma é "aparece a escrever e depois não envia nada").
// O `?.` só protege `me`, não o `.lid`. Acrescentamos o null-guard em `.lid`.
// É a ÚNICA correção real necessária para o bot responder em PV.
applyPatch(MSG_SEND, 'me.lid null-guard (entrega no PV)',
  'me?.lid.split(',
  'me?.lid?.split('
);
