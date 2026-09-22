-- Durable/idempotent review identity for Cards.
-- Existing rows receive the same deterministic legacy id that the client
-- derives when replaying pre-outbox pending reviews.
update public.study_review_log
set review_id =
  'legacy:' || coalesce(card_id,'') || '|' ||
  coalesce(ts::text,'') || '|' || position::text
where review_id is null;

drop index if exists public.study_review_log_review_id_uidx;

alter table public.study_review_log
  alter column review_id set not null;

create unique index study_review_log_review_id_uidx
  on public.study_review_log(profile_id, plan_id, review_id);

-- position remains an ordering hint, not an identity. Two offline devices may
-- legitimately generate the same local position before synchronization.
drop index if exists public.study_review_log_profile_plan_position_uidx;

create index if not exists study_review_log_profile_plan_position_idx
  on public.study_review_log(profile_id, plan_id, position);
