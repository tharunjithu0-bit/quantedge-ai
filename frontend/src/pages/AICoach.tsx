import { useState, useEffect, useMemo, useCallback } from "react";
import { motion } from "framer-motion";
import {
  Bot, TrendingUp, AlertTriangle, Lightbulb, Award, Activity, RefreshCw,
  ListChecks, Sparkles,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";

// ── Trade data ──────────────────────────────────────────────────────────────
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
  exit: number | null;
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

type ClosedTrade = ApiTrade & { pnl: number };
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "https://quantedge-ai-1bbs.onrender.com";
const TRADES_ENDPOINT = `${API_BASE_URL}/api/trades`;
const ANALYZE_ENDPOINT = `${API_BASE_URL}/api/ai/analyze`;

const SUPPORTED_ASSETS = ["EUR/USD", "XAU/USD", "BTC/USD", "AAPL"];

const PLACEHOLDER = "More trading history is needed to generate this insight.";

const GLOBAL_MIN = 3;          // decided-or-not trades needed before any insight fires at all
const SETUP_MIN = 2;           // decided trades in a setup before it's compared (existing threshold, kept as-is, with fallback)
const ASSET_MIN = 2;           // decided (closed) trades on an asset before it's compared (no fallback — stricter, new)
const DIRECTION_MIN = 3;       // decided trades on each side (buy/sell) before comparing them (new)
const DIRECTION_GAP_MIN = 10;  // min win-rate percentage-point gap between buy/sell to bother flagging (new)
const SETUP_GAP_MIN = 10;      // min win-rate percentage-point gap between best/worst setup for a comparison recommendation (new)
const STREAK_MIN = 3;          // consecutive same-result closed trades before a streak is worth mentioning (new)
const WEEKDAY_MIN_TOTAL = 5;   // trades needed before weekday-clustering is analyzed
const WEEKDAY_MIN_COUNT = 3;   // trades on a single weekday before it's flagged
const WEEKDAY_MIN_DECIDED = 2; // decided trades on a weekday before trusting its win rate

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

type SetupStat = { name: string; wins: number; losses: number; total: number; decided: number; winRate: number | null };
type AssetStat = { name: string; wins: number; losses: number; trades: number; pnl: number };
type DirectionStat = { direction: string; wins: number; losses: number; decided: number; pnl: number; winRate: number | null };
type Streak = { type: "win" | "loss"; count: number } | null;
type Pattern = { title: string; description: string; severity: "positive" | "warning"; occurrences: number };
type Recommendation = { title: string; detail: string };
// Explicit alias for findOvertradingDay's result — see the note on that
// function below for why this annotation matters for the build.
type OvertradingDay = { day: string; total: number; winRate: number } | null;

// Compact, JSON-serializable summary of everything computeInsights() already
// derived, sent to POST /api/ai/analyze so Gemini can interpret it. No raw
// trade rows and nothing Gemini would need to "calculate" itself.
type GeminiInput = {
  totalTrades: number;
  decidedTrades: number;
  overallWinRatePct: number | null;
  netPnl: number;
  avgWin: number | null;
  avgLoss: number | null;
  largestWin: number | null;
  largestLoss: number | null;
  bestSetup: { name: string; winRate: number | null; trades: number } | null;
  worstSetup: { name: string; winRate: number | null; trades: number } | null;
  bestAsset: { name: string; pnl: number; trades: number } | null;
  worstAsset: { name: string; pnl: number; trades: number } | null;
  mostUsedSetup: string | null;
  mostTradedAsset: string | null;
  directionComparison: { stronger: string; strongerWinRate: number; weaker: string; weakerWinRate: number; gap: number } | null;
  currentStreak: Streak;
  overtradingDay: { day: string; total: number; winRate: number } | null;
  patterns: { title: string; description: string; severity: "positive" | "warning" }[];
  recommendations: { title: string; detail: string }[];
  weeklyReview: { bestSetup: string; winRate: string; mistake: string; recommendation: string };
};

// Gemini's structured response — see backend/utils/gemini_coach.py RESPONSE_SCHEMA.
type GeminiAnalysis = {
  performance_summary: string;
  biggest_opportunity: string;
  biggest_risk: string;
  next_action: string;
};

const formatMoney = (n: number) => `${n >= 0 ? "+" : "-"}$${Math.abs(n).toFixed(2)}`;

// ── Aggregation helpers ───────────────────────────────────────────────────────

// Setup stats use ALL trades for the activity count ("across N trades"),
// but the win rate itself only counts decided (win/loss) trades — consistent
// with the app-wide Win Rate definition.
function getSetupStats(trades: ApiTrade[]): SetupStat[] {
  const map = new Map<string, { wins: number; losses: number; total: number }>();
  trades.forEach((t) => {
    const key = t.setup_type || "Unspecified";
    const entry = map.get(key) || { wins: 0, losses: 0, total: 0 };
    entry.total += 1;
    if (t.result === "win") entry.wins += 1;
    if (t.result === "loss") entry.losses += 1;
    map.set(key, entry);
  });
  return Array.from(map.entries()).map(([name, v]) => {
    const decided = v.wins + v.losses;
    return {
      name,
      wins: v.wins,
      losses: v.losses,
      total: v.total,
      decided,
      winRate: decided > 0 ? Math.round((v.wins / decided) * 100) : null,
    };
  });
}

// Existing behavior, kept as-is per the decision to preserve current thresholds:
// falls back to the full (unqualified) pool if nothing meets the minimum sample.
function pickExtremeSetup(stats: SetupStat[], direction: "best" | "worst", minSample = SETUP_MIN): SetupStat | null {
  const withRate = stats.filter((s) => s.winRate !== null);
  if (withRate.length === 0) return null;
  const qualified = withRate.filter((s) => s.decided >= minSample);
  const pool = qualified.length > 0 ? qualified : withRate;
  return pool.reduce((extreme, s) => {
    if (!extreme) return s;
    if (direction === "best") return s.winRate! > extreme.winRate! ? s : extreme;
    return s.winRate! < extreme.winRate! ? s : extreme;
  }, null as SetupStat | null);
}
function getAssetStats(closed: ClosedTrade[]): AssetStat[] {
  const map = new Map<string, { wins: number; losses: number; trades: number; pnl: number }>();
  closed.forEach((t) => {
    if (!SUPPORTED_ASSETS.includes(t.asset)) return;
    const entry = map.get(t.asset) || { wins: 0, losses: 0, trades: 0, pnl: 0 };
    entry.trades += 1;
    if (t.result === "win") entry.wins += 1;
    if (t.result === "loss") entry.losses += 1;
    entry.pnl += t.pnl;
    map.set(t.asset, entry);
  });
  return Array.from(map.entries()).map(([name, v]) => ({ name, ...v }));
}

// New metric — stricter than pickExtremeSetup on purpose: no fallback to an
// unqualified sample, so a single lucky/unlucky trade never gets called out
// as a "best" or "worst" asset by name.
function pickExtremeAsset(stats: AssetStat[], direction: "best" | "worst", minSample = ASSET_MIN): AssetStat | null {
  const qualified = stats.filter((s) => s.trades >= minSample);
  if (qualified.length === 0) return null;
  return qualified.reduce((extreme, s) => {
    if (!extreme) return s;
    if (direction === "best") return s.pnl > extreme.pnl ? s : extreme;
    return s.pnl < extreme.pnl ? s : extreme;
  }, null as AssetStat | null);
}

function getMostFrequent(values: string[]): { name: string; count: number } | null {
  if (values.length === 0) return null;
  const counts = new Map<string, number>();
  values.forEach((v) => counts.set(v, (counts.get(v) || 0) + 1));
  let best: { name: string; count: number } | null = null;
  counts.forEach((count, name) => {
    if (!best || count > best.count) best = { name, count };
  });
  return best;
}

function getDirectionStats(closed: ClosedTrade[]): DirectionStat[] {
  const map = new Map<string, { wins: number; losses: number; pnl: number }>();
  closed.forEach((t) => {
    const entry = map.get(t.direction) || { wins: 0, losses: 0, pnl: 0 };
    if (t.result === "win") entry.wins += 1;
    if (t.result === "loss") entry.losses += 1;
    entry.pnl += t.pnl;
    map.set(t.direction, entry);
  });
  return Array.from(map.entries()).map(([direction, v]) => {
    const decided = v.wins + v.losses;
    return { direction, wins: v.wins, losses: v.losses, decided, pnl: v.pnl, winRate: decided > 0 ? Math.round((v.wins / decided) * 100) : null };
  });
}

function compareDirections(
  stats: DirectionStat[],
  minSample = DIRECTION_MIN,
  minGap = DIRECTION_GAP_MIN
): { stronger: DirectionStat; weaker: DirectionStat; gap: number } | null {
  const buy = stats.find((s) => s.direction === "buy");
  const sell = stats.find((s) => s.direction === "sell");
  if (!buy || !sell) return null;
  if (buy.decided < minSample || sell.decided < minSample) return null;
  if (buy.winRate === null || sell.winRate === null) return null;

  const gap = Math.abs(buy.winRate - sell.winRate);
  if (gap < minGap) return null;

  const [stronger, weaker] = buy.winRate > sell.winRate ? [buy, sell] : [sell, buy];
  return { stronger, weaker, gap };
}

function getCurrentStreak(closed: ClosedTrade[]): Streak {
  if (closed.length === 0) return null;

  const sorted = [...closed].sort((a, b) => {
    if (a.trade_date !== b.trade_date) return a.trade_date < b.trade_date ? 1 : -1;
    return b.id - a.id;
  });

  let type: "win" | "loss" | null = null;
  let count = 0;
  for (const t of sorted) {
    if (t.result !== "win" && t.result !== "loss") break; // breakeven ends the streak
    if (type === null) {
      type = t.result;
      count = 1;
      continue;
    }
    if (t.result === type) {
      count += 1;
    } else {
      break;
    }
  }
  if (type === null) return null;
  return { type, count };
}

function findOvertradingDay(trades: ApiTrade[], overallWinRatePct: number | null): OvertradingDay {
  if (overallWinRatePct === null) return null;
  if (trades.length < WEEKDAY_MIN_TOTAL) return null;

  const byDay = new Map<string, { total: number; wins: number; losses: number }>();
  trades.forEach((t) => {
    const d = new Date(`${t.trade_date}T00:00:00`);
    if (isNaN(d.getTime())) return;
    const dayName = WEEKDAY_NAMES[d.getDay()];
    const entry = byDay.get(dayName) || { total: 0, wins: 0, losses: 0 };
    entry.total += 1;
    if (t.result === "win") entry.wins += 1;
    if (t.result === "loss") entry.losses += 1;
    byDay.set(dayName, entry);
  });

  const daysUsed = byDay.size;
  if (daysUsed === 0) return null;
  const average = trades.length / daysUsed;

  let flagged: { day: string; total: number; winRate: number } | null = null;
  byDay.forEach((v, day) => {
    const decided = v.wins + v.losses;
    if (decided < WEEKDAY_MIN_DECIDED) return;
    const dayWinRate = Math.round((v.wins / decided) * 100);
    const isOverloaded = v.total >= WEEKDAY_MIN_COUNT && v.total > average * 1.5;
    const isWeaker = dayWinRate < overallWinRatePct;
    if (isOverloaded && isWeaker) {
      if (!flagged || v.total > flagged.total) {
        flagged = { day, total: v.total, winRate: dayWinRate };
      }
    }
  });

  return flagged;
}

function computeInsights(trades: ApiTrade[]) {
  const emptyScaffold = () => ({
    weeklyReview: {
      bestSetup: PLACEHOLDER,
      winRate: PLACEHOLDER,
      mistake: PLACEHOLDER,
      recommendation: PLACEHOLDER,
    },
    patterns: [
      { title: "Strongest Setup", description: PLACEHOLDER, severity: "positive" as const, occurrences: 0 },
      { title: "Setup Weakness", description: PLACEHOLDER, severity: "warning" as const, occurrences: 0 },
      { title: "Trade Frequency Pattern", description: PLACEHOLDER, severity: "warning" as const, occurrences: 0 },
    ],
    recommendations: [
      { title: "More Data Needed", detail: PLACEHOLDER },
      { title: "More Data Needed", detail: PLACEHOLDER },
      { title: "More Data Needed", detail: PLACEHOLDER },
    ] as Recommendation[],
    geminiInput: null as GeminiInput | null,
  });

  const total = trades.length;
  if (total < GLOBAL_MIN) return emptyScaffold();

  const closed = trades.filter((t): t is ClosedTrade => t.pnl != null);
  const wins = closed.filter((t) => t.result === "win");
  const losses = closed.filter((t) => t.result === "loss");
  const decided = wins.length + losses.length;
  const overallWinRatePct = decided > 0 ? Math.round((wins.length / decided) * 100) : null;

  const netPnl = closed.reduce((s, t) => s + t.pnl, 0);
  const avgWin = wins.length > 0 ? wins.reduce((s, t) => s + t.pnl, 0) / wins.length : null;
  const avgLoss = losses.length > 0 ? Math.abs(losses.reduce((s, t) => s + t.pnl, 0)) / losses.length : null;
  const largestWin = wins.length > 0 ? Math.max(...wins.map((t) => t.pnl)) : null;
  const largestLoss = losses.length > 0 ? Math.min(...losses.map((t) => t.pnl)) : null;

  const setupStats = getSetupStats(trades);
  const bestSetup = pickExtremeSetup(setupStats, "best");
  const worstSetup = pickExtremeSetup(setupStats, "worst");
  const mostUsedSetup = getMostFrequent(trades.map((t) => t.setup_type || "Unspecified"));

  const assetStats = getAssetStats(closed);
  const bestAsset = pickExtremeAsset(assetStats, "best");
  const worstAsset = pickExtremeAsset(assetStats, "worst");
  const mostTradedAsset = getMostFrequent(trades.filter((t) => SUPPORTED_ASSETS.includes(t.asset)).map((t) => t.asset));

  // Buy vs Sell
  const directionStats = getDirectionStats(closed);
  const directionComparison = compareDirections(directionStats);

  // Streak
  const streak = getCurrentStreak(closed);

  // Weekday clustering
  const overtradingDay = findOvertradingDay(trades, overallWinRatePct);

  const patternCandidates: (Pattern | null)[] = [
    worstSetup
      ? {
          title: `${worstSetup.name} Is Underperforming`,
          description: `${worstSetup.name} trades are winning only ${worstSetup.winRate}% of decided trades across ${worstSetup.total} trade${worstSetup.total !== 1 ? "s" : ""} — well below your overall ${overallWinRatePct}% average.`,
          severity: "warning",
          occurrences: worstSetup.total,
        }
      : null,
    bestSetup
      ? {
          title: `${bestSetup.name} Is Your Strongest Edge`,
          description: `${bestSetup.name} trades win ${bestSetup.winRate}% of decided trades across ${bestSetup.total} trade${bestSetup.total !== 1 ? "s" : ""} — your most reliable setup right now.`,
          severity: "positive",
          occurrences: bestSetup.total,
        }
      : null,
    directionComparison
      ? {
          title: `${directionComparison.stronger.direction === "buy" ? "Buy" : "Sell"} Trades Outperform ${directionComparison.weaker.direction === "buy" ? "Buy" : "Sell"} Trades`,
          description: `Your ${directionComparison.stronger.direction === "buy" ? "buy" : "sell"} trades win ${directionComparison.stronger.winRate}% of the time versus ${directionComparison.weaker.winRate}% for ${directionComparison.weaker.direction === "buy" ? "buy" : "sell"} trades — a ${directionComparison.gap}-point gap.`,
          severity: "warning",
          occurrences: directionComparison.stronger.decided + directionComparison.weaker.decided,
        }
      : null,
    avgWin !== null && avgLoss !== null && avgLoss > avgWin * 1.1
      ? {
          title: "Losses Outsize Wins",
          description: `Your average losing trade (${formatMoney(-avgLoss)}) is larger than your average winning trade (${formatMoney(avgWin)}). Largest win was ${formatMoney(largestWin!)}, largest loss was ${formatMoney(largestLoss!)}.`,
          severity: "warning",
          occurrences: wins.length + losses.length,
        }
      : null,
    worstAsset && worstAsset.pnl < 0
      ? {
          title: `${worstAsset.name} Is Dragging on Results`,
          description: `${worstAsset.name} has a net P&L of ${formatMoney(worstAsset.pnl)} across ${worstAsset.trades} closed trade${worstAsset.trades !== 1 ? "s" : ""} — your weakest performer among supported assets.`,
          severity: "warning",
          occurrences: worstAsset.trades,
        }
      : null,
    streak && streak.type === "loss" && streak.count >= STREAK_MIN
      ? {
          title: `${streak.count}-Trade Losing Streak`,
          description: `Your last ${streak.count} closed trades have all been losses. Consider a smaller size or a pause until the pattern breaks.`,
          severity: "warning",
          occurrences: streak.count,
        }
      : null,
    streak && streak.type === "win" && streak.count >= STREAK_MIN
      ? {
          title: `${streak.count}-Trade Winning Streak`,
          description: `Your last ${streak.count} closed trades have all been wins. Keep following the process that's working rather than deviating from it.`,
          severity: "positive",
          occurrences: streak.count,
        }
      : null,
    overtradingDay
      ? {
          title: `Overtrading on ${overtradingDay.day}s`,
          description: `Trade frequency spikes on ${overtradingDay.day}s (${overtradingDay.total} trades, ${Math.round((overtradingDay.total / total) * 100)}% of all activity) with a lower win rate than the rest of the week.`,
          severity: "warning",
          occurrences: overtradingDay.total,
        }
      : null,
    total >= WEEKDAY_MIN_TOTAL
      ? {
          title: "Consistent Trading Cadence",
          description: `Your trade frequency is spread evenly across the week.${mostUsedSetup ? ` ${mostUsedSetup.name} is your most-used setup` : ""}${mostTradedAsset ? ` and ${mostTradedAsset.name} your most-traded asset` : ""} this period.`,
          severity: "positive",
          occurrences: total,
        }
      : null,
  ];

  const placeholderPatterns: Pattern[] = [
    { title: "Strongest Setup", description: PLACEHOLDER, severity: "positive", occurrences: 0 },
    { title: "Setup Weakness", description: PLACEHOLDER, severity: "warning", occurrences: 0 },
    { title: "Trade Frequency Pattern", description: PLACEHOLDER, severity: "warning", occurrences: 0 },
  ];

  const patterns: Pattern[] = patternCandidates.filter((p): p is Pattern => p !== null).slice(0, 3);
  while (patterns.length < 3) {
    patterns.push(placeholderPatterns[patterns.length]);
  }

  const recCandidates: (Recommendation | null)[] = [
    bestAsset
      ? {
          title: `Your Best-Performing Asset Is ${bestAsset.name}`,
          detail: `${bestAsset.name} is your top performer, netting ${formatMoney(bestAsset.pnl)} across ${bestAsset.trades} closed trade${bestAsset.trades !== 1 ? "s" : ""}. Consider whether you can allocate more attention to it.`,
        }
      : null,
    bestSetup && worstSetup && bestSetup.name !== worstSetup.name && bestSetup.winRate !== null && worstSetup.winRate !== null && bestSetup.winRate - worstSetup.winRate >= SETUP_GAP_MIN
      ? {
          title: `${bestSetup.name} Setups Outperform ${worstSetup.name}`,
          detail: `${bestSetup.name} wins ${bestSetup.winRate}% vs ${worstSetup.winRate}% for ${worstSetup.name} — focus more on your strongest setups.`,
        }
      : null,
    directionComparison
      ? {
          title: `Favor ${directionComparison.stronger.direction === "buy" ? "Buy" : "Sell"} Setups`,
          detail: `Your ${directionComparison.stronger.direction === "buy" ? "buy" : "sell"} trades win ${directionComparison.stronger.winRate}% of the time versus ${directionComparison.weaker.winRate}% on the ${directionComparison.weaker.direction === "buy" ? "buy" : "sell"} side. Leaning toward your stronger side could improve consistency.`,
        }
      : null,
    streak && streak.type === "loss" && streak.count >= STREAK_MIN
      ? {
          title: "Pause and Reset After This Streak",
          detail: `You're on a ${streak.count}-trade losing streak. Consider reducing position size or stepping back until you identify what's changed.`,
        }
      : null,
    bestSetup
      ? {
          title: `Size Up on ${bestSetup.name}`,
          detail: `${bestSetup.name} is your highest win-rate setup at ${bestSetup.winRate}% — make sure your position sizing reflects that edge.`,
        }
      : null,
  ];

  const recommendations: Recommendation[] = recCandidates.filter((r): r is Recommendation => r !== null).slice(0, 3);
  while (recommendations.length < 3) {
    recommendations.push({ title: "More Data Needed", detail: PLACEHOLDER });
  }

  // ── Weekly Performance Review ──
  const weeklyReview = {
    bestSetup: bestSetup ? bestSetup.name : PLACEHOLDER,
    winRate: overallWinRatePct !== null ? `${overallWinRatePct}%` : PLACEHOLDER,
    mistake: worstSetup ? `${worstSetup.name} entries` : worstAsset ? `Trading ${worstAsset.name}` : PLACEHOLDER,
    recommendation: recommendations[0]?.detail ?? PLACEHOLDER,
  };

  // ── Gemini input — a compact snapshot of everything computed above. ──
  // Reuses the same variables the three sections above already derived;
  // nothing here is recalculated differently for Gemini's benefit.
  const geminiInput: GeminiInput = {
    totalTrades: total,
    decidedTrades: decided,
    overallWinRatePct,
    netPnl: Math.round(netPnl * 100) / 100,
    avgWin: avgWin !== null ? Math.round(avgWin * 100) / 100 : null,
    avgLoss: avgLoss !== null ? Math.round(avgLoss * 100) / 100 : null,
    largestWin,
    largestLoss,
    bestSetup: bestSetup ? { name: bestSetup.name, winRate: bestSetup.winRate, trades: bestSetup.total } : null,
    worstSetup: worstSetup ? { name: worstSetup.name, winRate: worstSetup.winRate, trades: worstSetup.total } : null,
    bestAsset: bestAsset ? { name: bestAsset.name, pnl: bestAsset.pnl, trades: bestAsset.trades } : null,
    worstAsset: worstAsset ? { name: worstAsset.name, pnl: worstAsset.pnl, trades: worstAsset.trades } : null,
    mostUsedSetup: mostUsedSetup ? mostUsedSetup.name : null,
    mostTradedAsset: mostTradedAsset ? mostTradedAsset.name : null,
    directionComparison: directionComparison
      ? {
          stronger: directionComparison.stronger.direction,
          strongerWinRate: directionComparison.stronger.winRate as number,
          weaker: directionComparison.weaker.direction,
          weakerWinRate: directionComparison.weaker.winRate as number,
          gap: directionComparison.gap,
        }
      : null,
    currentStreak: streak,
    overtradingDay,
    patterns: patterns.map((p) => ({ title: p.title, description: p.description, severity: p.severity })),
    recommendations: recommendations.map((r) => ({ title: r.title, detail: r.detail })),
    weeklyReview,
  };

  return { weeklyReview, patterns, recommendations, geminiInput };
}

// ── Shared card style ─────────────────────────────────────────────────────────

const card = `
  bg-slate-900/70 backdrop-blur-xl
  rounded-2xl border border-slate-800/60
  p-4 md:p-5
  transition-colors duration-200
`;

function SectionHeader({
  icon: Icon, title,
}: { icon: React.ElementType; title: string }) {
  return (
    <div className="flex items-center gap-2.5 mb-4">
      <div className="w-8 h-8 rounded-lg bg-slate-800 border border-slate-700/60 flex items-center justify-center shrink-0">
        <Icon size={14} className="text-slate-400" />
      </div>
      <h2 className="text-sm font-semibold text-white">{title}</h2>
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

type FetchStatus = "loading" | "error" | "success";
type GeminiFetchStatus = "idle" | "loading" | "error" | "success";

function AICoach() {
  const { token } = useAuth();

  const [trades, setTrades] = useState<ApiTrade[]>([]);
  const [status, setStatus] = useState<FetchStatus>("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Gemini Trading Coach — separate loading/error state from the trades
  // fetch above, since it's a distinct request that can fail independently
  // without affecting the (already working) sections above it.
  const [geminiStatus, setGeminiStatus] = useState<GeminiFetchStatus>("idle");
  const [geminiData, setGeminiData] = useState<GeminiAnalysis | null>(null);
  const [geminiErrorMessage, setGeminiErrorMessage] = useState<string | null>(null);

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

  const { weeklyReview, patterns, recommendations, geminiInput } = useMemo(() => computeInsights(trades), [trades]);

  const fetchGeminiAnalysis = useCallback(async (insights: GeminiInput) => {
    setGeminiStatus("loading");
    setGeminiErrorMessage(null);
    try {
      const res = await fetch(ANALYZE_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ insights }),
      });

      const body = await res.json();

      if (!res.ok || body.status === "error") {
        const msg = body.status === "error" ? body.message : `Server responded with ${res.status}`;
        throw new Error(msg);
      }

      setGeminiData(body.data as GeminiAnalysis);
      setGeminiStatus("success");
    } catch (err) {
      console.error("Failed to fetch Gemini analysis:", err);
      setGeminiErrorMessage(err instanceof Error ? err.message : "Failed to generate the Gemini analysis.");
      setGeminiStatus("error");
    }
  }, [token]);

  useEffect(() => {
    if (status === "success" && geminiInput && geminiStatus === "idle") {
      fetchGeminiAnalysis(geminiInput);
    }
  }, [status, geminiInput, geminiStatus, fetchGeminiAnalysis]);

  const isLoading = status === "loading";
  const isError = status === "error";

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.25 }}
      className="space-y-5"
    >

      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white tracking-tight">AI Coach</h1>
        <p className="text-sm text-slate-500 mt-1">
          Pattern recognition and recommendations from your trade history.
        </p>
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

      {/* ── Weekly Performance Review ── */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className={card}
      >
        <SectionHeader icon={Award} title="Weekly Performance Review" />

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {isLoading
            ? [0, 1, 2, 3].map((i) => (
                <div key={i} className="p-4 rounded-xl bg-slate-800/50 border border-slate-700/40">
                  <div className="h-3 w-20 rounded bg-slate-700/50 animate-pulse mb-3" />
                  <div className="h-4 w-28 rounded bg-slate-700/50 animate-pulse" />
                </div>
              ))
            : [
                { label: "Best Setup",          value: weeklyReview.bestSetup,      color: "text-blue-400" },
                { label: "Win Rate",            value: weeklyReview.winRate,        color: "text-emerald-400" },
                { label: "Most Common Mistake", value: weeklyReview.mistake,        color: "text-rose-400" },
                { label: "Recommendation",      value: weeklyReview.recommendation, color: "text-slate-200" },
              ].map((item) => (
                <div
                  key={item.label}
                  className="p-4 rounded-xl bg-slate-800/50 border border-slate-700/40"
                >
                  <p className="text-xs text-slate-500 mb-2">{item.label}</p>
                  <p className={`text-sm font-semibold leading-snug ${item.color}`}>{item.value}</p>
                </div>
              ))}
        </div>
      </motion.div>

      {/* ── Trade Pattern Analysis ── */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, delay: 0.08 }}
        className={card}
      >
        <SectionHeader icon={Activity} title="Trade Pattern Analysis" />

        <div className="space-y-3">
          {isLoading
            ? [0, 1, 2].map((i) => (
                <div key={i} className="h-20 rounded-xl bg-slate-800/40 border border-slate-700/40 animate-pulse" />
              ))
            : patterns.map((p) => {
                const positive = p.severity === "positive";
                return (
                  <div
                    key={p.title}
                    className="flex items-start gap-3 p-4 rounded-xl bg-slate-800/40 border border-slate-700/40"
                  >
                    <div className={`
                      w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5
                      ${positive
                        ? "bg-emerald-500/10 text-emerald-400"
                        : "bg-amber-500/10 text-amber-400"}
                    `}>
                      {positive
                        ? <TrendingUp size={14} />
                        : <AlertTriangle size={14} />}
                    </div>

                    <div className="flex-1">
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <p className="text-sm font-semibold text-white">{p.title}</p>
                        {p.occurrences > 0 && (
                          <span className="text-xs text-slate-600 shrink-0">{p.occurrences}×</span>
                        )}
                      </div>
                      <p className="text-sm text-slate-400 leading-relaxed">{p.description}</p>
                    </div>
                  </div>
                );
              })}
        </div>
      </motion.div>

      {/* ── Recommendations ── */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, delay: 0.16 }}
        className={card}
      >
        <SectionHeader icon={Lightbulb} title="Recommendations" />

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {isLoading
            ? [0, 1, 2].map((i) => (
                <div key={i} className="h-28 rounded-xl bg-slate-800/40 border border-slate-700/40 animate-pulse" />
              ))
            : recommendations.map((r, i) => (
                <motion.div
                  key={`${r.title}-${i}`}
                  whileHover={{ y: -2 }}
                  transition={{ duration: 0.15 }}
                  className="p-4 rounded-xl bg-slate-800/40 border border-slate-700/40 hover:border-slate-600/60 transition-colors cursor-pointer"
                >
                  <div className="w-7 h-7 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-xs font-bold text-blue-400 mb-3">
                    {i + 1}
                  </div>
                  <p className="text-sm font-semibold text-white mb-1.5">{r.title}</p>
                  <p className="text-sm text-slate-400 leading-relaxed">{r.detail}</p>
                </motion.div>
              ))}
        </div>
      </motion.div>

      {/* ── Gemini Trading Coach ── */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, delay: 0.24 }}
        className={card}
      >
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-slate-800 border border-slate-700/60 flex items-center justify-center shrink-0">
              <Bot size={14} className="text-slate-400" />
            </div>
            <h2 className="text-sm font-semibold text-white">🤖 Gemini Trading Coach</h2>
          </div>
          {geminiStatus === "success" && (
            <span className="flex items-center gap-1.5 text-[10px] text-slate-500 uppercase tracking-widest">
              <Sparkles size={11} className="text-cyan-400" />
              AI-generated
            </span>
          )}
        </div>

        {/* Not enough data yet — same threshold the other sections use */}
        {!isLoading && !geminiInput && (
          <p className="text-sm text-slate-500">{PLACEHOLDER}</p>
        )}

        {/* Waiting on the trades fetch itself */}
        {isLoading && (
          <div className="space-y-3">
            <div className="h-16 rounded-xl bg-slate-800/40 border border-slate-700/40 animate-pulse" />
            <div className="h-24 rounded-xl bg-slate-800/40 border border-slate-700/40 animate-pulse" />
          </div>
        )}

        {/* Trades loaded, Gemini analysis in flight */}
        {!isLoading && geminiInput && geminiStatus === "loading" && (
          <div className="space-y-3">
            <div className="h-14 rounded-xl bg-slate-800/40 border border-slate-700/40 animate-pulse" />
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="h-20 rounded-xl bg-slate-800/40 border border-slate-700/40 animate-pulse" />
              <div className="h-20 rounded-xl bg-slate-800/40 border border-slate-700/40 animate-pulse" />
              <div className="h-20 rounded-xl bg-slate-800/40 border border-slate-700/40 animate-pulse" />
            </div>
          </div>
        )}

        {/* Gemini call failed */}
        {!isLoading && geminiInput && geminiStatus === "error" && (
          <div className="flex items-center justify-between gap-4 p-4 rounded-xl bg-slate-800/40 border border-slate-700/40">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-red-500/10 border border-red-500/20 flex items-center justify-center shrink-0">
                <AlertTriangle size={14} className="text-red-400" />
              </div>
              <div>
                <p className="text-sm font-semibold text-white">Couldn't generate the Gemini analysis</p>
                <p className="text-xs text-slate-500 mt-0.5">{geminiErrorMessage || "Something went wrong talking to the server."}</p>
              </div>
            </div>
            <button
              onClick={() => fetchGeminiAnalysis(geminiInput)}
              className="flex items-center gap-2 text-xs font-medium text-slate-300 bg-slate-800 hover:bg-slate-700 border border-slate-700/60 rounded-lg px-3 py-2 transition-colors shrink-0"
            >
              <RefreshCw size={12} />
              Retry
            </button>
          </div>
        )}

        {/* Success */}
        {!isLoading && geminiInput && geminiStatus === "success" && geminiData && (
          <div className="space-y-3">

            {/* Performance Summary */}
            <div className="p-4 rounded-xl bg-slate-800/60 border border-slate-700/60">
              <div className="flex items-center gap-2 mb-2">
                <Activity size={14} className="text-slate-400" />
                <p className="text-xs text-slate-500 uppercase tracking-widest">Performance Summary</p>
              </div>
              <p className="text-sm text-slate-200 leading-relaxed">{geminiData.performance_summary}</p>
            </div>

            {/* Biggest Opportunity + Biggest Risk */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="p-4 rounded-xl bg-slate-800/40 border border-slate-700/40">
                <div className="flex items-center gap-2 mb-2">
                  <TrendingUp size={14} className="text-emerald-400" />
                  <p className="text-sm font-semibold text-white">Biggest Opportunity</p>
                </div>
                <p className="text-sm text-slate-400 leading-relaxed">{geminiData.biggest_opportunity}</p>
              </div>

              <div className="p-4 rounded-xl bg-slate-800/40 border border-slate-700/40">
                <div className="flex items-center gap-2 mb-2">
                  <AlertTriangle size={14} className="text-amber-400" />
                  <p className="text-sm font-semibold text-white">Biggest Risk</p>
                </div>
                <p className="text-sm text-slate-400 leading-relaxed">{geminiData.biggest_risk}</p>
              </div>
            </div>

            {/* Next Action */}
            <div className="p-4 rounded-xl bg-slate-800/40 border border-slate-700/40">
              <div className="flex items-center gap-2 mb-2">
                <ListChecks size={14} className="text-blue-400" />
                <p className="text-sm font-semibold text-white">Next Action</p>
              </div>
              <p className="text-sm text-slate-400 leading-relaxed">{geminiData.next_action}</p>
            </div>
          </div>
        )}
      </motion.div>

    </motion.div>
  );
}

export default AICoach;