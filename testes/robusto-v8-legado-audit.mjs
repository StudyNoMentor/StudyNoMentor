import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT=dirname(dirname(fileURLToPath(import.meta.url)));
const proibidosArquivos=[
 'src/js/88-plano-sugestoes-robusto-v2.js','src/js/88a-plano-robusto-config-v4.js','src/js/88b-plano-robusto-router-v4.js','src/js/88c-plano-robusto-optimizer-v4.js','src/js/88d-plano-sugestoes-robusto-v4.js','src/js/89-plano-sugestoes-controller-v2.js','src/js/89z-robusto-foco-questoes-v7.js','src/js/84b-reforco-tec-extras-v5.js','src/js/85-mentor90-performance-bridge-v5.js','src/js/85-mentor90-policy-v6.js','src/js/89a-plano-robusto-audit-log-v1.js','src/css/23-robusto-config-v4.css','docs/manual-modulo-robusto-v5.md','docs/auditoria-independencia-motores-v5.md','docs/auditoria-motores-plano-v2.md'
];
for(const f of proibidosArquivos)assert.equal(existsSync(join(ROOT,f)),false,`residuo legado ainda existe: ${f}`);
const walk=d=>readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(join(d,e.name)):[join(d,e.name)]);
const files=[...walk(join(ROOT,'src')),join(ROOT,'build.mjs'),...walk(join(ROOT,'docs'))].filter(f=>/\.(?:js|css|html|md|mjs|json)$/.test(f));
const bans=[
 [/PlanoRobustoConfigV\d+/g,'config antigo'],[/PlanoRobustoRouterV\d+/g,'router antigo'],[/PlanoRobustoOptimizerV\d+/g,'optimizer antigo'],[/PlanoSugestoesRobustoV[234567]\b/g,'engine antigo'],[/\bMentor90(?:V\d+)?\b/g,'Mentor90'],[/\brobusto-v5\b/g,'id robusto-v5'],[/\brv5-(?:panel|section|row|field|mode|manual|export|search)/g,'CSS/DOM rv5'],[/\brv4-interv\b/g,'intervencao rv4'],[/roteador pedag[oó]gico/gi,'roteador pedagogico']
];
const erros=[];
for(const f of files){const txt=readFileSync(f,'utf8');for(const[rx,nome]of bans){rx.lastIndex=0;if(rx.test(txt))erros.push(`${relative(ROOT,f)}: ${nome}`);}}
assert.deepEqual(erros,[],`residuos do Robusto antigo no produto/documentacao:\n${erros.join('\n')}`);
const build=readFileSync(join(ROOT,'build.mjs'),'utf8');for(const ativo of ['84b-reforco-tec-extras-v8.js','88-plano-sugestoes-robusto-v8.js','89-plano-sugestoes-controller.js','89a-plano-robusto-audit-log-v2.js'])assert(build.includes(ativo),`build precisa carregar ${ativo}`);
console.log(`OK: limpeza Robusto V8 — ${files.length} arquivos de produto/docs auditados, sem engine/config/router/optimizer/Mentor90 legados.`);
