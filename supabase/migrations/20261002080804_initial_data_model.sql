-- Core MVP model: activities, anonymous-per-event participants, public ideas,
-- and a private link between each idea and its author.

create type public.activity_status as enum ('draft', 'open', 'closed');
create type public.moderation_mode as enum ('automatic', 'approval');
create type public.idea_status as enum ('pending', 'published', 'hidden');

create table public.activities (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  public_code varchar(8) not null unique
    check (public_code ~ '^[A-Z0-9]{8}$'),
  title varchar(120) not null
    check (char_length(btrim(title)) between 1 and 120),
  question varchar(300) not null
    check (char_length(btrim(question)) between 1 and 300),
  status public.activity_status not null default 'draft',
  moderation_mode public.moderation_mode not null default 'automatic',
  created_at timestamptz not null default now(),
  opened_at timestamptz,
  closed_at timestamptz
);

create index activities_owner_created_at_idx
  on public.activities (owner_id, created_at desc);

create table public.participants (
  id uuid primary key default gen_random_uuid(),
  activity_id uuid not null references public.activities (id) on delete cascade,
  first_name varchar(100) not null
    check (char_length(btrim(first_name)) between 1 and 100),
  last_name varchar(100) not null
    check (char_length(btrim(last_name)) between 1 and 100),
  email varchar(254) not null
    check (
      email = lower(btrim(email))
      and position('@' in email) > 1
      and char_length(email) <= 254
    ),
  created_at timestamptz not null default now(),
  constraint participants_activity_email_key unique (activity_id, email),
  constraint participants_activity_id_id_key unique (activity_id, id)
);

create table public.ideas (
  id uuid primary key default gen_random_uuid(),
  activity_id uuid not null references public.activities (id) on delete cascade,
  content varchar(500) not null
    check (char_length(btrim(content)) between 1 and 500),
  status public.idea_status not null default 'pending',
  created_at timestamptz not null default now(),
  published_at timestamptz,
  constraint ideas_activity_id_id_key unique (activity_id, id)
);

create index ideas_activity_status_created_at_idx
  on public.ideas (activity_id, status, created_at desc);

-- This table keeps personally identifying data out of the public ideas feed
-- and its Realtime payloads.
create table public.idea_authors (
  activity_id uuid not null,
  idea_id uuid primary key,
  participant_id uuid not null,
  created_at timestamptz not null default now(),
  constraint idea_authors_activity_idea_fkey
    foreign key (activity_id, idea_id)
    references public.ideas (activity_id, id)
    on delete cascade,
  constraint idea_authors_activity_participant_fkey
    foreign key (activity_id, participant_id)
    references public.participants (activity_id, id)
    on delete cascade
);

create index idea_authors_activity_participant_idx
  on public.idea_authors (activity_id, participant_id);

alter table public.activities enable row level security;
alter table public.participants enable row level security;
alter table public.ideas enable row level security;
alter table public.idea_authors enable row level security;

-- Public clients can read only the activity fields needed by the participant
-- and projection screens. They cannot read the organizer's user ID.
revoke all on table public.activities from anon, authenticated;
grant select (
  id,
  public_code,
  title,
  question,
  status,
  created_at,
  opened_at,
  closed_at
) on table public.activities to anon;
grant select, insert, update, delete on table public.activities to authenticated;
grant all on table public.activities to service_role;

create policy "Anyone can read open or closed activity details"
  on public.activities
  for select
  to anon, authenticated
  using (status in ('open', 'closed'));

create policy "Organizers can read their activities"
  on public.activities
  for select
  to authenticated
  using (owner_id = (select auth.uid()));

create policy "Organizers can create their activities"
  on public.activities
  for insert
  to authenticated
  with check (owner_id = (select auth.uid()));

create policy "Organizers can update their activities"
  on public.activities
  for update
  to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

create policy "Organizers can delete their activities"
  on public.activities
  for delete
  to authenticated
  using (owner_id = (select auth.uid()));

-- Participant PII is available only to the organizer who owns the activity.
revoke all on table public.participants from anon, authenticated;
grant select on table public.participants to authenticated;
grant all on table public.participants to service_role;

create policy "Organizers can read participants in their activities"
  on public.participants
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.activities as activity
      where activity.id = participants.activity_id
        and activity.owner_id = (select auth.uid())
    )
  );

-- Ideas contain only public-safe content. Writes go through the server API
-- using the server-only service role key; organizers moderate through RLS.
revoke all on table public.ideas from anon, authenticated;
grant select (id, activity_id, content, status, created_at, published_at)
  on table public.ideas to anon;
grant select, update, delete on table public.ideas to authenticated;
grant all on table public.ideas to service_role;

create policy "Anyone can read published ideas for open or closed activities"
  on public.ideas
  for select
  to anon, authenticated
  using (
    status = 'published'
    and exists (
      select 1
      from public.activities as activity
      where activity.id = ideas.activity_id
        and activity.status in ('open', 'closed')
    )
  );

create policy "Organizers can read all ideas in their activities"
  on public.ideas
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.activities as activity
      where activity.id = ideas.activity_id
        and activity.owner_id = (select auth.uid())
    )
  );

create policy "Organizers can moderate ideas in their activities"
  on public.ideas
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.activities as activity
      where activity.id = ideas.activity_id
        and activity.owner_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1
      from public.activities as activity
      where activity.id = ideas.activity_id
        and activity.owner_id = (select auth.uid())
    )
  );

create policy "Organizers can delete ideas in their activities"
  on public.ideas
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.activities as activity
      where activity.id = ideas.activity_id
        and activity.owner_id = (select auth.uid())
    )
  );

-- The private authorship link can be read only by the activity's organizer.
revoke all on table public.idea_authors from anon, authenticated;
grant select on table public.idea_authors to authenticated;
grant all on table public.idea_authors to service_role;

create policy "Organizers can read authors in their activities"
  on public.idea_authors
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.activities as activity
      where activity.id = idea_authors.activity_id
        and activity.owner_id = (select auth.uid())
    )
  );

-- Derive the initial visibility from the activity's current mode and reject
-- submissions after it has closed. Later mode changes affect future ideas;
-- already-pending ideas remain pending until the organizer reviews them.
create function public.set_initial_idea_status()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  activity_mode public.moderation_mode;
  activity_state public.activity_status;
begin
  select activity.moderation_mode, activity.status
    into activity_mode, activity_state
  from public.activities as activity
  where activity.id = new.activity_id
  for share;

  if not found or activity_state <> 'open' then
    raise exception 'Activity is not open for submissions'
      using errcode = 'check_violation';
  end if;

  if activity_mode = 'automatic' then
    new.status := 'published';
    new.published_at := now();
  else
    new.status := 'pending';
    new.published_at := null;
  end if;

  return new;
end;
$$;

create function public.update_idea_published_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'published' and old.status <> 'published' then
    new.published_at := now();
  elsif new.status <> 'published' then
    new.published_at := null;
  else
    new.published_at := old.published_at;
  end if;

  return new;
end;
$$;

revoke all on function public.set_initial_idea_status() from public, anon, authenticated;
revoke all on function public.update_idea_published_at() from public, anon, authenticated;

create trigger ideas_set_initial_status
  before insert on public.ideas
  for each row execute function public.set_initial_idea_status();

create trigger ideas_update_published_at
  before update of status on public.ideas
  for each row execute function public.update_idea_published_at();

alter table public.ideas replica identity full;
alter publication supabase_realtime add table public.ideas;
