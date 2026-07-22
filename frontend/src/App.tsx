import { Link, Routes, Route } from "react-router-dom";
import {
  LayoutDashboard,
  BookOpen,
  Briefcase,
  BarChart3,
  Bot,
  LogOut,
  Menu,
} from "lucide-react";
import { useState } from "react";
import Dashboard from "./pages/Dashboard";
import TradeJournal from "./pages/TradeJournal";
import Portfolio from "./pages/Portfolio";
import Analytics from "./pages/Analytics";
import AICoach from "./pages/AICoach";
import Login from "./pages/Login";
import Register from "./pages/Register";
import ProtectedRoute from "./components/ProtectedRoute";
import { useAuth } from "./context/AuthContext";

function DashboardLayout() {
  const { user, logout } = useAuth();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const closeMenu = () => setIsMobileMenuOpen(false);

  return (
    <div className="relative min-h-screen text-white overflow-hidden">
      {/* Background Gradient */}
      <div
        className="
        absolute inset-0
        bg-gradient-to-br
        from-slate-950
        via-blue-950
        to-slate-950
        -z-10
      "
      />

      {/* Radial Glow */}
      <div
        className="
        absolute inset-0
        bg-[radial-gradient(circle_at_center,rgba(59,130,246,0.25),transparent_70%)]
        -z-10
      "
      />

      <div className="flex min-h-screen">
        {/* Sidebar */}
        <div
          className={`
            fixed md:static inset-y-0 left-0 z-50
            w-72
            bg-slate-900/70
            backdrop-blur-xl
            border-r
            border-slate-800
            p-6
            transition-transform duration-300 ease-in-out
            ${isMobileMenuOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"}
          `}
        >
          {/* Logo */}
          <div className="mb-10">
            <div className="flex items-center gap-3">
              <div
                className="
                w-10 h-10
                rounded-xl
                bg-gradient-to-br
                from-cyan-400
                to-blue-600
                shadow-lg
                shadow-cyan-500/30
                flex
                items-center
                justify-center
                font-bold
                text-lg
              "
              >
                ▣
              </div>
              <div>
                <h1 className="text-2xl font-bold tracking-wide">
                  QuantEdge AI
                </h1>
                <p className="text-slate-400 text-xs">
                  Trading Intelligence Platform
                </p>
              </div>
            </div>
          </div>

          {/* Navigation */}
          <div className="space-y-2">
            <Link
              to="/"
              onClick={closeMenu}
              className="
              flex items-center gap-3
              p-3 rounded-xl
              hover:bg-slate-800
              hover:translate-x-1
              transition-all
              duration-300
            "
            >
              <LayoutDashboard size={20} />
              Dashboard
            </Link>

            <Link
              to="/trade-journal"
              onClick={closeMenu}
              className="
              flex items-center gap-3
              p-3 rounded-xl
              hover:bg-slate-800
              hover:translate-x-1
              transition-all
              duration-300
            "
            >
              <BookOpen size={20} />
              Trade Journal
            </Link>

            <Link
              to="/portfolio"
              onClick={closeMenu}
              className="
              flex items-center gap-3
              p-3 rounded-xl
              hover:bg-slate-800
              hover:translate-x-1
              transition-all
              duration-300
            "
            >
              <Briefcase size={20} />
              Portfolio
            </Link>

            <Link
              to="/analytics"
              onClick={closeMenu}
              className="
              flex items-center gap-3
              p-3 rounded-xl
              hover:bg-slate-800
              hover:translate-x-1
              transition-all
              duration-300
            "
            >
              <BarChart3 size={20} />
              Analytics
            </Link>

            <Link
              to="/ai-coach"
              onClick={closeMenu}
              className="
              flex items-center gap-3
              p-3 rounded-xl
              hover:bg-slate-800
              hover:translate-x-1
              transition-all
              duration-300
            "
            >
              <Bot size={20} />
              AI Coach
            </Link>
          </div>

          {/* User Card */}
          <div
            className="
            mt-12
            p-4
            rounded-2xl
            bg-slate-800/80
            border
            border-slate-700
            hover:border-blue-500
            transition-all
            duration-300
          "
          >
            <p className="font-semibold truncate">
              {user?.username}
            </p>

            <p className="text-sm text-slate-400 truncate">
              {user?.email}
            </p>

            <button
              onClick={() => {
                logout();
                closeMenu();
              }}
              className="
              mt-3
              w-full
              flex items-center justify-center gap-2
              p-2
              rounded-xl
              text-sm text-slate-300
              bg-slate-900/60
              border border-slate-700
              hover:border-red-400/50
              hover:text-red-400
              transition-all
              duration-300
            "
            >
              <LogOut size={16} />
              Logout
            </button>
          </div>
        </div>

        {/* Mobile Overlay */}
        {isMobileMenuOpen && (
          <div
            className="fixed inset-0 bg-black/60 z-40 md:hidden"
            onClick={closeMenu}
          />
        )}

        {/* Main Content */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Mobile Header */}
          <div className="md:hidden bg-slate-900/70 backdrop-blur-xl border-b border-slate-800 p-4 flex items-center justify-between z-30">
            <div className="flex items-center gap-3">
              <div
                className="
                w-8 h-8
                rounded-xl
                bg-gradient-to-br
                from-cyan-400
                to-blue-600
                flex
                items-center
                justify-center
                font-bold
                text-lg
              "
              >
                ▣
              </div>
              <h1 className="text-xl font-bold tracking-wide">QuantEdge AI</h1>
            </div>

            <button
              onClick={() => setIsMobileMenuOpen(true)}
              className="p-2 hover:bg-slate-800 rounded-xl transition-colors"
            >
              <Menu size={28} />
            </button>
          </div>

          {/* Page Content */}
          <div className="flex-1 p-4 md:p-10 overflow-auto">
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/trade-journal" element={<TradeJournal />} />
              <Route path="/portfolio" element={<Portfolio />} />
              <Route path="/analytics" element={<Analytics />} />
              <Route path="/ai-coach" element={<AICoach />} />
            </Routes>
          </div>
        </div>
      </div>
    </div>
  );
}

function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route
        path="/*"
        element={
          <ProtectedRoute>
            <DashboardLayout />
          </ProtectedRoute>
        }
      />
    </Routes>
  );
}

export default App;