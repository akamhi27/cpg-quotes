import { useState, useEffect, useRef } from "react";
import { supabase } from "./supabase";

const MT_TO_LB = 2204.62;
const MT_TO_L  = 1000; // approximate for palm oil (density ~0.9, but 1 MT = ~1111L; use user-entered density? Keep simple: just show $/L entered)
const TERMS = ["FOB", "CFR", "CIF", "Delivered"];
const STATUSES = ["Pending", "Accepted", "Rejected", "Countered", "Expired"];
const UNITS = ["$/MT", "$/lb", "$/liter"];

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

// Convert any unit to $/MT for cross-unit display
function toMT(value, unit) {
  const v = parseFloat(value);
  if (isNaN(v)) return null;
  if (unit === "$/MT") return v;
  if (unit === "$/lb") return v * MT_TO_LB;
  if (unit === "$/liter") return null; // can't reliably convert without density
  return null;
}
function toLB(value, unit) {
  const v = parseFloat(value);
  if (isNaN(v)) return null;
  if (unit === "$/lb") return v;
  if (unit === "$/MT") return v / MT_TO_LB;
  if (unit === "$/liter") return null;
  return null;
}

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
      padding: small ? "2px 8px" : "3px 10px", borderRadius: "20px",
      fontSize: small ? "10px" : "11px", fontWeight: 600,
      background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.border}`,
      whiteSpace: "nowrap",
    }}>{children}</span>
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
        <div style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, background: "#fff", border: "1px solid #e5e7eb", borderRadius: "8px", zIndex: 300, overflow: "hidden", boxShadow: "0 10px 30px rgba(0,0,0,0.12)" }}>
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
  return { date: new Date().toISOString().split("T")[0], buyer: "", product: "", terms: "FOB", price: "", unit: "$/MT", notes: "", status: "Pending" };
}

// Resolve what to display for a quote's price
function resolvePrice(q, bmdUsd) {
  if (q.is_bmd) {
    const resolved = bmdUsd ? calcBmdUsd(bmdUsd, q.bmd_spread, q.bmd_sign) : null;
    return {
      primary: q.price_mt_raw,           // "BMD+250"
      primaryUnit: "$/MT",
      resolved: resolved,
      resolvedUnit: "$/MT",
      secondary: resolved ? fmt(resolved / MT_TO_LB, 4) : null,
      secondaryUnit: "$/lb",
      isBmd: true,
    };
  }
  const v = parseFloat(q.price_value);
  const unit = q.price_unit || "$/MT";
  if (isNaN(v)) return null;

  let secondary = null, secondaryUnit = null;
  if (unit === "$/MT") { secondary = fmt(v / MT_TO_LB, 4); secondaryUnit = "$/lb"; }
  if (unit === "$/lb") { secondary = fmt(v * MT_TO_LB, 2); secondaryUnit = "$/MT"; }
  // $/liter: just show as-is, no reliable conversion

  return { primary: fmt(v, unit === "$/lb" ? 4 : 2), primaryUnit: unit, secondary, secondaryUnit, isBmd: false };
}

// ── Quote Form ────────────────────────────────────────────────────────
function QuoteForm({ form, setForm, onSubmit, onCancel, saving, editId, bmdUsd, allBuyers, allProds, onAddBuyer, onAddProduct }) {
  const formBmd = parseBmd(form.price);
  const formBmdUsd = formBmd.isBmd && bmdUsd ? calcBmdUsd(bmdUsd, formBmd.spread, formBmd.sign) : null;
  const canSubmit = form.buyer.trim() && form.price.trim();

  return (
    <div className="form-panel">
      <div style={{ fontSize: "13px", fontWeight: 700, color: "#0073ea", marginBottom: "16px" }}>
        {editId ? "✎ Edit Quote" : "+ New Quote"}
      </div>
      <div className="form-grid">
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
        <div className="form-field form-full">
          <label>Buyer</label>
          <Combobox value={form.buyer} onChange={v => setForm(f => ({ ...f, buyer: v }))} options={allBuyers} placeholder="Company name" onAdd={onAddBuyer} />
        </div>
        <div className="form-field form-full">
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
          <label>Unit</label>
          <select className="field-input" value={form.unit} onChange={e => setForm(f => ({ ...f, unit: e.target.value, price: "" }))}>
            {UNITS.map(u => <option key={u}>{u}</option>)}
          </select>
        </div>
        <div className="form-field form-full">
          <label>
            Price &nbsp;
            <span style={{ fontWeight: 400, color: "#9ca3af", fontSize: "11px", textTransform: "none" }}>
              {form.unit === "$/MT" ? "enter $/MT, or type BMD+spread (e.g. BMD+250)" : `enter ${form.unit}`}
            </span>
          </label>
          <input className="field-input" placeholder={form.unit === "$/MT" ? "850.00 or BMD+250" : form.unit === "$/lb" ? "0.3900" : "0.7500"}
            value={form.price} onChange={e => setForm(f => ({ ...f, price: e.target.value }))} />
          {/* BMD resolution hint */}
          {formBmd.isBmd && (
            <div style={{ marginTop: "5px", fontSize: "12px", color: formBmdUsd ? "#166534" : "#9ca3af" }}>
              {formBmdUsd ? `= $${fmt(formBmdUsd)} /MT · $${fmt(formBmdUsd / MT_TO_LB, 4)} /lb` : "Set BMD price in header to resolve"}
            </div>
          )}
          {/* Live conversion preview */}
          {!formBmd.isBmd && form.price && !isNaN(parseFloat(form.price)) && form.unit !== "$/liter" && (
            <div style={{ marginTop: "5px", fontSize: "12px", color: "#6b7280" }}>
              {form.unit === "$/MT" && `= $${fmt(parseFloat(form.price) / MT_TO_LB, 4)} /lb`}
              {form.unit === "$/lb" && `= $${fmt(parseFloat(form.price) * MT_TO_LB, 2)} /MT`}
            </div>
          )}
        </div>
        <div className="form-field form-full">
          <label>Notes</label>
          <input className="field-input" placeholder="Context, comparisons, follow-up…" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
        </div>
      </div>
      <div style={{ display: "flex", gap: "10px", marginTop: "16px" }}>
        <button onClick={onSubmit} disabled={saving || !canSubmit}
          style={{ flex: 1, background: canSubmit ? "#0073ea" : "#e5e7eb", color: canSubmit ? "#fff" : "#9ca3af", border: "none", padding: "11px", borderRadius: "8px", fontSize: "14px", fontWeight: 600, cursor: canSubmit ? "pointer" : "default", fontFamily: "inherit" }}>
          {saving ? "Saving…" : editId ? "Update Quote" : "Save Quote"}
        </button>
        <button onClick={onCancel} style={{ background: "#f3f4f6", color: "#6b7280", border: "none", padding: "11px 20px", borderRadius: "8px", fontSize: "14px", cursor: "pointer", fontFamily: "inherit" }}>
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── Price display component ───────────────────────────────────────────
function PriceDisplay({ q, bmdUsd, size = "normal" }) {
  const p = resolvePrice(q, bmdUsd);
  if (!p) return <span style={{ color: "#d1d5db" }}>—</span>;
  const big = size === "big";
  return (
    <div>
      {p.isBmd ? (
        <>
          <div style={{ fontWeight: 700, fontSize: big ? "15px" : "13px", color: "#374151" }}>
            {p.primary}
            {p.resolved != null && (
              <span style={{ fontWeight: 400, color: "#9ca3af", marginLeft: "6px", fontSize: big ? "13px" : "11px" }}>
                = ${fmt(p.resolved)}/MT
              </span>
            )}
          </div>
          {p.secondary && <div style={{ fontSize: big ? "12px" : "11px", color: "#9ca3af", marginTop: "1px" }}>${p.secondary}/lb</div>}
          {!p.resolved && <div style={{ fontSize: "11px", color: "#d1d5db", marginTop: "1px" }}>set BMD to resolve</div>}
        </>
      ) : (
        <>
          <div style={{ fontWeight: 700, fontSize: big ? "16px" : "14px", color: "#111827", fontVariantNumeric: "tabular-nums" }}>
            ${p.primary} <span style={{ fontWeight: 400, fontSize: big ? "13px" : "11px", color: "#9ca3af" }}>{p.primaryUnit}</span>
          </div>
          {p.secondary && (
            <div style={{ fontSize: big ? "12px" : "11px", color: "#9ca3af", marginTop: "1px", fontVariantNumeric: "tabular-nums" }}>
              ${p.secondary} {p.secondaryUnit}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Desktop table row ─────────────────────────────────────────────────
function QuoteRow({ q, bmdUsd, onEdit, onDelete, onStatusChange }) {
  return (
    <div className="quote-row">
      <div className="qcol date-col">{q.date}</div>
      <div className="qcol">
        <div style={{ fontWeight: 600, fontSize: "14px", color: "#111827" }}>{q.buyer}</div>
        {q.product && <div style={{ fontSize: "12px", color: "#9ca3af", marginTop: "1px" }}>{q.product}</div>}
      </div>
      <div className="qcol"><Pill cfg={TERMS_CFG[q.terms] || TERMS_CFG.FOB} small>{q.terms}</Pill></div>
      <div className="qcol"><PriceDisplay q={q} bmdUsd={bmdUsd} /></div>
      <div className="qcol">
        <select value={q.status} onChange={e => onStatusChange(q.id, e.target.value)}
          style={{ background: STATUS_CFG[q.status]?.bg, color: STATUS_CFG[q.status]?.color, border: `1px solid ${STATUS_CFG[q.status]?.border}`, borderRadius: "20px", padding: "4px 10px", fontSize: "11px", fontWeight: 700, cursor: "pointer", fontFamily: "inherit", appearance: "none", outline: "none" }}>
          {STATUSES.map(s => <option key={s}>{s}</option>)}
        </select>
      </div>
      <div className="qcol notes-col">{q.notes || <span style={{ color: "#e5e7eb" }}>—</span>}</div>
      <div className="qcol action-col">
        <button onClick={() => onEdit(q)} className="action-btn edit-btn">✎</button>
        <button onClick={() => onDelete(q.id)} className="action-btn del-btn">✕</button>
      </div>
    </div>
  );
}

// ── Mobile card ───────────────────────────────────────────────────────
function QuoteCard({ q, bmdUsd, onEdit, onDelete, onStatusChange }) {
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
      <div style={{ display: "flex", gap: "8px", alignItems: "center", marginBottom: "10px" }}>
        <Pill cfg={TERMS_CFG[q.terms] || TERMS_CFG.FOB} small>{q.terms}</Pill>
        <span style={{ fontSize: "11px", color: "#9ca3af" }}>{q.date}</span>
      </div>
      <div style={{ background: "#f9fafb", borderRadius: "8px", padding: "10px 12px", marginBottom: "10px" }}>
        <PriceDisplay q={q} bmdUsd={bmdUsd} size="big" />
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
  const [tab,      setTab]      = useState("quotes");
  const [sfStatus, setSfStatus] = useState("All");
  const [sfBuyer,  setSfBuyer]  = useState("All");
  const [sfProd,   setSfProd]   = useState("All");
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
      if (q) setQuotes(q);
      if (b) setBuyers(b.map(x => x.name));
      if (p) setProds(p.map(x => x.name));
      if (bmd) { setBmdUsd(bmd.bmd_myr || ""); setBmdInput(bmd.bmd_myr || ""); setBmdTs(bmd.updated_at || null); }
    } catch (_) {}
    setLoading(false);
  }

  async function addBuyer(name) { if (!name.trim()) return; await supabase.from("buyers").upsert({ name: name.trim() }); setBuyers(b => [...new Set([...b, name.trim()])].sort()); }
  async function addProduct(name) { if (!name.trim()) return; await supabase.from("products").upsert({ name: name.trim() }); setProds(p => [...new Set([...p, name.trim()])].sort()); }
  async function deleteBuyer(name) { await supabase.from("buyers").delete().eq("name", name); setBuyers(b => b.filter(x => x !== name)); }
  async function deleteProduct(name) { await supabase.from("products").delete().eq("name", name); setProds(p => p.filter(x => x !== name)); }

  async function saveBmd() {
    const now = new Date().toISOString();
    await supabase.from("bmd_settings").upsert({ id: 1, bmd_myr: bmdInput, fx_rate: "1", updated_at: now });
    setBmdUsd(bmdInput); setBmdTs(now); setShowBmd(false);
  }

  async function submit() {
    if (!form.buyer.trim() || !form.price.trim()) return;
    setSaving(true);
    const bmd = parseBmd(form.price);
    const entry = {
      id: editId || Date.now().toString(),
      buyer: form.buyer, product: form.product, terms: form.terms,
      price_mt_raw: form.price,
      price_value: bmd.isBmd ? null : parseFloat(form.price),
      price_unit: bmd.isBmd ? "$/MT" : form.unit,
      // legacy fields kept for compatibility
      price_mt: bmd.isBmd ? null : (form.unit === "$/MT" ? parseFloat(form.price) : null),
      price_lb: bmd.isBmd ? null : (form.unit === "$/lb" ? parseFloat(form.price) : null),
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
    // Reconstruct unit from stored data
    let unit = q.price_unit || (q.price_lb != null && q.price_mt == null ? "$/lb" : "$/MT");
    let price = q.price_mt_raw || (q.price_value != null ? String(q.price_value) : q.price_mt != null ? String(q.price_mt) : q.price_lb != null ? String(q.price_lb) : "");
    setForm({ date: q.date, buyer: q.buyer, product: q.product || "", terms: q.terms, price, unit, notes: q.notes || "", status: q.status });
    setEditId(q.id); setShowForm(true); setTab("quotes");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  function cancel() { setForm(emptyForm()); setEditId(null); setShowForm(false); }

  function filterByBuyer(name) { setSfBuyer(name); setSfProd("All"); setTab("quotes"); }
  function filterByProduct(name) { setSfProd(name); setSfBuyer("All"); setTab("quotes"); }

  const allBuyers = [...new Set([...buyers, ...quotes.map(q => q.buyer)])].filter(Boolean).sort();
  const allProds  = [...new Set([...prods,  ...quotes.map(q => q.product)])].filter(Boolean).sort();

  const filtered = quotes.filter(q =>
    (sfStatus === "All" || q.status === sfStatus) &&
    (sfBuyer  === "All" || q.buyer   === sfBuyer) &&
    (sfProd   === "All" || q.product === sfProd)
  );
  const counts = Object.fromEntries(STATUSES.map(s => [s, quotes.filter(q => q.status === s).length]));

  function fmtTs(iso) {
    if (!iso) return "";
    return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  }

  const TABLE_COLS = "96px 1.8fr 80px 1.6fr 130px 1.4fr 70px";

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
          transition: border-color 0.15s, box-shadow 0.15s; appearance: none;
        }
        .field-input:focus { border-color: #0073ea; box-shadow: 0 0 0 3px rgba(0,115,234,0.1); }
        .form-field label {
          display: block; font-size: 11px; font-weight: 600;
          color: #6b7280; letter-spacing: 0.08em; text-transform: uppercase; margin-bottom: 5px;
        }
        .form-panel { padding: 20px 24px; background: #fff; border-bottom: 2px solid #e8f0fe; }
        .form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px 20px; }
        .form-full { grid-column: 1 / -1; }

        /* Desktop table */
        .quote-table { display: block; background: #fff; }
        .quote-cards { display: none; padding: 14px; }

        .quote-row {
          display: grid; grid-template-columns: ${TABLE_COLS};
          padding: 0 20px; min-height: 52px; align-items: center;
          border-bottom: 1px solid #f3f4f6; transition: background 0.1s; background: #fff;
        }
        .quote-row:hover { background: #f8faff; }
        .qcol { padding: 10px 8px; }
        .date-col { font-size: 12px; color: #9ca3af; font-variant-numeric: tabular-nums; }
        .notes-col { font-size: 12px; color: #6b7280; font-style: italic; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

        .action-col { display: flex; gap: 5px; justify-content: flex-end; opacity: 0; transition: opacity 0.15s; }
        .quote-row:hover .action-col { opacity: 1; }
        .action-btn { width: 28px; height: 28px; border: none; border-radius: 6px; cursor: pointer; font-size: 12px; display: flex; align-items: center; justify-content: center; font-family: inherit; }
        .edit-btn { background: #eff6ff; color: #2563eb; }
        .del-btn  { background: #fef2f2; color: #dc2626; }

        .add-row {
          display: flex; align-items: center; gap: 8px; padding: 13px 28px;
          color: #d1d5db; font-size: 13px; cursor: pointer;
          border-bottom: 1px solid #f3f4f6; background: #fff; transition: all 0.15s;
        }
        .add-row:hover { color: #0073ea; background: #f0f7ff; }

        .list-row { transition: background 0.1s; }
        .list-row:hover { background: #f9fafb; }
        .clickable-name { cursor: pointer; color: #111827; transition: color 0.12s; }
        .clickable-name:hover { color: #0073ea; text-decoration: underline; }

        @media (max-width: 768px) {
          .quote-table { display: none; }
          .quote-cards { display: block; }
          .form-grid { grid-template-columns: 1fr; }
          .form-full { grid-column: 1; }
          .form-panel { padding: 16px; }
        }
      `}</style>

      {/* ── Nav ── */}
      <div style={{ background: "#1e1b4b", padding: "0 20px", position: "sticky", top: 0, zIndex: 50 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", height: "52px", maxWidth: "1280px", margin: "0 auto" }}>
          <div>
            <div style={{ fontSize: "15px", fontWeight: 700, color: "#fff" }}>Core Provisions Group</div>
            <div style={{ fontSize: "9px", color: "#6366f1", letterSpacing: "0.16em", textTransform: "uppercase" }}>Quote Ledger</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            {bmdUsd && !showBmd && (
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: "13px", fontWeight: 700, color: "#a5f3fc" }}>
                  ${fmt(parseFloat(bmdUsd))} <span style={{ fontSize: "10px", fontWeight: 400, color: "#818cf8" }}>BMD/MT</span>
                </div>
                {bmdTs && <div style={{ fontSize: "9px", color: "#4338ca" }}>{fmtTs(bmdTs)}</div>}
              </div>
            )}
            <button onClick={() => setShowBmd(s => !s)}
              style={{ background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.15)", color: "#c7d2fe", padding: "6px 12px", borderRadius: "6px", fontSize: "12px", cursor: "pointer", fontFamily: "inherit", fontWeight: 500 }}>
              {showBmd ? "Done" : bmdUsd ? "BMD ✎" : "Set BMD"}
            </button>
          </div>
        </div>
        {showBmd && (
          <div style={{ paddingBottom: "14px", maxWidth: "1280px", margin: "0 auto", display: "flex", gap: "8px", alignItems: "flex-end" }}>
            <div style={{ flex: 1, maxWidth: "260px" }}>
              <div style={{ fontSize: "10px", color: "#a5b4fc", marginBottom: "4px", letterSpacing: "0.1em", textTransform: "uppercase" }}>BMD Price (USD / MT)</div>
              <input value={bmdInput} onChange={e => setBmdInput(e.target.value)} placeholder="e.g. 987.50"
                style={{ width: "100%", background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.2)", borderRadius: "6px", color: "#fff", padding: "8px 10px", fontSize: "14px", fontFamily: "inherit", outline: "none" }} />
            </div>
            <button onClick={saveBmd} disabled={!bmdInput}
              style={{ background: "#0073ea", border: "none", color: "#fff", padding: "8px 18px", borderRadius: "6px", fontSize: "13px", fontWeight: 600, cursor: "pointer", fontFamily: "inherit", opacity: bmdInput ? 1 : 0.4 }}>
              Save
            </button>
          </div>
        )}
      </div>

      {/* ── Content ── */}
      <div style={{ maxWidth: "1280px", margin: "0 auto" }}>

        {/* ── Tabs ── */}
        <div style={{ background: "#fff", borderBottom: "1px solid #e5e7eb", display: "flex", padding: "0 20px" }}>
          {[["quotes", "Quotes"], ["buyers", "Buyers"], ["products", "Products"]].map(([key, label]) => (
            <button key={key} onClick={() => { setTab(key); cancel(); }}
              style={{ padding: "13px 18px", fontSize: "13px", fontWeight: tab === key ? 700 : 400, color: tab === key ? "#0073ea" : "#6b7280", background: "none", border: "none", borderBottom: tab === key ? "2px solid #0073ea" : "2px solid transparent", cursor: "pointer", fontFamily: "inherit", marginBottom: "-1px", transition: "all 0.15s" }}>
              {label}
              {key === "quotes" && quotes.length > 0 && (
                <span style={{ marginLeft: "6px", background: "#f3f4f6", color: "#6b7280", fontSize: "11px", fontWeight: 600, padding: "1px 7px", borderRadius: "20px" }}>{quotes.length}</span>
              )}
            </button>
          ))}
        </div>

        {/* ── QUOTES TAB ── */}
        {tab === "quotes" && (
          <div>
            {/* Toolbar */}
            <div style={{ background: "#fff", borderBottom: "1px solid #f0f0f0", padding: "10px 20px", display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
              <button onClick={() => { cancel(); setShowForm(s => !s); }}
                style={{ background: showForm && !editId ? "#f3f4f6" : "#0073ea", color: showForm && !editId ? "#6b7280" : "#fff", border: "none", padding: "9px 18px", borderRadius: "8px", fontSize: "13px", fontWeight: 600, cursor: "pointer", fontFamily: "inherit", flexShrink: 0 }}>
                {showForm && !editId ? "✕ Cancel" : "+ New Quote"}
              </button>
              <div style={{ display: "flex", gap: "5px", overflowX: "auto", flex: 1 }}>
                {["All", ...STATUSES].map(s => {
                  const active = sfStatus === s;
                  const c = s === "All" ? quotes.length : (counts[s] || 0);
                  return (
                    <button key={s} onClick={() => setSfStatus(s)}
                      style={{ background: active ? "#0073ea" : "#f3f4f6", color: active ? "#fff" : "#6b7280", border: "none", padding: "6px 12px", borderRadius: "20px", fontSize: "12px", fontWeight: active ? 600 : 400, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap", flexShrink: 0 }}>
                      {s}{c > 0 ? ` · ${c}` : ""}
                    </button>
                  );
                })}
              </div>
              {/* Active filter chips */}
              {sfBuyer !== "All" && (
                <div style={{ display: "flex", alignItems: "center", gap: "6px", background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: "20px", padding: "5px 12px", fontSize: "12px", color: "#1d4ed8", fontWeight: 500, flexShrink: 0 }}>
                  {sfBuyer}
                  <span onClick={() => setSfBuyer("All")} style={{ cursor: "pointer", opacity: 0.6, marginLeft: "2px" }}>✕</span>
                </div>
              )}
              {sfProd !== "All" && (
                <div style={{ display: "flex", alignItems: "center", gap: "6px", background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: "20px", padding: "5px 12px", fontSize: "12px", color: "#15803d", fontWeight: 500, flexShrink: 0 }}>
                  {sfProd}
                  <span onClick={() => setSfProd("All")} style={{ cursor: "pointer", opacity: 0.6, marginLeft: "2px" }}>✕</span>
                </div>
              )}
            </div>

            {/* Form */}
            {showForm && (
              <QuoteForm form={form} setForm={setForm} onSubmit={submit} onCancel={cancel}
                saving={saving} editId={editId} bmdUsd={bmdUsd}
                allBuyers={allBuyers} allProds={allProds}
                onAddBuyer={addBuyer} onAddProduct={addProduct} />
            )}

            {/* Desktop table */}
            <div className="quote-table">
              <div style={{ display: "grid", gridTemplateColumns: TABLE_COLS, padding: "0 20px", background: "#fafafa", borderBottom: "1px solid #e5e7eb" }}>
                {["Date", "Buyer", "Terms", "Price", "Status", "Notes", ""].map(h => (
                  <div key={h} style={{ padding: "9px 8px", fontSize: "11px", fontWeight: 700, color: "#9ca3af", letterSpacing: "0.08em", textTransform: "uppercase" }}>{h}</div>
                ))}
              </div>
              {loading ? (
                <div style={{ textAlign: "center", padding: "80px", color: "#9ca3af" }}>Loading…</div>
              ) : filtered.length === 0 ? (
                <div style={{ textAlign: "center", padding: "80px", color: "#9ca3af" }}>
                  <div style={{ fontSize: "32px", marginBottom: "12px" }}>📋</div>
                  <div style={{ fontSize: "15px", fontWeight: 600 }}>{quotes.length === 0 ? "No quotes yet" : "No quotes match"}</div>
                  {quotes.length === 0 && <div style={{ fontSize: "13px", marginTop: "6px" }}>Click + New Quote to get started</div>}
                </div>
              ) : (
                <>
                  {filtered.map(q => <QuoteRow key={q.id} q={q} bmdUsd={bmdUsd} onEdit={startEdit} onDelete={deleteQuote} onStatusChange={patchStatus} />)}
                  <div className="add-row" onClick={() => { cancel(); setShowForm(true); window.scrollTo({ top: 0, behavior: "smooth" }); }}>
                    <span>+</span> Add quote
                  </div>
                </>
              )}
            </div>

            {/* Mobile cards */}
            <div className="quote-cards">
              {loading ? (
                <div style={{ textAlign: "center", padding: "60px 0", color: "#9ca3af" }}>Loading…</div>
              ) : filtered.length === 0 ? (
                <div style={{ textAlign: "center", padding: "60px 0", color: "#9ca3af" }}>
                  <div style={{ fontSize: "32px", marginBottom: "10px" }}>📋</div>
                  <div style={{ fontSize: "15px", fontWeight: 600 }}>{quotes.length === 0 ? "No quotes yet" : "No quotes match"}</div>
                </div>
              ) : filtered.map(q => <QuoteCard key={q.id} q={q} bmdUsd={bmdUsd} onEdit={startEdit} onDelete={deleteQuote} onStatusChange={patchStatus} />)}
            </div>
          </div>
        )}

        {/* ── BUYERS TAB ── */}
        {tab === "buyers" && (
          <div style={{ padding: "16px" }}>
            <div style={{ background: "#fff", borderRadius: "10px", border: "1px solid #e5e7eb", overflow: "hidden" }}>
              <div style={{ padding: "16px", borderBottom: "1px solid #f3f4f6", display: "flex", gap: "8px" }}>
                <input className="field-input" style={{ flex: 1 }} placeholder="Add new buyer…" value={newBuyer}
                  onChange={e => setNewBuyer(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter" && newBuyer.trim()) { addBuyer(newBuyer.trim()); setNewBuyer(""); } }} />
                <button onClick={() => { if (newBuyer.trim()) { addBuyer(newBuyer.trim()); setNewBuyer(""); } }}
                  style={{ background: "#0073ea", color: "#fff", border: "none", padding: "10px 18px", borderRadius: "8px", fontSize: "13px", fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
                  Add
                </button>
              </div>
              {buyers.length === 0
                ? <div style={{ padding: "40px", textAlign: "center", color: "#9ca3af", fontSize: "14px" }}>No buyers yet</div>
                : buyers.map(b => {
                  const qCount = quotes.filter(q => q.buyer === b).length;
                  return (
                    <div key={b} className="list-row" style={{ padding: "13px 16px", borderBottom: "1px solid #f9fafb", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                        <span className="clickable-name" style={{ fontSize: "14px", fontWeight: 500 }} onClick={() => filterByBuyer(b)}>{b}</span>
                        {qCount > 0 && <span style={{ fontSize: "11px", color: "#9ca3af", background: "#f3f4f6", padding: "1px 7px", borderRadius: "20px", fontWeight: 500 }}>{qCount} quote{qCount !== 1 ? "s" : ""}</span>}
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                        <span onClick={() => filterByBuyer(b)} style={{ fontSize: "12px", color: "#0073ea", cursor: "pointer", fontWeight: 500 }}>View quotes →</span>
                        <button onClick={() => deleteBuyer(b)} style={{ background: "none", border: "none", color: "#d1d5db", cursor: "pointer", fontSize: "16px", padding: "0 4px" }}>✕</button>
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>
        )}

        {/* ── PRODUCTS TAB ── */}
        {tab === "products" && (
          <div style={{ padding: "16px" }}>
            <div style={{ background: "#fff", borderRadius: "10px", border: "1px solid #e5e7eb", overflow: "hidden" }}>
              <div style={{ padding: "16px", borderBottom: "1px solid #f3f4f6", display: "flex", gap: "8px" }}>
                <input className="field-input" style={{ flex: 1 }} placeholder="Add new product…" value={newProd}
                  onChange={e => setNewProd(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter" && newProd.trim()) { addProduct(newProd.trim()); setNewProd(""); } }} />
                <button onClick={() => { if (newProd.trim()) { addProduct(newProd.trim()); setNewProd(""); } }}
                  style={{ background: "#0073ea", color: "#fff", border: "none", padding: "10px 18px", borderRadius: "8px", fontSize: "13px", fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
                  Add
                </button>
              </div>
              {prods.length === 0
                ? <div style={{ padding: "40px", textAlign: "center", color: "#9ca3af", fontSize: "14px" }}>No products yet</div>
                : prods.map(p => {
                  const qCount = quotes.filter(q => q.product === p).length;
                  return (
                    <div key={p} className="list-row" style={{ padding: "13px 16px", borderBottom: "1px solid #f9fafb", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                        <span className="clickable-name" style={{ fontSize: "14px", fontWeight: 500 }} onClick={() => filterByProduct(p)}>{p}</span>
                        {qCount > 0 && <span style={{ fontSize: "11px", color: "#9ca3af", background: "#f3f4f6", padding: "1px 7px", borderRadius: "20px", fontWeight: 500 }}>{qCount} quote{qCount !== 1 ? "s" : ""}</span>}
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                        <span onClick={() => filterByProduct(p)} style={{ fontSize: "12px", color: "#0073ea", cursor: "pointer", fontWeight: 500 }}>View quotes →</span>
                        <button onClick={() => deleteProduct(p)} style={{ background: "none", border: "none", color: "#d1d5db", cursor: "pointer", fontSize: "16px", padding: "0 4px" }}>✕</button>
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
