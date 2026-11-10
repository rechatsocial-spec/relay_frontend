import React, { useState, useEffect, useRef, createContext, useContext } from "react";
import { createPortal } from "react-dom";
import {
  LayoutGrid, Users, Phone, Inbox as InboxIcon, Contact, Megaphone, Workflow,
  Bot, BarChart3, ScrollText, Settings as SettingsIcon, Search, Bell, ChevronDown,
  Plus, X, Check, CheckCheck, Send, Paperclip, Image as ImageIcon, Video, Mic,
  Smile, Play, Square, Trash2, UserCog,
  ChevronRight, ChevronLeft, Eye, Pencil, LogOut, Key,
  CircleDot, Clock, Construction, ArrowDown, GitBranch, MessageCircle, Save, Menu,
  Zap, ListTree, RefreshCw, AlertCircle, WifiOff, FileText, Copy
} from "lucide-react";
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Funnel, FunnelChart, LabelList
} from "recharts";

// ============================================================
// API CLIENT — every page below calls the real FastAPI backend.
// Backend URL comes from VITE_API_URL (see .env.example); defaults to
// localhost:8000, which is where the backend README runs it.
// ============================================================
const API_BASE = `${(import.meta.env.VITE_API_URL || "http://localhost:8000").replace(/\/+$/, "")}/api/v1`;

class ApiError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

// AuthProvider registers this so an expired/invalid token anywhere in the
// app signs the user out instead of leaving every page in an error state.
let onUnauthorized = null;

async function apiFetch(path, { method = "GET", body, token, params } = {}) {
  let url = `${API_BASE}${path}`;
  if (params) {
    const clean = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== "");
    const qs = new URLSearchParams(clean).toString();
    if (qs) url += `?${qs}`;
  }
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;

  let res;
  try {
    res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  } catch {
    // Fetch throws (not a 4xx/5xx) when the backend isn't reachable at all —
    // wrong host, server not running, CORS block. Surfaced distinctly so
    // the UI can say "can't reach the server" instead of a generic error.
    throw new ApiError("Could not reach the backend — is it running on " + API_BASE + "?", 0);
  }
  if (!res.ok) {
    let detail = res.statusText;
    try { const j = await res.json(); detail = j.detail || detail; } catch { /* body wasn't JSON */ }
    if (token && res.status === 401 && onUnauthorized) onUnauthorized();
    if (typeof detail !== "string") detail = JSON.stringify(detail); // FastAPI 422 returns a list
    throw new ApiError(detail, res.status);
  }
  if (res.status === 204) return null;
  return res.json();
}

// ============================================================
// AUTH — session is kept in localStorage so a page refresh doesn't sign the
// user out. The token's expiry (ACCESS_TOKEN_EXPIRE_MINUTES on the backend)
// is checked on load, and any 401 from the API signs out automatically.
// ============================================================
const AuthContext = createContext(null);
function useAuth() { return useContext(AuthContext); }

const SESSION_KEY = "relay_crm_session";

function tokenExpired(token) {
  try {
    const { exp } = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return !exp || exp * 1000 <= Date.now();
  } catch {
    return true;
  }
}

function loadSession() {
  try {
    const saved = JSON.parse(localStorage.getItem(SESSION_KEY));
    return saved?.token && !tokenExpired(saved.token) ? saved : null;
  } catch {
    return null;
  }
}

function saveSession(session) {
  try {
    if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else localStorage.removeItem(SESSION_KEY);
  } catch { /* storage unavailable (private mode) — session just won't persist */ }
}

function AuthProvider({ children }) {
  const [auth, setAuth] = useState(loadSession); // { token, role, name, userId }

  const startSession = (data) => {
    const next = { token: data.access_token, role: data.role, name: data.name, userId: data.user_id, hiddenPages: data.hidden_pages || [] };
    saveSession(next);
    setAuth(next);
    return next;
  };
  const login = async (email, password) =>
    startSession(await apiFetch("/auth/login", { method: "POST", body: { email, password } }));
  // `credential` is the ID token Google Identity Services gives the browser.
  const loginWithGoogle = async (credential) =>
    startSession(await apiFetch("/auth/google", { method: "POST", body: { credential } }));
  // Super Admin can change an Admin's visible pages at any time - re-sync.
  const setHiddenPages = (hiddenPages) =>
    setAuth((a) => {
      if (!a) return a;
      const next = { ...a, hiddenPages };
      saveSession(next);
      return next;
    });
  const logout = () => {
    saveSession(null);
    setAuth(null);
    // Belt-and-braces: we only use the button (popup), never One Tap auto-select,
    // so there's no silent re-login; this just clears Google's auto-select flag if loaded.
    window.google?.accounts?.id?.disableAutoSelect();
  };

  useEffect(() => {
    onUnauthorized = logout;
    return () => { onUnauthorized = null; };
  });

  return (
    <AuthContext.Provider value={{ ...auth, isAuthed: !!auth, login, loginWithGoogle, logout, setHiddenPages }}>
      {children}
    </AuthContext.Provider>
  );
}

/**
 * GET a list endpoint; refetches when path/params/token change or reload() is called.
 * refreshMs: also re-fetch silently every N ms (no loading flash) — for live data.
 */
function useApiList(path, { params, enabled = true, refreshMs } = {}) {
  const { token } = useAuth();
  const [state, setState] = useState({ data: [], loading: true, error: null });
  const [reloadKey, setReloadKey] = useState(0);
  const paramsKey = JSON.stringify(params || {});

  useEffect(() => {
    if (!enabled || !token) return;
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null }));
    apiFetch(path, { token, params }).then(
      (data) => { if (!cancelled) setState({ data, loading: false, error: null }); },
      (err) => { if (!cancelled) setState({ data: [], loading: false, error: err.message }); }
    );
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, token, paramsKey, reloadKey, enabled]);

  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!refreshMs || !enabled || !token) return;
    const t = setInterval(() => setTick((n) => n + 1), refreshMs);
    return () => clearInterval(t);
  }, [refreshMs, enabled, token]);
  useEffect(() => {
    if (!tick || !token) return;
    let cancelled = false;
    apiFetch(path, { token, params }).then((data) => { if (!cancelled) setState((s) => ({ ...s, data, error: null })); }, () => {});
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);

  return { ...state, reload: () => setReloadKey((k) => k + 1), refresh: () => setTick((n) => n + 1) };
}

// ============================================================
// DESIGN TOKENS
// ============================================================

const FONT_IMPORT = `@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap');`;

const RESPONSIVE_CSS = `
  html, body, #root { margin: 0; min-height: 100%; }
  *, *::before, *::after { box-sizing: border-box; }
  button, input, textarea, select { max-width: 100%; }
  .relay-shell { height: 100vh; min-height: 100vh; width: 100%; }
  .relay-main { min-width: 0; min-height: 0; }
  .relay-page { min-width: 0; min-height: 0; overflow-x: auto; overflow-y: auto; -webkit-overflow-scrolling: touch; }
  .relay-topbar { min-height: 56px; }
  .relay-topbar-search { width: 320px; }
  .relay-mobile-menu-btn { display: none; }
  .relay-mobile-overlay { display: none; }
  .relay-page-header { flex-wrap: wrap; gap: 12px; }
  .relay-table-wrap { overflow-x: auto !important; -webkit-overflow-scrolling: touch; }
  .relay-table-wrap table { min-width: 680px; }
  .relay-modal-card { max-width: calc(100vw - 24px) !important; }
  .relay-login-form { width: min(380px, calc(100vw - 24px)) !important; }
  .relay-auth-screen { min-height: 100dvh !important; min-height: 100vh !important; background: #16211C; }
  .relay-chart-grid { min-width: 0; }
  .relay-inbox { min-width: 0; }
  .relay-customer-panel { flex: 0 0 280px; }
  .relay-inbox-back { display: none; }
  .relay-kpi-card { min-width: 150px; }

  @media (max-width: 768px) {
    .relay-shell { height: 100dvh; min-height: 100dvh; }

    .relay-sidebar {
      position: fixed !important;
      z-index: 60;
      top: 0;
      left: 0;
      height: 100dvh !important;
      width: 280px !important;
      transform: translateX(-105%);
      box-shadow: 12px 0 30px rgba(0,0,0,0.18);
      transition: transform 0.22s ease;
    }
    .relay-sidebar.relay-sidebar-open { transform: translateX(0); }
    .relay-sidebar-collapse { display: none !important; }
    .relay-mobile-close { display: flex !important; }
    .relay-mobile-overlay {
      display: block;
      border: 0;
      padding: 0;
      position: fixed;
      inset: 0;
      z-index: 50;
      background: rgba(12, 18, 15, 0.42);
    }

    .relay-mobile-menu-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 34px;
      height: 34px;
      flex: 0 0 34px;
      border-radius: 7px;
      background: transparent;
      border: 1px solid transparent;
    }
    .relay-topbar {
      padding: 10px 12px !important;
      gap: 8px;
    }
    .relay-topbar-search {
      width: auto !important;
      flex: 1;
      min-width: 0;
    }
    .relay-topbar-user-details { display: none; }
    .relay-topbar-chevron { display: none; }
    .relay-topbar-actions { gap: 8px !important; }

    .relay-page {
      padding: 14px 12px !important;
    }
    .relay-page-header { margin-bottom: 14px !important; }
    .relay-page-header > div:first-child { min-width: 0; }
    .relay-page-header > div:last-child { width: 100%; }
    .relay-page-header > div:last-child > button { max-width: 100%; }

    .relay-kpi-card {
      flex: 1 1 calc(50% - 6px) !important;
      min-width: 0 !important;
    }

    .relay-chart-grid {
      grid-template-columns: minmax(0, 1fr) !important;
      gap: 12px !important;
    }

    .relay-modal-card {
      width: calc(100vw - 24px) !important;
      max-height: 90dvh !important;
    }

    .relay-inbox {
      height: calc(100dvh - 72px) !important;
      min-height: 0 !important;
      display: block !important;
      position: relative;
    }
    .relay-inbox-list {
      width: 100% !important;
      height: 100% !important;
      max-height: none !important;
      border-right: none !important;
      border-bottom: none !important;
    }
    .relay-inbox-thread {
      position: absolute !important;
      inset: 0 !important;
      width: 100% !important;
      height: 100% !important;
      background: #FFFFFF !important;
      z-index: 2;
    }
    .relay-inbox.relay-inbox-show-thread .relay-inbox-list { display: none !important; }
    .relay-inbox:not(.relay-inbox-show-thread) .relay-inbox-thread { display: none !important; }
    .relay-inbox .relay-customer-panel { display: none !important; }
    .relay-inbox-back { display: inline-flex !important; }
    .relay-inbox-thread .relay-thread-messages { padding-left: 12px !important; padding-right: 12px !important; }
    .relay-inbox-thread .relay-thread-composer { padding-left: 10px !important; padding-right: 10px !important; }
    .relay-inbox-thread .relay-composer-icons { gap: 0 !important; }
    .relay-inbox-thread .relay-composer-icons > button { padding: 5px !important; }
    .relay-inbox-thread .relay-thread-input { min-width: 0 !important; }

    .relay-flow-branches { flex-wrap: wrap; justify-content: center; gap: 20px !important; }
  }

  @media (max-width: 420px) {
    .relay-kpi-card { flex-basis: 100% !important; }
    .relay-topbar-search input { font-size: 12px !important; }
    .relay-page { padding: 12px 10px !important; }
  }
`;


const C = {
  bg: "#F4F6F2", panel: "#FFFFFF", panelDeep: "#ECEEE7",
  sidebar: "#16211C", sidebarSoft: "#22302A",
  ink: "#1B1F1D", inkSoft: "#5B615C", inkFaint: "#9A9C96",
  jade: "#1F6F54", jadeDeep: "#17543F", jadeSoft: "#E4EEE9",
  amber: "#D98E2E", amberSoft: "#FBF0DF",
  rust: "#B54A3C", rustSoft: "#F6E9E6",
  blue: "#3B6EA5", blueSoft: "#E7EEF5",
  gray: "#8B8E88", graySoft: "#EEEEEA",
  hairline: "#DDD9D0", hairlineSoft: "#E8E5DC", white: "#FFFFFF",
};
const F = { d: "'Space Grotesk', sans-serif", b: "'Inter', sans-serif", m: "'IBM Plex Mono', monospace" };

const PALETTE = [C.jade, C.amber, C.blue, C.rust, "#6B5B95", "#3D8A72"];
function initials(name) { return (name || "?").split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase(); }
function colorForId(id) {
  let hash = 0;
  const s = String(id || "");
  for (let i = 0; i < s.length; i++) hash = s.charCodeAt(i) + ((hash << 5) - hash);
  return PALETTE[Math.abs(hash) % PALETTE.length];
}
function fmtDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}
function fmtDateTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
}

// ============================================================
// PRIMITIVES
// ============================================================
function StatusPill({ status }) {
  const map = {
    active: [C.jade, C.jadeSoft, "Active"], warning: [C.amber, C.amberSoft, "Warning"],
    error: [C.rust, C.rustSoft, "Error"], inactive: [C.gray, C.graySoft, "Inactive"],
    Running: [C.jade, C.jadeSoft, "Running"], Paused: [C.amber, C.amberSoft, "Paused"],
    Completed: [C.blue, C.blueSoft, "Completed"], Failed: [C.rust, C.rustSoft, "Failed"],
    Scheduled: [C.gray, C.graySoft, "Scheduled"], Draft: [C.gray, C.graySoft, "Draft"],
    Connected: [C.jade, C.jadeSoft, "Connected"],
  };
  const [fg, bg, label] = map[status] || [C.gray, C.graySoft, status];
  return (
    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 text-[11px] font-medium" style={{ fontFamily: F.b, color: fg, background: bg, borderRadius: 6 }}>
      <CircleDot size={9} color={fg} />{label}
    </span>
  );
}

function KpiCard({ label, value, accent, sub }) {
  return (
    <div className="relay-kpi-card flex-1 min-w-[150px] px-4 py-3.5" style={{ background: C.panel, border: `1px solid ${C.hairline}`, borderRadius: 8, borderLeft: `2.5px solid ${accent}` }}>
      <div className="text-[11px] font-medium mb-1.5" style={{ fontFamily: F.b, color: C.inkSoft }}>{label}</div>
      <div className="text-[21px] font-semibold" style={{ fontFamily: F.d, color: C.ink }}>{value}</div>
      {sub && <div className="text-[11px] mt-1" style={{ fontFamily: F.m, color: C.inkFaint }}>{sub}</div>}
    </div>
  );
}

function Table({ columns, children }) {
  return (
    <div className="relay-table-wrap" style={{ background: C.panel, border: `1px solid ${C.hairline}`, borderRadius: 8, overflow: "hidden" }}>
      <table className="w-full border-collapse">
        <thead>
          <tr style={{ background: C.panelDeep, borderBottom: `1px solid ${C.hairline}` }}>
            {columns.map((c) => <th key={c} className="text-left px-3.5 py-2.5 text-[11px] font-semibold" style={{ fontFamily: F.b, color: C.inkSoft }}>{c}</th>)}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}
function Td({ children, mono }) {
  return <td className="px-3.5 py-2.5 text-[12.5px]" style={{ fontFamily: mono ? F.m : F.b, color: C.ink, borderBottom: `1px solid ${C.hairlineSoft}` }}>{children}</td>;
}
function IconBtn({ icon: Icon, onClick, active }) {
  return (
    <button onClick={onClick} className="p-1.5 shrink-0" style={{ borderRadius: 6, background: active ? C.jadeSoft : "transparent" }}>
      <Icon size={16} color={active ? C.jade : C.inkSoft} />
    </button>
  );
}
// Rendered into <body> via a portal: the page's fade-in animation creates a
// stacking context, which otherwise traps modals *under* the top bar.
function Modal({ title, onClose, children, width = 480 }) {
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(27,31,29,0.45)" }} onClick={onClose}>
      <div className="relay-modal-card" onClick={(e) => e.stopPropagation()} style={{ width, maxHeight: "85vh", overflowY: "auto", background: C.panel, borderRadius: 10, border: `1px solid ${C.hairline}` }}>
        <div className="flex items-center justify-between px-5 py-3.5" style={{ borderBottom: `1px solid ${C.hairline}` }}>
          <span className="text-[14px] font-semibold" style={{ fontFamily: F.d, color: C.ink }}>{title}</span>
          <button onClick={onClose}><X size={17} color={C.inkSoft} /></button>
        </div>
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>,
    document.body
  );
}
function Field({ label, children }) {
  return (
    <div className="mb-3.5">
      <label className="block text-[11.5px] font-medium mb-1.5" style={{ fontFamily: F.b, color: C.inkSoft }}>{label}</label>
      {children}
    </div>
  );
}
const inputStyle = { fontFamily: F.b, fontSize: 13, color: C.ink, width: "100%", padding: "8px 10px", border: `1px solid ${C.hairline}`, borderRadius: 7, outline: "none", background: C.white };
function PrimaryBtn({ children, onClick, full, disabled }) {
  return <button disabled={disabled} onClick={onClick} className={`px-4 py-2 text-[12.5px] font-medium text-white ${full ? "w-full" : ""}`} style={{ fontFamily: F.b, background: disabled ? C.gray : C.jade, borderRadius: 7, opacity: disabled ? 0.7 : 1 }}>{children}</button>;
}
function GhostBtn({ children, onClick }) {
  return <button onClick={onClick} className="px-4 py-2 text-[12.5px] font-medium" style={{ fontFamily: F.b, color: C.inkSoft, border: `1px solid ${C.hairline}`, borderRadius: 7 }}>{children}</button>;
}
function EmptyState({ icon: Icon, title, desc, phase }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 px-6 text-center">
      <div className="w-12 h-12 flex items-center justify-center mb-4" style={{ background: C.panelDeep, borderRadius: 10 }}><Icon size={22} color={C.inkSoft} /></div>
      <div className="text-[15px] font-semibold mb-1.5" style={{ fontFamily: F.d, color: C.ink }}>{title}</div>
      <div className="text-[12.5px] max-w-[380px] leading-relaxed mb-3" style={{ fontFamily: F.b, color: C.inkSoft }}>{desc}</div>
      {phase && <span className="inline-flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1" style={{ fontFamily: F.b, color: C.amber, background: C.amberSoft, borderRadius: 6 }}><Construction size={11} /> Planned for the next build phase</span>}
    </div>
  );
}
function PageHeader({ title, desc, action }) {
  return (
    <div className="relay-page-header flex items-start justify-between mb-5">
      <div>
        <div className="text-[19px] font-semibold" style={{ fontFamily: F.d, color: C.ink }}>{title}</div>
        {desc && <div className="text-[12.5px] mt-0.5" style={{ fontFamily: F.b, color: C.inkSoft }}>{desc}</div>}
      </div>
      {action}
    </div>
  );
}

/** Loading skeleton for table-shaped content — real fetches take real time. */
function TableSkeleton({ rows = 6 }) {
  return (
    <div style={{ background: C.panel, border: `1px solid ${C.hairline}`, borderRadius: 8, overflow: "hidden" }}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex gap-3 px-3.5 py-3" style={{ borderBottom: i < rows - 1 ? `1px solid ${C.hairlineSoft}` : "none" }}>
          {[30, 20, 15, 10, 10, 15].map((w, j) => (
            <div key={j} style={{ width: `${w}%`, height: 12, background: C.hairlineSoft, borderRadius: 4, animation: "relay-pulse 1.4s ease-in-out infinite" }} />
          ))}
        </div>
      ))}
      <style>{`@keyframes relay-pulse { 0%,100% { opacity: 0.5 } 50% { opacity: 1 } }`}</style>
    </div>
  );
}

/** Real errors get shown, not swallowed — with a retry that re-fires the fetch. */
function ErrorBanner({ message, onRetry }) {
  return (
    <div className="flex items-center justify-between px-4 py-3" style={{ background: C.rustSoft, border: `1px solid ${C.rust}33`, borderRadius: 8 }}>
      <div className="flex items-center gap-2">
        <WifiOff size={15} color={C.rust} />
        <span className="text-[12.5px]" style={{ fontFamily: F.b, color: C.rust }}>{message}</span>
      </div>
      {onRetry && (
        <button onClick={onRetry} className="flex items-center gap-1 text-[11.5px] font-medium px-2.5 py-1" style={{ fontFamily: F.b, color: C.rust, border: `1px solid ${C.rust}`, borderRadius: 6 }}>
          <RefreshCw size={12} /> Retry
        </button>
      )}
    </div>
  );
}

// ============================================================
// GOOGLE SIGN-IN — Google Identity Services. The client id comes from the
// backend (/auth/config -> GOOGLE_CLIENT_ID in the backend .env), so it's
// configured in one place. No id configured = no button.
// ============================================================
const GSI_SRC = "https://accounts.google.com/gsi/client";
let gsiPromise = null;
function loadGoogleScript() {
  if (window.google?.accounts?.id) return Promise.resolve();
  if (!gsiPromise) {
    gsiPromise = new Promise((resolve, reject) => {
      const el = document.createElement("script");
      el.src = GSI_SRC;
      el.async = true;
      el.onload = () => resolve();
      el.onerror = () => { gsiPromise = null; reject(new Error("Couldn't load Google sign-in. Check your connection.")); };
      document.head.appendChild(el);
    });
  }
  return gsiPromise;
}

function GoogleSignInButton({ clientId, onCredential, onError }) {
  const ref = useRef(null);
  // Keep the latest callbacks without re-initialising Google on every render.
  const cb = useRef({ onCredential, onError });
  cb.current = { onCredential, onError };

  useEffect(() => {
    let cancelled = false;
    loadGoogleScript().then(() => {
      if (cancelled || !ref.current) return;
      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: (resp) => cb.current.onCredential(resp.credential),
        ux_mode: "popup",
        cancel_on_tap_outside: true,
      });
      window.google.accounts.id.renderButton(ref.current, {
        type: "standard", theme: "outline", size: "large", text: "signin_with",
        shape: "rectangular", logo_alignment: "center", width: ref.current.offsetWidth || 324,
      });
    }, (err) => { if (!cancelled) cb.current.onError(err.message); });
    return () => { cancelled = true; };
  }, [clientId]);

  return <div ref={ref} style={{ width: "100%", minHeight: 40, display: "flex", justifyContent: "center" }} />;
}

// ============================================================
// LOGIN — email/password (POST /auth/login) or Google (POST /auth/google).
// ============================================================
function LoginScreen() {
  const { login, loginWithGoogle } = useAuth();
  const [googleClientId, setGoogleClientId] = useState(null);

  useEffect(() => {
    let cancelled = false;
    apiFetch("/auth/config").then(
      (cfg) => { if (!cancelled) setGoogleClientId(cfg.google_client_id || null); },
      () => { /* backend down — the password form will show that error on submit */ }
    );
    return () => { cancelled = true; };
  }, []);

  const signInWithGoogle = async (credential) => {
    setSubmitting(true);
    setError(null);
    try {
      await loginWithGoogle(credential);
    } catch (err) {
      setError(err.message || "Google sign-in failed");
      setSubmitting(false);
    }
  };
  const [email, setEmail] = useState("deepa@relaycrm.io");
  const [password, setPassword] = useState("password123");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await login(email, password);
    } catch (err) {
      setError(err.message || "Login failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="w-full h-full flex items-center justify-center" style={{ background: C.sidebar }}>
      <form onSubmit={submit} style={{ width: 380, background: C.panel, borderRadius: 12 }} className="relay-login-form px-7 py-8">
        <div className="flex items-center gap-2 mb-1">
          <div className="w-7 h-7 flex items-center justify-center" style={{ background: C.jade, borderRadius: 7 }}><InboxIcon size={15} color="white" /></div>
          <span className="text-[17px] font-semibold" style={{ fontFamily: F.d, color: C.ink }}>Rechat</span>
        </div>
        <p className="text-[12px] mb-6" style={{ fontFamily: F.b, color: C.inkSoft }}>WhatsApp communication & automation platform</p>

        {googleClientId && (
          <>
            <GoogleSignInButton clientId={googleClientId} onCredential={signInWithGoogle} onError={setError} />
            <div className="flex items-center gap-3 my-5">
              <div className="flex-1" style={{ height: 1, background: C.hairline }} />
              <span className="text-[11px]" style={{ fontFamily: F.b, color: C.inkFaint }}>or sign in with email</span>
              <div className="flex-1" style={{ height: 1, background: C.hairline }} />
            </div>
          </>
        )}

        <Field label="Work email">
          <input style={inputStyle} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </Field>
        <Field label="Password">
          <input style={inputStyle} type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </Field>

        {error && (
          <div className="flex items-center gap-2 px-3 py-2 mb-3.5" style={{ background: C.rustSoft, borderRadius: 7 }}>
            <AlertCircle size={13} color={C.rust} />
            <span className="text-[11.5px]" style={{ fontFamily: F.b, color: C.rust }}>{error}</span>
          </div>
        )}

        <PrimaryBtn full disabled={submitting}>{submitting ? "Signing in..." : "Sign in"}</PrimaryBtn>
      </form>
    </div>
  );
}

// ============================================================
// SIDEBAR + TOPBAR
// ============================================================
const NAV_ADMIN = [
  { key: "dashboard", label: "Dashboard", icon: LayoutGrid },
  { key: "inbox", label: "Inbox", icon: InboxIcon },
  { key: "numbers", label: "WhatsApp Numbers", icon: Phone },
  { key: "crm", label: "Contacts / CRM", icon: Contact },
  { key: "campaigns", label: "Campaigns", icon: Megaphone },
  { key: "automations", label: "Automations", icon: Workflow },
  { key: "chatbot", label: "Chatbot", icon: Bot },
  { key: "analytics", label: "Analytics", icon: BarChart3 },
  { key: "settings", label: "Settings", icon: SettingsIcon },
];
const NAV_SUPER = [
  { key: "dashboard", label: "Dashboard", icon: LayoutGrid },
  { key: "admins", label: "Admins", icon: Users },
  { key: "numbers", label: "WhatsApp Numbers", icon: Phone },
  { key: "inbox", label: "Inbox", icon: InboxIcon },
  { key: "crm", label: "Contacts / CRM", icon: Contact },
  { key: "campaigns", label: "Campaigns", icon: Megaphone },
  { key: "automations", label: "Automations", icon: Workflow },
  { key: "chatbot", label: "Chatbot", icon: Bot },
  { key: "analytics", label: "Analytics", icon: BarChart3 },
  { key: "activity", label: "Activity Logs", icon: ScrollText },
  { key: "settings", label: "Settings", icon: SettingsIcon },
];

function Sidebar({ role, page, setPage, collapsed, setCollapsed, mobileOpen, setMobileOpen }) {
  const { logout, hiddenPages = [] } = useAuth();
  const items = role === "super_admin" ? NAV_SUPER : NAV_ADMIN.filter((i) => !hiddenPages.includes(i.key));

  return (
    <div
      className={`relay-sidebar h-full flex flex-col shrink-0${mobileOpen ? " relay-sidebar-open" : ""}`}
      style={{
        width: collapsed ? 64 : 216,
        background: C.sidebar,
        transition: "width 0.2s ease",
      }}
    >
      <div
        className="flex items-center px-3 pt-5 pb-5"
        style={{ justifyContent: collapsed ? "center" : "flex-start", position: "relative" }}
      >
        <div className="w-7 h-7 flex items-center justify-center shrink-0" style={{ background: C.jade, borderRadius: 7 }}>
          <InboxIcon size={15} color="white" />
        </div>
        {!collapsed && (
          <span className="text-[15.5px] font-semibold ml-2" style={{ fontFamily: F.d, color: "white" }}>
            Rechat
          </span>
        )}

        <button
          type="button"
          className="relay-sidebar-collapse absolute flex items-center justify-center"
          onClick={() => setCollapsed((prev) => !prev)}
          style={{
            right: 6,
            top: 22,
            width: 20,
            height: 20,
            borderRadius: "50%",
            background: C.sidebar,
            border: `1px solid ${C.hairline}`,
            color: "#9DB2A5",
            zIndex: 10,
            cursor: "pointer",
          }}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? "→" : "←"}
        </button>

        <button
          type="button"
          className="relay-mobile-close items-center justify-center"
          onClick={() => setMobileOpen(false)}
          style={{
            display: "none",
            position: "absolute",
            right: 10,
            top: 20,
            width: 30,
            height: 30,
            borderRadius: 7,
            background: C.sidebarSoft,
            border: "none",
            cursor: "pointer",
          }}
          title="Close menu"
        >
          <X size={16} color="#DCE6DF" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-2.5">
        {items.map((it) => {
          const active = page === it.key;
          const Icon = it.icon;
          return (
            <button
              key={it.key}
              onClick={() => { setPage(it.key); setMobileOpen(false); }}
              className="w-full flex items-center px-3 py-2 mb-0.5 text-left"
              style={{
                borderRadius: 7,
                background: active ? C.sidebarSoft : "transparent",
                justifyContent: collapsed ? "center" : "flex-start",
                gap: collapsed ? 0 : 10,
              }}
              title={collapsed ? it.label : undefined}
            >
              <Icon size={15} color={active ? "white" : "#8CA398"} />
              {!collapsed && (
                <span className="text-[12.5px]" style={{ fontFamily: F.b, fontWeight: active ? 600 : 500, color: active ? "white" : "#9DB2A5" }}>
                  {it.label}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="px-2.5 pb-4 pt-2" style={{ borderTop: `1px solid #2A3A32` }}>
        <button
          onClick={logout}
          className="w-full flex items-center px-3 py-2 text-left"
          style={{ justifyContent: collapsed ? "center" : "flex-start", gap: collapsed ? 0 : 10 }}
          title={collapsed ? "Sign out" : undefined}
        >
          <LogOut size={15} color="#8CA398" />
          {!collapsed && <span className="text-[12.5px]" style={{ fontFamily: F.b, color: "#9DB2A5" }}>Sign out</span>}
        </button>
      </div>
    </div>
  );
}

function Topbar({ onMenu }) {
  const { role, name, logout } = useAuth();
  const [notifOpen, setNotifOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  return (
    <div className="relay-topbar flex items-center justify-between px-5 py-3 shrink-0" style={{ background: C.panel, borderBottom: `1px solid ${C.hairline}`, position: "relative", zIndex: 30 }}>
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <button
          type="button"
          className="relay-mobile-menu-btn"
          onClick={onMenu}
          aria-label="Open navigation"
        >
          <Menu size={18} color={C.inkSoft} />
        </button>

        <div className="relay-topbar-search flex items-center gap-2 px-3 py-1.5" style={{ background: C.bg, border: `1px solid ${C.hairline}`, borderRadius: 7 }}>
          <Search size={14} color={C.inkSoft} />
          <input placeholder="Search contacts, numbers, campaigns..." className="bg-transparent outline-none text-[12.5px] w-full placeholder:text-[#9A9C96]" style={{ fontFamily: F.b, color: C.ink }} />
        </div>
      </div>

      <div className="relay-topbar-actions flex items-center gap-3 ml-3 shrink-0">
        <div style={{ position: "relative" }}>
          <button type="button" onClick={() => { setNotifOpen((v) => !v); setProfileOpen(false); }} className="p-1.5" aria-label="Notifications" title="Notifications">
            <Bell size={17} color={C.inkSoft} />
          </button>
          {notifOpen && (
            <div style={{ position: "absolute", right: 0, top: 38, width: 230, background: C.white, border: `1px solid ${C.hairline}`, borderRadius: 8, boxShadow: "0 10px 28px rgba(0,0,0,.12)", padding: 12 }}>
              <div className="text-[12px] font-semibold" style={{ fontFamily: F.d, color: C.ink }}>Notifications</div>
              <div className="text-[11px] mt-1" style={{ fontFamily: F.b, color: C.inkSoft }}>No new notifications.</div>
            </div>
          )}
        </div>
        <div style={{ position: "relative" }}>
          <button type="button" onClick={() => { setProfileOpen((v) => !v); setNotifOpen(false); }} className="flex items-center gap-2" aria-label="Profile menu" title="Profile menu">
            <div className="w-7 h-7 flex items-center justify-center text-[11px] font-semibold text-white" style={{ background: C.jade, borderRadius: 7 }}>{initials(name)}</div>
            <div className="relay-topbar-user-details">
              <div className="text-[12px] font-medium text-left" style={{ fontFamily: F.b, color: C.ink }}>{name}</div>
              <div className="text-[10.5px] text-left" style={{ fontFamily: F.b, color: C.inkFaint }}>{role === "super_admin" ? "Super Admin" : "Admin"}</div>
            </div>
            <ChevronDown className="relay-topbar-chevron" size={13} color={C.inkSoft} />
          </button>
          {profileOpen && (
            <div style={{ position: "absolute", right: 0, top: 38, width: 180, background: C.white, border: `1px solid ${C.hairline}`, borderRadius: 8, boxShadow: "0 10px 28px rgba(0,0,0,.12)", padding: 8 }}>
              <div className="px-2 py-1.5">
                <div className="text-[12px] font-medium" style={{ fontFamily: F.b, color: C.ink }}>{name}</div>
                <div className="text-[10.5px]" style={{ fontFamily: F.b, color: C.inkFaint }}>{role === "super_admin" ? "Super Admin" : "Admin"}</div>
              </div>
              <button type="button" onClick={logout} className="w-full text-left px-2 py-2 text-[11.5px]" style={{ fontFamily: F.b, color: C.rust, borderRadius: 6 }}>Sign out</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// DASHBOARDS
// ============================================================
function SuperAdminDashboard() {
  const admins = useApiList("/admins");
  const numbers = useApiList("/numbers");
  const summary = useApiList("/analytics/summary");

  if (admins.error || numbers.error || summary.error) {
    return <ErrorBanner message={admins.error || numbers.error || summary.error} onRetry={() => { admins.reload(); numbers.reload(); summary.reload(); }} />;
  }
  if (admins.loading || numbers.loading || summary.loading) return <TableSkeleton rows={8} />;

  const nums = numbers.data;
  const s = summary.data;
  const activeCount = nums.filter((n) => n.status === "active").length;
  const warnErr = nums.filter((n) => n.status === "warning" || n.status === "error").length;
  const inactive = nums.filter((n) => n.status === "inactive").length;

  return (
    <div>
      <PageHeader title="Control center" desc={`Monitoring ${admins.data.length} admins across ${nums.length} WhatsApp numbers`} />
      <div className="flex flex-wrap gap-3 mb-6">
        <KpiCard label="Total Admins" value={admins.data.length} accent={C.jade} />
        <KpiCard label="WhatsApp Numbers" value={nums.length} accent={C.jade} sub={`${activeCount} active`} />
        <KpiCard label="Warning / Error" value={warnErr} accent={C.amber} />
        <KpiCard label="Inactive" value={inactive} accent={C.gray} />
        <KpiCard label="Messages Sent" value={s.messages_sent.toLocaleString()} accent={C.blue} />
        <KpiCard label="Delivered" value={s.delivered.toLocaleString()} accent={C.blue} />
        <KpiCard label="Failed" value={s.failed.toLocaleString()} accent={C.rust} />
        <KpiCard label="Conversion Rate" value={`${s.conversion_rate}%`} accent={C.jade} />
      </div>

      <div className="text-[13px] font-semibold mb-2.5" style={{ fontFamily: F.d, color: C.ink }}>Admin performance</div>
      <Table columns={["Admin", "Numbers", "Sent", "Replies", "Leads", "Conversion", "Status"]}>
        {admins.data.map((a) => (
          <tr key={a.id}>
            <Td><span className="font-medium">{a.name}</span></Td>
            <Td>{a.numbers_count}</Td>
            <Td mono>{a.messages_sent.toLocaleString()}</Td>
            <Td mono>{a.replies.toLocaleString()}</Td>
            <Td mono>{a.leads}</Td>
            <Td mono>{a.conversion_rate}%</Td>
            <Td><StatusPill status={a.status} /></Td>
          </tr>
        ))}
      </Table>

      <div className="text-[13px] font-semibold mb-2.5 mt-6" style={{ fontFamily: F.d, color: C.ink }}>WhatsApp number monitoring</div>
      <Table columns={["Number", "Status", "Messages Today", "Delivery Rate", "Reply Rate", "Last Activity"]}>
        {nums.slice(0, 8).map((n) => (
          <tr key={n.id}>
            <Td mono>{n.phone}</Td>
            <Td><StatusPill status={n.status} /></Td>
            <Td mono>{n.messages_today.toLocaleString()}</Td>
            <Td mono>{n.delivery_rate}%</Td>
            <Td mono>{n.reply_rate}%</Td>
            <Td>{fmtDateTime(n.last_activity_at)}</Td>
          </tr>
        ))}
      </Table>
      <div className="text-[11.5px] mt-2" style={{ fontFamily: F.b, color: C.inkFaint }}>Showing 8 of {nums.length} numbers — full table on the WhatsApp Numbers page.</div>
    </div>
  );
}

function AdminDashboard() {
  const numbers = useApiList("/numbers");
  const automations = useApiList("/automations");
  const summary = useApiList("/analytics/summary");

  if (numbers.error || automations.error || summary.error) {
    return <ErrorBanner message={numbers.error || automations.error || summary.error} onRetry={() => { numbers.reload(); automations.reload(); summary.reload(); }} />;
  }
  if (numbers.loading || automations.loading || summary.loading) return <TableSkeleton rows={6} />;

  const s = summary.data;
  const runningCount = automations.data.filter((a) => a.status === "Running").length;

  return (
    <div>
      <PageHeader title="Your workspace" desc={`${numbers.data.length} WhatsApp numbers · ${runningCount} active automations`} />
      <div className="flex flex-wrap gap-3 mb-6">
        <KpiCard label="Messages Sent" value={s.messages_sent.toLocaleString()} accent={C.jade} />
        <KpiCard label="Delivered" value={s.delivered.toLocaleString()} accent={C.blue} />
        <KpiCard label="Replies" value={s.replies.toLocaleString()} accent={C.jade} />
        <KpiCard label="Leads" value={s.leads} accent={C.amber} />
        <KpiCard label="Conversion Rate" value={`${s.conversion_rate}%`} accent={C.jade} />
      </div>

      <div className="text-[13px] font-semibold mb-2.5" style={{ fontFamily: F.d, color: C.ink }}>Automation progress</div>
      <Table columns={["Automation", "Status", "Recipients", "Sent", "Delivered", "Replies", "Progress"]}>
        {automations.data.map((a) => {
          const progress = a.recipients ? Math.round((a.sent / a.recipients) * 100) : 0;
          return (
            <tr key={a.id}>
              <Td>{a.name}</Td>
              <Td><StatusPill status={a.status} /></Td>
              <Td mono>{a.recipients.toLocaleString()}</Td>
              <Td mono>{a.sent.toLocaleString()}</Td>
              <Td mono>{a.delivered.toLocaleString()}</Td>
              <Td mono>{a.replies}</Td>
              <Td>
                <div className="flex items-center gap-2">
                  <div style={{ width: 60, height: 5, background: C.hairlineSoft, borderRadius: 3 }}><div style={{ width: `${progress}%`, height: 5, background: C.jade, borderRadius: 3 }} /></div>
                  <span className="text-[11px]" style={{ fontFamily: F.m, color: C.inkSoft }}>{progress}%</span>
                </div>
              </Td>
            </tr>
          );
        })}
      </Table>
    </div>
  );
}

// ============================================================
// WHATSAPP NUMBERS
// ============================================================
function NumbersPage({ role }) {
  const [statusFilter, setStatusFilter] = useState("all");
  const [showAdd, setShowAdd] = useState(false);
  const [showLink, setShowLink] = useState(false);
  const [pageNum, setPageNum] = useState(1);
  const perPage = 10;

  const numbers = useApiList("/numbers", { params: { status: statusFilter === "all" ? undefined : statusFilter } });
  const admins = useApiList("/admins", { enabled: role === "super_admin" });

  const totalPages = Math.max(1, Math.ceil(numbers.data.length / perPage));
  const paged = numbers.data.slice((pageNum - 1) * perPage, pageNum * perPage);

  return (
    <div>
      <PageHeader title="WhatsApp Numbers" desc={numbers.loading ? "Loading..." : `${numbers.data.length} numbers connected`} action={role === "super_admin" && <div className="flex gap-2"><GhostBtn onClick={() => setShowLink(true)}>Link via Unipile</GhostBtn><PrimaryBtn onClick={() => setShowAdd(true)}><span className="flex items-center gap-1.5"><Plus size={13} /> Add number</span></PrimaryBtn></div>} />

      <div className="flex gap-1.5 mb-3">
        {["all", "active", "warning", "error", "inactive"].map((s) => (
          <button key={s} onClick={() => { setStatusFilter(s); setPageNum(1); }} className="text-[11.5px] px-3 py-1.5 font-medium capitalize" style={{ fontFamily: F.b, borderRadius: 6, color: statusFilter === s ? "white" : C.inkSoft, background: statusFilter === s ? C.ink : C.panel, border: `1px solid ${statusFilter === s ? C.ink : C.hairline}` }}>{s}</button>
        ))}
      </div>

      {numbers.error && <ErrorBanner message={numbers.error} onRetry={numbers.reload} />}
      {numbers.loading && <TableSkeleton rows={8} />}
      {!numbers.loading && !numbers.error && (
        <>
          <Table columns={["Phone Number", "Display Name", "Status", "Messages Today", "Delivery Rate", "Reply Rate", "Last Activity"]}>
            {paged.map((n) => (
              <tr key={n.id}>
                <Td mono>{n.phone}</Td>
                <Td>{n.display_name}</Td>
                <Td><StatusPill status={n.status} /></Td>
                <Td mono>{n.messages_today.toLocaleString()}</Td>
                <Td mono>{n.delivery_rate}%</Td>
                <Td mono>{n.reply_rate}%</Td>
                <Td>{fmtDateTime(n.last_activity_at)}</Td>
              </tr>
            ))}
          </Table>
          <div className="flex items-center justify-between mt-3">
            <span className="text-[11.5px]" style={{ fontFamily: F.b, color: C.inkSoft }}>Page {pageNum} of {totalPages} · {numbers.data.length} numbers</span>
            <div className="flex gap-1.5">
              <button onClick={() => setPageNum(Math.max(1, pageNum - 1))} className="p-1.5" style={{ border: `1px solid ${C.hairline}`, borderRadius: 6 }}><ChevronLeft size={14} color={C.inkSoft} /></button>
              <button onClick={() => setPageNum(Math.min(totalPages, pageNum + 1))} className="p-1.5" style={{ border: `1px solid ${C.hairline}`, borderRadius: 6 }}><ChevronRight size={14} color={C.inkSoft} /></button>
            </div>
          </div>
        </>
      )}

      {showAdd && (
        <AddNumberModal admins={admins.data} onClose={() => setShowAdd(false)} onAdded={() => { setShowAdd(false); numbers.reload(); }} />
      )}
      {showLink && (
        <UnipileLinkModal admins={admins.data} onClose={() => setShowLink(false)} onLinked={() => { setShowLink(false); numbers.reload(); }} />
      )}
    </div>
  );
}

// Links a WhatsApp number through Unipile: opens Unipile's hosted QR / pairing
// page in a new tab, then polls /numbers until the new number shows up.
function UnipileLinkModal({ admins, onClose, onLinked }) {
  const { token } = useAuth();
  const [form, setForm] = useState({ display_name: "", admin_id: admins[0]?.id || "" });
  const [error, setError] = useState(null);
  const [waiting, setWaiting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const knownIds = useRef(null);
  const onLinkedRef = useRef(onLinked);
  useEffect(() => { onLinkedRef.current = onLinked; });

  useEffect(() => {
    if (!waiting) return;
    let stopped = false;
    const poll = async () => {
      try {
        const list = await apiFetch("/numbers", { token });
        if (stopped) return;
        if (list.some((n) => n.unipile_account_id && !knownIds.current.has(n.unipile_account_id))) onLinkedRef.current();
      } catch { /* keep polling */ }
    };
    const t = setInterval(poll, 3000);
    return () => { stopped = true; clearInterval(t); };
  }, [waiting, token]);

  const start = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const existing = await apiFetch("/numbers", { token });
      knownIds.current = new Set(existing.map((n) => n.unipile_account_id).filter(Boolean));
      const { link } = await apiFetch("/unipile/link", { method: "POST", token, body: form });
      window.open(link, "_blank", "noopener");
      setWaiting(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal title="Link WhatsApp via Unipile" onClose={onClose}>
      {!waiting ? (
        <>
          <Field label="Display name"><input style={inputStyle} placeholder="Sales Line — Mumbai" value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} /></Field>
          <Field label="Assigned admin">
            <select style={inputStyle} value={form.admin_id} onChange={(e) => setForm({ ...form, admin_id: e.target.value })}>
              {admins.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </Field>
          <div className="text-[11.5px] mb-3" style={{ fontFamily: F.b, color: C.inkSoft }}>A Unipile page opens in a new tab. On the phone: WhatsApp → Linked devices → Link a device, then scan the QR code (or use the pairing code).</div>
          {error && <div className="text-[11.5px] mb-3" style={{ fontFamily: F.b, color: C.rust }}>{error}</div>}
          <div className="flex gap-2 mt-4">
            <GhostBtn onClick={onClose}>Cancel</GhostBtn>
            <PrimaryBtn disabled={submitting || !form.admin_id} onClick={start}>{submitting ? "Preparing..." : "Open link page"}</PrimaryBtn>
          </div>
        </>
      ) : (
        <>
          <div className="text-[12.5px] mb-4" style={{ fontFamily: F.b, color: C.ink }}>Waiting for you to finish linking in the other tab… this closes automatically once the number is connected.</div>
          <div className="flex gap-2 mt-4"><GhostBtn onClick={onClose}>Close</GhostBtn></div>
        </>
      )}
    </Modal>
  );
}

function AddNumberModal({ admins, onClose, onAdded }) {
  const { token } = useAuth();
  const [form, setForm] = useState({ phone: "", display_name: "", waba_id: "", phone_number_id: "", admin_id: admins[0]?.id || "" });
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await apiFetch("/numbers", { method: "POST", token, body: form });
      onAdded();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal title="Add WhatsApp number" onClose={onClose}>
      <Field label="Phone number"><input style={inputStyle} placeholder="+91 98XXXXXXXX" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
      <Field label="Display name"><input style={inputStyle} placeholder="Sales Line — Mumbai" value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} /></Field>
      <Field label="WhatsApp Business Account ID"><input style={inputStyle} placeholder="WABA ID" value={form.waba_id} onChange={(e) => setForm({ ...form, waba_id: e.target.value })} /></Field>
      <Field label="Phone Number ID"><input style={inputStyle} placeholder="Meta phone number ID" value={form.phone_number_id} onChange={(e) => setForm({ ...form, phone_number_id: e.target.value })} /></Field>
      <Field label="Assigned admin">
        <select style={inputStyle} value={form.admin_id} onChange={(e) => setForm({ ...form, admin_id: e.target.value })}>
          {admins.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </Field>
      {error && <div className="text-[11.5px] mb-3" style={{ fontFamily: F.b, color: C.rust }}>{error}</div>}
      <div className="flex gap-2 mt-4">
        <GhostBtn onClick={onClose}>Cancel</GhostBtn>
        <PrimaryBtn disabled={submitting || !form.phone || !form.admin_id} onClick={submit}>{submitting ? "Adding..." : "Add number"}</PrimaryBtn>
      </div>
    </Modal>
  );
}

// ============================================================
// ADMINS PAGE (super admin only)
// ============================================================
function AdminsPage() {
  const admins = useApiList("/admins");
  const { token } = useAuth();
  const [showAdd, setShowAdd] = useState(false);
  const [pagesFor, setPagesFor] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [deletingAll, setDeletingAll] = useState(false);
  const [actionError, setActionError] = useState(null);

  const confirmDeleteAll = async () => {
    try {
      await apiFetch("/admins", { method: "DELETE", token });
    } catch (err) {
      setActionError(err.message);
    }
    setDeletingAll(false);
    admins.reload();
  };

  const confirmDelete = async () => {
    try {
      await apiFetch(`/admins/${deleting.id}`, { method: "DELETE", token });
      setDeleting(null);
      admins.reload();
    } catch (err) {
      setActionError(err.message);
      setDeleting(null);
    }
  };

  return (
    <div>
      <PageHeader title="Admins" desc={admins.loading ? "Loading..." : `${admins.data.length} admins`} action={<div className="flex gap-2">
        {admins.data.length > 0 && <button onClick={() => setDeletingAll(true)} className="px-4 py-2 text-[12.5px] font-medium flex items-center gap-1.5" style={{ fontFamily: F.b, color: C.rust, border: `1px solid ${C.rust}`, borderRadius: 7 }}><Trash2 size={13} /> Delete all</button>}
        <PrimaryBtn onClick={() => setShowAdd(true)}><span className="flex items-center gap-1.5"><Plus size={13} /> Add admin</span></PrimaryBtn>
      </div>} />

      {admins.error && <ErrorBanner message={admins.error} onRetry={admins.reload} />}
      {actionError && <ErrorBanner message={actionError} onRetry={() => setActionError(null)} />}
      {admins.loading && <TableSkeleton rows={8} />}
      {!admins.loading && !admins.error && (
        <Table columns={["Admin", "Email", "Phone", "Numbers", "Messages", "Leads", "Conversion", "Status", "Actions"]}>
          {admins.data.map((a) => (
            <tr key={a.id}>
              <Td><span className="font-medium">{a.name}</span></Td>
              <Td mono>{a.email}</Td>
              <Td mono>{a.phone}</Td>
              <Td mono>{a.numbers_count}</Td>
              <Td mono>{a.messages_sent.toLocaleString()}</Td>
              <Td mono>{a.leads}</Td>
              <Td mono>{a.conversion_rate}%</Td>
              <Td><StatusPill status={a.status} /></Td>
              <Td>
                <div className="flex gap-2">
                  <button onClick={() => setPagesFor(a)} className="px-2.5 py-1 text-[11.5px] font-medium" style={{ fontFamily: F.b, color: C.inkSoft, border: `1px solid ${C.hairline}`, borderRadius: 6 }}>Pages</button>
                  <button onClick={() => setDeleting(a)} className="px-2.5 py-1 text-[11.5px] font-medium flex items-center gap-1" style={{ fontFamily: F.b, color: C.rust, border: `1px solid ${C.hairline}`, borderRadius: 6 }}><Trash2 size={12} /> Delete</button>
                </div>
              </Td>
            </tr>
          ))}
        </Table>
      )}

      {pagesFor && <AdminPagesModal admin={pagesFor} onClose={() => setPagesFor(null)} onSaved={() => { setPagesFor(null); admins.reload(); }} />}
      {deletingAll && (
        <Modal title="Delete ALL admins" onClose={() => setDeletingAll(false)}>
          <p className="text-[13px] mb-2" style={{ fontFamily: F.b, color: C.ink }}>
            Delete all <b>{admins.data.length}</b> admins?
          </p>
          <p className="text-[12px] mb-4" style={{ fontFamily: F.b, color: C.rust }}>
            This permanently removes every admin account and all their WhatsApp numbers, contacts, conversations, campaigns, automations and chatbots. Super Admin accounts are not affected. It cannot be undone.
          </p>
          <div className="flex gap-2">
            <GhostBtn onClick={() => setDeletingAll(false)}>Cancel</GhostBtn>
            <button onClick={confirmDeleteAll} className="px-4 py-2 text-[12.5px] font-medium text-white" style={{ fontFamily: F.b, background: C.rust, borderRadius: 7 }}>Delete all permanently</button>
          </div>
        </Modal>
      )}
      {deleting && (
        <Modal title="Delete admin" onClose={() => setDeleting(null)}>
          <p className="text-[13px] mb-2" style={{ fontFamily: F.b, color: C.ink }}>
            Delete <b>{deleting.name}</b> ({deleting.email})?
          </p>
          <p className="text-[12px] mb-4" style={{ fontFamily: F.b, color: C.rust }}>
            This permanently removes their account and all their WhatsApp numbers, contacts, conversations, campaigns, automations and chatbots. It cannot be undone.
          </p>
          <div className="flex gap-2">
            <GhostBtn onClick={() => setDeleting(null)}>Cancel</GhostBtn>
            <button onClick={confirmDelete} className="px-4 py-2 text-[12.5px] font-medium text-white" style={{ fontFamily: F.b, background: C.rust, borderRadius: 7 }}>Delete permanently</button>
          </div>
        </Modal>
      )}

      {showAdd && <AddAdminModal onClose={() => setShowAdd(false)} onAdded={() => { setShowAdd(false); admins.reload(); }} />}
    </div>
  );
}

const PAGE_TOGGLES = NAV_ADMIN.map(({ key, label }) => ({ key, label }));

function AdminPagesModal({ admin, onClose, onSaved }) {
  const { token } = useAuth();
  const [hidden, setHidden] = useState(admin.hidden_pages || []);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const toggle = (key) => setHidden((h) => (h.includes(key) ? h.filter((k) => k !== key) : [...h, key]));

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await apiFetch(`/admins/${admin.id}`, { method: "PATCH", token, body: { hidden_pages: hidden } });
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={`Pages for ${admin.name}`} onClose={onClose}>
      <p className="text-[12px] mb-3" style={{ fontFamily: F.b, color: C.inkSoft }}>Tick the pages this admin can see in their menu.</p>
      {PAGE_TOGGLES.map((p) => (
        <label key={p.key} className="flex items-center gap-2.5 py-1.5 text-[13px] cursor-pointer" style={{ fontFamily: F.b, color: C.ink }}>
          <input type="checkbox" checked={!hidden.includes(p.key)} onChange={() => toggle(p.key)} />
          {p.label}
        </label>
      ))}
      {error && <div className="text-[11.5px] mt-2" style={{ fontFamily: F.b, color: C.rust }}>{error}</div>}
      <div className="flex gap-2 mt-4">
        <GhostBtn onClick={onClose}>Cancel</GhostBtn>
        <PrimaryBtn disabled={saving} onClick={save}>{saving ? "Saving..." : "Save"}</PrimaryBtn>
      </div>
    </Modal>
  );
}

function AddAdminModal({ onClose, onAdded }) {
  const { token } = useAuth();
  const [form, setForm] = useState({ name: "", email: "", phone: "", password: "" });
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await apiFetch("/admins", { method: "POST", token, body: form });
      onAdded();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal title="Add admin" onClose={onClose}>
      <Field label="Name"><input style={inputStyle} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Full name" /></Field>
      <Field label="Email"><input style={inputStyle} type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="name@company.com" /></Field>
      <Field label="Phone"><input style={inputStyle} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+91 ..." /></Field>
      <Field label="Temporary password"><input style={inputStyle} type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="At least 8 characters" /></Field>
      {error && <div className="text-[11.5px] mb-3" style={{ fontFamily: F.b, color: C.rust }}>{error}</div>}
      <div className="flex gap-2 mt-4">
        <GhostBtn onClick={onClose}>Cancel</GhostBtn>
        <PrimaryBtn disabled={submitting || !form.name || !form.email || !form.password} onClick={submit}>{submitting ? "Adding..." : "Add admin"}</PrimaryBtn>
      </div>
    </Modal>
  );
}

// ============================================================
// INBOX — real conversations. With Twilio live, replies go out over WhatsApp,
// incoming messages arrive via webhook, and the list refreshes on its own.
// ============================================================
const STICKERS = ["🎉", "😊", "👍", "❤️", "🙏", "😂", "🔥", "✅"];
const DAY_MS = 24 * 60 * 60 * 1000;

function inServiceWindow(lastInboundAt) {
  return !!lastInboundAt && Date.now() - new Date(lastInboundAt).getTime() < DAY_MS;
}

function VoiceComposer({ onCancel, onSend }) {
  const [recording, setRecording] = useState(true);
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!recording) return;
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [recording]);
  const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
  const ss = String(seconds % 60).padStart(2, "0");

  if (recording) {
    return (
      <div className="flex items-center gap-3 px-3 py-2.5" style={{ border: `1px solid ${C.rust}`, borderRadius: 10, background: C.rustSoft }}>
        <span className="w-2 h-2 rounded-full animate-pulse" style={{ background: C.rust }} />
        <span className="text-[12.5px] flex-1" style={{ fontFamily: F.m, color: C.rust }}>Recording (demo)... {mm}:{ss}</span>
        <button onClick={onCancel} className="text-[11.5px] font-medium px-2.5 py-1" style={{ fontFamily: F.b, color: C.inkSoft }}>Delete</button>
        <button onClick={() => setRecording(false)} className="flex items-center gap-1 text-[11.5px] font-medium px-2.5 py-1 text-white" style={{ fontFamily: F.b, background: C.rust, borderRadius: 6 }}><Square size={11} /> Stop</button>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-3 px-3 py-2.5" style={{ border: `1px solid ${C.hairline}`, borderRadius: 10 }}>
      <Play size={16} color={C.jade} />
      <div className="flex-1 h-[3px]" style={{ background: C.hairlineSoft, borderRadius: 3 }}><div style={{ width: "40%", height: 3, background: C.jade, borderRadius: 3 }} /></div>
      <span className="text-[11px]" style={{ fontFamily: F.m, color: C.inkSoft }}>{mm}:{ss}</span>
      <button onClick={onCancel}><Trash2 size={14} color={C.inkSoft} /></button>
      <button onClick={() => onSend(seconds)} className="p-1.5" style={{ background: C.jade, borderRadius: 7 }}><Send size={13} color="white" /></button>
    </div>
  );
}

/** Delivery state of an outgoing message — WhatsApp-style ticks. */
function StatusTick({ status }) {
  const t = { queued: [Clock, C.inkFaint, "Queued"], sent: [Check, C.inkFaint, "Sent"], delivered: [CheckCheck, C.inkFaint, "Delivered"],
    read: [CheckCheck, C.blue, "Read"], failed: [AlertCircle, C.rust, "Failed"], undelivered: [AlertCircle, C.rust, "Not delivered"] }[status]
    || [Check, C.inkFaint, status];
  const [Icon, color, label] = t;
  return <span title={label} className="inline-flex"><Icon size={13} color={color} /></span>;
}

function MediaPreview({ msg, light }) {
  const url = msg.media_url;
  if (!url || !/^https?:\/\//.test(url)) return <span style={{ opacity: 0.7 }}>[{msg.type}{msg.type === "voice" && msg.duration_seconds ? ` · ${msg.duration_seconds}s` : ""}]</span>;
  if (msg.type === "image" || msg.type === "sticker") {
    return <a href={url} target="_blank" rel="noreferrer"><img src={url} alt={msg.type} style={{ maxWidth: 220, maxHeight: 220, borderRadius: 6, display: "block" }} onError={(e) => { e.currentTarget.replaceWith(document.createTextNode("[image — open link]")); }} /></a>;
  }
  if (msg.type === "video") return <video src={url} controls style={{ maxWidth: 240, borderRadius: 6 }} />;
  if (msg.type === "voice") return <audio src={url} controls style={{ maxWidth: 240 }} />;
  return <a href={url} target="_blank" rel="noreferrer" style={{ color: light ? "white" : C.jade, textDecoration: "underline" }}>Open attachment</a>;
}

function Bubble({ msg }) {
  if (msg.sender === "system") {
    return <div className="flex justify-center my-3"><span className="text-[11px] px-3 py-1 text-center" style={{ fontFamily: F.b, color: C.inkSoft, background: msg.type === "note" ? C.amberSoft : C.panelDeep, borderRadius: 6, maxWidth: "80%" }}>{msg.type === "note" ? "📝 " : ""}{msg.text}</span></div>;
  }
  const isCustomer = msg.sender === "customer";
  const isBot = msg.sender === "bot";
  const failed = msg.status === "failed" || msg.status === "undelivered";
  return (
    <div className={`flex mb-2.5 ${isCustomer ? "justify-start" : "justify-end"}`}>
      <div className="max-w-[62%]">
        {isBot && <div className="flex items-center gap-1 mb-1 justify-end"><Bot size={11} color={C.amber} /><span className="text-[10.5px] font-medium" style={{ fontFamily: F.b, color: C.amber }}>Automated reply</span></div>}
        {msg.campaign_id && <div className="flex items-center gap-1 mb-1 justify-end"><Megaphone size={11} color={C.blue} /><span className="text-[10.5px] font-medium" style={{ fontFamily: F.b, color: C.blue }}>Campaign</span></div>}
        <div className="px-3.5 py-2.5 text-[13.5px] leading-relaxed" style={{ fontFamily: F.b, color: isCustomer ? C.ink : "white", background: isCustomer ? C.white : failed ? C.rust : isBot ? C.amber : C.jade, border: isCustomer ? `1px solid ${C.hairline}` : "none", borderRadius: isCustomer ? "10px 10px 10px 2px" : "10px 10px 2px 10px", whiteSpace: "pre-wrap", wordBreak: "break-word", opacity: failed ? 0.9 : 1 }}>
          {msg.type !== "text" && <div className={msg.text ? "mb-1.5" : ""}><MediaPreview msg={msg} light={!isCustomer} /></div>}
          {msg.text}
          {msg.type === "text" && !msg.text && <span style={{ opacity: 0.7 }}>[template message]</span>}
        </div>
        <div className={`flex items-center gap-1 mt-1 ${isCustomer ? "justify-start" : "justify-end"}`}>
          <span className="text-[10.5px]" style={{ fontFamily: F.m, color: C.inkFaint }}>{fmtDateTime(msg.created_at)}</span>
          {!isCustomer && <StatusTick status={msg.status} />}
        </div>
        {failed && (
          <div className="text-[10.5px] mt-0.5 text-right" style={{ fontFamily: F.b, color: C.rust }}>
            Not delivered{msg.error_message ? `: ${msg.error_message}` : ""}
            {msg.error_code && <> (<a href={`https://www.twilio.com/docs/api/errors/${msg.error_code}`} target="_blank" rel="noreferrer" style={{ textDecoration: "underline" }}>error {msg.error_code}</a>)</>}
          </div>
        )}
      </div>
    </div>
  );
}

function MediaModal({ initialType = "image", onClose, onSend }) {
  const [type, setType] = useState(initialType);
  const [url, setUrl] = useState("");
  const [caption, setCaption] = useState("");
  const valid = /^https:\/\/\S+$/.test(url.trim());
  return (
    <Modal title="Send media" onClose={onClose} width={440}>
      <Field label="Type">
        <select style={inputStyle} value={type} onChange={(e) => setType(e.target.value)}>
          <option value="image">Image (JPG / PNG)</option>
          <option value="video">Video (MP4)</option>
          <option value="voice">Audio / voice note (MP3 / OGG)</option>
        </select>
      </Field>
      <Field label="Public file link (https)">
        <input style={inputStyle} placeholder="https://yourdomain.com/offer.jpg" value={url} onChange={(e) => setUrl(e.target.value)} />
      </Field>
      <Field label="Caption (optional)">
        <input style={inputStyle} value={caption} onChange={(e) => setCaption(e.target.value)} />
      </Field>
      <div className="text-[11px] mb-3" style={{ fontFamily: F.b, color: C.inkFaint }}>WhatsApp downloads the file from this link, so it must be publicly reachable. Max 16 MB.</div>
      <div className="flex gap-2"><GhostBtn onClick={onClose}>Cancel</GhostBtn><PrimaryBtn disabled={!valid} onClick={() => onSend({ type, media_url: url.trim(), text: caption.trim() || undefined })}>Send</PrimaryBtn></div>
    </Modal>
  );
}

/** Rows of {{1}}, {{2}}... values for a WhatsApp template. */
function TemplateVariablesEditor({ vars, setVars }) {
  return (
    <div>
      {vars.map((v, i) => (
        <div key={i} className="flex items-center gap-2 mb-2">
          <span className="text-[11.5px] shrink-0" style={{ fontFamily: F.m, color: C.inkSoft, width: 44 }}>{`{{${i + 1}}}`}</span>
          <input style={inputStyle} value={v} placeholder={i === 0 ? "e.g. {{name}} or Rahul" : "value"} onChange={(e) => setVars(vars.map((x, j) => (j === i ? e.target.value : x)))} />
          <button type="button" onClick={() => setVars(vars.filter((_, j) => j !== i))} title="Remove"><X size={14} color={C.inkSoft} /></button>
        </div>
      ))}
      <button type="button" onClick={() => setVars([...vars, ""])} className="text-[11.5px] font-medium" style={{ fontFamily: F.b, color: C.jade }}>+ Add variable</button>
    </div>
  );
}
function varsToObject(vars) {
  const o = {};
  vars.forEach((v, i) => { if (v.trim()) o[String(i + 1)] = v.trim(); });
  return Object.keys(o).length ? o : undefined;
}

function TemplateModal({ onClose, onSend }) {
  const [sid, setSid] = useState("");
  const [vars, setVars] = useState([""]);
  const valid = /^HX[0-9a-fA-F]{32}$/.test(sid.trim());
  return (
    <Modal title="Send WhatsApp template" onClose={onClose} width={460}>
      <div className="text-[11.5px] mb-3 px-3 py-2" style={{ fontFamily: F.b, color: C.inkSoft, background: C.panelDeep, borderRadius: 6 }}>
        Templates are pre-approved messages — the only kind WhatsApp delivers when the customer hasn't written in the last 24 hours.
        Create one in Twilio Console → Messaging → Content Template Builder and copy its <b>Content SID</b> (starts with HX).
      </div>
      <Field label="Content SID"><input style={inputStyle} placeholder="HXxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" value={sid} onChange={(e) => setSid(e.target.value)} /></Field>
      <Field label="Template variables"><TemplateVariablesEditor vars={vars} setVars={setVars} /></Field>
      <div className="flex gap-2 mt-2"><GhostBtn onClick={onClose}>Cancel</GhostBtn><PrimaryBtn disabled={!valid} onClick={() => onSend({ type: "text", content_sid: sid.trim(), content_variables: varsToObject(vars) })}>Send template</PrimaryBtn></div>
    </Modal>
  );
}

/** Which provider is live (mock / twilio) + webhook URLs. Fetched once per session. */
let waStatusCache = null;
function useWhatsAppStatus() {
  const { token } = useAuth();
  const [status, setStatus] = useState(waStatusCache);
  useEffect(() => {
    if (waStatusCache || !token) return;
    apiFetch("/system/whatsapp", { token }).then((s) => { waStatusCache = s; setStatus(s); }, () => {});
  }, [token]);
  return status;
}

function CustomerPanel({ contact }) {
  const { token } = useAuth();
  const [note, setNote] = useState("");
  const [showNote, setShowNote] = useState(false);
  const [full, setFull] = useState(null); // full contact record (notes, status, tags)
  const [noteError, setNoteError] = useState(null);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    apiFetch(`/contacts/${contact.id}`, { token }).then(
      (c) => { if (!cancelled) setFull(c); },
      () => { if (!cancelled) setFull(null); }
    );
    return () => { cancelled = true; };
  }, [contact.id, token]);

  const saveNote = async () => {
    if (!note.trim()) return;
    setNoteError(null);
    try {
      const updated = await apiFetch(`/contacts/${contact.id}/notes`, { method: "POST", token, body: { note: note.trim() } });
      setFull(updated);
      setShowNote(false);
      setNote("");
    } catch (err) {
      setNoteError(err.message);
    }
  };
  const notes = (full?.notes || "").split("\n").filter(Boolean);

  return (
    <div className="relay-customer-panel h-full flex flex-col" style={{ borderLeft: `1px solid ${C.hairline}`, background: C.bg, width: 280 }}>
      <div className="flex flex-col items-center py-4" style={{ borderBottom: `1px solid ${C.hairline}` }}>
        <div className="w-12 h-12 flex items-center justify-center text-[16px] font-semibold text-white mb-2" style={{ background: colorForId(contact.id), borderRadius: 9 }}>{initials(contact.name)}</div>
        <span className="text-[13.5px] font-medium" style={{ fontFamily: F.b, color: C.ink }}>{contact.name}</span>
        <span className="text-[11.5px]" style={{ fontFamily: F.m, color: C.inkSoft }}>{contact.phone}</span>
        {full?.opted_out && <span className="text-[10.5px] font-medium px-2 py-0.5 mt-2" style={{ fontFamily: F.b, color: C.rust, background: C.rustSoft, borderRadius: 5 }}>Opted out (STOP)</span>}
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-3.5 space-y-2.5">
        {[["Email", contact.email || "—"], ["City", full?.city || "—"], ["Status", full?.status || "—"], ["Source", full?.source || "—"]].map(([k, v]) => (
          <div key={k} className="flex items-start justify-between gap-3"><span className="text-[11.5px] shrink-0" style={{ fontFamily: F.b, color: C.inkSoft }}>{k}</span><span className="text-[11.5px] font-medium text-right" style={{ fontFamily: F.b, color: C.ink }}>{v}</span></div>
        ))}
        {full?.tags?.length > 0 && (
          <div className="flex flex-wrap gap-1">{full.tags.map((t) => <span key={t} className="text-[10px] px-1.5 py-0.5" style={{ fontFamily: F.b, color: C.jade, background: C.jadeSoft, borderRadius: 4 }}>{t}</span>)}</div>
        )}
        <div style={{ borderTop: `1px solid ${C.hairlineSoft}` }} className="pt-3">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[11.5px]" style={{ fontFamily: F.b, color: C.inkSoft }}>Notes</span>
            <button onClick={() => setShowNote(true)} className="text-[11px] font-medium" style={{ fontFamily: F.b, color: C.jade }}>+ Add</button>
          </div>
          {notes.length === 0 && <div className="text-[11px]" style={{ fontFamily: F.b, color: C.inkFaint }}>No notes yet.</div>}
          {notes.map((n, i) => (
            <div key={i} className="text-[11.5px] px-2.5 py-1.5 mb-1.5" style={{ fontFamily: F.b, color: C.ink, background: C.white, border: `1px solid ${C.hairlineSoft}`, borderRadius: 6 }}>{n}</div>
          ))}
        </div>
      </div>
      {showNote && (
        <Modal title="Add note" onClose={() => setShowNote(false)} width={360}>
          <textarea style={{ ...inputStyle, minHeight: 90 }} placeholder="Write a note about this customer..." value={note} onChange={(e) => setNote(e.target.value)} />
          {noteError && <div className="text-[11.5px] mt-2" style={{ fontFamily: F.b, color: C.rust }}>{noteError}</div>}
          <div className="flex gap-2 mt-3"><GhostBtn onClick={() => setShowNote(false)}>Cancel</GhostBtn><PrimaryBtn disabled={!note.trim()} onClick={saveNote}>Save note</PrimaryBtn></div>
        </Modal>
      )}
    </div>
  );
}

function InboxPage() {
  const { token } = useAuth();
  const wa = useWhatsAppStatus();
  const live = !!wa?.live;
  const [filter, setFilter] = useState("all");
  // Refreshes every 5 s so messages arriving via the Twilio webhook show up.
  const conversations = useApiList("/inbox/conversations", { params: { status: filter === "all" ? undefined : filter }, refreshMs: 5000 });
  const [activeConvId, setActiveConvId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [sendError, setSendError] = useState(null);
  const [composerMode, setComposerMode] = useState(null); // null | "voice" | "stickers" | "media:image" | "media:video" | "template"
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [mobileThreadOpen, setMobileThreadOpen] = useState(false);
  const threadRef = useRef(null);
  const lastCountRef = useRef(0);

  // pick the first conversation once the list loads
  useEffect(() => {
    if (!activeConvId && conversations.data.length > 0) setActiveConvId(conversations.data[0].id);
  }, [conversations.data, activeConvId]);

  // load the open conversation, then keep it fresh (new replies, delivery ticks)
  useEffect(() => {
    if (!activeConvId || !token) return;
    let cancelled = false;
    setDetailLoading(true);
    setSendError(null);
    const load = (first) => apiFetch(`/inbox/conversations/${activeConvId}`, { token }).then(
      (d) => { if (!cancelled) { setDetail(d); if (first) setDetailLoading(false); } },
      () => { if (!cancelled && first) setDetailLoading(false); }
    );
    load(true);
    const t = setInterval(() => load(false), 4000);
    return () => { cancelled = true; clearInterval(t); };
  }, [activeConvId, token]);

  // scroll to the newest message when the count changes
  useEffect(() => {
    const n = detail?.messages?.length || 0;
    if (n !== lastCountRef.current && threadRef.current) threadRef.current.scrollTop = threadRef.current.scrollHeight;
    lastCountRef.current = n;
  }, [detail]);

  const sendMessage = async (payload) => {
    if (!activeConvId) return;
    setSending(true);
    setSendError(null);
    setComposerMode(null);
    try {
      const msg = await apiFetch(`/inbox/conversations/${activeConvId}/messages`, { method: "POST", token, body: payload });
      const fresh = await apiFetch(`/inbox/conversations/${activeConvId}`, { token });
      setDetail(fresh);
      if (payload.type === "text" && !payload.content_sid) setDraft("");
      if (msg.status === "failed") setSendError(`WhatsApp rejected the message${msg.error_message ? `: ${msg.error_message}` : ""}`);
      conversations.refresh();
    } catch (err) {
      setSendError(err.message);
    } finally {
      setSending(false);
    }
  };

  const statusColor = { needs_human: C.rust, bot: C.amber, human: C.jade };
  const windowOpen = detail && inServiceWindow(detail.last_inbound_at);

  if (conversations.error) return <ErrorBanner message={conversations.error} onRetry={conversations.reload} />;

  return (
    <div className={`relay-inbox flex${mobileThreadOpen ? " relay-inbox-show-thread" : ""}`} style={{ height: "calc(100vh - 108px)", background: C.panel, border: `1px solid ${C.hairline}`, borderRadius: 8, overflow: "hidden" }}>
      <div className="relay-inbox-list flex flex-col shrink-0" style={{ width: 300, borderRight: `1px solid ${C.hairline}` }}>
        <div className="px-3.5 pt-3.5 pb-2.5 flex items-center justify-between gap-2">
          <div className="flex gap-1">
            {[["all", "All"], ["needs_human", "Needs human"], ["bot", "Bot"]].map(([k, l]) => (
              <button key={k} onClick={() => setFilter(k)} className="text-[11px] px-2 py-1 font-medium" style={{ fontFamily: F.b, borderRadius: 5, color: filter === k ? "white" : C.inkSoft, background: filter === k ? C.ink : "transparent" }}>{l}</button>
            ))}
          </div>
          <span className="text-[10px] px-1.5 py-0.5 shrink-0" title={live ? "Messages really go out over WhatsApp" : "Demo mode — nothing is really sent"} style={{ fontFamily: F.b, color: live ? C.jade : C.amber, background: live ? C.jadeSoft : C.amberSoft, borderRadius: 4 }}>{live ? "Live · Twilio" : "Demo mode"}</span>
        </div>
        <div className="flex-1 overflow-y-auto">
          {conversations.loading && <div className="px-3.5 py-6 text-[12px]" style={{ fontFamily: F.b, color: C.inkFaint }}>Loading conversations...</div>}
          {!conversations.loading && conversations.data.length === 0 && <div className="px-3.5 py-6 text-[12px]" style={{ fontFamily: F.b, color: C.inkFaint }}>No conversations yet.</div>}
          {conversations.data.map((c) => {
            const active = c.id === activeConvId;
            return (
              <button key={c.id} onClick={() => { setActiveConvId(c.id); setMobileThreadOpen(true); }} className="w-full text-left px-3.5 py-2.5 flex items-start gap-2.5" style={{ borderBottom: `1px solid ${C.hairlineSoft}`, background: active ? C.panelDeep : "transparent", borderLeft: active ? `2px solid ${C.jade}` : "2px solid transparent" }}>
                <div className="w-8 h-8 flex items-center justify-center text-[11px] font-semibold text-white shrink-0" style={{ background: colorForId(c.contact.id), borderRadius: 7 }}>{initials(c.contact.name)}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <span className="text-[12.5px] font-medium truncate" style={{ fontFamily: F.b, color: C.ink }}>{c.contact.name}</span>
                    <span className="text-[10px] shrink-0" style={{ fontFamily: F.m, color: C.inkFaint }}>{fmtDateTime(c.last_message_at)}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-[6px] h-[6px] rounded-full shrink-0" style={{ background: statusColor[c.status] }} />
                    <span className="text-[11.5px] truncate" style={{ fontFamily: F.b, color: C.inkSoft }}>{c.contact.phone}</span>
                  </div>
                </div>
                {c.unread_count > 0 && <span className="text-[10px] font-semibold text-white w-[16px] h-[16px] flex items-center justify-center shrink-0 mt-0.5" style={{ background: C.jade, borderRadius: 4, fontFamily: F.m }}>{c.unread_count}</span>}
              </button>
            );
          })}
        </div>
      </div>

      <div className="relay-inbox-thread flex-1 flex flex-col min-w-0">
        {!detail || detailLoading ? (
          <div className="flex-1 flex items-center justify-center text-[12.5px]" style={{ fontFamily: F.b, color: C.inkFaint }}>{detailLoading ? "Loading conversation..." : "Select a conversation"}</div>
        ) : (
          <>
            <div className="flex items-center justify-between px-3 py-2" style={{ borderBottom: `1px solid ${C.hairline}` }}>
              <div className="flex items-center gap-2.5 min-w-0">
                <button type="button" className="relay-inbox-back p-1.5 shrink-0" onClick={() => setMobileThreadOpen(false)} aria-label="Back to conversations" title="Back to conversations"><ChevronLeft size={18} color={C.inkSoft} /></button>
                <div className="w-8 h-8 flex items-center justify-center text-[11px] font-semibold text-white" style={{ background: colorForId(detail.contact.id), borderRadius: 7 }}>{initials(detail.contact.name)}</div>
                <div>
                  <div className="text-[13px] font-medium" style={{ fontFamily: F.b, color: C.ink }}>{detail.contact.name}</div>
                  <div className="text-[11px]" style={{ fontFamily: F.m, color: C.inkSoft }}>{detail.contact.phone} · via {detail.whatsapp_number_phone}</div>
                </div>
              </div>
              {detail.status === "needs_human" && <span className="text-[10.5px] font-medium px-2 py-1" style={{ fontFamily: F.b, color: C.rust, background: C.rustSoft, borderRadius: 5 }}>Needs human</span>}
            </div>
            <div ref={threadRef} className="relay-thread-messages flex-1 overflow-y-auto px-5 py-4">
              {detail.messages.length === 0 && <div className="text-[12px] text-center py-8" style={{ fontFamily: F.b, color: C.inkFaint }}>No messages yet.</div>}
              {detail.messages.map((m) => <Bubble key={m.id} msg={m} />)}
            </div>
            <div className="relay-thread-composer px-4 py-3" style={{ borderTop: `1px solid ${C.hairline}` }}>
              {live && !windowOpen && (
                <div className="flex items-center justify-between gap-2 px-3 py-2 mb-2 text-[11.5px]" style={{ fontFamily: F.b, color: C.ink, background: C.amberSoft, borderRadius: 7 }}>
                  <span><b>24-hour window closed.</b> {detail.contact.name} hasn't messaged in the last 24h, so WhatsApp only delivers an approved template.</span>
                  <button onClick={() => setComposerMode("template")} className="shrink-0 text-[11.5px] font-medium px-2.5 py-1 text-white" style={{ background: C.amber, borderRadius: 6 }}>Send template</button>
                </div>
              )}
              {sendError && <div className="text-[11.5px] mb-2" style={{ fontFamily: F.b, color: C.rust }}>{sendError}</div>}
              {composerMode === "voice" ? (
                <VoiceComposer onCancel={() => setComposerMode(null)} onSend={(secs) => sendMessage({ type: "voice", duration_seconds: secs, media_url: "mock://voice.ogg" })} />
              ) : (
                <div className="relative flex items-end gap-1.5 px-2.5 py-1.5" style={{ border: `1px solid ${C.hairline}`, borderRadius: 10 }}>
                  <div className="relay-composer-icons flex items-center">
                    <IconBtn icon={Paperclip} onClick={() => setComposerMode("media:image")} />
                    <IconBtn icon={ImageIcon} onClick={() => setComposerMode("media:image")} />
                    <IconBtn icon={Video} onClick={() => setComposerMode("media:video")} />
                    <IconBtn icon={FileText} onClick={() => setComposerMode("template")} active={composerMode === "template"} />
                    <IconBtn icon={Smile} onClick={() => setComposerMode(composerMode === "stickers" ? null : "stickers")} active={composerMode === "stickers"} />
                    <textarea value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Write a reply..." rows={1}
                      onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && draft.trim() && !sending) { e.preventDefault(); sendMessage({ type: "text", text: draft }); } }}
                      className="relay-thread-input flex-1 bg-transparent outline-none resize-none text-[13px] py-1.5" style={{ fontFamily: F.b, color: C.ink }} />
                    {!live && <IconBtn icon={Mic} onClick={() => setComposerMode("voice")} />}
                    <button disabled={sending || !draft.trim()} onClick={() => sendMessage({ type: "text", text: draft })} className="p-2" style={{ background: sending || !draft.trim() ? C.gray : C.jade, borderRadius: 7 }}><Send size={14} color="white" /></button>
                  </div>
                  {composerMode === "stickers" && (
                    <div className="absolute bottom-11 left-2 grid grid-cols-4 gap-1 p-2" style={{ background: C.white, border: `1px solid ${C.hairline}`, borderRadius: 8, zIndex: 5 }}>
                      {STICKERS.map((s) => <button key={s} onClick={() => sendMessage({ type: "text", text: s })} className="text-[20px] p-1.5">{s}</button>)}
                    </div>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {detail && <CustomerPanel key={detail.contact.id} contact={detail.contact} />}
      {composerMode?.startsWith("media:") && <MediaModal initialType={composerMode.slice(6)} onClose={() => setComposerMode(null)} onSend={sendMessage} />}
      {composerMode === "template" && <TemplateModal onClose={() => setComposerMode(null)} onSend={sendMessage} />}
    </div>
  );
}

// ============================================================
// CONTACT IMPORT — paste numbers or upload a CSV. The backend normalises
// numbers (+91 added to 10-digit ones), merges duplicates and tags the list.
// ============================================================
function splitCsvLine(line, delim) {
  const out = [];
  let cur = "", quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') { cur += '"'; i++; } else quoted = !quoted;
    } else if (ch === delim && !quoted) { out.push(cur.trim()); cur = ""; }
    else cur += ch;
  }
  out.push(cur.trim());
  return out;
}
const digitCount = (s) => (String(s).match(/\d/g) || []).length;
const looksLikePhone = (s) => digitCount(s) >= 8 && !/[a-z]{2,}/i.test(s);

/**
 * Accepts: one number per line · "name, number" lines · several numbers on a
 * line · CSV/TSV with a header row (phone/mobile/number/whatsapp, name, tags).
 * Returns [{ phone, name, tags }].
 */
function parseContactList(text) {
  const lines = String(text || "").replace(/\r/g, "").split("\n").map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return [];
  const delim = [",", ";", "\t"].sort((a, b) => lines[0].split(b).length - lines[0].split(a).length)[0];
  const header = splitCsvLine(lines[0], delim).map((h) => h.toLowerCase());
  const phoneCol = header.findIndex((h) => /phone|mobile|number|whatsapp|contact/.test(h));
  const rows = [];

  if (phoneCol >= 0 && !looksLikePhone(lines[0])) {
    const nameCol = header.findIndex((h, i) => i !== phoneCol && /name/.test(h));
    const tagCol = header.findIndex((h) => /tag|label|group/.test(h));
    for (const line of lines.slice(1)) {
      const cells = splitCsvLine(line, delim);
      if (!cells[phoneCol]) continue;
      rows.push({
        phone: cells[phoneCol], name: nameCol >= 0 ? cells[nameCol] || undefined : undefined,
        tags: tagCol >= 0 && cells[tagCol] ? cells[tagCol].split(/[|/]/).map((t) => t.trim()).filter(Boolean) : [],
      });
    }
    return rows;
  }

  const PHONE_RE = /(\+?\d[\d\s().-]{6,}\d)/;
  for (const line of lines) {
    // each line may use its own separator (people mix "," and ";")
    const lineDelim = [",", ";", "\t"].find((d) => line.includes(d)) || delim;
    let cells = splitCsvLine(line, lineDelim).filter(Boolean);
    // "Ravi 9820011234" — name and number in one cell: split them
    cells = cells.flatMap((c) => {
      if (looksLikePhone(c) || digitCount(c) < 8) return [c];
      const m = c.match(PHONE_RE);
      if (!m) return [c];
      const rest = (c.slice(0, m.index) + " " + c.slice(m.index + m[0].length)).trim();
      return rest ? [rest, m[0].trim()] : [m[0].trim()];
    });
    const phones = cells.filter(looksLikePhone);
    if (phones.length > 1 && phones.length === cells.length) {         // "98200 11234, 98765 43210"
      phones.forEach((p) => rows.push({ phone: p, tags: [] }));
    } else if (phones.length >= 1) {                                    // "Ravi, 98200 11234"
      const name = cells.find((c) => !looksLikePhone(c));
      rows.push({ phone: phones[0], name: name || undefined, tags: [] });
    } else if (cells.length === 1 && digitCount(cells[0]) >= 1) {
      rows.push({ phone: cells[0], tags: [] });                          // let the server explain why it's invalid
    }
  }
  return rows;
}

/** Paste box + file upload + detected-count, shared by the import modal and the campaign wizard. */
function ContactListInput({ text, setText }) {
  const rows = parseContactList(text);
  const readFile = (file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setText(String(reader.result || ""));
    reader.readAsText(file);
  };
  return (
    <div>
      <textarea style={{ ...inputStyle, minHeight: 120, fontFamily: F.m, fontSize: 12 }} value={text} onChange={(e) => setText(e.target.value)}
        placeholder={"One per line, for example:\n9820011234\nRavi Kumar, 98765 43210\n+44 7700 900123"} />
      <div className="flex items-center justify-between mt-1.5 gap-2 flex-wrap">
        <label className="text-[11.5px] font-medium cursor-pointer" style={{ fontFamily: F.b, color: C.jade }}>
          <input type="file" accept=".csv,.txt,text/csv,text/plain" style={{ display: "none" }} onChange={(e) => readFile(e.target.files?.[0])} />
          ⬆ Upload CSV / TXT
        </label>
        <span className="text-[11.5px]" style={{ fontFamily: F.b, color: rows.length ? C.jadeDeep : C.inkFaint }}>{rows.length} number{rows.length === 1 ? "" : "s"} detected</span>
      </div>
      <div className="text-[10.5px] mt-1" style={{ fontFamily: F.b, color: C.inkFaint }}>CSV with a header row works too (columns like <code>name</code>, <code>phone</code>, <code>tags</code>). Excel: File → Save As → CSV.</div>
    </div>
  );
}

function ConsentCheckbox({ checked, onChange }) {
  return (
    <label className="flex items-start gap-2 text-[11.5px] cursor-pointer mt-3" style={{ fontFamily: F.b, color: C.ink }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} style={{ marginTop: 2 }} />
      <span>These people agreed to receive WhatsApp messages from us. <span style={{ color: C.inkSoft }}>Messaging people without consent gets your number reported and blocked by WhatsApp.</span></span>
    </label>
  );
}

function ImportSummary({ result }) {
  return (
    <div className="text-[12px] px-3 py-2.5" style={{ fontFamily: F.b, background: C.jadeSoft, color: C.jadeDeep, borderRadius: 7 }}>
      <b>{result.created}</b> added · <b>{result.updated}</b> already existed{result.duplicates_in_file ? ` · ${result.duplicates_in_file} duplicates skipped` : ""}
      {result.opted_out ? ` · ${result.opted_out} opted out (won't be messaged)` : ""}
      {result.invalid.length > 0 && (
        <div className="mt-1.5" style={{ color: C.rust }}>
          {result.invalid.length} invalid: {result.invalid.slice(0, 5).map((e) => `row ${e.row} "${e.value}" (${e.reason})`).join(", ")}{result.invalid.length > 5 ? "…" : ""}
        </div>
      )}
    </div>
  );
}

function ImportContactsModal({ numbers, onClose, onDone }) {
  const { token } = useAuth();
  const today = new Date().toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  const [numberId, setNumberId] = useState(numbers[0]?.id || "");
  const [text, setText] = useState("");
  const [tag, setTag] = useState(`Import ${today}`);
  const [cc, setCc] = useState("91");
  const [consent, setConsent] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const rows = parseContactList(text);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      setResult(await apiFetch("/contacts/import", { method: "POST", token, body: { whatsapp_number_id: numberId, rows, tag: tag.trim() || null, default_country_code: cc, consent } }));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Import contacts" onClose={result ? onDone : onClose} width={520}>
      {result ? (
        <>
          <ImportSummary result={result} />
          {result.tag && <div className="text-[11.5px] mt-3" style={{ fontFamily: F.b, color: C.inkSoft }}>All of them are tagged <b>{result.tag}</b>. In <b>Campaigns → Create → Audience → Contacts with a tag</b>, type that tag to message exactly this list.</div>}
          <div className="flex gap-2 mt-4"><PrimaryBtn onClick={onDone}>Done</PrimaryBtn></div>
        </>
      ) : (
        <>
          <Field label="WhatsApp number these contacts belong to">
            <select style={inputStyle} value={numberId} onChange={(e) => setNumberId(e.target.value)}>
              {numbers.map((n) => <option key={n.id} value={n.id}>{n.phone} — {n.display_name}</option>)}
            </select>
          </Field>
          <Field label="Numbers"><ContactListInput text={text} setText={setText} /></Field>
          <div className="flex gap-3">
            <div style={{ flex: 2 }}><Field label="Tag this list as"><input style={inputStyle} value={tag} onChange={(e) => setTag(e.target.value)} /></Field></div>
            <div style={{ flex: 1 }}><Field label="Default country code"><input style={inputStyle} value={cc} onChange={(e) => setCc(e.target.value.replace(/[^\d+]/g, "").slice(0, 4))} /></Field></div>
          </div>
          <div className="text-[10.5px] -mt-2" style={{ fontFamily: F.b, color: C.inkFaint }}>Numbers without a + get this code (10-digit Indian mobiles → +91…).</div>
          <ConsentCheckbox checked={consent} onChange={setConsent} />
          {error && <div className="text-[11.5px] mt-3" style={{ fontFamily: F.b, color: C.rust }}>{error}</div>}
          <div className="flex gap-2 mt-4">
            <GhostBtn onClick={onClose}>Cancel</GhostBtn>
            <PrimaryBtn disabled={busy || !rows.length || !consent || !numberId} onClick={submit}>{busy ? "Importing..." : `Import ${rows.length} contact${rows.length === 1 ? "" : "s"}`}</PrimaryBtn>
          </div>
        </>
      )}
    </Modal>
  );
}

// ============================================================
// CRM — server-side pagination and filtering (matches /contacts exactly).
// ============================================================
const CONTACT_STATUSES = ["New", "Contacted", "Replied", "Qualified", "Demo", "Converted", "Lost"];

function CrmPage() {
  const { token } = useAuth();
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [pageNum, setPageNum] = useState(1);
  const [selected, setSelected] = useState(null);
  const [result, setResult] = useState({ items: [], total: 0, total_pages: 1 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [showImport, setShowImport] = useState(false);
  const numbers = useApiList("/numbers");

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    setLoading(true);
    apiFetch("/contacts", { token, params: { page: pageNum, per_page: 10, status: statusFilter === "all" ? undefined : statusFilter, search: search || undefined } })
      .then((d) => { if (!cancelled) { setResult(d); setError(null); } })
      .catch((e) => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [token, pageNum, statusFilter, search, reloadKey]);

  const statusColor = { New: C.blue, Contacted: C.amber, Replied: C.jade, Qualified: C.jade, Demo: C.blue, Converted: C.jade, Lost: C.rust };

  return (
    <div>
      <PageHeader title="Contacts / CRM" desc={loading ? "Loading..." : `${result.total} contacts`} action={<PrimaryBtn disabled={numbers.loading || !numbers.data.length} onClick={() => setShowImport(true)}><span className="flex items-center gap-1.5"><Plus size={13} /> Import contacts</span></PrimaryBtn>} />
      {showImport && <ImportContactsModal numbers={numbers.data} onClose={() => setShowImport(false)} onDone={() => { setShowImport(false); setPageNum(1); setReloadKey((k) => k + 1); }} />}
      <div className="flex items-center gap-2 mb-3">
        <input placeholder="Search name or phone..." value={search} onChange={(e) => { setSearch(e.target.value); setPageNum(1); }} style={{ ...inputStyle, width: 220 }} />
        <div className="flex gap-1.5 flex-wrap">
          <button onClick={() => { setStatusFilter("all"); setPageNum(1); }} className="text-[11.5px] px-3 py-1.5 font-medium" style={{ fontFamily: F.b, borderRadius: 6, color: statusFilter === "all" ? "white" : C.inkSoft, background: statusFilter === "all" ? C.ink : C.panel, border: `1px solid ${statusFilter === "all" ? C.ink : C.hairline}` }}>All</button>
          {CONTACT_STATUSES.map((s) => (
            <button key={s} onClick={() => { setStatusFilter(s); setPageNum(1); }} className="text-[11.5px] px-3 py-1.5 font-medium" style={{ fontFamily: F.b, borderRadius: 6, color: statusFilter === s ? "white" : C.inkSoft, background: statusFilter === s ? C.ink : C.panel, border: `1px solid ${statusFilter === s ? C.ink : C.hairline}` }}>{s}</button>
          ))}
        </div>
      </div>

      {error && <ErrorBanner message={error} onRetry={() => setReloadKey((k) => k + 1)} />}
      {loading && <TableSkeleton rows={8} />}
      {!loading && !error && (
        <>
          <Table columns={["Name", "Phone", "Status", "Tags", "Last Contact", ""]}>
            {result.items.map((c) => (
              <tr key={c.id}>
                <Td><button onClick={() => setSelected(c)} className="font-medium" style={{ color: C.ink }}>{c.name}</button></Td>
                <Td mono>{c.phone}</Td>
                <Td><span className="text-[11px] font-medium px-2 py-0.5" style={{ fontFamily: F.b, color: statusColor[c.status], background: C.panelDeep, borderRadius: 5 }}>{c.status}</span></Td>
                <Td><div className="flex gap-1">{c.opted_out && <span className="text-[10px] px-1.5 py-0.5" style={{ fontFamily: F.b, color: C.rust, background: C.rustSoft, borderRadius: 4 }}>Opted out</span>}{(c.tags || []).slice(0, 2).map((t) => <span key={t} className="text-[10px] px-1.5 py-0.5" style={{ fontFamily: F.b, color: C.jade, background: C.jadeSoft, borderRadius: 4 }}>{t}</span>)}</div></Td>
                <Td>{fmtDate(c.last_contact_at)}</Td>
                <Td><Eye size={13} color={C.inkSoft} /></Td>
              </tr>
            ))}
          </Table>
          <div className="flex items-center justify-between mt-3">
            <span className="text-[11.5px]" style={{ fontFamily: F.b, color: C.inkSoft }}>Page {pageNum} of {result.total_pages} · {result.total} contacts</span>
            <div className="flex gap-1.5">
              <button onClick={() => setPageNum(Math.max(1, pageNum - 1))} className="p-1.5" style={{ border: `1px solid ${C.hairline}`, borderRadius: 6 }}><ChevronLeft size={14} color={C.inkSoft} /></button>
              <button onClick={() => setPageNum(Math.min(result.total_pages, pageNum + 1))} className="p-1.5" style={{ border: `1px solid ${C.hairline}`, borderRadius: 6 }}><ChevronRight size={14} color={C.inkSoft} /></button>
            </div>
          </div>
        </>
      )}

      {selected && (
        <Modal title={selected.name} onClose={() => setSelected(null)} width={440}>
          <div className="flex items-center gap-3 mb-4">
            <div className="w-11 h-11 flex items-center justify-center text-[14px] font-semibold text-white" style={{ background: colorForId(selected.id), borderRadius: 9 }}>{initials(selected.name)}</div>
            <div><div className="text-[13px] font-medium" style={{ fontFamily: F.b, color: C.ink }}>{selected.name}</div><div className="text-[11.5px]" style={{ fontFamily: F.m, color: C.inkSoft }}>{selected.phone}</div></div>
          </div>
          {[["Email", selected.email || "—"], ["City", selected.city || "—"], ["Status", selected.status], ["Source", selected.source || "—"], ["WhatsApp", selected.opted_out ? "Opted out (STOP)" : "Subscribed"], ["Last Contact", fmtDate(selected.last_contact_at)], ["Created", fmtDate(selected.created_at)]].map(([k, v]) => (
            <div key={k} className="flex items-center justify-between py-1.5" style={{ borderBottom: `1px solid ${C.hairlineSoft}` }}>
              <span className="text-[12px]" style={{ fontFamily: F.b, color: C.inkSoft }}>{k}</span>
              <span className="text-[12px] font-medium" style={{ fontFamily: F.b, color: C.ink }}>{v}</span>
            </div>
          ))}
        </Modal>
      )}
    </div>
  );
}

// ============================================================
// CAMPAIGNS — pick a number + audience, write a message (or pick an approved
// template), launch. Sending runs on the server; this page shows live progress.
// ============================================================
const CAMPAIGN_STEPS = ["Details", "Audience", "Message", "Review"];

function CreateCampaignModal({ numbers, onClose, onCreated }) {
  const { token } = useAuth();
  const wa = useWhatsAppStatus();
  const live = !!wa?.live;
  const [step, setStep] = useState(0);
  const [form, setForm] = useState({
    name: "", whatsapp_number_id: numbers[0]?.id || "",
    audienceMode: "all", status: "Replied", tag: "",
    useTemplate: false, message_type: "text", message_text: "", media_url: "", content_sid: "",
    listText: "", listConsent: false, listTag: null, listResult: null,
  });
  const [listBusy, setListBusy] = useState(false);
  const [vars, setVars] = useState([""]);
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  const audienceFilter = form.audienceMode === "status" ? { status: form.status }
    : form.audienceMode === "tag" && form.tag.trim() ? { tag: form.tag.trim() }
    : form.audienceMode === "list" ? { tag: form.listTag || "__unsaved_list__" } : {};
  const listRows = parseContactList(form.listText);

  // Saves the pasted numbers as contacts tagged for this campaign, then targets that tag.
  const saveList = async () => {
    setListBusy(true);
    setError(null);
    try {
      const stamp = new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
      const tag = `Campaign: ${form.name.trim() || "list"} ${stamp}`.slice(0, 60);
      const res = await apiFetch("/contacts/import", { method: "POST", token, body: { whatsapp_number_id: form.whatsapp_number_id, rows: listRows, tag, consent: form.listConsent } });
      set({ listTag: res.tag, listResult: res });
    } catch (err) {
      setError(err.message);
    } finally {
      setListBusy(false);
    }
  };
  const filterKey = JSON.stringify(audienceFilter);

  // live recipient count for the chosen number + audience
  useEffect(() => {
    if (!form.whatsapp_number_id || !token) return;
    let cancelled = false;
    const t = setTimeout(() => {
      apiFetch("/campaigns/audience-preview", { method: "POST", token, body: { whatsapp_number_id: form.whatsapp_number_id, audience_filter: JSON.parse(filterKey) } })
        .then((p) => { if (!cancelled) setPreview(p); }, () => { if (!cancelled) setPreview(null); });
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [form.whatsapp_number_id, filterKey, token]);

  const messageOk = form.useTemplate
    ? /^HX[0-9a-fA-F]{32}$/.test(form.content_sid.trim())
    : form.message_type === "text" ? !!form.message_text.trim() : /^https:\/\/\S+$/.test(form.media_url.trim());
  const listPending = form.audienceMode === "list" && !form.listTag;
  const shownPreview = listPending ? null : preview;
  const canNext = [!!form.name.trim(), !!form.whatsapp_number_id && !listPending && (preview?.recipients ?? 0) > 0, messageOk, true][step];
  const number = numbers.find((n) => n.id === form.whatsapp_number_id);

  const launch = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const body = {
        name: form.name.trim(), whatsapp_number_id: form.whatsapp_number_id, audience_filter: audienceFilter,
        message_type: form.useTemplate ? "text" : form.message_type,
        message_text: form.useTemplate ? null : form.message_text.trim() || null,
        media_url: !form.useTemplate && form.message_type !== "text" ? form.media_url.trim() : null,
        content_sid: form.useTemplate ? form.content_sid.trim() : null,
        content_variables: form.useTemplate ? varsToObject(vars) || null : null,
      };
      const created = await apiFetch("/campaigns", { method: "POST", token, body });
      await apiFetch(`/campaigns/${created.id}/launch`, { method: "POST", token });
      onCreated();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const radio = (mode, label) => (
    <label className="flex items-center gap-2 text-[12.5px] mb-2 cursor-pointer" style={{ fontFamily: F.b, color: C.ink }}>
      <input type="radio" checked={form.audienceMode === mode} onChange={() => set({ audienceMode: mode })} /> {label}
    </label>
  );

  return (
    <Modal title="Create campaign" onClose={onClose} width={540}>
      <div className="flex items-center gap-1 mb-5 flex-wrap">
        {CAMPAIGN_STEPS.map((s, i) => (
          <React.Fragment key={s}>
            <div className="flex items-center gap-1.5">
              <div className="w-5 h-5 flex items-center justify-center text-[10px] font-semibold" style={{ fontFamily: F.b, borderRadius: 999, background: i <= step ? C.jade : C.hairlineSoft, color: i <= step ? "white" : C.inkSoft }}>{i + 1}</div>
              <span className="text-[10.5px] font-medium" style={{ fontFamily: F.b, color: i === step ? C.ink : C.inkFaint }}>{s}</span>
            </div>
            {i < CAMPAIGN_STEPS.length - 1 && <div style={{ width: 14, height: 1, background: C.hairline }} />}
          </React.Fragment>
        ))}
      </div>

      {step === 0 && (
        <>
          <Field label="Campaign name"><input style={inputStyle} value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Diwali Offers Broadcast" /></Field>
          <Field label="Send from WhatsApp number">
            <select style={inputStyle} value={form.whatsapp_number_id} onChange={(e) => set({ whatsapp_number_id: e.target.value })}>
              {numbers.map((n) => <option key={n.id} value={n.id}>{n.phone} — {n.display_name}</option>)}
            </select>
          </Field>
          {live && <div className="text-[11px]" style={{ fontFamily: F.b, color: C.inkFaint }}>The number must be a WhatsApp sender in your Twilio account (for testing: the sandbox number +1 415 523 8886).</div>}
        </>
      )}

      {step === 1 && (
        <>
          <div className="text-[11.5px] font-medium mb-2" style={{ fontFamily: F.b, color: C.inkSoft }}>Who should receive it?</div>
          {radio("all", "All contacts of this number's admin")}
          {radio("status", "Contacts with a CRM status")}
          {form.audienceMode === "status" && (
            <select style={{ ...inputStyle, marginBottom: 10 }} value={form.status} onChange={(e) => set({ status: e.target.value })}>
              {CONTACT_STATUSES.map((s) => <option key={s}>{s}</option>)}
            </select>
          )}
          {radio("tag", "Contacts with a tag")}
          {form.audienceMode === "tag" && <input style={{ ...inputStyle, marginBottom: 10 }} placeholder="e.g. VIP" value={form.tag} onChange={(e) => set({ tag: e.target.value })} />}
          <label className="flex items-center gap-2 text-[12.5px] mb-2 cursor-pointer" style={{ fontFamily: F.b, color: C.ink }}>
            <input type="radio" checked={form.audienceMode === "list"} onChange={() => set({ audienceMode: "list", useTemplate: live ? true : form.useTemplate })} /> Paste numbers / upload a list
          </label>
          {form.audienceMode === "list" && (
            <div className="mb-2">
              {form.listTag ? (
                <>
                  <ImportSummary result={form.listResult} />
                  <button type="button" onClick={() => set({ listTag: null, listResult: null })} className="text-[11.5px] font-medium mt-2" style={{ fontFamily: F.b, color: C.jade }}>Change list</button>
                </>
              ) : (
                <>
                  <ContactListInput text={form.listText} setText={(t) => set({ listText: t })} />
                  <ConsentCheckbox checked={form.listConsent} onChange={(v) => set({ listConsent: v })} />
                  <div className="mt-3"><PrimaryBtn disabled={listBusy || !listRows.length || !form.listConsent} onClick={saveList}>{listBusy ? "Saving..." : `Use these ${listRows.length} number${listRows.length === 1 ? "" : "s"}`}</PrimaryBtn></div>
                </>
              )}
            </div>
          )}
          {!listPending && (
            <div className="mt-3 px-3 py-2.5 text-[12.5px]" style={{ fontFamily: F.b, background: C.jadeSoft, color: C.jadeDeep, borderRadius: 7 }}>
              {shownPreview ? <><b>{shownPreview.recipients}</b> recipient{shownPreview.recipients === 1 ? "" : "s"}{shownPreview.opted_out_skipped ? ` · ${shownPreview.opted_out_skipped} opted out (skipped)` : ""}</> : "Counting..."}
            </div>
          )}
        </>
      )}

      {step === 2 && (
        <>
          <div className="flex gap-1.5 mb-3">
            {[[false, "Write a message"], [true, "Use approved template"]].map(([v, l]) => (
              <button key={l} type="button" onClick={() => set({ useTemplate: v })} className="text-[11.5px] px-3 py-1.5 font-medium" style={{ fontFamily: F.b, borderRadius: 6, color: form.useTemplate === v ? "white" : C.inkSoft, background: form.useTemplate === v ? C.ink : C.panel, border: `1px solid ${form.useTemplate === v ? C.ink : C.hairline}` }}>{l}</button>
            ))}
          </div>
          {!form.useTemplate ? (
            <>
              <Field label="Type">
                <select style={inputStyle} value={form.message_type} onChange={(e) => set({ message_type: e.target.value })}>
                  <option value="text">Text</option><option value="image">Image + caption</option><option value="video">Video + caption</option>
                </select>
              </Field>
              {form.message_type !== "text" && <Field label="Public file link (https)"><input style={inputStyle} placeholder="https://yourdomain.com/offer.jpg" value={form.media_url} onChange={(e) => set({ media_url: e.target.value })} /></Field>}
              <Field label={form.message_type === "text" ? "Message" : "Caption (optional)"}>
                <textarea style={{ ...inputStyle, minHeight: 90 }} value={form.message_text} onChange={(e) => set({ message_text: e.target.value })} placeholder="Hi {{name}}, our Diwali sale is live — 20% off till Sunday!" />
              </Field>
              <div className="text-[11px] mb-1" style={{ fontFamily: F.b, color: C.inkFaint }}>Use <code>{"{{name}}"}</code> for the contact's first name.</div>
              {live && form.audienceMode === "list" && <div className="text-[11.5px] px-3 py-2 mt-2" style={{ fontFamily: F.b, color: "white", background: C.rust, borderRadius: 6 }}><b>These numbers probably never messaged you</b>, so WhatsApp will reject a normal message to them. Switch to <b>Use approved template</b>.</div>}
              {live && form.audienceMode !== "list" && <div className="text-[11px] px-3 py-2 mt-2" style={{ fontFamily: F.b, color: C.ink, background: C.amberSoft, borderRadius: 6 }}>Free-form messages only reach people who messaged you in the last 24 hours (sandbox: people who joined it). To reach everyone, use an approved template.</div>}
            </>
          ) : (
            <>
              <Field label="Content SID (from Twilio Content Template Builder)"><input style={inputStyle} placeholder="HXxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" value={form.content_sid} onChange={(e) => set({ content_sid: e.target.value })} /></Field>
              <Field label="Template variables"><TemplateVariablesEditor vars={vars} setVars={setVars} /></Field>
              <div className="text-[11px]" style={{ fontFamily: F.b, color: C.inkFaint }}>You can use <code>{"{{name}}"}</code> as a value too, e.g. {"{{1}}"} = {"{{name}}"}.</div>
            </>
          )}
        </>
      )}

      {step === 3 && (
        <div className="space-y-0">
          {[["Name", form.name], ["From", number ? `${number.phone} — ${number.display_name}` : "—"],
            ["Audience", form.audienceMode === "all" ? "All contacts" : form.audienceMode === "status" ? `Status: ${form.status}` : form.audienceMode === "list" ? `Pasted list (${form.listTag})` : `Tag: ${form.tag || "—"}`],
            ["Recipients", shownPreview ? String(shownPreview.recipients) : "—"],
            ["Message", form.useTemplate ? `Template ${form.content_sid}` : form.message_type === "text" ? form.message_text : `${form.message_type}: ${form.media_url}`],
            ["Delivery", live ? `Real WhatsApp via ${wa.provider === "wasender" ? "Wasender" : wa.provider === "twilio" ? "Twilio" : wa.provider} · ~${wa.send_interval_seconds}s between messages` : "Demo mode — nothing is really sent"],
          ].map(([k, v]) => (
            <div key={k} className="flex items-start justify-between gap-4 py-1.5" style={{ borderBottom: `1px solid ${C.hairlineSoft}` }}>
              <span className="text-[12px] shrink-0" style={{ fontFamily: F.b, color: C.inkSoft }}>{k}</span>
              <span className="text-[12px] font-medium text-right" style={{ fontFamily: F.b, color: C.ink, wordBreak: "break-word" }}>{v}</span>
            </div>
          ))}
        </div>
      )}

      {error && <div className="text-[11.5px] mt-3" style={{ fontFamily: F.b, color: C.rust }}>{error}</div>}
      <div className="flex justify-between mt-5">
        <GhostBtn onClick={() => (step > 0 ? setStep(step - 1) : onClose())}>{step > 0 ? "Back" : "Cancel"}</GhostBtn>
        <PrimaryBtn disabled={submitting || !canNext} onClick={() => (step === CAMPAIGN_STEPS.length - 1 ? launch() : setStep(step + 1))}>
          {submitting ? "Launching..." : step === CAMPAIGN_STEPS.length - 1 ? `Launch to ${shownPreview?.recipients ?? 0}` : "Next"}
        </PrimaryBtn>
      </div>
    </Modal>
  );
}

function CampaignsPage() {
  const { token } = useAuth();
  const campaigns = useApiList("/campaigns", { refreshMs: 3000 }); // live progress
  const numbers = useApiList("/numbers");
  const [showCreate, setShowCreate] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [actionError, setActionError] = useState(null);

  const act = async (c, action) => {
    setBusyId(c.id);
    setActionError(null);
    try {
      if (action === "pause") await apiFetch(`/campaigns/${c.id}`, { method: "PATCH", token, body: { status: "Paused" } });
      else await apiFetch(`/campaigns/${c.id}/launch`, { method: "POST", token });
      campaigns.refresh();
    } catch (err) {
      setActionError(`${c.name}: ${err.message}`);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div>
      <PageHeader title="Campaigns" desc={campaigns.loading ? "Loading..." : `${campaigns.data.length} campaigns`} action={<PrimaryBtn onClick={() => setShowCreate(true)}><span className="flex items-center gap-1.5"><Plus size={13} /> Create campaign</span></PrimaryBtn>} />
      {actionError && <div className="text-[12px] mb-3 px-3 py-2" style={{ fontFamily: F.b, color: C.rust, background: C.rustSoft, borderRadius: 7 }}>{actionError}</div>}
      {campaigns.error && <ErrorBanner message={campaigns.error} onRetry={campaigns.reload} />}
      {campaigns.loading && <TableSkeleton rows={6} />}
      {!campaigns.loading && !campaigns.error && (
        <Table columns={["Campaign", "Progress", "Recipients", "Sent", "Delivered", "Read", "Replies", "Failed", "Status", ""]}>
          {campaigns.data.map((c) => {
            const done = c.sent + c.failed;
            const pct = c.recipients ? Math.min(100, Math.round((done / c.recipients) * 100)) : 0;
            return (
              <tr key={c.id}>
                <Td><div className="font-medium">{c.name}</div><div className="text-[10.5px]" style={{ color: C.inkFaint }}>{c.content_sid ? "Template" : c.message_type} · {fmtDate(c.created_at)}</div></Td>
                <Td>
                  <div className="flex items-center gap-2">
                    <div style={{ width: 70, height: 5, background: C.hairlineSoft, borderRadius: 3 }}><div style={{ width: `${pct}%`, height: 5, background: c.status === "Failed" ? C.rust : C.jade, borderRadius: 3, transition: "width .4s" }} /></div>
                    <span className="text-[10.5px]" style={{ fontFamily: F.m, color: C.inkSoft }}>{pct}%</span>
                  </div>
                </Td>
                <Td mono>{c.recipients.toLocaleString()}</Td>
                <Td mono>{c.sent.toLocaleString()}</Td>
                <Td mono>{c.delivered.toLocaleString()}</Td>
                <Td mono>{c.read.toLocaleString()}</Td>
                <Td mono>{c.replies}</Td>
                <Td mono>{c.failed}</Td>
                <Td><StatusPill status={c.status} /></Td>
                <Td>
                  {c.status === "Running" && <button disabled={busyId === c.id} onClick={() => act(c, "pause")} className="text-[11px] px-2 py-1" style={{ fontFamily: F.b, color: C.amber, border: `1px solid ${C.amber}`, borderRadius: 6 }}>Pause</button>}
                  {(c.status === "Paused" || c.status === "Draft" || c.status === "Scheduled") && <button disabled={busyId === c.id} onClick={() => act(c, "launch")} className="text-[11px] px-2 py-1" style={{ fontFamily: F.b, color: C.jade, border: `1px solid ${C.jade}`, borderRadius: 6 }}>{c.status === "Paused" ? "Resume" : "Launch"}</button>}
                </Td>
              </tr>
            );
          })}
        </Table>
      )}
      {showCreate && !numbers.loading && (
        <CreateCampaignModal numbers={numbers.data} onClose={() => setShowCreate(false)} onCreated={() => { setShowCreate(false); campaigns.refresh(); }} />
      )}
    </div>
  );
}

// ============================================================
// AUTOMATIONS — list + status are real; the visual canvas below is
// illustrative (the backend stores `flow` as JSON but there's no field-level
// edit endpoint yet — activating/pausing is real, editing nodes isn't).
// ============================================================
function FlowNode({ label, sub, color, icon: Icon }) {
  return (
    <div className="px-3.5 py-2.5 flex items-center gap-2.5" style={{ background: C.white, border: `1px solid ${C.hairline}`, borderLeft: `3px solid ${color}`, borderRadius: 8, minWidth: 200 }}>
      <div className="w-6 h-6 flex items-center justify-center shrink-0" style={{ background: `${color}1A`, borderRadius: 6 }}><Icon size={12} color={color} /></div>
      <div><div className="text-[12px] font-medium" style={{ fontFamily: F.b, color: C.ink }}>{label}</div>{sub && <div className="text-[10.5px]" style={{ fontFamily: F.b, color: C.inkSoft }}>{sub}</div>}</div>
    </div>
  );
}
function FlowArrow() { return <div className="flex justify-center py-1"><ArrowDown size={14} color={C.inkFaint} /></div>; }

function AutomationsPage() {
  const { token } = useAuth();
  const automations = useApiList("/automations");
  const [openBuilder, setOpenBuilder] = useState(null);
  const [busy, setBusy] = useState(false);
  const [flowNodes, setFlowNodes] = useState([]);
  const [editingNode, setEditingNode] = useState(null);
  const [editForm, setEditForm] = useState({
    label: "",
    sub: "",
    messageVariants: [""],
    assignmentMode: "round_robin",
  });
  const [nameDraft, setNameDraft] = useState("");

  const defaultNodes = [
    { id: "trigger", type: "trigger", label: "New customer", sub: "Trigger", icon: "Zap", color: C.blue },
    { id: "welcome", type: "action", label: "Send welcome message", sub: "Text + image", icon: "Send", color: C.jade },
    { id: "delay", type: "delay", label: "Wait 2 hours", sub: "Delay", icon: "Clock", color: C.gray },
    { id: "condition", type: "condition", label: "Customer replied?", sub: "Condition", icon: "GitBranch", color: C.amber },
    { id: "yes", type: "action", label: "Transfer to human", sub: "YES", icon: "UserCog", color: C.jade },
    { id: "no", type: "action", label: "Send follow-up", sub: "NO", icon: "Send", color: C.rust },
  ];

  const openAutomation = (automation) => {
    const saved = Array.isArray(automation.flow?.nodes) ? automation.flow.nodes : [];
    const merged = saved.length >= 4
      ? saved.map((n, i) => ({
          ...n,
          id: n.id || `node-${i}`,
          type: n.type || "action",
          label: n.label || "Step",
          sub: n.sub || n.type || "Action",
          icon: n.icon || (n.type === "trigger" ? "Zap" : "Send"),
          color: n.color || (n.type === "trigger" ? C.blue : C.jade),
        }))
      : defaultNodes;
    setFlowNodes(merged);
    setNameDraft(automation.name || "");
    setOpenBuilder(automation);
  };

  const toggleStatus = async (automation) => {
    const next = automation.status === "Running" ? "Paused" : "Running";
    setBusy(true);
    try {
      const updated = await apiFetch(`/automations/${automation.id}`, { method: "PATCH", token, body: { status: next } });
      automations.reload();
      setOpenBuilder((current) => current?.id === automation.id ? { ...current, ...updated } : current);
    } catch (err) {
      alert(err.message || "Could not update automation status");
    } finally {
      setBusy(false);
    }
  };

  const saveAutomation = async () => {
    if (!openBuilder) return;
    setBusy(true);
    try {
      const updated = await apiFetch(`/automations/${openBuilder.id}`, {
        method: "PATCH",
        token,
        body: {
          name: nameDraft.trim() || openBuilder.name,
          flow: {
            nodes: flowNodes.map(({ color: _color, ...node }) => node),
          },
      } });
      setOpenBuilder({ ...openBuilder, ...updated });
      setEditingNode(null);
      automations.reload();
    } catch (err) {
      alert(err.message || "Could not save automation");
    } finally {
      setBusy(false);
    }
  };

  const iconMap = { Zap, Send, Clock, GitBranch, UserCog };

  const editNode = (node) => {
  setEditingNode(node.id);

  setEditForm({
    label: node.label || "",
    sub: node.sub || "",
    messageVariants:
      Array.isArray(node.messageVariants) && node.messageVariants.length
        ? node.messageVariants
        : [""],
    assignmentMode: node.assignmentMode || "round_robin",
  });
};

  const saveNode = () => {
    setFlowNodes((nodes) =>
      nodes.map((n) =>
        n.id === editingNode
          ? {
              ...n,
              label: editForm.label,
              sub: editForm.sub,
              messageVariants: editForm.messageVariants,
              assignmentMode: editForm.assignmentMode,
            }
          : n
      )
    );

    setEditingNode(null);
  };

  if (openBuilder) {
    return (
      <div>
        <button onClick={() => { setOpenBuilder(null); setEditingNode(null); }} className="flex items-center gap-1 text-[12px] font-medium mb-3" style={{ fontFamily: F.b, color: C.inkSoft }}><ChevronLeft size={14} /> Back to automations</button>
        <PageHeader title="Edit automation" desc="Edit the automation name, timing/action labels, then save changes." action={
          <div className="flex gap-2 flex-wrap justify-end">
            <GhostBtn onClick={() => toggleStatus(openBuilder)}>{openBuilder.status === "Running" ? "Pause" : "Activate"}</GhostBtn>
            <PrimaryBtn disabled={busy} onClick={saveAutomation}><span className="flex items-center gap-1.5"><Save size={13} /> {busy ? "Saving..." : "Save changes"}</span></PrimaryBtn>
          </div>
        } />

        <div className="mb-4" style={{ background: C.panel, border: `1px solid ${C.hairline}`, borderRadius: 8 }}>
          <div className="px-4 py-3" style={{ borderBottom: `1px solid ${C.hairline}` }}>
            <Field label="Automation name"><input style={inputStyle} value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} /></Field>
          </div>
          <div className="flex flex-col items-center py-6 px-3">
            {flowNodes.map((node, index) => {
              const Icon = iconMap[node.icon] || Send;
              const isBranch = node.id === "yes" || node.id === "no";
              return (
                <React.Fragment key={node.id}>
                  {index > 0 && <FlowArrow />}
                  {isBranch ? null : (
                    <div className="relay-flow-edit-row flex items-center gap-2">
                      <FlowNode label={node.label} sub={node.sub} color={node.color} icon={Icon} />
                      <button type="button" onClick={() => editNode(node)} className="p-2 shrink-0" title="Edit this step" aria-label={`Edit ${node.label}`} style={{ border: `1px solid ${C.hairline}`, borderRadius: 7, background: C.white }}><Pencil size={13} color={C.inkSoft} /></button>
                    </div>
                  )}
                  {node.id === "condition" && (
                    <div className="relay-flow-branches flex gap-10 mt-1">
                      {flowNodes.filter((n) => n.id === "yes" || n.id === "no").map((branch) => {
                        const BIcon = iconMap[branch.icon] || Send;
                        return <div key={branch.id} className="flex flex-col items-center"><span className="text-[10px] font-semibold mb-1" style={{ fontFamily: F.b, color: branch.color }}>{branch.sub}</span><div style={{ width: 1, height: 14, background: C.hairline }} /><div className="relay-flow-edit-row flex items-center gap-2"><FlowNode label={branch.label} sub="Action" color={branch.color} icon={BIcon} /><button type="button" onClick={() => editNode(branch)} className="p-2 shrink-0" title="Edit action" aria-label={`Edit ${branch.label}`} style={{ border: `1px solid ${C.hairline}`, borderRadius: 7, background: C.white }}><Pencil size={13} color={C.inkSoft} /></button></div></div>;
                      })}
                    </div>
                  )}
                </React.Fragment>
              );
            })}
          </div>
        </div>

        {editingNode && (
          <Modal title="Edit step" onClose={() => setEditingNode(null)} width={560}>
            <Field label="Action / step">
              <input
                style={inputStyle}
                value={editForm.label}
                onChange={(e) => setEditForm((prev) => ({ ...prev, label: e.target.value }))}
              />
            </Field>

            <Field label="Time / description">
              <input
                style={inputStyle}
                value={editForm.sub}
                onChange={(e) => setEditForm((prev) => ({ ...prev, sub: e.target.value }))}
                placeholder="e.g. Wait 2 hours or Text + image"
              />
            </Field>

            {/message|whatsapp/i.test(editForm.label) && (
              <div className="mt-5" style={{ borderTop: `1px solid ${C.hairline}`, paddingTop: 16 }}>
                <div className="flex items-center justify-between gap-3 mb-2">
                  <div>
                    <div className="text-sm font-semibold" style={{ color: C.ink, fontFamily: F.b }}>
                      WhatsApp message variants
                    </div>
                    <div className="text-xs mt-1" style={{ color: C.inkSoft }}>
                      Add alternative message versions for this automation step.
                    </div>
                  </div>
                  <span className="text-xs" style={{ color: C.inkSoft }}>
                    {editForm.messageVariants.length} variant(s)
                  </span>
                </div>

                {editForm.messageVariants.map((variant, index) => (
                  <div
                    key={index}
                    className="mb-4 p-3"
                    style={{ border: `1px solid ${C.hairline}`, borderRadius: 8, background: C.white }}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-xs font-semibold" style={{ color: C.ink }}>
                        Variant {index + 1}
                      </label>
                      <button
                        type="button"
                        disabled={editForm.messageVariants.length === 1}
                        onClick={() => setEditForm((prev) => ({
                          ...prev,
                          messageVariants: prev.messageVariants.filter((_, i) => i !== index),
                        }))}
                        className="text-xs"
                        style={{
                          color: editForm.messageVariants.length === 1 ? C.inkSoft : C.rust,
                          opacity: editForm.messageVariants.length === 1 ? 0.5 : 1,
                        }}
                      >
                        Remove
                      </button>
                    </div>

                    <textarea
                      value={variant}
                      onChange={(e) => setEditForm((prev) => ({
                        ...prev,
                        messageVariants: prev.messageVariants.map((message, i) =>
                          i === index ? e.target.value : message
                        ),
                      }))}
                      placeholder={`Write message variant ${index + 1}...`}
                      rows={3}
                      style={{ ...inputStyle, width: "100%", minHeight: 84, resize: "vertical", boxSizing: "border-box" }}
                    />
                    <div className="text-xs mt-2" style={{ color: C.inkSoft }}>
                      Preview: {variant.trim() || "Your message preview will appear here."}
                    </div>
                  </div>
                ))}

                <button
                  type="button"
                  onClick={() => setEditForm((prev) => ({
                    ...prev,
                    messageVariants: [...prev.messageVariants, ""],
                  }))}
                  className="text-sm font-medium px-3 py-2"
                  style={{ border: `1px solid ${C.jade}`, color: C.jade, borderRadius: 7, background: C.white }}
                >
                  + Add message variant
                </button>

                <div className="mt-4">
                  <Field label="Message assignment strategy">
                    <select
                      style={inputStyle}
                      value={editForm.assignmentMode}
                      onChange={(e) => setEditForm((prev) => ({ ...prev, assignmentMode: e.target.value }))}
                    >
                      <option value="round_robin">Round-robin — distribute evenly</option>
                      <option value="random">Random — choose a variant randomly</option>
                    </select>
                  </Field>
                  <div className="text-xs mt-2" style={{ color: C.inkSoft }}>
                    This saves the assignment preference. Actual message selection and delivery must be implemented by the backend worker.
                  </div>
                </div>
              </div>
            )}

            <div className="flex gap-2 mt-5">
              <GhostBtn onClick={() => setEditingNode(null)}>Cancel</GhostBtn>
              <PrimaryBtn onClick={saveNode}>Save step</PrimaryBtn>
            </div>
          </Modal>
        )}
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="Automations" desc={automations.loading ? "Loading..." : `${automations.data.length} automations`} />
      {automations.error && <ErrorBanner message={automations.error} onRetry={automations.reload} />}
      {automations.loading && <TableSkeleton rows={5} />}
      {!automations.loading && !automations.error && (
        <Table columns={["Automation", "Status", "Recipients", "Sent", "Delivered", "Replies", "Progress", "Actions"]}>
          {automations.data.map((a) => {
            const progress = a.recipients ? Math.round((a.sent / a.recipients) * 100) : 0;
            return (
              <tr key={a.id}>
                <Td><button onClick={() => openAutomation(a)} className="font-medium text-left" style={{ color: C.ink }}>{a.name}</button></Td>
                <Td><StatusPill status={a.status} /></Td>
                <Td mono>{a.recipients.toLocaleString()}</Td>
                <Td mono>{a.sent.toLocaleString()}</Td>
                <Td mono>{a.delivered.toLocaleString()}</Td>
                <Td mono>{a.replies}</Td>
                <Td><div className="flex items-center gap-2"><div style={{ width: 50, height: 5, background: C.hairlineSoft, borderRadius: 3 }}><div style={{ width: `${progress}%`, height: 5, background: C.jade, borderRadius: 3 }} /></div><span className="text-[10.5px]" style={{ fontFamily: F.m, color: C.inkSoft }}>{progress}%</span></div></Td>
                <Td><div className="flex gap-1.5 items-center"><button type="button" onClick={() => toggleStatus(a)} disabled={busy} className="text-[11px] px-2 py-1" style={{ fontFamily: F.b, color: a.status === "Running" ? C.amber : C.jade, border: `1px solid ${a.status === "Running" ? C.amber : C.jade}`, borderRadius: 6 }}>{a.status === "Running" ? "Pause" : "Activate"}</button><button type="button" onClick={() => openAutomation(a)} className="text-[11px] px-2 py-1" style={{ fontFamily: F.b, color: C.jade, border: `1px solid ${C.jade}`, borderRadius: 6 }}>Edit</button></div></Td>
              </tr>
            );
          })}
        </Table>
      )}
    </div>
  );
}

// ============================================================
// CHATBOT — same pattern: list/status real, flow canvas illustrative.
// ============================================================
function ChatbotPage() {
  const chatbots = useApiList("/chatbots");
  const [openBot, setOpenBot] = useState(null);

  if (openBot) {
    return (
      <div>
        <button onClick={() => setOpenBot(null)} className="flex items-center gap-1 text-[12px] font-medium mb-3" style={{ fontFamily: F.b, color: C.inkSoft }}><ChevronLeft size={14} /> Back to chatbots</button>
        <PageHeader title={openBot.name} desc={`Connected to ${chatbots.data.find((b) => b.id === openBot.id)?.whatsapp_number_id ? "a WhatsApp number" : ""}`} />
        <div style={{ background: C.panel, border: `1px solid ${C.hairline}`, borderRadius: 8 }} className="flex flex-col items-center py-6">
          <FlowNode label="START" color={C.blue} icon={Zap} />
          <FlowArrow />
          <FlowNode label="Welcome message" color={C.jade} icon={Send} />
          <FlowArrow />
          <FlowNode label="Main menu" sub="4 options" color={C.amber} icon={ListTree} />
          <div style={{ width: 1, height: 14, background: C.hairline }} className="mt-1" />
          <div className="flex gap-6 flex-wrap justify-center mt-1">
            {(openBot.flow?.menu || ["Product Information", "Pricing", "FAQ", "Talk to Human"]).map((label) => (
              <FlowNode key={label} label={label} sub={label === "Talk to Human" ? "Assign agent" : "Automated answer"} color={label === "Talk to Human" ? C.rust : C.jade} icon={label === "Talk to Human" ? UserCog : MessageCircle} />
            ))}
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {(openBot.keywords || []).map((k) => <span key={k} className="text-[10.5px] px-2 py-1" style={{ fontFamily: F.b, color: C.amber, background: C.amberSoft, borderRadius: 5 }}>{k}</span>)}
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="Chatbot" desc={chatbots.loading ? "Loading..." : `${chatbots.data.length} bots`} />
      {chatbots.error && <ErrorBanner message={chatbots.error} onRetry={chatbots.reload} />}
      {chatbots.loading && <TableSkeleton rows={4} />}
      {!chatbots.loading && !chatbots.error && (
        <Table columns={["Bot Name", "Status", "Conversations", "Automated Responses", "Human Handoffs", "Actions"]}>
          {chatbots.data.map((b) => (
            <tr key={b.id}>
              <Td><button onClick={() => setOpenBot(b)} className="font-medium" style={{ color: C.ink }}>{b.name}</button></Td>
              <Td><StatusPill status={b.status} /></Td>
              <Td mono>{b.conversations.toLocaleString()}</Td>
              <Td mono>{b.automated_responses.toLocaleString()}</Td>
              <Td mono>{b.human_handoffs}</Td>
              <Td><button onClick={() => setOpenBot(b)} className="flex items-center gap-1 text-[11.5px] font-medium" style={{ fontFamily: F.b, color: C.jade }}>Open builder <ChevronRight size={12} /></button></Td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}

// ============================================================
// ANALYTICS — KPIs, funnel, and campaign-performance chart are real
// (backed by /analytics/summary, /analytics/funnel, /campaigns). The
// messages-over-time and delivery/read/reply-by-day charts need a per-day
// events table the backend doesn't have yet (only rolling today-counters
// exist) — those two stay clearly-labeled synthetic data until that exists.
// ============================================================
function ChartCard({ title, children, height = 220, note }) {
  return (
    <div style={{ background: C.panel, border: `1px solid ${C.hairline}`, borderRadius: 8 }} className="p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="text-[12px] font-semibold" style={{ fontFamily: F.b, color: C.ink }}>{title}</div>
        {note && <span className="text-[10px] px-1.5 py-0.5" style={{ fontFamily: F.b, color: C.amber, background: C.amberSoft, borderRadius: 4 }}>{note}</span>}
      </div>
      <div style={{ height }}><ResponsiveContainer width="100%" height="100%">{children}</ResponsiveContainer></div>
    </div>
  );
}
const axisStyle = { fontSize: 10.5, fontFamily: F.m, fill: C.inkSoft };

function synthTimeSeries(seed) {
  return Array.from({ length: 14 }, (_, i) => {
    const day = i + 1;
    const sent = seed + Math.round(Math.sin(i / 2) * (seed * 0.1)) + i * (seed * 0.01);
    return { day: `Day ${day}`, sent: Math.round(sent), delivered: Math.round(sent * 0.94), read: Math.round(sent * 0.61), replies: Math.round(sent * 0.14) };
  });
}

function AnalyticsPage() {
  const summary = useApiList("/analytics/summary");
  const funnel = useApiList("/analytics/funnel");
  const campaigns = useApiList("/campaigns");

  if (summary.error) return <ErrorBanner message={summary.error} onRetry={() => { summary.reload(); funnel.reload(); campaigns.reload(); }} />;
  if (summary.loading || funnel.loading || campaigns.loading) return <TableSkeleton rows={6} />;

  const s = summary.data;
  const series = synthTimeSeries(Math.max(s.messages_sent / 14, 200));
  const funnelData = funnel.data.map((f, i) => ({ ...f, fill: ["#1F6F54", "#2E8567", "#4A9C7E", "#D98E2E", "#B54A3C"][i] }));

  return (
    <div>
      <PageHeader title="Analytics" desc="Live totals from every WhatsApp number and campaign" />
      <div className="flex flex-wrap gap-3 mb-4">
        <KpiCard label="Messages Sent" value={s.messages_sent.toLocaleString()} accent={C.jade} />
        <KpiCard label="Delivered" value={s.delivered.toLocaleString()} accent={C.blue} />
        <KpiCard label="Read" value={s.read.toLocaleString()} accent={C.blue} />
        <KpiCard label="Replies" value={s.replies.toLocaleString()} accent={C.amber} />
        <KpiCard label="Leads" value={s.leads} accent={C.jade} />
        <KpiCard label="Conversion Rate" value={`${s.conversion_rate}%`} accent={C.jade} />
      </div>

      <div className="relay-chart-grid grid grid-cols-2 gap-4 mb-4">
        <ChartCard title="Messages over time" note="Illustrative">
          <LineChart data={series}>
            <CartesianGrid stroke={C.hairlineSoft} vertical={false} />
            <XAxis dataKey="day" tick={axisStyle} interval={2} axisLine={{ stroke: C.hairline }} tickLine={false} />
            <YAxis tick={axisStyle} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={{ fontFamily: F.b, fontSize: 12, borderRadius: 8, border: `1px solid ${C.hairline}` }} />
            <Line type="monotone" dataKey="sent" stroke={C.jade} strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="replies" stroke={C.amber} strokeWidth={2} dot={false} />
          </LineChart>
        </ChartCard>
        <ChartCard title="Delivery vs read vs reply" note="Illustrative">
          <BarChart data={series.slice(-7)}>
            <CartesianGrid stroke={C.hairlineSoft} vertical={false} />
            <XAxis dataKey="day" tick={axisStyle} axisLine={{ stroke: C.hairline }} tickLine={false} />
            <YAxis tick={axisStyle} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={{ fontFamily: F.b, fontSize: 12, borderRadius: 8, border: `1px solid ${C.hairline}` }} />
            <Bar dataKey="delivered" fill={C.jade} radius={[3, 3, 0, 0]} />
            <Bar dataKey="read" fill={C.blue} radius={[3, 3, 0, 0]} />
            <Bar dataKey="replies" fill={C.amber} radius={[3, 3, 0, 0]} />
          </BarChart>
        </ChartCard>
      </div>

      <div className="relay-chart-grid grid grid-cols-2 gap-4">
        <ChartCard title="Conversion funnel" height={240}>
          <FunnelChart>
            <Tooltip contentStyle={{ fontFamily: F.b, fontSize: 12, borderRadius: 8, border: `1px solid ${C.hairline}` }} />
            <Funnel dataKey="value" data={funnelData} isAnimationActive={false}>
              <LabelList position="right" dataKey="name" fill={C.inkSoft} stroke="none" fontSize={10.5} fontFamily={F.b} />
            </Funnel>
          </FunnelChart>
        </ChartCard>
        <ChartCard title="Campaign performance" height={240}>
          <BarChart layout="vertical" data={campaigns.data.slice(0, 5).map((c) => ({ name: c.name.length > 16 ? c.name.slice(0, 16) + "…" : c.name, delivered: c.delivered }))} margin={{ left: 10 }}>
            <CartesianGrid stroke={C.hairlineSoft} horizontal={false} />
            <XAxis type="number" tick={axisStyle} axisLine={false} tickLine={false} />
            <YAxis type="category" dataKey="name" tick={{ ...axisStyle, fontFamily: F.b }} width={110} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={{ fontFamily: F.b, fontSize: 12, borderRadius: 8, border: `1px solid ${C.hairline}` }} />
            <Bar dataKey="delivered" fill={C.jade} radius={[0, 3, 3, 0]} />
          </BarChart>
        </ChartCard>
      </div>
    </div>
  );
}

// ============================================================
// API KEYS — super admin only, values always masked.
// ============================================================
function ApiKeysPage() {
  const { token } = useAuth();
  const keys = useApiList("/api-keys");
  const [showAdd, setShowAdd] = useState(false);
  const [busyId, setBusyId] = useState(null);

  const test = async (id) => {
    setBusyId(id);
    try { await apiFetch(`/api-keys/${id}/test`, { method: "POST", token }); keys.reload(); } finally { setBusyId(null); }
  };
  const remove = async (id) => {
    setBusyId(id);
    try { await apiFetch(`/api-keys/${id}`, { method: "DELETE", token }); keys.reload(); } finally { setBusyId(null); }
  };

  return (
    <div>
      <PageHeader title="API Keys" desc="Manage WhatsApp API provider connections" action={<PrimaryBtn onClick={() => setShowAdd(true)}><span className="flex items-center gap-1.5"><Plus size={13} /> Add API key</span></PrimaryBtn>} />
      {keys.error && <ErrorBanner message={keys.error} onRetry={keys.reload} />}
      {keys.loading && <TableSkeleton rows={2} />}
      {!keys.loading && !keys.error && (
        <div className="space-y-2.5">
          {keys.data.map((k) => (
            <div key={k.id} className="flex items-center justify-between px-4 py-3" style={{ background: C.panel, border: `1px solid ${C.hairline}`, borderRadius: 8 }}>
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 flex items-center justify-center" style={{ background: C.jadeSoft, borderRadius: 7 }}><Key size={14} color={C.jade} /></div>
                <div><div className="text-[13px] font-medium" style={{ fontFamily: F.b, color: C.ink }}>{k.provider}</div><div className="text-[11.5px]" style={{ fontFamily: F.m, color: C.inkSoft }}>{k.masked}</div></div>
              </div>
              <div className="flex items-center gap-3">
                <StatusPill status={k.status} />
                <button disabled={busyId === k.id} onClick={() => test(k.id)} className="text-[11.5px] font-medium" style={{ fontFamily: F.b, color: C.jade }}>Test</button>
                <button disabled={busyId === k.id} onClick={() => remove(k.id)} className="text-[11.5px] font-medium" style={{ fontFamily: F.b, color: C.rust }}>Remove</button>
              </div>
            </div>
          ))}
        </div>
      )}
      {showAdd && <AddApiKeyModal onClose={() => setShowAdd(false)} onAdded={() => { setShowAdd(false); keys.reload(); }} />}
    </div>
  );
}

function AddApiKeyModal({ onClose, onAdded }) {
  const { token } = useAuth();
  const [form, setForm] = useState({ provider: "Meta", api_key: "", business_account_id: "", phone_number_id: "" });
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await apiFetch("/api-keys", { method: "POST", token, body: form });
      onAdded();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal title="Add API key" onClose={onClose}>
      <Field label="Provider">
        <select style={inputStyle} value={form.provider} onChange={(e) => setForm({ ...form, provider: e.target.value })}>
          <option>Meta</option><option>360dialog</option><option>Twilio</option><option>Gupshup</option>
        </select>
      </Field>
      <Field label="API Key"><input style={inputStyle} type="password" value={form.api_key} onChange={(e) => setForm({ ...form, api_key: e.target.value })} placeholder="Paste API key" /></Field>
      <Field label="Business Account ID"><input style={inputStyle} value={form.business_account_id} onChange={(e) => setForm({ ...form, business_account_id: e.target.value })} placeholder="WABA ID" /></Field>
      <Field label="Phone Number ID"><input style={inputStyle} value={form.phone_number_id} onChange={(e) => setForm({ ...form, phone_number_id: e.target.value })} placeholder="Phone number ID" /></Field>
      {error && <div className="text-[11.5px] mb-3" style={{ fontFamily: F.b, color: C.rust }}>{error}</div>}
      <div className="flex gap-2 mt-4"><GhostBtn onClick={onClose}>Cancel</GhostBtn><PrimaryBtn disabled={submitting || !form.api_key} onClick={submit}>{submitting ? "Saving..." : "Save & connect"}</PrimaryBtn></div>
    </Modal>
  );
}

function ActivityLogsPage() {
  const logs = useApiList("/activity-logs", { params: { limit: 50 } });
  return (
    <div>
      <PageHeader title="Activity Logs" desc="System-wide activity across all admins and numbers" />
      {logs.error && <ErrorBanner message={logs.error} onRetry={logs.reload} />}
      {logs.loading && <TableSkeleton rows={6} />}
      {!logs.loading && !logs.error && (
        logs.data.length === 0 ? (
          <div style={{ background: C.panel, border: `1px solid ${C.hairline}`, borderRadius: 8 }}>
            <EmptyState icon={ScrollText} title="No activity yet" desc="Actions like adding a number, launching a campaign, or starting an automation will show up here." />
          </div>
        ) : (
          <Table columns={["Time", "Type", "Event"]}>
            {logs.data.map((a) => (
              <tr key={a.id}><Td mono>{fmtDateTime(a.created_at)}</Td><Td>{a.type}</Td><Td>{a.message}</Td></tr>
            ))}
          </Table>
        )
      )}
    </div>
  );
}

/** Settings → WhatsApp: is Twilio live, and the webhook URLs to paste into Twilio. */
function WhatsAppSettings() {
  const wa = useWhatsAppStatus();
  const [copied, setCopied] = useState(null);
  if (!wa) return <TableSkeleton rows={3} />;
  const copy = (label, text) => { navigator.clipboard?.writeText(text).then(() => { setCopied(label); setTimeout(() => setCopied(null), 1500); }, () => {}); };
  const row = (label, value, ok) => (
    <div className="flex items-center justify-between gap-4 py-2" style={{ borderBottom: `1px solid ${C.hairlineSoft}` }}>
      <span className="text-[12px]" style={{ fontFamily: F.b, color: C.inkSoft }}>{label}</span>
      <span className="text-[12px] font-medium flex items-center gap-1.5" style={{ fontFamily: F.b, color: ok === false ? C.rust : C.ink }}>{ok === true && <Check size={13} color={C.jade} />}{ok === false && <AlertCircle size={13} color={C.rust} />}{value}</span>
    </div>
  );
  const urlRow = (label, url) => (
    <div className="mb-3">
      <div className="text-[11.5px] font-medium mb-1" style={{ fontFamily: F.b, color: C.inkSoft }}>{label}</div>
      {url ? (
        <div className="flex items-center gap-2">
          <code className="flex-1 text-[11.5px] px-2.5 py-2 truncate" style={{ fontFamily: F.m, background: C.bg, border: `1px solid ${C.hairline}`, borderRadius: 6 }}>{url}</code>
          <button onClick={() => copy(label, url)} className="flex items-center gap-1 text-[11.5px] px-2.5 py-2" style={{ fontFamily: F.b, color: C.jade, border: `1px solid ${C.jade}`, borderRadius: 6 }}><Copy size={12} />{copied === label ? "Copied" : "Copy"}</button>
        </div>
      ) : <div className="text-[11.5px]" style={{ fontFamily: F.b, color: C.inkFaint }}>Set PUBLIC_BASE_URL in the backend .env to get this URL.</div>}
    </div>
  );
  return (
    <div style={{ background: C.panel, border: `1px solid ${C.hairline}`, borderRadius: 8, maxWidth: 640 }} className="px-5 py-4">
      {row("Sending mode", wa.live ? `Live — ${wa.provider}` : "Demo (mock) — nothing is really sent", wa.live)}
      {wa.provider === "twilio" && row("Twilio credentials", wa.credentials_set ? `Set (${wa.account_sid_hint})` : "Missing — add TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN", wa.credentials_set)}
      {row("Public URL (for webhooks)", wa.public_base_url || "Not set — replies & delivery ticks won't arrive", !!wa.public_base_url)}
      {row("Campaign pace", `${wa.send_interval_seconds}s between messages`)}
      <div className="text-[12.5px] font-semibold mt-5 mb-2" style={{ fontFamily: F.d, color: C.ink }}>Paste these into Twilio</div>
      <div className="text-[11.5px] mb-3" style={{ fontFamily: F.b, color: C.inkSoft }}>Twilio Console → Messaging → Try it out → Send a WhatsApp message → <b>Sandbox settings</b> (or your WhatsApp sender's settings). Method: <b>POST</b>.</div>
      {urlRow("When a message comes in", wa.inbound_webhook_url)}
      {urlRow("Status callback URL", wa.status_webhook_url)}
      {!wa.live && <div className="text-[11.5px] mt-3 px-3 py-2" style={{ fontFamily: F.b, color: C.ink, background: C.amberSoft, borderRadius: 6 }}>To go live: in the backend .env set <code>WHATSAPP_MOCK=false</code>, <code>WHATSAPP_PROVIDER=twilio</code> and your Twilio keys, then restart the backend.</div>}
    </div>
  );
}

function SettingsPage({ role }) {
  const { name } = useAuth();
  const [tab, setTab] = useState("profile");
  const tabs = role === "super_admin"
    ? [["profile", "Profile"], ["whatsapp", "WhatsApp"], ["apikeys", "API Keys"]]
    : [["profile", "Profile"], ["whatsapp", "WhatsApp"]];

  return (
    <div>
      <PageHeader title="Settings" />
      <div className="flex gap-1.5 mb-4">
        {tabs.map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} className="text-[12px] px-3 py-1.5 font-medium" style={{ fontFamily: F.b, borderRadius: 6, color: tab === k ? "white" : C.inkSoft, background: tab === k ? C.ink : C.panel, border: `1px solid ${tab === k ? C.ink : C.hairline}` }}>{l}</button>
        ))}
      </div>
      {tab === "whatsapp" ? <WhatsAppSettings /> : tab === "apikeys" ? <ApiKeysPage /> : (
        <div style={{ background: C.panel, border: `1px solid ${C.hairline}`, borderRadius: 8, maxWidth: 420 }} className="px-5 py-4">
          <Field label="Full name"><input style={inputStyle} defaultValue={name} disabled /></Field>
          <div className="text-[11.5px]" style={{ fontFamily: F.b, color: C.inkFaint }}>Profile editing isn't wired to an update endpoint yet — this reads your real logged-in name.</div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// ROOT APP
// ============================================================
function Shell() {
  const { isAuthed, userId } = useAuth();
  if (!isAuthed) return <div className="relay-auth-screen" style={{ minHeight: "100vh" }}><LoginScreen /></div>;
  // Keyed by user so navigation state resets on every sign-in — otherwise an
  // Admin signing in after a Super Admin could land on a super-admin-only page.
  return <Workspace key={userId} />;
}

function Workspace() {
  const { role, token, hiddenPages = [], setHiddenPages } = useAuth();
  const navItems = role === "super_admin" ? NAV_SUPER : NAV_ADMIN.filter((i) => !hiddenPages.includes(i.key));
  const firstPage = navItems[0]?.key || "inbox";
  const [page, setPage] = useState(firstPage);

  // Pick up page-visibility changes made by the Super Admin since sign-in.
  useEffect(() => {
    if (role === "super_admin") return;
    apiFetch("/admins/me", { token }).then((me) => setHiddenPages(me.hidden_pages || [])).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Never render a page this admin is not allowed to see.
  const allowed = navItems.some((i) => i.key === page);
  useEffect(() => { if (!allowed) setPage(firstPage); }, [allowed, firstPage]);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const pageMap = {
    dashboard: role === "super_admin" ? <SuperAdminDashboard /> : <AdminDashboard />,
    admins: <AdminsPage />,
    numbers: <NumbersPage role={role} />,
    inbox: <InboxPage />,
    crm: <CrmPage />,
    campaigns: <CampaignsPage />,
    automations: <AutomationsPage />,
    chatbot: <ChatbotPage />,
    analytics: <AnalyticsPage />,
    activity: <ActivityLogsPage />,
    settings: <SettingsPage role={role} />,
  };

  return (
    <div className="relay-shell flex" style={{ background: C.bg, overflow: "hidden" }}>
      {mobileMenuOpen && (
        <button
          type="button"
          className="relay-mobile-overlay"
          onClick={() => setMobileMenuOpen(false)}
          aria-label="Close navigation"
        />
      )}

      <Sidebar
        role={role}
        page={page}
        setPage={setPage}
        collapsed={sidebarCollapsed}
        setCollapsed={setSidebarCollapsed}
        mobileOpen={mobileMenuOpen}
        setMobileOpen={setMobileMenuOpen}
      />

      <div className="relay-main flex-1 flex flex-col min-w-0 min-h-0">
        <Topbar onMenu={() => { setSidebarCollapsed(false); setMobileMenuOpen(true); }} />
        <div className="relay-page flex-1 px-5 py-5">{allowed ? pageMap[page] : null}</div>
      </div>
    </div>
  );
}

export default function RelayCrmApp() {
  return (
    <div style={{ fontFamily: F.b, background: C.bg }}>
      <style>{FONT_IMPORT + RESPONSIVE_CSS}</style>
      <AuthProvider>
        <Shell />
      </AuthProvider>
    </div>
  );
}
