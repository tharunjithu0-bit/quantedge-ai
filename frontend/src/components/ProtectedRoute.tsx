import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

/**
 * Wraps a route element and redirects to /login if there is no
 * authenticated user. While the initial "restore session on refresh"
 * check is in flight, renders nothing rather than flashing the login
 * page for an already-logged-in user.
 */
export default function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return null;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}