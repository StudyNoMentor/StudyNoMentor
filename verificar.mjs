Warning: truncated output (original token count: 53000)
Total output lines: 3209

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
    [/navigationPreload/, 'o pre-carregamento de navegacao esta ligado'],
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


/* ── 6.8) O PLANO COM DADO DE VERDADE ──────────────────────────────────────
   A maior tela do app era invisivel para a verificacao: sem retratos
   importados, o painel do Plano nem existe no DOM, entao a navegacao da etapa 6
   e o contraste da etapa 7 passavam por cima dele. Aqui os retratos sinteticos
   entram ANTES da etapa 7 — assim o plano renderizado (modos, bloco da semana,
   explicacao da ordem, lista, fonte explicita das sugestoes e lacunas do edital) tambem e
   medido nos dois temas, sem nenhum checador novo. */
console.log('\n6.8) o Plano de pontos fracos renderiza com dado real');
try {
  await pag.setViewportSize({ width: 360, height: 780 });
  const plano = await pag.evaluate(() => {
    const dia = (n) => { const d = new Date(todayLocal() + 'T00:00:00'); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };
    const L = (c, n, disc, q, ac) => ({ depth: 1, codigo: c, nome: n, disciplina: disc, questoes: q, acertos: ac });
    // linha de DISCIPLINA (o export do TEC traz uma para cada): é dela que saem
    // os totais e é nela que o Reforco procura o desempenho do ramo inteiro
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
    DesempenhoTecScreen.switchTecTab('plano');
    return true;
  });
  await pag.waitForTimeout(500);
  const est = await pag.evaluate(() => {
    const q = (s) => document.querySelector(s);
    const txt = (s) => { const e = q(s); return e ? e.innerText : ''; };
    return {
      modos: document.querySelectorAll('#plano-modos .pl-modo').length,
      dominio: /\d+\.\d%/.test(txt('#plano-proj')) || /% de dom/i.test(txt('#plano-proj')),
      bloco: !!q('.pl-hoje'), ordem: !!q('.pl-ordem'), porque: !!q('.pl-porque'),
      edital: !!q('.pl-edital'), fonte: !!q('[data-tpm-output]') || !!q('[data-tpm-selector]'),
      itens: document.querySelectorAll('#plano-lista .pl-item').length,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      /* Os campos moram na folha de ajustes. Contar `#tec-panel-plano .rfc-field`
         daria zero e o teste passaria sem olhar nada. */
      semDica: [...document.querySelectorAll('#tec-cfg-body .tec-cfg-sec[data-tab="plano"] .rfc-field > label')]
        .filter((l) => !l.querySelector('.info-dot')).length,
      camposNaFolha: document.querySelectorAll('#tec-cfg-body .tec-cfg-sec[data-tab="plano"] .rfc-field').length
    };
  });
  est.modos >= 5 ? ok(`${est.modos} modos de ataque com explicacao propria`) : erro('os modos de ataque nao renderizaram: ' + est.modos);
  (est.bloco && est.ordem && est.porque) ? ok('bloco da semana, explicacao da ordem e "por que o 1o" presentes')
    : erro('faltam blocos do plano: ' + JSON.stringify(est));
  est.itens >= 3 ? ok(`${est.itens} assuntos listados`) : erro('a lista do plano veio vazia');
  est.fonte ? ok('fonte explicita das sugestoes presente') : erro('fonte explicita das sugestoes ausente');
  est.edital ? o…23000 tokens truncated…: Math.round(40 * tx / 100) });
        }
        snapsT.push({ id: 't' + i, nome: 't' + i, date: dia(170 - i * 30), startDate: dia(200 - i * 30), endDate: dia(170 - i * 30), rows: rs });
      }
      DB.getTecSnapshots = () => snapsT;
      DesempenhoTecScreen._planoRefC = null;
      DesempenhoTecScreen.renderPlano();
      const serie = PlanoEngine.serieHistorica(PlanoEngine.prefs());
      const cracha = [...document.querySelectorAll('.reforco-tag')].map((e) => e.textContent.trim())
        .find((t) => /importações/.test(t)) || '';
      /* (3) o caso da tela: 52 assuntos, so 6 chegam ao alvo de 50, o maior
         tem 72 — e o aviso mandava ligar 50, que ja estava ligado. */
      const rsA = [];
      for (let t = 0; t < 52; t++) rsA.push({ depth: 1, codigo: '0' + t, nome: 'A' + t, disciplina: 'D',
        questoes: t < 6 ? 60 + t * 2 : 22 + (t % 7), acertos: Math.round((t < 6 ? 60 + t * 2 : 22 + (t % 7)) * 0.7) });
      DB.getTecSnapshots = () => ([{ id: 'a1', nome: 'a1', date: dia(2), startDate: dia(30), endDate: dia(2), rows: rsA }]);
      PlanoEngine.salvarPrefs({ amostraAlvo: 50, minAmostra: 20 });
      DesempenhoTecScreen._planoRefC = null;
      const rA = PlanoEngine.calcular(DesempenhoTecScreen.scopedSnapshot(),
        Object.assign({}, PlanoEngine.prefs(), { amostraAlvo: 50, minAmostra: 20, disciplina: '__todas__' }));
      return {
        alvo: { inviavel: rA.alvoInviavel, atual: 50, sugerido: rA.alvoSugerido,
          comAlvo: rA.comAlvo, assuntos: rA.assuntos, maior: rA.maiorAmostra },
        linhaFina, shareFina: share ? +share.shareEsforco.toFixed(3) : null, nivelFina: share ? share.taxa : null,
        bruto: +(serie[serie.length - 1].dominio - serie[0].dominio).toFixed(1),
        comparavel: +serie.filter((x) => x.deltaComp != null).reduce((a, x) => a + x.deltaComp, 0).toFixed(1),
        cracha,
        /* A NOTA CURTA FICA NA TELA, A LONGA VAI PARA O "i". Os dois
           paragrafos que explicavam a linha ocupavam mais altura que o proprio
           grafico e falavam de numeros que a tela nao mostrava: agora a tela
           diz a conclusao em uma linha e a analise traz a explicacao com a
           serie inteira em numeros. */
        nota: [...document.querySelectorAll('.pl-ciclo-obs')].map((e) => e.textContent.replace(/\s+/g, ' '))
          .some((t) => /A linha inclui os assuntos novos/.test(t)),
        botaoTraj: !!document.querySelector('[data-traj-det]'),
        analiseTraj: (() => {
          const d = DesempenhoTecScreen._trajAnalise;
          return !!(d && /O seu nível médio sobre/.test(d.html)
            && /importação por importação/.test(d.html) && /pl-det-tab/.test(d.html));
        })()
      };
    } finally {
      DB.getTecSnapshots = origSnaps; ReforcoEngine._incidByDisc = origIncid;
      DB.getActiveSubjects = origSubs; window.planCycleMode = origModo;
    }
  });
  (num.shareFina > 0 && num.shareFina < 0.5 && num.nivelFina != null
    && /<1% do seu esforço/.test(num.linhaFina) && !/[^\d<]0% do seu esforço/.test(num.linhaFina))
    ? ok(`materia com ${num.shareFina}% do esforco e nivel medido diz "<1%", nao "0%"`)
    : erro('a linha ainda se contradiz: ' + JSON.stringify({ share: num.shareFina, nivel: num.nivelFina, linha: num.linhaFina.slice(0, 120) }));
  /* ── UM RITMO MANUAL VELHO ESTRAGA TODA PREVISAO, E EM SILENCIO ───────
     Visto numa auditoria real: ritmo digitado 30/sem contra 563/sem medidos
     nos ultimos 120 dias, e o "caminho mais curto" anunciando 486 semanas
     (nove anos) para um percurso que no ritmo de verdade leva 26. Um numero
     assim desacredita a tela inteira, e o unico sinal era a AUSENCIA da
     palavra "(medido)" ao lado do chip. Sinal por omissao nao e sinal. */
  const rit = await pag.evaluate(() => {
    const origSnaps = DB.getTecSnapshots, origSubs = DB.getActiveSubjects,
      origModo = window.planCycleMode, origInc = ReforcoEngine._incidByDisc;
    try {
      const dia = (n) => { const d = new Date(todayLocal() + 'T00:00:00'); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };
      const snaps = [];
      for (let s = 0; s < 4; s++) {
        const rows = [];
        for (let t = 0; t < 20; t++) rows.push({ depth: 1, codigo: String(t + 1), nome: 'T' + t,
          disciplina: 'D', questoes: 120, acertos: Math.round(120 * (55 + t + s) / 100) });
        snaps.push({ id: 'rt' + s, nome: 'rt' + s, date: dia(90 - s * 28), startDate: dia(118 - s * 28), endDate: dia(90 - s * 28), rows });
      }
      DB.getTecSnapshots = () => snaps;
      DB.getActiveSubjects = () => []; window.planCycleMode = () => 'pre';
      ReforcoEngine._incidByDisc = () => ({});
      PlanoEngine.salvarPrefs({ disciplina: '__todas__', minAmostra: 20, amostraAlvo: 50, ordenar: 'pior', limite: 30 });
      const campo = document.getElementById('plano-ritmo');
      if (campo) campo.value = 30;
      PlanoEngine.salvarPrefs({ ritmoSemanal: 30 });
      DesempenhoTecScreen._planoRefC = null;
      DesempenhoTecScreen.renderPlanoConteudo();
      const texto = () => (document.getElementById('plano-proj') || {}).textContent || '';
      const antes = PlanoEngine.calcular(DesempenhoTecScreen.scopedSnapshot(), PlanoEngine.prefs());
      const avisoAntes = /O ritmo está fixo em/.test(texto());
      const bt = document.getElementById('plano-ritmo-medido');
      if (bt) bt.click();
      const depois = PlanoEngine.calcular(DesempenhoTecScreen.scopedSnapshot(), PlanoEngine.prefs());
      return { travado: antes.ritmo, medido: antes.ritmoMedido, divAntes: antes.ritmoDivergente,
        avisoAntes, temBotao: !!bt, ritmoDepois: depois.ritmo, divDepois: depois.ritmoDivergente,
        avisoDepois: /O ritmo está fixo em/.test(texto()),
        semanasAntes: antes.semanas != null ? Math.round(antes.semanas) : null,
        semanasDepois: depois.semanas != null ? Math.round(depois.semanas) : null };
    } finally {
      DB.getTecSnapshots = origSnaps; DB.getActiveSubjects = origSubs;
      window.planCycleMode = origModo; ReforcoEngine._incidByDisc = origInc;
      PlanoEngine.salvarPrefs({ ritmoSemanal: null });
    }
  });
  (rit.divAntes === true && rit.avisoAntes && rit.temBotao)
    ? ok(`ritmo travado em ${rit.travado}/sem contra ${rit.medido}/sem medidos: a tela acusa e oferece o conserto (previsao ia em ${rit.semanasAntes} semanas)`)
    : erro('a divergencia de ritmo passou calada: ' + JSON.stringify(rit));
  (rit.divDepois === false && rit.ritmoDepois === rit.medido && !rit.avisoDepois)
    ? ok(`e um toque devolve o ritmo a medicao (${rit.ritmoDepois}/sem, previsao em ${rit.semanasDepois} semanas) e o aviso some`)
    : erro('o conserto do ritmo nao pegou: ' + JSON.stringify(rit));

  /* ── A PORTA DA AUDITORIA ─────────────────────────────────────────────
     O arquivo existe para OUTRA pessoa julgar o modulo. Duas coisas o
     inutilizam: faltar um bloco (um numero da tela que nao da para
     reproduzir) e vazar identidade (ai ele deixa de poder ser enviado). */
  const aud = await pag.evaluate(() => {
    /* A porta mudou de lugar: era um <details> recolhido no FIM da lista do
       Plano (depois de trinta assuntos, do segundo plano e das lacunas do
       edital) e virou uma SECAO da folha de ajustes, junto dos parametros que o
       arquivo carrega. */
    const sec = document.querySelector('#tec-cfg-body .tec-cfg-sec[data-tab="plano"][data-sec="auditoria"]');
    const chip = [...document.querySelectorAll('#tec-cfg-nav button')].some((b) => b.dataset.sec === 'auditoria');
    const a = PlanoAuditoria.gerar({ cadencia: 'semanal' });
    const txt = JSON.stringify(a);
    return {
      porta: !!sec, naFolha: !!sec && !!sec.closest('#tec-cfg-body'), chip,
      foraDaLista: !document.querySelector('#plano-lista [data-aud]'),
      botoes: [...document.querySelectorAll('#tec-cfg-body [data-aud]')].map((b) => b.dataset.aud),
      anon: !!document.getElementById('plano-aud-anon'),
      erro: a.erro || null,
      blocos: a.erro ? [] : ['parametros', 'contexto', 'retrato', 'serie', 'materias',
        'assuntos', 'atividades', 'qualidadeDoDado', 'invariantes', 'resumo',
        'importacao', 'incidencia', 'modosDeAtaque'].filter((k) => a[k] === undefined),
      versaoDoApp: a.erro ? null : (a.app && a.app.versao),
      importacao: a.erro ? null : (a.importacao || []).map((i) => ({
        linhas: i.linhas, disc: i.disciplinas, q: i.questoesNasDisciplinas,
        folhas: i.questoesNasFolhas, fecha: i.fechaEntreDisciplinasEFolhas,
        crua: i.somaCruaDeTodasAsLinhas, repetidas: i.disciplinasRepetidas,
        naoRepro: i.linhasComTaxaNaoReproduzivel })),
      invariantes: a.erro ? 0 : (a.invariantes || []).length,
      invOk: a.erro ? null : (a.invariantes || []).every((i) => i.ok),
      naoAplicaveis: a.erro ? 0 : (a.invariantes || []).filter((i) => i.aplicavel === false).length,
      invFalhas: a.erro ? [] : (a.invariantes || []).filter((i) => !i.ok).map((i) => i.nome + ' :: ' + JSON.stringify(i.detalhe)),
      vazou: txt.indexOf('pinHash') >= 0 || txt.indexOf('@') >= 0,
      kb: Math.round(txt.length / 1024)
    };
  });
  // o chip da fita e conferido no teste da folha (secao 9 acima), com ela aberta
  (aud.porta && aud.naFolha && aud.foraDaLista && aud.botoes.join(',') === 'semanal,mensal' && aud.anon)
    ? ok('a auditoria e uma secao da folha de ajustes (🧪), com exportacao semanal, mensal e modo anonimo — e saiu da lista')
    : erro('a porta da auditoria nao saiu certa: ' + JSON.stringify(aud));
  /* O ARQUIVO TEM DE CONFERIR A FONTE. Uma importacao que conta a mesma questao
     duas vezes produz dominio, custo e fila plausiveis: sem a reconciliacao
     entre o total das disciplinas e o das folhas, nada no arquivo denuncia. */
  const im = (aud.importacao || [])[0];
  (im && im.fecha === true && im.q === im.folhas && im.repetidas === 0 && im.naoRepro === 0 && im.crua >= im.q)
    ? ok(`o arquivo reconcilia a importacao: ${im.disc} disciplinas, ${im.q} questoes, folhas fechando (soma crua seria ${im.crua})`)
    : erro('a conferencia da importacao no arquivo falhou: ' + JSON.stringify(aud.importacao));
  (aud.versaoDoApp && /^v[0-9a-f]+$/.test(aud.versaoDoApp))
    ? ok(`o arquivo diz qual build o produziu (${aud.versaoDoApp})`)
    : erro('o arquivo nao carimba a versao do app: ' + JSON.stringify(aud.versaoDoApp));
  (!aud.erro && aud.blocos.length === 0 && aud.invariantes >= 3 && aud.invOk === true && !aud.vazou)
    ? ok(`e o arquivo sai completo (${aud.kb} KB), com as ${aud.invariantes} invariantes conferidas na hora e sem credencial nem e-mail`)
    : erro('o arquivo de auditoria saiu incompleto ou vazou dado: ' + JSON.stringify(aud));

  /* ── O NUMERO GRANDE PRECISA DIZER DE QUEM ELE E ──────────────────────
     Com o filtro numa disciplina, TUDO no cartao do topo passa a ser dela: o
     dominio, os "faltam X pontos", o caminho curto, as semanas. Medido no mesmo
     perfil, o numero saltava de 79,0% em 27 assuntos para 65,5% em 6 sem nada
     na tela dizendo por que — e o filtro vive numa folha suspensa, longe dali. */
  const escopo = await pag.evaluate(() => {
    const origSnaps = DB.getTecSnapshots, origSubs = DB.getActiveSubjects,
      origModo = window.planCycleMode, origInc = ReforcoEngine._incidByDisc;
    try {
      const dia = (n) => { const d = new Date(todayLocal() + 'T00:00:00'); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };
      const rs = [];
      [['Tributario', 10, 84], ['Contabilidade', 8, 58]].forEach(([d, n, base]) => {
        for (let t = 0; t < n; t++) rs.push({ depth: 1, codigo: String(t + 1), nome: d + ' ' + (t + 1),
          disciplina: d, questoes: 40 + t * 3, acertos: Math.round((40 + t * 3) * (base - 8 + t * 3) / 100) });
      });
      DB.getTecSnapshots = () => ([{ id: 'E', nome: 'E', date: dia(5), startDate: dia(35), endDate: dia(5), rows: rs }]);
      DB.getActiveSubjects = () => []; window.planCycleMode = () => 'pre';
      ReforcoEngine._incidByDisc = () => ({});
      const sel = document.getElementById('plano-disc');
      if (sel) sel.value = '__todas__';
      PlanoEngine.salvarPrefs({ disciplina: '__todas__', minAmostra: 20, metaDominio: 85, limite: 30 });
      DesempenhoTecScreen._planoRefC = null;
      DesempenhoTecScreen.renderPlano();
      const geral = PlanoEngine.calcular(DesempenhoTecScreen.scopedSnapshot(), PlanoEngine.prefs());
      const semRotulo = !document.querySelector('.pl-hero-escopo');
      if (sel) sel.value = 'Tributario';
      PlanoEngine.salvarPrefs({ disciplina: 'Tributario' });
      DesempenhoTecScreen._planoRefC = null;
      DesempenhoTecScreen.renderPlanoConteudo();
      const filtrado = PlanoEngine.calcular(DesempenhoTecScreen.scopedSnapshot(), PlanoEngine.prefs());
      const el = document.querySelector('.pl-hero-escopo');
      const btn = document.getElementById('plano-todas-disc');
      const rot = el ? el.textContent.replace(/\s+/g, ' ') : '';
      if (btn) btn.click();
      return { semRotulo, rot, temBotao: !!btn,
        voltou: PlanoEngine.prefs().disciplina === '__todas__' && !document.querySelector('.pl-hero-escopo'),
        domGeral: +geral.dominioPct.toFixed(1), nGeral: geral.assuntos,
        domFiltro: +filtrado.dominioPct.toFixed(1), nFiltro: filtrado.assuntos };
    } finally {
      DB.getTecSnapshots = origSnaps; DB.getActiveSubjects = origSubs;
      window.planCycleMode = origModo; ReforcoEngine._incidByDisc = origInc;
      PlanoEngine.salvarPrefs({ disciplina: '__todas__' });
    }
  });
  (escopo.semRotulo && /Tributario/.test(escopo.rot) && escopo.temBotao && escopo.voltou
    && Math.abs(escopo.domGeral - escopo.domFiltro) > 5)
    ? ok(`o dominio nomeia a materia quando filtrado (${escopo.domGeral}% em ${escopo.nGeral} assuntos → ${escopo.domFiltro}% em ${escopo.nFiltro}) e o botao "ver o geral" desfaz`)
    : erro('o numero grande nao diz de quem e: ' + JSON.stringify(escopo));

  /* ── DUAS ATIVIDADES, AS MESMAS QUESTOES ──────────────────────────────
     Medir o no pelas linhas cruas e o que torna a atividade imune a lente — e e
     tambem o que faz uma atividade em "Atos" contar o que uma segunda, em "Atos
     vinculados", tambem conta. Nas barras a dobra e defensavel; na calibragem o
     mesmo volume entra duas vezes e o "questoes por ponto" sai subestimado,
     rebaixando o custo de TODO assunto do Plano.

     Bloquear seria errado (afunilar dentro de uma frente aberta e estudo
     normal). Criar em silencio tambem. Entao a tela PERGUNTA — e o que este
     teste cobra e que a pergunta chegue com os dois nomes e que o "nao" nao
     crie nada. */
  const dobra = await pag.evaluate(async () => {
    const origSnaps = DB.getTecSnapshots, origConf = UI.confirm, origExtras = DB.getExtras,
      origSave = DB.saveExtras, origEscopo = DesempenhoTecScreen.scopedSnapshot;
    let banco = [];
    try {
      const dia = (n) => { const d = new Date(todayLocal() + 'T00:00:00'); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };
      const rows = [
        { depth: 0, codigo: null, nome: 'Dir Adm', disciplina: 'Dir Adm', questoes: 300, acertos: 150 },
        { depth: 1, codigo: '01', nome: 'Atos', disciplina: 'Dir Adm', questoes: 200, acertos: 100 },
        { depth: 2, codigo: '01.01', nome: 'Atos vinculados', disciplina: 'Dir Adm', questoes: 120, acertos: 60 },
        { depth: 2, codigo: '01.02', nome: 'Atos discricionarios', disciplina: 'Dir Adm', questoes: 80, acertos: 40 },
        { depth: 1, codigo: '02', nome: 'Licitacoes', disciplina: 'Dir Adm', questoes: 100, acertos: 50 }];
      const snap = { id: 'D', nome: 'D', date: dia(5), startDate: dia(35), endDate: dia(5), rows };
      DB.getTecSnapshots = () => ([snap]);
      DB.getExtras = () => banco;
      DB.saveExtras = (l) => { banco = l; };
      DesempenhoTecScreen.scopedSnapshot = () => snap;
      DesempenhoTecScreen._planoRefC = null;
      let visto = null, vezes = 0;
      UI.confirm = (msg) => { visto = String(msg); vezes++; return Promise.resolve(false); };
      // sem atividade aberta, o portao nem abre dialogo
      const livre = await DesempenhoTecScreen._confirmarSobreposicao('Atos vinculados', 'Dir Adm');
      const semDialogo = vezes === 0;
      // abre a frente ampla (o PAI) e tenta o filho
      const e = DB.addExtra({ titulo: 'Reforçar: Atos', tipo: 'questoes', alvo: 50, periodo: 'unica', contaMetricas: false });
      DB.updateExtra(e.id, { origemPlano: PlanoCiclo.origem('Atos', 'Dir Adm', null, {}) });
      const antesN = DB.getExtras().length;
      const recusado = await DesempenhoTecScreen._confirmarSobreposicao('Atos vinculados', 'Dir Adm');
      const depoisN = DB.getExtras().length;
      // e o irmao, que nao se sobrepoe, passa direto
      const vezesAntes = vezes;
      const irmao = await DesempenhoTecScreen._confirmarSobreposicao('Licitacoes', 'Dir Adm');
      return {
        livre, semDialogo, recusado, perguntou: vezes === vezesAntes,
        naoCriou: antesN === depoisN, irmao, vezes,
        citaAmbos: !!(visto && /Atos/.test(visto) && /Atos vinculados/.test(visto)),
        citaCalibragem: !!(visto && /calibragem/i.test(visto)),
        // a saida que a tela sugere tem de estar escrita nela
        citaSaida: !!(visto && /encerrar/i.test(visto)),
        titBloco: PlanoCiclo.titulo('Licitacoes · bloco', 'reforco', ['a', 'b', 'c']),
        titComum: PlanoCiclo.titulo('Atos', 'diagnostico', null)
      };
    } finally {
      DB.getTecSnapshots = origSnaps; UI.confirm = origConf; DB.getExtras = origExtras;
      DB.saveExtras = origSave; DesempenhoTecScreen.scopedSnapshot = origEscopo;
      DesempenhoTecScreen._planoRefC = null;
    }
  });
  (dobra.livre === true && dobra.semDialogo && dobra.irmao === true && dobra.vezes === 1)
    ? ok('o aviso de dobra so aparece quando ha dobra: assunto livre e irmao passam sem dialogo')
    : erro('o portao da sobreposicao abriu onde nao devia: ' + JSON.stringify(dobra));
  (dobra.recusado === false && dobra.naoCriou && dobra.citaAmbos && dobra.citaCalibragem && dobra.citaSaida)
    ? ok('com a frente ampla aberta, criar o subtopico pergunta antes — nomeia as duas, diz o custo na calibragem e a saida — e o "nao" nao cria nada')
    : erro('o aviso de dobra nao chegou completo: ' + JSON.stringify(dobra));
  (dobra.titBloco === 'Reforçar: Licitacoes (bloco de 3 tópicos)' && dobra.titComum === 'Diagnosticar: Atos')
    ? ok(`e a atividade de um bloco se apresenta em portugues ("${dobra.titBloco}")`)
    : erro('o titulo da atividade de bloco saiu errado: ' + JSON.stringify(dobra));

  /* ── ESCOLHER A SEMANA, E NAO UMA MATERIA POR VEZ ─────────────────────
     O quadro "Onde atacar primeiro" existe para dizer que tres ou quatro
     materias concentram metade do que esta em jogo — e o unico caminho para a
     lista de assuntos era um filtro de UMA disciplina. Montar a semana que o
     proprio quadro propoe exigia desfazer e refazer o filtro materia por
     materia.

     O foco acumula, e o que este teste cobra e que ele seja UM estado: o
     select, o rotulo do numero grande, a lista de baixo e o arquivo de
     auditoria tem de contar a mesma historia. */
  const foco = await pag.evaluate(() => {
    const origSnaps = DB.getTecSnapshots, origSubs = DB.getActiveSubjects,
      origModo = window.planCycleMode, origInc = ReforcoEngine._incidByDisc;
    const antes = PlanoEngine.prefs();
    try {
      const dia = (n) => { const d = new Date(todayLocal() + 'T00:00:00'); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };
      DB.getActiveSubjects = () => []; window.planCycleMode = () => 'pre';
      ReforcoEngine._incidByDisc = () => ({
        'Tributario': [{ codigo: null, depth: 0, nome: 'Tributario', disciplina: 'Tributario', incidencia: 300 }],
        'Contabil': [{ codigo: null, depth: 0, nome: 'Contabil', disciplina: 'Contabil', incidencia: 200 }],
        'Portugues': [{ codigo: null, depth: 0, nome: 'Portugues', disciplina: 'Portugues', incidencia: 100 }] });
      const rs = [];
      [['Tributario', 5, 62], ['Contabil', 4, 55], ['Portugues', 3, 78]].forEach(([d, n, base]) => {
        for (let t = 0; t < n; t++) rs.push({ depth: 1, codigo: String(t + 1), nome: d + ' ' + (t + 1),
          disciplina: d, questoes: 40 + t * 5, acertos: Math.round((40 + t * 5) * (base + t * 2) / 100) });
      });
      DB.getTecSnapshots = () => ([{ id: 'F', nome: 'F', date: dia(5), startDate: dia(35), endDate: dia(5), rows: rs }]);
      const pintar = () => { DesempenhoTecScreen._planoRefC = null; DesempenhoTecScreen._fatias = null;
        DesempenhoTecScreen.renderPlano(); };
      PlanoEngine.salvarPrefs({ foco: [], disciplina: '__todas__', minAmostra: 20, metaDominio: 85,
        limite: 50, ordenar: 'pior', granPiso: 0, apenasFolhas: true });
      pintar();
      const assuntos = () => [...document.querySelectorAll('#plano-lista .pl-item .pl-disc')].map((e) => e.textContent.trim());
      const chips = () => [...document.querySelectorAll('#plano-lista [data-foco]')];
      const geral = { n: assuntos().length, discs: [...new Set(assuntos())].sort().join(',') };
      const nChips = chips().length;
      // toda linha do quadro que tem assunto medido oferece o chip
      const clicar = (nome) => {
        const b = chips().find((e) => e.dataset.foco === nome);
        if (b) b.click();
        return !!b;
      };
      const ok1 = clicar('Tributario');
      const ok2 = clicar('Contabil');
      const dois = { n: assuntos().length, discs: [...new Set(assuntos())].sort().join(',') };
      /* Lido AGORA, com as duas em foco: `sel.value` e DOM vivo, e o final
         deste teste desfaz o foco de proposito. */
      const sel = document.getElementById('plano-disc');
      const selValor = sel ? sel.value : '';
      const selTexto = (sel && sel.options[sel.selectedIndex]) ? sel.options[sel.selectedIndex].text : '';
      const rotulo = ((document.querySelector('.pl-hero-escopo') || { textContent: '' }).textContent || '')
        .replace(/ver o geral\s*$/, '').replace(/\s+/g, ' ').trim();
      const marcados = chips().filter((e) => e.classList.contains('is-on')).map((e) => e.dataset.foco).sort().join(',');
      const aria = chips().filter((e) => e.getAttribute('aria-pressed') === 'true').length;
      const salvo = (PlanoEngine.prefs().foco || []).slice().sort().join(',');
      const derivada = PlanoEngine.prefs().disciplina;
      const a = PlanoAuditoria.gerar({ cadencia: 'avulsa' });
      const noArquivo = ((a.contexto && a.contexto.materiasEmFoco) || []).slice().sort().join(',');
      const fita = (() => { try { return TecAjustes.resumo('plano'); } catch (e) { return ''; } })();
      // desmarcar uma volta a uma so
      clicar('Contabil');
      const umaSo = { n: assuntos().length, sel: document.getElementById('plano-disc').value,
        disc: PlanoEngine.prefs().disciplina };
      // e "ver o geral" limpa tudo
      const limpar = document.getElementById('plano-todas-disc');
      if (limpar) limpar.click();
      const voltou = { n: assuntos().length, foco: (PlanoEngine.prefs().foco || []).length,
        sel: document.getElementById('plano-disc').value, rot: !document.querySelector('.pl-hero-escopo') };
      return { geral, nChips, ok1, ok2, dois, selValor, selTexto,
        rotulo, marcados, aria, salvo, derivada, noArquivo,
        fita: String(fita || '').replace(/\s+/g, ' '), umaSo, voltou };
    } finally {
      DB.getTecSnapshots = origSnaps; DB.getActiveSubjects = origSubs;
      window.planCycleMode = origModo; ReforcoEngine._incidByDisc = origInc;
      PlanoEngine.salvarPrefs({ foco: [], disciplina: '__todas__', minAmostra: antes.minAmostra,
        limite: antes.limite, ordenar: antes.ordenar, granPiso: antes.granPiso || 0 });
    }
  });
  (foco.nChips === 3 && foco.ok1 && foco.ok2 && foco.geral.n === 12 && foco.dois.n === 9
    && foco.dois.discs === 'Contabil,Tributario')
    ? ok(`o foco acumula: 3 materias oferecem chip, duas marcadas recortam a lista de ${foco.geral.n} para ${foco.dois.n} assuntos (${foco.dois.discs})`)
    : erro('o foco de varias materias nao recortou a lista: ' + JSON.stringify(foco));
  (foco.marcados === 'Contabil,Tributario' && foco.aria === 2 && foco.salvo === 'Contabil,Tributario')
    ? ok('e as duas linhas do quadro ficam marcadas, com o estado exposto para leitor de tela')
    : erro('o estado do chip nao acompanha o foco: ' + JSON.stringify(foco));
  (foco.selValor === '__varias__' && /2 mat/.test(foco.selTexto) && foco.derivada === '__todas__'
    && /Tributario/.test(foco.rotulo) && /Contabil/.test(foco.rotulo))
    ? ok(`o numero grande nomeia as duas ("${foco.rotulo}") e o select mostra o mesmo estado ("${foco.selTexto}")`)
    : erro('o select e o rotulo divergem do foco: ' + JSON.stringify(foco));
  (foco.noArquivo === 'Contabil,Tributario' && /2 mat/.test(foco.fita))
    ? ok('a auditoria grava o recorte aplicado e a fita dos ajustes o repete')
    : erro('o recorte nao chegou ao arquivo nem a fita: ' + JSON.stringify({ arq: foco.noArquivo, fita: foco.fita }));
  (foco.umaSo.n === 5 && foco.umaSo.sel === 'Tributario' && foco.umaSo.disc === 'Tributario'
    && foco.voltou.n === 12 && foco.voltou.foco === 0 && foco.voltou.sel === '__todas__' && foco.voltou.rot)
    ? ok('desmarcar volta ao filtro de uma (e o select acompanha); "ver o geral" limpa o foco inteiro')
    : erro('o foco nao desfaz corretamente: ' + JSON.stringify(foco));

  /* ── A GRANULARIDADE DA UNIDADE E UMA ESCOLHA, NAO UM DESTINO ─────────
     A arvore do TecConcursos e irregular: materia que termina no segundo nivel
     convive com materia que desce ao sexto. A lente de folha transforma isso em
     centenas de unidades de duas ou tres questoes, e o Plano inteiro morria na
     mensagem "nenhum assunto atingiu a amostra minima" — com o retrato na mao.

     O piso junta o que nao mede sozinho ao topico-pai. O que este teste cobra e
     que a escolha seja REVERSIVEL e HONESTA: mesmo volume em qualquer piso, o
     bloco se anunciando na tela, e a saida do beco oferecida em um toque. */
  const gran = await pag.evaluate(() => {
    const origSnaps = DB.getTecSnapshots, origSubs = DB.getActiveSubjects,
      origModo = window.planCycleMode, origInc = ReforcoEngine._incidByDisc;
    const antes = PlanoEngine.prefs();
    try {
      const dia = (n) => { const d = new Date(todayLocal() + 'T00:00:00'); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };
      DB.getActiveSubjects = () => []; window.planCycleMode = () => 'pre';
      ReforcoEngine._incidByDisc = () => ({});
      /* Um retrato realista: duas materias, cada uma com um topico-pai que se
         desdobra em muitos filhos de 2 a 4 questoes — o caso em que a lente de
         folha nao mede NADA e o app nao tinha saida boa a oferecer. */
      const rs = [{ depth: 0, codigo: null, nome: 'Tributario', disciplina: 'Tributario', questoes: 0, acertos: 0 },
        { depth: 1, codigo: '01', nome: 'Obrigacao', disciplina: 'Tributario', questoes: 0, acertos: 0 }];
      let qT = 0, aT = 0;
      for (let i = 1; i <= 12; i++) {
        const q = 2 + (i % 3), ac = Math.round(q * 0.4);
        rs.push({ depth: 2, codigo: '01.' + String(i).padStart(2, '0'), nome: 'Obrigacao ' + i,
          disciplina: 'Tributario', questoes: q, acertos: ac });
        qT += q; aT += ac;
      }
      rs[1].questoes = qT; rs[1].acertos = aT; rs[0].questoes = qT; rs[0].acertos = aT;
      rs.push({ depth: 0, codigo: null, nome: 'Contabil', disciplina: 'Contabil', questoes: 0, acertos: 0 },
        { depth: 1, codigo: '01', nome: 'Ativo', disciplina: 'Contabil', questoes: 0, acertos: 0 });
      let qC = 0, aC = 0;
      for (let i = 1; i <= 9; i++) {
        const q = 3, ac = 2;
        rs.push({ depth: 2, codigo: '01.' + String(i).padStart(2, '0'), nome: 'Ativo ' + i,
          disciplina: 'Contabil', questoes: q, acertos: ac });
        qC += q; aC += ac;
      }
      rs[rs.length - 10].questoes = qC; rs[rs.length - 10].acertos = aC;
      rs[rs.length - 11].questoes = qC; rs[rs.length - 11].acertos = aC;
      DB.getTecSnapshots = () => ([{ id: 'G', nome: 'G', date: dia(5), startDate: dia(35), endDate: dia(5), rows: rs }]);
      const total = qT + qC, totalAc = aT + aC;
      const pintar = (piso) => {
        PlanoEngine.salvarPrefs({ disciplina: '__todas__', minAmostra: 20, metaDominio: 85,
          limite: 30, ordenar: 'pior', apenasFolhas: true, granPiso: piso, incluirPequenas: false });
        PlanoEngine._agrC = null;
        DesempenhoTecScreen._planoRefC = null; DesempenhoTecScreen._fatias = null;
        DesempenhoTecScreen.renderPlano();
      };
      // 1) o controle existe na folha, com os quatro estados
      const sel = document.getElementById('plano-granpiso');
      const opcoes = sel ? [...sel.options].map((o) => o.value).join(',') : '';
      const naSecao = !!(sel && sel.closest('.tec-cfg-sec[data-tab="plano"][data-sec="amostra"]'));
      // 2) sem piso, o Plano nao existe — e a tela oferece o agrupamento
      pintar(0);
      const semPiso = PlanoEngine.calcular(DesempenhoTecScreen.scopedSnapshot(), PlanoEngine.prefs());
      const botao = document.getElementById('plano-juntar-finos');
      const rotulo = botao ? botao.textContent.replace(/\s+/g, ' ').trim() : '';
      const gSug = semPiso.granSugerida || null;
      // 3) um toque, e o Plano volta
      if (botao) botao.click();
      const pisoAplicado = PlanoEngine.prefs().granPiso;
      const comPiso = PlanoEngine.calcular(DesempenhoTecScreen.scopedSnapshot(), PlanoEngine.prefs());
      const selos = [...document.querySelectorAll('#plano-lista .pl-tag-bloco')];
      const comInfo = selos.filter((e) => (e.dataset.info || '').length > 80).length;
      const somaIdx = (piso) => {
        PlanoEngine._agrC = null;
        const idx = PlanoEngine._indice(DesempenhoTecScreen.scopedSnapshot(),
          Object.assign({}, PlanoEngine.prefs(), { granPiso: piso }));
        PlanoEngine._agrC = null;
        return { u: Object.keys(idx).length,
          q: Object.keys(idx).reduce((a, k) => a + idx[k].q, 0),
          ac: Object.keys(idx).reduce((a, k) => a + idx[k].ac, 0) };
      };
      const porPiso = [0, 10, 20, 30, 50].map(somaIdx);
      // 4) e a auditoria declara a lente, com a soma conferida no ato
      const a = PlanoAuditoria.gerar({ cadencia: 'avulsa' });
      const invGran = (a.invariantes || []).filter((i) => /agrupar|agrupamento/.test(i.nome));
      return {
        opcoes, naSecao, temSelect: !!sel,
        erroSemPiso: semPiso.erro || null, gSug, rotulo, pisoAplicado,
        erroComPiso: comPiso.erro || null, assuntosComPiso: comPiso.assuntos || 0,
        blocosNaTela: selos.length, comInfo, textoSelo: selos.length ? selos[0].textContent.trim() : '',
        total, totalAc, porPiso,
        somaSempreIgual: porPiso.every((x) => x.q === total && x.ac === totalAc),
        unidadesCaem: porPiso[0].u > porPiso[1].u,
        gran: a.granularidade ? { piso: a.granularidade.piso, ok: a.granularidade.somaPreservada,
          blocos: a.granularidade.blocos, topicos: a.granularidade.atomosAgrupados,
          medem: a.granularidade.medemSozinhas, medemSem: a.granularidade.medemSozinhasSemAgrupar } : null,
        invGran: invGran.map((i) => i.nome + '=' + i.ok), invTodasOk: (a.invariantes || []).every((i) => i.ok)
      };
    } finally {
      DB.getTecSnapshots = origSnaps; DB.getActiveSubjects = origSubs;
      window.planCycleMode = origModo; ReforcoEngine._incidByDisc = origInc;
      PlanoEngine._agrC = null;
      PlanoEngine.salvarPrefs({ granPiso: antes.granPiso || 0, minAmostra: antes.minAmostra,
        apenasFolhas: antes.apenasFolhas, disciplina: '__todas__' });
    }
  });
  (gran.temSelect && gran.naSecao && gran.opcoes === '0,10,20,30')
    ? ok('o piso de granularidade e um seletor de quatro estados, na secao Amostra dos ajustes')
    : erro('o controle de granularidade nao saiu certo: ' + JSON.stringify(gran));
  (gran.erroSemPiso === 'amostra' && gran.gSug && gran.gSug.piso === 10 && /Juntar os assuntos finos/.test(gran.rotulo))
    ? ok(`com 21 topicos de 2 a 4 questoes o Plano morria na amostra minima; agora a tela oferece juntar (${gran.rotulo})`)
    : erro('o beco da amostra nao oferece o agrupamento: ' + JSON.stringify({ erro: gran.erroSemPiso, g: gran.gSug, rot: gran.rotulo }));
  (gran.pisoAplicado === 10 && !gran.erroComPiso && gran.assuntosComPiso === 2)
    ? ok(`e um toque devolve o Plano: ${gran.assuntosComPiso} unidades medidas onde nenhuma media`)
    : erro('o toque nao devolveu o Plano: ' + JSON.stringify(gran));
  (gran.blocosNaTela === 2 && gran.comInfo === 2 && /bloco/.test(gran.textoSelo))
    ? ok(`cada unidade agrupada se anuncia na tela ("${gran.textoSelo}") e explica no "i" o que cobre`)
    : erro('o bloco nao se anuncia: ' + JSON.stringify(gran));
  (gran.somaSempreIgual && gran.unidadesCaem)
    ? ok(`e o volume e o MESMO em todo piso (${gran.total} questoes, ${gran.totalAc} acertos; unidades ${gran.porPiso.map((x) => x.u).join(' → ')})`)
    : erro('o agrupamento mexeu no volume: ' + JSON.stringify({ total: gran.total, porPiso: gran.porPiso }));
  (gran.gran && gran.gran.ok === true && gran.gran.piso === 10 && gran.gran.medem > gran.gran.medemSem
    && gran.invGran.length === 2 && gran.invGran.every((x) => /=true$/.test(x)) && gran.invTodasOk)
    ? ok(`a auditoria declara a lente (piso ${gran.gran.piso}, ${gran.gran.blocos} blocos, ${gran.gran.topicos} topicos, ${gran.gran.medemSem} → ${gran.gran.medem} medindo) e confere a soma no ato`)
    : erro('a auditoria nao declara a granularidade: ' + JSON.stringify({ gran: gran.gran, inv: gran.invGran, todas: gran.invTodasOk }));

  /* ── A TELA COMECA PELA PERGUNTA, NAO PELA RESPOSTA ───────────────────
     "O seu proximo bloco" vinha com quatro assuntos marcados e um botao grande
     ANTES de "Onde atacar primeiro" dizer qual materia importa: quem abre pela
     primeira vez criava quatro atividades sem ter visto que quatro materias
     concentram metade do que esta em jogo. E a guia de cada item abria enquanto
     `i <= idxMeta` — num plano de 17 assuntos, 17 guias completas abertas (e
     TODAS quando a meta era inalcancavel), o que fazia os itens responderem por
     84% de uma pagina de 20.681px a 390px. */
  const layout = await pag.evaluate(() => {
    const origSnaps = DB.getTecSnapshots, origSubs = DB.getActiveSubjects,
      origModo = window.planCycleMode, origInc = ReforcoEngine._incidByDisc;
    try {
      const dia = (n) => { const d = new Date(todayLocal() + 'T00:00:00'); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };
      ReforcoEngine._incidByDisc = () => ({
        'Grande': [{ codigo: null, depth: 0, nome: 'Grande', disciplina: 'Grande', incidencia: 890 }],
        'Cara': [{ codigo: null, depth: 0, nome: 'Cara', disciplina: 'Cara', incidencia: 100 }],
        'Miuda': [{ codigo: null, depth: 0, nome: 'Miuda', disciplina: 'Miuda', incidencia: 8 }] });
      DB.getActiveSubjects = () => []; window.planCycleMode = () => 'pre';
      const rs = [];
      [['Grande', 12, 58, 55], ['Cara', 8, 50, 80], ['Miuda', 1, 20, 88]].forEach(([d, n, q, tx]) => {
        for (let t = 0; t < n; t++) rs.push({ depth: 1, codigo: String(t + 1), nome: d + ' ' + (t + 1),
          disciplina: d, questoes: q, acertos: Math.round(q * (tx + t) / 100) });
      });
      DB.getTecSnapshots = () => ([{ id: 'L', nome: 'L', date: dia(5), startDate: dia(35), endDate: dia(5), rows: rs }]);
      PlanoEngine.salvarPrefs({ disciplina: '__todas__', minAmostra: 20, metaDominio: 85, limite: 30, ordenar: 'pior' });
      DesempenhoTecScreen._planoRefC = null;
      DesempenhoTecScreen.renderPlano();
      const blocos = [...document.querySelectorAll('#plano-lista > *')].map((e) => (e.className || '').split(' ')[0]);
      const tm = PlanoPontos.esforcoPorMateria();
      const por = {}; tm.linhas.forEach((l) => { por[l.nome] = l; });
      const r = PlanoEngine.calcular(DesempenhoTecScreen.scopedSnapshot(), PlanoEngine.prefs());
      return {
        iTempo: blocos.indexOf('pl-ciclo'), iHoje: blocos.indexOf('pl-hoje'),
        guiasAbertas: document.querySelectorAll('.pl-guia[open]').length,
        nItens: document.querySelectorAll('.pl-item').length,
        // a ordem curta e visivel de cada item, e o conselho inteiro dentro da guia
        comOrdem: document.querySelectorAll('.pl-item .pl-direcao').length,
        linhasOrdem: [...document.querySelectorAll('.pl-item .pl-direcao span:last-child')]
          .map(e => (e.textContent || '').trim().length),
        conselhoNaGuia: document.querySelectorAll('.pl-item .pl-guia-acao').length,
        idxMeta: r.idxMeta,
        cara: por.Cara, miuda: por.Miuda
      };
    } finally {
      DB.getTecSnapshots = origSnaps; DB.getActiveSubjects = origSubs;
      window.planCycleMode = origModo; ReforcoEngine._incidByDisc = origInc;
    }
  });
  (layout.iTempo >= 0 && layout.iHoje >= 0 && layout.iTempo < layout.iHoje)
    ? ok('a tela abre por "Onde atacar primeiro" (a materia) e so depois pelo bloco de assuntos')
    : erro('a ordem dos blocos voltou a comecar pela resposta: ' + JSON.stringify(layout));
  {
    /* CADA ITEM DIZ O QUE FAZER EM UMA LINHA, E NAO PERDE O PORQUE. O conselho
       inteiro ocupava nove linhas coloridas em cada item, com o mesmo miolo
       repetido dez vezes — 492px por assunto, mais que uma tela de celular.
       Ele nao foi cortado: mudou de lugar, para a guia que ja existia. */
    const maiorOrdem = Math.max(0, ...(layout.linhasOrdem || [0]));
    (layout.comOrdem === layout.nItens && layout.conselhoNaGuia === layout.nItens && maiorOrdem <= 130)
      ? ok(`cada um dos ${layout.nItens} itens traz a ordem em uma linha (maior: ${maiorOrdem} caracteres) e o conselho inteiro na guia`)
      : erro('a ordem curta ou o conselho completo sumiu do item: ' + JSON.stringify({
          itens: layout.nItens, comOrdem: layout.comOrdem, naGuia: layout.conselhoNaGuia, maiorOrdem }));
  }
  /* A guia nao abre sozinha em NENHUM item: ela abria nos tres primeiros
     porque a linha nao dizia o que fazer. Agora a linha traz a ordem curta e o
     conselho inteiro fica na guia — abrir tres seria voltar ao problema. */
  (layout.guiasAbertas === 0 && layout.nItens > 10)
    ? ok(`e nenhuma guia abre sozinha nos ${layout.nItens} itens (antes abria em ${layout.idxMeta >= 0 ? layout.idxMeta + 1 : 'todos'})`)
    : erro('a guia voltou a abrir em meia lista: ' + JSON.stringify({ abertas: layout.guiasAbertas, itens: layout.nItens }));
  (layout.cara.veredito === 'reduzir' && layout.miuda.veredito !== 'reduzir' && layout.miuda.sobra === true)
    ? ok(`"reduza" so onde ha o que reduzir: Cara com ${layout.cara.shareEsforco.toFixed(0)}% do esforco sim, Miuda com ${layout.miuda.shareEsforco.toFixed(1)}% nao (a sobra fica anotada)`)
    : erro('o piso de esforco do "reduza" falhou: ' + JSON.stringify({ cara: layout.cara.veredito, miuda: layout.miuda.veredito }));

  /* ── A SETA SO ACENDE QUANDO A DIFERENCA SE SUSTENTA ──────────────────
     `sensTendencia` responde "vale me avisar?" e e preferencia legitima.
     Faltava a outra pergunta: "da para provar?". Medido no caso real: 70
     questoes a 88% contra uma base de 10 a 65% acendia ▲ +18,6pp, quando a
     menor subida comprovavel naquele par e 30pp. Anunciar melhora que nao se
     sustenta e pior que nao anunciar: o aluno troca de estrategia por ruido. */
  const setas = await pag.evaluate(() => {
    const origSnaps = DB.getTecSnapshots, origSubs = DB.getActiveSubjects,
      origModo = window.planCycleMode, origInc = ReforcoEngine._incidByDisc;
    try {
      const dia = (n) => { const d = new Date(todayLocal() + 'T00:00:00'); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };
      const snap = (id, d, q, tx) => ({ id, nome: id, date: dia(d), startDate: dia(d + 7), endDate: dia(d),
        rows: [{ depth: 1, codigo: 'T', nome: 'T', disciplina: 'D', questoes: q, acertos: Math.round(q * tx / 100) }] });
      DB.getActiveSubjects = () => []; window.planCycleMode = () => 'pre';
      ReforcoEngine._incidByDisc = () => ({});
      const medir = (snaps, alvo) => {
        DB.getTecSnapshots = () => snaps;
        PlanoEngine.salvarPrefs({ disciplina: '__todas__', minAmostra: 20, amostraAlvo: alvo,
          pisoSerie: 5, sensTendencia: 3, ordenar: 'pior', limite: 30 });
        DesempenhoTecScreen._planoRefC = null;
        DesempenhoTecScreen.renderPlano();
        const r = PlanoEngine.calcular(DesempenhoTecScreen.scopedSnapshot(), PlanoEngine.prefs());
        const x = (r.itens || [])[0] || {};
        return { delta: x.delta, minimo: x.deltaMinimo, firme: x.deltaFirme, melhorando: r.melhorando,
          margem: /dentro da margem/.test(document.getElementById('plano-lista').textContent) };
      };
      return {
        fraca: medir([snap('b1', 21, 10, 65), snap('b2', 7, 70, 88)], 50),
        forte: medir([snap('c1', 21, 200, 60), snap('c2', 7, 200, 80)], 200)
      };
    } finally {
      DB.getTecSnapshots = origSnaps; DB.getActiveSubjects = origSubs;
      window.planCycleMode = origModo; ReforcoEngine._incidByDisc = origInc;
    }
  });
  (setas.fraca.firme === false && setas.fraca.melhorando === 0 && setas.fraca.margem
    && setas.fraca.delta > 3 && setas.fraca.minimo > setas.fraca.delta)
    ? ok(`base curta: sobe ${setas.fraca.delta}pp mas so ${setas.fraca.minimo.toFixed(0)}pp seriam comprovaveis — a tela marca "dentro da margem" e nao conta como melhorando`)
    : erro('a seta acendeu sem sustentacao: ' + JSON.stringify(setas.fraca));
  (setas.forte.firme === true && setas.forte.melhorando === 1 && !setas.forte.margem
    && setas.forte.delta > setas.forte.minimo)
    ? ok(`e com volume dos dois lados a seta fica CHEIA: ${setas.forte.delta}pp contra ${setas.forte.minimo.toFixed(0)}pp de minimo`)
    : erro('a seta firme deixou de acender: ' + JSON.stringify(setas.forte));

  /* ── O CONSELHO DE CADA ASSUNTO DIZ QUANTAS QUESTOES, E PARA QUE ──────
     Era "um bloco de ~B questoes" com B = custoQ/4: um quarto de uma
     estimativa, sem pergunta por tras. Agora sao duas contas fechadas — a
     amostra que MEDE (n = z²·p(1−p)/E², E = 10pp) e a que PROVA a subida ate
     a meta (teste de duas proporcoes, 80% de poder). Quando a medicao de hoje
     e curta demais para sustentar a comparacao, a tela diz isso em vez de
     inventar um numero. */
  const qtd = await pag.evaluate(() => {
    const origSnaps = DB.getTecSnapshots, origSubs = DB.getActiveSubjects,
      origModo = window.planCycleMode, origInc = ReforcoEngine._incidByDisc;
    try {
      const dia = (n) => { const d = new Date(todayLocal() + 'T00:00:00'); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };
      const specs = [['Critico', 40, 33], ['Fragil', 40, 58], ['Desenv', 40, 75]];
      const rs = specs.map(([n, q, tx]) => ({ depth: 1, codigo: n, nome: n, disciplina: 'D', questoes: q, acertos: Math.round(q * tx / 100) }));
      DB.getTecSnapshots = () => ([{ id: 'q1', nome: 'q1', date: dia(5), startDate: dia(35), endDate: dia(5), rows: rs }]);
      DB.getActiveSubjects = () => []; window.planCycleMode = () => 'pre';
      ReforcoEngine._incidByDisc = () => ({});
      PlanoEngine.salvarPrefs({ disciplina: '__todas__', minAmostra: 20, metaDominio: 85,
        faixaCritico: 50, faixaFragil: 65, ordenar: 'pior', limite: 30, incluirPequenas: false });
      DesempenhoTecScreen._planoRefC = null;
      DesempenhoTecScreen.renderPlano();
      const r = PlanoEngine.calcular(DesempenhoTecScreen.scopedSnapshot(), PlanoEngine.prefs());
      const de = (n) => (r.itens || []).find((x) => x.nome === n) || {};
      return {
        critico: (de('Critico').status || {}).acao || '',
        fragil: (de('Fragil').status || {}).acao || '',
        desenv: (de('Desenv').status || {}).acao || '',
        qMedirFragil: de('Fragil').qMedir, formula: PlanoEngine.qParaMedir(de('Fragil').taxa),
        provarDesenv: PlanoEngine.qParaProvar(de('Desenv').taxa, de('Desenv').qJanela, 85 - de('Desenv').taxa),
        txt: document.getElementById('plano-lista').textContent
      };
    } finally {
      DB.getTecSnapshots = origSnaps; DB.getActiveSubjects = origSubs;
      window.planCycleMode = origModo; ReforcoEngine._incidByDisc = origInc;
    }
  });
  (/retome a teoria/.test(qtd.critico) && /bloco de \d+ questões/.test(qtd.critico))
    ? ok('no critico a tela manda a TEORIA primeiro e so depois o bloco que remede o nivel')
    : erro('o conselho do critico perdeu a teoria ou o numero: ' + qtd.critico.slice(0, 140));
  (qtd.qMedirFragil === qtd.formula && /\d+ questões \(o que dá ±10pp de margem\)/.test(qtd.fragil) && !/~/.test(qtd.fragil))
    ? ok(`no fragil o bloco e a amostra da formula (${qtd.qMedirFragil}q para ±10pp), nao mais um quarto do custo`)
    : erro('o bloco do fragil nao saiu da formula: ' + JSON.stringify({ q: qtd.qMedirFragil, f: qtd.formula, t: qtd.fragil.slice(0, 140) }));
  (qtd.provarDesenv === null && /são poucas para comprovar/.test(qtd.desenv))
    ? ok('e quando a medicao de hoje e curta demais para provar a subida, a tela diz isso em vez de inventar um numero')
    : erro('o limite da comprovacao nao foi declarado: ' + JSON.stringify({ p: qtd.provarDesenv, t: qtd.desenv.slice(0, 140) }));
  !/\bNaN\b|\bundefined\b|\bInfinity\b/.test(qtd.txt)
    ? ok('nenhum numero podre nos conselhos') : erro('numero podre no conselho dos assuntos');

  /* ── A FILA NAO PODE PROMETER O QUE A AMOSTRA NAO SUSTENTA ────────────
     Simulacao com 40 assuntos e taxas verdadeiras conhecidas: com 20 a 50
     questoes por assunto, a fila por "pior acerto" acerta 55% dos cinco piores
     REAIS — e mesmo assim captura 91% do ganho disponivel. A posicao no topo e
     quase sorteio; a escolha entre os primeiros e quase otima. Calar isso
     empurra o aluno a refazer a fila atras de um 1o lugar que o dado nao
     sustenta. (Encolhimento bayesiano foi medido nos quatro regimes e movia o
     acerto em ±1pp: descartado.) */
  const emp = await pag.evaluate(() => {
    const origSnaps = DB.getTecSnapshots, origSubs = DB.getActiveSubjects,
      origModo = window.planCycleMode, origInc = ReforcoEngine._incidByDisc;
    try {
      const dia = (n) => { const d = new Date(todayLocal() + 'T00:00:00'); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };
      const montar = (specs) => {
        const rs = specs.map(([n, q, tx]) => ({ depth: 1, codigo: n, nome: n, disciplina: 'D', questoes: q, acertos: Math.round(q * tx / 100) }));
        DB.getTecSnapshots = () => ([{ id: 'emp', nome: 'emp', date: dia(5), startDate: dia(35), endDate: dia(5), rows: rs }]);
        DesempenhoTecScreen._planoRefC = null;
        DesempenhoTecScreen.renderPlano();
        return { r: PlanoEngine.calcular(DesempenhoTecScreen.scopedSnapshot(), PlanoEngine.prefs()),
          txt: document.getElementById('plano-lista').textContent.replace(/\s+/g, ' ') };
      };
      DB.getActiveSubjects = () => []; window.planCycleMode = () => 'pre';
      ReforcoEngine._incidByDisc = () => ({});
      const sel = document.getElementById('plano-ordenar');
      if (sel) sel.value = 'pior';
      PlanoEngine.salvarPrefs({ disciplina: '__todas__', minAmostra: 20, ordenar: 'pior',
        limite: 30, amostraAlvo: 50, ritmoSemanal: 300, incluirPequenas: false });
      const curta = montar([['T1', 22, 33], ['T2', 24, 42], ['T3', 21, 48], ['T4', 23, 52], ['T5', 200, 80]]);
      const larga = montar([['T1', 400, 33], ['T2', 400, 42], ['T3', 400, 48], ['T4', 400, 52], ['T5', 400, 80]]);
      return {
        empCurta: curta.r.empatados, avisoCurta: /empatados dentro da margem de erro/.test(curta.txt),
        empLarga: larga.r.empatados, avisoLarga: /empatados dentro da margem de erro/.test(larga.txt),
        taxas: curta.r.itens.slice(0, 4).map((x) => x.taxa.toFixed(0) + '%±' + x.margem.toFixed(0))
      };
    } finally {
      DB.getTecSnapshots = origSnaps; DB.getActiveSubjects = origSubs;
      window.planCycleMode = origModo; ReforcoEngine._incidByDisc = origInc;
    }
  });
  (emp.empCurta >= 3 && emp.avisoCurta && emp.empLarga === 1 && !emp.avisoLarga)
    ? ok(`com amostra curta a tela declara os ${emp.empCurta} primeiros empatados (${emp.taxas.join(', ')}); com 400q cada, as mesmas taxas viram diferenca real e o aviso some`)
    : erro('o empate tecnico falhou: ' + JSON.stringify(emp));

  /* O AVISO TEM DE MUDAR ALGUMA COISA. Ele derivava a sugestao do MAIOR
     assunto em faixas fixas: com o alvo em 50 e o maior em 72, sugeria 50. */
  (num.alvo.inviavel && num.alvo.sugerido != null && num.alvo.sugerido < num.alvo.atual)
    ? ok(`aviso de amostra: so ${num.alvo.comAlvo} de ${num.alvo.assuntos} chegam a ${num.alvo.atual} (maior ${num.alvo.maior}) e a sugestao e ${num.alvo.sugerido}, nao ${num.alvo.atual}`)
    : erro('o aviso de amostra sugere o que ja esta ligado: ' + JSON.stringify(num.alvo));
  (num.bruto < -10 && num.comparavel > 10 && /^\+/.test(num.cracha) && num.nota)
    ? ok(`trajetoria: a diferenca crua dizia ${num.bruto}pp com todo assunto subindo; o cracha agora diz "${num.cracha}" e a tela explica a linha`)
    : erro('a trajetoria ainda mente na direcao: ' + JSON.stringify(num));
  (num.botaoTraj && num.analiseTraj)
    ? ok('e os numeros por tras da trajetoria (serie importacao por importacao) abrem no "i", fora da tela')
    : erro('a analise da trajetoria nao esta acessivel: ' + JSON.stringify({ botao: num.botaoTraj, analise: num.analiseTraj }));

  (esf.casaGenero === 'lingua portuguesa' && esf.naoCasaIrmas === undefined && esf.naoCasaAmbiguo === undefined)
    ? ok('e o casamento de nomes, onde ainda e preciso (edital digitado x banca), segue conservador')
    : erro('o casamento de nomes virou palpite: ' + JSON.stringify(esf));

  pts.tempo ? ok('e o quadro de esforco por materia esta na tela') : erro('o quadro de esforco sumiu');
  !pts.podre ? ok('nenhum numero podre em nada disso') : erro('numero podre na tela de pontos');
  await pag.evaluate(() => { DB._set(DB.KEYS.extras, []); });
  await pag.setViewportSize({ width: 1280, height: 900 });
} catch (e) { erro('a gestao/regua de pontos falhou: ' + e.message); }

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
