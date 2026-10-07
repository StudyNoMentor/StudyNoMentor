/* "✨ Sugerir grade" no app real + sessões da grade preenchidas pelos
   registros de estudo da semana. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { extname, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT=dirname(dirname(fileURLToPath(import.meta.url)));
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8'};
const server=createServer((req,res)=>{const raw=(req.url||'/').split('?')[0],name=raw==='/'?'/index.html':raw;try{const body=readFileSync(join(ROOT,decodeURIComponent(name).replace(/^\/+/,'')));res.writeHead(200,{'Content-Type':MIME[extname(name)]||'application/octet-stream'});res.end(body);}catch{res.writeHead(404).end('nao encontrado');}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {});
const page=await browser.newPage({viewport:{width:412,height:900},timezoneId:'America/Fortaleza'});
// Terça à noite no Brasil, já quarta em UTC: datas da grade são locais.
await page.clock.setFixedTime(new Date('2026-10-06T23:30:00-03:00'));
const erros=[];page.on('pageerror',e=>erros.push(e.message));
let n=0;const ok=(v,m)=>{n++;assert.ok(v,m);};
try{
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html`,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.switchScreen&&window.GradeGerador&&window.GradeGerador.abrir&&window.GradeScreen&&GradeScreen.progresso,{timeout:30000});
  const r=await page.evaluate(async()=>{
    try{ProfileUI.hideGate();}catch(_){}
    const M=[['Direito Tributário',180],['Contabilidade Geral',120],['Direito Civil',60],['Estatística Básica',60]];
    M.forEach(([x])=>DB.upsertSubjectName(x));
    const iso=d=>d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
    const h=new Date(),ini=new Date(h.getFullYear(),h.getMonth(),h.getDate()-((h.getDay()+6)%7)),fim=new Date(ini.getFullYear(),ini.getMonth(),ini.getDate()+6);
    DB.saveCurrentCycle({startDate:iso(ini),endDate:iso(fim),weeklyHours:7,mode:'pre',subjects:M.map(([nome,m])=>({nome,definidoMin:m,sugeridoMin:m})),grade:{},sessions:3});
    // grade anterior: deve ir para "Grades salvas" ao aplicar
    DB.saveGradeTemplate({grade:{Segunda:[{subject:'Direito Civil',minutes:60,done:false}]},sessions:1});
    switchScreen('grade');
    const out={};
    // ⚙ Opções → Prioridades e cálculo: nada vem marcado sozinho
    document.getElementById('grade-gear-btn').click();
    document.getElementById('btn-grade-prioridades').click();
    await new Promise(r=>setTimeout(r,100));
    const gp=document.getElementById('grade-prioridades-modal');
    out.gpAberto=getComputedStyle(gp).display!=='none';
    out.gpInicial=[...gp.querySelectorAll('[data-gp-calc],[data-gp-pri]')].some(x=>x.checked);
    document.getElementById('gp-sugerir-calc').click();
    out.gpSugestao=[...gp.querySelectorAll('[data-gp-calc]')].map(x=>x.checked);
    const pDT=gp.querySelector('[data-gp-pri="0"]');pDT.checked=true;pDT.dispatchEvent(new Event('change',{bubbles:true}));
    out.gpResumo=document.getElementById('gp-resumo').textContent;
    document.getElementById('gp-ok').click();
    document.getElementById('btn-grade-sugerir').click();
    await new Promise(r=>setTimeout(r,100));
    out.aberto=getComputedStyle(document.getElementById('grade-gerador-modal')).display!=='none';
    out.materias=document.querySelectorAll('#gg-mats .gg-mat').length;
    out.calcPalpite=[...document.querySelectorAll('[data-mat-calc]')].map(x=>x.checked);
    out.priHerdada=document.querySelector('[data-mat-pri="0"]').checked;
    out.prev=document.querySelectorAll('#gg-prev .gg-cel').length;
    out.overflow=document.querySelector('#grade-gerador-modal .siglas-modal-box').scrollWidth-document.querySelector('#grade-gerador-modal .siglas-modal-box').clientWidth;
    UI.confirm=()=>Promise.resolve(true);
    const salvasAntes=DB.getSavedGrades().length;
    document.getElementById('gg-aplicar').click();
    await new Promise(r=>setTimeout(r,200));
    const t=DB.getGradeTemplate(),cel=[];
    Object.keys(t.grade).forEach(d=>(t.grade[d]||[]).forEach((c,i)=>{if(c)cel.push({d,i,s:c.subject,m:c.minutes});}));
    out.celulas=cel;out.salvas=DB.getSavedGrades().length-salvasAntes;
    out.primeiroDT=cel.filter(c=>c.s==='Direito Tributário').every(c=>c.i===0);
    out.prefs=!!localStorage.getItem(DB._profilePrefix()+'p:'+DB._activePlanId()+':grade-gerador');
    // registros da semana preenchem a grade
    const dt=cel.filter(c=>c.s==='Direito Tributário');
    DB.saveEntry({id:'e1',date:iso(ini),subject:'Direito Tributário',durationMin:90,method:'Teoria'});
    GradeScreen.render();await new Promise(r=>setTimeout(r,100));
    // com grade montada, a tela abre no Acompanhar (painel de missões)
    out.modoPadrao=GradeScreen.modo();
    out.painel=!!document.querySelector('#ciclo-grade .gp .gp-resumo')&&document.querySelectorAll('#ciclo-grade .gp-dia').length===7;
    GradeScreen.setView('semana');await new Promise(r=>setTimeout(r,100));
    const p=GradeScreen.progresso().mapa;
    out.prog=dt.map(c=>p[c.d+'|'+c.i]);
    const chips=[...document.querySelectorAll('.grade-cell-drop .subject-chip[data-subject="Direito Tributário"]')];
    out.autoDone=chips.filter(x=>x.classList.contains('auto-done')).length;
    out.parcial=chips.filter(x=>x.classList.contains('parcial')).length;
    // atalho: registrar a partir da sessão
    GradeScreen.registrarSessao('Contabilidade Geral',60);
    await new Promise(r=>setTimeout(r,300));
    out.reg={s:(document.getElementById('subject')||{}).value,h:(document.getElementById('duration-h')||{}).value,m:(document.getElementById('duration-m')||{}).value};
    // painel: o registro cobre primeiro a sessão mais antiga; o ✓ manual de
    // outra semana não vale nesta
    const D=['Segunda','Terça','Quarta','Quinta','Sexta','Sábado','Domingo'];
    const g={};D.forEach(d=>g[d]=['']);
    g.Segunda=[{subject:'Direito Civil',minutes:60,done:false}];
    g.Quarta=[{subject:'Direito Civil',minutes:60,done:false}];
    g.Sexta=[{subject:'Estatística Básica',minutes:60,done:true,doneWeek:'2000-01-03'}];
    g.Sábado=[{subject:'Estatística Básica',minutes:60,done:false}];
    DB.saveGradeTemplate({grade:g,sessions:1});
    const qua=new Date(ini.getFullYear(),ini.getMonth(),ini.getDate()+2);
    DB.saveEntry({id:'e2',date:iso(qua),subject:'Direito Civil',durationMin:60,method:'Teoria'});
    const m2=GradeScreen.progresso().mapa;
    out.maisAntiga={seg:m2['Segunda|0'].completo,qua:m2['Quarta|0'].completo};
    GradeScreen.setView('painel');await new Promise(r=>setTimeout(r,100));
    // A escolha sobrevive à navegação e ao formato reidratado da conta.
    switchScreen('registrar'); switchScreen('grade');
    out.preferenciaPainel=GradeScreen.modo()==='painel';
    const key=DB._profilePrefix()+'pref-grade-view';
    out.preferenciaPersistida=JSON.parse(localStorage.getItem(key))==='painel';
    DB.setRaw(key,JSON.stringify('semana')); GradeScreen.render();
    out.preferenciaMontar=GradeScreen.modo()==='semana';
    DB.setRaw(key,'painel'); GradeScreen.render();
    out.preferenciaLegada=GradeScreen.modo()==='painel';
    out.semProxima=!document.querySelector('#ciclo-grade .gp-proxima');
    const sel=d=>document.querySelector('#ciclo-grade [data-gp-dia="'+iso(d)+'"]');
    const sex=new Date(ini.getFullYear(),ini.getMonth(),ini.getDate()+4);
    sel(sex).click();await new Promise(r=>setTimeout(r,60));
    out.velhaSemana=document.querySelectorAll('#ciclo-grade .gp-missoes .gp-m.st-feita').length;
    // ✓ pelo painel grava a semana atual e conta como feita
    document.querySelector('#ciclo-grade .gp-missoes [data-gp-check]').click();await new Promise(r=>setTimeout(r,60));
    const c=DB.getGradeTemplate().grade.Sexta[0];
    out.marcou={done:c.done,semana:c.doneWeek===GradeScreen.progresso().ini,feitas:document.querySelectorAll('#ciclo-grade .gp-missoes .gp-m.st-feita').length};
    // ▶ Registrar abre o formulário com o que falta da missão
    sel(qua).click();await new Promise(r=>setTimeout(r,60));
    sel(new Date(ini.getFullYear(),ini.getMonth(),ini.getDate()+5)).click();await new Promise(r=>setTimeout(r,60));
    document.querySelector('#ciclo-grade .gp-missoes [data-gp-reg]').click();
    await new Promise(r=>setTimeout(r,300));
    out.regPainel={s:(document.getElementById('subject')||{}).value,h:(document.getElementById('duration-h')||{}).value};
    // grade vazia: o Acompanhar mostra o convite para montar
    DB.saveGradeTemplate({grade:{},sessions:1});localStorage.removeItem(DB._profilePrefix()+'pref-grade-view');
    out.modoVazio=GradeScreen.modo();
    GradeScreen.setView('painel');await new Promise(r=>setTimeout(r,60));
    out.vazio=!!document.querySelector('#ciclo-grade .gp-vazio [data-gp-acao="montar"]');
    return out;
  });
  // Recuperar a sessão de segunda na terça preserva a data nas duas telas.
  const datas=await page.evaluate(async()=>{
    const out={}, esperar=()=>new Promise(r=>setTimeout(r,100));
    DB.upsertSubjectName('Vendas');
    DB.saveGradeTemplate({grade:{
      Segunda:[{subject:'Vendas',minutes:60,done:false}],
      Terça:[{subject:'Vendas',minutes:60,done:false}]
    },sessions:1});
    const semana=GradeScreen.progresso();
    out.segunda=semana.dias.find(d=>d.dia==='Segunda').iso;
    GradeScreen.setView('semana');switchScreen('grade');await esperar();
    document.querySelector('.grade-cell-drop[data-dia="Segunda"] .chip-acronym-label').click();
    document.querySelector('[data-registrar]').click();await esperar();
    out.montar=document.getElementById('date').value;
    DB.saveEntry({id:'grade-data-segunda',date:out.montar,subject:'Vendas',durationMin:60,method:'Teoria'});
    const progresso=GradeScreen.progresso().mapa;
    out.progresso={segunda:progresso['Segunda|0'].completo,terca:progresso['Terça|0'].completo};
    DB.deleteEntry('grade-data-segunda');
    GradeScreen.setView('painel');switchScreen('grade');await esperar();
    document.querySelector('[data-gp-dia="'+out.segunda+'"]').click();
    document.querySelector('.gp-missoes [data-gp-reg]').click();await esperar();
    out.acompanhar=document.getElementById('date').value;
    // A seção de atrasadas também deve abrir segunda, sem trocar para hoje.
    switchScreen('grade');await esperar();
    document.querySelector('[data-gp-dia="2026-10-06"]').click();
    document.querySelector('.gp-atrasadas [data-gp-reg]').click();await esperar();
    out.atrasada=document.getElementById('date').value;
    out.dias=[];
    for(const d of semana.dias){
      GradeScreen.registrarSessao('Vendas',60,d.dia);await esperar();
      out.dias.push(document.getElementById('date').value===d.iso);
    }
    GradeScreen.registrarSessao('Vendas',60);await esperar();
    out.hoje=document.getElementById('date').value;
    return out;
  });
  ok(datas.segunda==='2026-10-05'&&datas.montar===datas.segunda&&datas.acompanhar===datas.segunda&&datas.atrasada===datas.segunda,'Montar, Acompanhar e atrasadas preservam a data da sessão selecionada');
  ok(datas.progresso.segunda&&!datas.progresso.terca,'registro da sessão de segunda conclui segunda e mantém terça pendente');
  ok(datas.dias.every(Boolean)&&datas.hoje==='2026-10-06','sete dias da semana e atalho sem sessão usam datas locais, mesmo após a virada UTC');
  // Um registro já salvo na terça deve preencher segunda sem alterar sua data.
  const ordem=await page.evaluate(async()=>{
    const out={}, esperar=()=>new Promise(r=>setTimeout(r,100));
    const grade={
      Segunda:[{subject:'Vendas',minutes:60,done:false},{subject:'Vendas',minutes:60,done:false}],
      Terça:[{subject:'Vendas',minutes:60,done:false},{subject:'Outra matéria',minutes:60,done:false}]
    };
    const salvar=min=>DB.getEntry('grade-ordem')
      ? DB.updateEntry('grade-ordem',{durationMin:min})
      : DB.saveEntry({id:'grade-ordem',date:'2026-10-06',subject:'Vendas',durationMin:min,method:'Teoria'});
    const minutos=()=>{const p=GradeScreen.progresso().mapa;return [p['Segunda|0'].feito,p['Segunda|1'].feito,p['Terça|0'].feito,p['Terça|1'].feito];};
    DB.saveGradeTemplate({grade,sessions:2});
    salvar(60);out.antigo=minutos();
    out.data=DB.getEntries().find(e=>e.id==='grade-ordem').date;
    GradeScreen.setView('semana');switchScreen('grade');await esperar();
    out.chips=[...document.querySelectorAll('.grade-cell-drop .subject-chip.auto-done')].map(c=>c.closest('.grade-cell-drop').dataset.dia);
    GradeScreen.setView('painel');await esperar();
    document.querySelector('[data-gp-dia="2026-10-05"]').click();await esperar();
    out.painelSegunda=document.querySelectorAll('.gp-missoes .gp-m.st-feita').length;
    document.querySelector('[data-gp-dia="2026-10-06"]').click();await esperar();
    out.painelTerca=document.querySelectorAll('.gp-missoes .gp-m.st-feita').length;
    salvar(90);out.parcial=minutos();
    salvar(150);out.seguinte=minutos();
    DB.saveEntry({id:'grade-fora-semana',date:'2026-09-29',subject:'Vendas',durationMin:600});
    out.foraSemana=minutos();DB.deleteEntry('grade-fora-semana');
    DB.deleteEntry('grade-ordem');out.excluido=minutos();
    grade.Segunda[0].done=true;grade.Segunda[0].doneWeek=GradeScreen.progresso().ini;
    DB.saveGradeTemplate({grade,sessions:2});salvar(90);out.manual=minutos();
    grade.Segunda[0].doneWeek='2000-01-03';
    DB.saveGradeTemplate({grade,sessions:2});out.manualOutraSemana=minutos();
    DB.deleteEntry('grade-ordem');
    return out;
  });
  ok(ordem.antigo.join()==='60,0,0,0'&&ordem.data==='2026-10-06','registro já salvo na terça preenche a primeira sessão de segunda sem mudar a data');
  ok(ordem.chips.join()==='Segunda'&&ordem.painelSegunda===1&&ordem.painelTerca===0,'Montar e Acompanhar mostram a mesma sessão mais antiga concluída');
  ok(ordem.parcial.join()==='60,30,0,0'&&ordem.seguinte.join()==='60,60,30,0','sessões do mesmo dia precedem as seguintes, com saldo parcial e isolamento por matéria: '+JSON.stringify(ordem));
  ok(ordem.foraSemana.join()===ordem.seguinte.join()&&ordem.excluido.every(x=>x===0),'registros de outra semana não contam e excluir o registro recalcula o progresso');
  ok(ordem.manual.join()==='0,60,30,0'&&ordem.manualOutraSemana.join()==='60,30,0,0','pula sessão marcada manualmente nesta semana; marca antiga não impede preencher a mais antiga');
  const livre=await page.evaluate(async()=>{
    const out={}, esperar=()=>new Promise(r=>setTimeout(r,100));
    DB.upsertSubjectName('Marcação livre');
    DB.saveGradeTemplate({grade:{Segunda:[{subject:'Marcação livre',minutes:60,done:false}],Terça:[{subject:'Marcação livre',minutes:60,done:false}]},sessions:1});
    DB.saveEntry({id:'grade-livre',date:'2026-10-06',subject:'Marcação livre',durationMin:60});
    GradeScreen.setView('semana');switchScreen('grade');await esperar();
    const chip=()=>document.querySelector('.grade-cell-drop[data-dia="Segunda"] .subject-chip');
    out.autoInicial=chip().classList.contains('auto-done');
    out.botaoLote=!document.getElementById('btn-uncheck-all').disabled;
    chip().querySelector('.chip-done-toggle').click();await esperar();
    const p=GradeScreen.progresso().mapa;
    out.desmarcou=!chip().classList.contains('done')&&!p['Segunda|0'].completo&&!p['Terça|0'].completo;
    out.semana=DB.getGradeTemplate().grade.Segunda[0].uncheckedWeek===GradeScreen.progresso().ini;
    // Reidratação do modelo e navegação precisam respeitar a decisão salva.
    DB.saveGradeTemplate(JSON.parse(JSON.stringify(DB.getGradeTemplate())));
    switchScreen('registrar');switchScreen('grade');await esperar();
    out.persistiu=!chip().classList.contains('done');
    GradeScreen.setView('painel');await esperar();
    document.querySelector('[data-gp-dia="2026-10-05"]').click();await esperar();
    out.painelAberto=document.querySelector('.gp-missoes [data-gp-check]').getAttribute('aria-pressed')==='false';
    document.querySelector('.gp-missoes [data-gp-check]').click();await esperar();
    out.remarcou=document.querySelector('.gp-missoes [data-gp-check]').getAttribute('aria-pressed')==='true';
    out.naoDuplicou=GradeScreen.progresso().mapa['Terça|0'].feito===0;
    document.querySelector('.gp-missoes [data-gp-check]').click();await esperar();
    out.desmarcouPainel=document.querySelector('.gp-missoes [data-gp-check]').getAttribute('aria-pressed')==='false';
    // Uma escolha da semana anterior não bloqueia a conclusão desta semana.
    const t=DB.getGradeTemplate();t.grade.Segunda[0].uncheckedWeek='2000-01-03';DB.saveGradeTemplate(t);
    GradeScreen.render();await esperar();
    out.expirou=GradeScreen.progresso().mapa['Segunda|0'].completo;
    const backup=window.CloudBackup&&CloudBackup.protegerAgora;
    if(window.CloudBackup) CloudBackup.protegerAgora=async()=>{};
    document.getElementById('btn-uncheck-all').click();await esperar();
    if(window.CloudBackup) CloudBackup.protegerAgora=backup;
    out.lote=!GradeScreen.progresso().mapa['Segunda|0'].completo&&!document.querySelector('.gp-missoes .st-feita');
    document.querySelector('[data-gp-dia="2026-10-06"]').click();await esperar();
    document.querySelector('.gp-missoes [data-gp-check]').click();await esperar();
    out.manual=document.querySelector('.gp-missoes [data-gp-check]').getAttribute('aria-pressed')==='true';
    document.querySelector('.gp-missoes [data-gp-check]').click();await esperar();
    out.manualDesmarcada=document.querySelector('.gp-missoes [data-gp-check]').getAttribute('aria-pressed')==='false';
    out.registro=DB.getEntry('grade-livre').date==='2026-10-06'&&DB.getEntry('grade-livre').durationMin===60;
    DB.deleteEntry('grade-livre');
    return out;
  });
  ok(livre.autoInicial&&livre.desmarcou&&livre.semana&&livre.persistiu,'desmarca conclusão automática em Montar e respeita a escolha salva após reidratar e navegar');
  ok(livre.painelAberto&&livre.remarcou&&livre.naoDuplicou&&livre.desmarcouPainel,'Acompanhar permite remarcar e desmarcar sem duplicar minutos na próxima sessão');
  ok(livre.botaoLote&&livre.lote,'Desmarcar concluídos também inclui as sessões automáticas');
  ok(livre.expirou&&livre.manual&&livre.manualDesmarcada&&livre.registro,'override vale somente nesta semana; marcar/desmarcar sessões manuais preserva o registro original');
  // Limites por disciplina no app real: aplicação, persistência e isolamento.
  const limites=await page.evaluate(async()=>{
    const out={}, plano=DB._activePlanId();
    DB.saveCurrentCycle({subjects:[{nome:'Contabilidade Geral',definidoMin:360},{nome:'Direito Civil',definidoMin:180}]});
    const el=s=>document.querySelector(s);
    const set=(s,v)=>{el(s).value=v;el(s).dispatchEvent(new Event('input',{bubbles:true}));};
    GradeGerador.abrir();
    set('[data-mat-sess-min="0"]','120');set('[data-mat-sess-max="0"]','120');
    set('[data-mat-sess-min="1"]','60');set('[data-mat-sess-max="1"]','60');
    out.valido=!el('#gg-aplicar').disabled;
    out.overflow=el('#grade-gerador-modal .siglas-modal-box').scrollWidth-el('#grade-gerador-modal .siglas-modal-box').clientWidth;
    set('[data-mat-sess-max="0"]','60');
    out.invertido=el('#gg-aplicar').disabled&&el('[data-mat-sess-min="0"]').getAttribute('aria-invalid')==='true';
    set('[data-mat-sess-max="0"]','125');set('[data-mat-sess-min="0"]','121');
    out.passo=el('#gg-aplicar').disabled;
    set('[data-mat-sess-min="0"]','120');set('[data-mat-sess-max="0"]','120');
    set('#gg-min','180');set('#gg-max','120');
    out.padraoInvertido=el('#gg-aplicar').disabled;
    set('#gg-min','');out.padraoVazio=el('#gg-aplicar').disabled;
    set('#gg-min','60');
    GradeGerador.fechar();GradeGerador.abrir();
    out.reabriu=el('[data-mat-sess-min="0"]').value==='120'&&el('[data-mat-sess-max="1"]').value==='60';
    GradeGerador.fechar();GradeGerador.abrirPrioridades();
    el('#gp-limpar').click();el('#gp-ok').click();GradeGerador.abrir();
    out.prioridadesPreservam=el('[data-mat-sess-min="0"]').value==='120';
    el('#gg-aplicar').click();await new Promise(r=>setTimeout(r,150));
    out.celulas=Object.values(DB.getGradeTemplate().grade).flat().filter(Boolean);
    const outro=PlanManager.createPlan({nome:'Teste limites separado',tipo:'Pré-edital'});
    PlanManager.setActivePlan(outro);
    DB.saveCurrentCycle({subjects:[{nome:'Contabilidade Geral',definidoMin:360}]});
    GradeGerador.abrir();out.outroPlano=el('[data-mat-sess-min="0"]').value==='';GradeGerador.fechar();
    PlanManager.setActivePlan(plano);GradeGerador.abrir();
    out.voltou=el('[data-mat-sess-min="0"]').value==='120';
    set('[data-mat-sess-min="0"]','');set('[data-mat-sess-max="0"]','');set('#gg-min','90');
    out.herda=el('[data-mat-sess-min="0"]').placeholder==='90'&&!el('#gg-aplicar').disabled;
    GradeGerador.fechar();GradeGerador.abrir();
    out.limpo=el('[data-mat-sess-min="0"]').value===''&&el('[data-mat-sess-min="0"]').placeholder==='90';
    return out;
  });
  ok(limites.valido&&limites.overflow<=1,'limites individuais válidos e sem overflow mobile');
  ok(limites.invertido&&limites.passo&&limites.padraoInvertido&&limites.padraoVazio,'bloqueia limites invertidos, passo inválido e padrão vazio');
  ok(limites.reabriu&&limites.prioridadesPreservam,'limites sobrevivem à reabertura e à limpeza de prioridades');
  ok(limites.celulas.length===6&&limites.celulas.every(c=>c.minutes===(c.subject==='Contabilidade Geral'?120:60)),'aplica sessões de 2 h e 1 h na mesma grade');
  ok(limites.outroPlano&&limites.voltou,'limites isolados por planejamento');
  ok(limites.herda&&limites.limpo,'campos vazios herdam o padrão atualizado e permanecem vazios ao reabrir');
  ok(r.preferenciaPainel&&r.preferenciaPersistida&&r.preferenciaMontar&&r.preferenciaLegada,'último modo salvo, navegação e preferência reidratada/legada');
  ok(r.semProxima,'lista diária sem bloco redundante Próxima missão');
  ok(r.aberto,'janela abre pelo botão ✨ Sugerir grade');
  ok(r.materias===4,'lista as matérias do ciclo');
  ok(r.gpAberto,'Prioridades e cálculo abre pelo menu ⚙ Opções');
  ok(!r.gpInicial,'nenhuma matéria vem marcada sozinha (vale para qualquer área)');
  ok(r.gpSugestao.join()==='false,true,false,true','"Sugerir pelo nome" marca as prováveis de cálculo');
  ok(r.gpResumo.startsWith('1 prioritária')&&r.gpResumo.includes('2 de cálculo'),'resumo das marcações');
  ok(r.priHerdada&&r.calcPalpite.join()==='false,true,false,true','Sugerir grade usa as marcações das Opções');
  ok(r.prev===7,'prévia com 7 sessões (3+2+1+1)');
  ok(r.overflow<=1,'janela sem rolagem horizontal no celular');
  ok(r.celulas.length===7&&r.celulas.every(c=>c.m===60),'grade aplicada com sessões de 60 min');
  ok(r.salvas===1,'grade anterior guardada em Grades salvas');
  ok(r.primeiroDT,'prioritária no primeiro horário');
  ok(r.prefs,'preferências da janela lembradas por planejamento');
  ok(r.prog.filter(x=>x.completo).length===1&&r.prog.some(x=>x.feito===30),'90 min registrados = 1 sessão completa + 30/60 na seguinte');
  ok(r.autoDone===1&&r.parcial===1,'chips mostram concluída pelos registros e parcial');
  ok(r.reg.s==='Contabilidade Geral'&&r.reg.h==='1'&&r.reg.m==='0','Registrar estudo aberto já preenchido');
  ok(r.modoPadrao==='painel'&&r.painel,'grade montada abre no Acompanhar, com resumo e os 7 dias');
  ok(r.maisAntiga.seg&&!r.maisAntiga.qua,'registro cobre primeiro a missão mais antiga, independentemente do dia salvo');
  ok(r.velhaSemana===0,'✓ manual de outra semana não vale nesta');
  ok(r.marcou.done&&r.marcou.semana&&r.marcou.feitas===1,'✓ pelo painel marca a missão na semana atual');
  ok(r.regPainel.s==='Estatística Básica'&&r.regPainel.h==='1','▶ Registrar do painel abre o formulário preenchido');
  ok(r.modoVazio==='semana','grade vazia abre no Montar');
  ok(r.vazio,'Acompanhar sem grade convida a montar');
  ok(erros.length===0,'sem erros de página: '+erros.join(' | '));
  console.log(`GRADE GERADOR (NAVEGADOR) OK — ${n} invariantes.`);
}finally{await browser.close();server.close();}
