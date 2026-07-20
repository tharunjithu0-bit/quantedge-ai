import axios from "axios";

// Same base URL constant used by Dashboard.tsx, TradeJournal.tsx, etc.
// Kept local to this file (not extracted into a shared config) so the
// existing pages' axios calls are left completely untouched.
const API_BASE_URL = "https://quantedge-ai-1bbs.onrender.com";

export type AuthUser = {
  id: number;
  username: string;
  email: string;
  created_at: string | null;
};

export type AuthResponse = {
  user: AuthUser;
  token: string;
};

type ApiEnvelope<T> = {
  status: "success" | "error";
  data?: T;
  message?: string;
};

/**
 * Registers a new account.
 * Throws an Error with a user-friendly message on failure.
 */
export async function registerRequest(
  username: string,
  email: string,
  password: string
): Promise<AuthResponse> {
  try {
    const res = await axios.post<ApiEnvelope<AuthResponse>>(
      `${API_BASE_URL}/api/auth/register`,
      { username, email, password }
    );
    return res.data.data as AuthResponse;
  } catch (err) {
    throw new Error(extractErrorMessage(err, "Registration failed"));
  }
}

/**
 * Logs in with a username-or-email + password.
 */
export async function loginRequest(
  identifier: string,
  password: string
): Promise<AuthResponse> {
  try {
    const res = await axios.post<ApiEnvelope<AuthResponse>>(
      `${API_BASE_URL}/api/auth/login`,
      { identifier, password }
    );
    return res.data.data as AuthResponse;
  } catch (err) {
    throw new Error(extractErrorMessage(err, "Login failed"));
  }
}

/**
 * Resolves the current user from a stored token. Used on app load to
 * silently restore a session after a refresh. Returns null (rather
 * than throwing) on any failure, since the caller just wants to know
 * "is this token still valid?".
 */
export async function fetchCurrentUser(token: string): Promise<AuthUser | null> {
  try {
    const res = await axios.get<ApiEnvelope<AuthUser>>(
      `${API_BASE_URL}/api/auth/me`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    return res.data.data ?? null;
  } catch {
    return null;
  }
}

/**
 * Best-effort logout call. The frontend discards the token regardless
 * of whether this succeeds (JWTs are stateless — see auth_routes.py).
 */
export async function logoutRequest(token: string): Promise<void> {
  try {
    await axios.post(
      `${API_BASE_URL}/api/auth/logout`,
      {},
      { headers: { Authorization: `Bearer ${token}` } }
    );
  } catch {
    // Intentionally ignored — logging out client-side always succeeds.
  }
}

function extractErrorMessage(err: unknown, fallback: string): string {
  if (axios.isAxiosError(err)) {
    const message = err.response?.data?.message;
    if (typeof message === "string") return message;
  }
  return fallback;
}