#!/usr/bin/env node
import fs from 'node:fs';
import assert from 'node:assert/strict';

const gov = fs.readFileSync('src/js/58-extras-governanca.js','utf8');
const tec = fs.readFileSync('src/js/59-tec-premium.js','utf8');
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
tem(gov, "e.status === 'concluida' || e.origemPlano.veredito", 'fechamento precisa ser reconhecido');
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

// TEC: parâmetros órfãos e carga sob demanda.
tem(tec, "this._tpAnalysisDirty=true", 'análise oculta deve virar lazy/dirty em vez de render imediato');
tem(tec, "medir('motor'", 'o tempo do Motor precisa ser instrumentado como o das demais abas');
tem(tec, 'auditoriaParametros()', 'TEC precisa auditar cobertura dos parâmetros');
tem(tec, 'MotorSugestao.DEFAULTS', 'a auditoria de parâmetros tem de sair dos padrões do próprio motor');
/* ── O MARCADOR DO SHELL NAO PODE SER O TEXTO QUE ELE EXIBE ────────────────
   Esta linha procurava a string 'CENTRAL DE DESEMPENHO' — o rotulo maiusculo
   que a faixa mostrava. O que ela quer garantir e que o shell operacional do
   TEC EXISTE, e para isso o rotulo era so um marcador conveniente: qualquer
   ajuste de copy derrubava a checagem sem que nada estrutural mudasse.

   E o rotulo mudou por um motivo: a faixa repetia "retratos no escopo" e
   "retratos salvos", que o cartao "Escopo da analise" logo abaixo ja mostra,
   e trazia auditoria de parametros e um cronometro em milissegundos como se
   fossem metrica de estudo. Ela passou a responder o que so ela pode — em que
   aba voce esta, QUAL MODELO decide a fila agora, e se o retrato esta vencido.

   Agora o teste olha a estrutura (a faixa e a funcao que a garante) e, de
   quebra, exige a informacao nova: e mais forte do que era, nao menos. */
tem(tec, "box.className='tp-command'", 'TEC precisa do shell operacional (faixa tp-command)');
tem(tec, 'garantirComando()', 'o shell precisa ser garantido em um lugar so');
tem(tec, 'fonteAtual()', 'o shell precisa dizer qual modelo decide a fila agora');

// UX responsiva e janela modal independente.
tem(css, '.rg-overlay', 'histórico/configuração precisam de modal independente');
tem(css, '@media(max-width:560px)', 'governança precisa responder no mobile');

console.log('OK: contratos de governança premium, lei seca e Desempenho TEC presentes.');
