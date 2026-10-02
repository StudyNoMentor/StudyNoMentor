# Publicação do backend oficial

O workflow sincroniza a main para a branch conectada ao Railway e executa `railway redeploy --from-source`. Um redeploy comum reutiliza o commit anterior.

## Credencial

Crie um API Token em Railway Account Settings → Tokens, com acesso ao workspace do projeto `studynomentor-anki-official`. Salve seu valor no repository secret de Actions `RAILWAY_TOKEN` em https://github.com/StudyNoMentor/StudyNoMentor/settings/secrets/actions.

O nome do secret GitHub é mantido por compatibilidade. O workflow passa seu valor ao CLI como `RAILWAY_API_TOKEN`, a variável correta para tokens de conta/workspace. `RAILWAY_TOKEN` no CLI é reservado a Project Tokens; misturar os tipos resulta em Unauthorized. Não grave o valor no código.

## Verificação

Projeto, ambiente production e serviço anki-official são definidos explicitamente no workflow. A publicação só é confirmada quando `/health` informa `ok`, motor `anki`, `runtime_version` igual à release de `UPSTREAM.lock.json` e `source_main` igual à `main` sincronizada. Após atualizar a credencial, reexecute o workflow Sync Anki Official production backend na aba Actions.
