create table public.portfolio_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  ticker text not null
    check (ticker ~ '^[A-Z0-9][A-Z0-9.-]{0,19}$'),
  asset_type text not null
    check (asset_type in ('stock', 'etf')),
  entry_type text not null
    check (entry_type in ('investment', 'dividend')),
  event_date date not null
    check (event_date <= current_date),
  units numeric(20, 6),
  investment_amount numeric(14, 2),
  commission_amount numeric(14, 2),
  dividend_amount numeric(14, 2),
  created_at timestamptz not null default now(),
  constraint portfolio_entries_event_values_check check (
    (
      entry_type = 'investment'
      and units is not null and units > 0
      and investment_amount is not null and investment_amount > 0
      and commission_amount is not null and commission_amount >= 0
      and dividend_amount is null
    )
    or
    (
      entry_type = 'dividend'
      and units is null
      and investment_amount is null
      and commission_amount is null
      and dividend_amount is not null and dividend_amount > 0
    )
  )
);

create index portfolio_entries_user_date_idx
  on public.portfolio_entries (user_id, event_date, created_at);

alter table public.portfolio_entries enable row level security;
revoke all on public.portfolio_entries from anon, authenticated;
grant select, insert, delete on public.portfolio_entries to authenticated;
grant select, insert, update, delete on public.portfolio_entries to service_role;

create policy "Active users read their own portfolio entries"
  on public.portfolio_entries for select to authenticated
  using (
    user_id = (select auth.uid())
    and (select public.has_active_access())
  );

create policy "Active users add their own portfolio entries"
  on public.portfolio_entries for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and (select public.has_active_access())
  );

create policy "Active users delete their own portfolio entries"
  on public.portfolio_entries for delete to authenticated
  using (
    user_id = (select auth.uid())
    and (select public.has_active_access())
  );
