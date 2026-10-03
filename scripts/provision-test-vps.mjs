// Owner-run provisioning for an isolated test instance. No production updates.
import { execFileSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, lstatSync } from 'node:fs'
import { resolve, join } from 'node:path'
const [archive, expectedHash, releaseName] = process.argv.slice(2)
if (process.platform !== 'linux' || process.getuid?.() !== 0) throw new Error('Executar apenas como administrador na VPS Linux')
if (!/^[a-f0-9]{64}$/.test(expectedHash ?? '') || !/^20261001-[a-zA-Z0-9]{6,16}$/.test(releaseName ?? '')) throw new Error('Argumentos inválidos')
const tar = resolve(archive ?? '')
if (!tar.startsWith('/tmp/polar-upload-') || !tar.endsWith('/polar-candidate.tgz')) throw new Error('Arquivo fora do diretório de transferência')
if (createHash('sha256').update(readFileSync(tar)).digest('hex') !== expectedHash) throw new Error('Checksum diferente')
const base = '/opt/polar-testes', data = '/var/lib/polar-testes', release = join(base,'releases',releaseName)
if (existsSync(release) || existsSync('/etc/systemd/system/polar-testes.service') || existsSync('/etc/polar-testes/instance.env')) throw new Error('Instância existente: não será substituída')
const paths = execFileSync('tar',['-tzf',tar],{encoding:'utf8'}).split('\n').filter(Boolean)
if (paths.some(p => p.startsWith('/') || p.split('/').includes('..'))) throw new Error('Caminho de arquivo inseguro')
if (!execFileSync('getent',['passwd'],{encoding:'utf8'}).split('\n').some(x=>x.startsWith('polar-testes:'))) {
  execFileSync('useradd',['--system','--home-dir',data,'--shell','/usr/sbin/nologin','polar-testes'])
}
mkdirSync(release,{recursive:true,mode:0o755}); mkdirSync(data,{recursive:true,mode:0o700}); mkdirSync('/etc/polar-testes',{recursive:true,mode:0o700})
execFileSync('tar',['-xzf',tar,'--no-same-owner','-C',release])
function verify(dir) {for(const e of readdirSync(dir,{withFileTypes:true})) {const p=join(dir,e.name);if(lstatSync(p).isSymbolicLink())throw new Error('Symlink no arquivo');if(e.isDirectory())verify(p)}}
verify(release)
execFileSync('chown',['-R','polar-testes:polar-testes',release,data])
execFileSync('runuser',['-u','polar-testes','--','npm','ci','--omit=dev','--no-audit','--no-fund'],{cwd:release,stdio:'inherit',timeout:240000})
for(const args of [['start.js','--check'],['scripts/check-runtime.mjs'],['scripts/smoke-dist.mjs','.','--installed']]) {
  execFileSync('runuser',['-u','polar-testes','--','node',...args],{cwd:release,stdio:'inherit',timeout:60000,env:{...process.env,POLAR_DIR:data,POLAR_INSTANCIA:'alo-teste'}})
}
// No session or customer configuration is copied. Only a new private test config.
mkdirSync(join(data,'config'),{recursive:true,mode:0o700})
const { CRIADOR } = await import(join(release,'src/config.js'))
writeFileSync(join(data,'config','bot.json'),JSON.stringify({nomeBot:'Polar · Teste',prefix:'!',numeroDono:CRIADOR,nomeDono:'Polar',fusoHorario:'Europe/Lisbon',jogosWebAtivo:false},null,2),{mode:0o600,flag:'wx'})
execFileSync('chown',['-R','polar-testes:polar-testes',data])
writeFileSync('/etc/polar-testes/instance.env',`POLAR_DIR=${data}\nPOLAR_INSTANCIA=alo-teste\nPOLAR_TEST_GROUP=alo\nPOLAR_PAINEL_HOST=127.0.0.1\nPOLAR_PAINEL_PORTA=9318\nPOLAR_PAINEL_TOKEN=${randomBytes(32).toString('hex')}\n`,{mode:0o600,flag:'wx'})
writeFileSync('/etc/systemd/system/polar-testes.service',`[Unit]\nDescription=Polar teste isolado (alo)\nAfter=network-online.target\nWants=network-online.target\nStartLimitIntervalSec=600\nStartLimitBurst=3\n\n[Service]\nUser=polar-testes\nGroup=polar-testes\nWorkingDirectory=${release}\nEnvironmentFile=/etc/polar-testes/instance.env\nExecStart=/usr/bin/node ${release}/index.js\nRestart=on-failure\nRestartSec=45\nUMask=0077\nNoNewPrivileges=true\nPrivateTmp=true\nProtectSystem=strict\nProtectHome=true\nReadWritePaths=${data}\nMemoryMax=768M\nTasksMax=128\nTimeoutStopSec=25\n\n[Install]\nWantedBy=multi-user.target\n`,{mode:0o644,flag:'wx'})
execFileSync('systemctl',['daemon-reload'])
execFileSync('systemctl',['start','polar-testes.service'])
console.log('Instância de testes criada. Não habilitada no arranque; sessão WhatsApp ainda não validada. Serviço: polar-testes; painel: loopback 9318.')
