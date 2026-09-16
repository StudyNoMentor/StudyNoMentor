-- TEC reconciliation v3: identidade canônica para consolidação multidispositivo.
--
-- A chave não substitui event_id: event_id continua sendo a identidade física da
-- linha; canonical_attempt_key identifica o mesmo fato pedagógico quando ele chega
-- por fontes diferentes (captura ao vivo, reconstrução ou outro dispositivo).

alter table public.tec_resolution_events
  add column if not exists canonical_attempt_key text,
  add column if not exists resolution_ref text,
  add column if not exists date_precision text,
  add column if not exists date_source text,
  add column if not exists reconciled_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname='tec_events_date_precision_ck') then
    alter table public.tec_resolution_events
      add constraint tec_events_date_precision_ck
      check (date_precision is null or date_precision in ('day','instant'));
  end if;
  if not exists (select 1 from pg_constraint where conname='tec_events_canonical_attempt_uk') then
    alter table public.tec_resolution_events
      add constraint tec_events_canonical_attempt_uk
      unique (profile_id, canonical_attempt_key);
  end if;
end $$;

create index if not exists tec_resolution_events_profile_book_question_idx
  on public.tec_resolution_events(profile_id, book_id, question_id);
create index if not exists tec_resolution_events_profile_resolution_ref_idx
  on public.tec_resolution_events(profile_id, resolution_ref)
  where resolution_ref is not null;

comment on column public.tec_resolution_events.canonical_attempt_key is
  'Identidade semântica v3 do mesmo fato TEC entre captura ao vivo/reconstrução/dispositivos.';
comment on column public.tec_resolution_events.resolution_ref is
  'ID da resolução no TEC quando a interface o expõe de forma verificável.';
comment on column public.tec_resolution_events.date_precision is
  'Precisão temporal disponível: day quando só o Gabarito informa a data; instant quando há timestamp.';
comment on column public.tec_resolution_events.date_source is
  'Proveniência da data: TEC/Gabarito/histórico ou captura local.';
