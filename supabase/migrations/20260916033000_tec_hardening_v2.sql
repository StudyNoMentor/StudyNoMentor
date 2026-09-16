-- TEC hardening v2: confiança/proveniência, pull incremental e quota global da IA.

alter table public.tec_resolution_events
  add column if not exists trust_status text not null default 'legacy-unverified',
  add column if not exists confidence text,
  add column if not exists capture_engine_version text,
  add column if not exists companion_version text,
  add column if not exists site_build text,
  add column if not exists device_id text,
  add column if not exists tab_session_id text,
  add column if not exists capture_strategy text,
  add column if not exists evidence_hash text;

-- Todo dado anterior à captura factual v2 é histórico, nunca evidência prescritiva.
update public.tec_resolution_events
set trust_status = 'legacy-unverified', confidence = null
where capture_engine_version is null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname='tec_events_marked_letter_ck') then
    alter table public.tec_resolution_events
      add constraint tec_events_marked_letter_ck check (marcada is null or marcada in ('A','B','C','D','E'));
  end if;
  if not exists (select 1 from pg_constraint where conname='tec_events_correct_letter_ck') then
    alter table public.tec_resolution_events
      add constraint tec_events_correct_letter_ck check (correta is null or correta in ('A','B','C','D','E'));
  end if;
  if not exists (select 1 from pg_constraint where conname='tec_events_trust_status_ck') then
    alter table public.tec_resolution_events
      add constraint tec_events_trust_status_ck check (trust_status in ('verified','observed','unverified','legacy-unverified'));
  end if;
  if not exists (select 1 from pg_constraint where conname='tec_events_confidence_ck') then
    alter table public.tec_resolution_events
      add constraint tec_events_confidence_ck check (confidence is null or confidence in ('high','medium','low'));
  end if;
  if not exists (select 1 from pg_constraint where conname='tec_events_verified_invariant_ck') then
    alter table public.tec_resolution_events
      add constraint tec_events_verified_invariant_ck check (
        trust_status <> 'verified' or
        (marcada is not null and correta is not null and confidence='high' and acertou=(marcada=correta))
      );
  end if;
end $$;

create index if not exists tec_resolution_events_profile_created_event_idx
  on public.tec_resolution_events(profile_id, created_at, event_id);

-- RLS equivalente à anterior, mas auth.uid() vira initplan único por consulta.
drop policy if exists tec_events_select_own on public.tec_resolution_events;
drop policy if exists tec_events_insert_own on public.tec_resolution_events;
drop policy if exists tec_events_update_own on public.tec_resolution_events;
drop policy if exists tec_events_delete_own on public.tec_resolution_events;

create policy tec_events_select_own on public.tec_resolution_events
for select to authenticated
using (
  (select auth.uid()) = user_id and exists (
    select 1 from public.study_profiles p
    where p.id=tec_resolution_events.profile_id and p.user_id=(select auth.uid())
  )
);
create policy tec_events_insert_own on public.tec_resolution_events
for insert to authenticated
with check (
  (select auth.uid()) = user_id and exists (
    select 1 from public.study_profiles p
    where p.id=tec_resolution_events.profile_id and p.user_id=(select auth.uid())
  )
);
-- UPDATE permanece durante a implantação compatível; será retirado após o app v2 entrar em main.
create policy tec_events_update_own on public.tec_resolution_events
for update to authenticated
using (
  (select auth.uid()) = user_id and exists (
    select 1 from public.study_profiles p
    where p.id=tec_resolution_events.profile_id and p.user_id=(select auth.uid())
  )
)
with check (
  (select auth.uid()) = user_id and exists (
    select 1 from public.study_profiles p
    where p.id=tec_resolution_events.profile_id and p.user_id=(select auth.uid())
  )
);
create policy tec_events_delete_own on public.tec_resolution_events
for delete to authenticated
using (
  (select auth.uid()) = user_id and exists (
    select 1 from public.study_profiles p
    where p.id=tec_resolution_events.profile_id and p.user_id=(select auth.uid())
  )
);

-- Quota global e atômica para a Edge Function. Não é diretamente legível pelo cliente.
create table if not exists public.tec_ai_rate_windows (
  user_id uuid primary key references auth.users(id) on delete cascade,
  window_started_at timestamptz not null default now(),
  hits integer not null default 0 check (hits >= 0),
  updated_at timestamptz not null default now()
);
alter table public.tec_ai_rate_windows enable row level security;
revoke all on table public.tec_ai_rate_windows from public, anon, authenticated;

create or replace function public.consume_tec_ai_quota(p_max_hits integer default 12, p_window_seconds integer default 60)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid := (select auth.uid());
  v_hits integer;
  v_now timestamptz := clock_timestamp();
begin
  if v_uid is null then return false; end if;
  p_max_hits := greatest(1, least(coalesce(p_max_hits,12), 120));
  p_window_seconds := greatest(10, least(coalesce(p_window_seconds,60), 3600));

  insert into public.tec_ai_rate_windows(user_id,window_started_at,hits,updated_at)
  values(v_uid,v_now,1,v_now)
  on conflict(user_id) do update
  set
    hits = case
      when v_now - public.tec_ai_rate_windows.window_started_at >= make_interval(secs => p_window_seconds) then 1
      else public.tec_ai_rate_windows.hits + 1
    end,
    window_started_at = case
      when v_now - public.tec_ai_rate_windows.window_started_at >= make_interval(secs => p_window_seconds) then v_now
      else public.tec_ai_rate_windows.window_started_at
    end,
    updated_at = v_now
  returning hits into v_hits;

  return v_hits <= p_max_hits;
end;
$$;
revoke all on function public.consume_tec_ai_quota(integer,integer) from public, anon;
grant execute on function public.consume_tec_ai_quota(integer,integer) to authenticated;

-- Event trigger administrativo não deve ser invocável via RPC por usuários.
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
