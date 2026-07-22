import { useState, useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { Pencil, Trash2, Upload, AlertTriangle } from "lucide-react";
import axios from "axios";
import { useAuth } from "../context/AuthContext";

type Trade = {
  id?: number;
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

type ImportError = { row: number; reason: string };
type ImportSummary = { imported: number; failed: number; errors: ImportError[] };
type DeleteAllMessage = { type: "success" | "error"; text: string };

const API_BASE_URL = "https://quantedge-ai-1bbs.onrender.com";

const capitalize = (value: string) =>
  value ? value.charAt(0).toUpperCase() + value.slice(1) : "";

const mapApiTradeToTrade = (item: any): Trade => ({
  id: item.id,
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

export default function TradeJournal() {
  const { token } = useAuth();

  const [asset, setAsset] = useState("");
  const [direction, setDirection] = useState("");
  const [entry, setEntry] = useState("");
  const [exit, setExit] = useState("");
  const [stopLoss, setStopLoss] = useState("");
  const [takeProfit, setTakeProfit] = useState("");
  const [lotSize, setLotSize] = useState("");
  const [setupType, setSetupType] = useState("");
  const [tradeDate, setTradeDate] = useState("");
  const [notes, setNotes] = useState("");

  const [trades, setTrades] = useState<Trade[]>([]);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);

  const [isImporting, setIsImporting] = useState(false);
  const [importSummary, setImportSummary] = useState<ImportSummary | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [isDeletingAll, setIsDeletingAll] = useState(false);
  const [deleteAllMessage, setDeleteAllMessage] = useState<DeleteAllMessage | null>(null);

  // Single source of truth for loading trades from the backend. Used on
  // mount and after every create/update/delete/import so there's only
  // one place that knows how to fetch + map trades from the API.
  const fetchTrades = async () => {
    try {
      const response = await axios.get(`${API_BASE_URL}/api/trades`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const apiTrades = Array.isArray(response.data?.data) ? response.data.data : [];
      setTrades(apiTrades.map(mapApiTradeToTrade));
    } catch (err) {
      console.error("Failed to load trades from API:", err);
    }
  };

  // Load trades from the backend on mount (and whenever the token changes,
  // e.g. after login).
  useEffect(() => {
    if (!token) return;
    fetchTrades();
  }, [token]);

  const handleSaveTrade = async () => {
    if (
      !asset ||
      !direction ||
      !entry ||
      !exit ||
      !stopLoss ||
      !takeProfit ||
      !lotSize ||
      !setupType ||
      !tradeDate
    ) {
      alert("Please fill all required fields");
      return;
    }

    const payload = {
      asset: asset,
      direction: direction.toLowerCase(),
      entry: Number(entry),
      exit: Number(exit),
      stop_loss: Number(stopLoss),
      take_profit: Number(takeProfit),
      lot_size: Number(lotSize),
      setup_type: setupType,
      trade_date: tradeDate,
      notes: notes,
    };

    const authHeaders = { headers: { Authorization: `Bearer ${token}` } };

    if (editingIndex !== null) {
      const tradeId = trades[editingIndex]?.id;
      if (tradeId === undefined) {
        alert("Could not determine which trade to update. Please try again.");
        return;
      }

      try {
        await axios.put(`${API_BASE_URL}/api/trades/${tradeId}`, payload, authHeaders);
        await fetchTrades();
        setEditingIndex(null);
      } catch (err) {
        console.error("Failed to update trade:", err);
        alert("Failed to update trade. Please try again.");
        return;
      }
    } else {
      try {
        await axios.post(`${API_BASE_URL}/api/trades`, payload, authHeaders);
        await fetchTrades();
      } catch (err) {
        console.error("Failed to save trade:", err);
        alert("Failed to save trade. Please try again.");
        return;
      }
    }

    setAsset("");
    setDirection("");
    setEntry("");
    setExit("");
    setStopLoss("");
    setTakeProfit("");
    setLotSize("");
    setSetupType("");
    setTradeDate("");
    setNotes("");
  };

  const winRate =
    trades.length > 0
      ? Math.round((trades.filter((t) => t.result === "Win").length / trades.length) * 100)
      : 0;

  const handleEditTrade = (index: number) => {
    const t = trades[index];
    setAsset(t.asset);
    setDirection(t.direction);
    setEntry(t.entry);
    setExit(t.exit);
    setStopLoss(t.stopLoss);
    setTakeProfit(t.takeProfit);
    setLotSize(t.lotSize);
    setSetupType(t.setupType);
    setTradeDate(t.tradeDate);
    setNotes(t.notes);
    setEditingIndex(index);
  };

  const handleDeleteTrade = async (index: number) => {
    const tradeId = trades[index]?.id;
    if (tradeId === undefined) return;

    const confirmed = window.confirm("Are you sure you want to delete this trade?");
    if (!confirmed) return;

    try {
      await axios.delete(`${API_BASE_URL}/api/trades/${tradeId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      await fetchTrades();
      if (editingIndex === index) setEditingIndex(null);
    } catch (err) {
      console.error("Failed to delete trade:", err);
      alert("Failed to delete trade. Please try again.");
    }
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsImporting(true);
    setImportSummary(null);

    const formData = new FormData();
    formData.append("file", file);

    try {
      // IMPORTANT: do NOT set "Content-Type" manually here. When the
      // body is a FormData instance, axios (via the browser) needs to
      // generate its own "multipart/form-data; boundary=----..." header,
      // because every multipart request needs a unique boundary string
      // that matches what's actually written into the body. Setting
      // "Content-Type": "multipart/form-data" by hand overrides that
      // and ships a header with NO boundary, which the backend can't
      // parse — Flask's request.files comes back empty and the route
      // returns 400 "No file provided" every time. Only the auth
      // header needs to be set explicitly; the content type is left
      // for axios/the browser to fill in.
      const response = await axios.post(`${API_BASE_URL}/api/trades/import`, formData, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      setImportSummary({
        imported: response.data?.imported ?? 0,
        failed: response.data?.failed ?? 0,
        errors: Array.isArray(response.data?.errors) ? response.data.errors : [],
      });

      await fetchTrades();
    } catch (err) {
      console.error("Failed to import trades:", err);
      alert("Failed to import trades. Please try again.");
    } finally {
      setIsImporting(false);
      // Reset so selecting the same file again still fires onChange.
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleDeleteAllTrades = async () => {
    const confirmed = window.confirm(
      "Are you sure you want to delete all trades? This action cannot be undone."
    );
    if (!confirmed) return;

    setIsDeletingAll(true);
    setDeleteAllMessage(null);
    setImportSummary(null);

    try {
      const response = await axios.delete(`${API_BASE_URL}/api/trades/all`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const deletedCount = response.data?.deleted ?? 0;

      // Refreshing trades also refreshes the dashboard stats (trade
      // count, win rate) since they're derived directly from `trades`.
      await fetchTrades();
      setEditingIndex(null);

      setDeleteAllMessage({
        type: "success",
        text: `Successfully deleted ${deletedCount} trade${deletedCount === 1 ? "" : "s"}.`,
      });
    } catch (err) {
      console.error("Failed to delete all trades:", err);
      setDeleteAllMessage({
        type: "error",
        text: "Failed to delete all trades. Please try again.",
      });
    } finally {
      setIsDeletingAll(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.4 }}
    >
      {/* Header */}
      <div className="mb-6 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <h1 className="text-4xl sm:text-5xl font-bold">Trade Journal</h1>
          <p className="text-slate-400 mt-1.5">
            Track, review and improve your trading performance.
          </p>
        </div>

        <div className="shrink-0 flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            className="hidden"
            onChange={handleFileChange}
          />
          <button
            onClick={handleImportClick}
            disabled={isImporting || isDeletingAll}
            className="
              flex items-center justify-center gap-2
              px-4 py-2.5
              rounded-xl
              font-semibold
              bg-slate-800
              border border-slate-700
              hover:bg-slate-700
              disabled:opacity-60
              disabled:cursor-not-allowed
              transition-colors
              w-full sm:w-auto
            "
          >
            <Upload size={16} />
            {isImporting ? "Importing..." : "Import CSV"}
          </button>

          <button
            onClick={handleDeleteAllTrades}
            disabled={isImporting || isDeletingAll || trades.length === 0}
            className="
              flex items-center justify-center gap-2
              px-4 py-2.5
              rounded-xl
              font-semibold
              bg-red-500/10
              text-red-400
              border border-red-500/30
              hover:bg-red-500/20
              hover:border-red-500/50
              disabled:opacity-60
              disabled:cursor-not-allowed
              transition-colors
              w-full sm:w-auto
            "
          >
            <Trash2 size={16} />
            {isDeletingAll ? "Deleting..." : "Delete All Trades"}
          </button>
        </div>
      </div>

      {/* Delete all feedback */}
      {deleteAllMessage && (
        <div
          className={`mb-6 flex items-center gap-2 p-4 rounded-2xl border-2 ${
            deleteAllMessage.type === "success"
              ? "bg-green-500/10 border-green-500/30 text-green-400"
              : "bg-red-500/10 border-red-500/30 text-red-400"
          }`}
        >
          {deleteAllMessage.type === "error" && <AlertTriangle size={16} className="shrink-0" />}
          <p className="font-semibold">{deleteAllMessage.text}</p>
        </div>
      )}

      {/* Import summary */}
      {importSummary && (
        <div className="mb-6 bg-slate-900/80 backdrop-blur-xl p-4 rounded-2xl border-2 border-slate-800">
          <p className="font-semibold">
            Import complete:{" "}
            <span className="text-green-400">{importSummary.imported} imported</span>
            {importSummary.failed > 0 && (
              <>
                {", "}
                <span className="text-red-400">{importSummary.failed} failed</span>
              </>
            )}
          </p>
          {importSummary.errors.length > 0 && (
            <ul className="mt-2 space-y-1 text-sm text-slate-400 max-h-32 overflow-y-auto">
              {importSummary.errors.map((e, i) => (
                <li key={i}>
                  Row {e.row}: {e.reason}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Main Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

        {/* Left Form */}
        <motion.div
          whileHover={{ y: -4, scale: 1.01 }}
          className="
            bg-slate-900/80
            backdrop-blur-xl
            p-5
            rounded-3xl
            border-2 border-slate-800
          "
        >
          <h2 className="text-2xl font-bold mb-5">
            {editingIndex !== null ? "Edit Trade" : "New Trade"}
          </h2>

          <div className="space-y-3.5">

            <div>
              <label className="block mb-2 text-slate-300">Asset</label>
              <select
                value={asset}
                onChange={(e) => setAsset(e.target.value)}
                className="w-full p-3 rounded-xl bg-slate-800 border border-slate-700"
              >
                <option value="">Select Asset</option>
                <option value="EUR/USD">EUR/USD</option>
                <option value="XAU/USD">Gold (XAU/USD)</option>
                <option value="BTC/USD">Bitcoin (BTC/USD)</option>
                <option value="AAPL">Apple (AAPL)</option>
              </select>
            </div>

            <div>
              <label className="block mb-2 text-slate-300">Direction</label>
              <select
                value={direction}
                onChange={(e) => setDirection(e.target.value)}
                className="w-full p-3 rounded-xl bg-slate-800 border border-slate-700"
              >
                <option value="">Select</option>
                <option>Buy</option>
                <option>Sell</option>
              </select>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block mb-2 text-slate-300">Entry</label>
                <input
                  type="number"
                  value={entry}
                  onChange={(e) => setEntry(e.target.value)}
                  className="w-full p-3 rounded-xl bg-slate-800 border border-slate-700"
                />
              </div>
              <div>
                <label className="block mb-2 text-slate-300">Exit</label>
                <input
                  type="number"
                  value={exit}
                  onChange={(e) => setExit(e.target.value)}
                  className="w-full p-3 rounded-xl bg-slate-800 border border-slate-700"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block mb-2 text-slate-300">Stop Loss</label>
                <input
                  type="number"
                  value={stopLoss}
                  onChange={(e) => setStopLoss(e.target.value)}
                  className="w-full p-3 rounded-xl bg-slate-800 border border-slate-700"
                />
              </div>
              <div>
                <label className="block mb-2 text-slate-300">Take Profit</label>
                <input
                  type="number"
                  value={takeProfit}
                  onChange={(e) => setTakeProfit(e.target.value)}
                  className="w-full p-3 rounded-xl bg-slate-800 border border-slate-700"
                />
              </div>
            </div>

            <div>
              <label className="block mb-2 text-slate-300">Lot Size</label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                placeholder="e.g. 0.01, 0.50, 1.00"
                value={lotSize}
                onChange={(e) => setLotSize(e.target.value)}
                className="w-full p-3 rounded-xl bg-slate-800 border border-slate-700"
              />
            </div>

            <div>
              <label className="block mb-2 text-slate-300">Setup Type</label>
              <select
                value={setupType}
                onChange={(e) => setSetupType(e.target.value)}
                className="w-full p-3 rounded-xl bg-slate-800 border border-slate-700"
              >
                <option value="">Select Setup</option>
                <option>Breakout</option>
                <option>Pullback</option>
                <option>Reversal</option>
                <option>Trend Continuation</option>
                <option>Other</option>
              </select>
            </div>

            <div>
              <label className="block mb-2 text-slate-300">Trade Date</label>
              <input
                type="date"
                value={tradeDate}
                onChange={(e) => setTradeDate(e.target.value)}
                className="w-full p-3 rounded-xl bg-slate-800 border border-slate-700"
              />
            </div>

            <div>
              <label className="block mb-2 text-slate-300">Notes</label>
              <textarea
                rows={4}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full p-3 rounded-xl bg-slate-800 border border-slate-700"
              />
            </div>

            {/* Save Trade Button */}
            <button
              onClick={handleSaveTrade}
              className="
                w-full
                py-3
                rounded-xl
                font-semibold
                bg-gradient-to-r
                from-cyan-500
                to-blue-600
                shadow-lg
                shadow-cyan-500/30
                hover:shadow-cyan-500/50
                hover:scale-[1.02]
                transition-all
                duration-300
              "
            >
              {editingIndex !== null ? "Update Trade" : "+ Save Trade"}
            </button>

          </div>
        </motion.div>

        {/* Right Trades Panel */}
        <motion.div
          whileHover={{ y: -4, scale: 1.01 }}
          className="lg:col-span-2 bg-slate-900/80 backdrop-blur-xl p-5 rounded-3xl border-2 border-slate-800 flex flex-col min-h-[600px] lg:h-[780px]"
        >
          <h2 className="text-2xl font-bold mb-5 shrink-0">Recent Trades</h2>

          {/* Small Stats */}
          <div className="grid grid-cols-2 gap-4 mb-5 shrink-0">
            <div className="bg-slate-800/60 p-4 rounded-xl">
              <p className="text-slate-400 text-sm">Trades</p>
              <h3 className="text-2xl font-bold">{trades.length}</h3>
            </div>
            <div className="bg-slate-800/60 p-4 rounded-xl">
              <p className="text-slate-400 text-sm">Win Rate</p>
              <h3 className="text-2xl font-bold text-green-400">
                {trades.length > 0 ? `${winRate}%` : "—"}
              </h3>
            </div>
          </div>

          {trades.length === 0 ? (
            // Empty state
            <div className="text-center py-16">
              <p className="text-3xl mb-3">📈</p>
              <p className="text-slate-300 text-lg font-semibold">No trades yet</p>
              <p className="text-slate-500 mt-2">
                Start building your trading statistics by logging your first trade.
              </p>
            </div>
          ) : (
            <div className="flex-1 min-h-0 overflow-hidden">
              <div className="overflow-x-auto h-full">
                <table className="w-full border-collapse min-w-[700px]">
                  <thead className="sticky top-0 z-10 bg-slate-900/95 backdrop-blur-xl">
                    <tr className="border-b border-slate-800">
                      <th className="p-4 text-left">Asset</th>
                      <th className="p-4 text-left">Direction</th>
                      <th className="p-4 text-left">Setup</th>
                      <th className="p-4 text-left">Result</th>
                      <th className="p-4 text-right">P&amp;L</th>
                      <th className="p-4 text-left">Date</th>
                      <th className="p-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trades.map((trade, index) => {
                      const pnl = trade.pnl ?? 0;
                      const positive = pnl >= 0;
                      return (
                        <tr
                          key={index}
                          className="
                            border-b border-slate-800
                            hover:bg-slate-800/40
                            transition-all
                          "
                        >
                          <td className="p-4">{trade.asset}</td>
                          <td className="p-4">
                            <span
                              className={`px-3 py-1 rounded-full text-xs font-semibold ${
                                trade.direction === "Buy"
                                  ? "bg-green-500/20 text-green-400"
                                  : "bg-red-500/20 text-red-400"
                              }`}
                            >
                              {trade.direction}
                            </span>
                          </td>
                          <td className="p-4">
                            <span className="px-3 py-1 rounded-full text-xs font-semibold bg-blue-500/20 text-blue-400">
                              {trade.setupType}
                            </span>
                          </td>
                          <td className="p-4">
                            <span
                              className={`px-3 py-1 rounded-full text-xs font-semibold ${
                                trade.result === "Win"
                                  ? "bg-green-500/20 text-green-400"
                                  : "bg-red-500/20 text-red-400"
                              }`}
                            >
                              {trade.result}
                            </span>
                          </td>
                          <td className="p-4 text-right">
                            <span
                              className={`font-semibold ${
                                positive ? "text-green-400" : "text-red-400"
                              }`}
                            >
                              {positive ? "+" : ""}
                              {pnl.toFixed(2)}
                            </span>
                          </td>
                          <td className="p-4">{trade.tradeDate}</td>
                          <td className="p-4">
                            <div className="flex items-center justify-end gap-2">
                              <button
                                onClick={() => handleEditTrade(index)}
                                className="p-2 rounded-lg hover:bg-slate-700/60 text-slate-400 hover:text-cyan-400 transition-colors"
                                aria-label="Edit trade"
                              >
                                <Pencil size={15} />
                              </button>
                              <button
                                onClick={() => handleDeleteTrade(index)}
                                className="p-2 rounded-lg hover:bg-slate-700/60 text-slate-400 hover:text-red-400 transition-colors"
                                aria-label="Delete trade"
                              >
                                <Trash2 size={15} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </motion.div>

      </div>
    </motion.div>
  );
}