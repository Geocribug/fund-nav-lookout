// Scriptable 大型组件：显示策略组合的当前占比、目标偏离与两种再平衡方案。
// 参数留空或填写 all 显示前 5 个策略；也可填写策略名称并排序，例如：美股科技,核心固收。

(async () => {
  const MAX_LARGE_STRATEGIES = 5;
  const APP_URL = "https://geocribug.github.io/fund-nav-lookout/";
  const fileManager = FileManager.local();
  const configPath = fileManager.joinPath(fileManager.documentsDirectory(), "fund-nav-lookout-strategy-widget-config.json");

  function readJson(path, fallback) {
    try {
      return fileManager.fileExists(path) ? JSON.parse(fileManager.readString(path)) : fallback;
    } catch (_) {
      return fallback;
    }
  }

  function money(value) {
    const amount = Math.abs(Number(value) || 0);
    return `¥${amount.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
  }

  function threshold(targetWeight) {
    return Math.min(5, Math.max(2, targetWeight * 0.25));
  }

  function statusFor(deviation, targetWeight) {
    const absolute = Math.abs(deviation);
    const limit = threshold(targetWeight);
    if (absolute >= limit) return "action";
    if (absolute >= limit / 2) return "watch";
    return "observe";
  }

  function colorFor(status, deviation) {
    if (status === "action") return new Color(deviation > 0 ? "#c45e50" : "#c58a2e");
    if (status === "watch") return new Color("#b08a40");
    return new Color("#578a7c");
  }

  function addText(parent, text, font, color, lineLimit = 1) {
    const label = parent.addText(text);
    label.font = font;
    label.textColor = color;
    label.lineLimit = lineLimit;
    label.minimumScaleFactor = 0.72;
    return label;
  }

  function emptyWidget(message) {
    const widget = new ListWidget();
    widget.backgroundColor = new Color("#fbf8f1");
    widget.setPadding(16, 16, 16, 16);
    addText(widget, "策略再平衡", Font.boldSystemFont(16), new Color("#22312d"));
    widget.addSpacer(8);
    addText(widget, message, Font.systemFont(12), new Color("#68736e"), 3);
    widget.url = APP_URL;
    return widget;
  }

  const storedConfig = readJson(configPath, null);
  const allStrategies = Array.isArray(storedConfig?.strategies) ? storedConfig.strategies
    .filter((item) => item && item.id && item.name && Number(item.targetWeight) > 0)
    .map((item) => ({ ...item, amount: Number(item.amount) || 0, targetWeight: Number(item.targetWeight) })) : [];

  if (!allStrategies.length) {
    const widget = emptyWidget("请先在 Scriptable 运行“策略再平衡-配置”脚本，导入网页配置并填写各策略当前金额。");
    Script.setWidget(widget);
    if (!config.runsInWidget) await widget.presentLarge();
    Script.complete();
    return;
  }

  const parameter = String(args.widgetParameter || "all").trim().replaceAll("，", ",");
  const names = parameter.toLowerCase() === "all" ? null : parameter.split(",").map((name) => name.trim()).filter(Boolean);
  const strategies = (names ? names.map((name) => allStrategies.find((item) => item.id === name || item.name === name)).filter(Boolean) : allStrategies)
    .slice(0, MAX_LARGE_STRATEGIES);
  const totalAmount = allStrategies.reduce((sum, item) => sum + item.amount, 0);
  const targetTotal = allStrategies.reduce((sum, item) => sum + item.targetWeight, 0);

  if (totalAmount <= 0 || targetTotal <= 0) {
    const widget = emptyWidget("请在“策略再平衡-配置”中为每个策略填写当前持有金额。金额支持两位小数。");
    Script.setWidget(widget);
    if (!config.runsInWidget) await widget.presentLarge();
    Script.complete();
    return;
  }

  const finalTotal = Math.max(totalAmount, ...allStrategies.map((item) => item.amount / (item.targetWeight / targetTotal)));
  const rows = strategies.map((item) => {
    const targetWeight = item.targetWeight / targetTotal * 100;
    const actualWeight = item.amount / totalAmount * 100;
    const deviation = actualWeight - targetWeight;
    const desired = totalAmount * targetWeight / 100;
    const adjustment = desired - item.amount;
    const newCapital = Math.max(0, finalTotal * targetWeight / 100 - item.amount);
    return { ...item, targetWeight, actualWeight, deviation, adjustment, newCapital, status: statusFor(deviation, targetWeight) };
  });
  const allRows = allStrategies.map((item) => {
    const targetWeight = item.targetWeight / targetTotal * 100;
    const desired = totalAmount * targetWeight / 100;
    return { newCapital: Math.max(0, finalTotal * targetWeight / 100 - item.amount), adjustment: desired - item.amount };
  });
  const totalNewCapital = allRows.reduce((sum, item) => sum + item.newCapital, 0);
  const totalTransfer = allRows.filter((item) => item.adjustment > 0).reduce((sum, item) => sum + item.adjustment, 0);

  const widget = new ListWidget();
  widget.backgroundColor = new Color("#fbf8f1");
  widget.setPadding(13, 15, 12, 15);
  widget.url = APP_URL;

  const heading = widget.addStack();
  heading.layoutHorizontally();
  addText(heading, "策略再平衡", Font.boldSystemFont(14), new Color("#22312d"));
  heading.addSpacer();
  addText(heading, `当前合计 ${money(totalAmount)}`, Font.systemFont(10), new Color("#68736e"));
  widget.addSpacer(6);

  const summary = widget.addStack();
  summary.layoutHorizontally();
  const newCapitalBox = summary.addStack();
  newCapitalBox.layoutVertically();
  addText(newCapitalBox, "仅新增资金", Font.systemFont(9), new Color("#77817c"));
  addText(newCapitalBox, totalNewCapital > 0.005 ? money(totalNewCapital) : "无需新增", Font.boldSystemFont(13), new Color("#c58a2e"));
  summary.addSpacer();
  const transferBox = summary.addStack();
  transferBox.layoutVertically();
  transferBox.rightAlignContent();
  addText(transferBox, "不增资调仓", Font.systemFont(9), new Color("#77817c"));
  addText(transferBox, totalTransfer > 0.005 ? money(totalTransfer) : "无需调仓", Font.boldSystemFont(13), new Color("#c45e50"));
  widget.addSpacer(8);

  rows.forEach((strategy, index) => {
    if (index) widget.addSpacer(7);
    const row = widget.addStack();
    row.layoutHorizontally();
    const left = row.addStack();
    left.layoutVertically();
    addText(left, strategy.name, Font.mediumSystemFont(13), new Color("#283632"));
    addText(left, `${money(strategy.amount)} · ${strategy.actualWeight.toFixed(1)}% / 目标 ${strategy.targetWeight.toFixed(1)}%`, Font.systemFont(9), new Color("#77817c"));
    row.addSpacer();
    const right = row.addStack();
    right.layoutVertically();
    right.rightAlignContent();
    const deviationText = `${strategy.deviation >= 0 ? "+" : ""}${strategy.deviation.toFixed(1)}pp`;
    addText(right, deviationText, Font.boldSystemFont(15), colorFor(strategy.status, strategy.deviation));
    const newCapitalText = strategy.newCapital > 0.005 ? `新增 ${money(strategy.newCapital)}` : "新增无需";
    const adjustmentText = Math.abs(strategy.adjustment) <= 0.005 ? "调仓无需" : `${strategy.adjustment > 0 ? "买入" : "卖出"} ${money(strategy.adjustment)}`;
    addText(right, `${newCapitalText} · ${adjustmentText}`, Font.systemFont(8), new Color("#68736e"));
  });

  widget.addSpacer(10);
  addText(widget, `目标合计 ${targetTotal.toFixed(1)}% · 偏离阈值 ±2–5pp`, Font.systemFont(8), new Color("#949b96"));
  Script.setWidget(widget);
  if (!config.runsInWidget) await widget.presentLarge();
  Script.complete();
})();