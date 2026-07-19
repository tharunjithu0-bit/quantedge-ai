import { useState, useEffect, useMemo } from "react";
import { motion } from "framer-motion";
import { DollarSign, Target, Flame, TrendingUp, TrendingDown, Gauge } from "lucide-react";
import {
  AreaChart, Area, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid,
} from "recharts";
import axios from "axios";
import { useAuth } from "../context/AuthContext";

// ── Trade data (shared shape with TradeJournal.tsx) ───────────────────────────

type Trade = {
  asset: string;
  direction: string;
  entry: string;
  exit: string;
  stopLoss: string;
  takeProfit: string;
  lotSize: string;
  pnl: number | null;
  setupType: string;
  result: string;
  tradeDate: string;
  notes: string;
};

const API_BASE_URL = "http://127.0.0.1:5000";
const STARTING_BALANCE = 1000; // baseline the equity curve is drawn from

// Capitalizes the first letter only, e.g. "buy" -> "Buy", "win" -> "Win".
// The backend stores direction/result lowercase; the UI expects the
// capitalized form for its badge styling and comparisons.
const capitalize = (value: string) =>
  value ? value.charAt(0).toUpperCase() + value.slice(1) : "";

// Maps a trade object returned by GET /api/trades (snake_case, numeric
// fields, server-calculated pnl) into the shape this component uses.
const mapApiTradeToTrade = (item: any): Trade => ({
  asset: item.asset ?? "",
  direction: capitalize(item.direction ?? ""),
  entry: item.entry !== null && item.entry !== undefined ? String(item.entry) : "",
  exit: item.exit !== null && item.exit !== undefined ? String(item.exit) : "",
  stopLoss: item.stop_loss !== null && item.stop_loss !== undefined ? String(item.stop_loss) : "",
  takeProfit:
    item.take_profit !== null && item.take_profit !== undefined ? String(item.take_profit) : "",
  lotSize: item.lot_size !== null && item.lot_size !== undefined ? String(item.lot_size) : "",
  pnl: item.pnl !== null && item.pnl !== undefined ? Number(item.pnl) : null,
  setupType: item.setup_type ?? "",
  result: capitalize(item.result ?? ""),
  tradeDate: item.trade_date ?? "",
  notes: item.notes ?? "",
});

async function loadTradesFromApi(): Promise<Trade[]> {
  try {
    const response = await axios.get(`${API_BASE_URL}/api/trades`);
    const apiTrades = Array.isArray(response.data?.data) ? response.data.data : [];
    return apiTrades.map(mapApiTradeToTrade);
  } catch (err) {
    console.error("Failed to load trades from API:", err);
    return [];
  }
}

const aiInsights = [
  {
    tag: "Edge",
    color: "text-cyan-400",
    bg: "bg-cyan-400/10",
    border: "border-cyan-400/20",
    text: "Breakout setups are your strongest edge — 78% win rate across 12 trades this month.",
  },
  {
    tag: "Warning",
    color: "text-amber-400",
    bg: "bg-amber-400/10",
    border: "border-amber-400/20",
    text: "Pullback trades are dragging your average down to 51%. Consider pausing them until you review the setup criteria.",
  },
  {
    tag: "Action",
    color: "text-violet-400",
    bg: "bg-violet-400/10",
    border: "border-violet-400/20",
    text: "Size up on A+ Breakout setups. Your current position sizing underweights your best setup.",
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0 });
}

// P&L is calculated server-side (entry/exit/direction/lot_size/asset —
// see backend/utils/pnl.py) and stored on the trade; this just reads it.
function getPnl(trade: Trade): number {
  return trade.pnl ?? 0;
}

// Planned risk:reward from the trade's stop loss / take profit at entry time
function getPlannedRR(trade: Trade): number | null {
  const entryNum = parseFloat(trade.entry);
  const slNum = parseFloat(trade.stopLoss);
  const tpNum = parseFloat(trade.takeProfit);
  if (isNaN(entryNum) || isNaN(slNum) || isNaN(tpNum)) return null;

  const risk = trade.direction === "Buy" ? entryNum - slNum : slNum - entryNum;
  const reward = trade.direction === "Buy" ? tpNum - entryNum : entryNum - tpNum;
  if (risk <= 0) return null;
  return reward / risk;
}

function formatDateLabel(dateStr: string) {
  const d = new Date(`${dateStr}T00:00:00`);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// Returns "Good Morning" / "Good Afternoon" / "Good Evening" / "Good Night"
// based on the current system hour (24h clock):
//   Morning:   5:00 – 11:59
//   Afternoon: 12:00 – 16:59
//   Evening:   17:00 – 20:59
//   Night:     21:00 – 4:59
function getTimeBasedGreeting(now: Date): string {
  const hour = now.getHours();
  if (hour >= 5 && hour < 12) return "Good Morning";
  if (hour >= 12 && hour < 17) return "Good Afternoon";
  if (hour >= 17 && hour < 21) return "Good Evening";
  return "Good Night";
}

// Formats the current system date as "Monday • 15 June 2026"
function formatHeaderDate(now: Date): string {
  const weekday = now.toLocaleDateString("en-US", { weekday: "long" });
  const day = now.getDate();
  const month = now.toLocaleDateString("en-US", { month: "long" });
  const year = now.getFullYear();
  return `${weekday} • ${day} ${month} ${year}`;
}

// ── Custom Chart Tooltip ──────────────────────────────────────────────────────

function ChartTooltip({ active, payload, label }: {
  active?: boolean;
  payload?: { value: number }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-slate-900 border border-slate-700/80 rounded-xl px-3.5 py-2.5 text-xs shadow-xl">
      <p className="text-slate-400 mb-1">{label}</p>
      <p className="text-white font-bold text-sm">{fmt(payload[0].value)}</p>
    </div>
  );
}

// ── KPI Card ──────────────────────────────────────────────────────────────────

function KpiCard({
  label, value, sub, icon: Icon, positive,
  delay,
}: {
  label: string;
  value: string;
  sub: string;
  icon: React.ElementType;
  positive: boolean;
  delay: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay }}
      className="
        relative overflow-hidden
        bg-slate-900/70 backdrop-blur-xl
        rounded-2xl border border-slate-800
        hover:border-slate-700
        p-6
        shadow-[0_0_50px_-18px_rgba(34,211,238,0.35)]
        hover:shadow-[0_0_60px_-12px_rgba(34,211,238,0.5)]
        transition-all duration-300
      "
    >
      {/* stronger glow at top */}
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-400/60 to-transparent" />
      <div className="absolute -top-10 left-1/2 -translate-x-1/2 w-40 h-20 bg-cyan-400/10 blur-3xl rounded-full pointer-events-none" />

      <div className="flex items-start justify-between mb-4">
        <p className="text-xs text-slate-500 uppercase tracking-widest font-medium">{label}</p>
        <div className="w-8 h-8 rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center">
          <Icon size={14} className="text-slate-400" />
        </div>
      </div>

      <p className="text-3xl font-bold tracking-tight text-white mb-2">{value}</p>

      <div className="flex items-center gap-1.5">
        {positive ? (
          <TrendingUp size={12} className="text-emerald-400" />
        ) : (
          <TrendingDown size={12} className="text-rose-400" />
        )}
        <p className={`text-xs font-medium ${positive ? "text-emerald-400" : "text-rose-400"}`}>
          {sub}
        </p>
      </div>
    </motion.div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const { user } = useAuth();
  const [trades, setTrades] = useState<Trade[]>([]);

  useEffect(() => {
    let cancelled = false;

    loadTradesFromApi().then((apiTrades) => {
      if (!cancelled) setTrades(apiTrades);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const stats = useMemo(() => {
    const total = trades.length;

    if (total === 0) {
      return {
        netPnl: 0,
        winRatePct: 0,
        wins: 0,
        losses: 0,
        currentStreak: 0,
        bestStreak: 0,
        profitFactor: null as number | null,
        equityData: [{ label: "Start", value: STARTING_BALANCE }],
        percentChange: 0,
        dateRangeLabel: "No trades yet",
        recentTrades: [] as {
          asset: string; dir: string; setup: string; date: string; pnl: number; rr: string;
        }[],
        bestSetup: null as { name: string; winRate: number } | null,
      };
    }

    const withPnl = trades.map((t) => ({ trade: t, pnl: getPnl(t) }));

    const netPnl = withPnl.reduce((sum, t) => sum + t.pnl, 0);
    const wins = trades.filter((t) => t.result === "Win").length;
    const losses = trades.filter((t) => t.result === "Loss").length;
    const winRatePct = Math.round((wins / total) * 100);

    const grossProfit = withPnl.filter((t) => t.pnl > 0).reduce((s, t) => s + t.pnl, 0);
    const grossLoss = Math.abs(withPnl.filter((t) => t.pnl < 0).reduce((s, t) => s + t.pnl, 0));
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? Infinity : null);

    // Group P&L by calendar day for the equity curve + green-day streak
    const byDate = new Map<string, number>();
    withPnl.forEach(({ trade, pnl }) => {
      byDate.set(trade.tradeDate, (byDate.get(trade.tradeDate) || 0) + pnl);
    });
    const sortedDates = Array.from(byDate.keys()).sort();

    let running = STARTING_BALANCE;
    const equityData = sortedDates.map((date) => {
      running += byDate.get(date)!;
      return { label: formatDateLabel(date), value: Math.round(running) };
    });

    // Streak = consecutive trading days (most recent backwards) that were net green
    let bestStreak = 0;
    let runStreak = 0;
    sortedDates.forEach((date) => {
      if (byDate.get(date)! > 0) {
        runStreak += 1;
        bestStreak = Math.max(bestStreak, runStreak);
      } else {
        runStreak = 0;
      }
    });
    let currentStreak = 0;
    for (let i = sortedDates.length - 1; i >= 0; i--) {
      if (byDate.get(sortedDates[i])! > 0) currentStreak += 1;
      else break;
    }

    const firstValue = equityData[0]?.value ?? STARTING_BALANCE;
    const lastValue = equityData[equityData.length - 1]?.value ?? STARTING_BALANCE;
    const percentChange = firstValue !== 0 ? ((lastValue - firstValue) / firstValue) * 100 : 0;

    const dateRangeLabel =
      sortedDates.length > 0
        ? `${formatDateLabel(sortedDates[0])} – ${formatDateLabel(sortedDates[sortedDates.length - 1])}`
        : "No trades yet";

    // Most recent 4 trades, newest first
    const recentTrades = [...trades]
      .sort((a, b) => (a.tradeDate < b.tradeDate ? 1 : a.tradeDate > b.tradeDate ? -1 : 0))
      .slice(0, 4)
      .map((t) => {
        const rr = getPlannedRR(t);
        return {
          asset: t.asset,
          dir: t.direction,
          setup: t.setupType,
          date: formatDateLabel(t.tradeDate),
          pnl: getPnl(t),
          rr: rr !== null ? rr.toFixed(1) : "—",
        };
      });

    // Best setup by win rate (ties broken by trade count)
    const setupStats = new Map<string, { wins: number; total: number }>();
    trades.forEach((t) => {
      const entry = setupStats.get(t.setupType) || { wins: 0, total: 0 };
      entry.total += 1;
      if (t.result === "Win") entry.wins += 1;
      setupStats.set(t.setupType, entry);
    });
    let bestSetup: { name: string; winRate: number } | null = null;
    setupStats.forEach((v, name) => {
      const winRate = Math.round((v.wins / v.total) * 100);
      const currentBestTotal = bestSetup ? setupStats.get(bestSetup.name)?.total ?? 0 : 0;
      if (!bestSetup || winRate > bestSetup.winRate || (winRate === bestSetup.winRate && v.total > currentBestTotal)) {
        bestSetup = { name, winRate };
      }
    });

    return {
      netPnl, winRatePct, wins, losses, currentStreak, bestStreak,
      profitFactor, equityData, percentChange, dateRangeLabel, recentTrades, bestSetup,
    };
  }, [trades]);

  const {
    netPnl, winRatePct, wins, losses, currentStreak, bestStreak,
    profitFactor, equityData, percentChange, dateRangeLabel, recentTrades, bestSetup,
  } = stats;

  const hasTrades = trades.length > 0;

  const now = new Date();
  const greeting = getTimeBasedGreeting(now);
  const headerDate = formatHeaderDate(now);
  const displayName = user?.username ?? "";

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
      className="space-y-6"
    >

      {/* ── Header ── */}
      <div className="flex items-end justify-between">
        <div>
          <p className="text-xs text-slate-500 uppercase tracking-widest mb-1">
            {headerDate}
          </p>
          <h1 className="text-2xl font-bold tracking-tight text-white">
            {greeting}, {displayName} 
          </h1>
        </div>
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800/60 border border-slate-700 text-xs text-slate-400">
          Last 30 days
          <span className="text-slate-600">▾</span>
        </div>
      </div>

      {/* ── KPI Cards ── */}
      <div className="grid grid-cols-4 gap-4">
        <KpiCard
          label="Net P&L"
          value={hasTrades ? `${netPnl >= 0 ? "+" : "-"}${fmt(Math.abs(netPnl))}` : "—"}
          sub={hasTrades ? `${trades.length} trade${trades.length !== 1 ? "s" : ""} logged` : "No trades yet"}
          icon={DollarSign}
          positive={netPnl >= 0}
          delay={0}
        />
        <KpiCard
          label="Win Rate"
          value={hasTrades ? `${winRatePct}%` : "—"}
          sub={hasTrades ? `${wins}W · ${losses}L` : "No trades yet"}
          icon={Target}
          positive={winRatePct >= 50}
          delay={0.06}
        />
        <KpiCard
          label="Green Day Streak"
          value={hasTrades ? `${currentStreak} day${currentStreak !== 1 ? "s" : ""}` : "—"}
          sub={hasTrades ? `Personal best: ${bestStreak}` : "No trades yet"}
          icon={Flame}
          positive={currentStreak > 0}
          delay={0.12}
        />
        <KpiCard
          label="Profit Factor"
          value={
            profitFactor === null
              ? "—"
              : profitFactor === Infinity
                ? "∞"
                : profitFactor.toFixed(1)
          }
          sub={hasTrades ? `Based on ${trades.length} trades` : "No trades yet"}
          icon={Gauge}
          positive={profitFactor === null ? false : profitFactor >= 1}
          delay={0.18}
        />
      </div>

      {/* ── Equity Curve ── */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.18 }}
        className="
          bg-slate-900/70 backdrop-blur-xl
          rounded-2xl border border-slate-800
          hover:border-slate-700
          p-6
          transition-all duration-300
        "
      >
        <div className="flex items-start justify-between mb-6">
          <div>
            <h2 className="text-sm font-semibold text-white">Equity Curve</h2>
            <p className="text-xs text-slate-500 mt-0.5">{dateRangeLabel}</p>
          </div>
          {hasTrades && (
            <div
              className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-1 rounded-full border ${
                percentChange >= 0
                  ? "text-emerald-400 bg-emerald-400/10 border-emerald-400/20"
                  : "text-rose-400 bg-rose-400/10 border-rose-400/20"
              }`}
            >
              {percentChange >= 0 ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
              {percentChange >= 0 ? "+" : ""}
              {Math.round(percentChange)}% overall
            </div>
          )}
        </div>

        <ResponsiveContainer width="100%" height={220}>
          <AreaChart data={equityData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="eqGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%"   stopColor="#22d3ee" stopOpacity={0.2} />
                <stop offset="100%" stopColor="#22d3ee" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="rgba(148,163,184,0.05)" vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fill: "#475569", fontSize: 11 }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tick={{ fill: "#475569", fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v) => `$${v.toLocaleString()}`}
              width={62}
            />
            <Tooltip content={<ChartTooltip />} />
            <Area
              type="monotone"
              dataKey="value"
              stroke="#22d3ee"
              strokeWidth={2}
              fill="url(#eqGrad)"
              dot={false}
              activeDot={{ r: 4, fill: "#22d3ee", strokeWidth: 0 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </motion.div>

      {/* ── Bottom: AI Insight + Recent Trades ── */}
      <div className="grid gap-4" style={{ gridTemplateColumns: "1fr 340px" }}>

        {/* AI Insight — signature element: animated gradient border */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.24 }}
          className="relative rounded-2xl p-px overflow-hidden"
          style={{
            background: "linear-gradient(135deg, rgba(34,211,238,0.35), rgba(59,130,246,0.3), rgba(139,92,246,0.35), rgba(34,211,238,0.35))",
            backgroundSize: "300% 300%",
            animation: "borderCycle 6s ease infinite",
          }}
        >
          {/* Keyframes injected via style tag */}
          <style>{`
            @keyframes borderCycle {
              0%   { background-position: 0% 50%; }
              50%  { background-position: 100% 50%; }
              100% { background-position: 0% 50%; }
            }
          `}</style>

          <div className="relative h-full bg-slate-950/90 backdrop-blur-xl rounded-[calc(1rem-1px)] p-6">

            {/* Header */}
            <div className="flex items-center gap-2.5 mb-5">
              <motion.div
                animate={{ opacity: [1, 0.3, 1] }}
                transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
                className="w-2 h-2 rounded-full bg-cyan-400"
                style={{ boxShadow: "0 0 8px #22d3ee" }}
              />
              <span className="text-sm font-semibold text-white">AI Coach</span>
              <span className="ml-auto text-[10px] text-slate-500 uppercase tracking-widest">
                3 insights
              </span>
            </div>

            {/* Insight rows */}
            <div className="space-y-3">
              {aiInsights.map((insight) => (
                <div
                  key={insight.tag}
                  className={`
                    flex items-start gap-3
                    p-3.5 rounded-xl
                    border ${insight.border}
                    ${insight.bg}
                  `}
                >
                  <span
                    className={`
                      text-[10px] font-bold uppercase tracking-wider
                      px-2 py-0.5 rounded-md shrink-0 mt-0.5
                      ${insight.color} ${insight.bg} border ${insight.border}
                    `}
                  >
                    {insight.tag}
                  </span>
                  <p className="text-sm text-slate-300 leading-relaxed">{insight.text}</p>
                </div>
              ))}
            </div>
          </div>
        </motion.div>

        {/* Recent Trades */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.28 }}
          className="
            bg-slate-900/70 backdrop-blur-xl
            rounded-2xl border border-slate-800
            hover:border-slate-700
            p-6
            transition-all duration-300
          "
        >
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-sm font-semibold text-white">Recent Trades</h2>
            <span className="text-xs text-cyan-400 cursor-pointer hover:text-cyan-300 transition-colors">
              View all →
            </span>
          </div>

          {recentTrades.length === 0 ? (
            <div className="text-center py-10">
              <p className="text-slate-500 text-sm">No trades yet</p>
              <p className="text-slate-600 text-xs mt-1">
                Log your first trade in the Trade Journal.
              </p>
            </div>
          ) : (
            <div className="space-y-1">
              {recentTrades.map((t, i) => {
                const pos = t.pnl >= 0;
                return (
                  <div
                    key={i}
                    className="
                      flex items-center gap-3
                      p-3 rounded-xl
                      hover:bg-slate-800/50
                      transition-colors duration-200
                      cursor-pointer
                    "
                  >
                    {/* Direction dot */}
                    <div
                      className={`
                        w-1.5 h-8 rounded-full shrink-0
                        ${pos ? "bg-emerald-400" : "bg-rose-400"}
                      `}
                    />

                    {/* Asset + setup */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold text-white">{t.asset}</p>
                        <span
                          className={`
                            text-[9px] font-bold uppercase px-1.5 py-0.5 rounded
                            ${t.dir === "Buy"
                              ? "bg-emerald-400/10 text-emerald-400"
                              : "bg-rose-400/10 text-rose-400"}
                          `}
                        >
                          {t.dir}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        {t.setup} · {t.date}
                      </p>
                    </div>

                    {/* PnL + RR */}
                    <div className="text-right shrink-0">
                      <p className={`text-sm font-bold ${pos ? "text-emerald-400" : "text-rose-400"}`}>
                        {pos ? "+" : ""}${Math.abs(t.pnl).toFixed(2)}
                      </p>
                      <p className="text-[11px] text-slate-500 mt-0.5">1:{t.rr}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Best setup */}
          <div className="mt-4 pt-4 border-t border-slate-800">
            <div className="flex items-center justify-between">
              <p className="text-xs text-slate-500">Best setup</p>
              <div className="flex items-center gap-1.5 text-xs font-semibold text-cyan-400">
                {bestSetup ? (
                  <>
                    {bestSetup.name}
                    <span className="text-slate-600">·</span>
                    <span className="text-emerald-400">{bestSetup.winRate}% WR</span>
                  </>
                ) : (
                  <span className="text-slate-500">—</span>
                )}
              </div>
            </div>
          </div>
        </motion.div>
      </div>

    </motion.div>
  );
}