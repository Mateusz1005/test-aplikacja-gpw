alter table public.instrument_catalog
  add column investor_relations_url text
    check (investor_relations_url is null or investor_relations_url ~* '^https://'),
  add column next_reporting_date date,
  add column next_reporting_source_url text
    check (next_reporting_source_url is null or next_reporting_source_url ~* '^https://'),
  add column next_reporting_verified_at date,
  add constraint instrument_catalog_reporting_source_check
    check (
      (next_reporting_date is null
        and next_reporting_source_url is null
        and next_reporting_verified_at is null)
      or
      (next_reporting_date is not null
        and next_reporting_source_url is not null
        and next_reporting_verified_at is not null)
    );
