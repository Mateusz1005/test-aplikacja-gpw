begin;

select plan(16);

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
    'a4300000-0000-4000-8000-000000000001',
    'authenticated',
    'authenticated',
    'documents-user-one@example.test',
    'test-hash',
    now(),
    now(),
    now()
  ),
  (
    'a4300000-0000-4000-8000-000000000002',
    'authenticated',
    'authenticated',
    'documents-user-two@example.test',
    'test-hash',
    now(),
    now(),
    now()
  ),
  (
    'a4300000-0000-4000-8000-000000000003',
    'authenticated',
    'authenticated',
    'documents-admin@example.test',
    'test-hash',
    now(),
    now(),
    now()
  );

update public.user_roles
set access_role = 'admin'
where user_id = 'a4300000-0000-4000-8000-000000000003'::uuid;

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
  'a4300000-0000-4000-8000-000000000010',
  'Przykładowa spółka testowa',
  'TEST',
  'PL0000000001',
  'gpw_main',
  'https://example.test/source',
  current_date,
  'certain'
);

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
  'a4300000-0000-4000-8000-000000000011',
  'Druga spółka testowa',
  'TEST2',
  'PL0000000002',
  'gpw_main',
  'https://example.test/source',
  current_date,
  'certain'
);

insert into public.company_documents (
  id,
  instrument_id,
  source_kind,
  document_type,
  title,
  reporting_period,
  publication_date,
  source_url,
  storage_path,
  original_file_name,
  mime_type,
  file_size_bytes,
  sha256,
  uploaded_by,
  status
)
values
  (
    'a4300000-0000-4000-8000-000000000020',
    'a4300000-0000-4000-8000-000000000010',
    'user_upload',
    'annual_report',
    'Raport roczny — gotowy',
    '2025',
    current_date,
    null,
    'a4300000-0000-4000-8000-000000000001/a4300000-0000-4000-8000-000000000020.pdf',
    'raport-roczny.pdf',
    'application/pdf',
    1024,
    repeat('a', 64),
    'a4300000-0000-4000-8000-000000000001',
    'ready'
  ),
  (
    'a4300000-0000-4000-8000-000000000021',
    'a4300000-0000-4000-8000-000000000010',
    'user_upload',
    'interim_report',
    'Raport kwartalny — kolejka',
    '2026-Q2',
    current_date,
    null,
    'a4300000-0000-4000-8000-000000000001/a4300000-0000-4000-8000-000000000021.pdf',
    'raport-kwartalny.pdf',
    'application/pdf',
    2048,
    repeat('b', 64),
    'a4300000-0000-4000-8000-000000000001',
    'queued'
  ),
  (
    'a4300000-0000-4000-8000-000000000024',
    'a4300000-0000-4000-8000-000000000011',
    'official_link',
    'presentation',
    'Oficjalna prezentacja drugiej spółki',
    null,
    current_date,
    'https://example.test/other-company-report',
    null,
    null,
    null,
    null,
    null,
    null,
    'ready'
  );

insert into public.company_analysis_items (
  id,
  instrument_id,
  analysis_key,
  revision,
  category,
  title,
  content,
  confidence,
  effective_date,
  change_reason,
  is_current
)
values
  (
    'a4300000-0000-4000-8000-000000000030',
    'a4300000-0000-4000-8000-000000000010',
    'business.model',
    1,
    'profile',
    'Model działalności',
    'Poprzednia wersja opisu.',
    'certain',
    current_date - 30,
    'Wersja początkowa.',
    false
  ),
  (
    'a4300000-0000-4000-8000-000000000031',
    'a4300000-0000-4000-8000-000000000010',
    'business.model',
    2,
    'profile',
    'Model działalności',
    'Aktualna wersja opisu.',
    'certain',
    current_date,
    'Uwzględniono nowszy raport.',
    true
  );

insert into public.company_analysis_item_sources (
  instrument_id,
  analysis_item_id,
  document_id,
  page_number,
  section,
  evidence_excerpt
)
values
  (
    'a4300000-0000-4000-8000-000000000010',
    'a4300000-0000-4000-8000-000000000030',
    'a4300000-0000-4000-8000-000000000020',
    10,
    'Opis działalności',
    'Potwierdzający fragment poprzedniej wersji.'
  ),
  (
    'a4300000-0000-4000-8000-000000000010',
    'a4300000-0000-4000-8000-000000000031',
    'a4300000-0000-4000-8000-000000000020',
    12,
    'Model biznesowy',
    'Potwierdzający fragment aktualnej wersji.'
  );

select is(
  (select public from storage.buckets where id = 'company-reports'),
  false,
  'company report storage is private'
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  'a4300000-0000-4000-8000-000000000001',
  true
);

select is(
  (select count(*) from public.company_documents),
  3::bigint,
  'an uploader can read their own documents while processing and shared documents'
);

select is(
  (select count(*) from public.company_analysis_items),
  2::bigint,
  'an active user can read shared analysis history'
);

select is(
  (select count(*) from public.company_analysis_item_sources),
  2::bigint,
  'an active user can read analysis provenance'
);

select throws_ok(
  $$insert into public.company_documents (
      instrument_id, source_kind, document_type, title, source_url
    )
    values (
      'a4300000-0000-4000-8000-000000000010'::uuid,
      'official_link', 'other', 'Niedozwolony wpis', 'https://example.test/report'
    )$$,
  '42501',
  null,
  'an active user cannot create shared document records directly'
);

select throws_ok(
  $$update public.company_analysis_items
    set content = 'Nieautoryzowana edycja'
    where id = 'a4300000-0000-4000-8000-000000000031'::uuid$$,
  '42501',
  null,
  'an active user cannot edit shared analysis directly'
);

select set_config(
  'request.jwt.claim.sub',
  'a4300000-0000-4000-8000-000000000002',
  true
);

select is(
  (select count(*) from public.company_documents),
  2::bigint,
  'another active user can read only ready shared documents'
);

select is(
  (
    select count(*)
    from public.company_documents
    where id = 'a4300000-0000-4000-8000-000000000021'::uuid
  ),
  0::bigint,
  'another active user cannot read a document still in the upload queue'
);

select is(
  (select count(*) from public.company_analysis_items),
  2::bigint,
  'another active user can read the same shared analysis history'
);

reset role;
set local role anon;

select throws_ok(
  $$select * from public.company_documents$$,
  '42501',
  null,
  'anonymous users cannot read company documents'
);

select throws_ok(
  $$select * from public.company_analysis_items$$,
  '42501',
  null,
  'anonymous users cannot read shared analysis'
);

reset role;
set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  'a4300000-0000-4000-8000-000000000003',
  true
);

select is(
  (select count(*) from public.company_documents),
  3::bigint,
  'an administrator can read documents requiring processing'
);

reset role;

select throws_ok(
  $$insert into public.company_documents (
      id, instrument_id, source_kind, document_type, title, storage_path,
      original_file_name, mime_type, file_size_bytes, sha256, uploaded_by
    )
    values (
      'a4300000-0000-4000-8000-000000000023'::uuid,
      'a4300000-0000-4000-8000-000000000010'::uuid,
      'user_upload', 'annual_report', 'Duplikat raportu',
      'a4300000-0000-4000-8000-000000000001/a4300000-0000-4000-8000-000000000023.pdf',
      'duplikat.pdf', 'application/pdf', 1024, repeat('a', 64),
      'a4300000-0000-4000-8000-000000000001'::uuid
    )$$,
  '23505',
  null,
  'the same report cannot be added twice for one company'
);

select throws_ok(
  $$insert into public.company_analysis_item_sources (
      instrument_id, analysis_item_id, document_id
    )
    values (
      'a4300000-0000-4000-8000-000000000011'::uuid,
      'a4300000-0000-4000-8000-000000000031'::uuid,
      'a4300000-0000-4000-8000-000000000024'::uuid
    )$$,
  '23503',
  null,
  'an analysis item cannot cite a report from another company'
);

set constraints company_analysis_items_require_source immediate;

select throws_ok(
  $$insert into public.company_analysis_items (
      instrument_id, analysis_key, revision, category, title, content,
      confidence, effective_date
    )
    values (
      'a4300000-0000-4000-8000-000000000010'::uuid,
      'unsupported', 1, 'profile', 'Bez źródła', 'Treść bez źródła.',
      'certain', current_date
    )$$,
  '23514',
  null,
  'every analysis item must be accompanied by a source before commit'
);

set constraints company_analysis_items_require_source deferred;

select throws_ok(
  $$insert into public.company_documents (
      id, instrument_id, source_kind, document_type, title, storage_path,
      original_file_name, mime_type, file_size_bytes, sha256, uploaded_by
    )
    values (
      'a4300000-0000-4000-8000-000000000022'::uuid,
      'a4300000-0000-4000-8000-000000000010'::uuid,
      'user_upload', 'annual_report', 'Za duży raport',
      'a4300000-0000-4000-8000-000000000001/a4300000-0000-4000-8000-000000000022.pdf',
      'za-duzy.pdf', 'application/pdf', 26214401, repeat('c', 64),
      'a4300000-0000-4000-8000-000000000001'::uuid
    )$$,
  '23514',
  null,
  'uploaded reports cannot exceed the 25 MiB limit'
);

select * from finish();
rollback;
