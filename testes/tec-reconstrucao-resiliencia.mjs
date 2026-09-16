import { readFileSync } from 'node:fs';

const retry=readFileSync(new URL('../companion/src/tec-reconstruct-resilience-v3.js',import.meta.url),'utf8');
const study=readFileSync(new URL('../companion/src/study-reconstruct-resilience-v3.js',import.meta.url),'utf8');
const runner=readFileSync(new URL('../companion/src/tec-reconstruct.js',import.meta.url),'utf8');
const manifest=JSON.parse(readFileSync(new URL('../companion/manifest.json',import.meta.url),'utf8'));

function ok(cond,msg){if(!cond)throw new Error(msg);}

const tec=manifest.content_scripts.find(row=>Array.isArray(row.js)&&row.js.includes('src/tec-reconstruct.js'));
ok(tec,'manifest não possui runner TEC');
const pressure=tec.js.indexOf('src/tec-reconstruct-backpressure-v2.js');
const resilience=tec.js.indexOf('src/tec-reconstruct-resilience-v3.js');
const core=tec.js.indexOf('src/tec-reconstruct.js');
ok(pressure>=0&&resilience>pressure&&core>resilience,'retry precisa envolver o runner depois do backpressure e antes do núcleo');

const studyMain=manifest.content_scripts.find(row=>row.world==='MAIN'&&Array.isArray(row.js)&&row.js.includes('src/study-reconstruct-ack-v2.js'));
ok(studyMain&&studyMain.js.includes('src/study-reconstruct-resilience-v3.js'),'diagnóstico de reconstrução parcial não está carregado no Study MAIN');
ok(studyMain.js.indexOf('src/study-reconstruct-resilience-v3.js')>studyMain.js.indexOf('src/study-reconstruct-ack-v2.js'),'diagnóstico v3 deve compor com o ACK v2');

ok(retry.includes('MAX_RECOVERY_ATTEMPTS = 3'),'retry por questão deve ter três novas tentativas após a tentativa original');
ok(retry.includes('recoverFailure(row)'),'não existe rotina explícita de recuperação por questão');
ok(retry.includes("message.kind === 'tec-reconstruct-batch'"),'retry não intercepta o lote antes da persistência');
ok(retry.indexOf('recoverFailure(row)')<retry.indexOf('underlyingSend({ ...message, rows:nextRows })'),'linha com falha pode ser persistida antes de esgotar retries');
ok(retry.includes('unresolvedFailures'),'falhas definitivas não são mantidas em memória durante o job');
ok(retry.includes('failedQuestionIds'),'resumo final não carrega IDs das questões que continuaram falhando');
ok(retry.includes('retryErrors'),'motivos de cada tentativa não são preservados');
ok(retry.includes('summary.incomplete = unresolvedFailures.size > 0'),'resumo não marca reconstrução incompleta');
ok(retry.includes("source:'tec-caderno-retry-v3'"),'questão recuperada não registra proveniência do retry');

ok(study.includes('Reconstrução parcial'),'UI não diferencia reconstrução parcial de sucesso total');
ok(study.includes('failureDetails'),'motivos das falhas não são persistidos para diagnóstico posterior');
ok(study.includes('failedQuestionIds'),'IDs das falhas não são persistidos no gerenciamento do caderno');
ok(study.includes('recuperada(s) automaticamente após retry'),'UI não informa recuperação automática bem-sucedida');

// Contrato legado que motivou esta proteção: o núcleo ainda converte a exceção
// de uma questão em row.question=null. O wrapper v3 precisa continuar cobrindo-o.
ok(runner.includes('question:null, history:null'),'runner deixou de expor a linha de falha esperada pelo guard v3');
ok(runner.includes('summary.failedQuestions++'),'runner deixou de contabilizar falha individual para reconciliação do guard v3');

console.log('TEC RECONSTRUÇÃO RESILIÊNCIA V3 OK — retry individual antes do ACK, diagnóstico persistente e estado parcial explícito.');
