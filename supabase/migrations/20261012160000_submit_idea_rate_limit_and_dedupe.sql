-- A2: add a per-participant submission rate limit and permanent content
-- de-duplication to submit_idea. Rejected submissions (duplicate or rate
-- limited) never insert a row, so they do not consume quota. The function
-- stays SECURITY DEFINER with an empty search_path and the same grants.
--
-- Concurrency relies on READ COMMITTED (PostgreSQL default, verified locally):
-- the transaction-level advisory lock serializes submissions that share the
-- same (activity, participant) identity, so the duplicate check and the window
-- count always observe the latest committed rows.
--
-- Content is compared after normalization: outer spaces trimmed, runs of ASCII
-- whitespace collapsed to one space and case ignored. Accents, punctuation and
-- emojis are preserved; non-ASCII whitespace (for example NBSP) is not
-- normalized.
--
-- The return type changes, so the function must be dropped and recreated;
-- CREATE OR REPLACE cannot alter OUT columns.

drop function public.submit_idea(text, text, text, text, text);

create function public.submit_idea(
  activity_code text,
  participant_first_name text,
  participant_last_name text,
  participant_email text,
  idea_content text
)
returns table (outcome text, idea_id uuid, idea_status public.idea_status)
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_activity_id uuid;
  target_participant_id uuid;
  normalized_content text;
  existing_idea_id uuid;
  recent_idea_count integer;
  created_idea_id uuid;
  created_idea_status public.idea_status;
  max_ideas_per_window constant integer := 5;
  window_seconds constant integer := 60;
begin
  if char_length(btrim(coalesce(participant_first_name, ''))) not between 1 and 100
    or char_length(btrim(coalesce(participant_last_name, ''))) not between 1 and 100
    or char_length(btrim(coalesce(participant_email, ''))) not between 3 and 254
    or position('@' in btrim(participant_email)) <= 1
    or char_length(btrim(coalesce(idea_content, ''))) not between 1 and 500 then
    raise exception 'Invalid submission data' using errcode = '22023';
  end if;

  select activity.id
    into target_activity_id
  from public.activities as activity
  where activity.public_code = upper(btrim(activity_code))
  for share;

  if not found then
    raise exception 'Activity not found' using errcode = 'P0002';
  end if;

  insert into public.participants (activity_id, first_name, last_name, email)
  values (
    target_activity_id,
    btrim(participant_first_name),
    btrim(participant_last_name),
    lower(btrim(participant_email))
  )
  on conflict (activity_id, email)
  do update set
    first_name = excluded.first_name,
    last_name = excluded.last_name
  returning id into target_participant_id;

  -- Serialize submissions that share the same identity within an activity.
  -- Every read below (duplicate check and window count) happens under this
  -- lock, which is released automatically at transaction end.
  perform pg_advisory_xact_lock(
    hashtextextended(
      target_activity_id::text || ':' || target_participant_id::text,
      0
    )
  );

  normalized_content :=
    lower(btrim(regexp_replace(idea_content, '\s+', ' ', 'g')));

  select idea.id
    into existing_idea_id
  from public.ideas as idea
  join public.idea_authors as author
    on author.activity_id = idea.activity_id
   and author.idea_id = idea.id
  where idea.activity_id = target_activity_id
    and author.participant_id = target_participant_id
    and lower(btrim(regexp_replace(idea.content, '\s+', ' ', 'g'))) = normalized_content
  limit 1;

  if existing_idea_id is not null then
    return query select 'duplicate'::text, null::uuid, null::public.idea_status;
    return;
  end if;

  select count(*)
    into recent_idea_count
  from public.ideas as idea
  join public.idea_authors as author
    on author.activity_id = idea.activity_id
   and author.idea_id = idea.id
  where idea.activity_id = target_activity_id
    and author.participant_id = target_participant_id
    and idea.created_at > now() - make_interval(secs => window_seconds);

  if recent_idea_count >= max_ideas_per_window then
    return query select 'rate_limited'::text, null::uuid, null::public.idea_status;
    return;
  end if;

  insert into public.ideas (activity_id, content)
  values (target_activity_id, btrim(idea_content))
  returning id, status into created_idea_id, created_idea_status;

  insert into public.idea_authors (activity_id, idea_id, participant_id)
  values (target_activity_id, created_idea_id, target_participant_id);

  return query select 'accepted'::text, created_idea_id, created_idea_status;
end;
$$;

revoke all on function public.submit_idea(text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.submit_idea(text, text, text, text, text)
  to anon, authenticated;
