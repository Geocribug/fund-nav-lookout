// Scriptable 小组件：显示持仓或观察基金距离近 210 个交易日高点的跌幅。
// 小组件参数：holding（持仓，默认）或 watch（观察列表）。
// 指定并排序基金：holding:100039,005827 或 watch:512400,161725；顺序即展示顺序。

(async () => {
  const TRADING_DAYS = 210;
  const OFF_HOURS_REFRESH_HOURS = 6;
  const MAX_MEDIUM_FUNDS = 3;
  const MAX_LARGE_FUNDS = 7;
  const APP_URL = "https://geocribug.github.io/fund-nav-lookout/";
  const fileManager = FileManager.local();
  const configPath = fileManager.joinPath(fileManager.documentsDirectory(), "fund-nav-lookout-widget-config.json");
  const cachePath = fileManager.joinPath(fileManager.documentsDirectory(), "fund-nav-lookout-widget-cache.json");

  function refreshHours() {
    const hour = new Date().getHours();
    return hour >= 16 && hour < 22 ? 1 : OFF_HOURS_REFRESH_HOURS;
  }

  const activeRefreshHours = refreshHours();

  function readJson(path, fallback) {
    try {
      return fileManager.fileExists(path) ? JSON.parse(fileManager.readString(path)) : fallback;
    } catch (_) {
      return fallback;
    }
  }

  function colorFor(drawdown) {
    if (drawdown >= 28) return new Color("#d75c4a");
    if (drawdown >= 21) return new Color("#db7a3f");
    if (drawdown >= 14) return new Color("#c99b37");
    if (drawdown >= 7) return new Color("#7d8c58");
    return new Color("#578a7c");
  }

  function dateText(timestamp) {
    return new Date(timestamp).toISOString().slice(5, 10);
  }

  function naturalDaysSince(highDate, latestDate) {
    return Math.max(0, Math.round((latestDate - highDate) / (24 * 60 * 60 * 1000)));
  }

  function calculateDrawdown(code, preferredName, source) {
    const name = source.match(/fS_name\s*=\s*"([^"]+)"/)?.[1] || preferredName || code;
    const raw = source.match(/Data_netWorthTrend\s*=\s*(\[[\s\S]*?\]);/)?.[1];
    if (!raw) throw new Error("未找到净值历史");
    const history = JSON.parse(raw)
      .filter((item) => Number.isFinite(item.x) && Number.isFinite(item.y))
      .slice(-TRADING_DAYS);
    if (history.length < 2) throw new Error("净值历史不足");
    const latest = history.at(-1);
    const high = history.reduce((previous, item) => item.y > previous.y ? item : previous);
    return {
      code,
      name,
      latestNav: latest.y,
      latestDate: latest.x,
      highNav: high.y,
      highDate: high.x,
      highElapsedDays: naturalDaysSince(high.x, latest.x),
      drawdown: Math.max(0, ((high.y - latest.y) / high.y) * 100),
      fetchedAt: Date.now(),
    };
  }

  async function getFundResult(fund, cache) {
    const cached = cache[fund.code];
    const cacheStillFresh = cached && Date.now() - cached.fetchedAt < activeRefreshHours * 60 * 60 * 1000;
    if (cacheStillFresh) return cached;
    try {
      const request = new Request(`https://fund.eastmoney.com/pingzhongdata/${fund.code}.js?v=${Date.now()}`);
      request.timeoutInterval = 12;
      const result = calculateDrawdown(fund.code, fund.name, await request.loadString());
      cache[fund.code] = result;
      return result;
    } catch (_) {
      return cached || { code: fund.code, name: fund.name || fund.code, error: "暂时无法更新" };
    }
  }

  function addText(parent, text, font, color, lineLimit = 1) {
    const label = parent.addText(text);
    label.font = font;
    label.textColor = color;
    label.lineLimit = lineLimit;
    label.minimumScaleFactor = 0.7;
    return label;
  }

  function buildEmptyWidget(message) {
    const widget = new ListWidget();
    widget.backgroundColor = new Color("#fbf8f1");
    widget.setPadding(14, 14, 14, 14);
    addText(widget, "净值望远镜", Font.boldSystemFont(15), new Color("#22312d"));
    widget.addSpacer(8);
    addText(widget, message, Font.systemFont(12), new Color("#68736e"), 3);
    widget.url = APP_URL;
    return widget;
  }

  const configuration = readJson(configPath, null);
  if (!configuration) {
    const widget = buildEmptyWidget("请先在 Scriptable 运行“净值望远镜-导入配置”脚本。");
    Script.setWidget(widget);
    if (!config.runsInWidget) await widget.presentMedium();
    Script.complete();
    return;
  }

  const parameter = String(args.widgetParameter || "holding").trim().toLowerCase().replaceAll("，", ",");
  const [listName, requestedCodes] = parameter.split(":", 2);
  const sourceName = listName === "watch" ? "watch" : "holding";
  const sourceFunds = sourceName === "watch" ? configuration.watchlist || [] : configuration.holdings || [];
  const requestedOrder = requestedCodes ? requestedCodes.split(",").map((code) => code.trim()).filter(Boolean) : null;
  const isSmallWidget = config.widgetFamily === "small";
  const isLargeWidget = config.widgetFamily === "large";
  const maxFunds = isSmallWidget ? 1 : isLargeWidget ? MAX_LARGE_FUNDS : MAX_MEDIUM_FUNDS;
  const selected = (requestedOrder ? requestedOrder.map((code) => sourceFunds.find((fund) => fund.code === code)).filter(Boolean) : sourceFunds)
    .slice(0, maxFunds);

  if (!selected.length) {
    const description = sourceName === "watch" ? "观察列表为空，或小组件参数中的基金代码不匹配。" : "持仓列表为空，或小组件参数中的基金代码不匹配。";
    const widget = buildEmptyWidget(description);
    Script.setWidget(widget);
    if (!config.runsInWidget) await widget.presentMedium();
    Script.complete();
    return;
  }

  const cache = readJson(cachePath, {});
  const results = await Promise.all(selected.map((fund) => getFundResult(fund, cache)));
  fileManager.writeString(cachePath, JSON.stringify(cache));

  const widget = new ListWidget();
  widget.backgroundColor = new Color("#fbf8f1");
  widget.setPadding(isLargeWidget ? 13 : 12, 15, isLargeWidget ? 12 : 12, 15);
  widget.url = APP_URL;

  const heading = widget.addStack();
  heading.layoutHorizontally();
  addText(heading, sourceName === "watch" ? "观察基金" : "我的基金", Font.boldSystemFont(isLargeWidget ? 14 : 13), new Color("#22312d"));
  heading.addSpacer();
  addText(heading, isLargeWidget ? "最多 7 只 · 210 日回撤" : "210 日回撤", Font.systemFont(isLargeWidget ? 10 : 11), new Color("#77817c"));
  widget.addSpacer(isLargeWidget ? 8 : 8);

  results.forEach((fund, index) => {
    if (index) widget.addSpacer(isLargeWidget ? 8 : 7);
    const row = widget.addStack();
    row.layoutHorizontally();
    const left = row.addStack();
    left.layoutVertically();
    addText(left, fund.name, Font.mediumSystemFont(isSmallWidget ? 15 : isLargeWidget ? 13 : 12), new Color("#283632"));
    if (fund.error) {
      addText(left, `${fund.code} · ${fund.error}`, Font.systemFont(isLargeWidget ? 10 : 10), new Color("#9a6257"));
      return;
    }
    addText(left, `${fund.code} · 净值 ${fund.latestNav.toFixed(4)} · ${dateText(fund.latestDate)}`, Font.systemFont(isLargeWidget ? 10 : 10), new Color("#77817c"));
    row.addSpacer();
    const right = row.addStack();
    right.layoutVertically();
    right.centerAlignContent();
    addText(right, `−${fund.drawdown.toFixed(2)}%`, Font.boldSystemFont(isSmallWidget ? 24 : isLargeWidget ? 17 : 15), colorFor(fund.drawdown));
    const elapsedDays = Number.isFinite(fund.highElapsedDays) ? fund.highElapsedDays : naturalDaysSince(fund.highDate, fund.latestDate);
    addText(right, `高点 ${fund.highNav.toFixed(4)} · ${elapsedDays}天前`, Font.systemFont(isLargeWidget ? 10 : 9), new Color("#77817c"));
  });

  // 固定底部呼吸感，避免大型组件把剩余高度全部留白。
  widget.addSpacer(isLargeWidget ? 10 : 8);
  const refreshText = activeRefreshHours === 1 ? "收盘时段 · 1小时更新" : `${OFF_HOURS_REFRESH_HOURS}小时缓存`;
  addText(widget, `数据源：天天基金 · ${TRADING_DAYS}日 · ${refreshText}`, Font.systemFont(isLargeWidget ? 9 : 9), new Color("#949b96"));
  widget.refreshAfterDate = new Date(Date.now() + activeRefreshHours * 60 * 60 * 1000);
  Script.setWidget(widget);
  if (!config.runsInWidget) {
    if (isSmallWidget) await widget.presentSmall();
    else if (isLargeWidget) await widget.presentLarge();
    else await widget.presentMedium();
  }
  Script.complete();
})();
