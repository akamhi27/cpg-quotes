import { useState, useEffect, useRef } from "react";
import { supabase } from "./supabase";

const MT_TO_LB = 2204.62;
const TERMS = ["FOB", "CFR", "CIF", "Delivered"];
const STATUSES = ["Pending", "Accepted", "Rejected", "Countered", "Expired"];

const STATUS_CFG = {
  Pending:   { bg: "#fff8e6", color: "#92640a", border: "#fcd98a" },
  Accepted:  { bg: "#e6f9ee", color: "#166534", border: "#86efac" },
  Rejected:  { bg: "#fef2f2", color: "#991b1b", border: "#fca5a5" },
  Countered: { bg: "#f0edff", color: "#4c1d95", border: "#c4b5fd" },
  Expired:   { bg: "#f3f4f6", color: "#6b7280", border: "#d1d5db" },
};

const TERMS_CFG = {
  FOB:       { bg: "#eff6ff", color: "#1d4ed8", border: "#bfdbfe" },
  CFR:       { bg: "#fdf4ff", color: "#7e22ce", border: "#e9d5ff" },
  CIF:       { bg: "#f0fdf4", color: "#15803d", border: "#bbf7d0" },
  Delivered: { bg: "#fff7ed", color: "#c2410c", border: "#fed7aa" },
};

function fmt(n, d = 2) {
  if (n == null || n === "" || isNaN(Number(n))) return "";
  return Number(n).toFixed(d);
}
function mtToLb(v) { return isNaN(parseFloat(v)) ? "" : fmt(parseFloat(v) / MT_TO_LB, 4); }
function lbToMt(v) { return isNaN(parseFloat(v)) ? "" : fmt(parseFloat(v) * MT_TO_LB, 2); }
function parseBmd(str) {
  if (!str) return { isBmd: false };
  const m = str.trim().toUpperCase().match(/^BMD\s*([+-])\s*(\d+(\.\d+)?)$/);
  if (!m) return { isBmd: false };
  return { isBmd: true, sign: m[1] === "+" ? 1 : -1, spread: parseFloat(m[2]) };
}
function calcBmdUsd(bmdUsd, spread, sign) {
  const b = parseFloat(bmdUsd);
  if (isNaN(b)) return null;
  return b + sign * spread;
}

function Pill({ cfg, children, small }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center",
      padding: small ? "2px 8px" : "3px 10px",
      borderRadius: "20px",
      fontSize: small ? "10px" : "11px",
      fontWeight: 600, letterSpacing: "0.03em",
      background: cfg.bg, color: cfg.color,
      border: `1px solid ${cfg.border}`,
      whiteSpace: "nowrap",
    }}>
      {children}
    </span>
  );
}

function Combobox({ value, onChange, options, placeholder, onAdd }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState(value || "");
  const ref = useRef();
  useEffect(() => setQ(value || ""), [value]);
  useEffect(() => {
    const h = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  const filtered = options.filter(o => o.toLowerCase().includes(q.toLowerCase()));
  const showAdd = q.trim() && !options.map(o => o.toLowerCase()).includes(q.trim().toLowerCase());
  function pick(v) { onChange(v); setQ(v); setOpen(false); }
  return (
    <div ref={ref} style={{ position: "relative", width: "100%" }}>
      <input value={q} placeholder={placeholder} autoComplete="off" className="field-input"
        onChange={e => { setQ(e.target.value); onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)} />
      {open && (filtered.length > 0 || showAdd) && (
        <div style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, background: "#fff", border: "1px solid #e5e7eb", borderRadius: "8px", zIndex: 300, overflow: "hidden", boxShadow: "0 10px 30px rgba(0,0,0,0.1)" }}>
          {filtered.map(o => (
            <div key={o} onMouseDown={() => pick(o)}
              style={{ padding: "10px 14px", fontSize: "14px", color: o === value ? "#0073ea" : "#374151", background: o === value ? "#f0f7ff" : "transparent", cursor: "pointer" }}>
              {o}
            </div>
          ))}
          {showAdd && (
            <div onMouseDown={() => { onAdd(q.trim()); pick(q.trim()); }}
              style={{ padding: "10px 14px", fontSize: "14px", color: "#0073ea", cursor: "pointer", borderTop: filtered.length ? "1px solid #f3f4f6" : "none", fontWeight: 500 }}>
              + Add "{q.trim()}"
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function emptyForm() {
  return { date: new Date().toISOString().split("T")[0], buyer: "", product: "", terms: "FOB", price_mt: "", price_lb: "", notes: "", status: "Pending" };
}

// ── Quote Form (shared between new + edit) ────────────────────────────
function QuoteForm({ form, setForm, onSubmit, onCancel, saving, editId, bmdUsd, allBuyers, allProds, onAddBuyer, onAddProduct }) {
  function setPriceMT(val) {
    const bmd = parseBmd(val);
    setForm(f => ({ ...f, price_mt: val, price_lb: bmd.isBmd ? "" : (val && !isNaN(parseFloat(val)) ? mtToLb(val) : f.price_lb) }));
  }
  function setPriceLB(val) {
    setForm(f => ({ ...f, price_lb: val, price_mt: val && !isNaN(parseFloat(val)) ? lbToMt(val) : f.price_mt }));
  }
  const formBmd = parseBmd(form.price_mt);
  const formBmdUsd = formBmd.isBmd && bmdUsd ? calcBmdUsd(bmdUsd, formBmd.spread, formBmd.sign) : null;
  const canSubmit = form.buyer.trim() && (form.price_mt || form.price_lb);

  return (
    <div style={{ padding: "20px 16px", background: "#fff", borderBottom: "1px solid #e5e7eb" }}>
      <div style={{ fontSize: "13px", fontWeight: 700, color: "#0073ea", marginBottom: "16px", letterSpacing: "0.02em" }}>
        {editId ? "✎ Edit Quote" : "+ New Quote"}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "12px" }}>
        <div className="form-field">
          <label>Date</label>
          <input type="date" className="field-input" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} />
        </div>
        <div className="form-field">
          <label>Status</label>
          <select className="field-input" value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
            {STATUSES.map(s => <option key={s}>{s}</option>)}
          </select>
        </div>
        <div className="form-field" style={{ gridColumn: "1 / -1" }}>
          <label>Buyer</label>
          <Combobox value={form.buyer} onChange={v => setForm(f => ({ ...f, buyer: v }))} options={allBuyers} placeholder="Company name" onAdd={onAddBuyer} />
        </div>
        <div className="form-field" style={{ gridColumn: "1 / -1" }}>
          <label>Product</label>
          <Combobox value={form.product} onChange={v => setForm(f => ({ ...f, product: v }))} options={allProds} placeholder="Select or add product" onAdd={onAddProduct} />
        </div>
        <div className="form-field">
          <label>Terms</label>
          <select className="field-input" value={form.terms} onChange={e => setForm(f => ({ ...f, terms: e.target.value }))}>
            {TERMS.map(t => <option key={t}>{t}</option>)}
          </select>
        </div>
        <div className="form-field">
          <label>$ / MT &nbsp;<span style={{ fontWeight: 400, color: "#9ca3af", fontSize: "11px" }}>or BMD+spread</span></label>
          <input className="field-input" placeholder="850.00 or BMD+250" value={form.price_mt} onChange={e => setPriceMT(e.target.value)} />
          {formBmd.isBmd && (
            <div style={{ marginTop: "5px", fontSize: "12px", color: formBmdUsd ? "#166534" : "#9ca3af" }}>
              {formBmdUsd ? `≈ $${fmt(formBmdUsd)} / MT · $${fmt(formBmdUsd / MT_TO_LB, 4)} / lb` : "Set BMD price to resolve"}
            </div>
          )}
        </div>
        <div className="form-field" style={{ gridColumn: "1 / -1" }}>
          <label>$ / LB</label>
          <input className="field-input" placeholder="auto-calculated" value={form.price_lb}
            disabled={formBmd.isBmd}
            style={{ opacity: formBmd.isBmd ? 0.4 : 1 }}
            onChange={e => setPriceLB(e.target.value)} />
        </div>
        <div className="form-field" style={{ gridColumn: "1 / -1" }}>
          <label>Notes</label>
          <input className="field-input" placeholder="Context, comparisons, follow-up…" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
        </div>
      </div>
      <div style={{ display: "flex", gap: "10px", marginTop: "16px" }}>
        <button onClick={onSubmit} disabled={saving || !canSubmit}
          style={{ flex: 1, background: canSubmit ? "#0073ea" : "#e5e7eb", color: canSubmit ? "#fff" : "#9ca3af", border: "none", padding: "12px", borderRadius: "8px", fontSize: "14px", fontWeight: 600, cursor: canSubmit ? "pointer" : "default", fontFamily: "inherit", transition: "all 0.15s" }}>
          {saving ? "Saving…" : editId ? "Update Quote" : "Save Quote"}
        </button>
        <button onClick={onCancel}
          style={{ background: "#f3f4f6", color: "#6b7280", border: "none", padding: "12px 20px", borderRadius: "8px", fontSize: "14px", cursor: "pointer", fontFamily: "inherit" }}>
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── Quote Card (mobile) ───────────────────────────────────────────────
function QuoteCard({ q, bmdUsd, onEdit, onDelete, onStatusChange }) {
  const usd = q.is_bmd ? (bmdUsd ? calcBmdUsd(bmdUsd, q.bmd_spread, q.bmd_sign) : null) : q.price_mt;
  const lb  = usd ? usd / MT_TO_LB : q.price_lb;
  return (
    <div style={{ background: "#fff", borderRadius: "10px", border: "1px solid #e5e7eb", padding: "14px 16px", marginBottom: "10px", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "8px" }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: "15px", color: "#111827" }}>{q.buyer}</div>
          {q.product && <div style={{ fontSize: "12px", color: "#6b7280", marginTop: "2px" }}>{q.product}</div>}
        </div>
        <select value={q.status} onChange={e => onStatusChange(q.id, e.target.value)}
          style={{ background: STATUS_CFG[q.status]?.bg, color: STATUS_CFG[q.status]?.color, border: `1px solid ${STATUS_CFG[q.status]?.border}`, borderRadius: "20px", padding: "4px 10px", fontSize: "11px", fontWeight: 700, cursor: "pointer", fontFamily: "inherit", appearance: "none", outline: "none" }}>
          {STATUSES.map(s => <option key={s}>{s}</option>)}
        </select>
      </div>

      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "10px", alignItems: "center" }}>
        <Pill cfg={TERMS_CFG[q.terms] || TERMS_CFG.FOB} small>{q.terms}</Pill>
        <span style={{ fontSize: "11px", color: "#9ca3af" }}>{q.date}</span>
      </div>

      <div style={{ background: "#f9fafb", borderRadius: "8px", padding: "10px 12px", marginBottom: "10px" }}>
        {q.is_bmd ? (
          <div>
            <div style={{ fontSize: "13px", fontWeight: 600, color: "#374151" }}>
              {q.price_mt_raw}
              {usd && <span style={{ fontWeight: 400, color: "#6b7280", marginLeft: "8px", fontSize: "12px" }}>= ${fmt(usd)} / MT</span>}
            </div>
            {usd && <div style={{ fontSize: "12px", color: "#6b7280", marginTop: "2px" }}>${fmt(lb, 4)} / lb</div>}
            {!usd && <div style={{ fontSize: "11px", color: "#9ca3af", marginTop: "2px" }}>Set BMD price to resolve</div>}
          </div>
        ) : usd != null ? (
          <div>
            <div style={{ fontSize: "15px", fontWeight: 700, color: "#111827", fontVariantNumeric: "tabular-nums" }}>
              ${fmt(usd)} <span style={{ fontSize: "12px", fontWeight: 400, color: "#6b7280" }}>/ MT</span>
            </div>
            {lb && <div style={{ fontSize: "12px", color: "#6b7280", marginTop: "2px", fontVariantNumeric: "tabular-nums" }}>${fmt(lb, 4)} / lb</div>}
          </div>
        ) : <span style={{ color: "#d1d5db", fontSize: "13px" }}>No price</span>}
      </div>

      {q.notes && <div style={{ fontSize: "13px", color: "#6b7280", fontStyle: "italic", marginBottom: "10px", lineHeight: 1.4 }}>{q.notes}</div>}

      <div style={{ display: "flex", gap: "8px", borderTop: "1px solid #f3f4f6", paddingTop: "10px" }}>
        <button onClick={() => onEdit(q)} style={{ flex: 1, background: "#f0f7ff", color: "#0073ea", border: "none", padding: "8px", borderRadius: "6px", fontSize: "13px", fontWeight: 500, cursor: "pointer", fontFamily: "inherit" }}>Edit</button>
        <button onClick={() => onDelete(q.id)} style={{ flex: 1, background: "#fff5f5", color: "#dc2626", border: "none", padding: "8px", borderRadius: "6px", fontSize: "13px", fontWeight: 500, cursor: "pointer", fontFamily: "inherit" }}>Delete</button>
      </div>
    </div>
  );
}

// ── Main App ──────────────────────────────────────────────────────────
export default function App() {
  const [quotes,   setQuotes]   = useState([]);
  const [buyers,   setBuyers]   = useState([]);
  const [prods,    setProds]    = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [form,     setForm]     = useState(emptyForm());
  const [editId,   setEditId]   = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [saving,   setSaving]   = useState(false);
  const [tab,      setTab]      = useState("quotes"); // quotes | buyers | products
  const [sfStatus, setSfStatus] = useState("All");
  const [sfBuyer,  setSfBuyer]  = useState("All");
  const [bmdUsd,   setBmdUsd]   = useState("");
  const [bmdInput, setBmdInput] = useState("");
  const [bmdTs,    setBmdTs]    = useState(null);
  const [showBmd,  setShowBmd]  = useState(false);
  const [newBuyer, setNewBuyer] = useState("");
  const [newProd,  setNewProd]  = useState("");

  useEffect(() => { loadAll(); }, []);

  async function loadAll() {
    setLoading(true);
    try {
      const [{ data: q }, { data: b }, { data: p }, { data: bmd }] = await Promise.all([
        supabase.from("quotes").select("*").order("created_at", { ascending: false }),
        supabase.from("buyers").select("*").order("name"),
        supabase.from("products").select("*").order("name"),
        supabase.from("bmd_settings").select("*").eq("id", 1).single(),
      ]);
      if (q)   setQuotes(q);
      if (b)   setBuyers(b.map(x => x.name));
      if (p)   setProds(p.map(x => x.name));
      if (bmd) {
        setBmdUsd(bmd.bmd_myr || "");
        setBmdInput(bmd.bmd_myr || "");
        setBmdTs(bmd.updated_at || null);
      }
    } catch (_) {}
    setLoading(false);
  }

  async function addBuyer(name) {
    if (!name.trim()) return;
    await supabase.from("buyers").upsert({ name: name.trim() });
    setBuyers(b => [...new Set([...b, name.trim()])].sort());
  }
  async function addProduct(name) {
    if (!name.trim()) return;
    await supabase.from("products").upsert({ name: name.trim() });
    setProds(p => [...new Set([...p, name.trim()])].sort());
  }
  async function deleteBuyer(name) {
    await supabase.from("buyers").delete().eq("name", name);
    setBuyers(b => b.filter(x => x !== name));
  }
  async function deleteProduct(name) {
    await supabase.from("products").delete().eq("name", name);
    setProds(p => p.filter(x => x !== name));
  }

  async function saveBmd() {
    const now = new Date().toISOString();
    await supabase.from("bmd_settings").upsert({ id: 1, bmd_myr: bmdInput, fx_rate: "1", updated_at: now });
    setBmdUsd(bmdInput); setBmdTs(now); setShowBmd(false);
  }

  async function submit() {
    if (!form.buyer.trim() || (!form.price_mt && !form.price_lb)) return;
    setSaving(true);
    const bmd = parseBmd(form.price_mt);
    const entry = {
      id: editId || Date.now().toString(),
      buyer: form.buyer, product: form.product, terms: form.terms,
      price_mt_raw: form.price_mt,
      price_mt: bmd.isBmd ? null : (parseFloat(form.price_mt) || null),
      price_lb: bmd.isBmd ? null : (parseFloat(form.price_lb) || null),
      is_bmd: bmd.isBmd,
      bmd_spread: bmd.isBmd ? bmd.spread : null,
      bmd_sign: bmd.isBmd ? bmd.sign : null,
      date: form.date, status: form.status, notes: form.notes,
      created_at: editId ? (quotes.find(q => q.id === editId)?.created_at || new Date().toISOString()) : new Date().toISOString(),
    };
    await supabase.from("quotes").upsert(entry);
    if (!buyers.includes(form.buyer.trim())) await addBuyer(form.buyer.trim());
    await loadAll();
    setSaving(false); setForm(emptyForm()); setEditId(null); setShowForm(false);
  }

  async function patchStatus(id, status) {
    await supabase.from("quotes").update({ status }).eq("id", id);
    setQuotes(qs => qs.map(q => q.id === id ? { ...q, status } : q));
  }
  async function deleteQuote(id) {
    await supabase.from("quotes").delete().eq("id", id);
    setQuotes(qs => qs.filter(q => q.id !== id));
  }
  function startEdit(q) {
    setForm({ date: q.date, buyer: q.buyer, product: q.product || "", terms: q.terms,
      price_mt: q.price_mt_raw || (q.price_mt != null ? String(q.price_mt) : ""),
      price_lb: q.price_lb != null ? String(q.price_lb) : "",
      notes: q.notes || "", status: q.status });
    setEditId(q.id); setShowForm(true); setTab("quotes");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  function cancel() { setForm(emptyForm()); setEditId(null); setShowForm(false); }

  const allBuyers = [...new Set([...buyers, ...quotes.map(q => q.buyer)])].filter(Boolean).sort();
  const allProds  = [...new Set([...prods,  ...quotes.map(q => q.product)])].filter(Boolean).sort();

  const filtered = quotes.filter(q =>
    (sfStatus === "All" || q.status === sfStatus) &&
    (sfBuyer  === "All" || q.buyer  === sfBuyer)
  );
  const counts = Object.fromEntries(STATUSES.map(s => [s, quotes.filter(q => q.status === s).length]));

  function fmtTs(iso) {
    if (!iso) return "";
    return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  }

  return (
    <div style={{ minHeight: "100vh", background: "#f3f4f6", fontFamily: "'Outfit', sans-serif", color: "#111827" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        input::placeholder { color: #d1d5db; }
        select option { background: #fff; color: #111827; }
        ::-webkit-scrollbar { width: 4px; height: 4px; }
        ::-webkit-scrollbar-thumb { background: #d1d5db; border-radius: 2px; }
        input[type=date]::-webkit-calendar-picker-indicator { cursor: pointer; opacity: 0.5; }
        .field-input {
          width: 100%; background: #fff; border: 1.5px solid #e5e7eb;
          border-radius: 8px; color: #111827; padding: 10px 12px;
          font-size: 14px; font-family: inherit; outline: none;
          box-sizing: border-box; transition: border-color 0.15s, box-shadow 0.15s;
          appearance: none;
        }
        .field-input:focus { border-color: #0073ea; box-shadow: 0 0 0 3px rgba(0,115,234,0.1); }
        .form-field label {
          display: block; font-size: 11px; font-weight: 600;
          color: #6b7280; letter-spacing: 0.08em; text-transform: uppercase; margin-bottom: 5px;
        }
        .tab-item { cursor: pointer; transition: all 0.15s; }
        .list-item-btn { transition: background 0.1s; cursor: pointer; }
        .list-item-btn:hover { background: #f9fafb; }
      `}</style>

      {/* ── Top nav ── */}
      <div style={{ background: "#1e1b4b", padding: "0 16px", position: "sticky", top: 0, zIndex: 50 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", height: "52px" }}>
          <div>
            <div style={{ fontSize: "15px", fontWeight: 700, color: "#fff", letterSpacing: "-0.01em" }}>Core Provisions</div>
            <div style={{ fontSize: "9px", color: "#6366f1", letterSpacing: "0.16em", textTransform: "uppercase" }}>Quote Ledger</div>
          </div>
          {/* BMD display / edit */}
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            {bmdUsd && !showBmd && (
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: "13px", fontWeight: 700, color: "#a5f3fc" }}>${fmt(parseFloat(bmdUsd))} <span style={{ fontSize: "10px", fontWeight: 400, color: "#6366f1" }}>BMD/MT</span></div>
              </div>
            )}
            <button onClick={() => setShowBmd(s => !s)}
              style={{ background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.15)", color: "#c7d2fe", padding: "6px 12px", borderRadius: "6px", fontSize: "12px", cursor: "pointer", fontFamily: "inherit", fontWeight: 500 }}>
              {showBmd ? "Done" : bmdUsd ? "BMD ✎" : "Set BMD"}
            </button>
          </div>
        </div>

        {/* BMD edit panel */}
        {showBmd && (
          <div style={{ paddingBottom: "14px", display: "flex", gap: "8px", alignItems: "flex-end" }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: "10px", color: "#a5b4fc", marginBottom: "4px", letterSpacing: "0.1em", textTransform: "uppercase" }}>BMD Price (USD / MT)</div>
              <input value={bmdInput} onChange={e => setBmdInput(e.target.value)} placeholder="e.g. 987.50"
                style={{ width: "100%", background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.2)", borderRadius: "6px", color: "#fff", padding: "8px 10px", fontSize: "14px", fontFamily: "inherit", outline: "none" }} />
            </div>
            <button onClick={saveBmd} disabled={!bmdInput}
              style={{ background: "#0073ea", border: "none", color: "#fff", padding: "8px 16px", borderRadius: "6px", fontSize: "13px", fontWeight: 600, cursor: "pointer", fontFamily: "inherit", opacity: bmdInput ? 1 : 0.4, whiteSpace: "nowrap" }}>
              Save
            </button>
          </div>
        )}
        {bmdTs && !showBmd && <div style={{ fontSize: "9px", color: "#4338ca", paddingBottom: "6px" }}>Updated {fmtTs(bmdTs)}</div>}
      </div>

      {/* ── Tabs ── */}
      <div style={{ background: "#fff", borderBottom: "1px solid #e5e7eb", display: "flex", padding: "0 16px" }}>
        {[["quotes", "Quotes"], ["buyers", "Buyers"], ["products", "Products"]].map(([key, label]) => (
          <button key={key} className="tab-item"
            onClick={() => { setTab(key); cancel(); }}
            style={{ padding: "12px 16px", fontSize: "13px", fontWeight: tab === key ? 700 : 400, color: tab === key ? "#0073ea" : "#6b7280", background: "none", border: "none", borderBottom: tab === key ? "2px solid #0073ea" : "2px solid transparent", cursor: "pointer", fontFamily: "inherit", marginBottom: "-1px" }}>
            {label}
            {key === "quotes" && <span style={{ marginLeft: "6px", background: "#f3f4f6", color: "#6b7280", fontSize: "11px", fontWeight: 600, padding: "1px 7px", borderRadius: "20px" }}>{quotes.length}</span>}
          </button>
        ))}
      </div>

      {/* ── Quotes tab ── */}
      {tab === "quotes" && (
        <div style={{ padding: "0" }}>
          {/* New quote button */}
          {!showForm && (
            <div style={{ padding: "12px 16px", background: "#fff", borderBottom: "1px solid #f3f4f6" }}>
              <button onClick={() => setShowForm(true)}
                style={{ width: "100%", background: "#0073ea", color: "#fff", border: "none", padding: "12px", borderRadius: "8px", fontSize: "14px", fontWeight: 600, cursor: "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", justifyContent: "center", gap: "6px" }}>
                + New Quote
              </button>
            </div>
          )}

          {/* Form */}
          {showForm && (
            <QuoteForm form={form} setForm={setForm} onSubmit={submit} onCancel={cancel}
              saving={saving} editId={editId} bmdUsd={bmdUsd}
              allBuyers={allBuyers} allProds={allProds}
              onAddBuyer={addBuyer} onAddProduct={addProduct} />
          )}

          {/* Status filter pills */}
          <div style={{ padding: "12px 16px", background: "#fff", borderBottom: "1px solid #f3f4f6", display: "flex", gap: "6px", overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
            {["All", ...STATUSES].map(s => {
              const active = sfStatus === s;
              const c = s === "All" ? quotes.length : (counts[s] || 0);
              return (
                <button key={s} onClick={() => setSfStatus(s)}
                  style={{ background: active ? "#0073ea" : "#f3f4f6", color: active ? "#fff" : "#6b7280", border: "none", padding: "6px 12px", borderRadius: "20px", fontSize: "12px", fontWeight: active ? 600 : 400, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap", flexShrink: 0 }}>
                  {s} {c > 0 ? `· ${c}` : ""}
                </button>
              );
            })}
          </div>

          {/* Buyer filter */}
          {allBuyers.length > 1 && (
            <div style={{ padding: "8px 16px", background: "#fff", borderBottom: "1px solid #f3f4f6" }}>
              <select value={sfBuyer} onChange={e => setSfBuyer(e.target.value)}
                style={{ background: sfBuyer === "All" ? "#f3f4f6" : "#eff6ff", border: "1.5px solid " + (sfBuyer === "All" ? "#e5e7eb" : "#bfdbfe"), color: sfBuyer === "All" ? "#6b7280" : "#1d4ed8", padding: "7px 12px", borderRadius: "8px", fontSize: "13px", fontWeight: 500, cursor: "pointer", fontFamily: "inherit", appearance: "none", outline: "none", width: "100%" }}>
                <option value="All">All Buyers</option>
                {allBuyers.map(b => <option key={b}>{b}</option>)}
              </select>
            </div>
          )}

          {/* Quote list */}
          <div style={{ padding: "12px 16px" }}>
            {loading ? (
              <div style={{ textAlign: "center", padding: "60px 0", color: "#9ca3af" }}>Loading…</div>
            ) : filtered.length === 0 ? (
              <div style={{ textAlign: "center", padding: "60px 0" }}>
                <div style={{ fontSize: "32px", marginBottom: "10px" }}>📋</div>
                <div style={{ fontSize: "15px", fontWeight: 600, color: "#9ca3af" }}>{quotes.length === 0 ? "No quotes yet" : "No quotes match"}</div>
                {quotes.length === 0 && <div style={{ fontSize: "13px", color: "#d1d5db", marginTop: "4px" }}>Tap + New Quote to get started</div>}
              </div>
            ) : filtered.map(q => (
              <QuoteCard key={q.id} q={q} bmdUsd={bmdUsd}
                onEdit={startEdit} onDelete={deleteQuote} onStatusChange={patchStatus} />
            ))}
          </div>
        </div>
      )}

      {/* ── Buyers tab ── */}
      {tab === "buyers" && (
        <div style={{ padding: "16px" }}>
          <div style={{ background: "#fff", borderRadius: "10px", border: "1px solid #e5e7eb", overflow: "hidden", marginBottom: "16px" }}>
            <div style={{ padding: "14px 16px", borderBottom: "1px solid #f3f4f6", display: "flex", gap: "8px" }}>
              <input className="field-input" style={{ flex: 1 }} placeholder="Add new buyer…" value={newBuyer} onChange={e => setNewBuyer(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && newBuyer.trim()) { addBuyer(newBuyer.trim()); setNewBuyer(""); } }} />
              <button onClick={() => { if (newBuyer.trim()) { addBuyer(newBuyer.trim()); setNewBuyer(""); } }}
                style={{ background: "#0073ea", color: "#fff", border: "none", padding: "10px 16px", borderRadius: "8px", fontSize: "13px", fontWeight: 600, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" }}>
                Add
              </button>
            </div>
            {buyers.length === 0 ? (
              <div style={{ padding: "32px", textAlign: "center", color: "#9ca3af", fontSize: "14px" }}>No buyers yet</div>
            ) : buyers.map(b => (
              <div key={b} className="list-item-btn" style={{ padding: "12px 16px", borderBottom: "1px solid #f9fafb", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: "14px", fontWeight: 500, color: "#111827" }}>{b}</span>
                <button onClick={() => deleteBuyer(b)} style={{ background: "none", border: "none", color: "#d1d5db", cursor: "pointer", fontSize: "16px", padding: "0 4px" }}>✕</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Products tab ── */}
      {tab === "products" && (
        <div style={{ padding: "16px" }}>
          <div style={{ background: "#fff", borderRadius: "10px", border: "1px solid #e5e7eb", overflow: "hidden", marginBottom: "16px" }}>
            <div style={{ padding: "14px 16px", borderBottom: "1px solid #f3f4f6", display: "flex", gap: "8px" }}>
              <input className="field-input" style={{ flex: 1 }} placeholder="Add new product…" value={newProd} onChange={e => setNewProd(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && newProd.trim()) { addProduct(newProd.trim()); setNewProd(""); } }} />
              <button onClick={() => { if (newProd.trim()) { addProduct(newProd.trim()); setNewProd(""); } }}
                style={{ background: "#0073ea", color: "#fff", border: "none", padding: "10px 16px", borderRadius: "8px", fontSize: "13px", fontWeight: 600, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" }}>
                Add
              </button>
            </div>
            {prods.length === 0 ? (
              <div style={{ padding: "32px", textAlign: "center", color: "#9ca3af", fontSize: "14px" }}>No products yet</div>
            ) : prods.map(p => (
              <div key={p} className="list-item-btn" style={{ padding: "12px 16px", borderBottom: "1px solid #f9fafb", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: "14px", fontWeight: 500, color: "#111827" }}>{p}</span>
                <button onClick={() => deleteProduct(p)} style={{ background: "none", border: "none", color: "#d1d5db", cursor: "pointer", fontSize: "16px", padding: "0 4px" }}>✕</button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
