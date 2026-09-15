import React, { useState, useEffect, useMemo } from "react";
import {
  LayoutDashboard, Truck, Boxes, Receipt, Factory, ClipboardList,
  Plus, Trash2, Pencil, Check, X, Printer, Search, ChevronDown, ChevronRight, ArrowUpDown,
  Loader2, Lock, LogOut, Users, PackageCheck
} from "lucide-react";

const SUPABASE_URL = "https://eovfcjadpyjxavymtqwf.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_UmpsvgnasiG799Xpw86KlA_UQv-plKX";
let ACCESS_TOKEN = null;

function setAccessToken(t) { ACCESS_TOKEN = t; }

async function sbRequest(path, { method = "GET", body, headers = {} } = {}) {
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    method,
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${ACCESS_TOKEN || SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  if (text) { try { data = JSON.parse(text); } catch (e) { data = text; } }
  if (!res.ok) {
    const msg = (data && (data.message || data.error_description || data.msg || data.error)) || `Request failed (${res.status})`;
    throw new Error(msg);
  }
  return data;
}

async function authSignUp(email, password, fullName) {
  return sbRequest("/auth/v1/signup", { method: "POST", body: { email, password, data: fullName ? { full_name: fullName } : undefined } });
}
async function authSignIn(email, password) {
  return sbRequest("/auth/v1/token?grant_type=password", { method: "POST", body: { email, password } });
}
async function authRefresh(refreshToken) {
  return sbRequest("/auth/v1/token?grant_type=refresh_token", { method: "POST", body: { refresh_token: refreshToken } });
}

const toCamelKey = (k) => k.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());
const toSnakeKey = (k) => k.replace(/[A-Z]/g, (c) => "_" + c.toLowerCase());
const rowToCamel = (row) => Object.fromEntries(Object.entries(row).map(([k, v]) => [toCamelKey(k), v]));
const rowsToCamel = (rows) => (rows || []).map(rowToCamel);
const objToSnake = (obj) => Object.fromEntries(Object.entries(obj).map(([k, v]) => [toSnakeKey(k), v]));

async function sbList(table, query = "?select=*") { return rowsToCamel(await sbRequest(`/rest/v1/${table}${query}`)); }
async function sbInsert(table, rows) { if (!rows.length) return; await sbRequest(`/rest/v1/${table}`, { method: "POST", body: rows.map(objToSnake), headers: { Prefer: "return=minimal" } }); }
async function sbUpdate(table, id, patch) { const { id: _drop, ...rest } = patch; await sbRequest(`/rest/v1/${table}?id=eq.${id}`, { method: "PATCH", body: objToSnake(rest), headers: { Prefer: "return=minimal" } }); }
async function sbDeleteById(table, id) { await sbRequest(`/rest/v1/${table}?id=eq.${id}`, { method: "DELETE", headers: { Prefer: "return=minimal" } }); }

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

async function saveRefreshToken(token) { try { sessionStorage.setItem("sbs-refresh-token", token); } catch (e) {} }
async function loadRefreshToken() { try { return sessionStorage.getItem("sbs-refresh-token"); } catch (e) { return null; } }
async function clearRefreshToken() { try { sessionStorage.removeItem("sbs-refresh-token"); } catch (e) {} }
async function authRecover(email) { return sbRequest("/auth/v1/recover", { method: "POST", body: { email } }); }

const uid = () => (window.crypto && crypto.randomUUID) ? crypto.randomUUID() :
  "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => { const r = (Math.random() * 16) | 0; const v = c === "x" ? r : (r & 0x3) | 0x8; return v.toString(16); });

const money = (n) => "Rs " + (Number(n) || 0).toLocaleString("en-PK", { maximumFractionDigits: 0 });
const num = (n, d = 2) => (Number(n) || 0).toLocaleString("en-PK", { minimumFractionDigits: 0, maximumFractionDigits: d });
const todayISO = () => new Date().toISOString().slice(0, 10);
const fmtDate = (d) => new Date(d + "T00:00:00").toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const confirmDelete = (label) => window.confirm(`Delete ${label || "this"}? This can't be undone.`);

const STATUS_LABEL = { consignment: "In godown", partial: "Partly converted", converted: "Fully converted", purchased: "Purchased", held: "On Hold" };
const STATUS_TONE = { consignment: "gray", partial: "amber", converted: "blue", purchased: "green", held: "rust" };
const statusLabel = (s) => STATUS_LABEL[s] || s;
const statusTone = (s) => STATUS_TONE[s] || "gray";

function buildSequentialLabelMap(arr, idKey, prefix) {
  // number by actual creation order (immutable), not by the editable "date received"
  // field — sorting by date let same-day entries fall back to comparing random UUIDs,
  // which produced numbers with no relation to when entries were actually made
  const sorted = [...arr].sort((a, b) => {
    const ca = a.createdAt || ""; const cb = b.createdAt || "";
    if (ca && cb) return ca < cb ? -1 : ca > cb ? 1 : 0;
    // fallback only if createdAt is ever missing
    const dateA = a.date || ""; const dateB = b.date || "";
    if (dateA !== dateB) return dateA < dateB ? -1 : 1;
    return String(a[idKey] || a.id) < String(b[idKey] || b.id) ? -1 : 1;
  });
  const map = new Map();
  let n = 0;
  sorted.forEach((x) => {
    const k = x[idKey] || x.id;
    if (!map.has(k)) { n += 1; map.set(k, `${prefix}-${n}`); }
  });
  return map;
}

const NAV_GROUPS = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard, view: "dashboard" },
  { id: "setup", label: "Setup", icon: ClipboardList, children: [
    { id: "masters-suppliers", label: "Suppliers", view: "masters-suppliers" },
    { id: "masters-brands", label: "Brands", view: "masters-brands" },
    { id: "masters-customers", label: "Customers", view: "masters-customers" },
    { id: "masters-sizes", label: "Packet sizes", view: "masters-sizes" },
    { id: "masters-lifters", label: "Lifters", view: "masters-lifters" },
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
  "dashboard": "Dashboard", "masters-suppliers": "Suppliers", "masters-brands": "Brands",
  "masters-customers": "Customers", "masters-sizes": "Packet sizes", "masters-lifters": "Lifters",
  "reels-entries": "Reels in — Entries", "reels-report": "Reels in — Report", "reels-edit": "Reels in — Edit",
  "hold-entries": "Hold / Release Reels", "hold-report": "Held Reels Report",
  "purchases-entries": "Purchases — Entries", "purchases-report": "Purchases — Report", "purchases-edit": "Purchases — Edit",
  "production-entries": "Production — Entries", "production-report": "Production — Report", "production-edit": "Production — Edit",
  "stock-current": "Current stock", "stock-quantity": "Reels quantity", "team": "Team & access",
};

function groupForView(view) {
  const g = NAV_GROUPS.find((g) => g.children && g.children.some((c) => c.view === view));
  return g ? g.id : null;
}

function Sidebar({ view, setView, isAdmin, collapsed, setCollapsed, userEmail, role, onSignOut }) {
  const activeGroup = groupForView(view);
  const [openGroups, setOpenGroups] = useState(() => activeGroup ? [activeGroup] : []);

  useEffect(() => {
    if (activeGroup && !openGroups.includes(activeGroup)) {
      setOpenGroups([activeGroup]);
    }
  }, [activeGroup]); // eslint-disable-line

  const toggleGroup = (id) => {
    setOpenGroups(prev => prev.includes(id) ? [] : [id]);
  };

  const groups = isAdmin ? [...NAV_GROUPS, { id: "team", label: "Team", icon: Users, view: "team" }] : NAV_GROUPS;

  return (
    <aside className={"sidebar no-print " + (collapsed ? "collapsed" : "")}>
      <div className="sidebar-brand">
        <div className="sidebar-brand-mark">SB</div>
        {!collapsed && <div className="sidebar-brand-text"><div className="sidebar-brand-title">Sale Base Stock</div><div className="sidebar-brand-sub">Bleach board register</div></div>}
      </div>
      <nav className="sidebar-nav">
        {groups.map((g) => {
          const Icon = g.icon;
          if (!g.children) {
            return (
              <button key={g.id} className={"sidebar-link " + (view === g.view ? "active" : "")} onClick={() => setView(g.view)} title={collapsed ? g.label : ""}>
                <Icon size={17} />{!collapsed && <span>{g.label}</span>}
              </button>
            );
          }
          const isOpen = openGroups.includes(g.id);
          return (
            <div key={g.id} className="sidebar-group">
              <button
                className={"sidebar-link sidebar-group-head " + (activeGroup === g.id ? "active-group" : "")}
                onClick={() => (collapsed ? setCollapsed(false) : toggleGroup(g.id))}
                title={collapsed ? g.label : ""}
              >
                <Icon size={17} />
                {!collapsed && (
                  <>
                    <span>{g.label}</span>
                    <ChevronDown size={14} className={"sidebar-chevron " + (isOpen ? "open" : "")} />
                  </>
                )}
              </button>
              {!collapsed && (
                <div className={"sidebar-children " + (isOpen ? "open" : "")}>
                  {g.children.map((c) => (
                    <button key={c.id} className={"sidebar-sublink " + (view === c.view ? "active" : "")} onClick={() => setView(c.view)}>{c.label}</button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </nav>
      <div className="sidebar-footer">
        {!collapsed && <div className="sidebar-user"><span>{userEmail}</span><span className="sidebar-role">{role}</span></div>}
        <button className="sidebar-collapse-btn" onClick={() => setCollapsed(!collapsed)} title={collapsed ? "Expand" : "Collapse"}>
          <ChevronRight size={14} style={{ transform: collapsed ? "none" : "rotate(180deg)" }} />
        </button>
        <button className="sidebar-signout" onClick={onSignOut} title="Sign out"><LogOut size={15} />{!collapsed && <span>Sign out</span>}</button>
      </div>
    </aside>
  );
}

function Stamp({ children, tone = "gray" }) { return <span className={`stamp stamp-${tone}`}>{children}</span>; }
function Field({ label, children }) { return <label className="field"><span>{label}</span>{children}</label>; }
function EmptyRow({ children }) { return <div className="empty-row">{children}</div>; }
function LockedNote({ text }) { return <div className="locked-panel"><Lock size={15} /><span>{text || "You don't have permission to view this."}</span></div>; }
function SectionHead({ title, onPrint }) {
  return (
    <div className="section-head">
      <h2>{title}</h2>
      {onPrint && <button className="btn no-print" onClick={onPrint}><Printer size={14} /> Print</button>}
    </div>
  );
}
function FormDivider({ label }) { return <div className="form-divider"><span>{label}</span></div>; }

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
      <button type="button" className="multiselect-btn" onClick={() => setOpen((o) => !o)}>
        <span>{label}</span> <ChevronDown size={13} />
      </button>
      {open && (
        <div className="multiselect-panel">
          {options.map((o) => (
            <label key={o.value} className="multiselect-option">
              <input type="checkbox" checked={values.includes(o.value)} onChange={() => toggle(o.value)} />
              {o.label}
            </label>
          ))}
          {values.length > 0 && <button type="button" className="multiselect-clear" onClick={() => onChange([])}>Clear</button>}
        </div>
      )}
    </div>
  );
}

function printHTML(title, bodyHtml) {
  const iframe = document.createElement("iframe");
  iframe.style.position = "fixed"; iframe.style.right = "0"; iframe.style.bottom = "0";
  iframe.style.width = "0"; iframe.style.height = "0"; iframe.style.border = "0";
  document.body.appendChild(iframe);
  const doc = iframe.contentWindow.document;
  doc.open();
  doc.write(`<!DOCTYPE html><html><head><title>${esc(title)}</title><style>
* { box-sizing: border-box; }
body { font-family: Arial, Helvetica, sans-serif; color:#23261F; padding:24px; }
h1 { font-size:17px; text-transform:uppercase; margin:0 0 4px; }
.meta { font-size:11px; color:#666; margin-bottom:18px; }
h2 { font-size:12px; text-transform:uppercase; background:#eeece3; padding:5px 8px; margin:18px 0 0; }
h3 { font-size:10.5px; text-transform:uppercase; color:#555; margin:10px 0 2px; }
table { width:100%; border-collapse:collapse; font-size:11px; margin-bottom:4px; }
th, td { padding:5px 7px; border-bottom:1px solid #ccc; text-align:left; }
th { font-size:9px; text-transform:uppercase; color:#666; border-bottom:1.5px solid #23261F; }
tfoot td { font-weight:bold; border-top:1.5px solid #23261F; border-bottom:none; }
.tag { font-family:monospace; }
</style></head><body>
<h1>${esc(title)}</h1>
<div class="meta">Printed ${esc(new Date().toLocaleString("en-GB"))}</div>
${bodyHtml}
</body></html>`);
  doc.close();
  setTimeout(() => {
    iframe.contentWindow.focus();
    iframe.contentWindow.print();
    setTimeout(() => { if (iframe.parentNode) document.body.removeChild(iframe); }, 1000);
  }, 250);
}

function LotPicker({ rowKey, lots, value, onChange, labelFn, placeholder }) {
  const selected = lots.find((l) => l.id === value);
  const [query, setQuery] = useState(selected ? labelFn(selected) : "");
  useEffect(() => { setQuery(selected ? labelFn(selected) : ""); }, [value]); // eslint-disable-line
  const listId = "lp-" + rowKey;
  const handleChange = (e) => {
    const v = e.target.value; setQuery(v);
    const exact = lots.find((l) => labelFn(l) === v) || lots.find((l) => String(l.lotNo) === v.trim());
    if (exact) onChange(exact.id);
    else if (v.trim() === "") onChange("");
  };
  return (
    <div className="lot-picker">
      <input list={listId} value={query} onChange={handleChange} placeholder={placeholder === undefined ? "Search lot no / brand / gsm…" : placeholder} />
      <datalist id={listId}>{lots.map((l) => <option key={l.id} value={labelFn(l)} />)}</datalist>
    </div>
  );
}

function groupByDate(arr) {
  const m = {};
  arr.forEach((x) => { (m[x.date] = m[x.date] || []).push(x); });
  return Object.entries(m).sort((a, b) => (a[0] < b[0] ? 1 : -1));
}

function sortWithin(arr, sortState, getters) {
  if (!sortState || sortState.field === "entry") return arr;
  const getter = getters[sortState.field];
  if (!getter) return arr;
  const dir = sortState.dir === "asc" ? 1 : -1;
  return [...arr].sort((a, b) => (getter(a) - getter(b)) * dir);
}

function LoginScreen({ onAuthed }) {
  const [mode, setMode] = useState("signin");
  const [email, setEmail] = useState(""); const [password, setPassword] = useState(""); const [fullName, setFullName] = useState("");
  const [busy, setBusy] = useState(false); const [err, setErr] = useState(""); const [notice, setNotice] = useState("");

  const submit = async () => {
    setErr(""); setNotice(""); setBusy(true);
    try {
      if (mode === "signin") {
        const data = await authSignIn(email.trim(), password);
        setAccessToken(data.access_token);
        await saveRefreshToken(data.refresh_token);
        onAuthed({ accessToken: data.access_token, refreshToken: data.refresh_token, user: data.user });
      } else if (mode === "signup") {
        const data = await authSignUp(email.trim(), password, fullName.trim());
        if (data && data.access_token) {
          setAccessToken(data.access_token);
          await saveRefreshToken(data.refresh_token);
          onAuthed({ accessToken: data.access_token, refreshToken: data.refresh_token, user: data.user });
        } else {
          setNotice("Account created. If email confirmation is turned on, check your inbox first, then sign in below.");
          setMode("signin");
        }
      } else if (mode === "forgot") {
        await authRecover(email.trim());
        setNotice("If that email has an account, a reset link has been sent.");
      }
    } catch (e) {
      setErr(e.message || "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-page">
      <Style />
      <div className="login-card">
        <div className="eyebrow">Bleach board reel & production register</div>
        <h1 className="login-title">Sale Base Stock</h1>
        <div className="login-sub">{mode === "signin" ? "Sign in to continue" : mode === "signup" ? "Create an account" : "Reset your password"}</div>
        {mode === "signup" && <Field label="Full name (optional)"><input value={fullName} onChange={(e) => setFullName(e.target.value)} /></Field>}
        <Field label="Email"><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        {mode !== "forgot" && <Field label="Password"><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>}
        {err && <div className="login-error">{err}</div>}
        {notice && <div className="login-notice">{notice}</div>}
        <button className="btn primary login-submit" onClick={submit} disabled={busy || !email || (mode !== "forgot" && !password)}>
          {busy ? "Please wait…" : mode === "signin" ? "Sign in" : mode === "signup" ? "Create account" : "Send reset link"}
        </button>
        {mode === "signin" && (
          <>
            <button className="login-switch" onClick={() => { setMode("signup"); setErr(""); setNotice(""); }}>New here? Create an account</button>
            <button className="login-switch" onClick={() => { setMode("forgot"); setErr(""); setNotice(""); }}>Forgot password?</button>
          </>
        )}
        {mode !== "signin" && (
          <button className="login-switch" onClick={() => { setMode("signin"); setErr(""); setNotice(""); }}>Back to sign in</button>
        )}
      </div>
    </div>
  );
}

export default function ReelStockManager() {
  const [booting, setBooting] = useState(true);
  const [session, setSession] = useState(null);

  useEffect(() => {
    (async () => {
      const rt = await loadRefreshToken();
      if (!rt) { setBooting(false); return; }
      try {
        const data = await authRefresh(rt);
        setAccessToken(data.access_token);
        await saveRefreshToken(data.refresh_token);
        setSession({ accessToken: data.access_token, refreshToken: data.refresh_token, user: data.user });
      } catch (e) {
        await clearRefreshToken();
      } finally {
        setBooting(false);
      }
    })();
  }, []);

  const handleSignOut = async () => { setAccessToken(null); await clearRefreshToken(); setSession(null); };

  if (booting) return <div className="login-page"><Style /><div className="boot-loader"><Loader2 className="spin" size={22} /><span>Checking session...</span></div></div>;
  if (!session) return <LoginScreen onAuthed={setSession} />;
  return <AuthedApp session={session} onSignOut={handleSignOut} />;
}

function AuthedApp({ session, onSignOut }) {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [profile, setProfile] = useState(null);
  const [view, setView] = useState("dashboard");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const [suppliers, setSuppliers] = useState([]);
  const [brands, setBrands] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [sizes, setSizes] = useState([]);
  const [lifters, setLifters] = useState([]);
  const [reels, setReels] = useState([]);
  const [purchases, setPurchases] = useState([]);
  const [productions, setProductions] = useState([]);
  const [productionItems, setProductionItems] = useState([]);

  useEffect(() => {
    setAccessToken(session.accessToken);
    (async () => {
      try {
        const profRows = await sbList("profiles", `?id=eq.${session.user.id}&select=*`);
        if (!profRows[0]) {
          setLoadError("No profile row found for this account. Make sure the SQL schema (including the signup trigger) has been run in your Supabase project, then sign out and back in.");
          setLoading(false); return;
        }
        setProfile(profRows[0]);

        const [su, br, cu, sz, li, re, pu, pr, pi] = await Promise.all([
          sbList("suppliers"), sbList("brands"), sbList("customers"), sbList("sizes"), sbList("lifters"),
          sbList("reels"), sbList("purchases"), sbList("productions"), sbList("production_items"),
        ]);
        setSuppliers(su); setBrands(br); setCustomers(cu); setSizes(sz); setLifters(li);
        setReels(re); setPurchases(pu); setProductions(pr); setProductionItems(pi);
      } catch (e) {
        setLoadError(e.message || "Failed to load data.");
      } finally {
        setLoading(false);
      }
    })();
  }, [session]);

  const persist = {
    suppliers: (v) => { const p = suppliers; setSuppliers(v); return syncTable("suppliers", p, v).catch((e) => { alert("Save failed: " + e.message); throw e; }); },
    brands: (v) => { const p = brands; setBrands(v); return syncTable("brands", p, v).catch((e) => { alert("Save failed: " + e.message); throw e; }); },
    customers: (v) => { const p = customers; setCustomers(v); return syncTable("customers", p, v).catch((e) => { alert("Save failed: " + e.message); throw e; }); },
    sizes: (v) => { const p = sizes; setSizes(v); return syncTable("sizes", p, v).catch((e) => { alert("Save failed: " + e.message); throw e; }); },
    lifters: (v) => { const p = lifters; setLifters(v); return syncTable("lifters", p, v).catch((e) => { alert("Save failed: " + e.message); throw e; }); },
    reels: (v) => { const p = reels; setReels(v); return syncTable("reels", p, v).catch((e) => { alert("Save failed: " + e.message); throw e; }); },
    purchases: (v) => { const p = purchases; setPurchases(v); return syncTable("purchases", p, v).catch((e) => { alert("Save failed: " + e.message); throw e; }); },
    productions: (v) => { const p = productions; setProductions(v); return syncTable("productions", p, v).catch((e) => { alert("Save failed: " + e.message); throw e; }); },
    productionItems: (v) => { const p = productionItems; setProductionItems(v); return syncTable("production_items", p, v).catch((e) => { alert("Save failed: " + e.message); throw e; }); },
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
    const purchase = purchases.find((x) => x.lotId === p.lotId);
    if (purchase) return 0;
    const idx = productions.findIndex((x) => x.id === productionId);
    const upToHere = productions.filter((x, i) => x.lotId === p.lotId && i <= idx);
    const closedByHere = upToHere.some((x) => x.closeOut);
    if (closedByHere) return 0;
    const usedUpToHere = upToHere.reduce((a, x) => a + itemsWeightFor(x.id) + Number(x.wastageKg || 0), 0);
    return Math.max(0, Number(lot.weight) - usedUpToHere);
  };

  const totalPacketWeightForLot = (lotId) => productions
    .filter((p) => p.lotId === lotId)
    .reduce((a, p) => a + itemsWeightFor(p.id), 0);
  const avgGramForLot = (lot) => avgGramForEntry(lot, totalPacketWeightForLot(lot.id));

  const lotInfo = useMemo(() => {
    const map = {};
    reels.forEach((lot) => {
      const purchase = purchases.find((p) => p.lotId === lot.id);
      const prods = productions.filter((p) => p.lotId === lot.id);
      const closedOut = prods.some((p) => p.closeOut);
      const usedKg = usedWeightForLot(lot.id);
      let status, remaining;

      if (purchase) {
        status = "purchased"; remaining = 0;
      } else if (lot.isHeld) {
        status = "held";
        remaining = Math.max(0, Number(lot.weight) - usedKg);
      } else if (closedOut) {
        status = "converted"; remaining = 0;
      } else {
        remaining = Math.max(0, Number(lot.weight) - usedKg);
        status = usedKg === 0 ? "consignment" : remaining > 0 ? "partial" : "converted";
      }

      const available = status !== "purchased" && status !== "converted" && remaining > 0.0001;

      map[lot.id] = { status, usedKg, remaining, purchase, productions: prods, closedOut, available };
    });
    return map;
  }, [reels, purchases, productions, productionItems, sizes, brands]);

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

  const totals = useMemo(() => {
    const godownWeight = reels.filter((r) => {
      const info = lotInfo[r.id];
      return info && info.status === "consignment";
    }).reduce((a, r) => a + (lotInfo[r.id]?.remaining || 0), 0);

    const godownReelsCount = reels.filter((r) => {
      const info = lotInfo[r.id];
      return info && info.status === "consignment";
    }).length;

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
  if (loadError) {
    return (
      <div className="app-shell">
        <Style />
        <div style={{ padding: 24 }}>
          <LockedNote text={loadError} />
          <button className="btn" style={{ marginTop: 14 }} onClick={onSignOut}>Sign out and try again</button>
        </div>
      </div>
    );
  }

  const can = (perm) => !!profile && (profile.role === "admin" || profile[perm]);
  const isAdmin = profile.role === "admin";

  const ctx = {
    suppliers, brands, customers, sizes, lifters, reels, purchases, productions, productionItems, persist,
    supplierName, brandName, customerName, lifterName, purchasedByLabel, packetWeightKg, sizeLabel, reelDesc, avgGramForEntry, avgGramForLot, itemsFor, itemsWeightFor,
    lotInfo, totals, usedWeightForLot, remainingForLot, remainingAfterProduction, totalPacketWeightForLot,
    reelLabelMap, purchaseLabelMap, productionLabelMap, profile, can, isAdmin,
  };

  return (
    <div className="app-shell app-shell-sidebar">
      <Style />
      <div className="app-layout">
        <Sidebar view={view} setView={setView} isAdmin={isAdmin} collapsed={sidebarCollapsed} setCollapsed={setSidebarCollapsed}
          userEmail={session.user.email} role={profile.role} onSignOut={onSignOut} />
        <div className="main-area">
          <header className="top-bar no-print">
            <h1>{VIEW_TITLES[view] || "Overview"}</h1>
          </header>
          <main className="app-main">
            {view === "dashboard" && <Dashboard ctx={ctx} />}
            {view === "masters-suppliers" && <NameListEditor title="Suppliers" items={ctx.suppliers} setItems={ctx.persist.suppliers} withContact blockedIds={ctx.reels.map((r) => r.supplierId)} placeholder="e.g. Punjab Board Mills" canManage={can("canManageMasters")} isAdmin={isAdmin} />}
            {view === "masters-brands" && <NameListEditor title="Brands" items={ctx.brands} setItems={ctx.persist.brands} blockedIds={ctx.reels.map((r) => r.brandId)} placeholder="e.g. Ningbo Fold" canManage={can("canManageMasters")} isAdmin={isAdmin} />}
            {view === "masters-customers" && <NameListEditor title="Customers" items={ctx.customers} setItems={ctx.persist.customers} withContact blockedIds={[]} placeholder="e.g. Abbasi Traders" canManage={can("canManageMasters")} isAdmin={isAdmin} />}
            {view === "masters-sizes" && <SizesEditor ctx={ctx} canManage={can("canManageMasters")} isAdmin={isAdmin} />}
            {view === "masters-lifters" && <NameListEditor title="Lifters" items={ctx.lifters} setItems={ctx.persist.lifters} withContact blockedIds={[]} placeholder="e.g. Ahmed Lifting" canManage={can("canManageMasters")} isAdmin={isAdmin} />}

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
            {view === "team" && isAdmin && <TeamTab ctx={ctx} />}
          </main>
        </div>
      </div>
    </div>
  );
}

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
  const load = async () => {
    setLoading(true); setErr("");
    try { setRows(await sbList("profiles", "?select=*&order=created_at.asc")); }
    catch (e) { setErr(e.message); }
    setLoading(false);
  };
  useEffect(() => { load(); }, []);
  const update = (id, patch) => setRows(rows.map((r) => r.id === id ? { ...r, ...patch } : r));
  const save = async (row) => {
    setSavingId(row.id);
    try {
      await sbUpdate("profiles", row.id, {
        role: row.role, canAddEntries: row.canAddEntries, canEditEntries: row.canEditEntries,
        canDeleteEntries: row.canDeleteEntries, canManageMasters: row.canManageMasters, canViewReports: row.canViewReports,
      });
    } catch (e) { alert("Save failed: " + e.message); }
    setSavingId(null);
  };
  return (
    <div>
      <SectionHead title="Team &amp; access" />
      <div className="computed" style={{ marginBottom: 14 }}>Names are whatever was given at signup. Reports access is required for almost everything else.</div>
      {loading && <EmptyRow>Loading team…</EmptyRow>}
      {err && <LockedNote text={err} />}
      {!loading && rows.length === 0 && <EmptyRow>No accounts yet.</EmptyRow>}
      {!loading && rows.map((r) => (
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

function Dashboard({ ctx }) {
  if (!ctx.can("canViewReports")) return <LockedNote text="You don't have report-viewing access yet." />;
  const { totals, reels, suppliers, sizes } = ctx;
  const cards = [
    { label: "In-godown reels", value: num(totals.godownReelsCount, 0) },
    { label: "In-godown weight", value: num(totals.godownWeight) + " kg" },
    { label: "Purchase weight total", value: num(totals.purchaseWeight) + " kg" },
    { label: "Total purchased value", value: money(totals.purchaseValue) },
    { label: "Suppliers / sizes on file", value: `${suppliers.length} / ${sizes.length}` },
  ];
  return (
    <div>
      <div className="metric-grid">{cards.map((c) => (
        <div className="metric-card" key={c.label}><div className="metric-label">{c.label}</div><div className="metric-value">{c.value}</div></div>
      ))}</div>
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
          <div className="invite-body">Add a supplier and brand in Setup, then log the first reels received under Reels in → Entries.</div>
        </div>
      )}
    </div>
  );
}

function NameListEditor({ title, items, setItems, withContact, blockedIds, placeholder, canManage, isAdmin }) {
  const [name, setName] = useState(""); const [contact, setContact] = useState("");
  const [editId, setEditId] = useState(null); const [editName, setEditName] = useState(""); const [editContact, setEditContact] = useState("");
  const add = () => { if (!name.trim()) return; setItems([...items, { id: uid(), name: name.trim(), contact: contact.trim() }]); setName(""); setContact(""); };
  const startEdit = (it) => { setEditId(it.id); setEditName(it.name); setEditContact(it.contact || ""); };
  const saveEdit = () => { if (!editName.trim()) return; setItems(items.map((it) => it.id === editId ? { ...it, name: editName.trim(), contact: editContact.trim() } : it)); setEditId(null); };
  const remove = (id) => { if (blockedIds.includes(id)) return; if (!confirmDelete(title.slice(0, -1))) return; setItems(items.filter((it) => it.id !== id)); };
  return (
    <div>
      <SectionHead title={title} />
      {canManage && (
        <div className="ticket-form">
          <Field label={title.slice(0, -1) + " name"}><input value={name} onChange={(e) => setName(e.target.value)} placeholder={placeholder} /></Field>
          {withContact && <Field label="Contact (optional)"><input value={contact} onChange={(e) => setContact(e.target.value)} /></Field>}
          <button className="btn primary" onClick={add}>Add</button>
        </div>
      )}
      <div className="list">
        {items.length === 0 && <EmptyRow>Nothing added yet.</EmptyRow>}
        {items.map((it) => (
          <div className="row" key={it.id}>
            {editId === it.id ? (
              <div className="edit-row">
                <input value={editName} onChange={(e) => setEditName(e.target.value)} />
                {withContact && <input value={editContact} onChange={(e) => setEditContact(e.target.value)} />}
                <button className="icon-btn" onClick={saveEdit}><Check size={15} /></button>
                <button className="icon-btn" onClick={() => setEditId(null)}><X size={15} /></button>
              </div>
            ) : (
              <>
                <div><div className="row-title">{it.name}</div>{it.contact && <div className="row-sub">{it.contact}</div>}</div>
                <div className="row-actions">
                  {canManage && <button className="icon-btn" onClick={() => startEdit(it)}><Pencil size={15} /></button>}
                  {isAdmin && <button className="icon-btn" onClick={() => remove(it.id)} disabled={blockedIds.includes(it.id)} title={blockedIds.includes(it.id) ? "In use — can't remove" : "Remove"}><Trash2 size={15} /></button>}
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
  const startEdit = (sz) => { setEditId(sz.id); setEf({ width: sz.width, length: sz.length, gsm: sz.gsm, brandId: sz.brandId }); };
  const saveEdit = () => { persist.sizes(sizes.map((s) => s.id === editId ? { ...s, width: Number(ef.width), length: Number(ef.length), gsm: Number(ef.gsm), brandId: ef.brandId } : s)); setEditId(null); };
  const inUse = (id) => productionItems.some((it) => it.sizeId === id);
  const remove = (id) => { if (inUse(id)) return; if (!confirmDelete("this size")) return; persist.sizes(sizes.filter((s) => s.id !== id)); };
  if (brands.length === 0) return <div><SectionHead title="Packet sizes" /><EmptyRow>Add a brand first.</EmptyRow></div>;
  return (
    <div>
      <SectionHead title="Packet sizes" />
      {canManage && (
        <div className="ticket-form grid-2">
          <Field label="Width"><input type="number" value={f.width} onChange={set("width")} /></Field>
          <Field label="Length"><input type="number" value={f.length} onChange={set("length")} /></Field>
          <Field label="Gram (GSM)"><input type="number" value={f.gsm} onChange={set("gsm")} /></Field>
          <Field label="Brand"><select value={f.brandId} onChange={set("brandId")}>{brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>
          <div className="computed span-2">Packet weight: <b>{num(wt, 4)} kg</b></div>
          <button className="btn primary span-2" onClick={add}>Add size</button>
        </div>
      )}
      <div className="list">
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
                  {canManage && <button className="icon-btn" onClick={() => startEdit(sz)}><Pencil size={15} /></button>}
                  {isAdmin && <button className="icon-btn" onClick={() => remove(sz.id)} disabled={inUse(sz.id)}><Trash2 size={15} /></button>}
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function ReelsAddForm({ ctx }) {
  const { suppliers, brands, lifters, reels, persist, reelLabelMap } = ctx;
  const [supplierId, setSupplierId] = useState(suppliers[0]?.id || "");
  const [date, setDate] = useState(todayISO());
  const [lifterId, setLifterId] = useState(lifters[0]?.id || "");
  const [biltyWeight, setBiltyWeight] = useState("");
  const [loadingChargePerKg, setLoadingChargePerKg] = useState("");

  const blankRow = () => ({ key: uid(), lotNo: "", brandId: brands[0]?.id || "", gsm: "", width: "", weight: "", detail: "" });
  const [rows, setRows] = useState([blankRow()]);
  const [lastSaved, setLastSaved] = useState(null);

  useEffect(() => { if (!supplierId && suppliers[0]) setSupplierId(suppliers[0].id); }, [suppliers]);
  useEffect(() => { if (!lifterId && lifters[0]) setLifterId(lifters[0].id); }, [lifters]);

  const updateRow = (key, patch) => setRows(rows.map((r) => r.key === key ? { ...r, ...patch } : r));
  const addRow = () => setRows([...rows, blankRow()]);
  const removeRow = (key) => setRows(rows.length > 1 ? rows.filter((r) => r.key !== key) : rows);
  const loadingChargesTotal = (Number(biltyWeight || 0) / 1000) * Number(loadingChargePerKg || 0);

  const saveAll = () => {
    if (!supplierId || !date) return;
    const valid = rows.filter((r) => r.lotNo.trim() && r.brandId && r.gsm && r.width && r.weight);
    if (valid.length === 0) return;
    const existingLots = new Set(reels.map((r) => r.lotNo));
    const batchId = uid();
    const newOnes = valid.filter((r) => !existingLots.has(r.lotNo.trim())).map((r) => ({
      id: uid(), batchId, lotNo: r.lotNo.trim(), supplierId, brandId: r.brandId, gsm: Number(r.gsm), width: Number(r.width),
      weight: Number(r.weight), detail: r.detail.trim(), date,
      lifterId: lifterId || null,
      biltyWeight: Number(biltyWeight || 0), loadingChargePerKg: Number(loadingChargePerKg || 0),
    }));
    if (newOnes.length === 0) return;
    persist.reels([...reels, ...newOnes]);
    setLastSaved({ count: newOnes.length, batchId });
    setRows([blankRow()]); setBiltyWeight(""); setLoadingChargePerKg("");
  };

  const disabled = suppliers.length === 0 || brands.length === 0;
  return (
    <div>
      {disabled && <EmptyRow>Add a supplier and at least one brand first.</EmptyRow>}
      {!disabled && (
        <div className="ticket-form" style={{ maxWidth: 900 }}>
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
          {(Number(biltyWeight) > 0 || Number(loadingChargePerKg) > 0) && (
            <div className="computed">Loading charges for this entry: <b>{money(loadingChargesTotal)}</b></div>
          )}
          <FormDivider label="Reels in this entry" />
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
            <button className="btn primary" onClick={saveAll}>Save all reels</button>
          </div>
          {lastSaved && <div className="computed">Saved {lastSaved.count} reel(s) under entry <b>{reelLabelMap.get(lastSaved.batchId)}</b>.</div>}
        </div>
      )}
    </div>
  );
}

function AddReelsToEntry({ ctx, batch, onDone }) {
  const { brands, reels, persist, reelLabelMap } = ctx;
  const blankRow = () => ({ key: uid(), lotNo: "", brandId: brands[0]?.id || "", gsm: "", width: "", weight: "", detail: "" });
  const [rows, setRows] = useState([blankRow()]);

  const updateRow = (key, patch) => setRows(rows.map((r) => r.key === key ? { ...r, ...patch } : r));
  const addRow = () => setRows([...rows, blankRow()]);
  const removeRow = (key) => setRows(rows.length > 1 ? rows.filter((r) => r.key !== key) : rows);

  const saveAll = () => {
    const valid = rows.filter((r) => r.lotNo.trim() && r.brandId && r.gsm && r.width && r.weight);
    if (valid.length === 0) return;
    const existingLots = new Set(reels.map((r) => r.lotNo));
    const newOnes = valid.filter((r) => !existingLots.has(r.lotNo.trim())).map((r) => ({
      id: uid(), batchId: batch.batchId, lotNo: r.lotNo.trim(), supplierId: batch.supplierId, brandId: r.brandId,
      gsm: Number(r.gsm), width: Number(r.width), weight: Number(r.weight), detail: r.detail.trim(), date: batch.date,
      lifterId: batch.lifterId || null, biltyWeight: batch.biltyWeight || 0, loadingChargePerKg: batch.loadingChargePerKg || 0,
    }));
    if (newOnes.length === 0) return;
    persist.reels([...reels, ...newOnes]);
    onDone();
  };

  return (
    <div className="ticket-form" style={{ margin: "8px 0" }} onClick={(e) => e.stopPropagation()}>
      <FormDivider label={`Add reels to ${reelLabelMap.get(batch.batchId)}`} />
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
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn" onClick={onDone}>Cancel</button>
          <button className="btn primary" onClick={saveAll}>Save reel(s) to this entry</button>
        </div>
      </div>
    </div>
  );
}

function ReelsEntriesTab({ ctx }) {
  const { reels, persist, reelLabelMap, supplierName, lifterName, reelDesc, lotInfo } = ctx;
  const [expanded, setExpanded] = useState(null);
  const canAdd = ctx.can("canAddEntries");
  const canDelete = ctx.can("canDeleteEntries");
  const canEdit = ctx.can("canEditEntries");
  const [editBatch, setEditBatch] = useState(null);
  const [draft, setDraft] = useState({ date: "", biltyWeight: "", loadingChargePerKg: "", lifterId: "" });
  const [addingTo, setAddingTo] = useState(null);

  const batches = useMemo(() => {
    const map = new Map();
    reels.forEach((lot) => { if (!map.has(lot.batchId)) map.set(lot.batchId, []); map.get(lot.batchId).push(lot); });
    return [...map.entries()].map(([batchId, lots]) => ({
      batchId, label: reelLabelMap.get(batchId), date: lots[0].date, supplierId: lots[0].supplierId, lots,
      biltyWeight: Number(lots[0].biltyWeight || 0), loadingChargePerKg: Number(lots[0].loadingChargePerKg || 0),
      lifterId: lots[0].lifterId || "",
      totalWeight: lots.reduce((a, l) => a + Number(l.weight), 0),
    })).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  }, [reels, reelLabelMap]);

  const deleteEntry = (batchId) => {
    const lots = reels.filter((r) => r.batchId === batchId);
    if (lots.some((l) => lotInfo[l.id].status !== "consignment" && lotInfo[l.id].status !== "held")) return;
    if (!confirmDelete(`this entry (${lots.length} reels)`)) return;
    persist.reels(reels.filter((r) => r.batchId !== batchId));
  };
  const startEdit = (b) => { setEditBatch(b.batchId); setDraft({ date: b.date, biltyWeight: b.biltyWeight || "", loadingChargePerKg: b.loadingChargePerKg || "", lifterId: b.lifterId || "" }); };
  const saveEntry = (batchId) => {
    if (!draft.date) return;
    persist.reels(reels.map((r) => r.batchId === batchId ? { ...r, date: draft.date, biltyWeight: Number(draft.biltyWeight || 0), loadingChargePerKg: Number(draft.loadingChargePerKg || 0), lifterId: draft.lifterId || null } : r));
    setEditBatch(null);
  };

  return (
    <div>
      <SectionHead title="Add reels received" />
      {canAdd ? <ReelsAddForm ctx={ctx} /> : <LockedNote text="You don't have permission to add reel entries." />}
      <h3 className="sub-heading">All entries</h3>
      {batches.length === 0 && <EmptyRow>No reels logged yet.</EmptyRow>}
      {batches.map((b) => {
        const blocked = b.lots.some((l) => lotInfo[l.id].status !== "consignment" && lotInfo[l.id].status !== "held");
        const isOpen = expanded === b.batchId;
        const isEditing = editBatch === b.batchId;
        const loadingChargesTotal = (b.biltyWeight / 1000) * b.loadingChargePerKg;
        return (
          <div className="entry-card" key={b.batchId}>
            <div className="entry-card-head" onClick={() => !isEditing && setExpanded(isOpen ? null : b.batchId)}>
              <div className="entry-card-title">
                {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                <span className="mono-tag entry-tag">{b.label}</span>
                {isEditing ? (
                  <span className="entry-date-edit" onClick={(e) => e.stopPropagation()}>
                    <input type="date" value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} />
                    <select value={draft.lifterId} onChange={(e) => setDraft({ ...draft, lifterId: e.target.value })} style={{ width: 140 }}>
                      <option value="">No Lifter</option>
                      {ctx.lifters.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                    </select>
                    <input type="number" placeholder="Bilty wt" value={draft.biltyWeight} onChange={(e) => setDraft({ ...draft, biltyWeight: e.target.value })} style={{ width: 110 }} />
                    <input type="number" placeholder="Loading/kg" value={draft.loadingChargePerKg} onChange={(e) => setDraft({ ...draft, loadingChargePerKg: e.target.value })} style={{ width: 100 }} />
                    <button className="icon-btn" onClick={() => saveEntry(b.batchId)}><Check size={14} /></button>
                    <button className="icon-btn" onClick={() => setEditBatch(null)}><X size={14} /></button>
                  </span>
                ) : (
                  <span>{fmtDate(b.date)} · {supplierName(b.supplierId)} · {lifterName(b.lifterId) ? `Lifter: ${lifterName(b.lifterId)} · ` : ""}{b.lots.length} reels · {num(b.totalWeight)} kg{loadingChargesTotal > 0 ? ` · loading ${money(loadingChargesTotal)}` : ""}</span>
                )}
              </div>
              {!isEditing && (
                <div className="row-actions">
                  {canAdd && <button className="icon-btn" onClick={(e) => { e.stopPropagation(); setAddingTo(addingTo === b.batchId ? null : b.batchId); setExpanded(b.batchId); }} title="Add reel(s) to this entry"><Plus size={15} /></button>}
                  {canEdit && <button className="icon-btn" onClick={(e) => { e.stopPropagation(); startEdit(b); }}><Pencil size={15} /></button>}
                  {canDelete && <button className="icon-btn" onClick={(e) => { e.stopPropagation(); deleteEntry(b.batchId); }} disabled={blocked}><Trash2 size={15} /></button>}
                </div>
              )}
            </div>
            {isOpen && (
              <div className="entry-card-body">
                {addingTo === b.batchId && (
                  <AddReelsToEntry ctx={ctx} batch={b} onDone={() => setAddingTo(null)} />
                )}
                {b.lots.map((lot) => {
                  const info = lotInfo[lot.id];
                  return (
                    <div className="row" key={lot.id}>
                      <div>
                        <div className="row-title">{reelDesc(lot)} <span className="mono-tag">Lot {lot.lotNo}</span></div>
                        <div className="row-sub">width {lot.width} · {num(lot.weight)} kg · remaining {num(info.remaining)} kg{lot.detail ? ` · ${lot.detail}` : ""}</div>
                      </div>
                      <Stamp tone={statusTone(info.status)}>{statusLabel(info.status)}</Stamp>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function ReelsEditTab({ ctx }) {
  const canEdit = ctx.can("canEditEntries"); const canDelete = ctx.can("canDeleteEntries");
  if (!canEdit && !canDelete) return <LockedNote text="No permission." />;
  const { reels, brands, lifters, persist, supplierName, lifterName, reelDesc, lotInfo, reelLabelMap } = ctx;
  const [q, setQ] = useState("");
  const [editId, setEditId] = useState(null); const [ef, setEf] = useState(null);
  const [addingToBatch, setAddingToBatch] = useState(null);
  const [newRow, setNewRow] = useState({ lotNo: "", brandId: "", gsm: "", width: "", weight: "", detail: "" });

  const startEdit = (lot) => { setEditId(lot.id); setEf({ lotNo: lot.lotNo, supplierId: lot.supplierId, brandId: lot.brandId, gsm: lot.gsm, width: lot.width || "", weight: lot.weight, detail: lot.detail || "", date: lot.date, lifterId: lot.lifterId || "" }); };
  const saveEdit = () => {
    persist.reels(reels.map((r) => r.id === editId ? { ...r, lotNo: ef.lotNo.trim(), supplierId: ef.supplierId, brandId: ef.brandId, gsm: Number(ef.gsm), width: Number(ef.width), weight: Number(ef.weight), detail: ef.detail.trim(), date: ef.date, lifterId: ef.lifterId || null } : r));
    setEditId(null);
  };
  const removeLot = (id) => { if (lotInfo[id]?.status !== "consignment" && lotInfo[id]?.status !== "held") return; if (!confirmDelete("this reel")) return; persist.reels(reels.filter((r) => r.id !== id)); };

  const addReelToBatch = (batchId) => {
    if (!newRow.lotNo.trim() || !newRow.brandId || !newRow.gsm || !newRow.width || !newRow.weight) return;
    const existingLots = new Set(reels.map((r) => r.lotNo));
    if (existingLots.has(newRow.lotNo.trim())) { alert("Lot number already exists!"); return; }
    const batchReel = reels.find(r => r.batchId === batchId);
    if (!batchReel) return;
    const newReel = {
      id: uid(), batchId, lotNo: newRow.lotNo.trim(), supplierId: batchReel.supplierId, brandId: newRow.brandId,
      gsm: Number(newRow.gsm), width: Number(newRow.width), weight: Number(newRow.weight), detail: newRow.detail.trim(),
      date: batchReel.date, lifterId: batchReel.lifterId || null,
      biltyWeight: Number(batchReel.biltyWeight || 0), loadingChargePerKg: Number(batchReel.loadingChargePerKg || 0),
    };
    persist.reels([...reels, newReel]);
    setNewRow({ lotNo: "", brandId: brands[0]?.id || "", gsm: "", width: "", weight: "", detail: "" });
    setAddingToBatch(null);
  };

  const filtered = reels.filter((lot) => {
    if (!q.trim()) return true;
    const query = q.trim().toLowerCase();
    const label = (reelLabelMap.get(lot.batchId) || "").toLowerCase();
    return `${label} ${lot.lotNo} ${reelDesc(lot).toLowerCase()} ${lifterName(lot.lifterId).toLowerCase()}`.includes(query);
  });
  const groups = groupByDate(filtered);
  return (
    <div>
      <SectionHead title="Edit individual reels" />
      <div className="filter-bar no-print"><Field label="Search"><div className="search-input"><Search size={13} /><input value={q} onChange={(e) => setQ(e.target.value)} /></div></Field></div>
      {groups.length === 0 && <EmptyRow>Nothing to edit.</EmptyRow>}
      {groups.map(([d, lots]) => (
        <div key={d} className="date-block">
          <div className="date-block-head">{fmtDate(d)}</div>
          <div className="list">
            {lots.map((lot) => {
              const info = lotInfo[lot.id];
              const isAddingHere = addingToBatch === lot.batchId;
              return (
                <React.Fragment key={lot.id}>
                  <div className="row">
                    {editId === lot.id ? (
                      <div className="edit-row grid-8">
                        <input value={ef.lotNo} onChange={(e) => setEf({ ...ef, lotNo: e.target.value })} />
                        <select value={ef.brandId} onChange={(e) => setEf({ ...ef, brandId: e.target.value })}>{brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
                        <input type="number" value={ef.gsm} onChange={(e) => setEf({ ...ef, gsm: e.target.value })} />
                        <input type="number" value={ef.width} onChange={(e) => setEf({ ...ef, width: e.target.value })} />
                        <input type="number" value={ef.weight} onChange={(e) => setEf({ ...ef, weight: e.target.value })} />
                        <select value={ef.lifterId} onChange={(e) => setEf({ ...ef, lifterId: e.target.value })}><option value="">No Lifter</option>{lifters.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}</select>
                        <input value={ef.detail} onChange={(e) => setEf({ ...ef, detail: e.target.value })} />
                        <input type="date" value={ef.date} onChange={(e) => setEf({ ...ef, date: e.target.value })} />
                        <button className="icon-btn" onClick={saveEdit}><Check size={15} /></button>
                        <button className="icon-btn" onClick={() => setEditId(null)}><X size={15} /></button>
                      </div>
                    ) : (
                      <>
                        <div>
                          <div className="row-title">{reelDesc(lot)} <span className="mono-tag">{reelLabelMap.get(lot.batchId)}</span> <span className="mono-tag">Lot {lot.lotNo}</span></div>
                          <div className="row-sub">{supplierName(lot.supplierId)} · {num(lot.weight)} kg · Lifter: {lifterName(lot.lifterId)}</div>
                        </div>
                        <div className="row-actions">
                          <Stamp tone={statusTone(info.status)}>{statusLabel(info.status)}</Stamp>
                          {canEdit && <button className="icon-btn" onClick={() => startEdit(lot)}><Pencil size={15} /></button>}
                          {canDelete && <button className="icon-btn" onClick={() => removeLot(lot.id)} disabled={info.status !== "consignment" && info.status !== "held"}><Trash2 size={15} /></button>}
                          {canEdit && (info.status === "consignment" || info.status === "held") && (
                            <button className="btn" style={{ fontSize: 11, padding: "4px 8px" }} onClick={() => setAddingToBatch(isAddingHere ? null : lot.batchId)}>
                              <Plus size={12} /> Add to {reelLabelMap.get(lot.batchId)}
                            </button>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                  {isAddingHere && (
                    <div className="ticket-form" style={{ margin: "8px 0", padding: 14 }}>
                      <div className="computed" style={{ marginBottom: 8 }}>Adding new reel to <b>{reelLabelMap.get(lot.batchId)}</b></div>
                      <div className="rows-table">
                        <div className="rows-head cols-7"><span>Lot no</span><span>Brand</span><span>Gram</span><span>Width</span><span>Weight</span><span>Detail</span><span /></div>
                        <div className="rows-line cols-7">
                          <input value={newRow.lotNo} onChange={(e) => setNewRow({ ...newRow, lotNo: e.target.value })} placeholder="e.g. 9939" />
                          <select value={newRow.brandId} onChange={(e) => setNewRow({ ...newRow, brandId: e.target.value })}>{brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
                          <input type="number" value={newRow.gsm} onChange={(e) => setNewRow({ ...newRow, gsm: e.target.value })} placeholder="230" />
                          <input type="number" value={newRow.width} onChange={(e) => setNewRow({ ...newRow, width: e.target.value })} placeholder="30" />
                          <input type="number" value={newRow.weight} onChange={(e) => setNewRow({ ...newRow, weight: e.target.value })} placeholder="647" />
                          <input value={newRow.detail} onChange={(e) => setNewRow({ ...newRow, detail: e.target.value })} placeholder="optional" />
                          <button className="btn primary" style={{ padding: "6px 10px", fontSize: 12 }} onClick={() => addReelToBatch(lot.batchId)}>Save</button>
                        </div>
                      </div>
                    </div>
                  )}
                </React.Fragment>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function ReelsReportView({ ctx }) {
  if (!ctx.can("canViewReports")) return <LockedNote text="No permission." />;
  const { reels, suppliers, supplierName, lifterName, reelDesc, lotInfo, reelLabelMap, purchaseLabelMap, productionLabelMap, sizeLabel, packetWeightKg, sizes, itemsFor, purchasedByLabel } = ctx;
  const [supplierFilter, setSupplierFilter] = useState([]);
  const [statusFilter, setStatusFilter] = useState([]);
  const [q, setQ] = useState("");
  const [from, setFrom] = useState(""); const [to, setTo] = useState("");
  const [sort, setSort] = useState({ field: "entry", dir: "desc" });
  const [expandedId, setExpandedId] = useState(null);

  const statusOptions = [
    { value: "consignment", label: "In godown" }, { value: "partial", label: "Partly converted" },
    { value: "converted", label: "Fully converted" }, { value: "purchased", label: "Purchased" },
    { value: "held", label: "On Hold" }
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
            <div className="date-block-head">{fmtDate(d)} <span>{lots.length} reels{dateCharges > 0 ? ` · loading ${money(dateCharges)}` : ""}</span></div>
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
                            {info.status === "held" && <div className="detail-line" style={{ color: 'var(--danger)' }}>Currently ON HOLD.</div>}
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

function HoldEntriesTab({ ctx }) {
  const { reels, lotInfo, reelDesc, persist, lifterName, customers, customerName } = ctx;
  const [selectedIds, setSelectedIds] = useState([]);
  const [holdNote, setHoldNote] = useState("");
  const [heldByCustomerId, setHeldByCustomerId] = useState("");
  const [q, setQ] = useState("");

  const available = reels.filter((r) =>
    lotInfo[r.id]?.available && !r.isHeld &&
    (!q.trim() || `${r.lotNo} ${reelDesc(r)} ${lifterName(r.lifterId)}`.toLowerCase().includes(q.toLowerCase()))
  );

  const toggleSelect = (id) => {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const applyHold = async () => {
    if (selectedIds.length === 0) return;
    if (!window.confirm(`Hold ${selectedIds.length} reel(s)?`)) return;
    const updated = reels.map(r =>
      selectedIds.includes(r.id)
        ? { ...r, isHeld: true, heldDate: todayISO(), holdNote: holdNote.trim(), heldByCustomerId: heldByCustomerId || null }
        : r
    );
    await persist.reels(updated);
    setSelectedIds([]);
    setHoldNote("");
    setHeldByCustomerId("");
  };

  const releaseHold = async (id) => {
    if (!window.confirm("Release this reel back to available stock?")) return;
    const updated = reels.map(r =>
      r.id === id ? { ...r, isHeld: false, heldDate: null, holdNote: null, heldByCustomerId: null } : r
    );
    await persist.reels(updated);
  };

  const heldReels = reels.filter(r => r.isHeld);

  return (
    <div>
      <SectionHead title="Hold / Release Reels" />
      <div className="ticket-form" style={{ maxWidth: 900 }}>
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
        <div className="list" style={{ maxHeight: 300, overflowY: 'auto', border: '1px solid var(--line)', borderRadius: 6, padding: 8 }}>
          {available.length === 0 && <EmptyRow>No available reels match search.</EmptyRow>}
          {available.map((r) => (
            <label key={r.id} className="checkbox-field" style={{ padding: '6px 4px', borderBottom: '1px solid var(--line)' }}>
              <input type="checkbox" checked={selectedIds.includes(r.id)} onChange={() => toggleSelect(r.id)} />
              <span>
                <b>{r.lotNo}</b> — {reelDesc(r)} — {num(lotInfo[r.id].remaining)} kg
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
      <h3 className="sub-heading">Currently Held Reels ({heldReels.length})</h3>
      {heldReels.length === 0 && <EmptyRow>No reels currently on hold.</EmptyRow>}
      <div className="list">
        {heldReels.map((r) => (
          <div className="row" key={r.id}>
            <div>
              <div className="row-title">{reelDesc(r)} <span className="mono-tag">Lot {r.lotNo}</span> <Stamp tone="rust">HELD</Stamp></div>
              <div className="row-sub">
                Held since {fmtDate(r.heldDate)} · {num(lotInfo[r.id].remaining)} kg remaining
                {r.heldByCustomerId && <> · <b>Held by: {customerName(r.heldByCustomerId)}</b></>}
                {r.holdNote && <> · Note: {r.holdNote}</>}
                {r.lifterId && <> · Lifter: {lifterName(r.lifterId)}</>}
              </div>
            </div>
            <div className="row-actions"><button className="btn" onClick={() => releaseHold(r.id)}>Release</button></div>
          </div>
        ))}
      </div>
    </div>
  );
}

function HoldReportView({ ctx }) {
  if (!ctx.can("canViewReports")) return <LockedNote text="No permission." />;
  const { reels, lotInfo, reelDesc, supplierName, lifterName, customerName } = ctx;
  const held = reels.filter(r => r.isHeld);
  const totalWeight = held.reduce((a, r) => a + lotInfo[r.id].remaining, 0);
  const doPrint = () => {
    let html = `<table><thead><tr><th>Lot</th><th>Description</th><th>Supplier</th><th>Lifter</th><th>Held By</th><th>Held Date</th><th>Note</th><th>Remaining</th></tr></thead><tbody>`;
    held.forEach(r => {
      html += `<tr><td>${esc(r.lotNo)}</td><td>${esc(reelDesc(r))}</td><td>${esc(supplierName(r.supplierId))}</td><td>${esc(lifterName(r.lifterId))}</td><td>${esc(customerName(r.heldByCustomerId))}</td><td>${esc(fmtDate(r.heldDate))}</td><td>${esc(r.holdNote || '—')}</td><td>${num(lotInfo[r.id].remaining)}</td></tr>`;
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
            {held.map(r => (
              <tr key={r.id}><td className="mono">{r.lotNo}</td><td>{reelDesc(r)}</td><td>{supplierName(r.supplierId)}</td><td>{lifterName(r.lifterId)}</td><td>{customerName(r.heldByCustomerId)}</td><td className="mono">{fmtDate(r.heldDate)}</td><td>{r.holdNote || "—"}</td><td className="mono">{num(lotInfo[r.id].remaining)}</td></tr>
            ))}
          </tbody>
          <tfoot><tr><td colSpan={7}>{held.length} reel(s)</td><td className="mono">{num(totalWeight)}</td></tr></tfoot>
        </table>
      )}
    </div>
  );
}

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
    const heldIds = new Set(valid.filter(r => reels.find(x => x.id === r.lotId)?.isHeld).map(r => r.lotId));
    if (heldIds.size > 0) {
      const updatedReels = reels.map(r => heldIds.has(r.id) ? { ...r, isHeld: false, heldDate: null, holdNote: null, heldByCustomerId: null } : r);
      persist.reels(updatedReels);
    }
    persist.purchases([...purchases, ...newOnes]);
    setLastSaved({ count: newOnes.length, batchId });
    setRows([blankRow()]);
  };
  return (
    <div>
      {eligible.length === 0 && rows.every((r) => !r.lotId) && <EmptyRow>No reels available to purchase right now.</EmptyRow>}
      {customers.length === 0 && <EmptyRow>No customers on file yet.</EmptyRow>}
      <div className="ticket-form" style={{ maxWidth: 900 }}>
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
                <LotPicker rowKey={r.key} lots={eligible} value={r.lotId} onChange={(id) => updateRow(r.key, { lotId: id })} labelFn={labelFn} placeholder="" />
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
  const { reels, purchases, persist, purchaseLabelMap, reelDesc } = ctx;
  const [expanded, setExpanded] = useState(null);
  const canAdd = ctx.can("canAddEntries"); const canDelete = ctx.can("canDeleteEntries"); const canEdit = ctx.can("canEditEntries");
  const [editDateBatch, setEditDateBatch] = useState(null); const [dateDraft, setDateDraft] = useState("");
  const batches = useMemo(() => {
    const map = new Map();
    purchases.forEach((p) => { if (!map.has(p.batchId)) map.set(p.batchId, []); map.get(p.batchId).push(p); });
    return [...map.entries()].map(([batchId, lines]) => ({
      batchId, label: purchaseLabelMap.get(batchId), date: lines[0].date, lines,
      totalWeight: lines.reduce((a, l) => a + Number(l.weight), 0),
      totalAmount: lines.reduce((a, l) => a + Number(l.weight) * Number(l.rate), 0),
    })).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  }, [purchases, purchaseLabelMap]);
  const deleteEntry = (batchId) => { if (!confirmDelete("this purchase entry")) return; persist.purchases(purchases.filter((p) => p.batchId !== batchId)); };
  const startEditDate = (b) => { setEditDateBatch(b.batchId); setDateDraft(b.date); };
  const saveEntryDate = (batchId) => { if (!dateDraft) return; persist.purchases(purchases.map((p) => p.batchId === batchId ? { ...p, date: dateDraft } : p)); setEditDateBatch(null); };
  return (
    <div>
      <SectionHead title="Record purchases" />
      {canAdd ? <PurchasesAddForm ctx={ctx} /> : <LockedNote text="No permission." />}
      <h3 className="sub-heading">All entries</h3>
      {batches.length === 0 && <EmptyRow>No purchases logged yet.</EmptyRow>}
      {batches.map((b) => {
        const isOpen = expanded === b.batchId; const isEditingDate = editDateBatch === b.batchId;
        return (
          <div className="entry-card" key={b.batchId}>
            <div className="entry-card-head" onClick={() => !isEditingDate && setExpanded(isOpen ? null : b.batchId)}>
              <div className="entry-card-title">
                {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                <span className="mono-tag entry-tag">{b.label}</span>
                {isEditingDate ? (
                  <span className="entry-date-edit" onClick={(e) => e.stopPropagation()}>
                    <input type="date" value={dateDraft} onChange={(e) => setDateDraft(e.target.value)} />
                    <button className="icon-btn" onClick={() => saveEntryDate(b.batchId)}><Check size={14} /></button>
                    <button className="icon-btn" onClick={() => setEditDateBatch(null)}><X size={14} /></button>
                  </span>
                ) : (
                  <span>{fmtDate(b.date)} · {b.lines.length} lines · {num(b.totalWeight)} kg · {money(b.totalAmount)}</span>
                )}
              </div>
              {!isEditingDate && (
                <div className="row-actions">
                  {canEdit && <button className="icon-btn" onClick={(e) => { e.stopPropagation(); startEditDate(b); }}><Pencil size={15} /></button>}
                  {canDelete && <button className="icon-btn" onClick={(e) => { e.stopPropagation(); deleteEntry(b.batchId); }}><Trash2 size={15} /></button>}
                </div>
              )}
            </div>
            {isOpen && (
              <div className="entry-card-body">
                {b.lines.map((p) => {
                  const lot = reels.find((r) => r.id === p.lotId);
                  return (
                    <div className="row" key={p.id}>
                      <div className="row-title">{lot ? reelDesc(lot) : "removed"} <span className="mono-tag">Lot {lot?.lotNo}</span></div>
                      <div className="row-sub">{num(p.weight)} kg at {num(p.rate)}/kg = {money(Number(p.weight) * Number(p.rate))}{ctx.purchasedByLabel(p) ? ` · ${ctx.purchasedByLabel(p)}` : ""}</div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function PurchaseReportView({ ctx }) {
  if (!ctx.can("canViewReports")) return <LockedNote text="No permission." />;
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
    html += `<h2>Grand total</h2><table><tbody><tr><td>Total weight</td><td>${num(grandWeight)} kg</td></tr><tr><td>Total amount</td><td>${money(grandAmount)}</td></tr></tbody></table>`;
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
      {filtered.length > 0 && (
        <div className="report-grand-total"><span>Grand total — {filtered.length} lots</span><span className="mono">{num(grandWeight)} kg</span><span className="mono">{money(grandAmount)}</span></div>
      )}
    </div>
  );
}

function PurchaseEditTab({ ctx }) {
  const canEdit = ctx.can("canEditEntries"); const canDelete = ctx.can("canDeleteEntries");
  if (!canEdit && !canDelete) return <LockedNote text="No permission." />;
  const { reels, purchases, customers, persist, reelDesc, lotInfo, purchaseLabelMap, remainingForLot, purchasedByLabel } = ctx;
  const [editId, setEditId] = useState(null); const [ef, setEf] = useState(null); const [q, setQ] = useState("");
  const eligibleFor = (currentLotId) => reels.filter((r) => r.id === currentLotId || lotInfo[r.id]?.available);
  const labelFn = (excludeId) => (l) => `${reelDesc(l)} · Lot ${l.lotNo} · ${num(remainingForLot(l.id, excludeId))} kg available`;
  const startEdit = (p) => { setEditId(p.id); setEf({ lotId: p.lotId, rate: p.rate, customerId: p.customerId || "", date: p.date }); };
  const saveEdit = () => {
    const weight = remainingForLot(ef.lotId, editId);
    persist.purchases(purchases.map((p) => p.id === editId ? { ...p, lotId: ef.lotId, weight, rate: Number(ef.rate), customerId: ef.customerId || null, date: ef.date } : p));
    setEditId(null);
  };
  const remove = (id) => { if (!confirmDelete("this purchase")) return; persist.purchases(purchases.filter((p) => p.id !== id)); };
  const filtered = purchases.filter((p) => {
    if (!q.trim()) return true;
    const query = q.trim().toLowerCase();
    const lot = reels.find((r) => r.id === p.lotId);
    const label = (purchaseLabelMap.get(p.batchId) || "").toLowerCase();
    return `${label} ${lot ? lot.lotNo : ""} ${lot ? reelDesc(lot).toLowerCase() : ""}`.includes(query);
  });
  const groups = groupByDate(filtered);
  return (
    <div>
      <SectionHead title="Edit purchases" />
      <div className="filter-bar no-print"><Field label="Search"><div className="search-input"><Search size={13} /><input value={q} onChange={(e) => setQ(e.target.value)} /></div></Field></div>
      {groups.length === 0 && <EmptyRow>Nothing to edit.</EmptyRow>}
      {groups.map(([d, lines]) => (
        <div key={d} className="date-block">
          <div className="date-block-head">{fmtDate(d)}</div>
          <div className="list">
            {lines.map((p) => {
              const lot = reels.find((r) => r.id === p.lotId);
              return (
                <div className="row" key={p.id}>
                  {editId === p.id ? (
                    <div className="edit-row grid-5">
                      <LotPicker rowKey={p.id} lots={eligibleFor(p.lotId)} value={ef.lotId} onChange={(id) => setEf({ ...ef, lotId: id })} labelFn={labelFn(p.id)} />
                      <input type="number" value={ef.rate} onChange={(e) => setEf({ ...ef, rate: e.target.value })} />
                      <select value={ef.customerId} onChange={(e) => setEf({ ...ef, customerId: e.target.value })}><option value="">Select…</option>{customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
                      <input type="date" value={ef.date} onChange={(e) => setEf({ ...ef, date: e.target.value })} />
                      <button className="icon-btn" onClick={saveEdit}><Check size={15} /></button>
                      <button className="icon-btn" onClick={() => setEditId(null)}><X size={15} /></button>
                    </div>
                  ) : lot ? (
                    <>
                      <div>
                        <div className="row-title">{reelDesc(lot)} <span className="mono-tag">{purchaseLabelMap.get(p.batchId)}</span> <span className="mono-tag">Lot {lot.lotNo}</span></div>
                        <div className="row-sub">{num(p.weight)} kg at {num(p.rate)}/kg = {money(Number(p.weight) * Number(p.rate))}{purchasedByLabel(p) ? ` · ${purchasedByLabel(p)}` : ""}</div>
                      </div>
                      <div className="row-actions">
                        {canEdit && <button className="icon-btn" onClick={() => startEdit(p)}><Pencil size={15} /></button>}
                        {canDelete && <button className="icon-btn" onClick={() => remove(p.id)}><Trash2 size={15} /></button>}
                      </div>
                    </>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

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
        const updatedReels = reels.map(r => r.id === lotId ? { ...r, isHeld: false, heldDate: null, holdNote: null, heldByCustomerId: null } : r);
        await persist.reels(updatedReels);
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
        <div className="ticket-form" style={{ maxWidth: 900 }}>
          <div className="grid-2">
            <Field label="Date"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
            <Field label="Reel"><LotPicker rowKey="prod-lot" lots={eligible} value={lotId} onChange={setLotId} labelFn={labelFn} /></Field>
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
                <select value={it.sizeId} onChange={(e) => updateItem(it.key, { sizeId: e.target.value })}>{sizes.map((s) => <option key={s.id} value={s.id}>{sizeLabel(s)}</option>)}</select>
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
  const { reels, sizes, productions, persist, reelDesc, sizeLabel, packetWeightKg, itemsFor, itemsWeightFor, productionLabelMap, lotInfo } = ctx;
  const [expanded, setExpanded] = useState(null);
  const canAdd = ctx.can("canAddEntries"); const canDelete = ctx.can("canDeleteEntries"); const canEdit = ctx.can("canEditEntries");
  const [editDateId, setEditDateId] = useState(null); const [dateDraft, setDateDraft] = useState("");
  const sorted = [...productions].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  const deleteEntry = (id) => { if (!confirmDelete("this production entry")) return; ctx.persist.productions(productions.filter((p) => p.id !== id)); ctx.persist.productionItems(ctx.productionItems.filter((it) => it.productionId !== id)); };
  const startEditDate = (p) => { setEditDateId(p.id); setDateDraft(p.date); };
  const saveEntryDate = (id) => { if (!dateDraft) return; persist.productions(productions.map((p) => p.id === id ? { ...p, date: dateDraft } : p)); setEditDateId(null); };
  return (
    <div>
      <SectionHead title="Convert a reel into packets" />
      {canAdd ? <ProductionAddForm ctx={ctx} /> : <LockedNote text="No permission." />}
      <h3 className="sub-heading">All entries</h3>
      {sorted.length === 0 && <EmptyRow>No production entries yet.</EmptyRow>}
      {sorted.map((p) => {
        const lot = reels.find((r) => r.id === p.lotId);
        const items = itemsFor(p.id);
        const totalUsed = itemsWeightFor(p.id) + Number(p.wastageKg || 0);
        const isOpen = expanded === p.id; const isEditingDate = editDateId === p.id;
        return (
          <div className="entry-card" key={p.id}>
            <div className="entry-card-head" onClick={() => !isEditingDate && setExpanded(isOpen ? null : p.id)}>
              <div className="entry-card-title">
                {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                <span className="mono-tag entry-tag">{productionLabelMap.get(p.id)}</span>
                {isEditingDate ? (
                  <span className="entry-date-edit" onClick={(e) => e.stopPropagation()}>
                    <input type="date" value={dateDraft} onChange={(e) => setDateDraft(e.target.value)} />
                    <button className="icon-btn" onClick={() => saveEntryDate(p.id)}><Check size={14} /></button>
                    <button className="icon-btn" onClick={() => setEditDateId(null)}><X size={14} /></button>
                  </span>
                ) : (
                  <span>{fmtDate(p.date)} · {lot ? reelDesc(lot) : "removed"} {lot ? `Lot ${lot.lotNo}` : ""} · {items.length} sizes · {num(totalUsed)} kg used{p.closeOut ? " · closed" : ""}</span>
                )}
              </div>
              {!isEditingDate && (
                <div className="row-actions">
                  {canEdit && <button className="icon-btn" onClick={(e) => { e.stopPropagation(); startEditDate(p); }}><Pencil size={15} /></button>}
                  {canDelete && <button className="icon-btn" onClick={(e) => { e.stopPropagation(); deleteEntry(p.id); }}><Trash2 size={15} /></button>}
                </div>
              )}
            </div>
            {isOpen && (
              <div className="entry-card-body">
                {lot && <div className="row-sub" style={{ marginBottom: 8 }}>Status: <Stamp tone={statusTone(lotInfo[lot.id].status)}>{statusLabel(lotInfo[lot.id].status)}</Stamp> · wastage {num(p.wastageKg || 0)} kg</div>}
                {items.map((it) => {
                  const sz = sizes.find((s) => s.id === it.sizeId);
                  const w = sz ? Number(it.packetsProduced) * packetWeightKg(sz) : 0;
                  return (<div className="row" key={it.id}><div>{sz ? sizeLabel(sz) : "removed size"}</div><div className="row-sub">{num(it.packetsProduced)} packets = {num(w)} kg</div></div>);
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function ProductionReportView({ ctx }) {
  if (!ctx.can("canViewReports")) return <LockedNote text="No permission." />;
  const { reels, sizes, productions, reelDesc, sizeLabel, packetWeightKg, avgGramForLot, lotInfo, itemsFor, itemsWeightFor, productionLabelMap, remainingAfterProduction } = ctx;
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
      {filtered.length > 0 && (
        <div className="report-grand-total"><span>Grand total — {filtered.length} entries</span><span className="mono">Packets {num(grandPackets)}</span><span className="mono">Used {num(grandUsed)} kg</span><span className="mono">Wastage {num(grandWastage)} kg</span></div>
      )}
    </div>
  );
}

function ProductionEditTab({ ctx }) {
  const canEdit = ctx.can("canEditEntries"); const canDelete = ctx.can("canDeleteEntries");
  if (!canEdit && !canDelete) return <LockedNote text="No permission." />;
  const { reels, sizes, productions, productionItems, persist, reelDesc, sizeLabel, packetWeightKg, productionLabelMap, itemsFor } = ctx;
  const [q, setQ] = useState("");
  const [editHeaderId, setEditHeaderId] = useState(null); const [eh, setEh] = useState(null);
  const [editItemId, setEditItemId] = useState(null); const [ei, setEi] = useState(null);
  const startEditHeader = (p) => { setEditHeaderId(p.id); setEh({ wastageKg: p.wastageKg, closeOut: !!p.closeOut, date: p.date }); };
  const saveEditHeader = () => { persist.productions(productions.map((p) => p.id === editHeaderId ? { ...p, wastageKg: Number(eh.wastageKg || 0), closeOut: eh.closeOut, date: eh.date } : p)); setEditHeaderId(null); };
  const startEditItem = (it) => { setEditItemId(it.id); setEi({ sizeId: it.sizeId, packetsProduced: it.packetsProduced }); };
  const saveEditItem = () => { persist.productionItems(productionItems.map((it) => it.id === editItemId ? { ...it, sizeId: ei.sizeId, packetsProduced: Number(ei.packetsProduced) } : it)); setEditItemId(null); };
  const removeItem = (id) => { if (!confirmDelete("this line")) return; persist.productionItems(productionItems.filter((it) => it.id !== id)); };
  const filtered = productions.filter((p) => {
    if (!q.trim()) return true;
    const query = q.trim().toLowerCase();
    const lot = reels.find((r) => r.id === p.lotId);
    const label = (productionLabelMap.get(p.id) || "").toLowerCase();
    return `${label} ${lot ? lot.lotNo : ""} ${lot ? reelDesc(lot).toLowerCase() : ""}`.includes(query);
  });
  const groups = groupByDate(filtered);
  return (
    <div>
      <SectionHead title="Edit production" />
      <div className="filter-bar no-print"><Field label="Search"><div className="search-input"><Search size={13} /><input value={q} onChange={(e) => setQ(e.target.value)} /></div></Field></div>
      {groups.length === 0 && <EmptyRow>Nothing to edit.</EmptyRow>}
      {groups.map(([d, heads]) => (
        <div key={d} className="date-block">
          <div className="date-block-head">{fmtDate(d)}</div>
          {heads.map((p) => {
            const lot = reels.find((r) => r.id === p.lotId); if (!lot) return null;
            const items = itemsFor(p.id);
            return (
              <div key={p.id} className="production-block">
                <div className="production-head">
                  <div><span className="mono-tag entry-tag">{productionLabelMap.get(p.id)}</span> <b>{reelDesc(lot)}</b> <span className="mono-tag">Lot {lot.lotNo}</span></div>
                  {editHeaderId === p.id ? (
                    <div className="edit-row">
                      <input type="number" value={eh.wastageKg} onChange={(e) => setEh({ ...eh, wastageKg: e.target.value })} placeholder="wastage" style={{ width: 100 }} />
                      <label className="checkbox-field" style={{ margin: 0 }}><input type="checkbox" checked={eh.closeOut} onChange={(e) => setEh({ ...eh, closeOut: e.target.checked })} /><span>Closed</span></label>
                      <input type="date" value={eh.date} onChange={(e) => setEh({ ...eh, date: e.target.value })} />
                      <button className="icon-btn" onClick={saveEditHeader}><Check size={15} /></button>
                      <button className="icon-btn" onClick={() => setEditHeaderId(null)}><X size={15} /></button>
                    </div>
                  ) : canEdit ? (<button className="icon-btn" onClick={() => startEditHeader(p)}><Pencil size={15} /></button>) : null}
                </div>
                <table className="ledger-table">
                  <thead><tr><th>Size</th><th>Packets</th><th>Weight</th><th>Edit</th></tr></thead>
                  <tbody>
                    {items.length === 0 && <tr><td colSpan={4}><EmptyRow>No sizes.</EmptyRow></td></tr>}
                    {items.map((it) => {
                      const sz = sizes.find((s) => s.id === it.sizeId);
                      if (editItemId === it.id) {
                        return (<tr key={it.id}><td colSpan={4}><div className="edit-row"><select value={ei.sizeId} onChange={(e) => setEi({ ...ei, sizeId: e.target.value })}>{sizes.map((s) => <option key={s.id} value={s.id}>{sizeLabel(s)}</option>)}</select><input type="number" step="any" value={ei.packetsProduced} onChange={(e) => setEi({ ...ei, packetsProduced: e.target.value })} style={{ width: 100 }} /><button className="icon-btn" onClick={saveEditItem}><Check size={15} /></button><button className="icon-btn" onClick={() => setEditItemId(null)}><X size={15} /></button></div></td></tr>);
                      }
                      if (!sz) return null;
                      const w = Number(it.packetsProduced) * packetWeightKg(sz);
                      return (
                        <tr key={it.id}>
                          <td>{sizeLabel(sz)}</td><td className="mono">{num(it.packetsProduced)}</td><td className="mono">{num(w)}</td>
                          <td className="row-actions">
                            {canEdit && <button className="icon-btn" onClick={() => startEditItem(it)}><Pencil size={15} /></button>}
                            {canDelete && <button className="icon-btn" onClick={() => removeItem(it.id)}><Trash2 size={15} /></button>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function StockReportTab({ ctx }) {
  if (!ctx.can("canViewReports")) return <LockedNote text="No permission." />;
  const { reels, suppliers, lotInfo, reelDesc, supplierName, purchasedByLabel, lifterName } = ctx;
  const [supplierFilter, setSupplierFilter] = useState([]);
  const [statusFilter, setStatusFilter] = useState([]);
  const [q, setQ] = useState("");
  const [from, setFrom] = useState(""); const [to, setTo] = useState("");
  const [sort, setSort] = useState({ field: "date", dir: "desc" });
  const statusOptions = [{ value: "consignment", label: "In godown" }, { value: "partial", label: "Partly converted" }, { value: "converted", label: "Fully converted" }, { value: "purchased", label: "Purchased" }, { value: "held", label: "On Hold" }];
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
  if (!ctx.can("canViewReports")) return <LockedNote text="No permission." />;
  const { reels, suppliers, lotInfo, reelDesc, supplierName } = ctx;
  const [supplierFilter, setSupplierFilter] = useState([]);
  const [statusFilter, setStatusFilter] = useState([]);
  const [q, setQ] = useState("");
  const [from, setFrom] = useState(""); const [to, setTo] = useState("");
  const [sort, setSort] = useState({ field: "qty", dir: "desc" });
  const statusOptions = [{ value: "consignment", label: "In godown" }, { value: "partial", label: "Partly converted" }, { value: "converted", label: "Fully converted" }, { value: "purchased", label: "Purchased" }, { value: "held", label: "On Hold" }];
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

/* ---------------- styles ---------------- */
function Style() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@500&display=swap');

      *, *::before, *::after { box-sizing: border-box; }

      :root {
        /* NEW SLATE & TEAL PALETTE */
        --ink: #1E293B;
        --paper: #F8FAFC;
        --paper-2: #FFFFFF;
        --line: #E2E8F0;
        --accent: #0F766E;       /* Teal 700 */
        --accent-light: #CCFBF1; /* Teal 100 */
        --accent-hover: #0D9488; /* Teal 600 */
        --danger: #DC2626;
        --danger-bg: #FEF2F2;
        --warn: #D97706;
        --warn-bg: #FFFBEB;
        --info: #2563EB;
        --info-bg: #EFF6FF;
        --gray-bg: #F1F5F9;
        --muted: #64748B;
      }

      html, body, #root {
        height: 100% !important;
        min-height: 100% !important;
        margin: 0 !important;
        padding: 0 !important;
        width: 100% !important;
        text-align: left !important;
        background: var(--paper) !important;
        color: var(--ink) !important;
        font-family: 'Inter', sans-serif !important;
      }

      /* =========================
         APP SHELL & LAYOUT
         ========================= */
      .app-shell {
        font-family: 'Inter', sans-serif;
        color: var(--ink);
        background: var(--paper);
        min-height: 100vh;
      }

      .loading-shell {
        display: flex; align-items: center; gap: 10px;
        justify-content: center; padding: 48px 0; color: var(--muted);
      }

      .spin { animation: spin 1s linear infinite; }
      @keyframes spin { to { transform: rotate(360deg); } }

      .app-layout { display: flex; min-height: 100vh; }
      .main-area { flex: 1; display: flex; flex-direction: column; min-width: 0; }
      .top-bar {
        padding: 16px 28px; border-bottom: 1px solid var(--line);
        background: var(--paper-2);
      }
      .top-bar h1 {
        font-family: 'Inter', sans-serif; font-weight: 700;
        font-size: 18px; text-transform: uppercase; margin: 0;
        letter-spacing: .03em; color: var(--ink);
      }
      .app-main { padding: 24px 28px 32px; flex: 1; overflow-y: auto; }

      /* =========================
         SIDEBAR (SLATE THEME)
         ========================= */
      .sidebar {
        width: 260px; background: var(--ink);
        border-right: none;
        display: flex; flex-direction: column;
        transition: width 0.25s cubic-bezier(0.4, 0, 0.2, 1);
        flex-shrink: 0; overflow: hidden;
      }
      .sidebar.collapsed { width: 64px; }

      .sidebar-brand {
        display: flex; align-items: center; gap: 12px;
        padding: 20px 16px; border-bottom: 1px solid rgba(255,255,255,0.08);
        min-height: 72px;
      }
      .sidebar-brand-mark {
        font-family: 'JetBrains Mono', monospace; font-weight: 700;
        font-size: 18px; background: var(--accent); color: #fff;
        width: 36px; height: 36px; display: flex; align-items: center;
        justify-content: center; border-radius: 8px; flex-shrink: 0;
      }
      .sidebar-brand-title {
        font-weight: 700; font-size: 14px; text-transform: uppercase;
        line-height: 1.15; color: #fff;
      }
      .sidebar-brand-sub {
        font-size: 10px; color: rgba(255,255,255,0.45); margin-top: 2px;
      }

      .sidebar-nav {
        flex: 1; overflow-y: auto; overflow-x: hidden;
        padding: 12px 10px; display: flex; flex-direction: column; gap: 2px;
      }
      .sidebar-nav::-webkit-scrollbar { width: 4px; }
      .sidebar-nav::-webkit-scrollbar-track { background: transparent; }
      .sidebar-nav::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.15); border-radius: 4px; }

      .sidebar-link {
        display: flex; align-items: center; gap: 12px;
        padding: 10px 12px; border-radius: 8px; border: none;
        background: transparent; color: rgba(255,255,255,0.6);
        font-size: 13px; font-weight: 500; cursor: pointer;
        white-space: nowrap; transition: all 0.15s ease;
        width: 100%; text-align: left;
      }
      .sidebar-link svg { flex-shrink: 0; opacity: 0.6; transition: opacity 0.15s ease; }
      .sidebar-link:hover { background: rgba(255,255,255,0.08); color: #fff; }
      .sidebar-link:hover svg { opacity: 1; }

      .sidebar-link.active {
        background: var(--accent); color: #fff; font-weight: 600;
        box-shadow: 0 2px 8px rgba(15, 118, 110, 0.3);
      }
      .sidebar-link.active svg { opacity: 1; color: #fff; }

      .sidebar-group-head { margin-top: 6px; }
      .sidebar-group-head.active-group {
        color: #fff; font-weight: 600; background: rgba(255,255,255,0.06);
      }
      .sidebar-chevron { margin-left: auto; opacity: 0.35; transition: all 0.15s ease; }
      .sidebar-group-head:hover .sidebar-chevron { opacity: 0.7; }

      .sidebar-children {
        display: none; flex-direction: column; gap: 1px;
        padding: 4px 0 4px 8px; margin-left: 12px;
        border-left: 2px solid rgba(255,255,255,0.1);
      }
      .sidebar-children.open { display: flex; }
      .sidebar-sublink {
        padding: 8px 12px; border-radius: 6px; border: none;
        background: transparent; color: rgba(255,255,255,0.5);
        font-size: 12.5px; font-weight: 450; cursor: pointer;
        text-align: left; white-space: nowrap;
        transition: all 0.15s ease; width: 100%; position: relative;
      }
      .sidebar-sublink:hover { background: rgba(255,255,255,0.06); color: rgba(255,255,255,0.9); padding-left: 16px; }
      .sidebar-sublink.active {
        background: rgba(15, 118, 110, 0.25); color: var(--accent-light);
        font-weight: 600; padding-left: 16px;
      }
      .sidebar-sublink.active::before {
        content: ''; position: absolute; left: -10px; top: 50%;
        transform: translateY(-50%); width: 2px; height: 16px;
        background: var(--accent); border-radius: 0 2px 2px 0;
      }

      .sidebar-footer {
        padding: 12px 10px; border-top: 1px solid rgba(255,255,255,0.08);
        display: flex; flex-direction: column; gap: 4px; background: var(--ink);
      }
      .sidebar-user {
        display: flex; flex-direction: column; padding: 8px 12px;
        font-size: 11.5px; color: rgba(255,255,255,0.6);
        overflow: hidden; border-radius: 6px; background: rgba(255,255,255,0.05);
      }
      .sidebar-role {
        font-size: 9.5px; text-transform: uppercase; letter-spacing: 0.06em;
        color: rgba(255,255,255,0.35); margin-top: 2px; font-weight: 600;
      }
      .sidebar-collapse-btn {
        border: none; background: transparent; color: rgba(255,255,255,0.4);
        cursor: pointer; padding: 8px 12px; border-radius: 6px;
        display: flex; align-items: center; justify-content: center;
        transition: all 0.15s ease;
      }
      .sidebar-collapse-btn:hover { background: rgba(255,255,255,0.08); color: #fff; }
      .sidebar-signout {
        display: flex; align-items: center; gap: 10px; border: none;
        background: transparent; color: #FCA5A5; font-size: 12.5px;
        font-weight: 500; cursor: pointer; padding: 9px 12px;
        border-radius: 6px; transition: all 0.15s ease;
      }
      .sidebar-signout:hover { background: rgba(220, 38, 38, 0.15); color: #FECACA; }

      .sidebar.collapsed .sidebar-link { justify-content: center; padding: 10px; }
      .sidebar.collapsed .sidebar-sublink { display: none; }
      .sidebar.collapsed .sidebar-children { display: none; }
      .sidebar.collapsed .sidebar-group-head { justify-content: center; }
      .sidebar.collapsed .sidebar-chevron { display: none; }

      /* =========================
         COMPONENTS
         ========================= */
      .section-head { margin-bottom: 16px; display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; }
      .section-head h2 { font-weight: 700; font-size: 15px; text-transform: uppercase; margin: 0; letter-spacing: .03em; color: var(--ink); }
      .sub-heading { font-weight: 700; font-size: 12px; text-transform: uppercase; color: var(--muted); margin: 26px 0 12px; letter-spacing: .04em; }

      .btn {
        font-size: 13px; font-weight: 600; padding: 9px 16px;
        border-radius: 8px; border: 1px solid var(--line);
        background: var(--paper-2); color: var(--ink); cursor: pointer;
        display: inline-flex; align-items: center; gap: 6px;
        transition: all 0.15s ease;
      }
      .btn:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
      .btn:disabled { opacity: .4; cursor: not-allowed; }
      .btn.primary { background: var(--accent); color: #fff; border-color: var(--accent); }
      .btn.primary:hover:not(:disabled) { background: var(--accent-hover); border-color: var(--accent-hover); }

      .icon-btn { border: none; background: transparent; color: var(--muted); cursor: pointer; padding: 6px; border-radius: 6px; display: inline-flex; transition: all 0.15s ease; }
      .icon-btn:hover:not(:disabled) { background: var(--accent-light); color: var(--accent); }
      .icon-btn:disabled { opacity: .3; cursor: not-allowed; }

      .field { display: flex; flex-direction: column; gap: 5px; font-size: 11.5px; color: var(--muted); font-weight: 600; text-transform: uppercase; letter-spacing: .03em; }
      .field input, .field select {
        font-family: 'JetBrains Mono', monospace; font-size: 13px;
        padding: 9px 12px; border: 1px solid var(--line); border-radius: 8px;
        background: var(--paper-2); color: var(--ink); transition: border-color 0.15s ease;
      }
      .field input:focus, .field select:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px rgba(15,118,110,0.1); }

      .search-input { display: flex; align-items: center; gap: 6px; background: var(--paper-2); border: 1px solid var(--line); border-radius: 8px; padding: 0 12px; transition: border-color 0.15s ease; }
      .search-input:focus-within { border-color: var(--accent); box-shadow: 0 0 0 3px rgba(15,118,110,0.1); }
      .search-input svg { color: var(--muted); flex-shrink: 0; }
      .search-input input { border: none; padding: 9px 0; background: transparent; width: 100%; }
      .search-input input:focus { outline: none; }

      .sort-control { display: flex; gap: 6px; }
      .sort-dir-btn { white-space: nowrap; padding: 9px 12px; }

      .multiselect { position: relative; }
      .multiselect-btn {
        width: 100%; min-width: 150px; display: flex; justify-content: space-between;
        align-items: center; gap: 8px; font-family: 'JetBrains Mono', monospace;
        font-size: 13px; padding: 9px 12px; border: 1px solid var(--line);
        border-radius: 8px; background: var(--paper-2); color: var(--ink); cursor: pointer;
        transition: border-color 0.15s ease;
      }
      .multiselect-btn:hover { border-color: var(--accent); }
      .multiselect-panel {
        position: absolute; top: calc(100% + 4px); left: 0; z-index: 20;
        background: var(--paper-2); border: 1px solid var(--line); border-radius: 10px;
        box-shadow: 0 8px 24px rgba(0,0,0,0.08); padding: 8px;
        min-width: 190px; max-height: 220px; overflow-y: auto;
        display: flex; flex-direction: column; gap: 2px;
      }
      .multiselect-option { display: flex; align-items: center; gap: 8px; font-size: 12.5px; padding: 7px 8px; border-radius: 6px; cursor: pointer; white-space: nowrap; transition: background 0.1s; }
      .multiselect-option:hover { background: var(--gray-bg); }
      .multiselect-clear { margin-top: 4px; font-size: 11px; padding: 5px 8px; align-self: flex-start; color: var(--accent); font-weight: 600; }

      .checkbox-field { display: flex; align-items: flex-start; gap: 8px; font-size: 12.5px; color: var(--ink); cursor: pointer; line-height: 1.4; }
      .checkbox-field input { margin-top: 2px; accent-color: var(--accent); }

      .stamp {
        font-family: 'JetBrains Mono', monospace; font-size: 10px;
        text-transform: uppercase; letter-spacing: .05em; padding: 4px 10px;
        border-radius: 20px; border: none; white-space: nowrap;
        display: inline-block; font-weight: 600;
      }
      .stamp-gray { color: var(--muted); background: var(--gray-bg); }
      .stamp-green { color: #047857; background: #D1FAE5; }
      .stamp-amber { color: var(--warn); background: var(--warn-bg); }
      .stamp-blue { color: var(--info); background: var(--info-bg); }
      .stamp-rust { color: var(--danger); background: var(--danger-bg); }

      .mono-tag { font-family: 'JetBrains Mono', monospace; }
      .entry-tag { background: var(--accent-light); color: var(--accent); padding: 3px 8px; border-radius: 6px; font-size: 10.5px; font-weight: 700; }

      /* =========================
         FORMS & TABLES
         ========================= */
      .ticket-form {
        background: var(--paper-2); border: 1px solid var(--line);
        border-radius: 12px; padding: 22px; margin-bottom: 8px;
        display: flex; flex-direction: column; gap: 14px;
        box-shadow: 0 1px 3px rgba(0,0,0,0.04);
      }
      .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
      .span-2 { grid-column: span 2; }
      .form-divider { display: flex; align-items: center; gap: 10px; margin: 2px 0; }
      .form-divider span { font-size: 10.5px; text-transform: uppercase; letter-spacing: .05em; color: var(--muted); font-weight: 700; white-space: nowrap; }
      .form-divider::after { content: ""; flex: 1; border-top: 1px dashed var(--line); }
      .computed { font-size: 13px; color: var(--muted); padding-top: 2px; }
      .computed b { color: var(--ink); font-family: 'JetBrains Mono', monospace; }
      .form-actions { display: flex; gap: 10px; justify-content: space-between; margin-top: 4px; }

      .rows-table { display: flex; flex-direction: column; gap: 8px; overflow-x: auto; }
      .rows-head, .rows-line { display: grid; gap: 10px; align-items: center; }
      .rows-head.cols-3, .rows-line.cols-3 { grid-template-columns: 1.6fr .9fr .9fr 30px; }
      .rows-head.cols-5, .rows-line.cols-5 { grid-template-columns: 1.5fr .8fr .6fr .9fr .8fr; }
      .rows-head.cols-7, .rows-line.cols-7 { grid-template-columns: .9fr 1.1fr .6fr .6fr .8fr 1fr 30px; }
      .rows-head.cols-8, .rows-line.cols-8 { grid-template-columns: .9fr 1fr .6fr .6fr .7fr .9fr .9fr 30px; }
      .rows-head span { font-size: 10px; text-transform: uppercase; letter-spacing: .05em; color: var(--muted); font-weight: 700; }
      .rows-line input, .rows-line select {
        font-family: 'JetBrains Mono', monospace; font-size: 12.5px;
        padding: 8px 10px; border: 1px solid var(--line); border-radius: 8px;
        background: var(--paper-2); width: 100%; transition: border-color 0.15s;
      }
      .rows-line input:focus, .rows-line select:focus { outline: none; border-color: var(--accent); }
      .static-cell { font-size: 12.5px; padding: 8px 4px; }
      .static-cell.danger { color: var(--danger); }
      .lot-picker { width: 100%; min-width: 0; }

      /* =========================
         LISTS & CARDS
         ========================= */
      .list { display: flex; flex-direction: column; }
      .row { display: flex; justify-content: space-between; align-items: center; padding: 12px 6px; gap: 12px; border-bottom: 1px solid var(--line); }
      .row:last-child { border-bottom: none; }
      .row-title { font-weight: 600; font-size: 13.5px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
      .row-sub { font-size: 11.5px; color: var(--muted); margin-top: 3px; }
      .row-actions { display: flex; align-items: center; gap: 6px; }
      .row-expand { border: none; background: transparent; color: var(--muted); cursor: pointer; padding: 4px; display: flex; align-items: center; border-radius: 4px; }
      .row-expand:hover { background: var(--gray-bg); }

      .entry-card { border: 1px solid var(--line); border-radius: 10px; margin-bottom: 10px; overflow: hidden; background: var(--paper-2); box-shadow: 0 1px 3px rgba(0,0,0,0.03); }
      .entry-card-head { display: flex; justify-content: space-between; align-items: center; gap: 10px; padding: 12px 16px; background: var(--paper-2); cursor: pointer; transition: background 0.1s; }
      .entry-card-head:hover { background: var(--gray-bg); }
      .entry-card-title { display: flex; align-items: center; gap: 8px; font-size: 13px; flex-wrap: wrap; color: var(--ink); }
      .entry-card-body { padding: 4px 16px 10px; background: var(--paper-2); border-top: 1px solid var(--line); }
      .entry-date-edit { display: flex; align-items: center; gap: 6px; }
      .entry-date-edit input { font-family: 'JetBrains Mono', monospace; font-size: 12px; padding: 5px 8px; border: 1px solid var(--line); border-radius: 6px; }

      .edit-row { display: flex; gap: 6px; flex: 1; align-items: center; flex-wrap: wrap; }
      .edit-row.grid-4 { display: grid; grid-template-columns: 1.6fr .8fr 1fr auto auto; gap: 8px; }
      .edit-row.grid-5 { display: grid; grid-template-columns: 1.4fr .6fr .8fr .9fr auto auto; gap: 8px; }
      .edit-row.grid-7 { display: grid; grid-template-columns: .8fr .9fr .6fr .6fr .8fr .9fr .9fr auto auto; gap: 8px; }
      .edit-row.grid-8 { display: grid; grid-template-columns: .8fr .9fr .6fr .6fr .7fr .8fr .8fr .8fr auto auto; gap: 6px; }
      .edit-row input, .edit-row select { font-family: 'JetBrains Mono', monospace; font-size: 12px; padding: 7px 8px; border: 1px solid var(--accent); border-radius: 6px; width: 100%; background: #fff; }

      .detail-panel { background: var(--gray-bg); padding: 14px 18px; font-size: 12px; border-radius: 8px; }
      .detail-title { font-weight: 700; margin-bottom: 6px; text-transform: uppercase; font-size: 10px; letter-spacing: .04em; color: var(--muted); }
      .detail-line { color: var(--ink); padding: 3px 0; }

      .production-block { margin-bottom: 16px; border: 1px solid var(--line); border-radius: 10px; overflow: hidden; background: var(--paper-2); }
      .production-head { display: flex; justify-content: space-between; align-items: center; gap: 10px; background: var(--gray-bg); padding: 12px 14px; flex-wrap: wrap; }

      /* =========================
         LEDGER TABLE
         ========================= */
      .date-block { margin-bottom: 20px; }
      .date-block-head {
        font-family: 'JetBrains Mono', monospace; font-size: 11px;
        text-transform: uppercase; letter-spacing: .05em; font-weight: 600;
        background: var(--ink); color: #fff; padding: 8px 14px;
        border-radius: 8px 8px 0 0; display: flex; justify-content: space-between;
      }
      .date-block-head span { color: rgba(255,255,255,0.6); text-transform: none; letter-spacing: 0; font-weight: 400; }
      .ledger-table { width: 100%; border-collapse: collapse; font-size: 12.5px; background: var(--paper-2); border-radius: 0 0 8px 8px; overflow: hidden; }
      .ledger-table th {
        text-align: left; font-size: 10px; text-transform: uppercase;
        letter-spacing: .04em; color: var(--muted); font-weight: 700;
        padding: 10px 10px; border-bottom: 2px solid var(--line); background: var(--gray-bg);
      }
      .ledger-table td { padding: 10px 10px; border-bottom: 1px solid var(--line); }
      .ledger-table tr:last-child td { border-bottom: none; }
      .ledger-table td.mono, .ledger-table th.mono { font-family: 'JetBrains Mono', monospace; }
      .ledger-table tfoot td { font-weight: 700; border-top: 2px solid var(--ink); border-bottom: none; font-family: 'JetBrains Mono', monospace; background: var(--gray-bg); }

      .report-grand-total {
        display: flex; gap: 24px; align-items: center; justify-content: flex-end;
        flex-wrap: wrap; background: var(--accent); color: #fff;
        border-radius: 10px; padding: 14px 20px; margin-top: 8px;
        font-size: 13px; font-weight: 600;
      }
      .report-grand-total .mono { font-family: 'JetBrains Mono', monospace; font-size: 14px; }
      .filter-bar {
        display: flex; gap: 16px; flex-wrap: wrap; margin-bottom: 18px;
        background: var(--paper-2); border: 1px solid var(--line);
        border-radius: 12px; padding: 16px;
        box-shadow: 0 1px 3px rgba(0,0,0,0.04);
      }

      .empty-row { padding: 24px 4px; color: var(--muted); font-size: 13px; border: 1px dashed var(--line); border-radius: 10px; text-align: center; }
      .locked-panel { display: flex; align-items: flex-start; gap: 10px; padding: 16px; border: 1px solid var(--danger); background: var(--danger-bg); border-radius: 10px; color: var(--danger); font-size: 13px; line-height: 1.5; }

      /* =========================
         DASHBOARD
         ========================= */
      .metric-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 14px; margin-bottom: 24px; }
      .metric-card {
        background: var(--paper-2); border: 1px solid var(--line);
        border-radius: 12px; padding: 18px;
        box-shadow: 0 1px 3px rgba(0,0,0,0.04);
        transition: box-shadow 0.15s;
      }
      .metric-card:hover { box-shadow: 0 4px 12px rgba(0,0,0,0.06); }
      .metric-label { font-size: 10px; color: var(--muted); text-transform: uppercase; margin-bottom: 8px; letter-spacing: .04em; font-weight: 700; }
      .metric-value { font-family: 'JetBrains Mono', monospace; font-size: 22px; font-weight: 700; color: var(--ink); }
      .invite-panel { border: 1px dashed var(--accent); border-radius: 12px; padding: 22px; background: var(--accent-light); }
      .invite-title { font-weight: 700; text-transform: uppercase; font-size: 13px; margin-bottom: 6px; color: var(--accent); }
      .invite-body { font-size: 13px; color: var(--ink); line-height: 1.6; }

      /* =========================
         TEAM
         ========================= */
      .team-row {
        display: flex; align-items: center; gap: 14px; flex-wrap: wrap;
        padding: 14px 16px; border: 1px solid var(--line); border-radius: 10px;
        margin-bottom: 8px; background: var(--paper-2);
      }
      .team-row-name { font-weight: 600; font-size: 13px; min-width: 140px; }
      .team-perm { margin: 0; white-space: nowrap; }

      /* =========================
         AUTH
         ========================= */
      .login-page { display: flex; align-items: center; justify-content: center; min-height: 100vh; width: 100%; padding: 24px; box-sizing: border-box; background: var(--paper); }
      .boot-loader { display: flex; align-items: center; gap: 10px; color: var(--muted); }
      .login-card {
        max-width: 400px; width: 100%; display: flex; flex-direction: column; gap: 16px;
        background: var(--paper-2); border: 1px solid var(--line);
        border-radius: 16px; padding: 36px 32px;
        box-shadow: 0 8px 32px rgba(0,0,0,0.06);
      }
      .login-title { font-weight: 800; font-size: 22px; text-transform: uppercase; margin: 0; color: var(--ink); }
      .login-sub { font-size: 13px; color: var(--muted); margin-bottom: 4px; }
      .login-error { font-size: 12.5px; color: var(--danger); background: var(--danger-bg); border: 1px solid var(--danger); border-radius: 8px; padding: 10px 12px; }
      .login-notice { font-size: 12.5px; color: #047857; background: #D1FAE5; border: 1px solid #047857; border-radius: 8px; padding: 10px 12px; }
      .login-submit { justify-content: center; }
      .login-switch { background: none; border: none; color: var(--accent); font-size: 12.5px; font-weight: 600; cursor: pointer; text-decoration: none; padding: 0; text-align: left; }
      .login-switch:hover { text-decoration: underline; }

      /* =========================
         PRINT & RESPONSIVE
         ========================= */
          /* ===== FIX INPUT / TEXTAREA TEXT VISIBILITY ===== */

input,
textarea,
select {
  color: #23261F !important;
  background-color: #FFFFFF !important;
  -webkit-text-fill-color: #23261F !important;
}

input::placeholder,
textarea::placeholder {
  color: #777777 !important;
  opacity: 0.5;
}

/* All text areas */
textarea {
  font-family: 'IBM Plex Sans', sans-serif;
  font-size: 13px;
  padding: 9px 10px;
  border: 1px solid var(--line);
  border-radius: 6px;
  width: 100%;
  min-height: 100px;
  box-sizing: border-box;
}

textarea:focus {
  outline: 2px solid var(--mill);
  outline-offset: 1px;
}

/* Fix headings */
.app-shell h1,
.app-shell h2,
.app-shell h3,
.app-shell h4,
.app-shell h5,
.app-shell h6,
.section-head h2,
.login-title,
.invite-title,
.app-header h1 {
  color: #23261F !important;
}

/* Search input fix */
.search-input input {
  color: #23261F !important;
  background: transparent !important;
}

/* Existing fields */
.field input,
.field select,
.rows-line input,
.rows-line select,
.edit-row input,
.edit-row select,
.multiselect-btn {
  color: #23261F !important;
  background-color: #FFFFFF !important;
}
         @media print { .no-print { display: none !important; } .app-shell { border: none; } }
      @media (max-width: 640px) {
        .sidebar { position: fixed; z-index: 100; height: 100vh; box-shadow: 4px 0 24px rgba(0,0,0,0.12); }
        .sidebar.collapsed { width: 0; border: none; padding: 0; }
        .rows-head, .rows-line,
        .rows-head.cols-3, .rows-line.cols-3,
        .rows-head.cols-5, .rows-line.cols-5,
        .rows-head.cols-7, .rows-line.cols-7,
        .rows-head.cols-8, .rows-line.cols-8 { grid-template-columns: 1fr; }
        .grid-2 { grid-template-columns: 1fr; }
        .span-2 { grid-column: span 1; }
        .filter-bar { flex-direction: column; }
        .edit-row.grid-4, .edit-row.grid-5, .edit-row.grid-7, .edit-row.grid-8 { grid-template-columns: 1fr; }
      }
    `}</style>
  );
}
