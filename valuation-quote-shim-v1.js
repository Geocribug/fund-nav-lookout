(() => {
  const originalFetch = window.fetch.bind(window);

  function quoteSymbol(secid) {
    const [exchange, code] = String(secid || "").split(".");
    if (exchange === "1") return `sh${code}`;
    if (exchange === "0") return `sz${code}`;
    if (exchange === "116") return `hk${code.padStart(5, "0")}`;
    return "";
  }

  window.fetch = async (input, init) => {
    const requestUrl = typeof input === "string" ? input : input instanceof Request ? input.url : String(input);
    if (!requestUrl.includes("push2.eastmoney.com/api/qt/stock/get")) {
      return originalFetch(input, init);
    }

    try {
      const secid = new URL(requestUrl).searchParams.get("secid");
      const symbol = quoteSymbol(secid);
      if (!symbol) throw new Error("unsupported security");
      const quoteResponse = await originalFetch(`https://qt.gtimg.cn/q=${encodeURIComponent(symbol)}`, { cache: "no-store" });
      const quote = await quoteResponse.text();
      const match = quote.match(/="([^"]*)"/);
      const pe = Number(match?.[1]?.split("~")[39]);
      return new Response(JSON.stringify({ data: { f162: Number.isFinite(pe) && pe > 0 ? Math.round(pe * 100) : null } }), {
        headers: { "content-type": "application/json" },
      });
    } catch {
      return originalFetch(input, init);
    }
  };
})();
