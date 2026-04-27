const PUBLIC_DATA_URL = "./data/market.json";
const USER_STOCKS_URL = "./data/user-stocks.json";
const FALLBACK_DATA_URL = "./data/stocks.json";
const LOCAL_KEY = "cn-stock-tracker-local-v1";
const STORE_KEY = "cn-stock-tracker-store-v2";

const state = {
  publicStocks: [],
  stocks: [],
  query: "",
  sortKey: "",
  sortDirection: "desc",
  recentTradingDate: "",
  history: [],
  deletedStocks: [],
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
  history: document.querySelector("#historySelect"),
  trash: document.querySelector("#trashSelect"),
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

function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function previousWeekday() {
  const date = new Date();
  const day = date.getDay();
  if (day === 0) date.setDate(date.getDate() - 2);
  if (day === 6) date.setDate(date.getDate() - 1);
  return formatDate(date);
}

function normalizeCode(code) {
  return String(code || "").replace(/\D/g, "").slice(0, 6);
}

function parseCodes(value) {
  const matches = String(value || "").match(/\d{6}/g) || [];
  return [...new Set(matches.map(normalizeCode))];
}

function parseNames(value) {
  return String(value || "")
    .split(/[\n,，;；]+/u)
    .map((item) => item.trim())
    .filter(Boolean);
}

function exchangePrefix(code) {
  return /^6|^9/.test(code) ? "1" : "0";
}

function secid(code) {
  return `${exchangePrefix(code)}.${code}`;
}

function secuCode(code) {
  if (/^6|^9/.test(code)) return `${code}.SH`;
  if (/^4|^8/.test(code)) return `${code}.BJ`;
  return `${code}.SZ`;
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
    highDrawdown: high > 0 ? (close - high) / high : NaN,
    startDrawdown: start > 0 ? (close - start) / start : NaN,
  };
}

function saveLocal() {
  localStorage.setItem(
    STORE_KEY,
    JSON.stringify({
      stocks: state.stocks,
      history: state.history,
      deletedStocks: state.deletedStocks,
    }),
  );
}

function loadStore() {
  try {
    const store = JSON.parse(localStorage.getItem(STORE_KEY) || "null");
    if (store && Array.isArray(store.stocks)) return store;
    const legacyStocks = JSON.parse(localStorage.getItem(LOCAL_KEY) || "null");
    if (Array.isArray(legacyStocks) && legacyStocks.length > 0) {
      return {
        stocks: legacyStocks,
        history: legacyStocks,
        deletedStocks: [],
      };
    }
    return null;
  } catch {
    return null;
  }
}

function stockLabel(stock) {
  return `${stock.name || stock.code}（${stock.code}）`;
}

function upsertByCode(list, stock) {
  return [stock, ...list.filter((item) => item.code !== stock.code)].slice(0, 80);
}

function renderSelect(select, stocks, placeholder) {
  select.textContent = "";
  const empty = document.createElement("option");
  empty.value = "";
  empty.textContent = placeholder;
  select.appendChild(empty);

  for (const stock of stocks) {
    const option = document.createElement("option");
    option.value = stock.code;
    option.textContent = stockLabel(stock);
    select.appendChild(option);
  }
}

function renderAuxiliarySelects() {
  renderSelect(els.history, state.history, "选择历史股票");
  renderSelect(els.trash, state.deletedStocks, "选择已删除股票");
}

function mergeWithPublicData(stocks, publicStocks) {
  const publicByCode = new Map(publicStocks.map((stock) => [stock.code, stock]));
  return stocks.map((stock) => {
    const publicStock = publicByCode.get(stock.code) || {};
    return {
      ...publicStock,
      ...stock,
      remark: stock.remark || publicStock.remark || "",
      recommender: stock.recommender || publicStock.recommender || "",
    };
  });
}

function buildInitialStocks(store, publicStocks) {
  if (!store) return publicStocks;
  const deletedCodes = new Set((store.deletedStocks || []).map((stock) => stock.code));
  const localStocks = mergeWithPublicData(store.stocks || [], publicStocks);
  const localCodes = new Set(localStocks.map((stock) => stock.code));
  const newPublicStocks = publicStocks.filter((stock) => !localCodes.has(stock.code) && !deletedCodes.has(stock.code));
  return [...localStocks, ...newPublicStocks];
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
  renderAuxiliarySelects();

  stocks.forEach((stock, index) => {
    const row = els.template.content.firstElementChild.cloneNode(true);
    const cells = Object.fromEntries([...row.querySelectorAll("[data-key]")].map((cell) => [cell.dataset.key, cell]));
    const computed = calculate(stock);

    cells.index.textContent = String(index + 1);
    cells.identity.textContent = "";
    const nameLine = document.createElement("a");
    const codeLine = document.createElement("div");
    nameLine.className = "stock-name";
    codeLine.className = "stock-code";
    nameLine.href = `https://stockpage.10jqka.com.cn/${stock.code}/`;
    nameLine.target = "_blank";
    nameLine.rel = "noopener noreferrer";
    nameLine.textContent = stock.name || "-";
    codeLine.textContent = `（${stock.code}）`;
    cells.identity.append(nameLine, codeLine);
    cells.remark.value = stock.remark || "";
    cells.recommender.value = stock.recommender || "";
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

    cells.remark.addEventListener("change", () => {
      replaceStock(stock.code, {
        ...stock,
        remark: cells.remark.value.trim(),
      });
      els.status.textContent = `${stock.name || stock.code} 备注已保存`;
    });

    cells.recommender.addEventListener("change", () => {
      replaceStock(stock.code, {
        ...stock,
        recommender: cells.recommender.value.trim(),
      });
      els.status.textContent = `${stock.name || stock.code} 推荐人已保存`;
    });

    row.querySelector(".delete").addEventListener("click", () => {
      state.deletedStocks = upsertByCode(state.deletedStocks, stock);
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
    const marketPayload = await loadJson(PUBLIC_DATA_URL);
    const marketStocks = Array.isArray(marketPayload.stocks) ? marketPayload.stocks : marketPayload;
    try {
      const userPayload = await loadJson(USER_STOCKS_URL);
      const userStocks = Array.isArray(userPayload.stocks) ? userPayload.stocks : userPayload;
      const userByCode = new Map(userStocks.map((stock) => [stock.code, stock]));
      return marketStocks.map((stock) => {
        const userStock = userByCode.get(stock.code) || {};
        return {
          ...userStock,
          ...stock,
          remark: userStock.remark || stock.remark || "",
          recommender: userStock.recommender || stock.recommender || "",
        };
      });
    } catch {
      return marketStocks;
    }
  } catch {
    const payload = await loadJson(FALLBACK_DATA_URL);
    return Array.isArray(payload.stocks) ? payload.stocks : payload;
  }
}

function jsonp(url, callbackParam = "cb") {
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

    script.src = `${url}${url.includes("?") ? "&" : "?"}${callbackParam}=${callback}`;
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

function summarizeBusiness(text) {
  const clean = String(text || "")
    .replace(/等.*$/u, "")
    .replace(/主要从事|主营业务为|公司主营业务为|业务包括|产品包括/gu, "")
    .trim();
  const parts = clean
    .split(/[、，,；;及和]/u)
    .map((part) => part.replace(/(的)?(研发|生产|销售|服务|运营|制造|加工|冶炼)$/u, "").trim())
    .filter(Boolean);
  return parts.slice(0, 4).join("、");
}

async function fetchRecentTradingDay() {
  const start = new Date();
  start.setDate(start.getDate() - 14);
  const url = new URL("https://push2his.eastmoney.com/api/qt/stock/kline/get");
  url.searchParams.set("secid", "1.000001");
  url.searchParams.set("fields1", "f1,f2,f3,f4,f5,f6");
  url.searchParams.set("fields2", "f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61");
  url.searchParams.set("klt", "101");
  url.searchParams.set("fqt", "1");
  url.searchParams.set("beg", formatDate(start).replaceAll("-", ""));
  url.searchParams.set("end", "20500101");

  try {
    const payload = await jsonp(url.toString());
    const klines = payload && payload.data && payload.data.klines;
    if (!Array.isArray(klines) || klines.length === 0) return previousWeekday();
    return parseKline(klines[klines.length - 1]).date || previousWeekday();
  } catch {
    return previousWeekday();
  }
}

async function resolveStockCodesFromNames(names) {
  const results = [];
  const failed = [];

  for (const name of names) {
    const url = new URL("https://searchapi.eastmoney.com/api/suggest/get");
    url.searchParams.set("input", name);
    url.searchParams.set("type", "14");
    url.searchParams.set("token", "D43BF722C8E33FCD6DC17E80F5BDF918");

    try {
      const payload = await jsonp(url.toString());
      const rows = payload && payload.QuotationCodeTable && payload.QuotationCodeTable.Data;
      const match = Array.isArray(rows) && rows.find((row) => row.Classify === "AStock" && /^\d{6}$/.test(row.Code));
      if (match) {
        results.push({
          code: normalizeCode(match.Code),
          name: match.Name || name,
        });
      } else {
        failed.push(name);
      }
    } catch {
      failed.push(name);
    }
  }

  return { results, failed };
}

async function fetchBusinessRemark(code) {
  const url = new URL("https://datacenter.eastmoney.com/securities/api/data/v1/get");
  url.searchParams.set("reportName", "RPT_F10_ORG_BASICINFO");
  url.searchParams.set("columns", "SECUCODE,MAIN_BUSINESS,PRODUCT_NAME,EM2016");
  url.searchParams.set("filter", `(SECUCODE="${secuCode(code)}")`);
  url.searchParams.set("pageNumber", "1");
  url.searchParams.set("pageSize", "1");
  url.searchParams.set("source", "HSF10");
  url.searchParams.set("client", "PC");

  try {
    const payload = await jsonp(url.toString(), "callback");
    const row = payload && payload.result && payload.result.data && payload.result.data[0];
    const summary = summarizeBusiness(row && (row.MAIN_BUSINESS || row.PRODUCT_NAME || row.EM2016));
    return summary || "";
  } catch {
    return "";
  }
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

async function fillMissingRemarks() {
  const missing = state.stocks.filter((stock) => !stock.remark);
  if (missing.length === 0) return;
  let changed = false;
  for (const stock of missing) {
    const remark = await fetchBusinessRemark(stock.code);
    if (remark) {
      stock.remark = remark;
      changed = true;
    }
  }
  if (changed) {
    saveLocal();
    render();
  }
}

async function init() {
  updateClock();
  window.setInterval(updateClock, 1000);
  const publicStocks = await loadPublicStocks();
  const store = loadStore();
  state.publicStocks = publicStocks;
  state.history = store ? mergeWithPublicData(store.history || [], publicStocks) : [];
  state.deletedStocks = store ? mergeWithPublicData(store.deletedStocks || [], publicStocks) : [];
  state.stocks = buildInitialStocks(store, publicStocks);
  render();
  const newest = state.stocks.map((stock) => stock.updatedAt).filter(Boolean).sort().pop();
  state.recentTradingDate = newest || previousWeekday();
  els.startDate.value = state.recentTradingDate;
  els.status.textContent = newest ? `数据日期 ${newest}` : "数据已载入";

  fetchRecentTradingDay().then((date) => {
    state.recentTradingDate = date;
    els.startDate.value = date;
  });
  fillMissingRemarks();
}

els.form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const codes = parseCodes(els.code.value);
  const names = parseNames(els.name.value);
  let entries = codes.map((code) => ({ code }));
  let failed = [];

  if (entries.length === 0 && names.length > 0) {
    els.status.textContent = `正在查找 ${names.length} 只股票`;
    const resolved = await resolveStockCodesFromNames(names);
    entries = resolved.results;
    failed = resolved.failed;
  }

  if (entries.length === 0) {
    els.status.textContent = "请输入股票代码或股票名称";
    return;
  }

  const addDate = els.startDate.value || state.recentTradingDate || previousWeekday();
  const manualStartPrice = els.startPrice.value;
  const added = [];

  els.status.textContent = `正在添加 ${entries.length} 只股票`;
  for (const entry of entries) {
    try {
      const code = entry.code;
      const fetched = await fetchStockFromEastMoney(code, addDate, entries.length === 1 ? manualStartPrice : "");
      const remark = await fetchBusinessRemark(code);
      added.push({
        ...fetched,
        name: fetched.name || entry.name || code,
        remark,
      });
    } catch (error) {
      failed.push(entry.name || entry.code);
    }
  }

  if (added.length > 0) {
    const addedCodes = new Set(added.map((stock) => stock.code));
    state.stocks = [...added, ...state.stocks.filter((item) => !addedCodes.has(item.code))];
    state.history = added.reduce((history, stock) => upsertByCode(history, stock), state.history);
    state.deletedStocks = state.deletedStocks.filter((stock) => !addedCodes.has(stock.code));
    saveLocal();
    render();
  }

  els.form.reset();
  els.startDate.value = state.recentTradingDate || "";
  els.status.textContent =
    failed.length > 0 ? `已添加 ${added.length} 只，失败 ${failed.join("、")}` : `已添加 ${added.length} 只股票`;
});

els.search.addEventListener("input", () => {
  state.query = els.search.value;
  render();
});

els.history.addEventListener("change", () => {
  const stock = state.history.find((item) => item.code === els.history.value);
  if (!stock) return;
  els.code.value = stock.code;
  els.name.value = "";
  els.history.value = "";
});

els.trash.addEventListener("change", () => {
  const stock = state.deletedStocks.find((item) => item.code === els.trash.value);
  if (!stock) return;
  state.stocks = upsertByCode(state.stocks, stock);
  state.deletedStocks = state.deletedStocks.filter((item) => item.code !== stock.code);
  state.history = upsertByCode(state.history, stock);
  saveLocal();
  render();
  els.status.textContent = `${stock.name || stock.code} 已从垃圾桶恢复`;
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
