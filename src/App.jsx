import React, { useState, useEffect, useMemo } from "react";
import {
  LayoutDashboard, Truck, Boxes, Receipt, Factory, ClipboardList,
  Plus, Trash2, Pencil, Check, X, Printer, Search, ChevronDown, ChevronRight, ArrowUpDown,
  Loader2, Lock, LogOut, Users, PackageCheck, Clock
} from "lucide-react";

/* ================= Supabase ================= */
const SUPABASE_URL = "https://eovfcjadpyjxavymtqwf.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_UmpsvgnasiG799Xpw86KlA_UQv-plKX";
let ACCESS_TOKEN = null;
let AUTH_REVISION = 0;
let refreshInFlight = null;
const setAccessToken = (t) => { ACCESS_TOKEN = t; AUTH_REVISION += 1; };
const tokenExpiresSoon = (token) => {
  if (!token) return false;
  try {
    const part = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const { exp } = JSON.parse(atob(part.padEnd(Math.ceil(part.length / 4) * 4, "=")));
    return Number.isFinite(exp) && exp * 1000 <= Date.now() + 60000;
  } catch { return false; }
};
async function refreshAccessToken() {
  // Share one refresh across simultaneous saves/loads and React startup effects.
  if (refreshInFlight) return refreshInFlight;
  const rt = loadRefreshToken();
  if (!rt) throw new Error("Your session has ended. Please sign in again.");
  const revision = AUTH_REVISION;
  refreshInFlight = (async () => {
    try {
      const d = await authRefresh(rt);
      // A sign-out or a different login must not be undone by a late response.
      if (revision !== AUTH_REVISION) throw new Error("Your login changed. Please retry.");
      if (!d?.access_token || !d?.refresh_token) throw new Error("Session refresh returned no login tokens.");
      setAccessToken(d.access_token);
      saveRefreshToken(d.refresh_token);
      return d;
    } catch (e) {
      if (revision === AUTH_REVISION && (e.status === 400 || e.status === 401 || e.status === 403)) {
        setAccessToken(null); clearRefreshToken();
        throw new Error("Your session has ended. Please sign in again.");
      }
      throw e;
    } finally { refreshInFlight = null; }
  })();
  return refreshInFlight;
}
async function sbRequest(path, { method = "GET", body, headers = {} } = {}, retried = false) {
  const isDatabase = path.startsWith("/rest/v1/");
  if (isDatabase && ACCESS_TOKEN && tokenExpiresSoon(ACCESS_TOKEN)) await refreshAccessToken();
  const requestToken = ACCESS_TOKEN;
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    method,
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${(isDatabase && requestToken) || SUPABASE_ANON_KEY}`, "Content-Type": "application/json", ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  if (text) { try { data = JSON.parse(text); } catch { data = text; } }
  if (!res.ok) {
    const msg = (data && (data.message || data.error_description || data.msg || data.error)) || `Request failed (${res.status})`;
    const expiredJwt = res.status === 401 && /(?:jwt|token).*expir|expir.*(?:jwt|token)/i.test(msg);
    if (isDatabase && expiredJwt && !retried && requestToken) {
      // A concurrent request may already have refreshed this token.
      if (ACCESS_TOKEN === requestToken) await refreshAccessToken();
      if (!ACCESS_TOKEN) throw new Error("Your session has ended. Please sign in again.");
      return sbRequest(path, { method, body, headers }, true);
    }
    const error = new Error(msg);
    error.status = res.status;
    throw error;
  }
  return data;
}
const authSignUp = (email, password, fullName) => sbRequest("/auth/v1/signup", { method: "POST", body: { email, password, data: fullName ? { full_name: fullName } : undefined } });
const authSignIn = (email, password) => sbRequest("/auth/v1/token?grant_type=password", { method: "POST", body: { email, password } });
const authRefresh = (rt) => sbRequest("/auth/v1/token?grant_type=refresh_token", { method: "POST", body: { refresh_token: rt } });
const authRecover = (email) => sbRequest("/auth/v1/recover", { method: "POST", body: { email } });
const toCamelKey = (k) => k.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());
const toSnakeKey = (k) => k.replace(/[A-Z]/g, (c) => "_" + c.toLowerCase());
const rowToCamel = (row) => Object.fromEntries(Object.entries(row).map(([k, v]) => [toCamelKey(k), v]));
const rowsToCamel = (rows) => (rows || []).map(rowToCamel);
const objToSnake = (obj) => Object.fromEntries(Object.entries(obj).map(([k, v]) => [toSnakeKey(k), v]));
const sbList = async (table, query = "?select=*") => rowsToCamel(await sbRequest(`/rest/v1/${table}${query}`));
const sbInsert = async (table, rows) => { if (!rows.length) return; await sbRequest(`/rest/v1/${table}`, { method: "POST", body: rows.map(objToSnake), headers: { Prefer: "return=minimal" } }); };
const sbUpdate = async (table, id, patch) => { const { id: _d, ...rest } = patch; await sbRequest(`/rest/v1/${table}?id=eq.${id}`, { method: "PATCH", body: objToSnake(rest), headers: { Prefer: "return=minimal" } }); };
const sbDeleteById = async (table, id) => { await sbRequest(`/rest/v1/${table}?id=eq.${id}`, { method: "DELETE", headers: { Prefer: "return=minimal" } }); };
async function syncTable(table, prevArr, nextArr) {
  const prevMap = new Map(prevArr.map((x) => [x.id, x]));
  const nextMap = new Map(nextArr.map((x) => [x.id, x]));
  const toInsert = nextArr.filter((x) => !prevMap.has(x.id));
  const toDelete = prevArr.filter((x) => !nextMap.has(x.id));
  const toUpdate = nextArr.filter((x) => { const p = prevMap.get(x.id); return p && JSON.stringify(p) !== JSON.stringify(x); });
  const ops = [];
  if (toInsert.length) ops.push(sbInsert(table, toInsert));
  toDelete.forEach((x) => ops.push(sbDeleteById(table, x.id)));
  toUpdate.forEach((x) => ops.push(sbUpdate(table, x.id, x)));
  await Promise.all(ops);
}
const saveRefreshToken = (t) => { try { sessionStorage.setItem("sbs-refresh-token", t); } catch (e) {} };
const loadRefreshToken = () => { try { return sessionStorage.getItem("sbs-refresh-token"); } catch (e) { return null; } };
const clearRefreshToken = () => { try { sessionStorage.removeItem("sbs-refresh-token"); } catch (e) {} };

/* ================= utils ================= */
const uid = () => (window.crypto && crypto.randomUUID) ? crypto.randomUUID() :
  "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => { const r = (Math.random() * 16) | 0; const v = c === "x" ? r : (r & 0x3) | 0x8; return v.toString(16); });
const money = (n) => "Rs " + (Number(n) || 0).toLocaleString("en-PK", { maximumFractionDigits: 0 });
const num = (n, d = 2) => (Number(n) || 0).toLocaleString("en-PK", { minimumFractionDigits: 0, maximumFractionDigits: d });
const todayISO = () => new Date().toISOString().slice(0, 10);
const fmtDate = (d) => {
  if (!d) return "Date not recorded";
  // Supabase may return either a DATE (YYYY-MM-DD) or a full timestamp.
  // Only append a local time to date-only values; appending it to a timestamp
  // produces an invalid string such as "...+00:00T00:00:00".
  const value = String(d).trim();
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T00:00:00`)
    : new Date(value);
  return Number.isNaN(parsed.getTime())
    ? "Date not recorded"
    : parsed.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
};
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const confirmDelete = (label) => window.confirm(`Delete ${label || "this"}? This can't be undone.`);
const lotKey = (v) => String(v ?? "").trim().toLowerCase();
const STATUS_LABEL = { consignment: "In godown", partial: "Partly converted", converted: "Fully converted", purchased: "Purchased", held: "On Hold", pipeline: "In Pipeline" };
const STATUS_TONE = { consignment: "gray", partial: "amber", converted: "blue", purchased: "green", held: "rust", pipeline: "indigo" };
const statusLabel = (s) => STATUS_LABEL[s] || s;
const statusTone = (s) => STATUS_TONE[s] || "gray";
function buildSequentialLabelMap(arr, idKey, prefix) {
  const sorted = [...arr].sort((a, b) => {
    const ca = a.createdAt || "", cb = b.createdAt || "";
    if (ca && cb) return ca < cb ? -1 : ca > cb ? 1 : 0;
    const da = a.date || "", db = b.date || "";
    if (da !== db) return da < db ? -1 : 1;
    return String(a[idKey] || a.id) < String(b[idKey] || b.id) ? -1 : 1;
  });
  const map = new Map(); let n = 0;
  sorted.forEach((x) => { const k = x[idKey] || x.id; if (!map.has(k)) { n += 1; map.set(k, `${prefix}-${n}`); } });
  return map;
}
const groupByDate = (arr) => { const m = {}; arr.forEach((x) => { (m[x.date] = m[x.date] || []).push(x); }); return Object.entries(m).sort((a, b) => (a[0] < b[0] ? 1 : -1)); };
function sortWithin(arr, sortState, getters) {
  if (!sortState || sortState.field === "entry") return arr;
  const getter = getters[sortState.field];
  if (!getter) return arr;
  const dir = sortState.dir === "asc" ? 1 : -1;
  return [...arr].sort((a, b) => (getter(a) - getter(b)) * dir);
}
function printHTML(title, bodyHtml) {
  const iframe = document.createElement("iframe");
  iframe.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;";
  document.body.appendChild(iframe);
  const doc = iframe.contentWindow.document;
  doc.open();
  doc.write(`<!DOCTYPE html><html><head><title>${esc(title)}</title><style>*{box-sizing:border-box}body{font-family:Arial,Helvetica,sans-serif;color:#23261F;padding:24px}h1{font-size:17px;text-transform:uppercase;margin:0 0 4px}.meta{font-size:11px;color:#666;margin-bottom:18px}h2{font-size:12px;text-transform:uppercase;background:#eeece3;padding:5px 8px;margin:18px 0 0}h3{font-size:10.5px;text-transform:uppercase;color:#555;margin:10px 0 2px}table{width:100%;border-collapse:collapse;font-size:11px;margin-bottom:4px}th,td{padding:5px 7px;border-bottom:1px solid #ccc;text-align:left}th{font-size:9px;text-transform:uppercase;color:#666;border-bottom:1.5px solid #23261F}tfoot td{font-weight:bold;border-top:1.5px solid #23261F;border-bottom:none}.tag{font-family:monospace}</style></head><body><h1>${esc(title)}</h1><div class="meta">Printed ${esc(new Date().toLocaleString("en-GB"))}</div>${bodyHtml}</body></html>`);
  doc.close();
  setTimeout(() => { iframe.contentWindow.focus(); iframe.contentWindow.print(); setTimeout(() => { if (iframe.parentNode) document.body.removeChild(iframe); }, 1000); }, 250);
}

/* ================= nav ================= */
const NAV_GROUPS = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard, view: "dashboard" },
  { id: "setup", label: "Setup", icon: ClipboardList, children: [
    { id: "masters-suppliers", label: "Suppliers", view: "masters-suppliers" },
    { id: "masters-brands", label: "Brands", view: "masters-brands" },
    { id: "masters-customers", label: "Customers", view: "masters-customers" },
    { id: "masters-sizes", label: "Packet sizes", view: "masters-sizes" },
    { id: "masters-lifters", label: "Lifters", view: "masters-lifters" },
  ] },
  { id: "pipeline", label: "Reels in Pipeline", icon: Clock, children: [
    { id: "pipeline-entries", label: "Entries", view: "pipeline-entries" },
    { id: "pipeline-report", label: "Report", view: "pipeline-report" },
    { id: "pipeline-edit", label: "Edit", view: "pipeline-edit" },
  ] },
  { id: "reels", label: "Reels in", icon: Boxes, children: [
    { id: "reels-entries", label: "Entries", view: "reels-entries" },
    { id: "reels-report", label: "Report", view: "reels-report" },
    { id: "reels-edit", label: "Edit", view: "reels-edit" },
  ] },
  { id: "hold", label: "Hold Reels", icon: PackageCheck, children: [
    { id: "hold-entries", label: "Hold / Release", view: "hold-entries" },
    { id: "hold-report", label: "Held Stock", view: "hold-report" },
  ] },
  { id: "purchases", label: "Purchases", icon: Receipt, children: [
    { id: "purchases-entries", label: "Entries", view: "purchases-entries" },
    { id: "purchases-report", label: "Report", view: "purchases-report" },
    { id: "purchases-edit", label: "Edit", view: "purchases-edit" },
  ] },
  { id: "production", label: "Production reel", icon: Factory, children: [
    { id: "production-entries", label: "Entries", view: "production-entries" },
    { id: "production-report", label: "Report", view: "production-report" },
    { id: "production-edit", label: "Edit", view: "production-edit" },
  ] },
  { id: "stock", label: "Stock reports", icon: Truck, children: [
    { id: "stock-current", label: "Current stock", view: "stock-current" },
    { id: "stock-quantity", label: "Reels quantity", view: "stock-quantity" },
  ] },
];
const VIEW_TITLES = {
  dashboard: "Overview", "masters-suppliers": "Suppliers", "masters-brands": "Brands",
  "masters-customers": "Customers", "masters-sizes": "Packet sizes", "masters-lifters": "Lifters",
  "pipeline-entries": "Reels in Pipeline — Entries", "pipeline-report": "Reels in Pipeline — Report", "pipeline-edit": "Reels in Pipeline — Edit",
  "reels-entries": "Reels in — Entries", "reels-report": "Reels in — Report", "reels-edit": "Reels in — Edit",
  "hold-entries": "Hold / Release Reels", "hold-report": "Held Reels Report",
  "purchases-entries": "Purchases — Entries", "purchases-report": "Purchases — Report", "purchases-edit": "Purchases — Edit",
  "production-entries": "Production — Entries", "production-report": "Production — Report", "production-edit": "Production — Edit",
  "stock-current": "Current stock", "stock-quantity": "Reels quantity", team: "Team & access",
};
const groupForView = (view) => { const g = NAV_GROUPS.find((g) => g.children && g.children.some((c) => c.view === view)); return g ? g.id : null; };

/* ================= shell ================= */
function Rail({ view, setView, isAdmin, onSignOut }) {
  const activeGroup = view === "dashboard" ? "dashboard" : view === "team" ? "team" : groupForView(view);
  const groups = isAdmin ? [...NAV_GROUPS, { id: "team", label: "Team", icon: Users, view: "team" }] : NAV_GROUPS;
  const go = (g) => setView(g.view || (g.children && g.children[0].view));
  return (
    <aside className="rail no-print">
      <div className="rail-top">
        <div className="rail-logo"><Boxes size={20} /></div>
        <div className="rail-brand">
          <div className="rail-brand-title">Sale Base Stock</div>
          <div className="rail-brand-sub">Bleach board register</div>
        </div>
      </div>
      <nav className="rail-nav">
        {groups.map((g) => {
          const Icon = g.icon; const active = activeGroup === g.id;
          return (
            <button key={g.id} className={"rail-btn " + (active ? "active" : "")} title={g.label} onClick={() => go(g)}>
              <Icon size={18} /><span className="rail-label">{g.label}</span>
              {g.children && <ChevronRight size={14} className={"rail-chevron " + (active ? "open" : "")} />}
            </button>
          );
        })}
      </nav>
      <div className="rail-foot">
        <button className="rail-btn rail-signout" title="Sign out" onClick={onSignOut}><LogOut size={18} /><span className="rail-label">Sign out</span></button>
      </div>
    </aside>
  );
}
function SubNav({ view, setView }) {
  const g = NAV_GROUPS.find((g) => g.children && g.children.some((c) => c.view === view));
  if (!g) return null;
  return (
    <div className="pill-tabs no-print">
      {g.children.map((c) => (
        <button key={c.id} className={"pill " + (view === c.view ? "on" : "")} onClick={() => setView(c.view)}>{c.label}</button>
      ))}
    </div>
  );
}
const Stamp = ({ children, tone = "gray" }) => <span className={`stamp stamp-${tone}`}>{children}</span>;
const Field = ({ label, children }) => <label className="field"><span>{label}</span>{children}</label>;
const EmptyRow = ({ children }) => <div className="empty-row">{children}</div>;
const LockedNote = ({ text }) => <div className="locked-panel"><Lock size={15} /><span>{text || "You don't have permission to view this."}</span></div>;
const SectionHead = ({ title, onPrint }) => (
  <div className="section-head"><h2>{title}</h2>{onPrint && <button className="btn no-print" onClick={onPrint}><Printer size={14} /> Print</button>}</div>
);
const FormDivider = ({ label }) => <div className="form-divider"><span>{label}</span></div>;
function SortControl({ value, onChange, options }) {
  return (
    <Field label="Sort by">
      <div className="sort-control">
        <select value={value.field} onChange={(e) => onChange({ ...value, field: e.target.value })}>
          {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <button type="button" className="btn sort-dir-btn" disabled={value.field === "entry"}
          onClick={() => onChange({ ...value, dir: value.dir === "asc" ? "desc" : "asc" })}>
          <ArrowUpDown size={13} /> {value.dir === "asc" ? "Low → High" : "High → Low"}
        </button>
      </div>
    </Field>
  );
}
function MultiSelect({ options, values, onChange, placeholder }) {
  const [open, setOpen] = useState(false);
  const toggle = (v) => { onChange(values.includes(v) ? values.filter((x) => x !== v) : [...values, v]); };
  const label = values.length === 0 ? (placeholder || "All") : values.length === 1
    ? (options.find((o) => o.value === values[0])?.label || "1 selected")
    : `${values.length} selected`;
  return (
    <div className="multiselect" tabIndex={0} onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false); }}>
      <button type="button" className="multiselect-btn" onClick={() => setOpen((o) => !o)}><span>{label}</span> <ChevronDown size={13} /></button>
      {open && (
        <div className="multiselect-panel">
          {options.map((o) => (
            <label key={o.value} className="multiselect-option">
              <input type="checkbox" checked={values.includes(o.value)} onChange={() => toggle(o.value)} />{o.label}
            </label>
          ))}
          {values.length > 0 && <button type="button" className="multiselect-clear" onClick={() => onChange([])}>Clear</button>}
        </div>
      )}
    </div>
  );
}
function Modal({ title, onClose, children }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><h3>{title}</h3><button className="icon-btn" onClick={onClose}><X size={16} /></button></div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}
/* ==== search-and-enter picker (copied UX from PKT DescPicker) ==== */
function ReelPicker({ lots, value, onChange, labelFn, placeholder, badgeFn }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [rect, setRect] = useState(null);
  const boxRef = React.useRef(null);
  const searchRef = React.useRef(null);
  const selected = lots.find((l) => l.id === value);
  const label = selected ? labelFn(selected) : "";
  const q = query.trim().toLowerCase();
  const list = lots.filter((l) => !q || labelFn(l).toLowerCase().includes(q));
  const place = () => { if (boxRef.current) setRect(boxRef.current.getBoundingClientRect()); };
  useEffect(() => { if (open) place(); }, [open]);
  useEffect(() => { if (open && rect && searchRef.current) searchRef.current.focus(); }, [open, rect]);
  useEffect(() => {
    if (!open) return;
    const onMove = () => place();
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => { window.removeEventListener("scroll", onMove, true); window.removeEventListener("resize", onMove); };
  }, [open]);
  const pick = (l) => { onChange(l.id); setOpen(false); setQuery(""); };
  let panelStyle = null;
  if (open && rect) {
    const spaceBelow = window.innerHeight - rect.bottom - 8;
    const flip = spaceBelow < 160 && rect.top - 12 > spaceBelow;
    panelStyle = flip
      ? { position: "fixed", bottom: window.innerHeight - rect.top + 4, left: rect.left, width: rect.width, maxHeight: Math.min(260, rect.top - 12), zIndex: 1200 }
      : { position: "fixed", top: rect.bottom + 4, left: rect.left, width: rect.width, maxHeight: Math.min(260, spaceBelow), zIndex: 1200 };
  }
  return (
    <div className="rp" onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) { setOpen(false); setQuery(""); } }}>
      <button ref={boxRef} type="button" className="rp-box" onClick={() => setOpen((o) => !o)}>
        <Search size={13} />
        <span className={label ? "rp-val" : "rp-ph"}>{label || placeholder || "Type to search reel…"}</span>
        {selected && (
          <span className="rp-clear" title="Clear" onClick={(e) => { e.stopPropagation(); onChange(""); setQuery(""); }}><X size={12} /></span>
        )}
      </button>
      {open && panelStyle && (
        <div className="rp-panel" style={panelStyle}>
          <div className="rp-search">
            <Search size={13} />
            <input ref={searchRef} autoFocus value={query} placeholder="Type to search…"
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Escape") { setOpen(false); setQuery(""); } if (e.key === "Enter" && list[0]) { e.preventDefault(); pick(list[0]); } }} />
          </div>
          <div className="rp-list">
            {list.length === 0 && <div className="rp-empty">No matching reel — try lot no, brand or gsm.</div>}
            {list.map((l) => (
              <button type="button" key={l.id} className="rp-opt" onMouseDown={(e) => e.preventDefault()} onClick={() => pick(l)}>
                <span className="rp-name">{labelFn(l)}</span>
                {badgeFn && <span className="rp-badge">{badgeFn(l)}</span>}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ================= auth + app ================= */
function LoginScreen({ onAuthed }) {
  const [mode, setMode] = useState("signin");
  const [email, setEmail] = useState(""); const [password, setPassword] = useState(""); const [fullName, setFullName] = useState("");
  const [busy, setBusy] = useState(false); const [err, setErr] = useState(""); const [notice, setNotice] = useState("");
  const submit = async () => {
    setErr(""); setNotice(""); setBusy(true);
    try {
      if (mode === "signin") {
        const d = await authSignIn(email.trim(), password);
        setAccessToken(d.access_token); await saveRefreshToken(d.refresh_token);
        onAuthed({ accessToken: d.access_token, refreshToken: d.refresh_token, user: d.user });
      } else if (mode === "signup") {
        const d = await authSignUp(email.trim(), password, fullName.trim());
        if (d && d.access_token) { setAccessToken(d.access_token); await saveRefreshToken(d.refresh_token); onAuthed({ accessToken: d.access_token, refreshToken: d.refresh_token, user: d.user }); }
        else { setNotice("Account created. If email confirmation is on, check your inbox, then sign in."); setMode("signin"); }
      } else { await authRecover(email.trim()); setNotice("If that email has an account, a reset link was sent."); }
    } catch (e) { setErr(e.message || "Something went wrong."); } finally { setBusy(false); }
  };
  return (
    <div className="login-page">
      <Style />
      <form className="login-card" onSubmit={(e) => { e.preventDefault(); if (!busy && email && (mode === "forgot" || password)) submit(); }}>
        <div className="login-logo"><Boxes size={22} /></div>
        <h1 className="login-title">Sale Base Stock</h1>
        <div className="login-sub">{mode === "signin" ? "Sign in to continue" : mode === "signup" ? "Create an account" : "Reset your password"}</div>
        {mode === "signup" && <Field label="Full name (optional)"><input name="name" autoComplete="name" value={fullName} onChange={(e) => setFullName(e.target.value)} /></Field>}
        <Field label="Email"><input name="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        {mode !== "forgot" && <Field label="Password"><input name="password" type="password" autoComplete={mode === "signin" ? "current-password" : "new-password"} value={password} onChange={(e) => setPassword(e.target.value)} /></Field>}
        {err && <div className="login-error">{err}</div>}
        {notice && <div className="login-notice">{notice}</div>}
        <button type="submit" className="btn primary login-submit" disabled={busy || !email || (mode !== "forgot" && !password)}>{busy ? "Please wait…" : mode === "signin" ? "Sign in" : mode === "signup" ? "Create account" : "Send reset link"}</button>
        {mode === "signin" && (<><button type="button" className="login-switch" onClick={() => { setMode("signup"); setErr(""); setNotice(""); }}>New here? Create an account</button><button type="button" className="login-switch" onClick={() => { setMode("forgot"); setErr(""); setNotice(""); }}>Forgot password?</button></>)}
        {mode !== "signin" && <button type="button" className="login-switch" onClick={() => { setMode("signin"); setErr(""); setNotice(""); }}>Back to sign in</button>}
      </form>
    </div>
  );
}
export default function ReelStockManager() {
  const [booting, setBooting] = useState(true);
  const [session, setSession] = useState(null);
  useEffect(() => {
    (async () => {
      const rt = loadRefreshToken();
      if (!rt) { setBooting(false); return; }
      try {
        const d = await refreshAccessToken();
        setSession({ accessToken: d.access_token, refreshToken: d.refresh_token, user: d.user });
      } catch (e) { clearRefreshToken(); } finally { setBooting(false); }
    })();
  }, []);
  const signOut = async () => { setAccessToken(null); clearRefreshToken(); setSession(null); };
  if (booting) return <div className="login-page"><Style /><div className="boot-loader"><Loader2 className="spin" size={22} /><span>Checking session...</span></div></div>;
  if (!session) return <LoginScreen onAuthed={setSession} />;
  return <AuthedApp session={session} onSignOut={signOut} />;
}
function AuthedApp({ session, onSignOut }) {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [profile, setProfile] = useState(null);
  const [view, setView] = useState("dashboard");
  const [suppliers, setSuppliers] = useState([]);
  const [brands, setBrands] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [sizes, setSizes] = useState([]);
  const [lifters, setLifters] = useState([]);
  const [reels, setReels] = useState([]);
  const [purchases, setPurchases] = useState([]);
  const [productions, setProductions] = useState([]);
  const [productionItems, setProductionItems] = useState([]);
  const [pipeline, setPipeline] = useState([]);
  useEffect(() => {
    (async () => {
      try {
        const profRows = await sbList("profiles", `?id=eq.${session.user.id}&select=*`);
        if (!profRows[0]) { setLoadError("No profile row found for this account. Run the schema SQL (with signup trigger) in Supabase, then sign in again."); setLoading(false); return; }
        setProfile(profRows[0]);
        const [su, br, cu, sz, li, re, pu, pr, pi, pl] = await Promise.all([
          sbList("suppliers"), sbList("brands"), sbList("customers"), sbList("sizes"), sbList("lifters"),
          sbList("reels"), sbList("purchases"), sbList("productions"), sbList("production_items"), sbList("pipeline"),
        ]);
        setSuppliers(su); setBrands(br); setCustomers(cu); setSizes(sz); setLifters(li);
        setReels(re); setPurchases(pu); setProductions(pr); setProductionItems(pi); setPipeline(pl);
      } catch (e) { setLoadError(e.message || "Failed to load."); } finally { setLoading(false); }
    })();
  }, [session]);
  const mk = (getter, setter, table) => (v) => { const p = getter(); setter(v); return syncTable(table, p, v).catch((e) => { alert("Save failed: " + e.message); throw e; }); };
  const persist = {
    suppliers: mk(() => suppliers, setSuppliers, "suppliers"),
    brands: mk(() => brands, setBrands, "brands"),
    customers: mk(() => customers, setCustomers, "customers"),
    sizes: mk(() => sizes, setSizes, "sizes"),
    lifters: mk(() => lifters, setLifters, "lifters"),
    reels: mk(() => reels, setReels, "reels"),
    purchases: mk(() => purchases, setPurchases, "purchases"),
    productions: mk(() => productions, setProductions, "productions"),
    productionItems: mk(() => productionItems, setProductionItems, "production_items"),
    pipeline: mk(() => pipeline, setPipeline, "pipeline"),
  };
  const supplierName = (id) => suppliers.find((s) => s.id === id)?.name || "—";
  const brandName = (id) => brands.find((b) => b.id === id)?.name || "—";
  const customerName = (id) => customers.find((c) => c.id === id)?.name || "—";
  const lifterName = (id) => lifters.find((l) => l.id === id)?.name || "—";
  const purchasedByLabel = (purchase) => purchase.customerId ? customerName(purchase.customerId) : (purchase.purchasedBy || "");
  const packetWeightKg = (size) => (Number(size.width) * Number(size.length) * Number(size.gsm)) / 15500;
  const sizeLabel = (size) => `${size.width}x${size.length} · ${size.gsm}g · ${brandName(size.brandId)} · BLC`;
  const reelDesc = (lot) => `BLC ${lot.gsm}g ${lot.width ? lot.width + '" · ' : ''}${brandName(lot.brandId)}`;
  const avgGramForEntry = (lot, totalPktWeight) => totalPktWeight > 0 ? (Number(lot.gsm) / totalPktWeight) * Number(lot.weight) : 0;
  const itemsFor = (productionId) => productionItems.filter((it) => it.productionId === productionId);
  const itemsWeightFor = (productionId) => itemsFor(productionId).reduce((a, it) => {
    const sz = sizes.find((s) => s.id === it.sizeId);
    return a + (sz ? Number(it.packetsProduced) * packetWeightKg(sz) : 0);
  }, 0);
  const usedWeightForLot = (lotId, excludeProductionId) => productions
    .filter((p) => p.lotId === lotId && p.id !== excludeProductionId)
    .reduce((a, p) => a + itemsWeightFor(p.id) + Number(p.wastageKg || 0), 0);
  const remainingAfterProduction = (productionId) => {
    const p = productions.find((x) => x.id === productionId);
    if (!p) return 0;
    const lot = reels.find((r) => r.id === p.lotId);
    if (!lot) return 0;
    if (purchases.find((x) => x.lotId === p.lotId)) return 0;
    const idx = productions.findIndex((x) => x.id === productionId);
    const upToHere = productions.filter((x, i) => x.lotId === p.lotId && i <= idx);
    if (upToHere.some((x) => x.closeOut)) return 0;
    const usedUpToHere = upToHere.reduce((a, x) => a + itemsWeightFor(x.id) + Number(x.wastageKg || 0), 0);
    return Math.max(0, Number(lot.weight) - usedUpToHere);
  };
  const totalPacketWeightForLot = (lotId) => productions.filter((p) => p.lotId === lotId).reduce((a, p) => a + itemsWeightFor(p.id), 0);
  const avgGramForLot = (lot) => avgGramForEntry(lot, totalPacketWeightForLot(lot.id));
  const lotInfo = useMemo(() => {
    const map = {};
    reels.forEach((lot) => {
      const purchase = purchases.find((p) => p.lotId === lot.id);
      const prods = productions.filter((p) => p.lotId === lot.id);
      const closedOut = prods.some((p) => p.closeOut);
      const usedKg = usedWeightForLot(lot.id);
      let status, remaining;
      if (purchase) { status = "purchased"; remaining = 0; }
      else if (lot.isHeld) { status = "held"; remaining = Math.max(0, Number(lot.weight) - usedKg); }
      else if (closedOut) { status = "converted"; remaining = 0; }
      else { remaining = Math.max(0, Number(lot.weight) - usedKg); status = usedKg === 0 ? "consignment" : remaining > 0 ? "partial" : "converted"; }
      const available = status !== "purchased" && status !== "converted" && remaining > 0.0001;
      map[lot.id] = { status, usedKg, remaining, purchase, productions: prods, closedOut, available };
    });
    pipeline.forEach((p) => {
      if (p.status === "pipeline") {
        if (p.isHeld) map[p.id] = { status: "held", usedKg: 0, remaining: Number(p.weight), purchase: null, productions: [], closedOut: false, available: false, isPipeline: true };
        else map[p.id] = { status: "pipeline", usedKg: 0, remaining: Number(p.weight), purchase: null, productions: [], closedOut: false, available: false, isPipeline: true };
      }
    });
    return map;
  }, [reels, purchases, productions, productionItems, sizes, brands, pipeline]);
  const allStockLots = useMemo(() => [
    ...reels,
    ...pipeline.filter((p) => p.status === "pipeline").map((p) => ({ ...p, isPipeline: true })),
  ], [reels, pipeline]);
  const remainingForLot = (lotId, excludePurchaseId) => {
    const lot = reels.find((r) => r.id === lotId);
    if (!lot) return 0;
    const otherPurchase = purchases.find((p) => p.lotId === lotId && p.id !== excludePurchaseId);
    if (otherPurchase) return 0;
    return Math.max(0, Number(lot.weight) - usedWeightForLot(lotId));
  };
  const reelLabelMap = useMemo(() => buildSequentialLabelMap(reels, "batchId", "RI"), [reels]);
  const purchaseLabelMap = useMemo(() => buildSequentialLabelMap(purchases, "batchId", "PR"), [purchases]);
  const productionLabelMap = useMemo(() => buildSequentialLabelMap(productions, "id", "PD"), [productions]);
  const pipelineLabelMap = useMemo(() => buildSequentialLabelMap(pipeline, "batchId", "PL"), [pipeline]);
  const totals = useMemo(() => {
    const godownWeight = reels.filter((r) => lotInfo[r.id] && lotInfo[r.id].status === "consignment").reduce((a, r) => a + (lotInfo[r.id]?.remaining || 0), 0);
    const godownReelsCount = reels.filter((r) => lotInfo[r.id] && lotInfo[r.id].status === "consignment").length;
    const purchaseValue = purchases.reduce((a, p) => a + Number(p.weight) * Number(p.rate), 0);
    const purchaseWeight = purchases.reduce((a, p) => a + Number(p.weight), 0);
    const packetsProduced = productionItems.reduce((a, it) => a + Number(it.packetsProduced), 0);
    const buyerMap = new Map();
    purchases.forEach((p) => {
      const name = purchasedByLabel(p).trim() || "Unspecified";
      if (!buyerMap.has(name)) buyerMap.set(name, { name, weight: 0, amount: 0, count: 0 });
      const b = buyerMap.get(name);
      b.weight += Number(p.weight); b.amount += Number(p.weight) * Number(p.rate); b.count += 1;
    });
    const purchasedByBreakdown = [...buyerMap.values()].sort((a, b) => b.amount - a.amount);
    return { godownWeight, godownReelsCount, purchaseValue, purchaseWeight, packetsProduced, purchasedByBreakdown };
  }, [reels, lotInfo, purchases, productionItems, customers]);
  if (loading) return <div className="app-shell loading-shell"><Style /><Loader2 className="spin" size={22} /><span>Opening the ledger...</span></div>;
  if (loadError) return <div className="app-shell"><Style /><div style={{ padding: 24 }}><LockedNote text={loadError} /><button className="btn" style={{ marginTop: 14 }} onClick={onSignOut}>Sign out and try again</button></div></div>;
  const can = (perm) => !!profile && (profile.role === "admin" || profile[perm]);
  const isAdmin = profile.role === "admin";
  const ctx = {
    suppliers, brands, customers, sizes, lifters, reels, purchases, productions, productionItems, pipeline, persist,
    supplierName, brandName, customerName, lifterName, purchasedByLabel, packetWeightKg, sizeLabel, reelDesc, avgGramForEntry, avgGramForLot, itemsFor, itemsWeightFor,
    lotInfo, totals, usedWeightForLot, remainingForLot, remainingAfterProduction, totalPacketWeightForLot, allStockLots,
    reelLabelMap, purchaseLabelMap, productionLabelMap, pipelineLabelMap, profile, can, isAdmin,
  };
  return (
    <div className="app-shell">
      <Style />
      <div className="app-layout">
        <Rail view={view} setView={setView} isAdmin={isAdmin} onSignOut={onSignOut} />
        <div className="main-area">
          <header className="page-head no-print">
            <div><h1>{VIEW_TITLES[view] || "Overview"}</h1><div className="page-sub">{new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</div></div>
            <div className="user-chip"><div className="user-avatar">{(session.user.email || "U").charAt(0).toUpperCase()}</div><div><div className="user-mail">{session.user.email}</div><div className="user-role">{profile.role}</div></div></div>
          </header>
          <SubNav view={view} setView={setView} />
          <main className="app-main">
            {view === "dashboard" && <Dashboard ctx={ctx} />}
            {view === "masters-suppliers" && <NameListEditor title="Suppliers" items={suppliers} setItems={persist.suppliers} withContact placeholder="e.g. Punjab Board Mills" canManage={can("canManageMasters")} isAdmin={isAdmin} blockedIds={reels.map((r) => r.supplierId)} />}
            {view === "masters-brands" && <NameListEditor title="Brands" items={brands} setItems={persist.brands} placeholder="e.g. Ningbo Fold" canManage={can("canManageMasters")} isAdmin={isAdmin} blockedIds={reels.map((r) => r.brandId)} />}
            {view === "masters-customers" && <NameListEditor title="Customers" items={customers} setItems={persist.customers} withContact placeholder="e.g. Abbasi Traders" canManage={can("canManageMasters")} isAdmin={isAdmin} blockedIds={[]} />}
            {view === "masters-sizes" && <SizesEditor ctx={ctx} canManage={can("canManageMasters")} isAdmin={isAdmin} />}
            {view === "masters-lifters" && <NameListEditor title="Lifters" items={lifters} setItems={persist.lifters} withContact placeholder="e.g. Ahmed Lifting" canManage={can("canManageMasters")} isAdmin={isAdmin} blockedIds={[]} />}
            {view === "pipeline-entries" && <PipelineEntriesTab ctx={ctx} />}
            {view === "pipeline-report" && <PipelineReportView ctx={ctx} />}
            {view === "pipeline-edit" && <PipelineEditTab ctx={ctx} />}
            {view === "reels-entries" && <ReelsEntriesTab ctx={ctx} />}
            {view === "reels-report" && <ReelsReportView ctx={ctx} />}
            {view === "reels-edit" && <ReelsEditTab ctx={ctx} />}
            {view === "hold-entries" && <HoldEntriesTab ctx={ctx} />}
            {view === "hold-report" && <HoldReportView ctx={ctx} />}
            {view === "purchases-entries" && <PurchasesEntriesTab ctx={ctx} />}
            {view === "purchases-report" && <PurchaseReportView ctx={ctx} />}
            {view === "purchases-edit" && <PurchaseEditTab ctx={ctx} />}
            {view === "production-entries" && <ProductionEntriesTab ctx={ctx} />}
            {view === "production-report" && <ProductionReportView ctx={ctx} />}
            {view === "production-edit" && <ProductionEditTab ctx={ctx} />}
            {view === "stock-current" && <StockReportTab ctx={ctx} />}
            {view === "stock-quantity" && <ReelsQuantityTab ctx={ctx} />}
            {view === "team" && isAdmin && <TeamTab />}
          </main>
        </div>
      </div>
    </div>
  );
}

/* ================= dashboard ================= */
function Dashboard({ ctx }) {
  if (!ctx.can("canViewReports")) return <LockedNote />;
  const { totals, reels, suppliers, sizes, pipeline, lotInfo, pipelineLabelMap, supplierName } = ctx;
  const openPipeline = pipeline.filter((p) => p.status === "pipeline");
  const pipelineWeight = openPipeline.reduce((a, p) => a + Number(p.weight), 0);
  const heldCount = reels.filter((r) => r.isHeld).length + pipeline.filter((p) => p.status === "pipeline" && p.isHeld).length;
  const cards = [
    { label: "In-godown reels", value: num(totals.godownReelsCount, 0), sub: `${num(totals.godownWeight)} kg in godown`, tone: "violet", icon: Boxes },
    { label: "In pipeline", value: num(openPipeline.length, 0), sub: `${num(pipelineWeight)} kg expected`, tone: "amber", icon: Clock },
    { label: "Purchased value", value: money(totals.purchaseValue), sub: `${num(totals.purchaseWeight)} kg purchased`, tone: "green", icon: Receipt },
    { label: "Packets produced", value: num(totals.packetsProduced, 0), sub: `${heldCount} reel(s) on hold`, tone: "cyan", icon: Factory },
  ];
  const breakdown = ["consignment", "partial", "converted", "purchased", "held"].map((s) => ({ s, count: reels.filter((r) => lotInfo[r.id] && lotInfo[r.id].status === s).length }));
  const maxCount = Math.max(1, ...breakdown.map((b) => b.count));
  const barColor = { consignment: "#7551FF", partial: "#FFB547", converted: "#0BC0EA", purchased: "#01B574", held: "#E31A1A" };
  const pipelineBatches = useMemo(() => {
    const map = new Map();
    openPipeline.forEach((p) => { if (!map.has(p.batchId)) map.set(p.batchId, []); map.get(p.batchId).push(p); });
    return [...map.entries()].map(([batchId, lots]) => ({ batchId, label: pipelineLabelMap.get(batchId), date: lots[0].date, supplierId: lots[0].supplierId, count: lots.length, weight: lots.reduce((a, l) => a + Number(l.weight), 0) })).sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 6);
  }, [pipeline, pipelineLabelMap]);
  return (
    <div>
      <div className="metric-grid">
        {cards.map((c) => { const Icon = c.icon; return (
          <div className={"metric-card tone-" + c.tone} key={c.label}>
            <div className="metric-top"><div className="metric-label">{c.label}</div><div className="metric-icon"><Icon size={16} /></div></div>
            <div className="metric-value">{c.value}</div>
            <div className="metric-sub">{c.sub}</div>
          </div>); })}
      </div>
      <div className="dash-grid">
        <div className="panel">
          <h3 className="panel-title">Stock mix</h3>
          {reels.length === 0 && <EmptyRow>No reels logged yet.</EmptyRow>}
          {breakdown.map((b) => (
            <div className="bar-row" key={b.s}>
              <div className="bar-label"><span>{statusLabel(b.s)}</span><span>{b.count} reels</span></div>
              <div className="bar-track"><div className="bar-fill" style={{ width: `${(b.count / maxCount) * 100}%`, background: barColor[b.s] }} /></div>
            </div>
          ))}
          <div className="panel-foot">{suppliers.length} suppliers · {sizes.length} packet sizes on file</div>
        </div>
        <div className="panel">
          <h3 className="panel-title">Pipeline watch</h3>
          {pipelineBatches.length === 0 && <EmptyRow>Nothing in pipeline right now.</EmptyRow>}
          {pipelineBatches.map((b) => (
            <div className="watch-row" key={b.batchId}>
              <span className="mono-tag pl-tag">{b.label}</span>
              <span className="watch-main">{supplierName(b.supplierId)} · {fmtDate(b.date)}</span>
              <span className="watch-val">{b.count} reels · {num(b.weight)} kg</span>
            </div>
          ))}
        </div>
      </div>
      {totals.purchasedByBreakdown.length > 0 && (
        <>
          <h3 className="sub-heading">Purchased by</h3>
          <table className="ledger-table">
            <thead><tr><th>Buyer</th><th>Purchases</th><th>Weight</th><th>Amount</th></tr></thead>
            <tbody>
              {totals.purchasedByBreakdown.map((b) => (
                <tr key={b.name}><td>{b.name}</td><td className="mono">{num(b.count, 0)}</td><td className="mono">{num(b.weight)} kg</td><td className="mono">{money(b.amount)}</td></tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      {reels.length === 0 && (
        <div className="invite-panel">
          <div className="invite-title">Start the register</div>
          <div className="invite-body">Add a supplier and brand in Setup, then log incoming reels under Reels in Pipeline → Entries, or received reels under Reels in → Entries.</div>
        </div>
      )}
    </div>
  );
}

/* ================= masters ================= */
function NameListEditor({ title, items, setItems, withContact, placeholder, canManage, isAdmin, blockedIds = [] }) {
  const [name, setName] = useState(""); const [contact, setContact] = useState("");
  const [editId, setEditId] = useState(null); const [en, setEn] = useState(""); const [ec, setEc] = useState("");
  const add = () => { if (!name.trim()) return; setItems([...items, { id: uid(), name: name.trim(), contact: contact.trim() || null }]); setName(""); setContact(""); };
  const save = () => { if (!en.trim()) return; setItems(items.map((it) => it.id === editId ? { ...it, name: en.trim(), contact: ec.trim() || null } : it)); setEditId(null); };
  const remove = (id) => { if (blockedIds.includes(id)) return; if (!confirmDelete(title.slice(0, -1))) return; setItems(items.filter((it) => it.id !== id)); };
  return (
    <div>
      <SectionHead title={title} />
      {canManage && (
        <div className="ticket-form">
          <div className="grid-2">
            <Field label={title.slice(0, -1) + " name"}><input value={name} onChange={(e) => setName(e.target.value)} placeholder={placeholder} /></Field>
            {withContact && <Field label="Contact (optional)"><input value={contact} onChange={(e) => setContact(e.target.value)} /></Field>}
          </div>
          <button className="btn primary" onClick={add}><Plus size={14} /> Add</button>
        </div>
      )}
      <div className="list panel-list">
        {items.length === 0 && <EmptyRow>Nothing added yet.</EmptyRow>}
        {items.map((it) => (
          <div className="row" key={it.id}>
            {editId === it.id ? (
              <div className="edit-row">
                <input value={en} onChange={(e) => setEn(e.target.value)} />
                {withContact && <input value={ec} onChange={(e) => setEc(e.target.value)} />}
                <button className="icon-btn" onClick={save}><Check size={15} /></button>
                <button className="icon-btn" onClick={() => setEditId(null)}><X size={15} /></button>
              </div>
            ) : (
              <>
                <div><div className="row-title">{it.name}</div>{it.contact && <div className="row-sub">{it.contact}</div>}</div>
                <div className="row-actions">
                  {canManage && <button className="icon-btn" onClick={() => { setEditId(it.id); setEn(it.name); setEc(it.contact || ""); }}><Pencil size={15} /></button>}
                  {isAdmin && <button className="icon-btn" disabled={blockedIds.includes(it.id)} onClick={() => remove(it.id)}><Trash2 size={15} /></button>}
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
function SizesEditor({ ctx, canManage, isAdmin }) {
  const { sizes, brands, persist, packetWeightKg, sizeLabel, productionItems } = ctx;
  const blank = { width: "", length: "", gsm: "", brandId: brands[0]?.id || "" };
  const [f, setF] = useState(blank);
  const [editId, setEditId] = useState(null); const [ef, setEf] = useState(blank);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const wt = f.width && f.length && f.gsm ? packetWeightKg(f) : 0;
  const add = () => {
    if (!f.width || !f.length || !f.gsm || !f.brandId) return;
    persist.sizes([...sizes, { id: uid(), width: Number(f.width), length: Number(f.length), gsm: Number(f.gsm), brandId: f.brandId }]);
    setF({ ...blank, brandId: f.brandId });
  };
  const saveEdit = () => { persist.sizes(sizes.map((s) => s.id === editId ? { ...s, width: Number(ef.width), length: Number(ef.length), gsm: Number(ef.gsm), brandId: ef.brandId } : s)); setEditId(null); };
  const inUse = (id) => productionItems.some((it) => it.sizeId === id);
  const remove = (id) => { if (inUse(id)) return; if (!confirmDelete("this size")) return; persist.sizes(sizes.filter((s) => s.id !== id)); };
  if (brands.length === 0) return <div><SectionHead title="Packet sizes" /><EmptyRow>Add a brand first.</EmptyRow></div>;
  return (
    <div>
      <SectionHead title="Packet sizes" />
      {canManage && (
        <div className="ticket-form grid-2">
          <Field label="Width"><input type="number" value={f.width} onChange={set("width")} placeholder="20" /></Field>
          <Field label="Length"><input type="number" value={f.length} onChange={set("length")} placeholder="30" /></Field>
          <Field label="Gram (GSM)"><input type="number" value={f.gsm} onChange={set("gsm")} placeholder="270" /></Field>
          <Field label="Brand"><select value={f.brandId} onChange={set("brandId")}>{brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>
          <div className="computed span-2">Packet weight: <b>{num(wt, 4)} kg</b></div>
          <button className="btn primary span-2" onClick={add}><Plus size={14} /> Add size</button>
        </div>
      )}
      <div className="list panel-list">
        {sizes.length === 0 && <EmptyRow>No packet sizes yet.</EmptyRow>}
        {sizes.map((sz) => (
          <div className="row" key={sz.id}>
            {editId === sz.id ? (
              <div className="edit-row grid-4">
                <input type="number" value={ef.width} onChange={(e) => setEf({ ...ef, width: e.target.value })} />
                <input type="number" value={ef.length} onChange={(e) => setEf({ ...ef, length: e.target.value })} />
                <input type="number" value={ef.gsm} onChange={(e) => setEf({ ...ef, gsm: e.target.value })} />
                <select value={ef.brandId} onChange={(e) => setEf({ ...ef, brandId: e.target.value })}>{brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
                <button className="icon-btn" onClick={saveEdit}><Check size={15} /></button>
                <button className="icon-btn" onClick={() => setEditId(null)}><X size={15} /></button>
              </div>
            ) : (
              <>
                <div><div className="row-title">{sizeLabel(sz)}</div><div className="row-sub">{num(packetWeightKg(sz), 4)} kg per packet</div></div>
                <div className="row-actions">
                  {canManage && <button className="icon-btn" onClick={() => { setEditId(sz.id); setEf({ width: sz.width, length: sz.length, gsm: sz.gsm, brandId: sz.brandId }); }}><Pencil size={15} /></button>}
                  {isAdmin && <button className="icon-btn" disabled={inUse(sz.id)} onClick={() => remove(sz.id)}><Trash2 size={15} /></button>}
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ================= pipeline ================= */
function PipelineEntriesTab({ ctx }) {
  const { suppliers, brands, lifters, pipeline, persist, pipelineLabelMap, supplierName, brandName, reelLabelMap } = ctx;
  const canAdd = ctx.can("canAddEntries");
  const [supplierId, setSupplierId] = useState(suppliers[0]?.id || "");
  const [date, setDate] = useState(todayISO());
  const [lifterId, setLifterId] = useState("");
  const blankRow = () => ({ key: uid(), lotNo: "", brandId: brands[0]?.id || "", gsm: "", width: "", weight: "", detail: "" });
  const [rows, setRows] = useState([blankRow()]);
  const [lastSaved, setLastSaved] = useState(null);
  const [expanded, setExpanded] = useState(null);
  useEffect(() => { if (!supplierId && suppliers[0]) setSupplierId(suppliers[0].id); }, [suppliers]);
  const updateRow = (key, patch) => setRows(rows.map((r) => r.key === key ? { ...r, ...patch } : r));
  const addRow = () => setRows([...rows, blankRow()]);
  const removeRow = (key) => setRows(rows.length > 1 ? rows.filter((r) => r.key !== key) : rows);
  const saveAll = () => {
    if (!supplierId || !date) return;
    const valid = rows.filter((r) => r.lotNo.trim() && r.brandId && r.gsm && r.width && r.weight);
    if (!valid.length) return;
    const batchId = uid();
    const newOnes = valid.map((r) => ({ id: uid(), batchId, lotNo: r.lotNo.trim(), supplierId, brandId: r.brandId, gsm: Number(r.gsm), width: Number(r.width), weight: Number(r.weight), detail: r.detail.trim(), date, lifterId: lifterId || null, status: "pipeline" }));
    persist.pipeline([...pipeline, ...newOnes]);
    setLastSaved({ count: newOnes.length, batchId });
    setRows([blankRow()]);
  };
  const batches = useMemo(() => {
    const map = new Map();
    pipeline.forEach((p) => { if (!map.has(p.batchId)) map.set(p.batchId, []); map.get(p.batchId).push(p); });
    return [...map.entries()].map(([batchId, lots]) => ({ batchId, label: pipelineLabelMap.get(batchId), date: lots[0].date, supplierId: lots[0].supplierId, lots, totalWeight: lots.reduce((a, l) => a + Number(l.weight), 0), openCount: lots.filter((l) => l.status === "pipeline").length })).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  }, [pipeline, pipelineLabelMap]);
  const disabled = suppliers.length === 0 || brands.length === 0;
  return (
    <div>
      <SectionHead title="Add reels to pipeline" />
      <div className="info-banner">Reels saved here are marked <b>In Pipeline</b>. Import them into godown from <b>Reels in → Entries → Import from Pipeline</b>. Edit / delete lives in <b>Pipeline → Edit</b>.</div>
      {canAdd && (
        <>
          {disabled && <EmptyRow>Add a supplier and at least one brand first.</EmptyRow>}
          {!disabled && (
            <div className="ticket-form" style={{ maxWidth: 940 }}>
              <div className="grid-2">
                <Field label="Supplier"><select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
                <Field label="Expected date"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
              </div>
              <Field label="Lifter">
                <select value={lifterId} onChange={(e) => setLifterId(e.target.value)}>
                  <option value="">Select Lifter...</option>
                  {lifters.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
              </Field>
              <FormDivider label="Reels in this pipeline entry" />
              <div className="rows-table">
                <div className="rows-head cols-7"><span>Lot no</span><span>Brand</span><span>Gram</span><span>Width</span><span>Weight</span><span>Detail</span><span /></div>
                {rows.map((r) => (
                  <div className="rows-line cols-7" key={r.key}>
                    <input value={r.lotNo} onChange={(e) => updateRow(r.key, { lotNo: e.target.value })} placeholder="e.g. 9938" />
                    <select value={r.brandId} onChange={(e) => updateRow(r.key, { brandId: e.target.value })}>{brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
                    <input type="number" value={r.gsm} onChange={(e) => updateRow(r.key, { gsm: e.target.value })} placeholder="230" />
                    <input type="number" value={r.width} onChange={(e) => updateRow(r.key, { width: e.target.value })} placeholder="30" />
                    <input type="number" value={r.weight} onChange={(e) => updateRow(r.key, { weight: e.target.value })} placeholder="647" />
                    <input value={r.detail} onChange={(e) => updateRow(r.key, { detail: e.target.value })} placeholder="optional" />
                    <button className="icon-btn" onClick={() => removeRow(r.key)}><Trash2 size={15} /></button>
                  </div>
                ))}
              </div>
              <div className="form-actions">
                <button className="btn" onClick={addRow}><Plus size={14} /> Add reel row</button>
                <button className="btn primary" onClick={saveAll}>Save to pipeline</button>
              </div>
              {lastSaved && <div className="computed">Saved {lastSaved.count} reel(s) under <b>{pipelineLabelMap.get(lastSaved.batchId)}</b> — status In Pipeline.</div>}
            </div>
          )}
        </>
      )}
      <h3 className="sub-heading">All pipeline entries (view only — edit in Edit)</h3>
      {batches.length === 0 && <EmptyRow>No pipeline entries yet.</EmptyRow>}
      {batches.map((b) => {
        const isOpen = expanded === b.batchId;
        return (
          <div className="entry-card" key={b.batchId}>
            <div className="entry-card-head" onClick={() => setExpanded(isOpen ? null : b.batchId)}>
              <div className="entry-card-title">
                {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                <span className="mono-tag pl-tag">{b.label}</span>
                <span>{fmtDate(b.date)} · {supplierName(b.supplierId)} · {b.lots.length} reels · {num(b.totalWeight)} kg</span>
                {b.openCount === b.lots.length ? <Stamp tone="indigo">In Pipeline</Stamp> : b.openCount === 0 ? <Stamp tone="green">Imported</Stamp> : <Stamp tone="amber">{b.openCount} open</Stamp>}
              </div>
            </div>
            {isOpen && (
              <div className="entry-card-body">
                <div className="tbl-wrap">
                  <table className="ledger-table">
                    <thead><tr><th>Lot</th><th>Item</th><th>Width</th><th>Weight</th><th>Status</th></tr></thead>
                    <tbody>
                      {b.lots.map((lot) => (
                        <tr key={lot.id}>
                          <td className="mono">{lot.lotNo}</td>
                          <td>{brandName(lot.brandId)} · {lot.gsm}g</td>
                          <td className="mono">{lot.width}</td>
                          <td className="mono">{num(lot.weight)} kg</td>
                          <td>{lot.status === "pipeline" ? (lot.isHeld ? <Stamp tone="rust">HELD</Stamp> : <Stamp tone="indigo">In Pipeline</Stamp>) : <Stamp tone="green">In Godown · {reelLabelMap.get(lot.importedBatchId) || ""}</Stamp>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
function ManagePipelineModal({ ctx, batch, onClose }) {
  const { pipeline, brands, persist, brandName, pipelineLabelMap } = ctx;
  const [lines, setLines] = useState(batch.lots.map((l) => ({ ...l })));
  const [adds, setAdds] = useState([]);
  const [nr, setNr] = useState({ lotNo: "", brandId: brands[0]?.id || "", gsm: "", width: "", weight: "", detail: "" });
  const cell = { padding: "9px 10px", border: "1px solid #E9EDF7", borderRadius: 10, background: "#fff", color: "#1B2559", fontFamily: "'JetBrains Mono',monospace", fontSize: 12.5, width: "100%", boxSizing: "border-box" };
  const cols = "0.9fr 1.1fr 0.6fr 0.6fr 0.8fr 1fr auto";
  const addLine = () => {
    if (!nr.lotNo.trim() || !nr.brandId || !nr.gsm || !nr.width || !nr.weight) return;
    const key = lotKey(nr.lotNo);
    const dup = pipeline.some((p) => lotKey(p.lotNo) === key) || adds.some((a) => lotKey(a.lotNo) === key) || lines.some((l) => lotKey(l.lotNo) === key);
    if (dup) { alert("Lot number already exists."); return; }
    setAdds([...adds, { ...nr, lotNo: nr.lotNo.trim() }]);
    setNr({ lotNo: "", brandId: nr.brandId, gsm: "", width: "", weight: "", detail: "" });
  };
  const save = () => {
    const newRecs = adds.map((a) => ({
      id: uid(), batchId: batch.batchId, lotNo: a.lotNo, supplierId: batch.supplierId, brandId: a.brandId,
      gsm: Number(a.gsm), width: Number(a.width), weight: Number(a.weight), detail: a.detail.trim(),
      date: batch.date, lifterId: batch.lifterId || null, status: "pipeline",
    }));
    const others = pipeline.filter((p) => p.batchId !== batch.batchId);
    persist.pipeline([...others, ...lines, ...newRecs]);
    onClose();
  };
  return (
    <Modal title={`Manage ${pipelineLabelMap.get(batch.batchId)} — add / remove pipeline reels`} onClose={onClose}>
      <h4 className="modal-sub" style={{ textAlign: "left" }}>Existing reels ({lines.length})</h4>
      <div className="list panel-list" style={{ maxHeight: 240, overflowY: "auto" }}>
        {lines.length === 0 && <EmptyRow>All rows removed — saving leaves this entry empty.</EmptyRow>}
        {lines.map((l) => (
          <div className="row" key={l.id}>
            <div>
              <div className="row-title">{brandName(l.brandId)} · {l.gsm}g {l.width ? `· ${l.width}"` : ""} <span className="mono-tag">Lot {l.lotNo}</span></div>
              <div className="row-sub">{num(l.weight)} kg</div>
            </div>
            <div className="row-actions"><button className="icon-btn" onClick={() => setLines(lines.filter((x) => x.id !== l.id))}><Trash2 size={15} /></button></div>
          </div>
        ))}
      </div>
      <h4 className="modal-sub" style={{ textAlign: "left", marginTop: 12 }}>Add more reels</h4>
      <div style={{ display: "grid", gridTemplateColumns: cols, gap: 8, alignItems: "center" }}>
        {["Lot no", "Brand", "Gram", "Width", "Weight", "Detail", ""].map((h, i) => (
          <span key={i} style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: ".06em", color: "#A3AED0", fontWeight: 800 }}>{h}</span>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: cols, gap: 8, alignItems: "center", marginTop: 6 }}>
        <input style={cell} value={nr.lotNo} onChange={(e) => setNr({ ...nr, lotNo: e.target.value })} placeholder="e.g. 9939" />
        <select style={cell} value={nr.brandId} onChange={(e) => setNr({ ...nr, brandId: e.target.value })}>{brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
        <input style={cell} type="number" value={nr.gsm} onChange={(e) => setNr({ ...nr, gsm: e.target.value })} placeholder="230" />
        <input style={cell} type="number" value={nr.width} onChange={(e) => setNr({ ...nr, width: e.target.value })} placeholder="30" />
        <input style={cell} type="number" value={nr.weight} onChange={(e) => setNr({ ...nr, weight: e.target.value })} placeholder="647" />
        <input style={cell} value={nr.detail} onChange={(e) => setNr({ ...nr, detail: e.target.value })} placeholder="optional" />
        <button className="btn primary" style={{ padding: "8px 12px", fontSize: 12, whiteSpace: "nowrap" }} onClick={addLine}><Plus size={13} /> Add</button>
      </div>
      {adds.length > 0 && (
        <div className="list panel-list" style={{ marginTop: 10 }}>
          {adds.map((a, i) => (
            <div className="row" key={i}>
              <div>
                <div className="row-title">{brandName(a.brandId)} · {a.gsm}g <span className="mono-tag">Lot {a.lotNo}</span></div>
                <div className="row-sub">{num(a.weight)} kg (new)</div>
              </div>
              <div className="row-actions"><button className="icon-btn" onClick={() => setAdds(adds.filter((_, x) => x !== i))}><Trash2 size={15} /></button></div>
            </div>
          ))}
        </div>
      )}
      <div className="form-actions">
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" onClick={save}><Check size={14} /> Save changes</button>
      </div>
    </Modal>
  );
}
function PipelineEditTab({ ctx }) {
  const canEdit = ctx.can("canEditEntries"), canDelete = ctx.can("canDeleteEntries");
  const { pipeline, persist, supplierName, suppliers, lifters, lifterName, brandName, pipelineLabelMap, reelLabelMap } = ctx;
  const [q, setQ] = useState(""); const [from, setFrom] = useState(""); const [to, setTo] = useState("");
  const [expanded, setExpanded] = useState(null);
  const [headEdit, setHeadEdit] = useState(null); const [hd, setHd] = useState({ date: "", supplierId: "", lifterId: "" });
  const [rowEdit, setRowEdit] = useState(null); const [ef, setEf] = useState(null);
  const [manage, setManage] = useState(null);
  if (!canEdit && !canDelete) return <LockedNote />;
  const allBatches = useMemo(() => {
    const map = new Map();
    pipeline.forEach((p) => { if (!map.has(p.batchId)) map.set(p.batchId, []); map.get(p.batchId).push(p); });
    return [...map.entries()].map(([batchId, lots]) => ({ batchId, label: pipelineLabelMap.get(batchId), date: lots[0].date, supplierId: lots[0].supplierId, lifterId: lots[0].lifterId || "", lots, totalWeight: lots.reduce((a, l) => a + Number(l.weight), 0), openCount: lots.filter((l) => l.status === "pipeline").length })).sort((a, b) => (a.date < b.date ? 1 : -1));
  }, [pipeline, pipelineLabelMap]);
  const batches = allBatches.filter((b) => {
    if (from && b.date < from) return false;
    if (to && b.date > to) return false;
    if (!q.trim()) return true;
    const query = q.trim().toLowerCase();
    return b.label.toLowerCase().includes(query) || b.date.includes(query) || fmtDate(b.date).toLowerCase().includes(query) ||
      b.lots.some((l) => `${l.lotNo} ${brandName(l.brandId)}`.toLowerCase().includes(query));
  });
  const saveHead = (batchId) => { persist.pipeline(pipeline.map((p) => p.batchId === batchId ? { ...p, date: hd.date, supplierId: hd.supplierId, lifterId: hd.lifterId || null } : p)); setHeadEdit(null); };
  const saveRow = () => {
    persist.pipeline(pipeline.map((p) => p.id === rowEdit ? { ...p, lotNo: ef.lotNo.trim(), brandId: ef.brandId, gsm: Number(ef.gsm), width: Number(ef.width), weight: Number(ef.weight), detail: ef.detail.trim(), date: ef.date } : p));
    setRowEdit(null);
  };
  const deleteRow = (id) => { if (!confirmDelete("this pipeline reel")) return; persist.pipeline(pipeline.filter((p) => p.id !== id)); };
  const deleteBatch = (batchId) => {
    const lots = pipeline.filter((p) => p.batchId === batchId);
    if (lots.some((l) => l.status !== "pipeline")) { alert("Already imported — delete the RI entry in Reels in → Edit to return it."); return; }
    if (!confirmDelete(`${allBatches.find((b) => b.batchId === batchId)?.label} (${lots.length} reels)`)) return;
    persist.pipeline(pipeline.filter((p) => p.batchId !== batchId));
  };
  const mb = batches.find((b) => b.batchId === manage) || allBatches.find((b) => b.batchId === manage);
  return (
    <div>
      <SectionHead title="Edit pipeline entries" />
      <div className="filter-bar no-print">
        <Field label="Search entry / lot"><div className="search-input"><Search size={13} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="PL-1, lot, brand…" /></div></Field>
        <Field label="From"><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="To"><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
      </div>
      <div className="info-banner">Use <b>+</b> on an entry to open the popup: add more reels or remove existing ones. <b>✎</b> edits the head, row ✎ edits a reel, 🗑 deletes.</div>
      {batches.length === 0 && <EmptyRow>Nothing to edit.</EmptyRow>}
      {batches.map((b) => {
        const open = expanded === b.batchId, editingHead = headEdit === b.batchId;
        return (
          <div className="entry-card" key={b.batchId}>
            <div className="entry-card-head" onClick={() => !editingHead && setExpanded(open ? null : b.batchId)}>
              <div className="entry-card-title">
                {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                <span className="mono-tag pl-tag">{b.label}</span>
                {editingHead ? (
                  <span className="entry-date-edit" onClick={(e) => e.stopPropagation()}>
                    <input type="date" value={hd.date} onChange={(e) => setHd({ ...hd, date: e.target.value })} />
                    <select value={hd.supplierId} onChange={(e) => setHd({ ...hd, supplierId: e.target.value })}>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
                    <select value={hd.lifterId} onChange={(e) => setHd({ ...hd, lifterId: e.target.value })} style={{ width: 120 }}><option value="">No Lifter</option>{lifters.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select>
                    <button className="icon-btn" onClick={() => saveHead(b.batchId)}><Check size={14} /></button>
                    <button className="icon-btn" onClick={() => setHeadEdit(null)}><X size={14} /></button>
                  </span>
                ) : (<span>{fmtDate(b.date)} · {supplierName(b.supplierId)} · {b.lots.length} reels · {num(b.totalWeight)} kg</span>)}
              </div>
              {!editingHead && (
                <div className="row-actions">
                  {canEdit && <button className="icon-btn" title="Add / remove reels" onClick={(e) => { e.stopPropagation(); setManage(b.batchId); }}><Plus size={15} /></button>}
                  {canEdit && <button className="icon-btn" title="Edit date / supplier" onClick={(e) => { e.stopPropagation(); setHeadEdit(b.batchId); setHd({ date: b.date, supplierId: b.supplierId, lifterId: b.lifterId }); }}><Pencil size={15} /></button>}
                  {canDelete && <button className="icon-btn" onClick={(e) => { e.stopPropagation(); deleteBatch(b.batchId); }}><Trash2 size={15} /></button>}
                </div>
              )}
            </div>
            {open && (
              <div className="entry-card-body">
                <div className="list panel-list">
                  {b.lots.map((l) => (
                    <div className="row" key={l.id}>
                      {rowEdit === l.id ? (
                        <div className="edit-row grid-8">
                          <input value={ef.lotNo} onChange={(e) => setEf({ ...ef, lotNo: e.target.value })} />
                          <input type="number" value={ef.gsm} onChange={(e) => setEf({ ...ef, gsm: e.target.value })} />
                          <input type="number" value={ef.width} onChange={(e) => setEf({ ...ef, width: e.target.value })} />
                          <input type="number" value={ef.weight} onChange={(e) => setEf({ ...ef, weight: e.target.value })} />
                          <input value={ef.detail} onChange={(e) => setEf({ ...ef, detail: e.target.value })} />
                          <input type="date" value={ef.date} onChange={(e) => setEf({ ...ef, date: e.target.value })} />
                          <button className="icon-btn" onClick={saveRow}><Check size={15} /></button>
                          <button className="icon-btn" onClick={() => setRowEdit(null)}><X size={15} /></button>
                        </div>
                      ) : (
                        <>
                          <div><div className="row-title">{brandName(l.brandId)} · {l.gsm}g {l.width ? `· ${l.width}"` : ""} <span className="mono-tag">Lot {l.lotNo}</span></div><div className="row-sub">{num(l.weight)} kg{l.detail ? ` · ${l.detail}` : ""}{l.lifterId ? ` · Lifter: ${lifterName(l.lifterId)}` : ""}</div></div>
                          <div className="row-actions">
                            {l.status !== "pipeline" && <Stamp tone="green">In Godown · {reelLabelMap.get(l.importedBatchId) || ""}</Stamp>}
                            {canEdit && l.status === "pipeline" && <button className="icon-btn" onClick={() => { setRowEdit(l.id); setEf({ lotNo: l.lotNo, brandId: l.brandId, gsm: l.gsm, width: l.width || "", weight: l.weight, detail: l.detail || "", date: l.date }); }}><Pencil size={15} /></button>}
                            {canDelete && l.status === "pipeline" && <button className="icon-btn" onClick={() => deleteRow(l.id)}><Trash2 size={15} /></button>}
                          </div>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })}
      {mb && <ManagePipelineModal ctx={ctx} batch={mb} onClose={() => setManage(null)} />}
    </div>
  );
}
function PipelineReportView({ ctx }) {
  if (!ctx.can("canViewReports")) return <LockedNote />;
  const { pipeline, suppliers, supplierName, brandName, lifterName, reelLabelMap, pipelineLabelMap } = ctx;
  const [supplierFilter, setSupplierFilter] = useState([]);
  const [statusFilter, setStatusFilter] = useState([]);
  const [q, setQ] = useState(""); const [from, setFrom] = useState(""); const [to, setTo] = useState("");
  const statusOptions = [{ value: "pipeline", label: "In Pipeline" }, { value: "imported", label: "Imported to Godown" }];
  const supplierOptions = suppliers.map((s) => ({ value: s.id, label: s.name }));
  const filtered = pipeline.filter((p) => {
    if (supplierFilter.length && !supplierFilter.includes(p.supplierId)) return false;
    if (statusFilter.length && !statusFilter.includes(p.status === "imported" ? "imported" : "pipeline")) return false;
    if (from && p.date < from) return false;
    if (to && p.date > to) return false;
    if (q.trim()) {
      const query = q.trim().toLowerCase();
      const label = (pipelineLabelMap.get(p.batchId) || "").toLowerCase();
      const hay = `${label} ${p.lotNo} ${brandName(p.brandId).toLowerCase()} ${supplierName(p.supplierId).toLowerCase()}`;
      if (!hay.includes(query)) return false;
    }
    return true;
  });
  const groups = groupByDate(filtered);
  const grandWeight = filtered.reduce((a, p) => a + Number(p.weight), 0);
  const doPrint = () => {
    let html = "";
    groups.forEach(([d, lots]) => {
      const tW = lots.reduce((a, l) => a + Number(l.weight), 0);
      html += `<h2>${esc(fmtDate(d))} — ${lots.length} reel(s)</h2><table><thead><tr><th>PL</th><th>Lot</th><th>Item</th><th>Width</th><th>Supplier</th><th>Lifter</th><th>Status</th><th>Weight</th></tr></thead><tbody>`;
      lots.forEach((p) => {
        html += `<tr><td class="tag">${esc(pipelineLabelMap.get(p.batchId))}</td><td class="tag">${esc(p.lotNo)}</td><td>${esc(brandName(p.brandId))} ${p.gsm}g</td><td>${esc(p.width)}</td><td>${esc(supplierName(p.supplierId))}</td><td>${esc(lifterName(p.lifterId))}</td><td>${p.status === "imported" ? "In Godown " + esc(reelLabelMap.get(p.importedBatchId) || "") : "In Pipeline"}</td><td>${num(p.weight)}</td></tr>`;
      });
      html += `</tbody><tfoot><tr><td colspan="7">${lots.length} reel(s)</td><td>${num(tW)}</td></tr></tfoot></table>`;
    });
    html += `<h2>Grand total — ${filtered.length} reel(s)</h2><table><tbody><tr><td>Total weight</td><td>${num(grandWeight)} kg</td></tr></tbody></table>`;
    printHTML("Pipeline report", html || "<p>No entries.</p>");
  };
  return (
    <div>
      <SectionHead title="Pipeline report" onPrint={doPrint} />
      <div className="filter-bar no-print">
        <Field label="Search"><div className="search-input"><Search size={13} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="PL, lot, brand..." /></div></Field>
        <Field label="Supplier"><MultiSelect options={supplierOptions} values={supplierFilter} onChange={setSupplierFilter} /></Field>
        <Field label="Status"><MultiSelect options={statusOptions} values={statusFilter} onChange={setStatusFilter} /></Field>
        <Field label="From"><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="To"><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
      </div>
      {groups.length === 0 && <EmptyRow>No pipeline reels match.</EmptyRow>}
      {groups.map(([d, lots]) => {
        const tW = lots.reduce((a, l) => a + Number(l.weight), 0);
        return (
          <div key={d} className="date-block">
            <div className="date-block-head">{fmtDate(d)} <span>{lots.length} reels · {num(tW)} kg</span></div>
            <table className="ledger-table">
              <thead><tr><th>PL</th><th>Lot</th><th>Item</th><th>Width</th><th>Supplier</th><th>Lifter</th><th>Status</th><th>Weight</th></tr></thead>
              <tbody>
                {lots.map((p) => (
                  <tr key={p.id}>
                    <td className="mono">{pipelineLabelMap.get(p.batchId)}</td>
                    <td className="mono">{p.lotNo}</td>
                    <td>{brandName(p.brandId)} · {p.gsm}g</td>
                    <td className="mono">{p.width}</td>
                    <td>{supplierName(p.supplierId)}</td>
                    <td>{lifterName(p.lifterId)}</td>
                    <td>{p.status === "imported" ? <Stamp tone="green">In Godown · {reelLabelMap.get(p.importedBatchId) || ""}</Stamp> : <Stamp tone="indigo">In Pipeline</Stamp>}</td>
                    <td className="mono">{num(p.weight)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr><td colSpan={7}>{lots.length} reels</td><td className="mono">{num(tW)}</td></tr></tfoot>
            </table>
          </div>
        );
      })}
      {filtered.length > 0 && (<div className="report-grand-total"><span>Grand total — {filtered.length} reels</span><span className="mono">{num(grandWeight)} kg</span></div>)}
    </div>
  );
}

/* ================= reels in ================= */
function ReelsAddForm({ ctx }) {
  const { suppliers, brands, lifters, reels, pipeline, persist, reelLabelMap, pipelineLabelMap, supplierName, brandName } = ctx;
  const [supplierId, setSupplierId] = useState(suppliers[0]?.id || "");
  const [date, setDate] = useState(todayISO());
  const [lifterId, setLifterId] = useState(lifters[0]?.id || "");
  const [biltyWeight, setBiltyWeight] = useState("");
  const [loadingChargePerKg, setLoadingChargePerKg] = useState("");
  const blankRow = () => ({ key: uid(), lotNo: "", brandId: brands[0]?.id || "", gsm: "", width: "", weight: "", detail: "", pipelineId: null, pipelineBatchId: null });
  const [rows, setRows] = useState([blankRow()]);
  const [lastSaved, setLastSaved] = useState(null);
  const [showImport, setShowImport] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);
  const [importNotice, setImportNotice] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (!supplierId && suppliers[0]) setSupplierId(suppliers[0].id); }, [suppliers]);
  useEffect(() => { if (!lifterId && lifters[0]) setLifterId(lifters[0].id); }, [lifters]);
  const openPipeline = pipeline.filter((p) => p.status === "pipeline" && !p.isHeld);
  const pipelineBatches = useMemo(() => {
    const map = new Map();
    openPipeline.forEach((p) => { if (!map.has(p.batchId)) map.set(p.batchId, []); map.get(p.batchId).push(p); });
    return [...map.entries()].map(([batchId, lots]) => ({ batchId, label: pipelineLabelMap.get(batchId), date: lots[0].date, supplierId: lots[0].supplierId, lots, totalWeight: lots.reduce((a, l) => a + Number(l.weight), 0) })).sort((a, b) => (a.date < b.date ? 1 : -1));
  }, [pipeline, pipelineLabelMap]);
  const updateRow = (key, patch) => setRows(rows.map((r) => r.key === key ? { ...r, ...patch } : r));
  const addRow = () => setRows([...rows, blankRow()]);
  const removeRow = (key) => setRows(rows.length > 1 ? rows.filter((r) => r.key !== key) : rows);
  const loadingChargesTotal = (Number(biltyWeight || 0) / 1000) * Number(loadingChargePerKg || 0);
  const toggleSelect = (id) => setSelectedIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  const selectBatch = (batchId) => {
    const ids = openPipeline.filter((p) => p.batchId === batchId).map((p) => p.id);
    setSelectedIds((prev) => {
      const all = ids.every((id) => prev.includes(id));
      return all ? prev.filter((id) => !ids.includes(id)) : [...new Set([...prev, ...ids])];
    });
  };
  const selectAll = () => setSelectedIds(selectedIds.length === openPipeline.length ? [] : openPipeline.map((p) => p.id));
  const addSelectedToRows = () => {
    const existingLots = new Set(reels.map((r) => lotKey(r.lotNo)));
    const inForm = new Set(rows.map((r) => lotKey(r.lotNo)));
    const skipped = []; const added = [];
    openPipeline.filter((p) => selectedIds.includes(p.id)).forEach((p) => {
      const key = lotKey(p.lotNo);
      if (existingLots.has(key) || inForm.has(key)) { skipped.push(String(p.lotNo)); return; }
      inForm.add(key);
      added.push({ key: uid(), lotNo: String(p.lotNo), brandId: p.brandId, gsm: String(p.gsm), width: String(p.width), weight: String(p.weight), detail: p.detail || "", pipelineId: p.id, pipelineBatchId: p.batchId });
    });
    if (added.length) setRows((prev) => [...prev, ...added]);
    setImportNotice(added.length
      ? `Added ${added.length} reel(s) below as editable rows.${skipped.length ? ` Skipped duplicate lot(s): ${skipped.join(", ")}.` : ""} Review them, then press “Save all reels”.`
      : `Nothing added — lot number(s) already exist in Reels In: ${skipped.join(", ")}.`);
    setSelectedIds([]);
  };
  const saveAll = async () => {
    if (saving || !supplierId || !date) return;
    const valid = rows.filter((r) => r.lotNo.trim() && r.brandId && r.gsm && r.width && r.weight);
    if (valid.length === 0) return;
    setSaving(true);
    const existingLots = new Set(reels.map((r) => lotKey(r.lotNo)));
    const seen = new Set(); const skipped = []; const savedKeys = new Set();
    const batchId = uid(); const newOnes = []; const reelIdByPipelineId = {};
    valid.forEach((r) => {
      const lotNo = r.lotNo.trim(); const key = lotKey(lotNo);
      if (existingLots.has(key) || seen.has(key)) { skipped.push(lotNo); return; }
      seen.add(key); savedKeys.add(r.key);
      const reelId = uid();
      newOnes.push({ id: reelId, batchId, lotNo, supplierId, brandId: r.brandId, gsm: Number(r.gsm), width: Number(r.width), weight: Number(r.weight), detail: r.detail.trim(), date, lifterId: lifterId || null, biltyWeight: Number(biltyWeight || 0), loadingChargePerKg: Number(loadingChargePerKg || 0), pipelineId: r.pipelineId || null, pipelineBatchId: r.pipelineBatchId || null });
      if (r.pipelineId) reelIdByPipelineId[r.pipelineId] = reelId;
    });
    if (newOnes.length === 0) { setLastSaved({ count: 0, batchId: null, skipped }); setSaving(false); return; }
    try {
      await persist.reels([...reels, ...newOnes]);
      const importedIds = Object.keys(reelIdByPipelineId);
      if (importedIds.length) {
        await persist.pipeline(pipeline.map((p) => reelIdByPipelineId[p.id] ? { ...p, status: "imported", importedReelId: reelIdByPipelineId[p.id], importedBatchId: batchId, importedAt: new Date().toISOString() } : p));
      }
    } catch (e) { setSaving(false); return; }
    setLastSaved({ count: newOnes.length, batchId, skipped });
    setRows((prev) => { const left = prev.filter((r) => !savedKeys.has(r.key)); return left.length ? left : [blankRow()]; });
    setBiltyWeight(""); setLoadingChargePerKg(""); setSaving(false);
  };
  const disabled = suppliers.length === 0 || brands.length === 0;
  return (
    <div>
      {disabled && <EmptyRow>Add a supplier and at least one brand first.</EmptyRow>}
      {!disabled && (
        <div className="ticket-form" style={{ maxWidth: 940 }}>
          <div className="grid-2">
            <Field label="Supplier"><select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
            <Field label="Date received"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          </div>
          <Field label="Lifter">
            <select value={lifterId} onChange={(e) => setLifterId(e.target.value)}>
              <option value="">Select Lifter...</option>
              {lifters.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </Field>
          <div className="grid-2">
            <Field label="Bilty weight (kg)"><input type="number" value={biltyWeight} onChange={(e) => setBiltyWeight(e.target.value)} placeholder="0" /></Field>
            <Field label="Loading/unloading charges (per kg)"><input type="number" value={loadingChargePerKg} onChange={(e) => setLoadingChargePerKg(e.target.value)} placeholder="0" /></Field>
          </div>
          {(Number(biltyWeight) > 0 || Number(loadingChargePerKg) > 0) && (<div className="computed">Loading charges for this entry: <b>{money(loadingChargesTotal)}</b></div>)}
          <div className="import-bar">
            <button type="button" className="btn import-toggle" onClick={() => setShowImport((s) => !s)}>
              <Clock size={14} /> {showImport ? "Hide pipeline" : `Import from Pipeline (${openPipeline.length} open)`}
            </button>
          </div>
          {showImport && (
            <div className="import-panel">
              <div className="import-panel-head">
                <div className="import-panel-title">Pick reels from pipeline — they become editable rows below and save only when you press “Save all reels”</div>
                <div className="row-actions">
                  <button className="btn" onClick={selectAll}>{selectedIds.length === openPipeline.length && openPipeline.length > 0 ? "Clear all" : "Select all reels"}</button>
                  <button className="btn primary" onClick={addSelectedToRows} disabled={selectedIds.length === 0}><Plus size={14} /> Add {selectedIds.length || ""} to entry</button>
                </div>
              </div>
              {openPipeline.length === 0 && <EmptyRow>Pipeline is empty — add reels under Reels in Pipeline → Entries.</EmptyRow>}
              {pipelineBatches.map((b) => (
                <div className="import-batch" key={b.batchId}>
                  <div className="import-batch-head">
                    <span className="mono-tag pl-tag">{b.label}</span>
                    <span>{fmtDate(b.date)} · {supplierName(b.supplierId)} · {b.lots.length} reels · {num(b.totalWeight)} kg</span>
                    <button className="btn select-all-btn" onClick={() => selectBatch(b.batchId)}>Select all</button>
                  </div>
                  {b.lots.map((p) => (
                    <label className="import-row" key={p.id}>
                      <input type="checkbox" checked={selectedIds.includes(p.id)} onChange={() => toggleSelect(p.id)} />
                      <span className="import-row-main"><b>{p.lotNo}</b> · {brandName(p.brandId)} · {p.gsm}g {p.width ? `· ${p.width}"` : ""} · {num(p.weight)} kg{p.detail ? ` · ${p.detail}` : ""}</span>
                    </label>
                  ))}
                </div>
              ))}
              {importNotice && <div className="notice-warn">{importNotice}</div>}
            </div>
          )}
          <FormDivider label="Reels in this entry" />
          <div className="rows-table">
            <div className="rows-head cols-7"><span>Lot no</span><span>Brand</span><span>Gram</span><span>Width</span><span>Weight</span><span>Detail</span><span /></div>
            {rows.map((r) => (
              <div className="rows-line cols-7" key={r.key}>
                <div className="lot-cell">
                  <input value={r.lotNo} onChange={(e) => updateRow(r.key, { lotNo: e.target.value })} placeholder="e.g. 9938" />
                  {r.pipelineId && <span className="pl-chip" title={`From ${pipelineLabelMap.get(r.pipelineBatchId)}`}>PL</span>}
                </div>
                <select value={r.brandId} onChange={(e) => updateRow(r.key, { brandId: e.target.value })}>{brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
                <input type="number" value={r.gsm} onChange={(e) => updateRow(r.key, { gsm: e.target.value })} placeholder="230" />
                <input type="number" value={r.width} onChange={(e) => updateRow(r.key, { width: e.target.value })} placeholder="30" />
                <input type="number" value={r.weight} onChange={(e) => updateRow(r.key, { weight: e.target.value })} placeholder="647" />
                <input value={r.detail} onChange={(e) => updateRow(r.key, { detail: e.target.value })} placeholder="optional" />
                <button className="icon-btn" onClick={() => removeRow(r.key)}><Trash2 size={15} /></button>
              </div>
            ))}
          </div>
          <div className="form-actions">
            <button className="btn" onClick={addRow}><Plus size={14} /> Add reel row</button>
            <button className="btn primary" onClick={saveAll} disabled={saving}>{saving ? "Saving…" : "Save all reels"}</button>
          </div>
          {lastSaved && lastSaved.count > 0 && (<div className="computed">Saved {lastSaved.count} reel(s) under entry <b>{reelLabelMap.get(lastSaved.batchId)}</b> — status In Godown.{lastSaved.skipped.length ? ` Skipped duplicate lot(s): ${lastSaved.skipped.join(", ")}.` : ""}</div>)}
          {lastSaved && lastSaved.count === 0 && (<div className="notice-warn">Nothing saved — duplicate lot number(s): {lastSaved.skipped.join(", ")}.</div>)}
        </div>
      )}
    </div>
  );
}
function ReelsEntriesTab({ ctx }) {
  const { reels, reelLabelMap, pipelineLabelMap, supplierName, lifterName, reelDesc, lotInfo } = ctx;
  const [expanded, setExpanded] = useState(null);
  const canAdd = ctx.can("canAddEntries");
  const batches = useMemo(() => {
    const map = new Map();
    reels.forEach((lot) => { if (!map.has(lot.batchId)) map.set(lot.batchId, []); map.get(lot.batchId).push(lot); });
    return [...map.entries()].map(([batchId, lots]) => ({ batchId, label: reelLabelMap.get(batchId), date: lots[0].date, supplierId: lots[0].supplierId, lots, biltyWeight: Number(lots[0].biltyWeight || 0), loadingChargePerKg: Number(lots[0].loadingChargePerKg || 0), lifterId: lots[0].lifterId || "", totalWeight: lots.reduce((a, l) => a + Number(l.weight), 0), fromPipeline: lots.some((l) => l.pipelineBatchId) })).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  }, [reels, reelLabelMap]);
  return (
    <div>
      <SectionHead title="Add reels received" />
      {canAdd ? <ReelsAddForm ctx={ctx} /> : <LockedNote text="You don't have permission to add reel entries." />}
      <h3 className="sub-heading">All entries (view only — edit in Edit)</h3>
      {batches.length === 0 && <EmptyRow>No reels logged yet.</EmptyRow>}
      {batches.map((b) => {
        const isOpen = expanded === b.batchId;
        const loadingChargesTotal = (b.biltyWeight / 1000) * b.loadingChargePerKg;
        return (
          <div className="entry-card" key={b.batchId}>
            <div className="entry-card-head" onClick={() => setExpanded(isOpen ? null : b.batchId)}>
              <div className="entry-card-title">
                {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                <span className="mono-tag entry-tag">{b.label}</span>
                {b.fromPipeline && <span className="mono-tag pl-tag">from Pipeline</span>}
                <span>{fmtDate(b.date)} · {supplierName(b.supplierId)} · {lifterName(b.lifterId) ? `Lifter: ${lifterName(b.lifterId)} ·` : ""}{b.lots.length} reels · {num(b.totalWeight)} kg{loadingChargesTotal > 0 ? `· loading ${money(loadingChargesTotal)}` : ""}</span>
              </div>
            </div>
            {isOpen && (
              <div className="entry-card-body">
                <div className="tbl-wrap">
                  <table className="ledger-table">
                    <thead><tr><th>Lot</th><th>Item</th><th>Width</th><th>Recv</th><th>Remaining</th><th>Status</th></tr></thead>
                    <tbody>
                      {b.lots.map((lot) => {
                        const info = lotInfo[lot.id];
                        return (
                          <tr key={lot.id}>
                            <td className="mono">{lot.lotNo}{lot.pipelineBatchId ? ` (${pipelineLabelMap.get(lot.pipelineBatchId)})` : ""}</td>
                            <td>{reelDesc(lot)}</td>
                            <td className="mono">{lot.width}</td>
                            <td className="mono">{num(lot.weight)} kg</td>
                            <td className="mono">{num(info.remaining)} kg</td>
                            <td><Stamp tone={statusTone(info.status)}>{statusLabel(info.status)}</Stamp></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
function ManageReelsModal({ ctx, batch, onClose }) {
  const { reels, pipeline, brands, persist, reelDesc } = ctx;
  const [lines, setLines] = useState(batch.lots.map((l) => ({ ...l })));
  const [adds, setAdds] = useState([]);
  const [nr, setNr] = useState({ lotNo: "", brandId: brands[0]?.id || "", gsm: "", width: "", weight: "", detail: "" });
  const cell = { padding: "9px 10px", border: "1px solid #E9EDF7", borderRadius: 10, background: "#fff", color: "#1B2559", fontFamily: "'JetBrains Mono',monospace", fontSize: 12.5, width: "100%", boxSizing: "border-box" };
  const cols = "0.9fr 1.1fr 0.6fr 0.6fr 0.8fr 1fr auto";
  const addLine = () => {
    if (!nr.lotNo.trim() || !nr.brandId || !nr.gsm || !nr.width || !nr.weight) return;
    const key = lotKey(nr.lotNo);
    const dup = reels.some((r) => lotKey(r.lotNo) === key) || adds.some((a) => lotKey(a.lotNo) === key) || lines.some((l) => lotKey(l.lotNo) === key);
    if (dup) { alert("Lot number already exists."); return; }
    setAdds([...adds, { ...nr, lotNo: nr.lotNo.trim() }]);
    setNr({ lotNo: "", brandId: nr.brandId, gsm: "", width: "", weight: "", detail: "" });
  };
  const save = async () => {
    const removed = batch.lots.filter((l) => !lines.some((x) => x.id === l.id));
    const newRecs = adds.map((a) => ({
      id: uid(), batchId: batch.batchId, lotNo: a.lotNo, supplierId: batch.supplierId, brandId: a.brandId,
      gsm: Number(a.gsm), width: Number(a.width), weight: Number(a.weight), detail: a.detail.trim(),
      date: batch.date, lifterId: batch.lifterId || null,
      biltyWeight: batch.biltyWeight || 0, loadingChargePerKg: batch.loadingChargePerKg || 0,
    }));
    const others = reels.filter((r) => r.batchId !== batch.batchId);
    await persist.reels([...others, ...lines, ...newRecs]);
    if (removed.length) {
      const pipeIds = new Set(removed.filter((l) => l.pipelineId).map((l) => l.pipelineId));
      if (pipeIds.size) await persist.pipeline(pipeline.map((p) => pipeIds.has(p.id) ? { ...p, status: "pipeline", importedReelId: null, importedBatchId: null, importedAt: null } : p));
    }
    onClose();
  };
  return (
    <Modal title={`Manage ${batch.label} — add / remove reels`} onClose={onClose}>
      <h4 className="modal-sub" style={{ textAlign: "left" }}>Existing reels ({lines.length})</h4>
      <div className="list panel-list" style={{ maxHeight: 240, overflowY: "auto" }}>
        {lines.length === 0 && <EmptyRow>All rows removed — saving leaves this entry empty.</EmptyRow>}
        {lines.map((l) => (
          <div className="row" key={l.id}>
            <div>
              <div className="row-title">{reelDesc(l)} <span className="mono-tag">Lot {l.lotNo}</span></div>
              <div className="row-sub">{num(l.weight)} kg</div>
            </div>
            <div className="row-actions"><button className="icon-btn" onClick={() => setLines(lines.filter((x) => x.id !== l.id))}><Trash2 size={15} /></button></div>
          </div>
        ))}
      </div>
      <h4 className="modal-sub" style={{ textAlign: "left", marginTop: 12 }}>Add more reels</h4>
      <div style={{ display: "grid", gridTemplateColumns: cols, gap: 8, alignItems: "center" }}>
        {["Lot no", "Brand", "Gram", "Width", "Weight", "Detail", ""].map((h, i) => (
          <span key={i} style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: ".06em", color: "#A3AED0", fontWeight: 800 }}>{h}</span>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: cols, gap: 8, alignItems: "center", marginTop: 6 }}>
        <input style={cell} value={nr.lotNo} onChange={(e) => setNr({ ...nr, lotNo: e.target.value })} placeholder="e.g. 9939" />
        <select style={cell} value={nr.brandId} onChange={(e) => setNr({ ...nr, brandId: e.target.value })}>{brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
        <input style={cell} type="number" value={nr.gsm} onChange={(e) => setNr({ ...nr, gsm: e.target.value })} placeholder="230" />
        <input style={cell} type="number" value={nr.width} onChange={(e) => setNr({ ...nr, width: e.target.value })} placeholder="30" />
        <input style={cell} type="number" value={nr.weight} onChange={(e) => setNr({ ...nr, weight: e.target.value })} placeholder="647" />
        <input style={cell} value={nr.detail} onChange={(e) => setNr({ ...nr, detail: e.target.value })} placeholder="optional" />
        <button className="btn primary" style={{ padding: "8px 12px", fontSize: 12, whiteSpace: "nowrap" }} onClick={addLine}><Plus size={13} /> Add</button>
      </div>
      {adds.length > 0 && (
        <div className="list panel-list" style={{ marginTop: 10 }}>
          {adds.map((a, i) => (
            <div className="row" key={i}>
              <div>
                <div className="row-title">{brands.find((b) => b.id === a.brandId)?.name} · {a.gsm}g <span className="mono-tag">Lot {a.lotNo}</span></div>
                <div className="row-sub">{num(a.weight)} kg (new)</div>
              </div>
              <div className="row-actions"><button className="icon-btn" onClick={() => setAdds(adds.filter((_, x) => x !== i))}><Trash2 size={15} /></button></div>
            </div>
          ))}
        </div>
      )}
      <div className="form-actions">
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" onClick={save}><Check size={14} /> Save changes</button>
      </div>
    </Modal>
  );
}
function ReelsEditTab({ ctx }) {
  const canEdit = ctx.can("canEditEntries"), canDelete = ctx.can("canDeleteEntries");
  const { reels, pipeline, brands, lifters, suppliers, persist, supplierName, lifterName, reelDesc, lotInfo, reelLabelMap } = ctx;
  const [q, setQ] = useState(""); const [from, setFrom] = useState(""); const [to, setTo] = useState("");
  const [expanded, setExpanded] = useState(null);
  const [headEdit, setHeadEdit] = useState(null); const [hd, setHd] = useState({ date: "", supplierId: "", lifterId: "", biltyWeight: "", loadingChargePerKg: "" });
  const [rowEdit, setRowEdit] = useState(null); const [ef, setEf] = useState(null);
  const [manage, setManage] = useState(null);
  if (!canEdit && !canDelete) return <LockedNote />;
  const allBatches = useMemo(() => {
    const map = new Map();
    reels.forEach((lot) => { if (!map.has(lot.batchId)) map.set(lot.batchId, []); map.get(lot.batchId).push(lot); });
    return [...map.entries()].map(([batchId, lots]) => ({ batchId, label: reelLabelMap.get(batchId), date: lots[0].date, supplierId: lots[0].supplierId, lifterId: lots[0].lifterId || "", biltyWeight: Number(lots[0].biltyWeight || 0), loadingChargePerKg: Number(lots[0].loadingChargePerKg || 0), lots, totalWeight: lots.reduce((a, l) => a + Number(l.weight), 0) })).sort((a, b) => (a.date < b.date ? 1 : -1));
  }, [reels, reelLabelMap]);
  const batches = allBatches.filter((b) => {
    if (from && b.date < from) return false;
    if (to && b.date > to) return false;
    if (!q.trim()) return true;
    const query = q.trim().toLowerCase();
    return b.label.toLowerCase().includes(query) || b.date.includes(query) || fmtDate(b.date).toLowerCase().includes(query) ||
      b.lots.some((l) => `${l.lotNo} ${reelDesc(l)}`.toLowerCase().includes(query));
  });
  const saveHead = (batchId) => {
    persist.reels(reels.map((r) => r.batchId === batchId ? { ...r, date: hd.date, supplierId: hd.supplierId, lifterId: hd.lifterId || null, biltyWeight: Number(hd.biltyWeight || 0), loadingChargePerKg: Number(hd.loadingChargePerKg || 0) } : r));
    setHeadEdit(null);
  };
  const saveRow = () => {
    const lotNo = ef.lotNo.trim();
    if (reels.some((r) => r.id !== rowEdit && lotKey(r.lotNo) === lotKey(lotNo))) { alert("Lot number already exists on another reel."); return; }
    persist.reels(reels.map((r) => r.id === rowEdit ? { ...r, lotNo, brandId: ef.brandId, gsm: Number(ef.gsm), width: Number(ef.width), weight: Number(ef.weight), detail: ef.detail.trim(), date: ef.date, lifterId: ef.lifterId || null } : r));
    setRowEdit(null);
  };
  const deleteRow = async (id) => {
    const lot = reels.find((r) => r.id === id);
    if (!lot) return;
    if (lotInfo[id]?.status !== "consignment" && lotInfo[id]?.status !== "held") return;
    if (!confirmDelete("this reel" + (lot.pipelineId ? " — it will return to Pipeline" : ""))) return;
    await persist.reels(reels.filter((r) => r.id !== id));
    if (lot.pipelineId) await persist.pipeline(pipeline.map((p) => p.id === lot.pipelineId ? { ...p, status: "pipeline", importedReelId: null, importedBatchId: null, importedAt: null } : p));
  };
  const deleteBatch = async (batchId) => {
    const lots = reels.filter((r) => r.batchId === batchId);
    if (lots.some((l) => lotInfo[l.id].status !== "consignment" && lotInfo[l.id].status !== "held")) { alert("Entry already used (production/purchase) — cannot delete."); return; }
    const fromPipeline = lots.filter((l) => l.pipelineId);
    if (!confirmDelete(`${allBatches.find((b) => b.batchId === batchId)?.label} (${lots.length} reels)${fromPipeline.length ? ` — ${fromPipeline.length} reel(s) will return to Pipeline` : ""}`)) return;
    await persist.reels(reels.filter((r) => r.batchId !== batchId));
    if (fromPipeline.length) {
      const ids = new Set(fromPipeline.map((l) => l.pipelineId));
      await persist.pipeline(pipeline.map((p) => ids.has(p.id) ? { ...p, status: "pipeline", importedReelId: null, importedBatchId: null, importedAt: null } : p));
    }
  };
  const mb = batches.find((b) => b.batchId === manage) || allBatches.find((b) => b.batchId === manage);
  return (
    <div>
      <SectionHead title="Edit reel entries" />
      <div className="filter-bar no-print">
        <Field label="Search entry / lot"><div className="search-input"><Search size={13} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="RI-1, lot, brand…" /></div></Field>
        <Field label="From"><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="To"><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
      </div>
      <div className="info-banner">Use <b>+</b> on an entry to open the popup: add more reels or remove existing ones. <b>✎</b> edits the head, row ✎ edits a reel, 🗑 deletes.</div>
      {batches.length === 0 && <EmptyRow>Nothing to edit.</EmptyRow>}
      {batches.map((b) => {
        const open = expanded === b.batchId, editingHead = headEdit === b.batchId;
        return (
          <div className="entry-card" key={b.batchId}>
            <div className="entry-card-head" onClick={() => !editingHead && setExpanded(open ? null : b.batchId)}>
              <div className="entry-card-title">
                {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                <span className="mono-tag entry-tag">{b.label}</span>
                {editingHead ? (
                  <span className="entry-date-edit" onClick={(e) => e.stopPropagation()}>
                    <input type="date" value={hd.date} onChange={(e) => setHd({ ...hd, date: e.target.value })} />
                    <select value={hd.supplierId} onChange={(e) => setHd({ ...hd, supplierId: e.target.value })}>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
                    <select value={hd.lifterId} onChange={(e) => setHd({ ...hd, lifterId: e.target.value })} style={{ width: 110 }}><option value="">No Lifter</option>{lifters.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select>
                    <input type="number" placeholder="Bilty wt" value={hd.biltyWeight} onChange={(e) => setHd({ ...hd, biltyWeight: e.target.value })} style={{ width: 90 }} />
                    <input type="number" placeholder="Load/kg" value={hd.loadingChargePerKg} onChange={(e) => setHd({ ...hd, loadingChargePerKg: e.target.value })} style={{ width: 90 }} />
                    <button className="icon-btn" onClick={() => saveHead(b.batchId)}><Check size={14} /></button>
                    <button className="icon-btn" onClick={() => setHeadEdit(null)}><X size={14} /></button>
                  </span>
                ) : (<span>{fmtDate(b.date)} · {supplierName(b.supplierId)} · {b.lots.length} reels · {num(b.totalWeight)} kg</span>)}
              </div>
              {!editingHead && (
                <div className="row-actions">
                  {canEdit && <button className="icon-btn" title="Add / remove reels" onClick={(e) => { e.stopPropagation(); setManage(b.batchId); }}><Plus size={15} /></button>}
                  {canEdit && <button className="icon-btn" title="Edit head" onClick={(e) => { e.stopPropagation(); setHeadEdit(b.batchId); setHd({ date: b.date, supplierId: b.supplierId, lifterId: b.lifterId, biltyWeight: b.biltyWeight || "", loadingChargePerKg: b.loadingChargePerKg || "" }); }}><Pencil size={15} /></button>}
                  {canDelete && <button className="icon-btn" onClick={(e) => { e.stopPropagation(); deleteBatch(b.batchId); }}><Trash2 size={15} /></button>}
                </div>
              )}
            </div>
            {open && (
              <div className="entry-card-body">
                <div className="list panel-list">
                  {b.lots.map((lot) => {
                    const info = lotInfo[lot.id];
                    return (
                      <div className="row" key={lot.id}>
                        {rowEdit === lot.id ? (
                          <div className="edit-row grid-8">
                            <input value={ef.lotNo} onChange={(e) => setEf({ ...ef, lotNo: e.target.value })} />
                            <select value={ef.brandId} onChange={(e) => setEf({ ...ef, brandId: e.target.value })}>{brands.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
                            <input type="number" value={ef.gsm} onChange={(e) => setEf({ ...ef, gsm: e.target.value })} />
                            <input type="number" value={ef.width} onChange={(e) => setEf({ ...ef, width: e.target.value })} />
                            <input type="number" value={ef.weight} onChange={(e) => setEf({ ...ef, weight: e.target.value })} />
                            <select value={ef.lifterId} onChange={(e) => setEf({ ...ef, lifterId: e.target.value })}><option value="">No Lifter</option>{lifters.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select>
                            <input value={ef.detail} onChange={(e) => setEf({ ...ef, detail: e.target.value })} />
                            <input type="date" value={ef.date} onChange={(e) => setEf({ ...ef, date: e.target.value })} />
                            <button className="icon-btn" onClick={saveRow}><Check size={15} /></button>
                            <button className="icon-btn" onClick={() => setRowEdit(null)}><X size={15} /></button>
                          </div>
                        ) : (
                          <>
                            <div><div className="row-title">{reelDesc(lot)} <span className="mono-tag">Lot {lot.lotNo}</span></div><div className="row-sub">{num(lot.weight)} kg · remaining {num(info.remaining)} kg · {supplierName(lot.supplierId)}</div></div>
                            <div className="row-actions">
                              <Stamp tone={statusTone(info.status)}>{statusLabel(info.status)}</Stamp>
                              {canEdit && (info.status === "consignment" || info.status === "held") && <button className="icon-btn" onClick={() => { setRowEdit(lot.id); setEf({ lotNo: lot.lotNo, brandId: lot.brandId, gsm: lot.gsm, width: lot.width || "", weight: lot.weight, detail: lot.detail || "", date: lot.date, lifterId: lot.lifterId || "" }); }}><Pencil size={15} /></button>}
                              {canDelete && <button className="icon-btn" disabled={info.status !== "consignment" && info.status !== "held"} onClick={() => deleteRow(lot.id)}><Trash2 size={15} /></button>}
                            </div>
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        );
      })}
      {mb && <ManageReelsModal ctx={ctx} batch={mb} onClose={() => setManage(null)} />}
    </div>
  );
}
function ReelsReportView({ ctx }) {
  if (!ctx.can("canViewReports")) return <LockedNote />;
  const { reels, suppliers, supplierName, lifterName, reelDesc, lotInfo, reelLabelMap, purchaseLabelMap, productionLabelMap, sizeLabel, packetWeightKg, sizes, itemsFor } = ctx;
  const [supplierFilter, setSupplierFilter] = useState([]);
  const [statusFilter, setStatusFilter] = useState([]);
  const [q, setQ] = useState("");
  const [from, setFrom] = useState(""); const [to, setTo] = useState("");
  const [sort, setSort] = useState({ field: "entry", dir: "desc" });
  const [expandedId, setExpandedId] = useState(null);
  const statusOptions = [
    { value: "consignment", label: "In godown" }, { value: "partial", label: "Partly converted" },
    { value: "converted", label: "Fully converted" }, { value: "purchased", label: "Purchased" },
    { value: "held", label: "On Hold" },
  ];
  const supplierOptions = suppliers.map((s) => ({ value: s.id, label: s.name }));
  const filtered = reels.filter((lot) => {
    if (supplierFilter.length && !supplierFilter.includes(lot.supplierId)) return false;
    if (statusFilter.length && !statusFilter.includes(lotInfo[lot.id].status)) return false;
    if (from && lot.date < from) return false;
    if (to && lot.date > to) return false;
    if (q.trim()) {
      const query = q.trim().toLowerCase();
      const label = (reelLabelMap.get(lot.batchId) || "").toLowerCase();
      const hay = `${label} ${lot.lotNo} ${reelDesc(lot).toLowerCase()} ${lifterName(lot.lifterId).toLowerCase()}`;
      if (!hay.includes(query)) return false;
    }
    return true;
  });
  const groups = groupByDate(filtered);
  const getters = { weight: (l) => Number(l.weight), remaining: (l) => lotInfo[l.id].remaining };
  const loadingChargesFor = (lots) => {
    const seen = new Set(); let total = 0;
    lots.forEach((lot) => { if (seen.has(lot.batchId)) return; seen.add(lot.batchId); total += (Number(lot.biltyWeight || 0) / 1000) * Number(lot.loadingChargePerKg || 0); });
    return total;
  };
  const grandLoadingCharges = loadingChargesFor(filtered);
  const grandWeightOnScreen = filtered.reduce((a, l) => a + Number(l.weight), 0);
  const grandRemainingOnScreen = filtered.reduce((a, l) => a + lotInfo[l.id].remaining, 0);
  const doPrint = () => {
    let html = "";
    groups.forEach(([d, lots]) => {
      const sorted = sortWithin(lots, sort, getters);
      const dateCharges = loadingChargesFor(lots);
      const tW = lots.reduce((a, l) => a + Number(l.weight), 0);
      const tR = lots.reduce((a, l) => a + lotInfo[l.id].remaining, 0);
      html += `<h2>${esc(fmtDate(d))} — ${lots.length} reel(s)${dateCharges > 0 ? ` — loading charges ${money(dateCharges)}` : ""}</h2><table><thead><tr><th>Entry</th><th>Item</th><th>Lot</th><th>Width</th><th>Supplier</th><th>Lifter</th><th>Status</th><th>Recv</th><th>Rem</th></tr></thead><tbody>`;
      sorted.forEach((lot) => {
        const info = lotInfo[lot.id];
        html += `<tr><td class="tag">${esc(reelLabelMap.get(lot.batchId))}</td><td>${esc(reelDesc(lot))}</td><td class="tag">${esc(lot.lotNo)}</td><td>${esc(lot.width)}</td><td>${esc(supplierName(lot.supplierId))}</td><td>${esc(lifterName(lot.lifterId))}</td><td>${esc(statusLabel(info.status))}</td><td>${num(lot.weight)}</td><td>${num(info.remaining)}</td></tr>`;
      });
      html += `</tbody><tfoot><tr><td colspan="7">${lots.length} reel(s)</td><td>${num(tW)}</td><td>${num(tR)}</td></tr></tfoot></table>`;
    });
    html += `<h2>Grand total — ${filtered.length} reel(s)</h2><table><tbody><tr><td>Total weight</td><td>${num(grandWeightOnScreen)} kg</td></tr><tr><td>Total remaining</td><td>${num(grandRemainingOnScreen)} kg</td></tr>${grandLoadingCharges > 0 ? `<tr><td>Loading charges</td><td>${money(grandLoadingCharges)}</td></tr>` : ""}</tbody></table>`;
    printHTML("Reels in report", html || "<p>No entries.</p>");
  };
  return (
    <div>
      <SectionHead title="Reels in — full report" onPrint={doPrint} />
      <div className="filter-bar no-print">
        <Field label="Search"><div className="search-input"><Search size={13} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Lot, desc, lifter..." /></div></Field>
        <Field label="Supplier"><MultiSelect options={supplierOptions} values={supplierFilter} onChange={setSupplierFilter} /></Field>
        <Field label="Status"><MultiSelect options={statusOptions} values={statusFilter} onChange={setStatusFilter} /></Field>
        <Field label="From"><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="To"><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        <SortControl value={sort} onChange={setSort} options={[{ value: "entry", label: "Entry order" }, { value: "weight", label: "Weight" }, { value: "remaining", label: "Remaining" }]} />
      </div>
      {groups.length === 0 && <EmptyRow>No reels match.</EmptyRow>}
      {groups.map(([d, lots]) => {
        const sorted = sortWithin(lots, sort, getters);
        const dateCharges = loadingChargesFor(lots);
        return (
          <div key={d} className="date-block">
            <div className="date-block-head">{fmtDate(d)} <span>{lots.length} reels{dateCharges > 0 ? `· loading ${money(dateCharges)}` : ""}</span></div>
            <table className="ledger-table">
              <thead><tr><th /><th>Entry</th><th>Item</th><th>Lot</th><th>Width</th><th>Supplier</th><th>Lifter</th><th>Status</th><th>Recv</th><th>Rem</th></tr></thead>
              <tbody>
                {sorted.map((lot) => {
                  const info = lotInfo[lot.id];
                  const isExpanded = expandedId === lot.id;
                  return (
                    <React.Fragment key={lot.id}>
                      <tr>
                        <td><button className="row-expand" onClick={() => setExpandedId(isExpanded ? null : lot.id)}>{isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</button></td>
                        <td className="mono">{reelLabelMap.get(lot.batchId)}</td>
                        <td>{reelDesc(lot)}</td><td className="mono">{lot.lotNo}</td><td className="mono">{lot.width}</td>
                        <td>{supplierName(lot.supplierId)}</td><td>{lifterName(lot.lifterId)}</td>
                        <td><Stamp tone={statusTone(info.status)}>{statusLabel(info.status)}</Stamp></td>
                        <td className="mono">{num(lot.weight)}</td><td className="mono">{num(info.remaining)}</td>
                      </tr>
                      {isExpanded && (
                        <tr className="no-print"><td /><td colSpan={9}>
                          <div className="detail-panel">
                            <div className="detail-title">Lifecycle for lot {lot.lotNo}</div>
                            {info.productions.length > 0 && info.productions.map((p) => (
                              <div key={p.id}>
                                <div className="detail-line">Production {productionLabelMap.get(p.id)} on {fmtDate(p.date)}:</div>
                                {itemsFor(p.id).map((it) => {
                                  const sz = sizes.find((s) => s.id === it.sizeId);
                                  const w = sz ? Number(it.packetsProduced) * packetWeightKg(sz) : 0;
                                  return <div className="detail-line" key={it.id} style={{ paddingLeft: 14 }}>— {num(it.packetsProduced)} × {sz ? sizeLabel(sz) : "removed"} = {num(w)} kg</div>;
                                })}
                              </div>
                            ))}
                            {info.purchase && <div className="detail-line">Purchase {purchaseLabelMap.get(info.purchase.batchId)}: {num(info.purchase.weight)} kg at {num(info.purchase.rate)}/kg</div>}
                            {info.status === "held" && <div className="detail-line" style={{ color: "var(--red)" }}>Currently ON HOLD.</div>}
                          </div>
                        </td></tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
              <tfoot><tr><td /><td colSpan={6}>{lots.length} reels</td><td /><td className="mono">{num(lots.reduce((a, l) => a + Number(l.weight), 0))}</td><td className="mono">{num(lots.reduce((a, l) => a + lotInfo[l.id].remaining, 0))}</td></tr></tfoot>
            </table>
          </div>
        );
      })}
      {filtered.length > 0 && (
        <div className="report-grand-total report-grand-total-multi">
          <span>Grand total — {filtered.length} reels</span>
          <span className="mono">Weight {num(grandWeightOnScreen)} kg</span>
          <span className="mono">Remaining {num(grandRemainingOnScreen)} kg</span>
          {grandLoadingCharges > 0 && <span className="mono">Loading {money(grandLoadingCharges)}</span>}
        </div>
      )}
    </div>
  );
}

/* ================= hold (includes pipeline reels) ================= */
function HoldEntriesTab({ ctx }) {
  const { reels, pipeline, lotInfo, reelDesc, persist, lifterName, customers, customerName, brandName } = ctx;
  const [selectedIds, setSelectedIds] = useState([]);
  const [holdNote, setHoldNote] = useState("");
  const [heldByCustomerId, setHeldByCustomerId] = useState("");
  const [q, setQ] = useState("");
  const pipeDesc = (p) => `BLC ${p.gsm}g ${p.width ? p.width + '" · ' : ''}${brandName(p.brandId)}`;
  const pool = [
    ...reels.filter((r) => lotInfo[r.id]?.available && !r.isHeld).map((r) => ({ id: r.id, kind: "reel", lotNo: r.lotNo, desc: reelDesc(r), weight: lotInfo[r.id].remaining, lifterId: r.lifterId })),
    ...pipeline.filter((p) => p.status === "pipeline" && !p.isHeld).map((p) => ({ id: p.id, kind: "pipe", lotNo: p.lotNo, desc: pipeDesc(p) + " · Pipeline", weight: Number(p.weight), lifterId: p.lifterId })),
  ];
  const available = pool.filter((x) => !q.trim() || `${x.lotNo} ${x.desc} ${lifterName(x.lifterId)}`.toLowerCase().includes(q.toLowerCase()));
  const toggleSelect = (id) => setSelectedIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  const applyHold = async () => {
    if (!selectedIds.length) return;
    if (!window.confirm(`Hold ${selectedIds.length} reel(s)?`)) return;
    const reelIds = new Set(selectedIds.filter((id) => pool.find((x) => x.id === id)?.kind === "reel"));
    const pipeIds = new Set(selectedIds.filter((id) => pool.find((x) => x.id === id)?.kind === "pipe"));
    if (reelIds.size) await persist.reels(reels.map((r) => reelIds.has(r.id) ? { ...r, isHeld: true, heldDate: todayISO(), holdNote: holdNote.trim(), heldByCustomerId: heldByCustomerId || null } : r));
    if (pipeIds.size) await persist.pipeline(pipeline.map((p) => pipeIds.has(p.id) ? { ...p, isHeld: true, heldDate: todayISO(), holdNote: holdNote.trim(), heldByCustomerId: heldByCustomerId || null } : p));
    setSelectedIds([]); setHoldNote(""); setHeldByCustomerId("");
  };
  const releaseHold = async (item) => {
    if (!window.confirm("Release this reel back?")) return;
    if (item.kind === "reel") await persist.reels(reels.map((r) => r.id === item.id ? { ...r, isHeld: false, heldDate: null, holdNote: null, heldByCustomerId: null } : r));
    else await persist.pipeline(pipeline.map((p) => p.id === item.id ? { ...p, isHeld: false, heldDate: null, holdNote: null, heldByCustomerId: null } : p));
  };
  const heldList = [
    ...reels.filter((r) => r.isHeld).map((r) => ({ id: r.id, kind: "reel", lotNo: r.lotNo, desc: reelDesc(r), remaining: lotInfo[r.id].remaining, heldDate: r.heldDate, heldByCustomerId: r.heldByCustomerId, holdNote: r.holdNote, lifterId: r.lifterId })),
    ...pipeline.filter((p) => p.status === "pipeline" && p.isHeld).map((p) => ({ id: p.id, kind: "pipe", lotNo: p.lotNo, desc: pipeDesc(p) + " · Pipeline", remaining: Number(p.weight), heldDate: p.heldDate, heldByCustomerId: p.heldByCustomerId, holdNote: p.holdNote, lifterId: p.lifterId })),
  ];
  return (
    <div>
      <SectionHead title="Hold / Release Reels" />
      <div className="info-banner">Godown reels <b>and open pipeline reels</b> can be placed on hold. Held reels are excluded from imports, purchases and production until released.</div>
      <div className="ticket-form" style={{ maxWidth: 940 }}>
        <h3 className="sub-heading" style={{ marginTop: 0 }}>Place Reels on Hold</h3>
        <Field label="Search available reels">
          <div className="search-input"><Search size={13} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Lot no or description..." /></div>
        </Field>
        <Field label="Held By (Customer)">
          <select value={heldByCustomerId} onChange={(e) => setHeldByCustomerId(e.target.value)}>
            <option value="">No customer specified</option>
            {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="Reason / Note (optional)">
          <input value={holdNote} onChange={(e) => setHoldNote(e.target.value)} placeholder="e.g. Quality check, reserved for special order" />
        </Field>
        <div className="list pick-list">
          {available.length === 0 && <EmptyRow>No available reels match search.</EmptyRow>}
          {available.map((r) => (
            <label key={r.id} className="checkbox-field pick-row">
              <input type="checkbox" checked={selectedIds.includes(r.id)} onChange={() => toggleSelect(r.id)} />
              <span>
                <b>{r.lotNo}</b> — {r.desc} — {num(r.weight)} kg
                {r.lifterId && <span className="mono-tag" style={{ marginLeft: 6 }}>Lifter: {lifterName(r.lifterId)}</span>}
              </span>
            </label>
          ))}
        </div>
        <div className="form-actions">
          <span className="computed">{selectedIds.length} reel(s) selected</span>
          <button className="btn primary" onClick={applyHold} disabled={selectedIds.length === 0}>Place on Hold</button>
        </div>
      </div>
      <h3 className="sub-heading">Currently Held Reels ({heldList.length})</h3>
      {heldList.length === 0 && <EmptyRow>No reels currently on hold.</EmptyRow>}
      <div className="list panel-list">
        {heldList.map((r) => (
          <div className="row" key={r.id}>
            <div>
              <div className="row-title">{r.desc} <span className="mono-tag">Lot {r.lotNo}</span> <Stamp tone="rust">HELD</Stamp></div>
              <div className="row-sub">
                Held since {fmtDate(r.heldDate)} · {num(r.remaining)} kg remaining
                {r.heldByCustomerId && <> · <b>Held by: {customerName(r.heldByCustomerId)}</b></>}
                {r.holdNote && <> · Note: {r.holdNote}</>}
                {r.lifterId && <> · Lifter: {lifterName(r.lifterId)}</>}
              </div>
            </div>
            <div className="row-actions"><button className="btn" onClick={() => releaseHold(r)}>Release</button></div>
          </div>
        ))}
      </div>
    </div>
  );
}
function HoldReportView({ ctx }) {
  if (!ctx.can("canViewReports")) return <LockedNote />;
  const { reels, pipeline, lotInfo, reelDesc, supplierName, lifterName, customerName, brandName } = ctx;
  const held = [
    ...reels.filter((r) => r.isHeld).map((r) => ({ id: r.id, lotNo: r.lotNo, desc: reelDesc(r), supplier: supplierName(r.supplierId), lifter: lifterName(r.lifterId), customer: customerName(r.heldByCustomerId), date: r.heldDate, note: r.holdNote, remaining: lotInfo[r.id].remaining })),
    ...pipeline.filter((p) => p.status === "pipeline" && p.isHeld).map((p) => ({ id: p.id, lotNo: p.lotNo, desc: `BLC ${p.gsm}g ${p.width ? p.width + '" · ' : ''}${brandName(p.brandId)} (Pipeline)`, supplier: supplierName(p.supplierId), lifter: lifterName(p.lifterId), customer: customerName(p.heldByCustomerId), date: p.heldDate, note: p.holdNote, remaining: Number(p.weight) })),
  ];
  const totalWeight = held.reduce((a, r) => a + r.remaining, 0);
  const doPrint = () => {
    let html = `<table><thead><tr><th>Lot</th><th>Description</th><th>Supplier</th><th>Lifter</th><th>Held By</th><th>Held Date</th><th>Note</th><th>Remaining</th></tr></thead><tbody>`;
    held.forEach((r) => {
      html += `<tr><td>${esc(r.lotNo)}</td><td>${esc(r.desc)}</td><td>${esc(r.supplier)}</td><td>${esc(r.lifter)}</td><td>${esc(r.customer)}</td><td>${esc(fmtDate(r.date))}</td><td>${esc(r.note || "—")}</td><td>${num(r.remaining)}</td></tr>`;
    });
    html += `</tbody><tfoot><tr><td colspan="7">${held.length} reel(s)</td><td>${num(totalWeight)}</td></tr></tfoot></table>`;
    printHTML("Held Reels Report", html);
  };
  return (
    <div>
      <SectionHead title="Held Reels Report" onPrint={doPrint} />
      {held.length === 0 && <EmptyRow>No reels on hold.</EmptyRow>}
      {held.length > 0 && (
        <table className="ledger-table">
          <thead><tr><th>Lot</th><th>Description</th><th>Supplier</th><th>Lifter</th><th>Held By</th><th>Held Date</th><th>Note</th><th>Remaining</th></tr></thead>
          <tbody>
            {held.map((r) => (
              <tr key={r.id}><td className="mono">{r.lotNo}</td><td>{r.desc}</td><td>{r.supplier}</td><td>{r.lifter}</td><td>{r.customer}</td><td className="mono">{fmtDate(r.date)}</td><td>{r.note || "—"}</td><td className="mono">{num(r.remaining)}</td></tr>
            ))}
          </tbody>
          <tfoot><tr><td colSpan={7}>{held.length} reel(s)</td><td className="mono">{num(totalWeight)}</td></tr></tfoot>
        </table>
      )}
    </div>
  );
}

/* ================= purchases ================= */
function PurchasesAddForm({ ctx }) {
  const { reels, purchases, customers, persist, reelDesc, lotInfo, purchaseLabelMap } = ctx;
  const [date, setDate] = useState(todayISO());
  const blankRow = () => ({ key: uid(), lotId: "", rate: "", customerId: "" });
  const [rows, setRows] = useState([blankRow()]);
  const [lastSaved, setLastSaved] = useState(null);
  const eligible = reels.filter((r) => lotInfo[r.id]?.available);
  const labelFn = (l) => `${reelDesc(l)} · Lot ${l.lotNo} · ${num(lotInfo[l.id].remaining)} kg${l.isHeld ? " (HELD)" : ""}`;
  const updateRow = (key, patch) => setRows(rows.map((r) => r.key === key ? { ...r, ...patch } : r));
  const addRow = () => setRows([...rows, blankRow()]);
  const removeRow = (key) => setRows(rows.length > 1 ? rows.filter((r) => r.key !== key) : rows);
  const saveAll = () => {
    const valid = rows.filter((r) => r.lotId && r.rate && lotInfo[r.lotId]?.available);
    if (valid.length === 0 || !date) return;
    const batchId = uid();
    const newOnes = valid.map((r) => ({ id: uid(), batchId, lotId: r.lotId, weight: lotInfo[r.lotId].remaining, rate: Number(r.rate), customerId: r.customerId || null, date }));
    const heldIds = new Set(valid.filter((r) => reels.find((x) => x.id === r.lotId)?.isHeld).map((r) => r.lotId));
    if (heldIds.size > 0) {
      persist.reels(reels.map((r) => heldIds.has(r.id) ? { ...r, isHeld: false, heldDate: null, holdNote: null, heldByCustomerId: null } : r));
    }
    persist.purchases([...purchases, ...newOnes]);
    setLastSaved({ count: newOnes.length, batchId });
    setRows([blankRow()]);
  };
  return (
    <div>
      {eligible.length === 0 && rows.every((r) => !r.lotId) && <EmptyRow>No reels available to purchase right now.</EmptyRow>}
      {customers.length === 0 && <EmptyRow>No customers on file yet.</EmptyRow>}
      <div className="ticket-form" style={{ maxWidth: 940 }}>
        <Field label="Date"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <FormDivider label="Purchase lines" />
        <div className="rows-table">
          <div className="rows-head cols-5"><span>Reel</span><span>Available</span><span>Rate/kg</span><span>Purchased by</span><span>Amount</span></div>
          {rows.map((r) => {
            const lot = reels.find((x) => x.id === r.lotId);
            const weight = lot ? lotInfo[lot.id].remaining : 0;
            const amt = weight * Number(r.rate || 0);
            return (
              <div className="rows-line cols-5" key={r.key}>
                <ReelPicker lots={eligible} value={r.lotId} onChange={(id) => updateRow(r.key, { lotId: id })} labelFn={labelFn} badgeFn={(l) => `${num(lotInfo[l.id].remaining)} kg`} placeholder="Search reel…" />
                <span className="static-cell">{lot ? num(weight) + " kg" + (lot.isHeld ? " (HELD)" : "") : "—"}</span>
                <input type="number" value={r.rate} onChange={(e) => updateRow(r.key, { rate: e.target.value })} />
                <select value={r.customerId} onChange={(e) => updateRow(r.key, { customerId: e.target.value })}>
                  <option value="">Select customer…</option>
                  {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <span className="static-cell mono-tag">{money(amt)}</span>
              </div>
            );
          })}
        </div>
        <div className="form-actions">
          <button className="btn" onClick={addRow}><Plus size={14} /> Add row</button>
          <button className="btn primary" onClick={saveAll}>Save purchases</button>
        </div>
        {lastSaved && <div className="computed">Saved {lastSaved.count} line(s) under <b>{purchaseLabelMap.get(lastSaved.batchId)}</b>.</div>}
      </div>
    </div>
  );
}
function PurchasesEntriesTab({ ctx }) {
  const { reels, purchaseLabelMap, reelDesc, purchasedByLabel } = ctx;
  const [expanded, setExpanded] = useState(null);
  const batches = useMemo(() => {
    const map = new Map();
    ctx.purchases.forEach((p) => { if (!map.has(p.batchId)) map.set(p.batchId, []); map.get(p.batchId).push(p); });
    return [...map.entries()].map(([batchId, lines]) => ({ batchId, label: purchaseLabelMap.get(batchId), date: lines[0].date, lines, totalWeight: lines.reduce((a, l) => a + Number(l.weight), 0), totalAmount: lines.reduce((a, l) => a + Number(l.weight) * Number(l.rate), 0) })).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  }, [ctx.purchases, purchaseLabelMap]);
  return (
    <div>
      <SectionHead title="Record purchases" />
      {ctx.can("canAddEntries") ? <PurchasesAddForm ctx={ctx} /> : <LockedNote />}
      <h3 className="sub-heading">All entries (view only — edit in Edit)</h3>
      {batches.length === 0 && <EmptyRow>No purchases logged yet.</EmptyRow>}
      {batches.map((b) => {
        const isOpen = expanded === b.batchId;
        return (
          <div className="entry-card" key={b.batchId}>
            <div className="entry-card-head" onClick={() => setExpanded(isOpen ? null : b.batchId)}>
              <div className="entry-card-title">
                {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                <span className="mono-tag entry-tag">{b.label}</span>
                <span>{fmtDate(b.date)} · {b.lines.length} lines · {num(b.totalWeight)} kg · {money(b.totalAmount)}</span>
              </div>
            </div>
            {isOpen && (
              <div className="entry-card-body">
                <div className="tbl-wrap">
                  <table className="ledger-table">
                    <thead><tr><th>Lot</th><th>Weight</th><th>Rate/kg</th><th>Amount</th><th>Buyer</th></tr></thead>
                    <tbody>
                      {b.lines.map((p) => {
                        const lot = reels.find((r) => r.id === p.lotId);
                        return (
                          <tr key={p.id}>
                            <td className="mono">{lot ? lot.lotNo : "removed"}</td>
                            <td className="mono">{num(p.weight)} kg</td>
                            <td className="mono">{num(p.rate)}</td>
                            <td className="mono">{money(Number(p.weight) * Number(p.rate))}</td>
                            <td>{purchasedByLabel(p) || "—"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
function ManagePurchaseModal({ ctx, batch, onClose }) {
  const { reels, purchases, customers, persist, reelDesc, lotInfo } = ctx;
  const [lines, setLines] = useState(batch.lines.map((l) => ({ ...l })));
  const [adds, setAdds] = useState([]);
  const [lotId, setLotId] = useState(""); const [rate, setRate] = useState(""); const [customerId, setCustomerId] = useState("");
  const eligible = reels.filter((r) => lotInfo[r.id]?.available && !lines.some((l) => l.lotId === r.id));
  const labelFn = (l) => `${reelDesc(l)} · Lot ${l.lotNo} · ${num(lotInfo[l.id].remaining)} kg`;
  const addLine = () => { if (!lotId || !rate) return; setAdds([...adds, { lotId, rate: Number(rate), customerId: customerId || null }]); setLotId(""); setRate(""); };
  const save = () => {
    const newRecs = adds.map((a) => {
      const lot = reels.find((r) => r.id === a.lotId);
      return { id: uid(), batchId: batch.batchId, lotId: a.lotId, weight: lotInfo[a.lotId].remaining, rate: a.rate, customerId: a.customerId, date: batch.date };
    });
    const others = purchases.filter((p) => p.batchId !== batch.batchId);
    persist.purchases([...others, ...lines, ...newRecs]);
    onClose();
  };
  return (
    <Modal title={`Manage ${batch.label} — add / remove purchase lines`} onClose={onClose}>
      <h4 className="modal-sub">Existing lines</h4>
      {lines.length === 0 && <EmptyRow>All rows removed — saving leaves this entry empty.</EmptyRow>}
      <div className="list panel-list">
        {lines.map((l) => {
          const lot = reels.find((r) => r.id === l.lotId);
          return (
            <div className="row" key={l.id}>
              <div><div className="row-title">{lot ? reelDesc(lot) : "removed"} <span className="mono-tag">Lot {lot?.lotNo}</span></div><div className="row-sub">{num(l.weight)} kg × {num(l.rate)}/kg = {money(Number(l.weight) * Number(l.rate))}</div></div>
              <div className="row-actions"><button className="icon-btn" onClick={() => setLines(lines.filter((x) => x.id !== l.id))}><Trash2 size={15} /></button></div>
            </div>
          );
        })}
      </div>
      <h4 className="modal-sub">Add more lines</h4>
      <div className="builder">
        <div className="builder-row">
          <div className="builder-desc"><ReelPicker lots={eligible} value={lotId} onChange={setLotId} labelFn={labelFn} badgeFn={(l) => `${num(lotInfo[l.id].remaining)} kg`} placeholder="Search reel…" /></div>
          <Field label="Rate /kg"><input type="number" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="0" /></Field>
          <Field label="Purchased by">
            <select value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
              <option value="">Select…</option>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <button className="btn primary builder-add" onClick={addLine} disabled={!lotId || !rate}><Plus size={14} /> Add line</button>
        </div>
      </div>
      {adds.length > 0 && (
        <div className="list panel-list">
          {adds.map((a, i) => {
            const lot = reels.find((r) => r.id === a.lotId);
            return (
              <div className="row" key={i}>
                <div><div className="row-title">{lot ? reelDesc(lot) : ""} <span className="mono-tag">Lot {lot?.lotNo}</span></div><div className="row-sub">{num(lotInfo[a.lotId].remaining)} kg × {num(a.rate)}/kg (new)</div></div>
                <div className="row-actions"><button className="icon-btn" onClick={() => setAdds(adds.filter((_, x) => x !== i))}><Trash2 size={15} /></button></div>
              </div>
            );
          })}
        </div>
      )}
      <div className="form-actions">
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" onClick={save}><Check size={14} /> Save changes</button>
      </div>
    </Modal>
  );
}
function PurchaseEditTab({ ctx }) {
  const canEdit = ctx.can("canEditEntries"), canDelete = ctx.can("canDeleteEntries");
  const { reels, purchases, customers, persist, reelDesc, lotInfo, purchaseLabelMap, remainingForLot, purchasedByLabel } = ctx;
  const [q, setQ] = useState(""); const [from, setFrom] = useState(""); const [to, setTo] = useState("");
  const [expanded, setExpanded] = useState(null);
  const [headEdit, setHeadEdit] = useState(null); const [hd, setHd] = useState("");
  const [rowEdit, setRowEdit] = useState(null); const [ef, setEf] = useState(null);
  const [manage, setManage] = useState(null);
  if (!canEdit && !canDelete) return <LockedNote />;
  const allBatches = useMemo(() => {
    const map = new Map();
    purchases.forEach((p) => { if (!map.has(p.batchId)) map.set(p.batchId, []); map.get(p.batchId).push(p); });
    return [...map.entries()].map(([batchId, lines]) => ({ batchId, label: purchaseLabelMap.get(batchId), date: lines[0].date, lines, totalWeight: lines.reduce((a, l) => a + Number(l.weight), 0), totalAmount: lines.reduce((a, l) => a + Number(l.weight) * Number(l.rate), 0) })).sort((a, b) => (a.date < b.date ? 1 : -1));
  }, [purchases, purchaseLabelMap]);
  const batches = allBatches.filter((b) => {
    if (from && b.date < from) return false;
    if (to && b.date > to) return false;
    if (!q.trim()) return true;
    const query = q.trim().toLowerCase();
    return b.label.toLowerCase().includes(query) || b.date.includes(query) || fmtDate(b.date).toLowerCase().includes(query) ||
      b.lines.some((l) => { const lot = reels.find((r) => r.id === l.lotId); return lot && `${lot.lotNo} ${reelDesc(lot)}`.toLowerCase().includes(query); });
  });
  const eligibleFor = (currentLotId) => reels.filter((r) => r.id === currentLotId || lotInfo[r.id]?.available);
  const labelFn = (excludeId) => (l) => `${reelDesc(l)} · Lot ${l.lotNo} · ${num(remainingForLot(l.id, excludeId))} kg available`;
  const saveHead = (batchId) => { persist.purchases(purchases.map((p) => p.batchId === batchId ? { ...p, date: hd } : p)); setHeadEdit(null); };
  const saveRow = () => {
    const weight = remainingForLot(ef.lotId, rowEdit);
    persist.purchases(purchases.map((p) => p.id === rowEdit ? { ...p, lotId: ef.lotId, weight, rate: Number(ef.rate), customerId: ef.customerId || null, date: ef.date } : p));
    setRowEdit(null);
  };
  const removeRow = (id) => { if (!confirmDelete("this purchase")) return; persist.purchases(purchases.filter((p) => p.id !== id)); };
  const removeBatch = (batchId) => {
    const lines = purchases.filter((p) => p.batchId === batchId);
    if (!confirmDelete(`${allBatches.find((b) => b.batchId === batchId)?.label} (${lines.length} lines)`)) return;
    persist.purchases(purchases.filter((p) => p.batchId !== batchId));
  };
  const mb = batches.find((b) => b.batchId === manage) || allBatches.find((b) => b.batchId === manage);
  return (
    <div>
      <SectionHead title="Edit purchase entries" />
      <div className="filter-bar no-print">
        <Field label="Search entry / lot"><div className="search-input"><Search size={13} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="PR-1, lot, brand…" /></div></Field>
        <Field label="From"><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="To"><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
      </div>
      <div className="info-banner">Use <b>+</b> on an entry to open the popup: add more lines or remove existing ones. <b>✎</b> edits head / a line, 🗑 deletes.</div>
      {batches.length === 0 && <EmptyRow>Nothing to edit.</EmptyRow>}
      {batches.map((b) => {
        const open = expanded === b.batchId, editingHead = headEdit === b.batchId;
        return (
          <div className="entry-card" key={b.batchId}>
            <div className="entry-card-head" onClick={() => !editingHead && setExpanded(open ? null : b.batchId)}>
              <div className="entry-card-title">
                {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                <span className="mono-tag entry-tag">{b.label}</span>
                {editingHead ? (
                  <span className="entry-date-edit" onClick={(e) => e.stopPropagation()}>
                    <input type="date" value={hd} onChange={(e) => setHd(e.target.value)} />
                    <button className="icon-btn" onClick={() => saveHead(b.batchId)}><Check size={14} /></button>
                    <button className="icon-btn" onClick={() => setHeadEdit(null)}><X size={14} /></button>
                  </span>
                ) : (<span>{fmtDate(b.date)} · {b.lines.length} lines · {num(b.totalWeight)} kg · {money(b.totalAmount)}</span>)}
              </div>
              {!editingHead && (
                <div className="row-actions">
                  {canEdit && <button className="icon-btn" title="Add / remove lines" onClick={(e) => { e.stopPropagation(); setManage(b.batchId); }}><Plus size={15} /></button>}
                  {canEdit && <button className="icon-btn" title="Edit date" onClick={(e) => { e.stopPropagation(); setHeadEdit(b.batchId); setHd(b.date); }}><Pencil size={15} /></button>}
                  {canDelete && <button className="icon-btn" onClick={(e) => { e.stopPropagation(); removeBatch(b.batchId); }}><Trash2 size={15} /></button>}
                </div>
              )}
            </div>
            {open && (
              <div className="entry-card-body">
                <div className="list panel-list">
                  {b.lines.map((l) => {
                    const lot = reels.find((r) => r.id === l.lotId);
                    return (
                      <div className="row" key={l.id}>
                        {rowEdit === l.id ? (
                          <div className="edit-row grid-5">
                            <ReelPicker lots={eligibleFor(l.lotId)} value={ef.lotId} onChange={(id) => setEf({ ...ef, lotId: id })} labelFn={labelFn(l.id)} placeholder="Search reel…" />
                            <input type="number" value={ef.rate} onChange={(e) => setEf({ ...ef, rate: e.target.value })} />
                            <select value={ef.customerId} onChange={(e) => setEf({ ...ef, customerId: e.target.value })}><option value="">Select…</option>{customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
                            <input type="date" value={ef.date} onChange={(e) => setEf({ ...ef, date: e.target.value })} />
                            <button className="icon-btn" onClick={saveRow}><Check size={15} /></button>
                            <button className="icon-btn" onClick={() => setRowEdit(null)}><X size={15} /></button>
                          </div>
                        ) : (
                          <>
                            <div><div className="row-title">{lot ? reelDesc(lot) : "removed"} <span className="mono-tag">Lot {lot?.lotNo}</span></div><div className="row-sub">{num(l.weight)} kg × {num(l.rate)}/kg = {money(Number(l.weight) * Number(l.rate))}{purchasedByLabel(l) ? ` · ${purchasedByLabel(l)}` : ""}</div></div>
                            <div className="row-actions">
                              {canEdit && <button className="icon-btn" onClick={() => { setRowEdit(l.id); setEf({ lotId: l.lotId, rate: l.rate, customerId: l.customerId || "", date: l.date }); }}><Pencil size={15} /></button>}
                              {canDelete && <button className="icon-btn" onClick={() => removeRow(l.id)}><Trash2 size={15} /></button>}
                            </div>
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        );
      })}
      {mb && <ManagePurchaseModal ctx={ctx} batch={mb} onClose={() => setManage(null)} />}
    </div>
  );
}
function PurchaseReportView({ ctx }) {
  if (!ctx.can("canViewReports")) return <LockedNote />;
  const { reels, purchases, reelDesc, purchaseLabelMap, purchasedByLabel } = ctx;
  const [q, setQ] = useState(""); const [from, setFrom] = useState(""); const [to, setTo] = useState("");
  const [sort, setSort] = useState({ field: "entry", dir: "desc" });
  const filtered = purchases.filter((p) => {
    if (from && p.date < from) return false; if (to && p.date > to) return false;
    if (q.trim()) {
      const query = q.trim().toLowerCase();
      const lot = reels.find((r) => r.id === p.lotId);
      const label = (purchaseLabelMap.get(p.batchId) || "").toLowerCase();
      const hay = `${label} ${lot ? lot.lotNo : ""} ${lot ? reelDesc(lot).toLowerCase() : ""} ${purchasedByLabel(p).toLowerCase()}`;
      if (!hay.includes(query)) return false;
    }
    return true;
  });
  const groups = groupByDate(filtered);
  const getters = { weight: (p) => Number(p.weight), rate: (p) => Number(p.rate), amount: (p) => Number(p.weight) * Number(p.rate) };
  const grandWeight = filtered.reduce((a, p) => a + Number(p.weight), 0);
  const grandAmount = filtered.reduce((a, p) => a + Number(p.weight) * Number(p.rate), 0);
  const doPrint = () => {
    let html = "";
    groups.forEach(([d, lines]) => {
      const sorted = sortWithin(lines, sort, getters);
      const tW = lines.reduce((a, p) => a + Number(p.weight), 0);
      const tA = lines.reduce((a, p) => a + Number(p.weight) * Number(p.rate), 0);
      html += `<h2>${esc(fmtDate(d))}</h2><table><thead><tr><th>Entry</th><th>Desc</th><th>Lot</th><th>Weight</th><th>Rate</th><th>Buyer</th><th>Amount</th></tr></thead><tbody>`;
      sorted.forEach((p) => {
        const lot = reels.find((r) => r.id === p.lotId); if (!lot) return;
        html += `<tr><td class="tag">${esc(purchaseLabelMap.get(p.batchId))}</td><td>${esc(reelDesc(lot))}</td><td class="tag">${esc(lot.lotNo)}</td><td>${num(p.weight)}</td><td>${num(p.rate)}</td><td>${esc(purchasedByLabel(p) || "—")}</td><td>${money(Number(p.weight) * Number(p.rate))}</td></tr>`;
      });
      html += `</tbody><tfoot><tr><td colspan="3">${lines.length} lots</td><td>${num(tW)}</td><td></td><td></td><td>${money(tA)}</td></tr></tfoot></table>`;
    });
    html += `<h2>Grand total</h2><table><tbody><tr><td>Weight</td><td>${num(grandWeight)} kg</td></tr><tr><td>Amount</td><td>${money(grandAmount)}</td></tr></tbody></table>`;
    printHTML("Purchase report", html);
  };
  return (
    <div>
      <SectionHead title="Purchase report" onPrint={doPrint} />
      <div className="filter-bar no-print">
        <Field label="Search"><div className="search-input"><Search size={13} /><input value={q} onChange={(e) => setQ(e.target.value)} /></div></Field>
        <Field label="From"><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="To"><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        <SortControl value={sort} onChange={setSort} options={[{ value: "entry", label: "Entry" }, { value: "weight", label: "Weight" }, { value: "amount", label: "Amount" }]} />
      </div>
      {groups.length === 0 && <EmptyRow>No purchases match.</EmptyRow>}
      {groups.map(([d, lines]) => {
        const sorted = sortWithin(lines, sort, getters);
        const tW = lines.reduce((a, p) => a + Number(p.weight), 0);
        const tA = lines.reduce((a, p) => a + Number(p.weight) * Number(p.rate), 0);
        return (
          <div key={d} className="date-block">
            <div className="date-block-head">{fmtDate(d)}</div>
            <table className="ledger-table">
              <thead><tr><th>Entry</th><th>Item</th><th>Lot</th><th>Weight</th><th>Rate</th><th>Buyer</th><th>Amount</th></tr></thead>
              <tbody>
                {sorted.map((p) => {
                  const lot = reels.find((r) => r.id === p.lotId); if (!lot) return null;
                  return (<tr key={p.id}><td className="mono">{purchaseLabelMap.get(p.batchId)}</td><td>{reelDesc(lot)}</td><td className="mono">{lot.lotNo}</td><td className="mono">{num(p.weight)}</td><td className="mono">{num(p.rate)}</td><td>{purchasedByLabel(p) || "—"}</td><td className="mono">{money(Number(p.weight) * Number(p.rate))}</td></tr>);
                })}
              </tbody>
              <tfoot><tr><td /><td colSpan={2}>{lines.length} lots</td><td className="mono">{num(tW)}</td><td /><td /><td className="mono">{money(tA)}</td></tr></tfoot>
            </table>
          </div>
        );
      })}
      {filtered.length > 0 && (<div className="report-grand-total"><span>Grand total — {filtered.length} lots</span><span className="mono">{num(grandWeight)} kg</span><span className="mono">{money(grandAmount)}</span></div>)}
    </div>
  );
}

/* ================= production ================= */
function ProductionAddForm({ ctx }) {
  const { reels, sizes, productions, productionItems, persist, reelDesc, sizeLabel, packetWeightKg, lotInfo, productionLabelMap } = ctx;
  const [date, setDate] = useState(todayISO());
  const [lotId, setLotId] = useState("");
  const [wastageKg, setWastageKg] = useState("");
  const [closeOut, setCloseOut] = useState(false);
  const blankItem = () => ({ key: uid(), sizeId: sizes[0]?.id || "", packetsProduced: "" });
  const [items, setItems] = useState([blankItem()]);
  const [lastSaved, setLastSaved] = useState(null);
  const [saving, setSaving] = useState(false);
  const eligible = reels.filter((r) => lotInfo[r.id]?.available);
  const labelFn = (l) => `${reelDesc(l)} · Lot ${l.lotNo} · ${num(lotInfo[l.id].remaining)} kg${l.isHeld ? " (HELD)" : ""}`;
  const lot = reels.find((r) => r.id === lotId);
  const capacity = lot ? lotInfo[lot.id].remaining : 0;
  const updateItem = (key, patch) => setItems(items.map((it) => it.key === key ? { ...it, ...patch } : it));
  const addItem = () => setItems([...items, blankItem()]);
  const removeItem = (key) => setItems(items.length > 1 ? items.filter((it) => it.key !== key) : items);
  const itemWeight = (it) => { const sz = sizes.find((s) => s.id === it.sizeId); return sz && it.packetsProduced ? Number(it.packetsProduced) * packetWeightKg(sz) : 0; };
  const itemsTotalWeight = items.reduce((a, it) => a + itemWeight(it), 0);
  const totalUsed = itemsTotalWeight + Number(wastageKg || 0);
  const remainingAfter = capacity - totalUsed;
  const ok = lot && totalUsed > 0 && remainingAfter >= -0.001;
  const saveAll = async () => {
    if (saving) return;
    const validItems = items.filter((it) => it.sizeId && it.packetsProduced);
    if (!lot || !date || validItems.length === 0 || !ok) return;
    setSaving(true);
    const productionId = uid();
    try {
      if (lot.isHeld) {
        await persist.reels(reels.map((r) => r.id === lotId ? { ...r, isHeld: false, heldDate: null, holdNote: null, heldByCustomerId: null } : r));
      }
      await persist.productions([...productions, { id: productionId, lotId, wastageKg: Number(wastageKg || 0), closeOut, date }]);
      await persist.productionItems([...productionItems, ...validItems.map((it) => ({ id: uid(), productionId, sizeId: it.sizeId, packetsProduced: Number(it.packetsProduced) }))]);
    } catch (e) { setSaving(false); return; }
    setLastSaved({ productionId });
    setLotId(""); setWastageKg(""); setCloseOut(false); setItems([blankItem()]);
    setSaving(false);
  };
  const disabled = sizes.length === 0;
  return (
    <div>
      {disabled && <EmptyRow>Add at least one packet size first.</EmptyRow>}
      {!disabled && (
        <div className="ticket-form" style={{ maxWidth: 940 }}>
          <div className="grid-2">
            <Field label="Date"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
            <Field label="Reel"><ReelPicker lots={eligible} value={lotId} onChange={setLotId} labelFn={labelFn} badgeFn={(l) => `${num(lotInfo[l.id].remaining)} kg`} placeholder="Search reel…" /></Field>
          </div>
          <div className="grid-2">
            <Field label="Wastage (kg)"><input type="number" value={wastageKg} onChange={(e) => setWastageKg(e.target.value)} placeholder="0" /></Field>
            <div className="computed" style={{ alignSelf: "end", paddingBottom: 9 }}>
              {lot ? <>Capacity: <b>{num(capacity)} kg</b> · Used: <b>{num(totalUsed)} kg</b> · {remainingAfter >= -0.001 ? <>Left: <b>{num(Math.max(0, remainingAfter))} kg</b></> : <span className="static-cell danger">Exceeds available</span>}</> : "Pick a reel"}
            </div>
          </div>
          <label className="checkbox-field"><input type="checkbox" checked={closeOut} onChange={(e) => setCloseOut(e.target.checked)} /><span>Mark fully converted (close out)</span></label>
          <FormDivider label="Packet sizes produced" />
          <div className="rows-table">
            <div className="rows-head cols-3"><span>Size</span><span>Packets</span><span>Weight</span></div>
            {items.map((it) => (
              <div className="rows-line cols-3" key={it.key}>
                <ReelPicker lots={sizes} value={it.sizeId} onChange={(id) => updateItem(it.key, { sizeId: id })} labelFn={sizeLabel} placeholder="Search size…" />
                <input type="number" step="any" value={it.packetsProduced} onChange={(e) => updateItem(it.key, { packetsProduced: e.target.value })} placeholder="300" />
                <span className="static-cell mono-tag">{num(itemWeight(it))} kg</span>
                <button className="icon-btn" onClick={() => removeItem(it.key)}><Trash2 size={15} /></button>
              </div>
            ))}
          </div>
          <div className="form-actions">
            <button className="btn" onClick={addItem}><Plus size={14} /> Add size</button>
            <button className="btn primary" onClick={saveAll} disabled={!ok || saving}>{saving ? "Saving…" : "Save production"}</button>
          </div>
          {lastSaved && <div className="computed">Saved under <b>{productionLabelMap.get(lastSaved.productionId)}</b>.</div>}
        </div>
      )}
    </div>
  );
}
function ProductionEntriesTab({ ctx }) {
  const { reels, sizes, productions, reelDesc, sizeLabel, packetWeightKg, itemsFor, itemsWeightFor, productionLabelMap, lotInfo } = ctx;
  const [expanded, setExpanded] = useState(null);
  const sorted = [...productions].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return (
    <div>
      <SectionHead title="Convert a reel into packets" />
      {ctx.can("canAddEntries") ? <ProductionAddForm ctx={ctx} /> : <LockedNote />}
      <h3 className="sub-heading">All entries (view only — edit in Edit)</h3>
      {sorted.length === 0 && <EmptyRow>No production entries yet.</EmptyRow>}
      {sorted.map((p) => {
        const lot = reels.find((r) => r.id === p.lotId);
        const items = itemsFor(p.id);
        const totalUsed = itemsWeightFor(p.id) + Number(p.wastageKg || 0);
        const isOpen = expanded === p.id;
        return (
          <div className="entry-card" key={p.id}>
            <div className="entry-card-head" onClick={() => setExpanded(isOpen ? null : p.id)}>
              <div className="entry-card-title">
                {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                <span className="mono-tag entry-tag">{productionLabelMap.get(p.id)}</span>
                <span>{fmtDate(p.date)} · {lot ? reelDesc(lot) : "removed"} {lot ? `Lot ${lot.lotNo}` : ""} · {items.length} sizes · {num(totalUsed)} kg used{p.closeOut ? " · closed" : ""}</span>
              </div>
            </div>
            {isOpen && (
              <div className="entry-card-body">
                {lot && <div className="row-sub" style={{ marginBottom: 8 }}>Status: <Stamp tone={statusTone(lotInfo[lot.id].status)}>{statusLabel(lotInfo[lot.id].status)}</Stamp> · wastage {num(p.wastageKg || 0)} kg</div>}
                <div className="tbl-wrap">
                  <table className="ledger-table">
                    <thead><tr><th>Size</th><th>Packets</th><th>Weight</th></tr></thead>
                    <tbody>
                      {items.map((it) => {
                        const sz = sizes.find((s) => s.id === it.sizeId);
                        const w = sz ? Number(it.packetsProduced) * packetWeightKg(sz) : 0;
                        return (<tr key={it.id}><td>{sz ? sizeLabel(sz) : "removed size"}</td><td className="mono">{num(it.packetsProduced)}</td><td className="mono">{num(w)} kg</td></tr>);
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
function ManageProductionModal({ ctx, prod, onClose }) {
  const { sizes, productionItems, persist, sizeLabel, packetWeightKg } = ctx;
  const [lines, setLines] = useState(productionItems.filter((it) => it.productionId === prod.id).map((l) => ({ ...l })));
  const [adds, setAdds] = useState([]);
  const [sizeId, setSizeId] = useState(""); const [packets, setPackets] = useState("");
  const addLine = () => { if (!sizeId || !packets) return; setAdds([...adds, { sizeId, packetsProduced: Number(packets) }]); setSizeId(""); setPackets(""); };
  const save = () => {
    const newRecs = adds.map((a) => ({ id: uid(), productionId: prod.id, sizeId: a.sizeId, packetsProduced: a.packetsProduced }));
    const others = productionItems.filter((it) => it.productionId !== prod.id);
    persist.productionItems([...others, ...lines, ...newRecs]);
    onClose();
  };
  const wOf = (l) => { const sz = sizes.find((s) => s.id === l.sizeId); return sz ? Number(l.packetsProduced) * packetWeightKg(sz) : 0; };
  return (
    <Modal title={`Manage ${ctx.productionLabelMap.get(prod.id)} — add / remove size lines`} onClose={onClose}>
      <h4 className="modal-sub">Existing lines</h4>
      {lines.length === 0 && <EmptyRow>All rows removed — saving leaves this production empty.</EmptyRow>}
      <div className="list panel-list">
        {lines.map((l) => {
          const sz = sizes.find((s) => s.id === l.sizeId);
          return (
            <div className="row" key={l.id}>
              <div><div className="row-title">{sz ? sizeLabel(sz) : "removed"}</div><div className="row-sub">{num(l.packetsProduced)} packets = {num(wOf(l))} kg</div></div>
              <div className="row-actions"><button className="icon-btn" onClick={() => setLines(lines.filter((x) => x.id !== l.id))}><Trash2 size={15} /></button></div>
            </div>
          );
        })}
      </div>
      <h4 className="modal-sub">Add more lines</h4>
      <div className="builder">
        <div className="builder-row">
          <div className="builder-desc"><ReelPicker lots={sizes} value={sizeId} onChange={setSizeId} labelFn={sizeLabel} placeholder="Search size…" /></div>
          <Field label="Packets"><input type="number" step="any" value={packets} onChange={(e) => setPackets(e.target.value)} placeholder="300" /></Field>
          <button className="btn primary builder-add" onClick={addLine} disabled={!sizeId || !packets}><Plus size={14} /> Add line</button>
        </div>
      </div>
      {adds.length > 0 && (
        <div className="list panel-list">
          {adds.map((a, i) => {
            const sz = sizes.find((s) => s.id === a.sizeId);
            return (
              <div className="row" key={i}>
                <div><div className="row-title">{sz ? sizeLabel(sz) : ""}</div><div className="row-sub">{num(a.packetsProduced)} packets (new)</div></div>
                <div className="row-actions"><button className="icon-btn" onClick={() => setAdds(adds.filter((_, x) => x !== i))}><Trash2 size={15} /></button></div>
              </div>
            );
          })}
        </div>
      )}
      <div className="form-actions">
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" onClick={save}><Check size={14} /> Save changes</button>
      </div>
    </Modal>
  );
}
function ProductionEditTab({ ctx }) {
  const canEdit = ctx.can("canEditEntries"), canDelete = ctx.can("canDeleteEntries");
  const { reels, sizes, productions, productionItems, persist, reelDesc, sizeLabel, packetWeightKg, productionLabelMap, itemsFor } = ctx;
  const [q, setQ] = useState(""); const [from, setFrom] = useState(""); const [to, setTo] = useState("");
  const [expanded, setExpanded] = useState(null);
  const [headEdit, setHeadEdit] = useState(null); const [eh, setEh] = useState(null);
  const [rowEdit, setRowEdit] = useState(null); const [ef, setEf] = useState(null);
  const [manage, setManage] = useState(null);
  if (!canEdit && !canDelete) return <LockedNote />;
  const filtered = productions.filter((p) => {
    if (from && p.date < from) return false;
    if (to && p.date > to) return false;
    if (!q.trim()) return true;
    const query = q.trim().toLowerCase();
    const lot = reels.find((r) => r.id === p.lotId);
    const label = (productionLabelMap.get(p.id) || "").toLowerCase();
    return `${label} ${lot ? lot.lotNo : ""} ${lot ? reelDesc(lot).toLowerCase() : ""}`.includes(query);
  }).sort((a, b) => (a.date < b.date ? 1 : -1));
  const saveHead = () => { persist.productions(productions.map((p) => p.id === headEdit ? { ...p, wastageKg: Number(eh.wastageKg || 0), closeOut: eh.closeOut, date: eh.date } : p)); setHeadEdit(null); };
  const saveRow = () => { persist.productionItems(productionItems.map((it) => it.id === rowEdit ? { ...it, sizeId: ef.sizeId, packetsProduced: Number(ef.packetsProduced) } : it)); setRowEdit(null); };
  const removeRow = (id) => { if (!confirmDelete("this line")) return; persist.productionItems(productionItems.filter((it) => it.id !== id)); };
  const removeBatch = (id) => { if (!confirmDelete(`${productionLabelMap.get(id)} and its lines`)) return; persist.productions(productions.filter((p) => p.id !== id)); persist.productionItems(productionItems.filter((it) => it.productionId !== id)); };
  const mp = filtered.find((p) => p.id === manage);
  return (
    <div>
      <SectionHead title="Edit production entries" />
      <div className="filter-bar no-print">
        <Field label="Search entry / lot"><div className="search-input"><Search size={13} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="PD-1, lot, brand…" /></div></Field>
        <Field label="From"><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="To"><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
      </div>
      <div className="info-banner">Use <b>+</b> on an entry to open the popup: add more size lines or remove existing ones. <b>✎</b> edits head / a line, 🗑 deletes.</div>
      {filtered.length === 0 && <EmptyRow>Nothing to edit.</EmptyRow>}
      {filtered.map((p) => {
        const lot = reels.find((r) => r.id === p.lotId); if (!lot) return null;
        const items = itemsFor(p.id);
        const open = expanded === p.id, editingHead = headEdit === p.id;
        return (
          <div className="entry-card" key={p.id}>
            <div className="entry-card-head" onClick={() => !editingHead && setExpanded(open ? null : p.id)}>
              <div className="entry-card-title">
                {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                <span className="mono-tag entry-tag">{productionLabelMap.get(p.id)}</span>
                {editingHead ? (
                  <span className="entry-date-edit" onClick={(e) => e.stopPropagation()}>
                    <input type="number" value={eh.wastageKg} onChange={(e) => setEh({ ...eh, wastageKg: e.target.value })} placeholder="wastage" style={{ width: 90 }} />
                    <label className="checkbox-field" style={{ margin: 0 }}><input type="checkbox" checked={eh.closeOut} onChange={(e) => setEh({ ...eh, closeOut: e.target.checked })} /><span>Closed</span></label>
                    <input type="date" value={eh.date} onChange={(e) => setEh({ ...eh, date: e.target.value })} />
                    <button className="icon-btn" onClick={saveHead}><Check size={14} /></button>
                    <button className="icon-btn" onClick={() => setHeadEdit(null)}><X size={14} /></button>
                  </span>
                ) : (<span>{fmtDate(p.date)} · {reelDesc(lot)} Lot {lot.lotNo} · {items.length} sizes</span>)}
              </div>
              {!editingHead && (
                <div className="row-actions">
                  {canEdit && <button className="icon-btn" title="Add / remove lines" onClick={(e) => { e.stopPropagation(); setManage(p.id); }}><Plus size={15} /></button>}
                  {canEdit && <button className="icon-btn" title="Edit head" onClick={(e) => { e.stopPropagation(); setHeadEdit(p.id); setEh({ wastageKg: p.wastageKg, closeOut: !!p.closeOut, date: p.date }); }}><Pencil size={15} /></button>}
                  {canDelete && <button className="icon-btn" onClick={(e) => { e.stopPropagation(); removeBatch(p.id); }}><Trash2 size={15} /></button>}
                </div>
              )}
            </div>
            {open && (
              <div className="entry-card-body">
                <div className="list panel-list">
                  {items.map((it) => {
                    const sz = sizes.find((s) => s.id === it.sizeId);
                    const w = sz ? Number(it.packetsProduced) * packetWeightKg(sz) : 0;
                    return (
                      <div className="row" key={it.id}>
                        {rowEdit === it.id ? (
                          <div className="edit-row">
                            <ReelPicker lots={sizes} value={ef.sizeId} onChange={(id) => setEf({ ...ef, sizeId: id })} labelFn={sizeLabel} placeholder="Search size…" />
                            <input type="number" step="any" value={ef.packetsProduced} onChange={(e) => setEf({ ...ef, packetsProduced: e.target.value })} style={{ width: 100 }} />
                            <button className="icon-btn" onClick={saveRow}><Check size={15} /></button>
                            <button className="icon-btn" onClick={() => setRowEdit(null)}><X size={15} /></button>
                          </div>
                        ) : (
                          <>
                            <div><div className="row-title">{sz ? sizeLabel(sz) : "removed"}</div><div className="row-sub">{num(it.packetsProduced)} packets = {num(w)} kg</div></div>
                            <div className="row-actions">
                              {canEdit && <button className="icon-btn" onClick={() => { setRowEdit(it.id); setEf({ sizeId: it.sizeId, packetsProduced: it.packetsProduced }); }}><Pencil size={15} /></button>}
                              {canDelete && <button className="icon-btn" onClick={() => removeRow(it.id)}><Trash2 size={15} /></button>}
                            </div>
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        );
      })}
      {mp && <ManageProductionModal ctx={ctx} prod={mp} onClose={() => setManage(null)} />}
    </div>
  );
}
function ProductionReportView({ ctx }) {
  if (!ctx.can("canViewReports")) return <LockedNote />;
  const { reels, sizes, productions, reelDesc, sizeLabel, packetWeightKg, avgGramForLot, itemsFor, itemsWeightFor, productionLabelMap, remainingAfterProduction } = ctx;
  const [q, setQ] = useState(""); const [from, setFrom] = useState(""); const [to, setTo] = useState("");
  const [sort, setSort] = useState({ field: "entry", dir: "desc" });
  const filtered = productions.filter((p) => {
    if (from && p.date < from) return false; if (to && p.date > to) return false;
    if (q.trim()) {
      const query = q.trim().toLowerCase();
      const lot = reels.find((r) => r.id === p.lotId);
      const label = (productionLabelMap.get(p.id) || "").toLowerCase();
      const hay = `${label} ${lot ? lot.lotNo : ""} ${lot ? reelDesc(lot).toLowerCase() : ""}`;
      if (!hay.includes(query)) return false;
    }
    return true;
  });
  const groups = groupByDate(filtered);
  const getters = { used: (p) => itemsWeightFor(p.id) + Number(p.wastageKg || 0), wastage: (p) => Number(p.wastageKg || 0) };
  const packetsFor = (p) => itemsFor(p.id).reduce((a, it) => a + Number(it.packetsProduced), 0);
  const grandPackets = filtered.reduce((a, p) => a + packetsFor(p), 0);
  const grandUsed = filtered.reduce((a, p) => a + itemsWeightFor(p.id), 0);
  const grandWastage = filtered.reduce((a, p) => a + Number(p.wastageKg || 0), 0);
  const doPrint = () => {
    let html = "";
    groups.forEach(([d, heads]) => {
      const sorted = sortWithin(heads, sort, getters);
      const dUsed = heads.reduce((a, p) => a + itemsWeightFor(p.id), 0);
      const dWastage = heads.reduce((a, p) => a + Number(p.wastageKg || 0), 0);
      html += `<h2>${esc(fmtDate(d))} — used ${num(dUsed)} kg — wastage ${num(dWastage)} kg</h2>`;
      sorted.forEach((p) => {
        const lot = reels.find((r) => r.id === p.lotId); if (!lot) return;
        const avgGram = avgGramForLot(lot);
        const remainingHere = remainingAfterProduction(p.id);
        html += `<h3>${esc(productionLabelMap.get(p.id))} — ${esc(reelDesc(lot))} (Lot ${esc(lot.lotNo)}) — wastage ${num(p.wastageKg || 0)} kg — rem ${num(remainingHere)} kg — avg ${num(avgGram)}${p.closeOut ? " — CLOSED" : ""}</h3><table><thead><tr><th>Size</th><th>Packets</th><th>Weight</th></tr></thead><tbody>`;
        itemsFor(p.id).forEach((it) => {
          const sz = sizes.find((s) => s.id === it.sizeId); if (!sz) return;
          const w = Number(it.packetsProduced) * packetWeightKg(sz);
          html += `<tr><td>${esc(sizeLabel(sz))}</td><td>${num(it.packetsProduced)}</td><td>${num(w)}</td></tr>`;
        });
        html += `</tbody></table>`;
      });
    });
    html += `<h2>Grand total</h2><table><tbody><tr><td>Total packets</td><td>${num(grandPackets)}</td></tr><tr><td>Total weight used</td><td>${num(grandUsed)} kg</td></tr><tr><td>Total wastage</td><td>${num(grandWastage)} kg</td></tr></tbody></table>`;
    printHTML("Production report", html);
  };
  return (
    <div>
      <SectionHead title="Production report" onPrint={doPrint} />
      <div className="filter-bar no-print">
        <Field label="Search"><div className="search-input"><Search size={13} /><input value={q} onChange={(e) => setQ(e.target.value)} /></div></Field>
        <Field label="From"><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="To"><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        <SortControl value={sort} onChange={setSort} options={[{ value: "entry", label: "Entry" }, { value: "used", label: "Used" }, { value: "wastage", label: "Wastage" }]} />
      </div>
      {groups.length === 0 && <EmptyRow>No entries match.</EmptyRow>}
      {groups.map(([d, heads]) => {
        const sorted = sortWithin(heads, sort, getters);
        const dUsed = heads.reduce((a, p) => a + itemsWeightFor(p.id), 0);
        const dWastage = heads.reduce((a, p) => a + Number(p.wastageKg || 0), 0);
        return (
          <div key={d} className="date-block">
            <div className="date-block-head">{fmtDate(d)} <span>used {num(dUsed)} kg · wastage {num(dWastage)} kg</span></div>
            {sorted.map((p) => {
              const lot = reels.find((r) => r.id === p.lotId); if (!lot) return null;
              const items = itemsFor(p.id);
              const totalUsed = itemsWeightFor(p.id) + Number(p.wastageKg || 0);
              const remainingHere = remainingAfterProduction(p.id);
              return (
                <div key={p.id} className="production-block">
                  <div className="production-head">
                    <div>
                      <span className="mono-tag entry-tag">{productionLabelMap.get(p.id)}</span> <b>{reelDesc(lot)}</b> <span className="mono-tag">Lot {lot.lotNo}</span>
                      <span className="row-sub"> · wastage {num(p.wastageKg || 0)} kg · used {num(totalUsed)} kg · rem {num(remainingHere)} kg · avg {num(avgGramForLot(lot))}{p.closeOut ? " · closed" : ""}</span>
                    </div>
                  </div>
                  <table className="ledger-table">
                    <thead><tr><th>Size</th><th>Packets</th><th>Weight</th></tr></thead>
                    <tbody>
                      {items.length === 0 && <tr><td colSpan={3}><EmptyRow>No sizes.</EmptyRow></td></tr>}
                      {items.map((it) => {
                        const sz = sizes.find((s) => s.id === it.sizeId); if (!sz) return null;
                        const w = Number(it.packetsProduced) * packetWeightKg(sz);
                        return (<tr key={it.id}><td>{sizeLabel(sz)}</td><td className="mono">{num(it.packetsProduced)}</td><td className="mono">{num(w)}</td></tr>);
                      })}
                    </tbody>
                    {items.length > 0 && (<tfoot><tr><td>{items.length} sizes</td><td className="mono">{num(packetsFor(p))}</td><td className="mono">{num(itemsWeightFor(p.id))}</td></tr></tfoot>)}
                  </table>
                </div>
              );
            })}
          </div>
        );
      })}
      {filtered.length > 0 && (<div className="report-grand-total"><span>Grand total — {filtered.length} entries</span><span className="mono">Packets {num(grandPackets)}</span><span className="mono">Used {num(grandUsed)} kg</span><span className="mono">Wastage {num(grandWastage)} kg</span></div>)}
    </div>
  );
}

/* ================= stock ================= */
function StockReportTab({ ctx }) {
  if (!ctx.can("canViewReports")) return <LockedNote />;
  const { suppliers, lotInfo, reelDesc, supplierName, purchasedByLabel, lifterName } = ctx;
  const reels = ctx.allStockLots || ctx.reels;
  const [supplierFilter, setSupplierFilter] = useState([]);
  const [statusFilter, setStatusFilter] = useState([]);
  const [q, setQ] = useState("");
  const [from, setFrom] = useState(""); const [to, setTo] = useState("");
  const [sort, setSort] = useState({ field: "date", dir: "desc" });
  const statusOptions = [{ value: "consignment", label: "In godown" }, { value: "partial", label: "Partly converted" }, { value: "converted", label: "Fully converted" }, { value: "purchased", label: "Purchased" }, { value: "held", label: "On Hold" }, { value: "pipeline", label: "In Pipeline" }];
  const supplierOptions = suppliers.map((s) => ({ value: s.id, label: s.name }));
  const rows = reels.filter((lot) => {
    if (supplierFilter.length && !supplierFilter.includes(lot.supplierId)) return false;
    if (statusFilter.length && !statusFilter.includes(lotInfo[lot.id].status)) return false;
    if (from && lot.date < from) return false; if (to && lot.date > to) return false;
    if (q.trim()) {
      const query = q.trim().toLowerCase();
      const hay = `${lot.lotNo} ${lot.width} ${reelDesc(lot).toLowerCase()} ${lifterName(lot.lifterId).toLowerCase()}`;
      if (!hay.includes(query)) return false;
    }
    return true;
  });
  const dir = sort.dir === "asc" ? 1 : -1;
  const sorted = [...rows].sort((a, b) => {
    if (sort.field === "date") return (a.date < b.date ? 1 : a.date > b.date ? -1 : 0) * (sort.dir === "asc" ? -1 : 1);
    if (sort.field === "weight") return (Number(a.weight) - Number(b.weight)) * dir;
    if (sort.field === "remaining") return (lotInfo[a.id].remaining - lotInfo[b.id].remaining) * dir;
    if (sort.field === "description") return reelDesc(a).localeCompare(reelDesc(b)) * dir;
    if (sort.field === "lotNo") return String(a.lotNo).localeCompare(String(b.lotNo), undefined, { numeric: true }) * dir;
    if (sort.field === "width") return (Number(a.width) - Number(b.width)) * dir;
    return 0;
  });
  const sumRemaining = sorted.reduce((a, lot) => a + lotInfo[lot.id].remaining, 0);
  const sumWeight = sorted.reduce((a, lot) => a + Number(lot.weight), 0);
  const doPrint = () => {
    let html = `<table><thead><tr><th>Desc</th><th>Detail</th><th>Lot</th><th>Width</th><th>Supplier</th><th>Lifter</th><th>Status</th><th>Buyer</th><th>Rem</th><th>Wt</th></tr></thead><tbody>`;
    sorted.forEach((lot) => {
      const info = lotInfo[lot.id];
      html += `<tr><td>${esc(reelDesc(lot))}</td><td>${esc(lot.detail || "—")}</td><td class="tag">${esc(lot.lotNo)}</td><td>${esc(lot.width)}</td><td>${esc(supplierName(lot.supplierId))}</td><td>${esc(lifterName(lot.lifterId))}</td><td>${esc(statusLabel(info.status))}</td><td>${esc(purchasedByLabel(info.purchase || {}) || "—")}</td><td>${num(info.remaining)}</td><td>${num(lot.weight)}</td></tr>`;
    });
    html += `</tbody><tfoot><tr><td colspan="8">${sorted.length} lots</td><td>${num(sumRemaining)}</td><td>${num(sumWeight)}</td></tr></tfoot></table>`;
    printHTML("Current stock", html);
  };
  return (
    <div>
      <SectionHead title="Current stock" onPrint={doPrint} />
      <div className="filter-bar no-print">
        <Field label="Search"><div className="search-input"><Search size={13} /><input value={q} onChange={(e) => setQ(e.target.value)} /></div></Field>
        <Field label="Supplier"><MultiSelect options={supplierOptions} values={supplierFilter} onChange={setSupplierFilter} /></Field>
        <Field label="Status"><MultiSelect options={statusOptions} values={statusFilter} onChange={setStatusFilter} /></Field>
        <Field label="From"><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="To"><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        <SortControl value={sort} onChange={setSort} options={[{ value: "date", label: "Date" }, { value: "description", label: "Desc" }, { value: "lotNo", label: "Lot" }, { value: "width", label: "Width" }, { value: "weight", label: "Weight" }, { value: "remaining", label: "Remaining" }]} />
      </div>
      <table className="ledger-table">
        <thead><tr><th>Item</th><th>Detail</th><th>Lot</th><th>Width</th><th>Supplier</th><th>Lifter</th><th>Status</th><th>Buyer</th><th>Remaining</th><th>Weight</th></tr></thead>
        <tbody>
          {sorted.length === 0 && <tr><td colSpan={10}><EmptyRow>No lots match.</EmptyRow></td></tr>}
          {sorted.map((lot) => {
            const info = lotInfo[lot.id];
            return (
              <tr key={lot.id}>
                <td>{reelDesc(lot)}</td><td>{lot.detail || "—"}</td><td className="mono">{lot.lotNo}</td><td className="mono">{lot.width || "—"}</td>
                <td>{supplierName(lot.supplierId)}</td><td>{lifterName(lot.lifterId)}</td>
                <td><Stamp tone={statusTone(info.status)}>{statusLabel(info.status)}</Stamp></td>
                <td>{purchasedByLabel(info.purchase || {}) || "—"}</td>
                <td className="mono">{num(info.remaining)}</td><td className="mono">{num(lot.weight)}</td>
              </tr>
            );
          })}
        </tbody>
        {sorted.length > 0 && (<tfoot><tr><td colSpan={8}>{sorted.length} lots</td><td className="mono">{num(sumRemaining)}</td><td className="mono">{num(sumWeight)}</td></tr></tfoot>)}
      </table>
    </div>
  );
}
function ReelsQuantityTab({ ctx }) {
  if (!ctx.can("canViewReports")) return <LockedNote />;
  const { suppliers, lotInfo, reelDesc } = ctx;
  const reels = ctx.allStockLots || ctx.reels;
  const [supplierFilter, setSupplierFilter] = useState([]);
  const [statusFilter, setStatusFilter] = useState([]);
  const [q, setQ] = useState("");
  const [from, setFrom] = useState(""); const [to, setTo] = useState("");
  const [sort, setSort] = useState({ field: "qty", dir: "desc" });
  const statusOptions = [{ value: "consignment", label: "In godown" }, { value: "partial", label: "Partly converted" }, { value: "converted", label: "Fully converted" }, { value: "purchased", label: "Purchased" }, { value: "held", label: "On Hold" }, { value: "pipeline", label: "In Pipeline" }];
  const supplierOptions = suppliers.map((s) => ({ value: s.id, label: s.name }));
  const rows = reels.filter((lot) => {
    if (supplierFilter.length && !supplierFilter.includes(lot.supplierId)) return false;
    if (statusFilter.length && !statusFilter.includes(lotInfo[lot.id].status)) return false;
    if (from && lot.date < from) return false; if (to && lot.date > to) return false;
    if (q.trim()) {
      const query = q.trim().toLowerCase();
      const hay = `${lot.lotNo} ${lot.width} ${reelDesc(lot).toLowerCase()}`;
      if (!hay.includes(query)) return false;
    }
    return true;
  });
  const groups = useMemo(() => {
    const map = new Map();
    rows.forEach((lot) => {
      const key = `${reelDesc(lot)}|||${lot.width}`;
      if (!map.has(key)) map.set(key, { description: reelDesc(lot), width: lot.width, qty: 0, sumWeight: 0, sumRemaining: 0 });
      const g = map.get(key);
      g.qty += 1; g.sumWeight += Number(lot.weight); g.sumRemaining += lotInfo[lot.id].remaining;
    });
    return [...map.values()];
  }, [rows, lotInfo]);
  const dir = sort.dir === "asc" ? 1 : -1;
  const sorted = [...groups].sort((a, b) => {
    if (sort.field === "qty") return (a.qty - b.qty) * dir;
    if (sort.field === "weight") return (a.sumWeight - b.sumWeight) * dir;
    if (sort.field === "remaining") return (a.sumRemaining - b.sumRemaining) * dir;
    if (sort.field === "description") return a.description.localeCompare(b.description) * dir;
    if (sort.field === "width") return (Number(a.width) - Number(b.width)) * dir;
    return a.description.localeCompare(b.description);
  });
  const totalQty = sorted.reduce((a, g) => a + g.qty, 0);
  const totalWeight = sorted.reduce((a, g) => a + g.sumWeight, 0);
  const totalRemaining = sorted.reduce((a, g) => a + g.sumRemaining, 0);
  const doPrint = () => {
    let html = `<table><thead><tr><th>Item</th><th>Width</th><th>Qty</th><th>Weight</th><th>Remaining</th></tr></thead><tbody>`;
    sorted.forEach((g) => { html += `<tr><td>${esc(g.description)}</td><td>${esc(g.width)}</td><td>${num(g.qty, 0)}</td><td>${num(g.sumWeight)}</td><td>${num(g.sumRemaining)}</td></tr>`; });
    html += `</tbody><tfoot><tr><td colspan="2">${sorted.length} items</td><td>${num(totalQty, 0)}</td><td>${num(totalWeight)}</td><td>${num(totalRemaining)}</td></tr></tfoot></table>`;
    printHTML("Reels quantity", html);
  };
  return (
    <div>
      <SectionHead title="Reels quantity" onPrint={doPrint} />
      <div className="filter-bar no-print">
        <Field label="Search"><div className="search-input"><Search size={13} /><input value={q} onChange={(e) => setQ(e.target.value)} /></div></Field>
        <Field label="Supplier"><MultiSelect options={supplierOptions} values={supplierFilter} onChange={setSupplierFilter} /></Field>
        <Field label="Status"><MultiSelect options={statusOptions} values={statusFilter} onChange={setStatusFilter} /></Field>
        <Field label="From"><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="To"><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        <SortControl value={sort} onChange={setSort} options={[{ value: "qty", label: "Qty" }, { value: "description", label: "Desc" }, { value: "width", label: "Width" }, { value: "weight", label: "Weight" }, { value: "remaining", label: "Remaining" }]} />
      </div>
      <table className="ledger-table">
        <thead><tr><th>Item</th><th>Width</th><th>Qty</th><th>Weight</th><th>Remaining</th></tr></thead>
        <tbody>
          {sorted.length === 0 && <tr><td colSpan={5}><EmptyRow>No lots match.</EmptyRow></td></tr>}
          {sorted.map((g) => (
            <tr key={g.description + g.width}>
              <td>{g.description}</td><td className="mono">{g.width || "—"}</td>
              <td className="mono">{num(g.qty, 0)}</td><td className="mono">{num(g.sumWeight)}</td><td className="mono">{num(g.sumRemaining)}</td>
            </tr>
          ))}
        </tbody>
        {sorted.length > 0 && (<tfoot><tr><td colSpan={2}>{sorted.length} items</td><td className="mono">{num(totalQty, 0)}</td><td className="mono">{num(totalWeight)}</td><td className="mono">{num(totalRemaining)}</td></tr></tfoot>)}
      </table>
    </div>
  );
}

/* ================= team ================= */
function TeamTab() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState(null);
  const [err, setErr] = useState("");
  const permKeys = [
    { key: "canAddEntries", label: "Add" }, { key: "canEditEntries", label: "Edit" },
    { key: "canDeleteEntries", label: "Delete" }, { key: "canManageMasters", label: "Masters" },
    { key: "canViewReports", label: "Reports" },
  ];
  useEffect(() => {
    (async () => {
      try { setRows(await sbList("profiles", "?select=*&order=created_at.asc")); }
      catch (e) { setErr(e.message); }
      setLoading(false);
    })();
  }, []);
  const update = (id, patch) => setRows(rows.map((r) => r.id === id ? { ...r, ...patch } : r));
  const save = async (row) => {
    setSavingId(row.id);
    try {
      await sbUpdate("profiles", row.id, { role: row.role, canAddEntries: row.canAddEntries, canEditEntries: row.canEditEntries, canDeleteEntries: row.canDeleteEntries, canManageMasters: row.canManageMasters, canViewReports: row.canViewReports });
    } catch (e) { alert("Save failed: " + e.message); }
    setSavingId(null);
  };
  if (loading) return <EmptyRow>Loading team…</EmptyRow>;
  if (err) return <LockedNote text={err} />;
  return (
    <div>
      <SectionHead title="Team &amp; access" />
      <div className="computed" style={{ marginBottom: 14 }}>Names are whatever was given at signup. Reports access is required for almost everything else.</div>
      {rows.length === 0 && <EmptyRow>No accounts yet.</EmptyRow>}
      {rows.map((r) => (
        <div key={r.id} className="team-row">
          <div className="team-row-name">{r.fullName || "—"}</div>
          <select value={r.role} onChange={(e) => update(r.id, { role: e.target.value })}>
            <option value="employee">Employee</option>
            <option value="admin">Admin</option>
          </select>
          {permKeys.map((p) => (
            <label key={p.key} className="checkbox-field team-perm">
              <input type="checkbox" checked={!!r[p.key]} disabled={r.role === "admin"} onChange={(e) => update(r.id, { [p.key]: e.target.checked })} />
              <span>{p.label}</span>
            </label>
          ))}
          <button className="btn" onClick={() => save(r)} disabled={savingId === r.id}>{savingId === r.id ? "Saving…" : "Save"}</button>
        </div>
      ))}
    </div>
  );
}

/* ================= styles ================= */
function Style() {
  return (<style>{`
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@500;600;700&display=swap');
*,*::before,*::after{box-sizing:border-box}
:root{--navy:#1B2559;--blue:#4318FF;--blue2:#7551FF;--blue-soft:#EEEAFF;--red:#e5484d;--green:#2eb872;--amber:#f5a524;--bg:#F4F7FE;--line:#E9EDF7;--muted:#A3AED0;--shadow:0 5px 24px rgba(112,144,176,0.14);--radius:16px}
html,body,#root{height:100%;margin:0;padding:0;width:100%;background:var(--bg);color:var(--navy);font-family:'Inter','Segoe UI',sans-serif;font-size:14px}
input,textarea,select,button{font-family:inherit;color:var(--navy)}
.mono,.mono-tag{font-family:'JetBrains Mono',monospace}
.spin{animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}
.app-shell{min-height:100vh}
.loading-shell{display:flex;align-items:center;justify-content:center;gap:10px;padding:60px 0;color:var(--muted);font-weight:600}
.app-layout{display:flex;min-height:100vh}
.main-area{flex:1;min-width:0;padding:20px 26px 40px}
.app-main{max-width:1240px;margin:0 auto}
/* sidebar */
.rail{width:248px;flex-shrink:0;background:#fff;border-right:1px solid var(--line);display:flex;flex-direction:column;padding:14px 12px;gap:4px;position:sticky;top:0;height:100vh;z-index:30;box-shadow:4px 0 24px rgba(23,50,77,.06)}
.rail-top{display:flex;align-items:center;gap:10px;padding:4px 6px 12px;border-bottom:1px solid var(--line);margin-bottom:8px}
.rail-logo{width:40px;height:40px;border-radius:12px;background:linear-gradient(135deg,var(--blue),var(--blue2));color:#fff;display:flex;align-items:center;justify-content:center;flex-shrink:0;box-shadow:0 8px 18px rgba(67,24,255,.35)}
.rail-brand-title{font-size:14px;font-weight:800;color:var(--navy);white-space:nowrap}
.rail-brand-sub{font-size:9.5px;color:var(--blue2);font-weight:800;text-transform:uppercase;letter-spacing:.1em;white-space:nowrap}
.rail-nav{display:flex;flex-direction:column;gap:2px;flex:1;overflow-y:auto}
.rail-btn{display:flex;align-items:center;gap:10px;width:100%;padding:10px 12px;border-radius:12px;border:none;background:transparent;color:var(--muted);font-size:13px;font-weight:700;cursor:pointer;text-align:left;transition:.15s}
.rail-btn svg{flex-shrink:0}
.rail-label{flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rail-chevron{opacity:.5;flex-shrink:0;transition:.15s}.rail-chevron.open{transform:rotate(90deg)}
.rail-btn:hover{background:var(--blue-soft);color:var(--blue)}
.rail-btn.active{background:var(--blue-soft);color:var(--blue);box-shadow:inset 0 0 0 1px rgba(67,24,255,.18)}
.rail-foot{margin-top:auto;padding-top:8px;border-top:1px solid var(--line)}
.rail-signout:hover{background:var(--red);color:#fff}
/* header + pills */
.page-head{display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap;background:#fff;border-radius:var(--radius);padding:12px 18px;box-shadow:var(--shadow);margin-bottom:12px}
.page-head h1{font-size:20px;font-weight:800;margin:0;color:var(--navy)}
.page-sub{color:var(--muted);font-size:11.5px;margin-top:2px;font-weight:600}
.user-chip{display:flex;align-items:center;gap:10px;background:var(--bg);border-radius:12px;padding:6px 12px 6px 6px}
.user-avatar{width:34px;height:34px;border-radius:10px;background:linear-gradient(135deg,var(--blue),var(--blue2));color:#fff;font-weight:800;display:flex;align-items:center;justify-content:center}
.user-mail{font-size:12px;font-weight:700}
.user-role{font-size:9.5px;color:var(--muted);text-transform:uppercase;letter-spacing:.07em;font-weight:800}
.pill-tabs{display:flex;gap:8px;margin:0 0 18px;flex-wrap:wrap}
.pill{border:none;background:#fff;color:var(--muted);font-size:12.5px;font-weight:700;padding:9px 18px;border-radius:999px;cursor:pointer;box-shadow:var(--shadow);transition:.15s}
.pill:hover:not(.on){color:var(--navy)}
.pill.on{background:var(--navy);color:#fff}
/* generic */
.section-head{margin-bottom:12px;display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap}
.section-head h2{font-weight:800;font-size:16px;margin:0;color:var(--navy)}
.sub-heading{font-weight:800;font-size:11px;text-transform:uppercase;color:var(--muted);margin:18px 0 10px;letter-spacing:.07em}
.btn{font-size:12.5px;font-weight:700;padding:9px 15px;border-radius:10px;border:1px solid var(--line);background:#fff;color:var(--navy);cursor:pointer;display:inline-flex;align-items:center;gap:6px;box-shadow:var(--shadow);transition:.15s}
.btn:hover:not(:disabled){border-color:var(--blue);color:var(--blue)}
.btn:disabled{opacity:.45;cursor:not-allowed}
.btn.primary{background:linear-gradient(135deg,var(--blue),var(--blue2));color:#fff;border-color:transparent}
.btn.primary:hover:not(:disabled){color:#fff;filter:brightness(1.06)}
.icon-btn{border:none;background:transparent;color:var(--muted);cursor:pointer;padding:6px;border-radius:8px;display:inline-flex;transition:.15s}
.icon-btn:hover:not(:disabled){background:var(--blue-soft);color:var(--blue)}
.icon-btn:disabled{opacity:.3;cursor:not-allowed}
.field{display:flex;flex-direction:column;gap:5px;font-size:10px;color:var(--muted);font-weight:800;text-transform:uppercase;letter-spacing:.07em}
.field input,.field select{font-family:'JetBrains Mono',monospace;font-size:12.5px;padding:9px 11px;border:1px solid var(--line);border-radius:10px;background:#fff;width:100%}
.field input:focus,.field select:focus{outline:none;border-color:var(--blue);box-shadow:0 0 0 3px rgba(67,24,255,.10)}
.search-input{display:flex;align-items:center;gap:6px;background:#fff;border:1px solid var(--line);border-radius:10px;padding:0 11px;min-width:180px}
.search-input:focus-within{border-color:var(--blue);box-shadow:0 0 0 3px rgba(67,24,255,.10)}
.search-input svg{color:var(--muted);flex-shrink:0}
.search-input input{border:none;padding:9px 0;background:transparent;width:100%;font-family:'JetBrains Mono',monospace;font-size:12.5px}
.search-input input:focus{outline:none}
.sort-control{display:flex;gap:6px}
.sort-control select{font-family:'JetBrains Mono',monospace;font-size:12px;padding:8px 10px;border:1px solid var(--line);border-radius:10px;background:#fff}
.sort-dir-btn{white-space:nowrap}
.multiselect{position:relative}
.multiselect-btn{width:100%;min-width:150px;display:flex;justify-content:space-between;align-items:center;gap:8px;font-family:'JetBrains Mono',monospace;font-size:12.5px;padding:9px 12px;border:1px solid var(--line);border-radius:10px;background:#fff;color:var(--navy);cursor:pointer}
.multiselect-panel{position:absolute;top:calc(100% + 4px);left:0;z-index:40;background:#fff;border:1px solid var(--line);border-radius:12px;box-shadow:var(--shadow);padding:8px;min-width:190px;max-height:220px;overflow-y:auto;display:flex;flex-direction:column;gap:2px}
.multiselect-option{display:flex;align-items:center;gap:8px;font-size:12.5px;padding:7px 8px;border-radius:8px;cursor:pointer;white-space:nowrap}
.multiselect-option:hover{background:var(--bg)}
.multiselect-clear{margin-top:4px;font-size:11px;padding:5px 8px;align-self:flex-start;color:var(--blue);font-weight:700}
.checkbox-field{display:flex;align-items:flex-start;gap:8px;font-size:12.5px;color:var(--navy);cursor:pointer;line-height:1.45}
.checkbox-field input{margin-top:2px;accent-color:var(--blue)}
.stamp{font-family:'JetBrains Mono',monospace;font-size:9.5px;text-transform:uppercase;letter-spacing:.05em;padding:4px 10px;border-radius:999px;white-space:nowrap;display:inline-block;font-weight:700}
.stamp-green{color:#047857;background:#D1FAE5}.stamp-rust{color:var(--red);background:#FEEEEE}.stamp-gray{color:var(--muted);background:#EEF1F5}.stamp-amber{color:#B45309;background:#FFF4E0}.stamp-blue{color:#0369A1;background:#E0F2FE}.stamp-indigo{color:var(--blue);background:var(--blue-soft)}
.entry-tag{background:var(--blue-soft);color:var(--blue);padding:3px 9px;border-radius:8px;font-size:10.5px;font-weight:800}
.pl-tag{background:var(--blue-soft);color:var(--blue2);padding:3px 9px;border-radius:8px;font-size:10.5px;font-weight:800}
.pl-chip{position:absolute;right:7px;top:50%;transform:translateY(-50%);background:var(--amber);color:#fff;font-size:8.5px;font-weight:800;padding:2px 5px;border-radius:5px;letter-spacing:.04em}
.pl-chip-inline{background:var(--blue-soft);color:var(--blue2);padding:3px 7px;border-radius:7px;font-size:10px;font-weight:800}
.lot-cell{position:relative}
.lot-cell input{width:100%}
.info-banner{background:var(--blue-soft);border:1px solid rgba(67,24,255,.3);color:var(--blue);border-radius:12px;padding:10px 14px;font-size:12px;font-weight:600;margin-bottom:12px}
.notice-warn{background:#FFF4E0;border:1px solid var(--amber);color:#8a5b00;border-radius:10px;padding:9px 13px;font-size:12px;font-weight:600;margin:8px 0}
/* modal (copied from PKT) */
.modal-overlay{position:fixed;inset:0;background:rgba(27,37,89,.45);z-index:80;display:flex;align-items:center;justify-content:center;padding:20px}
.modal-panel{background:#fff;border-radius:16px;box-shadow:0 20px 60px rgba(27,37,89,.35);width:100%;max-width:860px;max-height:88vh;display:flex;flex-direction:column}
.modal-head{display:flex;justify-content:space-between;align-items:center;padding:14px 18px;border-bottom:1px solid var(--line)}
.modal-head h3{margin:0;font-size:14px;font-weight:800;color:var(--navy)}
.modal-body{padding:14px 18px;overflow-y:auto;display:flex;flex-direction:column;gap:12px}
.modal-sub{margin:0 0 4px;font-size:10.5px;text-transform:uppercase;letter-spacing:.07em;color:var(--muted);font-weight:800}
/* search-and-enter picker (copied UX from PKT DescPicker) */
.rp{position:relative;width:100%;min-width:0}
.rp-box{display:flex;align-items:center;gap:8px;width:100%;background:#fff;border:1px solid var(--line);border-radius:10px;padding:9px 11px;font-family:'JetBrains Mono',monospace;font-size:12.5px;color:var(--navy);cursor:pointer;text-align:left}
.rp-box:hover{border-color:var(--blue)}
.rp-box>svg{color:var(--muted);flex-shrink:0}
.rp-val{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:700}
.rp-ph{flex:1;color:var(--muted);font-weight:500}
.rp-clear{border:none;background:transparent;color:var(--muted);cursor:pointer;padding:2px;border-radius:5px;display:inline-flex}
.rp-clear:hover{color:var(--red);background:#FEEEEE}
.rp-panel{background:#fff;border:1px solid var(--line);border-radius:12px;box-shadow:0 14px 40px rgba(23,50,77,.25);overflow:hidden;display:flex;flex-direction:column}
.rp-search{display:flex;align-items:center;gap:8px;padding:9px 12px;border-bottom:1px solid var(--line);flex-shrink:0}
.rp-search svg{color:var(--muted);flex-shrink:0}
.rp-search input{border:none;background:transparent;width:100%;font-family:'JetBrains Mono',monospace;font-size:12.5px;color:var(--navy)}
.rp-search input:focus{outline:none}
.rp-list{overflow-y:auto;flex:1}
.rp-opt{display:flex;justify-content:space-between;align-items:center;gap:10px;width:100%;padding:9px 12px;border:none;border-top:1px solid var(--line);background:#fff;cursor:pointer;text-align:left}
.rp-opt:first-child{border-top:none}
.rp-opt:hover{background:var(--blue-soft)}
.rp-name{font-size:12.5px;font-weight:700;color:var(--navy)}
.rp-badge{font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--blue2);background:var(--blue-soft);border-radius:999px;padding:3px 9px;white-space:nowrap}
.rp-empty{padding:12px;font-size:12px;color:var(--muted);font-weight:600}
/* forms */
.ticket-form{background:#fff;border-radius:var(--radius);padding:18px;margin-bottom:12px;display:flex;flex-direction:column;gap:12px;box-shadow:var(--shadow)}
.grid-2{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.span-2{grid-column:span 2}
.form-divider{display:flex;align-items:center;gap:10px}
.form-divider span{font-size:10.5px;text-transform:uppercase;letter-spacing:.07em;color:var(--muted);font-weight:800;white-space:nowrap}
.form-divider::after{content:"";flex:1;border-top:1px dashed var(--line)}
.computed{font-size:12.5px;color:var(--muted);font-weight:600}
.computed b{color:var(--navy);font-family:'JetBrains Mono',monospace}
.form-actions{display:flex;gap:10px;justify-content:space-between;align-items:center;flex-wrap:wrap}
.rows-table{display:flex;flex-direction:column;gap:8px;overflow-x:auto}
.rows-head,.rows-line{display:grid;gap:10px;align-items:center}
.rows-head.cols-3,.rows-line.cols-3{grid-template-columns:1.6fr .9fr .9fr 30px}
.rows-head.cols-5,.rows-line.cols-5{grid-template-columns:1.5fr .8fr .6fr .9fr .8fr}
.rows-head.cols-7,.rows-line.cols-7{grid-template-columns:.9fr 1.1fr .6fr .6fr .8fr 1fr 30px}
.rows-head.cols-8,.rows-line.cols-8{grid-template-columns:.8fr .9fr .6fr .6fr .7fr .9fr .9fr 30px}
.rows-head span{font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);font-weight:800}
.rows-line input,.rows-line select{font-family:'JetBrains Mono',monospace;font-size:12.5px;padding:9px 10px;border:1px solid var(--line);border-radius:10px;background:#fff;width:100%}
.rows-line input:focus,.rows-line select:focus{outline:none;border-color:var(--blue)}
.static-cell{font-size:12.5px;padding:8px 4px;font-weight:600}
.static-cell.danger{color:var(--red)}
.import-bar{display:flex;justify-content:flex-end}
.import-toggle{border-color:rgba(67,24,255,.35);color:var(--blue);background:var(--blue-soft)}
.import-panel{background:#fff;border:1.5px dashed rgba(67,24,255,.4);border-radius:14px;padding:14px;display:flex;flex-direction:column;gap:10px}
.import-panel-head{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap}
.import-panel-title{font-size:12px;font-weight:700;color:var(--muted)}
.import-batch{border:1px solid var(--line);border-radius:12px;overflow:hidden}
.import-batch-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap;background:var(--bg);padding:9px 12px;font-size:12px;font-weight:600;color:var(--navy)}
.select-all-btn{margin-left:auto;padding:5px 12px;font-size:11px;border-radius:999px}
.import-row{display:flex;align-items:center;gap:10px;padding:8px 12px;border-top:1px solid var(--line);cursor:pointer;font-size:12.5px}
.import-row:hover{background:var(--blue-soft)}
.import-row input{accent-color:var(--blue)}
.import-row-main{color:var(--navy);font-weight:600}
.builder{background:var(--bg);border:1px solid var(--line);border-radius:12px;padding:12px;display:flex;flex-direction:column;gap:10px}
.builder-row{display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end}
.builder-desc{flex:2;min-width:220px}
.builder-row .field{flex:0 0 110px}
.builder-add{flex:0 0 auto;margin-left:auto}
/* lists & cards */
.list{display:flex;flex-direction:column}
.panel-list{background:#fff;border-radius:var(--radius);box-shadow:var(--shadow);padding:4px 16px}
.pick-list{max-height:300px;overflow-y:auto;border:1px solid var(--line);border-radius:12px;padding:8px}
.pick-row{padding:7px 6px;border-bottom:1px solid var(--line)}
.pick-row:last-child{border-bottom:none}
.row{display:flex;justify-content:space-between;align-items:center;padding:10px 4px;gap:12px;border-bottom:1px solid var(--line)}
.row:last-child{border-bottom:none}
.row-title{font-weight:700;font-size:13px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;color:var(--navy)}
.row-sub{font-size:11px;color:var(--muted);margin-top:2px;font-weight:600}
.row-actions{display:flex;align-items:center;gap:6px;flex-shrink:0}
.row-expand{border:none;background:transparent;color:var(--muted);cursor:pointer;padding:4px;display:flex;align-items:center;border-radius:6px}
.row-expand:hover{background:var(--bg)}
.entry-card{border-radius:14px;margin-bottom:10px;overflow:hidden;background:#fff;box-shadow:var(--shadow)}
.entry-card-head{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:12px 16px;cursor:pointer;transition:.12s}
.entry-card-head:hover{background:var(--bg)}
.entry-card-title{display:flex;align-items:center;gap:9px;font-size:12.5px;flex-wrap:wrap;font-weight:600;color:var(--navy)}
.entry-card-body{padding:6px 16px 12px;border-top:1px solid var(--line)}
.entry-date-edit{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.entry-date-edit input,.entry-date-edit select{font-family:'JetBrains Mono',monospace;font-size:12px;padding:5px 8px;border:1px solid var(--line);border-radius:8px}
.edit-row{display:flex;gap:6px;flex:1;align-items:center;flex-wrap:wrap}
.edit-row.grid-4{display:grid;grid-template-columns:1.6fr .8fr 1fr auto auto;gap:8px}
.edit-row.grid-5{display:grid;grid-template-columns:1.4fr .6fr .8fr .9fr auto auto;gap:8px}
.edit-row.grid-8{display:grid;grid-template-columns:.8fr .9fr .6fr .6fr .7fr .8fr .8fr .8fr auto auto;gap:6px}
.edit-row input,.edit-row select{font-family:'JetBrains Mono',monospace;font-size:12px;padding:7px;border:1.5px solid var(--blue);border-radius:8px;width:100%;min-width:70px;background:#fff}
.detail-panel{background:var(--bg);padding:12px 16px;font-size:12px;border-radius:10px}
.detail-title{font-weight:800;margin-bottom:6px;text-transform:uppercase;font-size:10px;letter-spacing:.06em;color:var(--muted)}
.detail-line{color:var(--navy);padding:3px 0;font-weight:600}
.production-block{margin-bottom:12px;border:1px solid var(--line);border-radius:12px;overflow:hidden;background:#fff}
.production-head{display:flex;justify-content:space-between;align-items:center;gap:10px;background:var(--bg);padding:10px 14px;flex-wrap:wrap}
/* dashboard */
.metric-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(225px,1fr));gap:14px;margin-bottom:16px}
.metric-card{position:relative;background:#fff;border-radius:var(--radius);padding:16px 16px 14px 22px;box-shadow:var(--shadow);overflow:hidden}
.metric-card::before{content:'';position:absolute;left:0;top:14px;bottom:14px;width:4px;border-radius:0 4px 4px 0;background:var(--blue)}
.metric-card.tone-violet::before{background:var(--blue2)}
.metric-card.tone-green::before{background:var(--green)}
.metric-card.tone-amber::before{background:var(--amber)}
.metric-card.tone-cyan::before{background:#0BC0EA}
.metric-top{display:flex;justify-content:space-between;align-items:flex-start}
.metric-label{font-size:10.5px;color:var(--muted);font-weight:800;text-transform:uppercase;letter-spacing:.06em}
.metric-icon{width:32px;height:32px;border-radius:10px;background:var(--bg);color:var(--navy);display:flex;align-items:center;justify-content:center}
.metric-value{font-family:'JetBrains Mono',monospace;font-size:21px;font-weight:700;color:var(--navy);margin-top:6px}
.metric-sub{font-size:11px;color:var(--muted);margin-top:3px;font-weight:600}
.dash-grid{display:grid;grid-template-columns:1.35fr 1fr;gap:14px;margin-bottom:16px}
.panel{background:#fff;border-radius:var(--radius);box-shadow:var(--shadow);padding:18px}
.panel-title{font-size:14px;font-weight:800;color:var(--navy);margin:0 0 12px}
.panel-foot{margin-top:10px;font-size:11px;color:var(--muted);font-weight:700}
.bar-row{margin-bottom:10px}
.bar-label{display:flex;justify-content:space-between;font-size:11px;font-weight:700;color:var(--muted);margin-bottom:4px}
.bar-track{height:8px;border-radius:99px;background:var(--bg);overflow:hidden}
.bar-fill{height:100%;border-radius:99px}
.watch-row{display:flex;align-items:center;gap:10px;padding:8px 2px;border-bottom:1px solid var(--line);font-size:12px;font-weight:600;color:var(--navy)}
.watch-row:last-child{border-bottom:none}
.watch-main{flex:1;color:var(--muted)}
.watch-val{font-family:'JetBrains Mono',monospace;font-size:11px}
/* tables */
.tbl-wrap{overflow-x:auto;border-radius:10px}
.date-block{margin-bottom:16px}
.date-block-head{font-family:'JetBrains Mono',monospace;font-size:10.5px;text-transform:uppercase;letter-spacing:.06em;font-weight:700;background:var(--navy);color:#fff;padding:8px 14px;border-radius:10px 10px 0 0;display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap}
.date-block-head span{color:rgba(255,255,255,.65);text-transform:none;letter-spacing:0;font-weight:500}
.ledger-table{width:100%;border-collapse:collapse;font-size:12px;background:#fff;border-radius:0 0 12px 12px;overflow:hidden;box-shadow:var(--shadow)}
.ledger-table th{text-align:left;font-size:9.5px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);font-weight:800;padding:9px 11px;border-bottom:1px solid var(--line);background:#FBFCFF}
.ledger-table td{padding:9px 11px;border-bottom:1px solid var(--line);color:var(--navy)}
.ledger-table tr:last-child td{border-bottom:none}
.ledger-table td.mono{font-family:'JetBrains Mono',monospace}
.ledger-table tfoot td{font-weight:800;border-top:2px solid var(--navy);border-bottom:none;font-family:'JetBrains Mono',monospace;background:#FBFCFF}
.filter-bar + .ledger-table,.section-head + .ledger-table{border-radius:12px}
.report-grand-total{display:flex;gap:20px;align-items:center;justify-content:flex-end;flex-wrap:wrap;background:linear-gradient(135deg,var(--blue),var(--blue2));color:#fff;border-radius:12px;padding:12px 18px;margin-top:10px;font-size:12.5px;font-weight:700;box-shadow:0 8px 20px rgba(67,24,255,.28)}
.report-grand-total .mono{font-family:'JetBrains Mono',monospace;font-size:13px}
.filter-bar{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:14px;background:#fff;border-radius:var(--radius);padding:12px 14px;box-shadow:var(--shadow)}
.empty-row{padding:20px 4px;color:var(--muted);font-size:12.5px;border:1.5px dashed var(--line);border-radius:12px;text-align:center;font-weight:600;background:#fff}
.locked-panel{display:flex;align-items:flex-start;gap:10px;padding:14px;border:1px solid var(--red);background:#FEEEEE;border-radius:12px;color:var(--red);font-size:12.5px;line-height:1.5;font-weight:600}
.invite-panel{border:1.5px dashed var(--blue);border-radius:var(--radius);padding:20px;background:var(--blue-soft)}
.invite-title{font-weight:800;text-transform:uppercase;font-size:13px;margin-bottom:6px;color:var(--blue)}
.invite-body{font-size:13px;color:var(--navy);line-height:1.6;font-weight:600}
.team-row{display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:12px 16px;border-radius:12px;margin-bottom:8px;background:#fff;box-shadow:var(--shadow)}
.team-row-name{font-weight:700;font-size:12.5px;min-width:140px}
.team-row select{font-family:'JetBrains Mono',monospace;font-size:12px;padding:7px 9px;border:1px solid var(--line);border-radius:10px}
.team-perm{margin:0;white-space:nowrap}
/* auth */
.login-page{display:flex;align-items:center;justify-content:center;min-height:100vh;width:100%;padding:24px;background:var(--bg)}
.boot-loader{display:flex;align-items:center;gap:10px;color:var(--muted);font-weight:600}
.login-card{max-width:410px;width:100%;display:flex;flex-direction:column;gap:13px;background:#fff;border-radius:18px;padding:32px 28px;box-shadow:var(--shadow)}
.login-logo{width:50px;height:50px;border-radius:14px;background:linear-gradient(135deg,var(--blue),var(--blue2));color:#fff;display:flex;align-items:center;justify-content:center}
.login-title{font-weight:800;font-size:21px;margin:0;color:var(--navy)}
.login-sub{font-size:12.5px;color:var(--muted);font-weight:600}
.login-error{font-size:12px;color:var(--red);background:#FEEEEE;border:1px solid var(--red);border-radius:9px;padding:9px 12px;font-weight:600}
.login-notice{font-size:12px;color:#047857;background:#D1FAE5;border:1px solid #047857;border-radius:9px;padding:9px 12px;font-weight:600}
.login-submit{justify-content:center}
.login-switch{background:none;border:none;color:var(--blue);font-size:12px;font-weight:700;cursor:pointer;padding:0;text-align:left}
.login-switch:hover{text-decoration:underline}
@media print{.no-print{display:none !important}.rail{display:none !important}.main-area{padding:0}.page-head{box-shadow:none}}
@media (max-width:980px){.metric-grid{grid-template-columns:1fr 1fr}.dash-grid{grid-template-columns:1fr}}
@media (max-width:900px){
.app-layout{flex-direction:column}
.rail{position:static;height:auto;width:100%;flex-direction:row;align-items:center;padding:8px 10px;gap:6px;overflow-x:auto;box-shadow:none;border-right:none;border-bottom:1px solid var(--line)}
.rail-top{display:none}
.rail-nav{flex-direction:row;gap:4px;overflow:visible}
.rail-btn{width:auto;padding:8px 10px;white-space:nowrap}
.rail-chevron{display:none}
.rail-foot{margin:0;padding:0;border:none}
}
:root { color-scheme: light; }
html, body, #root, input, select, textarea, button, option { color-scheme: light; }
input, textarea, select { background:#fff; color:#1B2559; }
select option { background:#fff; color:#1B2559; }
input[type="checkbox"] { accent-color:#4318FF; background:#fff; }
.entry-date-edit input, .entry-date-edit select,
.team-row select,
.edit-row input, .edit-row select,
.rows-line input, .rows-line select,
.field input, .field select,
.multiselect-btn { background:#fff !important; color:#1B2559 !important; }
.modal-panel, .modal-body { color-scheme: light; }
@media (max-width:640px){
.main-area{padding:14px 12px 26px}
.grid-2{grid-template-columns:1fr}
.span-2{grid-column:span 1}
.filter-bar{flex-direction:column}
.metric-grid{grid-template-columns:1fr}
.rows-head,.rows-line,.rows-head.cols-3,.rows-line.cols-3,.rows-head.cols-5,.rows-line.cols-5,.rows-head.cols-7,.rows-line.cols-7,.rows-head.cols-8,.rows-line.cols-8{grid-template-columns:1fr}
.edit-row input,.edit-row select{width:100%}
.edit-row.grid-4,.edit-row.grid-5,.edit-row.grid-8{grid-template-columns:1fr}
.builder-row .field{flex:1 1 40%}
.builder-add{margin-left:0;width:100%;justify-content:center}
.tbl-wrap .ledger-table{min-width:680px}
.modal-panel{max-width:100%}
}
`}</style>);
}
