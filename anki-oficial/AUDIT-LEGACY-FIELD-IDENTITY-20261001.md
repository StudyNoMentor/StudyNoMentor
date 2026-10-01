# Auditoria da migração reversa — 2026-10-01

## Conclusão e reprodução

A main a2e32a5e13cb2abb4a725703c6089f5acbf830c7 falha ao migrar um Basic (and reversed card) perfeitamente válido: dois campos Front/Back, templates {{Front}} e {{Back}}, uma nota e dois cards. O commit e981b513603474560fc659180f90abe06247ac48 acrescentou somente a regressão, sem alterar o backend. O job Backend Anki Oficial falhou com a mesma HTTPException 422 e CardTypeError informados pelo usuário:
https://github.com/StudyNoMentor/StudyNoMentor/actions/runs/36911349902

Isso comprova uma causa suficiente no código publicado. Os dados privados do usuário não foram acessados; não é possível afirmar que esta seja a única inconsistência em sua coleção.

## Cadeia causal

1. O bridge serializa campos e templates da projeção local.
2. _apply_legacy_notetype_shape só restaura o stock quando as frentes de entrada já estão vazias ou duplicadas e as quantidades são compatíveis.
3. Com frentes válidas, o caminho normal zera nt["flds"] e cria novos campos via new_field(), com ord=None.
4. update_dict compara os campos novos com o modelo stock persistido. No Anki 26.09.3, renamed_and_removed_fields considera os ords antigos ausentes como remoções.
5. update_templates_for_renamed_and_removed_fields remove as referências Front e Back. Se a frente fica sem referência, add_missing_field_replacement insere o primeiro campo restante.
6. As duas frentes tornam-se {{Front}}. ensure_template_fronts_unique rejeita o segundo template.

Fonte oficial examinada: ankitects/anki commit 29bb700b951e3f0c0cb69b77c0180fc1fe33e6ba, rslib/src/notetype/mod.rs (prepare_for_update, renamed_and_removed_fields, update_templates_for_renamed_and_removed_fields e ensure_template_fronts_unique); pylib/anki/models.py (new_field, rename_field e new_template).

## Correção

Preservar os objetos de campo e template existentes por posição, incluindo ord e id atribuídos pelo Anki. Persistir a mudança dos campos antes de aplicar os templates legados: o backend termina as renomeações de schema sobre seus templates stock; os templates recebidos são aplicados depois, com os nomes finais. Toda atualização continua com skip_checks=False e dentro do snapshot guard.

Regressões verificam pares válidos com Front/Back, Pergunta/Resposta e Back/Front, valores de nota, qfmt exatos, ordinais e perguntas renderizadas pelo motor oficial. Os casos anteriores de frentes duplicadas, campos adicionais, colisão de modelos e rollback permanecem na suíte.

## Achados adicionais e limites

- Campos insuficientes ou quantidade de templates diferente do stock desativam o reparo de frentes inválidas. Não é seguro descartar templates ou inventar conteúdo para esses casos. Exigem diagnóstico e política explícita de conversão.
- O fallback de cards por posição, quando não encontra o ordinal legado, pode associar dois registros ao mesmo card oficial e sobrescrever scheduling/histórico. Deve ser substituído por validação explícita dos ordinais em uma correção própria.
- _legacy_stock_kind pode priorizar um stock_kind explícito incompatível com o nome; números e nomes/localizações sem metadado confiável precisam de uma política documentada.
- NoteTypes com mesmo ankiId em planos diferentes são agrupados pelo bridge, que conserva a primeira definição. Divergências de schema entre réplicas não são verificadas.
- O bridge envia notas como dicionário de campos e o backend só copia chaves presentes no modelo final. Chaves extras ausentes do NoteType podem ser ignoradas. A migração deve validar cobertura antes de salvar.
- As correções de deploy resolveram a publicação, mas não demonstravam que todos os caminhos da migração estavam corretos. O teste anterior só cobria a entrada já duplicada; o teste positivo de um par válido estava ausente.

Não foi introduzido scheduler aproximado nem validação desativada. A evidência da reprodução é o motor Anki 26.09.3 no GitHub Actions, pois o ambiente local não possui o pacote e seu proxy de rede está indisponível.
