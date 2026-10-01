# Anki Oficial — fonte literal de verdade dos Cards

Esta pasta ancora a paridade dos **Cards do StudyNoMentor** no repositório oficial `ankitects/anki`.

## Upstream literal

`anki-oficial/upstream` é um **git submodule/gitlink**, fixado no commit oficial da release **Anki 26.09.3**:

`29bb700b951e3f0c0cb69b77c0180fc1fe33e6ba`

Logo, após `git submodule update --init --recursive`, o conteúdo de `anki-oficial/upstream` é o próprio repositório oficial naquele commit — não uma transcrição manual.

O commit `d1d484c8249a8266a6fe9203694f9087726c6ba2` é apenas radar do `main` posterior à release e não muda o alvo de produção até nova release estável.

## Cobertura do repositório inteiro

O inventário em `inventario/` enumera **2107 arquivos** do commit oficial, com caminho, SHA do blob e tamanho.

- **571** arquivos: `CARDS_RUNTIME` — entram diretamente no contrato de paridade dos Cards.
- **1536** arquivos: `OUTSIDE_CARDS_RUNTIME` — continuam inventariados para detectar mudanças upstream, mas não são automaticamente tratados como comportamento de Cards.

A classificação não autoriza ignorar arquivos. Se um arquivo antes fora do runtime passar a influenciar Cards numa release futura, o gate deve reclassificá-lo.

## Regra de 100%

Paridade perfeita significa **resultado observável igual ao Anki oficial**, não apenas função parecida. Cada categoria em `cards-contracts.json` aponta os adaptadores do Study e os testes diferenciais responsáveis.

O gate `testes/cards-anki-upstream-manifest.mjs` garante que os 2107 arquivos estejam cobertos pelo inventário e que nenhum dos 571 arquivos de Cards fique sem categoria/contrato.
