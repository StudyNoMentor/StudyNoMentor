#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════════
   VERIFICAÇÃO — roda antes de publicar
   ───────────────────────────────────────────────────────────────────────────
   Sete checagens, da mais barata para a mais cara. Qualquer falha derruba o
   processo (código 1), então isto serve tanto para rodar na mão quanto para o
   GitHub Actions.

     1. src/ monta exatamente o index.html   (build.mjs --check)
     2. cada módulo JS de src/ tem sintaxe válida isoladamente
     3. o agendador bate com o Anki e sobrevive a configuracao corrompida
        (testes/paridade-anki.mjs · testes/robustez-config.mjs)
    3b. a importacao do TEC registra exatamente o que o arquivo diz, do byte
        ao total — desempenho e incidencia (testes/fidelidade-tec.mjs)
     4. o index.html publicado não tem id duplicado nem referência quebrada
     5. o app carrega no Chromium sem um único erro de console
     6. as 14 telas navegam e a suíte interna AutoTeste passa 100%
     7. um ANO de uso simulado: 8 importacoes sobre uma arvore irregular, com
        atividades, progresso na mao, retrato apagado, lente e foco trocados —
        e as invariantes cobradas depois de cada passo
     8. nenhum texto abaixo do contraste WCAG AA — nos temas claro E escuro

   As checagens 5 a 7 precisam do Chromium (Playwright). Se ele não estiver
   instalado, elas são PULADAS com aviso — as quatro primeiras sempre rodam.

   Uso:  node verificar.mjs        (tudo)
         node verificar.mjs --rapido   (só 1 a 4, sem navegador)
   ═══════════════════════════════════════════════════════════════════════════ */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { dirname, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { montarApiFalsa } from './test/supabase-falso.mjs';
import { createHash } from 'node:crypto';

const RAIZ = dirname(fileURLToPath(import.meta.url));
let falhas = 0;
const ok = (m) => console.log('  ✓ ' + m);
const erro = (m) => { falhas++; console.error('  ✗ ' + m); };

// ── 1. montagem byte a byte ────────────────────────────────────────────────
console.log('\n1) src/ monta o index.html publicado');
try {
  execFileSync(process.execPath, [join(RAIZ, 'build.mjs'), '--check'], { stdio: 'pipe' });
  ok('index.html e src/ estao em sincronia (byte a byte)');
} catch (e) {
  erro('src/ NAO monta o index.html atual:\n' + String(e.stdout || '') + String(e.stderr || ''));
}

// ── 2. sintaxe de cada módulo ──────────────────────────────────────────────
console.log('\n2) sintaxe de cada modulo de src/js');
const mods = readdirSync(join(RAIZ, 'src', 'js')).filter((f) => f.endsWith('.js')).sort();
let ruins = 0;
for (const m of mods) {
  try { execFileSync(process.execPath, ['--check', join(RAIZ, 'src', 'js', m)], { stdio: 'pipe' }); }
  catch (e) { ruins++; erro(`${m}: ${String(e.stderr).split('\n').slice(0, 3).join(' ')}`); }
}
if (!ruins) ok(`${mods.length} modulos analisam isoladamente`);

// ── 3. paridade com o Anki (teste diferencial, sem navegador) ──────────────
console.log('\n3) agendador: paridade com o Anki + robustez da configuracao');
try {
  const saida = execFileSync(process.execPath, [join(RAIZ, 'testes', 'paridade-anki.mjs')], { stdio: 'pipe' });
  ok(String(saida).trim());
} catch (e) {
  erro('divergencia contra a referencia:\n' + String(e.stdout || '') + String(e.stderr || ''));
}
try {
  const saida = execFileSync(process.execPath, [join(RAIZ, 'testes', 'robustez-config.mjs')], { stdio: 'pipe' });
  ok(String(saida).trim());
} catch (e) {
  erro('configuracao invalida ainda torna cards inagendaveis:\n' + String(e.stdout || '') + String(e.stderr || ''));
}

/* ── 3b. FIDELIDADE DA IMPORTACAO DO TEC ───────────────────────────────────
   A importacao e a fonte de todo numero do Desempenho TEC e do Plano: um erro
   de contagem ali erra o dominio, a fila de ataque, o custo e a nota projetada
   — e em silencio, porque depois nao ha com o que comparar. O teste parte dos
   BYTES de um .xlsx gerado com a estrutura do export real (pai = soma dos
   filhos, disciplina sem codigo, balde "Sem Classificacao", % arredondada) e
   cobra as invariantes de contagem, incluindo o indice de incidencia. */
console.log('\n3b) fidelidade da importacao do TEC (desempenho + incidencia)');
try {
  const saida = execFileSync(process.execPath, [join(RAIZ, 'testes', 'fidelidade-tec.mjs')], { stdio: 'pipe' });
  ok(String(saida).trim().split('\n').pop());
} catch (e) {
  erro('a importacao do TEC nao registra o que o arquivo diz:\n' + String(e.stdout || '') + String(e.stderr || ''));
}

// ── 4. integridade estática do HTML ────────────────────────────────────────
console.log('\n4) integridade do index.html');
const html = readFileSync(join(RAIZ, 'index.html'), 'utf8');
const semCodigo = html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '');
const ids = [...semCodigo.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
const dup = ids.filter((v, i) => ids.indexOf(v) !== i);
dup.length ? erro('ids duplicados: ' + [...new Set(dup)].join(', ')) : ok(`${ids.length} ids, nenhum duplicado`);
// o bloco inerte com o codigo do app tem de existir e nao pode conter "</script>"
// (isso encerraria a tag no meio do codigo e quebraria o app inteiro em silencio)
const inerte = html.match(/<script id="app-code" type="application\/x-diario-inert">([\s\S]*?)<\/script>/);
if (!inerte) erro('bloco <script id="app-code"> ausente ou malformado');
else if (inerte[1].length < 1000000) erro(`bloco app-code truncado (${inerte[1].length} bytes)`);
else ok(`bloco app-code integro (${inerte[1].length} bytes)`);
/* As tags ESTRUTURAIS tem de continuar pareadas. Ancoradas no inicio da linha
   de proposito: o texto "<style>" tambem aparece dentro de comentarios de CSS e
   de literais de string, e conta-los daria falso alarme. */
const forte = html.replace(/<script id="app-code"[\s\S]*?<\/script>/, '');
for (const nome of ['style', 'script']) {
  // Uma linha que abre E fecha a tag (o <script src=...></script> do Supabase)
  // ja esta balanceada; as demais precisam de uma linha de fechamento propria.
  let abertos = 0, faltando = 0;
  for (const linha of forte.split('\n')) {
    const abre = new RegExp('^[ \\t]*<' + nome + '\\b').test(linha);
    const fecha = new RegExp('</' + nome + '>').test(linha);
    if (abre && fecha) continue;
    if (abre) { abertos++; continue; }
    if (new RegExp('^[ \\t]*</' + nome + '>').test(linha)) { abertos--; if (abertos < 0) { faltando++; abertos = 0; } }
  }
  (abertos === 0 && faltando === 0)
    ? ok(`<${nome}> pareado`)
    : erro(`<${nome}> desbalanceado: ${abertos} sem fechar, ${faltando} fechamento(s) orfao(s)`);
}
// a diretiva que o navegador ignora em <meta> nao pode voltar PARA DENTRO da CSP
const meta = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]*)"/);
if (!meta) erro('<meta> de Content-Security-Policy ausente');
else if (/frame-ancestors/.test(meta[1])) erro('frame-ancestors voltou ao <meta> CSP (o navegador ignora e loga erro)');
else if (!/object-src 'none'/.test(meta[1]) || !/base-uri 'self'/.test(meta[1])) erro('CSP perdeu object-src/base-uri');
else ok('CSP do <meta> integra e sem diretivas ignoradas');
/* Nenhum catch VAZIO dentro do codigo do app. Fora dele (os dois scripts de
   arranque no <head> e o shim de armazenamento) e legitimo: _quiet ainda nao
   existe la. Dentro, catch vazio e uma falha que o usuario nunca vai ver. */
if (inerte) {
  const vazios = (inerte[1].match(/catch\s*\([A-Za-z_$][\w$]*\)\s*\{\s*\}/g) || []).length;
  vazios === 0 ? ok('nenhum catch vazio no codigo do app')
    : erro(`${vazios} catch vazio(s) no codigo do app — use _quiet(e, 'contexto')`);
}
// a trava anti-moldura tem de continuar no <head>, antes de qualquer pintura
/travaAntiMoldura/.test(html.slice(0, 6000)) ? ok('trava anti-moldura presente no <head>')
  : erro('trava anti-moldura sumiu do <head> (clickjacking volta a ser possivel)');

/* ── 4.5) invariantes do service worker ─────────────────────────────────────
   O sw.js nao e montado a partir de src/ e nao aparece no index.html, entao
   nenhuma das checagens acima o enxerga. E ele e o arquivo onde um erro nao da
   erro: da versao velha servida em silencio. Estas travas guardam as decisoes
   que custaram caro para descobrir. */
console.log('\n4.5) invariantes do service worker');
{
  const sw = readFileSync(join(RAIZ, 'sw.js'), 'utf8');
  try { new (await import('node:vm')).Script(sw); ok('sw.js analisa'); }
  catch (e) { erro('sw.js nao analisa: ' + e.message); }

  const regras = [
    [/const VERSAO = 'v[0-9a-f]{10}';/, 'a versao e um carimbo de conteudo (nao um nome fixo)'],
    [/CACHE_CDN = '(?!.*VERSAO)[^']+'/, 'o balde de CDN nao e versionado (nao se perde a cada publicacao)'],
    [/cache: 'reload'/, "o pre-carregamento usa cache: 'reload' (nao guarda a casca velha)"],
    [/navigationPreload[\s\S]{0,120}?disable\(\)/,
      'o pre-carregamento de navegacao e desligado (a navegacao sai do cache)'],
    [/function responderNavegacao[\s\S]{0,900}?if \(guardado\) \{/,
      'a navegacao serve a casca guardada antes de pensar em rede'],
    [/supabase\\\.\(co\|in\)\$/, 'trafego do Supabase passa direto, sem cache'],
    [/req\.method !== 'GET'/, 'apenas GET pode ser cacheado'],
  ];
  regras.forEach(([re, nome]) => (re.test(sw) ? ok(nome) : erro('sw.js: ' + nome)));

  // skipWaiting automatico na instalacao servia ativo novo para pagina velha
  const instalacao = (sw.match(/addEventListener\('install'[\s\S]*?\n\}\);/) || [''])[0];
  /skipWaiting\(\)/.test(instalacao.replace(/\/\*[\s\S]*?\*\//g, ''))
    ? erro('sw.js: skipWaiting() automatico voltou a instalacao (duas versoes vivas ao mesmo tempo)')
    : ok('a instalacao nao assume por baixo da pagina (sem skipWaiting automatico)');

  // o carimbo do sw.js tem de bater com o do index.html publicado
  const vSw = (sw.match(/const VERSAO = '([^']+)';/) || [])[1];
  const vPag = (html.match(/<meta name="diario-versao" content="([^"]+)">/) || [])[1];
  vSw && vSw === vPag ? ok(`index.html e sw.js na mesma versao (${vSw})`)
    : erro(`carimbos divergentes: index.html "${vPag}" x sw.js "${vSw}" — rode node build.mjs`);
}

if (process.argv.includes('--rapido')) {
  console.log(falhas ? `\nFALHOU: ${falhas} problema(s).` : '\nOK (modo rapido).');
  process.exit(falhas ? 1 : 0);
}

// ── 5 e 6. app real no Chromium ────────────────────────────────────────────
let chromium;
for (const alvo of ['playwright', '/opt/node22/lib/node_modules/playwright/index.mjs']) {
  try { ({ chromium } = await import(alvo)); break; } catch { /* tenta o proximo */ }
}
if (!chromium) { console.log('\n5-6) PULADAS: Playwright nao encontrado (npm i -D playwright).'); process.exit(falhas ? 1 : 0); }

const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.webmanifest': 'application/manifest+json', '.json': 'application/json' };
/* Permite a um teste servir uma versao DIFERENTE de um arquivo sem tocar no
   repositorio — e o que torna possivel encenar uma publicacao nova e observar o
   worker novo esperar, em vez de assumir por baixo da pagina. */
const substitutos = new Map();
/* A API falsa do Supabase mora NO MESMO servidor, e isso e proposital: a CSP da
   pagina so libera `connect-src 'self'` para o proprio endereco, entao servir a
   API de outra porta seria bloqueado pelo navegador antes de sair. Mesma origem,
   nenhuma excecao aberta na CSP, nenhuma mudanca no app. */
const api = montarApiFalsa();
const servidor = createServer((req, res) => {
  if (/^\/(rest|auth)\/v1\//.test((req.url || '').split('?')[0])) {
    let corpo = '';
    req.on('data', (c) => { corpo += c; });
    req.on('end', () => { api.tratar(req, res, corpo); });
    return;
  }
  const nome = (req.url || '/').split('?')[0] === '/' ? '/index.html' : (req.url || '').split('?')[0];
  if (substitutos.has(nome)) {
    res.writeHead(200, { 'Content-Type': TIPOS[extname(nome)] || 'application/octet-stream' });
    res.end(substitutos.get(nome));
    return;
  }
  try {
    const corpo = readFileSync(join(RAIZ, decodeURIComponent(nome).replace(/^\/+/, '')));
    res.writeHead(200, { 'Content-Type': TIPOS[extname(nome)] || 'application/octet-stream' });
    res.end(corpo);
  } catch { res.writeHead(404).end('nao encontrado'); }
});
await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${servidor.address().port}/index.html`;

console.log('\n5) o app carrega sem erro de console');
/* O pacote Playwright e o navegador são instalados separadamente. Em máquinas
   Windows que já têm Chrome/Edge, não faz sentido baixar outra cópia de ~200 MB
   só para a verificação local. A CI continua usando o Chromium do Playwright;
   localmente aceitamos um caminho explícito ou o navegador do sistema. */
const navegadorLocal = [
  process.env.PLAYWRIGHT_EXECUTABLE_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].find((p) => p && existsSync(p));
let nav;
try {
  nav = await chromium.launch();
} catch (e) {
  if (!navegadorLocal || !/Executable doesn't exist|browserType\.launch/.test(String(e && e.message))) throw e;
  console.log(`  • Chromium do Playwright ausente; usando ${navegadorLocal}`);
  nav = await chromium.launch({ executablePath: navegadorLocal });
}
const pag = await nav.newPage({ viewport: { width: 1280, height: 900 } });
const ruido = [];
pag.on('pageerror', (e) => ruido.push('excecao: ' + e.message));
// erros de rede sao esperados num ambiente sem acesso aos CDNs; nao contam.
pag.on('console', (m) => { if (m.type() === 'error' && !/net::|ERR_/.test(m.text())) ruido.push('console: ' + m.text().slice(0, 160)); });
try {
  await pag.goto(base, { waitUntil: 'domcontentloaded' });
  await pag.waitForFunction(() => window.AutoTeste && window.switchScreen, { timeout: 30000 });
  ruido.length ? erro('erros no carregamento:\n    ' + ruido.slice(0, 8).join('\n    ')) : ok('carregou limpo');
} catch (e) { erro('o app nao inicializou: ' + e.message); }

console.log('\n6) telas + suite interna');
try {
  await pag.evaluate(() => { try { ProfileUI.hideGate(); } catch (e) {} });
  const telas = await pag.evaluate(() => [...new Set([...document.querySelectorAll('[data-screen]')].map((b) => b.dataset.screen))]);
  for (const t of telas) { await pag.evaluate((n) => switchScreen(n), t); await pag.waitForTimeout(220); }
  ruido.length ? erro('erros ao navegar:\n    ' + ruido.slice(0, 8).join('\n    ')) : ok(`${telas.length} telas navegadas sem erro`);
  const r = await pag.evaluate(() => { const x = AutoTeste.rodar(false); return { t: x.total, p: x.passou, f: x.falhou, falhas: x.falhas.slice(0, 6) }; });
  r.f === 0 ? ok(`AutoTeste ${r.p}/${r.t}`) : erro(`AutoTeste ${r.p}/${r.t} — ${JSON.stringify(r.falhas)}`);
  // o botao de opcoes da Grade nao pode voltar a vazar do cabecalho
  await pag.evaluate(() => switchScreen('grade')); await pag.waitForTimeout(400);
  const vaza = await pag.evaluate(() => {
    const b = document.getElementById('grade-gear-btn'); if (!b) return -1;
    const h = b.closest('.card-header');
    return Math.round(Math.max(0, b.getBoundingClientRect().bottom - h.getBoundingClientRect().bottom));
  });
  vaza === 0 ? ok('botao "Opcoes" da Grade contido no cabecalho') : erro(`botao "Opcoes" vaza ${vaza}px do cabecalho`);
  /* E o menu, uma vez aberto, tem de ficar INTEIRO por cima da tabela. O
     cabecalho fixo da grade e promovido a camada composta pelo navegador e ja
     atravessou o painel aberto uma vez — z-index no menu nao resolvia. */
  await pag.click('#grade-gear-btn');
  await pag.waitForTimeout(400);
  const furos = await pag.evaluate(() => {
    const m = document.getElementById('grade-gear-menu'); if (!m) return -1;
    const q = m.getBoundingClientRect();
    if (q.width < 10 || q.height < 10) return -1;
    let n = 0;
    for (let y = q.top + 6; y < q.bottom - 4; y += 6) {
      for (const x of [q.left + 20, q.left + q.width / 2, q.right - 20]) {
        const el = document.elementFromPoint(x, y);
        if (!(el === m || m.contains(el))) n++;
      }
    }
    return n;
  });
  furos === 0 ? ok('menu "Opcoes" aberto sem nada por cima')
    : erro(furos < 0 ? 'menu "Opcoes" nao abriu' : `menu "Opcoes" coberto em ${furos} ponto(s) — a tabela volta a atravessar o painel`);
  // o rotulo do seletor de visao nao pode voltar a quebrar em duas linhas
  const alturaSeletor = await pag.evaluate(() => {
    const t = document.querySelector('#grade-gear-menu .grade-view-toggle');
    return t ? Math.round(t.getBoundingClientRect().height) : -1;
  });
  alturaSeletor > 0 && alturaSeletor <= 38 ? ok(`seletor Semanal/Meta diaria em uma linha (${alturaSeletor}px)`)
    : erro(`seletor de visao com ${alturaSeletor}px — o rotulo quebrou em duas linhas`);
  await pag.evaluate(() => { const b = document.getElementById('grade-gear-btn'); if (b) b.click(); });

  /* Painéis de filtro recolhíveis: têm de nascer RECOLHIDOS e com o resumo do
     que está valendo à mostra. Sem o resumo, recolher esconde informação em vez
     de esconder ruído. */
  for (const [tela, corpo, botao, resumo] of [
    ['desempenhotec', 'tec-scope-body', 'tec-scope-collapse', 'tec-scope-resumo'],
  ]) {
    await pag.evaluate((t) => switchScreen(t), tela);
    await pag.waitForTimeout(250);
    const r = await pag.evaluate(([c, b]) => {
      const corpoEl = document.getElementById(c), botaoEl = document.getElementById(b);
      if (!corpoEl || !botaoEl) return { faltando: true };
      const antes = corpoEl.hidden;
      botaoEl.click();
      const depois = corpoEl.hidden;
      botaoEl.click();                       // devolve ao estado inicial
      return { recolhidoDeInicio: antes, alterna: antes !== depois };
    }, [corpo, botao]);
    r.faltando ? erro(`painel recolhivel ausente: #${corpo}`)
      : (r.recolhidoDeInicio && r.alterna) ? ok(`painel #${corpo} nasce recolhido e alterna`)
      : erro(`painel #${corpo}: recolhidoDeInicio=${r.recolhidoDeInicio} alterna=${r.alterna}`);
  }

  /* A lista suspensa de período do gráfico de tempo substituiu seis botões que
     ficavam abertos o tempo todo. Se os chips voltarem, é regressão. */
  await pag.evaluate(() => switchScreen('evolucao'));
  await pag.waitForTimeout(300);
  const per = await pag.evaluate(() => {
    const sel = document.getElementById('evo-tempo-periodo-sel');
    const faixa = document.getElementById('evo-tempo-range');
    return { temSelect: !!sel, opcoes: sel ? sel.options.length : 0,
      faixaOculta: faixa ? faixa.hidden : null,
      chipsAntigos: document.querySelectorAll('#evo-tempo-periodo .evo-chip').length };
  });
  (per.temSelect && per.opcoes >= 7 && per.faixaOculta && per.chipsAntigos === 0)
    ? ok('periodo do grafico de tempo e lista suspensa, com intervalo recolhido')
    : erro('periodo do grafico de tempo: ' + JSON.stringify(per));

  /* As caixas de acertos/total do Estudo Novo: sem setinha de incremento (que
     roubava largura e mudava o valor num giro de roda) e largas o bastante para
     mostrar TRES digitos ate na tela mais estreita. */
  await pag.setViewportSize({ width: 360, height: 780 });
  await pag.evaluate(() => {
    DB.addSubject({ nome: 'Materia de teste', color: '#4f46e5' });
    DB.addTrackLesson('Materia de teste', 'Aula de teste');
    EstudoNovoScreen.currentSubject = 'Materia de teste';
    switchScreen('estudonovo');
    EstudoNovoScreen.render();
  });
  await pag.waitForTimeout(350);
  const caixa = await pag.evaluate(() => {
    const els = [...document.querySelectorAll('.ts-num')];
    if (!els.length) return { faltando: true };
    const el = els[0];
    const cs = getComputedStyle(el);
    // largura que 3 digitos ocupam de fato, medida com a mesma fonte da caixa
    const cv = document.createElement('canvas').getContext('2d');
    cv.font = cs.fontWeight + ' ' + cs.fontSize + ' ' + cs.fontFamily;
    const tresDigitos = cv.measureText('100').width;
    const util = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    return { tipos: [...new Set(els.map((e) => e.type))], util: Math.round(util * 10) / 10,
      precisa: Math.round(tresDigitos * 10) / 10, largura: Math.round(el.getBoundingClientRect().width) };
  });
  await pag.evaluate(() => { DB.saveTrack('Materia de teste', []); DB.saveSubjects(DB.getSubjects().filter((s) => s.nome !== 'Materia de teste')); });
  await pag.setViewportSize({ width: 1280, height: 900 });
  if (caixa.faltando) erro('nenhuma caixa .ts-num renderizada no Estudo Novo');
  else if (caixa.tipos.includes('number')) erro('as caixas de acertos voltaram a ser type="number" (setinha de incremento)');
  else if (caixa.util < caixa.precisa) erro(`caixa de acertos com ${caixa.util}px uteis a 360px — "100" precisa de ${caixa.precisa}px`);
  else ok(`caixa de acertos sem setinha e com 3 digitos a 360px (${caixa.largura}px, ${caixa.util} >= ${caixa.precisa})`);

  /* ── LEIS SECAS: leitor utilizavel de ponta a ponta ─────────────────────
     Tres regressoes que andaram juntas e so aparecem no aparelho:
       • .law-block ganhou content-visibility:auto, e a contencao de PINTURA
         recortou a numeracao da linha (absoluta, fora da caixa). O botao
         "Linhas" ligava a classe e nada aparecia;
       • sem numero para clicar, o marcador "Onde parei" nunca podia nascer —
         o botao so sabia ir ate um marcador que era impossivel criar;
       • no modo foco a navegacao inteira some, e o "Sair" saia da faixa
         rolavel: sem Esc no toque, a tela ficava sem saida.
     Medido no viewport de celular, que e onde o usuario viu o problema. */
  await pag.setViewportSize({ width: 412, height: 900 });
  const leis = await pag.evaluate(() => {
    switchScreen('leis');
    const texto = Array.from({ length: 60 }, (_, i) =>
      'Art. ' + (i + 1) + 'o O contribuinte devera, salvo disposicao em contrario, observar o prazo de 30 dias.').join('\n\n');
    const lei = DB.addLei({ titulo: 'LEI DE TESTE', referencia: '', materia: '', texto });
    LeisScreen.openReader(lei.id);
    if (!LeisScreen.showLines) LeisScreen.toggleLines();
    const corpo = document.getElementById('lei-reader-body');
    const num = corpo.querySelector('.law-lnum');
    const r = num.getBoundingClientRect();
    const sob = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2));
    const out = { numeroVisivel: r.width > 0 && r.height > 0,
      numeroClicavel: !!(sob && sob.classList.contains('law-lnum')) };
    // "Onde parei" sem marcador tem de CRIAR o marcador (e nao so reclamar)
    document.getElementById('lei-goto-mark-btn').click();
    out.marcadorCriado = DB.getLei(lei.id).bookmark != null;
    out.pinNoTexto = corpo.querySelectorAll('.law-bookmarked .law-pin').length;
    // e, com marcador, tem de ir ate ele sem apaga-lo
    document.getElementById('lei-goto-mark-btn').click();
    out.marcadorSobreviveu = DB.getLei(lei.id).bookmark != null;
    // MODO FOCO. Ali a numeracao caia em x negativo (o recuo do modo foco e de
    // 4px) e o cartao, com overflow:hidden, a comia; e os CINCO botoes com
    // rotulo nao cabiam na faixa, entao tres ficavam fora da area visivel num
    // rolamento horizontal sem barra e sem pista nenhuma de que existiam.
    LeisScreen.entrarFoco();
    const barra = document.getElementById('lei-foco-bar').getBoundingClientRect();
    const dentro = (el) => {
      const q = el.getBoundingClientRect();
      const em = document.elementFromPoint(Math.round(q.left + q.width / 2), Math.round(q.top + q.height / 2));
      return q.right <= barra.right + 1 && q.left >= barra.left - 1 && !!(em && em.closest && em.closest('#' + el.id));
    };
    out.saidaVisivel = dentro(document.getElementById('lei-foco-sair'));
    out.botoesDoFocoVisiveis = ['lei-foco-mark', 'lei-foco-erase', 'lei-foco-lines', 'lei-foco-marcar']
      .every((bid) => dentro(document.getElementById(bid)));
    const numF = corpo.querySelector('.law-lnum').getBoundingClientRect();
    const cartao = document.querySelector('.leis-reader-card').getBoundingClientRect();
    out.numeroVisivelNoFoco = numF.width > 0 && numF.left >= cartao.left - 1;
    LeisScreen.sairFoco();
    /* ⚙️ EXIBICAO: o pedido era poder ocultar o que nao se usa. Cada opcao tem
       de apagar MESMO a faixa correspondente — e devolve-la ao ser religada. */
    const faixa = { 'p-chips': '#lei-reader-meta', 'p-cores': '#lei-hl-chips',
      'p-dica': '.leis-mark-hint', 'p-painel': '#lei-marks-panel' };
    LeisScreen.applyMark('contribuinte', 1, 3);   // garante o painel de destaques na tela
    out.exibicaoDesliga = Object.keys(faixa).every((k) => {
      const el = document.querySelector(faixa[k]);
      if (!el) return false;
      LeisScreen.prefSetOn(k, false); LeisScreen.aplicarPrefs();
      const sumiu = getComputedStyle(el).display === 'none';
      LeisScreen.prefSetOn(k, true); LeisScreen.aplicarPrefs();
      return sumiu && getComputedStyle(el).display !== 'none';
    });
    // o botao "🔢 Linhas" e a caixa "Numeracao das linhas" sao UM estado so
    LeisScreen.toggleLines();
    out.linhasUmEstadoSo = LeisScreen.prefOn('p-linhas') === LeisScreen.showLines;
    LeisScreen.toggleLines();
    /* O painel de exibicao pertence a tela de Leis, nao a Configuracoes: ele
       abre do "⚙️ Ajustes" da LISTA (ao lado de "＋ Nova lei") e do "⚙️
       Exibicao" do leitor. Duas portas, um painel — e nenhuma copia perdida em
       Configuracoes, que era onde o ajuste ficava longe do que ele muda. */
    LeisScreen.closePrefs();
    LeisScreen.showList();                     // vai para a LISTA de leis
    const btnAj = document.getElementById('lei-ajustes-btn');
    out.ajustesNaLista = !!(btnAj && btnAj.offsetParent);
    if (btnAj) btnAj.click();
    const painel = document.getElementById('lei-prefs-modal');
    out.ajustesAbrePainel = !!(painel && getComputedStyle(painel).display !== 'none');
    const cxDe = (raiz, k) => document.querySelector(raiz + ' input[data-pref="' + k + '"]');
    const noPainel = cxDe('#lei-prefs-modal', 'p-justificado');
    if (!noPainel) { out.painelGravaPreferencia = false; }
    else {
      const antes = LeisScreen.prefOn('p-justificado');
      noPainel.checked = !antes; noPainel.dispatchEvent(new Event('change', { bubbles: true }));
      out.painelGravaPreferencia = LeisScreen.prefOn('p-justificado') === !antes;
      const volta = cxDe('#lei-prefs-modal', 'p-justificado');
      volta.checked = antes; volta.dispatchEvent(new Event('change', { bubbles: true }));
      out.painelGravaPreferencia = out.painelGravaPreferencia
        && LeisScreen.prefOn('p-justificado') === antes;
    }
    LeisScreen.closePrefs();
    // e nao sobrou nenhuma copia orfa em Configuracoes
    switchScreen('config');
    out.semCopiaEmConfig = !document.getElementById('cfg-leis-card');
    switchScreen('leis');
    // trocar de aba nao pode deixar body.leis-foco no ar (app sem navegacao)
    switchScreen('ciclo');
    out.focoLimpoAoTrocarDeAba = !document.body.classList.contains('leis-foco');
    switchScreen('leis');
    DB.deleteLei(lei.id);
    return out;
  });
  await pag.setViewportSize({ width: 1280, height: 900 });
  const leisFalhas = Object.keys(leis).filter((k) => !leis[k] && k !== 'pinNoTexto');
  if (leis.pinNoTexto !== 1) leisFalhas.push('pinNoTexto=' + leis.pinNoTexto);
  leisFalhas.length ? erro('leitor de Leis Secas: ' + leisFalhas.join(', '))
    : ok('Leis Secas: numeracao e "Onde parei" funcionais, modo foco completo, exibicao ajustavel pelo ⚙️ Ajustes da propria tela');
} catch (e) { erro('falha na navegacao: ' + e.message); }

/* ── 7. contraste WCAG AA nos DOIS temas ───────────────────────────────────
   O tema escuro nao e uma variacao cosmetica: ele inverte tokens, e um par que
   passa no claro pode reprovar no escuro sem ninguem notar. Foi assim que o
   aviso (toast) ficou branco sobre fundo claro — 1,21:1, ilegivel — e que o
   botao primario do app inteiro ficou em 3,62:1.

   Emoji sao ignorados de proposito: a cor renderizada deles nao vem de `color`,
   entao medi-los so gera alarme falso. */
/* ── 6.5 NADA FICA INVISÍVEL NO ARMAZENAMENTO ANTIGO ────────────────────────
   O app guarda tudo no IndexedDB por tras de uma fachada chamada `localStorage`.
   Dado escrito por versoes anteriores mora no localStorage NATIVO — e a adocao
   dele so rodava quando o IndexedDB estava COMPLETAMENTE vazio. Bastava o tema
   existir la para o resto nunca mais ser lido: os dados continuavam no
   navegador, integros, sem nenhuma porta. Este teste prova que a adocao e uma
   FUSAO e acontece mesmo com o IndexedDB ja povoado. */
console.log('\n6.5) dados do armazenamento antigo nao ficam invisiveis');
try {
  const ctx = await nav.newContext();
  const p2 = await ctx.newPage();
  await p2.addInitScript(() => {
    try {
      window.localStorage.setItem('diario-estudos:theme', 'light');   // IndexedDB nasce NAO-vazio
      window.localStorage.setItem('diario-estudos:u:antigo:p:pl1:entries', JSON.stringify([{ id: 'e1', subject: 'X', date: '2026-01-01', durationMin: 60 }]));
    } catch (e) { /* sem storage: o teste abaixo acusa */ }
  });
  await p2.goto(base, { waitUntil: 'domcontentloaded' });
  await p2.waitForFunction(() => window.AutoTeste && window.switchScreen, { timeout: 30000 });
  await p2.waitForTimeout(500);
  const r = await p2.evaluate(() => ({
    adotado: (JSON.parse(localStorage.getItem('diario-estudos:u:antigo:p:pl1:entries') || '[]')).length,
    sobrouNoNativo: window.Recuperacao ? Recuperacao.varrerAntigo().length : -1
  }));
  r.adotado === 1 && r.sobrouNoNativo === 0
    ? ok('armazenamento antigo adotado mesmo com o IndexedDB povoado')
    : erro(`dado do armazenamento antigo ficou invisivel (adotado=${r.adotado}, sobrou=${r.sobrouNoNativo})`);
  await ctx.close();
} catch (e) { erro('teste do armazenamento antigo falhou: ' + e.message); }

/* ── 6.6) o service worker, exercitado de verdade ───────────────────────────
   Ate aqui o sw.js so era LIDO. Mas ele e o unico arquivo cujo defeito nao
   aparece como erro: aparece como versao velha servida em silencio, dias
   depois. Aqui ele instala num navegador real, guarda a casca, responde quem
   e, e a pagina e aberta OFFLINE para provar que o que ficou guardado abre. */
console.log('\n6.6) o service worker instala, guarda a casca e abre offline');
try {
  const ctx = await nav.newContext();
  const p3 = await ctx.newPage();
  await p3.goto(base, { waitUntil: 'domcontentloaded' });
  const reg = await p3.evaluate(async () => {
    const r = await navigator.serviceWorker.register('sw.js', { scope: './', updateViaCache: 'none' });
    await navigator.serviceWorker.ready;
    return { escopo: r.scope, ativo: !!r.active };
  });
  reg.ativo ? ok('instalou e ativou') : erro('o service worker nao ativou');

  // a casca foi guardada sob a CHAVE CANONICA (e nao sob cada variacao de URL)
  const baldes = await p3.evaluate(async () => {
    const nomes = await caches.keys();
    const out = {};
    for (const n of nomes) out[n] = (await (await caches.open(n)).keys()).map((r) => r.url);
    return out;
  });
  const nomesApp = Object.keys(baldes).filter((n) => n.endsWith('-app'));
  const urlsApp = nomesApp.flatMap((n) => baldes[n]);
  nomesApp.length === 1 ? ok(`um unico balde de versao (${nomesApp[0]})`)
    : erro('baldes de versao inesperados: ' + nomesApp.join(', '));
  urlsApp.some((u) => u.endsWith('/index.html'))
    ? ok('a casca do app esta guardada na chave canonica')
    : erro('a casca do app nao foi pre-carregada: ' + JSON.stringify(urlsApp));

  // o worker sabe dizer qual versao esta servindo (e o que o Diagnostico usa)
  const vSwVivo = await p3.evaluate(() => new Promise((resolve) => {
    const c = new MessageChannel();
    c.port1.onmessage = (e) => resolve(e.data);
    setTimeout(() => resolve(null), 3000);
    navigator.serviceWorker.controller.postMessage('versao', [c.port2]);
  }));
  const vEsperada = (readFileSync(join(RAIZ, 'sw.js'), 'utf8').match(/const VERSAO = '([^']+)';/) || [])[1];
  vSwVivo && vSwVivo.versao === vEsperada
    ? ok(`o worker responde a propria versao (${vSwVivo.versao})`)
    : erro('o worker nao respondeu a versao: ' + JSON.stringify(vSwVivo));

  // OFFLINE: o servidor continua de pe, mas o navegador e cortado da rede
  await ctx.setOffline(true);
  const p4 = await ctx.newPage();
  const semRede = [];
  p4.on('pageerror', (e) => semRede.push(e.message));
  await p4.goto(base, { waitUntil: 'domcontentloaded' });
  const abriu = await p4.evaluate(() => ({
    titulo: document.title,
    temApp: !!document.getElementById('app-code'),
    versao: (document.querySelector('meta[name="diario-versao"]') || {}).content || null
  }));
  await ctx.setOffline(false);
  abriu.temApp && abriu.versao === vEsperada
    ? ok(`offline abriu a casca certa (${abriu.versao})`)
    : erro('offline nao abriu a casca guardada: ' + JSON.stringify(abriu));

  // e a navegacao offline por um endereco DIFERENTE tambem acha a casca
  const p5 = await ctx.newPage();
  await ctx.setOffline(true);
  await p5.goto(base + '?origem=teste', { waitUntil: 'domcontentloaded' });
  const comQuery = await p5.evaluate(() => !!document.getElementById('app-code'));
  await ctx.setOffline(false);
  comQuery ? ok('offline com query string tambem abre (chave canonica funciona)')
    : erro('offline com query string caiu na pagina de erro');
  await p4.close(); await p5.close();   // clientes soltos atrapalham a encenacao abaixo

  /* ── A NAVEGACAO NAO ESPERA A REDE ──────────────────────────────────────
     Rede primeiro custava ate TIMEOUT_REDE de tela branca em toda abertura, e
     o index.html tem alguns megabytes: em rede movel a corrida era perdida
     sempre. Aqui o servidor passa a responder uma casca IMPOSTORA. Se a
     navegacao ainda tocasse a rede, ela apareceria na tela. Como a casca sai do
     balde desta versao, a impostora e ignorada — e a deteccao de versao nova
     continua funcionando pelo sw.js, provado na encenacao seguinte. */
  substitutos.set('/index.html',
    '<!doctype html><meta charset="utf-8"><title>impostora</title><div id="casca-impostora">rede</div>');
  try {
    const p6 = await ctx.newPage();
    const inicio = Date.now();
    await p6.goto(base, { waitUntil: 'domcontentloaded' });
    const gasto = Date.now() - inicio;
    const doCache = await p6.evaluate(() => ({
      temApp: !!document.getElementById('app-code'),
      impostora: !!document.getElementById('casca-impostora')
    }));
    doCache.temApp && !doCache.impostora
      ? ok(`a navegacao sai do cache da versao ativa (${gasto}ms, sem esperar a rede)`)
      : erro('a navegacao foi buscar na rede: ' + JSON.stringify(doCache));
    const semErro = [];
    // mesmo filtro do resto do arquivo: recurso externo indisponivel no
    // ambiente de teste (fontes, CDN) nao e defeito do worker
    p6.on('console', (m) => {
      if (m.type() === 'error' && !/net::|ERR_/.test(m.text())) semErro.push(m.text());
    });
    await p6.reload({ waitUntil: 'domcontentloaded' });
    semErro.length === 0 ? ok('navegacao do cache sem reclamacao no console')
      : erro('console reclamou na navegacao: ' + semErro.join(' | '));
    await p6.close();
  } finally {
    substitutos.delete('/index.html');
  }

  /* ── A TROCA DE VERSAO, ENCENADA ────────────────────────────────────────
     Publicamos um sw.js com outro carimbo e observamos as tres regras que
     custaram caro: o worker novo ESPERA (nao assume por baixo da pagina), o
     balde da versao velha e descartado na ativacao, e o balde IMUTAVEL de CDN
     sobrevive a publicacao. */
  const swAtual = readFileSync(join(RAIZ, 'sw.js'), 'utf8');
  const vNova = 'v0000000001';
  substitutos.set('/sw.js', swAtual.replace(/const VERSAO = '[^']+';/, `const VERSAO = '${vNova}';`));
  try {
    // marca o balde imutavel com uma entrada nossa, para conferir que ela fica
    await p3.evaluate(async () => {
      const c = await caches.open('cdn-imutavel-v1');
      await c.put('https://cdn.exemplo/teste.js', new Response('/* marca */'));
    });
    const esperando = await p3.evaluate(async () => {
      const r = await navigator.serviceWorker.getRegistration();
      await r.update();
      for (let i = 0; i < 60 && !r.waiting; i++) await new Promise((x) => setTimeout(x, 100));
      return { temEsperando: !!r.waiting, controladorTrocou: false };
    });
    esperando.temEsperando ? ok('a versao nova instala e ESPERA (nao assume sozinha)')
      : erro('a versao nova nao ficou em espera');

    const antesDaTroca = await p3.evaluate(() => new Promise((resolve) => {
      const c = new MessageChannel();
      c.port1.onmessage = (e) => resolve(e.data && e.data.versao);
      setTimeout(() => resolve(null), 3000);
      navigator.serviceWorker.controller.postMessage('versao', [c.port2]);
    }));
    antesDaTroca === vEsperada ? ok('quem serve a pagina continua sendo a versao antiga')
      : erro(`a versao nova assumiu sem ordem: quem serve e "${antesDaTroca}"`);

    /* Agora a ordem de trocar, exatamente como o botao "Atualizar agora" faz:
       INSISTINDO. Um pedido so nao basta quando o worker antigo ainda tem
       requisicao em aberto — foi medindo isto que o valor de 4s da primeira
       versao se mostrou curto demais (a troca levou 24s numa rede ruim). */
    const depois = await p3.evaluate(async (vAlvo) => {
      const r = await navigator.serviceWorker.getRegistration();
      const trocou = new Promise((res) => navigator.serviceWorker.addEventListener('controllerchange', () => res(true), { once: true }));
      const bater = setInterval(() => { try { if (r.waiting) r.waiting.postMessage('skipWaiting'); } catch (_) {} }, 600);
      r.waiting.postMessage('skipWaiting');
      await Promise.race([trocou, new Promise((res) => setTimeout(() => res(false), 40000))]);
      clearInterval(bater);
      for (let i = 0; i < 60; i++) {
        const nomes = await caches.keys();
        if (nomes.includes(vAlvo + '-app') && !nomes.some((n) => n.endsWith('-app') && n !== vAlvo + '-app')) break;
        await new Promise((x) => setTimeout(x, 200));
      }
      return await caches.keys();
    }, vNova);
    depois.includes(vNova + '-app') && !depois.some((n) => n.endsWith('-app') && n !== vNova + '-app')
      ? ok('a troca descarta o balde da versao anterior')
      : erro('baldes apos a troca: ' + JSON.stringify(depois));
    depois.includes('cdn-imutavel-v1')
      ? ok('o balde imutavel de CDN sobrevive a publicacao')
      : erro('o balde imutavel de CDN foi descartado na publicacao');
  } finally {
    substitutos.delete('/sw.js');
  }

  await ctx.close();
} catch (e) { erro('teste do service worker falhou: ' + e.message); }

/* ── 6.7) o caminho da nuvem, de ponta a ponta ──────────────────────────────
   Ate aqui, tudo que toca o Supabase era verificado por LEITURA e por testes
   com dubles. Aqui o app conversa com um PostgREST de mentira que aplica as
   regras de verdade (trava otimista por `rev`, indice unico parcial da ancora,
   unicidade de secao, isolamento por dono) — e o CLIENTE nao e falso: o
   supabase-js do npm bate byte a byte com o do CDN (mesmo hash de integridade),
   entao a biblioteca que roda aqui e a mesma que roda em producao. */
console.log('\n6.7) o caminho da nuvem, de ponta a ponta, contra um banco com as regras de verdade');
try {
  let libSupabase = null;
  try { libSupabase = readFileSync(join(RAIZ, 'node_modules/@supabase/supabase-js/dist/umd/supabase.js'), 'utf8'); }
  catch { console.log('  PULADA: supabase-js nao instalado (npm ci).'); }
  if (libSupabase) {
  /* O pacote do npm tem de ser O MESMO BUILD que o index.html fixa por hash de
     integridade. Se divergir, o navegador recusaria o script e o teste falharia
     por um motivo que nao tem nada a ver com o que ele quer provar — e, pior, o
     que rodaria aqui nao seria a biblioteca de producao. */
  {
    const esperado = (html.match(/supabase-js@[^"]*"\s+integrity="sha256-([^"]+)"/) || [])[1];
    const real = createHash('sha256').update(libSupabase).digest('base64');
    esperado === real
      ? ok('o supabase-js instalado e o MESMO build que a pagina fixa por integridade')
      : erro(`o supabase-js instalado nao bate com o hash fixado na pagina (${real} x ${esperado})`);
  }
  // service worker fora deste teste: aqui o assunto e a nuvem, nao o cache
  const ctx = await nav.newContext({ serviceWorkers: 'block' });
  await ctx.route('https://cdn.jsdelivr.net/**', (rota) => rota.fulfill({
    status: 200, contentType: 'text/javascript; charset=utf-8',
    headers: { 'access-control-allow-origin': '*' }, body: libSupabase
  }));
  await ctx.route('https://fonts.googleapis.com/**', (rota) => rota.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  const pg = await ctx.newPage();
  const erros = [];
  pg.on('pageerror', (e) => erros.push(e.message));
  await pg.goto(base, { waitUntil: 'domcontentloaded' });
  await pg.waitForFunction(() => window.CloudStore && window.ProfileManager && window.SectionSync, { timeout: 30000 });

  // aponta o cliente para a API local (mesma origem: a CSP so libera 'self')
  const iniciou = await pg.evaluate((origem) => {
    CloudStore.SUPABASE_URL = origem;
    CloudStore.SUPABASE_KEY = 'chave-publicavel-de-teste';
    CloudStore.init();
    return CloudStore.libStatus;
  }, new URL(base).origin);
  iniciou === 'ready' ? ok('a biblioteca real do Supabase carregou e o cliente subiu')
    : erro('o cliente do Supabase nao iniciou: ' + iniciou);

  // ── 1. conta, perfil e a primeira linha no banco ────────────────────────
  const criacao = await pg.evaluate(async () => {
    await CloudStore.signUp('estudante@teste.local', 'senha-de-teste-123');
    await new Promise((r) => setTimeout(r, 300));            // deixa o onAuth correr
    const row = await CloudStore.createRow({ name: 'Perfil de teste', avatar: '📘', color: '#4f46e5', payload: {} });
    ProfileManager.addMirror({ id: row.id, nome: 'Perfil de teste', avatar: '📘', cor: '#4f46e5' });
    ProfileManager.setRev(row.id, row.rev || 1);
    ProfileManager.setActiveProfile(row.id);
    PlanManager.init();
    /* O mesmo carimbo que o portao de acesso grava ao ENTRAR num perfil. Varias
       rotas de envio o exigem, de proposito: sem ele, o app estaria na tela de
       selecao de perfil e nao teria o que sincronizar. */
    sessionStorage.setItem('diario-estudos:entered', row.id);
    return { id: row.id, rev: row.rev, logado: CloudStore.isLoggedIn(), uid: CloudStore.session.user.id };
  });
  criacao.logado && criacao.id ? ok(`entrou na conta e criou o perfil (${criacao.id.slice(0, 8)}…)`)
    : erro('nao deu para criar conta/perfil: ' + JSON.stringify(criacao));
  const perfilNoBanco = api.estado.tabelas.study_profiles.find((p) => p.id === criacao.id);
  perfilNoBanco && perfilNoBanco.user_id === criacao.uid
    ? ok('a linha do perfil existe no banco, com o dono certo')
    : erro('a linha do perfil nao chegou ao banco com o dono certo');

  // ── 2. um registro de estudo sobe COMO SECAO ────────────────────────────
  const envio = await pg.evaluate(async () => {
    DB.saveEntry({ id: 'e-teste-1', subject: 'Direito Constitucional', method: 'Questões', date: '2026-03-01', durationMin: 90, correct: 8, total: 10 });
    SectionSync.seedOnce();
    await SectionSync.pushDirty();
    return { sujas: SectionSync._dirty.size, erro: SectionSync._lastError };
  });
  envio.sujas === 0 && !envio.erro ? ok('o registro saiu da fila sem erro')
    : erro('a fila nao esvaziou: ' + JSON.stringify(envio));
  const secoes = api.estado.tabelas.profile_sections.filter((l) => l.profile_id === criacao.id);
  const secaoEntries = secoes.find((l) => /entries$/.test(l.section));
  secaoEntries && /Direito Constitucional/.test(JSON.stringify(secaoEntries.data))
    ? ok(`o registro esta no banco, na secao "${secaoEntries.section}"`)
    : erro('o registro NAO chegou a tabela de secoes: ' + JSON.stringify(secoes.map((l) => l.section)));
  secoes.some((l) => l.section === '__manifest')
    ? ok('o manifesto de secoes foi publicado')
    : erro('o manifesto nao foi publicado (exclusoes nunca chegariam a nuvem)');

  // ── 3. o blob de seguranca tambem sobe ──────────────────────────────────
  const blob = await pg.evaluate(async () => {
    const r = await CloudStore.saveActive();
    return { rev: r && r.rev, conflito: !!(r && r.conflict), recusado: !!(r && r.recusado) };
  });
  const linhaPerfil = api.estado.tabelas.study_profiles.find((p) => p.id === criacao.id);
  !blob.conflito && !blob.recusado && linhaPerfil && JSON.stringify(linhaPerfil.payload).includes('Direito Constitucional')
    ? ok(`o blob de seguranca subiu (rev ${linhaPerfil.rev})`)
    : erro('o blob de seguranca nao subiu: ' + JSON.stringify(blob));


  // ── 4. CONFLITO DE REVISAO: a alteracao local nao pode ser descartada ────
  /* Outro aparelho subiu algo: a `rev` do banco anda sozinha. O envio daqui,
     filtrado por `rev=eq.<antiga>`, nao acerta linha nenhuma — e e assim que o
     conflito nasce. O que importa provar e o desfecho: a retentativa realinha
     a revisao e o dado DAQUI prevalece, em vez de sumir. */
  api.estado.tabelas.study_profiles.find((p) => p.id === criacao.id).rev = 99;
  const conflito = await pg.evaluate(async () => {
    DB.saveEntry({ id: 'e-teste-2', subject: 'Português', method: 'Teoria', date: '2026-03-02', durationMin: 45 });
    const direto = await CloudStore.saveActive();          // deve bater no conflito
    const comRetentativa = await CloudStore.saveActiveWithRetry();
    return { conflitou: !!(direto && direto.conflict), resolvido: !!(comRetentativa && comRetentativa.rev) };
  });
  conflito.conflitou ? ok('a trava otimista detecta o envio de outro aparelho (conflito)')
    : erro('o conflito de revisao NAO foi detectado — a trava otimista nao esta valendo');
  const depoisDoConflito = api.estado.tabelas.study_profiles.find((p) => p.id === criacao.id);
  conflito.resolvido && JSON.stringify(depoisDoConflito.payload).includes('Português')
    ? ok(`a retentativa resolveu e o dado local prevaleceu (rev ${depoisDoConflito.rev})`)
    : erro('o dado local se perdeu no conflito: ' + JSON.stringify(conflito));

  /* AS DUAS COPIAS TEM DE CONTAR A MESMA HISTORIA. `saveActive` grava so o
     blob; quem mantem as secoes em dia e o ciclo normal de sincronizacao. Se
     as duas divergissem, um aparelho NOVO — que le pelas secoes — abriria sem
     a alteracao mais recente, mesmo com ela salva no blob. */
  const drenou = await pg.evaluate(async () => {
    CloudStore._pending = true;
    await CloudStore.autoSave();         // o ciclo real: o blob dispara o envio das secoes
    // esperar a FILA ESVAZIAR, e nao so a chamada voltar: o envio das secoes
    // segue em andamento depois que o blob termina
    for (let i = 0; i < 100; i++) {
      if (!SectionSync._pushing && SectionSync._dirty.size === 0) return true;
      await new Promise((r) => setTimeout(r, 100));
    }
    return false;
  });
  drenou || erro('a fila de secoes nao esvaziou depois do ciclo de sincronizacao');
  const secaoDepois = api.estado.tabelas.profile_sections
    .find((l) => l.profile_id === criacao.id && /entries$/.test(l.section));
  const blobDepois = api.estado.tabelas.study_profiles.find((p) => p.id === criacao.id);
  const nasDuas = (t) => JSON.stringify(secaoDepois && secaoDepois.data).includes(t)
                      && JSON.stringify(blobDepois && blobDepois.payload).includes(t);
  nasDuas('Direito Constitucional') && nasDuas('Português')
    ? ok('depois do ciclo de sincronizacao, secoes e blob contam a mesma historia')
    : erro('secoes e blob divergiram apos o ciclo de sincronizacao');

  // ── 5. BACKUP NO BANCO: a primeira foto vira ancora ─────────────────────
  const bkp1 = await pg.evaluate(async () => {
    CloudBackup.enabled = true;
    const r = await CloudBackup.criar('teste de ponta a ponta', { forcar: true });
    return { ok: !!(r && r.ok), motivo: r && r.motivo, ancora: !!(r && r.ancora) };
  });
  const fotos = () => api.estado.tabelas.profile_backups.filter((l) => l.profile_id === criacao.id);
  bkp1.ok && fotos().length === 1 && fotos()[0].ancora === true
    ? ok('a primeira foto foi gravada no banco e virou ancora')
    : erro('backup no banco falhou: ' + JSON.stringify(bkp1) + ' — linhas: ' + fotos().length);

  // ── 6. ANCORA UNICA: a corrida perdida nao vira falha ───────────────────
  /* Duas fotos tentando ser ancora ao mesmo tempo: a segunda leva 23505 do
     indice unico parcial. O app tem de tratar isso como sucesso normal (grava
     como foto rolante), nunca como erro — e no fim tem de sobrar UMA ancora. */
  const bkp2 = await pg.evaluate(async () => {
    const antes = CloudBackup._temAncora;
    CloudBackup._temAncora = async () => false;            // finge que ainda nao ha ancora
    try { return await CloudBackup.criar('segunda foto disputando a ancora', { forcar: true }); }
    finally { CloudBackup._temAncora = antes; }
  });
  const ancoras = fotos().filter((l) => l.ancora === true).length;
  bkp2 && bkp2.ok && fotos().length === 2 && ancoras === 1
    ? ok('a disputa pela ancora e resolvida pelo banco: 2 fotos, exatamente 1 ancora')
    : erro(`disputa pela ancora deu errado: ${fotos().length} fotos, ${ancoras} ancora(s), r=${JSON.stringify(bkp2)}`);

  // ── 7. RESTAURAR: o dado volta do banco ─────────────────────────────────
  const idDaFoto = fotos()[0].id;
  const restauro = await pg.evaluate(async (rowId) => {
    DB._set(DB.KEYS.entries, []);                          // "perdi tudo neste aparelho"
    const antes = (DB.getEntries() || []).length;
    const r = await CloudBackup.restaurar(rowId);
    const depois = DB.getEntries() || [];
    return { antes, r, assuntos: depois.map((e) => e.subject).sort() };
  }, idDaFoto);
  restauro.antes === 0 && restauro.r && restauro.r.ok && restauro.assuntos.includes('Direito Constitucional')
    ? ok(`restaurar trouxe os registros de volta (${restauro.assuntos.length})`)
    : erro('a restauracao NAO trouxe os dados de volta: ' + JSON.stringify(restauro));

  // ── 8. RETENCAO: a faxina nunca apaga a ancora ──────────────────────────
  const faxina = await pg.evaluate(async () => {
    const linhas = await CloudBackup.listar();
    const alvo = CloudBackup.selecionarParaFaxina(linhas, Date.now());
    return { total: linhas.length, apagar: alvo.map((l) => l.id), ancoras: linhas.filter((l) => l.ancora).map((l) => l.id) };
  });
  faxina.ancoras.length === 1 && !faxina.apagar.includes(faxina.ancoras[0])
    ? ok('a faxina de retencao nunca escolhe a ancora')
    : erro('a faxina escolheu a ancora para apagar: ' + JSON.stringify(faxina));

  // ── 9. HIDRATACAO: apagar o local e reconstruir a partir das secoes ─────
  const hidratou = await pg.evaluate(async (pid) => {
    const pfx = 'diario-estudos:u:' + pid + ':';
    const apagar = [];
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith(pfx)) apagar.push(k); }
    apagar.forEach((k) => localStorage.removeItem(k));
    SectionSync._dirty.clear();
    const r = await SectionSync.hydrate(pid);
    return { ok: !!(r && r.ok), motivo: r && r.motivo, assuntos: (DB.getEntries() || []).map((e) => e.subject).sort() };
  }, criacao.id);
  hidratou.ok && hidratou.assuntos.includes('Direito Constitucional') && hidratou.assuntos.includes('Português')
    ? ok(`a leitura por secao reconstruiu o perfil do zero (${hidratou.assuntos.length} registros)`)
    : erro('a hidratacao por secao falhou: ' + JSON.stringify(hidratou));

  // ── 10. ISOLAMENTO: outra conta nao ve nada do perfil alheio ────────────
  const outra = await pg.evaluate(async () => {
    await CloudStore.signOut();
    await CloudStore.signUp('outra@teste.local', 'senha-de-teste-456');
    await new Promise((r) => setTimeout(r, 300));
    const lista = await CloudStore.listProfiles();
    return { perfis: lista.length, uid: CloudStore.session.user.id };
  });
  outra.perfis === 0 ? ok('a outra conta nao enxerga o perfil alheio (isolamento por dono)')
    : erro(`a outra conta viu ${outra.perfis} perfil(is) que nao sao dela`);
  const vazamento = await pg.evaluate(async (pid) => {
    try { await CloudStore.fetchPayload(pid); return 'baixou os dados alheios'; }
    catch (e) { return (e && e.code) || 'erro sem codigo'; }
  }, criacao.id);
  vazamento === 'perfil-inexistente'
    ? ok('baixar o perfil de outra conta e recusado pelo banco')
    : erro('o perfil de outra conta ficou acessivel: ' + vazamento);

  // ── 11. TOKEN "EMITIDO NO FUTURO": a falha intermitente do portao ───────
  /* O PostgREST compara o `iat` do token com o relogio DELE, e recusa um token
     que diz ter nascido depois de agora. Entre o servidor que carimba o `iat` e
     o no que valida ha uma deriva de um ou dois segundos — invisivel, menos no
     instante em que o app usa um token recem emitido, que e exatamente o que o
     portao de acesso faz. Era esse 401 que aparecia no lugar dos perfis.
     A cura e ESPERAR, nao renovar: um token novo nasceria com `iat` ainda mais
     adiante e seria recusado de novo. As duas metades sao verificadas aqui. */
  const tokensAntes = api.estado.pedidos.filter((p) => /\/auth\/v1\/token/.test(p.caminho)).length;
  let recusasRestantes = 2;                       // o app tem direito a 2 retentativas
  const recusarPorRelogio = (req, url) => {
    if (req.method !== 'GET' || !url.pathname.endsWith('/rest/v1/study_profiles')) return null;
    return { status: 401, corpo: { code: 'PGRST301', message: 'JWT issued at future' } };
  };
  api.estado.falhaForcada = (req, url) =>
    (recusasRestantes-- > 0 ? recusarPorRelogio(req, url) : null);
  const tolerou = await pg.evaluate(async () => {
    CloudStore.TOKEN_ESPERA_MS = 60;              // o teste nao espera 1,5 s de verdade
    try { const l = await CloudStore.listProfiles(); return { ok: true, n: l.length }; }
    catch (e) { return { ok: false, msg: e.message, code: e.code }; }
  });
  api.estado.falhaForcada = null;
  tolerou.ok ? ok('token recusado por "issued at future": a lista de perfis se recupera sozinha')
    : erro('o portao ainda quebra com token emitido no futuro: ' + JSON.stringify(tolerou));
  const tokensDepois = api.estado.pedidos.filter((p) => /\/auth\/v1\/token/.test(p.caminho)).length;
  tokensDepois === tokensAntes
    ? ok('e a recuperacao ESPERA, sem renovar o token (renovar traria um `iat` ainda mais adiante)')
    : erro(`a recuperacao renovou o token ${tokensDepois - tokensAntes}x — o token novo nasce com iat ainda mais no futuro`);

  // Limitada de proposito: o que NAO passa nunca vira tela parada em silencio.
  api.estado.falhaForcada = recusarPorRelogio;
  const desistiu = await pg.evaluate(async () => {
    try { await CloudStore.listProfiles(); return 'passou sem o servidor aceitar'; }
    catch (e) { return (e && e.code) || 'erro sem codigo'; }
  });
  api.estado.falhaForcada = null;
  desistiu === 'token-fora-de-hora'
    ? ok('falha persistente ainda vira erro proprio, com codigo (a retentativa e limitada)')
    : erro('a falha persistente nao virou erro proprio: ' + desistiu);

  erros.length === 0 ? ok('nenhuma excecao nao tratada em todo o percurso')
    : erro('excecoes durante o percurso da nuvem: ' + erros.slice(0, 3).join(' | '));

  await ctx.close();
  }
} catch (e) { erro('teste do caminho da nuvem falhou: ' + e.message); }


/* ── 6.8) O MOTOR DE SUGESTAO COM DADO DE VERDADE ──────────────────────────
   A tela que decide era invisivel para a verificacao: sem retratos importados
   o painel nem existe no DOM, entao a navegacao da etapa 6 e o contraste da
   etapa 8 passavam por cima dele. Os retratos sinteticos entram ANTES da etapa
   7 — assim a fila renderizada tambem e medida nos dois temas.

   O que se cobra aqui e o contrato da tela, nao a aritmetica (essa tem teste
   proprio em AutoTeste.motorSugestao): a fila aparece, cada linha diz a margem
   que a manteve naquele nivel, o par pre/pos troca a fonte do peso, e o botao
   de virar atividade realmente cria a atividade ligada ao motor. */
console.log('\n6.8) o Motor de sugestao renderiza com dado real');
try {
  await pag.setViewportSize({ width: 360, height: 780 });
  await pag.evaluate(() => {
    const dia = (n) => { const d = new Date(todayLocal() + 'T00:00:00'); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };
    const L = (c, n, disc, q, ac) => ({ depth: 1, codigo: c, nome: n, disciplina: disc, questoes: q, acertos: ac });
    // linha de DISCIPLINA (o export do TEC traz uma para cada): é dela que saem
    // os totais e é nela que a arvore pendura os topicos
    const D = (n, q, ac) => ({ depth: 0, codigo: null, nome: n, disciplina: n, questoes: q, acertos: ac });
    const R = (id, i, f, rows) => ({ id, nome: id, date: f, startDate: i, endDate: f, rows });
    DB._set(DB.KEYS.tec, [
      R('r1', dia(120), dia(95), [
        D('Direito Constitucional', 100, 40), L('01', 'Controle de constitucionalidade', 'Direito Constitucional', 100, 40),
        D('Direito Administrativo', 500, 240), L('01', 'Licitacoes', 'Direito Administrativo', 500, 240),
        D('Portugues', 20, 15), L('01', 'Crase', 'Portugues', 20, 15)]),
      R('r2', dia(30), dia(5), [
        D('Direito Constitucional', 50, 30), L('01', 'Controle de constitucionalidade', 'Direito Constitucional', 50, 30),
        D('Direito Administrativo', 100, 50), L('01', 'Licitacoes', 'Direito Administrativo', 100, 50),
        D('Portugues', 52, 37), L('01', 'Crase', 'Portugues', 40, 34), L('02', 'Ortografia', 'Portugues', 12, 3),
        D('AFO', 8, 3), L('01', 'Orcamento publico', 'AFO', 8, 3)])
    ]);
    ['Direito Constitucional', 'Direito Administrativo', 'Portugues', 'AFO', 'Direito Penal']
      .forEach((n) => { if (!DB.getSubjects().some((s) => s.nome === n)) DB.addSubject({ nome: n }); });
    switchScreen('desempenhotec');
    DesempenhoTecScreen.render();
    DesempenhoTecScreen.switchTecTab('motor');
  });
  await pag.waitForTimeout(500);
  const est = await pag.evaluate(() => {
    const q = (s) => document.querySelector(s);
    return {
      fases: document.querySelectorAll('#motor-fase button[data-fase]').length,
      faseAtiva: document.querySelectorAll('#motor-fase button.active').length,
      itens: document.querySelectorAll('#motor-lista .ms-item').length,
      comMargem: [...document.querySelectorAll('#motor-lista .ms-item')]
        .filter((it) => /margem/.test(it.innerText)).length,
      comDose: [...document.querySelectorAll('#motor-lista .ms-dose')]
        .filter((d) => parseInt(d.textContent, 10) > 0).length,
      resumo: (q('.ms-resumo') || {}).innerText || '',
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      semDica: [...document.querySelectorAll('#tec-cfg-body .tec-cfg-sec[data-tab="motor"] .rfc-field > label')]
        .filter((l) => !l.querySelector('.info-dot')).length,
      camposNaFolha: document.querySelectorAll('#tec-cfg-body .tec-cfg-sec[data-tab="motor"] .rfc-field').length
    };
  });
  est.fases === 2 && est.faseAtiva === 1
    ? ok('o par pre/pos aparece com exatamente uma fase valendo')
    : erro('o seletor de fase nao renderizou: ' + JSON.stringify(est));
  est.itens >= 2 ? ok(`${est.itens} frente(s) na fila do motor`) : erro('a fila do motor veio vazia');
  est.comMargem === est.itens && est.itens > 0
    ? ok('toda linha declara a margem que a manteve naquele nivel da arvore')
    : erro(`${est.itens - est.comMargem} linha(s) sem a margem declarada`);
  est.comDose === est.itens && est.itens > 0
    ? ok('toda frente saiu com dose maior que zero')
    : erro('ha frente com dose zero na fila: ' + JSON.stringify(est));
  /questões no caderno/.test(est.resumo)
    ? ok('o resumo diz de quantas questoes e o caderno repartido')
    : erro('o resumo do motor nao diz o tamanho do caderno: ' + est.resumo);
  est.overflow === 0 ? ok('nenhum vazamento horizontal a 360px') : erro(`o motor vaza ${est.overflow}px na horizontal a 360px`);
  (est.semDica === 0 && est.camposNaFolha >= 4)
    ? ok(`todos os ${est.camposNaFolha} campos de ajuste do Motor tem dica explicativa`)
    : erro(`${est.semDica} campo(s) sem o "i" (de ${est.camposNaFolha} encontrados — se veio zero, o seletor perdeu os campos)`);

  /* A poda e a promessa central: nenhuma frente pode chegar a tela com uma
     margem MAIOR que a tolerada sem estar marcada como bloco — se isso
     acontece, a tela esta recomendando ruido com cara de diagnostico. */
  const poda = await pag.evaluate(() => {
    const r = MotorSugestao.calcular();
    const p = MotorSugestao.prefs();
    const foraDaRegua = (r.itens || []).filter((x) => !x.agregado && (x.margem == null || x.margem > p.margemMax));
    return { margemMax: p.margemMax, fora: foraDaRegua.length, total: (r.itens || []).length };
  });
  poda.fora === 0 && poda.total > 0
    ? ok(`as ${poda.total} frentes oferecidas cabem na margem de ±${poda.margemMax}pp (ou sao blocos declarados)`)
    : erro('a poda deixou passar frente fora da regua: ' + JSON.stringify(poda));

  /* Trocar a fase troca a FONTE DO PESO, e sem incidencia importada o pos tem
     de dizer isso em vez de inventar um ranking. */
  const pos = await pag.evaluate(() => {
    document.querySelector('#motor-fase button[data-fase="pos"]').click();
    return { fase: MotorSugestao.prefs().fase, texto: (document.getElementById('motor-lista') || {}).innerText || '' };
  });
  (pos.fase === 'pos' && /incid/i.test(pos.texto))
    ? ok('o pos-edital sem incidencia importada explica o que falta, em vez de chutar')
    : erro('a troca para o pos-edital nao respondeu: ' + JSON.stringify(pos));
  await pag.evaluate(() => { document.querySelector('#motor-fase button[data-fase="pre"]').click(); });
  await pag.waitForTimeout(200);

  /* O botao que vira sugestao em TAREFA e o unico ponto da tela que muda
     dados. Se ele quebra, a tela inteira volta a ser um relatorio bonito. */
  const criar = await pag.evaluate(() => {
    const antes = DB.getExtras().length;
    const b = document.querySelector('#motor-lista [data-motor-extra]');
    if (!b) return { faltando: true };
    b.click();
    const depois = DB.getExtras();
    return { criadas: depois.length - antes, comOrigem: depois.filter((e) => e.origemPlano && e.origemPlano.topico).length };
  });
  (!criar.faltando && criar.criadas === 1 && criar.comOrigem >= 1)
    ? ok('virar uma frente em atividade grava a origem que fecha o ciclo')
    : erro('o botao de criar atividade do motor nao funcionou: ' + JSON.stringify(criar));
  await pag.setViewportSize({ width: 1280, height: 900 });
} catch (e) { erro('o Motor nao renderizou com dado real: ' + e.message); }


/* ── 6.9) AS OUTRAS TRES ABAS DO DESEMPENHO TEC ────────────────────────────
   Analise e Incidencia tinham a mesma sorte que a tela de decisao tinha antes:
   nenhuma checagem chegava nelas com dado de verdade. As invariantes abaixo
   sao as que, quando quebram, quebram calado — um numero plausivel no lugar
   de um numero certo. */
console.log('\n6.9) Analise e Incidencia com dado real');
try {
  await pag.setViewportSize({ width: 360, height: 780 });
  // ── ANALISE ──────────────────────────────────────────────────────────────
  const an = await pag.evaluate(async () => {
    DesempenhoTecScreen.switchTecTab('analise');
    DesempenhoTecScreen.renderAnalysis();
    await new Promise((r) => setTimeout(r, 150));
    const txt = (s) => { const e = document.querySelector(s); return e ? e.textContent : ''; };
    return {
      semListaParalela: !document.getElementById('tec-weak-list'),
      semAjusteParalelo: !document.querySelector('[data-cfg="analise"], #tec-cfg-body [data-tab="analise"]'),
      delta: !!document.querySelector('#tec-totais .tec-delta'),
      legendaTotais: /compara o último retrato/i.test(txt('#tec-totais')),
      linhas: document.querySelectorAll('#tec-disc-list .tnode-row').length
    };
  });
  (an.semListaParalela && an.semAjusteParalelo)
    ? ok('a Analise nao recria a lista paralela removida nem ajustes orfaos')
    : erro('a lista paralela removida voltou ao DOM: ' + JSON.stringify(an));
  an.delta && an.legendaTotais
    ? ok('a evolucao aparece no escopo consolidado, dizendo o que compara')
    : erro('o delta do aproveitamento nao aparece no escopo padrao: ' + JSON.stringify(an));
  an.linhas > 0
    ? ok(`a arvore hierarquica da Analise continua renderizando com dado real (${an.linhas} linha(s))`)
    : erro('a arvore hierarquica da Analise ficou vazia');

  // ── INCIDENCIA: importar duas vezes nao pode dobrar ──────────────────────
  const inc = await pag.evaluate(async () => {
    const linhas = [
      { disciplina: 'Direito Administrativo', topico: 'Licitacoes', incidencia: 40, codigo: '01', depth: 1 },
      // este NAO existe no desempenho: tem de virar aviso de casamento, nunca ponto cego
      { disciplina: 'Direito Administrativo', topico: 'Improbidade', incidencia: 25, codigo: '02', depth: 1 },
      { disciplina: 'Direito Constitucional', topico: 'Controle de constitucionalidade', incidencia: 30, codigo: '01', depth: 1 }
    ];
    DB.saveIncidencia([]);
    const a = DB.addIncidenciaRows('FGV', linhas, true);
    const b = DB.addIncidenciaRows('FGV', linhas, false);   // de novo, SEM substituir
    const total = DB.getIncidencia().filter((r) => r.banca === 'FGV').reduce((s, r) => s + r.incidencia, 0);
    const n = DB.getIncidencia().filter((r) => r.banca === 'FGV').length;
    DB.renameIncidenciaBanca('FGV', 'FGV 2026');
    const renomeou = DB.getIncidencia().every((r) => r.banca !== 'FGV') && DB.getBancas().indexOf('FGV 2026') >= 0;
    DB.renameIncidenciaBanca('FGV 2026', 'FGV');
    return { primeira: a, segunda: b, total, n, renomeou };
  });
  (inc.n === 3 && inc.total === 95 && inc.segunda.repetidas === 3 && inc.segunda.novas === 0)
    ? ok('reimportar a mesma incidencia atualiza em vez de dobrar (3 linhas, 95 questoes)')
    : erro('a incidencia duplicou ao reimportar: ' + JSON.stringify(inc));
  inc.renomeou ? ok('renomear uma banca preserva o que ja foi importado') : erro('renomear banca nao funcionou');

  // ── ORDEM DA ARVORE (a replica do TecConcursos) ──────────────────────────
  /* A promessa da Analise e que a ordem escolhida vale em TODOS os niveis: e
     por isso que se pode abrir a disciplina mais fraca e cair direto no
     subtopico que a puxa. Ordenar so o primeiro nivel passaria neste teste se
     ele olhasse apenas a raiz — entao ele abre um ramo e confere os filhos. */
  const arv = await pag.evaluate(async () => {
    switchScreen('desempenhotec');
    DesempenhoTecScreen.switchTecTab('analise');
    const pct = (el) => {
      const m = (el.querySelector('.tnode-pct b') || {}).textContent || '';
      return parseFloat(String(m).replace('%', '').replace(',', '.'));
    };
    const raizes = () => [...document.querySelectorAll('#tec-disc-list > .tec-tree > .tnode > .tnode-row')].map(pct);
    const clicar = (ordem) => {
      document.querySelector('#tec-ordem button[data-ordem="' + ordem + '"]').click();
    };
    clicar('fracos');
    await new Promise((r) => setTimeout(r, 200));
    const fracos = raizes();
    clicar('fortes');
    await new Promise((r) => setTimeout(r, 200));
    const fortes = raizes();
    clicar('fracos');
    await new Promise((r) => setTimeout(r, 200));
    // abre o primeiro ramo com filhos e le a ordem DENTRO dele
    const pai = [...document.querySelectorAll('#tec-disc-list .tnode[data-haskids="1"]')][0];
    let filhos = [];
    if (pai) {
      pai.querySelector('.tnode-row').click();
      await new Promise((r) => setTimeout(r, 200));
      filhos = [...pai.querySelectorAll(':scope > .tnode-children > .tnode > .tnode-row')].map(pct);
    }
    const linha = document.querySelector('#tec-disc-list .tnode-row');
    return {
      fracos, fortes, filhos,
      temQuestoes: !!(linha && linha.querySelector('.tnode-q')),
      temErro: !!(linha && linha.querySelectorAll('.tnode-pct b').length === 2)
    };
  });
  const crescente = (a) => a.every((v, i) => i === 0 || a[i - 1] <= v);
  (arv.fracos.length > 1 && crescente(arv.fracos))
    ? ok(`"pontos fracos" ordena as ${arv.fracos.length} disciplinas do pior para o melhor`)
    : erro('a ordem por pontos fracos nao ordenou: ' + JSON.stringify(arv.fracos));
  (arv.fortes.length > 1 && crescente(arv.fortes.slice().reverse()))
    ? ok('"pontos fortes" inverte a mesma lista')
    : erro('a ordem por pontos fortes nao inverteu: ' + JSON.stringify(arv.fortes));
  (arv.filhos.length > 1 ? crescente(arv.filhos) : arv.filhos.length >= 0)
    ? ok('e a ordem vale dentro do ramo aberto, nao so na raiz')
    : erro('os filhos nao seguiram a ordem do pai: ' + JSON.stringify(arv.filhos));
  (arv.temQuestoes && arv.temErro)
    ? ok('cada linha traz questoes resolvidas, acerto e erro — como na tela do TecConcursos')
    : erro('a linha da arvore nao tem as colunas do TEC: ' + JSON.stringify(arv));

  // ── "i" em todos os controles das tres abas ─────────────────────────────
  const dicas = await pag.evaluate(() => {
    /* Inclui a FOLHA DE AJUSTES: e la que moram os campos das tres abas desde
       que a tela deixou de abrir em formulario. Sem esses dois seletores o
       teste conta zero campos e passa sem olhar nada. */
    const alvos = ['#tec-panel-analise', '#tec-panel-incidencia', '#tec-panel-motor',
      '#tec-cfg-body .tec-cfg-sec[data-tab="motor"]'];
    let sem = [];
    alvos.forEach((a) => {
      document.querySelectorAll(a + ' .field > label, ' + a + ' .rfc-field > label').forEach((l) => {
        // dentro da folha a secao nasce `hidden`; o que importa e o campo ter o "i"
        const dentroDaFolha = !!l.closest('#tec-cfg-body');
        if (!l.querySelector('.info-dot') && (dentroDaFolha || !l.closest('[hidden]'))) sem.push(a + ' ' + (l.textContent || '').trim().slice(0, 24));
      });
    });
    return sem;
  });
  dicas.length === 0 ? ok('todos os controles remanescentes das abas tem dica explicativa')
    : erro(`${dicas.length} controle(s) sem "i": ` + dicas.slice(0, 6).join(' | '));
  await pag.setViewportSize({ width: 1280, height: 900 });
} catch (e) { erro('as abas de fatos nao renderizaram com dado real: ' + e.message); }


/* ── 6.11) O CICLO MENSAL ──────────────────────────────────────────────────
   O dado desta tela e volatil por natureza: todo mes entra um retrato novo por
   cima. O que NAO pode mudar nesse momento sao as suas decisoes — o modo
   ajustado, o limiar escolhido, a atividade em andamento e o vinculo dela com
   o assunto. E o que TEM de mudar sao os numeros. Este e o unico teste que
   percorre o ciclo inteiro. */
console.log('\n6.11) importar um retrato novo por cima de tudo');
try {
  const ciclo = await pag.evaluate(async () => {
    const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
    const dia = (n) => { const d = new Date(todayLocal() + 'T00:00:00'); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };
    const L = (c, n, disc, q, ac) => ({ depth: 1, codigo: c, nome: n, disciplina: disc, questoes: q, acertos: ac, pctAcerto: Math.round(ac / q * 1000) / 10 });
    const D = (n, q, ac) => ({ depth: 0, codigo: null, nome: n, disciplina: n, questoes: q, acertos: ac, pctAcerto: Math.round(ac / q * 1000) / 10 });

    // estado ANTES: preferencias proprias e uma atividade em curso
    MotorSugestao.salvar({ metaAcerto: 88 });
    DesempenhoTecScreen.switchTecTab('motor');
    await esperar(300);
    const alvo = (PlanoEngine.calcular(DesempenhoTecScreen.scopedSnapshot(), PlanoEngine.prefs()).itens[0] || {});
    DB.getExtras().filter((e) => e.origemPlano).forEach((e) => DB.deleteExtra && DB.deleteExtra(e.id));
    DesempenhoTecScreen.criarExtraDoPlano(alvo.nome, alvo.disciplina, alvo.custoQ, 'reforco');
    await esperar(250);
    const extra = DB.getExtras().find((e) => e.origemPlano && e.origemPlano.topico === alvo.nome);
    const antes = {
      taxa: alvo.taxa, dominio: PlanoEngine.calcular(DesempenhoTecScreen.scopedSnapshot(), PlanoEngine.prefs()).dominioPct,
      taxaInicial: extra && extra.origemPlano.taxaInicial, modo: MotorSugestao.prefs().metaAcerto,
      retratos: DB.getTecSnapshots().length
    };

    // O MES SEGUINTE: o assunto do topo melhorou muito; entra um retrato novo
    const novos = DB.getTecSnapshots().slice();
    novos.push({ id: 'novo', nome: 'novo', date: dia(2), startDate: dia(4), endDate: dia(2), rows: [
      D(alvo.disciplina, 120, 96), L('01', alvo.nome, alvo.disciplina, 120, 96),
      D('Direito Constitucional', 40, 20), L('01', 'Controle de constitucionalidade', 'Direito Constitucional', 40, 20)
    ] });
    DB._set(DB.KEYS.tec, novos);
    DesempenhoTecScreen.selectedSnapIds = null;   // escopo recalcula do zero, como numa abertura
    DesempenhoTecScreen.render();
    DesempenhoTecScreen.switchTecTab('motor');
    await esperar(400);
    const r2 = PlanoEngine.calcular(DesempenhoTecScreen.scopedSnapshot(), PlanoEngine.prefs());
    const depoisAlvo = [].concat(r2.itens, r2.pequenas || []).find((x) => x.nome === alvo.nome);
    const extra2 = DB.getExtras().find((e) => e.origemPlano && e.origemPlano.topico === alvo.nome);
    return {
      antes,
      depois: {
        taxa: depoisAlvo ? depoisAlvo.taxa : null,
        dominio: r2.dominioPct,
        taxaInicial: extra2 && extra2.origemPlano.taxaInicial,
        modo: MotorSugestao.prefs().metaAcerto,
        retratos: DB.getTecSnapshots().length,
        temExtra: !!extra2,
        comparando: DesempenhoTecScreen.rotuloComparacao()
      }
    };
  });
  const a = ciclo.antes, d = ciclo.depois;
  (d.retratos === a.retratos + 1) ? ok(`o retrato novo entrou no escopo (${a.retratos} → ${d.retratos})`)
    : erro('o retrato novo nao entrou: ' + JSON.stringify(ciclo));
  (d.taxa != null && a.taxa != null && d.taxa > a.taxa)
    ? ok(`a taxa do assunto atacado subiu com o dado novo (${a.taxa.toFixed(0)}% → ${d.taxa.toFixed(0)}%)`)
    : erro('a taxa nao acompanhou o retrato novo: ' + JSON.stringify({ a: a.taxa, d: d.taxa }));
  (d.modo === 88)
    ? ok('a configuracao do Motor sobrevive a importacao')
    : erro('a importacao levou a configuracao do Motor junto: ' + JSON.stringify({ modo: d.modo }));
  (d.temExtra && d.taxaInicial === a.taxaInicial)
    ? ok('a atividade continua ligada ao assunto, com a taxa inicial preservada')
    : erro('o vinculo da atividade se perdeu: ' + JSON.stringify({ t: d.temExtra, i: d.taxaInicial, a: a.taxaInicial }));
  /* O rotulo tem de dizer DUAS datas — uma para cada retrato. Juntar dois
     intervalos com seta virava uma sequencia de quatro datas ilegivel. */
  (d.comparando && (d.comparando.match(/→/g) || []).length === 1)
    ? ok(`o ▲▼ passa a comparar o retrato novo com o anterior (${d.comparando})`)
    : erro('rotulo de comparacao ilegivel: ' + d.comparando);
} catch (e) { erro('o ciclo mensal falhou: ' + e.message); }


/* ── 6.12) ESCOLHER QUAIS BANCAS SAO AS MINHAS ─────────────────────────────
   A escolha vale para tres abas ao mesmo tempo e muda o numero que decide a
   ordem de estudo. Este bloco percorre o seletor de ponta a ponta: uma banca,
   duas somadas, e a volta para todas — conferindo, a cada passo, o que o
   Reforco passa a usar. */
console.log('\n6.12) selecao de bancas (uma, varias, todas)');
try {
  const sel = await pag.evaluate(async () => {
    const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
    const linhas = (banca, n) => [
      { disciplina: 'Direito Administrativo', topico: 'Licitacoes', incidencia: n, codigo: '01', depth: 1 },
      { disciplina: 'Direito Constitucional', topico: 'Controle de constitucionalidade', incidencia: Math.round(n / 2), codigo: '01', depth: 1 }
    ];
    DB.saveIncidencia([]);
    DB.addIncidenciaRows('FGV', linhas('FGV', 40), true);
    DB.addIncidenciaRows('Cebraspe', linhas('Cebraspe', 26), true);
    DB.addIncidenciaRows('FCC', linhas('FCC', 100), true);
    DesempenhoTecScreen.savePrefs({ bancasSel: [] });
    DesempenhoTecScreen.switchTecTab('incidencia');
    await esperar(300);

    const host = document.getElementById('incid-banca-pick');
    const abrir = () => { host.querySelector('.banca-pick-btn').click(); };
    const marcar = async (nome) => {
      abrir(); await esperar(80);
      const c = [...host.querySelectorAll('.banca-pick-panel input[type=checkbox]')].find((x) => x.value === nome);
      c.checked = !c.checked; c.dispatchEvent(new Event('change', { bubbles: true }));
      await esperar(250);
    };
    /* A conta da incidência é lida direto do mapa que o Motor usa no
       pós-edital: é ele que a seleção de bancas tem de mover. */
    const estado = () => {
      const mapa = ReforcoEngine.incidenceMap(DesempenhoTecScreen.bancaFiltro());
      return {
        rotulo: document.querySelector('#incid-banca-pick .banca-pick-btn span').textContent.trim(),
        blocos: document.querySelectorAll('#incid-bancas-list .incid-banca-block').length,
        resumo: (document.getElementById('incid-selecao-resumo') || {}).textContent || '',
        incid: ReforcoEngine.incidenciaDe(mapa, 'Licitacoes', 'Direito Administrativo').valor
      };
    };
    const todas = estado();
    await marcar('FGV');
    const uma = estado();
    await marcar('Cebraspe');
    const duas = estado();
    // a mesma selecao tem de valer nas outras abas
    DesempenhoTecScreen.switchTecTab('motor');
    await esperar(350);
    const noPlano = {
      rotulo: (document.querySelector('#motor-banca-pick .banca-pick-btn span') || {}).textContent || '',
      filtro: DesempenhoTecScreen.bancaFiltro()
    };
    DesempenhoTecScreen.switchTecTab('incidencia');
    await esperar(250);
    // volta para todas
    document.querySelector('#incid-banca-pick .banca-pick-btn').click();
    await esperar(80);
    const btnTodas = document.querySelector('#incid-banca-pick .banca-pick-panel [data-acao="todas"]');
    if (btnTodas) btnTodas.click();
    await esperar(300);
    const voltou = estado();
    return { todas, uma, duas, noPlano, voltou };
  });
  (sel.todas.incid === 166)
    ? ok('todas as bancas somam num assunto so (40+26+100 = 166)')
    : erro('a soma de todas as bancas saiu errada: ' + JSON.stringify(sel.todas));
  (sel.uma.incid === 40 && /FGV/.test(sel.uma.rotulo) && sel.uma.blocos === 1)
    ? ok('marcar uma banca restringe a conta e a lista de bancas (FGV, 40)')
    : erro('a selecao de uma banca nao pegou: ' + JSON.stringify(sel.uma));
  (sel.duas.incid === 66 && /2 bancas/.test(sel.duas.rotulo) && sel.duas.blocos === 2 && /FGV e Cebraspe|Cebraspe e FGV/.test(sel.duas.resumo))
    ? ok('duas bancas somam so as duas (40+26 = 66) e o resumo nomeia as duas')
    : erro('a soma de duas bancas saiu errada: ' + JSON.stringify(sel.duas));
  (/2 bancas/.test(sel.noPlano.rotulo) && Array.isArray(sel.noPlano.filtro) && sel.noPlano.filtro.length === 2)
    ? ok('a mesma selecao vale no Motor, sem precisar escolher de novo')
    : erro('a selecao nao atravessou para o Motor: ' + JSON.stringify(sel.noPlano));
  (sel.voltou.incid === 166 && /Todas/.test(sel.voltou.rotulo))
    ? ok('voltar a todas as bancas devolve a soma completa')
    : erro('nao voltou para todas: ' + JSON.stringify(sel.voltou));
} catch (e) { erro('o seletor de bancas falhou: ' + e.message); }

/* ── 6.13) DOIS ASSUNTOS COM O MESMO NOME ──────────────────────────────────
   "Principios" existe em Constitucional e em Administrativo, e nao e o mesmo
   assunto. Enquanto o indice do Plano somava homonimos, a tela mostrava UMA
   linha com uma taxa que nao era de nenhum dos dois, filtrar por disciplina
   devolvia "sem retrato" com o retrato na mao, e a atividade criada para um
   deles bloqueava a do outro. Este bloco percorre o caminho inteiro na tela:
   as duas linhas, as duas atividades e o progresso de cada uma. */
console.log('\n6.13) dois assuntos com o mesmo nome em disciplinas diferentes');
try {
  await pag.evaluate(() => {
    const dia = (n) => { const d = new Date(todayLocal() + 'T00:00:00'); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };
    const linhas = (a, b) => [
      { depth: 0, codigo: null, nome: 'Direito Constitucional', disciplina: 'Direito Constitucional', questoes: 100, acertos: a },
      { depth: 1, codigo: '01', nome: 'Principios', disciplina: 'Direito Constitucional', questoes: 100, acertos: a },
      { depth: 0, codigo: null, nome: 'Direito Administrativo', disciplina: 'Direito Administrativo', questoes: 100, acertos: b },
      { depth: 1, codigo: '01', nome: 'Principios', disciplina: 'Direito Administrativo', questoes: 100, acertos: b }];
    DB.saveIncidencia([]);
    DB._set(DB.KEYS.extras, []);
    DB._set(DB.KEYS.tec, [
      { id: 'g1', nome: 'g1', date: dia(40), startDate: dia(60), endDate: dia(40), rows: linhas(35, 15) },
      { id: 'g2', nome: 'g2', date: dia(3), startDate: dia(30), endDate: dia(3), rows: linhas(30, 10) }]);
    PlanoEngine.salvarPrefs({ minAmostra: 1, tetoDominio: 100, limite: 50, disciplina: '__todas__', ordenar: 'pior' });
    DesempenhoTecScreen._planoRefC = null;
    DesempenhoTecScreen.render();
    DesempenhoTecScreen.switchTecTab('motor');
  });
  await pag.waitForTimeout(400);
  const hom = await pag.evaluate(() => {
    const texto = [...document.querySelectorAll('#motor-lista .ms-item')].map((e) => e.textContent.replace(/\s+/g, ' '));
    const r = MotorSugestao.calcular({ maxFrentes: 12 });
    const p = (r.todos || []).filter((x) => /Princ[ií]pios/.test(x.nome));
    return { comPrincipios: texto.filter((t) => /Princ[ií]pios/.test(t)).length,
      taxas: p.map((x) => Math.round(x.taxa)), discs: p.map((x) => x.disciplina) };
  });
  (hom.taxas.length === 2 && new Set(hom.taxas).size === 2 && new Set(hom.discs).size === 2)
    ? ok(`os dois "Principios" continuam separados, com a taxa de cada um (${hom.taxas.join('% e ')}%)`)
    : erro('os homonimos se fundiram no motor: ' + JSON.stringify(hom));
  const filtro = await pag.evaluate(() => {
    const r = PlanoEngine.calcular(DesempenhoTecScreen.scopedSnapshot(),
      Object.assign({}, PlanoEngine.prefs(), { disciplina: 'Direito Administrativo' }));
    return { erro: r.erro || null, assuntos: r.assuntos, dominio: r.dominioPct };
  });
  (!filtro.erro && filtro.assuntos === 1 && Math.round(filtro.dominio) === 10)
    ? ok('filtrar por disciplina acha o homonimo daquela disciplina (10% de dominio)')
    : erro('o filtro por disciplina perdeu o homonimo: ' + JSON.stringify(filtro));
  const ativ = await pag.evaluate(() => {
    const T = DesempenhoTecScreen;
    const a = T.criarExtraDoPlano('Principios', 'Direito Constitucional', 30, 'reforco', true);
    const b = T.criarExtraDoPlano('Principios', 'Direito Administrativo', 30, 'reforco', true);
    const c = T.criarExtraDoPlano('Principios', 'Direito Administrativo', 30, 'reforco', true);
    const extras = DB.getExtras();
    const r = PlanoEngine.calcular(T.scopedSnapshot(), PlanoEngine.prefs());
    const casados = r.itens.map((x) => {
      const e = extras.find((e2) => T._casaTopico(e2.origemPlano, x.nome, x.disciplina));
      return e ? e.origemPlano.disciplina : null;
    });
    return { criou: [a, b], recusouRepetida: c === false, total: extras.length,
      taxas: extras.map((e) => e.origemPlano.disciplina + ':' + Math.round(e.origemPlano.taxaInicial)),
      casados, distintos: new Set(casados).size };
  });
  (ativ.criou[0] && ativ.criou[1] && ativ.recusouRepetida && ativ.total === 2)
    ? ok('da para criar uma atividade para cada homonimo, e repetir o mesmo continua sendo recusado')
    : erro('a criacao de atividades confundiu os homonimos: ' + JSON.stringify(ativ));
  (ativ.distintos === 2 && ativ.casados.every(Boolean))
    ? ok('cada linha do Plano se liga a atividade da sua propria disciplina')
    : erro('as linhas do Plano se ligaram a atividade errada: ' + JSON.stringify(ativ.casados));
  (ativ.taxas.indexOf('Direito Constitucional:30') >= 0 && ativ.taxas.indexOf('Direito Administrativo:10') >= 0)
    ? ok('e cada atividade guarda a taxa inicial do SEU assunto (30% e 10%)')
    : erro('a taxa inicial veio do assunto errado: ' + JSON.stringify(ativ.taxas));
} catch (e) { erro('o caso dos homonimos falhou: ' + e.message); }

/* ── 6.14) A FOLHA DE AJUSTES ───────────────────────────────────────────────
   Vinte e cinco campos abertos faziam o Desempenho TEC ABRIR EM CONFIGURACAO:
   2.413px de formulario antes do primeiro numero, a 390px de largura. As
   invariantes abaixo sao as que, quando quebram, devolvem exatamente isso —
   ou, pior, escondem os ajustes sem deixar caminho ate eles. */
console.log('\n6.14) os ajustes numa folha suspensa, nao empilhados na tela');
try {
  await pag.setViewportSize({ width: 390, height: 844 });
  const ABAS = ['motor'];
  await pag.evaluate(() => { switchScreen('desempenhotec'); DesempenhoTecScreen.switchTecTab('motor'); });
  await pag.waitForTimeout(400);
  // 1) nenhuma aba abre com campo de ajuste solto na tela
  const solto = await pag.evaluate((abas) => {
    const out = {};
    abas.forEach((t) => {
      DesempenhoTecScreen.switchTecTab(t);
      const p = document.getElementById('tec-panel-' + t);
      out[t] = {
        campos: p ? p.querySelectorAll('.rfc-field input, .rfc-field select, .tec-filterbar input, .tec-filterbar select').length : -1,
        porta: !!(p && p.querySelector('.tec-cfg-open')),
        etiquetas: p ? p.querySelectorAll('.tec-cfg-pill').length : 0,
        alturaBarra: p && p.querySelector('.tec-cfg-bar') ? Math.round(p.querySelector('.tec-cfg-bar').getBoundingClientRect().height) : -1
      };
    });
    DesempenhoTecScreen.switchTecTab('motor');
    return out;
  }, ABAS);
  const tudoLimpo = ABAS.every((t) => solto[t].campos === 0 && solto[t].porta && solto[t].etiquetas >= 3);
  tudoLimpo
    ? ok(`o Motor abre em RESULTADO: 0 campos soltos, a porta ⚙ e ${solto.motor.etiquetas} etiquetas do que esta valendo`)
    : erro('ainda ha ajuste solto na tela: ' + JSON.stringify(solto));
  const maisAlta = Math.max(...ABAS.map((t) => solto[t].alturaBarra));
  maisAlta > 0 && maisAlta < 170
    ? ok(`a linha de ajustes ocupa no maximo ${maisAlta}px a 390px (eram 2.413px de formulario)`)
    : erro(`a linha de ajustes voltou a crescer: ${maisAlta}px`);

  /* 2) A PORTA NAO PODE SUMIR. "Ocultar filtros" escondia tudo que tivesse a
     classe .tec-cfg — se a barra da folha voltar a te-la, o unico caminho ate
     os ajustes desaparece do app e nao ha como reabri-lo. */
  const some = await pag.evaluate(() => {
    const antes = DesempenhoTecScreen._loadPrefs().hideCfg;
    DesempenhoTecScreen.savePrefs({ hideCfg: true });
    DesempenhoTecScreen.applyCfgHidden();
    const vis = [...document.querySelectorAll('.tec-cfg-open')].filter((b) => b.getBoundingClientRect().height > 0).length;
    DesempenhoTecScreen.savePrefs({ hideCfg: antes });
    DesempenhoTecScreen.applyCfgHidden();
    return vis;
  });
  some >= 1 ? ok('"Ocultar filtros" nao esconde a porta dos ajustes')
    : erro('com os filtros ocultos nao sobra caminho nenhum ate os ajustes');

  // 3) a folha abre com UMA secao e a fita troca de secao
  const abre = await pag.evaluate(() => {
    document.querySelector('.tec-cfg-open[data-cfg="motor"]').click();
    const chips = [...document.querySelectorAll('#tec-cfg-nav button')].map((b) => b.dataset.sec);
    const visiveis = () => [...document.querySelectorAll('#tec-cfg-body .tec-cfg-sec')].filter((s) => !s.hidden);
    const inicio = visiveis().map((s) => s.dataset.tab + '/' + s.dataset.sec);
    TecAjustes.mostrar('caderno');
    const depois = visiveis().map((s) => s.dataset.tab + '/' + s.dataset.sec);
    return { chips, inicio, depois };
  });
  (abre.chips.length === 4 && abre.inicio.length === 1 && abre.depois.length === 1 && abre.depois[0] === 'motor/caderno')
    ? ok(`a folha do Motor tem ${abre.chips.length} secoes e mostra UMA por vez (${abre.inicio[0]} → ${abre.depois[0]})`)
    : erro('a folha nao esta mostrando uma secao por vez: ' + JSON.stringify(abre));

  // 5) mexer num campo aplica NA HORA e atualiza a etiqueta do que esta valendo
  // 5) mexer num campo aplica NA HORA e atualiza a etiqueta do que esta valendo
  const vivo = await pag.evaluate(async () => {
    TecAjustes.fechar();
    DesempenhoTecScreen.switchTecTab('motor');
    await new Promise((r) => setTimeout(r, 200));
    document.querySelector('.tec-cfg-open[data-cfg="motor"]').click();
    TecAjustes.mostrar('caderno');
    const el = document.getElementById('motor-alvo');
    el.value = '40'; el.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 200));
    return { etiqueta: document.getElementById('motor-cfg-resumo').textContent,
      gravado: MotorSugestao.prefs().alvoQuestoes,
      ponto: !!document.querySelector('#tec-cfg-nav button[data-sec="caderno"] .dot') };
  });
  (vivo.gravado === 40 && /40/.test(vivo.etiqueta))
    ? ok('mexer num campo aplica na hora e a etiqueta acompanha (caderno de 40 questoes)')
    : erro('o ajuste nao foi aplicado ao vivo: ' + JSON.stringify(vivo));
  vivo.ponto ? ok('e a secao ganha o ponto de "voce mexeu aqui"')
    : erro('a secao personalizada nao ficou marcada');

  // 6) o pe fica alcancavel: nada de rolar um formulario atras do "Concluir"
  const pe = await pag.evaluate(() => {
    const box = document.querySelector('.tec-cfg-box').getBoundingClientRect();
    const foot = document.querySelector('.tec-cfg-foot').getBoundingClientRect();
    const body = document.getElementById('tec-cfg-body');
    return { dentro: Math.round(box.bottom - foot.bottom), altura: Math.round(box.height),
      corpoIndependente: body.scrollHeight >= body.clientHeight,
      vazaH: document.documentElement.scrollWidth - document.documentElement.clientWidth };
  });
  /* `dentro` e a distancia entre a base da caixa e a base do rodape: por
     construcao ela vale ZERO — o rodape e o ultimo filho e fica rente. O que
     se mede e o arredondamento sub-pixel, que oscila com a metrica da fonte.
     A falha que isto existe para pegar e o formulario rolando ATRAS do
     "Concluir", e ali o rodape cai dezenas de pixels abaixo da caixa. */
  (Math.abs(pe.dentro) <= 2 && pe.altura <= 844 * 0.93 && pe.vazaH === 0)
    ? ok(`a folha cabe na tela (${pe.altura}px de 844) com o pe preso (${pe.dentro >= 0 ? '+' : ''}${pe.dentro}px) e sem vazamento horizontal`)
    : erro('a folha nao esta contida: ' + JSON.stringify(pe));

  // 7) Esc fecha e o foco volta para a porta por onde se entrou
  const esc = await pag.evaluate(async () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await new Promise((r) => setTimeout(r, 120));
    return { fechada: document.getElementById('tec-cfg-modal').style.display === 'none',
      foco: (document.activeElement || {}).className || '' };
  });
  esc.fechada ? ok('Esc fecha a folha') : erro('Esc nao fechou a folha');
  /^tec-cfg-open/.test(esc.foco) ? ok('e o foco volta para o botao por onde se entrou')
    : erro('o foco nao voltou para a porta: ' + esc.foco);

  // 8) restaurar padroes vale para os ajustes do Motor
  const rest = await pag.evaluate(async () => {
    document.querySelector('.tec-cfg-open[data-cfg="motor"]').click();
    document.getElementById('tec-cfg-reset').click();
    await new Promise((r) => setTimeout(r, 120));
    document.getElementById('ui-modal-ok').click();
    await new Promise((r) => setTimeout(r, 300));
    return { alvo: MotorSugestao.prefs().alvoQuestoes, padrao: MotorSugestao.DEFAULTS.alvoQuestoes };
  });
  (rest.alvo === rest.padrao)
    ? ok(`restaurar padroes devolve o Motor ao caderno padrao de ${rest.padrao} questoes`)
    : erro('restaurar padroes do Motor falhou: ' + JSON.stringify(rest));

  /* 10) A FITA NAO PODE FUGIR DO DEDO. No celular a folha e ancorada embaixo:
  /* 10) A FITA NAO PODE FUGIR DO DEDO. No celular a folha e ancorada embaixo:
     a base fica presa na borda da tela e e o TOPO que se move quando o conteudo
     muda de tamanho. Trocar de secao mexia 219px no topo, e a fita de chips —
     que e justamente o que se esta tocando — subia junto. */
  for (const [larg, alt, rot] of [[390, 844, '390x844'], [360, 640, '360x640'], [1280, 900, 'desktop']]) {
    await pag.setViewportSize({ width: larg, height: alt });
    for (const aba of ABAS) {
      await pag.evaluate((t) => { try { TecAjustes.fechar(); } catch (e) {} DesempenhoTecScreen.switchTecTab(t); }, aba);
      await pag.waitForTimeout(220);
      await pag.evaluate((t) => document.querySelector('.tec-cfg-open[data-cfg="' + t + '"]').click(), aba);
      await pag.waitForTimeout(300);
      const secs = await pag.evaluate(() => [...document.querySelectorAll('#tec-cfg-nav button')].map((b) => b.dataset.sec));
      const medidas = [];
      for (const sec of secs) {
        await pag.evaluate((x) => TecAjustes.mostrar(x), sec);
        await pag.waitForTimeout(130);
        medidas.push(await pag.evaluate(() => {
          const b = document.querySelector('.tec-cfg-box').getBoundingClientRect();
          const n = document.querySelector('.tec-cfg-nav').getBoundingClientRect();
          const f = document.querySelector('.tec-cfg-foot').getBoundingClientRect();
          return { topo: Math.round(b.top), fita: Math.round(n.top), pe: Math.round(f.top) };
        }));
      }
      await pag.evaluate(() => { try { TecAjustes.fechar(); } catch (e) {} });
      const osc = (k) => Math.max(...medidas.map((m) => m[k])) - Math.min(...medidas.map((m) => m[k]));
      const pior = Math.max(osc('topo'), osc('fita'), osc('pe'));
      pior <= 1
        ? ok(`${rot} · ${aba}: trocar entre ${secs.length} secao(oes) nao move a folha (topo/fita/pe parados)`)
        : erro(`${rot} · ${aba}: a folha pula ao trocar de secao — topo ${osc('topo')}px, fita ${osc('fita')}px, pe ${osc('pe')}px`);
    }
  }
  await pag.evaluate(() => { try { TecAjustes.fechar(); } catch (e) {} });
  await pag.setViewportSize({ width: 1280, height: 900 });
} catch (e) { erro('a folha de ajustes falhou: ' + e.message); }

/* ── 6.15) O CICLO: DECIDI · FIZ · FUNCIONOU? ──────────────────────────────
   A tela media tudo e nao fechava nada. O percurso inteiro, no navegador: criar
   pelo Plano, importar o retrato, e conferir que o app conta as questoes
   sozinho, encerra o que acabou e diz a verdade sobre o que nao funcionou. */
console.log('\n6.15) o ciclo de uma atividade do Motor, ponta a ponta');
try {
  await pag.setViewportSize({ width: 390, height: 844 });
  const cria = await pag.evaluate(() => {
    const dia = (n) => { const d = new Date(todayLocal() + 'T00:00:00'); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };
    const D = (n, q, ac) => ({ depth: 0, codigo: null, nome: n, disciplina: n, questoes: q, acertos: ac });
    const L = (c, n, disc, q, ac) => ({ depth: 1, codigo: c, nome: n, disciplina: disc, questoes: q, acertos: ac });
    const R = (id, i, f, rows) => ({ id, nome: id, date: f, startDate: i, endDate: f, rows });
    const base = (a, b, c) => [D('Dir Adm', 300, a + b + c), L('01', 'Licitacoes', 'Dir Adm', 100, a),
      L('02', 'Atos', 'Dir Adm', 100, b), L('03', 'Contratos', 'Dir Adm', 100, c)];
    DB.saveIncidencia([]); DB._set(DB.KEYS.extras, []);
    DB._set(DB.KEYS.tec, [R('c1', dia(90), dia(70), base(40, 40, 45)), R('c2', dia(60), dia(35), base(40, 40, 45))]);
    MotorSugestao.salvar({ metaAcerto: 85 });
    PlanoEngine.salvarPrefs({ minAmostra: 1, limite: 20, ordenar: 'pior', metaDominio: 85, tetoDominio: 90, disciplina: '__todas__' });
    DesempenhoTecScreen._planoRefC = null; DesempenhoTecScreen._cicloSel = null;
    switchScreen('desempenhotec'); DesempenhoTecScreen.render(); DesempenhoTecScreen.switchTecTab('motor');
    ['Licitacoes', 'Atos', 'Contratos'].forEach((t) => DesempenhoTecScreen.criarExtraDoPlano(t, 'Dir Adm', 120, 'reforco', true));
    return DB.getExtras().map((e) => ({ t: e.origemPlano.topico, qBase: e.origemPlano.qBase,
      taxa: e.origemPlano.taxaInicial, meta: e.origemPlano.metaAlvo }));
  });
  (cria.length === 3 && cria.every((x) => x.qBase === 200 && x.taxa != null && x.meta === 85))
    ? ok('criar pelo Plano grava o contador do assunto, a taxa inicial e a meta do dia')
    : erro('a origem da atividade veio incompleta: ' + JSON.stringify(cria));

  // o retrato novo: um resolveu, um piorou, um esta a meio caminho
  const dep = await pag.evaluate(() => {
    const dia = (n) => { const d = new Date(todayLocal() + 'T00:00:00'); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };
    const D = (n, q, ac) => ({ depth: 0, codigo: null, nome: n, disciplina: n, questoes: q, acertos: ac });
    const L = (c, n, disc, q, ac) => ({ depth: 1, codigo: c, nome: n, disciplina: disc, questoes: q, acertos: ac });
    const s = DB.getTecSnapshots();
    s.push({ id: 'c3', nome: 'c3', date: dia(1), startDate: dia(20), endDate: dia(1), rows: [
      D('Dir Adm', 350, 195), L('01', 'Licitacoes', 'Dir Adm', 150, 138),
      L('02', 'Atos', 'Dir Adm', 150, 42), L('03', 'Contratos', 'Dir Adm', 50, 15)] });
    DB._set(DB.KEYS.tec, s);
    DesempenhoTecScreen._planoRefC = null; DesempenhoTecScreen._cicloSel = null;
    DesempenhoTecScreen.render(); DesempenhoTecScreen.switchTecTab('motor');
    const por = {};
    DB.getExtras().forEach((e) => { por[e.origemPlano.topico] = { st: e.status,
      v: e.origemPlano.veredito ? e.origemPlano.veredito.tipo : null,
      pp: e.origemPlano.veredito ? e.origemPlano.veredito.ganhoPP : null }; });
    /* O progresso medido pelo retrato e a lista de ciclos fechados vivem no
       modelo, nao mais numa tela: e o mesmo dado que a tela de Atividades le. */
    const emCurso = PlanoCiclo.emCurso(PlanoEngine.calcular(DesempenhoTecScreen.scopedSnapshot(), PlanoEngine.prefs()))
      .map((x) => x.origem.topico + ' ' + x.feito + '/' + x.alvo);
    const motor = document.getElementById('motor-lista');
    return { por, emCurso,
      hist: PlanoCiclo.fechados().length,
      podre: /\bNaN\b|\bundefined\b|\bInfinity\b/.test((motor || {}).textContent || ''),
      vaza: document.documentElement.scrollWidth - document.documentElement.clientWidth };
  });
  (dep.por.Licitacoes.st === 'concluida' && dep.por.Licitacoes.v === 'funcionou' && dep.por.Licitacoes.pp > 50)
    ? ok(`o assunto que atingiu a meta encerra sozinho, com o ganho registrado (+${dep.por.Licitacoes.pp}pp)`)
    : erro('o veredito de sucesso nao saiu: ' + JSON.stringify(dep.por.Licitacoes));
  (dep.por.Atos.st === 'concluida' && dep.por.Atos.v === 'naoFuncionou' && dep.por.Atos.pp < 0)
    ? ok(`cumpriu as questoes e a taxa caiu → veredito "nao funcionou" (${dep.por.Atos.pp}pp), que e o diagnostico`)
    : erro('o veredito negativo nao saiu: ' + JSON.stringify(dep.por.Atos));
  (dep.por.Contratos.st === 'ativa' && dep.por.Contratos.v === null)
    ? ok('e o que ainda esta a meio caminho continua aberto')
    : erro('atividade em andamento foi encerrada por engano: ' + JSON.stringify(dep.por.Contratos));
  (dep.emCurso.length === 1 && /50\/120/.test(dep.emCurso[0]))
    ? ok('o ciclo conta as questoes a partir do retrato, sem lancamento manual (50/120)')
    : erro('o progresso automatico nao apareceu: ' + JSON.stringify(dep.emCurso));
  dep.hist === 2 ? ok('e os dois ciclos fechados entram no historico "o que os retratos ja julgaram"')
    : erro(`historico com ${dep.hist} ciclo(s), esperado 2`);
  (!dep.podre && dep.vaza === 0) ? ok('nenhum numero podre e nenhum vazamento a 390px')
    : erro(`ciclo na tela: podre=${dep.podre} vazamento=${dep.vaza}px`);

  // a tela de Atividades mostra de onde veio e o que aconteceu
  const card = await pag.evaluate(() => {
    switchScreen('extras');
    if (window.ExtrasScreen) ExtrasScreen.render();
    const t = (document.getElementById('extras-list') || {}).textContent || '';
    /* ── A ORIGEM FICOU MAIS PRECISA; O TESTE PEDE A INFORMACAO ────────────
       A etiqueta dizia "🏁 do Plano" para QUALQUER atividade vinda do TEC —
       leitura analitica legada, Simplificado e Robusto, as tres iguais. Com os
       tres coexistindo isso impede a conferencia que mais importa: o que esta
       na fila saiu do modelo que eu escolhi? Agora a etiqueta nomeia a fonte
       (o dado ja estava em `origemPlano.sugestao.motor`, so nao chegava a
       tela). O que este teste garante continua sendo o mesmo — o cartao diz de
       ONDE veio —, e passa a aceitar qualquer uma das tres fontes em vez de
       exigir a frase generica que existia quando havia so uma. */
    return { doPlano: /Motor · (pré|pós)-edital|do TEC/.test(t),
      evo: /45% → 30%/.test(t), retrato: /pelo retrato/.test(t),
      barra: /50 \/ 120/.test(t) };
  });
  (card.doPlano && card.evo && card.barra)
    ? ok('o cartao da atividade nomeia a fase em que foi escolhida, mostra 45% → 30% e a barra em 50/120')
    : erro('o cartao nao trouxe o ciclo: ' + JSON.stringify(card));

  // a calibragem so aparece com historico, e propoe o SEU numero
  const cal = await pag.evaluate(() => {
    const dia = (n) => { const d = new Date(todayLocal() + 'T00:00:00'); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };
    const fake = (t, q, ini, fim) => {
      const e = DB.addExtra({ titulo: t, tipo: 'questoes', alvo: q, periodo: 'unica', contaMetricas: false });
      DB.updateExtra(e.id, { status: 'concluida', origemPlano: { topico: t, disciplina: 'Dir Adm', criadoEm: dia(30),
        veredito: { tipo: 'funcionou', em: todayLocal(), taxaInicial: ini, taxaFinal: fim, ganhoPP: fim - ini, questoes: q, alvo: q } } });
    };
    const antes = PlanoCiclo.calibragem().pronta;
    fake('K1', 100, 40, 58); fake('K2', 200, 50, 86);
    const c = PlanoCiclo.calibragem();
    return { antes, pronta: c.pronta, n: c.n, qPorPonto: c.qPorPonto, atual: c.atual };
  });
  (cal.antes === false && cal.pronta && cal.n >= 3)
    ? ok(`a calibragem so liga com historico: ${cal.n} ciclos → ${cal.qPorPonto} questoes por ponto (o padrao era ${cal.atual})`)
    : erro('a calibragem nao ficou pronta como devia: ' + JSON.stringify(cal));
  await pag.evaluate(() => { DB._set(DB.KEYS.extras, []); });
  await pag.setViewportSize({ width: 1280, height: 900 });
} catch (e) { erro('o ciclo da atividade falhou: ' + e.message); }

/* ── 6.16) GESTÃO NUM LUGAR SÓ ─────────────────────────────────────────────
   Com varios assuntos abertos em disciplinas diferentes, o unico lugar com o
   progresso de todos era um bloco dentro da tela de decisao — o lugar errado
   para perguntar "o que eu tenho em andamento?". A gestao mora em Atividades,
   e e la que este teste a procura. */
console.log('\n6.16) a gestao das atividades em andamento, na tela de Atividades');
try {
  await pag.setViewportSize({ width: 390, height: 844 });
  const g = await pag.evaluate(() => {
    const dia = (n) => { const d = new Date(todayLocal() + 'T00:00:00'); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };
    const D = (n, q, ac) => ({ depth: 0, codigo: null, nome: n, disciplina: n, questoes: q, acertos: ac });
    const L = (c, n, disc, q, ac) => ({ depth: 1, codigo: c, nome: n, disciplina: disc, questoes: q, acertos: ac });
    const R = (id, i, f, rows) => ({ id, nome: id, date: f, startDate: i, endDate: f, rows });
    const linhas = () => [D('Dir Adm', 200, 80), L('01', 'Licitacoes', 'Dir Adm', 100, 40), L('02', 'Atos', 'Dir Adm', 100, 40),
      D('Portugues', 100, 45), L('01', 'Crase', 'Portugues', 100, 45)];
    DB.saveIncidencia([]); DB._set(DB.KEYS.extras, []);
    DB._set(DB.KEYS.tec, [R('g1', dia(60), dia(40), linhas()), R('g2', dia(30), dia(2), linhas())]);
    PlanoEngine.salvarPrefs({ minAmostra: 1, limite: 20, ordenar: 'pior', metaDominio: 85, tetoDominio: 90, cadenciaDias: 30, disciplina: '__todas__' });
    DesempenhoTecScreen._planoRefC = null; DesempenhoTecScreen._cicloSel = null;
    switchScreen('desempenhotec'); DesempenhoTecScreen.render(); DesempenhoTecScreen.switchTecTab('motor');
    [['Licitacoes', 'Dir Adm'], ['Atos', 'Dir Adm'], ['Crase', 'Portugues']]
      .forEach(([t, d]) => DesempenhoTecScreen.criarExtraDoPlano(t, d, 120, 'reforco', true));
    switchScreen('extras'); ExtrasScreen.render();
    const painel = document.getElementById('extras-curso');
    return {
      existe: !!painel.querySelector('.exc-card'),
      grupos: [...painel.querySelectorAll('.exc-disc')].map((e) => e.textContent),
      itens: painel.querySelectorAll('.pl-ciclo-lista > li').length,
      resumo: (painel.querySelector('.exc-resumo') || {}).textContent.replace(/\s+/g, ' '),
      semDatas: !DB.getExtras().some((e) => (e.datas || []).length),
      discsNoDia: document.querySelectorAll('#extras-list .extras-disc-title').length,
      vaza: document.documentElement.scrollWidth - document.documentElement.clientWidth
    };
  });
  (g.existe && g.itens === 3 && g.grupos.length === 2)
    ? ok(`a tela de Atividades tem o painel dos ${g.itens} reforcos abertos, agrupados por disciplina (${g.grupos.join(', ')})`)
    : erro('o painel de gestao nao apareceu: ' + JSON.stringify(g));
  /* O reforço agora tem duas escalas deliberadamente distintas: a parcela
     executável do dia e a meta acumulada do ciclo. A agenda automática precisa
     existir, mas o painel não pode misturá-la com a antiga projeção derivada. */
  (/Missão diária/.test(g.resumo) && /Missão geral/.test(g.resumo) && !g.semDatas && !/\/dia até a próxima importação/.test(g.resumo))
    ? ok('o painel separa Missão diária e Missão geral, com agenda automática explícita')
    : erro('o contrato diário/geral falhou: ' + JSON.stringify({ resumo: g.resumo, semDatas: g.semDatas }));
  (g.discsNoDia >= 2 && g.vaza === 0)
    ? ok('o dia tambem separa por disciplina, sem vazamento a 390px')
    : erro(`agrupamento do dia: ${g.discsNoDia} titulo(s), vazamento ${g.vaza}px`);
  await pag.setViewportSize({ width: 1280, height: 900 });
} catch (e) { erro('a gestao das atividades falhou: ' + e.message); }

/* ═══ 7) UM ANO DE USO, SIMULADO ════════════════════════════════════════════
   As etapas acima conferem partes. Esta confere a EXPERIÊNCIA: uma jornada de
   oito importações mensais sobre uma árvore irregular de até cinco níveis (685
   folhas possíveis, ~1.000 linhas de incidência), com atividades criadas pelos
   dois portões, progresso lançado na mão, atividade encerrada pelo botão,
   retrato apagado, lente trocada, foco de três matérias e as seis ordens.

   Depois de CADA passo, um conjunto de invariantes é cobrado sobre o dado real
   daquele instante: o índice fecha com o retrato em qualquer piso, o
   consolidado soma os retratos, nenhum número podre em taxa/margem/custo,
   nenhuma margem zero com amostra finita, nenhum assunto em dois lugares,
   nenhuma atividade viva declarada órfã, nenhuma encerrada sem veredito, e
   TODAS as invariantes da própria auditoria.

   Foi esta etapa que encontrou o colapso da margem de erro (1.167 linhas com
   ±0pp), o progresso zerado ao apagar retrato, o ciclo que escapava sem
   veredito e a saturação do piso de granularidade. */
console.log('\n7) um ano de uso, simulado (jornada + invariantes)');
try {
  await pag.addScriptTag({ content: readFileSync(join(RAIZ, 'test/jornada-dados.js'), 'utf8') });
  await pag.addScriptTag({ content: readFileSync(join(RAIZ, 'test/jornada-invariantes.js'), 'utf8') });
  const j = await pag.evaluate(() => window.RODAR_JORNADA());
  const s = j.resumo || {};
  (j.totalFalhas === 0)
    ? ok(`8 importacoes, ${s.extras} atividades, ${s.ciclos} ciclos julgados (${Object.keys(s.porTipo || {}).map((k) => k + ':' + s.porTipo[k]).join(' ')}) — nenhuma invariante violada em 25 pontos de conferencia`)
    : erro(`a jornada violou ${j.totalFalhas} invariante(s):\n    `
      + [...new Set(j.falhas.map((f) => f.passo + ' :: ' + f.o))].slice(0, 10).join('\n    ')
      + '\n    exemplo: ' + JSON.stringify(j.falhas[0]));
  (s.pisoOferecido && s.assuntos1 > 0)
    ? ok(`no 1o retrato de uma arvore funda a tela oferece a lente (piso ${s.pisoOferecido}) e o Plano passa a existir (${s.assuntos1} unidades onde havia zero)`)
    : erro('a lente nao salvou o primeiro retrato: ' + JSON.stringify(s));
  (s.progressoPreservado > 0 && s.repinadas > 0)
    ? ok(`e apagar um retrato preservou o progresso medido de ${s.progressoPreservado} atividade(s) (${s.repinadas} re-pinadas), em vez de zerar`)
    : erro('o progresso nao foi preservado ao apagar retrato: ' + JSON.stringify(s));
} catch (e) {
  erro('a jornada simulada nao rodou: ' + e.message);
}

console.log('\n8) contraste WCAG AA (temas claro e escuro)');
/* Transicoes e animacoes desligadas durante a medicao. Sem isto, medir logo
   apos uma troca de tela pega a cor INTERMEDIARIA de uma transicao (a aba ativa
   a meio caminho entre --text-soft e --accent, por exemplo) e reprova um par de
   cores que na verdade passa. Falso alarme intermitente e pior que checagem
   nenhuma: ensina a ignorar a CI. */
await pag.addStyleTag({ content: '*,*::before,*::after{transition:none!important;animation:none!important}' });
const MEDIR = () => {
  const lum = (c) => { const [r, g, b] = c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  /* Aceita rgb()/rgba() E color(srgb r g b) — o segundo formato e o que o
     navegador devolve para um background feito com color-mix(). Sem ele, um
     fundo valido era lido como "transparente" e a medida saia errada. */
  const cor = (s) => {
    const t = String(s);
    const cs = t.match(/color\(srgb\s+([\d.eE+-]+)\s+([\d.eE+-]+)\s+([\d.eE+-]+)(?:\s*\/\s*([\d.eE+-]+))?\)/);
    if (cs) { if (cs[4] != null && Number(cs[4]) < 0.95) return null;
      return [1, 2, 3].map((i) => Math.round(Number(cs[i]) * 255)); }
    const m = t.match(/rgba?\(([^)]+)\)/); if (!m) return null;
    const q = m[1].split(',').map(Number); if (q.length > 3 && q[3] < 0.95) return null; return q.slice(0, 3);
  };
  const raiz = cor(getComputedStyle(document.body).backgroundColor) || [255, 255, 255];
  const caminho = (el) => { const v = []; let e = el;
    while (e && e !== document.documentElement) { v.unshift(e.tagName.toLowerCase() + (e.className ? '.' + String(e.className).trim().split(/\s+/)[0] : '')); e = e.parentElement; }
    return v.slice(-3).join('>'); };
  const ruins = [];
  document.querySelectorAll('*').forEach((el) => {
    const r = el.getBoundingClientRect(); if (r.width < 4 || r.height < 4) return;
    const txt = [...el.childNodes].filter((x) => x.nodeType === 3 && x.textContent.trim()).map((x) => x.textContent.trim()).join('');
    if (!txt || /^[\p{Emoji_Presentation}\p{Extended_Pictographic}\s]+$/u.test(txt)) return;
    const st = getComputedStyle(el); if (st.visibility === 'hidden' || st.opacity === '0') return;
    const fg = cor(st.color); if (!fg) return;
    let bg = null, e = el;
    while (e) { const c = cor(getComputedStyle(e).backgroundColor); if (c) { bg = c; break; } e = e.parentElement; }
    bg = bg || raiz;
    const l1 = lum(fg), l2 = lum(bg);
    const razao = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    const px = parseFloat(st.fontSize);
    const minimo = (px >= 24 || (px >= 18.66 && parseInt(st.fontWeight) >= 700)) ? 3 : 4.5;
    if (razao < minimo) ruins.push(`"${txt.slice(0, 22)}" ${razao.toFixed(2)}:1 (min ${minimo}) rgb(${fg}) sobre rgb(${bg}) [${caminho(el)}]`);
  });
  return ruins;
};
try {
  for (const tema of ['light', 'dark']) {
    const achados = new Set();
    await pag.evaluate((t) => document.documentElement.setAttribute('data-theme', t), tema);
    const telas = await pag.evaluate(() => [...new Set([...document.querySelectorAll('[data-screen]')].map((b) => b.dataset.screen))]);
    for (const t of telas) {
      await pag.evaluate((n) => { try { switchScreen(n); } catch (e) {} }, t);
      await pag.waitForTimeout(150);
      (await pag.evaluate(MEDIR)).forEach((x) => achados.add(x));
    }
    /* As quatro abas do Desempenho TEC sao PAINEIS dentro da mesma tela: o laco
       acima mede so a que estiver aberta. Sem passar por todas, tres quartos da
       maior tela do app ficam fora da medicao de contraste — foi assim que o
       numero dos passos do Plano ficou em 1,65:1 sem ninguem ver. */
    for (const aba of ['analise', 'incidencia', 'reforco', 'plano']) {
      await pag.evaluate((t) => { try { switchScreen('desempenhotec'); DesempenhoTecScreen.switchTecTab(t); } catch (e) {} }, aba);
      await pag.waitForTimeout(220);
      (await pag.evaluate(MEDIR)).forEach((x) => achados.add(x));
      /* E a FOLHA DE AJUSTES, secao por secao. Ela nasce `display:none`, entao
         o medidor pula tudo o que ha dentro dela: os 25 campos do Plano, os
         chips da fita e o pe do dialogo sairiam da medicao inteiros — que e
         exatamente como o numero dos passos do Plano ficou em 1,65:1 sem
         ninguem ver, antes de as abas entrarem neste laco. */
      const secs = await pag.evaluate((t) => {
        try {
          const b = document.querySelector('.tec-cfg-open[data-cfg="' + t + '"]');
          if (!b) return [];
          b.click();
          return [...document.querySelectorAll('#tec-cfg-nav button')].map((x) => x.dataset.sec);
        } catch (e) { return []; }
      }, aba);
      for (const sec of secs) {
        await pag.evaluate((x) => { try { TecAjustes.mostrar(x); } catch (e) {} }, sec);
        await pag.waitForTimeout(120);
        (await pag.evaluate(MEDIR)).forEach((x) => achados.add(x));
      }
      if (secs.length) await pag.evaluate(() => { try { TecAjustes.fechar(); } catch (e) {} });
    }
    // o aviso flutuante so existe depois de disparado
    await pag.evaluate(() => { try { showToast('Verificacao de contraste'); } catch (e) {} });
    await pag.waitForTimeout(400);
    (await pag.evaluate(MEDIR)).forEach((x) => achados.add(x));
    /* O indicador de sincronizacao muda de classe conforme a NUVEM responde, e
       so ha nuvem quando ha rede. Medir "o tom que aparecer" fez um bug real
       passar aqui e so aparecer na CI: sem um `st-*` conhecido, o botao caia no
       preto do navegador — 1,14:1 no tema escuro. Agora percorremos os tons na
       marra, incluindo um DESCONHECIDO, para a cobertura nao depender de rede. */
    for (const tom of ['ok', 'off', 'syncing', 'error', 'desconhecido']) {
      await pag.evaluate((t) => {
        const b = document.getElementById('cloud-sync-btn');
        if (b) b.className = 'cloud-sync-btn st-' + t;
      }, tom);
      await pag.waitForTimeout(80);
      (await pag.evaluate(MEDIR)).forEach((x) => achados.add(x));
    }
    achados.size === 0 ? ok(`tema ${tema}: nenhum texto abaixo do WCAG AA`)
      : erro(`tema ${tema}: ${achados.size} texto(s) abaixo do WCAG AA\n    ` + [...achados].slice(0, 10).join('\n    '));
  }
  await pag.evaluate(() => document.documentElement.removeAttribute('data-theme'));
} catch (e) { erro('falha ao medir contraste: ' + e.message); }

await nav.close();
servidor.close();
console.log(falhas ? `\nFALHOU: ${falhas} problema(s).` : '\nTUDO OK.');
process.exit(falhas ? 1 : 0);
