-- 情侣打卡 100 件事：Supabase 云端同步结构
-- 在 Supabase SQL Editor 中一次性执行。不要把 service_role key 放进网页或 GitHub。

create extension if not exists pgcrypto;

create table if not exists public.couple_rooms (
  id uuid primary key default gen_random_uuid(),
  room_key text not null unique check (length(room_key) between 20 and 200),
  member_a text not null default '我' check (char_length(member_a) between 1 and 20),
  member_b text not null default 'TA' check (char_length(member_b) between 1 and 20),
  created_at timestamptz not null default now()
);

create table if not exists public.couple_items (
  room_id uuid not null references public.couple_rooms(id) on delete cascade,
  item_id integer not null check (item_id between 1 and 100),
  title text not null check (char_length(title) between 1 and 80),
  category text not null check (category in ('日常相伴', '美食时刻', '出门走走', '旅行远方', '特别纪念', '未来计划')),
  done boolean not null default false,
  date date,
  place text not null default '' check (char_length(place) <= 120),
  note_a text not null default '' check (char_length(note_a) <= 2000),
  note_b text not null default '' check (char_length(note_b) <= 2000),
  updated_at timestamptz,
  updated_by text check (updated_by in ('a', 'b')),
  primary key (room_id, item_id)
);

alter table public.couple_rooms enable row level security;
alter table public.couple_items enable row level security;
revoke all on table public.couple_rooms from anon, authenticated;
revoke all on table public.couple_items from anon, authenticated;

create or replace function public.ensure_couple_room(p_room_key text, p_items jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.couple_rooms; item jsonb;
begin
  if length(coalesce(p_room_key, '')) not between 20 and 200 or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) <> 100 or
     (select count(distinct (x->>'id')::integer) from jsonb_array_elements(p_items) x) <> 100 or
     exists (select 1 from jsonb_array_elements(p_items) x where (x->>'id')::integer not between 1 and 100 or char_length(x->>'title') not between 1 and 80 or x->>'category' not in ('日常相伴', '美食时刻', '出门走走', '旅行远方', '特别纪念', '未来计划')) then
    raise exception 'invalid room';
  end if;
  insert into public.couple_rooms(room_key) values (p_room_key)
    on conflict (room_key) do nothing returning * into r;
  if r.id is null then select * into r from public.couple_rooms where room_key = p_room_key; end if;
  if not exists (select 1 from public.couple_items where room_id = r.id) then
    for item in select * from jsonb_array_elements(p_items) loop
      insert into public.couple_items(room_id, item_id, title, category)
      values (r.id, (item->>'id')::integer, item->>'title', item->>'category');
    end loop;
  end if;
  return jsonb_build_object('room_id', r.id, 'member_a', r.member_a, 'member_b', r.member_b);
end $$;

create or replace function public.get_couple_room(p_room_key text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.couple_rooms;
begin
  select * into r from public.couple_rooms where room_key = p_room_key;
  if r.id is null then raise exception 'room not found'; end if;
  return jsonb_build_object(
    'version', 1,
    'revision', extract(epoch from greatest(coalesce((select max(updated_at) from public.couple_items where room_id = r.id), r.created_at)))::bigint,
    'members', jsonb_build_object('a', r.member_a, 'b', r.member_b),
    'items', coalesce((select jsonb_agg(jsonb_build_object('id', item_id, 'title', title, 'category', category, 'done', done, 'date', coalesce(date::text, ''), 'place', place, 'noteA', note_a, 'noteB', note_b, 'updatedAt', coalesce(updated_at::text, ''), 'updatedBy', coalesce(updated_by, '')) order by item_id) from public.couple_items where room_id = r.id), '[]'::jsonb)
  );
end $$;

create or replace function public.update_couple_item(p_room_key text, p_item_id integer, p_actor text, p_changes jsonb, p_expected jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.couple_rooms; old public.couple_items; key text; value jsonb;
begin
  if p_actor not in ('a', 'b') or jsonb_typeof(p_changes) <> 'object' or jsonb_typeof(p_expected) <> 'object' or p_changes = '{}'::jsonb or
     not (p_expected ?& array(select jsonb_object_keys(p_changes))) then raise exception 'invalid update'; end if;
  select * into r from public.couple_rooms where room_key = p_room_key;
  if r.id is null then raise exception 'room not found'; end if;
  select * into old from public.couple_items where room_id = r.id and item_id = p_item_id for update;
  if old.room_id is null then raise exception 'item not found'; end if;
  if (p_changes ? 'done' and jsonb_typeof(p_changes->'done') <> 'boolean') or
     (p_changes ? 'date' and (jsonb_typeof(p_changes->'date') <> 'string' or (p_changes->>'date' <> '' and (p_changes->>'date')::date::text <> p_changes->>'date'))) or
     (p_changes ? 'place' and (jsonb_typeof(p_changes->'place') <> 'string' or char_length(p_changes->>'place') > 120)) or
     (p_changes ? 'noteA' and (jsonb_typeof(p_changes->'noteA') <> 'string' or char_length(p_changes->>'noteA') > 2000)) or
     (p_changes ? 'noteB' and (jsonb_typeof(p_changes->'noteB') <> 'string' or char_length(p_changes->>'noteB') > 2000)) then raise exception 'invalid field'; end if;
  for key, value in select * from jsonb_each(p_changes) loop
    if key = 'done' and (value <> to_jsonb(old.done)) then null;
    elsif key = 'date' and value <> to_jsonb(coalesce(old.date::text, '')) then null;
    elsif key = 'place' and value <> to_jsonb(old.place) then null;
    elsif key = 'noteA' and value <> to_jsonb(old.note_a) then null;
    elsif key = 'noteB' and value <> to_jsonb(old.note_b) then null;
    elsif key not in ('done', 'date', 'place', 'noteA', 'noteB') then raise exception 'unsupported field';
    end if;
  end loop;
  if (p_expected ? 'done' and p_expected->'done' <> to_jsonb(old.done)) or
     (p_expected ? 'date' and p_expected->>'date' <> coalesce(old.date::text, '')) or
     (p_expected ? 'place' and p_expected->>'place' <> old.place) or
     (p_expected ? 'noteA' and p_expected->>'noteA' <> old.note_a) or
     (p_expected ? 'noteB' and p_expected->>'noteB' <> old.note_b) then raise exception 'conflict'; end if;
  update public.couple_items set
    done = case when p_changes ? 'done' then (p_changes->>'done')::boolean else done end,
    date = case when p_changes ? 'date' and nullif(p_changes->>'date', '') is not null then (p_changes->>'date')::date when p_changes ? 'date' then null else date end,
    place = case when p_changes ? 'place' then p_changes->>'place' else place end,
    note_a = case when p_changes ? 'noteA' then p_changes->>'noteA' else note_a end,
    note_b = case when p_changes ? 'noteB' then p_changes->>'noteB' else note_b end,
    updated_at = now(), updated_by = p_actor
  where room_id = r.id and item_id = p_item_id;
  return public.get_couple_room(p_room_key);
exception when others then
  if sqlerrm = 'conflict' then raise exception using message = 'conflict'; else raise; end if;
end $$;

create or replace function public.update_couple_members(p_room_key text, p_actor text, p_changes jsonb, p_expected jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.couple_rooms;
begin
  if p_actor not in ('a', 'b') or jsonb_typeof(p_changes) <> 'object' or jsonb_typeof(p_expected) <> 'object' or p_changes = '{}'::jsonb or
     not (p_expected ?& array(select jsonb_object_keys(p_changes))) or
     exists (select 1 from jsonb_object_keys(p_changes) k where k not in ('a', 'b')) or
     (p_changes ? 'a' and (jsonb_typeof(p_changes->'a') <> 'string' or char_length(trim(p_changes->>'a')) not between 1 and 20)) or
     (p_changes ? 'b' and (jsonb_typeof(p_changes->'b') <> 'string' or char_length(trim(p_changes->>'b')) not between 1 and 20)) then raise exception 'invalid update'; end if;
  select * into r from public.couple_rooms where room_key = p_room_key for update;
  if r.id is null then raise exception 'room not found'; end if;
  if (p_expected ? 'a' and p_expected->>'a' <> r.member_a) or (p_expected ? 'b' and p_expected->>'b' <> r.member_b) then raise exception 'conflict'; end if;
  update public.couple_rooms set member_a = case when p_changes ? 'a' then p_changes->>'a' else member_a end, member_b = case when p_changes ? 'b' then p_changes->>'b' else member_b end where id = r.id;
  return public.get_couple_room(p_room_key);
exception when others then
  if sqlerrm = 'conflict' then raise exception using message = 'conflict'; else raise; end if;
end $$;

revoke all on function public.ensure_couple_room(text, jsonb) from public;
revoke all on function public.get_couple_room(text) from public;
revoke all on function public.update_couple_item(text, integer, text, jsonb, jsonb) from public;
revoke all on function public.update_couple_members(text, text, jsonb, jsonb) from public;
grant execute on function public.ensure_couple_room(text, jsonb) to anon;
grant execute on function public.get_couple_room(text) to anon;
grant execute on function public.update_couple_item(text, integer, text, jsonb, jsonb) to anon;
grant execute on function public.update_couple_members(text, text, jsonb, jsonb) to anon;
