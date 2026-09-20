# Banco de dados — arquitetura relacional atual

> Estado validado em 20/09/2026 após a migração completa para PostgreSQL relacional.

O StudyNoMentor usa o Supabase/PostgreSQL como **fonte persistente única dos dados de estudo**. O navegador mantém apenas a projeção em RAM necessária para as telas síncronas. Dados de perfil não são reidratados de IndexedDB/localStorage.

## Princípios

- O estado operacional vive em tabelas relacionais `study_*`.
- `study_profiles` guarda somente metadados do perfil. Não existe mais blob `payload` nem revisão monolítica `rev`.
- Escritas por entidade passam por `RelationalStore` e pelas RPCs relacionais.
- Abertura de perfil faz SELECT/hidratação canônica do PostgreSQL.
- Catch-up entre aparelhos usa `study_change_log`.
- Realtime publica somente as tabelas necessárias ao modelo atual.
- Histórico durável é separado do estado operacional em `profile_backups`.
- Exportação manual em .json continua disponível, mas não é a fonte do app.

## Tabelas operacionais

### Perfil e planejamento

- `study_profiles` — metadados do perfil, plano ativo e PIN.
- `study_plans` — planejamentos.
- `study_plan_state` — estado chave/valor específico de um planejamento.
- `study_profile_settings` — preferências/estado de perfil sem escopo de plano.
- `user_preferences` — preferências da conta.

### Conteúdo de estudo

- `study_subjects`
- `study_methods`
- `study_phases`
- `study_modes`
- `study_statuses`
- `study_entries`
- `study_track_items`
- `study_cycle_history`
- `study_saved_grades`
- `study_custom_siglas`
- `study_decks`
- `study_cards`
- `study_review_log`
- `study_laws`
- `study_law_keywords`
- `study_links`
- `study_extras`

### TEC

- `study_tec_snapshots`
- `study_tec_snapshot_rows`
- `study_incidence`
- `tec_resolution_events`
- `tec_ai_rate_windows`

### Sincronização e backup

- `study_change_log` — log incremental usado para catch-up entre aparelhos.
- `profile_backups` — fotos imutáveis/comprimidas do perfil para recuperação histórica.

## RPCs relacionais

As RPCs públicas relevantes ao fluxo atual são:

- `mutate_study_plan_rows(...)`
- `mutate_study_plans(...)`
- `replace_study_plan_rows(...)`
- `replace_study_tec(...)`
- `read_study_profile_core(...)`
- `read_study_profile_heavy(...)`
- `read_study_change_summary(...)`
- `owns_study_profile(...)`

As funções internas `log_study_profile_change()` e `log_study_table_change()` alimentam o log de mudanças. Não devem ser transformadas em API de negócio.

## Realtime

A publicação `supabase_realtime` contém somente:

- `study_profiles`
- `study_change_log`
- `tec_resolution_events`

Adicionar tabelas à publicação deve ser uma decisão explícita. Tabela criada no PostgreSQL não precisa automaticamente de Realtime.

## Objetos aposentados

Os objetos abaixo pertenciam às arquiteturas blob/seções/sessão exclusiva e **não fazem parte do modelo atual**:

- `public.profile_sections`
- `public.cloud_profiles`
- `public.active_sessions`
- `private.profile_section_tombstones`
- `public.write_profile_section_cas(...)`
- `public.delete_profile_section_cas(...)`
- implementações CAS privadas e trigger de revisão de `profile_sections`
- colunas `study_profiles.payload` e `study_profiles.rev`
- `SectionSync`
- `SessionLock` / `SessionGuard`
- histórico persistente local (`BackupHistory`)
- tela/módulo de recuperação local legado

Não recrie esses objetos para resolver problemas de sincronização. A correção deve acontecer nas tabelas relacionais, RPCs atuais ou no fluxo de hidratação/catch-up.

## Backups de migração preservados

A limpeza operacional **não apaga** os snapshots de segurança:

- schema `migration_backup_20260919`
- `private.legacy_snapshot_20260919`
- `public.profile_backups`

O schema `migration_backup_20260919` e `private.legacy_snapshot_20260919` são históricos de migração, não fontes operacionais. Não devem ser lidos pelo frontend.

Antes da limpeza final dos objetos legados foi capturada uma segunda fotografia em `private.legacy_snapshot_20260919`, preservando inclusive a versão mais recente de `profile_sections`.

## Fluxo do cliente

1. Login autentica no Supabase.
2. `CloudStore.listProfiles()` lê metadados de `study_profiles`.
3. Ao entrar no perfil, `RelationalStore.hydrateProfile()` lê o núcleo relacional.
4. Blocos pesados de TEC/incidência são carregados conforme necessidade.
5. Mutações atualizam a projeção em RAM e entram na fila do `RelationalStore`.
6. `RelationalStore.flush()` confirma a persistência SQL.
7. `study_change_log` permite detectar/capturar alterações feitas em outro aparelho.

Nenhum passo depende de `profile_sections`, blob de perfil ou cache persistente local.

## Backup histórico

`profile_backups` é deliberadamente separado das tabelas operacionais:

- fotos imutáveis;
- âncora permanente;
- foto diária;
- retenção em faixas;
- foto antes de operações de risco;
- restauração via `RelationalStore.replaceProfileFromPayload()`.

Restaurar um backup transforma a foto novamente em linhas relacionais. A foto não volta a ser um blob operacional.

## Consultas rápidas de auditoria

### Confirmar que o legado não voltou

```sql
select n.nspname as schema_name, c.relname
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname in ('public','private')
  and c.relname in (
    'profile_sections',
    'cloud_profiles',
    'active_sessions',
    'profile_section_tombstones'
  );
```

O resultado esperado é vazio.

### Confirmar a forma de `study_profiles`

```sql
select column_name, data_type
from information_schema.columns
where table_schema = 'public'
  and table_name = 'study_profiles'
order by ordinal_position;
```

As colunas operacionais esperadas são: `id`, `user_id`, `profile_name`, `avatar`, `color`, `updated_at`, `created_at`, `active_plan_id` e `pin_hash`.

### Confirmar Realtime

```sql
select tablename
from pg_publication_tables
where pubname = 'supabase_realtime'
  and schemaname = 'public'
order by tablename;
```

Para o fluxo atual, o conjunto esperado é `study_change_log`, `study_profiles` e `tec_resolution_events`.

## Regra de manutenção

Qualquer mudança futura de banco deve preservar três invariantes:

1. PostgreSQL continua sendo a fonte persistente única.
2. O frontend não ganha uma segunda autoridade local.
3. Migrações destrutivas só acontecem depois de snapshot e validação de paridade.
