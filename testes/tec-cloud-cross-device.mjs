import { readFileSync } from 'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const js=read('src/js/99c-tec-cloud-ledger.js');
const build=read('build.mjs');

const checks=[
  ['usa tabela append-only dedicada',js.includes("TABLE = 'tec_resolution_events'")],
  ['identidade é perfil Study + event_id',js.includes('profile_id:pid')&&js.includes('event_id:String(ev.eventId)')],
  ['RLS é apoiada por user_id autenticado',js.includes('user_id:uid')&&js.includes('CloudStore.session.user')],
  ['cada resolução sobe imediatamente',js.includes('patchIngest()')&&js.includes('self.pushPayload(payload,res.event.eventId)')],
  ['falha de rede deixa fila durável',js.includes('tec-cloud-ledger:pendentes-v1')&&js.includes('markPending')&&js.includes('flushPending')],
  ['histórico local antigo faz backfill',js.includes('backfillLocal()')&&js.includes('rowFromLocal(ev)')],
  ['download pagina todo o histórico',js.includes('PAGE_SIZE = 1000')&&js.includes('.range(from,from+PAGE_SIZE-1)')],
  ['merge remoto preserva eventos por eventId',js.includes('rs.events[ev.eventId]')&&js.includes('R.mergeEvent')],
  ['payload restaura também Biblioteca TEC',js.includes('payload.question')&&js.includes('T.mergeInto')],
  ['estado remoto vazio antigo não pode mais sobrescrever ledger local',js.includes('protectLegacySections()')&&js.includes("'tec-realtime:eventos-v1'")&&js.includes("'tec-integracao:estado-v2'")],
  ['secoes TEC antigas nao permanecem na caixa de saida do SectionSync',js.includes('(preservar||[]).filter(sec=>!LEGACY_SECTIONS.has(sec))')&&js.includes('S._dirty&&S._dirty.delete(sec)')],
  ['modulo novo nao adiciona catches vazios',!/catch\s*\([^)]*\)\s*\{\s*\}/.test(js)&&!/.catch\(\s*\(\)\s*=>\s*\{\s*\}\s*\)/.test(js)],
  ['sync reage a foco, visibilidade e retorno da rede',js.includes("addEventListener('focus'")&&js.includes("addEventListener('online'")&&js.includes('visibilitychange')],
  ['há assinatura realtime entre dispositivos',js.includes('postgres_changes')&&js.includes('table:TABLE')],
  ['estado da sincronização fica auditável',js.includes('window.TecCloudLedger=C')&&js.includes('status()')&&js.includes('lastSyncAt')&&js.includes('lastError')],
  ['build carrega ledger depois das guardas',build.includes("'js/99b-tec-lacunas-guardas.js','js/99c-tec-cloud-ledger.js'")],
  ['não usa senha/cookie/token do TEC',!/chrome\.cookies|document\.cookie|password|bearer/i.test(js)]
];
const bad=checks.filter(([,ok])=>!ok);
if(bad.length){for(const [name] of bad)console.error('FALHOU:',name);process.exit(1);}
console.log(`TEC CLOUD CROSS-DEVICE: ${checks.length}/${checks.length} contratos válidos.`);
