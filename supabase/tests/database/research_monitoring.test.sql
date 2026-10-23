begin;

select plan(10);

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
    'a5500000-0000-4000-8000-000000000001',
    'authenticated',
    'authenticated',
    'monitor-active@example.test',
    'test-hash',
    now(),
    now(),
    now()
  ),
  (
    'a5500000-0000-4000-8000-000000000002',
    'authenticated',
    'authenticated',
    'monitor-blocked@example.test',
    'test-hash',
    now(),
    now(),
    now()
  );

update public.user_access
set access_status = 'active',
    access_starts_at = now() - interval '1 day',
    access_expires_at = now() + interval '7 days'
where user_id = 'a5500000-0000-4000-8000-000000000001'::uuid;

update public.user_access
set access_status = 'blocked'
where user_id = 'a5500000-0000-4000-8000-000000000002'::uuid;

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
  'a6600000-0000-4000-8000-000000000001',
  'Przykładowa spółka monitorowana',
  'MON1',
  'PL0000000001',
  'gpw_main',
  'https://example.test/mon1',
  current_date,
  'certain'
);

set local role service_role;

select lives_ok(
  $$insert into public.monitored_research_items (
      instrument_id, title, url, source, description, published_at, content_kind
    )
    values
      (
        'a6600000-0000-4000-8000-000000000001',
        'Raport spółki',
        'https://example.test/article-1',
        'Źródło testowe',
        'Opis raportu',
        current_date,
        'news'
      ),
      (
        'a6600000-0000-4000-8000-000000000001',
        'Wiadomość spółki',
        'https://example.test/article-2',
        'Źródło testowe',
        null,
        current_date - 1,
        'news'
      )$$,
  'service role can save monitored items'
);

select lives_ok(
  $$insert into public.research_monitor_state (
      instrument_id, last_checked_at, last_successful_check_at, news_checked_at
    )
    values (
      'a6600000-0000-4000-8000-000000000001',
      now(),
      now(),
      now()
    )
    on conflict (instrument_id)
    do update set
      last_checked_at = excluded.last_checked_at,
      last_successful_check_at = excluded.last_successful_check_at,
      news_checked_at = excluded.news_checked_at$$,
  'service role can upsert monitor state'
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  'a5500000-0000-4000-8000-000000000001',
  true
);

select is(
  (select count(*) from public.monitored_research_items),
  2::bigint,
  'active user can read monitored items'
);

select is(
  (select count(*) from public.research_monitor_state),
  1::bigint,
  'active user can read monitor state'
);

select throws_ok(
  $$insert into public.monitored_research_items (
      instrument_id, title, url, source, published_at
    )
    values (
      'a6600000-0000-4000-8000-000000000001',
      'Nieautoryzowany wpis',
      'https://example.test/unauthorized',
      'Źródło testowe',
      current_date
    )$$,
  '42501',
  null,
  'authenticated user cannot write monitored items directly'
);

select set_config(
  'request.jwt.claim.sub',
  'a5500000-0000-4000-8000-000000000002',
  true
);

select is(
  (select count(*) from public.monitored_research_items),
  0::bigint,
  'user without active access cannot read monitored items'
);

set local role anon;
select set_config('request.jwt.claim.sub', '', true);

select throws_ok(
  $$select * from public.monitored_research_items$$,
  '42501',
  null,
  'anonymous user cannot read monitored items'
);

set local role service_role;

select throws_ok(
  $$insert into public.monitored_research_items (
      instrument_id, title, url, source, published_at
    )
    values (
      'a6600000-0000-4000-8000-000000000001',
      'Nieprawidłowy URL',
      'http://example.test/insecure',
      'Źródło testowe',
      current_date
    )$$,
  '23514',
  null,
  'monitored item URL must use HTTPS'
);

select throws_ok(
  $$insert into public.monitored_research_items (
      instrument_id, title, url, source, published_at, content_kind
    )
    values (
      'a6600000-0000-4000-8000-000000000001',
      'Nieprawidłowy rodzaj',
      'https://example.test/invalid-kind',
      'Źródło testowe',
      current_date,
      'unknown'
    )$$,
  '23514',
  null,
  'content kind must be one of the supported values'
);

select throws_ok(
  $$insert into public.monitored_research_items (
      instrument_id, title, url, source, published_at
    )
    values (
      'a6600000-0000-4000-8000-000000000001',
      'Duplikat',
      'https://example.test/article-1',
      'Źródło testowe',
      current_date
    )$$,
  '23505',
  null,
  'same URL cannot be saved twice for one instrument'
);

select * from finish();
rollback;
