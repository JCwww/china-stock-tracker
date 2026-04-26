const PUBLIC_DATA_URL = "./data/market.json";
const FALLBACK_DATA_URL = "./data/stocks.json";
const LOCAL_KEY = "cn-stock-tracker-local-v1";

const state = {
  publicStocks: [],
  stocks: [],
  query: "",
  sortKey: "",
  sortDirection: "desc",
};

const els = {
  rows: document.querySelector("#stockRows"),
  template: document.querySelector("#rowTemplate"),
  empty: document.querySelector("#emptyState"),
  form: document.querySelector("#stockForm"),
  code: document.querySelector("#codeInput"),
  name: document.querySelector("#nameInput"),
  startDate: document.querySelector("#startDateInput"),
  startPrice: document.querySelector("#startPriceInput"),
  search: document.querySelector("#searchInput"),
  refresh: document.querySelector("#refreshButton"),
  status: document.querySelector("#updateStatus"),
  clock: document.querySelector("#clockText"),
  sortButtons: [...document.querySelectorAll("[data-sort]")],
};

function today() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function normalizeCode(code) {
  return String(code || "").replace(/\D/g, "").slice(0, 6);
}

function parseCodes(value) {
  const matches = String(value || "").match(/\d{6}/g) || [];
  return [...new Set(matches.map(normalizeCode))];
}

function exchangePrefix(code) {
  return /^6|^9/.test(code) ? "1" : "0";
}

function secid(code) {
  return `${exchangePrefix(code)}.${code}`;
}

function money(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num.toFixed(2) : "-";
}

function percent(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "-";
  return `${(num * 100).toFixed(2)}%`;
}

function setTrend(cell, value) {
  cell.textContent = percent(value);
  cell.classList.toggle("positive", Number(value) >= 0);
  cell.classList.toggle("negative", Number(value) < 0);
}

function calculate(stock) {
  const start = Number(stock.startPrice);
  const high = Number(stock.highPrice);
  const close = Number(stock.closePrice);
  return {
    increase: start > 0 ? (high - start) / start : NaN,
    highDrawdown: high > 0 ? (high - close) / high : NaN,
    startDrawdown: start > 0 ? (start - close) / start / -1 : NaN,
  };
}

function saveLocal() {
  localStorage.setItem(LOCAL_KEY, JSON.stringify(state.stocks));
}

function loadLocal() {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_KEY) || "null");
  } catch {
    return null;
  }
}

function updateClock() {
  const now = new Date();
  els.clock.textContent = new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(now);
}

function filteredStocks() {
  const query = state.query.trim().toLowerCase();
  const stocks = !query
    ? state.stocks
    : state.stocks.filter((stock) => {
    return stock.code.includes(query) || String(stock.name || "").toLowerCase().includes(query);
  });
  return sortStocks(stocks);
}

function sortValue(stock, index, key) {
  if (key === "index") return index + 1;
  if (key === "startDate") return Date.parse(stock.startDate || "") || 0;
  if (key === "increase" || key === "highDrawdown" || key === "startDrawdown") {
    return calculate(stock)[key];
  }
  return Number(stock[key]);
}

function sortStocks(stocks) {
  if (!state.sortKey) return stocks;
  const direction = state.sortDirection === "asc" ? 1 : -1;
  return [...stocks].sort((a, b) => {
    const originalA = state.stocks.findIndex((stock) => stock.code === a.code);
    const originalB = state.stocks.findIndex((stock) => stock.code === b.code);
    const valueA = sortValue(a, originalA, state.sortKey);
    const valueB = sortValue(b, originalB, state.sortKey);

    if (!Number.isFinite(valueA) && !Number.isFinite(valueB)) return originalA - originalB;
    if (!Number.isFinite(valueA)) return 1;
    if (!Number.isFinite(valueB)) return -1;
    if (valueA === valueB) return originalA - originalB;
    return (valueA - valueB) * direction;
  });
}

function updateSortButtons() {
  for (const button of els.sortButtons) {
    const active = button.dataset.sort === state.sortKey;
    button.classList.toggle("active", active);
    button.dataset.direction = active ? state.sortDirection : "";
  }
}

function replaceStock(code, nextStock) {
  state.stocks = state.stocks.map((stock) => (stock.code === code ? nextStock : stock));
  saveLocal();
  render();
}

async function changeStartDate(stock, startDate, input) {
  const oldValue = stock.startDate || "";
  input.disabled = true;
  els.status.textContent = `正在更新 ${stock.name || stock.code}`;

  try {
    const next = await fetchStockFromEastMoney(stock.code, startDate, "");
    replaceStock(stock.code, {
      ...stock,
      ...next,
      name: stock.name || next.name,
    });
    els.status.textContent = `${stock.name || stock.code} 已按新起始日期更新`;
  } catch (error) {
    input.value = oldValue;
    input.disabled = false;
    els.status.textContent = error.message || "更新失败";
  }
}

function render() {
  els.rows.textContent = "";
  const stocks = filteredStocks();
  els.empty.hidden = stocks.length > 0;
  updateSortButtons();

  stocks.forEach((stock, index) => {
    const row = els.template.content.firstElementChild.cloneNode(true);
    const cells = Object.fromEntries([...row.querySelectorAll("[data-key]")].map((cell) => [cell.dataset.key, cell]));
    const computed = calculate(stock);

    cells.index.textContent = String(index + 1);
    cells.name.textContent = stock.name || "-";
    cells.code.textContent = stock.code;
    cells.startDate.value = stock.startDate || "";
    cells.startPrice.textContent = money(stock.startPrice);
    cells.highPrice.textContent = money(stock.highPrice);
    cells.closePrice.textContent = money(stock.closePrice);
    setTrend(cells.increase, computed.increase);
    setTrend(cells.highDrawdown, computed.highDrawdown);
    setTrend(cells.startDrawdown, computed.startDrawdown);

    cells.startDate.addEventListener("change", () => {
      if (!cells.startDate.value || cells.startDate.value === stock.startDate) return;
      changeStartDate(stock, cells.startDate.value, cells.startDate);
    });

    row.querySelector(".delete").addEventListener("click", () => {
      state.stocks = state.stocks.filter((item) => item.code !== stock.code);
      saveLocal();
      render();
    });

    els.rows.appendChild(row);
  });
}

async function loadJson(url) {
  const response = await fetch(`${url}?t=${Date.now()}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function loadPublicStocks() {
  try {
    const payload = await loadJson(PUBLIC_DATA_URL);
    return Array.isArray(payload.stocks) ? payload.stocks : payload;
  } catch {
    const payload = await loadJson(FALLBACK_DATA_URL);
    return Array.isArray(payload.stocks) ? payload.stocks : payload;
  }
}

function jsonp(url) {
  return new Promise((resolve, reject) => {
    const callback = `stockCallback_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const script = document.createElement("script");
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error("请求超时"));
    }, 12000);

    function cleanup() {
      window.clearTimeout(timeout);
      script.remove();
      delete window[callback];
    }

    window[callback] = (payload) => {
      cleanup();
      resolve(payload);
    };

    script.src = `${url}${url.includes("?") ? "&" : "?"}cb=${callback}`;
    script.onerror = () => {
      cleanup();
      reject(new Error("请求失败"));
    };
    document.body.appendChild(script);
  });
}

function parseKline(line) {
  const [date, open, close, high, low] = String(line).split(",");
  return {
    date,
    open: Number(open),
    close: Number(close),
    high: Number(high),
    low: Number(low),
  };
}

async function fetchStockFromEastMoney(code, startDate, forcedStartPrice) {
  const cleanCode = normalizeCode(code);
  const beg = (startDate || today()).replaceAll("-", "");
  const url = new URL("https://push2his.eastmoney.com/api/qt/stock/kline/get");
  url.searchParams.set("secid", secid(cleanCode));
  url.searchParams.set("fields1", "f1,f2,f3,f4,f5,f6");
  url.searchParams.set("fields2", "f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61");
  url.searchParams.set("klt", "101");
  url.searchParams.set("fqt", "1");
  url.searchParams.set("beg", beg);
  url.searchParams.set("end", "20500101");

  const payload = await jsonp(url.toString());
  const data = payload && payload.data;
  if (!data || !Array.isArray(data.klines) || data.klines.length === 0) {
    throw new Error("未找到该股票的日线数据");
  }

  const klines = data.klines.map(parseKline).filter((item) => Number.isFinite(item.close));
  const first = klines[0];
  const last = klines[klines.length - 1];
  const highPrice = Math.max(...klines.map((item) => item.high).filter(Number.isFinite));
  const startPrice = Number(forcedStartPrice) > 0 ? Number(forcedStartPrice) : first.close;

  return {
    code: cleanCode,
    name: data.name || "",
    startDate: first.date,
    startPrice,
    highPrice,
    closePrice: last.close,
    updatedAt: last.date,
  };
}

async function refreshVisibleStocks() {
  els.status.textContent = "正在刷新";
  const refreshed = [];

  for (const stock of state.stocks) {
    try {
      const next = await fetchStockFromEastMoney(stock.code, stock.startDate, stock.startPrice);
      refreshed.push({
        ...stock,
        ...next,
        name: stock.name || next.name,
        highPrice: Math.max(Number(stock.highPrice) || 0, Number(next.highPrice) || 0),
      });
    } catch {
      refreshed.push(stock);
    }
  }

  state.stocks = refreshed;
  saveLocal();
  render();
  els.status.textContent = `已更新 ${today()}`;
}

async function init() {
  updateClock();
  window.setInterval(updateClock, 1000);
  els.startDate.value = "";
  const publicStocks = await loadPublicStocks();
  state.publicStocks = publicStocks;
  state.stocks = loadLocal() || publicStocks;
  render();
  const newest = state.stocks.map((stock) => stock.updatedAt).filter(Boolean).sort().pop();
  els.status.textContent = newest ? `数据日期 ${newest}` : "数据已载入";
}

els.form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const codes = parseCodes(els.code.value);
  if (codes.length === 0) return;

  const addDate = els.startDate.value || today();
  const manualName = els.name.value.trim();
  const manualStartPrice = els.startPrice.value;
  const added = [];
  const failed = [];

  els.status.textContent = `正在添加 ${codes.length} 只股票`;
  for (const code of codes) {
    try {
      const fetched = await fetchStockFromEastMoney(code, addDate, codes.length === 1 ? manualStartPrice : "");
      added.push({
        ...fetched,
        name: codes.length === 1 && manualName ? manualName : fetched.name,
      });
    } catch (error) {
      failed.push(code);
    }
  }

  if (added.length > 0) {
    const addedCodes = new Set(added.map((stock) => stock.code));
    state.stocks = [...added, ...state.stocks.filter((item) => !addedCodes.has(item.code))];
    saveLocal();
    render();
  }

  els.form.reset();
  els.startDate.value = "";
  els.status.textContent =
    failed.length > 0 ? `已添加 ${added.length} 只，失败 ${failed.join("、")}` : `已添加 ${added.length} 只股票`;
});

els.search.addEventListener("input", () => {
  state.query = els.search.value;
  render();
});

els.sortButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const key = button.dataset.sort;
    if (state.sortKey === key) {
      state.sortDirection = state.sortDirection === "asc" ? "desc" : "asc";
    } else {
      state.sortKey = key;
      state.sortDirection = key === "index" || key === "startDate" ? "asc" : "desc";
    }
    render();
  });
});

els.refresh.addEventListener("click", refreshVisibleStocks);

init().catch(() => {
  els.status.textContent = "数据载入失败";
});
