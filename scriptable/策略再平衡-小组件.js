// Scriptable 小号组件：一张卡显示一个策略组合。
// 在小组件 Parameter 中填写策略名称或策略 ID，例如：美股科技。

(async () => {
  try {
    const OFF_HOURS_REFRESH_HOURS = 6;
    const PLAN_COLUMN_WIDTH = 68;
    const fileManager = FileManager.local();
    const configPath = fileManager.joinPath(fileManager.documentsDirectory(), "fund-nav-lookout-strategy-widget-config.json");
    const cachePath = fileManager.joinPath(fileManager.documentsDirectory(), "fund-nav-lookout-strategy-widget-nav-cache.json");

    function refreshHours() {
      const hour = new Date().getHours();
      return hour >= 16 && hour <= 22 ? 1 : OFF_HOURS_REFRESH_HOURS;
    }

    const activeRefreshHours = refreshHours();

    function readJson(path, fallback) {
      try {
        return fileManager.fileExists(path) ? JSON.parse(fileManager.readString(path)) : fallback;
      } catch (_) {
        return fallback;
      }
    }

    function compactMoney(value) {
      const amount = Math.abs(Number(value) || 0);
      if (amount >= 10000) return `¥${(amount / 10000).toFixed(amount >= 100000 ? 1 : 2)}万`;
      return `¥${amount.toFixed(amount >= 1000 ? 0 : 2)}`;
    }

    function headlineMoney(value) {
      const amount = Math.abs(Number(value) || 0);
      return amount >= 1000 ? `¥${(amount / 10000).toFixed(amount >= 100000 ? 1 : 2)}万` : `¥${amount.toFixed(2)}`;
    }

    function addText(parent, text, font, color, lineLimit = 1) {
      const label = parent.addText(text);
      label.font = font;
      label.textColor = color;
      label.lineLimit = lineLimit;
      label.minimumScaleFactor = 0.68;
      return label;
    }

    function addCenteredText(parent, text, font, color, lineLimit = 1) {
      const label = addText(parent, text, font, color, lineLimit);
      label.centerAlignText();
      return label;
    }

    function addLeftAlignedText(parent, text, font, color, lineLimit = 1) {
      const label = addText(parent, text, font, color, lineLimit);
      label.leftAlignText();
      return label;
    }

    function emptyWidget(message) {
      const widget = new ListWidget();
      widget.backgroundColor = new Color("#fbf8f1");
      widget.setPadding(13, 13, 13, 13);
      addText(widget, "策略组合", Font.boldSystemFont(15), new Color("#22312d"));
      widget.addSpacer(7);
      addText(widget, message, Font.systemFont(11), new Color("#68736e"), 4);
      return widget;
    }

    function latestDailyChange(member, source) {
      const raw = source.match(/Data_netWorthTrend\s*=\s*(\[[\s\S]*?\]);/)?.[1];
      if (!raw) throw new Error("未找到净值历史");
      const history = JSON.parse(raw).filter((item) => Number.isFinite(item.x) && Number.isFinite(item.y));
      if (history.length < 2) throw new Error("净值历史不足");
      const latest = history.at(-1);
      const previous = history.at(-2);
      if (!latest || !previous || previous.y <= 0) throw new Error("最新净值无效");
      return {
        ...member,
        dailyChange: ((latest.y / previous.y) - 1) * 100,
        latestDate: new Date(latest.x).toISOString().slice(0, 10),
        fetchedAt: Date.now(),
      };
    }

    async function getMemberDailyChange(member, cache) {
      const cached = cache[member.code];
      const cacheStillFresh = cached && Date.now() - cached.fetchedAt < activeRefreshHours * 60 * 60 * 1000;
      if (cacheStillFresh) return { ...member, ...cached };
      try {
        const request = new Request(`https://fund.eastmoney.com/pingzhongdata/${member.code}.js?v=${Date.now()}`);
        request.timeoutInterval = 12;
        const result = latestDailyChange(member, await request.loadString());
        cache[member.code] = {
          dailyChange: result.dailyChange,
          latestDate: result.latestDate,
          fetchedAt: result.fetchedAt,
        };
        return result;
      } catch (_) {
        return cached ? { ...member, ...cached } : member;
      }
    }

    function memberStats(members) {
      const valid = (Array.isArray(members) ? members : [])
        .filter((member) => Number.isFinite(Number(member?.dailyChange)));
      if (!valid.length) return { count: Array.isArray(members) ? members.length : 0, dailyChange: null };
      const amountTotal = valid.reduce((sum, member) => sum + Math.max(0, Number(member.amount) || 0), 0);
      const dailyChange = amountTotal > 0
        ? valid.reduce((sum, member) => sum + Number(member.dailyChange) * (Math.max(0, Number(member.amount) || 0) / amountTotal), 0)
        : valid.reduce((sum, member) => sum + Number(member.dailyChange), 0) / valid.length;
      return { count: Array.isArray(members) ? members.length : 0, dailyChange };
    }

    const storedConfig = readJson(configPath, null);
    const allStrategies = Array.isArray(storedConfig?.strategies) ? storedConfig.strategies
      .filter((item) => item && item.id && item.name && Number(item.targetWeight) > 0)
      .map((item) => ({
        ...item,
        amount: Math.max(0, Number(item.amount) || 0),
        targetWeight: Number(item.targetWeight),
        members: Array.isArray(item.members) ? item.members : [],
      })) : [];

    if (!allStrategies.length) {
      const widget = emptyWidget("请先运行“策略再平衡-配置”，导入网页配置并填写各策略当前金额。");
      Script.setWidget(widget);
      Script.complete();
      return;
    }

    const parameter = String(args.widgetParameter || "").trim();
    const strategy = parameter && parameter.toLowerCase() !== "all"
      ? allStrategies.find((item) => item.id === parameter || item.name === parameter)
      : allStrategies[0];
    if (!strategy) {
      const widget = emptyWidget(`未找到“${parameter}”。请在 Parameter 中填写准确的策略名称。`);
      Script.setWidget(widget);
      Script.complete();
      return;
    }

    const totalAmount = allStrategies.reduce((sum, item) => sum + item.amount, 0);
    const targetTotal = allStrategies.reduce((sum, item) => sum + item.targetWeight, 0);
    if (totalAmount <= 0 || targetTotal <= 0) {
      const widget = emptyWidget("请在“策略再平衡-配置”中为每个策略填写当前持有金额。");
      Script.setWidget(widget);
      Script.complete();
      return;
    }

    const targetWeight = strategy.targetWeight / targetTotal * 100;
    const actualWeight = strategy.amount / totalAmount * 100;
    const deviation = actualWeight - targetWeight;
    const finalTotal = Math.max(totalAmount, ...allStrategies.map((item) => item.amount / (item.targetWeight / targetTotal)));
    const newCapital = Math.max(0, finalTotal * targetWeight / 100 - strategy.amount);
    const adjustment = totalAmount * targetWeight / 100 - strategy.amount;
    const cache = readJson(cachePath, {});
    const liveMembers = await Promise.all(strategy.members.map((member) => getMemberDailyChange(member, cache)));
    fileManager.writeString(cachePath, JSON.stringify(cache));
    const stats = memberStats(liveMembers);

    const widget = new ListWidget();
    widget.backgroundColor = new Color("#fbf8f1");
    widget.setPadding(13, 14, 12, 14);
    widget.addSpacer();

    const heading = widget.addStack();
    heading.layoutHorizontally();
    addText(heading, strategy.name, Font.boldSystemFont(17), new Color("#22312d"));
    heading.addSpacer();
    addText(heading, `${stats.count} 只基金`, Font.systemFont(10), new Color("#77817c"));
    widget.addSpacer(4);

    const metricLabels = widget.addStack();
    metricLabels.layoutHorizontally();
    const totalLabelBox = metricLabels.addStack();
    totalLabelBox.size = new Size(PLAN_COLUMN_WIDTH, 0);
    addCenteredText(totalLabelBox, "基金总额", Font.systemFont(9), new Color("#87908b"));
    metricLabels.addSpacer();
    const performanceLabelBox = metricLabels.addStack();
    performanceLabelBox.size = new Size(PLAN_COLUMN_WIDTH, 0);
    addLeftAlignedText(performanceLabelBox, "加权涨跌", Font.systemFont(9), new Color("#87908b"));

    widget.addSpacer(2);
    const metricValues = widget.addStack();
    metricValues.layoutHorizontally();
    metricValues.centerAlignContent();
    const totalValueBox = metricValues.addStack();
    totalValueBox.size = new Size(PLAN_COLUMN_WIDTH, 0);
    addCenteredText(totalValueBox, headlineMoney(strategy.amount), Font.boldSystemFont(16), new Color("#283632"));
    metricValues.addSpacer();
    const performanceBox = metricValues.addStack();
    performanceBox.size = new Size(PLAN_COLUMN_WIDTH, 0);
    const performanceText = stats.dailyChange === null ? "待同步" : `${stats.dailyChange >= 0 ? "+" : ""}${stats.dailyChange.toFixed(2)}%`;
    addCenteredText(performanceBox, performanceText, Font.boldSystemFont(16), stats.dailyChange === null ? new Color("#87908b") : new Color(stats.dailyChange >= 0 ? "#578a7c" : "#c45e50"));

    const position = widget.addStack();
    position.layoutHorizontally();
    position.centerAlignContent();
    const positionText = Math.abs(deviation) <= 0.05 ? "仓位平衡" : `${deviation < 0 ? "低配" : "超配"} ${Math.abs(deviation).toFixed(1)}pp`;
    const positionColor = new Color(Math.abs(deviation) <= 0.05 ? "#578a7c" : deviation < 0 ? "#c58a2e" : "#c45e50");
    const positionBox = position.addStack();
    positionBox.size = new Size(PLAN_COLUMN_WIDTH, 0);
    addLeftAlignedText(positionBox, positionText, Font.boldSystemFont(11), positionColor);
    position.addSpacer();
    const allocationBox = position.addStack();
    allocationBox.size = new Size(PLAN_COLUMN_WIDTH, 0);
    addCenteredText(allocationBox, `${actualWeight.toFixed(1)}% → ${targetWeight.toFixed(1)}%`, Font.systemFont(9), new Color("#77817c"));
    widget.addSpacer(11);

    const planLabels = widget.addStack();
    planLabels.layoutHorizontally();
    const newCapitalLabelBox = planLabels.addStack();
    newCapitalLabelBox.size = new Size(PLAN_COLUMN_WIDTH, 0);
    addLeftAlignedText(newCapitalLabelBox, "增资补足", Font.systemFont(9), new Color("#87908b"));
    planLabels.addSpacer();
    const transferLabelBox = planLabels.addStack();
    transferLabelBox.size = new Size(PLAN_COLUMN_WIDTH, 0);
    addLeftAlignedText(transferLabelBox, "内部调仓", Font.systemFont(9), new Color("#87908b"));

    widget.addSpacer(2);
    const planValues = widget.addStack();
    planValues.layoutHorizontally();
    planValues.centerAlignContent();
    const newCapitalValueBox = planValues.addStack();
    newCapitalValueBox.size = new Size(PLAN_COLUMN_WIDTH, 0);
    addCenteredText(newCapitalValueBox, newCapital > 0.005 ? compactMoney(newCapital) : "无需新增", Font.boldSystemFont(13), new Color("#c58a2e"));
    planValues.addSpacer();
    const transferValueBox = planValues.addStack();
    transferValueBox.size = new Size(PLAN_COLUMN_WIDTH, 0);
    const transferText = Math.abs(adjustment) <= 0.005 ? "无需调仓" : `${adjustment > 0 ? "买入" : "卖出"} ${compactMoney(adjustment)}`;
    addCenteredText(transferValueBox, transferText, Font.boldSystemFont(13), new Color(adjustment > 0.005 ? "#c58a2e" : adjustment < -0.005 ? "#c45e50" : "#578a7c"));

    widget.addSpacer(9);
    addText(widget, activeRefreshHours === 1 ? "收盘更新时段 · 每小时尝试" : `自动更新 · ${OFF_HOURS_REFRESH_HOURS} 小时缓存`, Font.systemFont(7), new Color("#9aa19d"));
    widget.addSpacer();
    widget.refreshAfterDate = new Date(Date.now() + activeRefreshHours * 60 * 60 * 1000);
    Script.setWidget(widget);
    Script.complete();
  } catch (error) {
    const widget = new ListWidget();
    widget.backgroundColor = new Color("#fbf8f1");
    widget.setPadding(13, 13, 13, 13);
    const title = widget.addText("策略组合 · 配置异常");
    title.font = Font.boldSystemFont(14);
    title.textColor = new Color("#c45e50");
    widget.addSpacer(7);
    const message = widget.addText(error instanceof Error ? error.message : "无法读取策略配置");
    message.font = Font.systemFont(10);
    message.textColor = new Color("#68736e");
    message.lineLimit = 4;
    Script.setWidget(widget);
    Script.complete();
  }
})();
