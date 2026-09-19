#!/usr/bin/env node
import fs from 'node:fs';
import assert from 'node:assert/strict';

const gov = fs.readFileSync('src/js/58-extras-governanca.js','utf8');
const tec = fs.readFileSync('src/js/59-tec-premium.js','utf8');
const telaTec = fs.readFileSync('src/js/51-tela-desempenho-tec.js','utf8');
const motorTec = fs.readFileSync('src/js/86-motor-sugestao.js','utf8');
const extrasMotor = fs.readFileSync('src/js/47-tela-extras.js','utf8');
const htmlTec = fs.readFileSync('src/html/05-corpo-cont.html','utf8');
const css = fs.readFileSync('src/css/11-extras-governanca.css','utf8');

const tem = (src, trecho, msg) => assert.ok(src.includes(trecho), msg || `faltou: ${trecho}`);

// Reforço: escopo explícito, política por atividade e proteção do hoje iniciado.
tem(gov, 'data-rg-id', 'configuração precisa selecionar atividades');
tem(gov, 'm.disciplinasDia=d', 'densidade deve ser gravada por reforço');
tem(gov, 'm.blocoMin=lim.min', 'faixa mínima deve ser gravada por reforço');
tem(gov, 'm.blocoMax=lim.max', 'faixa máxima deve ser gravada por reforço');
tem(gov, "cfg.escopo==='hoje-futuro'", 'deve existir escopo hoje + futuro');
tem(gov, 'ReforcoFila.feitoNoDia(e,hoje)>0', 'missão iniciada precisa ser detectada pelo progresso real do dia');
tem(gov, 'preserve.add(e.id)', 'missão iniciada/fora do escopo precisa ser preservada');
tem(gov, 'todos.every(o=>this.densidade(o.e)>=2)', 'duas frentes só podem coexistir quando ambas aceitam 2/dia');
tem(gov, 'if(m.disciplinasDia==null)m.disciplinasDia=pAntes.disciplinasDia', 'troca de padrão deve congelar reforços não selecionados');
tem(gov, 'configHistorico', 'mudanças de política precisam ficar auditáveis');

// Histórico: concluído sai do operacional e permanece consultável por completo.
tem(gov, "e.status === 'concluida' || o.veredito", 'fechamento precisa ser reconhecido');
tem(gov, "filter(e=>!self.eFechado(e))", 'Gerenciar deve esconder reforços fechados');
tem(gov, 'Execução dia a dia', 'histórico deve detalhar execução diária');
tem(gov, 'Dados de auditoria completos', 'histórico deve permitir auditoria integral');
tem(gov, 'Histórico gerenciado', 'histórico deve viver em janela separada');

// Lei seca: tempo, ritmo aprendido, limites diários e registro com minutos.
tem(gov, "modoCarga:raw.modoCarga==='tempo'?'tempo':'linhas'", 'lei seca precisa aceitar modo por tempo');
tem(gov, 'minutosSessao', 'lei seca precisa ter alvo em minutos');
tem(gov, 'linhasPorMinuto', 'lei seca precisa ter ritmo configurável');
tem(gov, 'ritmoMedido', 'lei seca precisa aprender ritmo real');
tem(gov, 'usados<p.porDia', 'redução de leis/dia precisa rebalancear o hoje');
tem(gov, 'adiadaPorLimite', 'overflow de leis deve ser reagendado, não perdido');
tem(gov, 'Registrar leitura', 'registro dedicado de leitura precisa existir');
tem(gov, 'DB.addExtraProgress(atual.id,q,m', 'registro de lei deve armazenar linhas e minutos');

// TEC: carga sob demanda sem transformar instrumentação interna em interface.
tem(tec, "this._tpAnalysisDirty=true", 'análise oculta deve virar lazy/dirty em vez de render imediato');
tem(tec, "box.className='tp-command'", 'TEC precisa do shell operacional (faixa tp-command)');
tem(tec, 'garantirComando()', 'o shell precisa ser garantido em um lugar so');
tem(tec, 'mensagemAba(tab)', 'o cabeçalho precisa mudar a mensagem conforme a natureza da aba');
tem(tec, 'Nenhum modelo opina aqui', 'Análise precisa se declarar como fato, não decisão do Motor');
tem(tec, 'Fatos da banca', 'Incidência precisa se declarar como dado factual da banca');
tem(tec, "if(tab==='motor')", 'somente a aba Motor deve explicar a lógica de prioridade');
assert.ok(!tec.includes('auditoriaParametros()'), 'auditoria de desenvolvedor não deve voltar ao cabeçalho do aluno');
assert.ok(!tec.includes("medir('motor'"), 'cronômetro interno não deve voltar a ser requisito de UX');
assert.ok(!tec.includes('data-tp-settings') || tec.includes("querySelectorAll('.tp-overlay,[data-tp-settings],[data-tp-audit]"),
  'seletor legado pode existir apenas como limpeza de DOM antigo, nunca como botão novo');
assert.ok(!tec.includes('abrirDiagnostico()'), 'modal Diagnóstico do TEC não deve ser recriado');

/* Contrato final do Motor/TEC: esta bateria é propositalmente textual e roda
   antes do navegador. Se alguém ressuscitar um legado ou trocar silenciosamente
   uma das decisões estruturais, a PR para aqui antes da suíte longa. */
tem(motorTec, 'metaAcerto: 90', 'meta de fábrica do Motor deve ser 90%');
tem(motorTec, 'maxFrentes: [1, 3]', 'rodada acionável deve ter no máximo 3 disciplinas');
tem(motorTec, '_lacuna(item, p)', 'Motor precisa calcular a distância simples até a meta');
tem(motorTec, 'minAmostra: 20', 'amostra mínima deve ser o único freio de granularidade');
tem(motorTec, 'retratoAtual()', 'Motor precisa escolher explicitamente o retrato atual do escopo');
tem(motorTec, 'DesempenhoTecScreen.scopedSnapshot()', 'Motor deve decidir pelo mesmo período/retratos selecionados na tela');
tem(motorTec, '_forestEstavel(snap)', 'Motor precisa reconstruir de forma estável a árvore do retrato atual');
tem(motorTec, 'disciplinasSel: []', 'Motor precisa de filtro persistente de disciplinas, vazio = todas');
tem(motorTec, 'lacunaDisc', 'escolha da matéria precisa usar a distância percentual até a meta');
tem(motorTec, '_incidenciaDisciplina(nome, mapa)', 'pós-edital deve usar incidência apenas como desempate');
assert.ok(!motorTec.includes('PlanoEngine.margemErro'), 'Motor simples não pode depender de Wilson/margem estatística');
assert.ok(!motorTec.includes('gapConfiavel'), 'lacuna segura não pode voltar ao Motor simples');
assert.ok(!motorTec.includes('deficitSeguro'), 'volume histórico não pode multiplicar a prioridade da matéria');
assert.ok(!motorTec.includes('MAX_IRMAOS_GRUPO'), 'agrupamento não pode voltar a um teto arbitrário de irmãos');
tem(motorTec, 'disciplinasAcionaveis', 'ranking geral e fila executável precisam permanecer separados');
tem(motorTec, 'restante >= piso', 'agrupador deve continuar criando blocos enquanto houver amostra para outra sugestão');
tem(telaTec, 'ms-disc-filter-all', 'filtro do Motor deve expor Todas as disciplinas como primeira opção');
tem(telaTec, 'lacuna p/ meta', 'cards precisam explicar a lacuna simples ao aluno');
tem(extrasMotor, 'Rodada recomendada agora', 'Puxar do Motor deve juntar as recomendações no topo');
tem(extrasMotor, 'Alternativas por matéria', 'alternativas do Puxar do Motor devem ficar agrupadas por matéria');
tem(extrasMotor, "MotorSugestao.salvar({ disciplinasSel:", 'filtro em Extras deve recalcular o Motor, não apenas esconder linhas');
tem(telaTec, '_scopeRenderTimer', 'seleção de retratos deve coalescer cliques rápidos');
tem(telaTec, 'Atualizando análise…', 'seleção de retratos precisa mostrar feedback visual');
tem(telaTec, '--tec-level-hue', 'granularidades profundas precisam conservar tom próprio');
assert.match(htmlTec, /id="motor-meta"[^>]*value="90"/, 'campo da meta deve nascer em 90%');
assert.match(htmlTec, /id="motor-amostra"[^>]*value="20"/, 'campo da amostra mínima deve nascer em 20 questões');
assert.ok(!htmlTec.includes('id="motor-margem"'), 'ajuste de margem estatística não deve voltar ao Motor simples');
assert.match(htmlTec, /id="motor-frentes"[^>]*max="3"/, 'campo de disciplinas por rodada deve limitar em 3');

// UX responsiva e janela modal independente.
tem(css, '.rg-overlay', 'histórico/configuração precisam de modal independente');
tem(css, '@media(max-width:560px)', 'governança precisa responder no mobile');

console.log('OK: contratos de governança premium, lei seca e Desempenho TEC presentes.');
