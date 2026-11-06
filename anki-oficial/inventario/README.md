# Inventário integral do upstream Anki 26.09.4

Gerado diretamente da Git tree do commit:

`c06370ff4d87cb48d825f90cc83e02b9a4e84ecd`

Total: **2110 blobs/arquivos**.

Os arquivos são divididos em blocos de 250 entradas apenas para manter diffs revisáveis. A concatenação dos blocos, ordenada por `index`, é o inventário integral.

Campos:
- `path`: caminho oficial;
- `blob_sha`: SHA Git do conteúdo oficial;
- `size`: bytes informados pela Git tree;
- `repository_area`: área estrutural;
- `cards_scope`: `CARDS_RUNTIME`, `OUTSIDE_CARDS_RUNTIME` ou `UNCLASSIFIED`;
- `cards_category`: contrato funcional quando aplicável.

Arquivos novos em áreas potencialmente funcionais entram como `UNCLASSIFIED` e bloqueiam o merge automático até classificação explícita.
