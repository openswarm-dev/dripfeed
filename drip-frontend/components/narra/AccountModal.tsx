"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { IframeStamper, KeyFormat } from "@turnkey/iframe-stamper";

const TOKEN_KEY = "betttr_auth_token";
const USER_KEY = "betttr_auth_user";

const IFRAME_CONTAINER_ID = "betttr-turnkey-export-container";
const IFRAME_ELEMENT_ID = "betttr-turnkey-export-iframe";
const EXPORT_IFRAME_URL = "https://export.turnkey.com";

const IFRAME_STYLES = {
  backgroundColor: "transparent",
  color: "#e8e8e8",
  fontSize: "14px",
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
  fontWeight: "600",
  lineHeight: "1.55em",
  width: "100%",
  padding: "0px",
  margin: "0px",
  borderWidth: "0px",
  borderStyle: "none",
  borderRadius: "0px",
  textAlign: "left" as const,
  overflowWrap: "anywhere" as const,
  wordWrap: "break-word" as const,
};

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
  const [balanceSol, setBalanceSol] = useState<number | null>(null);
  const [balanceReady, setBalanceReady] = useState(false);
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
    if (!token) {
      setBalanceSol(null);
      setBalanceReady(false);
      return;
    }
    void api<{
      user: BetttrUser;
      wallet: BetttrWallet | null;
      balanceSol?: number | null;
    }>("/auth/me", { token })
      .then((data) => {
        setUser(data.user);
        setWallet(data.wallet);
        if (typeof data.balanceSol === "number") {
          setBalanceSol(data.balanceSol);
          setBalanceReady(true);
        } else {
          setBalanceReady(false);
        }
        localStorage.setItem(USER_KEY, JSON.stringify(data.user));
      })
      .catch(() => {
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(USER_KEY);
        setToken(null);
        setUser(null);
        setWallet(null);
        setBalanceSol(null);
        setBalanceReady(false);
      });
  }, [token]);

  const refreshBalance = useCallback(async () => {
    if (!token) return null;
    try {
      const data = await api<{ balanceSol: number | null }>("/wallet/balance", { token });
      setBalanceSol(data.balanceSol);
      setBalanceReady(true);
      return data.balanceSol;
    } catch {
      return null;
    }
  }, [token]);

  const persist = useCallback((t: string, u: BetttrUser, w: BetttrWallet | null) => {
    localStorage.setItem(TOKEN_KEY, t);
    localStorage.setItem(USER_KEY, JSON.stringify(u));
    setToken(t);
    setUser(u);
    setWallet(w);
    setBalanceSol(null);
    setBalanceReady(false);
  }, []);

  const register = useCallback(async (username: string, password: string) => {
    const data = await api<{
      token: string;
      user: BetttrUser;
      wallet: BetttrWallet;
    }>("/auth/register", { method: "POST", body: { username, password } });
    persist(data.token, data.user, data.wallet);
    setBalanceSol(0);
    setBalanceReady(true);
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
    setBalanceSol(null);
    setBalanceReady(false);
  }, []);

  const checkUsername = useCallback(async (username: string) => {
    const data = await api<{ available: boolean }>(
      `/auth/username-available?u=${encodeURIComponent(username)}`,
    );
    return data.available;
  }, []);

  return {
    ready,
    token,
    user,
    wallet,
    balanceSol,
    balanceReady,
    refreshBalance,
    register,
    login,
    logout,
    checkUsername,
  };
}

function formatSol(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n === 0) return "0 SOL";
  if (n < 0.0001) return "<0.0001 SOL";
  return `${n.toLocaleString(undefined, { maximumFractionDigits: 4 })} SOL`;
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
  if (!open) return null;

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

          {auth.user ? (
            <AccountPanel auth={auth} onClose={onClose} />
          ) : (
            <AuthForms auth={auth} onClose={onClose} />
          )}
        </div>
      </div>
    </div>
  );
}

function AuthForms({
  auth,
  onClose,
}: {
  auth: ReturnType<typeof useBetttrAuth>;
  onClose: () => void;
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
    setError(null);
    setStatus(null);
    setAvailable(null);
  }, [mode]);

  useEffect(() => {
    if (mode !== "create" || username.trim().length < 3) {
      setAvailable(null);
      return;
    }
    const t = setTimeout(() => {
      void auth.checkUsername(username).then(setAvailable).catch(() => setAvailable(null));
    }, 350);
    return () => clearTimeout(t);
  }, [username, mode, auth]);

  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      if (mode === "create") {
        if (password !== confirm) throw new Error("Passwords do not match");
        if (available === false) throw new Error("Username is taken");
        setStatus("Creating Turnkey wallet…");
        await auth.register(username.trim(), password);
        setStatus(null);
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
    <>
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
    </>
  );
}

function AccountPanel({
  auth,
  onClose,
}: {
  auth: ReturnType<typeof useBetttrAuth>;
  onClose: () => void;
}) {
  const address = auth.wallet?.address ?? null;
  const [copied, setCopied] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);

  // Soft refresh only when we don't already have a balance from /auth/me
  useEffect(() => {
    if (!auth.token || auth.balanceReady) return;
    void auth.refreshBalance();
  }, [auth.token, auth.balanceReady]); // eslint-disable-line react-hooks/exhaustive-deps

  const copyAddress = async () => {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      /* ignore */
    }
  };

  const signOut = () => {
    auth.logout();
    onClose();
  };

  return (
    <>
      <h2 className="auth-modal__title rainbow-text">Account</h2>
      <p className="auth-modal__hint">
        Your custodial Turnkey Solana wallet. Deposit SOL to this address, then deploy or export.
      </p>

      <div className="auth-account-grid">
        <div className="auth-account-row">
          <span className="auth-account-label">Username</span>
          <span className="auth-account-value">@{auth.user?.username}</span>
        </div>

        <div className="auth-account-row">
          <span className="auth-account-label">Balance</span>
          <span className="auth-account-value auth-account-value--mono">
            {auth.balanceReady ? formatSol(auth.balanceSol) : "…"}
          </span>
        </div>

        <div className="auth-account-row auth-account-row--stack">
          <div className="auth-account-row__top">
            <span className="auth-account-label">Turnkey wallet</span>
            <button
              type="button"
              className="auth-account-copy"
              onClick={() => void copyAddress()}
              disabled={!address}
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <code className="auth-account-address" title={address ?? undefined}>
            {address ? address : "No wallet"}
          </code>
        </div>
      </div>

      {!exportOpen ? (
        <>
          {/* Pre-mount hidden iframe container so export can warm faster */}
          <div className="auth-export__iframe auth-export__iframe--hidden" aria-hidden>
            <div id={IFRAME_CONTAINER_ID} />
          </div>
          <button
            type="button"
            className="auth-modal__cta"
            disabled={!address}
            onClick={() => setExportOpen(true)}
          >
            <span className="auth-modal__cta-glow rainbow-bg" aria-hidden="true" />
            <span className="auth-modal__cta-label">Export private key</span>
          </button>
          <button type="button" className="auth-modal__switch" onClick={signOut}>
            Sign out
          </button>
        </>
      ) : (
        <ExportKeyFlow
          token={auth.token}
          onCancel={() => setExportOpen(false)}
        />
      )}
    </>
  );
}

type ExportStage = "unlock" | "loading" | "done" | "error";

function ExportKeyFlow({
  token,
  onCancel,
}: {
  token: string | null;
  onCancel: () => void;
}) {
  const stamperRef = useRef<IframeStamper | null>(null);
  const warmReadyRef = useRef(false);
  const [stage, setStage] = useState<ExportStage>("unlock");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [iframeVisible, setIframeVisible] = useState(false);
  const [exportedAddress, setExportedAddress] = useState<string | null>(null);
  const [copiedHint, setCopiedHint] = useState(false);
  const [iframeReady, setIframeReady] = useState(false);

  // Warm Turnkey iframe while the user types their password
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const container = document.getElementById(IFRAME_CONTAINER_ID);
        if (!container) return;
        stamperRef.current?.clear();
        stamperRef.current = null;
        container.replaceChildren();

        const stamper = new IframeStamper({
          iframeUrl: EXPORT_IFRAME_URL,
          iframeContainer: container,
          iframeElementId: IFRAME_ELEMENT_ID,
        });
        await stamper.init();
        if (cancelled) {
          stamper.clear();
          return;
        }
        await stamper.applySettings({ styles: IFRAME_STYLES });
        stamperRef.current = stamper;
        warmReadyRef.current = Boolean(stamper.publicKey());
        setIframeReady(warmReadyRef.current);
      } catch {
        warmReadyRef.current = false;
        setIframeReady(false);
      }
    })();

    return () => {
      cancelled = true;
      stamperRef.current?.clear();
      stamperRef.current = null;
      warmReadyRef.current = false;
    };
  }, []);

  const reveal = async () => {
    if (!token) {
      setError("Sign in to export your key.");
      setStage("error");
      return;
    }
    if (password.length < 8) {
      setError("Enter your account password (min 8 characters)");
      return;
    }

    setStage("loading");
    setError(null);
    setIframeVisible(false);
    setExportedAddress(null);

    try {
      let stamper = stamperRef.current;
      if (!stamper || !stamper.publicKey()) {
        const container = document.getElementById(IFRAME_CONTAINER_ID);
        if (!container) throw new Error("Export container missing");
        container.replaceChildren();
        stamper = new IframeStamper({
          iframeUrl: EXPORT_IFRAME_URL,
          iframeContainer: container,
          iframeElementId: IFRAME_ELEMENT_ID,
        });
        await stamper.init();
        await stamper.applySettings({ styles: IFRAME_STYLES });
        stamperRef.current = stamper;
      }

      const targetPublicKey = stamper.publicKey();
      if (!targetPublicKey) {
        throw new Error("Turnkey export iframe did not provide an encryption key");
      }

      const { exportBundle, organizationId, address: walletAddress } = await api<{
        exportBundle: string;
        organizationId: string;
        address: string;
      }>("/wallet/export", {
        method: "POST",
        token,
        body: { password, targetPublicKey },
      });

      const injected = await stamper.injectKeyExportBundle(
        exportBundle,
        organizationId,
        KeyFormat.Solana,
        walletAddress,
      );
      if (!injected) {
        throw new Error("Could not decrypt export bundle in Turnkey iframe");
      }

      await stamper.applySettings({ styles: IFRAME_STYLES });
      setExportedAddress(walletAddress);
      setIframeVisible(true);
      setStage("done");
    } catch (err) {
      setError((err as Error).message || "Export failed");
      setStage("error");
    }
  };

  const copyKeyHint = () => {
    const iframe = document.getElementById(IFRAME_ELEMENT_ID) as HTMLIFrameElement | null;
    iframe?.focus();
    setCopiedHint(true);
    window.setTimeout(() => setCopiedHint(false), 2800);
  };

  return (
    <div className="auth-export">
      <p className="auth-export__warn">
        Enter your account password to reveal the Solana private key inside Turnkey&apos;s secure
        frame. Never share this key.
      </p>

      {(stage === "unlock" || stage === "error") && (
        <label className="auth-field">
          <span>Password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            placeholder="your account password"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") void reveal();
            }}
          />
        </label>
      )}

      {error && <p className="auth-modal__error">{error}</p>}

      {stage === "done" && (
        <p className="auth-export__done-hint">
          Key is shown only in Turnkey&apos;s isolated iframe — select it below, then copy.
        </p>
      )}

      <div
        className={iframeVisible ? "auth-export__iframe" : "auth-export__iframe auth-export__iframe--hidden"}
        aria-hidden={!iframeVisible}
      >
        <div id={IFRAME_CONTAINER_ID} />
      </div>

      {stage === "done" && exportedAddress && (
        <p className="auth-export__addr">
          Address · <span>{exportedAddress}</span>
        </p>
      )}

      {stage === "loading" ? (
        <button type="button" className="auth-modal__cta" disabled>
          <span className="auth-modal__cta-glow rainbow-bg" aria-hidden="true" />
          <span className="auth-modal__cta-label">Unlocking…</span>
        </button>
      ) : stage === "done" ? (
        <button type="button" className="auth-modal__cta" onClick={copyKeyHint}>
          <span className="auth-modal__cta-glow rainbow-bg" aria-hidden="true" />
          <span className="auth-modal__cta-label">
            {copiedHint ? "Select key above, then Ctrl+C / ⌘C" : "Copy private key"}
          </span>
        </button>
      ) : (
        <button type="button" className="auth-modal__cta" onClick={() => void reveal()}>
          <span className="auth-modal__cta-glow rainbow-bg" aria-hidden="true" />
          <span className="auth-modal__cta-label">
            {stage === "error"
              ? "Try again"
              : iframeReady
                ? "Unlock & reveal key"
                : "Unlock & reveal key"}
          </span>
        </button>
      )}

      <button type="button" className="auth-modal__switch" onClick={onCancel}>
        Back to account
      </button>
    </div>
  );
}
