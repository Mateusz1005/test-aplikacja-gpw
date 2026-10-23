begin;

select plan(14);

insert into auth.users (
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  created_at,
  updated_at
)
values
  (
    'a4100000-0000-4000-8000-000000000001',
    'authenticated',
    'authenticated',
    'rls-user-one@example.test',
    'test-hash',
    now(),
    now(),
    now()
  ),
  (
    'a4100000-0000-4000-8000-000000000002',
    'authenticated',
    'authenticated',
    'rls-user-two@example.test',
    'test-hash',
    now(),
    now(),
    now()
  );

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  'a4100000-0000-4000-8000-000000000001',
  true
);

select is(
  (select count(*) from public.user_preferences),
  1::bigint,
  'a user can only read their own preferences'
);

select is(
  (select count(*) from public.user_roles),
  1::bigint,
  'a user can only read their own role'
);

select is(
  (select access_role from public.user_roles),
  'user',
  'new accounts receive the standard user role'
);

select is(
  (select access_type from public.user_access),
  'trial',
  'new accounts receive the no-subscription trial'
);

select ok(
  (
    select access_expires_at > now()
      and access_expires_at <= now() + interval '7 days'
    from public.user_access
  ),
  'new accounts receive a seven-day trial'
);

select throws_ok(
  $$update public.user_roles set access_role = 'admin'
    where user_id = 'a4100000-0000-4000-8000-000000000001'::uuid$$,
  '42501',
  null,
  'a user cannot change their own role'
);

select throws_ok(
  $$update public.user_preferences
    set user_id = 'a4100000-0000-4000-8000-000000000002'::uuid
    where user_id = 'a4100000-0000-4000-8000-000000000001'::uuid$$,
  '42501',
  null,
  'a user cannot transfer preferences to another account'
);

select set_config(
  'request.jwt.claim.sub',
  'a4100000-0000-4000-8000-000000000002',
  true
);

select is(
  (select count(*) from public.user_preferences),
  1::bigint,
  'another account can read its own preferences'
);

select is(
  (select count(*) from public.user_roles),
  1::bigint,
  'another account can read its own role'
);

select is(
  (select count(*) from public.user_access),
  1::bigint,
  'another account can only read its own access record'
);

select lives_ok(
  $$update public.app_settings set trial_days = 90 where id$$,
  'a regular-user settings update is evaluated'
);

reset role;
select is(
  (select trial_days from public.app_settings where id),
  7,
  'a regular user cannot change application settings'
);

set local role authenticated;
select throws_ok(
  $$update public.user_access
    set access_status = 'active'
    where user_id = 'a4100000-0000-4000-8000-000000000002'::uuid$$,
  '42501',
  null,
  'a regular user cannot grant access'
);

reset role;
update public.user_access
set access_starts_at = now() + interval '1 day'
where user_id = 'a4100000-0000-4000-8000-000000000002'::uuid;

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  'a4100000-0000-4000-8000-000000000002',
  true
);

select ok(
  not public.has_active_access(),
  'scheduled access does not become active before its start time'
);

select * from finish();
rollback;
