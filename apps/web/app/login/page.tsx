"use client";

import { Suspense, useEffect, useState, useSyncExternalStore } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";

const emptySubscribe = () => () => {};

function useIsClient() {
  return useSyncExternalStore(emptySubscribe, () => true, () => false);
}

function LoginForm() {
  const { token, login } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const isClient = useIsClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!isClient || !token) return;
    const next = searchParams.get("next");
    router.replace(next && next.startsWith("/") ? next : "/");
  }, [isClient, token, router, searchParams]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        token?: string;
        user?: { id: string; email: string };
      };
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : "Sign-in failed.");
        return;
      }
      if (!data.token || !data.user?.id || !data.user?.email) {
        setError("Invalid response from server.");
        return;
      }
      login(data.token, { id: data.user.id, email: data.user.email });
      const next = searchParams.get("next");
      router.replace(next && next.startsWith("/") ? next : "/");
    } catch {
      setError("Could not reach the server. Try again later.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center bg-background p-4 text-foreground">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-24 -left-24 h-96 w-96 rounded-full bg-[rgba(201,100,66,0.14)] blur-3xl" />
        <div className="absolute top-1/4 -right-32 h-96 w-96 rounded-full bg-[rgba(217,119,87,0.12)] blur-3xl" />
      </div>

      <div className="relative w-full max-w-md">
        <div className="mb-8 text-center">
          <h1 className="mb-2 text-[var(--type-heading)] leading-[var(--line-heading)] font-semibold">
            Medbot
          </h1>
          <p className="text-[var(--type-caption)] text-[var(--text-muted)]">Sign in to continue</p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface-strong)] p-8 shadow-lg"
        >
          {error && (
            <div role="alert" className="mb-4 rounded-[var(--radius-sm)] border border-[rgba(181,51,51,0.35)] bg-[rgba(181,51,51,0.08)] px-3 py-2 text-sm text-[var(--danger)]">
              {error}
            </div>
          )}

          <label className="mb-1 block text-sm font-medium text-[var(--text-muted)]">
            Email
          </label>
          <input
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mb-4 w-full rounded-[var(--radius-sm)] border border-[var(--border)] bg-background px-3 py-2.5 text-foreground outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            required
          />

          <label className="mb-1 block text-sm font-medium text-[var(--text-muted)]">
            Password
          </label>
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mb-6 w-full rounded-[var(--radius-sm)] border border-[var(--border)] bg-background px-3 py-2.5 text-foreground outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            required
          />

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-[var(--radius-pill)] bg-[var(--accent)] py-3 text-sm font-semibold text-[var(--accent-foreground)] shadow-[0_0_0_1px_var(--accent)] transition-transform hover:bg-[var(--accent-strong)] active:scale-[0.98] disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            {submitting ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-background text-foreground">
          <div className="h-9 w-9 rounded-[var(--radius-pill)] border-2 border-[var(--accent)] border-t-transparent animate-spin" />
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
