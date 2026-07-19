// Scriptable 配置脚本：从网页导出的 JSON 读取策略、成员基金与净值摘要，
// 并在本机记录每个策略组合的当前持有金额（保留两位小数）。

(async () => {
  const fileManager = FileManager.local();
  const configPath = fileManager.joinPath(fileManager.documentsDirectory(), "fund-nav-lookout-strategy-widget-config.json");

  // 配置脚本需要文件选择与金额输入，不能作为桌面组件运行。
  if (typeof config !== "undefined" && config.runsInWidget) {
    const widget = new ListWidget();
    widget.backgroundColor = new Color("#fbf8f1");
    widget.setPadding(16, 16, 16, 16);
    const title = widget.addText("策略再平衡配置");
    title.font = Font.boldSystemFont(15);
    title.textColor = new Color("#22312d");
    widget.addSpacer(8);
    const message = widget.addText("这是配置脚本，请在 Scriptable App 内手动运行；桌面组件请选择“策略再平衡-组件”。");
    message.font = Font.systemFont(12);
    message.textColor = new Color("#68736e");
    message.lineLimit = 3;
    Script.setWidget(widget);
    Script.complete();
    return;
  }

  function readJson(path, fallback) {
    try {
      return fileManager.fileExists(path) ? JSON.parse(fileManager.readString(path)) : fallback;
    } catch (_) {
      return fallback;
    }
  }

  function parseExport(raw) {
    const text = String(raw || "").replace(/^\uFEFF/, "").trim();
    if (!text.startsWith("{")) throw new Error("请选择由网页“导出配置”生成的 JSON 文件");
    try {
      return JSON.parse(text);
    } catch (_) {
      throw new Error("配置 JSON 无法读取，请重新从网页导出后再选择");
    }
  }

  function dailyNavChange(item) {
    const history = Array.isArray(item?.history) ? item.history : [];
    const latest = Number(history[0]?.nav ?? item?.latestNav);
    const previous = Number(history[1]?.nav);
    if (!Number.isFinite(latest) || !Number.isFinite(previous) || previous <= 0) return null;
    return Number((((latest / previous) - 1) * 100).toFixed(4));
  }

  function normalizeMembers(holdings, strategyId) {
    return (Array.isArray(holdings) ? holdings : [])
      .filter((item) => String(item?.strategyId || "") === strategyId)
      .flatMap((item) => {
        const code = String(item?.code || "").trim();
        const name = String(item?.nickname || item?.name || "").trim();
        if (!code || !name) return [];
        return [{
          code,
          name: name.slice(0, 30),
          amount: Math.max(0, Number(item?.amount) || 0),
          dailyChange: dailyNavChange(item),
          latestDate: String(item?.latestDate || "").slice(0, 10),
        }];
      });
  }

  function normalizeStrategies(items, holdings, previous) {
    const previousById = new Map((previous?.strategies || []).map((item) => [item.id, item.amount]));
    const previousByName = new Map((previous?.strategies || []).map((item) => [item.name, item.amount]));
    const seen = new Set();
    return (Array.isArray(items) ? items : []).flatMap((item) => {
      const id = String(item?.id || "").trim();
      const name = String(item?.name || "").trim();
      const targetWeight = Number(item?.targetWeight);
      if (!id || !name || !Number.isFinite(targetWeight) || targetWeight <= 0 || seen.has(id)) return [];
      seen.add(id);
      const previousAmount = previousById.get(id) ?? previousByName.get(name) ?? 0;
      return [{
        id,
        name: name.slice(0, 30),
        targetWeight: Math.min(100, targetWeight),
        amount: Number(previousAmount) || 0,
        members: normalizeMembers(holdings, id),
      }];
    });
  }

  function parseAmount(value) {
    const amount = Number(String(value || "").replace(/[，,\s]/g, ""));
    if (!Number.isFinite(amount) || amount < 0) throw new Error("金额请填写为大于或等于 0 的数字");
    return Number(amount.toFixed(2));
  }

  async function editAmounts(strategies) {
    for (let index = 0; index < strategies.length; index += 1) {
      const strategy = strategies[index];
      const alert = new Alert();
      alert.title = `${strategy.name}（${index + 1}/${strategies.length}）`;
      alert.message = `目标占比 ${strategy.targetWeight.toFixed(1)}%\n请输入该策略组合当前持有金额（元），支持两位小数。`;
      alert.addTextField("当前持有金额", strategy.amount ? strategy.amount.toFixed(2) : "");
      alert.addAction(index === strategies.length - 1 ? "保存" : "下一项");
      alert.addCancelAction("暂不修改");
      const result = await alert.presentAlert();
      if (result === -1) continue;
      strategy.amount = parseAmount(alert.textFieldValue(0));
    }
  }

  try {
    const existing = readJson(configPath, null);
    const chooser = new Alert();
    chooser.title = "策略再平衡配置";
    chooser.message = existing ? "可重新从网页配置读取策略名称与目标，或仅修改本机保存的当前金额。" : "请先从网页导出的配置中读取策略组合。";
    chooser.addAction("从网页配置导入");
    if (existing?.strategies?.length) chooser.addAction("仅修改当前金额");
    chooser.addCancelAction("取消");
    const choice = await chooser.presentAlert();
    if (choice === -1) return;

    let strategies;
    if (choice === 0) {
      const file = await DocumentPicker.openFile();
      if (!file) return;
      const payload = parseExport(fileManager.readString(file));
      strategies = normalizeStrategies(payload.strategyGroups, payload.holdings, existing);
      if (!strategies.length) throw new Error("没有识别到策略组合。请先在网页中建立策略组合并设置目标占比。");
    } else {
      strategies = existing.strategies.map((item) => ({ ...item }));
    }

    await editAmounts(strategies);
    fileManager.writeString(configPath, JSON.stringify({ version: 2, updatedAt: new Date().toISOString(), strategies }, null, 2));
    const done = new Alert();
    done.title = "配置已保存";
    done.message = `已保存 ${strategies.length} 个策略组合的目标占比、当前金额与成员基金净值摘要。金额仅保存在此 iPhone。`;
    done.addAction("知道了");
    await done.presentAlert();
  } catch (error) {
    const alert = new Alert();
    alert.title = "配置未完成";
    alert.message = error instanceof Error ? error.message : "无法保存策略配置";
    alert.addAction("知道了");
    await alert.presentAlert();
  }
})();
