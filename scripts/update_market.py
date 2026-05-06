import json
import os
import sys
from datetime import date
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[1]
STOCKS_PATH = ROOT / "data" / "stocks.json"
MARKET_PATH = ROOT / "data" / "market.json"
SUPABASE_URL = os.getenv("SUPABASE_URL", "https://kawztespuaiztftoifdk.supabase.co")
SUPABASE_KEY = os.getenv("SUPABASE_KEY", "sb_publishable_Ydf2JJK06d4GMTE2awOSwg_3GZLTR27")


def exchange_prefix(code: str) -> str:
    return "1" if code.startswith(("6", "9")) else "0"


def secu_code(code: str) -> str:
    if code.startswith(("6", "9")):
        return f"{code}.SH"
    if code.startswith(("4", "8")):
        return f"{code}.BJ"
    return f"{code}.SZ"


def summarize_business(text: str) -> str:
    if not text:
        return ""
    clean = text.split("等", 1)[0]
    for phrase in ("主要从事", "主营业务为", "公司主营业务为", "业务包括", "产品包括"):
        clean = clean.replace(phrase, "")
    parts = []
    for token in clean.replace("，", "、").replace(",", "、").replace("；", "、").replace(";", "、").split("、"):
        token = token.strip()
        for suffix in ("研发", "生产", "销售", "服务", "运营", "制造", "加工", "冶炼"):
            if token.endswith(suffix):
                token = token[: -len(suffix)]
        if token:
            parts.append(token)
    return "、".join(parts[:4])


def fetch_business_remark(code: str) -> str:
    params = urlencode(
        {
            "reportName": "RPT_F10_ORG_BASICINFO",
            "columns": "SECUCODE,MAIN_BUSINESS,PRODUCT_NAME,EM2016",
            "filter": f'(SECUCODE="{secu_code(code)}")',
            "pageNumber": "1",
            "pageSize": "1",
            "source": "HSF10",
            "client": "PC",
        }
    )
    request = Request(
        f"https://datacenter.eastmoney.com/securities/api/data/v1/get?{params}",
        headers={"User-Agent": "Mozilla/5.0"},
    )
    with urlopen(request, timeout=20) as response:
        payload = json.loads(response.read().decode("utf-8"))
    rows = ((payload.get("result") or {}).get("data") or [])
    if not rows:
        return ""
    row = rows[0]
    return summarize_business(row.get("MAIN_BUSINESS") or row.get("PRODUCT_NAME") or row.get("EM2016") or "")


def number_or_none(value):
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def stock_from_db(row: dict) -> dict:
    return {
        "code": str(row.get("code") or "").zfill(6),
        "name": row.get("name") or row.get("code") or "",
        "remark": row.get("remark") or "",
        "recommender": row.get("recommender") or "",
        "startDate": row.get("start_date") or "",
        "startPrice": number_or_none(row.get("start_price")),
        "highPrice": number_or_none(row.get("high_price")),
        "closePrice": number_or_none(row.get("close_price")),
        "updatedAt": row.get("last_quote_date") or "",
        "deleted": bool(row.get("deleted")),
        "createdAt": row.get("created_at") or "",
        "sortOrder": number_or_none(row.get("sort_order")),
    }


def load_local_stocks() -> list[dict]:
    source = json.loads(STOCKS_PATH.read_text(encoding="utf-8"))
    return source.get("stocks", source)


def fetch_supabase_stocks() -> list[dict]:
    if not SUPABASE_URL or not SUPABASE_KEY:
        return []
    request = Request(
        f"{SUPABASE_URL.rstrip('/')}/rest/v1/stocks?select=*&deleted=eq.false",
        headers={
            "apikey": SUPABASE_KEY,
            "Authorization": f"Bearer {SUPABASE_KEY}",
            "Content-Type": "application/json",
        },
    )
    with urlopen(request, timeout=30) as response:
        rows = json.loads(response.read().decode("utf-8"))
    stocks = [
        stock_from_db(row)
        for row in rows
        if not (row.get("code") == "000001" and row.get("deleted") and row.get("recommender") == "测试")
    ]
    stocks.sort(key=lambda stock: stock.get("code") or "")
    stocks.sort(key=lambda stock: stock.get("createdAt") or "", reverse=True)
    stocks.sort(
        key=lambda stock: stock["sortOrder"] if stock.get("sortOrder") is not None else float("inf")
    )
    return stocks


def load_stocks() -> list[dict]:
    try:
        stocks = fetch_supabase_stocks()
        if stocks:
            return stocks
    except Exception as exc:
        print(f"Supabase stock load failed: {exc}", file=sys.stderr)
    return load_local_stocks()


def fetch_history(stock: dict) -> dict:
    code = str(stock["code"]).zfill(6)
    start_date = str(stock.get("startDate") or date.today().isoformat()).replace("-", "")
    params = urlencode(
        {
            "secid": f"{exchange_prefix(code)}.{code}",
            "fields1": "f1,f2,f3,f4,f5,f6",
            "fields2": "f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61",
            "klt": "101",
            "fqt": "1",
            "beg": start_date,
            "end": "20500101",
        }
    )
    request = Request(
        f"https://push2his.eastmoney.com/api/qt/stock/kline/get?{params}",
        headers={"User-Agent": "Mozilla/5.0"},
    )
    with urlopen(request, timeout=20) as response:
        payload = json.loads(response.read().decode("utf-8"))

    data = payload.get("data") or {}
    klines = data.get("klines") or []
    if not klines:
        raise RuntimeError(f"No market data returned for {code}")

    parsed = []
    for line in klines:
        fields = line.split(",")
        parsed.append(
            {
                "date": fields[0],
                "open": float(fields[1]),
                "close": float(fields[2]),
                "high": float(fields[3]),
                "low": float(fields[4]),
            }
        )

    first = parsed[0]
    last = parsed[-1]
    old_high = float(stock.get("highPrice") or 0)
    history_high = max(item["high"] for item in parsed)
    start_price = float(stock.get("startPrice") or first["close"])

    return {
        **stock,
        "name": stock.get("name") or data.get("name") or code,
        "code": code,
        "remark": stock.get("remark") or fetch_business_remark(code),
        "startDate": stock.get("startDate") or first["date"],
        "startPrice": round(start_price, 3),
        "highPrice": round(max(old_high, history_high), 3),
        "closePrice": round(last["close"], 3),
        "updatedAt": last["date"],
    }


def sync_supabase(stocks: list[dict]) -> None:
    if not SUPABASE_URL or not SUPABASE_KEY:
        return
    rows = [
        {
            "code": stock["code"],
            "name": stock.get("name") or stock["code"],
            "remark": stock.get("remark") or "",
            "recommender": stock.get("recommender") or "",
            "start_date": stock.get("startDate"),
            "start_price": stock.get("startPrice"),
            "high_price": stock.get("highPrice"),
            "close_price": stock.get("closePrice"),
            "last_quote_date": stock.get("updatedAt"),
            "deleted": bool(stock.get("deleted", False)),
        }
        for stock in stocks
    ]
    request = Request(
        f"{SUPABASE_URL.rstrip('/')}/rest/v1/stocks?on_conflict=code",
        data=json.dumps(rows, ensure_ascii=False).encode("utf-8"),
        headers={
            "apikey": SUPABASE_KEY,
            "Authorization": f"Bearer {SUPABASE_KEY}",
            "Content-Type": "application/json",
            "Prefer": "resolution=merge-duplicates",
        },
        method="POST",
    )
    with urlopen(request, timeout=30) as response:
        response.read()


def main() -> int:
    stocks = load_stocks()
    updated = []
    failures = []

    for stock in stocks:
        try:
            updated.append(fetch_history(stock))
        except Exception as exc:
            failures.append(f"{stock.get('code')}: {exc}")
            updated.append(stock)

    payload = {
        "updatedAt": date.today().isoformat(),
        "source": "eastmoney",
        "stocks": updated,
        "failures": failures,
    }
    MARKET_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    if failures:
        print("\n".join(failures), file=sys.stderr)
    try:
        sync_supabase(updated)
    except Exception as exc:
        print(f"Supabase sync failed: {exc}", file=sys.stderr)
    print(f"Updated {len(updated)} stocks")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
