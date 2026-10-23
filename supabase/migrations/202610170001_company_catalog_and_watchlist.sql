create table public.instrument_catalog (
  id uuid primary key default gen_random_uuid(),
  company_name text not null
    check (char_length(btrim(company_name)) between 1 and 200),
  ticker text not null
    check (char_length(btrim(ticker)) between 1 and 32),
  isin text not null
    check (isin ~ '^[A-Z]{2}[A-Z0-9]{9}[0-9]$'),
  market text not null
    check (market in ('gpw_main', 'newconnect')),
  source_url text not null
    check (source_url ~* '^https?://'),
  source_date date not null,
  confidence text not null
    check (confidence in ('certain', 'uncertain')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (isin, market)
);

create index instrument_catalog_ticker_idx
  on public.instrument_catalog (lower(ticker));

create table public.user_watchlist (
  user_id uuid not null references auth.users (id) on delete cascade,
  instrument_id uuid not null
    references public.instrument_catalog (id) on delete cascade,
  note text not null default '' check (char_length(note) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, instrument_id)
);

alter table public.instrument_catalog enable row level security;
alter table public.user_watchlist enable row level security;

revoke all on public.instrument_catalog from anon, authenticated;
grant select on public.instrument_catalog to authenticated;
create policy "Authenticated users can read the instrument catalog"
  on public.instrument_catalog for select to authenticated
  using (true);

revoke all on public.user_watchlist from anon, authenticated;
grant select, insert, update, delete on public.user_watchlist to authenticated;
create policy "Users can read their own watchlist"
  on public.user_watchlist for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "Users can add items to their own watchlist"
  on public.user_watchlist for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "Users can update their own watchlist"
  on public.user_watchlist for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "Users can remove items from their own watchlist"
  on public.user_watchlist for delete to authenticated
  using ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.instrument_catalog to service_role;
grant select, insert, update, delete on public.user_watchlist to service_role;
