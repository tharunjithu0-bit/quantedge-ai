import { useState } from "react";
import type { FormEvent } from "react";
import { Link, Navigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Eye, EyeOff, UserPlus } from "lucide-react";
import { useAuth } from "../context/AuthContext";

export default function Register() {
  const { user, isLoading, register } = useAuth();

  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (!isLoading && user) {
    return <Navigate to="/" replace />;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (!username.trim() || !email.trim() || !password || !confirmPassword) {
      setError("Please fill in every field.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters long.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setSubmitting(true);
    try {
      await register(username.trim(), email.trim(), password);
      // Once `user` is set by register(), the check above redirects to "/".
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="relative min-h-screen text-white overflow-hidden flex items-center justify-center">
      {/* Background Gradient — identical to App.tsx / Login.tsx */}
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

      {/* Radial Glow — identical to App.tsx / Login.tsx */}
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
            <label className="block text-sm text-slate-400 mb-2" htmlFor="username">
              Username
            </label>
            <input
              id="username"
              type="text"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="trader_mike"
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
            <label className="block text-sm text-slate-400 mb-2" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="mike@example.com"
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
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 8 characters"
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

          <div>
            <label className="block text-sm text-slate-400 mb-2" htmlFor="confirmPassword">
              Confirm Password
            </label>
            <input
              id="confirmPassword"
              type={showPassword ? "text" : "password"}
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Re-enter your password"
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
            <UserPlus size={18} />
            {submitting ? "Creating account..." : "Create Account"}
          </button>
        </form>

        <p className="text-center text-sm text-slate-400 mt-6">
          Already have an account?{" "}
          <Link to="/login" className="text-cyan-400 hover:text-cyan-300 transition-colors duration-300">
            Login
          </Link>
        </p>
      </motion.div>
    </div>
  );
}