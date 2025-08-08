import React, { useEffect, useMemo, useState } from "react";

/* =======================
   Helper types
======================= */
type OITrend = "rising" | "flat" | "falling";

type Position = {
  id: string;
  side: "LONG"; // BTC only, spot
  entryPrice: number;
  qtyBtc: number; // BTC amount
  amountUsd: number; // original USD size at entry (remaining updates when partial exits)
  openedAt: number; // timestamp
  notes?: string;
  // tracking for Time-to-Bounce rule
  maxPnlPctEver?: number; // % since open (positive only)
};

type ClosedTrade = Position & {
  closedAt: number;
  exitPrice: number;
  qtyClosed: number;
  realizedPnlUsd: number;
};

/* =======================
   Component
======================= */
export default function TacticalPanel() {
  /* ===== CSV helpers ===== */
  const toCsv = (rows: Record<string, any>[]) => {
    if (!rows.length) return "";
    const headers = Object.keys(rows[0]);
    const esc = (v: any) => {
      const s = v === undefined || v === null ? "" : String(v);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const lines = [headers.join(",")].concat(
      rows.map((r) => headers.map((h) => esc(r[h])).join(","))
    );
    return lines.join("\n");
  };

  const downloadCsv = (name: string, csv: string) => {
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  /* ===== Live data (filled on Refresh) ===== */
  const [data, setData] = useState({
    rsi1h: 0,
    rsi4h: 0,
    rsi1d: 0,
    macd1h: 0,
    macd4h: 0,
    macd1d: 0,
    macd4hFlattening: false,
    funding: 0,
    oiTrend: "flat" as OITrend,
    spotVol: 0,
    futVol: 0,
    nearSupport: false,
    requireSupport: true,
    btcPrice: 0,
  });

  const [refreshKey, setRefreshKey] = useState(0);

  /* ===== Trade state (persisted) ===== */
  const [positions, setPositions] = useState<Position[]>([]);
  const [closed, setClosed] = useState<ClosedTrade[]>([]);
  const [amountUsd, setAmountUsd] = useState<number>(0);
  const [notes, setNotes] = useState<string>("");

  /* ===== Data source settings (persisted) ===== */
  const [apiCfg, setApiCfg] = useState({
    rsiEndpoint: "",
    macdEndpoint: "",
    perpEndpoint: "",
    volumeEndpoint: "",
    priceEndpoint: "",
    apiKey: "",
  });

  /* ===== Load from localStorage on mount ===== */
  useEffect(() => {
    try {
      const p = localStorage.getItem("btc_positions");
      const c = localStorage.getItem("btc_closed");
      const a = localStorage.getItem("btc_amountUsd");
      const n = localStorage.getItem("btc_notesDraft");
      const cfg = localStorage.getItem("btc_apiCfg");
      if (p) setPositions(JSON.parse(p));
      if (c) setClosed(JSON.parse(c));
      if (a) setAmountUsd(JSON.parse(a));
      if (n) setNotes(JSON.parse(n));
      if (cfg) setApiCfg(JSON.parse(cfg));
    } catch {}
  }, []);

  /* ===== Persist to localStorage ===== */
  useEffect(() => {
    localStorage.setItem("btc_positions", JSON.stringify(positions));
  }, [positions]);
  useEffect(() => {
    localStorage.setItem("btc_closed", JSON.stringify(closed));
  }, [closed]);
  useEffect(() => {
    localStorage.setItem("btc_amountUsd", JSON.stringify(amountUsd));
  }, [amountUsd]);
  useEffect(() => {
    localStorage.setItem("btc_notesDraft", JSON.stringify(notes));
  }, [notes]);
  useEffect(() => {
    localStorage.setItem("btc_apiCfg", JSON.stringify(apiCfg));
  }, [apiCfg]);

  /* ===== Fetch Live Data (real wiring or demo fallback) ===== */
  const fetchLiveData = async () => {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (apiCfg.apiKey) headers["Authorization"] = `Bearer ${apiCfg.apiKey}`;

    const safeFetch = async (url?: string) => {
      if (!url) return undefined;
      try {
        const res = await fetch(url, { headers });
        if (!res.ok) throw new Error(`${res.status}`);
        return await res.json();
      } catch {
        return undefined;
      }
    };

    const [rsiJson, macdJson, perpJson, volJson, priceJson] = await Promise.all([
      safeFetch(apiCfg.rsiEndpoint),
      safeFetch(apiCfg.macdEndpoint),
      safeFetch(apiCfg.perpEndpoint),
      safeFetch(apiCfg.volumeEndpoint),
      safeFetch(apiCfg.priceEndpoint),
    ]);

    if (rsiJson || macdJson || perpJson || volJson || priceJson) {
      const live = {
        rsi1h: rsiJson?.rsi?.h1 ?? data.rsi1h,
        rsi4h: rsiJson?.rsi?.h4 ?? data.rsi4h,
        rsi1d: rsiJson?.rsi?.d1 ?? data.rsi1d,
        macd1h: macdJson?.macd?.h1?.hist ?? data.macd1h,
        macd4h: macdJson?.macd?.h4?.hist ?? data.macd4h,
        macd1d: macdJson?.macd?.d1?.hist ?? data.macd1d,
        macd4hFlattening:
          (macdJson?.macd?.h4?.flattening ?? false) ||
          (macdJson?.macd?.h4?.hist ?? 0) >= 0,
        funding: perpJson?.funding ?? data.funding,
        oiTrend: (perpJson?.oiTrend ?? data.oiTrend) as OITrend,
        spotVol: volJson?.spot24h ?? data.spotVol,
        futVol: volJson?.futures24h ?? data.futVol,
        nearSupport: perpJson?.nearSupport ?? data.nearSupport,
        requireSupport: data.requireSupport,
        btcPrice: priceJson?.price ?? data.btcPrice,
      };
      setData(live);
      setRefreshKey((k) => k + 1);
    } else {
      const live = {
        rsi1h: 46,
        rsi4h: 49,
        rsi1d: 50,
        macd1h: 85,
        macd4h: -21,
        macd1d: 44,
        macd4hFlattening: false,
        funding: 0.01,
        oiTrend: "falling" as OITrend,
        spotVol: 27,
        futVol: 58,
        nearSupport: false,
        requireSupport: true,
        btcPrice: 114000,
      };
      setData(live);
      setRefreshKey((k) => k + 1);
    }
  };

  /* ===== Decision logic (mirrors tactical checklist) ===== */
  const outcome = useMemo(() => {
    const rsiBand =
      (data.rsi1h >= 35 && data.rsi1h <= 45) ||
      (data.rsi4h >= 35 && data.rsi4h <= 45);

    const macdOK = data.macd4hFlattening || data.macd4h >= 0;
    const fundingOK = data.funding <= 0;
    const oiOK = data.oiTrend !== "rising";
    const spotOK = data.spotVol >= data.futVol * 0.9;
    const supportOK = data.requireSupport ? data.nearSupport : true;

    const missing: string[] = [];
    if (!rsiBand) missing.push("RSI (1H or 4H) in 35–45");
    if (!macdOK) missing.push("4H MACD flattening / cross-up");
    if (!fundingOK) missing.push("Funding ≤ 0% (flat/neg)");
    if (!oiOK) missing.push("OI not rising aggressively");
    if (!spotOK) missing.push("Spot volume steady/rising vs futures");
    if (!supportOK) missing.push("Price near a known support");

    const buy = rsiBand && macdOK && fundingOK && oiOK && spotOK && supportOK;
    const trail = !buy && macdOK && (data.rsi1h > 45 || data.rsi4h > 45) && oiOK;
    const takeProfit =
      (data.rsi1h >= 65 || data.rsi4h >= 65 || data.rsi1d >= 65) &&
      data.macd4h < 0;

    let verdict: "BUY" | "TRAIL" | "HOLD" | "TP" = "HOLD";
    if (buy) verdict = "BUY";
    else if (takeProfit) verdict = "TP";
    else if (trail) verdict = "TRAIL";

    return { verdict, missing, rsiBand, macdOK, fundingOK, oiOK, spotOK, supportOK };
  }, [refreshKey, data]);

  /* ===== Position analytics ===== */
  const positionAnalytics = useMemo(() => {
    const nowPrice = data.btcPrice || 0;
    return positions.map((p) => {
      const pnlPct = nowPrice > 0 ? (nowPrice - p.entryPrice) / p.entryPrice : 0;
      const pnlUsd = pnlPct * p.amountUsd;

      const currentGainPct = Math.max(0, pnlPct * 100);
      const maxPnlPctEver = Math.max(p.maxPnlPctEver || 0, currentGainPct);

      let tier: "<5%" | "+5%" | "+7%" | "+10%+" = "<5%";
      if (pnlPct >= 0.1) tier = "+10%+";
      else if (pnlPct >= 0.07) tier = "+7%";
      else if (pnlPct >= 0.05) tier = "+5%";

      let rec = "HOLD";
      if (tier === "+5%") rec = "Exit 50%";
      else if (tier === "+7%") rec = "Exit 30% (after 50%)";
      else if (tier === "+10%+") rec = "Exit 20% or TRAIL";

      const daysHeld = Math.max(0, Math.floor((Date.now() - p.openedAt) / (1000 * 60 * 60 * 24)));
      const ttbFlag = daysHeld >= 5 && maxPnlPctEver < 3;

      return {
        ...p,
        pnlPct: +(pnlPct * 100).toFixed(2),
        pnlUsd: +pnlUsd.toFixed(2),
        tier,
        rec,
        daysHeld,
        maxPnlPctEver: +maxPnlPctEver.toFixed(2),
        ttbFlag,
      };
    });
  }, [positions, data.btcPrice]);

  useEffect(() => {
    setPositions((prev) =>
      prev.map((p) => {
        const updated = positionAnalytics.find((q) => q.id === p.id);
        return updated ? { ...p, maxPnlPctEver: updated.maxPnlPctEver } : p;
      })
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey, data.btcPrice]);

  const realizedTotal = closed.reduce((s, c) => s + c.realizedPnlUsd, 0);

  /* ===== CSV export builders ===== */
  const exportOpenCsv = () => {
    const rows = positionAnalytics.map((p) => ({
      id: p.id,
      openedAt: new Date(p.openedAt).toISOString(),
      side: p.side,
      entryPrice: p.entryPrice,
      qtyBtc: p.qtyBtc,
      amountUsd: p.amountUsd,
      currentPrice: data.btcPrice,
      pnlUsd: p.pnlUsd,
      pnlPct: p.pnlPct,
      tier: p.tier,
      recommendation: p.rec,
      daysHeld: p.daysHeld,
      maxPnlPctEver: p.maxPnlPctEver,
      ttbFlag: p.ttbFlag,
      notes: p.notes || "",
    }));
    downloadCsv(`open_positions_${Date.now()}.csv`, toCsv(rows));
  };

  const exportClosedCsv = () => {
    const rows = closed.map((c) => ({
      id: c.id,
      openedAt: new Date(c.openedAt).toISOString(),
      closedAt: new Date(c.closedAt).toISOString(),
      side: c.side,
      entryPrice: c.entryPrice,
      exitPrice: c.exitPrice,
      qtyClosed: c.qtyClosed,
      realizedPnlUsd: c.realizedPnlUsd,
      notes: c.notes || "",
    }));
    downloadCsv(`closed_trades_${Date.now()}.csv`, toCsv(rows));
  };

  /* ===== Trade actions ===== */
  const handleBuy = () => {
    if (!data.btcPrice || amountUsd <= 0) return;
    const qty = amountUsd / data.btcPrice;
    const pos: Position = {
      id: `pos_${Date.now()}`,
      side: "LONG",
      entryPrice: data.btcPrice,
      qtyBtc: qty,
      amountUsd,
      openedAt: Date.now(),
      notes: notes?.trim() || undefined,
      maxPnlPctEver: 0,
    };
    setPositions((arr) => [pos, ...arr]);
    setNotes("");
  };

  const closePortion = (id: string, portion: number) => {
    const nowPx = data.btcPrice || 0;
    setPositions((arr) => {
      const idx = arr.findIndex((p) => p.id === id);
      if (idx === -1 || nowPx <= 0) return arr;
      const p = arr[idx];
      const qtyToClose = p.qtyBtc * portion;
      const amountClosedUsd = qtyToClose * p.entryPrice;
      const exitValueUsd = qtyToClose * nowPx;
      const pnlUsd = exitValueUsd - amountClosedUsd;

      const trade: ClosedTrade = {
        ...p,
        closedAt: Date.now(),
        exitPrice: nowPx,
        qtyClosed: qtyToClose,
        realizedPnlUsd: pnlUsd,
      };
      setClosed((c) => [trade, ...c]);

      const remainingQty = p.qtyBtc - qtyToClose;
      if (remainingQty <= 1e-10) {
        const copy = [...arr];
        copy.splice(idx, 1);
        return copy;
      } else {
        const remainingUsd = remainingQty * p.entryPrice;
        const copy = [...arr];
        copy[idx] = { ...p, qtyBtc: remainingQty, amountUsd: remainingUsd };
        return copy;
      }
    });
  };

  const closeAll = (id: string) => closePortion(id, 1);

  /* ===== UI helpers ===== */
  const badge = (ok: boolean) => (
    <span
      className={`px-2 py-1 rounded-full text-xs font-semibold ${
        ok
          ? "bg-emerald-500/15 text-emerald-300 border border-emerald-600/40"
          : "bg-rose-500/10 text-rose-300 border border-rose-600/40"
      }`}
    >
      {ok ? "OK" : "Needs work"}
    </span>
  );

  const fmt = (n: number, d = 0) =>
    n.toLocaleString(undefined, { maximumFractionDigits: d });

  const verdictColor: Record<string, string> = {
    BUY: "bg-emerald-500/15 text-emerald-300 border-emerald-600/40",
    TRAIL: "bg-amber-500/15 text-amber-300 border-amber-600/40",
    HOLD: "bg-sky-500/15 text-sky-300 border-sky-600/40",
    TP: "bg-fuchsia-500/15 text-fuchsia-300 border-fuchsia-600/40",
  };

  /* ===== Render ===== */
  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-indigo-200">
              BTC Tactical Decision Panel
            </h1>
            <p className="text-slate-400 text-sm">
              Manual refresh • No auto-stream • Mirrors your entry checklist
            </p>
          </div>
          <button
            onClick={fetchLiveData}
            className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 border border-indigo-400/40"
          >
            Refresh Data & Decision
          </button>
        </header>

        {/* Data source settings */}
        <details className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4">
          <summary className="cursor-pointer text-slate-300">
            Data source settings (optional)
          </summary>
          <div className="grid md:grid-cols-2 gap-3 mt-3 text-sm">
            <input
              placeholder="RSI endpoint (returns { rsi: { h1, h4, d1 } })"
              value={apiCfg.rsiEndpoint}
              onChange={(e) =>
                setApiCfg({ ...apiCfg, rsiEndpoint: e.target.value })
              }
              className="bg-slate-800 rounded-lg p-2 border border-slate-700"
            />
            <input
              placeholder="MACD endpoint (returns { macd: { h1:{hist}, h4:{hist,flattening}, d1:{hist} } })"
              value={apiCfg.macdEndpoint}
              onChange={(e) =>
                setApiCfg({ ...apiCfg, macdEndpoint: e.target.value })
              }
              className="bg-slate-800 rounded-lg p-2 border border-slate-700"
            />
            <input
              placeholder="PERP endpoint (returns { funding, oiTrend, nearSupport })"
              value={apiCfg.perpEndpoint}
              onChange={(e) =>
                setApiCfg({ ...apiCfg, perpEndpoint: e.target.value })
              }
              className="bg-slate-800 rounded-lg p-2 border border-slate-700"
            />
            <input
              placeholder="Volume endpoint (returns { spot24h, futures24h })"
              value={apiCfg.volumeEndpoint}
              onChange={(e) =>
                setApiCfg({ ...apiCfg, volumeEndpoint: e.target.value })
              }
              className="bg-slate-800 rounded-lg p-2 border border-slate-700"
            />
            <input
              placeholder="Price endpoint (returns { price })"
              value={apiCfg.priceEndpoint}
              onChange={(e) =>
                setApiCfg({ ...apiCfg, priceEndpoint: e.target.value })
              }
              className="bg-slate-800 rounded-lg p-2 border border-slate-700"
            />
            <input
              placeholder="API key (Bearer)"
              value={apiCfg.apiKey}
              onChange={(e) =>
                setApiCfg({ ...apiCfg, apiKey: e.target.value })
              }
              className="bg-slate-800 rounded-lg p-2 border border-slate-700"
            />
          </div>
          <p className="text-xs text-slate-500 mt-2">
            Tip: expose your own lightweight endpoints that normalize raw
            providers to the shapes shown above.
          </p>
        </details>

        {/* Top metrics */}
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          <section className="rounded-2xl border border-slate-800 bg-slate-900/50 p-4 space-y-3">
            <h2 className="font-semibold text-indigo-300">RSI</h2>
            <div className="flex justify-between">
              <span>1H: {data.rsi1h}</span>
              <span>4H: {data.rsi4h}</span>
              <span>1D: {data.rsi1d}</span>
            </div>
            {badge(outcome.rsiBand)}
          </section>

          <section className="rounded-2xl border border-slate-800 bg-slate-900/50 p-4 space-y-3">
            <h2 className="font-semibold text-indigo-300">MACD</h2>
            <div className="flex justify-between">
              <span>1H: {data.macd1h}</span>
              <span>4H: {data.macd4h}</span>
              <span>1D: {data.macd1d}</span>
            </div>
            {badge(outcome.macdOK)}
          </section>

          <section className="rounded-2xl border border-slate-800 bg-slate-900/50 p-4 space-y-3">
            <h2 className="font-semibold text-indigo-300">Funding/OI</h2>
            <div>
              Funding: {data.funding}% {badge(outcome.fundingOK)}
            </div>
            <div>
              OI trend: {data.oiTrend} {badge(outcome.oiOK)}
            </div>
          </section>

          <section className="rounded-2xl border border-slate-800 bg-slate-900/50 p-4 space-y-3">
            <h2 className="font-semibold text-indigo-300">Spot vs Futures</h2>
            <div>
              Spot: {data.spotVol}B / Futures: {data.futVol}B{" "}
              {badge(outcome.spotOK)}
            </div>
          </section>

          <section className="rounded-2xl border border-slate-800 bg-slate-900/50 p-4 space-y-3">
            <h2 className="font-semibold text-indigo-300">Support</h2>
            <div>
              Require: {data.requireSupport ? "Yes" : "No"} / Near:{" "}
              {data.nearSupport ? "Yes" : "No"} {badge(outcome.supportOK)}
            </div>
          </section>

          <section className="rounded-2xl border border-slate-800 bg-slate-900/50 p-4 space-y-3">
            <h2 className="font-semibold text-indigo-300">Price</h2>
            <div className="text-2xl font-bold">${fmt(data.btcPrice)}</div>
            <p className="text-slate-400 text-sm">
              Live spot price (from your data source)
            </p>
          </section>
        </div>

        {/* Decision + Trade ticket */}
        <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5 space-y-4">
          <div
            className={`inline-flex items-center gap-3 px-4 py-2 rounded-xl border ${verdictColor[outcome.verdict]}`}
          >
            <span className="text-sm">Overall Recommendation</span>
            <span className="text-xl font-extrabold tracking-wide">
              {outcome.verdict}
            </span>
          </div>

          {outcome.missing.length > 0 && (
            <div>
              <h3 className="text-slate-300 font-semibold">
                What’s missing for a BUY
              </h3>
              <ul className="mt-2 grid md:grid-cols-2 gap-1 text-slate-400 text-sm">
                {outcome.missing.map((m, i) => (
                  <li key={i}>• {m}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Trade ticket */}
          <div className="grid md:grid-cols-3 gap-3 items-end">
            <div>
              <label className="block text-slate-400 text-sm mb-1">
                Tranche Amount (USD)
              </label>
              <input
                type="number"
                value={amountUsd}
                onChange={(e) => setAmountUsd(+e.target.value)}
                placeholder="Enter any amount"
                className="w-full bg-slate-800 rounded-lg p-2 border border-slate-700"
              />
              <div className="flex gap-2 mt-2 text-xs">
                {[1000, 3000, 5000, 10000].map((v) => (
                  <button
                    key={v}
                    onClick={() => setAmountUsd(v)}
                    className="px-2 py-1 rounded bg-slate-800 border border-slate-700 hover:bg-slate-700"
                  >
                    ${v.toLocaleString()}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-slate-400 text-sm mb-1">
                Notes (why this entry)
              </label>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="e.g., 4H RSI 40, funding flat, near $112k support"
                className="w-full bg-slate-800 rounded-lg p-2 border border-slate-700"
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleBuy}
                disabled={!data.btcPrice || amountUsd <= 0}
                className="px-4 py-2 h-[42px] rounded-xl bg-emerald-600 hover:bg-emerald-500 border border-emerald-400/40 disabled:opacity-50"
              >
                Buy BTC (Spot)
              </button>
            </div>
          </div>
        </section>

        {/* Open Positions Log */}
        <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-indigo-300">Open Positions</h2>
            <div className="flex items-center gap-3">
              <button
                onClick={exportOpenCsv}
                className="px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 hover:bg-slate-700 text-xs"
              >
                Export CSV
              </button>
              <div className="text-slate-400 text-sm">
                Realized P&L:{" "}
                <span
                  className={
                    realizedTotal >= 0 ? "text-emerald-300" : "text-rose-300"
                  }
                >
                  ${fmt(realizedTotal, 2)}
                </span>
              </div>
            </div>
          </div>

          {positionAnalytics.length === 0 ? (
            <p className="text-slate-400 text-sm">
              No open positions. Use the ticket above to buy.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-slate-400">
                  <tr className="border-b border-slate-800">
                    <th className="py-2 text-left">Date</th>
                    <th className="py-2 text-left">Entry</th>
                    <th className="py-2 text-left">Qty (BTC)</th>
                    <th className="py-2 text-left">Now</th>
                    <th className="py-2 text-left">PnL $</th>
                    <th className="py-2 text-left">PnL %</th>
                    <th className="py-2 text-left">Tier</th>
                    <th className="py-2 text-left">Recommendation</th>
                    <th className="py-2 text-left">TTB</th>
                    <th className="py-2 text-left">Notes</th>
                    <th className="py-2 text-left">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {positionAnalytics.map((p) => (
                    <tr
                      key={p.id}
                      className={`border-b border-slate-800 ${
                        p.ttbFlag ? "bg-rose-900/10" : ""
                      }`}
                    >
                      <td className="py-2">
                        {new Date(p.openedAt).toLocaleString()}
                      </td>
                      <td className="py-2">${fmt(p.entryPrice)}</td>
                      <td className="py-2">{p.qtyBtc.toFixed(6)}</td>
                      <td className="py-2">${fmt(data.btcPrice, 0)}</td>
                      <td
                        className={`py-2 ${
                          p.pnlUsd >= 0 ? "text-emerald-300" : "text-rose-300"
                        }`}
                      >
                        ${fmt(p.pnlUsd, 2)}
                      </td>
                      <td
                        className={`py-2 ${
                          p.pnlPct >= 0 ? "text-emerald-300" : "text-rose-300"
                        }`}
                      >
                        {p.pnlPct}%
                      </td>
                      <td className="py-2">{p.tier}</td>
                      <td className="py-2">{p.rec}</td>
                      <td
                        className={`py-2 ${
                          p.ttbFlag
                            ? "text-rose-300 font-semibold"
                            : "text-slate-400"
                        }`}
                      >
                        {p.ttbFlag ? ">5d & <+3%" : "OK"}
                      </td>
                      <td className="py-2 max-w-[260px] truncate" title={p.notes || ""}>
                        {p.notes || "—"}
                      </td>
                      <td className="py-2">
                        <div className="flex flex-wrap gap-2">
                          <button
                            onClick={() => closePortion(p.id, 0.5)}
                            className="px-2 py-1 rounded bg-amber-600/70 hover:bg-amber-600 text-xs"
                          >
                            Exit 50%
                          </button>
                          <button
                            onClick={() => closePortion(p.id, 0.3)}
                            className="px-2 py-1 rounded bg-amber-600/40 hover:bg-amber-600 text-xs"
                          >
                            Exit 30%
                          </button>
                          <button
                            onClick={() => closePortion(p.id, 0.2)}
                            className="px-2 py-1 rounded bg-sky-700/60 hover:bg-sky-700 text-xs"
                          >
                            Exit 20%
                          </button>
                          <button
                            onClick={() => closeAll(p.id)}
                            className="px-2 py-1 rounded bg-rose-700 hover:bg-rose-600 text-xs"
                          >
                            Close All
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-xs text-slate-500">
            Exit tiers: +5% → exit 50% • +7% → exit 30% • +10% → exit 20% or
            trail. Time-to-bounce auto-flag turns red if position age ≥ 5 days
            and max favorable excursion since entry &lt; +3%.
          </p>
        </section>

        {/* Closed trades log */}
        <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5 space-y-3">
          <h2 className="font-semibold text-indigo-300">Closed Trades</h2>
          <div className="mt-2">
            <button
              onClick={exportClosedCsv}
              className="px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 hover:bg-slate-700 text-xs"
            >
              Export CSV
            </button>
          </div>
          {closed.length === 0 ? (
            <p className="text-slate-400 text-sm">No closed trades yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-slate-400">
                  <tr className="border-b border-slate-800">
                    <th className="py-2 text-left">Closed</th>
                    <th className="py-2 text-left">Entry</th>
                    <th className="py-2 text-left">Exit</th>
                    <th className="py-2 text-left">Qty</th>
                    <th className="py-2 text-left">PnL $</th>
                    <th className="py-2 text-left">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {closed.map((c) => (
                    <tr
                      key={`${c.id}_${c.closedAt}`}
                      className="border-b border-slate-800"
                    >
                      <td className="py-2">
                        {new Date(c.closedAt).toLocaleString()}
                      </td>
                      <td className="py-2">${fmt(c.entryPrice)}</td>
                      <td className="py-2">${fmt(c.exitPrice)}</td>
                      <td className="py-2">{c.qtyClosed.toFixed(6)}</td>
                      <td
                        className={`py-2 ${
                          c.realizedPnlUsd >= 0
                            ? "text-emerald-300"
                            : "text-rose-300"
                        }`}
                      >
                        ${fmt(c.realizedPnlUsd, 2)}
                      </td>
                      <td
                        className="py-2 max-w-[320px] truncate"
                        title={c.notes || ""}
                      >
                        {c.notes || "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
