#!/usr/bin/env node
/* Auditoria destrutiva apenas dentro de um perfil efêmero do Chrome.
   Todos os dados são fictícios; o código publicado não é alterado. */
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const RAIZ = dirname(dirname(fileURLToPath(import.meta.url)));
const SAIDA = join(RAIZ, 'testes', 'resultado-stress-extras-tec.json');
const EVIDENCIAS = join(RAIZ, 'testes', 'evidencias');
const MAX_EXTRAS = Math.max(1, Number.parseInt(process.env.STRESS_EXTRAS || '2000', 10));
const zahChrome = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].find(existsSync);
if (!zahChrome) throw new Error('Chrome/Edge local não encontrado.');
mkdirSync(EVIDENCIAS, { recursive: true });

const html = readFileSync(join(RAIZ, 'index.html'));
const supabase = readFileSync(join(RAIZ, 'node_modules', '@supabase', 'supabase-js', 'dist', 'umd', 'supabase.js'));
const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json' };
const servidor = createServer((req, res) => {
  const url = (req.url || '/').split('?')[0];
  if (url === '/' || url === '/index.html') {
    res.writeHead(200, { 'Content-Type': TIPOS['.html'] }); res.end(html); return;
  }
  try {
    const arquivo = join(RAIZ, decodeURIComponent(url).replace(/^\/+/, ''));
    const corpo = readFileSync(arquivo);
    res.writeHead(200, { 'Content-Type': TIPOS[extname(arquivo)] || 'application/octet-stream' });
    res.end(corpo);
  } catch { res.writeHead(404).end('não encontrado'); }
});
await new Promise((resolve) => servidor.listen(0, '127.0.0.1', resolve));

const navegador = await chromium.launch({ headless: true, executablePath: zahChrome });
const contexto = await navegador.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'pt-BR' });
const pagina = await contexto.newPage();
const consoleErrors = [];
pagina.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));
pagina.on('console', (m) => {
  if (m.text().startsWith('[STRESS]')) console.log(m.text());
  if (m.type() === 'error' && !/net::ERR_|favicon/.test(m.text())) consoleErrors.push('console: ' + m.text());
});
await pagina.route('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js',
  (rota) => rota.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body: supabase }));
await pagina.route('https://fonts.googleapis.com/**',
  (rota) => rota.fulfill({ status: 200, contentType: 'text/css; charset=utf-8', body: '' }));
await pagina.route('https://fonts.gstatic.com/**', (rota) => rota.abort());

try {
  const origem = `http://127.0.0.1:${servidor.address().port}`;
  await pagina.goto(origem + '/index.html', { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await pagina.waitForFunction(() => typeof ExtrasScreen === 'object' && typeof PlanoEngine === 'object' &&
    typeof DesempenhoTecScreen === 'object' && typeof ProfileUI === 'object', null, { timeout: 30_000 });
  await pagina.waitForTimeout(1_500);

  const resultado = await pagina.evaluate(async ({ maxExtras }) => {
    const rel = {
      executadoEm: new Date().toISOString(), modo: 'Chrome real, perfil efêmero, DOM completo',
      checagens: [], desempenho: [], volumes: {}, longTasks: []
    };
    const check = (grupo, nome, passou, detalhe) => rel.checagens.push({
      grupo, nome, passou: !!passou, detalhe: detalhe === undefined ? null : detalhe
    });
    const fase = (nome) => console.info('[STRESS] ' + nome);
    const medir = async (nome, fn) => {
      const ini = performance.now();
      const valor = await fn();
      const ms = Math.round((performance.now() - ini) * 10) / 10;
      rel.desempenho.push({ nome, ms });
      return valor;
    };
    const paint = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const dia = (offset) => {
      const d = new Date(todayLocal() + 'T12:00:00'); d.setDate(d.getDate() + offset);
      return d.toISOString().slice(0, 10);
    };
    const semNaN = (el) => !/NaN|undefined|null%/.test((el && el.textContent) || '');
    let observador;
    if (typeof PerformanceObserver !== 'undefined' && PerformanceObserver.supportedEntryTypes?.includes('longtask')) {
      observador = new PerformanceObserver((lista) => lista.getEntries().forEach((e) => rel.longTasks.push({
        inicio: Math.round(e.startTime), ms: Math.round(e.duration)
      })));
      observador.observe({ entryTypes: ['longtask'] });
    }

    ProfileUI.hideGate();
    fase('1/5 importações e cenários pequenos');
    const DT = DesempenhoTecScreen;
    const PE = PlanoEngine;
    const tipos = Object.keys(ExtrasScreen.TIPOS);
    const periodos = ['unica', 'diaria', 'semanal', 'quinzenal', 'mensal'];

    // 1. Importações reais e casos de borda pelo mesmo parser/tela usados no app.
    const tsv = [
      'Hierarquia\tÍndice\tQuestões Resolvidas\tAcertos (%)\tQuantidade de acertos',
      '\tDireito Constitucional\t200\t55\t110',
      '01\tControle de Constitucionalidade\t120\t50\t60',
      '02\tDireitos Fundamentais\t80\t62,5\t50',
      '\tPortuguês\t100\t70\t70',
      '01\tInterpretação de Texto\t100\t70\t70'
    ].join('\n');
    const parseadas = await medir('TEC: parse TSV válido (5 linhas)', () => TecEngine.parse(tsv));
    check('importacao', 'TSV preserva linhas e totais', parseadas.length === 5 &&
      TecEngine.totais({ rows: parseadas }).questoes === 300, { linhas: parseadas.length, totais: TecEngine.totais({ rows: parseadas }) });
    const csv = 'Hierarquia,Índice,Questões Resolvidas,Acertos (%),Quantidade de acertos\n,"Direito, Processo",10,50,5\n01,"Atos, Fatos",10,50,5';
    const csvRows = TecEngine.parse(csv);
    check('importacao', 'CSV citado preserva vírgulas entre aspas', csvRows.length === 2 && csvRows[1]?.nome === 'Atos, Fatos', { linhas: csvRows.length });
    const invalidas = TecEngine.parseCellRows([
      ['Hierarquia', 'Índice', 'Questões Resolvidas', 'Acertos (%)', 'Quantidade de acertos'],
      ['', 'Maior que total', 10, 150, 15], ['', 'Total negativo', -10, 0, 0],
      ['', 'Acerto negativo', 10, -20, -2], ['', 'Fracionário', 10.5, 52.4, 5.5]
    ]);
    const contagensValidas = invalidas.every((r) => Number.isInteger(r.questoes) && Number.isInteger(r.acertos) &&
      r.questoes >= 0 && r.acertos >= 0 && r.acertos <= r.questoes);
    check('importacao', 'Parser rejeita contagens impossíveis', contagensValidas, invalidas);

    const disciplinas = Array.from({ length: 4 }, (_, i) => 'Disciplina ' + (i + 1));
    DB.saveSubjects(disciplinas.map((nome, i) => ({ id: 'disc-' + i, nome, ativo: true, peso: i + 1,
      qtdQuestoes: 100, pontosPorQuestao: 1, minimoPct: 50 })));
    const linhasPequenas = (rodada) => disciplinas.flatMap((disc, di) => {
      const folhas = Array.from({ length: 8 }, (_, ti) => {
        const q = 30 + ((ti + rodada) % 4) * 10;
        const taxa = Math.min(0.98, 0.18 + ti * 0.09 + rodada * 0.05 + di * 0.01);
        const ac = Math.round(q * taxa);
        return { codigo: String(ti + 1).padStart(2, '0'), nome: 'Tema ' + (ti + 1), depth: 1,
          disciplina: disc, questoes: q, acertos: ac, pctAcerto: ac / q * 100 };
      });
      const q = folhas.reduce((n, x) => n + x.questoes, 0), ac = folhas.reduce((n, x) => n + x.acertos, 0);
      return [{ codigo: null, nome: disc, depth: 0, disciplina: disc, questoes: q, acertos: ac,
        pctAcerto: ac / q * 100 }, ...folhas];
    });
    const snapsPequenos = [-90, -60, -30, -1].map((d, i) => ({ id: 1000 + i, startDate: dia(d),
      endDate: dia(d), date: dia(d), label: 'Importação fictícia ' + (i + 1), rows: linhasPequenas(i) }));
    DB._set(DB.KEYS.tec, snapsPequenos);
    DB.saveIncidencia(disciplinas.flatMap((disc, di) => [
      { banca: 'BANCA A', disciplina: disc, topico: disc, codigo: null, depth: 0, incidencia: 800 + di * 100 },
      ...Array.from({ length: 8 }, (_, ti) => ({ banca: 'BANCA A', disciplina: disc, topico: 'Tema ' + (ti + 1),
        codigo: String(ti + 1).padStart(2, '0'), depth: 1, incidencia: 100 - ti * 7 }))
    ]));
    PE.salvarPrefs({ ...PE.DEFAULTS, migracao: 4, limite: 50 });
    DT.scopeMode = 'all'; DT.selectedSnapIds = new Set(snapsPequenos.map((s) => s.id));
    DT.savePrefs({ scopeMode: 'all', tecTab: 'analise' });
    const baseCount = DB.getTecSnapshots().length;
    DT.openImport();
    document.getElementById('tec-import-start').value = dia(1);
    document.getElementById('tec-import-end').value = dia(1);
    DT._parsedRows = [{ codigo: null, nome: 'Inválido', depth: 0, disciplina: 'Inválido',
      questoes: 10, acertos: 15, pctAcerto: 150 }];
    DT.saveImport();
    check('importacao', 'Salvar bloqueia acertos maiores que total', DB.getTecSnapshots().length === baseCount,
      { antes: baseCount, depois: DB.getTecSnapshots().length });
    DB._set(DB.KEYS.tec, snapsPequenos);
    DT.openImport();
    document.getElementById('tec-import-start').value = dia(1);
    document.getElementById('tec-import-end').value = dia(1);
    DT._parsedRows = [{ codigo: null, nome: 'Vazio', depth: 0, disciplina: 'Vazio', questoes: 0, acertos: 0, pctAcerto: 0 }];
    DT.saveImport();
    check('importacao', 'Salvar bloqueia retrato sem questões', DB.getTecSnapshots().length === baseCount,
      { antes: baseCount, depois: DB.getTecSnapshots().length });
    DB._set(DB.KEYS.tec, snapsPequenos);
    DT.openImport();
    document.getElementById('tec-import-start').value = dia(1);
    document.getElementById('tec-import-end').value = dia(1);
    DT._parsedRows = linhasPequenas(4);
    DT.saveImport();
    check('importacao', 'Importação válida é persistida pela tela', DB.getTecSnapshots().length === baseCount + 1,
      { depois: DB.getTecSnapshots().length });
    DB._set(DB.KEYS.tec, snapsPequenos);

    // 2. Fluxo completo: reforço do Plano + atividade externa (Anki) + resolução parcial.
    fase('2/5 Extras funcional: Plano, Anki e parciais');
    DB.saveExtras([]); DT._planoRefC = null; ExtrasScreen._ctxKey = null;
    const criouPlano = DT.criarExtraDoPlano('Tema 1', 'Disciplina 1', 120, 'reforco', true);
    const repetiuPlano = DT.criarExtraDoPlano('Tema 1', 'Disciplina 1', 120, 'reforco', true);
    const planoExtra = DB.getExtras()[0];
    check('extras-plano', 'Plano cria atividade vinculada', criouPlano && !!planoExtra?.origemPlano, planoExtra?.origemPlano);
    check('extras-plano', 'Plano bloqueia duplicata aberta', repetiuPlano === false && DB.getExtras().length === 1,
      { retorno: repetiuPlano, total: DB.getExtras().length });
    const anki = DB.addExtra({ titulo: 'Anki — Tema 1', tipo: 'anki', disciplina: 'Disciplina 1', alvo: 80,
      unidade: 'cards', periodo: 'diaria', dataInicio: dia(-2), dataFim: dia(10), contaMetricas: true });
    const foraPlano = DB.addExtra({ titulo: 'Questões externas — Tema 1', tipo: 'questoes', disciplina: 'Disciplina 1',
      alvo: 60, unidade: 'questoes', periodo: 'unica', contaMetricas: true });
    check('extras-plano', 'Anki e questões externas coexistem com o reforço do Plano', DB.getExtras().length === 3 &&
      !anki.origemPlano && !foraPlano.origemPlano, DB.getExtras().map((x) => ({ titulo: x.titulo, origemPlano: !!x.origemPlano })));

    ExtrasScreen.selDay = todayLocal(); ExtrasScreen._ctxKey = DB._profilePrefix() + '|' + DB._activePlanId();
    switchScreen('extras'); ExtrasScreen.render();
    let card = document.querySelector(`.exd[data-id="${foraPlano.id}"]`);
    card.querySelector('.exd-qtd').value = '25'; card.querySelector('.exd-ac').value = '18';
    card.querySelector('.exd-reg-btn').click();
    let foraAtual = DB.getExtra(foraPlano.id);
    check('extras-parcial', 'Registro parcial pela UI preserva total e acertos', foraAtual.progresso === 25 &&
      foraAtual.historico.at(-1).acertos === 18 && foraAtual.status === 'ativa', foraAtual);
    DB.addExtraProgress(foraPlano.id, 20, 0, { data: todayLocal(), acertos: 999 });
    foraAtual = DB.getExtra(foraPlano.id);
    check('extras-parcial', 'Acertos são limitados ao total do lançamento', foraAtual.historico.at(-1).acertos === 20,
      foraAtual.historico.at(-1));
    DB.addExtraProgress(foraPlano.id, 15, 0, { data: todayLocal(), acertos: 10 });
    foraAtual = DB.getExtra(foraPlano.id);
    check('extras-parcial', 'Parciais somadas concluem exatamente no alvo', foraAtual.progresso === 60 &&
      foraAtual.status === 'concluida', { progresso: foraAtual.progresso, status: foraAtual.status });
    DB.undoExtraProgressDay(foraPlano.id, todayLocal()); foraAtual = DB.getExtra(foraPlano.id);
    check('extras-parcial', 'Desfazer último parcial reabre atividade', foraAtual.progresso === 45 &&
      foraAtual.status === 'ativa', { progresso: foraAtual.progresso, status: foraAtual.status });
    DB.setConcluidaDia(anki.id, dia(1), true);
    check('extras-recorrencia', 'Ocorrência futura não pode ser concluída', !DB.extraConcluidaEm(DB.getExtra(anki.id), dia(1)));
    DB.setConcluidaDia(anki.id, todayLocal(), true);
    check('extras-recorrencia', 'Concluir Anki hoje não conclui amanhã', DB.extraConcluidaEm(DB.getExtra(anki.id), todayLocal()) &&
      !DB.extraConcluidaEm(DB.getExtra(anki.id), dia(1)));

    const parcialAntes = PlanoCiclo.avaliar(DB.getExtra(planoExtra.id), PE.calcular(DT.scopedSnapshot(), PE.prefs()));
    const snapNovo = JSON.parse(JSON.stringify(snapsPequenos.at(-1)));
    snapNovo.id = 1999; snapNovo.startDate = snapNovo.endDate = snapNovo.date = dia(1);
    snapNovo.rows.forEach((r) => {
      if (r.disciplina === 'Disciplina 1' && r.nome === 'Tema 1') { r.questoes += 150; r.acertos += 135; r.pctAcerto = r.acertos / r.questoes * 100; }
    });
    DB.saveTecSnapshot(snapNovo); DT.selectedSnapIds.add(snapNovo.id);
    const parcialDepois = PlanoCiclo.avaliar(DB.getExtra(planoExtra.id), PE.calcular(DT.scopedSnapshot(), PE.prefs()));
    check('extras-plano', 'Novo retrato alimenta progresso automático só do reforço vinculado',
      parcialAntes.medido === 0 && parcialDepois.medido >= 150 && DB.getExtra(foraPlano.id).progresso === 45,
      { antes: parcialAntes.medido, depois: parcialDepois.medido, externo: DB.getExtra(foraPlano.id).progresso });
    DB._set(DB.KEYS.tec, snapsPequenos); DT.selectedSnapIds = new Set(snapsPequenos.map((s) => s.id));

    // 3. Matriz combinatória de 360 estados válidos da tela de Extras.
    fase('3/5 matriz de 360 combinações');
    const matriz = [];
    let mi = 0;
    for (const tipo of tipos) for (const periodo of periodos) for (const status of ['ativa', 'concluida', 'pausada']) {
      for (const contaMetricas of [false, true]) for (const origem of ['externa', 'plano']) {
        const recorrente = periodo !== 'unica';
        const id = 'matriz-' + (++mi);
        matriz.push({ id, titulo: `${origem === 'plano' ? 'Plano' : 'Externa'} ${tipo} ${periodo} ${status}`,
          tipo, disciplina: 'Disciplina ' + ((mi % 4) + 1), alvo: 100, progresso: 35,
          unidade: ExtrasScreen.TIPOS[tipo].unidade, periodo, status, contaMetricas,
          dataInicio: dia(-14), dataFim: recorrente ? dia(31) : null,
          datas: recorrente ? [todayLocal(), dia(1)] : (mi % 2 ? [todayLocal()] : []),
          concluidasEm: recorrente && status === 'concluida' ? [todayLocal()] : [], excluidasEm: [],
          historico: [{ data: dia(-1), quantidade: 20, minutos: tipo === 'video' ? 20 : 0 },
            { data: todayLocal(), quantidade: 15, minutos: tipo === 'video' ? 15 : 0 }],
          origemPlano: origem === 'plano' ? { topico: 'Tema ' + ((mi % 8) + 1), disciplina: 'Disciplina ' + ((mi % 4) + 1),
            criadoEm: dia(-2), qBase: 0, taxaInicial: 40, motivo: 'reforco' } : undefined,
          createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
      }
    }
    DB.saveExtras(matriz); ExtrasScreen._planoRefCard = PE.calcular(DT.scopedSnapshot(), PE.prefs());
    let htmlOk = 0;
    for (const x of matriz) {
      const s = ExtrasScreen.cardHtml(x, todayLocal());
      if (s.includes(x.titulo) && !/NaN|undefined/.test(s)) htmlOk++;
    }
    rel.volumes.matrizExtras = matriz.length;
    check('matriz-extras', '360 combinações renderizam cartão finito', htmlOk === matriz.length,
      { esperadas: matriz.length, validas: htmlOk });
    const renderMatriz = await medir('Extras: render + layout da matriz de 360 combinações', async () => {
      ExtrasScreen._cursoAberto = false; ExtrasScreen.selDay = todayLocal(); ExtrasScreen.render(); await paint();
      return document.querySelectorAll('#extras-list .exd').length;
    });
    check('matriz-extras', 'Tela monta atividades do Plano e externas juntas',
      renderMatriz > 0 && document.querySelectorAll('#extras-list .extra-tag.plano').length > 0,
      { cartoesNoDia: renderMatriz, tagsPlano: document.querySelectorAll('#extras-list .extra-tag.plano').length });
    await medir('Extras: gerenciador com 360 combinações', async () => { ExtrasScreen.renderManageList(); await paint(); });
    const matrizPrimeira = document.querySelectorAll('#extras-manage-list .exm-row').length;
    document.getElementById('exm-load-more')?.click(); await paint();
    const matrizSegunda = document.querySelectorAll('#extras-manage-list .exm-row').length;
    check('matriz-extras', 'Gerenciador pagina as 360 atividades sem perder linhas',
      matrizPrimeira === 200 && matrizSegunda === matriz.length,
      { primeiraPagina: matrizPrimeira, aposMostrarMais: matrizSegunda });

    const casosRec = [
      ['mensal 31/jan em ano comum', '2025-01-31', '2025-03-31', 3],
      ['mensal 31/jan em ano bissexto', '2024-01-31', '2024-03-31', 3],
      ['diária em 31 dias', '2026-01-01', '2026-01-31', 31],
      ['semanal em 29 dias', '2026-01-01', '2026-01-29', 5],
      ['quinzenal em 29 dias', '2026-01-01', '2026-01-29', 3]
    ];
    for (const [nome, inicio, fim, esperado] of casosRec) {
      const periodo = nome.split(' ')[0] === 'mensal' ? 'mensal' : nome.split(' ')[0] === 'diária' ? 'diaria' : nome.split(' ')[0];
      const datas = DB._gerarDatasRecorrencia({ periodo, dataInicio: inicio, dataFim: fim });
      check('extras-recorrencia', nome, datas.length === esperado, { esperado, obtido: datas.length, datas });
    }

    // 4. Carga massiva TEC: 12 retratos, 3.000 tópicos e evolução parcial.
    fase('4/5 gerar carga TEC de 12 retratos x 3.000 tópicos');
    const numDisc = 30, porDisc = 100, numSnaps = 12;
    const snapsMassivos = [];
    for (let si = 0; si < numSnaps; si++) {
      const rows = [];
      for (let di = 0; di < numDisc; di++) {
        const disc = 'Matéria Massiva ' + String(di + 1).padStart(2, '0');
        const folhas = [];
        for (let ti = 0; ti < porDisc; ti++) {
          // Alguns tópicos entram só nas quatro últimas importações: reforços novos fora do plano original.
          if (ti >= 95 && si < 8) continue;
          const global = di * porDisc + ti;
          const q = 20 + ((global * 17 + si * 13) % 181);
          const taxa = Math.max(0, Math.min(1, 0.12 + (global % 73) / 100 + si * 0.012));
          const ac = Math.round(q * taxa);
          folhas.push({ codigo: String(ti + 1).padStart(3, '0'), nome: 'Tópico ' + String(ti + 1).padStart(3, '0'),
            depth: 1, disciplina: disc, questoes: q, acertos: ac, pctAcerto: ac / q * 100 });
        }
        const q = folhas.reduce((n, x) => n + x.questoes, 0), ac = folhas.reduce((n, x) => n + x.acertos, 0);
        rows.push({ codigo: null, nome: disc, depth: 0, disciplina: disc, questoes: q, acertos: ac,
          pctAcerto: q ? ac / q * 100 : 0 }, ...folhas);
      }
      const off = -360 + si * 30;
      snapsMassivos.push({ id: 50000 + si, startDate: dia(off), endDate: dia(off), date: dia(off),
        label: 'Carga massiva ' + (si + 1), rows });
    }
    const linhasTec = snapsMassivos.reduce((n, s) => n + s.rows.length, 0);
    fase('4/5 persistir carga TEC');
    await medir(`TEC: persistir ${numSnaps} retratos / ${linhasTec.toLocaleString('pt-BR')} linhas`,
      () => DB._set(DB.KEYS.tec, snapsMassivos));
    DT.scopeMode = 'all'; DT.selectedSnapIds = new Set(snapsMassivos.map((s) => s.id));
    fase('4/5 agregar carga TEC');
    const agregado = await medir('TEC: agregar 12 retratos e evolução parcial', () => DT.scopedSnapshot());
    fase('4/5 calcular Plano');
    const plano = await medir('TEC: calcular Plano com 3.000 tópicos', () => PE.calcular(agregado, { ...PE.prefs(), limite: 200 }));
    const incidencia = [];
    for (let bi = 0; bi < 3; bi++) for (let di = 0; di < numDisc; di++) {
      const disc = 'Matéria Massiva ' + String(di + 1).padStart(2, '0');
      incidencia.push({ banca: 'BANCA MASSIVA ' + (bi + 1), disciplina: disc, topico: disc, codigo: null,
        depth: 0, incidencia: 10_000 + di * 100 });
      for (let ti = 0; ti < porDisc; ti++) incidencia.push({ banca: 'BANCA MASSIVA ' + (bi + 1),
        disciplina: disc, topico: 'Tópico ' + String(ti + 1).padStart(3, '0'), codigo: String(ti + 1).padStart(3, '0'),
        depth: 1, incidencia: 1 + ((di * porDisc + ti + bi * 7) % 97) });
    }
    await medir(`TEC: persistir ${incidencia.length.toLocaleString('pt-BR')} linhas de incidência / 3 bancas`,
      () => DB.saveIncidencia(incidencia));
    fase('4/5 calcular Reforço');
    const reforco = await medir('TEC: calcular Reforço com incidência massiva', () => ReforcoEngine.suggestFrontier(agregado,
      { banca: '__todas__', estrategia: 0.5, granularidade: 1, minQuestoes: 10, incidMin: 5, limite: 200 }));
    rel.volumes.tec = { retratos: numSnaps, topicosCatalogo: numDisc * porDisc, linhas: linhasTec,
      incidencia: incidencia.length, questoesAgregadas: TecEngine.totais(agregado).questoes };
    check('tec-massivo', 'Plano massivo mantém números finitos', Number.isFinite(plano.dominioPct) &&
      plano.itens.every((x) => Number.isFinite(x.custoQ) && Number.isFinite(x.ganhoPP)),
      { dominio: plano.dominioPct, itens: plano.itens.length });
    check('tec-massivo', 'Reforço massivo retorna itens sem duplicar unidade', reforco.items.length > 0 &&
      new Set(reforco.items.map((x) => x.disciplina + '|' + x.nome)).size === reforco.items.length,
      { itens: reforco.items.length, unidades: reforco.totalUnidades });
    switchScreen('desempenhotec');
    for (const aba of ['analise', 'incidencia', 'reforco', 'plano']) {
      fase('4/5 renderizar aba ' + aba);
      const restaurar = [], perfil = {};
      if (aba === 'plano') {
        const observar = (obj, nomes, prefixo) => nomes.forEach((nome) => {
          if (typeof obj?.[nome] !== 'function') return;
          const original = obj[nome]; restaurar.push(() => { obj[nome] = original; });
          obj[nome] = function (...args) {
            const ini = performance.now();
            try { return original.apply(this, args); }
            finally {
              const k = prefixo + '.' + nome, p = perfil[k] || { chamadas: 0, ms: 0 };
              p.chamadas++; p.ms += performance.now() - ini; perfil[k] = p;
            }
          };
        });
        observar(PE, ['calcular', 'totalHistorico', '_indice', '_folhas', '_agrupamento', 'serieHistorica'], 'PlanoEngine');
        observar(PlanoPontos, ['projecao', 'materias', 'esforcoPorMateria', 'dificuldadeMedida', 'anexarPontos'], 'PlanoPontos');
        observar(PlanoCiclo, ['emCurso', 'avaliar'], 'PlanoCiclo');
      }
      await medir(`TEC: render + layout da aba ${aba} (carga massiva)`, async () => { DT.switchTecTab(aba); await paint(); });
      restaurar.reverse().forEach((fn) => fn());
      if (aba === 'plano') rel.perfilPlano = Object.fromEntries(Object.entries(perfil)
        .map(([k, v]) => [k, { chamadas: v.chamadas, ms: Math.round(v.ms * 10) / 10 }]));
      const host = document.getElementById('tec-panel-' + aba);
      check('tec-massivo', 'Aba ' + aba + ' renderiza sem NaN', host && host.textContent.trim().length > 30 && semNaN(host),
        { caracteres: host?.textContent.length, elementos: host?.querySelectorAll('*').length });
    }

    // 5. Carga massiva Extras, com os seis tipos, cinco períodos e duas origens.
    fase(`5/5 gerar ${maxExtras.toLocaleString('pt-BR')} Extras`);
    const extrasMassivos = [];
    for (let i = 0; i < maxExtras; i++) {
      const tipo = tipos[i % tipos.length], periodo = periodos[i % periodos.length];
      const rec = periodo !== 'unica', hoje = i % 11 === 0;
      extrasMassivos.push({ id: 'massa-' + i, titulo: `${i % 100 === 0 ? 'Plano' : 'Externa'} ${tipo} ${i}`,
        tipo, disciplina: 'Matéria Massiva ' + String((i % numDisc) + 1).padStart(2, '0'),
        alvo: 20 + i % 181, progresso: i % 90, unidade: ExtrasScreen.TIPOS[tipo].unidade,
        periodo, status: i % 17 === 0 ? 'concluida' : 'ativa', contaMetricas: i % 2 === 0,
        dataInicio: dia(-45), dataFim: rec ? dia(120) : null,
        datas: hoje ? [todayLocal()] : [dia(1 + (i % 120))],
        concluidasEm: rec && i % 17 === 0 ? [todayLocal()] : [], excluidasEm: [],
        historico: Array.from({ length: 4 }, (_, hi) => ({ data: dia(-hi), quantidade: 1 + (i + hi) % 20,
          minutos: tipo === 'video' ? 1 + (i + hi) % 20 : 0,
          ...(tipo === 'questoes' ? { acertos: (i + hi) % (2 + (i + hi) % 20) } : {}) })),
        origemPlano: i % 100 === 0 ? { topico: 'Tópico ' + String((i % porDisc) + 1).padStart(3, '0'),
          disciplina: 'Matéria Massiva ' + String((i % numDisc) + 1).padStart(2, '0'), criadoEm: dia(-30),
          qBase: 0, taxaInicial: 40, motivo: 'reforco' } : undefined,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    }
    fase('5/5 persistir Extras');
    await medir(`Extras: persistir ${maxExtras.toLocaleString('pt-BR')} atividades / ${(maxExtras * 4).toLocaleString('pt-BR')} lançamentos`, () => DB.saveExtras(extrasMassivos));
    switchScreen('extras'); ExtrasScreen._ctxKey = DB._profilePrefix() + '|' + DB._activePlanId();
    ExtrasScreen.selDay = todayLocal(); ExtrasScreen._cursoAberto = false;
    fase('5/5 renderizar tela diária de Extras');
    const visiveis = await medir(`Extras: render + layout com ${maxExtras.toLocaleString('pt-BR')} atividades e TEC massivo`, async () => {
      ExtrasScreen.render(); await paint(); return document.querySelectorAll('#extras-list .exd').length;
    });
    const botaoDia = document.getElementById('extras-load-more');
    if (botaoDia) { botaoDia.click(); await paint(); }
    const visiveis2 = document.querySelectorAll('#extras-list .exd').length;
    fase(`5/5 materializar gerenciador de ${maxExtras.toLocaleString('pt-BR')} Extras`);
    ExtrasScreen._manageLimit = 200;
    await medir(`Extras: gerenciador DOM com ${maxExtras.toLocaleString('pt-BR')} atividades`, async () => { ExtrasScreen.renderManageList(); await paint(); });
    const geridas = document.querySelectorAll('#extras-manage-list .exm-row').length;
    document.getElementById('exm-load-more')?.click(); await paint();
    const geridas2 = document.querySelectorAll('#extras-manage-list .exm-row').length;
    ExtrasScreen._manageLimit = maxExtras; ExtrasScreen.renderManageList(); await paint();
    const geridasTodas = document.querySelectorAll('#extras-manage-list .exm-row').length;
    await medir('Extras: varrer ocorrências de 31 dias', () => {
      let n = 0; for (let d = -15; d <= 15; d++) n += ExtrasScreen.occurrencesForDay(dia(d)).length; return n;
    });
    await medir('Extras: somar carga horária anual', () => ExtrasScreen._minInRange(dia(-365), todayLocal()));
    await medir(`Extras: registrar parcial com ${maxExtras.toLocaleString('pt-BR')} itens persistidos`, () => DB.addExtraProgress('massa-1', 7, 0,
      { data: todayLocal() }));
    await medir(`Extras: desfazer parcial com ${maxExtras.toLocaleString('pt-BR')} itens persistidos`, () => DB.undoExtraProgressDay('massa-1', todayLocal()));
    rel.volumes.extras = { atividades: extrasMassivos.length, historicos: extrasMassivos.length * 4,
      origensPlano: extrasMassivos.filter((x) => x.origemPlano).length, cartoesHoje: visiveis, linhasGerenciador: geridas };
    check('extras-massivo', 'Tela diária pagina e expande o subconjunto navegável',
      visiveis > 0 && visiveis <= ExtrasScreen.PAGE_SIZE && visiveis2 > visiveis,
      { primeiraPagina: visiveis, segundaPagina: visiveis2, total: extrasMassivos.length });
    check('extras-massivo', `Gerenciador pagina e alcança as ${maxExtras.toLocaleString('pt-BR')} atividades`,
      geridas === 200 && geridas2 === 400 && geridasTodas === extrasMassivos.length,
      { primeiraPagina: geridas, segundaPagina: geridas2, todas: geridasTodas });
    check('extras-massivo', 'Tela massiva não exibe NaN', semNaN(document.getElementById('screen-extras')),
      { caracteres: document.getElementById('screen-extras')?.textContent.length });
    check('extras-massivo', 'Plano e Anki/externas permanecem distinguíveis',
      extrasMassivos.some((x) => x.origemPlano) && extrasMassivos.some((x) => x.tipo === 'anki' && !x.origemPlano),
      { plano: extrasMassivos.filter((x) => x.origemPlano).length,
        ankiExterno: extrasMassivos.filter((x) => x.tipo === 'anki' && !x.origemPlano).length });

    if (observador) { await paint(); observador.disconnect(); }
    rel.memoria = performance.memory ? {
      usadoMB: Math.round(performance.memory.usedJSHeapSize / 104857.6) / 10,
      totalMB: Math.round(performance.memory.totalJSHeapSize / 104857.6) / 10,
      limiteMB: Math.round(performance.memory.jsHeapSizeLimit / 104857.6) / 10
    } : null;
    rel.resumo = { total: rel.checagens.length, passou: rel.checagens.filter((x) => x.passou).length,
      falhou: rel.checagens.filter((x) => !x.passou).length,
      maiorTempoMs: Math.max(...rel.desempenho.map((x) => x.ms)),
      longTasks: rel.longTasks.length };
    fase('concluído');
    return rel;
  }, { maxExtras: MAX_EXTRAS });

  resultado.browser = { versao: await navegador.version(), consoleErrors };
  resultado.evidencias = [];
  resultado.errosDeCaptura = [];
  // Persiste primeiro: uma captura lenta nunca pode apagar as medições já concluídas.
  writeFileSync(SAIDA, JSON.stringify(resultado, null, 2));

  // A medição foi feita com o volume completo. Para a inspeção visual, retiramos do
  // DOM as milhares de linhas ocultas e mantemos uma amostra representativa legível.
  await pagina.evaluate(() => {
    const todos = DB.getExtras();
    DB.saveExtras(todos.filter((x, i) => i < 60 || x.origemPlano).slice(0, 80));
    const ger = document.getElementById('extras-manage-list'); if (ger) ger.innerHTML = '';
    ExtrasScreen._ctxKey = DB._profilePrefix() + '|' + DB._activePlanId();
    ExtrasScreen.selDay = todayLocal(); ExtrasScreen.render();
    const selo = document.createElement('div'); selo.id = 'stress-visual-label';
    selo.style.cssText = 'position:fixed;right:8px;bottom:8px;z-index:99999;background:#172554;color:white;padding:7px 10px;border-radius:8px;font:12px sans-serif';
    selo.textContent = 'Amostra visual após teste massivo'; document.body.appendChild(selo);
  });
  const capturar = async (nome) => {
    try {
      await pagina.screenshot({ path: join(EVIDENCIAS, nome), fullPage: false, timeout: 60_000 });
      resultado.evidencias.push(nome);
    } catch (e) { resultado.errosDeCaptura.push(nome + ': ' + e.message); }
  };
  await capturar('stress-extras-desktop.png');
  await pagina.setViewportSize({ width: 390, height: 844 }); await pagina.waitForTimeout(250);
  await capturar('stress-extras-celular.png');
  await pagina.setViewportSize({ width: 1440, height: 1000 });
  await pagina.evaluate(() => { switchScreen('desempenhotec'); DesempenhoTecScreen.switchTecTab('plano'); });
  await pagina.waitForTimeout(250);
  await capturar('stress-tec-plano-desktop.png');
  await pagina.setViewportSize({ width: 390, height: 844 }); await pagina.waitForTimeout(250);
  await capturar('stress-tec-plano-celular.png');
  writeFileSync(SAIDA, JSON.stringify(resultado, null, 2));
  console.log(JSON.stringify({ resumo: resultado.resumo, volumes: resultado.volumes,
    falhas: resultado.checagens.filter((x) => !x.passou), desempenho: resultado.desempenho,
    memoria: resultado.memoria, consoleErrors }, null, 2));
} finally {
  await contexto.close(); await navegador.close();
  await new Promise((resolve) => servidor.close(resolve));
}
