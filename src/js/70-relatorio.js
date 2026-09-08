/* ============================================================
   RELATÓRIO DE EVOLUÇÃO - visualização e exportação em PDF
   Somente leitura: nenhum dado é persistido ou sincronizado.
   ============================================================ */
const StudyReport = {
  modal: null,
  esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); },
  n(v) { const x = Number(v); return Number.isFinite(x) ? x : 0; },
  date(v) { if (!v) return ''; const d = new Date(String(v).slice(0,10) + 'T00:00:00'); return isNaN(d) ? String(v) : d.toLocaleDateString('pt-BR'); },
  hm(min) { min = Math.max(0, Math.round(this.n(min))); return Math.floor(min/60) + 'h ' + String(min%60).padStart(2,'0') + 'min'; },
  pct(a,b) { return b > 0 ? (100*a/b) : 0; },
  dayKey(e) { return String(e.date || e.data || e.createdAt || '').slice(0,10); },
  start() { return document.getElementById('study-report-start'); },
  end() { return document.getElementById('study-report-end'); },
  init() {
    this.modal = document.getElementById('study-report-modal');
    const open = document.getElementById('study-report-open');
    if (!this.modal || !open) return;
    open.addEventListener('click', () => this.open());
    ['study-report-close','study-report-cancel'].forEach(id => document.getElementById(id).addEventListener('click', () => this.close()));
    /* fundo desfocado nao fecha o modal: so o X / Cancelar / Esc fecham */
    $id('study-report-presets').addEventListener('click', e => { const b=e.target.closest('[data-days]'); if(b) this.preset(b.dataset.days,b); });
    this.start().addEventListener('change', () => this.clearPreset()); this.end().addEventListener('change', () => this.clearPreset());
    $id('study-report-detail').addEventListener('change', e => this.applyDetail(e.target.value));
    $id('study-report-preview').addEventListener('click', () => this.generate(false));
    $id('study-report-generate').addEventListener('click', () => this.generate(true));
  },
  open() { this.preset('30', document.querySelector('#study-report-presets [data-days="30"]')); this.modal.classList.add('open'); document.body.style.overflow='hidden'; },
  close() { this.modal.classList.remove('open'); document.body.style.overflow=''; },
  clearPreset() { document.querySelectorAll('#study-report-presets button').forEach(b=>b.classList.remove('active')); },
  preset(days, btn) {
    this.clearPreset(); if(btn) btn.classList.add('active');
    const end=todayLocal(); let start='';
    if(days !== 'all'){ const d=new Date(end+'T00:00:00'); d.setDate(d.getDate()-Number(days)+1); start=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
    this.start().value=start; this.end().value=end;
  },
  applyDetail(value) {
    document.querySelectorAll('#study-report-sections input[data-complete]').forEach(x => { if(value==='summary') x.checked=false; else if(x.value==='extras') x.checked=true; });
  },
  config() {
    return { start:this.start().value, end:this.end().value, scope:$id('study-report-scope').value,
      detail:$id('study-report-detail').value,
      sections:new Set([...document.querySelectorAll('#study-report-sections input:checked')].map(x=>x.value)) };
  },
  entries(cfg) {
    const all = cfg.scope==='all' && DB.getAllEntriesTagged ? DB.getAllEntriesTagged() : DB.getEntries();
    return (all||[]).filter(e=>{ const d=this.dayKey(e); return d && (!cfg.start||d>=cfg.start) && (!cfg.end||d<=cfg.end); }).sort((a,b)=>this.dayKey(a).localeCompare(this.dayKey(b)));
  },
  cycles(cfg) {
    const all = cfg.scope==='all' && DB.getAllCycleHistoryTagged ? DB.getAllCycleHistoryTagged() : DB.getCycleHistory();
    return (all||[]).filter(c=>{ const a=String(c.startDate||c.date||'').slice(0,10), b=String(c.endDate||a).slice(0,10); return (!cfg.start||b>=cfg.start)&&(!cfg.end||a<=cfg.end); });
  },
  aggregate(entries) {
    const bySub={}, byMethod={}, byDay={}; let minutes=0,total=0,correct=0;
    entries.forEach(e=>{
      const m=this.n(e.durationMin||e.minutes||e.minutos), q=this.n(e.total||e.questions||e.questoes), c=this.n(e.correct||e.acertos);
      const sub=e.subject||e.materia||'Sem disciplina', method=e.method||e.modalidade||'Não informada', day=this.dayKey(e);
      minutes+=m; total+=q; correct+=c;
      const s=bySub[sub]||(bySub[sub]={name:sub,minutes:0,sessions:0,total:0,correct:0}); s.minutes+=m;s.sessions++;s.total+=q;s.correct+=c;
      const md=byMethod[method]||(byMethod[method]={name:method,minutes:0,sessions:0});md.minutes+=m;md.sessions++;
      const dy=byDay[day]||(byDay[day]={minutes:0,total:0,correct:0,sessions:0});dy.minutes+=m;dy.total+=q;dy.correct+=c;dy.sessions++;
    });
    return {minutes,total,correct,bySub:Object.values(bySub),byMethod:Object.values(byMethod),byDay};
  },
  svgBars(items, valueKey, color='#4f46e5', suffix='') {
    if(!items.length) return '<div class="empty">Sem dados suficientes para o gráfico.</div>';
    const max=Math.max(...items.map(x=>this.n(x[valueKey])),1), w=720, row=34, h=items.length*row+20;
    return `<svg class="chart" viewBox="0 0 ${w} ${h}" role="img">${items.map((x,i)=>{const y=i*row+8,v=this.n(x[valueKey]),bw=Math.max(2,(v/max)*430);return `<text x="0" y="${y+15}" class="svg-label">${this.esc(String(x.name).slice(0,28))}</text><rect x="220" y="${y}" width="${bw}" height="20" rx="5" fill="${color}" opacity=".88"/><text x="${Math.min(665,230+bw)}" y="${y+15}" class="svg-value">${this.esc(x.display!=null?x.display:(Math.round(v*10)/10)+suffix)}</text>`}).join('')}</svg>`;
  },
  lineChart(dayData) {
    const keys=Object.keys(dayData).sort(); if(keys.length<2) return '<div class="empty">São necessários registros em pelo menos dois dias para exibir a evolução.</div>';
    const vals=keys.map(k=>dayData[k].minutes), max=Math.max(...vals,1), w=740,h=220,p=34;
    const pts=vals.map((v,i)=>`${p+i*(w-2*p)/Math.max(1,vals.length-1)},${h-p-v*(h-2*p)/max}`).join(' ');
    return `<svg class="chart" viewBox="0 0 ${w} ${h}"><line x1="${p}" y1="${h-p}" x2="${w-p}" y2="${h-p}" stroke="#cbd5e1"/><polyline points="${pts}" fill="none" stroke="#4f46e5" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>${pts.split(' ').map(pt=>{const [x,y]=pt.split(',');return `<circle cx="${x}" cy="${y}" r="4" fill="#4f46e5"/>`}).join('')}<text x="${p}" y="${h-8}" class="svg-label">${this.date(keys[0])}</text><text x="${w-p}" y="${h-8}" text-anchor="end" class="svg-label">${this.date(keys[keys.length-1])}</text></svg>`;
  },
  /* Totais do TecConcursos pela MESMA função da tela de Desempenho TEC
     (TecEngine.totais), que soma apenas o nível de disciplina.
     Antes esta página somava TODAS as linhas do retrato — disciplina, tópico,
     subtópico e sub-subtópico —, contando a mesma questão uma vez por nível da
     hierarquia. O relatório mostrava um total várias vezes maior que a tela de
     onde o dado veio; o aproveitamento até sobrevivia (numerador e denominador
     inflavam juntos), mas "questões" e "acertos" não. */
  snapshotRows(cfg) {
    const snaps=(DB.getTecSnapshots?DB.getTecSnapshots():[]).filter(x=>{const a=String(x.startDate||x.date||'').slice(0,10),b=String(x.endDate||x.date||a).slice(0,10);return(!cfg.start||b>=cfg.start)&&(!cfg.end||a<=cfg.end)});
    return snaps.map(s=>{ const t=TecEngine.totais(s); return {date:s.endDate||s.date||s.startDate,q:t.questoes,c:t.acertos,p:this.pct(t.acertos,t.questoes)}; });
  },
  extras(cfg) {
    const out=[]; (DB.getExtras?DB.getExtras():[]).forEach(x=>(x.historico||[]).forEach(h=>{const d=String(h.data||'').slice(0,10);if(d&&(!cfg.start||d>=cfg.start)&&(!cfg.end||d<=cfg.end))out.push({title:x.titulo||'Atividade',date:d,quantity:this.n(h.quantidade),minutes:this.n(h.minutos)});})); return out;
  },
  css() { return `
    *{box-sizing:border-box}body{margin:0;background:#eef1f6;color:#172033;font:13px Inter,Arial,sans-serif}.toolbar{position:sticky;top:0;z-index:5;display:flex;justify-content:space-between;align-items:center;gap:12px;padding:12px 22px;background:#172033;color:white}.toolbar button{border:0;border-radius:9px;padding:9px 14px;font-weight:700;cursor:pointer}.toolbar .primary{background:#4f46e5;color:white}.paper{width:210mm;min-height:297mm;margin:18px auto;background:white;box-shadow:0 12px 35px #17203322}.page{padding:16mm 17mm;page-break-after:always}.page:last-child{page-break-after:auto}.cover{min-height:297mm;display:flex;flex-direction:column;justify-content:space-between;background:linear-gradient(145deg,#fff 0%,#f4f2ff 100%)}.brand{font-weight:900;color:#4f46e5;letter-spacing:.08em;text-transform:uppercase}.cover h1{font-size:34px;line-height:1.07;margin:14px 0}.cover .period{font-size:18px;color:#475569}.cover-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:30px}.cover-cell{padding:14px;border:1px solid #dbe2ee;border-radius:12px;background:#ffffffaa}.cover-cell small{display:block;color:#64748b;text-transform:uppercase;font-weight:800;font-size:9px;letter-spacing:.06em}.cover-cell strong{display:block;margin-top:5px;font-size:14px}.page-head{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:2px solid #4f46e5;padding-bottom:9px;margin-bottom:18px}.page-head h2{margin:0;font-size:21px}.page-head span{color:#64748b;font-size:10px}.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:9px}.kpi{border:1px solid #dbe2ee;border-radius:12px;padding:12px;min-height:74px}.kpi b{display:block;font-size:19px;color:#4f46e5}.kpi span{font-size:9px;color:#64748b;text-transform:uppercase;font-weight:800;letter-spacing:.04em}.narrative{margin:16px 0;padding:14px 16px;border-left:4px solid #4f46e5;background:#f5f3ff;line-height:1.6}.section{margin-top:20px}.section h3{font-size:15px;margin:0 0 10px}.chart{display:block;width:100%;max-height:255px}.svg-label{font:11px Arial;fill:#475569}.svg-value{font:bold 11px Arial;fill:#172033}.table{width:100%;border-collapse:collapse;font-size:10px}.table th{background:#f1f5f9;color:#475569;text-align:left;padding:7px;border-bottom:1px solid #cbd5e1}.table td{padding:7px;border-bottom:1px solid #e2e8f0;vertical-align:top}.table .num{text-align:right;font-variant-numeric:tabular-nums}.empty{padding:18px;border:1px dashed #cbd5e1;border-radius:10px;text-align:center;color:#64748b}.note{font-size:9px;color:#64748b;margin-top:8px}.good{color:#047857}.bad{color:#b91c1c}@page{size:A4;margin:0}@media print{body{background:white}.toolbar{display:none}.paper{margin:0;box-shadow:none}.page{min-height:297mm}}
  `; },
  pageHead(title,cfg){return `<div class="page-head"><h2>${this.esc(title)}</h2><span>${this.esc(this.rangeLabel(cfg))}</span></div>`;},
  rangeLabel(cfg){return (cfg.start?this.date(cfg.start):'Início')+' a '+(cfg.end?this.date(cfg.end):'Hoje');},
  build(cfg, entries) {
    const a=this.aggregate(entries), profile=window.ProfileManager&&ProfileManager.getActiveProfile?ProfileManager.getActiveProfile():null;
    const plan=cfg.scope==='all'?'Todos os planejamentos':((window.PlanManager&&PlanManager.getActivePlan&&PlanManager.getActivePlan()||{}).nome||'Planejamento atual');
    const days=Object.keys(a.byDay), studiedDays=days.length, calDays=(cfg.start&&cfg.end)?Math.max(1,Math.round((new Date(cfg.end+'T00:00:00')-new Date(cfg.start+'T00:00:00'))/86400000)+1):studiedDays;
    const acc=this.pct(a.correct,a.total), avg=studiedDays?a.minutes/studiedDays:0;
    const narrative=entries.length?`No período selecionado, foram registrados <strong>${this.hm(a.minutes)}</strong> de estudo em <strong>${studiedDays}</strong> dia(s), com <strong>${entries.length}</strong> sessão(ões). ${a.total?`Foram contabilizadas <strong>${Math.round(a.total)}</strong> questões e aproveitamento geral de <strong>${(Math.round(acc*100)/100).toFixed(2).replace('.',',')}%</strong>.`: 'Não há questões contabilizadas no recorte.'}`:'Não há registros de estudo no período selecionado.';
    let pages=`<section class="page cover"><div><div class="brand">Diário de Estudos</div><h1>Relatório de evolução dos estudos</h1><div class="period">${this.esc(this.rangeLabel(cfg))}</div><div class="cover-grid"><div class="cover-cell"><small>Perfil</small><strong>${this.esc(profile&&profile.nome||'Perfil ativo')}</strong></div><div class="cover-cell"><small>Escopo</small><strong>${this.esc(plan)}</strong></div><div class="cover-cell"><small>Formato</small><strong>${cfg.detail==='complete'?'Completo':'Resumido'}</strong></div><div class="cover-cell"><small>Gerado em</small><strong>${new Date().toLocaleString('pt-BR')}</strong></div></div></div><div class="note">Documento gerado localmente em modo somente leitura.</div></section>`;
    pages+=`<section class="page">${this.pageHead('Resumo executivo',cfg)}<div class="kpis"><div class="kpi"><b>${this.hm(a.minutes)}</b><span>Tempo estudado</span></div><div class="kpi"><b>${entries.length}</b><span>Sessões</span></div><div class="kpi"><b>${studiedDays}/${calDays}</b><span>Dias com estudo</span></div><div class="kpi"><b>${a.total?acc.toFixed(1).replace('.',',')+'%':'-'}</b><span>Aproveitamento</span></div><div class="kpi"><b>${this.hm(avg)}</b><span>Média por dia estudado</span></div><div class="kpi"><b>${Math.round(a.total)}</b><span>Questões</span></div><div class="kpi"><b>${Math.round(a.correct)}</b><span>Acertos</span></div><div class="kpi"><b>${a.bySub.length}</b><span>Disciplinas</span></div></div><div class="narrative">${narrative}</div>${cfg.sections.has('tempo')?`<div class="section"><h3>Tempo registrado ao longo do período</h3>${this.lineChart(a.byDay)}</div>`:''}</section>`;
    if(cfg.sections.has('disciplinas')){const rows=a.bySub.sort((x,y)=>y.minutes-x.minutes);pages+=`<section class="page">${this.pageHead('Análise por disciplina',cfg)}<table class="table"><thead><tr><th>Disciplina</th><th class="num">Tempo</th><th class="num">% do tempo</th><th class="num">Sessões</th><th class="num">Questões</th><th class="num">Acertos</th><th class="num">Aproveitamento</th></tr></thead><tbody>${rows.length?rows.map(x=>`<tr><td><strong>${this.esc(x.name)}</strong></td><td class="num">${this.hm(x.minutes)}</td><td class="num">${this.pct(x.minutes,a.minutes).toFixed(1).replace('.',',')}%</td><td class="num">${x.sessions}</td><td class="num">${Math.round(x.total)}</td><td class="num">${Math.round(x.correct)}</td><td class="num">${x.total?this.pct(x.correct,x.total).toFixed(1).replace('.',',')+'%':'-'}</td></tr>`).join(''):`<tr><td colspan="7">Sem registros.</td></tr>`}</tbody></table><div class="section"><h3>Distribuição do tempo</h3>${this.svgBars(rows.slice(0,12).map(x=>({...x,display:this.hm(x.minutes)})),'minutes')}</div></section>`;}
    if(cfg.sections.has('questoes')){const rows=a.bySub.filter(x=>x.total>0).sort((x,y)=>y.total-x.total);pages+=`<section class="page">${this.pageHead('Questões e aproveitamento',cfg)}<div class="kpis"><div class="kpi"><b>${Math.round(a.total)}</b><span>Resolvidas</span></div><div class="kpi"><b>${Math.round(a.correct)}</b><span>Acertos</span></div><div class="kpi"><b>${Math.max(0,Math.round(a.total-a.correct))}</b><span>Erros</span></div><div class="kpi"><b>${a.total?acc.toFixed(1).replace('.',',')+'%':'-'}</b><span>Aproveitamento</span></div></div><div class="section"><h3>Volume por disciplina</h3>${this.svgBars(rows.slice(0,12).map(x=>({...x,display:Math.round(x.total)+' questões'})),'total','#0a95a8')}</div><div class="section"><h3>Aproveitamento por disciplina</h3>${this.svgBars(rows.slice(0,12).map(x=>({name:x.name,value:this.pct(x.correct,x.total),display:this.pct(x.correct,x.total).toFixed(1).replace('.',',')+'%'})),'value','#0f9d63')}</div></section>`;}
    if(cfg.sections.has('modalidades')){const rows=a.byMethod.sort((x,y)=>y.minutes-x.minutes);pages+=`<section class="page">${this.pageHead('Modalidades de estudo',cfg)}<div class="section"><h3>Tempo por modalidade</h3>${this.svgBars(rows.map(x=>({...x,display:this.hm(x.minutes)})),'minutes','#7c3aed')}</div><table class="table"><thead><tr><th>Modalidade</th><th class="num">Sessões</th><th class="num">Tempo</th><th class="num">Participação</th></tr></thead><tbody>${rows.map(x=>`<tr><td>${this.esc(x.name)}</td><td class="num">${x.sessions}</td><td class="num">${this.hm(x.minutes)}</td><td class="num">${this.pct(x.minutes,a.minutes).toFixed(1).replace('.',',')}%</td></tr>`).join('')||'<tr><td colspan="4">Sem dados.</td></tr>'}</tbody></table></section>`;}
    if(cfg.sections.has('ciclos')){const rows=this.cycles(cfg);pages+=`<section class="page">${this.pageHead('Ciclos e metas',cfg)}<table class="table"><thead><tr><th>Período do ciclo</th><th>Planejamento</th><th class="num">Carga planejada</th><th class="num">Disciplinas</th></tr></thead><tbody>${rows.map(c=>`<tr><td>${this.date(c.startDate)} a ${this.date(c.endDate||c.startDate)}</td><td>${this.esc(c._planNome||plan)}</td><td class="num">${this.hm(this.n(c.weeklyHours)*60)}</td><td class="num">${(c.subjects||[]).length}</td></tr>`).join('')||'<tr><td colspan="4">Nenhum ciclo fechado coincide com o período.</td></tr>'}</tbody></table><p class="note">Ciclos que coincidem total ou parcialmente com o intervalo selecionado.</p></section>`;}
    if(cfg.sections.has('tec')){const rows=this.snapshotRows(cfg);pages+=`<section class="page">${this.pageHead('Desempenho no TecConcursos',cfg)}<table class="table"><thead><tr><th>Data de referência</th><th class="num">Questões identificadas</th><th class="num">Acertos identificados</th><th class="num">Aproveitamento</th></tr></thead><tbody>${rows.map(x=>`<tr><td>${this.date(x.date)}</td><td class="num">${Math.round(x.q)}</td><td class="num">${Math.round(x.c)}</td><td class="num">${x.q?x.p.toFixed(1).replace('.',',')+'%':'Dados agregados não disponíveis'}</td></tr>`).join('')||'<tr><td colspan="4">Não há retratos do TecConcursos no período selecionado.</td></tr>'}</tbody></table></section>`;}
    if(cfg.sections.has('extras')){const rows=this.extras(cfg), sumQ=rows.reduce((s,x)=>s+x.quantity,0),sumM=rows.reduce((s,x)=>s+x.minutes,0);pages+=`<section class="page">${this.pageHead('Atividades extras',cfg)}<div class="kpis"><div class="kpi"><b>${rows.length}</b><span>Lançamentos</span></div><div class="kpi"><b>${Math.round(sumQ)}</b><span>Quantidade registrada</span></div><div class="kpi"><b>${this.hm(sumM)}</b><span>Tempo registrado</span></div></div><table class="table" style="margin-top:16px"><thead><tr><th>Data</th><th>Atividade</th><th class="num">Quantidade</th><th class="num">Tempo</th></tr></thead><tbody>${rows.slice(0,80).map(x=>`<tr><td>${this.date(x.date)}</td><td>${this.esc(x.title)}</td><td class="num">${x.quantity||'-'}</td><td class="num">${x.minutes?this.hm(x.minutes):'-'}</td></tr>`).join('')||'<tr><td colspan="4">Nenhuma atividade extra registrada no período.</td></tr>'}</tbody></table>${rows.length>80?'<p class="note">Exibindo os 80 primeiros lançamentos.</p>':''}</section>`;}
    if(cfg.sections.has('historico')){const chunks=[];for(let i=0;i<entries.length;i+=28)chunks.push(entries.slice(i,i+28));if(!chunks.length)chunks.push([]);chunks.forEach((chunk,idx)=>{pages+=`<section class="page">${this.pageHead('Histórico detalhado'+(chunks.length>1?' '+(idx+1)+'/'+chunks.length:''),cfg)}<table class="table"><thead><tr><th>Data</th><th>Disciplina</th><th>Modalidade</th><th>Conteúdo</th><th class="num">Duração</th><th class="num">Questões</th><th class="num">Acertos</th></tr></thead><tbody>${chunk.map(e=>`<tr><td>${this.date(this.dayKey(e))}</td><td>${this.esc(e.subject||e.materia||'-')}</td><td>${this.esc(e.method||e.modalidade||'-')}</td><td>${this.esc(e.lesson||e.conteudo||'-')}</td><td class="num">${this.hm(this.n(e.durationMin||e.minutes||e.minutos))}</td><td class="num">${Math.round(this.n(e.total||e.questoes))}</td><td class="num">${Math.round(this.n(e.correct||e.acertos))}</td></tr>`).join('')||'<tr><td colspan="7">Sem registros.</td></tr>'}</tbody></table></section>`;});}
    return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Relatório de evolução - ${this.esc(this.rangeLabel(cfg))}</title><style>${this.css()}
</style></head><body><div class="toolbar"><div><strong>Pré-visualização do relatório</strong><div style="font-size:11px;opacity:.75">${this.esc(this.rangeLabel(cfg))}</div></div><div><button onclick="window.close()">Fechar</button> <button class="primary" onclick="window.print()">Salvar em PDF</button></div></div><main class="paper">${pages}</main></body></html>`;
  },
  generate(printNow) {
    const cfg=this.config();
    if(cfg.start&&cfg.end&&cfg.start>cfg.end){showToast('A data inicial não pode ser posterior à data final.');return;}
    if(!cfg.sections.size){showToast('Selecione ao menos uma seção do relatório.');return;}
    const entries=this.entries(cfg), win=window.open('','_blank');
    if(!win){showToast('O navegador bloqueou a visualização. Permita pop-ups para gerar o PDF.');return;}
    win.document.open();win.document.write(this.build(cfg,entries));win.document.close();this.close();
    if(printNow) setTimeout(()=>{try{win.focus();win.print();}catch (e) { _quiet(e); }},500);
  }
};

/* ===== CAMADA ANALITICA AVANCADA DO RELATORIO ===== */
(function enhanceStudyReport(){
  const baseCss = StudyReport.css.bind(StudyReport);
  StudyReport.css = function(){ return baseCss() + `
    :root{--ink:#162033;--muted:#64748b;--line:#dce4ef;--violet:#6657e8;--blue:#168aad;--green:#10a36d;--orange:#e78a20;--red:#dc5363;--purple:#8b5cf6}
    body{background:radial-gradient(circle at 15% 0,#e9e7ff 0,transparent 28%),#eef2f7;color:var(--ink)}
    .paper{overflow:hidden;border-radius:4px}.page{position:relative;background:linear-gradient(180deg,#fff 0,#fff 88%,#fafbfe 100%)}
    .page:after{content:'DIARIO DE ESTUDOS  •  RELATORIO ANALITICO';position:absolute;left:17mm;right:17mm;bottom:7mm;padding-top:3mm;border-top:1px solid #e7ebf2;color:#8a96a8;font:700 7px Arial;letter-spacing:.12em}
    .cover:after{display:none}.cover{background:linear-gradient(145deg,#161b33 0%,#312e81 52%,#6d5ce7 100%);color:white;position:relative;overflow:hidden}
    .cover:before{content:'';position:absolute;width:115mm;height:115mm;border-radius:50%;right:-30mm;top:-24mm;background:radial-gradient(circle,#ffffff2f 0,#ffffff08 56%,transparent 57%);box-shadow:-65mm 164mm 0 20mm #ffffff0b}
    .cover>div{position:relative;z-index:1}.cover .brand{color:#c9c4ff}.cover h1{font-size:38px;max-width:155mm}.cover .period{color:#e5e7ff}.cover-cell{background:#ffffff12;border-color:#ffffff35;backdrop-filter:blur(5px)}.cover-cell small{color:#cfccff}.cover .note{color:#d9d8ff}
    .page-head{border:0;align-items:center;padding:0 0 12px;position:relative}.page-head:after{content:'';position:absolute;bottom:0;left:0;width:58px;height:4px;border-radius:3px;background:linear-gradient(90deg,var(--violet),#1d9cc1)}
    .page-head h2{font-size:24px;letter-spacing:-.025em}.page-head span{background:#f0efff;color:#5549c7;border-radius:20px;padding:6px 10px;font-weight:700}
    .kpis{gap:10px}.kpi{position:relative;overflow:hidden;border:0;background:linear-gradient(145deg,#f8f9fc,#fff);box-shadow:0 5px 15px #1b24400b,0 0 0 1px #e3e8f1;min-height:82px;padding:13px 13px 12px}.kpi:before{content:'';position:absolute;left:0;top:0;bottom:0;width:4px;background:var(--violet)}.kpi:nth-child(4n+2):before{background:var(--blue)}.kpi:nth-child(4n+3):before{background:var(--green)}.kpi:nth-child(4n):before{background:var(--orange)}.kpi b{font-size:20px;color:var(--ink);letter-spacing:-.03em}.kpi span{display:block;margin-top:5px;line-height:1.25}
    .narrative{border:0;border-radius:12px;background:linear-gradient(135deg,#eeecff,#f7f9ff);box-shadow:inset 4px 0 0 var(--violet)}
    .section{border:1px solid #e3e8f1;border-radius:14px;padding:14px;background:#fff;box-shadow:0 5px 18px #1b24400a}.section h3{display:flex;align-items:center;gap:7px}.section h3:before{content:'';width:8px;height:8px;border-radius:50%;background:var(--violet);box-shadow:0 0 0 4px #eeecff}
    .table{border:1px solid #e1e7f0;border-radius:10px;overflow:hidden}.table th{background:#202742;color:white;padding:8px}.table tbody tr:nth-child(even){background:#f8f9fc}.table td{padding:7.5px}.table strong{color:#2d3470}
    .insight-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:12px 0}.insight{position:relative;border-radius:13px;padding:13px 14px 13px 45px;background:#f7f8fc;border:1px solid #e1e6ef;min-height:74px}.insight .ico{position:absolute;left:13px;top:13px;width:23px;height:23px;border-radius:8px;display:grid;place-items:center;background:#eae7ff;color:#5146c9;font-weight:900}.insight b{display:block;font-size:12px;margin-bottom:4px}.insight p{margin:0;color:#59677b;font-size:9.5px;line-height:1.45}.insight.good{background:#effaf5;border-color:#c9eddd}.insight.warn{background:#fff8ec;border-color:#f4dfb9}.insight.info{background:#eef8fb;border-color:#cce8ee}
    .metric-band{display:grid;grid-template-columns:repeat(3,1fr);gap:0;border-radius:14px;overflow:hidden;background:linear-gradient(110deg,#22294a,#423a99 58%,#126f8d);color:white;margin:14px 0}.metric-band>div{padding:15px;border-right:1px solid #ffffff22}.metric-band>div:last-child{border:0}.metric-band b{display:block;font-size:19px}.metric-band span{font-size:8px;text-transform:uppercase;letter-spacing:.08em;color:#d8dcff}
    .mini-title{font-size:10px;font-weight:900;text-transform:uppercase;letter-spacing:.08em;color:#69768a;margin:16px 0 8px}.legend{display:flex;flex-wrap:wrap;gap:10px;margin:8px 0 0;color:#64748b;font-size:8.5px}.legend i{display:inline-block;width:9px;height:9px;border-radius:3px;margin-right:4px;vertical-align:-1px}
    .data-note{display:flex;gap:9px;padding:10px 12px;border-radius:10px;background:#f4f6f9;color:#68768a;font-size:9px;line-height:1.45;margin-top:12px}.data-note:before{content:'i';flex:0 0 18px;height:18px;border-radius:50%;display:grid;place-items:center;background:#667085;color:white;font:bold 11px serif}
    @media print{.paper{border-radius:0}.section{break-inside:avoid}.page:after{-webkit-print-color-adjust:exact;print-color-adjust:exact}*{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
  `; };

  StudyReport._niceMax = function(v){ if(v<=0)return 1; const pow=Math.pow(10,Math.floor(Math.log10(v))); const n=v/pow; return (n<=1?1:n<=2?2:n<=5?5:10)*pow; };
  StudyReport.lineChart = function(dayData){
    const keys=Object.keys(dayData).sort();
    if(!keys.length) return '<div class="empty">Nenhum registro de tempo no periodo.</div>';
    const vals=keys.map(k=>this.n(dayData[k].minutes));
    const W=760,H=275,L=60,R=20,T=24,B=48, plotW=W-L-R,plotH=H-T-B;
    const yMax=this._niceMax(Math.max(...vals,60));
    const x=(i)=>L+(keys.length===1?plotW/2:i*plotW/(keys.length-1));
    const y=(v)=>T+plotH-(v/yMax)*plotH;
    const path=vals.map((v,i)=>(i?'L':'M')+x(i).toFixed(1)+' '+y(v).toFixed(1)).join(' ');
    const area=path+` L ${x(vals.length-1)} ${T+plotH} L ${x(0)} ${T+plotH} Z`;
    let grid=''; for(let i=0;i<=4;i++){const val=yMax*i/4, yy=y(val); grid+=`<line x1="${L}" y1="${yy}" x2="${W-R}" y2="${yy}" stroke="#dfe5ee" stroke-dasharray="4 4"/><text x="${L-9}" y="${yy+4}" text-anchor="end" class="svg-label">${this.hm(val)}</text>`;}
    const step=Math.max(1,Math.ceil(keys.length/7)); let xlabels=''; keys.forEach((k,i)=>{if(i%step===0||i===keys.length-1)xlabels+=`<text x="${x(i)}" y="${H-18}" text-anchor="middle" class="svg-label">${this.date(k).slice(0,5)}</text>`;});
    const points=vals.map((v,i)=>`<circle cx="${x(i)}" cy="${y(v)}" r="4.5" fill="#6757e8" stroke="white" stroke-width="2"/><text x="${x(i)}" y="${Math.max(12,y(v)-9)}" text-anchor="middle" class="svg-value">${this.hm(v)}</text>`).join('');
    return `<svg class="chart" style="max-height:310px" viewBox="0 0 ${W} ${H}" role="img" aria-label="Tempo estudado por data"><defs><linearGradient id="studyArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6757e8" stop-opacity=".28"/><stop offset="1" stop-color="#6757e8" stop-opacity=".02"/></linearGradient></defs>${grid}<path d="${area}" fill="url(#studyArea)"/><path d="${path}" fill="none" stroke="#6757e8" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>${points}${xlabels}<text x="${W/2}" y="${H-2}" text-anchor="middle" class="svg-label" style="font-weight:bold">DATA DO ESTUDO</text><text transform="translate(13 ${H/2}) rotate(-90)" text-anchor="middle" class="svg-label" style="font-weight:bold">TEMPO REGISTRADO</text></svg><div class="legend"><span><i style="background:#6757e8"></i>Tempo total por dia</span><span>Valores exibidos em horas e minutos</span></div>`;
  };

  StudyReport._advanced = function(entries){
    const a=this.aggregate(entries), days=Object.keys(a.byDay).sort();
    const read=[], video=[]; let pages=0,readMin=0,videoConsumed=0,videoStudyMin=0;
    entries.forEach(e=>{
      const min=this.n(e.durationMin||e.minutes||e.minutos), method=String(e.method||'').toLowerCase();
      /* Ritmo de LEITURA só com sessões de leitura. A tela de Evolução já fazia
         assim; aqui ainda entrava qualquer sessão com páginas preenchidas
         (Questões, Revisão...), inflando o divisor e derrubando o "páginas por
         hora" — a mesma métrica saía diferente na tela e no relatório. */
      const leitura=!/quest|revis|video|aula/.test(method.normalize('NFD').replace(/[\u0300-\u036f]/g,''));
      const p1=this.n(e.pageStart),p2=this.n(e.pageEnd); const pg=(leitura&&p1&&p2&&p2>=p1)?p2-p1+1:0;
      if(pg>0&&min>0){pages+=pg;readMin+=min;read.push({subject:e.subject||'Sem disciplina',pages:pg,min,date:this.dayKey(e)});}
      const v1=this.n(e.videoStart),v2=this.n(e.videoEnd); const vc=(v2>v1)?v2-v1:0;
      if(vc>0&&min>0){videoConsumed+=vc;videoStudyMin+=min;video.push({subject:e.subject||'Sem disciplina',content:vc,min,date:this.dayKey(e)});}
    });
    let maxStreak=0,current=0,prev=null; days.forEach(k=>{const d=new Date(k+'T00:00:00');if(prev&&Math.round((d-prev)/86400000)===1)current++;else current=1;maxStreak=Math.max(maxStreak,current);prev=d;});
    const weekday=Array.from({length:7},(_,i)=>({name:['Dom','Seg','Ter','Qua','Qui','Sex','Sab'][i],minutes:0,sessions:0})); entries.forEach(e=>{const d=new Date(this.dayKey(e)+'T00:00:00');if(!isNaN(d)){weekday[d.getDay()].minutes+=this.n(e.durationMin);weekday[d.getDay()].sessions++;}});
    const hourBuckets=[{name:'Madrugada',minutes:0,sessions:0},{name:'Manha',minutes:0,sessions:0},{name:'Tarde',minutes:0,sessions:0},{name:'Noite',minutes:0,sessions:0}]; entries.forEach(e=>{const raw=String(e.createdAt||'');const d=new Date(raw);if(!isNaN(d)){const h=d.getHours(),idx=h<6?0:h<12?1:h<18?2:3;hourBuckets[idx].minutes+=this.n(e.durationMin);hourBuckets[idx].sessions++;}});
    const activeDays=days.length, avgSession=entries.length?a.minutes/entries.length:0, consistency=days.length&&days[0]&&days[days.length-1]?100*activeDays/Math.max(1,Math.round((new Date(days[days.length-1]+'T00:00:00')-new Date(days[0]+'T00:00:00'))/86400000)+1):0;
    return {a,days,pages,readMin,readSpeed:readMin?pages/(readMin/60):0,read,videoConsumed,videoStudyMin,videoRatio:videoStudyMin?videoConsumed/videoStudyMin:0,video,maxStreak,weekday,hourBuckets,avgSession,consistency};
  };
  StudyReport._insights = function(d){
    const out=[]; const subs=d.a.bySub.slice().sort((x,y)=>y.minutes-x.minutes);
    if(d.days.length) out.push({ico:'C',tone:'good',title:'Consistencia observada',text:`${d.days.length} dia(s) com estudo, sequencia maxima de ${d.maxStreak} dia(s) e frequencia de ${d.consistency.toFixed(0)}% entre o primeiro e o ultimo registro.`});
    if(subs.length) out.push({ico:'F',tone:'info',title:'Concentracao do tempo',text:`${subs[0].name} recebeu ${this.pct(subs[0].minutes,d.a.minutes).toFixed(1).replace('.',',')}% do tempo registrado. O indicador descreve a distribuicao, sem julgar a estrategia.`});
    if(d.readSpeed) out.push({ico:'L',tone:'good',title:'Ritmo de leitura',text:`${d.pages} pagina(s) em ${this.hm(d.readMin)}, equivalente a ${d.readSpeed.toFixed(1).replace('.',',')} paginas por hora nos registros com inicio e fim de pagina.`});
    else out.push({ico:'L',tone:'warn',title:'Ritmo de leitura indisponivel',text:'Nao ha registros suficientes com pagina inicial, pagina final e duracao para calcular a velocidade de leitura.'});
    if(d.videoRatio) out.push({ico:'V',tone:'info',title:'Ritmo de video',text:`${Math.round(d.videoConsumed)} min de conteudo em ${this.hm(d.videoStudyMin)} de estudo, razao de ${d.videoRatio.toFixed(2).replace('.',',')}x.`});
    return out;
  };
  StudyReport._mentorPages = function(cfg,entries){
    const d=this._advanced(entries), ins=this._insights(d), subs=d.a.bySub.slice().sort((x,y)=>y.minutes-x.minutes);
    let html=`<section class="page">${this.pageHead('Painel analitico do mentor',cfg)}<div class="metric-band"><div><b>${d.maxStreak} dia(s)</b><span>Maior sequencia</span></div><div><b>${this.hm(d.avgSession)}</b><span>Duracao media da sessao</span></div><div><b>${d.consistency.toFixed(0)}%</b><span>Frequencia no intervalo ativo</span></div></div><div class="insight-grid">${ins.map(x=>`<div class="insight ${x.tone}"><span class="ico">${x.ico}</span><b>${this.esc(x.title)}</b><p>${x.text}</p></div>`).join('')}</div><div class="section"><h3>Distribuicao semanal do esforco</h3>${this.svgBars(d.weekday.map(x=>({...x,display:this.hm(x.minutes)})),'minutes','#168aad')}</div><div class="data-note">As leituras acima sao descritivas e calculadas apenas com os campos efetivamente preenchidos. Decisoes de planejamento devem considerar edital, prioridade, dificuldade e qualidade da execucao.</div></section>`;
    html+=`<section class="page">${this.pageHead('Velocidade e produtividade',cfg)}<div class="kpis"><div class="kpi"><b>${d.pages||'-'}</b><span>Paginas contabilizadas</span></div><div class="kpi"><b>${d.readSpeed?d.readSpeed.toFixed(1).replace('.',','):'-'}</b><span>Paginas por hora</span></div><div class="kpi"><b>${d.videoConsumed?Math.round(d.videoConsumed)+' min':'-'}</b><span>Conteudo em video</span></div><div class="kpi"><b>${d.videoRatio?d.videoRatio.toFixed(2).replace('.',',')+'x':'-'}</b><span>Razao conteudo/estudo</span></div></div><div class="mini-title">Leitura por disciplina</div><table class="table"><thead><tr><th>Disciplina</th><th class="num">Paginas</th><th class="num">Tempo</th><th class="num">Paginas/hora</th></tr></thead><tbody>${Object.values(d.read.reduce((m,x)=>{const z=m[x.subject]||(m[x.subject]={subject:x.subject,pages:0,min:0});z.pages+=x.pages;z.min+=x.min;return m;},{})).sort((a,b)=>b.pages-a.pages).map(x=>`<tr><td>${this.esc(x.subject)}</td><td class="num">${x.pages}</td><td class="num">${this.hm(x.min)}</td><td class="num">${(x.pages/(x.min/60)).toFixed(1).replace('.',',')}</td></tr>`).join('')||'<tr><td colspan="4">Sem dados suficientes de paginas e duracao.</td></tr>'}</tbody></table><div class="mini-title">Video por disciplina</div><table class="table"><thead><tr><th>Disciplina</th><th class="num">Conteudo consumido</th><th class="num">Tempo de estudo</th><th class="num">Razao</th></tr></thead><tbody>${Object.values(d.video.reduce((m,x)=>{const z=m[x.subject]||(m[x.subject]={subject:x.subject,content:0,min:0});z.content+=x.content;z.min+=x.min;return m;},{})).sort((a,b)=>b.content-a.content).map(x=>`<tr><td>${this.esc(x.subject)}</td><td class="num">${Math.round(x.content)} min</td><td class="num">${this.hm(x.min)}</td><td class="num">${(x.content/x.min).toFixed(2).replace('.',',')}x</td></tr>`).join('')||'<tr><td colspan="4">Sem dados suficientes de posicao do video e duracao.</td></tr>'}</tbody></table><div class="data-note">Velocidade de leitura usa pagina inicial e final, incluindo ambas. A razao de video compara minutos de conteudo avancado com minutos efetivamente registrados.</div></section>`;
    html+=`<section class="page">${this.pageHead('Padroes de estudo e equilibrio',cfg)}<div class="section"><h3>Tempo por dia da semana</h3>${this.svgBars(d.weekday.map(x=>({...x,display:this.hm(x.minutes)})),'minutes','#6657e8')}</div><div class="section"><h3>Registro por faixa do dia</h3>${this.svgBars(d.hourBuckets.map(x=>({...x,display:this.hm(x.minutes)})),'minutes','#e78a20')}</div><div class="mini-title">Indicadores por disciplina</div><table class="table"><thead><tr><th>Disciplina</th><th class="num">Tempo</th><th class="num">Sessoes</th><th class="num">Media/sessao</th><th class="num">Questoes/hora</th><th class="num">Aproveitamento</th></tr></thead><tbody>${subs.map(x=>`<tr><td><strong>${this.esc(x.name)}</strong></td><td class="num">${this.hm(x.minutes)}</td><td class="num">${x.sessions}</td><td class="num">${this.hm(x.minutes/Math.max(1,x.sessions))}</td><td class="num">${x.minutes&&x.total?(x.total/(x.minutes/60)).toFixed(1).replace('.',','):'-'}</td><td class="num">${x.total?this.pct(x.correct,x.total).toFixed(1).replace('.',',')+'%':'-'}</td></tr>`).join('')||'<tr><td colspan="6">Sem registros.</td></tr>'}</tbody></table><div class="data-note">A faixa do dia usa o horario de criacao do registro, que pode ser diferente do horario real do estudo quando o lancamento e feito posteriormente.</div></section>`;
    return html;
  };
  const originalBuild=StudyReport.build.bind(StudyReport);
  StudyReport.build=function(cfg,entries){
    let doc=originalBuild(cfg,entries);
    const pages=this._mentorPages(cfg,entries);
    doc=doc.replace('</main>',pages+'</main>');
    return doc;
  };
})();


/* ===== REVISAO V3: RITMO DE QUESTOES E REMOCAO DE FAIXA HORARIA ===== */
(function refineMentorReportV3(){
  const priorAdvanced = StudyReport._advanced.bind(StudyReport);
  StudyReport._advanced = function(entries){
    const d=priorAdvanced(entries);
    const questionEntries=[], qBySub={}, qByDay={};
    let questionMinutes=0, questionCount=0, questionCorrect=0;
    entries.forEach(e=>{
      const q=this.n(e.total||e.questions||e.questoes), c=this.n(e.correct||e.acertos), min=this.n(e.durationMin||e.minutes||e.minutos);
      if(q<=0) return;
      const sub=e.subject||e.materia||'Sem disciplina', day=this.dayKey(e);
      questionCount+=q; questionCorrect+=c;
      if(min>0) questionMinutes+=min;
      const row={subject:sub,day,q,c,min,mpq:min>0?min/q:0,qph:min>0?q/(min/60):0}; questionEntries.push(row);
      const s=qBySub[sub]||(qBySub[sub]={name:sub,questions:0,correct:0,minutes:0,sessions:0,timedSessions:0});
      s.questions+=q;s.correct+=c;s.sessions++;if(min>0){s.minutes+=min;s.timedSessions++;}
      const z=qByDay[day]||(qByDay[day]={name:day,questions:0,correct:0,minutes:0,sessions:0});z.questions+=q;z.correct+=c;z.minutes+=min;z.sessions++;
    });
    const timed=questionEntries.filter(x=>x.min>0);
    const paces=timed.map(x=>x.mpq).sort((a,b)=>a-b);
    const median=paces.length?(paces.length%2?paces[(paces.length-1)/2]:(paces[paces.length/2-1]+paces[paces.length/2])/2):0;
    const qSessions=questionEntries.length;
    return {...d,questionEntries,qBySub:Object.values(qBySub),qByDay,questionMinutes,questionCount,questionCorrect,
      minutesPerQuestion:questionCount&&questionMinutes?questionMinutes/questionCount:0,
      questionsPerHour:questionMinutes?questionCount/(questionMinutes/60):0,
      medianMinutesPerQuestion:median,
      avgQuestionsPerSession:qSessions?questionCount/qSessions:0,
      timedQuestionSessions:timed.length,questionSessions:qSessions};
  };
  StudyReport._questionChart = function(d){
    const rows=Object.values(d.qByDay).filter(x=>x.questions>0&&x.minutes>0).sort((a,b)=>a.name.localeCompare(b.name));
    if(!rows.length)return '<div class="empty">Nao ha registros com questoes e duracao no periodo.</div>';
    const values=rows.map(x=>x.minutes/x.questions), W=760,H=270,L=62,R=20,T=28,B=50, pw=W-L-R,ph=H-T-B;
    const max=this._niceMax(Math.max(...values,1)); const x=i=>L+(rows.length===1?pw/2:i*pw/(rows.length-1)), y=v=>T+ph-v/max*ph;
    let grid='';for(let i=0;i<=4;i++){const v=max*i/4,yy=y(v);grid+=`<line x1="${L}" y1="${yy}" x2="${W-R}" y2="${yy}" stroke="#e0e5ed" stroke-dasharray="4 4"/><text x="${L-9}" y="${yy+4}" text-anchor="end" class="svg-label">${v.toFixed(1).replace('.',',')}</text>`;}
    const path=values.map((v,i)=>(i?'L':'M')+x(i)+' '+y(v)).join(' '),step=Math.max(1,Math.ceil(rows.length/7));
    const pts=values.map((v,i)=>`<circle cx="${x(i)}" cy="${y(v)}" r="5" fill="#e78a20" stroke="white" stroke-width="2"/><text x="${x(i)}" y="${Math.max(13,y(v)-10)}" text-anchor="middle" class="svg-value">${v.toFixed(2).replace('.',',')}</text>`).join('');
    const labs=rows.map((r,i)=>(i%step===0||i===rows.length-1)?`<text x="${x(i)}" y="${H-19}" text-anchor="middle" class="svg-label">${this.date(r.name).slice(0,5)}</text>`:'').join('');
    return `<svg class="chart" style="max-height:300px" viewBox="0 0 ${W} ${H}" role="img" aria-label="Minutos por questao ao longo do periodo">${grid}<path d="${path}" fill="none" stroke="#e78a20" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>${pts}${labs}<text x="${W/2}" y="${H-2}" text-anchor="middle" class="svg-label" style="font-weight:bold">DATA</text><text transform="translate(14 ${H/2}) rotate(-90)" text-anchor="middle" class="svg-label" style="font-weight:bold">MINUTOS POR QUESTAO</text></svg><div class="legend"><span><i style="background:#e78a20"></i>Tempo registrado dividido pelo total de questoes do dia</span><span>Valor menor representa menor tempo medio, sem medir dificuldade</span></div>`;
  };
  StudyReport._insights = function(d){
    const out=[],subs=d.a.bySub.slice().sort((x,y)=>y.minutes-x.minutes);
    if(d.days.length)out.push({ico:'C',tone:'good',title:'Consistencia observada',text:`${d.days.length} dia(s) com estudo, sequencia maxima de ${d.maxStreak} dia(s) e frequencia de ${d.consistency.toFixed(0)}% entre o primeiro e o ultimo registro.`});
    if(subs.length)out.push({ico:'F',tone:'info',title:'Concentracao do tempo',text:`${subs[0].name} recebeu ${this.pct(subs[0].minutes,d.a.minutes).toFixed(1).replace('.',',')}% do tempo registrado. O indicador descreve a distribuicao, sem julgar a estrategia.`});
    if(d.minutesPerQuestion)out.push({ico:'Q',tone:'good',title:'Ritmo global de questoes',text:`${d.minutesPerQuestion.toFixed(2).replace('.',',')} min por questao, equivalentes a ${d.questionsPerHour.toFixed(1).replace('.',',')} questoes por hora, considerando apenas registros com quantidade e duracao.`});
    if(d.readSpeed)out.push({ico:'L',tone:'good',title:'Ritmo de leitura',text:`${d.pages} pagina(s) em ${this.hm(d.readMin)}, equivalente a ${d.readSpeed.toFixed(1).replace('.',',')} paginas por hora.`});
    if(d.videoRatio)out.push({ico:'V',tone:'info',title:'Ritmo de video',text:`${Math.round(d.videoConsumed)} min de conteudo em ${this.hm(d.videoStudyMin)} de estudo, razao de ${d.videoRatio.toFixed(2).replace('.',',')}x.`});
    return out;
  };
  StudyReport._mentorPages = function(cfg,entries){
    const d=this._advanced(entries),ins=this._insights(d),subs=d.a.bySub.slice().sort((x,y)=>y.minutes-x.minutes);
    let html=`<section class="page">${this.pageHead('Painel analitico do mentor',cfg)}<div class="metric-band"><div><b>${d.maxStreak} dia(s)</b><span>Maior sequencia</span></div><div><b>${this.hm(d.avgSession)}</b><span>Duracao media da sessao</span></div><div><b>${d.consistency.toFixed(0)}%</b><span>Frequencia no intervalo ativo</span></div></div><div class="insight-grid">${ins.map(x=>`<div class="insight ${x.tone}"><span class="ico">${x.ico}</span><b>${this.esc(x.title)}</b><p>${x.text}</p></div>`).join('')}</div><div class="section"><h3>Distribuicao semanal do esforco</h3>${this.svgBars(d.weekday.map(x=>({...x,display:this.hm(x.minutes)})),'minutes','#168aad')}</div><div class="data-note">O painel utiliza datas, duracoes, paginas, videos e questoes efetivamente registrados. Nao utiliza o horario de cadastro como horario de estudo.</div></section>`;
    const qrows=d.qBySub.slice().sort((a,b)=>b.questions-a.questions);
    html+=`<section class="page">${this.pageHead('Ritmo e produtividade em questoes',cfg)}<div class="kpis"><div class="kpi"><b>${d.questionCount?Math.round(d.questionCount):'-'}</b><span>Questoes contabilizadas</span></div><div class="kpi"><b>${d.minutesPerQuestion?d.minutesPerQuestion.toFixed(2).replace('.',','):'-'}</b><span>Minutos por questao</span></div><div class="kpi"><b>${d.questionsPerHour?d.questionsPerHour.toFixed(1).replace('.',','):'-'}</b><span>Questoes por hora</span></div><div class="kpi"><b>${d.avgQuestionsPerSession?d.avgQuestionsPerSession.toFixed(1).replace('.',','):'-'}</b><span>Questoes por sessao</span></div><div class="kpi"><b>${this.hm(d.questionMinutes)}</b><span>Tempo em sessoes com questoes</span></div><div class="kpi"><b>${d.medianMinutesPerQuestion?d.medianMinutesPerQuestion.toFixed(2).replace('.',','):'-'}</b><span>Mediana min/questao por sessao</span></div><div class="kpi"><b>${d.questionCount?this.pct(d.questionCorrect,d.questionCount).toFixed(1).replace('.',',')+'%':'-'}</b><span>Aproveitamento</span></div><div class="kpi"><b>${d.timedQuestionSessions}/${d.questionSessions}</b><span>Sessoes com tempo preenchido</span></div></div><div class="section"><h3>Evolucao de minutos por questao</h3>${this._questionChart(d)}</div><div class="data-note">Minutos por questao = duracao total dos registros com questoes ÷ quantidade total de questoes. A metrica nao controla dificuldade, leitura do enunciado, correcao comentada nem revisao posterior.</div></section>`;
    html+=`<section class="page">${this.pageHead('Comparativo de ritmo por disciplina',cfg)}<table class="table"><thead><tr><th>Disciplina</th><th class="num">Tempo</th><th class="num">Questoes</th><th class="num">Min/questao</th><th class="num">Questoes/h</th><th class="num">Acertos</th><th class="num">Aproveitamento</th><th class="num">Sessoes</th></tr></thead><tbody>${qrows.map(x=>`<tr><td><strong>${this.esc(x.name)}</strong></td><td class="num">${x.minutes?this.hm(x.minutes):'-'}</td><td class="num">${Math.round(x.questions)}</td><td class="num">${x.minutes?(x.minutes/x.questions).toFixed(2).replace('.',','):'-'}</td><td class="num">${x.minutes?(x.questions/(x.minutes/60)).toFixed(1).replace('.',','):'-'}</td><td class="num">${Math.round(x.correct)}</td><td class="num">${this.pct(x.correct,x.questions).toFixed(1).replace('.',',')}%</td><td class="num">${x.sessions}</td></tr>`).join('')||'<tr><td colspan="8">Sem registros com questoes no periodo.</td></tr>'}</tbody></table><div class="section"><h3>Minutos por questao por disciplina</h3>${this.svgBars(qrows.filter(x=>x.minutes).map(x=>({name:x.name,value:x.minutes/x.questions,display:(x.minutes/x.questions).toFixed(2).replace('.',',')+' min'})),'value','#e78a20')}</div><div class="data-note">Compare ritmo e aproveitamento em conjunto. Um tempo menor nao significa, isoladamente, melhor desempenho.</div></section>`;
    html+=`<section class="page">${this.pageHead('Velocidade de leitura e video',cfg)}<div class="kpis"><div class="kpi"><b>${d.pages||'-'}</b><span>Paginas contabilizadas</span></div><div class="kpi"><b>${d.readSpeed?d.readSpeed.toFixed(1).replace('.',','):'-'}</b><span>Paginas por hora</span></div><div class="kpi"><b>${d.videoConsumed?Math.round(d.videoConsumed)+' min':'-'}</b><span>Conteudo em video</span></div><div class="kpi"><b>${d.videoRatio?d.videoRatio.toFixed(2).replace('.',',')+'x':'-'}</b><span>Razao conteudo/estudo</span></div></div><div class="mini-title">Leitura por disciplina</div><table class="table"><thead><tr><th>Disciplina</th><th class="num">Paginas</th><th class="num">Tempo</th><th class="num">Paginas/hora</th></tr></thead><tbody>${Object.values(d.read.reduce((m,x)=>{const z=m[x.subject]||(m[x.subject]={subject:x.subject,pages:0,min:0});z.pages+=x.pages;z.min+=x.min;return m;},{})).sort((a,b)=>b.pages-a.pages).map(x=>`<tr><td>${this.esc(x.subject)}</td><td class="num">${x.pages}</td><td class="num">${this.hm(x.min)}</td><td class="num">${(x.pages/(x.min/60)).toFixed(1).replace('.',',')}</td></tr>`).join('')||'<tr><td colspan="4">Sem dados suficientes de paginas e duracao.</td></tr>'}</tbody></table><div class="mini-title">Video por disciplina</div><table class="table"><thead><tr><th>Disciplina</th><th class="num">Conteudo consumido</th><th class="num">Tempo de estudo</th><th class="num">Razao</th></tr></thead><tbody>${Object.values(d.video.reduce((m,x)=>{const z=m[x.subject]||(m[x.subject]={subject:x.subject,content:0,min:0});z.content+=x.content;z.min+=x.min;return m;},{})).sort((a,b)=>b.content-a.content).map(x=>`<tr><td>${this.esc(x.subject)}</td><td class="num">${Math.round(x.content)} min</td><td class="num">${this.hm(x.min)}</td><td class="num">${(x.content/x.min).toFixed(2).replace('.',',')}x</td></tr>`).join('')||'<tr><td colspan="4">Sem dados suficientes de posicao do video e duracao.</td></tr>'}</tbody></table><div class="data-note">Velocidade de leitura usa pagina inicial e final, incluindo ambas. A razao de video compara minutos de conteudo avancado com minutos registrados.</div></section>`;
    html+=`<section class="page">${this.pageHead('Equilibrio e profundidade por disciplina',cfg)}<div class="section"><h3>Tempo por dia da semana</h3>${this.svgBars(d.weekday.map(x=>({...x,display:this.hm(x.minutes)})),'minutes','#6657e8')}</div><div class="mini-title">Indicadores consolidados</div><table class="table"><thead><tr><th>Disciplina</th><th class="num">Tempo</th><th class="num">% do tempo</th><th class="num">Sessoes</th><th class="num">Media/sessao</th><th class="num">Questoes</th><th class="num">Min/questao</th><th class="num">Aproveitamento</th></tr></thead><tbody>${subs.map(x=>`<tr><td><strong>${this.esc(x.name)}</strong></td><td class="num">${this.hm(x.minutes)}</td><td class="num">${this.pct(x.minutes,d.a.minutes).toFixed(1).replace('.',',')}%</td><td class="num">${x.sessions}</td><td class="num">${this.hm(x.minutes/Math.max(1,x.sessions))}</td><td class="num">${Math.round(x.total)}</td><td class="num">${x.minutes&&x.total?(x.minutes/x.total).toFixed(2).replace('.',','):'-'}</td><td class="num">${x.total?this.pct(x.correct,x.total).toFixed(1).replace('.',',')+'%':'-'}</td></tr>`).join('')||'<tr><td colspan="8">Sem registros.</td></tr>'}</tbody></table><div class="data-note">A dimensao por faixa horaria foi removida porque o horario de cadastro pode nao representar o horario real do estudo.</div></section>`;
    return html;
  };
})();


/* ===== REVISAO V4: LEGIBILIDADE, MARGENS E ACABAMENTO PROFISSIONAL ===== */
(function professionalPrintReviewV4(){
  const previousCss=StudyReport.css.bind(StudyReport);
  StudyReport.css=function(){return previousCss()+`
    html{font-size:16px}body{font-size:13.5px;line-height:1.48;text-rendering:optimizeLegibility;-webkit-font-smoothing:antialiased}
    .paper{width:210mm;max-width:210mm}.page{width:210mm;min-height:297mm;padding:15mm 15mm 17mm;overflow:hidden}
    .page:after{left:15mm;right:15mm;bottom:6mm;font-size:8px}
    .cover{padding:18mm 17mm}.cover h1{font-size:40px;line-height:1.08;letter-spacing:-.035em}.cover .period{font-size:19px}.cover-cell small{font-size:10px}.cover-cell strong{font-size:15px;line-height:1.35}
    .page-head{margin-bottom:16px}.page-head h2{font-size:25px;line-height:1.15}.page-head span{font-size:10px;line-height:1.2}
    .kpis{grid-template-columns:repeat(4,minmax(0,1fr));gap:9px}.kpi{min-height:86px;padding:13px 11px 12px}.kpi b{font-size:19px;line-height:1.12;overflow-wrap:anywhere}.kpi span{font-size:9.5px;line-height:1.3;letter-spacing:.035em}
    .metric-band b{font-size:20px}.metric-band span{font-size:9px;line-height:1.35}
    .narrative{font-size:12px;line-height:1.65;padding:14px 16px}
    .section{padding:13px;margin-top:15px}.section h3{font-size:14px;line-height:1.3;margin-bottom:11px}
    .table{font-size:10.5px;line-height:1.35;table-layout:auto}.table th{font-size:9.5px;line-height:1.25;padding:8px 6px;white-space:normal}.table td{font-size:10.5px;padding:7px 6px;overflow-wrap:anywhere}.table td.num{white-space:nowrap}
    .insight-grid{gap:9px}.insight{min-height:82px;padding:13px 13px 13px 46px}.insight b{font-size:12px;line-height:1.3}.insight p{font-size:10.5px;line-height:1.48}.insight .ico{font-size:12px}
    .mini-title{font-size:10px;line-height:1.35}.legend{font-size:9.5px;line-height:1.4;gap:12px}.data-note{font-size:10px;line-height:1.5;padding:10px 12px}.note{font-size:9.5px;line-height:1.45}.empty{font-size:11px}
    .chart{width:100%;height:auto;max-height:240px;overflow:visible}.svg-label{font:12px Arial,sans-serif;fill:#536176}.svg-value{font:bold 12px Arial,sans-serif;fill:#172033}.section .chart+ .legend{margin-top:6px}
    @media screen and (max-width:900px){.paper{width:100%;max-width:210mm;margin:0 auto}.page{width:100%;min-height:auto;padding:24px}.toolbar{padding:10px 14px}.kpis{grid-template-columns:repeat(2,1fr)}}
    @media print{@page{size:A4 portrait;margin:0}.paper,.page{width:210mm}.paper{margin:0;box-shadow:none}.page{height:297mm;min-height:297mm;max-height:297mm;padding:15mm 15mm 17mm;break-after:page;page-break-after:always}.page:last-child{break-after:auto;page-break-after:auto}.cover{padding:18mm 17mm}.table thead{display:table-header-group}.table tr,.kpi,.insight,.metric-band{break-inside:avoid;page-break-inside:avoid}.section{break-inside:avoid;page-break-inside:avoid}.chart{max-height:235px}}
  `};

  const oldBars=StudyReport.svgBars.bind(StudyReport);
  StudyReport.svgBars=function(items,valueKey,color='#4f46e5',suffix=''){
    if(!items.length)return '<div class="empty">Sem dados suficientes para o grafico.</div>';
    const shown=items.slice(0,10),max=Math.max(...shown.map(x=>this.n(x[valueKey])),1),W=760,row=39,H=shown.length*row+24,labelX=0,barX=245,barMax=385;
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img">${shown.map((x,i)=>{const y=i*row+7,v=this.n(x[valueKey]),bw=Math.max(3,(v/max)*barMax),label=String(x.name||'').length>32?String(x.name).slice(0,30)+'…':String(x.name||'');return `<text x="${labelX}" y="${y+17}" class="svg-label" style="font-weight:600">${this.esc(label)}</text><rect x="${barX}" y="${y}" width="${barMax}" height="24" rx="6" fill="#edf0f5"/><rect x="${barX}" y="${y}" width="${bw}" height="24" rx="6" fill="${color}" opacity=".94"/><text x="${Math.min(W-8,barX+bw+9)}" y="${y+17}" class="svg-value">${this.esc(x.display!=null?x.display:(Math.round(v*10)/10)+suffix)}</text>`}).join('')}</svg>${items.length>10?`<div class="note">Grafico limitado aos 10 itens de maior relevancia visual. A tabela mantem o detalhamento disponivel.</div>`:''}`;
  };

  const oldQuestionChart=StudyReport._questionChart.bind(StudyReport);
  StudyReport._questionChart=function(d){
    const raw=oldQuestionChart(d);
    return raw.replace(/class="svg-label"/g,'class="svg-label" style="font-size:12px"').replace(/class="svg-value"/g,'class="svg-value" style="font-size:12px"');
  };

  const previousBuild=StudyReport.build.bind(StudyReport);
  StudyReport.build=function(cfg,entries){
    let doc=previousBuild(cfg,entries);
    doc=doc.replace('<title>Relatório de evolução -','<title>Relatorio Analitico de Estudos -');
    doc=doc.replace(/<main class="paper">/,'<main class="paper" aria-label="Relatorio analitico de estudos">');
    return doc;
  };
})();


/* ═══════════════════════════════════════════════════════════════════════════
   FIDELIDADE A4 EM QUALQUER APARELHO
   ───────────────────────────────────────────────────────────────────────────
   O problema: o documento do relatório usava viewport "width=device-width".
   Num celular de 390px, a regra @media screen and (max-width:900px) disparava e
   REFLUÍA todo o layout — página de 100% de largura, padding de 24px, KPIs em 2
   colunas. Ou seja: o que você via (e em vários navegadores, o que saía no PDF)
   era um layout DIFERENTE do desktop. Tablet caía num terceiro estado.

   A correção: travar o viewport em 794px, que é exatamente 210mm a 96dpi — a
   largura de uma folha A4. O navegador passa a diagramar SEMPRE em tamanho A4 e
   apenas reduz a escala visual para caber na tela. Nada reflui, então celular,
   tablet e computador produzem o MESMO PDF.

   Como 794 < 900, a antiga regra de 900px passaria a valer sempre — por isso ela
   é desativada logo abaixo, em vez de apenas ignorada.
   ═══════════════════════════════════════════════════════════════════════════ */
(function a4FidelidadeMultiDispositivo(){
  const A4_PX = 794;   // 210mm a 96dpi

  const cssAntes = StudyReport.css.bind(StudyReport);
  StudyReport.css = function () {
    // Desativa o reflow de tela pequena: ele era a causa de o celular gerar
    // um layout diferente. A folha continua A4 em qualquer largura.
    const base = cssAntes().replace(
      /@media screen and \(max-width:900px\)\{[^}]*\{[^}]*\}[^}]*\{[^}]*\}[^}]*\{[^}]*\}[^}]*\{[^}]*\}\}/g,
      ''
    );
    return base + `
    /* A folha nunca reflui: largura fixa de A4 em qualquer aparelho */
    html{-webkit-text-size-adjust:100%;text-size-adjust:100%}
    body{min-width:${A4_PX}px}
    .paper{width:210mm!important;max-width:210mm!important;margin-left:auto;margin-right:auto}
    .page{width:210mm!important}
    .kpis{grid-template-columns:repeat(4,1fr)!important}
    .toolbar{width:100%}
    @media print{
      html,body{min-width:0!important;background:#fff!important}
      .toolbar{display:none!important}
      .paper{width:210mm!important;max-width:210mm!important;margin:0!important;box-shadow:none!important}
      .page{width:210mm!important;padding:15mm 15mm 17mm!important}
      /* garante que fundos e cores das barras saiam impressos (padrão é descartar) */
      *{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}
    }`;
  };

  const buildAntes = StudyReport.build.bind(StudyReport);
  StudyReport.build = function (cfg, entries) {
    let doc = buildAntes(cfg, entries);
    // A troca do viewport é o coração da correção (ver bloco acima).
    doc = doc.replace(
      /<meta name="viewport"[^>]*>/,
      `<meta name="viewport" content="width=${A4_PX}">`
    );
    return doc;
  };
})();

(function exhaustiveLayoutAuditV5(){
  const cssBefore=StudyReport.css.bind(StudyReport);
  StudyReport.css=function(){return cssBefore()+`
    .page{height:auto!important;max-height:none!important;min-height:297mm;overflow:visible!important}
    .section{break-inside:auto!important;page-break-inside:auto!important}
    .bar-chart-sheet,.line-chart-sheet{break-inside:avoid;page-break-inside:avoid;margin:0 0 14px;padding:2px 0 8px}
    .bar-chart-sheet+.bar-chart-sheet,.line-chart-sheet+.line-chart-sheet{break-before:page;page-break-before:always;padding-top:15mm}
    .chart-continuation{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:0 0 12px;padding-bottom:8px;border-bottom:2px solid #6657e8;color:#1f2940;font-size:14px;font-weight:800}
    .chart-continuation span{font-size:10px;font-weight:700;color:#68768a;background:#f1f2f7;padding:4px 8px;border-radius:14px}
    .bar-chart-sheet .chart{display:block;width:100%;max-height:none!important}
    .table{width:100%;border-spacing:0}.table th,.table td{vertical-align:middle}
    .table th:first-child,.table td:first-child{padding-left:8px}.table th:last-child,.table td:last-child{padding-right:8px}
    .table td:first-child{line-height:1.35}.table td.num{text-align:right}
    @media print{
      .page{height:auto!important;max-height:none!important;min-height:297mm;overflow:visible!important}
      .bar-chart-sheet,.line-chart-sheet{break-inside:avoid;page-break-inside:avoid}
      .bar-chart-sheet+.bar-chart-sheet,.line-chart-sheet+.line-chart-sheet{break-before:page;page-break-before:always}
      .chart-continuation{display:flex}
    }
  `};

  StudyReport.svgBars=function(items,valueKey,color='#4f46e5',suffix=''){
    if(!items.length)return '<div class="empty">Sem dados suficientes para o grafico.</div>';
    const all=items.slice(), perPage=9, groups=[];
    for(let i=0;i<all.length;i+=perPage)groups.push(all.slice(i,i+perPage));
    const globalMax=Math.max(...all.map(x=>this.n(x[valueKey])),1), W=760,row=43,barX=265,barMax=355;
    return groups.map((group,gi)=>{
      const H=group.length*row+25;
      const title=groups.length>1?`<div class="chart-continuation">Dados do grafico <span>parte ${gi+1} de ${groups.length} - itens ${gi*perPage+1} a ${gi*perPage+group.length}</span></div>`:'';
      const svg=`<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Grafico de barras, parte ${gi+1} de ${groups.length}">${group.map((x,i)=>{const y=i*row+7,v=this.n(x[valueKey]),bw=Math.max(3,(v/globalMax)*barMax),raw=String(x.name||''),label=raw.length>38?raw.slice(0,36)+'…':raw;return `<text x="0" y="${y+18}" class="svg-label" style="font-size:13px;font-weight:600">${this.esc(label)}</text><title>${this.esc(raw)}: ${this.esc(x.display!=null?x.display:(Math.round(v*10)/10)+suffix)}</title><rect x="${barX}" y="${y}" width="${barMax}" height="26" rx="6" fill="#edf0f5"/><rect x="${barX}" y="${y}" width="${bw}" height="26" rx="6" fill="${color}" opacity=".95"/><text x="${Math.min(W-8,barX+bw+9)}" y="${y+18}" class="svg-value" style="font-size:13px">${this.esc(x.display!=null?x.display:(Math.round(v*10)/10)+suffix)}</text>`}).join('')}</svg>`;
      return `<div class="bar-chart-sheet">${title}${svg}</div>`;
    }).join('');
  };

  const lineBefore=StudyReport.lineChart.bind(StudyReport);
  StudyReport.lineChart=function(dayData){
    const keys=Object.keys(dayData).sort(); if(keys.length<=12)return lineBefore(dayData);
    const groups=[];for(let i=0;i<keys.length;i+=12)groups.push(keys.slice(i,i+12));
    return groups.map((g,i)=>{const subset={};g.forEach(k=>subset[k]=dayData[k]);return `<div class="line-chart-sheet">${groups.length>1?`<div class="chart-continuation">Evolucao do tempo <span>parte ${i+1} de ${groups.length} - ${this.date(g[0])} a ${this.date(g[g.length-1])}</span></div>`:''}${lineBefore(subset)}</div>`}).join('');
  };

  const questionBefore=StudyReport._questionChart.bind(StudyReport);
  StudyReport._questionChart=function(d){
    const keys=Object.keys(d.qByDay||{}).sort();if(keys.length<=12)return questionBefore(d);
    const groups=[];for(let i=0;i<keys.length;i+=12)groups.push(keys.slice(i,i+12));
    return groups.map((g,i)=>{const copy={...d,qByDay:{}};g.forEach(k=>copy.qByDay[k]=d.qByDay[k]);return `<div class="line-chart-sheet">${groups.length>1?`<div class="chart-continuation">Minutos por questao <span>parte ${i+1} de ${groups.length} - ${this.date(g[0])} a ${this.date(g[g.length-1])}</span></div>`:''}${questionBefore(copy)}</div>`}).join('');
  };
})();


/* ===== REVISAO V6: RELATORIO TEC A PARTIR DOS RETRATOS IMPORTADOS ===== */
(function tecSnapshotsReportV6(){
  StudyReport._tecSnaps=function(cfg){
    return (DB.getTecSnapshots?DB.getTecSnapshots():[]).filter(s=>{
      const a=String(s.startDate||s.date||'').slice(0,10),b=String(s.endDate||s.date||a).slice(0,10);
      return (!cfg.start||b>=cfg.start)&&(!cfg.end||a<=cfg.end);
    });
  };
  StudyReport._tecTotals=function(s){
    if(typeof TecEngine!=='undefined'&&TecEngine.totais)return TecEngine.totais(s);
    const roots=(s.rows||[]).filter(r=>this.n(r.depth)===0);const q=roots.reduce((a,r)=>a+this.n(r.questoes),0),ac=roots.reduce((a,r)=>a+this.n(r.acertos),0);
    return {questoes:q,acertos:ac,pct:this.pct(ac,q),disciplinas:roots.length};
  };
  StudyReport._tecDiscs=function(s){
    if(typeof TecEngine!=='undefined'&&TecEngine.disciplinas)return TecEngine.disciplinas(s);
    return (s.rows||[]).filter(r=>this.n(r.depth)===0).map(r=>({nome:r.nome,questoes:this.n(r.questoes),acertos:this.n(r.acertos),pct:this.n(r.pctAcerto)||this.pct(r.acertos,r.questoes)}));
  };
  StudyReport._tecRows=function(s){return (s.rows||[]).map(r=>({codigo:r.codigo||'',nome:r.nome||'',disciplina:r.disciplina||(this.n(r.depth)===0?r.nome:''),depth:this.n(r.depth),questoes:this.n(r.questoes),acertos:this.n(r.acertos),pct:this.n(r.pctAcerto)||this.pct(r.acertos,r.questoes)}));};
  StudyReport._tecEvolution=function(snaps){
    const map={};snaps.forEach(s=>this._tecDiscs(s).forEach(d=>{const k=d.nome;(map[k]=map[k]||{name:k,points:[]}).points.push({date:s.endDate||s.date||s.startDate,q:d.questoes,ac:d.acertos,pct:d.pct});}));return Object.values(map).sort((a,b)=>a.name.localeCompare(b.name,'pt-BR'));
  };
  StudyReport._tecPages=function(cfg){
    const snaps=this._tecSnaps(cfg);if(!snaps.length)return `<section class="page">${this.pageHead('Desempenho no TecConcursos',cfg)}<div class="empty">Nao ha retratos importados do TecConcursos no periodo selecionado.</div></section>`;
    const totals=snaps.map(s=>({snap:s,...this._tecTotals(s)})),latest=totals[totals.length-1],first=totals[0];
    let html=`<section class="page">${this.pageHead('Desempenho no TecConcursos',cfg)}<div class="kpis"><div class="kpi"><b>${snaps.length}</b><span>Retratos no periodo</span></div><div class="kpi"><b>${Math.round(latest.questoes||0)}</b><span>Questoes no retrato mais recente</span></div><div class="kpi"><b>${Math.round(latest.acertos||0)}</b><span>Acertos no retrato mais recente</span></div><div class="kpi"><b>${this.n(latest.pct).toFixed(1).replace('.',',')}%</b><span>Aproveitamento mais recente</span></div><div class="kpi"><b>${latest.disciplinas||0}</b><span>Disciplinas identificadas</span></div><div class="kpi"><b>${this.date(first.snap.startDate||first.snap.date)}</b><span>Primeiro retrato do recorte</span></div><div class="kpi"><b>${this.date(latest.snap.endDate||latest.snap.date)}</b><span>Ultimo retrato do recorte</span></div><div class="kpi"><b>${snaps.reduce((a,s)=>a+(s.rows||[]).filter(r=>this.n(r.depth)>0).length,0)}</b><span>Topicos extraidos nos retratos</span></div></div><div class="mini-title">Resumo de cada retrato importado</div><table class="table"><thead><tr><th>Retrato</th><th>Intervalo</th><th class="num">Disciplinas</th><th class="num">Topicos</th><th class="num">Questoes</th><th class="num">Acertos</th><th class="num">Erros</th><th class="num">Aproveitamento</th></tr></thead><tbody>${totals.map(x=>`<tr><td><strong>${this.esc(x.snap.nome||'Retrato TEC')}</strong></td><td>${this.date(x.snap.startDate||x.snap.date)} a ${this.date(x.snap.endDate||x.snap.date)}</td><td class="num">${x.disciplinas||0}</td><td class="num">${(x.snap.rows||[]).filter(r=>this.n(r.depth)>0).length}</td><td class="num">${Math.round(x.questoes||0)}</td><td class="num">${Math.round(x.acertos||0)}</td><td class="num">${Math.max(0,Math.round((x.questoes||0)-(x.acertos||0)))}</td><td class="num">${this.n(x.pct).toFixed(1).replace('.',',')}%</td></tr>`).join('')}</tbody></table><div class="data-note">Os totais sao calculados a partir das linhas de disciplina de cada retrato importado, evitando somar novamente topicos e subtópicos hierarquicos.</div></section>`;
    snaps.forEach((s,si)=>{
      const discs=this._tecDiscs(s).sort((a,b)=>b.questoes-a.questoes), rows=this._tecRows(s).filter(r=>r.depth>0);
      const chunks=[];for(let i=0;i<discs.length;i+=18)chunks.push(discs.slice(i,i+18));if(!chunks.length)chunks.push([]);
      chunks.forEach((chunk,ci)=>{html+=`<section class="page">${this.pageHead(`Retrato TEC ${si+1}/${snaps.length} - disciplinas${chunks.length>1?' '+(ci+1)+'/'+chunks.length:''}`,cfg)}<div class="narrative"><strong>${this.esc(s.nome||'Retrato TEC')}</strong><br>${this.date(s.startDate||s.date)} a ${this.date(s.endDate||s.date)} · ${discs.length} disciplina(s) · ${rows.length} topico(s) extraido(s)</div><table class="table"><thead><tr><th>Disciplina</th><th class="num">Questoes</th><th class="num">Acertos</th><th class="num">Erros</th><th class="num">Aproveitamento</th></tr></thead><tbody>${chunk.map(d=>`<tr><td><strong>${this.esc(d.nome)}</strong></td><td class="num">${Math.round(d.questoes)}</td><td class="num">${Math.round(d.acertos)}</td><td class="num">${Math.max(0,Math.round(d.questoes-d.acertos))}</td><td class="num">${this.n(d.pct).toFixed(1).replace('.',',')}%</td></tr>`).join('')||'<tr><td colspan="5">Sem disciplinas identificadas.</td></tr>'}</tbody></table>${ci===chunks.length-1?`<div class="section"><h3>Aproveitamento por disciplina neste retrato</h3>${this.svgBars(discs.map(d=>({name:d.nome,value:d.pct,display:this.n(d.pct).toFixed(1).replace('.',',')+'%'})),'value','#168aad')}</div>`:''}</section>`;});
      const topicChunks=[];for(let i=0;i<rows.length;i+=24)topicChunks.push(rows.slice(i,i+24));
      topicChunks.forEach((chunk,ci)=>{html+=`<section class="page">${this.pageHead(`Topicos extraidos - retrato ${si+1}/${snaps.length} - ${ci+1}/${topicChunks.length}`,cfg)}<div class="narrative"><strong>${this.esc(s.nome||'Retrato TEC')}</strong> · detalhamento hierarquico integral importado do TEC.</div><table class="table"><thead><tr><th>Disciplina</th><th>Codigo</th><th>Topico / subtopico</th><th class="num">Nivel</th><th class="num">Questoes</th><th class="num">Acertos</th><th class="num">Erros</th><th class="num">Aproveitamento</th></tr></thead><tbody>${chunk.map(r=>`<tr><td>${this.esc(r.disciplina||'-')}</td><td>${this.esc(r.codigo||'-')}</td><td style="padding-left:${8+Math.min(4,r.depth)*7}px"><strong>${this.esc(r.nome)}</strong></td><td class="num">${r.depth}</td><td class="num">${Math.round(r.questoes)}</td><td class="num">${Math.round(r.acertos)}</td><td class="num">${Math.max(0,Math.round(r.questoes-r.acertos))}</td><td class="num">${r.questoes?this.n(r.pct).toFixed(1).replace('.',',')+'%':'-'}</td></tr>`).join('')}</tbody></table></section>`;});
    });
    const evo=this._tecEvolution(snaps).filter(x=>x.points.length>1);
    if(evo.length){const chunks=[];for(let i=0;i<evo.length;i+=16)chunks.push(evo.slice(i,i+16));chunks.forEach((chunk,ci)=>{html+=`<section class="page">${this.pageHead(`Evolucao entre retratos TEC${chunks.length>1?' '+(ci+1)+'/'+chunks.length:''}`,cfg)}<table class="table"><thead><tr><th>Disciplina</th><th>Primeiro retrato</th><th class="num">% inicial</th><th>Ultimo retrato</th><th class="num">% final</th><th class="num">Variacao</th><th class="num">Questoes finais</th></tr></thead><tbody>${chunk.map(x=>{const a=x.points[0],b=x.points[x.points.length-1],delta=b.pct-a.pct;return `<tr><td><strong>${this.esc(x.name)}</strong></td><td>${this.date(a.date)}</td><td class="num">${this.n(a.pct).toFixed(1).replace('.',',')}%</td><td>${this.date(b.date)}</td><td class="num">${this.n(b.pct).toFixed(1).replace('.',',')}%</td><td class="num">${delta>=0?'+':''}${delta.toFixed(1).replace('.',',')} p.p.</td><td class="num">${Math.round(b.q)}</td></tr>`}).join('')}</tbody></table><div class="data-note">A variacao compara a primeira e a ultima medicao disponivel para cada disciplina dentro dos retratos selecionados.</div></section>`;});}
    return html;
  };
  const buildBefore=StudyReport.build.bind(StudyReport);
  StudyReport.build=function(cfg,entries){
    let doc=buildBefore(cfg,entries);if(!cfg.sections.has('tec'))return doc;
    const replacement=this._tecPages(cfg);
    const re=/<section class="page"><div class="page-head"><h2>Desempenho no TecConcursos<\/h2>[\s\S]*?<\/section>/;
    if(re.test(doc))doc=doc.replace(re,replacement);else doc=doc.replace('</main>',replacement+'</main>');
    return doc;
  };
})();

StudyReport.init();
window.StudyReport=StudyReport;

/* ---- Alternador de tema claro/escuro (preferência do dispositivo) ---- */
(function () {
  const KEY = 'diario-estudos:theme';
  const btn = document.getElementById('theme-toggle');
  function current() { return document.documentElement.getAttribute('data-theme') || 'light'; }
  function syncIcon() {
    const dark = current() === 'dark';
    const icon = btn && btn.querySelector('.theme-toggle-icon');
    if (icon) icon.textContent = dark ? '☀️' : '🌙';
    if (btn) {
      btn.title = dark ? 'Mudar para modo claro' : 'Mudar para modo escuro';
      btn.setAttribute('aria-label', btn.title);
      btn.setAttribute('aria-pressed', dark ? 'true' : 'false');
    }
    // a barra do navegador (mobile) acompanha o tema
    const mt = document.getElementById('meta-theme-color');
    if (mt) mt.setAttribute('content', dark ? '#15171c' : '#ffffff');
  }
  function apply(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem(KEY, theme); } catch (e) { _quiet(e); }
    syncIcon();
  }
  syncIcon();
  if (btn) btn.addEventListener('click', () => apply(current() === 'dark' ? 'light' : 'dark'));
})();

/* ── Rede de segurança: erros não tratados ──────────────────────────────────
   Sem isto, qualquer exceção inesperada deixava a tela parada sem explicação e
   sem pista do que aconteceu. Agora o usuário é avisado e o erro fica no console. */
(function () {
  let ultimo = 0;
  function avisar(origem, msg) {
    console.error('[' + origem + ']', msg);
    const agora = Date.now();
    if (agora - ultimo < 8000) return; // não empilha avisos repetidos
    ultimo = agora;
    try {
      if (typeof showToast === 'function') showToast('⚠ Algo falhou nesta ação. Seus dados estão salvos — recarregue a página se a tela parar de responder.');
    } catch (_) { _quiet(_); }
  }
  window.addEventListener('error', (e) => {
    if (e && e.target && e.target !== window && e.target.tagName) return; // falha ao carregar recurso externo
    avisar('erro', (e && (e.message || e.error)) || 'desconhecido');
  });
  window.addEventListener('unhandledrejection', (e) => {
    avisar('promessa', (e && e.reason && (e.reason.message || e.reason)) || 'desconhecida');
  });
})();

// Os modais de editar perfil e de PIN estavam DENTRO de #profile-gate, que fica
// display:none quando você está logado — por isso "editar perfil" não aparecia
// dentro do app. Movemos ambos para o <body> para que possam ser exibidos a
// qualquer momento, independentemente do estado do gate.
(function relocateProfileModals() {
  ['profile-modal', 'pin-modal'].forEach(id => {
    const el = document.getElementById(id);
    if (el && el.parentElement && el.parentElement.id === 'profile-gate') {
      document.body.appendChild(el);
    }
  });
})();
