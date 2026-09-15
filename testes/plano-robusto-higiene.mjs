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
const semComentarios=src=>src.replace(/\/\*[\s\S]*?\*\//g,'').replace(/(^|[^:])\/\/[^\n\r]*/g,'$1');
const erros=[];
for(const f of files){
  const txt=readFileSync(f,'utf8'),rel=relative(ROOT,f);
  if(/\.css$/.test(f)){
    if(/\brv5-(?:panel|section|row|field|mode|manual|export|search)\b/.test(txt))erros.push(`${rel}: CSS/DOM rv5`);
    if(/\brv4-interv\b/.test(txt))erros.push(`${rel}: intervencao rv4`);
    continue;
  }
  if(/\.js$|\.mjs$/.test(f)){
    const code=semComentarios(txt);
    const refs=[
      [/\bPlanoRobustoConfigV\d+\s*[.(\[]|window\.PlanoRobustoConfigV\d+\b/,'config antigo'],
      [/\bPlanoRobustoRouterV\d+\s*[.(\[]|window\.PlanoRobustoRouterV\d+\b/,'router antigo'],
      [/\bPlanoRobustoOptimizerV\d+\s*[.(\[]|window\.PlanoRobustoOptimizerV\d+\b/,'optimizer antigo'],
      [/\bPlanoSugestoesRobustoV[234567]\s*[.(\[]|window\.PlanoSugestoesRobustoV[234567]\b/,'engine antigo'],
      [/\bMentor90(?:V\d+)?\s*[.(\[]|window\.Mentor90\w*\b/,'Mentor90 executavel']
    ];
    for(const[rx,nome]of refs)if(rx.test(code))erros.push(`${rel}: ${nome}`);
  }
  if(/\brobusto-v5\b/.test(txt))erros.push(`${rel}: id robusto-v5`);
}
assert.deepEqual(erros,[],`residuos executaveis/visuais do Robusto antigo:\n${erros.join('\n')}`);

const build=readFileSync(join(ROOT,'build.mjs'),'utf8');
for(const ativo of ['84b-reforco-tec-extras.js','88-plano-sugestoes-robusto.js','89-plano-sugestoes-controller.js','89a-plano-robusto-audit-log.js'])assert(build.includes(ativo),`build precisa carregar ${ativo}`);
for(const antigo of ['88-plano-sugestoes-robusto-v2.js','88a-plano-robusto-config-v4.js','88b-plano-robusto-router-v4.js','88c-plano-robusto-optimizer-v4.js','88d-plano-sugestoes-robusto-v4.js','85-mentor90-performance-bridge-v5.js','85-mentor90-policy-v6.js'])assert(!build.includes(antigo),`build nao pode carregar ${antigo}`);
console.log(`OK: limpeza Robusto — ${files.length} arquivos de produto/docs auditados; sem modulos, referencias executaveis ou seletores visuais legados.`);
