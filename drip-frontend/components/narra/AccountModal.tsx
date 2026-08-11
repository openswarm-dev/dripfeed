"use client";

import { useCallback, useEffect, useState } from "react";

const TOKEN_KEY = "betttr_auth_token";
const USER_KEY = "betttr_auth_user";

type BetttrUser = { id: string; username: string; createdAt: string };
type BetttrWallet = { address: string; createdAt?: string };

async function api<T>(
  path: string,
  opts?: { method?: string; body?: unknown; token?: string | null },
): Promise<T> {
  const res = await fetch(`/api/radar${path}`, {
    method: opts?.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      ...(opts?.token ? { Authorization: `Bearer ${opts.token}` } : {}),
    },
    body: opts?.body ? JSON.stringify(opts.body) : undefined,
    cache: "no-store",
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data as T;
}

export function useBetttrAuth() {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<BetttrUser | null>(null);
  const [wallet, setWallet] = useState<BetttrWallet | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const t = localStorage.getItem(TOKEN_KEY);
    const u = localStorage.getItem(USER_KEY);
    if (t) setToken(t);
    if (u) {
      try {
        setUser(JSON.parse(u));
      } catch {
        /* ignore */
      }
    }
    setReady(true);
  }, []);

  useEffect(() => {
    if (!token) return;
    void api<{ user: BetttrUser; wallet: BetttrWallet | null }>("/auth/me", { token })
      .then((data) => {
        setUser(data.user);
        setWallet(data.wallet);
        localStorage.setItem(USER_KEY, JSON.stringify(data.user));
      })
      .catch(() => {
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(USER_KEY);
        setToken(null);
        setUser(null);
        setWallet(null);
      });
  }, [token]);

  const persist = useCallback((t: string, u: BetttrUser, w: BetttrWallet | null) => {
    localStorage.setItem(TOKEN_KEY, t);
    localStorage.setItem(USER_KEY, JSON.stringify(u));
    setToken(t);
    setUser(u);
    setWallet(w);
  }, []);

  const register = useCallback(async (username: string, password: string) => {
    const data = await api<{
      token: string;
      user: BetttrUser;
      wallet: BetttrWallet;
    }>("/auth/register", { method: "POST", body: { username, password } });
    persist(data.token, data.user, data.wallet);
    return data;
  }, [persist]);

  const login = useCallback(async (username: string, password: string) => {
    const data = await api<{
      token: string;
      user: BetttrUser;
      wallet: BetttrWallet | null;
    }>("/auth/login", { method: "POST", body: { username, password } });
    persist(data.token, data.user, data.wallet);
    return data;
  }, [persist]);

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    setToken(null);
    setUser(null);
    setWallet(null);
  }, []);

  const checkUsername = useCallback(async (username: string) => {
    const data = await api<{ available: boolean }>(
      `/auth/username-available?u=${encodeURIComponent(username)}`,
    );
    return data.available;
  }, []);

  return { ready, token, user, wallet, register, login, logout, checkUsername };
}

export function AccountModal({
  open,
  onClose,
  auth,
}: {
  open: boolean;
  onClose: () => void;
  auth: ReturnType<typeof useBetttrAuth>;
}) {
  const [mode, setMode] = useState<"create" | "login">("create");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [available, setAvailable] = useState<boolean | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setStatus(null);
    setAvailable(null);
  }, [open, mode]);

  useEffect(() => {
    if (!open || mode !== "create" || username.trim().length < 3) {
      setAvailable(null);
      return;
    }
    const t = setTimeout(() => {
      void auth.checkUsername(username).then(setAvailable).catch(() => setAvailable(null));
    }, 350);
    return () => clearTimeout(t);
  }, [username, open, mode, auth]);

  if (!open) return null;

  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      if (mode === "create") {
        if (password !== confirm) throw new Error("Passwords do not match");
        if (available === false) throw new Error("Username is taken");
        setStatus("Creating Turnkey wallet…");
        const data = await auth.register(username.trim(), password);
        setStatus(`Wallet ready: ${data.wallet.address.slice(0, 8)}…`);
        onClose();
      } else {
        await auth.login(username.trim(), password);
        onClose();
      }
    } catch (err) {
      setError((err as Error).message);
      setStatus(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-modal-backdrop" onClick={onClose} role="presentation">
      <div className="auth-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="auth-modal__edge rainbow-bg" aria-hidden="true" />
        <div className="auth-modal__body">
          <div className="auth-modal__brand">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logos/Betttr.png" alt="" className="auth-modal__logo" />
            <span className="auth-modal__brand-name rainbow-text">Betttr.xyz</span>
            <button type="button" className="auth-modal__close" onClick={onClose} aria-label="Close">
              ×
            </button>
          </div>

          <h2 className="auth-modal__title rainbow-text">
            {mode === "create" ? "Create account" : "Sign in"}
          </h2>
          <p className="auth-modal__hint">
            {mode === "create"
              ? "Username + password unlocks your Turnkey Solana wallet — deposit, withdraw, export, and deploy."
              : "Welcome back. Sign in to your custodial Turnkey wallet."}
          </p>

          <label className="auth-field">
            <span>Username</span>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              placeholder="yourname"
              disabled={busy}
            />
            {mode === "create" && available != null && username.trim().length >= 3 && (
              <em className={available ? "ok" : "bad"}>
                {available ? "Available" : "Taken"}
              </em>
            )}
          </label>

          <label className="auth-field">
            <span>Password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === "create" ? "new-password" : "current-password"}
              placeholder="min 8 characters"
              disabled={busy}
            />
          </label>

          {mode === "create" && (
            <label className="auth-field">
              <span>Confirm password</span>
              <input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password"
                disabled={busy}
              />
            </label>
          )}

          {error && <p className="auth-modal__error">{error}</p>}
          {status && <p className="auth-modal__status">{status}</p>}

          <button
            type="button"
            className="auth-modal__cta"
            disabled={busy}
            onClick={() => void submit()}
          >
            <span className="auth-modal__cta-glow rainbow-bg" aria-hidden="true" />
            <span className="auth-modal__cta-label">
              {busy
                ? "Working…"
                : mode === "create"
                  ? "Create Turnkey wallet"
                  : "Sign in"}
            </span>
          </button>

          <button
            type="button"
            className="auth-modal__switch"
            disabled={busy}
            onClick={() => setMode(mode === "create" ? "login" : "create")}
          >
            {mode === "create" ? "Already have an account? Sign in" : "Need an account? Create one"}
          </button>
        </div>
      </div>
    </div>
  );
}
