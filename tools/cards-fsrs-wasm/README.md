# Cards FSRS WASM

Wrapper minimo do otimizador oficial usado pelo modulo **Cards**.

## Contrato de paridade

A dependencia e fixada em `fsrs = "=6.6.2"`, a mesma versao usada como
referencia pela auditoria do Anki 26.09.2. A funcao `optimize_json()` replica
os parametros de `Collection::compute_params()`:

- `enable_short_term = true`;
- `card_ids` alinhados aos itens de treino;
- `num_relearning_steps` do preset;
- `TrainingConfig { num_epochs: 8, ..Default::default() }`;
- comparacao entre log loss atual e otimizado;
- fallback pos-treino identico ao Anki 26.09.2.

A conversao do revlog do Study para `FSRSItem` fica no JavaScript de
`AnkiParity` e possui testes baseados nos vetores do rslib.

O binario de navegador e gerado de forma reproduzivel e versionado em
`src/vendor/fsrs-6.6.2/`. Nao ha CDN em tempo de execucao.

A pasta `src/vendor/fsrs-6.6.2/` e artefato derivado: deve ser produzida pelo workflow
`Cards FSRS 6.6.2 vendor` a partir deste wrapper, nunca editada manualmente.

## Patch do crate para o navegador

`preparar-fsrs.sh` baixa o crate **oficial** `fsrs 6.6.2` do crates.io
(SHA-256 fixado) e aplica um único patch, `fsrs-6.6.2-wasm-sequencial.patch`:
em `evaluate_with_time_series_splits` (a verificação de saúde), cada divisão
era disparada com `rayon::spawn` e o resultado esperado num canal. No
`wasm32-unknown-unknown` não há threads, o job nunca executa e a espera era
eterna — a aba travava. No wasm32 a divisão é avaliada na própria thread; a
ordem, a matemática e o resultado são os mesmos (conferido contra
`compute_fsrs_params`/`evaluate_params` do anki==26.09.2 em
`audit/cards-20260924-completa/otimizador_*.{py,mjs}`: Δ < 3e-7).
