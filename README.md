# 中国股票跟踪表

一个部署在 GitHub Pages 上的中国 A 股跟踪网页，支持按股票代码增删查，并展示：

- 股票（名称和代码）
- 备注
- 推荐人
- 添加起始日价
- 起始日起最高价
- 今日收盘价
- 涨幅
- 最高价回撤
- 起始价回撤

股票数据现在以 Supabase 的 `stocks` 表为主存储，手机和电脑会读取同一份远端数据。第一次部署时，请在 Supabase SQL Editor 里运行 `supabase-schema.sql`。GitHub Actions 会在工作日 16:10 中国时间附近自动更新 `data/market.json`，并尝试同步 Supabase 股票行情。

## 公式

```text
涨幅 = (起始日起最高价 - 添加起始日价) / 添加起始日价
最高价回撤 = (今日收盘价 - 起始日起最高价) / 起始日起最高价
起始价回撤 = (今日收盘价 - 添加起始日价) / 添加起始日价
```

## 更新公开列表

修改 `data/stocks.json` 后提交到 `main` 分支，等待 `Update market data` workflow 运行，或在 GitHub Actions 页面手动运行它。
