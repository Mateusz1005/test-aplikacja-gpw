create table public.app_settings (
  id boolean primary key default true check (id),
  trial_days integer not null default 7 check (trial_days between 1 and 90),
  subscription_trial_days integer not null default 30
    check (subscription_trial_days between 1 and 180),
  manual_access_days integer not null default 30
    check (manual_access_days between 1 and 3650),
  sender_email text not null default ''
    check (sender_email = '' or sender_email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);

insert into public.app_settings (id)
values (true)
on conflict (id) do nothing;

create table public.trial_claims (
  email text primary key,
  user_id uuid references auth.users (id) on delete set null,
  claimed_at timestamptz not null default now()
);

create table public.user_access (
  user_id uuid primary key references auth.users (id) on delete cascade,
  access_status text not null default 'pending'
    check (access_status in ('active', 'blocked', 'revoked', 'pending')),
  access_type text not null default 'none'
    check (access_type in ('trial', 'subscription_trial', 'subscription', 'manual', 'none')),
  access_starts_at timestamptz,
  access_expires_at timestamptz,
  granted_by uuid references auth.users (id) on delete set null,
  note text not null default '' check (char_length(note) <= 500),
  updated_at timestamptz not null default now(),
  constraint user_access_expiry_after_start check (
    access_expires_at is null
    or access_starts_at is null
    or access_expires_at > access_starts_at
  ),
  constraint user_access_expiry_for_paid_subscription check (
    access_type <> 'subscription' or access_expires_at is not null
  )
);

create table public.login_events (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users (id) on delete set null,
  email text not null,
  event_type text not null check (event_type in ('login_succeeded')),
  occurred_at timestamptz not null default now()
);

create index login_events_occurred_at_idx
  on public.login_events (occurred_at desc);
create index login_events_email_occurred_at_idx
  on public.login_events (lower(email), occurred_at desc);

create table public.admin_audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid references auth.users (id) on delete set null,
  target_user_id uuid references auth.users (id) on delete set null,
  action text not null,
  details jsonb not null default '{}'::jsonb
    check (pg_column_size(details) <= 8192),
  occurred_at timestamptz not null default now()
);

create index admin_audit_log_occurred_at_idx
  on public.admin_audit_log (occurred_at desc);

alter table public.user_roles
  alter column access_role set default 'user';

alter table public.user_roles
  drop constraint user_roles_access_role_check;

alter table public.user_roles
  add constraint user_roles_access_role_check
    check (access_role in ('user', 'admin'));

update public.user_roles
set access_role = 'user'
where access_role = 'pending';

insert into public.trial_claims (email, user_id, claimed_at)
select lower(u.email), u.id, now()
from auth.users as u
where u.email is not null
on conflict (email) do nothing;

insert into public.user_access (
  user_id,
  access_status,
  access_type,
  access_starts_at,
  access_expires_at,
  note
)
select
  u.id,
  'active',
  'trial',
  now(),
  now() + make_interval(days => settings.trial_days),
  'Okres próbny nadany podczas migracji.'
from auth.users as u
cross join public.app_settings as settings
where settings.id
on conflict (user_id) do nothing;

alter table public.app_settings enable row level security;
alter table public.trial_claims enable row level security;
alter table public.user_access enable row level security;
alter table public.login_events enable row level security;
alter table public.admin_audit_log enable row level security;

revoke all on public.app_settings from anon, authenticated;
grant select, update on public.app_settings to authenticated;
create policy "Only administrators can read application settings"
  on public.app_settings for select to authenticated
  using ((select public.is_admin()));
create policy "Only administrators can update application settings"
  on public.app_settings for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

revoke all on public.trial_claims from anon, authenticated;

revoke all on public.user_access from anon, authenticated;
grant select on public.user_access to authenticated;
create policy "Users can read their own access status"
  on public.user_access for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "Administrators can read all user access"
  on public.user_access for select to authenticated
  using ((select public.is_admin()));

revoke all on public.login_events from anon, authenticated;
create policy "Only administrators can read login history"
  on public.login_events for select to authenticated
  using ((select public.is_admin()));

revoke all on public.admin_audit_log from anon, authenticated;
create policy "Only administrators can read the audit log"
  on public.admin_audit_log for select to authenticated
  using ((select public.is_admin()));

grant usage, select on sequence public.login_events_id_seq to service_role;
grant insert on public.login_events to service_role;
grant usage, select on sequence public.admin_audit_log_id_seq to service_role;
grant insert on public.admin_audit_log to service_role;
grant select, insert, update, delete on public.app_settings to service_role;
grant select, insert, update, delete on public.trial_claims to service_role;
grant select, insert, update, delete on public.user_access to service_role;
grant select, insert, update, delete on public.login_events to service_role;
grant select, insert, update, delete on public.admin_audit_log to service_role;
grant select, insert, update, delete on public.user_roles to service_role;

create or replace function public.record_login_event()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  current_email text := nullif((select auth.jwt() ->> 'email'), '');
begin
  if current_user_id is null or current_email is null then
    raise exception 'An authenticated user is required to record a login.';
  end if;

  insert into public.login_events (user_id, email, event_type)
  values (current_user_id, lower(current_email), 'login_succeeded');
end;
$$;

revoke all on function public.record_login_event() from public;
grant execute on function public.record_login_event() to authenticated;

create or replace function public.bootstrap_initial_admin(
  target_user_id uuid,
  target_email text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(1514142601, 1);

  if exists (
    select 1 from public.user_roles where access_role = 'admin'
  ) then
    return false;
  end if;

  if not exists (
    select 1
    from auth.users
    where id = target_user_id
      and lower(email) = lower(target_email)
      and email_confirmed_at is not null
  ) then
    return false;
  end if;

  update public.user_roles
  set access_role = 'admin'
  where user_id = target_user_id;

  insert into public.admin_audit_log (
    actor_id,
    target_user_id,
    action,
    details
  )
  values (
    target_user_id,
    target_user_id,
    'admin.initial_bootstrap',
    jsonb_build_object('email', lower(target_email))
  );

  return true;
end;
$$;

revoke all on function public.bootstrap_initial_admin(uuid, text) from public;
grant execute on function public.bootstrap_initial_admin(uuid, text) to service_role;

create or replace function public.has_active_access()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select public.is_admin())
    or exists (
      select 1
      from public.user_access
      where user_id = (select auth.uid())
        and access_status = 'active'
        and (
          access_starts_at is null
          or access_starts_at <= now()
        )
        and (
          access_expires_at is null
          or access_expires_at > now()
        )
    );
$$;

revoke all on function public.has_active_access() from public;
grant execute on function public.has_active_access() to authenticated;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_email text;
  trial_duration integer;
  is_first_trial boolean;
  trial_start timestamptz;
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

  normalized_email := lower(coalesce(new.email, ''));
  trial_start := coalesce(new.created_at, now());

  select trial_days
  into trial_duration
  from public.app_settings
  where id;

  if normalized_email <> '' then
    insert into public.trial_claims (email, user_id, claimed_at)
    values (normalized_email, new.id, trial_start)
    on conflict (email) do nothing;

    is_first_trial := found;
  else
    is_first_trial := false;
  end if;

  if is_first_trial then
    insert into public.user_access (
      user_id,
      access_status,
      access_type,
      access_starts_at,
      access_expires_at
    )
    values (
      new.id,
      'active',
      'trial',
      trial_start,
      trial_start + make_interval(days => trial_duration)
    );
  else
    insert into public.user_access (user_id)
    values (new.id);
  end if;

  return new;
end;
$$;

revoke all on function public.handle_new_user() from public;
