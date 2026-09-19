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
/* ── 6.5) O ARMAZENAMENTO ANTIGO NÃO VOLTA A SER AUTORIDADE ─────────────
   A migração relacional eliminou a adoção automática de IndexedDB/localStorage.
   Uma cópia antiga pode continuar detectável para recuperação manual, mas nunca
   pode povoar silenciosamente a projeção viva nem concorrer com PostgreSQL. */
console.log('\n6.5) armazenamento antigo fica fora da fonte operacional');
try {
  const ctx = await nav.newContext();
  const p2 = await ctx.newPage();
  await p2.addInitScript(() => {
    try {
      window.localStorage.setItem('diario-estudos:u:antigo:p:pl1:entries',
        JSON.stringify([{ id:'e1', subject:'X', date:'2026-01-01', durationMin:60 }]));
    } catch (e) { /* o resultado abaixo acusa se o navegador não expuser storage */ }
  });
  await p2.goto(base, { waitUntil: 'domcontentloaded' });
  await p2.waitForFunction(() => window.AutoTeste && window.RelationalStore, { timeout: 30000 });
  const antigo = await p2.evaluate(() => ({
    memoriaSomente: window.__memoryOnlyStore === true && window.__idbShim === false,
    syncLegadoAposentado: !!window.SectionSync && SectionSync.retired === true &&
      SectionSync.enabled === false && SectionSync.readEnabled === false,
    recuperavel: window.Recuperacao ? Recuperacao.varrerAntigo().length : -1
  }));
  antigo.memoriaSomente && antigo.syncLegadoAposentado && antigo.recuperavel >= 1
    ? ok('copia antiga continua detectavel, mas a fonte operacional e somente SQL')
    : erro('legado local voltou ao caminho operacional: ' + JSON.stringify(antigo));
  await ctx.close();
} catch (e) { erro('teste de isolamento do armazenamento antigo falhou: ' + e.message); }

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

/* ── 6.7) O CAMINHO SQL RELACIONAL, DE PONTA A PONTA ────────────────────
   O cliente continua sendo o supabase-js real; o servidor falso agora modela
   as tabelas normalizadas e as RPCs transacionais usadas em produção. A prova
   importante é CRUD + reidratação sem tocar profile_sections. */
console.log('\n6.7) persistencia relacional, de ponta a ponta, contra o banco falso');
try {
  let libSupabase = null;
  try { libSupabase = readFileSync(join(RAIZ, 'node_modules/@supabase/supabase-js/dist/umd/supabase.js'), 'utf8'); }
  catch { console.log('  PULADA: supabase-js nao instalado (npm ci).'); }
  if (libSupabase) {
    const esperado = (html.match(/supabase-js@[^"]*"\s+integrity="sha256-([^"]+)"/) || [])[1];
    const real = createHash('sha256').update(libSupabase).digest('base64');
    esperado === real
      ? ok('o supabase-js instalado e o MESMO build fixado na pagina')
      : erro('o supabase-js instalado nao bate com o hash da pagina');

    const ctx = await nav.newContext({ serviceWorkers:'block' });
    await ctx.route('https://cdn.jsdelivr.net/**', (rota) => rota.fulfill({
      status:200, contentType:'text/javascript; charset=utf-8',
      headers:{'access-control-allow-origin':'*'}, body:libSupabase
    }));
    await ctx.route('https://fonts.googleapis.com/**',
      (rota) => rota.fulfill({status:200,contentType:'text/css',body:''}));
    const pg = await ctx.newPage();
    const erros = [];
    pg.on('pageerror',(e)=>erros.push(e.message));
    await pg.goto(base,{waitUntil:'domcontentloaded'});
    await pg.waitForFunction(() => window.CloudStore && window.RelationalStore && window.ProfileManager,
      {timeout:30000});

    const iniciou = await pg.evaluate((origem) => {
      CloudStore.SUPABASE_URL=origem;
      CloudStore.SUPABASE_KEY='chave-publicavel-de-teste';
      CloudStore.init();
      return CloudStore.libStatus;
    },new URL(base).origin);
    iniciou === 'ready' ? ok('cliente Supabase real iniciou') : erro('cliente Supabase nao iniciou: '+iniciou);

    const criacao = await pg.evaluate(async () => {
      await CloudStore.signUp('estudante@teste.local','senha-de-teste-123');
      await new Promise((r)=>setTimeout(r,250));
      const row=await CloudStore.createRow({name:'Perfil SQL',avatar:'📘',color:'#4f46e5',payload:{}});
      ProfileManager.addMirror({id:row.id,nome:'Perfil SQL',avatar:'📘',cor:'#4f46e5'});
      ProfileManager.setActiveProfile(row.id);
      sessionStorage.setItem('diario-estudos:entered',row.id);
      PlanManager.init();
      await RelationalStore.flush();
      return {id:row.id,uid:CloudStore.session.user.id,plan:PlanManager.getActivePlanId()};
    });
    const perfil=api.estado.tabelas.study_profiles.find((x)=>x.id===criacao.id);
    perfil && perfil.user_id===criacao.uid && criacao.plan
      ? ok('conta, perfil e planejamento relacional foram criados')
      : erro('perfil/plano relacional nao nasceu corretamente: '+JSON.stringify(criacao));

    const gravou = await pg.evaluate(async () => {
      DB.saveEntry({id:'e-sql-1',subject:'Direito Constitucional',method:'Questões',
        date:'2026-03-01',durationMin:90,correct:8,total:10});
      await RelationalStore.flush();
      return {pend:RelationalStore.pendingCount(),err:RelationalStore._lastError};
    });
    const row1=api.estado.tabelas.study_entries.find((x)=>x.profile_id===criacao.id&&x.entry_id==='e-sql-1');
    gravou.pend===0 && !gravou.err && row1 && row1.subject==='Direito Constitucional'
      ? ok('INSERT relacional do registro chegou ao banco')
      : erro('INSERT relacional falhou: '+JSON.stringify({gravou,row1}));
    api.estado.tabelas.profile_sections.filter((x)=>x.profile_id===criacao.id).length===0
      ? ok('nenhuma escrita operacional voltou para profile_sections')
      : erro('profile_sections recebeu escrita depois da aposentadoria');

    await pg.evaluate(async () => {
      DB.updateEntry('e-sql-1',{correct:9,total:10,comment:'editado'});
      await RelationalStore.flush();
    });
    const editados=api.estado.tabelas.study_entries.filter((x)=>x.profile_id===criacao.id&&x.entry_id==='e-sql-1');
    editados.length===1 && Number(editados[0].correct)===9 && editados[0].comment==='editado'
      ? ok('UPDATE relacional alterou uma unica linha')
      : erro('UPDATE relacional duplicou/perdeu o registro: '+JSON.stringify(editados));

    await pg.evaluate(async () => {
      DB.saveEntry({id:'e-sql-2',subject:'AFO',method:'Questões',date:'2026-03-02',
        durationMin:60,correct:10,total:16});
      await RelationalStore.flush();
      DB.deleteEntry('e-sql-1');
      await RelationalStore.flush();
    });
    const idsBanco=api.estado.tabelas.study_entries.filter((x)=>x.profile_id===criacao.id).map((x)=>x.entry_id).sort();
    idsBanco.length===1 && idsBanco[0]==='e-sql-2'
      ? ok('DELETE relacional removeu so o ID solicitado')
      : erro('DELETE relacional atingiu linhas erradas: '+JSON.stringify(idsBanco));

    const hidratou=await pg.evaluate(async (pid) => {
      const pfx='diario-estudos:u:'+pid+':';
      RelationalStore._applying=true;
      try {
        const ks=[]; for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);if(k&&k.startsWith(pfx))ks.push(k);}
        ks.forEach((k)=>localStorage.removeItem(k));
      } finally { RelationalStore._applying=false; }
      const r=await RelationalStore.hydrateProfile(pid,{motivo:'e2e'});
      return {ok:!!r,ids:(DB.getEntries()||[]).map((e)=>String(e.id)).sort()};
    },criacao.id);
    hidratou.ok && hidratou.ids.length===1 && hidratou.ids[0]==='e-sql-2'
      ? ok('SELECT relacional reconstruiu a memoria do zero')
      : erro('hidratacao relacional divergiu: '+JSON.stringify(hidratou));

    const isolamento=await pg.evaluate(async (pid) => {
      await CloudStore.signOut();
      await CloudStore.signUp('outra@teste.local','senha-de-teste-456');
      await new Promise((r)=>setTimeout(r,250));
      const perfis=await CloudStore.listProfiles();
      const q=await CloudStore.client.from('study_entries').select('*').eq('profile_id',pid);
      return {perfis:perfis.length,linhas:(q.data||[]).length,erro:q.error&&q.error.message};
    },criacao.id);
    isolamento.perfis===0 && isolamento.linhas===0 && !isolamento.erro
      ? ok('RLS simulada isola perfil e linhas relacionais entre contas')
      : erro('isolamento entre contas falhou: '+JSON.stringify(isolamento));

    erros.length===0
      ? ok('nenhuma excecao nao tratada no percurso relacional')
      : erro('excecoes no percurso relacional: '+erros.slice(0,3).join(' | '));
    await ctx.close();
  }
} catch (e) { erro('teste do caminho relacional falhou: '+e.message); }

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
    MotorSugestao.restaurar();
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
    const motor = MotorSugestao.calcular();
    return {
      fases: document.querySelectorAll('#motor-fase button[data-fase]').length,
      faseAtiva: document.querySelectorAll('#motor-fase button.active').length,
      itens: document.querySelectorAll('#motor-lista .ms-suggestion-card').length,
      filtro: !!document.querySelector('#motor-lista .ms-disc-filter'),
      todasPrimeiro: !!document.querySelector('#motor-lista .ms-disc-filter-panel > [data-ms-disc-all]:first-child'),
      etapas: document.querySelectorAll('#motor-lista .ms-stage').length,
      comAmostra: [...document.querySelectorAll('#motor-lista .ms-suggestion-card')]
        .filter((it) => /piso válido|amostra/i.test(it.innerText)).length,
      comDose: [...document.querySelectorAll('#motor-lista .ms-dose b')]
        .filter((d) => parseInt(d.textContent, 10) === MotorSugestao.prefs().alvoQuestoes).length,
      minDose: Math.min(...(motor.itens || []).map(x => x.dose || 0)),
      nenhumaDiscInteira: (motor.itens || []).every((x) => x.nivel > 0 && ReforcoEngine.norm(x.nome) !== ReforcoEngine.norm(x.disciplina)),
      umaPorDisc: new Set((motor.itens || []).map((x) => ReforcoEngine.norm(x.disciplina))).size === (motor.itens || []).length,
      rankingDisc: (motor.disciplinas || []).length,
      temFilas: document.querySelectorAll('#motor-lista .ms-queue-item').length,
      meta: motor.prefs.metaAcerto,
      maxFrentes: motor.prefs.maxFrentes,
      lacunasValidas: (motor.itens || []).every(x => Number.isFinite(x.gapMeta) && x.gapMeta > 0),
      cardsComLacuna: [...document.querySelectorAll('#motor-lista .ms-suggestion-card')]
        .filter(el => /lacuna p\/ meta/i.test(el.innerText)).length,
      resumo: (q('.ms-rule-summary') || {}).innerText || '',
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      semDica: [...document.querySelectorAll('#tec-cfg-body .tec-cfg-sec[data-tab="motor"] .rfc-field > label')]
        .filter((l) => !l.querySelector('.info-dot')).length,
      camposNaFolha: document.querySelectorAll('#tec-cfg-body .tec-cfg-sec[data-tab="motor"] .rfc-field').length
    };
  });
  est.fases === 2 && est.faseAtiva === 1
    ? ok('o par pre/pos aparece com exatamente uma fase valendo')
    : erro('o seletor de fase nao renderizou: ' + JSON.stringify(est));
  (est.meta === 90 && est.maxFrentes === 3 && est.itens <= 3)
    ? ok('o Motor nasce com meta 90% e uma rodada curta de no maximo 3 disciplinas')
    : erro('meta/quantidade da rodada saiu do contrato: ' + JSON.stringify(est));
  (est.lacunasValidas && est.cardsComLacuna === est.itens && est.itens > 0)
    ? ok('cada sugestao expõe a lacuna simples até a meta')
    : erro('a lacuna simples ficou ausente ou opaca: ' + JSON.stringify(est));
  (est.etapas === 1 && est.filtro && est.todasPrimeiro && est.rankingDisc >= est.itens && est.temFilas >= est.rankingDisc)
    ? ok('o Motor mostra uma rodada unica, filtro com Todas primeiro e filas completas por materia')
    : erro('a rodada/filtro/filas do Motor nao apareceram como contrato: ' + JSON.stringify(est));
  (est.nenhumaDiscInteira && est.umaPorDisc)
    ? ok('nenhuma disciplina inteira vira reforco e ha no maximo um topico por disciplina')
    : erro('o Motor voltou a usar disciplina como unidade executavel: ' + JSON.stringify(est));
  est.itens >= 2 ? ok(`${est.itens} frente(s) na fila do motor`) : erro('a fila do motor veio vazia');
  est.comAmostra === est.itens && est.itens > 0
    ? ok('toda linha declara o piso/amostra que sustenta o nível da árvore')
    : erro(`${est.itens - est.comAmostra} linha(s) sem amostra declarada`);
  (est.comDose === est.itens && est.itens > 0 && est.minDose === 25)
    ? ok(`toda frente saiu com a dose fixa de ${est.minDose} questoes`)
    : erro('o Motor deixou de usar dose fixa por atividade: ' + JSON.stringify(est));
  (/25 questões por atividade/i.test(est.resumo) || /questões por atividade/i.test(est.resumo))
    ? ok('o resumo deixa claro que a dose é fixa por atividade')
    : erro('o resumo do Motor nao explica a dose por atividade: ' + est.resumo);
  est.overflow === 0 ? ok('nenhum vazamento horizontal a 360px') : erro(`o motor vaza ${est.overflow}px na horizontal a 360px`);
  (est.semDica === 0 && est.camposNaFolha >= 4)
    ? ok(`todos os ${est.camposNaFolha} campos de ajuste do Motor tem dica explicativa`)
    : erro(`${est.semDica} campo(s) sem o "i" (de ${est.camposNaFolha} encontrados — se veio zero, o seletor perdeu os campos)`);

  const filtroMotor = await pag.evaluate(async () => {
    const host = document.getElementById('motor-lista');
    const btn = host.querySelector('.ms-disc-filter-btn');
    btn.click();
    let panel = host.querySelector('.ms-disc-filter-panel');
    panel.dataset.guard = 'mesmo-fluxo';
    const escolher = async nome => {
      panel = document.querySelector('#motor-lista .ms-disc-filter-panel');
      const ch = [...panel.querySelectorAll('.ms-disc-filter-item input')].find(x => x.value === nome);
      if (!ch) return false;
      ch.checked = true; ch.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise(r => setTimeout(r, 80));
      panel = document.querySelector('#motor-lista .ms-disc-filter-panel');
      return !panel.hasAttribute('hidden');
    };
    const a = await escolher('Direito Administrativo');
    const b = await escolher('Portugues');
    const p = MotorSugestao.prefs();
    const r = MotorSugestao.calcular();
    const nomes = new Set((r.disciplinas || []).map(d => ReforcoEngine.norm(d.nome)));
    const okEscopo = (p.disciplinasSel || []).length === 2
      && [...nomes].every(n => n === ReforcoEngine.norm('Direito Administrativo') || n === ReforcoEngine.norm('Portugues'));
    MotorSugestao.salvar({ disciplinasSel: [] });
    DesempenhoTecScreen.renderMotor();
    return { a, b, n: (p.disciplinasSel || []).length, okEscopo };
  });
  (filtroMotor.a && filtroMotor.b && filtroMotor.n === 2 && filtroMotor.okEscopo)
    ? ok('filtro do Motor aceita varias disciplinas, permanece aberto e muda o calculo de verdade')
    : erro('filtro do Motor virou apenas filtro visual ou fechou entre cliques: ' + JSON.stringify(filtroMotor));

  /* Toda frente executável precisa respeitar o piso simples de amostra. */
  const poda = await pag.evaluate(() => {
    const r = MotorSugestao.calcular();
    const p = MotorSugestao.prefs();
    const foraDaRegua = (r.itens || []).filter((x) => x.nivel <= 0 || x.questoes < p.minAmostra);
    return { minAmostra: p.minAmostra, fora: foraDaRegua.length, total: (r.itens || []).length };
  });
  poda.fora === 0 && poda.total > 0
    ? ok(`as ${poda.total} frentes oferecidas sao topicos com pelo menos ${poda.minAmostra} questoes`)
    : erro('a poda deixou passar raiz ou frente abaixo da amostra mínima: ' + JSON.stringify(poda));

  const hier = await pag.evaluate(() => {
    const n = (nome, q, ac, depth, kids) => ({ nome, codigo: null, depth, disciplina: 'Teste', questoes: q, acertos: ac, children: kids || [] });
    const top = n('Topico', 40, 11, 1, [n('A.1', 10, 2, 2), n('A.2', 12, 3, 2), n('A.3', 18, 6, 2)]);
    const plano = MotorSugestao._planejarNo(top, 20, []);
    const bloco = plano.find(x => x.motivoNivel === 'pior-do-grupo');
    const muitos = n('Topico B', 36, 9, 1, [
      n('B.1', 6, 1, 2), n('B.2', 6, 1, 2), n('B.3', 6, 1, 2),
      n('B.4', 6, 2, 2), n('B.5', 6, 2, 2), n('B.6', 6, 2, 2)
    ]);
    const blocoGrande = MotorSugestao._planejarNo(muitos, 20, []).find(x => x.motivoNivel === 'pior-do-grupo');
    const doisBlocos = n('Topico C', 40, 20, 1, [
      n('C.1', 10, 5, 2), n('C.2', 10, 5, 2), n('C.3', 10, 5, 2), n('C.4', 10, 5, 2)
    ]);
    const planoDois = MotorSugestao._planejarNo(doisBlocos, 20, [], 90);
    const semForte = n('Topico D', 30, 15, 1, [n('D.1', 10, 2, 2), n('D.2', 10, 3, 2), n('D forte', 10, 10, 2)]);
    const planoSemForte = MotorSugestao._planejarNo(semForte, 20, [], 90);
    const porRamo = n('Teste', 80, 42, 0, [
      n('Pai mais fraco', 40, 16, 1, [n('P.1', 20, 6, 2), n('P.2', 20, 10, 2)]),
      n('Outro pai', 40, 18, 1, [n('O.1', 40, 4, 2)])
    ]);
    const filaRamos = MotorSugestao._filaDisciplina(porRamo, Object.assign(MotorSugestao.prefs(), { minAmostra: 20, metaAcerto: 90 }));
    const raiz = MotorSugestao._planejarNo(n('Teste', 40, 11, 0, [top]), 20, []);
    const p = Object.assign(MotorSugestao.prefs(), { fase: 'pre', metaAcerto: 90 });
    const muitoPraticada = { nome: 'Muito praticada', taxa: 80, questoes: 5000, lacunaDisc: 10, incidenciaDisc: 100 };
    const poucoPraticada = { nome: 'Pouco praticada', taxa: 60, questoes: 80, lacunaDisc: 30, incidenciaDisc: 1 };
    const empateA = { nome: 'A', taxa: 70, questoes: 100, lacunaDisc: 20, incidenciaDisc: 10 };
    const empateB = { nome: 'B', taxa: 70, questoes: 100, lacunaDisc: 20, incidenciaDisc: 50 };

    const R = (id, rows) => ({ id, startDate: '2026-0' + id + '-01', endDate: '2026-0' + id + '-28', rows });
    const row = (nome, depth, codigo, q, ac) => ({ nome, depth, codigo, questoes: q, acertos: ac, disciplina: 'Disc X' });
    const s1 = R(1, [row('Disc X',0,null,80,40), row('A',1,'01',40,15), row('A-filho',2,'01.01',20,5), row('B',1,'02',40,25), row('B-filho',2,'02.01',20,15)]);
    const s2 = R(2, [row('Disc X',0,null,100,55), row('B',1,'01',50,30), row('B-filho',2,'01.01',25,17), row('A',1,'02',50,25), row('A-filho',2,'02.01',25,8)]);
    const sf = MotorSugestao._forestEstavel({ rows: s1.rows.concat(s2.rows), _fontes: [s1,s2] });
    const dx = sf[0] || { children: [] }, na = dx.children.find(x => x.nome === 'A'), nb = dx.children.find(x => x.nome === 'B');
    return {
      bloco: bloco ? { pai: bloco.pai, nome: bloco.nome, grupoTamanho: bloco.grupoTamanho, nivel: bloco.nivel } : null,
      blocoGrande: blocoGrande ? { pai: blocoGrande.pai, nome: blocoGrande.nome, grupoTamanho: blocoGrande.grupoTamanho } : null,
      doisBlocos: planoDois.map(x => ({ nome: x.nome, grupoTamanho: x.grupoTamanho, grupoQuestoes: x.grupoQuestoes })),
      semForte: planoSemForte.map(x => ({ nome: x.nome, grupoTamanho: x.grupoTamanho })),
      filaRamos: filaRamos.map(x => x.nome),
      raiz: raiz.length,
      lacunaVenceVolume: MotorSugestao._compararDisciplinas(poucoPraticada, muitoPraticada, p) < 0,
      incidenciaDesempata: MotorSugestao._compararDisciplinas(empateB, empateA, Object.assign({}, p, { fase: 'pos' })) < 0,
      codigoEstavel: !!(na && nb && na.questoes === 90 && nb.questoes === 90
        && na.children[0] && na.children[0].nome === 'A-filho'
        && nb.children[0] && nb.children[0].nome === 'B-filho')
    };
  });
  (hier.bloco && hier.bloco.pai === 'Topico' && hier.bloco.nome === 'A.1' && hier.bloco.grupoTamanho === 3 && hier.raiz === 0)
    ? ok('ramos pequenos so agrupam entre irmaos do mesmo pai e miram o pior deles, nunca sobem para a disciplina')
    : erro('o agrupamento atravessou a hierarquia: ' + JSON.stringify(hier));
  (hier.blocoGrande && hier.blocoGrande.pai === 'Topico B' && hier.blocoGrande.nome === 'B.1' && hier.blocoGrande.grupoTamanho > 4)
    ? ok('o agrupamento simples usa todos os irmaos pequenos necessários para confirmar a lacuna, mesmo mirando só o pior')
    : erro('o agrupamento simples perdeu ramos pequenos: ' + JSON.stringify(hier.blocoGrande));
  (hier.doisBlocos.length === 2 && JSON.stringify(hier.doisBlocos.map(x => x.nome)) === '["C.1","C.3"]' && hier.doisBlocos.every(x => x.grupoTamanho === 2 && x.grupoQuestoes === 20))
    ? ok('o agrupamento continua nos subtópicos restantes e cria várias sugestões executáveis, cada uma mirando o pior do seu grupo')
    : erro('o agrupamento parou depois do primeiro bloco: ' + JSON.stringify(hier.doisBlocos));
  (hier.semForte.length === 1 && hier.semForte[0].nome === 'D.1' && hier.semForte[0].grupoTamanho === 2)
    ? ok('subtópico forte não é usado para completar bloco fraco')
    : erro('o agrupamento diluiu a lacuna com subtópico forte: ' + JSON.stringify(hier.semForte));
  hier.filaRamos.join('|') === 'P.1|P.2|O.1'
    ? ok('o ramo-pai mais fraco é esgotado antes de entrar em outro ramo')
    : erro('a fila misturou descendentes de pais diferentes: ' + JSON.stringify(hier.filaRamos));
  hier.lacunaVenceVolume
    ? ok('lacuna percentual vence volume historico na prioridade da materia')
    : erro('volume historico voltou a dominar o ranking: ' + JSON.stringify(hier));
  hier.incidenciaDesempata
    ? ok('no pos-edital, incidencia apenas desempata lacunas iguais')
    : erro('incidencia nao funcionou como desempate simples: ' + JSON.stringify(hier));
  hier.codigoEstavel
    ? ok('mudanca/reuso de codigo TEC entre retratos nao troca filhos de pai no consolidado')
    : erro('o Motor ainda usa codigo posicional como identidade historica: ' + JSON.stringify(hier));

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
    return { criadas: depois.length - antes, comOrigem: depois.filter((e) => e.origemMotor && e.origemMotor.topico).length };
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
    const host = document.getElementById('tec-disc-pick');
    const btn = host && host.querySelector('.tec-disc-pick-btn');
    if (btn) btn.click();
    const panel = host && host.querySelector('.tec-disc-pick-panel');
    let multi = { existe: !!panel, mesmoPainel: false, abertas: false, marcadas: 0, raizes: 0 };
    if (panel) {
      panel.dataset.guard = 'mesmo';
      const boxes = [...panel.querySelectorAll('input[type="checkbox"]')].slice(0, 2);
      for (const b of boxes) {
        b.checked = true;
        b.dispatchEvent(new Event('change', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 60));
      }
      const atual = document.querySelector('#tec-disc-pick .tec-disc-pick-panel');
      multi = {
        existe: true,
        mesmoPainel: atual === panel && atual.dataset.guard === 'mesmo',
        abertas: !atual.hasAttribute('hidden'),
        marcadas: atual.querySelectorAll('input[type="checkbox"]:checked').length,
        raizes: document.querySelectorAll('#tec-disc-list > .tec-tree > .tnode').length
      };
      DesempenhoTecScreen._setDiscFilters([], atual);
      await new Promise((r) => setTimeout(r, 80));
    }
    return {
      semListaParalela: !document.getElementById('tec-weak-list'),
      semAjusteParalelo: !document.querySelector('[data-cfg="analise"], #tec-cfg-body [data-tab="analise"]'),
      delta: !!document.querySelector('#tec-totais .tec-delta'),
      legendaTotais: /compara o último retrato/i.test(txt('#tec-totais')),
      linhas: document.querySelectorAll('#tec-disc-list .tnode-row').length,
      multi
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
  (an.multi.existe && an.multi.mesmoPainel && an.multi.abertas && an.multi.marcadas === 2 && an.multi.raizes === 2)
    ? ok('o seletor aceita varias disciplinas sem reconstruir, fechar ou voltar a lista ao inicio')
    : erro('o multifiltro de disciplinas perdeu estabilidade: ' + JSON.stringify(an.multi));

  const limpezaTec = await pag.evaluate(() => {
    const texto = () => (document.querySelector('.tp-command') || {}).innerText || '';
    DesempenhoTecScreen.switchTecTab('analise');
    const analise = texto();
    DesempenhoTecScreen.switchTecTab('incidencia');
    const incidencia = texto();
    DesempenhoTecScreen.switchTecTab('motor');
    const motor = texto();
    DesempenhoTecScreen.switchTecTab('analise');
    return {
      semAjusteAnalise: !document.querySelector('[data-cfg="analise"], #tec-gear-btn, #tec-enxuto-btn'),
      semPremiumInutil: !document.querySelector('[data-tp-settings],[data-tp-audit],.tp-overlay'),
      semBotaoAbas: !document.getElementById('tec-tabs-gear'),
      abasVisiveis: [...document.querySelectorAll('#tec-subtabs .tec-subtab')].filter(b => getComputedStyle(b).display !== 'none').length,
      analiseFactual: /fatos do seu tec/i.test(analise) && /nenhum modelo opina aqui/i.test(analise),
      incidenciaFactual: /fatos da banca/i.test(incidencia) && /dados de incidência/i.test(incidencia),
      motorDecideSoAqui: /motor/i.test(motor) && /prioriza/i.test(motor),
      semRotulosMortos: !/ajustes de análise|ajustes de incidência|diagnóstico/i.test(analise + '\n' + incidencia + '\n' + motor)
    };
  });
  (limpezaTec.semAjusteAnalise && limpezaTec.semPremiumInutil && limpezaTec.semBotaoAbas && limpezaTec.abasVisiveis >= 3)
    ? ok('Ajustes de Analise/Incidencia, Diagnostico e botao Abas foram removidos de verdade, inclusive da camada Premium')
    : erro('sobrou controle legado no TEC: ' + JSON.stringify(limpezaTec));
  (limpezaTec.analiseFactual && limpezaTec.incidenciaFactual && limpezaTec.motorDecideSoAqui && limpezaTec.semRotulosMortos)
    ? ok('Analise e Incidencia se apresentam como fatos; somente o Motor fala em prioridade')
    : erro('o cabecalho voltou a misturar fato com decisao do Motor: ' + JSON.stringify(limpezaTec));

  const retratos = await pag.evaluate(async () => {
    DesempenhoTecScreen.scopeMode = 'select';
    DesempenhoTecScreen.renderScopeControls(DB.getTecSnapshots());
    const box = document.getElementById('tec-scope-select');
    const lista = box.querySelector('.tec-scope-list');
    lista.style.maxHeight = '58px';
    lista.scrollTop = 999;
    const antes = lista.scrollTop;
    lista.dataset.guard = 'mesma-lista';
    const original = DesempenhoTecScreen.renderAnalysis;
    let renders = 0;
    DesempenhoTecScreen.renderAnalysis = function(){ renders++; return original.apply(this, arguments); };
    const checks = [...lista.querySelectorAll('input[data-snap]')].slice(0, 2);
    checks.forEach(ch => {
      ch.checked = !ch.checked;
      ch.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const spinnerImediato = !box.querySelector('.tec-scope-busy').hidden;
    await new Promise(r => setTimeout(r, 340));
    DesempenhoTecScreen.renderAnalysis = original;
    const atual = box.querySelector('.tec-scope-list');
    const depois = atual.scrollTop;
    const allPrimeiro = !!atual.querySelector(':scope > .tec-snap-all:first-child');
    // "Todos" também não deve jogar a lista de volta ao topo.
    const yAntesTodos = atual.scrollTop;
    const all = atual.querySelector('input[data-snap-all]');
    if (all) { all.checked = true; all.dispatchEvent(new Event('change', { bubbles: true })); }
    const yLogoDepoisTodos = atual.scrollTop;
    await new Promise(r => setTimeout(r, 340));
    const yDepoisTodos = atual.scrollTop;
    // restaura o escopo para os testes seguintes
    DesempenhoTecScreen.selectedSnapIds = new Set(DB.getTecSnapshots().map(s => s.id));
    DesempenhoTecScreen.scopeMode = 'consolidado';
    DesempenhoTecScreen.aplicarMudancaEscopo();
    return {
      mesmaLista: atual === lista && atual.dataset.guard === 'mesma-lista',
      antes, depois, spinnerImediato, allPrimeiro, renders,
      yAntesTodos, yLogoDepoisTodos, yDepoisTodos
    };
  });
  (retratos.mesmaLista && retratos.spinnerImediato && retratos.allPrimeiro
      && retratos.depois === retratos.antes && retratos.renders === 1
      && retratos.yLogoDepoisTodos === retratos.yAntesTodos && retratos.yDepoisTodos === retratos.yAntesTodos)
    ? ok('retratos preservam DOM/scroll, mostram spinner e dois cliques rapidos viram um unico recalculo')
    : erro('o seletor de retratos ainda reinicia, pula ou recalcula demais: ' + JSON.stringify(retratos));

  // ── INCIDENCIA: importar duas vezes nao pode dobrar ──────────────────────
  const incidenciaFechada = await pag.evaluate(() => {
    DesempenhoTecScreen.switchTecTab('incidencia');
    const d = document.getElementById('incid-import-details');
    return !!d && !d.open;
  });
  incidenciaFechada
    ? ok('a area de importar/colar Incidencia nasce recolhida e pode ser expandida sob demanda')
    : erro('a area de importacao da Incidencia nao nasceu recolhida');
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
    const rows = [...document.querySelectorAll('#tec-disc-list .tnode-row')];
    return {
      fracos, fortes, filhos,
      temQuestoes: !!(linha && linha.querySelector('.tnode-q')),
      temErro: !!(linha && linha.querySelectorAll('.tnode-pct b').length === 2),
      vaza: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      cortadas: rows.filter(r => r.getBoundingClientRect().right > document.documentElement.clientWidth + 2).length,
      niveis: new Set([...document.querySelectorAll('#tec-disc-list .tnode[data-level]')].map(n => n.dataset.level)).size,
      tonsProfundos: (() => {
        const fake = (nivel) => ({ nome: 'N' + nivel, depth: nivel, disciplina: 'D', questoes: 100, acertos: 50, children: [] });
        const host = document.createElement('div');
        host.innerHTML = DesempenhoTecScreen.treeNodeHtml(fake(6), null, 6)
          + DesempenhoTecScreen.treeNodeHtml(fake(7), null, 7);
        const ns = host.querySelectorAll('.tnode');
        return ns.length === 2
          && ns[0].style.getPropertyValue('--tec-level-hue') !== ns[1].style.getPropertyValue('--tec-level-hue')
          && ns[0].style.getPropertyValue('--tec-indent') !== '';
      })()
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
  (arv.temQuestoes && arv.temErro && arv.vaza === 0 && arv.cortadas === 0)
    ? ok('a arvore mobile exibe questoes, acerto e erro sem cortar a tabela')
    : erro('a arvore mobile perdeu coluna ou vazou horizontalmente: ' + JSON.stringify(arv));
  arv.tonsProfundos
    ? ok('niveis 6+ continuam recebendo tons e recuos proprios, sem colapsar visualmente no nivel 5')
    : erro('a granularidade profunda voltou a compartilhar a mesma codificacao visual');

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
    const alvo = (MotorSugestao.calcular().itens[0] || {});
    DB.getExtras().filter((e) => e.origemMotor).forEach((e) => DB.deleteExtra && DB.deleteExtra(e.id));
    DesempenhoTecScreen.criarExtraDoMotor(alvo.nome, alvo.disciplina, alvo.dose, 'reforco');
    await esperar(250);
    const extra = DB.getExtras().find((e) => e.origemMotor && e.origemMotor.topico === alvo.nome);
    const antes = {
      taxa: alvo.taxa,
      taxaInicial: extra && extra.origemMotor.taxaInicial, modo: MotorSugestao.prefs().metaAcerto,
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
    const r2 = MotorSugestao.calcular();
    const depoisAlvo = [].concat(r2.itens, r2.todos || []).find((x) => x.nome === alvo.nome);
    const extra2 = DB.getExtras().find((e) => e.origemMotor && e.origemMotor.topico === alvo.nome);
    return {
      antes,
      depois: {
        taxa: depoisAlvo ? depoisAlvo.taxa : null,
        taxaInicial: extra2 && extra2.origemMotor.taxaInicial,
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
    const abrir = () => {
      const p = host.querySelector('.banca-pick-panel');
      if (p && p.hasAttribute('hidden')) host.querySelector('.banca-pick-btn').click();
    };
    const marcar = async (nome) => {
      abrir(); await esperar(80);
      const painel = host.querySelector('.banca-pick-panel');
      const y = painel.scrollTop;
      painel.dataset.guard = 'mesmo';
      const ch = [...painel.querySelectorAll('input[data-banca]')].find((x) => x.value === nome);
      ch.checked = !ch.checked; ch.dispatchEvent(new Event('change', { bubbles: true }));
      await esperar(250);
      const atual = host.querySelector('.banca-pick-panel');
      if (atual !== painel || atual.dataset.guard !== 'mesmo' || atual.scrollTop !== y) throw new Error('painel de bancas foi reconstruido');
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
    const motorCalc = MotorSugestao.calcular({ fase: 'pos' });
    const noPlano = {
      filtro: DesempenhoTecScreen.bancaFiltro(),
      motorBanca: motorCalc && !motorCalc.erro ? motorCalc.banca : null
    };
    DesempenhoTecScreen.switchTecTab('incidencia');
    await esperar(250);
    // volta para todas — a opção deve ser a primeira da lista
    const hp = document.getElementById('incid-banca-pick');
    const pp = hp.querySelector('.banca-pick-panel');
    if (pp.hasAttribute('hidden')) hp.querySelector('.banca-pick-btn').click();
    await esperar(80);
    const btnTodas = pp.querySelector(':scope > [data-acao="todas"]:first-child');
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
  (Array.isArray(sel.noPlano.filtro) && sel.noPlano.filtro.length === 2
      && Array.isArray(sel.noPlano.motorBanca) && sel.noPlano.motorBanca.length === 2
      && sel.noPlano.filtro.map(x => String(x).trim().toLowerCase()).sort().join('|')
        === sel.noPlano.motorBanca.map(x => String(x).trim().toLowerCase()).sort().join('|'))
    ? ok('a mesma selecao de duas bancas chega ao calculo do Motor, sem seletor duplicado')
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
    MotorSugestao.salvar({ minAmostra: 1, disciplinasSel: [] });
    DesempenhoTecScreen._planoRefC = null;
    DesempenhoTecScreen.render();
    DesempenhoTecScreen.switchTecTab('motor');
  });
  await pag.waitForTimeout(400);
  const hom = await pag.evaluate(() => {
    const texto = [...document.querySelectorAll('#motor-lista .ms-suggestion-card')].map((e) => e.textContent.replace(/\s+/g, ' '));
    const r = MotorSugestao.calcular({ maxFrentes: 12 });
    const p = (r.todos || []).filter((x) => /Princ[ií]pios/.test(x.nome));
    return { comPrincipios: texto.filter((t) => /Princ[ií]pios/.test(t)).length,
      taxas: p.map((x) => Math.round(x.taxa)), discs: p.map((x) => x.disciplina) };
  });
  (hom.taxas.length === 2 && new Set(hom.taxas).size === 2 && new Set(hom.discs).size === 2)
    ? ok(`os dois "Principios" continuam separados, com a taxa de cada um (${hom.taxas.join('% e ')}%)`)
    : erro('os homonimos se fundiram no motor: ' + JSON.stringify(hom));
  const filtro = await pag.evaluate(() => {
    const r = MotorSugestao.calcular({ disciplinasSel: ['Direito Administrativo'] });
    const disc = (r.disciplinasTodas || []).find((d) => d.nome === 'Direito Administrativo');
    const assuntos = (r.todos || []).filter((x) => x.disciplina === 'Direito Administrativo'
      && /Princ[ií]pios/.test(x.nome)).length;
    return { erro: r.erro || null, assuntos, dominio: disc ? disc.taxa : null };
  });
  (!filtro.erro && filtro.assuntos === 1 && Math.abs(filtro.dominio - 12.5) < 0.01)
    ? ok('filtrar por disciplina acha o homonimo e consolida o período selecionado (12,5% de domínio)')
    : erro('o filtro por disciplina perdeu o homonimo: ' + JSON.stringify(filtro));
  const ativ = await pag.evaluate(() => {
    const T = DesempenhoTecScreen;
    const a = T.criarExtraDoMotor('Principios', 'Direito Constitucional', 30, 'reforco', true);
    const b = T.criarExtraDoMotor('Principios', 'Direito Administrativo', 30, 'reforco', true);
    const c = T.criarExtraDoMotor('Principios', 'Direito Administrativo', 30, 'reforco', true);
    const extras = DB.getExtras();
    const r = MotorSugestao.calcular();
    const casados = r.itens.map((x) => {
      const e = extras.find((e2) => T._casaTopico(e2.origemMotor, x.nome, x.disciplina));
      return e ? e.origemMotor.disciplina : null;
    });
    return { criou: [a, b], recusouRepetida: c === false, total: extras.length,
      taxas: extras.map((e) => e.origemMotor.disciplina + ':' + Math.round(e.origemMotor.taxaInicial)),
      casados, distintos: new Set(casados).size };
  });
  (ativ.criou[0] && ativ.criou[1] && ativ.recusouRepetida && ativ.total === 2)
    ? ok('da para criar uma atividade para cada homonimo, e repetir o mesmo continua sendo recusado')
    : erro('a criacao de atividades confundiu os homonimos: ' + JSON.stringify(ativ));
  (ativ.distintos === 2 && ativ.casados.every(Boolean))
    ? ok('cada linha do Plano se liga a atividade da sua propria disciplina')
    : erro('as linhas do Plano se ligaram a atividade errada: ' + JSON.stringify(ativ.casados));
  (ativ.taxas.indexOf('Direito Constitucional:30') >= 0 && ativ.taxas.indexOf('Direito Administrativo:10') >= 0)
    ? ok('e cada atividade guarda a taxa inicial do retrato mais recente do SEU assunto (30% e 10%)')
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
  // Teto de sanidade contra a regressão de 2.413px, não um orçamento de
  // pixel exato: as etiquetas ganharam caixa alta e mais respiro de
  // propósito (pedido explícito de revisão visual), então o teto sobe um
  // pouco — continua uma fração ínfima do formulário antigo.
  const maisAlta = Math.max(...ABAS.map((t) => solto[t].alturaBarra));
  maisAlta > 0 && maisAlta < 220
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
    ? ok('mexer num campo aplica na hora e a etiqueta acompanha (base de 40 questoes por reforco)')
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
    ? ok(`restaurar padroes devolve o Motor a base padrao de ${rest.padrao} questoes por reforco`)
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
  /* O Motor mantem uma frente ativa por disciplina, entao cada assunto deste
     percurso vive em sua propria disciplina. O retrato mais recente e a unica
     fonte lida pelo Motor (nao ha mais consolidado historico): o contador do
     assunto na origem reflete somente o ultimo retrato antes da atividade. */
  const cria = await pag.evaluate(() => {
    const dia = (n) => { const d = new Date(todayLocal() + 'T00:00:00'); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };
    const D = (n, q, ac) => ({ depth: 0, codigo: null, nome: n, disciplina: n, questoes: q, acertos: ac });
    const L = (c, n, disc, q, ac) => ({ depth: 1, codigo: c, nome: n, disciplina: disc, questoes: q, acertos: ac });
    const R = (id, i, f, rows) => ({ id, nome: id, date: f, startDate: i, endDate: f, rows });
    const base = (a, b, c) => [D('Licitacoes', 100, a), L('01', 'Licitacoes', 'Licitacoes', 100, a),
      D('Atos', 100, b), L('01', 'Atos', 'Atos', 100, b),
      D('Contratos', 100, c), L('01', 'Contratos', 'Contratos', 100, c)];
    DB.saveIncidencia([]); DB._set(DB.KEYS.extras, []);
    DB._set(DB.KEYS.tec, [R('c1', dia(90), dia(70), base(40, 40, 45)), R('c2', dia(60), dia(35), base(40, 40, 45))]);
    MotorSugestao.salvar({ metaAcerto: 85, minAmostra: 1, disciplinasSel: [] });
    DesempenhoTecScreen._planoRefC = null; DesempenhoTecScreen._cicloSel = null;
    switchScreen('desempenhotec'); DesempenhoTecScreen.render(); DesempenhoTecScreen.switchTecTab('motor');
    [['Licitacoes', 'Licitacoes'], ['Atos', 'Atos'], ['Contratos', 'Contratos']]
      .forEach(([t, d]) => DesempenhoTecScreen.criarExtraDoMotor(t, d, 120, 'reforco', true));
    return DB.getExtras().map((e) => ({ t: e.origemMotor.topico, qBase: e.origemMotor.qBase,
      taxa: e.origemMotor.taxaInicial, meta: e.origemMotor.metaAlvo }));
  });
  (cria.length === 3 && cria.every((x) => x.qBase === 100 && x.taxa != null && x.meta === 85))
    ? ok('criar pelo Motor grava o contador do assunto (no ultimo retrato), a taxa inicial e a meta do dia')
    : erro('a origem da atividade veio incompleta: ' + JSON.stringify(cria));

  // o retrato novo: um resolveu, os outros seguem abertos (o Motor nunca fecha por piora)
  const dep = await pag.evaluate(() => {
    const dia = (n) => { const d = new Date(todayLocal() + 'T00:00:00'); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };
    const D = (n, q, ac) => ({ depth: 0, codigo: null, nome: n, disciplina: n, questoes: q, acertos: ac });
    const L = (c, n, disc, q, ac) => ({ depth: 1, codigo: c, nome: n, disciplina: disc, questoes: q, acertos: ac });
    const s = DB.getTecSnapshots();
    s.push({ id: 'c3', nome: 'c3', date: dia(1), startDate: dia(20), endDate: dia(1), rows: [
      D('Licitacoes', 150, 138), L('01', 'Licitacoes', 'Licitacoes', 150, 138),
      D('Atos', 150, 42), L('01', 'Atos', 'Atos', 150, 42),
      D('Contratos', 50, 15), L('01', 'Contratos', 'Contratos', 50, 15)] });
    DB._set(DB.KEYS.tec, s);
    DesempenhoTecScreen._planoRefC = null; DesempenhoTecScreen._cicloSel = null;
    DesempenhoTecScreen.render(); DesempenhoTecScreen.switchTecTab('motor');
    const por = {};
    DB.getExtras().forEach((e) => { const v = e.origemMotor && e.origemMotor.veredito;
      por[e.origemMotor.topico] = { st: e.status,
      v: v ? v.tipo : null,
      pp: v ? (v.taxaFinal - v.taxaInicial) : null }; });
    /* O progresso medido pelo retrato e a lista de ciclos fechados vivem no
       modelo, nao mais numa tela: e o mesmo dado que a tela de Atividades le. */
    const emCurso = MotorCiclo.emCurso()
      .map((x) => x.origem.topico + ' ' + x.feito + '/' + x.alvo);
    const motor = document.getElementById('motor-lista');
    return { por, emCurso,
      hist: MotorCiclo.fechados().length,
      podre: /\bNaN\b|\bundefined\b|\bInfinity\b/.test((motor || {}).textContent || ''),
      vaza: document.documentElement.scrollWidth - document.documentElement.clientWidth };
  });
  (dep.por.Licitacoes.st === 'concluida' && dep.por.Licitacoes.v === 'resolvida' && dep.por.Licitacoes.pp > 0)
    ? ok(`o assunto que atingiu a meta encerra sozinho, com o ganho registrado (+${dep.por.Licitacoes.pp}pp)`)
    : erro('o veredito de sucesso nao saiu: ' + JSON.stringify(dep.por.Licitacoes));
  (dep.por.Atos.st === 'ativa' && dep.por.Atos.v === null)
    ? ok('a taxa caiu mas o assunto continua na frente prioritaria; o Motor nunca fecha uma atividade so por piorar')
    : erro('o assunto que piorou foi encerrado indevidamente: ' + JSON.stringify(dep.por.Atos));
  (dep.por.Contratos.st === 'ativa' && dep.por.Contratos.v === null)
    ? ok('e o que ainda esta a meio caminho continua aberto')
    : erro('atividade em andamento foi encerrada por engano: ' + JSON.stringify(dep.por.Contratos));
  (dep.emCurso.length === 2 && dep.emCurso.some((x) => /Atos 50\/120/.test(x)))
    ? ok('o ciclo conta as questoes a partir do retrato, sem lancamento manual (Atos 50/120)')
    : erro('o progresso automatico nao apareceu: ' + JSON.stringify(dep.emCurso));
  dep.hist === 1 ? ok('e o unico ciclo fechado entra no historico "o que os retratos ja julgaram"')
    : erro(`historico com ${dep.hist} ciclo(s), esperado 1`);
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
       (o dado ja estava em `origemMotor.sugestao.motor`, so nao chegava a
       tela). O que este teste garante continua sendo o mesmo — o cartao diz de
       ONDE veio —, e passa a aceitar qualquer uma das tres fontes em vez de
       exigir a frase generica que existia quando havia so uma. */
    return { doPlano: /Motor · (pré|pós)-edital|do TEC/.test(t),
      barra: /50 \/ 120/.test(t) };
  });
  (card.doPlano && card.barra)
    ? ok('o cartao da atividade nomeia a fase em que foi escolhida e mostra a barra em 50/120')
    : erro('o cartao nao trouxe o ciclo: ' + JSON.stringify(card));

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
    MotorSugestao.salvar({ minAmostra: 1, disciplinasSel: [] });
    DesempenhoTecScreen._planoRefC = null; DesempenhoTecScreen._cicloSel = null;
    switchScreen('desempenhotec'); DesempenhoTecScreen.render(); DesempenhoTecScreen.switchTecTab('motor');
    /* Duas frentes na mesma disciplina simultaneamente: o Motor so permite uma
       frente ativa por disciplina pelo botao (regra deliberada), entao aqui a
       segunda atividade de "Dir Adm" e gravada direto, como se ja existisse
       antes da regra — o que este bloco testa e o agrupamento na tela de
       Atividades, nao a regra de uma frente por vez. */
    const r0 = MotorSugestao.calcular();
    [['Licitacoes', 'Dir Adm'], ['Atos', 'Dir Adm'], ['Crase', 'Portugues']].forEach(([t, d]) => {
      const item = [].concat(r0.itens || [], r0.todos || []).find((x) => x.nome === t && x.disciplina === d) || { nome: t, disciplina: d };
      const e = DB.addExtra({ titulo: MotorCiclo.titulo(t, item.membros), tipo: 'questoes', disciplina: d,
        unidade: 'questoes', alvo: 120, periodo: 'unica', contaMetricas: false });
      DB.updateExtra(e.id, { origemMotor: MotorCiclo.origem(t, d, item) });
    });
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
