import { useState, useEffect, useMemo, useCallback } from "react";
import { motion } from "framer-motion";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip,
  PieChart, Pie, Cell, BarChart, Bar, CartesianGrid,
} from "recharts";
import { TrendingUp, BarChart2, Percent, ChevronsUpDown, Lightbulb, AlertTriangle, RefreshCw } from "lucide-react";

// ── Trade data ──────────────────────────────────────────────────────────────
// Matches models/trade.py Trade.to_dict() exactly, as returned by
// GET /api/trades (routes/trade_routes.py -> {"status": "success", "data": [...]}).
//
// pnl and result are computed/stored server-side (create_trade / update_trade
// call calculate_pnl() on write) and are used here as-is — never recalculated
// on the client.

type ApiTrade = {
  id: number;
  asset: string;
  direction: string;          // "buy" | "sell"
  entry: number;
  exit: number | null;        // null while the trade is still open
  stop_loss: number | null;
  take_profit: number | null;
  lot_size: number;
  pnl: number | null;         // stored — null while open, never recomputed here
  setup_type: string | null;
  result: string | null;      // "win" | "loss" | "breakeven" | null while open
  trade_date: string;         // "YYYY-MM-DD"
  notes: string | null;
  created_at: string;
};

type TradesResponse =
  | { status: "success"; data: ApiTrade[] }
  | { status: "error"; message: string };

// Adjust to wherever the Flask API is actually served from.
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "https://quantedge-ai-1bbs.onrender.com";
const TRADES_ENDPOINT = `${API_BASE_URL}/api/trades`;

const STARTING_BALANCE = 1000; // baseline the equity curve is drawn from

// Planned risk:reward from the trade's stop loss / take profit at entry time.
// Not a stored column, so it's still legitimately derived on the client.
// Returns null if the trade doesn't have both a stop loss and a take profit
// set (e.g. a newly-opened trade), or if the stop loss implies zero/negative risk.
function getPlannedRR(trade: ApiTrade): number | null {
  const { entry, stop_loss, take_profit, direction } = trade;
  if (stop_loss == null || take_profit == null) return null;

  const risk = direction === "buy" ? entry - stop_loss : stop_loss - entry;
  const reward = direction === "buy" ? take_profit - entry : entry - take_profit;
  if (risk <= 0) return null;
  return reward / risk;
}

const PIE_COLORS = ["#22c55e", "#ef4444"];

type Recommendation = {
  tag: string;
  color: string;
  bg: string;
  border: string;
  text: string;
};

// ── Shared styles ─────────────────────────────────────────────────────────────

const card = `
  bg-slate-900
  rounded-2xl border border-slate-800/40
  p-6 transition-colors duration-200
`;

function IconBadge({ icon: Icon }: { icon: React.ElementType }) {
  return (
    <div className="w-8 h-8 rounded-lg bg-slate-800 border border-slate-700/60 flex items-center justify-center shrink-0">
      <Icon size={14} className="text-slate-400" />
    </div>
  );
}

function ChartTooltip({ active, payload, label }: {
  active?: boolean; payload?: { value: number }[]; label?: string | number;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl px-3.5 py-2.5 shadow-xl">
      <p className="text-slate-500 text-xs mb-1">Trade #{label}</p>
      <p className="text-white font-semibold text-sm">${payload[0].value.toLocaleString()}</p>
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

type FetchStatus = "loading" | "error" | "success";

export default function Analytics() {
  const [trades, setTrades] = useState<ApiTrade[]>([]);
  const [status, setStatus] = useState<FetchStatus>("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loadTrades = useCallback(async () => {
    setStatus("loading");
    setErrorMessage(null);
    try {
      const res = await fetch(TRADES_ENDPOINT, {
        method: "GET",
        headers: { "Content-Type": "application/json" },
      });

      const body: TradesResponse = await res.json();

      if (!res.ok || body.status === "error") {
        const msg = body.status === "error" ? body.message : `Server responded with ${res.status}`;
        throw new Error(msg);
      }

      setTrades(body.data);
      setStatus("success");
    } catch (err) {
      console.error("Failed to load trades from API:", err);
      setErrorMessage(
        err instanceof Error ? err.message : "Failed to load trades."
      );
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    loadTrades();
  }, [loadTrades]);

  const stats = useMemo(() => {
    const total = trades.length;

    if (total === 0) {
      return {
        totalTrades: 0,
        winRatePct: 0,
        profitFactor: null as number | null,
        avgRR: null as number | null,
        equityData: [{ trade: 0, balance: STARTING_BALANCE }],
        winLossData: [{ name: "Wins", value: 0 }, { name: "Losses", value: 0 }],
        setupData: [] as { setup: string; trades: number }[],
        recommendations: [] as Recommendation[],
      };
    }

    // result/pnl come straight from the stored columns — used as-is, never recalculated.
    const wins = trades.filter((t) => t.result === "win").length;
    const losses = trades.filter((t) => t.result === "loss").length;
    const winRatePct = Math.round((wins / total) * 100);

    // Only closed trades (pnl not null) contribute to P&L-based figures.
    const closed = trades.filter((t) => t.pnl != null) as (ApiTrade & { pnl: number })[];

    const grossProfit = closed.filter((t) => t.pnl > 0).reduce((s, t) => s + t.pnl, 0);
    const grossLoss = Math.abs(closed.filter((t) => t.pnl < 0).reduce((s, t) => s + t.pnl, 0));
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? Infinity : null);

    const rrValues = trades.map(getPlannedRR).filter((v): v is number => v !== null);
    const avgRR = rrValues.length > 0 ? rrValues.reduce((s, v) => s + v, 0) / rrValues.length : null;

    // Equity curve: cumulative balance in chronological order, one point per
    // CLOSED trade (open trades haven't realized a pnl yet, so they don't move the curve).
    const chronologicalClosed = [...closed].sort((a, b) =>
      a.trade_date < b.trade_date ? -1 : a.trade_date > b.trade_date ? 1 : 0
    );
    let running = STARTING_BALANCE;
    const equityData = chronologicalClosed.length > 0
      ? chronologicalClosed.map((t, i) => {
          running += t.pnl;
          return { trade: i + 1, balance: Math.round(running) };
        })
      : [{ trade: 0, balance: STARTING_BALANCE }];

    const winLossData = [
      { name: "Wins", value: wins },
      { name: "Losses", value: losses },
    ];

    // Setup performance, most-traded setup first (includes open trades — this is just a count)
    const setupCounts = new Map<string, number>();
    trades.forEach((t) => {
      const key = t.setup_type || "Unspecified";
      setupCounts.set(key, (setupCounts.get(key) || 0) + 1);
    });
    const setupData = Array.from(setupCounts.entries())
      .map(([setup, count]) => ({ setup, trades: count }))
      .sort((a, b) => b.trades - a.trades);

    // Setup win rates (for the "strongest setup" recommendation) — uses stored result.
    // Denominator is win+loss trades for that setup (breakeven/open trades don't
    // count toward a "win rate").
    const setupWinStats = new Map<string, { wins: number; total: number }>();
    trades.forEach((t) => {
      if (t.result !== "win" && t.result !== "loss") return;
      const key = t.setup_type || "Unspecified";
      const entry = setupWinStats.get(key) || { wins: 0, total: 0 };
      entry.total += 1;
      if (t.result === "win") entry.wins += 1;
      setupWinStats.set(key, entry);
    });
    let bestSetup: { name: string; winRate: number; total: number } | null = null;
    // NOTE: this was previously `setupWinStats.forEach((v, name) => { ... bestSetup = ... })`.
    // TypeScript cannot track reassignment of an outer `let` from inside a callback
    // passed to Map.forEach, so after the loop it still treats `bestSetup` as its
    // pre-loop type (`null`), which made every later `bestSetup.xxx` access resolve
    // to `never` and fail the build ("Property 'name' does not exist on type 'never'").
    // A plain `for...of` loop has the same runtime behavior (same iteration order,
    // same values, same mutation) but lets TypeScript correctly widen `bestSetup`
    // back to `{ name; winRate; total } | null` once the loop exits.
    for (const [name, v] of setupWinStats) {
      const winRate = Math.round((v.wins / v.total) * 100);
      if (
        !bestSetup ||
        winRate > bestSetup.winRate ||
        (winRate === bestSetup.winRate && v.total > bestSetup.total)
      ) {
        bestSetup = { name, winRate, total: v.total };
      }
    }

    // Best-performing asset by total net P&L — uses stored pnl, closed trades only
    const assetPnl = new Map<string, number>();
    closed.forEach((t) => {
      assetPnl.set(t.asset, (assetPnl.get(t.asset) || 0) + t.pnl);
    });
    let bestAsset: { name: string; pnl: number } | null = null;
    // Same fix as bestSetup above: for...of instead of Map.forEach so TypeScript
    // keeps `bestAsset`'s real type after the loop instead of narrowing it to `never`.
    for (const [name, pnl] of assetPnl) {
      if (!bestAsset || pnl > bestAsset.pnl) bestAsset = { name, pnl };
    }

    // ── Data-driven recommendations ──
    const recommendations: Recommendation[] = [];

    if (bestSetup) {
      recommendations.push({
        tag: "Edge",
        color: "text-blue-400",
        bg: "bg-blue-500/8",
        border: "border-blue-500/20",
        text: `${bestSetup.name} is your strongest setup at ${bestSetup.winRate}% win rate across ${bestSetup.total} trade${bestSetup.total !== 1 ? "s" : ""}.`,
      });
    }

    if (profitFactor !== null && profitFactor < 1) {
      recommendations.push({
        tag: "Warning",
        color: "text-amber-400",
        bg: "bg-amber-500/8",
        border: "border-amber-500/20",
        text: "Your losses exceed your gains. Review your risk management before increasing position size.",
      });
    } else if (winRatePct >= 70) {
      recommendations.push({
        tag: "Action",
        color: "text-emerald-400",
        bg: "bg-emerald-500/8",
        border: "border-emerald-500/20",
        text: `Your consistency is excellent — a ${winRatePct}% win rate. Keep executing your process as-is.`,
      });
    } else if (profitFactor !== null) {
      recommendations.push({
        tag: "Action",
        color: "text-emerald-400",
        bg: "bg-emerald-500/8",
        border: "border-emerald-500/20",
        text: `Your Profit Factor of ${profitFactor === Infinity ? "∞" : profitFactor.toFixed(1)} is solid. Protect it by trimming your lowest-edge setups.`,
      });
    }

    if (bestAsset && bestAsset.pnl > 0) {
      recommendations.push({
        tag: "Insight",
        color: "text-cyan-400",
        bg: "bg-cyan-500/8",
        border: "border-cyan-500/20",
        text: `${bestAsset.name} is currently your best-performing asset at ${bestAsset.pnl >= 0 ? "+" : ""}${bestAsset.pnl.toFixed(2)} net P&L.`,
      });
    }

    // Backfill with a generic nudge if fewer than 3 rules triggered, to keep the 3-card layout
    while (recommendations.length < 3) {
      recommendations.push({
        tag: "Insight",
        color: "text-cyan-400",
        bg: "bg-cyan-500/8",
        border: "border-cyan-500/20",
        text: "Log a few more trades to unlock additional personalized insights.",
      });
    }

    return {
      totalTrades: total,
      winRatePct,
      profitFactor,
      avgRR,
      equityData,
      winLossData,
      setupData,
      recommendations: recommendations.slice(0, 3),
    };
  }, [trades]);

  const {
    totalTrades, winRatePct, profitFactor, avgRR,
    equityData, winLossData, setupData, recommendations,
  } = stats;

  const isLoading = status === "loading";
  const isError = status === "error";
  const hasTrades = status === "success" && totalTrades > 0;

  const kpis = [
    {
      label: "Total Trades",
      value: hasTrades ? `${totalTrades}` : "—",
      color: "text-white",
      icon: BarChart2,
    },
    {
      label: "Win Rate",
      value: hasTrades ? `${winRatePct}%` : "—",
      color: "text-emerald-400",
      icon: Percent,
    },
    {
      label: "Profit Factor",
      value:
        !hasTrades || profitFactor === null ? "—" : profitFactor === Infinity ? "∞" : profitFactor.toFixed(1),
      color: "text-blue-400",
      icon: TrendingUp,
    },
    {
      label: "Avg RR",
      value: hasTrades && avgRR !== null ? `1 : ${avgRR.toFixed(1)}` : "—",
      color: "text-white",
      icon: ChevronsUpDown,
    },
  ];

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.25 }}
      className="space-y-6"
    >

      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white tracking-tight">Analytics</h1>
        <p className="text-sm text-slate-500 mt-1">Performance breakdown across all your trades.</p>
      </div>

      {/* Error state */}
      {isError && (
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          className={`${card} flex items-center justify-between gap-4`}
        >
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-red-500/10 border border-red-500/20 flex items-center justify-center shrink-0">
              <AlertTriangle size={14} className="text-red-400" />
            </div>
            <div>
              <p className="text-sm font-semibold text-white">Couldn't load your trades</p>
              <p className="text-xs text-slate-500 mt-0.5">{errorMessage || "Something went wrong talking to the server."}</p>
            </div>
          </div>
          <button
            onClick={loadTrades}
            className="flex items-center gap-2 text-xs font-medium text-slate-300 bg-slate-800 hover:bg-slate-700 border border-slate-700/60 rounded-lg px-3 py-2 transition-colors"
          >
            <RefreshCw size={12} />
            Retry
          </button>
        </motion.div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-4 gap-4">
        {kpis.map((k, i) => (
          <motion.div
            key={k.label}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            whileHover={{ y: -2 }}
            transition={{ duration: 0.3, delay: i * 0.06 }}
            className={card}
          >
            <div className="flex items-start justify-between mb-5">
              <p className="text-xs text-slate-500 uppercase tracking-widest font-medium">{k.label}</p>
              <IconBadge icon={k.icon} />
            </div>
            {isLoading ? (
              <div className="h-8 w-16 rounded-md bg-slate-800 animate-pulse" />
            ) : (
              <p className={`text-3xl font-bold tracking-tight ${k.color}`}>{k.value}</p>
            )}
          </motion.div>
        ))}
      </div>

      {/* Equity Curve + Win/Loss */}
      <div className="grid gap-4" style={{ gridTemplateColumns: "1.86fr 1fr" }}>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, delay: 0.24 }}
          className={card}
        >
          <h2 className="text-sm font-semibold text-white mb-1">Equity Curve</h2>
          <p className="text-xs text-slate-500 mb-5">Balance per trade</p>

          {isLoading ? (
            <div className="h-[260px] rounded-xl bg-slate-800/50 animate-pulse" />
          ) : !hasTrades ? (
            <div className="h-[260px] flex flex-col items-center justify-center text-center">
              <p className="text-slate-500 text-sm">No trades yet</p>
              <p className="text-slate-600 text-xs mt-1">Log a trade to start building your equity curve.</p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={equityData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="eqGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%"   stopColor="#3b82f6" stopOpacity={0.18} />
                    <stop offset="100%" stopColor="#3b82f6" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="rgba(148,163,184,0.05)" vertical={false} />
                <XAxis dataKey="trade" tick={{ fill: "#64748b", fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v) => `#${v}`} />
                <YAxis tick={{ fill: "#64748b", fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${v}`} width={52} />
                <Tooltip content={<ChartTooltip />} />
                <Area type="monotone" dataKey="balance" stroke="#3b82f6" strokeWidth={2} fill="url(#eqGrad)" dot={false} activeDot={{ r: 4, fill: "#3b82f6", strokeWidth: 0 }} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, delay: 0.28 }}
          className={card}
        >
          <h2 className="text-sm font-semibold text-white mb-1">Win / Loss Distribution</h2>
          <p className="text-xs text-slate-500 mb-5">
            {hasTrades ? `Last ${totalTrades} trade${totalTrades !== 1 ? "s" : ""}` : isLoading ? "Loading…" : "No trades yet"}
          </p>

          {isLoading ? (
            <div className="h-[200px] rounded-xl bg-slate-800/50 animate-pulse" />
          ) : (
            <>
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie data={winLossData} dataKey="value" innerRadius={65} outerRadius={90} paddingAngle={4} strokeWidth={0}>
                    {winLossData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i]} />)}
                  </Pie>
                  <text x="50%" y="46%" textAnchor="middle" dominantBaseline="middle" fill="white" fontSize="26" fontWeight="bold">
                    {hasTrades ? `${winRatePct}%` : "—"}
                  </text>
                  <text x="50%" y="57%" textAnchor="middle" dominantBaseline="middle" fill="#64748b" fontSize="12">Win Rate</text>
                </PieChart>
              </ResponsiveContainer>

              <div className="flex justify-center gap-6 mt-4">
                {winLossData.map((d, i) => (
                  <div key={d.name} className="flex items-center gap-2">
                    <div className="w-2.5 h-2.5 rounded-full" style={{ background: PIE_COLORS[i] }} />
                    <span className="text-xs text-slate-400">{d.name} ({d.value})</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </motion.div>
      </div>

      {/* Setup Performance */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, delay: 0.32 }}
        className={card}
      >
        <h2 className="text-sm font-semibold text-white mb-1">Setup Performance</h2>
        <p className="text-xs text-slate-500 mb-5">Trades by setup type</p>

        {isLoading ? (
          <div className="h-[240px] rounded-xl bg-slate-800/50 animate-pulse" />
        ) : setupData.length === 0 ? (
          <div className="text-center py-10">
            <p className="text-slate-500 text-sm">No trades yet</p>
            <p className="text-slate-600 text-xs mt-1">
              Log trades in the Trade Journal to see setup performance.
            </p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={setupData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="rgba(148,163,184,0.05)" vertical={false} />
              <XAxis dataKey="setup" tick={{ fill: "#64748b", fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: "#64748b", fontSize: 11 }} axisLine={false} tickLine={false} width={28} />
              <Tooltip
                cursor={{ fill: "rgba(148,163,184,0.06)" }}
                contentStyle={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: "0.75rem", color: "#fff", fontSize: 12 }}
              />
              <Bar dataKey="trades" fill="#3b82f6" radius={[6, 6, 0, 0]} maxBarSize={48} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </motion.div>

      {/* Recommendations */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, delay: 0.36 }}
        className={card}
      >
        <div className="flex items-center gap-2.5 mb-5">
          <IconBadge icon={Lightbulb} />
          <div>
            <h2 className="text-sm font-semibold text-white">Recommendations</h2>
            <p className="text-xs text-slate-500 mt-0.5">Based on your trade data</p>
          </div>
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-28 rounded-xl bg-slate-800/50 animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {recommendations.map((r, i) => (
              <motion.div
                key={`${r.tag}-${i}`}
                whileHover={{ y: -2 }}
                transition={{ duration: 0.15 }}
                className={`p-4 rounded-xl border ${r.border} ${r.bg}`}
              >
                <div className={`w-7 h-7 rounded-lg border ${r.border} ${r.bg} flex items-center justify-center text-xs font-bold ${r.color} mb-3`}>
                  {i + 1}
                </div>
                <span className={`text-[10px] font-bold uppercase tracking-wider ${r.color} block mb-2`}>
                  {r.tag}
                </span>
                <p className="text-sm text-slate-300 leading-relaxed">{r.text}</p>
              </motion.div>
            ))}
          </div>
        )}
      </motion.div>

    </motion.div>
  );
}