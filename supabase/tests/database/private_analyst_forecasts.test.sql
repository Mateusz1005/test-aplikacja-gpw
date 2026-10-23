begin;

select plan(17);

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
    'a4400000-0000-4000-8000-000000000001',
    'authenticated',
    'authenticated',
    'forecast-user-one@example.test',
    'test-hash',
    now(),
    now(),
    now()
  ),
  (
    'a4400000-0000-4000-8000-000000000002',
    'authenticated',
    'authenticated',
    'forecast-user-two@example.test',
    'test-hash',
    now(),
    now(),
    now()
  ),
  (
    'a4400000-0000-4000-8000-000000000003',
    'authenticated',
    'authenticated',
    'forecast-admin@example.test',
    'test-hash',
    now(),
    now(),
    now()
  );

update public.user_roles
set access_role = 'admin'
where user_id = 'a4400000-0000-4000-8000-000000000003'::uuid;

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
  'a4400000-0000-4000-8000-000000000010',
  'Przykładowa spółka prognozowa',
  'FORECAST',
  'PL0000000010',
  'gpw_main',
  'https://example.test/company',
  current_date,
  'certain'
);

insert into public.user_analyst_forecasts (
  id,
  owner_id,
  instrument_id,
  title,
  analyst_name,
  forecast_period,
  document_date,
  storage_path,
  original_file_name,
  mime_type,
  file_size_bytes,
  sha256
)
values
  (
    'a4400000-0000-4000-8000-000000000020',
    'a4400000-0000-4000-8000-000000000001',
    'a4400000-0000-4000-8000-000000000010',
    'Prognoza użytkownika pierwszego',
    'Dom testowy A',
    '2026',
    current_date,
    'a4400000-0000-4000-8000-000000000001/a4400000-0000-4000-8000-000000000020.pdf',
    'prognoza-a.pdf',
    'application/pdf',
    1024,
    repeat('a', 64)
  ),
  (
    'a4400000-0000-4000-8000-000000000021',
    'a4400000-0000-4000-8000-000000000002',
    'a4400000-0000-4000-8000-000000000010',
    'Prognoza użytkownika drugiego',
    'Dom testowy B',
    '2026',
    current_date,
    'a4400000-0000-4000-8000-000000000002/a4400000-0000-4000-8000-000000000021.pdf',
    'prognoza-b.pdf',
    'application/pdf',
    2048,
    repeat('b', 64)
  );

insert into storage.objects (bucket_id, name, owner_id, metadata)
values
  (
    'analyst-forecasts',
    'a4400000-0000-4000-8000-000000000001/a4400000-0000-4000-8000-000000000020.pdf',
    'a4400000-0000-4000-8000-000000000001',
    '{"mimetype":"application/pdf"}'::jsonb
  ),
  (
    'analyst-forecasts',
    'a4400000-0000-4000-8000-000000000002/a4400000-0000-4000-8000-000000000021.pdf',
    'a4400000-0000-4000-8000-000000000002',
    '{"mimetype":"application/pdf"}'::jsonb
  );

select is(
  (select public from storage.buckets where id = 'analyst-forecasts'),
  false,
  'private forecast bucket is not public'
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  'a4400000-0000-4000-8000-000000000001',
  true
);

select is(
  (select count(*) from public.user_analyst_forecasts),
  1::bigint,
  'a user can read only their own private forecast metadata'
);

select is(
  (
    select count(*)
    from public.user_analyst_forecasts
    where id = 'a4400000-0000-4000-8000-000000000020'::uuid
  ),
  1::bigint,
  'the owner can read their own forecast'
);

select is(
  (
    select count(*)
    from public.user_analyst_forecasts
    where id = 'a4400000-0000-4000-8000-000000000021'::uuid
  ),
  0::bigint,
  'the owner cannot read another user forecast'
);

select is(
  (select count(*) from storage.objects where bucket_id = 'analyst-forecasts'),
  1::bigint,
  'the owner can read only their private forecast file'
);

select is(
  (
    select count(*)
    from storage.objects
    where bucket_id = 'analyst-forecasts'
      and name = 'a4400000-0000-4000-8000-000000000002/a4400000-0000-4000-8000-000000000021.pdf'
  ),
  0::bigint,
  'the owner cannot read another user forecast file'
);

select set_config(
  'request.jwt.claim.sub',
  'a4400000-0000-4000-8000-000000000002',
  true
);

select is(
  (select count(*) from public.user_analyst_forecasts),
  1::bigint,
  'a second user can read only their own private forecast metadata'
);

select is(
  (select count(*) from storage.objects where bucket_id = 'analyst-forecasts'),
  1::bigint,
  'a second user can read only their own private forecast file'
);

select is(
  (
    select count(*)
    from storage.objects
    where bucket_id = 'analyst-forecasts'
      and name = 'a4400000-0000-4000-8000-000000000001/a4400000-0000-4000-8000-000000000020.pdf'
  ),
  0::bigint,
  'a second user cannot read the first user file'
);

select throws_ok(
  $$insert into public.user_analyst_forecasts (
      owner_id, instrument_id, title, storage_path, original_file_name,
      mime_type, file_size_bytes, sha256
    )
    values (
      'a4400000-0000-4000-8000-000000000001'::uuid,
      'a4400000-0000-4000-8000-000000000010'::uuid,
      'Próba podszycia',
      'a4400000-0000-4000-8000-000000000001/a4400000-0000-4000-8000-000000000022.pdf',
      'podszycie.pdf', 'application/pdf', 1024, repeat('c', 64)
    )$$,
  '42501',
  null,
  'a user cannot add a forecast under another owner'
);

select set_config(
  'request.jwt.claim.sub',
  'a4400000-0000-4000-8000-000000000003',
  true
);

select is(
  (select count(*) from public.user_analyst_forecasts),
  2::bigint,
  'an administrator can read every private forecast'
);

select is(
  (select count(*) from storage.objects where bucket_id = 'analyst-forecasts'),
  2::bigint,
  'an administrator can read every private forecast file'
);

reset role;
set local role anon;

select is(
  (select count(*) from storage.objects where bucket_id = 'analyst-forecasts'),
  0::bigint,
  'anonymous users cannot read private forecast files'
);

select throws_ok(
  $$select * from public.user_analyst_forecasts$$,
  '42501',
  null,
  'anonymous users cannot read private forecast metadata'
);

reset role;

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  'a4400000-0000-4000-8000-000000000002',
  true
);

select throws_ok(
  $$insert into public.user_analyst_forecasts (
      id, owner_id, instrument_id, title, storage_path, original_file_name,
      mime_type, file_size_bytes, sha256
    )
    values (
      'a4400000-0000-4000-8000-000000000022'::uuid,
      'a4400000-0000-4000-8000-000000000002'::uuid,
      'a4400000-0000-4000-8000-000000000010'::uuid,
      'Niedozwolony tytuł',
      'a4400000-0000-4000-8000-000000000002/a4400000-0000-4000-8000-000000000022.pdf',
      'nieautoryzowany.pdf', 'application/pdf', 1024, repeat('c', 64)
    )$$,
  '42501',
  null,
  'direct forecast metadata insertion is reserved for the trusted server'
);

select throws_ok(
  $$update public.user_analyst_forecasts
    set title = 'Próba zmiany'
    where id = 'a4400000-0000-4000-8000-000000000021'::uuid$$,
  '42501',
  null,
  'users cannot update forecast metadata directly'
);

select is(
  (select count(*) from public.user_analyst_forecasts),
  1::bigint,
  'only the authenticated user own forecast metadata remains visible'
);

select * from finish();
rollback;
