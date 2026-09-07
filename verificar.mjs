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
const servidor = createServer((req, res) => {
  const nome = (req.url || '/').split('?')[0] === '/' ? '/index.html' : (req.url || '').split('?')[0];
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
    ['desempenhotec', 'plano-filtros-body', 'plano-filtros-collapse', 'plano-filtros-resumo'],
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
} catch (e) { erro('falha na navegacao: ' + e.message); }

/* ── 7. contraste WCAG AA nos DOIS temas ───────────────────────────────────
   O tema escuro nao e uma variacao cosmetica: ele inverte tokens, e um par que
   passa no claro pode reprovar no escuro sem ninguem notar. Foi assim que o
   aviso (toast) ficou branco sobre fundo claro — 1,21:1, ilegivel — e que o
   botao primario do app inteiro ficou em 3,62:1.

   Emoji sao ignorados de proposito: a cor renderizada deles nao vem de `color`,
   entao medi-los so gera alarme falso. */
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
