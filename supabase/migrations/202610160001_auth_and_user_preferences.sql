create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '',
  created_at timestamptz not null default now()
);

create table public.user_roles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  access_role text not null default 'pending' check (access_role in ('pending', 'user', 'admin')),
  created_at timestamptz not null default now()
);

create table public.user_preferences (
  user_id uuid primary key references auth.users (id) on delete cascade,
  show_only_certain boolean not null default false,
  theme text not null default 'system' check (theme in ('light', 'dark', 'system')),
  updated_at timestamptz not null default now()
);

create function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.user_roles
    where user_id = (select auth.uid())
      and access_role = 'admin'
  );
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'display_name', '')
  );

  insert into public.user_roles (user_id)
  values (new.id);

  insert into public.user_preferences (user_id)
  values (new.id);

  return new;
end;
$$;

revoke all on function public.handle_new_user() from public;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.user_preferences enable row level security;

revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (display_name) on public.profiles to authenticated;

create policy "Users can read their own profile"
  on public.profiles for select to authenticated
  using ((select auth.uid()) = id or (select public.is_admin()));

create policy "Users can update their own display name"
  on public.profiles for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

revoke all on public.user_roles from anon, authenticated;
grant select on public.user_roles to authenticated;

create policy "Users can read their own role"
  on public.user_roles for select to authenticated
  using ((select auth.uid()) = user_id or (select public.is_admin()));

revoke all on public.user_preferences from anon, authenticated;
grant select, insert, update, delete on public.user_preferences to authenticated;

create policy "Users can read their own preferences"
  on public.user_preferences for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can create their own preferences"
  on public.user_preferences for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Users can update their own preferences"
  on public.user_preferences for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Users can delete their own preferences"
  on public.user_preferences for delete to authenticated
  using ((select auth.uid()) = user_id);
