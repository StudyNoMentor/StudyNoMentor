-- Robustez diária dos Cards — 2026-09-21
-- Aplicado ao projeto Supabase antes deste arquivo entrar no repositório.
-- Objetivos: replay idempotente do revlog, exclusão mútua do reviewer e
-- substituição transacional da coleção de cards em operações em massa.

begin;

alter table public.study_review_log
  add column if not exists review_id text;

create unique index if not exists study_review_log_review_id_uidx
  on public.study_review_log(profile_id, plan_id, review_id)
  where review_id is not null;

create table if not exists public.study_review_leases (
  profile_id uuid not null,
  plan_id text not null,
  holder_id text not null,
  lease_until timestamptz not null,
  updated_at timestamptz not null default now(),
  primary key (profile_id, plan_id),
  constraint study_review_leases_plan_fkey
    foreign key (profile_id, plan_id)
    references public.study_plans(profile_id, plan_id)
    on delete cascade
);

alter table public.study_review_leases enable row level security;

drop policy if exists study_review_leases_own on public.study_review_leases;
create policy study_review_leases_own
on public.study_review_leases
for all
to authenticated
using (public.owns_study_profile(profile_id))
with check (public.owns_study_profile(profile_id));

revoke all on table public.study_review_leases from anon;
grant select, insert, update, delete on table public.study_review_leases to authenticated;

create or replace function public.claim_study_review_lease(
  p_profile_id uuid,
  p_plan_id text,
  p_holder_id text,
  p_ttl_seconds integer default 600
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_ttl integer := greatest(60, least(coalesce(p_ttl_seconds, 600), 1800));
  v_until timestamptz := now() + make_interval(secs => v_ttl);
  v_row public.study_review_leases%rowtype;
begin
  if p_holder_id is null or length(trim(p_holder_id)) < 8 then
    raise exception 'holder_id_invalid';
  end if;

  insert into public.study_review_leases(profile_id, plan_id, holder_id, lease_until, updated_at)
  values (p_profile_id, p_plan_id, p_holder_id, v_until, now())
  on conflict (profile_id, plan_id) do update
    set holder_id = excluded.holder_id,
        lease_until = excluded.lease_until,
        updated_at = now()
    where public.study_review_leases.holder_id = excluded.holder_id
       or public.study_review_leases.lease_until <= now();

  select * into v_row
  from public.study_review_leases
  where profile_id = p_profile_id and plan_id = p_plan_id;

  return jsonb_build_object(
    'acquired', coalesce(v_row.holder_id = p_holder_id and v_row.lease_until > now(), false),
    'holder_id', v_row.holder_id,
    'lease_until', v_row.lease_until
  );
end;
$$;

create or replace function public.release_study_review_lease(
  p_profile_id uuid,
  p_plan_id text,
  p_holder_id text
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_n integer;
begin
  delete from public.study_review_leases
  where profile_id = p_profile_id
    and plan_id = p_plan_id
    and holder_id = p_holder_id;
  get diagnostics v_n = row_count;
  return v_n > 0;
end;
$$;

create or replace function public.replace_study_cards(
  p_profile_id uuid,
  p_plan_id text,
  p_rows jsonb default '[]'::jsonb
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_rows jsonb := coalesce(p_rows, '[]'::jsonb);
  v_count integer := 0;
begin
  if jsonb_typeof(v_rows) <> 'array' then
    raise exception 'p_rows_must_be_array';
  end if;
  if exists (
    select 1 from jsonb_array_elements(v_rows) r
    where (r->>'profile_id') is distinct from p_profile_id::text
       or (r->>'plan_id') is distinct from p_plan_id
  ) then
    raise exception 'row_scope_mismatch';
  end if;

  delete from public.study_cards
  where profile_id = p_profile_id and plan_id = p_plan_id;

  if jsonb_array_length(v_rows) > 0 then
    insert into public.study_cards
    select * from jsonb_populate_recordset(null::public.study_cards, v_rows);
    get diagnostics v_count = row_count;
  end if;
  return v_count;
end;
$$;

revoke all on function public.claim_study_review_lease(uuid,text,text,integer) from public, anon;
revoke all on function public.release_study_review_lease(uuid,text,text) from public, anon;
revoke all on function public.replace_study_cards(uuid,text,jsonb) from public, anon;
grant execute on function public.claim_study_review_lease(uuid,text,text,integer) to authenticated;
grant execute on function public.release_study_review_lease(uuid,text,text) to authenticated;
grant execute on function public.replace_study_cards(uuid,text,jsonb) to authenticated;

commit;
