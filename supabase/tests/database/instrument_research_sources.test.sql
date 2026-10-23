begin;

select plan(4);

select lives_ok(
  $$insert into public.instrument_catalog (
      company_name, ticker, isin, market, source_url, source_date, confidence,
      investor_relations_url, next_reporting_date, next_reporting_source_url,
      next_reporting_verified_at
    )
    values (
      'Spółka z potwierdzonymi źródłami', 'SRC1', 'PL0000000001', 'gpw_main',
      'https://www.gpw.pl/listing', current_date, 'certain',
      'https://example.test/ir', current_date + 30,
      'https://example.test/calendar', current_date
    )$$,
  'catalog accepts verified HTTPS research sources'
);

select throws_ok(
  $$insert into public.instrument_catalog (
      company_name, ticker, isin, market, source_url, source_date, confidence,
      investor_relations_url
    )
    values (
      'Spółka z niebezpiecznym linkiem', 'SRC2', 'PL0000000002', 'gpw_main',
      'https://www.gpw.pl/listing', current_date, 'certain',
      'http://example.test/ir'
    )$$,
  '23514',
  null,
  'investor relations links require HTTPS'
);

select throws_ok(
  $$insert into public.instrument_catalog (
      company_name, ticker, isin, market, source_url, source_date, confidence,
      next_reporting_date
    )
    values (
      'Spółka bez źródła terminu', 'SRC3', 'PL0000000003', 'gpw_main',
      'https://www.gpw.pl/listing', current_date, 'certain', current_date + 30
    )$$,
  '23514',
  null,
  'a next reporting date cannot be saved without its source and verification date'
);

select throws_ok(
  $$insert into public.instrument_catalog (
      company_name, ticker, isin, market, source_url, source_date, confidence,
      next_reporting_source_url, next_reporting_verified_at
    )
    values (
      'Spółka bez terminu', 'SRC4', 'PL0000000004', 'gpw_main',
      'https://www.gpw.pl/listing', current_date, 'certain',
      'https://example.test/calendar', current_date
    )$$,
  '23514',
  null,
  'a reporting source and verification date require the reporting date'
);

select * from finish();
rollback;
