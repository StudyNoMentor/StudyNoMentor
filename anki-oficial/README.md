# Anki Oficial — fonte literal de verdade dos Cards

Esta pasta ancora a paridade dos **Cards do StudyNoMentor** no repositório oficial `ankitects/anki`.

## Upstream literal

`anki-oficial/upstream` é um **git submodule/gitlink**, fixado no commit oficial da release **Anki 26.09.3**:

`29bb700b951e3f0c0cb69b77c0180fc1fe33e6ba`

Logo, após `git submodule update --init --recursive`, o conteúdo de `anki-oficial/upstream` é o próprio repositório oficial naquele commit — não uma transcrição manual.

O commit `7a4db0038e4d5570cc3a297a2b47f8fefbfc309c` é o radar do `main` consultado em 2026-10-01. Ele está 15 commits à frente da release e não muda o alvo de produção até nova release estável.

## Cobertura do repositório inteiro

O inventário em `inventario/` enumera todos os blobs do commit oficial, com caminho, SHA e tamanho. A contagem autoritativa da release atual vive em `UPSTREAM.lock.json`.

Os submódulos internos também estão registrados
em `inventario/submodules.json`, com seus commits oficiais. Seus arquivos internos
não são contabilizados como blobs do repositório pai.

- `CARDS_RUNTIME` — arquivos que entram diretamente no contrato de paridade dos Cards.
- `OUTSIDE_CARDS_RUNTIME` — arquivos inventariados que não são tratados como comportamento de Cards.
- `UNCLASSIFIED` — permitido apenas em PR automático pendente de revisão; o gate impede merge enquanto existir.

A classificação não autoriza ignorar arquivos. Se um arquivo antes fora do runtime passar a influenciar Cards numa release futura, o gate deve reclassificá-lo.

## Regra de 100%

Paridade perfeita significa **resultado observável igual ao Anki oficial**, não apenas função parecida. Cada categoria em `cards-contracts.json` aponta os adaptadores do Study e os testes diferenciais responsáveis.

O gate `testes/cards-anki-upstream-manifest.mjs` garante que todo blob da release esteja coberto pelo inventário e que nenhum arquivo `CARDS_RUNTIME` fique sem categoria/contrato.

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

## Atualização automática de release estável

O workflow `.github/workflows/auto-update-anki-stable.yml` consulta diariamente a release estável mais recente publicada por `ankitects/anki`. Quando encontra uma versão superior à fixada em `UPSTREAM.lock.json`, ele prepara uma branch e um PR com o submódulo, inventário, pin Python, contratos e artefatos publicados atualizados.

A promoção é **fail-safe**: arquivos novos em áreas potencialmente funcionais entram como `UNCLASSIFIED` e bloqueiam o merge automático. Sem bloqueadores, a automação dispara a verificação completa do Study; somente um run integralmente verde permite merge. Depois do merge, o workflow de produção é disparado explicitamente e o Railway só é aceito quando `/health` reporta a mesma versão e a mesma revisão da `main`.

Pré-releases, drafts, downgrades, runtime Python divergente, inventário incompleto ou qualquer falha de navegador/backend mantêm a versão anterior em produção.

## Validação funcional

A integração do runtime de Cards exige **100% dos arquivos classificados como `CARDS_RUNTIME`**. Todas as categorias apontam para adaptadores que delegam o comportamento acadêmico ao backend com `anki==26.09.3`; o Study mantém somente UI, metadados e projeções necessárias ao produto.

A proteção útil do repositório fica concentrada em três fontes versionadas: o inventário literal do upstream, `cards-contracts.json` e as suítes funcionais/diferenciais que executam a ponte e o pacote Anki real. O gate reprova divergência de blobs, versão, contrato, adapter inexistente, reintrodução de motor local ou falhas nos smokes oficiais.

Relatórios derivados de auditoria por arquivo não são versionados. Quando for necessário investigar uma regressão, a evidência deve vir do commit upstream fixado, do contrato afetado e do teste reproduzível correspondente, evitando arquivos gerados gigantes ou contadores sem efeito no runtime.
