"use client";

import React, { createContext, useCallback, useContext, useMemo, useSyncExternalStore } from "react";
import {
  clearStoredAuth,
  getStoredToken,
  getStoredUser,
  setStoredAuth,
  type StoredUser,
} from "@/lib/authStorage";

type AuthSnapshot = { token: string | null; user: StoredUser | null };

/** Stable reference for SSR/hydration — getServerSnapshot must not return a fresh object each call. */
const SERVER_AUTH_SNAPSHOT: AuthSnapshot = Object.freeze({ token: null, user: null });

const listeners = new Set<() => void>();

function emitAuth() {
  listeners.forEach((l) => l());
}

function subscribeAuth(onChange: () => void) {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

function usersEqual(a: StoredUser | null, b: StoredUser | null): boolean {
  if (a === b) return true;
  if (a == null || b == null) return a === b;
  return a.id === b.id && a.email === b.email;
}

/** getSnapshot must return the same reference when store data is unchanged (Object.is), or React re-renders in a loop. */
let clientSnapshotCache: AuthSnapshot = { token: null, user: null };

function getClientAuthSnapshot(): AuthSnapshot {
  const token = getStoredToken();
  const user = getStoredUser();
  if (token === clientSnapshotCache.token && usersEqual(clientSnapshotCache.user, user)) {
    return clientSnapshotCache;
  }
  clientSnapshotCache = { token, user };
  return clientSnapshotCache;
}

function getServerAuthSnapshot(): AuthSnapshot {
  return SERVER_AUTH_SNAPSHOT;
}

type AuthContextValue = {
  token: string | null;
  user: StoredUser | null;
  login: (token: string, user: StoredUser) => void;
  logout: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { token, user } = useSyncExternalStore(
    subscribeAuth,
    getClientAuthSnapshot,
    getServerAuthSnapshot
  );

  const login = useCallback((nextToken: string, nextUser: StoredUser) => {
    setStoredAuth(nextToken, nextUser);
    emitAuth();
  }, []);

  const logout = useCallback(() => {
    clearStoredAuth();
    emitAuth();
  }, []);

  const value = useMemo(() => ({ token, user, login, logout }), [token, user, login, logout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return ctx;
}
