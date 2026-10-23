create table public.company_documents (
  id uuid primary key default gen_random_uuid(),
  instrument_id uuid not null
    references public.instrument_catalog (id) on delete restrict,
  source_kind text not null
    check (source_kind in ('user_upload', 'official_link')),
  document_type text not null
    check (
      document_type in (
        'annual_report',
        'interim_report',
        'current_report',
        'presentation',
        'other'
      )
    ),
  title text not null check (char_length(btrim(title)) between 1 and 300),
  reporting_period text check (reporting_period is null or char_length(reporting_period) <= 32),
  publication_date date,
  source_url text check (source_url is null or source_url ~* '^https://'),
  storage_path text unique,
  original_file_name text
    check (original_file_name is null or char_length(original_file_name) between 1 and 255),
  mime_type text,
  file_size_bytes bigint,
  sha256 text check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  uploaded_by uuid references auth.users (id) on delete set null,
  status text not null default 'queued'
    check (status in ('queued', 'processing', 'ready', 'needs_review', 'failed', 'archived')),
  status_detail text not null default '' check (char_length(status_detail) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  processed_at timestamptz,
  constraint company_documents_storage_metadata_check check (
    (
      source_kind = 'user_upload'
      and storage_path is not null
      and storage_path = uploaded_by::text || '/' || id::text || '.pdf'
      and original_file_name is not null
      and mime_type = 'application/pdf'
      and file_size_bytes between 1 and 26214400
      and sha256 is not null
      and uploaded_by is not null
      and (source_url is null or source_url ~* '^https://')
    )
    or (
      source_kind = 'official_link'
      and storage_path is null
      and original_file_name is null
      and mime_type is null
      and file_size_bytes is null
      and sha256 is null
      and source_url is not null
    )
  ),
  unique (id, instrument_id)
);

create unique index company_documents_instrument_sha256_idx
  on public.company_documents (instrument_id, sha256)
  where sha256 is not null;
create index company_documents_instrument_publication_idx
  on public.company_documents (instrument_id, publication_date desc);
create index company_documents_instrument_status_idx
  on public.company_documents (instrument_id, status);

create table public.company_analysis_items (
  id uuid primary key default gen_random_uuid(),
  instrument_id uuid not null
    references public.instrument_catalog (id) on delete restrict,
  analysis_key text not null
    check (analysis_key ~ '^[a-z0-9][a-z0-9._-]{0,99}$'),
  revision integer not null check (revision > 0),
  category text not null check (category in ('profile', 'risk', 'event')),
  title text not null check (char_length(btrim(title)) between 1 and 300),
  content text not null check (char_length(btrim(content)) between 1 and 5000),
  confidence text not null check (confidence in ('certain', 'uncertain')),
  effective_date date not null,
  change_reason text not null default '' check (char_length(change_reason) <= 2000),
  is_current boolean not null default true,
  created_by uuid references auth.users (id) on delete set null,
  created_via text not null default 'system'
    check (created_via in ('system', 'admin')),
  created_at timestamptz not null default now(),
  unique (instrument_id, analysis_key, revision),
  unique (id, instrument_id)
);

create unique index company_analysis_items_current_idx
  on public.company_analysis_items (instrument_id, analysis_key)
  where is_current;
create index company_analysis_items_category_idx
  on public.company_analysis_items (instrument_id, category, is_current);

create table public.company_analysis_item_sources (
  id uuid primary key default gen_random_uuid(),
  instrument_id uuid not null
    references public.instrument_catalog (id) on delete restrict,
  analysis_item_id uuid not null,
  document_id uuid not null,
  page_number integer check (page_number is null or page_number > 0),
  section text check (section is null or char_length(section) <= 300),
  evidence_excerpt text
    check (evidence_excerpt is null or char_length(evidence_excerpt) <= 1200),
  created_at timestamptz not null default now(),
  foreign key (analysis_item_id, instrument_id)
    references public.company_analysis_items (id, instrument_id) on delete restrict,
  foreign key (document_id, instrument_id)
    references public.company_documents (id, instrument_id) on delete restrict
);

create index company_analysis_item_sources_item_idx
  on public.company_analysis_item_sources (analysis_item_id);
create index company_analysis_item_sources_document_idx
  on public.company_analysis_item_sources (document_id);

create function public.require_company_analysis_source()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.company_analysis_item_sources
    where analysis_item_id = new.id
  ) then
    raise exception using
      errcode = '23514',
      message = 'Every shared analysis item must have at least one source.';
  end if;

  return null;
end;
$$;

create constraint trigger company_analysis_items_require_source
  after insert or update on public.company_analysis_items
  deferrable initially deferred
  for each row execute function public.require_company_analysis_source();

revoke all on function public.require_company_analysis_source() from public, anon, authenticated;

alter table public.company_documents enable row level security;
alter table public.company_analysis_items enable row level security;
alter table public.company_analysis_item_sources enable row level security;

revoke all on public.company_documents from public, anon, authenticated;
grant select on public.company_documents to authenticated;
create policy "Active users can read shared company documents"
  on public.company_documents for select to authenticated
  using (
    (select public.has_active_access())
    and (
      status in ('ready', 'needs_review')
      or uploaded_by = (select auth.uid())
      or (select public.is_admin())
      or exists (
        select 1
        from public.company_analysis_item_sources as source
        where source.document_id = company_documents.id
      )
    )
  );

revoke all on public.company_analysis_items from public, anon, authenticated;
grant select on public.company_analysis_items to authenticated;
create policy "Active users can read shared company analysis"
  on public.company_analysis_items for select to authenticated
  using ((select public.has_active_access()));

revoke all on public.company_analysis_item_sources from public, anon, authenticated;
grant select on public.company_analysis_item_sources to authenticated;
create policy "Active users can read shared analysis sources"
  on public.company_analysis_item_sources for select to authenticated
  using ((select public.has_active_access()));

grant select, insert, update on public.company_documents to service_role;
grant select, insert, update on public.company_analysis_items to service_role;
grant select, insert on public.company_analysis_item_sources to service_role;

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'company-reports',
  'company-reports',
  false,
  26214400,
  array['application/pdf']
)
on conflict (id) do update
set
  name = excluded.name,
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "Active users can read available company reports"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'company-reports'
    and (select public.has_active_access())
    and exists (
      select 1
      from public.company_documents as document
      where document.storage_path = name
        and (
          document.status in ('ready', 'needs_review')
          or document.uploaded_by = (select auth.uid())
          or (select public.is_admin())
          or exists (
            select 1
            from public.company_analysis_item_sources as source
            where source.document_id = document.id
          )
        )
    )
  );

create policy "Users can upload queued company reports to their own folder"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'company-reports'
    and (select public.has_active_access())
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and exists (
      select 1
      from public.company_documents as document
      where document.storage_path = name
        and document.uploaded_by = (select auth.uid())
        and document.status = 'queued'
    )
  );
