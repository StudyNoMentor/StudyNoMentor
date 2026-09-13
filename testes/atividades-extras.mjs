#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Contrato operacional do Extra, execução curta e agenda automática do Plano.
const js=readFileSync('src/js/47-tela-extras.js','utf8'), scope=readFileSync('src/js/51a-tec-scope-consistency.js','utf8'), agenda=readFileSync('src/js/51b-reforco-agenda-auto.js','utf8'), plano=readFileSync('src/js/51-tela-desempenho-tec.js','utf8'), css=readFileSync('src/css/08-ux-v49.css','utf8'), html=readFileSync('src/html/05-corpo-cont.html','utf8');
const a=(c,m)=>{if(!c){console.error('FALHA:',m);process.exit(1)}};
a(js.includes('_planoRefOperacional()'),'sem referência operacional');a(js.includes('DesempenhoTecScreen.aggregate(snaps)'),'não agrega histórico integral');a(!js.includes('DB.toggleExtraData(b.dataset.cursoDia'),'Ver hoje ainda altera datas');a(js.includes('>Ver hoje</button>'),'Ver hoje ausente');a(js.includes("title:'Concluir antes da meta?'"),'conclusão precoce sem confirmação');a(js.includes('_progressoNoPeriodo(x, day)'),'histórico usa período atual');a(js.includes('exd-num exd-min'),'minutos ausentes');a(js.includes('DB.addExtraProgress(id, q, min,'),'minutos não gravados');a(js.includes("label: 'Minutos (opcional)'"),'edição apaga minutos');a(js.includes('new Set([dia,'),'ocorrência calculada não entra no seletor');a(js.includes('if (temHistoricoNoDia || foiConcluidaNoDia) return true;'),'histórico recorrente pode sumir após editar agenda');a(js.includes('totalMin.toLocaleString'),'minutos registrados não ficam visíveis no cartão');a(js.includes("ReforcoEngine.norm(x.disciplina || '') + ReforcoEngine.SEP"),'homônimos não protegidos');a((js.match(/setAttribute\('aria-checked'/g)||[]).length>=2,'aria switch');a(js.includes('O início da recorrência não pode ser depois do fim'),'intervalo inválido aceito');a(css.includes('FILA OPERACIONAL PROFISSIONAL')&&css.includes('.exc-btn')&&css.includes('.exc-kpi'),'visual compacto ausente');a(html.includes('A agenda organiza o dia; o painel acompanha o que continua em aberto.'),'copy não enxugada');

// Execução realista do Plano: quatro moedas diferentes, sem transformar custo em tarefa.
a(scope.includes('MAX_CICLO = 30'),'ciclo operacional sem teto');a(scope.includes('MAX_SESSAO = 15'),'sessão sem teto');a(scope.includes('custoEstimadoQ'),'custo estimado não foi separado da meta');a(scope.includes('metaCicloQ'),'meta do ciclo ausente');a(scope.includes('metaSessaoQ'),'meta de sessão ausente');a(scope.includes('qMedirAlvo'),'amostra estatística não está separada');a(scope.includes('Não vira a meta da atividade'),'custo ainda se apresenta como alvo');a(scope.includes('disciplinas.size < 3'),'rodízio inicial não limita a três disciplinas');a(scope.includes('if (disciplinas.has(d)) continue'),'rodízio inicial pode selecionar dois tópicos da mesma disciplina');a(scope.includes('o que você registra hoje soma neste ciclo'),'Extra ainda parece duplicar tarefa');a(scope.includes('Number(e.alvo) <= MAX_CICLO * 4'),'migração de alvo legado não limita anomalias');a(scope.includes('if (feito > 0) return'),'migração de alvo legado não preserva ciclo iniciado');a(plano.includes('alvoTop && alvoTop.metaCicloQ'),'criação direta do Plano não usa meta operacional');

// Agenda automática: invariantes estruturais que não podem regredir.
a(agenda.includes('MAX_POR_DIA = 3'),'agenda não limita reforços do dia');
a(agenda.includes('JANELA_AGRUPAR_DIAS = 2'),'agenda não possui janela de agrupamento');
a(agenda.includes('setConcluidaDiaComSessao'),'checkbox diário ainda pode concluir o ciclo inteiro');
a(agenda.includes('finalizarCiclo'),'não existe encerramento explícito do ciclo-pai');
a(agenda.includes("estado: on ? 'concluida' : 'planejada'"),'sessão não tem estado próprio');
a(agenda.includes('sessão perdida não vira dívida vencida') || agenda.includes('sessão perdida não vira dívida'),'agenda não documenta realocação de sessão perdida');
a(agenda.includes('ev.stopPropagation()'),'controle diário não intercepta a conclusão global legada');

// Teste comportamental do planejador puro e da semântica sessão != ciclo.
const HOJE='2026-09-13';
let banco=[{
  id:'p1', titulo:'Reforçar T1', tipo:'questoes', disciplina:'Disc A', unidade:'questoes',
  alvo:25, periodo:'unica', progresso:8, status:'ativa', datas:[HOJE], concluidasEm:[],
  historico:[{data:HOJE,quantidade:8,minutos:10}],
  origemPlano:{topico:'T1',disciplina:'Disc A',metaCicloQ:25,metaSessaoQ:15,
    agendaAuto:{versao:1,sessoes:{[HOJE]:{alvo:13,estado:'planejada'}}}}
}];
let chamadasGlobais=0;
const DBfake={
  getExtras:()=>banco,
  saveExtras:(l)=>{banco=l;},
  getExtra:(id)=>banco.find(x=>x.id===id)||null,
  setConcluidaDia:(id,dia,on)=>{chamadasGlobais++;const e=banco.find(x=>x.id===id);if(e)e.status=on?'concluida':'ativa';return e;},
  extraConcluidaEm:(e)=>e.status==='concluida',
  addExtraProgress:(id,q,min,opts)=>{const e=banco.find(x=>x.id===id);e.progresso+=Number(q)||0;e.historico.push({data:(opts&&opts.data)||HOJE,quantidade:Number(q)||0,minutos:Number(min)||0});if(e.progresso>=e.alvo)e.status='concluida';return e;},
  undoExtraProgressDay:()=>null,
  undoExtraProgress:()=>null
};
const contexto={DB:DBfake,ExtrasScreen:{_planoRefCard:null},todayLocal:()=>HOJE,console,Date,Intl};
vm.createContext(contexto);
vm.runInContext(agenda,contexto,{filename:'51b-reforco-agenda-auto.js'});
const A=contexto.ReforcoAgendaAuto;
a(A&&A.maxPorDia===3&&A.maxSessao===15,'API da agenda automática não subiu');
a(JSON.stringify([...A.dividir(17)])===JSON.stringify([9,8]),'17q não foi balanceado em 9+8');
a(JSON.stringify([...A.dividir(25)])===JSON.stringify([13,12]),'25q não foi balanceado em 13+12');
a(A.dividir(31).every(n=>n<=15),'sessão passou de 15q');

const mod=A.planejarModelo([
  {id:'a',disciplina:'A',restante:25},
  {id:'b',disciplina:'B',restante:25},
  {id:'c',disciplina:'C',restante:25},
  {id:'d',disciplina:'D',restante:25}
],HOJE);
Object.entries(mod.ocupacao).forEach(([dia,itens])=>{
  a(itens.length<=3,`mais de 3 reforços em ${dia}`);
  a(new Set(itens.map(x=>x.id)).size===itens.length,`mesma frente repetida em ${dia}`);
  a(new Set(itens.map(x=>String(x.disciplina).toLowerCase())).size===itens.length,`disciplina repetida em ${dia}`);
});
['a','b','c','d'].forEach(id=>{
  const ss=mod.porId[id]||[];
  a(ss.reduce((n,s)=>n+s.alvo,0)===25,`planejamento perdeu questões de ${id}`);
  a(ss.every(s=>s.alvo<=15),`bloco de ${id} passou do teto`);
  a(new Set(ss.map(s=>s.data)).size===ss.length,`mesma frente ${id} repetiu no mesmo dia`);
});
a((mod.porDia[HOJE]||[]).length===3,'primeiro dia não recebeu o rodízio de 3 disciplinas');

// Caso relatado pelo usuário: 8/25 feitos, fecha a sessão parcial de 13.
// O pai DEVE ficar ativo e as 17 restantes devem virar 9+8 nos dias seguintes.
contexto.DB.setConcluidaDia('p1',HOJE,true);
const p=banco[0];
a(p.status==='ativa','fechar sessão parcial encerrou o ciclo-pai');
a(chamadasGlobais===0,'sessão parcial caiu no encerramento global legado');
a((p.concluidasEm||[]).includes(HOJE),'sessão concluída não ficou registrada no dia');
const futuras=Object.entries(p.origemPlano.agendaAuto.sessoes).filter(([d,s])=>d>HOJE&&s.estado==='planejada').map(([,s])=>s.alvo);
a(JSON.stringify(futuras)===JSON.stringify([9,8]),'restante 17q não foi redistribuído em 9+8');
a(futuras.reduce((x,y)=>x+y,0)===17,'replanejamento não preservou exatamente o restante do ciclo');

// Três frentes da MESMA disciplina precisam se espalhar, não furar a diversidade.
const mesma=A.planejarModelo([
  {id:'x1',disciplina:'Tributário',restante:10},
  {id:'x2',disciplina:'Tributário',restante:10},
  {id:'x3',disciplina:'Tributário',restante:10}
],HOJE);
a(Object.values(mesma.ocupacao).every(v=>v.length<=1),'mesma disciplina foi empilhada no mesmo dia');

console.log('OK: Atividades Extras — sessão parcial preserva o ciclo, redistribui o restante e mantém rodízio de até 3 disciplinas.');
