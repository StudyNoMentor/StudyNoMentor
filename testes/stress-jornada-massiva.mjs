#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════════
   AUDITORIA MASSIVA DE JORNADA — Chromium real + carga + combinatória
   ───────────────────────────────────────────────────────────────────────────
   Esta suíte é deliberadamente mais pesada que verificar.mjs e NÃO roda em
   todo PR. Ela existe para testar o produto como o aluno usa: dados persistidos,
   telas reais, agenda de reforço, importações, Extras mistos e carga de Anki.

   Cobertura principal:
     · fuzz determinístico do planejador de reforços;
     · importação TEC pelo FileReader real do navegador;
     · 24 retratos sintéticos irregulares + incidência reimportada;
     · duas ondas de reforços vindos do Plano;
     · sessão parcial, sessão cheia, falta e replanejamento;
     · Extras fora do Plano (Anki, questões, leitura, vídeo, revisão e livre);
     · 200 atividades extras simultâneas;
     · 2.000 cards + 8.000 entradas de revlog;
     · renderização real desktop e mobile, com screenshots;
     · persistência depois de reload;
     · invariantes de agenda, histórico e isolamento dos Extras manuais.

   Uso local/CI:
     node testes/stress-jornada-massiva.mjs
   ═══════════════════════════════════════════════════════════════════════════ */
import { createServer } from 'node:http';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const ART = join(RAIZ, 'artifacts', 'stress-jornada');
mkdirSync(ART, { recursive: true });

const TIPOS = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png'
};
const servidor = createServer((req, res) => {
  const url = new URL(req.url || '/', 'http://127.0.0.1');
  const nome = url.pathname === '/' ? '/index.html' : url.pathname;
  try {
    const corpo = readFileSync(join(RAIZ, decodeURIComponent(nome).replace(/^\/+/, '')));
    res.writeHead(200, { 'Content-Type': TIPOS[extname(nome)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(corpo);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('nao encontrado');
  }
});
await new Promise(r => servidor.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${servidor.address().port}/index.html?stress=${Date.now()}`;

let browser;
const falhasExternas = [];
const resumo = { inicio: new Date().toISOString(), base, artefatos: [], navegador: 'Chromium/Playwright' };
try {
  browser = await chromium.launch({ headless: true });
  const contexto = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'pt-BR' });
  const page = await contexto.newPage();
  page.on('pageerror', e => falhasExternas.push('pageerror: ' + e.message));
  page.on('console', m => {
    const txt = m.text();
    // Falha de CDN é irrelevante para o núcleo offline; erro do app não é.
    if (m.type() === 'error' && !/ERR_|net::|Failed to load resource/i.test(txt)) falhasExternas.push('console: ' + txt.slice(0, 400));
  });

  await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction(() => window.DB && window.ExtrasScreen && window.PlanoEngine && window.PlanoCiclo && window.ReforcoAgendaAuto, null, { timeout: 30000 });
  await page.addScriptTag({ path: join(RAIZ, 'test', 'jornada-dados.js') });
  await page.evaluate(() => { try { ProfileUI.hideGate(); } catch (_) {} });

  const resultado = await page.evaluate(async () => {
    const falhas = [], notas = [], metricas = {};
    let checagens = 0;
    const A = (cond, msg, det) => {
      checagens++;
      if (!cond) falhas.push({ msg, det: det == null ? null : det });
    };
    const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const addDias = (iso, n) => {
      const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + n);
      return DB._isoDia(d);
    };
    const hoje = todayLocal();
    const norm = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
    const planExtras = () => DB.getExtras().filter(e => e.origemPlano && e.origemPlano.topico);
    const openPlan = () => planExtras().filter(e => e.status !== 'concluida');
    const histDia = (e, dia) => (e.historico || []).filter(h => h.data === dia).reduce((n,h)=>n+(Number(h.quantidade)||0),0);

    /* ── 1. FUZZ DO PLANEJADOR PURO ─────────────────────────────────────── */
    let seed = 0x5eed2026;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    const ent = (a,b) => a + Math.floor(rnd() * (b-a+1));
    const tFuzz = performance.now();
    for (let caso = 0; caso < 1000; caso++) {
      const n = ent(1, 36), nd = ent(1, 12), itens = [];
      for (let i = 0; i < n; i++) itens.push({ id: `c${caso}-${i}`, disciplina: `D${i % nd}`, restante: ent(1, 300), ordem: i });
      const inicio = '2026-01-05';
      const p = ReforcoAgendaAuto.planejarModelo(itens, inicio, { maxPorDia: 3, maxSessao: 15, horizonteDias: 90 });
      const disc = Object.fromEntries(itens.map(x => [String(x.id), norm(x.disciplina)]));
      for (const x of itens) {
        const blocos = (p.porId[x.id] || []).map(s => s.alvo);
        A(eq(blocos, ReforcoAgendaAuto.dividir(x.restante, 15)), 'fuzz: conservação/blocos cheios', { caso, id:x.id, restante:x.restante, blocos });
        A(blocos.every(q => q >= 1 && q <= 15), 'fuzz: bloco fora de 1..15', { caso, id:x.id, blocos });
      }
      for (const [dia, g] of Object.entries(p.porDia || {})) {
        A(g.length <= 3, 'fuzz: mais de 3 reforços no dia', { caso, dia, n:g.length });
        A(new Set(g.map(x => String(x.id))).size === g.length, 'fuzz: mesma frente repetida no dia', { caso, dia, g });
        A(new Set(g.map(x => disc[String(x.id)])).size === g.length, 'fuzz: disciplina repetida no dia', { caso, dia, g });
      }
      if (caso % 100 === 0) {
        const p2 = ReforcoAgendaAuto.planejarModelo(itens, inicio, { maxPorDia: 3, maxSessao: 15, horizonteDias: 90 });
        A(eq(p.porId, p2.porId), 'fuzz: planejador não determinístico', { caso });
      }
      if (falhas.length > 80) break;
    }
    // Cauda adversarial: mais frentes da mesma disciplina do que a janela-base.
    const cauda = Array.from({length:140}, (_,i)=>({id:'mesma-'+i, disciplina:'Disciplina única', restante:31, ordem:i}));
    const pc = ReforcoAgendaAuto.planejarModelo(cauda, '2026-01-05', { maxPorDia:3, maxSessao:15, horizonteDias:90 });
    const diasCauda = Object.entries(pc.porDia || {});
    A(diasCauda.every(([,g]) => g.length === 1), 'adversarial: horizonte estourou e sobrepôs mesma disciplina', { piores: diasCauda.filter(([,g])=>g.length!==1).slice(0,5) });
    A(cauda.every(x => (pc.porId[x.id] || []).reduce((n,s)=>n+s.alvo,0) === 31), 'adversarial: perdeu volume após horizonte longo');
    metricas.fuzzMs = Math.round(performance.now() - tFuzz);
    metricas.fuzzCasos = 1001;

    /* ── 2. IMPORTAÇÃO REAL VIA FileReader DO NAVEGADOR ─────────────────── */
    const csv = [
      ['Hierarquia','índice','Questões Resolvidas','Acertos (%)','Quantidade de acertos','Erros (%)','Quantidade de erros','Peso'].join('\t'),
      ['', 'Direito Tributario', '120','50','60','50','60','1'].join('\t'),
      ['01','Obrigacao Tributaria','120','50','60','50','60','1'].join('\t'),
      ['', 'Contabilidade Geral','100','45','45','55','55','1'].join('\t'),
      ['01','Ativo e Passivo','100','45','45','55','55','1'].join('\t'),
      ['', 'Auditoria','80','55','44','45','36','1'].join('\t'),
      ['01','Materialidade','80','55','44','45','36','1'].join('\t')
    ].join('\n');
    const f = new File([csv], 'stress-tec.csv', { type:'text/csv' });
    DesempenhoTecScreen.handleFile(f);
    for (let i=0; i<50 && !(DesempenhoTecScreen._parsedRows && DesempenhoTecScreen._parsedRows.length); i++) await sleep(20);
    A((DesempenhoTecScreen._parsedRows || []).length === 6, 'FileReader TEC não reconheceu as 6 linhas reais do CSV', { linhas:(DesempenhoTecScreen._parsedRows||[]).length });
    const iniUI = addDias(hoje, -900), fimUI = addDias(hoje, -871);
    document.getElementById('tec-import-start').value = iniUI;
    document.getElementById('tec-import-end').value = fimUI;
    document.getElementById('tec-import-label').value = 'Importação real de stress';
    DesempenhoTecScreen.saveImport();
    await sleep(40);
    let snaps = DB.getTecSnapshots();
    A(snaps.length === 1, 'importação UI não persistiu exatamente um retrato', { n:snaps.length });
    if (snaps[0]) {
      const tt = TecEngine.totais(snaps[0]);
      A(tt.questoes === 300 && tt.acertos === 149, 'importação UI alterou totais', tt);
    }

    /* ── 3. CARGA TEC + INCIDÊNCIA ──────────────────────────────────────── */
    const todos = SIM.retratos(24);
    for (let i=0; i<12; i++) DB.saveTecSnapshot(Object.assign({}, todos[i], { id:'stress-'+i, label:'Stress '+(i+1) }));
    const inc = SIM.incidencia();
    const i1 = DB.addIncidenciaRows('CESPE', inc, true);
    const antesInc = DB.getIncidencia().length;
    const i2 = DB.addIncidenciaRows('CESPE', inc, false);
    A(DB.getIncidencia().length === antesInc, 'reimportação de incidência duplicou linhas', { antes:antesInc, depois:DB.getIncidencia().length, i2 });
    A(i2.repetidas === inc.length, 'reimportação não reconheceu todas as linhas repetidas', { esperado:inc.length, obtido:i2.repetidas });
    snaps = DB.getTecSnapshots();
    metricas.retratosPrimeiraOnda = snaps.length;
    metricas.linhasIncidencia = DB.getIncidencia().length;
    metricas.linhasTecPrimeiraOnda = snaps.reduce((n,s)=>n+(s.rows||[]).length,0);

    PlanoEngine.salvarPrefs({ minAmostra:5, amostraAlvo:30, granPiso:10, incluirPequenas:true, metaDominio:85, tetoDominio:90, limite:20, foco:[], disciplina:'__todas__' });
    const refPlano = () => {
      PlanoEngine._agrC = null;
      const s = DB.getTecSnapshots();
      const ag = s.length > 1 ? DesempenhoTecScreen.aggregate(s) : s[0];
      return PlanoEngine.calcular(ag, PlanoEngine.prefs());
    };
    function criarFocos(max) {
      const r = refPlano();
      if (!r || r.erro) return [];
      const cand = [...(r.itens || []), ...(r.pequenas || [])];
      const abertas = new Set(openPlan().map(e => norm(e.origemPlano.disciplina)+'|'+norm(e.origemPlano.topico)));
      const usadas = new Set(), criadas=[];
      for (const x of cand) {
        const dk=norm(x.disciplina), k=dk+'|'+norm(x.nome);
        if (!dk || usadas.has(dk) || abertas.has(k)) continue;
        const antes = DB.getExtras().length;
        DesempenhoTecScreen.criarExtraDoPlano(x.nome, x.disciplina, x.custoQ || x.faltaAmostra || 30, x.faltaAmostra ? 'diagnostico' : 'reforco', true);
        const lista = DB.getExtras();
        if (lista.length > antes) {
          const e = lista[lista.length-1]; criadas.push(e.id); usadas.add(dk); abertas.add(k);
          if (criadas.length >= max) break;
        }
      }
      ReforcoAgendaAuto.replanejar(hoje, { preservarHoje:false });
      return criadas;
    }

    const onda1 = criarFocos(3);
    A(onda1.length === 3, 'Plano não conseguiu formar 3 focos iniciais de disciplinas diferentes', { onda1, abertas:openPlan().map(e=>e.disciplina) });
    const d1 = onda1.map(id => norm(DB.getExtra(id).disciplina));
    A(new Set(d1).size === onda1.length, 'os 3 focos iniciais repetiram disciplina', d1);

    /* ── 4. EXTRAS FORA DO PLANO + ANKI MASSIVO ─────────────────────────── */
    const anki = DB.addExtra({ titulo:'Anki diário — revisão geral', tipo:'anki', disciplina:'Revisão geral', unidade:'cards', alvo:50, periodo:'diaria', dataInicio:hoje, dataFim:addDias(hoje,60), contaMetricas:true });
    const lei = DB.addExtra({ titulo:'Lei seca semanal', tipo:'leitura', disciplina:'Direito Tributario', unidade:'paginas', alvo:20, periodo:'semanal', dataInicio:hoje, dataFim:addDias(hoje,120), contaMetricas:true });
    const qManual = DB.addExtra({ titulo:'Questões livres', tipo:'questoes', disciplina:'Contabilidade Geral', unidade:'questoes', alvo:40, periodo:'unica', datas:[hoje], contaMetricas:true });
    const video = DB.addExtra({ titulo:'Vídeo de revisão', tipo:'video', disciplina:'Auditoria', unidade:'min', alvo:30, periodo:'diaria', dataInicio:hoje, dataFim:addDias(hoje,14), contaMetricas:true });
    const rev = DB.addExtra({ titulo:'Revisão quinzenal', tipo:'revisao', disciplina:'Português', unidade:'sessoes', alvo:2, periodo:'quinzenal', dataInicio:hoje, dataFim:addDias(hoje,90), contaMetricas:false });
    const livre = DB.addExtra({ titulo:'Checklist mensal', tipo:'livre', disciplina:'', unidade:'itens', alvo:5, periodo:'mensal', dataInicio:hoje, dataFim:addDias(hoje,180), contaMetricas:false });
    DB.addExtraProgress(anki.id, 30, 25, { data:hoje });
    DB.addExtraProgress(lei.id, 7, 18, { data:hoje });
    DB.addExtraProgress(qManual.id, 13, 22, { data:hoje, acertos:9 });
    DB.addExtraProgress(video.id, 15, 0, { data:hoje });
    DB.addExtraProgress(rev.id, 1, 35, { data:hoje });
    DB.addExtraProgress(livre.id, 2, 10, { data:hoje });
    const manualSentinelaAntes = JSON.stringify(DB.getExtra(anki.id));

    // 34 extras passam pelo caminho público; o restante aumenta a carga em lote.
    for (let i=0; i<34; i++) DB.addExtra({
      titulo:'Extra API '+i, tipo:['anki','questoes','leitura','revisao','video','livre'][i%6],
      disciplina:['Direito Tributario','Contabilidade Geral','Auditoria','Administrativo','Português'][i%5],
      unidade:['cards','questoes','paginas','sessoes','min','itens'][i%6], alvo:10+(i%31),
      periodo:i%4===0?'semanal':'unica', datas:i%4===0?[]:[addDias(hoje,i%5)], contaMetricas:i%3!==0
    });
    let extrasCarga = DB.getExtras();
    const baseExtra = extrasCarga.length;
    for (let i=baseExtra; i<200; i++) {
      extrasCarga.push({ id:'bulk-extra-'+i, titulo:'Carga extra '+i, tipo:['anki','questoes','leitura','revisao','video','livre'][i%6],
        disciplina:['Direito Tributario','Contabilidade Geral','Auditoria','Administrativo','Português','Estatística'][i%6],
        unidade:['cards','questoes','paginas','sessoes','min','itens'][i%6], alvo:5+(i%46), periodo:'unica', dataInicio:null, dataFim:null,
        progresso:i%9, datas:[addDias(hoje,(i%9)-3)], marcador:'', contaMetricas:i%2===0, status:'ativa', concluidasEm:[],
        historico:i%4===0?[{data:addDias(hoje,-(i%7)),quantidade:i%9,minutos:10+(i%20)}]:[], createdAt:new Date().toISOString(), updatedAt:new Date().toISOString() });
    }
    DB.saveExtras(extrasCarga);
    A(DB.getExtras().length >= 200, 'carga de 200 Extras não persistiu', { n:DB.getExtras().length });

    const deckNames=['Tributário','Contabilidade','Auditoria','Administrativo','Português','Constitucional','Estatística','Legislação'];
    const decks=deckNames.map(n=>DB.addDeck('Stress '+n));
    for (let i=0; i<120; i++) DB.addCard({ deckId:decks[i%decks.length].id, materia:deckNames[i%deckNames.length], topico:'Tópico '+(i%50), frente:'Pergunta '+i, verso:'Resposta '+i, tipo:'stress' });
    let cards=DB.getCards();
    for (let i=cards.length; i<2000; i++) cards.push({
      id:'bulk-card-'+i, deckId:decks[i%decks.length].id, materia:deckNames[i%deckNames.length], topico:'Carga '+(i%100), tipo:'stress', kind:'basic', reversedOf:null,
      frente:'Questão massiva '+i, verso:'Resposta massiva '+i, favorito:false, status:i%5===0?'sei':'pendente', ease:2.5,
      intervalo:i%5===0?Math.max(1,i%60):0, due:todayCards(), reps:i%7, lapses:i%3, phase:i%5===0?'review':'new', learnStep:0,
      s:i%5===0?10+(i%100):null, d:i%5===0?5:null, dueTs:null, posicaoNova:i, createdAt:new Date().toISOString(), updatedAt:new Date().toISOString()
    });
    DB.saveCards(cards);
    const revlog=Array.from({length:8000},(_,i)=>({cardId:cards[i%cards.length].id, ts:Date.now()-i*60000, rating:1+(i%4), elapsed:i%12000, scheduledDays:i%90, date:addDias(hoje,-(i%365))}));
    DB._set(DB.KEYS.revlog, revlog);
    A(DB.getCards().length === 2000, '2.000 cards não persistiram', { n:DB.getCards().length });
    A(DB.getRevlog().length === 8000, '8.000 revlogs não persistiram', { n:DB.getRevlog().length });

    /* ── 5. SESSÃO PARCIAL / CHEIA / FALTA ─────────────────────────────── */
    ReforcoAgendaAuto.replanejar(hoje, { preservarHoje:false });
    let e0=DB.getExtra(onda1[0]), e1=DB.getExtra(onda1[1]), e2=DB.getExtra(onda1[2]);
    const sess0=e0 && e0.origemPlano.agendaAuto.sessoes[hoje];
    A(!!sess0, 'primeiro foco não recebeu sessão hoje');
    if (sess0) {
      const parcial=Math.max(1,Math.min(8,(sess0.alvo||15)-1));
      DB.addExtraProgress(e0.id, parcial, 18, {data:hoje,acertos:Math.max(0,parcial-2)});
      ReforcoAgendaAuto.concluirSessao(e0.id, hoje);
      e0=DB.getExtra(e0.id);
      const futuro=Object.entries(e0.origemPlano.agendaAuto.sessoes||{}).filter(([d,s])=>d>hoje&&s.estado!=='concluida').map(([,s])=>s.alvo);
      A(e0.status !== 'concluida', 'fechar sessão parcial encerrou o ciclo-pai', { progresso:e0.progresso, alvo:e0.alvo });
      A(futuro.reduce((n,q)=>n+q,0) === Math.max(0,e0.alvo-e0.progresso), 'saldo da sessão parcial não foi conservado', { futuro, progresso:e0.progresso, alvo:e0.alvo });
      A(eq(futuro, ReforcoAgendaAuto.dividir(Math.max(0,e0.alvo-e0.progresso),15)), 'saldo parcial foi pulverizado em vez de blocos cheios', { futuro });
    }
    if (e1) {
      const s=e1.origemPlano.agendaAuto.sessoes[hoje];
      if (s) DB.addExtraProgress(e1.id,s.alvo,25,{data:hoje,acertos:Math.max(0,s.alvo-3)});
      e1=DB.getExtra(e1.id);
      A(DB.extraConcluidaEm(e1,hoje), 'sessão que atingiu o bloco não foi fechada automaticamente', { alvo:s&&s.alvo, hist:histDia(e1,hoje) });
    }
    if (e2) {
      // Encena uma sessão de ontem sem qualquer registro: deve sumir como dívida.
      const y=addDias(hoje,-1), list=DB.getExtras(), x=list.find(z=>z.id===e2.id);
      x.origemPlano=Object.assign({},x.origemPlano,{agendaAuto:Object.assign({},x.origemPlano.agendaAuto||{},{sessoes:{[y]:{alvo:15,estado:'planejada',rodada:0}}})});
      x.datas=[y]; DB.saveExtras(list);
      ReforcoAgendaAuto.replanejar(hoje,{preservarHoje:false});
      e2=DB.getExtra(e2.id);
      A(!((e2.origemPlano.agendaAuto.sessoes||{})[y]), 'sessão perdida sem registro ficou como dívida vencida', { sessoes:e2.origemPlano.agendaAuto.sessoes });
      A(Object.keys(e2.origemPlano.agendaAuto.sessoes||{}).some(d=>d>=hoje), 'sessão perdida não voltou para a fila futura');
    }

    /* Extra manual é sentinela: o replanejador jamais pode tocá-lo. */
    const ankiDepois=JSON.stringify(DB.getExtra(anki.id));
    A(ankiDepois === manualSentinelaAntes, 'agenda do Plano alterou Extra manual/Anki', { antes:manualSentinelaAntes.slice(0,250), depois:ankiDepois.slice(0,250) });

    /* ── 6. NOVAS IMPORTAÇÕES + NOVOS REFORÇOS ──────────────────────────── */
    let fechadasDados=0;
    for (let i=12; i<18; i++) {
      DB.saveTecSnapshot(Object.assign({}, todos[i], { id:'stress-'+i, label:'Stress '+(i+1) }));
      DesempenhoTecScreen._cicloSel=null;
      try { const c=PlanoCiclo.conciliar(); fechadasDados += (c && c.fechadas ? c.fechadas.length : 0); } catch(e) { falhas.push({msg:'conciliar lançou durante importação',det:String(e&&e.message)}); }
      ReforcoAgendaAuto.replanejar(hoje,{preservarHoje:true});
    }
    const onda2=criarFocos(3);
    A(onda2.length >= 1, 'nova onda do Plano não conseguiu entrar com ciclos antigos coexistindo', { onda2, abertos:openPlan().length });
    for (let i=18; i<24; i++) {
      DB.saveTecSnapshot(Object.assign({}, todos[i], { id:'stress-'+i, label:'Stress '+(i+1) }));
      DesempenhoTecScreen._cicloSel=null;
      try { const c=PlanoCiclo.conciliar(); fechadasDados += (c && c.fechadas ? c.fechadas.length : 0); } catch(e) { falhas.push({msg:'conciliar lançou na 2ª onda',det:String(e&&e.message)}); }
      ReforcoAgendaAuto.replanejar(hoje,{preservarHoje:true});
    }
    metricas.retratosFinais=DB.getTecSnapshots().length;
    metricas.linhasTecFinais=DB.getTecSnapshots().reduce((n,s)=>n+(s.rows||[]).length,0);
    metricas.ciclosFechadosPorDados=fechadasDados;
    metricas.planCriados=planExtras().length;

    /* ── 7. INVARIANTES GLOBAIS DE AGENDA ───────────────────────────────── */
    function conferirAgenda(rot) {
      const ativos=openPlan(), porDia={};
      for (const e of ativos) {
        const ss=(e.origemPlano.agendaAuto&&e.origemPlano.agendaAuto.sessoes)||{};
        const datas=Object.keys(ss);
        A(datas.length>0 || e.alvo<=ReforcoAgendaAuto.feitoCiclo(e), rot+': ciclo aberto sem agenda', {id:e.id,t:e.titulo,alvo:e.alvo,feito:ReforcoAgendaAuto.feitoCiclo(e)});
        for (const d of datas) {
          const s=ss[d];
          A((s.alvo||0)>=1 && (s.alvo||0)<=15, rot+': sessão fora do teto', {id:e.id,d,s});
          if (d<hoje && s.estado==='planejada' && histDia(e,d)===0 && !(e.concluidasEm||[]).includes(d)) A(false,rot+': dívida vencida fantasma',{id:e.id,d,s});
          if (s.estado!=='concluida' && d>=hoje) (porDia[d]=porDia[d]||[]).push(e);
        }
      }
      for (const [d,g] of Object.entries(porDia)) {
        A(g.length<=3, rot+': mais de 3 reforços futuros no dia', {d,n:g.length,t:g.map(x=>x.titulo)});
        A(new Set(g.map(x=>String(x.id))).size===g.length, rot+': frente duplicada no dia',{d});
        A(new Set(g.map(x=>norm(x.disciplina))).size===g.length, rot+': disciplina duplicada no mesmo dia',{d,disc:g.map(x=>x.disciplina)});
      }
    }
    conferirAgenda('após 24 importações');
    A(planExtras().filter(e=>e.status==='concluida').every(e=>e.origemPlano&&e.origemPlano.veredito), 'ciclo concluído do Plano ficou sem veredito');

    /* ── 8. RENDERIZAÇÃO REAL SOB CARGA ─────────────────────────────────── */
    const tRender=performance.now();
    try { switchScreen('extras'); } catch (_) {}
    ExtrasScreen.selDay=hoje; ExtrasScreen.render();
    metricas.renderExtrasMs=Math.round(performance.now()-tRender);
    await sleep(100);
    const host=document.getElementById('screen-extras');
    const cardsHoje=document.querySelectorAll('#extras-list .exd').length;
    const curso=document.querySelectorAll('#extras-curso .exc-item').length;
    const tags=[...document.querySelectorAll('#extras-list .pl-sessao-tag')].map(x=>x.textContent);
    metricas.cardsExtrasHoje=cardsHoje; metricas.reforcosEmCursoUI=curso;
    A(cardsHoje>0, 'UI real de Extras ficou vazia sob carga');
    A(curso===openPlan().length, 'painel Em curso divergiu dos ciclos abertos', {ui:curso,dado:openPlan().length});
    A(tags.every(t=>/sessão|ciclo/i.test(t)), 'tag de sessão/ciclo ficou ambígua', {tags:tags.slice(0,10)});
    if(host) A(host.scrollWidth<=host.clientWidth+3, 'overflow horizontal na tela Extras desktop', {sw:host.scrollWidth,cw:host.clientWidth});
    A(metricas.renderExtrasMs<8000, 'renderização de Extras excedeu 8s', metricas.renderExtrasMs);

    const antesReload={ extras:DB.getExtras().length,cards:DB.getCards().length,revlog:DB.getRevlog().length,snaps:DB.getTecSnapshots().length,inc:DB.getIncidencia().length,
      plan:planExtras().length,open:openPlan().length, histPlan:planExtras().reduce((n,e)=>n+(e.historico||[]).length,0) };
    return { falhas, checagens, notas, metricas, antesReload };
  });

  Object.assign(resumo, resultado);
  console.log(`\nAuditoria massiva no Chromium: ${resultado.checagens.toLocaleString('pt-BR')} checagens`);
  console.log('Métricas:', JSON.stringify(resultado.metricas, null, 2));
  if (resultado.falhas.length) {
    console.error(`FALHAS DE CENÁRIO: ${resultado.falhas.length}`);
    resultado.falhas.slice(0, 30).forEach((f,i)=>console.error(`${i+1}. ${f.msg}${f.det!=null?' · '+JSON.stringify(f.det):''}`));
  }

  // Screenshot desktop do estado pesado real.
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.evaluate(() => { try { switchScreen('extras'); ExtrasScreen.selDay=todayLocal(); ExtrasScreen.render(); } catch (_) {} });
  await page.waitForTimeout(150);
  const shotDesk=join(ART,'extras-desktop.png');
  await page.screenshot({ path:shotDesk, fullPage:false }); resumo.artefatos.push('artifacts/stress-jornada/extras-desktop.png');

  // Mobile real: mede overflow e guarda imagem para inspeção humana.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => { ExtrasScreen.render(); }); await page.waitForTimeout(120);
  const mobile=await page.evaluate(()=>{const h=document.getElementById('screen-extras');return {scrollWidth:h&&h.scrollWidth,clientWidth:h&&h.clientWidth,cards:document.querySelectorAll('#extras-list .exd').length,curso:document.querySelectorAll('#extras-curso .exc-item').length};});
  resumo.mobile=mobile;
  if(mobile.scrollWidth>mobile.clientWidth+3) resultado.falhas.push({msg:'overflow horizontal no mobile 390px',det:mobile});
  const shotMob=join(ART,'extras-mobile-390.png');
  await page.screenshot({ path:shotMob, fullPage:false }); resumo.artefatos.push('artifacts/stress-jornada/extras-mobile-390.png');

  await page.setViewportSize({ width: 360, height: 640 });
  await page.evaluate(() => { ExtrasScreen.render(); }); await page.waitForTimeout(120);
  const narrow=await page.evaluate(()=>{const h=document.getElementById('screen-extras');return {scrollWidth:h&&h.scrollWidth,clientWidth:h&&h.clientWidth};});
  resumo.mobile360=narrow;
  if(narrow.scrollWidth>narrow.clientWidth+3) resultado.falhas.push({msg:'overflow horizontal no mobile 360px',det:narrow});
  const shotN=join(ART,'extras-mobile-360.png');
  await page.screenshot({ path:shotN, fullPage:false }); resumo.artefatos.push('artifacts/stress-jornada/extras-mobile-360.png');

  /* ── 9. RELOAD REAL: o estado tem de voltar idêntico ─────────────────── */
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.reload({ waitUntil:'domcontentloaded', timeout:30000 });
  await page.waitForFunction(() => window.DB && window.ExtrasScreen && window.ReforcoAgendaAuto, null, { timeout:30000 });
  await page.evaluate(()=>{try{ProfileUI.hideGate();}catch(_){}});
  await page.waitForTimeout(700); // dá tempo à fachada IndexedDB para hidratar
  const apos=await page.evaluate(()=>{
    const p=DB.getExtras().filter(e=>e.origemPlano&&e.origemPlano.topico);
    const open=p.filter(e=>e.status!=='concluida');
    ReforcoAgendaAuto.replanejar(todayLocal(),{preservarHoje:true});
    ExtrasScreen.selDay=todayLocal(); try{switchScreen('extras');}catch(_){} ExtrasScreen.render();
    return {extras:DB.getExtras().length,cards:DB.getCards().length,revlog:DB.getRevlog().length,snaps:DB.getTecSnapshots().length,inc:DB.getIncidencia().length,
      plan:p.length,open:open.length,histPlan:p.reduce((n,e)=>n+(e.historico||[]).length,0), uiCurso:document.querySelectorAll('#extras-curso .exc-item').length};
  });
  resumo.aposReload=apos;
  const antes=resultado.antesReload;
  for(const k of ['extras','cards','revlog','snaps','inc','plan','histPlan']) if(apos[k]!==antes[k]) resultado.falhas.push({msg:'persistência após reload divergiu em '+k,det:{antes:antes[k],apos:apos[k]}});
  if(apos.uiCurso!==apos.open) resultado.falhas.push({msg:'painel Em curso divergiu depois do reload',det:apos});

  resumo.falhasExternas=falhasExternas;
  if(falhasExternas.length) resultado.falhas.push(...falhasExternas.map(x=>({msg:x})));
  resumo.falhas=resultado.falhas;
  resumo.fim=new Date().toISOString();
  writeFileSync(join(ART,'relatorio.json'),JSON.stringify(resumo,null,2));
  console.log(`Persistência: ${JSON.stringify({antes,apos})}`);
  console.log(`Screenshots: ${resumo.artefatos.join(', ')}`);

  if(resultado.falhas.length) {
    console.error(`\nAUDITORIA MASSIVA FALHOU: ${resultado.falhas.length} problema(s).`);
    process.exitCode=1;
  } else {
    console.log(`\nOK: AUDITORIA MASSIVA — dados, rodízio, parciais, importações, Extras mistos, Anki, UI e reload passaram.`);
  }
} catch (e) {
  console.error('\nFALHA ESTRUTURAL DA AUDITORIA MASSIVA:', e && e.stack || e);
  resumo.falhaEstrutural=String(e&&e.stack||e); resumo.fim=new Date().toISOString();
  try { writeFileSync(join(ART,'relatorio.json'),JSON.stringify(resumo,null,2)); } catch {}
  process.exitCode=1;
} finally {
  try { if(browser) await browser.close(); } catch {}
  await new Promise(r=>servidor.close(r));
}
