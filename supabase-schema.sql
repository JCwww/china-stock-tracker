create table if not exists public.stocks (
  code text primary key,
  name text not null,
  remark text default '',
  recommender text default '',
  start_date date,
  start_price numeric,
  high_price numeric,
  close_price numeric,
  last_quote_date date,
  deleted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.stocks enable row level security;

drop policy if exists "public read stocks" on public.stocks;
drop policy if exists "public insert stocks" on public.stocks;
drop policy if exists "public update stocks" on public.stocks;

create policy "public read stocks"
on public.stocks for select
using (true);

create policy "public insert stocks"
on public.stocks for insert
with check (true);

create policy "public update stocks"
on public.stocks for update
using (true)
with check (true);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists stocks_set_updated_at on public.stocks;

create trigger stocks_set_updated_at
before update on public.stocks
for each row
execute function public.set_updated_at();

insert into public.stocks (
  code, name, remark, recommender, start_date, start_price, high_price, close_price, last_quote_date, deleted
) values
  ('002716', '湖南白银', '白银、电解铅、黄金、电积铜', '', '2024-01-01', 6.92, 21.3, 11.57, '2026-04-24', false),
  ('300058', '蓝色光标', '数字营销、品牌管理、广告服务', '', '2024-01-01', 11.52, 24.43, 17.4, '2026-04-24', false),
  ('002131', '利欧股份', '数字营销、泵业机械、园林机械', '', '2024-01-01', 5.64, 10.4, 7.37, '2026-04-24', false)
on conflict (code) do update set
  name = excluded.name,
  remark = excluded.remark,
  start_date = excluded.start_date,
  start_price = excluded.start_price,
  high_price = excluded.high_price,
  close_price = excluded.close_price,
  last_quote_date = excluded.last_quote_date,
  deleted = excluded.deleted;
