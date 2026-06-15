// app/api/extract/route.js
// ---------------------------------------------------------------------------
// The backend. This is the ONLY new code vs. the prototype, and the reason we
// need a server at all: it holds your Anthropic API key (never sent to the
// browser), calls the model, and fetches recipe URLs server-side (no CORS).
//
// The browser POSTs { images:[{media_type,data}], urls:[...] } to /api/extract
// and gets back { recipes:[...], errors:[...] }.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const maxDuration = 60; // seconds; Vercel Hobby allows up to 60

// Model: Sonnet 4.6 reads messy cookbook photos reliably.
// To cut cost, switch to "claude-haiku-4-5" (cheaper, still has vision).
const MODEL = "claude-sonnet-4-6";

const MAX_PHOTOS = 3;
const MAX_LINKS = 3;
const CATEGORY_ORDER = ["Produce", "Meat", "Seafood", "Dairy", "Bar", "Pantry", "Other"];

const SYSTEM = `You extract grocery shopping ingredients from recipes for a shopping-list app.
Return ONLY a JSON object — no prose, no markdown fences. Schema:
{"recipes":[{"shortName":"1-2 words for a tag e.g. 'Sea Bass'","fullName":"full recipe title","ingredients":[{"name":"the shoppable item e.g. 'garlic' not '2 cloves minced garlic'","quantity":"amount as written e.g. '2 cloves','1 tbsp','to taste'","category":"one of: Produce, Meat, Seafood, Dairy, Pantry, Bar, Other"}]}]}
Rules:
- name = what you'd buy/find in a store, lowercase unless a proper noun. Put prep notes (minced, diced) in quantity or drop them.
- Bar = spirits, liqueurs, bitters, wine, mixers. Pantry = oils, spices, flour, sugar, canned/jarred goods, condiments, dry goods. Produce = fresh fruit/veg/herbs. Dairy = milk, cheese, butter, eggs, yogurt. Meat = poultry/beef/pork. Seafood = fish/shellfish.
- Each distinct recipe (each page or each link) is its own entry.
- Never invent ingredients. If a source is unreadable, return {"shortName":"Unreadable","fullName":"Unreadable","ingredients":[]}.`;

function stripToJson(text) {
  let t = (text || "").trim().replace(/```json|```/g, "").trim();
  const first = t.indexOf("{");
  const last = t.lastIndexOf("}");
  if (first !== -1 && last !== -1) t = t.slice(first, last + 1);
  return JSON.parse(t);
}

function normalizeRecipes(parsed) {
  return (parsed.recipes || []).map((r) => ({
    shortName: r.shortName || "Recipe",
    fullName: r.fullName || r.shortName || "Recipe",
    ingredients: (r.ingredients || []).map((i) => ({
      name: i.name || "",
      quantity: i.quantity || "",
      category: CATEGORY_ORDER.includes(i.category) ? i.category : "Other",
    })),
  }));
}

async function callModel(content) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1500,
      system: SYSTEM,
      messages: [{ role: "user", content }],
    }),
  });

  const raw = await res.text();
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error("API returned non-JSON (HTTP " + res.status + ")");
  }
  if (!res.ok || data.error) {
    throw new Error(data.error?.message || "API error HTTP " + res.status);
  }
  const text = (data.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
  if (!text) throw new Error("empty response from the model");
  return normalizeRecipes(stripToJson(text));
}

async function extractFromImage(img) {
  const content = [
    { type: "image", source: { type: "base64", media_type: img.media_type || "image/jpeg", data: img.data } },
    { type: "text", text: "Extract the recipe(s) shown in this image per the schema. Return JSON only." },
  ];
  return callModel(content);
}

async function fetchPageText(url) {
  let res;
  try {
    res = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 (compatible; CartEBee/1.0)" } });
  } catch {
    throw new Error("couldn't reach " + url);
  }
  if (!res.ok) throw new Error("couldn't fetch " + url + " (HTTP " + res.status + ")");
  const html = await res.text();
  // Recipe pages often embed schema.org Recipe data as JSON-LD — grab it first,
  // it's the cleanest structured source. Then add stripped page text as backup.
  const ld = [...html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)]
    .map((m) => m[1])
    .join("\n");
  const body = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return (ld + "\n\n" + body).slice(0, 14000); // cap input tokens / cost
}

async function extractFromUrl(url) {
  const pageText = await fetchPageText(url);
  const content = [
    { type: "text", text: "Recipe page from " + url + ":\n\n" + pageText + "\n\nExtract the recipe(s) per the schema. Return JSON only." },
  ];
  return callModel(content);
}

export async function POST(req) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json({ error: "Server is missing ANTHROPIC_API_KEY." }, { status: 500 });
  }

  let payload;
  try {
    payload = await req.json();
  } catch {
    return Response.json({ error: "Bad request body." }, { status: 400 });
  }

  // Server-side guardrails — the browser caps are friendly UI; THIS is the real
  // protection against a giant/expensive request.
  const images = Array.isArray(payload.images) ? payload.images.slice(0, MAX_PHOTOS) : [];
  const urls = Array.isArray(payload.urls) ? payload.urls.slice(0, MAX_LINKS) : [];
  if (!images.length && !urls.length) {
    return Response.json({ error: "Add at least one photo or link." }, { status: 400 });
  }

  const tasks = [
    ...images.map((img) => extractFromImage(img)),
    ...urls.map((url) => extractFromUrl(url)),
  ];
  const settled = await Promise.allSettled(tasks);

  const recipes = [];
  const errors = [];
  settled.forEach((s) => {
    if (s.status === "fulfilled") recipes.push(...s.value.filter((r) => r.ingredients.length));
    else errors.push(s.reason?.message || "extraction error");
  });

  return Response.json({ recipes, errors });
}
