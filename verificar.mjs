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
     7. nenhum texto abaixo do contraste WCAG AA — nos temas claro E escuro

   As checagens 5 a 7 precisam do Chromium (Playwright). Se ele não estiver
   instalado, elas são PULADAS com aviso — as quatro primeiras sempre rodam.

   Uso:  node verificar.mjs        (tudo)
         node verificar.mjs --rapido   (só 1 a 4, sem navegador)
   ═══════════════════════════════════════════════════════════════════════════ */
import { readFileSync, readdirSync } from 'node:fs';
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
const nav = await chromium.launch();
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
   explicacao da ordem, lista, segundo plano e lacunas do edital) tambem e
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
      edital: !!q('.pl-edital'), segundo: /SEGUNDO PLANO/i.test(txt('#plano-lista')),
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
  est.segundo ? ok('segundo plano (sem diagnostico) presente') : erro('segundo plano ausente');
  est.edital ? ok('lacunas do planejamento sem medicao no TEC presentes') : erro('bloco de lacunas do edital ausente');
  est.overflow === 0 ? ok('nenhum vazamento horizontal a 360px') : erro(`o plano vaza ${est.overflow}px na horizontal a 360px`);
  /* Todo campo de ajuste tem de ter o seu "i". Um campo novo sem explicacao e
     exatamente como esta tela ficou confusa da primeira vez. */
  (est.semDica === 0 && est.camposNaFolha >= 20)
    ? ok(`todos os ${est.camposNaFolha} campos de ajuste do Plano tem dica explicativa`)
    : erro(`${est.semDica} campo(s) sem o "i" (de ${est.camposNaFolha} encontrados — se veio zero, o seletor perdeu os campos)`);
  /* Os rotulos das ordens moram numa tabela so. Se o select voltar a ser uma
     copia estatica, ele diverge do texto que explica a ordem escolhida — foi
     exatamente o que aconteceu com o dialogo "Puxar do Plano". */
  const ord = await pag.evaluate(() => {
    const sel = document.getElementById('plano-ordenar');
    // as ordens que só existem pós-edital não entram no seletor no pré
    const chaves = Object.keys(PlanoEngine.ORDENS).filter((k) => !PlanoEngine.ORDENS[k].soPos);
    return {
      opcoes: sel ? [...sel.options].map((o) => o.value) : [],
      semDica: sel ? [...sel.options].filter((o) => !o.title).length : -1,
      chaves,
      textoBate: sel ? [...sel.options].every((o) => o.text === PlanoEngine.ORDENS[o.value].rot) : false
    };
  });
  (ord.opcoes.length === ord.chaves.length && ord.semDica === 0 && ord.textoBate)
    ? ok(`as ${ord.opcoes.length} ordens de ataque saem da mesma tabela, cada uma com "quando usar"`)
    : erro('o select de ordem divergiu da tabela do motor: ' + JSON.stringify(ord));
  /* O botao que vira o plano em TAREFA e o unico ponto da tela que muda dados.
     Se ele quebra, a tela inteira volta a ser um relatorio bonito. */
  const lote = await pag.evaluate(() => {
    const antes = DB.getExtras().length;
    const b = document.getElementById('plano-lote');
    if (!b) return { faltando: true };
    b.click();
    const depois = DB.getExtras();
    return { criadas: depois.length - antes, comOrigem: depois.filter((e) => e.origemPlano && e.origemPlano.topico).length };
  });
  (!lote.faltando && lote.criadas >= 1 && lote.comOrigem >= 1)
    ? ok(`criar em lote gerou ${lote.criadas} atividade(s) ligada(s) ao Plano`)
    : erro('o botao de criar atividades em lote nao funcionou: ' + JSON.stringify(lote));
  // trocar de modo de ataque tem de reconfigurar o plano de verdade
  const modo = await pag.evaluate(() => {
    const b = document.querySelector('#plano-modos .pl-modo[data-modo="curto"]');
    if (!b) return { faltando: true };
    b.click();
    const p = PlanoEngine.prefs();
    return { ordenar: p.ordenar, limite: p.limite, ativo: PlanoEngine.modoAtivo(p) };
  });
  await pag.waitForTimeout(250);
  (modo.ativo === 'curto' && modo.ordenar === 'rendimento')
    ? ok('trocar de modo de ataque reconfigura o plano (⏱️ Tempo curto)')
    : erro('o modo de ataque nao foi aplicado: ' + JSON.stringify(modo));
  await pag.setViewportSize({ width: 1280, height: 900 });
} catch (e) { erro('o Plano nao renderizou com dado real: ' + e.message); }


/* ── 6.9) AS OUTRAS TRES ABAS DO DESEMPENHO TEC ────────────────────────────
   Analise, Incidencia e Reforco tinham a mesma sorte que o Plano tinha antes:
   nenhuma checagem chegava nelas com dado de verdade. As invariantes abaixo
   sao as que, quando quebram, quebram calado — um numero plausivel no lugar
   de um numero certo. */
console.log('\n6.9) Analise, Incidencia e Reforco com dado real');
try {
  await pag.setViewportSize({ width: 360, height: 780 });
  // ── ANALISE ──────────────────────────────────────────────────────────────
  const an = await pag.evaluate(async () => {
    DesempenhoTecScreen.switchTecTab('analise');
    DesempenhoTecScreen.renderAnalysis();
    await new Promise((r) => setTimeout(r, 150));
    /* textContent, nao innerText: `.weak-row` usa content-visibility:auto, e o
       que esta fora da tela some do innerText — o teste reprovaria o app por
       uma otimizacao de render. */
    const txt = (s) => { const e = document.querySelector(s); return e ? e.textContent : ''; };
    const antes = [...document.querySelectorAll('#tec-weak-list .weak-row .wname')].map((e) => e.textContent);
    const sel = document.getElementById('tec-weak-ordenar');
    sel.value = 'impacto'; sel.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 150));
    const depois = [...document.querySelectorAll('#tec-weak-list .weak-row .wname')].map((e) => e.textContent);
    sel.value = 'taxa'; sel.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 120));
    return {
      legenda: !!document.querySelector('#tec-weak-list .weak-legenda'),
      margem: /±\d+pp/.test(txt('#tec-weak-list')),
      delta: !!document.querySelector('#tec-totais .tec-delta'),
      legendaTotais: /compara o último retrato/i.test(txt('#tec-totais')),
      ordemTaxa: antes.join('|'),
      limiar: document.getElementById('tec-weak-threshold').value,
      metaPlano: String(PlanoEngine.prefs().metaDominio),
      mudouOrdem: antes.join('|') !== depois.join('|'),
      itens: antes.length
    };
  });
  an.legenda ? ok('pontos fracos trazem a legenda do criterio') : erro('legenda dos pontos fracos ausente');
  an.margem ? ok('cada ponto fraco mostra a margem de erro (±pp)') : erro('a margem de erro nao aparece nos pontos fracos');
  an.delta && an.legendaTotais
    ? ok('a evolucao aparece no escopo consolidado, dizendo o que compara')
    : erro('o delta do aproveitamento nao aparece no escopo padrao: ' + JSON.stringify(an));
  an.limiar === an.metaPlano ? ok(`o limiar de ponto fraco nasce da meta do Plano (${an.limiar}%)`)
    : erro(`limiar ${an.limiar}% divergente da meta do Plano ${an.metaPlano}%`);
  an.mudouOrdem ? ok('o modo "mais erros" produz uma fila diferente de "pior taxa"')
    : erro('os dois modos de leitura dos pontos fracos dao a mesma lista');

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

  // ── REFORCO ──────────────────────────────────────────────────────────────
  const rf = await pag.evaluate(async () => {
    const ler = () => ({
      itens: document.querySelectorAll('#reforco-list .reforco-row').length,
      status: (document.getElementById('reforco-status') || {}).innerText || '',
      casamento: (document.getElementById('reforco-casamento') || {}).innerText || ''
    });
    // 1) SEM incidencia: a aba tem de funcionar pelo erro puro
    const guardado = DB.getIncidencia();
    DB.saveIncidencia([]);
    DesempenhoTecScreen.switchTecTab('reforco');
    await new Promise((r) => setTimeout(r, 250));
    const sem = ler();
    // 2) COM incidencia
    DB.saveIncidencia(guardado);
    DesempenhoTecScreen.renderReforco();
    await new Promise((r) => setTimeout(r, 250));
    const com = ler();
    // 3) granularidade em tres estados
    const tog = document.getElementById('reforco-gran-toggle');
    const antes = document.getElementById('reforco-gran').value;
    tog.querySelector('button[data-gran="0"]').click();
    await new Promise((r) => setTimeout(r, 200));
    const gran = { valor: document.getElementById('reforco-gran').value, ativos: tog.querySelectorAll('button.active').length };
    tog.querySelector('button[data-gran="' + antes + '"]').click();
    await new Promise((r) => setTimeout(r, 200));
    return { sem, com, gran };
  });
  rf.sem.itens > 0 ? ok(`sem incidencia o Reforco ordena pelo seu erro (${rf.sem.itens} assuntos)`)
    : erro('sem incidencia o Reforco continua vazio: ' + JSON.stringify(rf.sem));
  /^(?!.*prioriza só pelo seu erro\.).*$/.test(rf.sem.status) && /só pelo seu erro/.test(rf.sem.status)
    ? ok('e o status explica que a fila esta cega para a prova')
    : erro('status do Reforco sem incidencia: ' + rf.sem.status.slice(0, 120));
  rf.com.itens > 0 ? ok(`com incidencia o ranking cruza banca e erro (${rf.com.itens} unidades)`)
    : erro('o Reforco com incidencia veio vazio');
  /Improbidade/.test(rf.com.casamento)
    ? ok('assunto da banca sem correspondencia vira aviso de casamento, nao ponto cego')
    : erro('o aviso de casamento nao apareceu: ' + rf.com.casamento.slice(0, 120));
  (rf.gran.valor === '0' && rf.gran.ativos === 1)
    ? ok('granularidade e um seletor de tres estados, nao um cursor de 101')
    : erro('o seletor de granularidade nao respondeu: ' + JSON.stringify(rf.gran));

  // ── "i" em todos os controles das tres abas ─────────────────────────────
  const dicas = await pag.evaluate(() => {
    /* Inclui a FOLHA DE AJUSTES: e la que moram os campos das tres abas desde
       que a tela deixou de abrir em formulario. Sem esses dois seletores o
       teste conta zero campos e passa sem olhar nada. */
    const alvos = ['#tec-panel-analise', '#tec-panel-incidencia', '#tec-panel-reforco',
      '#tec-cfg-body .tec-cfg-sec[data-tab="analise"]', '#tec-cfg-body .tec-cfg-sec[data-tab="reforco"]'];
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
  dicas.length === 0 ? ok('todos os controles das tres abas tem dica explicativa')
    : erro(`${dicas.length} controle(s) sem "i": ` + dicas.slice(0, 6).join(' | '));
  await pag.setViewportSize({ width: 1280, height: 900 });
} catch (e) { erro('as tres abas nao renderizaram com dado real: ' + e.message); }


/* ── 6.10) OS CAMINHOS QUE SO EXISTEM NA TELA ──────────────────────────────
   O motor tem teste proprio. O que so o navegador exerce — abrir o dialogo do
   modo, marcar caixas, ver o botao mudar de rotulo — nao tinha nenhum. Sao
   justamente os pontos onde um listener esquecido nao quebra nada: so deixa de
   funcionar, calado (foi assim que o seletor de ordem dos pontos fracos nasceu
   decorativo). */
console.log('\n6.10) dialogos e escolhas do Plano, no navegador');
try {
  await pag.setViewportSize({ width: 390, height: 900 });
  await pag.evaluate(() => { switchScreen('desempenhotec'); DesempenhoTecScreen.switchTecTab('plano'); });
  await pag.waitForTimeout(400);

  // ── ✎ EDITAR UM MODO ────────────────────────────────────────────────────
  const edit = await pag.evaluate(async () => {
    const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
    PlanoEngine.restaurarModo('curto');
    document.querySelector('#plano-modos .pl-modo-edit[data-editar="curto"]').click();
    await esperar(250);
    const campo = document.getElementById('uip_metaDominio');
    if (!campo) return { faltando: true };
    const antes = campo.value;
    campo.value = '92';
    document.getElementById('ui-modal-ok').click();
    await esperar(350);
    return { antes, patch: PlanoEngine.modoPatch('curto'), editado: PlanoEngine.modoEditado('curto'),
      ponto: !!document.querySelector('#plano-modos .pl-modo-edit-dot') };
  });
  (!edit.faltando && edit.patch.metaDominio === 92 && edit.editado && edit.ponto)
    ? ok(`ajustar um modo pelo ✎ guarda o valor (meta ${edit.antes}% → 92%) e marca o chip`)
    : erro('o dialogo de ajuste do modo nao funcionou: ' + JSON.stringify(edit));

  // aplicar o modo ajustado tem de levar o valor ajustado para a tela
  const aplicou = await pag.evaluate(async () => {
    document.querySelector('#plano-modos .pl-modo[data-modo="curto"]').click();
    await new Promise((r) => setTimeout(r, 350));
    return { meta: PlanoEngine.prefs().metaDominio, campo: document.getElementById('plano-meta').value,
      ativo: PlanoEngine.modoAtivo() };
  });
  (aplicou.meta === 92 && aplicou.campo === '92' && aplicou.ativo === 'curto')
    ? ok('aplicar o modo ajustado leva o ajuste para o plano inteiro')
    : erro('o modo ajustado nao foi aplicado: ' + JSON.stringify(aplicou));

  // ── ↺ RESTAURAR SO AQUELE MODO ──────────────────────────────────────────
  const rest = await pag.evaluate(async () => {
    const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
    PlanoEngine.salvarModo('base', { custoPiso: 77 });      // outro modo tambem ajustado
    DesempenhoTecScreen.renderPlano();
    await esperar(150);
    document.querySelector('#plano-modos .pl-modo-edit[data-editar="curto"]').click();
    await esperar(250);
    const sel = document.getElementById('uip_restaurar');
    if (!sel) return { faltando: true };
    sel.value = '1';
    document.getElementById('ui-modal-ok').click();
    await esperar(350);
    return { curto: PlanoEngine.modoEditado('curto'), base: PlanoEngine.modoEditado('base'),
      pisoBase: PlanoEngine.modoPatch('base').custoPiso,
      /* O dialogo nasce de PlanoEngine.MODO_CAMPOS: cada campo declarado tem de
         ter virado um campo na tela, e o passo de leitura NAO pode estar la. */
      camposNoDialogo: PlanoEngine.MODO_CAMPOS.filter((c) => !document.getElementById('uip_' + c.key)).map((c) => c.key),
      temLimite: !!document.getElementById('uip_limite') };
  });
  (!rest.faltando && rest.curto === false && rest.base === true && rest.pisoBase === 77)
    ? ok('restaurar um modo devolve so ele ao padrao, sem tocar nos outros')
    : erro('o restaurar por modo nao funcionou: ' + JSON.stringify(rest));
  (rest.camposNoDialogo && rest.camposNoDialogo.length === 0 && rest.temLimite === false)
    ? ok('o dialogo do modo mostra TODOS os parametros que o modo guarda — e so eles')
    : erro('os campos do modo divergem do que ele guarda: ' + JSON.stringify(rest));
  await pag.evaluate(() => { PlanoEngine.restaurarModo('base'); PlanoEngine.salvarPrefs(PlanoEngine.modoPatch('base')); DesempenhoTecScreen.renderPlano(); });
  await pag.waitForTimeout(300);

  // ── ESCOLHER O QUE VIRA ATIVIDADE ───────────────────────────────────────
  const escolha = await pag.evaluate(async () => {
    const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
    const caixas = [...document.querySelectorAll('.pl-hoje-sel:not(:disabled)')];
    if (caixas.length < 2) return { poucas: caixas.length };
    const btn = document.getElementById('plano-lote');
    // desmarca tudo: o botao tem de se desabilitar e dizer o que falta
    caixas.forEach((c) => { if (c.checked) { c.checked = false; c.dispatchEvent(new Event('change', { bubbles: true })); } });
    await esperar(120);
    const vazio = { txt: btn.textContent.trim(), off: btn.disabled };
    // marca SO um dos "proximos" (fora do bloco): tem de criar aquele, e so aquele
    const alvo = caixas[caixas.length - 1];
    const nome = alvo.dataset.topico;
    alvo.checked = true; alvo.dispatchEvent(new Event('change', { bubbles: true }));
    await esperar(120);
    const um = { txt: btn.textContent.trim(), off: btn.disabled };
    const antes = DB.getExtras().length;
    btn.click();
    await esperar(400);
    const criadas = DB.getExtras().slice(antes);
    return { vazio, um, nome, n: criadas.length, casou: criadas.some((e) => e.origemPlano && e.origemPlano.topico === nome) };
  });
  (escolha.vazio && escolha.vazio.off && /Marque ao menos/.test(escolha.vazio.txt))
    ? ok('sem nada marcado, o botao se desabilita e pede a escolha')
    : erro('o botao de criar nao reagiu a lista vazia: ' + JSON.stringify(escolha.vazio || escolha));
  (escolha.n === 1 && escolha.casou && /Criar a atividade marcada/.test(escolha.um.txt))
    ? ok('marcar um assunto da fila seguinte cria exatamente aquele')
    : erro('a escolha do bloco nao criou o assunto certo: ' + JSON.stringify(escolha));

  // ── A REGUA UNICA SEGUE O PLANO ATE VOCE MEXER ──────────────────────────
  const regua = await pag.evaluate(async () => {
    const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
    const p = DesempenhoTecScreen._loadPrefs();
    delete p.weakLimiar;
    DB.setRaw(DesempenhoTecScreen._prefsKey(), JSON.stringify(p));
    PlanoEngine.salvarPrefs({ metaDominio: 77 });
    DesempenhoTecScreen.switchTecTab('analise');
    DesempenhoTecScreen.renderAnalysis();
    await esperar(200);
    const herdado = document.getElementById('tec-weak-threshold').value;
    // agora a pessoa escolhe outro corte: a partir daqui a escolha manda
    const el = document.getElementById('tec-weak-threshold');
    el.value = '60'; el.dispatchEvent(new Event('input', { bubbles: true }));
    await esperar(200);
    PlanoEngine.salvarPrefs({ metaDominio: 85 });
    DesempenhoTecScreen.renderAnalysis();
    await esperar(200);
    const proprio = document.getElementById('tec-weak-threshold').value;
    return { herdado, proprio };
  });
  (regua.herdado === '77' && regua.proprio === '60')
    ? ok('o limiar herda a meta do Plano ate voce escolher o seu (77% → 60%)')
    : erro('a regua unica nao se comportou: ' + JSON.stringify(regua));
  await pag.setViewportSize({ width: 1280, height: 900 });
} catch (e) { erro('os dialogos do Plano falharam: ' + e.message); }


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

    // estado ANTES: preferencias proprias, um modo ajustado e uma atividade em curso
    PlanoEngine.salvarModo('base', { metaDominio: 88 });
    PlanoEngine.salvarPrefs(PlanoEngine.modoPatch('base'));
    DesempenhoTecScreen.savePrefs({ weakLimiar: 62 });
    DesempenhoTecScreen.switchTecTab('plano');
    await esperar(300);
    const alvo = (PlanoEngine.calcular(DesempenhoTecScreen.scopedSnapshot(), PlanoEngine.prefs()).itens[0] || {});
    DB.getExtras().filter((e) => e.origemPlano).forEach((e) => DB.deleteExtra && DB.deleteExtra(e.id));
    DesempenhoTecScreen.criarExtraDoPlano(alvo.nome, alvo.disciplina, alvo.custoQ, 'reforco');
    await esperar(250);
    const extra = DB.getExtras().find((e) => e.origemPlano && e.origemPlano.topico === alvo.nome);
    const antes = {
      taxa: alvo.taxa, dominio: PlanoEngine.calcular(DesempenhoTecScreen.scopedSnapshot(), PlanoEngine.prefs()).dominioPct,
      taxaInicial: extra && extra.origemPlano.taxaInicial, modo: PlanoEngine.modoPatch('base').metaDominio,
      limiar: DesempenhoTecScreen._loadPrefs().weakLimiar, retratos: DB.getTecSnapshots().length
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
    DesempenhoTecScreen.switchTecTab('plano');
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
        modo: PlanoEngine.modoPatch('base').metaDominio,
        limiar: DesempenhoTecScreen._loadPrefs().weakLimiar,
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
  (d.modo === 88 && d.limiar === 62)
    ? ok('o modo ajustado e o limiar escolhido sobrevivem a importacao')
    : erro('a importacao levou as preferencias junto: ' + JSON.stringify({ modo: d.modo, limiar: d.limiar }));
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
    const estado = () => {
      const r = ReforcoEngine.suggestFrontier(DesempenhoTecScreen.scopedSnapshot(),
        { banca: DesempenhoTecScreen.bancaFiltro(), minQuestoes: 10, granularidade: 1, limite: 20 });
      const lic = r.items.find((i) => /Licita/.test(i.nome));
      return {
        rotulo: document.querySelector('#incid-banca-pick .banca-pick-btn span').textContent.trim(),
        blocos: document.querySelectorAll('#incid-bancas-list .incid-banca-block').length,
        resumo: (document.getElementById('incid-selecao-resumo') || {}).textContent || '',
        incid: lic ? lic.incidencia : null,
        vezes: r.items.filter((i) => /Licita/.test(i.nome)).length
      };
    };
    const todas = estado();
    await marcar('FGV');
    const uma = estado();
    await marcar('Cebraspe');
    const duas = estado();
    // a mesma selecao tem de valer nas outras abas
    DesempenhoTecScreen.switchTecTab('plano');
    await esperar(350);
    const noPlano = {
      rotulo: (document.querySelector('#plano-banca-pick .banca-pick-btn span') || {}).textContent || '',
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
  (sel.todas.incid === 166 && sel.todas.vezes === 1)
    ? ok('todas as bancas somam num assunto so (40+26+100 = 166)')
    : erro('a soma de todas as bancas saiu errada: ' + JSON.stringify(sel.todas));
  (sel.uma.incid === 40 && /FGV/.test(sel.uma.rotulo) && sel.uma.blocos === 1)
    ? ok('marcar uma banca restringe a conta e a lista de bancas (FGV, 40)')
    : erro('a selecao de uma banca nao pegou: ' + JSON.stringify(sel.uma));
  (sel.duas.incid === 66 && /2 bancas/.test(sel.duas.rotulo) && sel.duas.blocos === 2 && /FGV e Cebraspe|Cebraspe e FGV/.test(sel.duas.resumo))
    ? ok('duas bancas somam so as duas (40+26 = 66) e o resumo nomeia as duas')
    : erro('a soma de duas bancas saiu errada: ' + JSON.stringify(sel.duas));
  (/2 bancas/.test(sel.noPlano.rotulo) && Array.isArray(sel.noPlano.filtro) && sel.noPlano.filtro.length === 2)
    ? ok('a mesma selecao vale no Plano, sem precisar escolher de novo')
    : erro('a selecao nao atravessou para o Plano: ' + JSON.stringify(sel.noPlano));
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
    DesempenhoTecScreen.switchTecTab('plano');
  });
  await pag.waitForTimeout(400);
  const hom = await pag.evaluate(() => {
    const texto = [...document.querySelectorAll('#plano-lista .pl-item')].map((e) => e.textContent.replace(/\s+/g, ' '));
    const r = PlanoEngine.calcular(DesempenhoTecScreen.scopedSnapshot(), PlanoEngine.prefs());
    const p = r.itens.filter((x) => /Princ[ií]pios/.test(x.nome));
    return { comPrincipios: texto.filter((t) => /Princ[ií]pios/.test(t)).length,
      // a taxa vem do motor: no texto da linha ha varios "%" e o primeiro nao e este
      taxas: p.map((x) => Math.round(x.taxa)), discs: p.map((x) => x.disciplina) };
  });
  (hom.comPrincipios === 2 && hom.taxas.length === 2 && new Set(hom.taxas).size === 2 && new Set(hom.discs).size === 2)
    ? ok(`os dois "Principios" viram duas linhas, com a taxa de cada um (${hom.taxas.join('% e ')}%)`)
    : erro('os homonimos nao viraram duas linhas: ' + JSON.stringify(hom));
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
  await pag.evaluate(() => { switchScreen('desempenhotec'); DesempenhoTecScreen.switchTecTab('plano'); });
  await pag.waitForTimeout(400);
  // 1) nenhuma aba abre com campo de ajuste solto na tela
  const solto = await pag.evaluate(() => {
    const out = {};
    ['analise', 'reforco', 'plano'].forEach((t) => {
      DesempenhoTecScreen.switchTecTab(t);
      const p = document.getElementById('tec-panel-' + t);
      out[t] = {
        campos: p ? p.querySelectorAll('.rfc-field input, .rfc-field select, .tec-filterbar input, .tec-filterbar select').length : -1,
        porta: !!(p && p.querySelector('.tec-cfg-open')),
        etiquetas: p ? p.querySelectorAll('.tec-cfg-pill').length : 0,
        alturaBarra: p && p.querySelector('.tec-cfg-bar') ? Math.round(p.querySelector('.tec-cfg-bar').getBoundingClientRect().height) : -1
      };
    });
    DesempenhoTecScreen.switchTecTab('plano');
    return out;
  });
  const tudoLimpo = ['analise', 'reforco', 'plano'].every((t) => solto[t].campos === 0 && solto[t].porta && solto[t].etiquetas >= 3);
  tudoLimpo
    ? ok(`as tres abas abrem em RESULTADO: 0 campos soltos, a porta ⚙ e ${['analise', 'reforco', 'plano'].map((t) => solto[t].etiquetas).join('/')} etiquetas do que esta valendo`)
    : erro('ainda ha ajuste solto na tela: ' + JSON.stringify(solto));
  const maisAlta = Math.max(...['analise', 'reforco', 'plano'].map((t) => solto[t].alturaBarra));
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
    document.querySelector('.tec-cfg-open[data-cfg="plano"]').click();
    const chips = [...document.querySelectorAll('#tec-cfg-nav button')].map((b) => b.dataset.sec);
    const visiveis = () => [...document.querySelectorAll('#tec-cfg-body .tec-cfg-sec')].filter((s) => !s.hidden);
    const inicio = visiveis().map((s) => s.dataset.tab + '/' + s.dataset.sec);
    TecAjustes.mostrar('esforco');
    const depois = visiveis().map((s) => s.dataset.tab + '/' + s.dataset.sec);
    return { chips, inicio, depois };
  });
  (abre.chips.length === 6 && abre.inicio.length === 1 && abre.depois.length === 1 && abre.depois[0] === 'plano/esforco')
    ? ok(`a folha do Plano tem ${abre.chips.length} secoes e mostra UMA por vez (${abre.inicio[0]} → ${abre.depois[0]})`)
    : erro('a folha nao esta mostrando uma secao por vez: ' + JSON.stringify(abre));

  /* 4) As tres abas dividem o mesmo corpo. Esconder so as secoes irmas deixava
     a secao da aba anterior aparecendo por baixo — a folha do Plano exibindo
     os campos do Reforco. */
  const vaza = await pag.evaluate(() => {
    TecAjustes.fechar();
    DesempenhoTecScreen.switchTecTab('reforco');
    document.querySelector('.tec-cfg-open[data-cfg="reforco"]').click();
    return [...document.querySelectorAll('#tec-cfg-body .tec-cfg-sec')].filter((s) => !s.hidden)
      .map((s) => s.dataset.tab + '/' + s.dataset.sec);
  });
  (vaza.length === 1 && vaza[0].indexOf('reforco/') === 0)
    ? ok('trocar de aba nao deixa a secao da outra aparecendo por baixo')
    : erro('secao de outra aba vazou na folha: ' + JSON.stringify(vaza));

  /* 5) CAMPO QUE NAO VALE PARA A SUA CONFIGURACAO NAO E INFORMACAO, E RUIDO.
     Os tres sub-campos de custo eram irmaos permanentes, dois deles sempre
     inertes, com o rotulo pedindo desculpa ("· se fixo: questoes"). */
  const cond = await pag.evaluate(() => {
    TecAjustes.fechar();
    DesempenhoTecScreen.switchTecTab('plano');
    document.querySelector('.tec-cfg-open[data-cfg="plano"]').click();
    TecAjustes.mostrar('esforco');
    const vis = () => [...document.querySelectorAll('#tec-cfg-body [data-cfg-se]')].filter((e) => !e.hidden).map((e) => e.dataset.cfgSe);
    const trocar = (id, v) => { const s = document.getElementById(id); s.value = v; s.dispatchEvent(new Event('change', { bubbles: true })); };
    trocar('plano-customodo', 'lacuna'); const lacuna = vis();
    trocar('plano-customodo', 'fixo'); const fixo = vis();
    trocar('plano-customodo', 'proporcional'); const prop = vis();
    trocar('plano-customodo', 'lacuna');
    return { lacuna, fixo, prop };
  });
  (cond.lacuna.every((x) => /lacuna/.test(x)) && cond.fixo.length === 1 && /fixo/.test(cond.fixo[0])
    && cond.prop.length === 1 && /proporcional/.test(cond.prop[0]))
    ? ok('os sub-campos de custo so aparecem no modo a que pertencem')
    : erro('campo condicional errado: ' + JSON.stringify(cond));

  // 6) mexer num campo aplica NA HORA e atualiza a etiqueta do que esta valendo
  const vivo = await pag.evaluate(() => {
    TecAjustes.mostrar('essencial');
    const el = document.getElementById('plano-meta');
    el.value = '92'; el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    const etiqueta = document.getElementById('plano-cfg-resumo').textContent;
    const gravado = PlanoEngine.prefs().metaDominio;
    const ponto = !!document.querySelector('#tec-cfg-nav button[data-sec="essencial"] .dot');
    return { etiqueta, gravado, ponto };
  });
  (vivo.gravado === 92 && /92/.test(vivo.etiqueta))
    ? ok('mexer num campo aplica na hora e a etiqueta acompanha (meta 92%)')
    : erro('o ajuste nao foi aplicado ao vivo: ' + JSON.stringify(vivo));
  vivo.ponto ? ok('e a secao ganha o ponto de "voce mexeu aqui"')
    : erro('a secao personalizada nao ficou marcada');

  // 7) o pe fica alcancavel: nada de rolar um formulario atras do "Concluir"
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
     se mede, entao, e so o arredondamento sub-pixel de duas posicoes
     fracionarias, e ele oscila com a metrica da fonte: a mesma caixa de 776px
     dava +1 aqui e -1 no runner do CI, onde as fontes instaladas sao outras.
     Exigir `>= 0` era exigir que a sorte do arredondamento caisse sempre para
     o mesmo lado.

     A falha que esta verificacao existe para pegar e o formulario rolando
     ATRAS do "Concluir" — ali o rodape cai dezenas de pixels abaixo da caixa,
     nao um. A tolerancia passa a ser simetrica, e continua apertada o
     suficiente para isso. */
  (Math.abs(pe.dentro) <= 2 && pe.altura <= 844 * 0.93 && pe.vazaH === 0)
    ? ok(`a folha cabe na tela (${pe.altura}px de 844) com o pe preso (${pe.dentro >= 0 ? '+' : ''}${pe.dentro}px) e sem vazamento horizontal`)
    : erro('a folha nao esta contida: ' + JSON.stringify(pe));

  // 8) Esc fecha e o foco volta para a porta por onde se entrou
  const esc = await pag.evaluate(async () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await new Promise((r) => setTimeout(r, 120));
    return { fechada: document.getElementById('tec-cfg-modal').style.display === 'none',
      foco: (document.activeElement || {}).className || '' };
  });
  esc.fechada ? ok('Esc fecha a folha') : erro('Esc nao fechou a folha');
  /^tec-cfg-open/.test(esc.foco) ? ok('e o foco volta para o botao por onde se entrou')
    : erro('o foco nao voltou para a porta: ' + esc.foco);

  // 9) restaurar padroes vale para a aba aberta, e so para ela
  const rest = await pag.evaluate(async () => {
    DesempenhoTecScreen.savePrefs({ minq: 44 });
    document.querySelector('.tec-cfg-open[data-cfg="plano"]').click();
    document.getElementById('tec-cfg-reset').click();
    await new Promise((r) => setTimeout(r, 120));
    document.getElementById('ui-modal-ok').click();
    await new Promise((r) => setTimeout(r, 250));
    return { meta: PlanoEngine.prefs().metaDominio, padrao: PlanoEngine.DEFAULTS.metaDominio,
      reforcoIntacto: DesempenhoTecScreen._loadPrefs().minq };
  });
  (rest.meta === rest.padrao && String(rest.reforcoIntacto) === '44')
    ? ok('restaurar padroes zera SO a aba aberta (meta volta a 85%, o Reforco fica)')
    : erro('restaurar padroes passou dos limites: ' + JSON.stringify(rest));
  /* 9b) A FITA NAO PODE FUGIR DO DEDO. No celular a folha e ancorada embaixo:
     a base fica presa na borda da tela e e o TOPO que se move quando o conteudo
     muda de tamanho. Trocar de secao mexia 219px no topo, e a fita de chips —
     que e justamente o que se esta tocando — subia junto: voce mira em "Regua"
     e o botao sai do lugar entre o toque e o dedo chegar. */
  for (const [larg, alt, rot] of [[390, 844, '390x844'], [360, 640, '360x640'], [1280, 900, 'desktop']]) {
    await pag.setViewportSize({ width: larg, height: alt });
    for (const aba of ['plano', 'reforco', 'analise']) {
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
  await pag.setViewportSize({ width: 390, height: 844 });
  await pag.evaluate(() => { DesempenhoTecScreen.switchTecTab('plano'); });
  await pag.waitForTimeout(250);

  /* 10) E nas OUTRAS DUAS ABAS o "Restaurar padroes" tem de mexer nos CAMPOS,
     nao so no armazenamento: o Reforco e a Analise leem os proprios campos a
     cada repintura, entao apagar a preferencia salva deixava a tela igualzinha
     — um botao que dizia restaurar e nao restaurava nada. */
  const restRef = await pag.evaluate(async () => {
    TecAjustes.fechar();
    DesempenhoTecScreen.switchTecTab('reforco');
    await new Promise((r) => setTimeout(r, 200));
    const minq = document.getElementById('reforco-minq');
    const ord = document.getElementById('reforco-ordenar');
    minq.value = '77'; minq.dispatchEvent(new Event('input', { bubbles: true }));
    ord.value = 'incidencia'; ord.dispatchEvent(new Event('change', { bubbles: true }));
    const antes = { minq: minq.value, ord: ord.value };
    document.querySelector('.tec-cfg-open[data-cfg="reforco"]').click();
    document.getElementById('tec-cfg-reset').click();
    await new Promise((r) => setTimeout(r, 120));
    document.getElementById('ui-modal-ok').click();
    await new Promise((r) => setTimeout(r, 300));
    return { antes, depois: { minq: minq.value, ord: ord.value },
      padrao: { minq: minq.defaultValue, ord: ([...ord.options].find((o) => o.defaultSelected) || {}).value } };
  });
  (restRef.antes.minq === '77' && restRef.depois.minq === restRef.padrao.minq && restRef.depois.ord === restRef.padrao.ord)
    ? ok(`restaurar padroes devolve os CAMPOS do Reforco ao padrao (77 → ${restRef.depois.minq}, ${restRef.antes.ord} → ${restRef.depois.ord})`)
    : erro('restaurar padroes do Reforco nao mexeu nos campos: ' + JSON.stringify(restRef));
  await pag.evaluate(() => { try { TecAjustes.fechar(); } catch (e) {} DesempenhoTecScreen.savePrefs({ minq: null }); });
  await pag.setViewportSize({ width: 1280, height: 900 });
} catch (e) { erro('a folha de ajustes falhou: ' + e.message); }

/* ── 6.15) O CICLO: DECIDI · FIZ · FUNCIONOU? ──────────────────────────────
   A tela media tudo e nao fechava nada. O percurso inteiro, no navegador: criar
   pelo Plano, importar o retrato, e conferir que o app conta as questoes
   sozinho, encerra o que acabou e diz a verdade sobre o que nao funcionou. */
console.log('\n6.15) o ciclo de uma atividade do Plano, ponta a ponta');
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
    PlanoEngine.salvarPrefs({ minAmostra: 1, limite: 20, ordenar: 'pior', metaDominio: 85, tetoDominio: 90, disciplina: '__todas__' });
    DesempenhoTecScreen._planoRefC = null; DesempenhoTecScreen._cicloSel = null;
    switchScreen('desempenhotec'); DesempenhoTecScreen.render(); DesempenhoTecScreen.switchTecTab('plano');
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
    DesempenhoTecScreen.render(); DesempenhoTecScreen.switchTecTab('plano');
    const por = {};
    DB.getExtras().forEach((e) => { por[e.origemPlano.topico] = { st: e.status,
      v: e.origemPlano.veredito ? e.origemPlano.veredito.tipo : null,
      pp: e.origemPlano.veredito ? e.origemPlano.veredito.ganhoPP : null }; });
    const cx = {};
    document.querySelectorAll('#plano-lista .pl-hoje-sel').forEach((c) => { cx[c.dataset.topico] = { travada: c.disabled }; });
    const emCurso = [...document.querySelectorAll('.pl-ciclo:not(.pl-ciclo-hist):not(.pl-calib) .pl-ciclo-lista > li')]
      .map((li) => li.textContent.replace(/\s+/g, ' ').trim());
    return { por, cx, emCurso,
      hist: document.querySelectorAll('.pl-ciclo-hist .pl-ciclo-lista > li').length,
      txt: document.getElementById('plano-lista').textContent,
      podre: /\bNaN\b|\bundefined\b|\bInfinity\b/.test(document.getElementById('plano-lista').textContent),
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
  (dep.emCurso.length === 1 && /50\/120/.test(dep.emCurso[0]) && /pelo retrato/.test(dep.emCurso[0]))
    ? ok('o bloco "Em curso" conta as questoes a partir do retrato, sem lancamento manual (50/120)')
    : erro('o progresso automatico nao apareceu: ' + JSON.stringify(dep.emCurso));
  dep.hist === 2 ? ok('e os dois ciclos fechados entram no historico "o que os retratos ja julgaram"')
    : erro(`historico com ${dep.hist} ciclo(s), esperado 2`);
  /* O SELO NAO PODE MENTIR. Uma atividade encerrada com "nao funcionou" exibia
     um "✓" — o simbolo de sucesso no exato caso em que o volume falhou. */
  (/não funcionou/.test(dep.txt) && dep.cx.Atos && dep.cx.Atos.travada === false)
    ? ok('o assunto que nao funcionou aparece como tal, e volta a ser atacavel')
    : erro('o selo do "nao funcionou" mentiu ou travou o assunto: ' + JSON.stringify(dep.cx));
  (dep.cx.Contratos && dep.cx.Contratos.travada === true)
    ? ok('e o que tem atividade ABERTA continua travado, para nao duplicar')
    : erro('assunto com atividade aberta ficou marcavel: ' + JSON.stringify(dep.cx));
  (!dep.podre && dep.vaza === 0) ? ok('nenhum numero podre e nenhum vazamento a 390px')
    : erro(`ciclo na tela: podre=${dep.podre} vazamento=${dep.vaza}px`);

  // a tela de Atividades mostra de onde veio e o que aconteceu
  const card = await pag.evaluate(() => {
    switchScreen('extras');
    if (window.ExtrasScreen) ExtrasScreen.render();
    const t = (document.getElementById('extras-list') || {}).textContent || '';
    return { doPlano: /do Plano/.test(t), evo: /45% → 30%/.test(t), retrato: /pelo retrato/.test(t),
      barra: /50 \/ 120/.test(t) };
  });
  (card.doPlano && card.evo && card.barra)
    ? ok('o cartao da atividade diz que veio do Plano, mostra 45% → 30% e a barra em 50/120')
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
    switchScreen('desempenhotec'); DesempenhoTecScreen.switchTecTab('plano');
    const c = PlanoCiclo.calibragem();
    const btn = document.getElementById('plano-calibrar');
    const houve = !!btn;
    if (btn) btn.click();
    return { antes, pronta: c.pronta, n: c.n, qPorPonto: c.qPorPonto, atual: c.atual, houve };
  });
  (cal.antes === false && cal.pronta && cal.n >= 3 && cal.houve)
    ? ok(`a calibragem so liga com historico: ${cal.n} ciclos → ${cal.qPorPonto} questoes por ponto (o padrao era ${cal.atual})`)
    : erro('a calibragem nao apareceu como devia: ' + JSON.stringify(cal));
  await pag.waitForTimeout(200);
  const aplicou = await pag.evaluate(async () => {
    const ok = document.getElementById('ui-modal-ok');
    if (ok) ok.click();
    await new Promise((r) => setTimeout(r, 250));
    return PlanoEngine.prefs().custoPorPonto;
  });
  (aplicou === cal.qPorPonto)
    ? ok(`calibrar leva o numero para os ajustes do Plano (custo por ponto = ${aplicou})`)
    : erro(`calibrar nao aplicou: custoPorPonto=${aplicou}, esperado ${cal.qPorPonto}`);
  await pag.evaluate(() => { PlanoEngine.salvarPrefs({ custoPorPonto: PlanoEngine.DEFAULTS.custoPorPonto }); DB._set(DB.KEYS.extras, []); });
  await pag.setViewportSize({ width: 1280, height: 900 });
} catch (e) { erro('o ciclo do Plano falhou: ' + e.message); }

/* ── 6.16) GESTÃO NUM LUGAR SÓ, E A RÉGUA QUE APROVA ───────────────────────
   Duas dores diferentes, no navegador. A primeira: com vários assuntos abertos
   em disciplinas diferentes, o unico lugar com o progresso de todos era o bloco
   dentro da aba Plano — tela de decisao, e o lugar errado para perguntar "o que
   eu tenho em andamento?". A segunda: o Plano mandava atacar a cratera de
   dominio (4 questoes a 20%) em vez de onde os pontos estao. */
console.log('\n6.16) a gestao na tela de Atividades e a regua de pontos');
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
    switchScreen('desempenhotec'); DesempenhoTecScreen.render(); DesempenhoTecScreen.switchTecTab('plano');
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
  /* O RITMO É DERIVADO, NÃO AGENDADO. Amarrar cada atividade a um dia cria
     divida vencida: voce nao estudou terca, e terca fica la, cobrando. */
  (/\/dia até a próxima importação/.test(g.resumo) && g.semDatas)
    ? ok('com ritmo por dia calculado na hora, e nenhuma atividade amarrada a uma data')
    : erro('o ritmo derivado falhou: ' + JSON.stringify({ resumo: g.resumo, semDatas: g.semDatas }));
  (g.discsNoDia >= 2 && g.vaza === 0)
    ? ok('o dia tambem separa por disciplina, sem vazamento a 390px')
    : erro(`agrupamento do dia: ${g.discsNoDia} titulo(s), vazamento ${g.vaza}px`);
  /* SIMPLICIDADE VEM DE MOVER, NÃO DE SOMAR: o Plano abre mao do painel e
     fica com a linha que leva ate a gestao. */
  const mini = await pag.evaluate(() => {
    switchScreen('desempenhotec'); DesempenhoTecScreen.switchTecTab('plano');
    const d = document.querySelector('.pl-ciclo-mini');
    return { existe: !!d, recolhido: d ? !d.open : null,
      texto: d ? d.querySelector('summary').textContent.replace(/\s+/g, ' ') : '',
      link: !!document.getElementById('plano-ir-extras'),
      painelInteiro: document.querySelectorAll('#plano-lista .pl-ciclo:not(.pl-ciclo-mini):not(.pl-ciclo-hist):not(.pl-calib):not(.pl-pontos):not(.pl-tempo):not(.pl-auditoria)').length };
  });
  (mini.existe && mini.recolhido && mini.link && mini.painelInteiro === 0)
    ? ok('no Plano sobrou uma linha recolhida que leva para a gestao — nao um segundo painel')
    : erro('o Plano nao encolheu: ' + JSON.stringify(mini));

  // ── a regua de pontos ────────────────────────────────────────────────────
  const pts = await pag.evaluate(() => {
    const origSubs = DB.getActiveSubjects, origModo = window.planCycleMode, origCiclo = DB.getCurrentCycle;
    try {
      DB.getActiveSubjects = () => ([
        { nome: 'Dir Adm', qtdQuestoes: 40, pontosPorQuestao: 1, peso: 1 },
        { nome: 'Portugues', qtdQuestoes: 5, pontosPorQuestao: 1, peso: 1, minimoPct: 60 }]);
      DB.getCurrentCycle = () => ({ subjects: [
        { nome: 'Portugues', definidoMin: 180, fase: 'Novo', dificuldade: 2 },
        { nome: 'Dir Adm', definidoMin: 60, fase: 'Novo', dificuldade: 3 }] });
      window.planCycleMode = () => 'pos';
      PlanoPontos.setCorte(30);
      DesempenhoTecScreen._planoRefC = null;
      DesempenhoTecScreen.renderPlano();
      const t = document.getElementById('plano-lista').textContent.replace(/\s+/g, ' ');
      const r = PlanoEngine.calcular(DesempenhoTecScreen.scopedSnapshot(),
        Object.assign({}, PlanoEngine.prefs(), { ordenar: 'pontos' }));
      const out = {
        bloco: !!document.querySelector('.pl-pontos'),
        composicao: !!document.querySelector('.pl-comp'),
        temCorte: /corte que você informou/.test(t),
        eliminatoria: /abaixo do mínimo/.test(t),
        primeiroPorPontos: r.itens[0] ? r.itens[0].disciplina + '/' + r.itens[0].nome : null,
        elim1: r.itens[0] ? !!r.itens[0].eliminatoria : null,
        tempo: !!document.querySelector('.pl-tempo'),
        podre: /\bNaN\b|\bundefined\b|\bInfinity\b/.test(t)
      };
      PlanoPontos.setCorte('');
      return out;
    } finally { DB.getActiveSubjects = origSubs; window.planCycleMode = origModo; DB.getCurrentCycle = origCiclo; }
  });
  (pts.bloco && pts.composicao && pts.temCorte)
    ? ok('a nota projetada aparece com o corte declarado como SEU e a composicao a vista')
    : erro('o bloco de pontos nao saiu completo: ' + JSON.stringify(pts));
  (pts.eliminatoria && pts.elim1 === true && /Portugues/.test(pts.primeiroPorPontos || ''))
    ? ok(`materia abaixo do minimo eliminatorio vem antes de tudo (${pts.primeiroPorPontos})`)
    : erro('a eliminatoria nao ganhou prioridade: ' + JSON.stringify(pts));
  /* O QUADRO QUE RESPONDE "QUAIS MATERIAS EU PRIORIZO". 3h em Portugues, que
     vale 5 das 45 questoes, contra 1h em Dir Adm, que vale 40: e o caso que
     ninguem percebe sozinho, e que nenhuma tela mostrava. */
  /* ── DA MATÉRIA PARA O ASSUNTO, EM UM TOQUE ────────────────────────────
     A tabela fala de MATÉRIAS e a lista abaixo fala de ASSUNTOS. Sem a ponte o
     caminho era manual e de cinco passos: ler o veredito, abrir os ajustes,
     achar o campo Disciplina, escolher, fechar a folha, rolar. E o botão só
     pode existir onde ha acao a tomar — numa linha ✅ ele convidaria a fazer
     exatamente o que a tela acabou de dizer para nao fazer. */
  const atk = await pag.evaluate(() => {
    const origSubs = DB.getActiveSubjects, origModo = window.planCycleMode, origCiclo = DB.getCurrentCycle;
    try {
      DB.getActiveSubjects = () => ([{ nome: 'Dir Adm', qtdQuestoes: 40, pontosPorQuestao: 1, peso: 1 },
        { nome: 'Portugues', qtdQuestoes: 5, pontosPorQuestao: 1, peso: 1 }]);
      DB.getCurrentCycle = () => ({ subjects: [{ nome: 'Portugues', definidoMin: 180 }, { nome: 'Dir Adm', definidoMin: 60 }] });
      window.planCycleMode = () => 'pos';
      PlanoEngine.salvarPrefs({ disciplina: '__todas__' });
      DesempenhoTecScreen._planoRefC = null;
      DesempenhoTecScreen.renderPlano();
      const linhas = [...document.querySelectorAll('.pl-mat-lista > .pl-mat')].map((li) => ({
        ver: li.querySelector('.reforco-tag').textContent.trim(),
        botao: !!li.querySelector('[data-atacar]'),
        // cada linha carrega o "i" que abre a analise da materia
        analise: !!li.querySelector('[data-mat-det]') }));
      const b = document.querySelector('[data-atacar]');
      const antes = document.querySelectorAll('#plano-lista .pl-item').length;
      if (b) b.click();
      const out = { linhas, alvo: b ? b.dataset.atacar : null, antes,
        depois: document.querySelectorAll('#plano-lista .pl-item').length,
        filtro: document.getElementById('plano-disc').value,
        gravado: PlanoEngine.prefs().disciplina,
        temBloco: !!document.querySelector('#plano-lista .pl-hoje'),
        // com a lista JA FILTRADA, os botoes das OUTRAS materias tem de continuar la
        botoesComFiltro: [...document.querySelectorAll('[data-atacar]')].map((x) => x.dataset.atacar) };
      PlanoEngine.salvarPrefs({ disciplina: '__todas__' });
      DesempenhoTecScreen._planoRefC = null;
      DesempenhoTecScreen.renderPlano();
      out.botoesSemFiltro = [...document.querySelectorAll('[data-atacar]')].map((x) => x.dataset.atacar);
      return out;
    } finally { DB.getActiveSubjects = origSubs; window.planCycleMode = origModo; DB.getCurrentCycle = origCiclo; }
  });
  const pedemAcao = (atk.linhas || []).filter((l) => /ataque aqui|comece/.test(l.ver));
  const naoPedem = (atk.linhas || []).filter((l) => /mantenha|reduza|na fila|fica para depois/.test(l.ver));
  (pedemAcao.length >= 1 && pedemAcao.every((l) => l.botao) && naoPedem.every((l) => !l.botao))
    ? ok(`o botao "atacar esta materia" so aparece nas ${pedemAcao.length} linha(s) que pedem acao`)
    : erro('o botao apareceu no lugar errado: ' + JSON.stringify(atk.linhas));
  (atk.filtro === atk.alvo && atk.gravado === atk.alvo && atk.depois > 0 && atk.depois < atk.antes && atk.temBloco)
    ? ok(`clicar filtra a lista pela materia (${atk.antes} → ${atk.depois} assuntos) e mantem o bloco de criar atividades`)
    : erro('o botao nao filtrou a lista: ' + JSON.stringify(atk));
  /* O ALVO DO BOTAO SAI DAS DISCIPLINAS DO RETRATO, NAO DA LISTA FILTRADA.
     Saindo de `r.itens` — o resultado do Plano COM o filtro aplicado — bastava
     filtrar por uma materia para TODAS as outras perderem o botao, e sobrava
     exatamente uma linha com ele: a que ja estava filtrada. O botao de "va
     para outra materia" so funcionava para a materia em que voce ja estava. */
  (atk.botoesComFiltro.length === atk.botoesSemFiltro.length && atk.botoesComFiltro.length >= 1
    && atk.botoesComFiltro.every((d) => atk.botoesSemFiltro.indexOf(d) >= 0))
    ? ok(`e filtrar a lista nao apaga os botoes das outras materias (${atk.botoesComFiltro.length} antes e depois)`)
    : erro('o filtro comeu os botoes: ' + JSON.stringify({ com: atk.botoesComFiltro, sem: atk.botoesSemFiltro }));

  /* ── O QUADRO DE ESFORCO NAO DEPENDE DO NOME QUE VOCE DIGITOU ──────────
     A primeira versao comparava os MINUTOS do ciclo com o peso da banca, e as
     duas pontas falavam linguas diferentes: o ciclo voce digita ("Portugues"),
     a banca manda "Lingua Portuguesa". O veredito so nascia com as duas pontas,
     entao um nome diferente nao deixava a linha errada — deixava a linha
     INEXISTENTE. O usuario via oito materias leves somando 23% do peso sem ter
     como saber que os outros 77% da prova haviam sumido calados.

     A moeda passou a ser a QUESTAO, a unica que os dois lados ja falam. Aqui o
     ciclo esta escrito de proposito num idioma que nao existe em lugar nenhum
     ("Port.", "Const"): o quadro tem de sair igual. */
  const esf = await pag.evaluate(() => {
    const origIncid = ReforcoEngine._incidByDisc, origSubs = DB.getActiveSubjects,
      origModo = window.planCycleMode, origCiclo = DB.getCurrentCycle, origSnaps = DB.getTecSnapshots;
    try {
      const I = (d, n) => ({ codigo: '01', nome: 'Geral', disciplina: d, incidencia: n });
      // a banca cobra Constitucional acima de tudo; Contabilidade quase nada
      ReforcoEngine._incidByDisc = () => ({
        'Direito Constitucional': [I('Direito Constitucional', 500)],
        'Lingua Portuguesa': [I('Lingua Portuguesa', 300)],
        'Contabilidade Geral': [I('Contabilidade Geral', 100)],
        'Arquivologia': [I('Arquivologia', 6)], 'Ingles': [I('Ingles', 5)],
        // tres materias pequenas e NUNCA tocadas: sozinhas nao decidem nada,
        // somadas valem mais que a Contabilidade em que ele gasta 2/3 do esforco
        'Direito Penal': [I('Direito Penal', 40)], 'Direito Civil': [I('Direito Civil', 40)],
        'Estatistica': [I('Estatistica', 40)] });
      DB.getActiveSubjects = () => [];
      window.planCycleMode = () => 'pre';
      // o ciclo fala outro idioma — e agora e irrelevante
      DB.getCurrentCycle = () => ({ subjects: [{ nome: 'Port.', definidoMin: 999 }, { nome: 'Const', definidoMin: 999 }] });
      const dia = (n) => { const d = new Date(todayLocal() + 'T00:00:00'); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };
      // o esforco: muito em Contabilidade (leve), nada em Constitucional (pesadissima)
      const linhas = [];
      [['Lingua Portuguesa', 100, 90], ['Contabilidade Geral', 600, 300], ['Musica', 100, 90]]
        .forEach(([d, q, ac]) => {
          linhas.push({ depth: 0, codigo: null, nome: d, disciplina: d, questoes: q, acertos: ac });
          linhas.push({ depth: 1, codigo: '01', nome: 'Geral', disciplina: d, questoes: q, acertos: ac });
        });
      DB.getTecSnapshots = () => ([{ id: 'e1', nome: 'e1', date: dia(2), startDate: dia(30), endDate: dia(2), rows: linhas }]);
      DesempenhoTecScreen._planoRefC = null;
      DesempenhoTecScreen.renderPlano();
      const tm = PlanoPontos.esforcoPorMateria();
      const por = {}; tm.linhas.forEach((l) => { por[ReforcoEngine.norm(l.nome)] = l; });
      const tela = document.querySelector('.pl-tempo');
      return {
        somaPeso: tm.linhas.reduce((a, l) => a + (l.sharePeso || 0), 0),
        somaEsforco: tm.linhas.reduce((a, l) => a + l.shareEsforco, 0),
        nLinhas: tm.linhas.length,
        intocada: (por['direito constitucional'] || {}).veredito,
        sobra: (por['contabilidade geral'] || {}).veredito,
        sobraAnotada: (por['contabilidade geral'] || {}).sobra,
        forte: (por['lingua portuguesa'] || {}).veredito,
        foraDoPeso: (por['musica'] || {}).veredito,
        emJogo: tm.emJogo, nCorte: tm.nCorte, acoes: tm.acoes,
        ordemPorPremio: tm.linhas.filter((l) => l.ganho > 0).every((l, i, a) => i === 0 || a[i - 1].ganho >= l.ganho),
        alvosDoBotao: [...document.querySelectorAll('[data-atacar]')].map((b) => b.dataset.atacar),
        premioDoBotao: [...document.querySelectorAll('[data-atacar]')].map((b) => {
          const l = por[ReforcoEngine.norm(b.dataset.atacar)]; return l ? l.ganho : null; }),
        qPortugues: (por['lingua portuguesa'] || {}).q,
        linhasTela: document.querySelectorAll('.pl-mat-lista > .pl-mat').length,
        resumos: [...document.querySelectorAll('.pl-mat.is-resumo .pl-mat-nome')].map((el) => el.textContent.replace(/\s+/g, ' ')
          + ' ' + (el.closest('.pl-mat').querySelector('.pl-mat-sub') || { textContent: '' }).textContent.replace(/\s+/g, ' ')),
        /* A soma do resumo vai no `data-peso` da linha: ler a posicao de uma
           celula de tabela era um contrato fragil, e a tabela nem existe mais. */
        pesoResumido: [...document.querySelectorAll('.pl-mat.is-resumo')].map((li) => parseFloat(li.dataset.peso) || 0),
        temMiudas: !!document.querySelector('.pl-mat.is-resumo'),
        // e cada linha de materia tem o "i" da analise detalhada
        comAnalise: document.querySelectorAll('.pl-mat-lista > .pl-mat:not(.is-resumo) [data-mat-det]').length,
        texto: tela ? tela.textContent.replace(/\s+/g, ' ') : '',
        // e o casamento de nomes segue conservador onde ainda e necessario
        casaGenero: PlanoPontos._casarNomes(['portugues'], ['lingua portuguesa'])['portugues'],
        naoCasaIrmas: PlanoPontos._casarNomes(['contabilidade geral'], ['contabilidade de custos'])['contabilidade geral'],
        naoCasaAmbiguo: PlanoPontos._casarNomes(['direito'], ['direito penal', 'direito civil'])['direito']
      };
    } finally {
      ReforcoEngine._incidByDisc = origIncid; DB.getActiveSubjects = origSubs;
      window.planCycleMode = origModo; DB.getCurrentCycle = origCiclo; DB.getTecSnapshots = origSnaps;
    }
  });
  (Math.abs(esf.somaPeso - 100) < 0.01 && Math.abs(esf.somaEsforco - 100) < 0.01 && esf.nLinhas === 9)
    ? ok(`nada some: ${esf.nLinhas} materias, peso somando ${esf.somaPeso.toFixed(0)}% e esforco ${esf.somaEsforco.toFixed(0)}%`)
    : erro('a cobertura do quadro de esforco falhou: ' + JSON.stringify(esf));
  /* CADA VEREDITO E UM VERBO, NAO UM DIAGNOSTICO. "Desalinhada" descrevia um
     estado e deixava a traducao para o aluno — que foi onde ele se perdeu. */
  (esf.intocada === 'comecar' && esf.forte === 'manter' && esf.foraDoPeso === 'foraDoPeso'
    && /^(atacar|fila|reduzir)$/.test(esf.sobra) && esf.sobraAnotada === true)
    ? ok(`cada linha diz um VERBO: comece / ${esf.sobra} / mantenha / fora do peso, e a desproporcao de esforco vira anotacao`)
    : erro('os vereditos do quadro sairam errados: ' + JSON.stringify(esf));
  /* A ORDEM E O PREMIO, E O BOTAO SEGUE A ORDEM. Antes o botao nascia em
     "muito esforco para o peso que ela tem" — ou seja, convidava a investir
     mais na materia que a linha acabava de acusar de consumir demais, e que
     era a de MENOR premio da tela. */
  (esf.ordemPorPremio && esf.emJogo > 0 && esf.nCorte >= 1)
    ? ok(`a tabela e ordenada pelo premio: ${esf.emJogo.toFixed(0)}pp da prova em jogo, ${esf.nCorte} materia(s) concentram metade`)
    : erro('a ordem por pontos em jogo falhou: ' + JSON.stringify({ ordem: esf.ordemPorPremio, emJogo: esf.emJogo, corte: esf.nCorte }));
  /* ── O CASO EXATO DA TELA DO USUARIO ───────────────────────────────────
     Dez materias, peso x nivel como ele viu. O quadro antigo punha o botao
     "atacar esta materia" na linha de 5% de peso e 84% de acerto — 0,5pp em
     jogo, o MENOR premio da tabela inteira — e nao punha botao nenhum nas de
     13%/70% e 6%/58%, que valiam 4,5pp e 3,3pp. O veredito ali era
     "equilibrada" (verde) porque a regra media ALOCACAO, e alocacao nao e a
     pergunta que decide onde vai a proxima hora. */
  const dez = await pag.evaluate(() => {
    const origIncid = ReforcoEngine._incidByDisc, origSubs = DB.getActiveSubjects,
      origModo = window.planCycleMode, origSnaps = DB.getTecSnapshots;
    try {
      const M = [['Dir Constitucional', 13, 70], ['Dir Tributario', 7, 58], ['Contabilidade', 6, 71],
        ['Auditoria', 6, 58], ['Dir Administrativo', 5, 84], ['Portugues', 5, 81],
        ['RLM', 5, 80], ['Economia', 5, 80], ['Dir Civil', 3, 75], ['Dir Penal', 3, 59]];
      ReforcoEngine._incidByDisc = () => { const o = {};
        M.forEach(([d, p]) => { o[d] = [{ codigo: '01', nome: 'Geral', disciplina: d, incidencia: p * 10 }]; }); return o; };
      DB.getActiveSubjects = () => []; window.planCycleMode = () => 'pre';
      const dia = (n) => { const d = new Date(todayLocal() + 'T00:00:00'); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };
      const rows = [];
      M.forEach(([d, , taxa]) => { const q = 400, ac = Math.round(q * taxa / 100);
        rows.push({ depth: 0, codigo: null, nome: d, disciplina: d, questoes: q, acertos: ac });
        ['A', 'B'].forEach((suf, i) => rows.push({ depth: 1, codigo: '0' + (i + 1), nome: 'Topico ' + suf,
          disciplina: d, questoes: q / 2, acertos: Math.round(ac / 2) })); });
      DB.getTecSnapshots = () => ([{ id: 'd1', nome: 'd1', date: dia(2), startDate: dia(30), endDate: dia(2), rows }]);
      PlanoEngine.salvarPrefs({ disciplina: '__todas__' });
      DesempenhoTecScreen._planoRefC = null;
      DesempenhoTecScreen.renderPlano();
      const tm = PlanoPontos.esforcoPorMateria();
      const por = {}; tm.linhas.forEach((l) => { por[ReforcoEngine.norm(l.nome)] = l; });
      const alvos = [...document.querySelectorAll('[data-atacar]')].map((b) => b.dataset.atacar);
      // e agora com a lista JA FILTRADA por UMA das materias de ataque:
      // as outras duas nao podem perder o botao
      PlanoEngine.salvarPrefs({ disciplina: alvos[0] });
      DesempenhoTecScreen._planoRefC = null;
      DesempenhoTecScreen.renderPlano();
      const alvosFiltrado = [...document.querySelectorAll('[data-atacar]')].map((b) => b.dataset.atacar);
      PlanoEngine.salvarPrefs({ disciplina: '__todas__' });
      DesempenhoTecScreen._planoRefC = null;
      DesempenhoTecScreen.renderPlano();
      return {
        ordem: tm.linhas.slice(0, 4).map((l) => l.nome),
        alvos, alvosFiltrado,
        penal: por['dir penal'],
        premios: alvos.map((a) => +por[ReforcoEngine.norm(a)].ganho.toFixed(2)),
        piorPremio: +Math.min(...tm.linhas.filter((l) => l.ganho > 0).map((l) => l.ganho)).toFixed(2),
        administrativo: por['dir administrativo'],
        tributario: por['dir tributario'],
        nCorte: tm.nCorte, emJogo: +tm.emJogo.toFixed(1)
      };
    } finally {
      ReforcoEngine._incidByDisc = origIncid; DB.getActiveSubjects = origSubs;
      window.planCycleMode = origModo; DB.getTecSnapshots = origSnaps;
      PlanoEngine.salvarPrefs({ disciplina: '__todas__' });
    }
  });
  (dez.ordem[0] === 'Dir Constitucional' && dez.ordem[1] === 'Dir Tributario' && dez.ordem[2] === 'Auditoria')
    ? ok(`a fila vira o premio: ${dez.ordem.join(' > ')} (${dez.emJogo}pp em jogo, ${dez.nCorte} materias concentram metade)`)
    : erro('a ordem das dez materias saiu errada: ' + JSON.stringify(dez.ordem));
  (dez.alvos.length === dez.nCorte && dez.alvos.indexOf('Dir Administrativo') < 0
    && Math.min(...dez.premios) > dez.piorPremio * 3)
    ? ok(`e o botao vai para as ${dez.alvos.length} de maior premio (${dez.premios.join(', ')}pp), nunca para a de ${dez.piorPremio}pp`)
    : erro('o botao nao seguiu o premio: ' + JSON.stringify({ alvos: dez.alvos, premios: dez.premios, pior: dez.piorPremio }));
  (dez.administrativo.veredito === 'manter' && dez.tributario.veredito === 'atacar')
    ? ok('a materia de 5%/84% deixou de pedir ataque e a de 7%/58% deixou de ser "equilibrada" verde')
    : erro('os vereditos do caso real sairam errados: ' + JSON.stringify({ adm: dez.administrativo.veredito, trib: dez.tributario.veredito }));
  /* FILTRAR A LISTA NAO PODE APAGAR OS BOTOES DAS OUTRAS MATERIAS. O alvo saia
     de `r.itens`, o resultado do Plano COM o filtro aplicado: bastava filtrar
     por uma materia para as demais perderem o botao, e sobrava exatamente uma
     linha com ele — a que ja estava filtrada. */
  (dez.alvosFiltrado.length === dez.alvos.length && dez.alvos.length >= 3
    && dez.alvos.every((d) => dez.alvosFiltrado.indexOf(d) >= 0))
    ? ok(`filtrar a lista por "${dez.alvos[0]}" mantem os ${dez.alvos.length} botoes de pe`)
    : erro('o filtro comeu os botoes das outras materias: ' + JSON.stringify({ antes: dez.alvos, depois: dez.alvosFiltrado }));
  /* O ESFORCO DESPROPORCIONAL E ANOTACAO, NAO VERBO — enquanto sobrar premio.
     Competindo com o premio, ele mandava "reduza: sobrou pouco a ganhar" numa
     materia que ainda tinha 1,6pp em jogo e acerto em 59%, que e o oposto da
     verdade. Fora das duas bandas, ai sim gastar demais e o fato principal. */
  (dez.penal.veredito === 'fila' && dez.penal.sobra === true && dez.penal.razao >= 1.6)
    ? ok(`materia com ${dez.penal.ganho.toFixed(1)}pp em jogo e ${dez.penal.razao.toFixed(1)}x o peso em esforco fica "na fila" com a sobra anotada, nao "reduza"`)
    : erro('a sobra voltou a competir com o premio: ' + JSON.stringify(dez.penal));
  (esf.qPortugues === 100 && !/seu tempo/i.test(esf.texto) && /questões|questão/.test(esf.texto))
    ? ok('o quadro sai igual com o ciclo escrito em outro idioma ("Port.", "Const") — a moeda e a questao')
    : erro('o quadro ainda depende do ciclo: ' + JSON.stringify({ q: esf.qPortugues, t: esf.texto.slice(0, 160) }));
  /* COBRIR TUDO E OBRIGACAO; VIRAR PAREDE NAO. Uma banca com trinta
     disciplinas produzia vinte linhas de "0% · 0 questoes" que empurravam a
     decisao de verdade para fora da tela. Os dois resumos existem por motivos
     diferentes: a miuda e rodape e NAO conta na manchete; a nao-tocada pequena
     CONTA — uma sozinha nao decide nada, tres somando 17% da prova decidem. */
  const rIntoc = esf.resumos.find((t) => /ainda não começou/.test(t));
  const rMiud = esf.resumos.find((t) => /miúda/.test(t));
  (esf.resumos.length === 2 && /3 matérias/.test(rIntoc || '') && /2 matérias/.test(rMiud || ''))
    ? ok(`as pequenas viram dois resumos, cada um com o seu motivo (${esf.resumos.map((t) => t.split('nenhuma')[0].split('abaixo')[0].trim()).join(' · ')})`)
    : erro('o agrupamento das pequenas falhou: ' + JSON.stringify(esf.resumos));
  (esf.pesoResumido[0] >= 11)
    ? ok(`e o resumo mostra a SOMA (${esf.pesoResumido[0]}% da prova nunca comecada), em vez de somer com ela`)
    : erro('a soma do resumo saiu errada: ' + JSON.stringify(esf.pesoResumido));
  /* ── TODA LINHA EXPLICA A PROPRIA POSICAO ──────────────────────────────
     A duvida que o quadro produzia era sempre a mesma: "tenho materia com
     percentual menor que aparece muito depois — por que?". A resposta e peso x
     lacuna, e ela nao cabia numa celula: cada linha tem o "i" que abre a conta
     feita com os numeros dela, os vizinhos na fila e o contraexemplo. */
  (esf.comAnalise === esf.linhasTela - esf.resumos.length && esf.comAnalise >= 1)
    ? ok(`cada uma das ${esf.comAnalise} materias tem o "i" da analise detalhada`)
    : erro('faltou o "i" de analise nas linhas: ' + JSON.stringify({ comAnalise: esf.comAnalise, linhas: esf.linhasTela, resumos: esf.resumos.length }));
  /* ── DE ONDE VEM O PESO, E POR QUE ELE ESTAVA TORTO ────────────────────
     Pela RAIZ de cada disciplina na incidencia, nao pela soma das linhas dela.
     A incidencia e uma arvore ("Direito Civil 200" → "01 Parte Geral 100" →
     "01.01 Principios 60"), e somar tudo conta a mesma questao em cada degrau.
     O erro dependia de quao FUNDO cada tabela foi colada, nao do que a banca
     cobra: duas disciplinas de 200 questoes viravam 55,6% e 44,4% da prova. */
  const arv = await pag.evaluate(() => {
    const origModo = window.planCycleMode, origSubs = DB.getActiveSubjects,
      origSnaps = DB.getTecSnapshots, origInc = DB.getIncidencia();
    try {
      DB.saveIncidencia([]);
      DB.addIncidenciaRows('FGV', [
        { disciplina: 'Detalhada', topico: 'Detalhada', incidencia: 200, codigo: null, depth: 0 },
        { disciplina: 'Detalhada', topico: 'Parte Geral', incidencia: 100, codigo: '01', depth: 1 },
        { disciplina: 'Detalhada', topico: 'Principios', incidencia: 60, codigo: '01.01', depth: 2 },
        { disciplina: 'Detalhada', topico: 'Fontes', incidencia: 40, codigo: '01.02', depth: 2 },
        { disciplina: 'Detalhada', topico: 'Parte Especial', incidencia: 100, codigo: '02', depth: 1 },
        { disciplina: 'Rasa', topico: 'Rasa', incidencia: 200, codigo: null, depth: 0 },
        { disciplina: 'Rasa', topico: 'Tudo', incidencia: 200, codigo: '01', depth: 1 }], true);
      const dia = (n) => { const d = new Date(todayLocal() + 'T00:00:00'); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };
      const rows = [];
      ['Detalhada', 'Rasa'].forEach((d) => {
        rows.push({ depth: 0, codigo: null, nome: d, disciplina: d, questoes: 400, acertos: 240 });
        rows.push({ depth: 1, codigo: '01', nome: 'Geral', disciplina: d, questoes: 400, acertos: 240 }); });
      DB.getTecSnapshots = () => ([{ id: 'v1', nome: 'v1', date: dia(2), startDate: dia(30), endDate: dia(2), rows }]);
      DB.getActiveSubjects = () => []; window.planCycleMode = () => 'pre';
      const tm = PlanoPontos.esforcoPorMateria();
      const por = {}; tm.linhas.forEach((l) => { por[l.nome] = l; });
      const plana = ReforcoEngine._incidByDisc('__todas__');
      return {
        somaPlana: Object.keys(plana).map((d) => d + '=' + plana[d].reduce((a, r) => a + (r.incidencia || 0), 0)),
        raiz: ReforcoEngine.incidPorDisciplina('__todas__'),
        pesos: { det: +por['Detalhada'].sharePeso.toFixed(1), rasa: +por['Rasa'].sharePeso.toFixed(1) },
        ganhos: { det: +por['Detalhada'].ganho.toFixed(2), rasa: +por['Rasa'].ganho.toFixed(2) }
      };
    } finally {
      DB.saveIncidencia(origInc); DB.getTecSnapshots = origSnaps;
      DB.getActiveSubjects = origSubs; window.planCycleMode = origModo;
    }
  });
  (arv.raiz.Detalhada === 200 && arv.raiz.Rasa === 200 && arv.pesos.det === 50 && arv.pesos.rasa === 50)
    ? ok(`o peso vem da RAIZ da arvore (${arv.somaPlana.join(', ')} somados virariam 55,6%/44,4%; a raiz da 50%/50%)`)
    : erro('o peso ainda conta pai e filho: ' + JSON.stringify(arv));
  (Math.abs(arv.ganhos.det - arv.ganhos.rasa) < 0.01)
    ? ok(`e o premio deixa de depender de quao fundo a tabela foi colada (${arv.ganhos.det}pp nas duas)`)
    : erro('o premio herdou a distorcao: ' + JSON.stringify(arv.ganhos));

  /* ── DOIS NUMEROS QUE A TELA DIZIA E QUE BRIGAVAM COM A REALIDADE ──────
     1) "0% do seu esforço · nível 57%" e uma linha que se contradiz: se o
        nivel foi medido, houve questao. O zero era arredondamento.
     2) "-9,9pp em 8 importacoes" — a trajetoria compara a media sobre
        conjuntos DIFERENTES de assuntos a cada retrato. Quem abre frente nova
        entra com assunto fraco e a linha cai mesmo com TODO assunto subindo. */
  const num = await pag.evaluate(() => {
    const origSnaps = DB.getTecSnapshots, origIncid = ReforcoEngine._incidByDisc,
      origSubs = DB.getActiveSubjects, origModo = window.planCycleMode;
    try {
      const dia = (n) => { const d = new Date(todayLocal() + 'T00:00:00'); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };
      // (1) uma materia com peso relevante e esforco abaixo de 0,5%
      ReforcoEngine._incidByDisc = () => ({
        'Grande': [{ codigo: null, depth: 0, nome: 'Grande', disciplina: 'Grande', incidencia: 600 }],
        'Fina': [{ codigo: null, depth: 0, nome: 'Fina', disciplina: 'Fina', incidencia: 400 }] });
      DB.getActiveSubjects = () => []; window.planCycleMode = () => 'pre';
      const rowsN = [
        { depth: 0, codigo: null, nome: 'Grande', disciplina: 'Grande', questoes: 9000, acertos: 6300 },
        { depth: 1, codigo: '01', nome: 'Geral', disciplina: 'Grande', questoes: 9000, acertos: 6300 },
        { depth: 0, codigo: null, nome: 'Fina', disciplina: 'Fina', questoes: 25, acertos: 14 },
        { depth: 1, codigo: '01', nome: 'Geral', disciplina: 'Fina', questoes: 25, acertos: 14 }];
      DB.getTecSnapshots = () => ([{ id: 'n1', nome: 'n1', date: dia(2), startDate: dia(30), endDate: dia(2), rows: rowsN }]);
      DesempenhoTecScreen._planoRefC = null;
      DesempenhoTecScreen.renderPlano();
      const linhaFina = [...document.querySelectorAll('.pl-mat-lista > .pl-mat')]
        .map((li) => li.textContent.replace(/\s+/g, ' ')).find((t) => /Fina/.test(t)) || '';
      const share = PlanoPontos.esforcoPorMateria().linhas.find((l) => l.nome === 'Fina');

      // (2) todo assunto sobe 5pp por retrato; so a COBERTURA cresce
      const snapsT = [];
      for (let i = 0; i < 4; i++) {
        const rs = [];
        const n = 3 + i * 6;
        for (let t = 0; t < n; t++) {
          const nasc = t < 3 ? 0 : Math.ceil((t - 2) / 6);
          const tx = (nasc === 0 ? 80 : 35) + (i - nasc) * 5;
          rs.push({ depth: 1, codigo: '0' + t, nome: 'T' + t, disciplina: 'D', questoes: 40, acertos: Math.round(40 * tx / 100) });
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

console.log('\n7) contraste WCAG AA (temas claro e escuro)');
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
