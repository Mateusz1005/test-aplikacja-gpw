begin;

select plan(13);

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at
)
values
  (
    'a4400000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
    'portfolio-user-one@example.test', 'test-hash', now(), now(), now()
  ),
  (
    'a4400000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
    'portfolio-user-two@example.test', 'test-hash', now(), now(), now()
  ),
  (
    'a4400000-0000-4000-8000-000000000003', 'authenticated', 'authenticated',
    'portfolio-user-blocked@example.test', 'test-hash', now(), now(), now()
  );

insert into public.user_access (user_id, access_status, access_type, access_starts_at)
values
  ('a4400000-0000-4000-8000-000000000001', 'active', 'manual', now()),
  ('a4400000-0000-4000-8000-000000000002', 'active', 'manual', now()),
  ('a4400000-0000-4000-8000-000000000003', 'blocked', 'none', now())
on conflict (user_id) do update
set access_status = excluded.access_status,
    access_type = excluded.access_type,
    access_starts_at = excluded.access_starts_at;

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  'a4400000-0000-4000-8000-000000000001',
  true
);

select lives_ok(
  $$insert into public.portfolio_entries
    (user_id, ticker, asset_type, entry_type, event_date, units, investment_amount, commission_amount)
    values (
      'a4400000-0000-4000-8000-000000000001', 'KRK', 'stock', 'investment',
      current_date, 2.5, 1000.00, 5.00
    )$$,
  'an active user can record a stock investment with a fee'
);

select lives_ok(
  $$insert into public.portfolio_entries
    (user_id, ticker, asset_type, entry_type, event_date, dividend_amount)
    values (
      'a4400000-0000-4000-8000-000000000001', 'KRK', 'stock', 'dividend',
      current_date, 22.50
    )$$,
  'an active user can record a dividend'
);

select is(
  (select count(*) from public.portfolio_entries),
  2::bigint,
  'the owner can read their own portfolio entries'
);

select throws_ok(
  $$insert into public.portfolio_entries
    (user_id, ticker, asset_type, entry_type, event_date, units, investment_amount, commission_amount)
    values (
      'a4400000-0000-4000-8000-000000000002', 'ABC', 'stock', 'investment',
      current_date, 1, 10, 0
    )$$,
  '42501',
  null,
  'a user cannot add an entry to another account'
);

select throws_ok(
  $$insert into public.portfolio_entries
    (user_id, ticker, asset_type, entry_type, event_date, units, investment_amount, commission_amount)
    values (
      'a4400000-0000-4000-8000-000000000001', 'ABC', 'stock', 'investment',
      current_date, 0, 10, 0
    )$$,
  '23514',
  null,
  'zero investment units are rejected'
);

select set_config(
  'request.jwt.claim.sub',
  'a4400000-0000-4000-8000-000000000002',
  true
);

select is(
  (select count(*) from public.portfolio_entries),
  0::bigint,
  'another active user cannot read the first users entries'
);

select lives_ok(
  $$insert into public.portfolio_entries
    (user_id, ticker, asset_type, entry_type, event_date, units, investment_amount, commission_amount)
    values (
      'a4400000-0000-4000-8000-000000000002', 'ETFTEST', 'etf', 'investment',
      current_date, 1, 100, 0
    )$$,
  'another user can write to their own portfolio'
);

select throws_ok(
  $$update public.portfolio_entries
    set investment_amount = 200
    where user_id = 'a4400000-0000-4000-8000-000000000001'$$,
  '42501',
  null,
  'direct portfolio updates are not granted'
);

select lives_ok(
  $$delete from public.portfolio_entries
    where user_id = 'a4400000-0000-4000-8000-000000000001'$$,
  'another user cannot delete a row they cannot see'
);

reset role;
select is(
  (
    select investment_amount
    from public.portfolio_entries
    where user_id = 'a4400000-0000-4000-8000-000000000001'
      and entry_type = 'investment'
  ),
  1000.00::numeric,
  'the owner entries remain unchanged after attempts by another user'
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  'a4400000-0000-4000-8000-000000000003',
  true
);

select is(
  (select count(*) from public.portfolio_entries),
  0::bigint,
  'a blocked account cannot read its portfolio'
);

select throws_ok(
  $$insert into public.portfolio_entries
    (user_id, ticker, asset_type, entry_type, event_date, units, investment_amount, commission_amount)
    values (
      'a4400000-0000-4000-8000-000000000003', 'ABC', 'stock', 'investment',
      current_date, 1, 10, 0
    )$$,
  '42501',
  null,
  'a blocked account cannot add portfolio entries'
);

reset role;
set local role anon;
select throws_ok(
  $$select * from public.portfolio_entries$$,
  '42501',
  null,
  'anonymous users cannot access portfolio data'
);

select * from finish();
rollback;
