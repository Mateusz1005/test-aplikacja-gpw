-- Monitorowanie RSS: artykuły o spółkach odkryte poprzez automatyczne wyszukiwanie
create table public.monitored_research_items (
  id uuid primary key default gen_random_uuid(),
  instrument_id uuid not null
    references public.instrument_catalog (id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 500),
  url text not null check (url ~* '^https://'),
  source text not null check (char_length(btrim(source)) between 1 and 200),
  description text check (description is null or char_length(description) <= 500),
  published_at date not null,
  discovered_at timestamptz not null default now(),
  content_kind text not null default 'news'
    check (content_kind in ('news', 'report', 'analyst', 'video', 'schedule')),
  is_reviewed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (url, instrument_id)
);

create index monitored_research_items_instrument_idx
  on public.monitored_research_items (instrument_id, discovered_at desc);
create index monitored_research_items_reviewed_idx
  on public.monitored_research_items (instrument_id, is_reviewed, published_at desc);
create index monitored_research_items_kind_idx
  on public.monitored_research_items (instrument_id, content_kind, published_at desc);

-- Metadane ostatniego sprawdzenia dla każdej spółki
create table public.research_monitor_state (
  instrument_id uuid primary key
    references public.instrument_catalog (id) on delete cascade,
  last_checked_at timestamptz not null default now(),
  last_successful_check_at timestamptz,
  check_error text,
  news_checked_at timestamptz,
  analyst_checked_at timestamptz,
  video_checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index research_monitor_state_last_check_idx
  on public.research_monitor_state (last_checked_at asc);

-- RLS: użytkownicy z aktywnym dostępem mogą czytać znalezione artykuły
alter table public.monitored_research_items enable row level security;
alter table public.research_monitor_state enable row level security;

revoke all on public.monitored_research_items from public, anon, authenticated;
grant select on public.monitored_research_items to authenticated;
create policy "Active users can read monitored research items"
  on public.monitored_research_items for select to authenticated
  using ((select public.has_active_access()));

revoke all on public.research_monitor_state from public, anon, authenticated;
grant select on public.research_monitor_state to authenticated;
create policy "Active users can read monitor state"
  on public.research_monitor_state for select to authenticated
  using ((select public.has_active_access()));

-- Service role do pisania monitorowanych artykułów
grant select, insert, update on public.monitored_research_items to service_role;
grant select, insert, update on public.research_monitor_state to service_role;
