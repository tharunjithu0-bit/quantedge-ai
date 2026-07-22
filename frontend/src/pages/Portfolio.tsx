import { useState, useEffect, useMemo, useCallback } from "react";
import { motion } from "framer-motion";
import {
  DollarSign,
  Trophy,
  TrendingDown,
  Layers,
  PieChart as PieChartIcon,
  AlertTriangle,
  RefreshCw,
} from "lucide-react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import { useAuth } from "../context/AuthContext";

// ---------- Trade data ----------
// Matches models/trade.py Trade.to_dict() exactly, as returned by
// GET /api/trades (routes/trade_routes.py -> {"status": "success", "data": [...]}).
//
// pnl and result are stored server-side and used as-is below — never
// recalculated on the client. pnl is null while a trade is still open.

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

function formatDateLabel(dateStr: string) {
  const d = new Date(`${dateStr}T00:00:00`);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

const DONUT_COLORS = ["#22d3ee", "#3b82f6", "#a78bfa", "#34d399", "#f59e0b", "#f43f5e", "#facc15", "#10b981"];

// ---------- Helpers ----------

const formatCurrency = (n: number) =>
  n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const cardClass = `
  p-6 rounded-2xl
  bg-slate-800/50
  backdrop-blur-xl
  border border-slate-800
  hover:border-blue-500
  transition-all duration-300
`;

// ---------- Component ----------

type FetchStatus = "loading" | "error" | "success";

function Portfolio() {
  const { token } = useAuth();
  const [trades, setTrades] = useState<ApiTrade[]>([]);
  const [status, setStatus] = useState<FetchStatus>("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loadTrades = useCallback(async () => {
    setStatus("loading");
    setErrorMessage(null);
    try {
      const res = await fetch(TRADES_ENDPOINT, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
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
      setErrorMessage(err instanceof Error ? err.message : "Failed to load trades.");
      setStatus("error");
    }
  }, [token]);

  useEffect(() => {
    if (!token) return;
    loadTrades();
  }, [token, loadTrades]);

  const stats = useMemo(() => {
    const total = trades.length;

    if (total === 0) {
      return {
        netPnl: 0,
        bestAsset: null as { name: string; pnl: number } | null,
        worstAsset: null as { name: string; pnl: number } | null,
        assetCount: 0,
        closedCount: 0,
        equityData: [{ label: "Start", value: STARTING_BALANCE }],
        donutData: [] as { name: string; value: number; color: string }[],
        assetPerformance: [] as {
          asset: string; trades: number; wins: number; losses: number; winRate: number; netPnl: number;
        }[],
      };
    }

    // Only closed trades (pnl not null) feed P&L-based figures — open trades
    // are counted in "total" but never contribute a pnl, win, or loss.
    const closed = trades.filter((t) => t.pnl != null) as (ApiTrade & { pnl: number })[];
    const netPnl = closed.reduce((sum, t) => sum + t.pnl, 0);

    // Distinct assets across ALL trades (an asset with only an open
    // position should still show up in "Total Assets Traded").
    const assetCount = new Set(trades.map((t) => t.asset)).size;

    // Per-asset performance — CLOSED trades only (result/pnl are stored, used as-is).
    const assetMap = new Map<string, { trades: number; wins: number; losses: number; pnl: number }>();
    closed.forEach((t) => {
      const entry = assetMap.get(t.asset) || { trades: 0, wins: 0, losses: 0, pnl: 0 };
      entry.trades += 1;
      if (t.result === "win") entry.wins += 1;
      if (t.result === "loss") entry.losses += 1;
      entry.pnl += t.pnl;
      assetMap.set(t.asset, entry);
    });

    let bestAsset: { name: string; pnl: number } | null = null;
    let worstAsset: { name: string; pnl: number } | null = null;
    assetMap.forEach((v, name) => {
      if (!bestAsset || v.pnl > bestAsset.pnl) bestAsset = { name, pnl: v.pnl };
      if (!worstAsset || v.pnl < worstAsset.pnl) worstAsset = { name, pnl: v.pnl };
    });

    const assetPerformance = Array.from(assetMap.entries())
      .map(([asset, v]) => ({
        asset,
        trades: v.trades,
        wins: v.wins,
        losses: v.losses,
        winRate: v.trades > 0 ? Math.round((v.wins / v.trades) * 100) : 0,
        netPnl: v.pnl,
      }))
      .sort((a, b) => b.netPnl - a.netPnl);

    // Trade Distribution represents trading ACTIVITY by asset, not
    // performance — so it's built from ALL trades (open + closed),
    // independent of the closed-only assetMap used for P&L above.
    const activityMap = new Map<string, number>();
    trades.forEach((t) => {
      activityMap.set(t.asset, (activityMap.get(t.asset) || 0) + 1);
    });
    const donutData = Array.from(activityMap.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([asset, count], i) => ({
        name: asset,
        value: Math.round((count / total) * 100),
        color: DONUT_COLORS[i % DONUT_COLORS.length],
      }));

    // Equity curve: cumulative stored P&L per calendar day, chronological — closed trades only.
    const byDate = new Map<string, number>();
    closed.forEach((t) => {
      byDate.set(t.trade_date, (byDate.get(t.trade_date) || 0) + t.pnl);
    });
    const sortedDates = Array.from(byDate.keys()).sort();
    let running = STARTING_BALANCE;
    const equityData = sortedDates.map((date) => {
      running += byDate.get(date)!;
      return { label: formatDateLabel(date), value: Math.round(running) };
    });

    return {
      netPnl,
      bestAsset,
      worstAsset,
      assetCount,
      closedCount: closed.length,
      equityData: equityData.length > 0 ? equityData : [{ label: "Start", value: STARTING_BALANCE }],
      donutData,
      assetPerformance,
    };
  }, [trades]);

  const { netPnl, bestAsset, worstAsset, assetCount, closedCount, equityData, donutData, assetPerformance } = stats;

  const isLoading = status === "loading";
  const isError = status === "error";
  const hasTrades = status === "success" && trades.length > 0;
  const hasClosedTrades = status === "success" && closedCount > 0;
  const isPnLPositive = netPnl >= 0;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-wide">Portfolio</h1>
        <p className="text-slate-400 mt-1">
          Your trading performance broken down by asset
        </p>
      </div>

      {/* Error state */}
      {isError && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className={`${cardClass} flex items-center justify-between gap-4`}
        >
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-rose-400 to-red-600 flex items-center justify-center shadow-lg shadow-rose-500/30">
              <AlertTriangle size={16} />
            </div>
            <div>
              <p className="font-semibold">Couldn't load your trades</p>
              <p className="text-slate-400 text-xs mt-0.5">{errorMessage || "Something went wrong talking to the server."}</p>
            </div>
          </div>
          <button
            onClick={loadTrades}
            className="flex items-center gap-2 text-xs font-medium text-slate-300 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg px-3 py-2 transition-colors"
          >
            <RefreshCw size={12} />
            Retry
          </button>
        </motion.div>
      )}

      {/* Top Cards: Net P&L, Best Asset, Worst Asset, Total Assets Traded */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className={cardClass}
        >
          <div className="flex items-center justify-between">
            <p className="text-slate-400 text-sm">Net P&amp;L</p>
            <div
              className={`
                w-9 h-9 rounded-lg
                flex items-center justify-center
                shadow-lg
                ${
                  isPnLPositive
                    ? "bg-gradient-to-br from-emerald-400 to-green-600 shadow-emerald-500/30"
                    : "bg-gradient-to-br from-rose-400 to-red-600 shadow-rose-500/30"
                }
              `}
            >
              <DollarSign size={16} />
            </div>
          </div>
          {isLoading ? (
            <div className="h-9 w-28 rounded-md bg-slate-700/50 animate-pulse mt-3" />
          ) : (
            <p
              className={`text-3xl font-bold mt-3 tracking-wide ${
                hasClosedTrades ? (isPnLPositive ? "text-emerald-400" : "text-rose-400") : ""
              }`}
            >
              {hasClosedTrades ? `${isPnLPositive ? "+" : ""}${formatCurrency(netPnl)}` : "—"}
            </p>
          )}
          <p className="text-slate-500 text-xs mt-2">
            {hasTrades ? `${trades.length} trade${trades.length !== 1 ? "s" : ""} logged` : "No trades yet"}
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.05 }}
          className={cardClass}
        >
          <div className="flex items-center justify-between">
            <p className="text-slate-400 text-sm">Best Asset</p>
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-cyan-400 to-blue-600 flex items-center justify-center shadow-lg shadow-cyan-500/30">
              <Trophy size={16} />
            </div>
          </div>
          {isLoading ? (
            <div className="h-9 w-24 rounded-md bg-slate-700/50 animate-pulse mt-3" />
          ) : (
            <p className="text-3xl font-bold mt-3 tracking-wide">
              {bestAsset ? bestAsset.name : "—"}
            </p>
          )}
          <p className="text-emerald-500/80 text-xs mt-2">
            {bestAsset ? `${bestAsset.pnl >= 0 ? "+" : ""}${formatCurrency(bestAsset.pnl)} net P&L` : "No closed trades yet"}
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.1 }}
          className={cardClass}
        >
          <div className="flex items-center justify-between">
            <p className="text-slate-400 text-sm">Worst Asset</p>
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-rose-400 to-red-600 flex items-center justify-center shadow-lg shadow-rose-500/30">
              <TrendingDown size={16} />
            </div>
          </div>
          {isLoading ? (
            <div className="h-9 w-24 rounded-md bg-slate-700/50 animate-pulse mt-3" />
          ) : (
            <p className="text-3xl font-bold mt-3 tracking-wide">
              {worstAsset ? worstAsset.name : "—"}
            </p>
          )}
          <p className="text-rose-500/80 text-xs mt-2">
            {worstAsset ? `${worstAsset.pnl >= 0 ? "+" : ""}${formatCurrency(worstAsset.pnl)} net P&L` : "No closed trades yet"}
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.15 }}
          className={cardClass}
        >
          <div className="flex items-center justify-between">
            <p className="text-slate-400 text-sm">Total Assets Traded</p>
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-violet-400 to-purple-600 flex items-center justify-center shadow-lg shadow-violet-500/30">
              <Layers size={16} />
            </div>
          </div>
          {isLoading ? (
            <div className="h-9 w-12 rounded-md bg-slate-700/50 animate-pulse mt-3" />
          ) : (
            <p className="text-3xl font-bold mt-3 tracking-wide">
              {hasTrades ? assetCount : "—"}
            </p>
          )}
          <p className="text-slate-500 text-xs mt-2">
            {hasTrades ? `${trades.length} total trades` : "No trades yet"}
          </p>
        </motion.div>
      </div>

      {/* Performance + Distribution */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Equity Curve */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.1 }}
          className={`lg:col-span-2 ${cardClass}`}
        >
          <h2 className="font-semibold text-lg mb-1">Equity Curve</h2>
          <p className="text-slate-400 text-sm mb-4">
            {isLoading ? "Loading…" : hasClosedTrades ? "Cumulative balance over time" : "No closed trades yet"}
          </p>

          <div className="h-72">
            {isLoading ? (
              <div className="w-full h-full rounded-xl bg-slate-700/30 animate-pulse" />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={equityData}>
                  <defs>
                    <linearGradient id="equityFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#22d3ee" stopOpacity={0.4} />
                      <stop offset="100%" stopColor="#22d3ee" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="#1e293b"
                    vertical={false}
                  />
                  <XAxis
                    dataKey="label"
                    stroke="#64748b"
                    fontSize={12}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    stroke="#64748b"
                    fontSize={12}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v) => `$${(v / 1000).toFixed(1)}k`}
                    width={50}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "rgba(15, 23, 42, 0.95)",
                      border: "1px solid #1e293b",
                      borderRadius: "0.75rem",
                      color: "#fff",
                    }}
                    formatter={(value) => [
                      formatCurrency(Number(value)),
                      "Balance",
                    ]}
                  />
                  <Area
                    type="monotone"
                    dataKey="value"
                    stroke="#22d3ee"
                    strokeWidth={2}
                    fill="url(#equityFill)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </motion.div>

        {/* Trade Distribution Donut */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.15 }}
          className={cardClass}
        >
          <div className="flex items-center gap-2 mb-1">
            <PieChartIcon size={18} className="text-cyan-400" />
            <h2 className="font-semibold text-lg">Trade Distribution</h2>
          </div>
          <p className="text-slate-400 text-sm mb-2">By asset</p>

          {isLoading ? (
            <div className="h-44 rounded-xl bg-slate-700/30 animate-pulse" />
          ) : donutData.length === 0 ? (
            <div className="h-44 flex items-center justify-center">
              <p className="text-slate-500 text-sm">No trades yet</p>
            </div>
          ) : (
            <>
              <div className="h-44 relative">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={donutData}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={50}
                      outerRadius={72}
                      paddingAngle={3}
                      strokeWidth={0}
                    >
                      {donutData.map((entry) => (
                        <Cell key={entry.name} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{
                        background: "rgba(15, 23, 42, 0.95)",
                        border: "1px solid #1e293b",
                        borderRadius: "0.75rem",
                        color: "#fff",
                      }}
                      formatter={(value, name) => [
                        `${value}%`,
                        String(name),
                      ]}
                    />
                  </PieChart>
                </ResponsiveContainer>
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                  <p className="text-xs text-slate-500">Assets</p>
                  <p className="text-xl font-bold">{assetCount}</p>
                </div>
              </div>

              <div className="space-y-2 mt-4">
                {donutData.map((item) => (
                  <div
                    key={item.name}
                    className="flex items-center justify-between text-sm"
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className="w-2.5 h-2.5 rounded-full"
                        style={{ backgroundColor: item.color }}
                      />
                      <span className="text-slate-300">{item.name}</span>
                    </div>
                    <span className="font-medium text-slate-200">
                      {item.value}%
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
        </motion.div>
      </div>

      {/* Asset Performance */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.2 }}
        className={cardClass}
      >
        <h2 className="font-semibold text-lg mb-1">Asset Performance</h2>
        <p className="text-slate-400 text-sm mb-5">
          Win rate and P&amp;L broken down by asset
        </p>

        {isLoading ? (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-10 rounded-lg bg-slate-700/30 animate-pulse" />
            ))}
          </div>
        ) : assetPerformance.length === 0 ? (
          <div className="text-center py-10">
            <p className="text-slate-500 text-sm">
              {hasTrades ? "No closed trades yet" : "No trades yet"}
            </p>
            <p className="text-slate-600 text-xs mt-1">
              {hasTrades
                ? "Asset performance appears once a trade has an exit price."
                : "Log trades in the Trade Journal to see asset performance."}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-500 border-b border-slate-800">
                  <th className="pb-3 font-medium">Asset</th>
                  <th className="pb-3 font-medium">Trades</th>
                  <th className="pb-3 font-medium">Wins</th>
                  <th className="pb-3 font-medium">Losses</th>
                  <th className="pb-3 font-medium">Win Rate</th>
                  <th className="pb-3 font-medium text-right">Net P&amp;L</th>
                </tr>
              </thead>
              <tbody>
                {assetPerformance.map((a) => {
                  const positive = a.netPnl >= 0;
                  return (
                    <tr
                      key={a.asset}
                      className="
                        border-b border-slate-800/60
                        last:border-0
                        hover:bg-slate-800/40
                        transition-colors duration-200
                      "
                    >
                      <td className="py-3.5">
                        <p className="font-semibold">{a.asset}</p>
                      </td>
                      <td className="py-3.5 text-slate-300">{a.trades}</td>
                      <td className="py-3.5 text-emerald-400">{a.wins}</td>
                      <td className="py-3.5 text-rose-400">{a.losses}</td>
                      <td className="py-3.5">
                        <div className="flex items-center gap-2 max-w-[140px]">
                          <div className="flex-1 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                            <div
                              className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-blue-600"
                              style={{ width: `${a.winRate}%` }}
                            />
                          </div>
                          <span className="text-slate-400 text-xs w-9">
                            {a.winRate}%
                          </span>
                        </div>
                      </td>
                      <td className="py-3.5 text-right">
                        <span
                          className={`font-medium ${
                            positive ? "text-emerald-400" : "text-rose-400"
                          }`}
                        >
                          {positive ? "+" : ""}
                          {formatCurrency(a.netPnl)}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </motion.div>
    </div>
  );
}

export default Portfolio;