-- =====================================================================
-- ExamGuard schema for Supabase  (paste into SQL Editor -> Run)
-- Students never log in. They only talk to the database through the
-- three SECURITY DEFINER functions below, so the tables stay locked.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------- Tables ----------
create table if not exists public.classes (
  id          uuid primary key default gen_random_uuid(),
  teacher_id  uuid not null references auth.users(id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 80),
  code        text not null unique,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

create table if not exists public.participants (
  id          uuid primary key default gen_random_uuid(),
  class_id    uuid not null references public.classes(id) on delete cascade,
  name        text not null check (char_length(name) between 2 and 60),
  token       uuid not null default gen_random_uuid(),   -- secret held only by that student's extension
  status      text not null default 'active' check (status in ('active','away','left')),
  last_event  text,
  away_count  int  not null default 0,
  joined_at   timestamptz not null default now(),
  last_seen   timestamptz not null default now()
);
create index if not exists participants_class_idx on public.participants(class_id);

create table if not exists public.activity_log (
  id             bigint generated always as identity primary key,
  participant_id uuid not null references public.participants(id) on delete cascade,
  status         text not null,
  detail         text,
  created_at     timestamptz not null default now()
);
create index if not exists activity_participant_idx on public.activity_log(participant_id, created_at desc);

-- ---------- Row Level Security ----------
alter table public.classes      enable row level security;
alter table public.participants enable row level security;
alter table public.activity_log enable row level security;

-- Teachers can manage only their own classes.
drop policy if exists "teacher reads own classes"   on public.classes;
drop policy if exists "teacher updates own classes" on public.classes;
drop policy if exists "teacher deletes own classes" on public.classes;
create policy "teacher reads own classes"   on public.classes for select to authenticated using (teacher_id = auth.uid());
create policy "teacher updates own classes" on public.classes for update to authenticated using (teacher_id = auth.uid());
create policy "teacher deletes own classes" on public.classes for delete to authenticated using (teacher_id = auth.uid());

-- participants & activity_log: no direct access for anyone (functions only).
revoke all on public.participants from anon, authenticated;
revoke all on public.activity_log from anon, authenticated;
revoke all on public.classes      from anon;
revoke insert on public.classes   from authenticated;   -- classes are created via create_class()

-- ---------- Teacher: create a class with a unique code ----------
create or replace function public.create_class(p_name text)
returns public.classes
language plpgsql security definer set search_path = public as $$
declare
  v_code text;
  v_row  public.classes;
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';  -- no 0/O/1/I confusion
begin
  if auth.uid() is null then raise exception 'You must be logged in as a teacher'; end if;
  if char_length(trim(coalesce(p_name,''))) = 0 then raise exception 'Class name is required'; end if;

  loop
    v_code := '';
    for i in 1..6 loop
      v_code := v_code || substr(v_alphabet, 1 + (get_byte(gen_random_bytes(1), 0) % 32), 1);
    end loop;
    exit when not exists (select 1 from classes where code = v_code);
  end loop;

  insert into classes (teacher_id, name, code)
  values (auth.uid(), left(trim(p_name), 80), v_code)
  returning * into v_row;
  return v_row;
end $$;

-- ---------- Student: join with name + class code (no login) ----------
create or replace function public.join_class(p_code text, p_name text)
returns table (pid uuid, ptoken uuid, cname text)
language plpgsql security definer set search_path = public as $$
declare
  v_class public.classes;
  v_pid   uuid;
  v_tok   uuid;
begin
  select * into v_class from classes where code = upper(trim(coalesce(p_code,''))) and is_active;
  if not found then raise exception 'Invalid or closed class code'; end if;
  if char_length(trim(coalesce(p_name,''))) < 2 then raise exception 'Enter your full name'; end if;

  insert into participants (class_id, name)
  values (v_class.id, left(trim(p_name), 60))
  returning id, token into v_pid, v_tok;

  insert into activity_log (participant_id, status, detail) values (v_pid, 'active', 'Joined the session');

  return query select v_pid, v_tok, v_class.name;
end $$;

-- ---------- Student: report status / heartbeat ----------
create or replace function public.report_status(p_participant uuid, p_token uuid, p_status text, p_detail text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_old text;
begin
  if p_status not in ('active','away','left') then raise exception 'Invalid status'; end if;

  select status into v_old from participants where id = p_participant and token = p_token;
  if not found then raise exception 'Invalid session'; end if;
  if v_old = 'left' then return; end if;     -- a student who left stays "left"

  update participants set
    status     = p_status,
    last_seen  = now(),
    away_count = away_count + (case when p_status = 'away' and v_old <> 'away' then 1 else 0 end),
    last_event = case when p_status <> v_old then coalesce(left(p_detail, 120), p_status) else last_event end
  where id = p_participant;

  if p_status <> v_old then
    insert into activity_log (participant_id, status, detail) values (p_participant, p_status, left(p_detail, 120));
  end if;
end $$;

-- ---------- Teacher: roster for one class ----------
create or replace function public.class_roster(p_class_id uuid)
returns table (id uuid, name text, status text, last_event text, away_count int, joined_at timestamptz, seconds_since_seen int)
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from classes c where c.id = p_class_id and c.teacher_id = auth.uid()) then
    raise exception 'Class not found';
  end if;
  return query
    select p.id, p.name, p.status, p.last_event, p.away_count, p.joined_at,
           extract(epoch from (now() - p.last_seen))::int
    from participants p
    where p.class_id = p_class_id
    order by p.joined_at;
end $$;

-- ---------- Teacher: activity history for one student ----------
create or replace function public.participant_log(p_participant uuid)
returns table (status text, detail text, created_at timestamptz)
language plpgsql security definer set search_path = public as $$
begin
  if not exists (
    select 1 from participants p join classes c on c.id = p.class_id
    where p.id = p_participant and c.teacher_id = auth.uid()
  ) then
    raise exception 'Student not found';
  end if;
  return query
    select l.status, l.detail, l.created_at
    from activity_log l
    where l.participant_id = p_participant
    order by l.created_at desc
    limit 25;
end $$;

-- ---------- Function permissions ----------
revoke execute on function public.create_class(text)                    from public, anon;
revoke execute on function public.class_roster(uuid)                    from public, anon;
revoke execute on function public.participant_log(uuid)                 from public, anon;
grant  execute on function public.create_class(text)                    to authenticated;
grant  execute on function public.class_roster(uuid)                    to authenticated;
grant  execute on function public.participant_log(uuid)                 to authenticated;
grant  execute on function public.join_class(text, text)                to anon, authenticated;
grant  execute on function public.report_status(uuid, uuid, text, text) to anon, authenticated;
