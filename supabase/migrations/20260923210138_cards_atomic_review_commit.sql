-- Anki-style durable review commit.
-- Generated from the production migration 20260923210138.

CREATE OR REPLACE FUNCTION public.commit_study_review_atomic(p_review jsonb, p_card_before jsonb, p_card_after jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_profile uuid;
  v_plan text;
  v_card_id text;
  v_review_id text;
  v_current public.study_cards%rowtype;
  v_exists boolean := false;
  v_before boolean := false;
  v_after boolean := false;
  v_sched_extra jsonb := '{}'::jsonb;
begin
  if jsonb_typeof(p_review) <> 'object'
     or jsonb_typeof(p_card_before) <> 'object'
     or jsonb_typeof(p_card_after) <> 'object' then
    raise exception 'invalid_review_payload';
  end if;

  v_profile := nullif(p_review->>'profile_id','')::uuid;
  v_plan := p_review->>'plan_id';
  v_card_id := p_review->>'card_id';
  v_review_id := p_review->>'review_id';

  if v_profile is null or coalesce(v_plan,'') = '' or coalesce(v_card_id,'') = ''
     or coalesce(v_review_id,'') = '' then
    raise exception 'invalid_review_scope';
  end if;
  if not public.owns_study_profile(v_profile) then
    raise exception 'review_profile_forbidden' using errcode = '42501';
  end if;
  if (p_card_before->>'profile_id') is distinct from v_profile::text
     or (p_card_after->>'profile_id') is distinct from v_profile::text
     or (p_card_before->>'plan_id') is distinct from v_plan
     or (p_card_after->>'plan_id') is distinct from v_plan
     or (p_card_before->>'card_id') is distinct from v_card_id
     or (p_card_after->>'card_id') is distinct from v_card_id then
    raise exception 'review_scope_mismatch';
  end if;

  select * into v_current
  from public.study_cards
  where profile_id = v_profile and plan_id = v_plan and card_id = v_card_id
  for update;

  if not found then
    raise exception 'review_card_missing';
  end if;

  v_before :=
    v_current.deck_id is not distinct from (p_card_before->>'deck_id') and
    v_current.due is not distinct from (p_card_before->>'due') and
    v_current.due_ts is not distinct from nullif(p_card_before->>'due_ts','')::bigint and
    v_current.ease is not distinct from nullif(p_card_before->>'ease','')::numeric and
    v_current.interval_value is not distinct from nullif(p_card_before->>'interval_value','')::numeric and
    v_current.lapses is not distinct from nullif(p_card_before->>'lapses','')::integer and
    v_current.learn_step is not distinct from nullif(p_card_before->>'learn_step','')::integer and
    v_current.reps is not distinct from nullif(p_card_before->>'reps','')::integer and
    v_current.phase is not distinct from (p_card_before->>'phase') and
    v_current.d is not distinct from nullif(p_card_before->>'d','')::numeric and
    v_current.s is not distinct from nullif(p_card_before->>'s','')::numeric and
    v_current.algo is not distinct from (p_card_before->>'algo') and
    v_current.last_review is not distinct from (p_card_before->>'last_review') and
    (coalesce(v_current.extra,'{}'::jsonb)->'originalDeckId') is not distinct from (coalesce(p_card_before->'extra','{}'::jsonb)->'originalDeckId') and
    (coalesce(v_current.extra,'{}'::jsonb)->'originalDue') is not distinct from (coalesce(p_card_before->'extra','{}'::jsonb)->'originalDue') and
    (coalesce(v_current.extra,'{}'::jsonb)->'originalDueTs') is not distinct from (coalesce(p_card_before->'extra','{}'::jsonb)->'originalDueTs') and
    (coalesce(v_current.extra,'{}'::jsonb)->'originalPhase') is not distinct from (coalesce(p_card_before->'extra','{}'::jsonb)->'originalPhase') and
    (coalesce(v_current.extra,'{}'::jsonb)->'filteredPosition') is not distinct from (coalesce(p_card_before->'extra','{}'::jsonb)->'filteredPosition') and
    (coalesce(v_current.extra,'{}'::jsonb)->'filteredReschedule') is not distinct from (coalesce(p_card_before->'extra','{}'::jsonb)->'filteredReschedule') and
    (coalesce(v_current.extra,'{}'::jsonb)->'filteredDeckId') is not distinct from (coalesce(p_card_before->'extra','{}'::jsonb)->'filteredDeckId');

  v_after :=
    v_current.deck_id is not distinct from (p_card_after->>'deck_id') and
    v_current.due is not distinct from (p_card_after->>'due') and
    v_current.due_ts is not distinct from nullif(p_card_after->>'due_ts','')::bigint and
    v_current.ease is not distinct from nullif(p_card_after->>'ease','')::numeric and
    v_current.interval_value is not distinct from nullif(p_card_after->>'interval_value','')::numeric and
    v_current.lapses is not distinct from nullif(p_card_after->>'lapses','')::integer and
    v_current.learn_step is not distinct from nullif(p_card_after->>'learn_step','')::integer and
    v_current.reps is not distinct from nullif(p_card_after->>'reps','')::integer and
    v_current.phase is not distinct from (p_card_after->>'phase') and
    v_current.d is not distinct from nullif(p_card_after->>'d','')::numeric and
    v_current.s is not distinct from nullif(p_card_after->>'s','')::numeric and
    v_current.algo is not distinct from (p_card_after->>'algo') and
    v_current.last_review is not distinct from (p_card_after->>'last_review') and
    (coalesce(v_current.extra,'{}'::jsonb)->'originalDeckId') is not distinct from (coalesce(p_card_after->'extra','{}'::jsonb)->'originalDeckId') and
    (coalesce(v_current.extra,'{}'::jsonb)->'originalDue') is not distinct from (coalesce(p_card_after->'extra','{}'::jsonb)->'originalDue') and
    (coalesce(v_current.extra,'{}'::jsonb)->'originalDueTs') is not distinct from (coalesce(p_card_after->'extra','{}'::jsonb)->'originalDueTs') and
    (coalesce(v_current.extra,'{}'::jsonb)->'originalPhase') is not distinct from (coalesce(p_card_after->'extra','{}'::jsonb)->'originalPhase') and
    (coalesce(v_current.extra,'{}'::jsonb)->'filteredPosition') is not distinct from (coalesce(p_card_after->'extra','{}'::jsonb)->'filteredPosition') and
    (coalesce(v_current.extra,'{}'::jsonb)->'filteredReschedule') is not distinct from (coalesce(p_card_after->'extra','{}'::jsonb)->'filteredReschedule') and
    (coalesce(v_current.extra,'{}'::jsonb)->'filteredDeckId') is not distinct from (coalesce(p_card_after->'extra','{}'::jsonb)->'filteredDeckId');

  select exists(
    select 1 from public.study_review_log
    where profile_id = v_profile and plan_id = v_plan and review_id = v_review_id
  ) into v_exists;

  if v_exists and v_after then
    return jsonb_build_object('status','duplicate','review_id',v_review_id);
  end if;

  if not v_before then
    return jsonb_build_object(
      'status','conflict','review_id',v_review_id,
      'remote_reps',v_current.reps,
      'expected_reps',nullif(p_card_before->>'reps','')::integer
    );
  end if;

  if not v_exists then
    insert into public.study_review_log(
      profile_id,plan_id,review_id,card_id,ts,review_date,correct,grade,elapsed,
      phase,interval_value,d,s,position,extra
    ) values (
      v_profile,v_plan,v_review_id,nullif(p_review->>'card_id',''),
      nullif(p_review->>'ts','')::bigint,p_review->>'review_date',
      nullif(p_review->>'correct','')::boolean,nullif(p_review->>'grade','')::numeric,
      nullif(p_review->>'elapsed','')::numeric,p_review->>'phase',
      nullif(p_review->>'interval_value','')::numeric,
      nullif(p_review->>'d','')::numeric,nullif(p_review->>'s','')::numeric,
      coalesce(nullif(p_review->>'position','')::integer,1),
      coalesce(p_review->'extra','{}'::jsonb)
    )
    on conflict (profile_id,plan_id,review_id) do nothing;
  end if;

  select coalesce(jsonb_object_agg(key,value),'{}'::jsonb)
  into v_sched_extra
  from jsonb_each(coalesce(p_card_after->'extra','{}'::jsonb))
  where key = any(array[
    'originalDeckId','originalDue','originalDueTs','originalPhase',
    'filteredPosition','filteredReschedule','filteredDeckId',
    'firstReviewAt','leech','suspenso','ankiMod'
  ]);

  update public.study_cards
  set deck_id = p_card_after->>'deck_id',
      status = p_card_after->>'status',
      due = p_card_after->>'due',
      due_ts = nullif(p_card_after->>'due_ts','')::bigint,
      ease = nullif(p_card_after->>'ease','')::numeric,
      interval_value = nullif(p_card_after->>'interval_value','')::numeric,
      lapses = nullif(p_card_after->>'lapses','')::integer,
      learn_step = nullif(p_card_after->>'learn_step','')::integer,
      reps = nullif(p_card_after->>'reps','')::integer,
      phase = p_card_after->>'phase',
      d = nullif(p_card_after->>'d','')::numeric,
      s = nullif(p_card_after->>'s','')::numeric,
      algo = p_card_after->>'algo',
      last_review = p_card_after->>'last_review',
      updated_at = coalesce(nullif(p_card_after->>'updated_at','')::timestamptz, now()),
      extra = coalesce(v_current.extra,'{}'::jsonb) || v_sched_extra
  where profile_id = v_profile and plan_id = v_plan and card_id = v_card_id;

  return jsonb_build_object(
    'status',case when v_exists then 'repaired' else 'committed' end,
    'review_id',v_review_id
  );
end;
$function$


revoke all on function public.commit_study_review_atomic(jsonb,jsonb,jsonb) from public;
revoke all on function public.commit_study_review_atomic(jsonb,jsonb,jsonb) from anon;
grant execute on function public.commit_study_review_atomic(jsonb,jsonb,jsonb) to authenticated;
