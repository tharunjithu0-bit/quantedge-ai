import { useState } from "react";
import type { FormEvent } from "react";
import { Link, Navigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Eye, EyeOff, LogIn } from "lucide-react";
import { useAuth } from "../context/AuthContext";

export default function Login() {
  const { user, isLoading, login } = useAuth();

  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Already logged in (e.g. valid token restored on refresh) -> skip
  // straight to the dashboard instead of showing the login form.
  if (!isLoading && user) {
    return <Navigate to="/" replace />;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (!identifier.trim() || !password) {
      setError("Please enter your username/email and password.");
      return;
    }

    setSubmitting(true);
    try {
      await login(identifier.trim(), password, rememberMe);
      // Navigation to "/" happens automatically: once `user` is set,
      // the check above (and ProtectedRoute) will render the dashboard.
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="relative min-h-screen text-white overflow-hidden flex items-center justify-center">
      {/* Background Gradient — identical to App.tsx */}
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

      {/* Radial Glow — identical to App.tsx */}
      <div
        className="
        absolute inset-0
        bg-[radial-gradient(circle_at_center,rgba(59,130,246,0.25),transparent_70%)]
        -z-10
      "
      />

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="
        w-full max-w-md
        mx-4
        bg-slate-900/70
        backdrop-blur-xl
        border
        border-slate-800
        rounded-2xl
        p-8
        shadow-lg
        shadow-cyan-500/10
      "
      >
        {/* Logo — same mark as the sidebar in App.tsx */}
        <div className="flex flex-col items-center text-center mb-8">
          <div
            className="
            w-14 h-14
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
            text-2xl
            mb-4
          "
          >
            ▣
          </div>
          <h1 className="text-2xl font-bold tracking-wide">QuantEdge AI</h1>
          <p className="text-slate-400 text-xs mt-1">
            AI-Powered Trading Intelligence Platform
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-sm text-slate-400 mb-2" htmlFor="identifier">
              Username or Email
            </label>
            <input
              id="identifier"
              type="text"
              autoComplete="username"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              placeholder="trader_mike or mike@example.com"
              className="
                w-full
                bg-slate-800/60
                border border-slate-700
                rounded-xl
                px-4 py-3
                text-sm
                placeholder:text-slate-500
                focus:outline-none
                focus:border-cyan-400
                transition-all
                duration-300
              "
            />
          </div>

          <div>
            <label className="block text-sm text-slate-400 mb-2" htmlFor="password">
              Password
            </label>
            <div className="relative">
              <input
                id="password"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="
                  w-full
                  bg-slate-800/60
                  border border-slate-700
                  rounded-xl
                  px-4 py-3 pr-11
                  text-sm
                  placeholder:text-slate-500
                  focus:outline-none
                  focus:border-cyan-400
                  transition-all
                  duration-300
                "
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="
                  absolute right-3 top-1/2 -translate-y-1/2
                  text-slate-400 hover:text-cyan-400
                  transition-colors duration-300
                "
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          <div className="flex items-center justify-between text-sm">
            <label className="flex items-center gap-2 text-slate-400 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                className="rounded border-slate-700 bg-slate-800/60 accent-cyan-500"
              />
              Remember Me
            </label>
          </div>

          {error && (
            <div
              className="
              bg-red-400/10
              border border-red-400/20
              text-red-400
              text-sm
              rounded-xl
              px-4 py-3
            "
            >
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="
              w-full
              flex items-center justify-center gap-2
              bg-gradient-to-br
              from-cyan-400
              to-blue-600
              shadow-lg
              shadow-cyan-500/30
              rounded-xl
              py-3
              font-semibold
              hover:translate-y-[-1px]
              disabled:opacity-60
              disabled:hover:translate-y-0
              transition-all
              duration-300
            "
          >
            <LogIn size={18} />
            {submitting ? "Logging in..." : "Login"}
          </button>
        </form>

        <p className="text-center text-sm text-slate-400 mt-6">
          Don&apos;t have an account?{" "}
          <Link to="/register" className="text-cyan-400 hover:text-cyan-300 transition-colors duration-300">
            Create Account
          </Link>
        </p>
      </motion.div>
    </div>
  );
}