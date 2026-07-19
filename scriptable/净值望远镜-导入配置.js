// 在 Scriptable App 内运行一次：从“净值望远镜”导出的 JSON 中提取基金代码。
// 本脚本不会保存持有金额、目标比例或买入理由。

(async () => {
  const fileManager = FileManager.local();
  const configPath = fileManager.joinPath(fileManager.documentsDirectory(), "fund-nav-lookout-widget-config.json");

  function cleanFunds(items) {
    const seen = new Set();
    return (Array.isArray(items) ? items : []).flatMap((item) => {
      const code = String(item?.code || "").trim();
      if (!/^\d{6}$/.test(code) || seen.has(code)) return [];
      seen.add(code);
      const customName = String(item?.nickname || "").trim();
      const name = customName || String(item?.name || code).trim();
      return [{ code, name: name.slice(0, 40) }];
    });
  }

  try {
    const selected = await DocumentPicker.openFile();
    if (!selected) throw new Error("没有选择配置文件");
    const payload = JSON.parse(fileManager.readString(selected));
    const holdings = cleanFunds(payload.holdings);
    const holdingCodes = new Set(holdings.map((fund) => fund.code));
    const watchlist = cleanFunds(payload.watchlist).filter((fund) => !holdingCodes.has(fund.code));
    if (!holdings.length && !watchlist.length) throw new Error("没有识别到基金代码，请选择由“净值望远镜”导出的 JSON 文件");

    fileManager.writeString(configPath, JSON.stringify({
      version: 1,
      importedAt: new Date().toISOString(),
      holdings,
      watchlist,
    }, null, 2));

    const alert = new Alert();
    alert.title = "导入完成";
    alert.message = `已保存 ${holdings.length} 只持仓基金、${watchlist.length} 只观察基金。\n\n持有金额等隐私信息不会写入 Scriptable。`;
    alert.addAction("知道了");
    await alert.presentAlert();
  } catch (error) {
    const alert = new Alert();
    alert.title = "导入未完成";
    alert.message = error instanceof Error ? error.message : "无法读取配置文件";
    alert.addAction("知道了");
    await alert.presentAlert();
  }
})();