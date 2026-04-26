import json
import sys
from datetime import date
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[1]
STOCKS_PATH = ROOT / "data" / "stocks.json"
MARKET_PATH = ROOT / "data" / "market.json"


def exchange_prefix(code: str) -> str:
    return "1" if code.startswith(("6", "9")) else "0"


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
        "startDate": stock.get("startDate") or first["date"],
        "startPrice": round(start_price, 3),
        "highPrice": round(max(old_high, history_high), 3),
        "closePrice": round(last["close"], 3),
        "updatedAt": last["date"],
    }


def main() -> int:
    source = json.loads(STOCKS_PATH.read_text(encoding="utf-8"))
    stocks = source.get("stocks", source)
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
    print(f"Updated {len(updated)} stocks")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
