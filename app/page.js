"use client";

import { useState, useEffect, useRef } from "react";

/* =========================================================================
   Cart E. Bee — recipe → categorized checkbox shopping list
   - Photos & links are read by our own backend at /api/extract (key stays server-side)
   - Persistence: localStorage (per device)
   ========================================================================= */

/* ---- storage: localStorage (per device) ---- */
const store = {
  get(key) {
    try {
      const v = localStorage.getItem(key);
      return v ? JSON.parse(v) : null;
    } catch {
      return null;
    }
  },
  set(key, val) {
    try {
      localStorage.setItem(key, JSON.stringify(val));
    } catch {
      /* storage full or unavailable — ignore */
    }
  },
};

/* ---- category order + color chips (functional: brief groups by type) ---- */
const CATEGORY_ORDER = ["Produce", "Meat", "Seafood", "Dairy", "Bar", "Pantry", "Other"];
const CATEGORY_COLOR = {
  Produce: "#2E7D4F",
  Meat: "#C2452D",
  Seafood: "#3B7EA1",
  Dairy: "#D4A93B",
  Bar: "#8E5B9E",
  Pantry: "#B58853",
  Other: "#9AA39B",
};

const MAX_PHOTOS = 3;
const MAX_LINKS = 3;
const normName = (n) => (n || "").trim().toLowerCase().replace(/\s+/g, " ");
const uid = () => Math.random().toString(36).slice(2, 9);

const SAMPLE_RECIPES = [
  {
    shortName: "Paper Plane",
    fullName: "Paper Plane",
    ingredients: [
      { name: "bourbon", quantity: "3/4 oz", category: "Bar" },
      { name: "Aperol", quantity: "3/4 oz", category: "Bar" },
      { name: "Amaro Nonino", quantity: "3/4 oz", category: "Bar" },
      { name: "lemon juice", quantity: "3/4 oz", category: "Produce" },
    ],
  },
  {
    shortName: "Sea Bass",
    fullName: "Tamarind-Glazed Sea Bass",
    ingredients: [
      { name: "sea bass fillets", quantity: "2", category: "Seafood" },
      { name: "garlic", quantity: "3 cloves", category: "Produce" },
      { name: "lime", quantity: "1", category: "Produce" },
      { name: "cilantro", quantity: "1 bunch", category: "Produce" },
      { name: "tamarind paste", quantity: "2 tbsp", category: "Pantry" },
      { name: "olive oil", quantity: "2 tbsp", category: "Pantry" },
    ],
  },
  {
    shortName: "Kofta",
    fullName: "Chicken Kofta",
    ingredients: [
      { name: "ground chicken", quantity: "1 lb", category: "Meat" },
      { name: "garlic", quantity: "4 cloves", category: "Produce" },
      { name: "yogurt", quantity: "1/2 cup", category: "Dairy" },
      { name: "parsley", quantity: "1 bunch", category: "Produce" },
      { name: "cumin", quantity: "2 tsp", category: "Pantry" },
      { name: "olive oil", quantity: "2 tbsp", category: "Pantry" },
    ],
  },
];

/* aggregate every recipe's ingredients for the "All" tab:
   dedupe on name, stack each recipe's quantity, merge recipe tags */
function buildAll(recipes) {
  const map = new Map();
  recipes.forEach((r) => {
    (r.ingredients || []).forEach((ing) => {
      const k = normName(ing.name);
      if (!k) return;
      if (!map.has(k))
        map.set(k, { key: k, name: ing.name, category: ing.category || "Other", tags: [], qtys: [] });
      const e = map.get(k);
      if (!e.tags.includes(r.shortName)) e.tags.push(r.shortName);
      e.qtys.push({ recipe: r.shortName, quantity: ing.quantity });
      if (e.category === "Other" && ing.category && ing.category !== "Other") e.category = ing.category;
    });
  });
  return Array.from(map.values());
}

function groupByCategory(items) {
  const groups = {};
  items.forEach((it) => {
    const c = CATEGORY_ORDER.includes(it.category) ? it.category : "Other";
    (groups[c] = groups[c] || []).push(it);
  });
  return CATEGORY_ORDER.filter((c) => groups[c]?.length).map((c) => ({
    category: c,
    items: groups[c].sort((a, b) => a.name.localeCompare(b.name)),
  }));
}

/* shrink an image file to base64 for the API (keep detail for OCR) */
function fileToCompressedBase64(file, maxEdge = 1024, quality = 0.72) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        canvas.getContext("2d").drawImage(img, 0, 0, w, h);
        const dataUrl = canvas.toDataURL("image/jpeg", quality);
        resolve({ media_type: "image/jpeg", data: dataUrl.split(",")[1], preview: dataUrl });
      };
      img.onerror = reject;
      img.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/* --------------------------------- UI --------------------------------- */
export default function CartEBee() {
  const [recipes, setRecipes] = useState([]);
  const [checked, setChecked] = useState({});
  const [activeTab, setActiveTab] = useState("all");
  const [files, setFiles] = useState([]); // {id, preview, media_type, data}
  const [urlField, setUrlField] = useState("");
  const [urls, setUrls] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(true);
  const [ready, setReady] = useState(false);
  const fileInput = useRef(null);

  /* load fonts (graceful fallback to system stacks if blocked) */
  useEffect(() => {
    const l = document.createElement("link");
    l.rel = "stylesheet";
    l.href =
      "https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,700;12..96,800&family=Hanken+Grotesk:wght@400;500;600&family=Spline+Sans+Mono:wght@400;500&display=swap";
    document.head.appendChild(l);
  }, []);

  /* hydrate from localStorage */
  useEffect(() => {
    const r = store.get("cb_recipes");
    const c = store.get("cb_checked");
    if (r?.length) {
      setRecipes(r);
      setAdding(false);
    }
    if (c) setChecked(c);
    setReady(true);
  }, []);

  useEffect(() => {
    if (ready) store.set("cb_recipes", recipes);
  }, [recipes, ready]);
  useEffect(() => {
    if (ready) store.set("cb_checked", checked);
  }, [checked, ready]);

  async function onPickFiles(e) {
    const picked = Array.from(e.target.files || []);
    const remaining = MAX_PHOTOS - files.length;
    if (remaining <= 0) {
      setError(`That's the ${MAX_PHOTOS}-photo limit per list — remove one to swap it out.`);
      e.target.value = "";
      return;
    }
    const accepted = picked.slice(0, remaining);
    const out = [];
    for (const f of accepted) {
      try {
        const c = await fileToCompressedBase64(f);
        out.push({ id: uid(), ...c });
      } catch {
        /* skip unreadable file */
      }
    }
    setFiles((prev) => [...prev, ...out]);
    setError(
      picked.length > remaining
        ? `Added ${remaining} to reach the ${MAX_PHOTOS}-photo limit (skipped ${picked.length - remaining}).`
        : ""
    );
    e.target.value = "";
  }

  function addUrl() {
    const v = urlField.trim();
    if (!v) return;
    if (urls.length >= MAX_LINKS) {
      setError(`That's the ${MAX_LINKS}-link limit per list — remove one to add another.`);
      return;
    }
    if (!/^https?:\/\//i.test(v)) {
      setError("Links need to start with http:// or https://");
      return;
    }
    setUrls((prev) => [...prev, v]);
    setUrlField("");
    setError("");
  }

  async function build() {
    if (!files.length && !urls.length) {
      setError("Add at least one photo or link first.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/extract", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          images: files.map((f) => ({ media_type: f.media_type, data: f.data })),
          urls,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "server error (HTTP " + res.status + ")");

      const got = (data.recipes || [])
        .map((r) => ({
          id: uid(),
          shortName: r.shortName || "Recipe",
          fullName: r.fullName || r.shortName || "Recipe",
          ingredients: (r.ingredients || []).map((i) => ({
            name: i.name || "",
            quantity: i.quantity || "",
            category: CATEGORY_ORDER.includes(i.category) ? i.category : "Other",
          })),
        }))
        .filter((r) => r.ingredients.length);

      if (!got.length) {
        setError(
          "Couldn't read any ingredients" +
            (data.errors?.length ? ": " + data.errors[0] : ". Try a clearer photo or another link.")
        );
      } else {
        setRecipes((prev) => {
          const seen = new Set(prev.map((r) => normName(r.fullName)));
          const merged = [...prev];
          got.forEach((r) => {
            if (!seen.has(normName(r.fullName))) {
              seen.add(normName(r.fullName));
              merged.push(r);
            }
          });
          return merged;
        });
        setFiles([]);
        setUrls([]);
        setAdding(false);
        setActiveTab("all");
        setError(data.errors?.length ? "Added the rest, but skipped: " + data.errors.join("; ") : "");
      }
    } catch (e) {
      setError("Couldn't reach the extractor (" + (e.message || e) + ").");
    } finally {
      setLoading(false);
    }
  }

  function toggle(key) {
    setChecked((prev) => ({ ...prev, [key]: !prev[key] }));
  }
  function removeRecipe(id) {
    setRecipes((prev) => prev.filter((r) => r.id !== id));
    if (activeTab === id) setActiveTab("all");
  }
  function startOver() {
    setRecipes([]);
    setChecked({});
    setActiveTab("all");
    setAdding(true);
  }
  // Dormant demo loader — no button is wired to it right now (kept for easy restore).
  function loadSample() {
    setRecipes(SAMPLE_RECIPES.map((r) => ({ ...r, id: uid(), ingredients: r.ingredients.map((i) => ({ ...i })) })));
    setChecked({});
    setFiles([]);
    setUrls([]);
    setError("");
    setAdding(false);
    setActiveTab("all");
  }

  /* current view data */
  const allItems = buildAll(recipes);
  let viewItems;
  if (activeTab === "all") {
    viewItems = allItems;
  } else {
    const r = recipes.find((x) => x.id === activeTab);
    viewItems = r
      ? r.ingredients.map((ing) => ({
          key: normName(ing.name),
          name: ing.name,
          category: ing.category,
          tags: [],
          qtys: [{ recipe: r.shortName, quantity: ing.quantity }],
        }))
      : [];
  }
  const grouped = groupByCategory(viewItems);
  const total = viewItems.length;
  const gathered = viewItems.filter((it) => checked[it.key]).length;

  return (
    <div className="cb-root">
      <style>{`
        .cb-root{
          --paper:#F6F7F3; --card:#FFFFFF; --ink:#1C2B24; --ink-soft:#5C6B62;
          --line:#E5E8DF; --grocer:#2E7D4F; --grocer-deep:#1F5A38;
          --sticker:#F7C92E; --sticker-ink:#161512;
          font-family:'Hanken Grotesk',system-ui,-apple-system,Segoe UI,sans-serif;
          color:var(--ink); background:var(--paper);
          min-height:100vh; width:100%;
        }
        .cb-wrap{max-width:640px;margin:0 auto;padding:0 16px 80px;}
        .cb-head{padding:26px 0 18px;display:flex;align-items:flex-end;justify-content:space-between;gap:12px;}
        .cb-title{font-family:'Bricolage Grotesque',sans-serif;font-weight:800;font-size:34px;
          letter-spacing:-0.02em;line-height:0.95;margin:0;}
        .cb-title em{font-style:normal;background:var(--sticker);color:var(--sticker-ink);
          border-radius:8px;padding:0 .16em;-webkit-box-decoration-break:clone;box-decoration-break:clone;}
        .cb-sub{margin:6px 0 0;color:var(--ink-soft);font-size:14px;}
        .cb-by{margin:3px 0 0;font-family:'Spline Sans Mono',ui-monospace,Menlo,monospace;
          font-size:11.5px;color:var(--ink-soft);opacity:.8;}
        .cb-bag{flex:0 0 auto;width:56px;height:56px;border-radius:15px;background:#F7C92E;
          display:grid;place-items:center;box-shadow:0 4px 14px rgba(22,21,18,.18);}
        .cb-bag svg{width:42px;height:42px;}
        .intro{margin:2px 0 18px;}
        .intro p{margin:0 0 10px;color:var(--ink-soft);font-size:14px;line-height:1.5;}
        .intro p:last-child{margin:0;}

        .cb-panel{background:var(--card);border:1px solid var(--line);border-radius:18px;
          padding:16px;box-shadow:0 1px 0 rgba(28,43,36,.03);}
        .cb-row{display:flex;gap:10px;flex-wrap:wrap;}
        .btn{font-family:inherit;font-weight:600;font-size:14px;cursor:pointer;border-radius:11px;
          padding:11px 15px;border:1px solid var(--line);background:#fff;color:var(--ink);
          display:inline-flex;align-items:center;gap:8px;transition:transform .06s ease,background .15s;}
        .btn:hover{background:#FBFCFA;}
        .btn:active{transform:translateY(1px);}
        .btn.primary{background:var(--grocer);border-color:var(--grocer);color:#fff;
          box-shadow:0 4px 14px rgba(46,125,79,.25);}
        .btn.primary:hover{background:var(--grocer-deep);}
        .btn.ghost{border-color:transparent;background:transparent;color:var(--ink-soft);padding:8px 10px;}
        .btn[disabled]{opacity:.5;cursor:not-allowed;}
        .field{flex:1;min-width:180px;font-family:inherit;font-size:14px;padding:11px 13px;
          border-radius:11px;border:1px solid var(--line);background:#fff;color:var(--ink);}
        .field:focus{outline:2px solid var(--grocer);outline-offset:1px;}

        .thumbs{display:flex;gap:10px;flex-wrap:wrap;margin-top:12px;}
        .thumb{position:relative;width:64px;height:64px;border-radius:10px;overflow:hidden;border:1px solid var(--line);}
        .thumb img{width:100%;height:100%;object-fit:cover;}
        .thumb button{position:absolute;top:-6px;right:-6px;width:20px;height:20px;border-radius:50%;
          border:none;background:var(--ink);color:#fff;font-size:12px;line-height:1;cursor:pointer;}
        .chip-url{display:inline-flex;align-items:center;gap:6px;background:#F1F4EE;border:1px solid var(--line);
          border-radius:8px;padding:6px 9px;font-size:12px;color:var(--ink-soft);max-width:100%;}
        .chip-url span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:200px;}
        .chip-url button{border:none;background:none;cursor:pointer;color:var(--ink-soft);font-size:13px;}

        .note{font-size:12px;color:var(--ink-soft);margin-top:10px;line-height:1.45;}
        .err{margin-top:12px;font-size:13px;color:#B23A2A;background:#FBEEEC;border:1px solid #F2D6D1;
          border-radius:10px;padding:9px 12px;}

        .tabs{display:flex;gap:8px;overflow-x:auto;padding:18px 0 6px;scrollbar-width:none;}
        .tabs::-webkit-scrollbar{display:none;}
        .tab{flex:0 0 auto;font-family:inherit;font-weight:600;font-size:13px;cursor:pointer;
          border-radius:999px;padding:8px 14px;border:1px solid var(--line);background:#fff;color:var(--ink-soft);
          white-space:nowrap;}
        .tab.active{background:var(--ink);color:#fff;border-color:var(--ink);}
        .tab.all.active{background:var(--grocer);border-color:var(--grocer);}

        .tally{font-family:'Spline Sans Mono',ui-monospace,Menlo,monospace;font-size:12.5px;color:var(--ink-soft);
          display:flex;align-items:center;justify-content:space-between;padding:6px 2px 14px;
          border-bottom:1px dashed var(--line);margin-bottom:10px;}
        .tally b{color:var(--grocer);font-weight:500;}

        .cat{margin:18px 0 8px;display:flex;align-items:center;gap:9px;}
        .cat-dot{width:9px;height:9px;border-radius:50%;}
        .cat-name{font-family:'Bricolage Grotesque',sans-serif;font-weight:700;font-size:12px;
          letter-spacing:.14em;text-transform:uppercase;color:var(--ink);}
        .cat-count{font-family:'Spline Sans Mono',monospace;font-size:11px;color:var(--ink-soft);}

        .item{display:flex;align-items:center;gap:12px;padding:11px 4px;border-bottom:1px solid var(--line);}
        .box{flex:0 0 auto;width:22px;height:22px;border-radius:7px;border:2px solid #CBD3C8;background:#fff;
          cursor:pointer;display:grid;place-items:center;transition:all .12s;}
        .box.on{background:var(--grocer);border-color:var(--grocer);}
        .box svg{width:13px;height:13px;opacity:0;transition:opacity .12s;}
        .box.on svg{opacity:1;}
        .item-main{flex:1;min-width:0;}
        .item-name{font-size:15px;font-weight:500;transition:color .15s;}
        .item.done .item-name{color:#A9B2A8;text-decoration:line-through;text-decoration-color:#C9D1C6;}
        .item-qtys{font-family:'Spline Sans Mono',monospace;font-size:11.5px;color:var(--ink-soft);margin-top:3px;
          display:flex;flex-wrap:wrap;gap:4px 10px;}
        .item.done .item-qtys{opacity:.5;}
        .stickers{display:flex;gap:5px;flex-wrap:wrap;flex:0 0 auto;}
        .sticker{font-size:10.5px;font-weight:700;color:var(--sticker-ink);background:var(--sticker);
          border-radius:999px;padding:3px 9px;letter-spacing:.01em;
          box-shadow:0 1px 0 rgba(22,21,18,.25);}
        .item.done .sticker{opacity:.45;}

        .empty{text-align:center;padding:46px 16px;color:var(--ink-soft);}
        .empty h3{font-family:'Bricolage Grotesque',sans-serif;color:var(--ink);font-size:19px;margin:0 0 6px;}
        .foot{display:flex;justify-content:space-between;align-items:center;margin-top:22px;
          font-size:12px;color:var(--ink-soft);}
        .spinner{width:15px;height:15px;border:2px solid rgba(255,255,255,.45);border-top-color:#fff;
          border-radius:50%;animation:spin .7s linear infinite;}
        @keyframes spin{to{transform:rotate(360deg)}}
        @media (prefers-reduced-motion: reduce){.spinner{animation:none}}
      `}</style>

      <div className="cb-wrap">
        <header className="cb-head">
          <div>
            <h1 className="cb-title"><em>Cart</em> E. Bee</h1>
            <p className="cb-sub">Snap recipes, gather every ingredient.</p>
            <p className="cb-by">By Jay Nargundkar (2026).</p>
          </div>
          <div className="cb-bag" aria-hidden="true">
            <svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg">
              {/* shopping cart, black, bold lines */}
              <g fill="none" stroke="#161512" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M7.5 17 L11 17 L14 22 L31 22" />
                <path d="M14 22 L16.5 29 L28 29 L31 22" />
                <path d="M18 29 L18.5 30.4 M27 29 L26.5 30.4" />
              </g>
              <circle cx="18.5" cy="32" r="2" fill="#161512" />
              <circle cx="26" cy="32" r="2" fill="#161512" />
              {/* bumblebee in flight, above the cart */}
              <g transform="translate(28.5 9.5) rotate(-12) scale(1.25) translate(-28.5 -9.5)">
                <ellipse cx="27" cy="6.4" rx="2.4" ry="1.5" fill="#FFFFFF" fillOpacity="0.9" stroke="#161512" strokeWidth="0.7" transform="rotate(-25 27 6.4)" />
                <ellipse cx="29.6" cy="6.6" rx="2.2" ry="1.4" fill="#FFFFFF" fillOpacity="0.9" stroke="#161512" strokeWidth="0.7" transform="rotate(18 29.6 6.6)" />
                <ellipse cx="28.4" cy="9.6" rx="3.7" ry="2.6" fill="#161512" />
                <path d="M27.5 7.3 L27 11.9" stroke="#F7C92E" strokeWidth="1" strokeLinecap="round" />
                <path d="M29.4 7.4 L28.9 11.7" stroke="#F7C92E" strokeWidth="1" strokeLinecap="round" />
                <circle cx="31.6" cy="9.9" r="1.5" fill="#161512" />
                <circle cx="32.2" cy="9.4" r="0.45" fill="#FFFFFF" />
                <path d="M31.9 8.6 Q32.7 7 33.7 6.8" stroke="#161512" strokeWidth="0.7" fill="none" strokeLinecap="round" />
                <circle cx="33.8" cy="6.7" r="0.55" fill="#161512" />
                <path d="M24.8 9.6 L23.2 8.9 L23.5 10.6 Z" fill="#161512" />
              </g>
              {/* faint flight trail linking bee to cart */}
              <path d="M13 16 Q16 9 21 8.6" fill="none" stroke="#161512" strokeWidth="2.2" strokeDasharray="0.1 3.4" strokeLinecap="round" opacity="0.55" />
            </svg>
          </div>
        </header>

        {(adding || recipes.length === 0) && (
          <div className="intro">
            <p>
              Use this tool to prepare a shopping or kitchen prep list of ingredients across multiple recipes. Simply
              upload photos from a favorite cookbook or screenshots from an online recipe (up to three at a time), or
              paste in a URL for an online recipe, and Cart E. will do the rest!
            </p>
            <p>
              Within a minute, you'll have an interactive check-box list, for which you can cross off items as you put
              them in your grocery shopping cart or pull them off a pantry shelf.
            </p>
          </div>
        )}

        {(adding || recipes.length === 0) && (
          <section className="cb-panel">
            <div className="cb-row">
              <button className="btn" onClick={() => fileInput.current?.click()} disabled={files.length >= MAX_PHOTOS}>
                <span aria-hidden>📷</span> {files.length >= MAX_PHOTOS ? `Photos full (${MAX_PHOTOS})` : `Add photos${files.length ? ` (${files.length}/${MAX_PHOTOS})` : ""}`}
              </button>
              <input ref={fileInput} type="file" accept="image/*" multiple
                style={{ display: "none" }} onChange={onPickFiles} />
              <input className="field" placeholder={urls.length >= MAX_LINKS ? `Link limit reached (${MAX_LINKS})` : "Paste a recipe link…"} value={urlField}
                onChange={(e) => setUrlField(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addUrl()}
                disabled={urls.length >= MAX_LINKS} />
              <button className="btn" onClick={addUrl} disabled={urls.length >= MAX_LINKS}>
                {urls.length >= MAX_LINKS ? `Links full (${MAX_LINKS})` : `Add link${urls.length ? ` (${urls.length}/${MAX_LINKS})` : ""}`}
              </button>
            </div>

            {(files.length > 0 || urls.length > 0) && (
              <div className="thumbs">
                {files.map((f) => (
                  <div className="thumb" key={f.id}>
                    <img src={f.preview} alt="recipe page" />
                    <button onClick={() => setFiles((p) => p.filter((x) => x.id !== f.id))} aria-label="Remove photo">×</button>
                  </div>
                ))}
                {urls.map((u, i) => (
                  <div className="chip-url" key={i}>
                    <span>{u.replace(/^https?:\/\//, "")}</span>
                    <button onClick={() => setUrls((p) => p.filter((_, j) => j !== i))} aria-label="Remove link">×</button>
                  </div>
                ))}
              </div>
            )}

            <div className="cb-row" style={{ marginTop: 14 }}>
              <button className="btn primary" onClick={build} disabled={loading}>
                {loading ? <><span className="spinner" /> Reading…</> : "Build list →"}
              </button>
              {recipes.length > 0 && (
                <button className="btn ghost" onClick={() => setAdding(false)}>Cancel</button>
              )}
            </div>

            {error && <div className="err">{error}</div>}
            <p className="note">
              Recipe sites behind paywalls cannot be imported. Some popular recipe sites (e.g. Allrecipes) may
              block Cart E. Bee. In this case, simply take a screenshot of the recipe, and upload that instead.
            </p>
          </section>
        )}

        {recipes.length > 0 && (
          <>
            <div className="tabs" role="tablist">
              <button className={`tab all ${activeTab === "all" ? "active" : ""}`} onClick={() => setActiveTab("all")}>
                All
              </button>
              {recipes.map((r) => (
                <button key={r.id} className={`tab ${activeTab === r.id ? "active" : ""}`} onClick={() => setActiveTab(r.id)}>
                  {r.shortName}
                </button>
              ))}
              {!adding && (
                <button className="tab" onClick={() => setAdding(true)} style={{ color: "var(--grocer)" }}>
                  + Add
                </button>
              )}
            </div>

            <div className="tally">
              <span><b>{gathered}</b> of {total} gathered</span>
              <span>{recipes.length} {recipes.length === 1 ? "recipe" : "recipes"}</span>
            </div>

            {grouped.length === 0 ? (
              <div className="empty"><p>Nothing in this tab yet.</p></div>
            ) : (
              grouped.map((g) => {
                const got = g.items.filter((it) => checked[it.key]).length;
                return (
                  <div key={g.category}>
                    <div className="cat">
                      <span className="cat-dot" style={{ background: CATEGORY_COLOR[g.category] }} />
                      <span className="cat-name">{g.category}</span>
                      <span className="cat-count">{got}/{g.items.length}</span>
                    </div>
                    {g.items.map((it) => {
                      const on = !!checked[it.key];
                      return (
                        <div className={`item ${on ? "done" : ""}`} key={it.key}>
                          <div className={`box ${on ? "on" : ""}`} role="checkbox" aria-checked={on} tabIndex={0}
                            onClick={() => toggle(it.key)}
                            onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), toggle(it.key))}>
                            <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M20 6 9 17l-5-5" />
                            </svg>
                          </div>
                          <div className="item-main">
                            <div className="item-name">{it.name}</div>
                            <div className="item-qtys">
                              {it.qtys.map((q, i) => (
                                <span key={i}>{q.quantity}{activeTab === "all" && it.qtys.length > 1 ? ` · ${q.recipe}` : ""}</span>
                              ))}
                            </div>
                          </div>
                          {activeTab === "all" && it.tags.length > 0 && (
                            <div className="stickers">
                              {it.tags.map((t) => <span className="sticker" key={t}>{t}</span>)}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })
            )}

            <div className="foot">
              <span>
                {activeTab !== "all" && recipes.find((r) => r.id === activeTab) && (
                  <button className="btn ghost" onClick={() => removeRecipe(activeTab)}>Remove this recipe</button>
                )}
              </span>
              <button className="btn ghost" onClick={startOver}>Start over</button>
            </div>
          </>
        )}

        {recipes.length === 0 && !adding && (
          <div className="empty">
            <h3>Your cart's empty</h3>
            <p>Add a photo or a link to get started.</p>
          </div>
        )}
      </div>
    </div>
  );
}
