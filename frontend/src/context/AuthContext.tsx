import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
} from "react";
import type { ReactNode } from "react";
import {
  loginRequest,
  registerRequest,
  fetchCurrentUser,
  logoutRequest,
  type AuthUser,
} from "../api/authApi";

const TOKEN_STORAGE_KEY = "quantedge_auth_token";

type AuthContextValue = {
  user: AuthUser | null;
  token: string | null;
  /** True only while the initial "restore session on refresh" check is running. */
  isLoading: boolean;
  login: (identifier: string, password: string, rememberMe: boolean) => Promise<void>;
  register: (username: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // On first mount, try to restore a session from a previously stored
  // token (this is what makes "remember login after refresh" work).
  // If /api/auth/me rejects the token (expired/invalid), we clear it
  // and fall through to the login page.
  useEffect(() => {
    // Check sessionStorage first (this tab's "don't remember me" login),
    // then fall back to localStorage (a "Remember Me" login from any
    // previous session). Either way, a page refresh restores the user.
    const storedToken =
      sessionStorage.getItem(TOKEN_STORAGE_KEY) || localStorage.getItem(TOKEN_STORAGE_KEY);
    if (!storedToken) {
      setIsLoading(false);
      return;
    }

    fetchCurrentUser(storedToken).then((currentUser) => {
      if (currentUser) {
        setUser(currentUser);
        setToken(storedToken);
      } else {
        localStorage.removeItem(TOKEN_STORAGE_KEY);
        sessionStorage.removeItem(TOKEN_STORAGE_KEY);
      }
      setIsLoading(false);
    });
  }, []);

  const login = useCallback(
    async (identifier: string, password: string, rememberMe: boolean) => {
      const { user: loggedInUser, token: newToken } = await loginRequest(identifier, password);
      setUser(loggedInUser);
      setToken(newToken);

      // "Remember Me" controls persistence beyond this tab/session:
      // checked -> localStorage (survives closing the browser),
      // unchecked -> sessionStorage (cleared when the tab closes).
      // AuthProvider always reads from localStorage on mount, so when
      // "Remember Me" is off we deliberately do NOT write there.
      if (rememberMe) {
        localStorage.setItem(TOKEN_STORAGE_KEY, newToken);
      } else {
        sessionStorage.setItem(TOKEN_STORAGE_KEY, newToken);
      }
    },
    []
  );

  const register = useCallback(
    async (username: string, email: string, password: string) => {
      const { user: newUser, token: newToken } = await registerRequest(username, email, password);
      setUser(newUser);
      setToken(newToken);
      // New accounts are remembered by default, same as a fresh login.
      localStorage.setItem(TOKEN_STORAGE_KEY, newToken);
    },
    []
  );

  const logout = useCallback(async () => {
    if (token) {
      await logoutRequest(token);
    }
    setUser(null);
    setToken(null);
    localStorage.removeItem(TOKEN_STORAGE_KEY);
    sessionStorage.removeItem(TOKEN_STORAGE_KEY);
  }, [token]);

  return (
    <AuthContext.Provider value={{ user, token, isLoading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return ctx;
}