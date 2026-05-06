alter table public.stocks
add column if not exists sort_order integer;

with ordered as (
  select
    code,
    row_number() over (order by created_at desc, code asc) * 10 as next_sort_order
  from public.stocks
  where deleted = false
)
update public.stocks as stocks
set sort_order = ordered.next_sort_order
from ordered
where stocks.code = ordered.code
  and stocks.sort_order is null;

create index if not exists stocks_display_order_idx
on public.stocks (deleted, sort_order, created_at desc);
