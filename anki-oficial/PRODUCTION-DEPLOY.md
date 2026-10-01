# Publicação do backend oficial

O workflow `.github/workflows/sync-anki-official-production.yml` sincroniza a árvore da main para a branch conectada ao Railway e executa `railway redeploy --from-source`. Um redeploy comum reutiliza o commit do deploy anterior; sincronizar uma branch sozinho não confirma publicação.

## Configuração

Crie um Project Token no projeto Railway `studynomentor-anki-official`, ambiente `production`. Salve-o no secret de Actions `RAILWAY_TOKEN` em https://github.com/StudyNoMentor/StudyNoMentor/settings/secrets/actions. Não use variáveis públicas nem grave o token no repositório. O workflow valida sua presença antes de sincronizar a branch.

## Verificação e recuperação

O destino é o serviço `anki-official` no projeto e ambiente explicitamente definidos no workflow. O workflow só conclui com sucesso quando `/health` confirma `ok`, motor `anki`, runtime `26.09.3` e `source_main` igual à main sincronizada. O retorno do comando Railway só confirma o disparo.

Depois de configurar ou corrigir o secret, execute novamente o workflow “Sync Anki Official production backend” pela aba Actions. A sincronização preserva o histórico e é idempotente. Mesmo quando a branch já está sincronizada, o disparo explícito busca a fonte atual.
