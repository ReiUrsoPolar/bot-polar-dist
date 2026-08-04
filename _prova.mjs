import { classificarMedia, _limparCache } from './src/anti18.js'
import { disponivel, analisarLocal } from './src/anti18local.js'
import sharp from 'sharp'

console.log('verificador local disponível:', await disponivel())
_limparCache()

// Imagens sintéticas — chegam para provar o caminho completo.
const verde = await sharp({ create: { width: 300, height: 300, channels: 3, background: '#6aa84f' } }).jpeg().toBuffer()
const t0 = Date.now()
const r = await analisarLocal(verde)
console.log('\nanálise (', Date.now() - t0, 'ms ):')
console.log('  veredicto:', r?.veredicto)
console.log('  ' + (r?.previsoes ?? []).map(p => p.className + ':' + (p.probability*100).toFixed(0) + '%').join('  '))

// E agora pelo caminho que o bot usa a sério (classificarMedia), SEM classificador de IA:
const b64 = verde.toString('base64')
console.log('\npelo classificarMedia (sem IA nenhuma, só local):')
console.log('  →', await classificarMedia(b64, 'image/jpeg', null))
