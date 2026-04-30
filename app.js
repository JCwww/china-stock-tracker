const SUPABASE_URL = "https://kawztespuaiztftoifdk.supabase.co";
const SUPABASE_KEY = "sb_publishable_Ydf2JJK06d4GMTE2awOSwg_3GZLTR27";
const PUBLIC_DATA_URL = "./data/market.json";
const FALLBACK_DATA_URL = "./data/stocks.json";

const state = {
  allStocks: [],
  stocks: [],
  query: "",
  sortKey: "",
  sortDirection: "desc",
  recentTradingDate: "",
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

function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function today() {
  return formatDate(new Date());
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

function sohuCode(code) {
  return `cn_${code}`;
}

function money(value) {
  if (value === null || value === undefined || value === "") return "-";
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

function updateClock() {
  els.clock.textContent = new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date());
}

function supabaseHeaders(extra = {}) {
  return {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

async function supabaseRequest(path, options = {}) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: supabaseHeaders(options.headers),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Supabase HTTP ${response.status}`);
  }
  if (response.status === 204) return null;
  return response.json();
}

function fromDb(row) {
  const numberOrNull = (value) => (value === null || value === undefined ? null : Number(value));
  return {
    code: row.code,
    name: row.name,
    remark: row.remark || "",
    recommender: row.recommender || "",
    startDate: row.start_date || "",
    startPrice: numberOrNull(row.start_price),
    highPrice: numberOrNull(row.high_price),
    closePrice: numberOrNull(row.close_price),
    updatedAt: row.last_quote_date || "",
    deleted: Boolean(row.deleted),
    createdAt: row.created_at || "",
  };
}

function createdTime(stock) {
  const time = Date.parse(stock.createdAt || "");
  return Number.isFinite(time) ? time : 0;
}

function compareCreatedDesc(a, b) {
  const timeDiff = createdTime(b) - createdTime(a);
  if (timeDiff !== 0) return timeDiff;
  return String(a.code || "").localeCompare(String(b.code || ""));
}

function syncActiveStocks() {
  state.allStocks = [...state.allStocks].sort(compareCreatedDesc);
  state.stocks = state.allStocks.filter((stock) => !stock.deleted);
}

function toDb(stock) {
  return {
    code: stock.code,
    name: stock.name || stock.code,
    remark: stock.remark || "",
    recommender: stock.recommender || "",
    start_date: stock.startDate || state.recentTradingDate || previousWeekday(),
    start_price: Number(stock.startPrice) || null,
    high_price: Number(stock.highPrice) || null,
    close_price: Number(stock.closePrice) || null,
    last_quote_date: stock.updatedAt || null,
    deleted: Boolean(stock.deleted),
  };
}

async function loadRemoteStocks() {
  const rows = await supabaseRequest("stocks?select=*&order=created_at.desc,code.asc");
  state.allStocks = rows
    .map(fromDb)
    .filter((stock) => !(stock.code === "000001" && stock.deleted && stock.recommender === "测试"));
  syncActiveStocks();
}

async function upsertRemoteStock(stock) {
  const rows = await supabaseRequest("stocks?on_conflict=code", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify(toDb(stock)),
  });
  const saved = fromDb(rows[0]);
  state.allStocks = [saved, ...state.allStocks.filter((item) => item.code !== saved.code)];
  syncActiveStocks();
  return saved;
}

async function patchRemoteStock(code, patch) {
  const rows = await supabaseRequest(`stocks?code=eq.${encodeURIComponent(code)}`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(patch),
  });
  const saved = fromDb(rows[0]);
  state.allStocks = state.allStocks.map((stock) => (stock.code === saved.code ? saved : stock));
  syncActiveStocks();
  return saved;
}

async function loadJson(url) {
  const response = await fetch(`${url}?t=${Date.now()}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function loadFallbackStocks() {
  try {
    const payload = await loadJson(PUBLIC_DATA_URL);
    return Array.isArray(payload.stocks) ? payload.stocks : payload;
  } catch {
    const payload = await loadJson(FALLBACK_DATA_URL);
    return Array.isArray(payload.stocks) ? payload.stocks : payload;
  }
}

function stockLabel(stock) {
  return `${stock.name || stock.code}（${stock.code}）`;
}

function renderSelect(select, stocks, placeholder) {
  select.textContent = "";
  select.classList.add("placeholder");
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
  renderSelect(els.history, state.allStocks, "选择历史股票");
  renderSelect(
    els.trash,
    state.allStocks.filter((stock) => stock.deleted),
    "选择已删除股票",
  );
}

function sortValue(stock, index, key) {
  if (key === "index") return index + 1;
  if (key === "startDate") return Date.parse(stock.startDate || "") || 0;
  if (key === "increase" || key === "highDrawdown" || key === "startDrawdown") return calculate(stock)[key];
  return Number(stock[key]);
}

function sortStocks(stocks) {
  if (!state.sortKey) return [...stocks].sort(compareCreatedDesc);
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

function filteredStocks() {
  const query = state.query.trim().toLowerCase();
  const stocks = query
    ? state.stocks.filter((stock) => stock.code.includes(query) || String(stock.name || "").toLowerCase().includes(query))
    : state.stocks;
  return sortStocks(stocks);
}

function updateSortButtons() {
  for (const button of els.sortButtons) {
    const active = button.dataset.sort === state.sortKey;
    button.classList.toggle("active", active);
    button.dataset.direction = active ? state.sortDirection : "";
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

    cells.startDate.addEventListener("change", async () => {
      if (!cells.startDate.value || cells.startDate.value === stock.startDate) return;
      await changeStartDate(stock, cells.startDate.value, cells.startDate);
    });

    cells.remark.addEventListener("change", async () => {
      await patchRemoteStock(stock.code, { remark: cells.remark.value.trim() });
      render();
      els.status.textContent = `${stock.name || stock.code} 备注已保存`;
    });

    cells.recommender.addEventListener("change", async () => {
      await patchRemoteStock(stock.code, { recommender: cells.recommender.value.trim() });
      render();
      els.status.textContent = `${stock.name || stock.code} 推荐人已保存`;
    });

    row.querySelector(".delete").addEventListener("click", async () => {
      await patchRemoteStock(stock.code, { deleted: true });
      render();
      els.status.textContent = `${stock.name || stock.code} 已移入垃圾桶`;
    });

    els.rows.appendChild(row);
  });
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
  return { date, open: Number(open), close: Number(close), high: Number(high), low: Number(low) };
}

function parseSohuKline(row) {
  return {
    date: row[0],
    open: Number(row[1]),
    close: Number(row[2]),
    low: Number(row[5]),
    high: Number(row[6]),
  };
}

function summarizeBusiness(text) {
  const clean = String(text || "")
    .replace(/等.*$/u, "")
    .replace(/主要从事|主营业务为|公司主营业务为|业务包括|产品包括|提供|基于|符合国家|战略方向|为客户/gu, "")
    .trim();
  const parts = clean
    .split(/[、，,；;及和]/u)
    .map((part) =>
      part
        .replace(/.*的/u, "")
        .replace(/(一体化|产品以|产品|业务|相关|解决方案)$/u, "")
        .replace(/(的)?(研发|生产|销售|服务|运营|制造|加工|冶炼)$/u, "")
        .trim(),
    )
    .map((part) => part.replace(/^以/u, "").trim())
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
      if (match) results.push({ code: normalizeCode(match.Code), name: match.Name || name });
      else failed.push(name);
    } catch {
      failed.push(name);
    }
  }
  return { results, failed };
}

async function resolveStockNameFromCode(code) {
  const profile = await fetchStockProfile(code);
  if (profile.name && profile.name !== code) return profile.name;
  const resolved = await resolveStockCodesFromNames([code]);
  return (resolved.results[0] && resolved.results[0].name) || code;
}

async function fetchStockProfile(code) {
  const url = new URL("https://datacenter.eastmoney.com/securities/api/data/v1/get");
  url.searchParams.set("reportName", "RPT_F10_ORG_BASICINFO");
  url.searchParams.set("columns", "SECUCODE,SECURITY_NAME_ABBR,MAIN_BUSINESS,PRODUCT_NAME,EM2016");
  url.searchParams.set("filter", `(SECUCODE="${secuCode(code)}")`);
  url.searchParams.set("pageNumber", "1");
  url.searchParams.set("pageSize", "1");
  url.searchParams.set("source", "HSF10");
  url.searchParams.set("client", "PC");

  try {
    const payload = await jsonp(url.toString(), "callback");
    const row = payload && payload.result && payload.result.data && payload.result.data[0];
    if (!row) return { name: "", remark: "" };
    return {
      name: row.SECURITY_NAME_ABBR || "",
      remark: summarizeBusiness(row.MAIN_BUSINESS || row.PRODUCT_NAME || row.EM2016) || "",
    };
  } catch {
    return { name: "", remark: "" };
  }
}

async function fetchBusinessRemark(code) {
  return (await fetchStockProfile(code)).remark;
}

async function fetchStockFromEastMoney(code, startDate, forcedStartPrice) {
  const cleanCode = normalizeCode(code);
  let beg = (startDate || state.recentTradingDate || previousWeekday()).replaceAll("-", "");
  const selectedDate = new Date(`${beg.slice(0, 4)}-${beg.slice(4, 6)}-${beg.slice(6, 8)}T00:00:00`);
  const url = new URL("https://push2his.eastmoney.com/api/qt/stock/kline/get");
  url.searchParams.set("secid", secid(cleanCode));
  url.searchParams.set("fields1", "f1,f2,f3,f4,f5,f6");
  url.searchParams.set("fields2", "f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61");
  url.searchParams.set("klt", "101");
  url.searchParams.set("fqt", "1");
  url.searchParams.set("beg", beg);
  url.searchParams.set("end", "20500101");

  let payload = await jsonp(url.toString());
  let data = payload && payload.data;

  if (!data || !Array.isArray(data.klines) || data.klines.length === 0) {
    const lookback = new Date(selectedDate);
    lookback.setDate(lookback.getDate() - 45);
    const fallbackUrl = new URL(url.toString());
    fallbackUrl.searchParams.set("beg", formatDate(lookback).replaceAll("-", ""));
    fallbackUrl.searchParams.set("end", beg);
    const fallbackPayload = await jsonp(fallbackUrl.toString());
    const fallbackData = fallbackPayload && fallbackPayload.data;
    const fallbackKlines = fallbackData && Array.isArray(fallbackData.klines) ? fallbackData.klines : [];
    if (fallbackKlines.length === 0) throw new Error("未找到该股票的日线数据");
    beg = parseKline(fallbackKlines[fallbackKlines.length - 1]).date.replaceAll("-", "");
    url.searchParams.set("beg", beg);
    payload = await jsonp(url.toString());
    data = payload && payload.data;
  }

  if (!data || !Array.isArray(data.klines) || data.klines.length === 0) throw new Error("未找到该股票的日线数据");

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
    deleted: false,
  };
}

async function fetchStockFromSohu(code, startDate, forcedStartPrice, name = "") {
  const cleanCode = normalizeCode(code);
  const selected = startDate || state.recentTradingDate || previousWeekday();
  const url = new URL("https://q.stock.sohu.com/hisHq");
  url.searchParams.set("code", sohuCode(cleanCode));
  url.searchParams.set("start", selected.replaceAll("-", ""));
  url.searchParams.set("end", today().replaceAll("-", ""));
  url.searchParams.set("stat", "1");
  url.searchParams.set("order", "D");
  url.searchParams.set("period", "d");
  url.searchParams.set("rt", "jsonp");

  let payload = await jsonp(url.toString(), "callback");
  let rows = payload && payload[0] && Array.isArray(payload[0].hq) ? payload[0].hq : [];

  if (rows.length === 0) {
    const lookback = new Date(`${selected}T00:00:00`);
    lookback.setDate(lookback.getDate() - 45);
    url.searchParams.set("start", formatDate(lookback).replaceAll("-", ""));
    url.searchParams.set("end", selected.replaceAll("-", ""));
    payload = await jsonp(url.toString(), "callback");
    rows = payload && payload[0] && Array.isArray(payload[0].hq) ? payload[0].hq : [];
  }

  const klines = rows.map(parseSohuKline).filter((item) => Number.isFinite(item.close));
  if (klines.length === 0) throw new Error("未找到该股票的备用日线数据");
  klines.sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
  const first = klines[0];
  const last = klines[klines.length - 1];

  return {
    code: cleanCode,
    name,
    startDate: first.date,
    startPrice: Number(forcedStartPrice) > 0 ? Number(forcedStartPrice) : first.close,
    highPrice: Math.max(...klines.map((item) => item.high).filter(Number.isFinite)),
    closePrice: last.close,
    updatedAt: last.date,
    deleted: false,
  };
}

async function fetchStockQuote(code, startDate, forcedStartPrice, name = "") {
  try {
    return await fetchStockFromEastMoney(code, startDate, forcedStartPrice);
  } catch {
    return fetchStockFromSohu(code, startDate, forcedStartPrice, name);
  }
}

async function changeStartDate(stock, startDate, input) {
  const oldValue = stock.startDate || "";
  input.disabled = true;
  els.status.textContent = `正在更新 ${stock.name || stock.code}`;
  try {
    const next = await fetchStockQuote(stock.code, startDate, "", stock.name);
    await upsertRemoteStock({ ...stock, ...next, name: stock.name || next.name });
    render();
    els.status.textContent = `${stock.name || stock.code} 已按新起始日期更新`;
  } catch (error) {
    await patchRemoteStock(stock.code, { start_date: startDate });
    render();
    els.status.textContent = `${stock.name || stock.code} 起始日期已保存，行情稍后自动更新`;
  } finally {
    input.disabled = false;
  }
}

async function refreshVisibleStocks() {
  els.status.textContent = "正在刷新";
  for (const stock of state.stocks) {
    try {
      const next = await fetchStockQuote(stock.code, stock.startDate, stock.startPrice, stock.name);
      await upsertRemoteStock({
        ...stock,
        ...next,
        name: stock.name || next.name,
        highPrice: Math.max(Number(stock.highPrice) || 0, Number(next.highPrice) || 0),
      });
    } catch {
      // Keep the existing row if one stock fails.
    }
  }
  render();
  els.status.textContent = `已更新 ${today()}`;
}

async function repairCodeOnlyNames() {
  const targets = state.allStocks.filter((stock) => stock.name === stock.code);
  if (targets.length === 0) return;
  let repaired = 0;

  for (const stock of targets) {
    const name = await resolveStockNameFromCode(stock.code);
    if (name && name !== stock.code) {
      await patchRemoteStock(stock.code, { name });
      repaired += 1;
    }
  }

  if (repaired > 0) {
    render();
    els.status.textContent = `已修正 ${repaired} 个股票名称`;
  }
}

async function initRemoteData() {
  try {
    await loadRemoteStocks();
    const newest = state.allStocks.map((stock) => stock.updatedAt).filter(Boolean).sort().pop();
    state.recentTradingDate = newest || previousWeekday();
    els.startDate.value = state.recentTradingDate;
    render();
    els.status.textContent = newest ? `数据日期 ${newest}` : "数据已载入";
  } catch (error) {
    const fallback = await loadFallbackStocks();
    state.allStocks = fallback.map((stock) => ({ ...stock, deleted: false }));
    syncActiveStocks();
    const newest = state.stocks.map((stock) => stock.updatedAt).filter(Boolean).sort().pop();
    state.recentTradingDate = newest || previousWeekday();
    els.startDate.value = state.recentTradingDate;
    render();
    els.status.textContent = "Supabase 表未就绪，正在显示只读公开数据";
  }

  fetchRecentTradingDay().then((date) => {
    if (!state.recentTradingDate) {
      state.recentTradingDate = date;
      els.startDate.value = date;
    }
  });
  repairCodeOnlyNames();
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
      const resolvedName = entry.name || (await resolveStockNameFromCode(entry.code));
      let fetched;
      try {
        fetched = await fetchStockQuote(entry.code, addDate, entries.length === 1 ? manualStartPrice : "", resolvedName);
      } catch {
        fetched = {
          code: entry.code,
          name: resolvedName,
          startDate: addDate,
          startPrice: entries.length === 1 && Number(manualStartPrice) > 0 ? Number(manualStartPrice) : null,
          highPrice: null,
          closePrice: null,
          updatedAt: null,
          deleted: false,
        };
      }
      const remark = await fetchBusinessRemark(entry.code);
      const saved = await upsertRemoteStock({
        ...fetched,
        name: fetched.name || resolvedName || entry.code,
        remark,
        deleted: false,
      });
      added.push(saved);
    } catch (error) {
      failed.push(`${entry.name || entry.code}${error && error.message ? `：${error.message}` : ""}`);
    }
  }

  els.form.reset();
  els.startDate.value = state.recentTradingDate || "";
  render();
  els.status.textContent =
    failed.length > 0 ? `已添加 ${added.length} 只，失败 ${failed.join("、")}` : `已添加 ${added.length} 只股票`;
});

els.search.addEventListener("input", () => {
  state.query = els.search.value;
  render();
});

els.history.addEventListener("change", () => {
  const stock = state.allStocks.find((item) => item.code === els.history.value);
  if (!stock) return;
  els.code.value = stock.code;
  els.name.value = "";
  els.history.value = "";
});

els.trash.addEventListener("change", async () => {
  const stock = state.allStocks.find((item) => item.code === els.trash.value);
  if (!stock) return;
  await patchRemoteStock(stock.code, { deleted: false });
  render();
  els.status.textContent = `${stock.name || stock.code} 已从垃圾桶恢复`;
});

els.sortButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const key = button.dataset.sort;
    if (state.sortKey === key) state.sortDirection = state.sortDirection === "asc" ? "desc" : "asc";
    else {
      state.sortKey = key;
      state.sortDirection = key === "index" || key === "startDate" ? "asc" : "desc";
    }
    render();
  });
});

els.refresh.addEventListener("click", refreshVisibleStocks);

updateClock();
window.setInterval(updateClock, 1000);
initRemoteData();
