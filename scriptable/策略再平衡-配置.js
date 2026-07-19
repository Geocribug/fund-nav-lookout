// Scriptable 配置脚本：导入网页策略，或在本机建立独立策略组合。
// 自定义策略仅保存在此 iPhone，适合只在小组件中跟踪的组合。

(async () => {
  const fileManager = FileManager.local();
  const configPath = fileManager.joinPath(fileManager.documentsDirectory(), "fund-nav-lookout-strategy-widget-config.json");

  if (typeof config !== "undefined" && config.runsInWidget) {
    const widget = new ListWidget();
    widget.backgroundColor = new Color("#fbf8f1");
    widget.setPadding(16, 16, 16, 16);
    const title = widget.addText("策略再平衡配置");
    title.font = Font.boldSystemFont(15);
    title.textColor = new Color("#22312d");
    widget.addSpacer(8);
    const message = widget.addText("这是配置脚本，请在 Scriptable App 内手动运行；桌面组件请选择“策略再平衡-组件”或“策略再平衡-小组件”。");
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

  function parseAmount(value) {
    const amount = Number(String(value || "").replace(/[，,\s]/g, ""));
    if (!Number.isFinite(amount) || amount < 0) throw new Error("金额请填写为大于或等于 0 的数字");
    return Number(amount.toFixed(2));
  }

  function parseTargetWeight(value) {
    const target = Number(String(value || "").replace(/[，,\s]/g, ""));
    if (!Number.isFinite(target) || target <= 0 || target > 100) throw new Error("目标占比请填写为大于 0 且不超过 100 的数字");
    return Number(target.toFixed(2));
  }

  function parseMemberCodes(value) {
    const raw = String(value || "").trim().replaceAll("，", ",");
    if (!raw) return [];
    const codes = raw.split(",").map((item) => item.trim()).filter(Boolean);
    if (codes.some((code) => !/^\d{6}$/.test(code))) throw new Error("成员基金代码请用 6 位代码，并以逗号分隔");
    return [...new Set(codes)];
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

  function cleanMembers(members) {
    const seen = new Set();
    return (Array.isArray(members) ? members : []).flatMap((item) => {
      const code = String(item?.code || "").trim();
      if (!/^\d{6}$/.test(code) || seen.has(code)) return [];
      seen.add(code);
      return [{
        code,
        name: String(item?.name || code).trim().slice(0, 30) || code,
        amount: Math.max(0, Number(item?.amount) || 0),
        dailyChange: Number.isFinite(Number(item?.dailyChange)) ? Number(item.dailyChange) : null,
        latestDate: String(item?.latestDate || "").slice(0, 10),
      }];
    });
  }

  function cloneStrategy(item) {
    const id = String(item?.id || "").trim();
    const name = String(item?.name || "").trim().slice(0, 30);
    const targetWeight = Number(item?.targetWeight);
    if (!id || !name || !Number.isFinite(targetWeight) || targetWeight <= 0) return null;
    return {
      id,
      name,
      targetWeight: Math.min(100, targetWeight),
      amount: Math.max(0, Number(item?.amount) || 0),
      members: cleanMembers(item?.members),
      source: item?.source === "custom" ? "custom" : "web",
    };
  }

  function normalizeStrategies(items, holdings, previous) {
    const previousStrategies = (previous?.strategies || []).map(cloneStrategy).filter(Boolean);
    const previousById = new Map(previousStrategies.map((item) => [item.id, item.amount]));
    const previousByName = new Map(previousStrategies.map((item) => [item.name, item.amount]));
    const seen = new Set();
    const imported = (Array.isArray(items) ? items : []).flatMap((item) => {
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
        source: "web",
      }];
    });
    const importedNames = new Set(imported.map((item) => item.name));
    const custom = previousStrategies.filter((item) => item.source === "custom" && !seen.has(item.id) && !importedNames.has(item.name));
    return [...imported, ...custom];
  }

  function createCustomId() {
    return `custom-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  async function editMemberAmounts(codes, totalAmount, previousMembers = []) {
    if (!codes.length) return [];
    const previousByCode = new Map(cleanMembers(previousMembers).map((item) => [item.code, item]));
    const defaultAmount = totalAmount / codes.length;
    const members = [];
    for (let index = 0; index < codes.length; index += 1) {
      const code = codes[index];
      const previous = previousByCode.get(code);
      const alert = new Alert();
      alert.title = `成员基金 ${index + 1}/${codes.length}`;
      alert.message = `${code}\n填写它在该策略中的金额，用于计算加权净值涨跌；策略总金额仍以策略设置为准。`;
      alert.addTextField("成员金额", previous ? previous.amount.toFixed(2) : defaultAmount.toFixed(2));
      alert.addAction(index === codes.length - 1 ? "完成" : "下一只");
      alert.addCancelAction("使用默认金额");
      const choice = await alert.presentAlert();
      const amount = choice === -1 ? (previous?.amount ?? defaultAmount) : parseAmount(alert.textFieldValue(0));
      members.push({
        code,
        name: previous?.name || code,
        amount,
        dailyChange: previous?.dailyChange ?? null,
        latestDate: previous?.latestDate || "",
      });
    }
    return members;
  }

  async function createCustomStrategy(strategies) {
    const alert = new Alert();
    alert.title = "新建自定义策略";
    alert.message = "该策略仅保存在 Scriptable 本机，不会写回网页。成员基金代码可留空，之后再编辑。";
    alert.addTextField("策略名称", "");
    alert.addTextField("目标占比（%）", "");
    alert.addTextField("当前金额（元）", "");
    alert.addTextField("成员基金代码（逗号分隔）", "");
    alert.addAction("下一步");
    alert.addCancelAction("取消");
    if (await alert.presentAlert() === -1) return null;
    const name = String(alert.textFieldValue(0) || "").trim().slice(0, 30);
    if (!name) throw new Error("请填写策略名称");
    if (strategies.some((item) => item.name === name)) throw new Error("已有同名策略，请换一个名称");
    const targetWeight = parseTargetWeight(alert.textFieldValue(1));
    const amount = parseAmount(alert.textFieldValue(2));
    const codes = parseMemberCodes(alert.textFieldValue(3));
    const members = await editMemberAmounts(codes, amount);
    return { id: createCustomId(), name, targetWeight, amount, members, source: "custom" };
  }

  async function editStrategyDetails(strategies) {
    for (let index = 0; index < strategies.length; index += 1) {
      const strategy = strategies[index];
      const isCustom = strategy.source === "custom";
      const alert = new Alert();
      alert.title = `${strategy.name}（${index + 1}/${strategies.length}）`;
      alert.message = isCustom
        ? "自定义策略：可同时修改目标、金额和成员基金。"
        : "网页导入策略：可在本机修改目标与金额；下次从网页导入时，目标会以网页设置为准。";
      alert.addTextField("目标占比（%）", strategy.targetWeight.toFixed(2));
      alert.addTextField("当前金额（元）", strategy.amount.toFixed(2));
      if (isCustom) alert.addTextField("成员基金代码（逗号分隔）", strategy.members.map((item) => item.code).join(","));
      alert.addAction(index === strategies.length - 1 ? "保存" : "下一项");
      alert.addCancelAction("暂不修改");
      const choice = await alert.presentAlert();
      if (choice === -1) continue;
      strategy.targetWeight = parseTargetWeight(alert.textFieldValue(0));
      strategy.amount = parseAmount(alert.textFieldValue(1));
      if (isCustom) {
        const codes = parseMemberCodes(alert.textFieldValue(2));
        strategy.members = await editMemberAmounts(codes, strategy.amount, strategy.members);
      }
    }
  }

  async function deleteCustomStrategy(strategies) {
    const custom = strategies.filter((item) => item.source === "custom");
    if (!custom.length) throw new Error("当前没有可删除的自定义策略");
    const alert = new Alert();
    alert.title = "删除自定义策略";
    alert.message = "选择一项删除；此操作不会影响网页中的策略组合。";
    custom.forEach((item) => alert.addAction(`删除 ${item.name}`));
    alert.addCancelAction("取消");
    const choice = await alert.presentAlert();
    if (choice === -1) return strategies;
    const selected = custom[choice];
    return strategies.filter((item) => item.id !== selected.id);
  }

  try {
    const existing = readJson(configPath, null);
    const existingStrategies = (existing?.strategies || []).map(cloneStrategy).filter(Boolean);
    const actions = [
      { id: "import", label: "从网页配置导入" },
      { id: "create", label: "新建自定义策略" },
    ];
    if (existingStrategies.length) actions.push({ id: "edit", label: "编辑目标与金额" });
    if (existingStrategies.some((item) => item.source === "custom")) actions.push({ id: "delete", label: "删除自定义策略" });

    const chooser = new Alert();
    chooser.title = "策略再平衡配置";
    chooser.message = "网页策略可导入；也可只在本机建立自定义策略组合。";
    actions.forEach((action) => chooser.addAction(action.label));
    chooser.addCancelAction("取消");
    const choice = await chooser.presentAlert();
    if (choice === -1) return;
    const action = actions[choice]?.id;
    let strategies = existingStrategies.map((item) => ({ ...item, members: [...item.members] }));

    if (action === "import") {
      const file = await DocumentPicker.openFile();
      if (!file) return;
      const payload = parseExport(fileManager.readString(file));
      strategies = normalizeStrategies(payload.strategyGroups, payload.holdings, existing);
      if (!strategies.length) throw new Error("没有识别到策略组合。请先在网页中建立策略组合，或选择“新建自定义策略”。");
    } else if (action === "create") {
      const created = await createCustomStrategy(strategies);
      if (!created) return;
      strategies.push(created);
    } else if (action === "edit") {
      await editStrategyDetails(strategies);
    } else if (action === "delete") {
      strategies = await deleteCustomStrategy(strategies);
    } else {
      return;
    }

    fileManager.writeString(configPath, JSON.stringify({ version: 3, updatedAt: new Date().toISOString(), strategies }, null, 2));
    const webCount = strategies.filter((item) => item.source !== "custom").length;
    const customCount = strategies.filter((item) => item.source === "custom").length;
    const done = new Alert();
    done.title = "配置已保存";
    done.message = `已保存 ${strategies.length} 个策略组合（网页 ${webCount} 个 · 自定义 ${customCount} 个）。\n\n金额、目标与自定义策略仅保存在此 iPhone。`;
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
