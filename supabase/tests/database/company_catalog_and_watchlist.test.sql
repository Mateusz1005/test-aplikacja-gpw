begin;

select plan(15);

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
    'a4200000-0000-4000-8000-000000000001',
    'authenticated',
    'authenticated',
    'catalog-user-one@example.test',
    'test-hash',
    now(),
    now(),
    now()
  ),
  (
    'a4200000-0000-4000-8000-000000000002',
    'authenticated',
    'authenticated',
    'catalog-user-two@example.test',
    'test-hash',
    now(),
    now(),
    now()
  ),
  (
    'a4200000-0000-4000-8000-000000000003',
    'authenticated',
    'authenticated',
    'catalog-admin@example.test',
    'test-hash',
    now(),
    now(),
    now()
  );

update public.user_roles
set access_role = 'admin'
where user_id = 'a4200000-0000-4000-8000-000000000003'::uuid;

insert into public.instrument_catalog (
  id,
  company_name,
  ticker,
  isin,
  market,
  source_url,
  source_date,
  confidence
)
values (
  'a4200000-0000-4000-8000-000000000010',
  'Przykładowa spółka testowa',
  'TEST',
  'PL0000000001',
  'gpw_main',
  'https://example.test/source',
  current_date,
  'certain'
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  'a4200000-0000-4000-8000-000000000001',
  true
);

select is(
  (select count(*) from public.instrument_catalog),
  1::bigint,
  'authenticated users can read the shared catalog'
);

select lives_ok(
  $$insert into public.user_watchlist (user_id, instrument_id, note)
    values (
      'a4200000-0000-4000-8000-000000000001'::uuid,
      'a4200000-0000-4000-8000-000000000010'::uuid,
      'Moja notatka'
    )$$,
  'a user can add an item to their own watchlist'
);

select is(
  (select count(*) from public.user_watchlist),
  1::bigint,
  'a user can read their own watchlist'
);

select throws_ok(
  $$insert into public.user_watchlist (user_id, instrument_id)
    values (
      'a4200000-0000-4000-8000-000000000002'::uuid,
      'a4200000-0000-4000-8000-000000000010'::uuid
    )$$,
  '42501',
  null,
  'a user cannot add a watchlist item for another account'
);

select lives_ok(
  $$update public.user_watchlist
    set note = 'Zaktualizowana notatka'
    where user_id = 'a4200000-0000-4000-8000-000000000001'::uuid$$,
  'a user can update their own note'
);

select is(
  (select note from public.user_watchlist),
  'Zaktualizowana notatka',
  'the updated note is saved'
);

select set_config(
  'request.jwt.claim.sub',
  'a4200000-0000-4000-8000-000000000002',
  true
);

select is(
  (select count(*) from public.user_watchlist),
  0::bigint,
  'another user cannot read the first user watchlist'
);

select lives_ok(
  $$insert into public.user_watchlist (user_id, instrument_id)
    values (
      'a4200000-0000-4000-8000-000000000002'::uuid,
      'a4200000-0000-4000-8000-000000000010'::uuid
    )$$,
  'another user can add an item to their own watchlist'
);

select lives_ok(
  $$update public.user_watchlist
    set note = 'Próba zmiany cudzej notatki'
    where user_id = 'a4200000-0000-4000-8000-000000000001'::uuid$$,
  'another user cannot update someone else watchlist'
);

select lives_ok(
  $$delete from public.user_watchlist
    where user_id = 'a4200000-0000-4000-8000-000000000001'::uuid$$,
  'another user cannot remove someone else watchlist item'
);

reset role;
select is(
  (
    select count(*)
    from public.user_watchlist
    where user_id = 'a4200000-0000-4000-8000-000000000001'::uuid
      and note = 'Zaktualizowana notatka'
  ),
  1::bigint,
  'another user cannot change or remove someone else watchlist item'
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  'a4200000-0000-4000-8000-000000000003',
  true
);

select is(
  (select count(*) from public.instrument_catalog),
  1::bigint,
  'administrators can read the shared catalog'
);

select is(
  (select count(*) from public.user_watchlist),
  0::bigint,
  'administrators cannot read private user notes'
);

reset role;
set local role anon;

select throws_ok(
  $$select * from public.instrument_catalog$$,
  '42501',
  null,
  'anonymous users cannot read the catalog'
);

reset role;

select throws_ok(
  $$insert into public.instrument_catalog (
      company_name, ticker, isin, market, source_url, source_date, confidence
    )
    values (
      'Niepewna spółka', 'BAD', 'PL0000000002', 'gpw_main',
      'https://example.test/source', current_date, 'unknown'
    )$$,
  '23514',
  null,
  'catalog confidence is restricted to the supported labels'
);

select * from finish();
rollback;
