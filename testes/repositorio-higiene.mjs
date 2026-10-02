#!/usr/bin/env node
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT=dirname(dirname(fileURLToPath(import.meta.url)));
const walk=d=>readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(join(d,e.name)):[join(d,e.name)]);
const build=readFileSync(join(ROOT,'build.mjs'),'utf8');
const declarados=[...build.matchAll(/['"]((?:html|css|js)\/[^'"]+)['"]/g)].map(m=>m[1]);
const duplicados=declarados.filter((x,i)=>declarados.indexOf(x)!==i);
assert.deepEqual([...new Set(duplicados)],[],'build.mjs não pode carregar a mesma fonte duas vezes');

const todosSrcAbs=walk(join(ROOT,'src')).filter(f=>/\.(?:js|css|html)$/.test(f));
const relSrc=f=>relative(join(ROOT,'src'),f).replaceAll('\\','/');
const vendorAbs=todosSrcAbs.filter(f=>relSrc(f).startsWith('vendor/'));
const fontesAbs=todosSrcAbs.filter(f=>!relSrc(f).startsWith('vendor/'));
const fontes=fontesAbs.map(relSrc).sort();
for(const f of todosSrcAbs) assert.notEqual(readFileSync(f,'utf8').trim(),'',
  `fonte vazia não deve ser versionada: ${relative(ROOT,f)}`);
for(const f of fontes) assert.equal(/-v\d+\.(?:js|css)$/i.test(f),false,
  `fonte atual não deve carregar sufixo de versão: ${f}`);
assert.deepEqual([...new Set(declarados)].sort(),fontes,
  'todo JS/CSS/HTML autoral de src deve participar exatamente do build publicado');

// Vendors são runtimes estáticos carregados sob demanda e NÃO entram no bundle
// concatenado. A whitelist exata mantém o gate estrito: vendor/ não vira um
// lugar onde JS órfão pode ser escondido.
const vendorsPermitidos=[];
const vendors=vendorAbs.map(relSrc).sort();
assert.deepEqual(vendors,vendorsPermitidos,
  'src/vendor só pode conter os runtimes estáticos explicitamente auditados');

const proibidos=[
  'AUDITORIA.md',
  'AUDITORIA-GERAL-2026-09.md',
  'anki-oficial/BRANCH-CONSOLIDATION-20261001.md',
  'anki-oficial/AUDIT-LEGACY-FIELD-IDENTITY-20261001.md',
  'audit.html','audit-runner.cjs','audit-tests.js','audit-browser.js','audit-results.json','audit-browser-results.json',
  'testes/rodar-auditoria-browser.mjs','testes/stress-extras-tec.mjs','testes/resultado-stress-extras-tec.json',
  'testes/plano-robusto-v4.mjs','testes/plano-robusto-foco-questoes-v7.mjs','testes/reforco-cenarios.mjs',
  'src/css/04-tec-inline.css','docs/robusto-auditoria-json.md',
  'src/js/13-backups-locais.js','src/js/61-session-guard.js','src/js/65-recuperacao.js',
  'testes/paridade-anki.mjs',
  'testes/robustez-config.mjs',
  'testes/referencia-anki.js',
  'testes/cards-paridade-total-anki.mjs',
  'testes/cards-certificacao-anki.mjs',
  'testes/cards-practical-10.mjs',
  'testes/cards-product-parity.mjs',
  'testes/cards-total-parity.mjs',
  'testes/cards-max-stats-media.mjs',
  'testes/cards-max-reviewer-browser.mjs',
  'testes/cards-search-differential.mjs',
  'testes/cards-typeanswer-differential.mjs',
  'testes/anki-oficial-search.py',
  'testes/anki-oficial-typeanswer.py',
  'testes/anki-oficial-roundtrip.py',
  'testes/cards-apkg-export.mjs',
  'testes/cards-import-formatos.mjs',
  'testes/cards-import-anki-oficial.mjs',
  'testes/cards-fsrs-optimizer-oficial.mjs',
  'testes/cards-foco-edicao-browser.mjs',
  'testes/cards-reparo-memoria-browser.mjs',
  'testes/cards-10of10-final.mjs',
  '.tmp-build-map-1.json',
  '.tmp-build-map-2.json',
  'anki-oficial/AUDITORIA-POR-ARQUIVO.md',
  'anki-oficial/audit-status.json',
  'tools/anki-audit-report.mjs',
  'src/js/44-anki-10of10-final.js',
  'src/js/34-anki-export.js',
  'src/js/44-anki-runtime.js',
  'src/js/45-anki-official-surfaces.js',
  'src/js/30-fsrs.js',
  'src/js/31-cards-config.js',
  'src/js/32-card-engine.js'
];
for(const p of proibidos)assert.equal(existsSync(join(ROOT,p)),false,`artefato obsoleto voltou: ${p}`);
const temporariosBuild=readdirSync(ROOT).filter(n=>/^\.tmp-build-map-.*\.json$/.test(n));
assert.deepEqual(temporariosBuild,[],'mapas temporários de build não podem ser versionados');
assert.equal(existsSync(join(ROOT,'testes','evidencias')),false,'evidências geradas não devem ser versionadas');
assert.equal(existsSync(join(ROOT,'audit')),false,'auditorias históricas de motores removidos não devem voltar ao repositório');
const ankiTransport=readFileSync(join(ROOT,'src','js','44-anki-official.js'),'utf8');
assert.equal(ankiTransport.includes('ankiOfficialApiUrl'),false,'transporte oficial não deve aceitar override legado por localStorage');

// A versão anterior não deve sobreviver em código ativo, mensagens ou testes.
// Auditorias históricas fora destes diretórios podem registrar o passado, mas
// não entram no runtime nem na barreira funcional atual.
const activeVersionRoots=[join(ROOT,'src'),join(ROOT,'anki_official_backend'),join(ROOT,'testes')];
for(const dir of activeVersionRoots){
  for(const file of walk(dir).filter(f=>/\.(?:js|mjs|py|css|html)$/.test(f))){
    assert.equal(/\b26\.0?9\.2\b/.test(readFileSync(file,'utf8')),false,
      `referência ativa à versão Anki descontinuada: ${relative(ROOT,file)}`);
  }
}

const semComentarios=src=>src.replace(/\/\*[\s\S]*?\*\//g,'').replace(/(^|[^:])\/\/[^\n\r]*/g,'$1');
const apiVersionada=/\bMotorSugestaoV\d+\b/;
const fontesJs=fontesAbs.filter(f=>f.endsWith('.js'));
for(const f of fontesJs){
  const codigo=semComentarios(readFileSync(f,'utf8'));
  assert.equal(apiVersionada.test(codigo),false,`API técnica versionada em src/: ${relative(ROOT,f)}`);
  assert.equal(/_legacyPuxar\b/.test(codigo),false,`fallback para Puxar do Plano legado não pode voltar: ${relative(ROOT,f)}`);
  assert.equal(/\b(?:SessionLock|SessionGuard|BackupHistory|Recuperacao)\b|cfg-vhist/.test(codigo),false,
    `runtime legado relacional/local não pode voltar: ${relative(ROOT,f)}`);
}

const testeAtual=fileURLToPath(import.meta.url);
const testesJs=walk(join(ROOT,'testes')).filter(f=>/\.(?:mjs|js)$/.test(f)&&f!==testeAtual);
for(const f of testesJs){
  const codigo=semComentarios(readFileSync(f,'utf8'));
  assert.equal(apiVersionada.test(codigo),false,`teste ainda referencia API técnica versionada: ${relative(ROOT,f)}`);
}

// Todo teste executável precisa participar de uma barreira automática. Arquivo
// .mjs sem referência no workflow/verificador é teste morto: parece proteção,
// mas nunca roda e tende a apodrecer silenciosamente.
const workflow=readFileSync(join(ROOT,'.github','workflows','verificar.yml'),'utf8');
const verificador=readFileSync(join(ROOT,'verificar.mjs'),'utf8');
const cobertura=workflow+'\n'+verificador;
const mjsTopo=readdirSync(join(ROOT,'testes')).filter(n=>n.endsWith('.mjs'));
const orfaos=mjsTopo.filter(n=>!cobertura.includes(`testes/${n}`));
assert.deepEqual(orfaos,[],`testes .mjs sem execução automática: ${orfaos.join(', ')}`);

// A pasta test/ contém fixtures auxiliares carregadas pelo verificador agregado.
// Ela ficava fora da barreira acima, então um helper abandonado poderia sobreviver
// indefinidamente no repositório. Cada JS/MJS auxiliar precisa ter consumidor
// explícito no verificar.mjs; se deixar de ter, deve ser removido junto da mudança.
const auxDir=join(ROOT,'test');
if(existsSync(auxDir)){
  const auxiliares=readdirSync(auxDir).filter(n=>/\.(?:mjs|js)$/.test(n));
  const auxOrfaos=auxiliares.filter(n=>!verificador.includes(`test/${n}`));
  assert.deepEqual(auxOrfaos,[],`auxiliares de test/ sem consumidor no verificador: ${auxOrfaos.join(', ')}`);
}

console.log(`OK: higiene do repositório — ${fontes.length} fontes publicadas, nenhuma órfã/duplicada, ${mjsTopo.length} testes executáveis cobertos e nenhuma API técnica versionada.`);
