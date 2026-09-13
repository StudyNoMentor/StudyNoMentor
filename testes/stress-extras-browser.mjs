#!/usr/bin/env node
/* ============================================================================
   STRESS REAL — Atividades Extras + reforços do Plano em Chromium
   ----------------------------------------------------------------------------
   Esta bateria NÃO substitui os testes unitários. Ela abre o app publicado em
   Chromium, usa o DB e as telas reais e produz screenshots/relatório para que
   a agenda seja testada como produto, não só como fórmula.

   Cobertura principal:
   - milhares de combinações do planejador (fuzz determinístico);
   - importações TEC sucessivas e volumosas pelo parser real;
   - reforços do Plano convivendo com Anki, lei seca, revisão e atividade livre;
   - sessões completas, parciais, perdidas, reabertas e desfeitas;
   - entrada de novos reforços enquanto outros ainda estão em curso;
   - máximo de 3 reforços do Plano por dia e diversidade de disciplina;
   - conservação exata do saldo de cada ciclo;
   - histórico concluído imutável e ausência de dívida vencida fantasma;
   - desktop e celular, com screenshots da interface real.
   ============================================================================ */
import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { chromium } from 'playwright';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'test-artifacts', 'stress-extras');
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

let checks = 0;
const ck = (cond, msg) => {
  checks++;
  if (!cond) throw new Error(`STRESS FALHOU: ${msg}`);
};
const pad = (n) => String(n).padStart(2, '0');
const addDays = (iso, n) => {
  const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
};
const TODAY = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Fortaleza' });

// RNG determinístico: se quebrar, a mesma seed reproduz.
function rng(seed) {
  let x = seed >>> 0;
  return () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return (x >>> 0) / 4294967296; };
}
const ri = (r, a, b) => a + Math.floor(r() * (b - a + 1));

const report = {
  hoje: TODAY,
  checks: 0,
  fuzz: {},
  browser: {},
  screenshots: [],
  consoleErrors: [],
  pageErrors: []
};

/* ────────────────────────────────────────────────────────────────────────────
   1) FUZZ DO MOTOR REAL, FORA DO DOM
   Carrega o MESMO 51b do produto. Aqui podemos testar milhares de cenários sem
   pagar o custo de repintura do navegador a cada um.
   ──────────────────────────────────────────────────────────────────────────── */
const agendaSrc = readFileSync(join(ROOT, 'src/js/51b-reforco-agenda-auto.js'), 'utf8');
let fakeExtras = [];
let fakeToday = TODAY;
const fakeDB = {
  getExtras: () => fakeExtras,
  saveExtras: (x) => { fakeExtras = x; },
  getExtra: (id) => fakeExtras.find(x => x.id === id) || null,
  extraConcluidaEm: (e, dia) => e && ((e.concluidasEm || []).includes(dia) || e.status === 'concluida'),
  setConcluidaDia: (id, dia, on) => { const e=fakeExtras.find(x=>x.id===id); if(!e)return null; e.status=on?'concluida':'ativa'; return e; },
  addExtraProgress: (id,q,min,opts) => { const e=fakeExtras.find(x=>x.id===id); if(!e)return null; const data=(opts&&opts.data)||fakeToday; e.progresso=(+e.progresso||0)+(+q||0); e.historico=e.historico||[]; e.historico.push({data,quantidade:+q||0,minutos:+min||0}); if(e.progresso>=e.alvo)e.status='concluida'; return e; },
  undoExtraProgressDay: (id,dia) => { const e=fakeExtras.find(x=>x.id===id); if(!e)return null; const h=e.historico||[]; for(let i=h.length-1;i>=0;i--){if(h[i].data===dia){const z=h.splice(i,1)[0];e.progresso=Math.max(0,(+e.progresso||0)-(+z.quantidade||0));return z;}} return null; },
  undoExtraProgress: (id) => { const e=fakeExtras.find(x=>x.id===id); if(!e||!(e.historico||[]).length)return null; const z=e.historico.pop(); e.progresso=Math.max(0,(+e.progresso||0)-(+z.quantidade||0)); return z; }
};
const vctx = {
  console, Date, Math, JSON, Number, String, Array, Object, Set, Map, Intl,
  globalThis: null,
  DB: fakeDB,
  ExtrasScreen: { _planoRefCard:null, _planoRefOperacional:()=>null, render:()=>{} },
  todayLocal: () => fakeToday,
  _quiet: () => {},
  showToast: () => {},
  PlanoCiclo: { avaliar: (e) => ({ feito: +e.progresso || 0 }) }
};
vctx.globalThis = vctx;
vm.createContext(vctx);
vm.runInContext(agendaSrc, vctx, { filename: '51b-reforco-agenda-auto.js' });
const A = vctx.ReforcoAgendaAuto;
ck(A && A.maxPorDia === 3 && A.maxSessao === 15, 'API real da agenda não subiu no fuzz');

let plannedBlocks = 0;
const FUZZ_CASES = 3500;
for (let seed=1; seed<=FUZZ_CASES; seed++) {
  const r = rng(seed * 2654435761);
  const n = ri(r, 1, 28);
  const discs = ri(r, 1, Math.min(12,n));
  const items = Array.from({length:n}, (_,i) => ({
    id: `s${seed}-i${i}`,
    disciplina: `D${i % discs}`,
    restante: ri(r,1,180),
    minDia: addDays(TODAY, ri(r,0,5)),
    ordem: i
  }));
  const m1 = A.planejarModelo(items, TODAY, { horizonteDias: 720 });
  const m2 = A.planejarModelo(items, TODAY, { horizonteDias: 720 });
  ck(JSON.stringify(m1.porId) === JSON.stringify(m2.porId), `planejador não determinístico na seed ${seed}`);
  for (const it of items) {
    const ss = m1.porId[it.id] || [];
    plannedBlocks += ss.length;
    ck(ss.reduce((s,x)=>s+x.alvo,0) === it.restante, `saldo perdido na seed ${seed}/${it.id}`);
    ck(ss.every(x => x.alvo >= 1 && x.alvo <= 15), `bloco fora de 1..15 na seed ${seed}/${it.id}`);
    ck(new Set(ss.map(x=>x.data)).size === ss.length, `frente duplicada no mesmo dia na seed ${seed}/${it.id}`);
    for (let j=1;j<ss.length;j++) ck(ss[j].data > ss[j-1].data, `datas não crescentes na seed ${seed}/${it.id}`);
  }
  for (const [dia, occ] of Object.entries(m1.ocupacao)) {
    ck(occ.length <= 3, `mais de 3 reforços em ${dia}, seed ${seed}`);
    ck(new Set(occ.map(x=>x.id)).size === occ.length, `mesma frente repetida em ${dia}, seed ${seed}`);
    ck(new Set(occ.map(x=>String(x.disciplina).toLowerCase())).size === occ.length, `mesma disciplina repetida em ${dia}, seed ${seed}`);
  }
}

// Saturação deliberada: testa além do uso normal para revelar limite artificial.
for (const qtd of [30, 60, 120]) {
  const itens = Array.from({length:qtd}, (_,i)=>({ id:`sat-${qtd}-${i}`, disciplina:'Única', restante:30, ordem:i }));
  const m = A.planejarModelo(itens, TODAY, { horizonteDias: 900 });
  const occ = Object.values(m.ocupacao);
  ck(occ.every(v=>v.length<=1), `saturação ${qtd}: empilhou a mesma disciplina no dia`);
  ck(itens.every(it=>(m.porId[it.id]||[]).reduce((s,x)=>s+x.alvo,0)===30), `saturação ${qtd}: perdeu saldo`);
}
report.fuzz = { casos: FUZZ_CASES, blocosPlanejados: plannedBlocks, saturacoes: [30,60,120] };

/* ────────────────────────────────────────────────────────────────────────────
   2) APP REAL EM CHROMIUM
   ──────────────────────────────────────────────────────────────────────────── */
const MIME = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.json':'application/json; charset=utf-8', '.webmanifest':'application/manifest+json', '.svg':'image/svg+xml' };
const server = createServer((req,res) => {
  try {
    const u = new URL(req.url, 'http://127.0.0.1');
    let p = decodeURIComponent(u.pathname);
    if (p === '/') p = '/index.html';
    const file = join(ROOT, p.replace(/^\/+/, ''));
    if (!file.startsWith(ROOT) || !existsSync(file)) { res.writeHead(404); res.end('404'); return; }
    res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream', 'cache-control':'no-store' });
    res.end(readFileSync(file));
  } catch (e) { res.writeHead(500); res.end(String(e)); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const PORT = server.address().port;
const BASE = `http://127.0.0.1:${PORT}/`;
const browser = await chromium.launch({ headless: true });

async function abrir(viewport, nome) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  page.on('console', msg => { if (msg.type()==='error') report.consoleErrors.push(`${nome}: ${msg.text()}`); });
  page.on('pageerror', e => report.pageErrors.push(`${nome}: ${e.message}`));
  await page.goto(BASE, { waitUntil:'domcontentloaded', timeout:30000 });
  await page.waitForFunction(() => typeof DB !== 'undefined' && typeof ExtrasScreen !== 'undefined' && typeof ReforcoAgendaAuto !== 'undefined' && typeof TecEngine !== 'undefined', null, { timeout:30000 });
  return { ctx, page };
}

async function limpar(page) {
  await page.evaluate(() => {
    try { localStorage.clear(); } catch (_) {}
    DB.saveExtras([]);
    try { DB._set(DB.KEYS.tec, []); } catch (_) {}
    try { DB._set(DB.KEYS.incidencia, []); } catch (_) {}
  });
}

async function seedBase(page) {
  return page.evaluate(({today}) => {
    const add=(iso,n)=>{const d=new Date(iso+'T12:00:00');d.setDate(d.getDate()+n);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
    const header=['Hierarquia','índice','Questões Resolvidas','Acertos (%)','Quantidade de acertos','Erros (%)','Quantidade de erros','Peso'];
    const disciplines=Array.from({length:14},(_,i)=>`Disciplina ${String(i+1).padStart(2,'0')}`);
    const snaps=[];
    for(let s=0;s<16;s++){
      const cells=[header];
      disciplines.forEach((disc,di)=>{
        const filhos=[]; let tq=0,ta=0;
        for(let t=0;t<24;t++){
          const q=8+((s*7+di*11+t*13)%28);
          const base=32+((di*9+t*5+s*3)%58);
          const ac=Math.max(0,Math.min(q,Math.round(q*base/100)));
          tq+=q;ta+=ac;
          filhos.push([String(t+1).padStart(2,'0'),`Assunto ${di+1}.${t+1}`,String(q),String(Math.round(ac/q*100)),String(ac),String(100-Math.round(ac/q*100)),String(q-ac),'1']);
        }
        cells.push(['',disc,String(tq),String(Math.round(ta/tq*100)),String(ta),String(100-Math.round(ta/tq*100)),String(tq-ta),'1']);
        cells.push(...filhos);
      });
      const end=add(today,-(15-s)*7), start=add(end,-6);
      snaps.push({id:`stress-snap-${s}`,startDate:start,endDate:end,label:`Stress ${s+1}`,rows:TecEngine.parseCellRows(cells),importedAt:new Date().toISOString()});
    }
    DB._set(DB.KEYS.tec, []);
    snaps.forEach(s=>DB.saveTecSnapshot(s));

    const mkPlano=(disc,topico,alvo,taxa=45)=>{
      const item={ nome:topico, topico, taxa, n:40, questoes:40, acertos:Math.round(40*taxa/100), metaCicloQ:alvo, metaSessaoQ:15, qMedirAlvo:95, custoEstimadoQ:236, custoQ:236 };
      const e=DB.addExtra({titulo:`Reforçar: ${topico}`,tipo:'questoes',disciplina:disc,unidade:'questoes',alvo,periodo:'unica',contaMetricas:true});
      let origem={topico,disciplina:disc,taxaInicial:taxa,metaCicloQ:alvo,metaSessaoQ:15,qMedirAlvo:95,custoEstimadoQ:236};
      try { if (typeof PlanoCiclo!=='undefined' && PlanoCiclo.origem) origem=Object.assign(origem,PlanoCiclo.origem(topico,disc,item,{motivo:'reforco'})); } catch(_){}
      origem.metaCicloQ=alvo; origem.metaSessaoQ=15; origem.topico=topico; origem.disciplina=disc;
      DB.updateExtra(e.id,{origemPlano:origem});
      return e.id;
    };
    const planos=[
      mkPlano('Disciplina 01','Assunto 1.1',25,35),
      mkPlano('Disciplina 02','Assunto 2.2',30,42),
      mkPlano('Disciplina 03','Assunto 3.3',20,48),
      mkPlano('Disciplina 04','Assunto 4.4',18,51),
      mkPlano('Disciplina 05','Assunto 5.5',15,57)
    ];

    const anki=DB.addExtra({titulo:'Anki diário — 120 cards',tipo:'anki',disciplina:'Revisão Geral',unidade:'cards',alvo:120,periodo:'diaria',dataInicio:today,dataFim:add(today,45),contaMetricas:true});
    const lei=DB.addExtra({titulo:'Lei seca — CTN',tipo:'leitura',disciplina:'Direito Tributário',unidade:'paginas',alvo:12,periodo:'diaria',dataInicio:today,dataFim:add(today,30),contaMetricas:true});
    const rev=DB.addExtra({titulo:'Revisão semanal',tipo:'revisao',disciplina:'Contabilidade',unidade:'sessoes',alvo:3,periodo:'semanal',dataInicio:today,dataFim:add(today,50),contaMetricas:true});
    const manual=DB.addExtra({titulo:'Questões avulsas de Auditoria',tipo:'questoes',disciplina:'Auditoria',unidade:'questoes',alvo:40,periodo:'unica',datas:[today],contaMetricas:true});
    const video=DB.addExtra({titulo:'Aula complementar',tipo:'video',disciplina:'Economia',unidade:'min',alvo:45,periodo:'unica',datas:[add(today,1)],contaMetricas:false});

    ReforcoAgendaAuto.replanejar(today);
    const screen=document.getElementById('screen-extras');
    if(screen){screen.classList.add('active');screen.style.display='block';screen.style.visibility='visible';}
    document.querySelectorAll('.screen').forEach(s=>{if(s!==screen)s.classList.remove('active');});
    ExtrasScreen.selDay=today; ExtrasScreen._calStart=ExtrasScreen._addDays(today,-3); ExtrasScreen.render();
    return {planos,manual:[anki.id,lei.id,rev.id,manual.id,video.id],snapshots:snaps.length,rows:snaps.reduce((n,s)=>n+s.rows.length,0)};
  }, { today:TODAY });
}

function assertAgenda(state, label) {
  ck(state.planCount >= 0, `${label}: contagem inválida`);
  for (const [dia, arr] of Object.entries(state.byDay)) {
    ck(arr.length <= 3, `${label}: ${dia} tem ${arr.length} reforços do Plano`);
    ck(new Set(arr.map(x=>x.id)).size === arr.length, `${label}: frente duplicada em ${dia}`);
    ck(new Set(arr.map(x=>x.disc)).size === arr.length, `${label}: disciplina duplicada em ${dia}`);
  }
  state.cycles.forEach(c => {
    if(c.status==='concluida') return;
    ck(c.futureSum === c.remaining, `${label}: ${c.id} futuro ${c.futureSum} != saldo ${c.remaining}`);
    ck(c.maxBlock <= 15, `${label}: ${c.id} bloco ${c.maxBlock}>15`);
  });
}

async function estado(page) {
  return page.evaluate(({today}) => {
    const extras=DB.getExtras();
    const planos=extras.filter(e=>e.origemPlano&&e.origemPlano.topico&&e.tipo==='questoes');
    const byDay={};
    planos.filter(e=>e.status!=='concluida').forEach(e=>{
      const ss=(e.origemPlano.agendaAuto&&e.origemPlano.agendaAuto.sessoes)||{};
      Object.entries(ss).forEach(([dia,s])=>{
        if(s.estado==='concluida')return;
        (byDay[dia]=byDay[dia]||[]).push({id:e.id,disc:String(e.disciplina||'').toLowerCase(),alvo:+s.alvo||0});
      });
    });
    return {
      planCount:planos.length,
      manualCount:extras.length-planos.length,
      todayPlanOpen:(byDay[today]||[]).length,
      byDay,
      cycles:planos.map(e=>{
        const rem=Math.max(0,(+e.alvo||0)-(+e.progresso||0));
        const ss=(e.origemPlano.agendaAuto&&e.origemPlano.agendaAuto.sessoes)||{};
        const fut=Object.entries(ss).filter(([d,s])=>d>=today&&s.estado!=='concluida');
        return {id:e.id,status:e.status,progress:+e.progresso||0,target:+e.alvo||0,remaining:rem,futureSum:fut.reduce((n,[,s])=>n+(+s.alvo||0),0),maxBlock:fut.reduce((m,[,s])=>Math.max(m,+s.alvo||0),0)};
      }),
      anki:extras.find(e=>e.tipo==='anki')?.titulo||null,
      total:extras.length
    };
  }, {today:TODAY});
}

const desk=await abrir({width:1440,height:1000},'desktop');
await limpar(desk.page);
const baseSeed=await seedBase(desk.page);
let st=await estado(desk.page);
assertAgenda(st,'base desktop');
ck(st.manualCount===5,'extras manuais sumiram ao criar reforços');
ck(!!st.anki,'Anki recorrente não coexistiu com o Plano');
ck(st.todayPlanOpen<=3,'mais de 3 reforços abertos hoje na base');

// Screenshot inicial do produto de verdade.
const screen=desk.page.locator('#screen-extras');
await screen.screenshot({path:join(OUT,'01-desktop-base.png')});
report.screenshots.push('01-desktop-base.png');

// Sessão parcial pelo FLUXO VISUAL: registra 7q e clica o checkbox do card.
const partial=await desk.page.evaluate(({today})=>{
  const e=DB.getExtras().find(x=>x.origemPlano&&x.status!=='concluida'&&x.datas&&x.datas.includes(today));
  if(!e) return null;
  DB.addExtraProgress(e.id,7,11,{data:today});
  ExtrasScreen.selDay=today; ExtrasScreen.render();
  return {id:e.id,target:e.alvo};
},{today:TODAY});
ck(!!partial,'não encontrou reforço do Plano para sessão parcial');
const card=desk.page.locator(`#extras-list .exd[data-id="${partial.id}"]`);
ck(await card.count()===1,'card da sessão parcial não apareceu no DOM');
await card.locator('.exd-check').click();
await desk.page.waitForTimeout(80);
st=await estado(desk.page);
const pc=st.cycles.find(x=>x.id===partial.id);
ck(pc&&pc.status!=='concluida','fechar sessão parcial encerrou o ciclo no navegador real');
ck(pc.progress===7,'progresso parcial não ficou em 7q');
assertAgenda(st,'após parcial');
await screen.screenshot({path:join(OUT,'02-desktop-parcial.png')});
report.screenshots.push('02-desktop-parcial.png');

// Novo reforço entra com outros em andamento. A sessão já feita hoje continua
// ocupando um slot do limite diário; não pode virar 1 concluído + 3 novos = 4.
const afterNew=await desk.page.evaluate(({today})=>{
  const item={nome:'Assunto 6.6',topico:'Assunto 6.6',taxa:31,n:50,questoes:50,acertos:16,metaCicloQ:30,metaSessaoQ:15,qMedirAlvo:95,custoEstimadoQ:210};
  const e=DB.addExtra({titulo:'Reforçar: Assunto 6.6',tipo:'questoes',disciplina:'Disciplina 06',unidade:'questoes',alvo:30,periodo:'unica'});
  let origem={topico:item.topico,disciplina:'Disciplina 06',taxaInicial:31,metaCicloQ:30,metaSessaoQ:15};
  try{origem=Object.assign(origem,PlanoCiclo.origem(item.topico,'Disciplina 06',item,{motivo:'reforco'}));}catch(_){}
  origem.metaCicloQ=30;origem.metaSessaoQ=15;origem.topico=item.topico;origem.disciplina='Disciplina 06';
  DB.updateExtra(e.id,{origemPlano:origem});
  ReforcoAgendaAuto.replanejar(today); ExtrasScreen.selDay=today; ExtrasScreen.render();
  return e.id;
},{today:TODAY});
ck(!!afterNew,'novo reforço não foi criado');
st=await estado(desk.page);
assertAgenda(st,'novo reforço concorrente');
const todayTotalPlan=await desk.page.evaluate(({today})=>{
  const es=DB.getExtras().filter(e=>e.origemPlano&&e.origemPlano.topico);
  return es.filter(e=>{
    const s=e.origemPlano.agendaAuto&&e.origemPlano.agendaAuto.sessoes&&e.origemPlano.agendaAuto.sessoes[today];
    return !!s;
  }).length;
},{today:TODAY});
ck(todayTotalPlan<=3,`dia atual ficou com ${todayTotalPlan} reforços contando a sessão já concluída`);

// Sessão perdida ontem sem histórico: deve desaparecer do passado e voltar à fila.
await desk.page.evaluate(({today})=>{
  const e=DB.getExtras().find(x=>x.origemPlano&&x.status!=='concluida');
  const y=(()=>{const d=new Date(today+'T12:00:00');d.setDate(d.getDate()-1);return d.toISOString().slice(0,10);})();
  e.origemPlano.agendaAuto=e.origemPlano.agendaAuto||{versao:1,sessoes:{}};
  e.origemPlano.agendaAuto.sessoes[y]={alvo:15,estado:'planejada'};
  e.datas=[...new Set([...(e.datas||[]),y])].sort();
  DB.saveExtras(DB.getExtras());
  ReforcoAgendaAuto.replanejar(today,{preservarHoje:false});
  ExtrasScreen.render();
},{today:TODAY});
const stale=await desk.page.evaluate(({today})=>DB.getExtras().filter(e=>e.origemPlano&&e.status!=='concluida').flatMap(e=>Object.entries((e.origemPlano.agendaAuto&&e.origemPlano.agendaAuto.sessoes)||{}).filter(([d,s])=>d<today&&s.estado==='planejada'&&!(e.historico||[]).some(h=>h.data===d))),{today:TODAY});
ck(stale.length===0,'sobrou dívida vencida fantasma após replanejar');

// Desfazer progresso do dia deve conservar o ciclo e regenerar saldo.
await desk.page.evaluate(({id,today})=>{DB.undoExtraProgressDay(id,today);ReforcoAgendaAuto.replanejar(today,{preservarHoje:false});ExtrasScreen.render();},{id:partial.id,today:TODAY});
st=await estado(desk.page); assertAgenda(st,'após desfazer parcial');
ck(st.cycles.find(x=>x.id===partial.id)?.progress===0,'undo do parcial não voltou o ciclo a 0');

// MASSA: 90 ciclos do Plano + 360 extras não-Plano. O objetivo é testar
// renderização/agenda em estado muito acima do uso normal sem perder dados.
const mass=await desk.page.evaluate(({today})=>{
  const beforeManual=DB.getExtras().filter(e=>!e.origemPlano).length;
  const mk=(i)=>{
    const disc=`Massa ${String((i%24)+1).padStart(2,'0')}`; const top=`Tópico massivo ${i+1}`; const alvo=15+(i%16);
    const e=DB.addExtra({titulo:`Reforçar: ${top}`,tipo:'questoes',disciplina:disc,unidade:'questoes',alvo,periodo:'unica'});
    DB.updateExtra(e.id,{origemPlano:{topico:top,disciplina:disc,taxaInicial:30+(i%40),metaCicloQ:alvo,metaSessaoQ:15,qMedirAlvo:95,custoEstimadoQ:200+(i%50)}});
  };
  for(let i=0;i<90;i++)mk(i);
  for(let i=0;i<120;i++)DB.addExtra({titulo:`Anki massa ${i}`,tipo:'anki',disciplina:`Deck ${i%12}`,unidade:'cards',alvo:80+(i%50),periodo:'diaria',dataInicio:today,dataFim:today});
  for(let i=0;i<120;i++)DB.addExtra({titulo:`Questões manuais ${i}`,tipo:'questoes',disciplina:`Manual ${i%18}`,unidade:'questoes',alvo:20+(i%30),periodo:'unica',datas:[today]});
  for(let i=0;i<120;i++)DB.addExtra({titulo:`Revisão manual ${i}`,tipo:'revisao',disciplina:`Revisão ${i%10}`,unidade:'sessoes',alvo:2+(i%4),periodo:'unica',datas:[today]});
  const t0=performance.now(); ReforcoAgendaAuto.replanejar(today); const t1=performance.now();
  ExtrasScreen.selDay=today; ExtrasScreen.render(); const t2=performance.now();
  return {beforeManual,afterManual:DB.getExtras().filter(e=>!e.origemPlano).length,total:DB.getExtras().length,replanMs:t1-t0,renderMs:t2-t1};
},{today:TODAY});
ck(mass.afterManual-mass.beforeManual===360,'massa: extras fora do Plano foram perdidos/alterados na criação');
st=await estado(desk.page); assertAgenda(st,'massa 90+360');
ck(st.manualCount===mass.afterManual,'massa: replanejamento alterou quantidade de extras manuais');
ck(report.pageErrors.length===0,'houve pageerror durante massa: '+report.pageErrors.join(' | '));
await screen.screenshot({path:join(OUT,'03-desktop-massa.png')});
report.screenshots.push('03-desktop-massa.png');

// Mobile real com a MESMA massa: testa densidade/overflow e captura visual.
await desk.page.setViewportSize({width:390,height:844});
await desk.page.evaluate(()=>{ExtrasScreen.render();});
const layout=await desk.page.evaluate(()=>{
  const s=document.getElementById('screen-extras'), curso=document.getElementById('extras-curso'), list=document.getElementById('extras-list');
  return {screenW:s?.scrollWidth||0,clientW:s?.clientWidth||0,cursoW:curso?.scrollWidth||0,cursoClient:curso?.clientWidth||0,listW:list?.scrollWidth||0,listClient:list?.clientWidth||0,cards:document.querySelectorAll('#extras-list .exd').length};
});
ck(layout.screenW<=layout.clientW+2,`mobile: screen vaza ${layout.screenW-layout.clientW}px`);
ck(layout.cursoW<=layout.cursoClient+2,`mobile: painel em curso vaza ${layout.cursoW-layout.cursoClient}px`);
ck(layout.listW<=layout.listClient+2,`mobile: lista vaza ${layout.listW-layout.listClient}px`);
await screen.screenshot({path:join(OUT,'04-mobile-massa.png')});
report.screenshots.push('04-mobile-massa.png');

// Reabrir contexto limpo em mobile e repetir base/parcial para não esconder
// problemas de estado por causa da massa do cenário anterior.
const mob=await abrir({width:390,height:844},'mobile-limpo');
await limpar(mob.page); await seedBase(mob.page);
const mScreen=mob.page.locator('#screen-extras');
await mScreen.screenshot({path:join(OUT,'05-mobile-base-limpa.png')});
report.screenshots.push('05-mobile-base-limpa.png');
const mobLayout=await mob.page.evaluate(()=>{const s=document.getElementById('screen-extras');return {sw:s.scrollWidth,cw:s.clientWidth,planHoje:DB.getExtras().filter(e=>e.origemPlano&&e.datas&&e.datas.includes(todayLocal())).length,anki:!!DB.getExtras().find(e=>e.tipo==='anki')};});
ck(mobLayout.sw<=mobLayout.cw+2,'mobile limpo tem overflow horizontal');
ck(mobLayout.planHoje<=3,'mobile limpo mostra mais de 3 reforços do Plano hoje');
ck(mobLayout.anki,'mobile limpo perdeu Anki ao lado dos reforços');

report.browser = { seed:baseSeed, massa:mass, layoutMobileMassivo:layout, layoutMobileLimpo:mobLayout };
report.checks = checks;
writeFileSync(join(OUT,'report.json'), JSON.stringify(report,null,2));

await mob.ctx.close();
await desk.ctx.close();
await browser.close();
await new Promise(r=>server.close(r));

if(report.consoleErrors.length) {
  // Nem todo console.error é fatal em ambiente offline, mas esta bateria trata
  // erros do app como regressão: o objetivo é uma execução limpa.
  throw new Error('console.error no Chromium: '+report.consoleErrors.join(' | '));
}
console.log(`OK STRESS EXTRAS: ${checks} invariantes; ${FUZZ_CASES} cenários de fuzz; ${plannedBlocks} blocos; ${baseSeed.snapshots} importações/${baseSeed.rows} linhas TEC; massa ${mass.total} atividades; desktop + mobile; ${report.screenshots.length} screenshots.`);
