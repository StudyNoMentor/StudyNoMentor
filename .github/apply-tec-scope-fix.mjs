#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const ler = (p) => readFileSync(p, 'utf8');
const gravar = (p, s) => writeFileSync(p, s, 'utf8');

// 1) Inclui a camada logo após a tela TEC, ainda no mesmo escopo global.
{
  const p = 'build.mjs';
  let s = ler(p);
  const linha = "    'js/51a-tec-scope-consistency.js',";
  if (!s.includes(linha)) {
    const alvo = "    'js/51-tela-desempenho-tec.js',";
    if (!s.includes(alvo)) throw new Error('Ponto de inserção do módulo TEC não encontrado em build.mjs');
    s = s.replace(alvo, alvo + '\n' + linha);
    gravar(p, s);
  }
}

// 2) Torna a regressão parte da barreira oficial de qualidade.
{
  const p = 'verificar.mjs';
  let s = ler(p);
  if (!s.includes("escopo-plano-tec.mjs")) {
    const alvo = "// ── 4. integridade estática do HTML ────────────────────────────────────────";
    if (!s.includes(alvo)) throw new Error('Ponto de inserção da verificação 3c não encontrado');
    const bloco = `// ── 3c. ESCOPO DO PLANO TEC ───────────────────────────────────────────────\nconsole.log('\\n3c) escopo selecionado do TEC governa o Plano');\ntry {\n  const saida = execFileSync(process.execPath, [join(RAIZ, 'testes', 'escopo-plano-tec.mjs')], { stdio: 'pipe' });\n  ok(String(saida).trim());\n} catch (e) {\n  erro('o Plano voltou a enxergar retratos fora do escopo:\\n' + String(e.stdout || '') + String(e.stderr || ''));\n}\n\n`;
    s = s.replace(alvo, bloco + alvo);
    gravar(p, s);
  }
}

// 3) Regera os artefatos publicados e o carimbo do service worker.
execFileSync(process.execPath, ['testes/escopo-plano-tec.mjs'], { stdio: 'inherit' });
execFileSync(process.execPath, ['build.mjs'], { stdio: 'inherit' });
execFileSync(process.execPath, ['verificar.mjs', '--rapido'], { stdio: 'inherit' });
console.log('Aplicação concluída: fonte, index, manifesto, SW e verificador sincronizados.');
