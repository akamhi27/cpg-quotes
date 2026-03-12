import { useState, useEffect, useRef } from "react";
import { supabase } from "./supabase";

const MT_TO_LB = 2204.62;
const TERMS = ["FOB", "CFR", "CIF", "Delivered"];
const STATUSES = ["Pending", "Accepted", "Rejected", "Countered", "Expired"];

const STATUS_CFG = {
  Pending:   { bg: "#fff0c2", color: "#8a6a00", border: "#f0d060" },
  Accepted:  { bg: "#d4f5e2", color: "#1a7a45", border: "#7adba8" },
  Rejected:  { bg: "#ffe0e0", color: "#9a2020", border: "#f0a0a0" },
  Countered: { bg: "#e8e0ff", color: "#4a30a0", border: "#b0a0f0" },
  Expired:   { bg: "#ebebeb", color: "#666",    border: "#ccc" },
};

const TERMS_CFG = {
  FOB:       { bg: "#e8f4ff", color: "#1a5fa0", border: "#a8d4f8" },
  CFR:       { bg: "#f0e8ff", color: "#5a30a0", border: "#c0a0f0" },
  CIF:       { bg: "#e8fff4", color: "#1a7a55", border: "#a0dfc0" },
  Delivered: { bg: "#fff4e8", color: "#a05a10", border: "#f0c080" },
};

const COLS = [
  { key: "date",    label: "Date",    w: "100px" },
  { key: "buyer",   label: "Buyer",   w: "1.8fr" },
  { key: "product", label: "Product", w: "1.4fr" },
  { key: "terms",   label: "Terms",   w: "90px"  },
  { key: "price",   label: "Price",   w: "1.6fr" },
  { key: "status",  label: "Status",  w: "120px" },
  { key: "notes",   label: "Notes",   w: "1.6fr" },
  { key: "actions", label: "",        w: "60px"  },
];
const GRID = COLS.map(c => c.w).join(" ");

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
function calcBmdUsd(bmdMyr, spread, sign, fx) {
  const b = parseFloat(bmdMyr), f = parseFloat(fx);
  if (isNaN(b) || isNaN(f) || f === 0) return null;
  return (b + sign * spread) / f;
}

function Pill({ cfg, children }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", padding: "3px 10px", borderRadius: "20px", fontSize: "11px", fontWeight: 600, letterSpacing: "0.04em", background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.border}`, whiteSpace: "nowrap" }}>
      {children}
    </span>
  );
}

function Combobox({ value, onChange, options, placeholder, onAdd, inputStyle }) {
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
      <input value={q} placeholder={placeholder} autoComplete="off" style={inputStyle}
        onChange={e => { setQ(e.target.value); onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)} />
      {open && (filtered.length > 0 || showAdd) && (
        <div style={{ position: "absolute", top: "calc(100% + 2px)", left: 0, right: 0, background: "#fff", border: "1px solid #ddd", borderRadius: "6px", zIndex: 300, overflow: "hidden", boxShadow: "0 8px 24px rgba(0,0,0,0.12)" }}>
          {filtered.map(o => (
            <div key={o} onMouseDown={() => pick(o)}
              style={{ padding: "8px 12px", fontSize: "13px", color: o === value ? "#0073ea" : "#333", background: o === value ? "#f0f7ff" : "transparent", cursor: "pointer" }}>
              {o}
            </div>
          ))}
          {showAdd && (
            <div onMouseDown={() => { onAdd(q.trim()); pick(q.trim()); }}
              style={{ padding: "8px 12px", fontSize: "13px", color: "#0073ea", cursor: "pointer", borderTop: filtered.length ? "1px solid #eee" : "none", fontWeight: 500 }}>
              + Add "{q.trim()}"
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const fieldInput = {
  width: "100%", background: "#fff", border: "1.5px solid #e0e4ea",
  borderRadius: "6px", color: "#1a1a2e", padding: "8px 11px",
  fontSize: "13px", fontFamily: "inherit", outline: "none",
  boxSizing: "border-box", transition: "border-color 0.15s",
};
const fieldSelect = { ...fieldInput, cursor: "pointer", appearance: "none" };

function emptyForm() {
  return { date: new Date().toISOString().split("T")[0], buyer: "", product: "", terms: "FOB", price_mt: "", price_lb: "", notes: "", status: "Pending" };
}

export default function App() {
  const [quotes,  setQuotes]  = useState([]);
  const [buyers,  setBuyers]  = useState([]);
  const [prods,   setProds]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [form,    setForm]    = useState(emptyForm());
  const [editId,  setEditId]  = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [saving,  setSaving]  = useState(false);
  const [sfStatus, setSfStatus] = useState("All");
  const [sfBuyer,  setSfBuyer]  = useState("All");
  const [sfProd,   setSfProd]   = useState("All");
  const [bmdMyr,  setBmdMyr]  = useState("");
  const [fxRate,  setFxRate]  = useState("");
  const [bmdTs,   setBmdTs]   = useState(null);
  const [showBmd, setShowBmd] = useState(false);

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
      if (bmd) { setBmdMyr(bmd.bmd_myr || ""); setFxRate(bmd.fx_rate || ""); setBmdTs(bmd.updated_at || null); }
    } catch (_) {}
    setLoading(false);
  }

  async function addBuyer(name) {
    await supabase.from("buyers").upsert({ name });
    setBuyers(b => [...new Set([...b, name])].sort());
  }

  async function addProduct(name) {
    await supabase.from("products").upsert({ name });
    setProds(p => [...new Set([...p, name])]);
  }

  async function saveBmd() {
    const now = new Date().toISOString();
    await supabase.from("bmd_settings").upsert({ id: 1, bmd_myr: bmdMyr, fx_rate: fxRate, updated_at: now });
    setBmdTs(now); setShowBmd(false);
  }

  function setPriceMT(val) {
    const bmd = parseBmd(val);
    setForm(f => ({ ...f, price_mt: val, price_lb: bmd.isBmd ? "" : (val && !isNaN(parseFloat(val)) ? mtToLb(val) : f.price_lb) }));
  }
  function setPriceLB(val) {
    setForm(f => ({ ...f, price_lb: val, price_mt: val && !isNaN(parseFloat(val)) ? lbToMt(val) : f.price_mt }));
  }

  async function submit() {
    if (!form.buyer.trim() || (!form.price_mt && !form.price_lb)) return;
    setSaving(true);
    const bmd = parseBmd(form.price_mt);
    const entry = {
      id: editId || Date.now().toString(),
      buyer: form.buyer,
      product: form.product,
      terms: form.terms,
      price_mt_raw: form.price_mt,
      price_mt: bmd.isBmd ? null : (parseFloat(form.price_mt) || null),
      price_lb: bmd.isBmd ? null : (parseFloat(form.price_lb) || null),
      is_bmd: bmd.isBmd,
      bmd_spread: bmd.isBmd ? bmd.spread : null,
      bmd_sign: bmd.isBmd ? bmd.sign : null,
      date: form.date,
      status: form.status,
      notes: form.notes,
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
    setEditId(q.id); setShowForm(true);
  }
  function cancel() { setForm(emptyForm()); setEditId(null); setShowForm(false); }

  function resolveUsd(q) {
    if (!q.is_bmd || !bmdMyr || !fxRate) return null;
    return calcBmdUsd(bmdMyr, q.bmd_spread, q.bmd_sign, fxRate);
  }

  const allBuyers = [...new Set([...buyers, ...quotes.map(q => q.buyer)])].filter(Boolean).sort();
  const allProds  = [...new Set([...prods,  ...quotes.map(q => q.product)])].filter(Boolean);
  const filtered  = quotes.filter(q =>
    (sfStatus === "All" || q.status === sfStatus) &&
    (sfBuyer  === "All" || q.buyer  === sfBuyer)  &&
    (sfProd   === "All" || q.product === sfProd)
  );
  const counts   = Object.fromEntries(STATUSES.map(s => [s, quotes.filter(q => q.status === s).length]));
  const bmdReady = bmdMyr && fxRate;
  const formBmd  = parseBmd(form.price_mt);
  const formBmdUsd = formBmd.isBmd && bmdReady ? calcBmdUsd(bmdMyr, formBmd.spread, formBmd.sign, fxRate) : null;

  function fmtTs(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) + " " + d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  }

  return (
    <div style={{ minHeight: "100vh", background: "#f5f6f8", fontFamily: "'Outfit', sans-serif", color: "#1a1a2e" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        input::placeholder { color: #bbb; }
        select option { background: #fff; color: #1a1a2e; }
        ::-webkit-scrollbar { height: 4px; width: 4px; }
        ::-webkit-scrollbar-track { background: #f0f0f0; }
        ::-webkit-scrollbar-thumb { background: #d0d0d0; border-radius: 2px; }
        input[type=date]::-webkit-calendar-picker-indicator { cursor: pointer; opacity: 0.4; }
        .row-hover { transition: background 0.1s; }
        .row-hover:hover { background: #f0f4ff !important; }
        .action-btn { opacity: 0; transition: opacity 0.15s; }
        .row-hover:hover .action-btn { opacity: 1; }
        .form-input:focus { border-color: #0073ea !important; box-shadow: 0 0 0 3px rgba(0,115,234,0.1); }
        .add-row-btn:hover { background: #f0f7ff !important; color: #0073ea !important; }
      `}</style>

      <div style={{ display: "flex", minHeight: "100vh" }}>

        {/* Sidebar */}
        <div style={{ width: "220px", background: "#1a1a2e", flexShrink: 0, display: "flex", flexDirection: "column" }}>
          <div style={{ padding: "22px 20px 16px" }}>
            <div style={{ fontSize: "15px", fontWeight: 700, color: "#fff", letterSpacing: "-0.01em" }}>Core Provisions</div>
            <div style={{ fontSize: "10px", color: "#4a4a6a", letterSpacing: "0.14em", textTransform: "uppercase", marginTop: "3px" }}>Group</div>
          </div>
          <div style={{ height: "1px", background: "#252540", margin: "0 16px" }} />
          <div style={{ padding: "16px 12px", flex: 1 }}>
            <div style={{ fontSize: "10px", color: "#3a3a5a", letterSpacing: "0.14em", textTransform: "uppercase", padding: "0 8px", marginBottom: "8px" }}>Workspace</div>
            {[
              { icon: "📋", label: "Quote Ledger", active: true },
              { icon: "📦", label: "Products", active: false },
              { icon: "🏢", label: "Buyers", active: false },
            ].map(item => (
              <div key={item.label} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "8px 10px", borderRadius: "6px", marginBottom: "2px", background: item.active ? "rgba(0,115,234,0.15)" : "transparent", color: item.active ? "#5b9cf6" : "#5a5a7a", fontSize: "13px", fontWeight: item.active ? 600 : 400, cursor: "pointer" }}>
                <span style={{ fontSize: "14px" }}>{item.icon}</span> {item.label}
              </div>
            ))}
          </div>

          {/* BMD panel */}
          <div style={{ margin: "12px", background: "#252540", borderRadius: "8px", padding: "14px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px" }}>
              <div style={{ fontSize: "10px", color: "#4a4a6a", letterSpacing: "0.12em", textTransform: "uppercase", fontWeight: 600 }}>BMD Index</div>
              <button onClick={() => setShowBmd(s => !s)} style={{ background: "none", border: "none", color: "#5b9cf6", fontSize: "11px", cursor: "pointer", fontFamily: "inherit", padding: 0 }}>
                {showBmd ? "Done" : "Edit"}
              </button>
            </div>
            {showBmd ? (
              <div>
                <input value={bmdMyr} onChange={e => setBmdMyr(e.target.value)} placeholder="BMD (MYR/MT)"
                  style={{ width: "100%", background: "#1a1a2e", border: "1px solid #3a3a5a", borderRadius: "4px", color: "#fff", padding: "6px 8px", fontSize: "12px", fontFamily: "inherit", outline: "none", marginBottom: "6px" }} />
                <input value={fxRate} onChange={e => setFxRate(e.target.value)} placeholder="MYR/USD rate"
                  style={{ width: "100%", background: "#1a1a2e", border: "1px solid #3a3a5a", borderRadius: "4px", color: "#fff", padding: "6px 8px", fontSize: "12px", fontFamily: "inherit", outline: "none", marginBottom: "8px" }} />
                {bmdMyr && fxRate && <div style={{ fontSize: "11px", color: "#4ade80", marginBottom: "8px" }}>≈ ${fmt(parseFloat(bmdMyr) / parseFloat(fxRate))} USD/MT</div>}
                <button onClick={saveBmd} disabled={!bmdMyr || !fxRate}
                  style={{ width: "100%", background: "#0073ea", border: "none", color: "#fff", padding: "6px", borderRadius: "4px", fontSize: "11px", fontWeight: 600, cursor: "pointer", fontFamily: "inherit", opacity: bmdMyr && fxRate ? 1 : 0.4 }}>
                  Save
                </button>
              </div>
            ) : bmdReady ? (
              <div>
                <div style={{ fontSize: "18px", fontWeight: 700, color: "#fff", fontVariantNumeric: "tabular-nums" }}>{parseFloat(bmdMyr).toLocaleString()}</div>
                <div style={{ fontSize: "10px", color: "#4a4a6a", marginTop: "1px" }}>MYR / MT</div>
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: "8px" }}>
                  <div>
                    <div style={{ fontSize: "12px", color: "#4ade80", fontWeight: 600 }}>${fmt(parseFloat(bmdMyr) / parseFloat(fxRate))}</div>
                    <div style={{ fontSize: "9px", color: "#4a4a6a" }}>USD / MT</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: "12px", color: "#94a3b8" }}>{parseFloat(fxRate).toFixed(3)}</div>
                    <div style={{ fontSize: "9px", color: "#4a4a6a" }}>MYR/USD</div>
                  </div>
                </div>
                {bmdTs && <div style={{ fontSize: "9px", color: "#3a3a5a", marginTop: "8px" }}>Updated {fmtTs(bmdTs)}</div>}
              </div>
            ) : (
              <div style={{ fontSize: "12px", color: "#3a3a5a", fontStyle: "italic" }}>Not set — click Edit</div>
            )}
          </div>
          <div style={{ padding: "16px" }} />
        </div>

        {/* Main */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>

          {/* Top bar */}
          <div style={{ background: "#fff", borderBottom: "1px solid #e8eaf0", padding: "0 28px", display: "flex", alignItems: "center", height: "56px", gap: "12px" }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: "18px", fontWeight: 700, color: "#1a1a2e", letterSpacing: "-0.02em" }}>Quote Ledger</div>
            </div>
            <div style={{ display: "flex", gap: "4px", background: "#f5f6f8", padding: "4px", borderRadius: "8px" }}>
              {["All", ...STATUSES].map(s => {
                const active = sfStatus === s;
                const c = s === "All" ? quotes.length : (counts[s] || 0);
                return (
                  <button key={s} onClick={() => setSfStatus(s)}
                    style={{ background: active ? "#fff" : "transparent", color: active ? "#0052cc" : "#888", border: "none", padding: "5px 12px", borderRadius: "6px", fontSize: "12px", fontWeight: active ? 600 : 400, cursor: "pointer", fontFamily: "inherit", boxShadow: active ? "0 1px 3px rgba(0,0,0,0.1)" : "none", whiteSpace: "nowrap" }}>
                    {s} {c > 0 ? <span style={{ fontSize: "10px", color: active ? "#0073ea" : "#bbb" }}>·{c}</span> : ""}
                  </button>
                );
              })}
            </div>
            <button onClick={() => { cancel(); setShowForm(s => !s); }}
              style={{ background: "#0073ea", color: "#fff", border: "none", padding: "8px 18px", borderRadius: "7px", fontSize: "13px", fontWeight: 600, cursor: "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", gap: "6px", flexShrink: 0 }}>
              {showForm && !editId ? "✕ Cancel" : "+ New Quote"}
            </button>
          </div>

          {/* Sub-bar */}
          <div style={{ background: "#fff", borderBottom: "1px solid #f0f2f5", padding: "8px 28px", display: "flex", gap: "10px", alignItems: "center" }}>
            <span style={{ fontSize: "12px", color: "#aaa", marginRight: "4px" }}>Filter by</span>
            {[
              [sfBuyer, setSfBuyer, ["All", ...allBuyers], "Buyer"],
              [sfProd,  setSfProd,  ["All", ...allProds],  "Product"],
            ].map(([val, set, opts, lbl]) => (
              <select key={lbl} value={val} onChange={e => set(e.target.value)}
                style={{ background: val === "All" ? "#f5f6f8" : "#e8f0fe", border: "1.5px solid " + (val === "All" ? "#e0e4ea" : "#a8c8f8"), color: val === "All" ? "#666" : "#0052cc", padding: "5px 10px", borderRadius: "6px", fontSize: "12px", fontWeight: 500, cursor: "pointer", fontFamily: "inherit", appearance: "none", outline: "none" }}>
                {opts.map(o => <option key={o}>{o === "All" ? `All ${lbl}s` : o}</option>)}
              </select>
            ))}
            {(sfBuyer !== "All" || sfProd !== "All") && (
              <button onClick={() => { setSfBuyer("All"); setSfProd("All"); }} style={{ background: "none", border: "none", color: "#aaa", fontSize: "12px", cursor: "pointer", fontFamily: "inherit" }}>Clear filters</button>
            )}
            <div style={{ marginLeft: "auto", fontSize: "12px", color: "#bbb" }}>{filtered.length} quote{filtered.length !== 1 ? "s" : ""}</div>
          </div>

          {/* Form */}
          {showForm && (
            <div style={{ background: "#fff", borderBottom: "2px solid #e8f0fe", padding: "24px 28px" }}>
              <div style={{ fontSize: "13px", fontWeight: 600, color: "#0073ea", marginBottom: "20px" }}>
                {editId ? "✎ Edit Quote" : "+ New Quote"}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "14px 20px" }}>
                {[
                  { label: "Date", content: <input type="date" className="form-input" style={fieldInput} value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} /> },
                  { label: "Buyer", content: <Combobox value={form.buyer} onChange={v => setForm(f => ({ ...f, buyer: v }))} options={allBuyers} placeholder="Company name" onAdd={addBuyer} inputStyle={fieldInput} /> },
                  { label: "Product", content: <Combobox value={form.product} onChange={v => setForm(f => ({ ...f, product: v }))} options={allProds} placeholder="Select or add" onAdd={addProduct} inputStyle={fieldInput} /> },
                  { label: "Terms", content: <select className="form-input" style={fieldSelect} value={form.terms} onChange={e => setForm(f => ({ ...f, terms: e.target.value }))}>{TERMS.map(t => <option key={t}>{t}</option>)}</select> },
                  {
                    label: "$ / MT  or  BMD+[spread]", content: (
                      <div>
                        <input className="form-input" style={fieldInput} placeholder="850.00 or BMD+35" value={form.price_mt} onChange={e => setPriceMT(e.target.value)} />
                        {formBmd.isBmd && <div style={{ fontSize: "11px", marginTop: "4px", color: formBmdUsd ? "#1a7a45" : "#aaa" }}>{formBmdUsd ? `≈ $${fmt(formBmdUsd)}/MT · $${fmt(formBmdUsd / MT_TO_LB, 4)}/lb` : "Set BMD to resolve"}</div>}
                      </div>
                    )
                  },
                  { label: "$ / LB", content: <input className="form-input" style={{ ...fieldInput, opacity: formBmd.isBmd ? 0.4 : 1 }} placeholder="auto-calculated" value={form.price_lb} disabled={formBmd.isBmd} onChange={e => setPriceLB(e.target.value)} /> },
                  { label: "Status", content: <select className="form-input" style={fieldSelect} value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>{STATUSES.map(s => <option key={s}>{s}</option>)}</select> },
                  { label: "Notes", content: <input className="form-input" style={fieldInput} placeholder="Comparing vs. SE Asian supplier…" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} /> },
                ].map(({ label, content }) => (
                  <div key={label}>
                    <div style={{ fontSize: "11px", fontWeight: 600, color: "#888", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: "6px" }}>{label}</div>
                    {content}
                  </div>
                ))}
              </div>
              <div style={{ display: "flex", gap: "10px", marginTop: "20px" }}>
                <button onClick={submit} disabled={saving || !form.buyer.trim() || (!form.price_mt && !form.price_lb)}
                  style={{ background: "#0073ea", color: "#fff", border: "none", padding: "9px 22px", borderRadius: "7px", fontSize: "13px", fontWeight: 600, cursor: "pointer", fontFamily: "inherit", opacity: form.buyer.trim() && (form.price_mt || form.price_lb) ? 1 : 0.4 }}>
                  {saving ? "Saving…" : editId ? "Update Quote" : "Save Quote"}
                </button>
                <button onClick={cancel} style={{ background: "#f5f6f8", color: "#666", border: "1.5px solid #e0e4ea", padding: "9px 18px", borderRadius: "7px", fontSize: "13px", cursor: "pointer", fontFamily: "inherit" }}>
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Table */}
          <div style={{ flex: 1, overflowX: "auto" }}>
            <div style={{ display: "grid", gridTemplateColumns: GRID, background: "#fff", borderBottom: "2px solid #e8eaf0", padding: "0 28px", position: "sticky", top: 0, zIndex: 10 }}>
              {COLS.map(col => (
                <div key={col.key} style={{ padding: "10px 12px", fontSize: "11px", fontWeight: 700, color: "#888", letterSpacing: "0.1em", textTransform: "uppercase" }}>
                  {col.label}
                </div>
              ))}
            </div>

            {loading ? (
              <div style={{ textAlign: "center", padding: "80px", color: "#bbb", fontSize: "14px" }}>Loading…</div>
            ) : filtered.length === 0 ? (
              <div style={{ textAlign: "center", padding: "80px", color: "#ccc" }}>
                <div style={{ fontSize: "40px", marginBottom: "12px" }}>📋</div>
                <div style={{ fontSize: "15px", fontWeight: 600, color: "#aaa" }}>{quotes.length === 0 ? "No quotes yet" : "No quotes match these filters"}</div>
                {quotes.length === 0 && <div style={{ fontSize: "13px", color: "#ccc", marginTop: "6px" }}>Click + New Quote to get started</div>}
              </div>
            ) : (
              <>
                {filtered.map((q, i) => {
                  const usd = q.is_bmd ? resolveUsd(q) : q.price_mt;
                  const lb  = usd ? usd / MT_TO_LB : q.price_lb;
                  return (
                    <div key={q.id} className="row-hover"
                      style={{ display: "grid", gridTemplateColumns: GRID, padding: "0 28px", background: i % 2 === 0 ? "#fff" : "#fafbfd", borderBottom: "1px solid #f0f2f5", minHeight: "52px", alignItems: "center" }}>
                      <div style={{ padding: "10px 12px", fontSize: "12px", color: "#888", fontVariantNumeric: "tabular-nums" }}>{q.date}</div>
                      <div style={{ padding: "10px 12px" }}>
                        <div style={{ fontWeight: 600, fontSize: "13px", color: "#1a1a2e" }}>{q.buyer}</div>
                      </div>
                      <div style={{ padding: "10px 12px", fontSize: "12px", color: "#555" }}>{q.product}</div>
                      <div style={{ padding: "10px 12px" }}>
                        <Pill cfg={TERMS_CFG[q.terms] || TERMS_CFG.FOB}>{q.terms}</Pill>
                      </div>
                      <div style={{ padding: "10px 12px" }}>
                        {q.is_bmd ? (
                          <div>
                            <span style={{ fontSize: "12px", fontWeight: 600, color: "#b08030", background: "#fff8e8", padding: "2px 8px", borderRadius: "4px", border: "1px solid #f0d080" }}>{q.price_mt_raw}</span>
                            {usd != null ? (
                              <div style={{ marginTop: "3px", fontSize: "11px", color: "#555", fontVariantNumeric: "tabular-nums" }}>
                                <span style={{ fontWeight: 600, color: "#1a1a2e" }}>${fmt(usd)}</span><span style={{ color: "#aaa" }}>/MT</span>
                                <span style={{ margin: "0 4px", color: "#ddd" }}>·</span>
                                <span style={{ fontWeight: 600, color: "#1a1a2e" }}>${fmt(usd / MT_TO_LB, 4)}</span><span style={{ color: "#aaa" }}>/lb</span>
                              </div>
                            ) : <div style={{ fontSize: "10px", color: "#ccc", marginTop: "2px" }}>set BMD to resolve</div>}
                          </div>
                        ) : usd != null ? (
                          <div>
                            <span style={{ fontWeight: 700, fontSize: "13px", color: "#1a1a2e", fontVariantNumeric: "tabular-nums" }}>${fmt(usd)}</span>
                            <span style={{ fontSize: "11px", color: "#aaa", marginLeft: "3px" }}>/MT</span>
                            <div style={{ fontSize: "11px", color: "#999", marginTop: "1px", fontVariantNumeric: "tabular-nums" }}>${fmt(lb, 4)}/lb</div>
                          </div>
                        ) : <span style={{ color: "#ddd" }}>—</span>}
                      </div>
                      <div style={{ padding: "10px 12px" }}>
                        <select value={q.status} onChange={e => patchStatus(q.id, e.target.value)}
                          style={{ background: STATUS_CFG[q.status]?.bg, color: STATUS_CFG[q.status]?.color, border: `1.5px solid ${STATUS_CFG[q.status]?.border}`, borderRadius: "20px", padding: "3px 10px", fontSize: "11px", fontWeight: 700, cursor: "pointer", fontFamily: "inherit", appearance: "none", outline: "none" }}>
                          {STATUSES.map(s => <option key={s}>{s}</option>)}
                        </select>
                      </div>
                      <div style={{ padding: "10px 12px", fontSize: "12px", color: "#888", fontStyle: q.notes ? "italic" : "normal", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {q.notes || <span style={{ color: "#ddd" }}>—</span>}
                      </div>
                      <div className="action-btn" style={{ padding: "10px 12px", display: "flex", gap: "6px", justifyContent: "flex-end" }}>
                        <button onClick={() => startEdit(q)} style={{ background: "#f0f4ff", border: "none", color: "#0073ea", width: "28px", height: "28px", borderRadius: "6px", cursor: "pointer", fontSize: "13px", display: "flex", alignItems: "center", justifyContent: "center" }}>✎</button>
                        <button onClick={() => deleteQuote(q.id)} style={{ background: "#fff0f0", border: "none", color: "#e05050", width: "28px", height: "28px", borderRadius: "6px", cursor: "pointer", fontSize: "13px", display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button>
                      </div>
                    </div>
                  );
                })}
                <div className="add-row-btn" onClick={() => { cancel(); setShowForm(true); }}
                  style={{ display: "flex", alignItems: "center", gap: "8px", padding: "12px 28px", color: "#bbb", fontSize: "13px", cursor: "pointer", borderBottom: "1px solid #f0f2f5", background: "#fff", transition: "all 0.15s" }}>
                  <span style={{ fontSize: "16px", lineHeight: 1 }}>+</span> Add quote
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
