-- StudyNoMentor: Diário normalizado e cloud-authoritative
-- 1 registro de estudo = 1 linha. O JSONB abaixo guarda apenas os campos do registro,
-- não o Diário inteiro. Exclusão é lógica para que Realtime receba UPDATE filtrável.

create table if not exists public.study_entries (
  profile_id uuid not null references public.study_profiles(id) on delete cascade,
  plan_id text not null,
  entry_id text not null,
  data jsonb not null check (jsonb_typeof(data) = 'object'),
  rev bigint not null default 1 check (rev >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  sort_key bigint not null default ((extract(epoch from clock_timestamp()) * 1000)::bigint),
  last_mutation_id text,
  source_session_id text,
  primary key (profile_id, plan_id, entry_id)
);

create index if not exists study_entries_profile_plan_active_idx
  on public.study_entries(profile_id, plan_id, sort_key)
  where deleted_at is null;

create index if not exists study_entries_profile_updated_idx
  on public.study_entries(profile_id, updated_at desc);

alter table public.study_entries enable row level security;

drop policy if exists study_entries_owner_select on public.study_entries;
create policy study_entries_owner_select
on public.study_entries
for select
to authenticated
using (
  exists (
    select 1
    from public.study_profiles p
    where p.id = study_entries.profile_id
      and p.user_id = (select auth.uid())
  )
);

-- Escritas do cliente passam pelas RPCs abaixo. SELECT é suficiente para leitura
-- e para a autorização dos eventos Realtime.
revoke all on public.study_entries from anon;
revoke insert, update, delete on public.study_entries from authenticated;
grant select on public.study_entries to authenticated;

create or replace function public.upsert_study_entry(
  p_profile_id uuid,
  p_plan_id text,
  p_entry_id text,
  p_data jsonb,
  p_mutation_id text,
  p_session_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.study_entries%rowtype;
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_profile_id is null
     or nullif(btrim(p_plan_id), '') is null
     or nullif(btrim(p_entry_id), '') is null
     or p_data is null
     or jsonb_typeof(p_data) <> 'object'
     or nullif(btrim(p_mutation_id), '') is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid-arguments');
  end if;
  if not exists (
    select 1 from public.study_profiles p
    where p.id = p_profile_id and p.user_id = v_uid
  ) then
    raise exception 'profile not owned by current user' using errcode = '42501';
  end if;

  select *
    into v_row
  from public.study_entries
  where profile_id = p_profile_id
    and plan_id = p_plan_id
    and entry_id = p_entry_id
  for update;

  if found then
    if v_row.last_mutation_id is not distinct from p_mutation_id then
      return jsonb_build_object(
        'ok', true, 'rev', v_row.rev, 'duplicate', true,
        'deleted', v_row.deleted_at is not null
      );
    end if;

    -- Uma aba velha nunca pode ressuscitar um registro já excluído.
    -- Restauração de backup usa replace_study_entries(), explicitamente.
    if v_row.deleted_at is not null then
      return jsonb_build_object(
        'ok', false, 'reason', 'deleted', 'deleted', true, 'rev', v_row.rev
      );
    end if;

    update public.study_entries
       set data = p_data,
           rev = rev + 1,
           updated_at = now(),
           last_mutation_id = p_mutation_id,
           source_session_id = p_session_id
     where profile_id = p_profile_id
       and plan_id = p_plan_id
       and entry_id = p_entry_id
    returning * into v_row;
  else
    insert into public.study_entries(
      profile_id, plan_id, entry_id, data, rev,
      created_at, updated_at, deleted_at, sort_key,
      last_mutation_id, source_session_id
    )
    values(
      p_profile_id, p_plan_id, p_entry_id, p_data, 1,
      now(), now(), null,
      (extract(epoch from clock_timestamp()) * 1000)::bigint,
      p_mutation_id, p_session_id
    )
    returning * into v_row;
  end if;

  return jsonb_build_object('ok', true, 'rev', v_row.rev, 'deleted', false);
end;
$$;

create or replace function public.soft_delete_study_entry(
  p_profile_id uuid,
  p_plan_id text,
  p_entry_id text,
  p_mutation_id text,
  p_session_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.study_entries%rowtype;
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_profile_id is null
     or nullif(btrim(p_plan_id), '') is null
     or nullif(btrim(p_entry_id), '') is null
     or nullif(btrim(p_mutation_id), '') is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid-arguments');
  end if;
  if not exists (
    select 1 from public.study_profiles p
    where p.id = p_profile_id and p.user_id = v_uid
  ) then
    raise exception 'profile not owned by current user' using errcode = '42501';
  end if;

  select *
    into v_row
  from public.study_entries
  where profile_id = p_profile_id
    and plan_id = p_plan_id
    and entry_id = p_entry_id
  for update;

  -- Excluir algo que já não existe é sucesso idempotente.
  if not found then
    return jsonb_build_object('ok', true, 'absent', true, 'deleted', true);
  end if;
  if v_row.deleted_at is not null then
    return jsonb_build_object('ok', true, 'rev', v_row.rev, 'deleted', true);
  end if;

  update public.study_entries
     set deleted_at = now(),
         rev = rev + 1,
         updated_at = now(),
         last_mutation_id = p_mutation_id,
         source_session_id = p_session_id
   where profile_id = p_profile_id
     and plan_id = p_plan_id
     and entry_id = p_entry_id
  returning * into v_row;

  return jsonb_build_object('ok', true, 'rev', v_row.rev, 'deleted', true);
end;
$$;

-- Restauração/importação: substitui explicitamente a projeção do Diário do perfil.
-- Esse é o ÚNICO caminho autorizado a reabrir um entry_id que estava excluído.
create or replace function public.replace_study_entries(
  p_profile_id uuid,
  p_rows jsonb,
  p_mutation_id text,
  p_session_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_item jsonb;
  v_plan text;
  v_entry text;
  v_data jsonb;
  v_count integer := 0;
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_profile_id is null
     or p_rows is null
     or jsonb_typeof(p_rows) <> 'array'
     or nullif(btrim(p_mutation_id), '') is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid-arguments');
  end if;
  if not exists (
    select 1 from public.study_profiles p
    where p.id = p_profile_id and p.user_id = v_uid
  ) then
    raise exception 'profile not owned by current user' using errcode = '42501';
  end if;

  -- Primeiro marca a projeção anterior como excluída; tudo ocorre na mesma transação.
  update public.study_entries
     set deleted_at = coalesce(deleted_at, now()),
         rev = rev + case when deleted_at is null then 1 else 0 end,
         updated_at = case when deleted_at is null then now() else updated_at end,
         last_mutation_id = case when deleted_at is null then p_mutation_id else last_mutation_id end,
         source_session_id = case when deleted_at is null then p_session_id else source_session_id end
   where profile_id = p_profile_id;

  for v_item in select value from jsonb_array_elements(p_rows)
  loop
    v_plan := nullif(btrim(v_item->>'plan_id'), '');
    v_entry := nullif(btrim(v_item->>'entry_id'), '');
    v_data := v_item->'data';
    if v_plan is null or v_entry is null or v_data is null or jsonb_typeof(v_data) <> 'object' then
      continue;
    end if;

    insert into public.study_entries(
      profile_id, plan_id, entry_id, data, rev,
      created_at, updated_at, deleted_at, sort_key,
      last_mutation_id, source_session_id
    )
    values(
      p_profile_id, v_plan, v_entry, v_data, 1,
      now(), now(), null,
      coalesce((v_item->>'sort_key')::bigint, (extract(epoch from clock_timestamp()) * 1000)::bigint),
      p_mutation_id, p_session_id
    )
    on conflict (profile_id, plan_id, entry_id) do update
       set data = excluded.data,
           deleted_at = null,
           rev = public.study_entries.rev + 1,
           updated_at = now(),
           sort_key = excluded.sort_key,
           last_mutation_id = p_mutation_id,
           source_session_id = p_session_id;
    v_count := v_count + 1;
  end loop;

  return jsonb_build_object('ok', true, 'rows', v_count);
end;
$$;

revoke all on function public.upsert_study_entry(uuid,text,text,jsonb,text,text) from public;
revoke all on function public.soft_delete_study_entry(uuid,text,text,text,text) from public;
revoke all on function public.replace_study_entries(uuid,jsonb,text,text) from public;
grant execute on function public.upsert_study_entry(uuid,text,text,jsonb,text,text) to authenticated;
grant execute on function public.soft_delete_study_entry(uuid,text,text,text,text) to authenticated;
grant execute on function public.replace_study_entries(uuid,jsonb,text,text) to authenticated;

-- Backfill idempotente a partir do formato legado profile_sections/p:<plano>:entries.
insert into public.study_entries(
  profile_id, plan_id, entry_id, data, rev,
  created_at, updated_at, deleted_at, sort_key,
  last_mutation_id, source_session_id
)
select
  ps.profile_id,
  substring(ps.section from '^p:(.+):entries$') as plan_id,
  e.value->>'id' as entry_id,
  e.value as data,
  1,
  coalesce(ps.updated_at, now()),
  coalesce(ps.updated_at, now()),
  null,
  e.ord::bigint,
  'legacy-backfill',
  ps.device_id
from public.profile_sections ps
cross join lateral jsonb_array_elements(
  case when jsonb_typeof(ps.data) = 'array' then ps.data else '[]'::jsonb end
) with ordinality as e(value, ord)
where ps.section ~ '^p:.+:entries$'
  and nullif(e.value->>'id', '') is not null
on conflict (profile_id, plan_id, entry_id) do nothing;

-- Realtime: INSERT/UPDATE são filtráveis por profile_id; DELETE físico não é usado.
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'study_entries'
  ) then
    alter publication supabase_realtime add table public.study_entries;
  end if;
end $$;
