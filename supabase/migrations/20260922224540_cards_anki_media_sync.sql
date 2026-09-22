-- Anki-style media sync for Cards.
-- Bytes are kept in the relational backend so media can follow the same
-- profile/plan ownership model as cards and review history. Tombstones
-- propagate deletions without resurrecting files on another device.
create table if not exists public.study_anki_media (
  profile_id uuid not null,
  plan_id text not null,
  media_name text not null,
  mime text not null default '',
  fingerprint text not null default '',
  size_bytes bigint not null default 0,
  content_b64 text,
  deleted_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (profile_id, plan_id, media_name),
  constraint study_anki_media_plan_fkey
    foreign key (profile_id, plan_id)
    references public.study_plans(profile_id, plan_id)
    on delete cascade
);

create index if not exists study_anki_media_updated_idx
  on public.study_anki_media(profile_id, plan_id, updated_at);

alter table public.study_anki_media enable row level security;

drop policy if exists study_anki_media_own on public.study_anki_media;
create policy study_anki_media_own
  on public.study_anki_media
  for all
  to authenticated
  using (public.owns_study_profile(profile_id))
  with check (public.owns_study_profile(profile_id));

grant select, insert, update, delete on public.study_anki_media to authenticated;
revoke all on public.study_anki_media from anon;
