begin;
create or replace function public.internal_notice_is_staff()
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select exists(select 1 from public.store_users where user_id=auth.uid());
$$;
create or replace function public.internal_notice_is_admin()
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select exists(select 1 from public.store_users where user_id=auth.uid() and role='Andy');
$$;
revoke all on function public.internal_notice_is_staff(), public.internal_notice_is_admin() from public,anon;
grant execute on function public.internal_notice_is_staff(), public.internal_notice_is_admin() to authenticated;

create table if not exists public.internal_notices (
  id uuid primary key default gen_random_uuid(),
  title text not null check(length(btrim(title)) between 1 and 160),
  body text not null check(length(btrim(body)) between 1 and 20000),
  category text not null default '營運通知',
  is_pinned boolean not null default false,
  is_published boolean not null default false,
  revision bigint not null default 1,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz
);
create table if not exists public.internal_notice_reads (
  notice_id uuid not null references public.internal_notices(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  notice_revision bigint not null,
  read_at timestamptz not null default now(),
  primary key(notice_id,user_id)
);
create index if not exists internal_notices_published_idx on public.internal_notices(is_published,is_pinned,published_at desc);
create index if not exists internal_notice_reads_user_idx on public.internal_notice_reads(user_id);

create or replace function public.internal_notice_revision()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  if TG_OP='INSERT' then
    new.revision=1; new.created_by=auth.uid(); new.created_at=now();
    new.published_at=case when new.is_published then now() else null end;
  else
    new.created_by=old.created_by; new.created_at=old.created_at;
    new.revision=old.revision + case when
      row(new.title,new.body,new.category,new.is_published) is distinct from
      row(old.title,old.body,old.category,old.is_published) then 1 else 0 end;
    new.published_at=case when new.is_published and not old.is_published then now() else old.published_at end;
  end if;
  new.updated_at=now(); return new;
end;
$$;
drop trigger if exists internal_notice_revision_trigger on public.internal_notices;
create trigger internal_notice_revision_trigger before insert or update on public.internal_notices
  for each row execute function public.internal_notice_revision();

alter table public.internal_notices enable row level security;
alter table public.internal_notice_reads enable row level security;
revoke all on public.internal_notices,public.internal_notice_reads from public,anon;
grant select,insert,update,delete on public.internal_notices to authenticated;
grant select,insert,update on public.internal_notice_reads to authenticated;
grant all on public.internal_notices,public.internal_notice_reads to service_role;

drop policy if exists internal_notice_read on public.internal_notices;
create policy internal_notice_read on public.internal_notices for select to authenticated
  using(public.internal_notice_is_staff() and (is_published or public.internal_notice_is_admin()));
drop policy if exists internal_notice_manage on public.internal_notices;
create policy internal_notice_manage on public.internal_notices for all to authenticated
  using(public.internal_notice_is_admin()) with check(public.internal_notice_is_admin());
drop policy if exists internal_notice_own_reads on public.internal_notice_reads;
create policy internal_notice_own_reads on public.internal_notice_reads for select to authenticated
  using(user_id=auth.uid() and public.internal_notice_is_staff());
drop policy if exists internal_notice_mark_insert on public.internal_notice_reads;
create policy internal_notice_mark_insert on public.internal_notice_reads for insert to authenticated
  with check(user_id=auth.uid() and public.internal_notice_is_staff() and exists(
    select 1 from public.internal_notices n where n.id=notice_id and n.is_published and n.revision=notice_revision
  ));
drop policy if exists internal_notice_mark_update on public.internal_notice_reads;
create policy internal_notice_mark_update on public.internal_notice_reads for update to authenticated
  using(user_id=auth.uid() and public.internal_notice_is_staff())
  with check(user_id=auth.uid() and public.internal_notice_is_staff() and exists(
    select 1 from public.internal_notices n where n.id=notice_id and n.is_published and n.revision=notice_revision
  ));
notify pgrst,'reload schema';
commit;
