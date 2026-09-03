import React, { useState, useEffect, useMemo } from "react";
import {
  LayoutDashboard, Truck, Boxes, Receipt, Factory, ClipboardList,
  Plus, Trash2, Pencil, Check, X, Printer, Search, ChevronDown, ChevronRight, ArrowUpDown,
  Loader2, Lock, LogOut, Users
} from "lucide-react";

/* =========================================================
   SUPABASE — plain fetch() based client (no npm import allowed
   in this sandbox), talking to PostgREST + GoTrue directly.
   ========================================================= */
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
async function saveRefreshToken(token) { try { await window.storage.set("sbs-refresh-token", token, false); } catch (e) {} }
async function loadRefreshToken() { try { const r = await window.storage.get("sbs-refresh-token", false); return r ? r.value : null; } catch (e) { return null; } }
async function clearRefreshToken() { try { await window.storage.delete("sbs-refresh-token", false); } catch (e) {} }

const uid = () => (window.crypto && crypto.randomUUID) ? crypto.randomUUID() :
  "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => { const r = (Math.random() * 16) | 0; const v = c === "x" ? r : (r & 0x3) | 0x8; return v.toString(16); });

/* =========================================================
   Generic helpers (unchanged from before)
   ========================================================= */
const money = (n) => "Rs " + (Number(n) || 0).toLocaleString("en-PK", { maximumFractionDigits: 0 });
const num = (n, d = 2) => (Number(n) || 0).toLocaleString("en-PK", { minimumFractionDigits: 0, maximumFractionDigits: d });
const todayISO = () => new Date().toISOString().slice(0, 10);
const fmtDate = (d) => new Date(d + "T00:00:00").toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const STATUS_LABEL = { consignment: "In godown", partial: "Partly converted", converted: "Fully converted", purchased: "Purchased" };
const STATUS_TONE = { consignment: "gray", partial: "amber", converted: "blue", purchased: "green" };
const statusLabel = (s) => STATUS_LABEL[s] || s;
const statusTone = (s) => STATUS_TONE[s] || "gray";

const TABS = [
  { id: "dashboard", label: "Overview", icon: LayoutDashboard },
  { id: "masters", label: "Suppliers / brands / sizes", icon: ClipboardList },
  { id: "reels", label: "Reels in", icon: Boxes },
  { id: "purchases", label: "Purchases", icon: Receipt },
  { id: "production", label: "Production reel", icon: Factory },
  { id: "stock", label: "Stock reports", icon: Truck },
];

function Stamp({ children, tone = "gray" }) { return <span className={`stamp stamp-${tone}`}>{children}</span>; }
function Field({ label, children }) { return <label className="field"><span>{label}</span>{children}</label>; }
function EmptyRow({ children }) { return <div className="empty-row">{children}</div>; }
function LockedNote({ text }) { return <div className="locked-panel"><Lock size={15} /><span>{text || "You don't have permission to view this."}</span></div>; }
function groupByDate(arr) {
  const m = {};
  arr.forEach((x) => { (m[x.date] = m[x.date] || []).push(x); });
  return Object.entries(m).sort((a, b) => (a[0] < b[0] ? 1 : -1));
}
function buildLabelMap(arr, idKey, prefix) {
  const map = new Map(); let n = 0;
  arr.forEach((x) => { const k = x[idKey] || x.id; if (!map.has(k)) { n += 1; map.set(k, `${prefix}-${n}`); } });
  return map;
}
function sortWithin(arr, sortState, getters) {
  if (!sortState || sortState.field === "entry") return arr;
  const getter = getters[sortState.field];
  if (!getter) return arr;
  const dir = sortState.dir === "asc" ? 1 : -1;
  return [...arr].sort((a, b) => (getter(a) - getter(b)) * dir);
}
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
        <span>{label}</span><ChevronDown size={13} />
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
function ModuleTabs({ sub, setSub, tabs }) {
  return (
    <div className="subtabbar no-print">
      {tabs.map((t) => <button key={t.id} className={"subtab" + (sub === t.id ? " active" : "")} onClick={() => setSub(t.id)}>{t.label}</button>)}
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
    <>
      <input list={listId} value={query} onChange={handleChange} placeholder={placeholder || "Search lot no / brand / gsm…"} />
      <datalist id={listId}>{lots.map((l) => <option key={l.id} value={labelFn(l)} />)}</datalist>
    </>
  );
}

/* =========================================================
   AUTH: login screen + top-level gate
   ========================================================= */
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
      } else {
        const data = await authSignUp(email.trim(), password, fullName.trim());
        if (data && data.access_token) {
          setAccessToken(data.access_token);
          await saveRefreshToken(data.refresh_token);
          onAuthed({ accessToken: data.access_token, refreshToken: data.refresh_token, user: data.user });
        } else {
          setNotice("Account created. If email confirmation is turned on, check your inbox first, then sign in below.");
          setMode("signin");
        }
      }
    } catch (e) {
      setErr(e.message || "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="app-shell login-shell">
      <Style />
      <div className="login-card">
        <div className="eyebrow">Bleach board reel &amp; production register</div>
        <h1 className="login-title">Sale Base Stock</h1>
        <div className="login-sub">{mode === "signin" ? "Sign in to continue" : "Create an account"}</div>
        {mode === "signup" && <Field label="Full name (optional)"><input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Shown to the admin" /></Field>}
        <Field label="Email"><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" /></Field>
        <Field label="Password"><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" /></Field>
        {err && <div className="login-error">{err}</div>}
        {notice && <div className="login-notice">{notice}</div>}
        <button className="btn primary login-submit" onClick={submit} disabled={busy || !email || !password}>
          {busy ? "Please wait…" : mode === "signin" ? "Sign in" : "Create account"}
        </button>
        <button className="login-switch" onClick={() => { setMode(mode === "signin" ? "signup" : "signin"); setErr(""); setNotice(""); }}>
          {mode === "signin" ? "New here? Create an account" : "Already have an account? Sign in"}
        </button>
        <div className="login-hint">New accounts start as an employee with limited access — an admin can grant more from the Team tab. The very first account has to be promoted to admin once via SQL (see the schema notes you were given).</div>
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

  if (booting) return <div className="app-shell loading-shell"><Style /><Loader2 className="spin" size={22} /><span>Checking session...</span></div>;
  if (!session) return <LoginScreen onAuthed={setSession} />;
  return <AuthedApp session={session} onSignOut={handleSignOut} />;
}

/* =========================================================
   AUTHED APP — everything that used to be the default export
   ========================================================= */
function AuthedApp({ session, onSignOut }) {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [profile, setProfile] = useState(null);
  const [tab, setTab] = useState("dashboard");
  const [suppliers, setSuppliers] = useState([]);
  const [brands, setBrands] = useState([]);
  const [sizes, setSizes] = useState([]);
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
        const [su, br, sz, re, pu, pr, pi] = await Promise.all([
          sbList("suppliers"), sbList("brands"), sbList("sizes"), sbList("reels"),
          sbList("purchases"), sbList("productions"), sbList("production_items"),
        ]);
        setSuppliers(su); setBrands(br); setSizes(sz); setReels(re); setPurchases(pu);
        setProductions(pr); setProductionItems(pi);
      } catch (e) {
        setLoadError(e.message || "Failed to load data.");
      } finally {
        setLoading(false);
      }
    })();
  }, [session]);

  const persist = {
    suppliers: (v) => { const p = suppliers; setSuppliers(v); syncTable("suppliers", p, v).catch((e) => alert("Save failed: " + e.message)); },
    brands: (v) => { const p = brands; setBrands(v); syncTable("brands", p, v).catch((e) => alert("Save failed: " + e.message)); },
    sizes: (v) => { const p = sizes; setSizes(v); syncTable("sizes", p, v).catch((e) => alert("Save failed: " + e.message)); },
    reels: (v) => { const p = reels; setReels(v); syncTable("reels", p, v).catch((e) => alert("Save failed: " + e.message)); },
    purchases: (v) => { const p = purchases; setPurchases(v); syncTable("purchases", p, v).catch((e) => alert("Save failed: " + e.message)); },
    productions: (v) => { const p = productions; setProductions(v); syncTable("productions", p, v).catch((e) => alert("Save failed: " + e.message)); },
    productionItems: (v) => { const p = productionItems; setProductionItems(v); syncTable("production_items", p, v).catch((e) => alert("Save failed: " + e.message)); },
  };

  const supplierName = (id) => suppliers.find((s) => s.id === id)?.name || "—";
  const brandName = (id) => brands.find((b) => b.id === id)?.name || "—";
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

  const lotInfo = useMemo(() => {
    const map = {};
    reels.forEach((lot) => {
      const purchase = purchases.find((p) => p.lotId === lot.id);
      const prods = productions.filter((p) => p.lotId === lot.id);
      const closedOut = prods.some((p) => p.closeOut);
      const usedKg = usedWeightForLot(lot.id);
      let status, remaining;
      if (purchase) { status = "purchased"; remaining = 0; }
      else if (closedOut) { status = "converted"; remaining = 0; }
      else {
        remaining = Math.max(0, Number(lot.weight) - usedKg);
        status = usedKg === 0 ? "consignment" : remaining > 0 ? "partial" : "converted";
      }
      map[lot.id] = { status, usedKg, remaining, purchase, productions: prods, closedOut, available: status !== "purchased" && remaining > 0.0001 };
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

  const reelLabelMap = useMemo(() => buildLabelMap(reels, "batchId", "RI"), [reels]);
  const purchaseLabelMap = useMemo(() => buildLabelMap(purchases, "batchId", "PR"), [purchases]);
  const productionLabelMap = useMemo(() => buildLabelMap(productions, "id", "PD"), [productions]);

  const totals = useMemo(() => {
    const godownWeight = reels.filter((r) => lotInfo[r.id]?.status !== "purchased").reduce((a, r) => a + (lotInfo[r.id]?.remaining || 0), 0);
    const purchaseValue = purchases.reduce((a, p) => a + Number(p.weight) * Number(p.rate), 0);
    const packetsProduced = productionItems.reduce((a, it) => a + Number(it.packetsProduced), 0);
    return { godownWeight, purchaseValue, packetsProduced };
  }, [reels, lotInfo, purchases, productionItems]);

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
    suppliers, brands, sizes, reels, purchases, productions, productionItems, persist,
    supplierName, brandName, packetWeightKg, sizeLabel, reelDesc, avgGramForEntry, itemsFor, itemsWeightFor,
    lotInfo, totals, usedWeightForLot, remainingForLot, reelLabelMap, purchaseLabelMap, productionLabelMap,
    profile, can, isAdmin,
  };

  const tabs = isAdmin ? [...TABS, { id: "team", label: "Team", icon: Users }] : TABS;

  return (
    <div className="app-shell">
      <Style />
      <header className="app-header">
        <div><div className="eyebrow">Bleach board reel &amp; production register</div><h1>Sale Base Stock</h1></div>
        <div className="header-note no-print header-user">
          <span>{session.user.email} · {profile.role}</span>
          <button className="btn header-signout" onClick={onSignOut}><LogOut size={12} /> Sign out</button>
        </div>
      </header>
      <nav className="tabbar no-print">
        {tabs.map((t) => {
          const Icon = t.icon;
          return <button key={t.id} className={"tab" + (tab === t.id ? " active" : "")} onClick={() => setTab(t.id)}><Icon size={16} />{t.label}</button>;
        })}
      </nav>
      <main className="app-main">
        {tab === "dashboard" && <Dashboard ctx={ctx} />}
        {tab === "masters" && <MastersTab ctx={ctx} />}
        {tab === "reels" && <ReelsModule ctx={ctx} />}
        {tab === "purchases" && <PurchasesModule ctx={ctx} />}
        {tab === "production" && <ProductionModule ctx={ctx} />}
        {tab === "stock" && <StockModule ctx={ctx} />}
        {tab === "team" && isAdmin && <TeamTab ctx={ctx} />}
      </main>
    </div>
  );
}

/* ---------------- Team (admin only) ---------------- */
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
      <div className="computed" style={{ marginBottom: 14 }}>Names are whatever was given at signup — usually their email unless they entered a name. Reports access is required for almost everything else to work (you need to see a reel to purchase or convert it), so think twice before turning it off for someone who also has Add/Edit/Delete.</div>
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

/* ---------------- Dashboard ---------------- */
function Dashboard({ ctx }) {
  if (!ctx.can("canViewReports")) return <LockedNote text="You don't have report-viewing access yet — ask an admin to grant it in Team." />;
  const { totals, reels, suppliers, sizes } = ctx;
  const cards = [
    { label: "Reel lots on record", value: reels.length },
    { label: "In-godown weight (unpurchased)", value: num(totals.godownWeight) + " kg" },
    { label: "Total purchased value", value: money(totals.purchaseValue) },
    { label: "Packets produced", value: num(totals.packetsProduced, 0) },
    { label: "Suppliers / sizes on file", value: `${suppliers.length} / ${sizes.length}` },
  ];
  return (
    <div>
      <div className="metric-grid">{cards.map((c) => (
        <div className="metric-card" key={c.label}><div className="metric-label">{c.label}</div><div className="metric-value">{c.value}</div></div>
      ))}</div>
      {reels.length === 0 && (
        <div className="invite-panel">
          <div className="invite-title">Start the register</div>
          <div className="invite-body">Add a supplier and brand in Suppliers / brands / sizes, then log the first reels received under Reels in → Entries.</div>
        </div>
      )}
    </div>
  );
}

/* ---------------- Masters ---------------- */
function MastersTab({ ctx }) {
  const [sub, setSub] = useState("suppliers");
  const canManage = ctx.can("canManageMasters");
  const isAdmin = ctx.isAdmin;
  return (
    <div>
      <div className="subtabbar no-print">
        {["suppliers", "brands", "sizes"].map((s) => (
          <button key={s} className={"subtab" + (sub === s ? " active" : "")} onClick={() => setSub(s)}>{s === "suppliers" ? "Suppliers" : s === "brands" ? "Brands" : "Packet sizes"}</button>
        ))}
      </div>
      {sub === "suppliers" && <NameListEditor title="Suppliers" items={ctx.suppliers} setItems={ctx.persist.suppliers}
        withContact blockedIds={ctx.reels.map((r) => r.supplierId)} placeholder="e.g. Punjab Board Mills" canManage={canManage} isAdmin={isAdmin} />}
      {sub === "brands" && <NameListEditor title="Brands" items={ctx.brands} setItems={ctx.persist.brands}
        blockedIds={ctx.reels.map((r) => r.brandId)} placeholder="e.g. Ningbo Fold" canManage={canManage} isAdmin={isAdmin} />}
      {sub === "sizes" && <SizesEditor ctx={ctx} canManage={canManage} isAdmin={isAdmin} />}
    </div>
  );
}

function NameListEditor({ title, items, setItems, withContact, blockedIds, placeholder, canManage, isAdmin }) {
  const [name, setName] = useState(""); const [contact, setContact] = useState("");
  const [editId, setEditId] = useState(null); const [editName, setEditName] = useState(""); const [editContact, setEditContact] = useState("");
  const add = () => { if (!name.trim()) return; setItems([...items, { id: uid(), name: name.trim(), contact: contact.trim() }]); setName(""); setContact(""); };
  const startEdit = (it) => { setEditId(it.id); setEditName(it.name); setEditContact(it.contact || ""); };
  const saveEdit = () => { if (!editName.trim()) return; setItems(items.map((it) => it.id === editId ? { ...it, name: editName.trim(), contact: editContact.trim() } : it)); setEditId(null); };
  const remove = (id) => { if (blockedIds.includes(id)) return; setItems(items.filter((it) => it.id !== id)); };
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
  const remove = (id) => { if (inUse(id)) return; persist.sizes(sizes.filter((s) => s.id !== id)); };

  if (brands.length === 0) return <div><SectionHead title="Packet sizes" /><EmptyRow>Add a brand first — sizes are tied to a brand.</EmptyRow></div>;

  return (
    <div>
      <SectionHead title="Packet sizes" />
      {canManage && (
        <div className="ticket-form grid-2">
          <Field label="Width"><input type="number" value={f.width} onChange={set("width")} /></Field>
          <Field label="Length"><input type="number" value={f.length} onChange={set("length")} /></Field>
          <Field label="Gram (GSM)"><input type="number" value={f.gsm} onChange={set("gsm")} /></Field>
          <Field label="Brand"><select value={f.brandId} onChange={set("brandId")}>{brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>
          <div className="computed span-2">Packet weight: <b>{num(wt, 4)} kg</b> — width × length × gsm ÷ 15500</div>
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
                  {isAdmin && <button className="icon-btn" onClick={() => remove(sz.id)} disabled={inUse(sz.id)} title={inUse(sz.id) ? "In use — can't remove" : "Remove"}><Trash2 size={15} /></button>}
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/* =========================================================
   REELS IN MODULE
   ========================================================= */
function ReelsModule({ ctx }) {
  const [sub, setSub] = useState("entries");
  return (
    <div>
      <ModuleTabs sub={sub} setSub={setSub} tabs={[{ id: "entries", label: "Entries" }, { id: "report", label: "Report" }, { id: "edit", label: "Edit" }]} />
      {sub === "entries" && <ReelsEntriesTab ctx={ctx} />}
      {sub === "report" && <ReelsReportView ctx={ctx} />}
      {sub === "edit" && <ReelsEditTab ctx={ctx} />}
    </div>
  );
}

function ReelsAddForm({ ctx }) {
  const { suppliers, brands, reels, persist, reelLabelMap } = ctx;
  const [supplierId, setSupplierId] = useState(suppliers[0]?.id || "");
  const [date, setDate] = useState(todayISO());
  const blankRow = () => ({ key: uid(), lotNo: "", brandId: brands[0]?.id || "", gsm: "", width: "", weight: "", detail: "" });
  const [rows, setRows] = useState([blankRow()]);
  const [lastSaved, setLastSaved] = useState(null);

  useEffect(() => { if (!supplierId && suppliers[0]) setSupplierId(suppliers[0].id); }, [suppliers]);

  const updateRow = (key, patch) => setRows(rows.map((r) => r.key === key ? { ...r, ...patch } : r));
  const addRow = () => setRows([...rows, blankRow()]);
  const removeRow = (key) => setRows(rows.length > 1 ? rows.filter((r) => r.key !== key) : rows);

  const saveAll = () => {
    if (!supplierId || !date) return;
    const valid = rows.filter((r) => r.lotNo.trim() && r.brandId && r.gsm && r.width && r.weight);
    if (valid.length === 0) return;
    const existingLots = new Set(reels.map((r) => r.lotNo));
    const batchId = uid();
    const newOnes = valid.filter((r) => !existingLots.has(r.lotNo.trim())).map((r) => ({
      id: uid(), batchId, lotNo: r.lotNo.trim(), supplierId, brandId: r.brandId, gsm: Number(r.gsm), width: Number(r.width),
      weight: Number(r.weight), detail: r.detail.trim(), date,
    }));
    if (newOnes.length === 0) return;
    persist.reels([...reels, ...newOnes]);
    setLastSaved({ count: newOnes.length, batchId });
    setRows([blankRow()]);
  };

  const disabled = suppliers.length === 0 || brands.length === 0;

  return (
    <div>
      {disabled && <EmptyRow>Add a supplier and at least one brand first, in Suppliers / brands / sizes.</EmptyRow>}
      {!disabled && (
        <div className="ticket-form" style={{ maxWidth: 820 }}>
          <div className="grid-2">
            <Field label="Supplier"><select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
            <Field label="Date received"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          </div>
          <FormDivider label="Reels in this entry" />
          <div className="rows-table">
            <div className="rows-head cols-7"><span>Lot no</span><span>Brand</span><span>Gram</span><span>Width</span><span>Weight (kg)</span><span>Detail / ref</span><span /></div>
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
            <button className="btn primary" onClick={saveAll}>Save all reels for this date</button>
          </div>
          {lastSaved && <div className="computed">Saved {lastSaved.count} reel(s) under entry <b>{reelLabelMap.get(lastSaved.batchId)}</b>. See the list below.</div>}
        </div>
      )}
    </div>
  );
}

function ReelsEntriesTab({ ctx }) {
  const { reels, persist, reelLabelMap, supplierName, reelDesc, lotInfo } = ctx;
  const [expanded, setExpanded] = useState(null);
  const canAdd = ctx.can("canAddEntries");
  const canDelete = ctx.can("canDeleteEntries");
  const canEdit = ctx.can("canEditEntries");
  const [editDateBatch, setEditDateBatch] = useState(null);
  const [dateDraft, setDateDraft] = useState("");

  const batches = useMemo(() => {
    const map = new Map();
    reels.forEach((lot) => { if (!map.has(lot.batchId)) map.set(lot.batchId, []); map.get(lot.batchId).push(lot); });
    return [...map.entries()].map(([batchId, lots]) => ({
      batchId, label: reelLabelMap.get(batchId), date: lots[0].date, supplierId: lots[0].supplierId, lots,
      totalWeight: lots.reduce((a, l) => a + Number(l.weight), 0),
    })).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  }, [reels, reelLabelMap]);

  const deleteEntry = (batchId) => {
    const lots = reels.filter((r) => r.batchId === batchId);
    if (lots.some((l) => lotInfo[l.id].status !== "consignment")) return;
    persist.reels(reels.filter((r) => r.batchId !== batchId));
  };
  const startEditDate = (b) => { setEditDateBatch(b.batchId); setDateDraft(b.date); };
  const saveEntryDate = (batchId) => {
    if (!dateDraft) return;
    persist.reels(reels.map((r) => r.batchId === batchId ? { ...r, date: dateDraft } : r));
    setEditDateBatch(null);
  };

  return (
    <div>
      <SectionHead title="Add reels received" />
      {canAdd ? <ReelsAddForm ctx={ctx} /> : <LockedNote text="You don't have permission to add reel entries." />}
      <h3 className="sub-heading">All entries</h3>
      {batches.length === 0 && <EmptyRow>No reels logged yet.</EmptyRow>}
      {batches.map((b) => {
        const blocked = b.lots.some((l) => lotInfo[l.id].status !== "consignment");
        const isOpen = expanded === b.batchId;
        const isEditingDate = editDateBatch === b.batchId;
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
                  <span>{fmtDate(b.date)} · {supplierName(b.supplierId)} · {b.lots.length} reel{b.lots.length > 1 ? "s" : ""} · {num(b.totalWeight)} kg</span>
                )}
              </div>
              {!isEditingDate && (
                <div className="row-actions">
                  {canEdit && <button className="icon-btn" onClick={(e) => { e.stopPropagation(); startEditDate(b); }} title="Edit entry date"><Pencil size={15} /></button>}
                  {canDelete && (
                    <button className="icon-btn" onClick={(e) => { e.stopPropagation(); deleteEntry(b.batchId); }}
                      disabled={blocked} title={blocked ? "Some reels in this entry are already purchased/converted" : "Delete entire entry"}>
                      <Trash2 size={15} />
                    </button>
                  )}
                </div>
              )}
            </div>
            {isOpen && (
              <div className="entry-card-body">
                {b.lots.map((lot) => {
                  const info = lotInfo[lot.id];
                  return (
                    <div className="row" key={lot.id}>
                      <div>
                        <div className="row-title">{reelDesc(lot)} <span className="mono-tag">Lot {lot.lotNo}</span></div>
                        <div className="row-sub">width {lot.width} · {num(lot.weight)} kg · remaining {num(info.remaining)} kg{lot.detail ? " · " + lot.detail : ""}</div>
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

function ReelsReportView({ ctx }) {
  if (!ctx.can("canViewReports")) return <LockedNote text="You don't have permission to view reports." />;
  const { reels, suppliers, supplierName, reelDesc, lotInfo, reelLabelMap, purchaseLabelMap, productionLabelMap, sizeLabel, packetWeightKg, sizes, itemsFor } = ctx;
  const [supplierFilter, setSupplierFilter] = useState([]);
  const [statusFilter, setStatusFilter] = useState([]);
  const [q, setQ] = useState("");
  const [from, setFrom] = useState(""); const [to, setTo] = useState("");
  const [sort, setSort] = useState({ field: "entry", dir: "desc" });
  const [expandedId, setExpandedId] = useState(null);
  const statusOptions = [{ value: "consignment", label: "In godown" }, { value: "partial", label: "Partly converted" }, { value: "converted", label: "Fully converted" }, { value: "purchased", label: "Purchased" }];
  const supplierOptions = suppliers.map((s) => ({ value: s.id, label: s.name }));

  const filtered = reels.filter((lot) => {
    if (supplierFilter.length && !supplierFilter.includes(lot.supplierId)) return false;
    if (statusFilter.length && !statusFilter.includes(lotInfo[lot.id].status)) return false;
    if (from && lot.date < from) return false;
    if (to && lot.date > to) return false;
    if (q.trim()) {
      const query = q.trim().toLowerCase();
      const label = (reelLabelMap.get(lot.batchId) || "").toLowerCase();
      const hay = `${label} ${lot.lotNo} ${reelDesc(lot).toLowerCase()}`;
      if (!hay.includes(query)) return false;
    }
    return true;
  });
  const groups = groupByDate(filtered);
  const getters = { weight: (l) => Number(l.weight), remaining: (l) => lotInfo[l.id].remaining };

  const doPrint = () => {
    let html = "";
    groups.forEach(([d, lots]) => {
      const sorted = sortWithin(lots, sort, getters);
      html += `<h2>${esc(fmtDate(d))} — ${lots.length} reel(s)</h2><table><thead><tr><th>Entry</th><th>Item description</th><th>Lot no</th><th>Width</th><th>Supplier</th><th>Status</th><th>Received</th><th>Remaining</th></tr></thead><tbody>`;
      sorted.forEach((lot) => {
        const info = lotInfo[lot.id];
        html += `<tr><td class="tag">${esc(reelLabelMap.get(lot.batchId))}</td><td>${esc(reelDesc(lot))}</td><td class="tag">${esc(lot.lotNo)}</td><td>${esc(lot.width)}</td><td>${esc(supplierName(lot.supplierId))}</td><td>${esc(statusLabel(info.status))}</td><td>${num(lot.weight)} kg</td><td>${num(info.remaining)} kg</td></tr>`;
      });
      html += `</tbody></table>`;
    });
    printHTML("Reels in report", html || "<p>No entries.</p>");
  };

  return (
    <div>
      <SectionHead title="Reels in — full report by date" onPrint={doPrint} />
      <div className="filter-bar no-print">
        <Field label="Search (entry id / lot no / description)"><div className="search-input"><Search size={13} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. RI-2 or 9938" /></div></Field>
        <Field label="Supplier"><MultiSelect options={supplierOptions} values={supplierFilter} onChange={setSupplierFilter} /></Field>
        <Field label="Status"><MultiSelect options={statusOptions} values={statusFilter} onChange={setStatusFilter} /></Field>
        <Field label="From"><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="To"><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        <SortControl value={sort} onChange={setSort} options={[{ value: "entry", label: "Entry order" }, { value: "weight", label: "Weight received" }, { value: "remaining", label: "Remaining weight" }]} />
      </div>
      {groups.length === 0 && <EmptyRow>No reels match this filter.</EmptyRow>}
      {groups.map(([d, lots]) => {
        const sorted = sortWithin(lots, sort, getters);
        return (
          <div key={d} className="date-block">
            <div className="date-block-head">{fmtDate(d)} <span>{lots.length} reel{lots.length > 1 ? "s" : ""}</span></div>
            <table className="ledger-table">
              <thead><tr><th /><th>Entry</th><th>Item description</th><th>Lot no</th><th>Width</th><th>Supplier</th><th>Status</th><th>Received</th><th>Remaining</th></tr></thead>
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
                        <td>{supplierName(lot.supplierId)}</td><td><Stamp tone={statusTone(info.status)}>{statusLabel(info.status)}</Stamp></td>
                        <td className="mono">{num(lot.weight)}</td><td className="mono">{num(info.remaining)}</td>
                      </tr>
                      {isExpanded && (
                        <tr className="no-print"><td /><td colSpan={8}>
                          <div className="detail-panel">
                            <div className="detail-title">Lifecycle for lot {lot.lotNo}</div>
                            {info.productions.length > 0 && info.productions.map((p) => (
                              <div key={p.id}>
                                <div className="detail-line">Production {productionLabelMap.get(p.id)}{p.wastageKg ? ` — wastage ${num(p.wastageKg)} kg` : ""}, on {fmtDate(p.date)}:</div>
                                {itemsFor(p.id).map((it) => {
                                  const sz = sizes.find((s) => s.id === it.sizeId);
                                  const w = sz ? Number(it.packetsProduced) * packetWeightKg(sz) : 0;
                                  return <div className="detail-line" key={it.id} style={{ paddingLeft: 14 }}>— {num(it.packetsProduced, 0)} × {sz ? sizeLabel(sz) : "removed size"} = {num(w)} kg</div>;
                                })}
                              </div>
                            ))}
                            {info.purchase && <div className="detail-line">Purchase {purchaseLabelMap.get(info.purchase.batchId)}: {num(info.purchase.weight)} kg at {num(info.purchase.rate)}/kg = {money(Number(info.purchase.weight) * Number(info.purchase.rate))}, on {fmtDate(info.purchase.date)}</div>}
                            {info.status === "consignment" && <div className="detail-line">Still sitting in godown, not yet purchased or produced.</div>}
                            {info.status === "partial" && <div className="detail-line">{num(info.remaining)} kg still available — can be purchased or converted further.</div>}
                          </div>
                        </td></tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}

function ReelsEditTab({ ctx }) {
  const canEdit = ctx.can("canEditEntries"); const canDelete = ctx.can("canDeleteEntries");
  if (!canEdit && !canDelete) return <LockedNote text="You don't have permission to edit or delete reel entries." />;
  const { reels, brands, persist, supplierName, reelDesc, lotInfo, reelLabelMap } = ctx;
  const [q, setQ] = useState("");
  const [editId, setEditId] = useState(null); const [ef, setEf] = useState(null);

  const startEdit = (lot) => { setEditId(lot.id); setEf({ lotNo: lot.lotNo, supplierId: lot.supplierId, brandId: lot.brandId, gsm: lot.gsm, width: lot.width || "", weight: lot.weight, detail: lot.detail || "", date: lot.date }); };
  const saveEdit = () => {
    persist.reels(reels.map((r) => r.id === editId ? { ...r, lotNo: ef.lotNo.trim(), supplierId: ef.supplierId, brandId: ef.brandId, gsm: Number(ef.gsm), width: Number(ef.width), weight: Number(ef.weight), detail: ef.detail.trim(), date: ef.date } : r));
    setEditId(null);
  };
  const removeLot = (id) => { if (lotInfo[id]?.status !== "consignment") return; persist.reels(reels.filter((r) => r.id !== id)); };

  const filtered = reels.filter((lot) => {
    if (!q.trim()) return true;
    const query = q.trim().toLowerCase();
    const label = (reelLabelMap.get(lot.batchId) || "").toLowerCase();
    return `${label} ${lot.lotNo} ${reelDesc(lot).toLowerCase()}`.includes(query);
  });
  const groups = groupByDate(filtered);

  return (
    <div>
      <SectionHead title="Edit individual reels" />
      <div className="filter-bar no-print">
        <Field label="Search (entry id / lot no / description)"><div className="search-input"><Search size={13} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. RI-2 or 9938" /></div></Field>
      </div>
      {groups.length === 0 && <EmptyRow>Nothing to edit.</EmptyRow>}
      {groups.map(([d, lots]) => (
        <div key={d} className="date-block">
          <div className="date-block-head">{fmtDate(d)}</div>
          <div className="list">
            {lots.map((lot) => {
              const info = lotInfo[lot.id];
              return (
                <div className="row" key={lot.id}>
                  {editId === lot.id ? (
                    <div className="edit-row grid-7">
                      <input value={ef.lotNo} onChange={(e) => setEf({ ...ef, lotNo: e.target.value })} />
                      <select value={ef.brandId} onChange={(e) => setEf({ ...ef, brandId: e.target.value })}>{brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
                      <input type="number" value={ef.gsm} onChange={(e) => setEf({ ...ef, gsm: e.target.value })} />
                      <input type="number" value={ef.width} onChange={(e) => setEf({ ...ef, width: e.target.value })} />
                      <input type="number" value={ef.weight} onChange={(e) => setEf({ ...ef, weight: e.target.value })} />
                      <input value={ef.detail} onChange={(e) => setEf({ ...ef, detail: e.target.value })} />
                      <input type="date" value={ef.date} onChange={(e) => setEf({ ...ef, date: e.target.value })} />
                      <button className="icon-btn" onClick={saveEdit}><Check size={15} /></button>
                      <button className="icon-btn" onClick={() => setEditId(null)}><X size={15} /></button>
                    </div>
                  ) : (
                    <>
                      <div>
                        <div className="row-title">{reelDesc(lot)} <span className="mono-tag entry-tag">{reelLabelMap.get(lot.batchId)}</span> <span className="mono-tag">Lot {lot.lotNo}</span></div>
                        <div className="row-sub">{supplierName(lot.supplierId)} · width {lot.width} · {num(lot.weight)} kg{lot.detail ? " · " + lot.detail : ""}</div>
                      </div>
                      <div className="row-actions">
                        <Stamp tone={statusTone(info.status)}>{statusLabel(info.status)}</Stamp>
                        {canEdit && <button className="icon-btn" onClick={() => startEdit(lot)}><Pencil size={15} /></button>}
                        {canDelete && <button className="icon-btn" onClick={() => removeLot(lot.id)} disabled={info.status !== "consignment"} title={info.status !== "consignment" ? "Already purchased/converted" : "Remove"}><Trash2 size={15} /></button>}
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

/* =========================================================
   PURCHASES MODULE
   ========================================================= */
function PurchasesModule({ ctx }) {
  const [sub, setSub] = useState("entries");
  return (
    <div>
      <ModuleTabs sub={sub} setSub={setSub} tabs={[{ id: "entries", label: "Entries" }, { id: "report", label: "Report" }, { id: "edit", label: "Edit" }]} />
      {sub === "entries" && <PurchasesEntriesTab ctx={ctx} />}
      {sub === "report" && <PurchaseReportView ctx={ctx} />}
      {sub === "edit" && <PurchaseEditTab ctx={ctx} />}
    </div>
  );
}

function PurchasesAddForm({ ctx }) {
  const { reels, purchases, persist, reelDesc, lotInfo, purchaseLabelMap } = ctx;
  const [date, setDate] = useState(todayISO());
  const blankRow = () => ({ key: uid(), lotId: "", rate: "", purchasedBy: "" });
  const [rows, setRows] = useState([blankRow()]);
  const [lastSaved, setLastSaved] = useState(null);
  const eligible = reels.filter((r) => lotInfo[r.id]?.available);
  const labelFn = (l) => `${reelDesc(l)} · Lot ${l.lotNo} · ${num(lotInfo[l.id].remaining)} kg available`;

  const updateRow = (key, patch) => setRows(rows.map((r) => r.key === key ? { ...r, ...patch } : r));
  const addRow = () => setRows([...rows, blankRow()]);
  const removeRow = (key) => setRows(rows.length > 1 ? rows.filter((r) => r.key !== key) : rows);

  const saveAll = () => {
    const valid = rows.filter((r) => r.lotId && r.rate && lotInfo[r.lotId]?.available);
    if (valid.length === 0 || !date) return;
    const batchId = uid();
    const newOnes = valid.map((r) => ({ id: uid(), batchId, lotId: r.lotId, weight: lotInfo[r.lotId].remaining, rate: Number(r.rate), purchasedBy: r.purchasedBy.trim(), date }));
    persist.purchases([...purchases, ...newOnes]);
    setLastSaved({ count: newOnes.length, batchId });
    setRows([blankRow()]);
  };

  return (
    <div>
      {eligible.length === 0 && rows.every((r) => !r.lotId) && <EmptyRow>No reels available to purchase right now (nothing in godown or partly converted).</EmptyRow>}
      <div className="ticket-form" style={{ maxWidth: 900 }}>
        <Field label="Date"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <FormDivider label="Purchase lines for this entry" />
        <div className="rows-table">
          <div className="rows-head cols-5"><span>Reel (search lot no / brand)</span><span>Weight available</span><span>Rate / kg</span><span>Purchased by</span><span>Amount</span></div>
          {rows.map((r) => {
            const lot = reels.find((x) => x.id === r.lotId);
            const weight = lot ? lotInfo[lot.id].remaining : 0;
            const amt = weight * Number(r.rate || 0);
            return (
              <div className="rows-line cols-5" key={r.key}>
                <LotPicker rowKey={r.key} lots={eligible} value={r.lotId} onChange={(id) => updateRow(r.key, { lotId: id })} labelFn={labelFn} />
                <span className="static-cell">{lot ? num(weight) + " kg" : "—"}</span>
                <input type="number" value={r.rate} onChange={(e) => updateRow(r.key, { rate: e.target.value })} placeholder="276" />
                <input value={r.purchasedBy} onChange={(e) => updateRow(r.key, { purchasedBy: e.target.value })} placeholder="e.g. Ahmed" />
                <span className="static-cell mono-tag">{money(amt)}</span>
              </div>
            );
          })}
        </div>
        <div className="form-actions">
          <button className="btn" onClick={addRow}><Plus size={14} /> Add row</button>
          <button className="btn primary" onClick={saveAll}>Save purchases for this date</button>
        </div>
        {lastSaved && <div className="computed">Saved {lastSaved.count} purchase line(s) under entry <b>{purchaseLabelMap.get(lastSaved.batchId)}</b>. See the list below.</div>}
      </div>
    </div>
  );
}

function PurchasesEntriesTab({ ctx }) {
  const { reels, purchases, persist, purchaseLabelMap, reelDesc } = ctx;
  const [expanded, setExpanded] = useState(null);
  const canAdd = ctx.can("canAddEntries");
  const canDelete = ctx.can("canDeleteEntries");
  const canEdit = ctx.can("canEditEntries");
  const [editDateBatch, setEditDateBatch] = useState(null);
  const [dateDraft, setDateDraft] = useState("");

  const batches = useMemo(() => {
    const map = new Map();
    purchases.forEach((p) => { if (!map.has(p.batchId)) map.set(p.batchId, []); map.get(p.batchId).push(p); });
    return [...map.entries()].map(([batchId, lines]) => ({
      batchId, label: purchaseLabelMap.get(batchId), date: lines[0].date, lines,
      totalWeight: lines.reduce((a, l) => a + Number(l.weight), 0),
      totalAmount: lines.reduce((a, l) => a + Number(l.weight) * Number(l.rate), 0),
    })).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  }, [purchases, purchaseLabelMap]);

  const deleteEntry = (batchId) => persist.purchases(purchases.filter((p) => p.batchId !== batchId));
  const startEditDate = (b) => { setEditDateBatch(b.batchId); setDateDraft(b.date); };
  const saveEntryDate = (batchId) => {
    if (!dateDraft) return;
    persist.purchases(purchases.map((p) => p.batchId === batchId ? { ...p, date: dateDraft } : p));
    setEditDateBatch(null);
  };

  return (
    <div>
      <SectionHead title="Record purchases" />
      {canAdd ? <PurchasesAddForm ctx={ctx} /> : <LockedNote text="You don't have permission to add purchase entries." />}
      <h3 className="sub-heading">All entries</h3>
      {batches.length === 0 && <EmptyRow>No purchases logged yet.</EmptyRow>}
      {batches.map((b) => {
        const isOpen = expanded === b.batchId;
        const isEditingDate = editDateBatch === b.batchId;
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
                  <span>{fmtDate(b.date)} · {b.lines.length} line{b.lines.length > 1 ? "s" : ""} · {num(b.totalWeight)} kg · {money(b.totalAmount)}</span>
                )}
              </div>
              {!isEditingDate && (
                <div className="row-actions">
                  {canEdit && <button className="icon-btn" onClick={(e) => { e.stopPropagation(); startEditDate(b); }} title="Edit entry date"><Pencil size={15} /></button>}
                  {canDelete && <button className="icon-btn" onClick={(e) => { e.stopPropagation(); deleteEntry(b.batchId); }} title="Delete entire entry"><Trash2 size={15} /></button>}
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
                      <div className="row-sub">{num(p.weight)} kg at {num(p.rate)}/kg = {money(Number(p.weight) * Number(p.rate))}{p.purchasedBy ? ` · purchased by ${p.purchasedBy}` : ""}</div>
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
  if (!ctx.can("canViewReports")) return <LockedNote text="You don't have permission to view reports." />;
  const { reels, purchases, reelDesc, purchaseLabelMap } = ctx;
  const [q, setQ] = useState(""); const [from, setFrom] = useState(""); const [to, setTo] = useState("");
  const [sort, setSort] = useState({ field: "entry", dir: "desc" });

  const filtered = purchases.filter((p) => {
    if (from && p.date < from) return false;
    if (to && p.date > to) return false;
    if (q.trim()) {
      const query = q.trim().toLowerCase();
      const lot = reels.find((r) => r.id === p.lotId);
      const label = (purchaseLabelMap.get(p.batchId) || "").toLowerCase();
      const hay = `${label} ${lot ? lot.lotNo : ""} ${lot ? reelDesc(lot).toLowerCase() : ""} ${(p.purchasedBy || "").toLowerCase()}`;
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
      html += `<h2>${esc(fmtDate(d))}</h2><table><thead><tr><th>Entry</th><th>Description</th><th>Lot no</th><th>T.weight</th><th>Rate</th><th>Purchased by</th><th>Amount</th></tr></thead><tbody>`;
      sorted.forEach((p) => {
        const lot = reels.find((r) => r.id === p.lotId); if (!lot) return;
        html += `<tr><td class="tag">${esc(purchaseLabelMap.get(p.batchId))}</td><td>${esc(reelDesc(lot))}</td><td class="tag">${esc(lot.lotNo)}</td><td>${num(p.weight)}</td><td>${num(p.rate)}</td><td>${esc(p.purchasedBy || "—")}</td><td>${money(Number(p.weight) * Number(p.rate))}</td></tr>`;
      });
      html += `</tbody><tfoot><tr><td colspan="3">${lines.length} lot(s)</td><td>${num(tW)}</td><td></td><td></td><td>${money(tA)}</td></tr></tfoot></table>`;
    });
    html += `<h2>Grand total — ${filtered.length} lot(s)</h2><table><tbody><tr><td>Total weight</td><td>${num(grandWeight)} kg</td></tr><tr><td>Total amount</td><td>${money(grandAmount)}</td></tr></tbody></table>`;
    printHTML("Purchase report", html || "<p>No entries.</p>");
  };

  return (
    <div>
      <SectionHead title="Purchase report — by date" onPrint={doPrint} />
      <div className="filter-bar no-print">
        <Field label="Search (entry id / lot no / description / purchased by)"><div className="search-input"><Search size={13} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. PR-1 or 9938 or Ahmed" /></div></Field>
        <Field label="From"><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="To"><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        <SortControl value={sort} onChange={setSort} options={[{ value: "entry", label: "Entry order" }, { value: "weight", label: "Weight" }, { value: "rate", label: "Rate" }, { value: "amount", label: "Amount" }]} />
      </div>
      {groups.length === 0 && <EmptyRow>No purchases match this filter.</EmptyRow>}
      {groups.map(([d, lines]) => {
        const sorted = sortWithin(lines, sort, getters);
        const tW = lines.reduce((a, p) => a + Number(p.weight), 0);
        const tA = lines.reduce((a, p) => a + Number(p.weight) * Number(p.rate), 0);
        return (
          <div key={d} className="date-block">
            <div className="date-block-head">{fmtDate(d)}</div>
            <table className="ledger-table">
              <thead><tr><th>Entry</th><th>Item description</th><th>Lot no</th><th>T.weight</th><th>Rate</th><th>Purchased by</th><th>Amount</th></tr></thead>
              <tbody>
                {sorted.map((p) => {
                  const lot = reels.find((r) => r.id === p.lotId);
                  if (!lot) return null;
                  return (
                    <tr key={p.id}>
                      <td className="mono">{purchaseLabelMap.get(p.batchId)}</td>
                      <td>{reelDesc(lot)}</td><td className="mono">{lot.lotNo}</td>
                      <td className="mono">{num(p.weight)}</td><td className="mono">{num(p.rate)}</td>
                      <td>{p.purchasedBy || "—"}</td>
                      <td className="mono">{money(Number(p.weight) * Number(p.rate))}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot><tr><td /><td colSpan={2}>{lines.length} lot(s)</td><td className="mono">{num(tW)}</td><td /><td /><td className="mono">{money(tA)}</td></tr></tfoot>
            </table>
          </div>
        );
      })}
      {filtered.length > 0 && (
        <div className="report-grand-total">
          <span>Grand total — {filtered.length} lot(s)</span>
          <span className="mono">{num(grandWeight)} kg</span>
          <span className="mono">{money(grandAmount)}</span>
        </div>
      )}
    </div>
  );
}

function PurchaseEditTab({ ctx }) {
  const canEdit = ctx.can("canEditEntries"); const canDelete = ctx.can("canDeleteEntries");
  if (!canEdit && !canDelete) return <LockedNote text="You don't have permission to edit or delete purchases." />;
  const { reels, purchases, persist, reelDesc, lotInfo, purchaseLabelMap, remainingForLot } = ctx;
  const [editId, setEditId] = useState(null); const [ef, setEf] = useState(null);
  const [q, setQ] = useState("");

  const eligibleFor = (currentLotId) => reels.filter((r) => r.id === currentLotId || lotInfo[r.id]?.available);
  const labelFn = (excludeId) => (l) => `${reelDesc(l)} · Lot ${l.lotNo} · ${num(remainingForLot(l.id, excludeId))} kg available`;
  const startEdit = (p) => { setEditId(p.id); setEf({ lotId: p.lotId, rate: p.rate, purchasedBy: p.purchasedBy || "", date: p.date }); };
  const saveEdit = () => {
    const weight = remainingForLot(ef.lotId, editId);
    persist.purchases(purchases.map((p) => p.id === editId ? { ...p, lotId: ef.lotId, weight, rate: Number(ef.rate), purchasedBy: ef.purchasedBy.trim(), date: ef.date } : p));
    setEditId(null);
  };
  const remove = (id) => persist.purchases(purchases.filter((p) => p.id !== id));

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
      <SectionHead title="Edit individual purchases" />
      <div className="filter-bar no-print">
        <Field label="Search (entry id / lot no / description)"><div className="search-input"><Search size={13} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. PR-1 or 9938" /></div></Field>
      </div>
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
                      <input type="number" value={ef.rate} onChange={(e) => setEf({ ...ef, rate: e.target.value })} placeholder="rate" />
                      <input value={ef.purchasedBy} onChange={(e) => setEf({ ...ef, purchasedBy: e.target.value })} placeholder="purchased by" />
                      <input type="date" value={ef.date} onChange={(e) => setEf({ ...ef, date: e.target.value })} />
                      <button className="icon-btn" onClick={saveEdit}><Check size={15} /></button>
                      <button className="icon-btn" onClick={() => setEditId(null)}><X size={15} /></button>
                    </div>
                  ) : lot ? (
                    <>
                      <div>
                        <div className="row-title">{reelDesc(lot)} <span className="mono-tag entry-tag">{purchaseLabelMap.get(p.batchId)}</span> <span className="mono-tag">Lot {lot.lotNo}</span></div>
                        <div className="row-sub">{num(p.weight)} kg at {num(p.rate)}/kg = {money(Number(p.weight) * Number(p.rate))}{p.purchasedBy ? ` · purchased by ${p.purchasedBy}` : ""}</div>
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

/* =========================================================
   PRODUCTION MODULE
   ========================================================= */
function ProductionModule({ ctx }) {
  const [sub, setSub] = useState("entries");
  return (
    <div>
      <ModuleTabs sub={sub} setSub={setSub} tabs={[{ id: "entries", label: "Entries" }, { id: "report", label: "Report" }, { id: "edit", label: "Edit" }]} />
      {sub === "entries" && <ProductionEntriesTab ctx={ctx} />}
      {sub === "report" && <ProductionReportView ctx={ctx} />}
      {sub === "edit" && <ProductionEditTab ctx={ctx} />}
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

  const eligible = reels.filter((r) => lotInfo[r.id]?.available);
  const labelFn = (l) => `${reelDesc(l)} · Lot ${l.lotNo} · ${num(lotInfo[l.id].remaining)} kg available`;
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

  const saveAll = () => {
    const validItems = items.filter((it) => it.sizeId && it.packetsProduced);
    if (!lot || !date || validItems.length === 0 || !ok) return;
    const productionId = uid();
    persist.productions([...productions, { id: productionId, lotId, wastageKg: Number(wastageKg || 0), closeOut, date }]);
    persist.productionItems([...productionItems, ...validItems.map((it) => ({ id: uid(), productionId, sizeId: it.sizeId, packetsProduced: Number(it.packetsProduced) }))]);
    setLastSaved({ productionId });
    setLotId(""); setWastageKg(""); setCloseOut(false); setItems([blankItem()]);
  };

  const disabled = sizes.length === 0;

  return (
    <div>
      {disabled && <EmptyRow>Add at least one packet size first, in Suppliers / brands / sizes.</EmptyRow>}
      {!disabled && (
        <div className="ticket-form" style={{ maxWidth: 900 }}>
          <div className="grid-2">
            <Field label="Date"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
            <Field label="Reel"><LotPicker rowKey="prod-lot" lots={eligible} value={lotId} onChange={setLotId} labelFn={labelFn} /></Field>
          </div>
          <div className="grid-2">
            <Field label="Wastage for this reel (kg)"><input type="number" value={wastageKg} onChange={(e) => setWastageKg(e.target.value)} placeholder="0" /></Field>
            <div className="computed" style={{ alignSelf: "end", paddingBottom: 9 }}>
              {lot ? <>Capacity: <b>{num(capacity)} kg</b> · Used so far this entry: <b>{num(totalUsed)} kg</b> · {remainingAfter >= -0.001 ? <>Left: <b>{num(Math.max(0, remainingAfter))} kg</b></> : <span className="static-cell danger">Exceeds available weight</span>}</> : "Pick a reel to see capacity"}
            </div>
          </div>
          <label className="checkbox-field">
            <input type="checkbox" checked={closeOut} onChange={(e) => setCloseOut(e.target.checked)} />
            <span>Mark this reel fully converted — treat any small leftover weight as used up, don't track it as remaining</span>
          </label>
          <FormDivider label="Packet sizes produced from this reel" />
          <div className="rows-table">
            <div className="rows-head cols-3"><span>Packet size</span><span>Packets produced</span><span>Weight used</span></div>
            {items.map((it) => (
              <div className="rows-line cols-3" key={it.key}>
                <select value={it.sizeId} onChange={(e) => updateItem(it.key, { sizeId: e.target.value })}>
                  {sizes.map((s) => <option key={s.id} value={s.id}>{sizeLabel(s)}</option>)}
                </select>
                <input type="number" value={it.packetsProduced} onChange={(e) => updateItem(it.key, { packetsProduced: e.target.value })} placeholder="300" />
                <span className="static-cell mono-tag">{num(itemWeight(it))} kg</span>
                <button className="icon-btn" onClick={() => removeItem(it.key)}><Trash2 size={15} /></button>
              </div>
            ))}
          </div>
          <div className="form-actions">
            <button className="btn" onClick={addItem}><Plus size={14} /> Add packet size</button>
            <button className="btn primary" onClick={saveAll} disabled={!ok}>Save production for this date</button>
          </div>
          {lastSaved && <div className="computed">Saved under production id <b>{productionLabelMap.get(lastSaved.productionId)}</b>. See the list below.</div>}
        </div>
      )}
    </div>
  );
}

function ProductionEntriesTab({ ctx }) {
  const { reels, sizes, productions, persist, reelDesc, sizeLabel, packetWeightKg, itemsFor, itemsWeightFor, productionLabelMap, lotInfo } = ctx;
  const [expanded, setExpanded] = useState(null);
  const canAdd = ctx.can("canAddEntries");
  const canDelete = ctx.can("canDeleteEntries");
  const canEdit = ctx.can("canEditEntries");
  const [editDateId, setEditDateId] = useState(null);
  const [dateDraft, setDateDraft] = useState("");

  const sorted = [...productions].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  const deleteEntry = (id) => {
    ctx.persist.productions(productions.filter((p) => p.id !== id));
    ctx.persist.productionItems(ctx.productionItems.filter((it) => it.productionId !== id));
  };
  const startEditDate = (p) => { setEditDateId(p.id); setDateDraft(p.date); };
  const saveEntryDate = (id) => {
    if (!dateDraft) return;
    persist.productions(productions.map((p) => p.id === id ? { ...p, date: dateDraft } : p));
    setEditDateId(null);
  };

  return (
    <div>
      <SectionHead title="Convert a reel into packets" />
      {canAdd ? <ProductionAddForm ctx={ctx} /> : <LockedNote text="You don't have permission to add production entries." />}
      <h3 className="sub-heading">All entries</h3>
      {sorted.length === 0 && <EmptyRow>No production entries yet.</EmptyRow>}
      {sorted.map((p) => {
        const lot = reels.find((r) => r.id === p.lotId);
        const items = itemsFor(p.id);
        const totalUsed = itemsWeightFor(p.id) + Number(p.wastageKg || 0);
        const isOpen = expanded === p.id;
        const isEditingDate = editDateId === p.id;
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
                  <span>{fmtDate(p.date)} · {lot ? reelDesc(lot) : "removed reel"} {lot ? `Lot ${lot.lotNo}` : ""} · {items.length} size{items.length > 1 ? "s" : ""} · {num(totalUsed)} kg used{p.closeOut ? " · closed out" : ""}</span>
                )}
              </div>
              {!isEditingDate && (
                <div className="row-actions">
                  {canEdit && <button className="icon-btn" onClick={(e) => { e.stopPropagation(); startEditDate(p); }} title="Edit entry date"><Pencil size={15} /></button>}
                  {canDelete && <button className="icon-btn" onClick={(e) => { e.stopPropagation(); deleteEntry(p.id); }} title="Delete entire entry"><Trash2 size={15} /></button>}
                </div>
              )}
            </div>
            {isOpen && (
              <div className="entry-card-body">
                {lot && <div className="row-sub" style={{ marginBottom: 8 }}>Reel status: <Stamp tone={statusTone(lotInfo[lot.id].status)}>{statusLabel(lotInfo[lot.id].status)}</Stamp> · wastage {num(p.wastageKg || 0)} kg</div>}
                {items.map((it) => {
                  const sz = sizes.find((s) => s.id === it.sizeId);
                  const w = sz ? Number(it.packetsProduced) * packetWeightKg(sz) : 0;
                  return (
                    <div className="row" key={it.id}>
                      <div>{sz ? sizeLabel(sz) : "removed size"}</div>
                      <div className="row-sub">{num(it.packetsProduced, 0)} packets = {num(w)} kg</div>
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

function ProductionReportView({ ctx }) {
  if (!ctx.can("canViewReports")) return <LockedNote text="You don't have permission to view reports." />;
  const { reels, sizes, productions, reelDesc, sizeLabel, packetWeightKg, avgGramForEntry, lotInfo, itemsFor, itemsWeightFor, productionLabelMap } = ctx;
  const [q, setQ] = useState(""); const [from, setFrom] = useState(""); const [to, setTo] = useState("");
  const [sort, setSort] = useState({ field: "entry", dir: "desc" });

  const filtered = productions.filter((p) => {
    if (from && p.date < from) return false;
    if (to && p.date > to) return false;
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

  const doPrint = () => {
    let html = "";
    groups.forEach(([d, heads]) => {
      const sorted = sortWithin(heads, sort, getters);
      html += `<h2>${esc(fmtDate(d))}</h2>`;
      sorted.forEach((p) => {
        const lot = reels.find((r) => r.id === p.lotId); if (!lot) return;
        const totalPktWeight = itemsWeightFor(p.id);
        const avgGram = avgGramForEntry(lot, totalPktWeight);
        const info = lotInfo[lot.id];
        html += `<h3>${esc(productionLabelMap.get(p.id))} — ${esc(reelDesc(lot))} (Lot ${esc(lot.lotNo)}) — wastage ${num(p.wastageKg || 0)} kg — remaining ${num(info.remaining)} kg — avg gram ${num(avgGram)}${p.closeOut ? " — CLOSED OUT" : ""}</h3><table><thead><tr><th>Packet size</th><th>Packets</th><th>Weight used</th></tr></thead><tbody>`;
        itemsFor(p.id).forEach((it) => {
          const sz = sizes.find((s) => s.id === it.sizeId); if (!sz) return;
          const w = Number(it.packetsProduced) * packetWeightKg(sz);
          html += `<tr><td>${esc(sizeLabel(sz))}</td><td>${num(it.packetsProduced, 0)}</td><td>${num(w)}</td></tr>`;
        });
        html += `</tbody></table>`;
      });
    });
    printHTML("Production report", html || "<p>No entries.</p>");
  };

  return (
    <div>
      <SectionHead title="Production report — full record" onPrint={doPrint} />
      <div className="filter-bar no-print">
        <Field label="Search (PD id / lot no / description)"><div className="search-input"><Search size={13} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. PD-1 or Ningbo" /></div></Field>
        <Field label="From"><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="To"><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        <SortControl value={sort} onChange={setSort} options={[{ value: "entry", label: "Entry order" }, { value: "used", label: "Weight used" }, { value: "wastage", label: "Wastage" }]} />
      </div>
      {groups.length === 0 && <EmptyRow>No production entries match this filter.</EmptyRow>}
      {groups.map(([d, heads]) => {
        const sorted = sortWithin(heads, sort, getters);
        return (
          <div key={d} className="date-block">
            <div className="date-block-head">{fmtDate(d)}</div>
            {sorted.map((p) => {
              const lot = reels.find((r) => r.id === p.lotId);
              if (!lot) return null;
              const items = itemsFor(p.id);
              const totalUsed = itemsWeightFor(p.id) + Number(p.wastageKg || 0);
              const info = lotInfo[lot.id];
              return (
                <div key={p.id} className="production-block">
                  <div className="production-head">
                    <div>
                      <span className="mono-tag entry-tag">{productionLabelMap.get(p.id)}</span>{" "}
                      <b>{reelDesc(lot)}</b> <span className="mono-tag">Lot {lot.lotNo}</span>
                      <span className="row-sub"> · wastage {num(p.wastageKg || 0)} kg · total used {num(totalUsed)} kg · remaining {num(info.remaining)} kg · avg gram {num(avgGramForEntry(lot, itemsWeightFor(p.id)))}{p.closeOut ? " · closed out" : ""}</span>
                    </div>
                  </div>
                  <table className="ledger-table">
                    <thead><tr><th>Packet size</th><th>Packets</th><th>Weight used</th></tr></thead>
                    <tbody>
                      {items.length === 0 && <tr><td colSpan={3}><EmptyRow>No packet sizes on this entry.</EmptyRow></td></tr>}
                      {items.map((it) => {
                        const sz = sizes.find((s) => s.id === it.sizeId);
                        if (!sz) return null;
                        const w = Number(it.packetsProduced) * packetWeightKg(sz);
                        return (
                          <tr key={it.id}>
                            <td>{sizeLabel(sz)}</td><td className="mono">{num(it.packetsProduced, 0)}</td>
                            <td className="mono">{num(w)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

function ProductionEditTab({ ctx }) {
  const canEdit = ctx.can("canEditEntries"); const canDelete = ctx.can("canDeleteEntries");
  if (!canEdit && !canDelete) return <LockedNote text="You don't have permission to edit or delete production entries." />;
  const { reels, sizes, productions, productionItems, persist, reelDesc, sizeLabel, packetWeightKg, productionLabelMap, itemsFor } = ctx;
  const [q, setQ] = useState("");
  const [editHeaderId, setEditHeaderId] = useState(null); const [eh, setEh] = useState(null);
  const [editItemId, setEditItemId] = useState(null); const [ei, setEi] = useState(null);

  const startEditHeader = (p) => { setEditHeaderId(p.id); setEh({ wastageKg: p.wastageKg, closeOut: !!p.closeOut, date: p.date }); };
  const saveEditHeader = () => { persist.productions(productions.map((p) => p.id === editHeaderId ? { ...p, wastageKg: Number(eh.wastageKg || 0), closeOut: eh.closeOut, date: eh.date } : p)); setEditHeaderId(null); };
  const startEditItem = (it) => { setEditItemId(it.id); setEi({ sizeId: it.sizeId, packetsProduced: it.packetsProduced }); };
  const saveEditItem = () => { persist.productionItems(productionItems.map((it) => it.id === editItemId ? { ...it, sizeId: ei.sizeId, packetsProduced: Number(ei.packetsProduced) } : it)); setEditItemId(null); };
  const removeItem = (id) => persist.productionItems(productionItems.filter((it) => it.id !== id));

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
      <SectionHead title="Edit production entries" />
      <div className="filter-bar no-print">
        <Field label="Search (PD id / lot no / description)"><div className="search-input"><Search size={13} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. PD-1 or Ningbo" /></div></Field>
      </div>
      {groups.length === 0 && <EmptyRow>Nothing to edit.</EmptyRow>}
      {groups.map(([d, heads]) => (
        <div key={d} className="date-block">
          <div className="date-block-head">{fmtDate(d)}</div>
          {heads.map((p) => {
            const lot = reels.find((r) => r.id === p.lotId);
            if (!lot) return null;
            const items = itemsFor(p.id);
            return (
              <div key={p.id} className="production-block">
                <div className="production-head">
                  <div>
                    <span className="mono-tag entry-tag">{productionLabelMap.get(p.id)}</span>{" "}
                    <b>{reelDesc(lot)}</b> <span className="mono-tag">Lot {lot.lotNo}</span>
                  </div>
                  {editHeaderId === p.id ? (
                    <div className="edit-row">
                      <input type="number" value={eh.wastageKg} onChange={(e) => setEh({ ...eh, wastageKg: e.target.value })} placeholder="wastage kg" style={{ width: 100 }} />
                      <label className="checkbox-field" style={{ margin: 0 }}><input type="checkbox" checked={eh.closeOut} onChange={(e) => setEh({ ...eh, closeOut: e.target.checked })} /><span>Closed out</span></label>
                      <input type="date" value={eh.date} onChange={(e) => setEh({ ...eh, date: e.target.value })} />
                      <button className="icon-btn" onClick={saveEditHeader}><Check size={15} /></button>
                      <button className="icon-btn" onClick={() => setEditHeaderId(null)}><X size={15} /></button>
                    </div>
                  ) : canEdit ? (
                    <button className="icon-btn" onClick={() => startEditHeader(p)} title="Edit wastage / date"><Pencil size={15} /></button>
                  ) : null}
                </div>
                <table className="ledger-table">
                  <thead><tr><th>Packet size</th><th>Packets</th><th>Weight used</th><th>Edit</th></tr></thead>
                  <tbody>
                    {items.length === 0 && <tr><td colSpan={4}><EmptyRow>No packet sizes on this entry.</EmptyRow></td></tr>}
                    {items.map((it) => {
                      const sz = sizes.find((s) => s.id === it.sizeId);
                      if (editItemId === it.id) {
                        return (
                          <tr key={it.id}><td colSpan={4}>
                            <div className="edit-row">
                              <select value={ei.sizeId} onChange={(e) => setEi({ ...ei, sizeId: e.target.value })}>{sizes.map((s) => <option key={s.id} value={s.id}>{sizeLabel(s)}</option>)}</select>
                              <input type="number" value={ei.packetsProduced} onChange={(e) => setEi({ ...ei, packetsProduced: e.target.value })} placeholder="packets" style={{ width: 100 }} />
                              <button className="icon-btn" onClick={saveEditItem}><Check size={15} /></button>
                              <button className="icon-btn" onClick={() => setEditItemId(null)}><X size={15} /></button>
                            </div>
                          </td></tr>
                        );
                      }
                      if (!sz) return null;
                      const w = Number(it.packetsProduced) * packetWeightKg(sz);
                      return (
                        <tr key={it.id}>
                          <td>{sizeLabel(sz)}</td><td className="mono">{num(it.packetsProduced, 0)}</td>
                          <td className="mono">{num(w)}</td>
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

/* =========================================================
   STOCK MODULE
   ========================================================= */
function StockModule({ ctx }) {
  const [sub, setSub] = useState("current");
  return (
    <div>
      <ModuleTabs sub={sub} setSub={setSub} tabs={[{ id: "current", label: "Current stock" }, { id: "quantity", label: "Reels quantity" }]} />
      {sub === "current" && <StockReportTab ctx={ctx} />}
      {sub === "quantity" && <ReelsQuantityTab ctx={ctx} />}
    </div>
  );
}

function StockReportTab({ ctx }) {
  if (!ctx.can("canViewReports")) return <LockedNote text="You don't have permission to view reports." />;
  const { reels, suppliers, lotInfo, reelDesc, supplierName } = ctx;
  const [supplierFilter, setSupplierFilter] = useState([]);
  const [statusFilter, setStatusFilter] = useState([]);
  const [q, setQ] = useState("");
  const [from, setFrom] = useState(""); const [to, setTo] = useState("");
  const [sort, setSort] = useState({ field: "date", dir: "desc" });
  const statusOptions = [{ value: "consignment", label: "In godown" }, { value: "partial", label: "Partly converted" }, { value: "converted", label: "Fully converted" }, { value: "purchased", label: "Purchased" }];
  const supplierOptions = suppliers.map((s) => ({ value: s.id, label: s.name }));

  const rows = reels.filter((lot) => {
    if (supplierFilter.length && !supplierFilter.includes(lot.supplierId)) return false;
    if (statusFilter.length && !statusFilter.includes(lotInfo[lot.id].status)) return false;
    if (from && lot.date < from) return false;
    if (to && lot.date > to) return false;
    if (q.trim()) {
      const query = q.trim().toLowerCase();
      const hay = `${lot.lotNo} ${lot.width} ${reelDesc(lot).toLowerCase()}`;
      if (!hay.includes(query)) return false;
    }
    return true;
  });
  const dir = sort.dir === "asc" ? 1 : -1;
  const sorted = [...rows].sort((a, b) => {
    if (sort.field === "date") return (a.date < b.date ? 1 : a.date > b.date ? -1 : 0) * (sort.dir === "asc" ? -1 : 1);
    if (sort.field === "weight") return (Number(a.weight) - Number(b.weight)) * dir;
    if (sort.field === "remaining") return (lotInfo[a.id].remaining - lotInfo[b.id].remaining) * dir;
    return 0;
  });
  const sumRemaining = sorted.reduce((a, lot) => a + lotInfo[lot.id].remaining, 0);
  const sumWeight = sorted.reduce((a, lot) => a + Number(lot.weight), 0);

  const doPrint = () => {
    let html = `<table><thead><tr><th>Description</th><th>Detail</th><th>Lot no</th><th>Width</th><th>Supplier</th><th>Status</th><th>Purchased by</th><th>Remaining</th><th>Weight</th></tr></thead><tbody>`;
    sorted.forEach((lot) => {
      const info = lotInfo[lot.id];
      html += `<tr><td>${esc(reelDesc(lot))}</td><td>${esc(lot.detail || "—")}</td><td class="tag">${esc(lot.lotNo)}</td><td>${esc(lot.width)}</td><td>${esc(supplierName(lot.supplierId))}</td><td>${esc(statusLabel(info.status))}</td><td>${esc(info.purchase?.purchasedBy || "—")}</td><td>${num(info.remaining)}</td><td>${num(lot.weight)}</td></tr>`;
    });
    html += `</tbody><tfoot><tr><td colspan="7">${sorted.length} lot(s)</td><td>${num(sumRemaining)}</td><td>${num(sumWeight)}</td></tr></tfoot></table>`;
    printHTML("Current stock", html);
  };

  return (
    <div>
      <SectionHead title="Current stock — reel-wise" onPrint={doPrint} />
      <div className="filter-bar no-print">
        <Field label="Search (lot no / width / description)"><div className="search-input"><Search size={13} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. 9938 or Ningbo" /></div></Field>
        <Field label="Supplier"><MultiSelect options={supplierOptions} values={supplierFilter} onChange={setSupplierFilter} /></Field>
        <Field label="Status"><MultiSelect options={statusOptions} values={statusFilter} onChange={setStatusFilter} /></Field>
        <Field label="From"><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="To"><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        <SortControl value={sort} onChange={setSort} options={[{ value: "date", label: "Date" }, { value: "weight", label: "Received weight" }, { value: "remaining", label: "Remaining weight" }]} />
      </div>
      <table className="ledger-table">
        <thead><tr><th>Item description</th><th>Detail</th><th>Lot no</th><th>Width</th><th>Supplier</th><th>Status</th><th>Purchased by</th><th>Remaining</th><th>Weight</th></tr></thead>
        <tbody>
          {sorted.length === 0 && <tr><td colSpan={9}><EmptyRow>No lots match this filter.</EmptyRow></td></tr>}
          {sorted.map((lot) => {
            const info = lotInfo[lot.id];
            return (
              <tr key={lot.id}>
                <td>{reelDesc(lot)}</td><td>{lot.detail || "—"}</td><td className="mono">{lot.lotNo}</td><td className="mono">{lot.width || "—"}</td>
                <td>{supplierName(lot.supplierId)}</td><td><Stamp tone={statusTone(info.status)}>{statusLabel(info.status)}</Stamp></td>
                <td>{info.purchase?.purchasedBy || "—"}</td>
                <td className="mono">{num(info.remaining)}</td><td className="mono">{num(lot.weight)}</td>
              </tr>
            );
          })}
        </tbody>
        {sorted.length > 0 && (
          <tfoot><tr><td colSpan={7}>{sorted.length} lot(s)</td><td className="mono">{num(sumRemaining)}</td><td className="mono">{num(sumWeight)}</td></tr></tfoot>
        )}
      </table>
    </div>
  );
}

function ReelsQuantityTab({ ctx }) {
  if (!ctx.can("canViewReports")) return <LockedNote text="You don't have permission to view reports." />;
  const { reels, suppliers, lotInfo, reelDesc, supplierName } = ctx;
  const [supplierFilter, setSupplierFilter] = useState([]);
  const [statusFilter, setStatusFilter] = useState([]);
  const [q, setQ] = useState("");
  const [from, setFrom] = useState(""); const [to, setTo] = useState("");
  const [sort, setSort] = useState({ field: "qty", dir: "desc" });
  const statusOptions = [{ value: "consignment", label: "In godown" }, { value: "partial", label: "Partly converted" }, { value: "converted", label: "Fully converted" }, { value: "purchased", label: "Purchased" }];
  const supplierOptions = suppliers.map((s) => ({ value: s.id, label: s.name }));

  const rows = reels.filter((lot) => {
    if (supplierFilter.length && !supplierFilter.includes(lot.supplierId)) return false;
    if (statusFilter.length && !statusFilter.includes(lotInfo[lot.id].status)) return false;
    if (from && lot.date < from) return false;
    if (to && lot.date > to) return false;
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
      g.qty += 1;
      g.sumWeight += Number(lot.weight);
      g.sumRemaining += lotInfo[lot.id].remaining;
    });
    return [...map.values()];
  }, [rows, lotInfo]);

  const dir = sort.dir === "asc" ? 1 : -1;
  const sorted = [...groups].sort((a, b) => {
    if (sort.field === "qty") return (a.qty - b.qty) * dir;
    if (sort.field === "weight") return (a.sumWeight - b.sumWeight) * dir;
    if (sort.field === "remaining") return (a.sumRemaining - b.sumRemaining) * dir;
    return a.description.localeCompare(b.description);
  });
  const totalQty = sorted.reduce((a, g) => a + g.qty, 0);
  const totalWeight = sorted.reduce((a, g) => a + g.sumWeight, 0);
  const totalRemaining = sorted.reduce((a, g) => a + g.sumRemaining, 0);

  const doPrint = () => {
    let html = `<table><thead><tr><th>Item description</th><th>Width</th><th>Reels quantity</th><th>Total weight</th><th>Total remaining</th></tr></thead><tbody>`;
    sorted.forEach((g) => {
      html += `<tr><td>${esc(g.description)}</td><td>${esc(g.width)}</td><td>${num(g.qty, 0)}</td><td>${num(g.sumWeight)}</td><td>${num(g.sumRemaining)}</td></tr>`;
    });
    html += `</tbody><tfoot><tr><td colspan="2">${sorted.length} item(s)</td><td>${num(totalQty, 0)}</td><td>${num(totalWeight)}</td><td>${num(totalRemaining)}</td></tr></tfoot></table>`;
    printHTML("Reels quantity", html);
  };

  return (
    <div>
      <SectionHead title="Reels quantity — grouped by item &amp; width" onPrint={doPrint} />
      <div className="filter-bar no-print">
        <Field label="Search (width / description)"><div className="search-input"><Search size={13} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. 30 or Ningbo" /></div></Field>
        <Field label="Supplier"><MultiSelect options={supplierOptions} values={supplierFilter} onChange={setSupplierFilter} /></Field>
        <Field label="Status"><MultiSelect options={statusOptions} values={statusFilter} onChange={setStatusFilter} /></Field>
        <Field label="From"><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="To"><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        <SortControl value={sort} onChange={setSort} options={[{ value: "qty", label: "Reels quantity" }, { value: "weight", label: "Total weight" }, { value: "remaining", label: "Total remaining" }]} />
      </div>
      <table className="ledger-table">
        <thead><tr><th>Item description</th><th>Width</th><th>Reels quantity</th><th>Total weight</th><th>Total remaining</th></tr></thead>
        <tbody>
          {sorted.length === 0 && <tr><td colSpan={5}><EmptyRow>No lots match this filter.</EmptyRow></td></tr>}
          {sorted.map((g) => (
            <tr key={g.description + g.width}>
              <td>{g.description}</td><td className="mono">{g.width || "—"}</td>
              <td className="mono">{num(g.qty, 0)}</td><td className="mono">{num(g.sumWeight)}</td><td className="mono">{num(g.sumRemaining)}</td>
            </tr>
          ))}
        </tbody>
        {sorted.length > 0 && (
          <tfoot><tr><td colSpan={2}>{sorted.length} item(s)</td><td className="mono">{num(totalQty, 0)}</td><td className="mono">{num(totalWeight)}</td><td className="mono">{num(totalRemaining)}</td></tr></tfoot>
        )}
      </table>
    </div>
  );
}

/* ---------------- styles ---------------- */
function Style() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Oswald:wght@500;600&family=IBM+Plex+Sans:wght@400;500&family=IBM+Plex+Mono:wght@500&display=swap');
      .app-shell { --ink:#23261F; --paper:#EFEEE6; --paper-2:#F8F7F2; --line:#CBC6B6;
        --rust:#A8471E; --rust-bg:#F3E2D6; --mill:#2B4C6F; --mill-bg:#DCE4EC;
        --moss:#4A7856; --moss-bg:#E1EADD; --gray-bg:#E7E5DC; --danger:#A32D2D;
        font-family:'IBM Plex Sans',sans-serif; color:var(--ink); background:var(--paper);
        border-radius:12px; padding:0; max-width:100%; overflow:hidden; border:1px solid var(--line); }
      .loading-shell { display:flex; align-items:center; gap:10px; justify-content:center; padding:48px 0; color:#6b6a5e; }
      .spin { animation: spin 1s linear infinite; } @keyframes spin { to { transform: rotate(360deg); } }
      .app-header { display:flex; justify-content:space-between; align-items:flex-end; padding:22px 24px 16px; border-bottom:2px solid var(--ink); background:var(--paper-2); }
      .eyebrow { font-family:'IBM Plex Mono',monospace; font-size:11px; letter-spacing:.08em; text-transform:uppercase; color:var(--rust); margin-bottom:4px; }
      .app-header h1 { font-family:'Oswald',sans-serif; font-weight:600; font-size:26px; margin:0; text-transform:uppercase; letter-spacing:.02em; }
      .header-note { font-size:11px; color:#7a7869; max-width:220px; text-align:right; }
      .header-user { display:flex; flex-direction:column; align-items:flex-end; gap:6px; }
      .header-signout { padding:5px 10px; font-size:11px; }
      .tabbar { display:flex; flex-wrap:wrap; gap:3px; padding:10px 20px; background:var(--paper-2); border-bottom:1px solid var(--line); }
      .tab { display:flex; align-items:center; gap:6px; padding:8px 12px; border:1px solid transparent; background:transparent;
        font-size:12.5px; font-weight:500; color:#5c5a4e; cursor:pointer; border-radius:6px; white-space:nowrap; }
      .tab:hover { background:var(--gray-bg); } .tab.active { background:var(--ink); color:var(--paper); }
      .subtabbar { display:flex; gap:6px; margin-bottom:18px; }
      .subtab { padding:7px 14px; border:1px solid var(--line); background:#fff; border-radius:14px; font-size:12.5px; font-weight:500; cursor:pointer; color:#5c5a4e; }
      .subtab.active { background:var(--ink); color:var(--paper); border-color:var(--ink); }
      .app-main { padding:22px 26px 30px; }
      .section-head { margin-bottom:16px; display:flex; justify-content:space-between; align-items:center; gap:12px; flex-wrap:wrap; }
      .section-head h2 { font-family:'Oswald',sans-serif; font-size:16px; text-transform:uppercase; margin:0; letter-spacing:.01em; }
      .sub-heading { font-family:'Oswald',sans-serif; font-size:13px; text-transform:uppercase; color:#6b6a5e; margin:26px 0 12px; letter-spacing:.03em; }
      .btn { font-size:13px; font-weight:500; padding:9px 15px; border-radius:6px; border:1px solid var(--ink); background:transparent; color:var(--ink); cursor:pointer; display:inline-flex; align-items:center; gap:6px; }
      .btn:hover:not(:disabled) { background:var(--ink); color:var(--paper); } .btn:disabled { opacity:.4; cursor:not-allowed; }
      .btn.primary { background:var(--ink); color:var(--paper); } .btn.primary:hover:not(:disabled) { background:var(--rust); border-color:var(--rust); }
      .icon-btn { border:none; background:transparent; color:#9a8f7c; cursor:pointer; padding:6px; border-radius:6px; display:inline-flex; }
      .icon-btn:hover:not(:disabled) { background:var(--rust-bg); color:var(--rust); } .icon-btn:disabled { opacity:.3; cursor:not-allowed; }
      .row-expand { border:none; background:transparent; color:#9a8f7c; cursor:pointer; padding:4px; display:flex; align-items:center; }
      .field { display:flex; flex-direction:column; gap:5px; font-size:11.5px; color:#6b6a5e; font-weight:500; }
      .field input, .field select { font-family:'IBM Plex Mono',monospace; font-size:13px; padding:9px 10px; border:1px solid var(--line); border-radius:6px; background:#fff; color:var(--ink); }
      .field input:focus, .field select:focus { outline:2px solid var(--mill); outline-offset:1px; }
      .search-input { display:flex; align-items:center; gap:6px; background:#fff; border:1px solid var(--line); border-radius:6px; padding:0 10px; }
      .search-input svg { color:#9a9384; flex-shrink:0; }
      .search-input input { border:none; padding:9px 0; background:transparent; }
      .search-input input:focus { outline:none; }
      .sort-control { display:flex; gap:6px; }
      .sort-dir-btn { white-space:nowrap; padding:9px 12px; }
      .multiselect { position:relative; }
      .multiselect-btn { width:100%; min-width:150px; display:flex; justify-content:space-between; align-items:center; gap:8px;
        font-family:'IBM Plex Mono',monospace; font-size:13px; padding:9px 10px; border:1px solid var(--line); border-radius:6px; background:#fff; color:var(--ink); cursor:pointer; }
      .multiselect-btn:hover { border-color:var(--mill); }
      .multiselect-btn svg { color:#9a9384; flex-shrink:0; }
      .multiselect-panel { position:absolute; top:calc(100% + 4px); left:0; z-index:20; background:#fff; border:1px solid var(--line); border-radius:8px;
        box-shadow:0 6px 18px rgba(35,38,31,.12); padding:8px; min-width:190px; max-height:220px; overflow-y:auto; display:flex; flex-direction:column; gap:2px; }
      .multiselect-option { display:flex; align-items:center; gap:8px; font-size:12.5px; padding:6px 6px; border-radius:5px; cursor:pointer; white-space:nowrap; }
      .multiselect-option:hover { background:var(--gray-bg); }
      .multiselect-clear { margin-top:4px; font-size:11px; padding:5px 8px; align-self:flex-start; }
      .checkbox-field { display:flex; align-items:flex-start; gap:8px; font-size:12.5px; color:#4d4b40; cursor:pointer; line-height:1.4; }
      .checkbox-field input { margin-top:2px; }
      .ticket-form { background:var(--paper-2); border:1px solid var(--line); border-radius:10px; padding:20px; margin-bottom:8px; display:flex; flex-direction:column; gap:14px; }
      .ticket-form.grid-2, .grid-2 { display:grid; grid-template-columns:1fr 1fr; gap:14px; }
      .span-2 { grid-column: span 2; }
      .form-divider { display:flex; align-items:center; gap:10px; margin:2px 0; }
      .form-divider span { font-size:10.5px; text-transform:uppercase; letter-spacing:.04em; color:#8a8879; font-weight:600; white-space:nowrap; }
      .form-divider::after { content:""; flex:1; border-top:1px dashed var(--line); }
      .computed { font-size:13px; color:#6b6a5e; padding-top:2px; } .computed b { color:var(--ink); font-family:'IBM Plex Mono',monospace; }
      .rows-table { display:flex; flex-direction:column; gap:8px; overflow-x:auto; }
      .rows-head, .rows-line { display:grid; grid-template-columns:1.4fr 1fr .8fr .8fr 1fr 32px; gap:10px; align-items:center; }
      .rows-head.cols-3, .rows-line.cols-3 { grid-template-columns:1.6fr .9fr .9fr 30px; }
      .rows-head.cols-4, .rows-line.cols-4 { grid-template-columns:1.8fr .8fr .8fr 1fr; }
      .rows-head.cols-5, .rows-line.cols-5 { grid-template-columns:1.5fr .8fr .6fr .9fr .8fr; }
      .rows-head.cols-7, .rows-line.cols-7 { grid-template-columns:.9fr 1.1fr .6fr .6fr .8fr 1fr 30px; }
      .rows-head span { font-size:10px; text-transform:uppercase; letter-spacing:.04em; color:#8a8879; font-weight:600; }
      .rows-line input, .rows-line select { font-family:'IBM Plex Mono',monospace; font-size:12.5px; padding:8px 9px; border:1px solid var(--line); border-radius:6px; background:#fff; width:100%; }
      .static-cell { font-size:12.5px; padding:8px 4px; }
      .static-cell.danger { color: var(--danger); }
      .alert-note { font-size:10.5px; color:var(--danger); margin-top:4px; }
      .mono-tag { font-family:'IBM Plex Mono',monospace; }
      .entry-tag { background:var(--mill-bg); color:var(--mill); padding:2px 7px; border-radius:4px; font-size:10.5px; font-weight:600; }
      .form-actions { display:flex; gap:10px; justify-content:space-between; margin-top:4px; }
      .list { display:flex; flex-direction:column; }
      .row { display:flex; justify-content:space-between; align-items:center; padding:11px 4px; gap:12px; border-bottom:1px solid var(--line); }
      .row-title { font-weight:500; font-size:13.5px; display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
      .row-sub { font-size:11.5px; color:#7a7869; margin-top:3px; }
      .row-actions { display:flex; align-items:center; gap:6px; }
      .detail-panel { background:var(--paper-2); padding:12px 16px; font-size:12px; border-radius:6px; }
      .detail-title { font-weight:600; margin-bottom:6px; text-transform:uppercase; font-size:10.5px; letter-spacing:.03em; color:#7a7869; }
      .detail-line { color:#4d4b40; padding:3px 0; }
      .entry-card { border:1px solid var(--line); border-radius:8px; margin-bottom:10px; overflow:hidden; }
      .entry-card-head { display:flex; justify-content:space-between; align-items:center; gap:10px; padding:11px 14px; background:var(--paper-2); cursor:pointer; }
      .entry-card-title { display:flex; align-items:center; gap:8px; font-size:13px; flex-wrap:wrap; color:#4d4b40; }
      .entry-card-body { padding:4px 14px 8px; background:#fff; }
      .entry-date-edit { display:flex; align-items:center; gap:6px; }
      .entry-date-edit input { font-family:'IBM Plex Mono',monospace; font-size:12px; padding:5px 7px; border:1px solid var(--line); border-radius:5px; }
      .production-block { margin-bottom:16px; border:1px solid var(--line); border-radius:8px; overflow:hidden; }
      .production-head { display:flex; justify-content:space-between; align-items:center; gap:10px; background:var(--paper-2); padding:10px 12px; flex-wrap:wrap; }
      .edit-row { display:flex; gap:6px; flex:1; align-items:center; flex-wrap:wrap; }
      .edit-row.grid-4 { display:grid; grid-template-columns:1.6fr .8fr 1fr auto auto; gap:8px; flex:1; }
      .edit-row.grid-5 { display:grid; grid-template-columns:1.4fr .6fr .8fr .9fr auto auto; gap:8px; flex:1; }
      .edit-row.grid-7 { display:grid; grid-template-columns:.8fr .9fr .6fr .6fr .8fr .9fr .9fr auto auto; gap:8px; flex:1; }
      .edit-row input, .edit-row select { font-family:'IBM Plex Mono',monospace; font-size:12px; padding:7px 8px; border:1px solid var(--line); border-radius:6px; width:100%; }
      .empty-row { padding:22px 4px; color:#8a8879; font-size:13px; border:1px dashed var(--line); border-radius:8px; text-align:center; }
      .locked-panel { display:flex; align-items:flex-start; gap:10px; padding:16px; border:1px dashed var(--rust); background:var(--rust-bg); border-radius:8px; color:var(--rust); font-size:13px; line-height:1.5; }
      .date-block { margin-bottom:20px; }
      .date-block-head { font-family:'IBM Plex Mono',monospace; font-size:12px; text-transform:uppercase; letter-spacing:.04em; background:var(--gray-bg); padding:7px 11px; border-radius:6px 6px 0 0; display:flex; justify-content:space-between; }
      .date-block-head span { color:#7a7869; text-transform:none; letter-spacing:0; }
      .ledger-table { width:100%; border-collapse:collapse; font-size:12.5px; }
      .ledger-table th { text-align:left; font-size:10px; text-transform:uppercase; letter-spacing:.03em; color:#8a8879; padding:9px 8px; border-bottom:1px solid var(--ink); background:var(--paper-2); }
      .ledger-table td { padding:9px 8px; border-bottom:1px solid var(--line); }
      .ledger-table td.mono, .ledger-table th.mono { font-family:'IBM Plex Mono',monospace; }
      .ledger-table tfoot td { font-weight:500; border-top:2px solid var(--ink); border-bottom:none; font-family:'IBM Plex Mono',monospace; }
      .report-grand-total { display:flex; gap:24px; align-items:center; justify-content:flex-end; background:var(--ink); color:var(--paper); border-radius:8px; padding:12px 18px; margin-top:6px; font-size:13px; font-weight:500; }
      .report-grand-total .mono { font-family:'IBM Plex Mono',monospace; font-size:14px; }
      .filter-bar { display:flex; gap:16px; flex-wrap:wrap; margin-bottom:18px; background:var(--paper-2); border:1px solid var(--line); border-radius:10px; padding:14px; }
      .stamp { font-family:'IBM Plex Mono',monospace; font-size:10px; text-transform:uppercase; letter-spacing:.05em; padding:4px 9px; border-radius:4px; border:1px solid currentColor; transform:rotate(-2deg); white-space:nowrap; display:inline-block; }
      .stamp-gray { color:#6b6a5e; background:var(--gray-bg); } .stamp-green { color:var(--moss); background:var(--moss-bg); }
      .stamp-amber { color:var(--rust); background:var(--rust-bg); } .stamp-blue { color:var(--mill); background:var(--mill-bg); }
      .metric-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(170px,1fr)); gap:14px; margin-bottom:22px; }
      .metric-card { background:var(--paper-2); border:1px solid var(--line); border-radius:10px; padding:16px; }
      .metric-label { font-size:11px; color:#8a8879; text-transform:uppercase; margin-bottom:8px; letter-spacing:.02em; }
      .metric-value { font-family:'IBM Plex Mono',monospace; font-size:21px; font-weight:500; }
      .invite-panel { border:1px dashed var(--line); border-radius:10px; padding:20px; background:var(--paper-2); }
      .invite-title { font-family:'Oswald',sans-serif; text-transform:uppercase; font-size:14px; margin-bottom:6px; }
      .invite-body { font-size:13px; color:#6b6a5e; line-height:1.6; }
      .team-row { display:flex; align-items:center; gap:14px; flex-wrap:wrap; padding:12px 14px; border:1px solid var(--line); border-radius:8px; margin-bottom:8px; background:#fff; }
      .team-row-name { font-weight:500; font-size:13px; min-width:140px; }
      .team-perm { margin:0; white-space:nowrap; }
      .login-shell { display:flex; align-items:center; justify-content:center; min-height:70vh; padding:24px; }
      .login-card { max-width:380px; width:100%; display:flex; flex-direction:column; gap:14px; background:var(--paper-2); border:1px solid var(--line); border-radius:14px; padding:32px 28px; }
      .login-title { font-family:'Oswald',sans-serif; font-size:22px; text-transform:uppercase; margin:0; }
      .login-sub { font-size:13px; color:#6b6a5e; margin-bottom:4px; }
      .login-error { font-size:12.5px; color:var(--danger); background:#f6e3e3; border:1px solid var(--danger); border-radius:6px; padding:9px 11px; }
      .login-notice { font-size:12.5px; color:var(--moss); background:var(--moss-bg); border:1px solid var(--moss); border-radius:6px; padding:9px 11px; }
      .login-submit { justify-content:center; }
      .login-switch { background:none; border:none; color:var(--mill); font-size:12.5px; cursor:pointer; text-decoration:underline; padding:0; text-align:left; }
      .login-hint { font-size:11px; color:#8a8879; line-height:1.5; margin-top:6px; }
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
  opacity: 1;
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
      @media print { .no-print { display:none !important; } .app-shell { border:none; } }
      @media (max-width:640px){
        .rows-head, .rows-line, .rows-head.cols-3, .rows-line.cols-3, .rows-head.cols-4, .rows-line.cols-4, .rows-head.cols-5, .rows-line.cols-5, .rows-head.cols-7, .rows-line.cols-7 { grid-template-columns:1fr; }
        .ticket-form.grid-2, .grid-2 { grid-template-columns:1fr; } .span-2 { grid-column: span 1; }
        .app-header { flex-direction:column; align-items:flex-start; gap:6px; } .header-note { text-align:left; }
        .header-user { align-items:flex-start; }
        .filter-bar { flex-direction:column; }
    `}</style>
  );
}