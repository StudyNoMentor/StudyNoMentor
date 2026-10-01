# Anki Oficial — fonte literal de verdade dos Cards

Esta pasta ancora a paridade dos **Cards do StudyNoMentor** no repositório oficial `ankitects/anki`.

## Upstream literal

`anki-oficial/upstream` é um **git submodule/gitlink**, fixado no commit oficial da release **Anki 26.09.3**:

`29bb700b951e3f0c0cb69b77c0180fc1fe33e6ba`

Logo, após `git submodule update --init --recursive`, o conteúdo de `anki-oficial/upstream` é o próprio repositório oficial naquele commit — não uma transcrição manual.

O commit `d1d484c8249a8266a6fe9203694f9087726c6ba2` é apenas radar do `main` posterior à release e não muda o alvo de produção até nova release estável.

## Cobertura do repositório inteiro

O inventário em `inventario/` enumera **2107 arquivos** do commit oficial, com caminho, SHA do blob e tamanho.

Os quatro submódulos internos (traduções e instaladores) também estão registrados
em `inventario/submodules.json`, com seus commits oficiais. Seus arquivos internos
não são contabilizados como blobs do repositório pai.

- **571** arquivos: `CARDS_RUNTIME` — entram diretamente no contrato de paridade dos Cards.
- **1536** arquivos: `OUTSIDE_CARDS_RUNTIME` — continuam inventariados para detectar mudanças upstream, mas não são automaticamente tratados como comportamento de Cards.

A classificação não autoriza ignorar arquivos. Se um arquivo antes fora do runtime passar a influenciar Cards numa release futura, o gate deve reclassificá-lo.

## Regra de 100%

Paridade perfeita significa **resultado observável igual ao Anki oficial**, não apenas função parecida. Cada categoria em `cards-contracts.json` aponta os adaptadores do Study e os testes diferenciais responsáveis.

O gate `testes/cards-anki-upstream-manifest.mjs` garante que os 2107 arquivos estejam cobertos pelo inventário e que nenhum dos 571 arquivos de Cards fique sem categoria/contrato.

No CI, o checkout é recursivo e o gate roda com `--require-upstream`: a ausência
da fonte oficial faz a verificação falhar. Para reproduzir:

```sh
git submodule update --init --recursive
node testes/cards-anki-upstream-manifest.mjs --require-upstream
python testes/anki-oficial-version.py
```

O gate também confere que `requirements.txt`, o backend e o inventário apontem
a mesma release. O backend recusa iniciar com uma versão Anki diferente ou sem
versão identificável, antes de abrir coleções. `/health` informa a versão real
validada; nunca substitui uma versão ausente pela versão esperada.

O antigo workflow de geração de FSRS WASM foi retirado: o FSRS dos Cards é
executado pelo pacote oficial no backend, conforme os contratos desta pasta.

## Auditoria individual e progresso

[`AUDITORIA-POR-ARQUIVO.md`](AUDITORIA-POR-ARQUIVO.md) lista cada arquivo upstream
com link oficial, SHA, categoria e status. O mapa de categoria indica os adapters
e testes a inspecionar; não afirma que cada teste cobre cada arquivo.

`audit-status.json` mantém somente as evidências individuais já revisadas.
Ausência de registro significa `PENDING`. Não se atribui um percentual de paridade
a partir da existência de APIs, botões, testes ou do inventário.

Após alterar inventário, contratos ou evidências:

```sh
node tools/anki-audit-report.mjs
node tools/anki-audit-report.mjs --check
```

O segundo comando participa do gate existente. Uma certificação exige evidência
referenciada com SHA upstream/Study, teste, casos, resultado e relatório de execução
versionado cobrindo estado, resultado, persistência, erro e casos comuns/extremos.
O gate valida rastreabilidade; a cobertura integral ainda exige revisão do código.
