-- Submit an idea atomically without exposing service_role to public clients.
create function public.submit_idea(
  activity_code text,
  participant_first_name text,
  participant_last_name text,
  participant_email text,
  idea_content text
)
returns table (idea_id uuid, idea_status public.idea_status)
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_activity_id uuid;
  target_participant_id uuid;
  created_idea_id uuid;
  created_idea_status public.idea_status;
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

  insert into public.ideas (activity_id, content)
  values (target_activity_id, btrim(idea_content))
  returning id, status into created_idea_id, created_idea_status;

  insert into public.idea_authors (activity_id, idea_id, participant_id)
  values (target_activity_id, created_idea_id, target_participant_id);

  return query select created_idea_id, created_idea_status;
end;
$$;

revoke all on function public.submit_idea(text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.submit_idea(text, text, text, text, text)
  to anon, authenticated;
