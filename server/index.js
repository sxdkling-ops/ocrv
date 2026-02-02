import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import Groq from "groq-sdk";

dotenv.config();

const app = express();

// ✅ Allow your Vercel frontend + local dev
const allowedOrigins = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "https://ocrv-3nl6.vercel.app", // ✅ your current Vercel domain
];

// If you use preview deployments on Vercel (random URLs), this helps too:
function isAllowedOrigin(origin) {
  if (!origin) return true; // allow server-to-server / curl
  if (allowedOrigins.includes(origin)) return true;
  if (origin.endsWith(".vercel.app")) return true; // allow Vercel previews
  return false;
}

app.use(
  cors({
    origin: (origin, cb) => {
      if (isAllowedOrigin(origin)) return cb(null, true);
      return cb(new Error("CORS blocked: " + origin));
    },
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);

app.use(express.json({ limit: "10mb" }));

// ✅ Basic health check (useful for Render)
app.get("/", (req, res) => {
  res.json({ ok: true, message: "OCRV server is running" });
});

app.get("/health", (req, res) => {
  res.json({ ok: true });
});

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

function toNumber(x) {
  if (x === null || x === undefined) return null;
  if (typeof x === "number") return Number.isFinite(x) ? x : null;

  const s = String(x)
    .replace(/[, ]+/g, "")
    .replace(/[^0-9.-]/g, "");
  if (!s) return null;

  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function round2(n) {
  if (n === null || n === undefined) return null;
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function approxEqual(a, b, tol = 0.05) {
  if (a === null || b === null) return false;
  return Math.abs(a - b) <= tol;
}

function reconcileMath(structured) {
  if (!structured || typeof structured !== "object") return structured;

  structured.subtotal = round2(toNumber(structured.subtotal));
  structured.tax_rate = toNumber(structured.tax_rate); // 13 means 13%
  structured.tax_amount = round2(toNumber(structured.tax_amount));
  structured.total = round2(toNumber(structured.total));

  const items = Array.isArray(structured.line_items)
    ? structured.line_items
    : [];

  structured.line_items = items.map((it) => {
    let qty = toNumber(it.qty);
    let unit = round2(toNumber(it.unit_price));
    let amt = round2(toNumber(it.amount));

    // fill missing amount
    if (amt === null && qty !== null && unit !== null) amt = round2(qty * unit);

    // fill missing unit
    if (unit === null && qty !== null && amt !== null && qty !== 0)
      unit = round2(amt / qty);

    // fill missing qty (prefer integer)
    if (qty === null && unit !== null && amt !== null && unit !== 0) {
      const q = amt / unit;
      const qInt = Math.round(q);
      qty = Math.abs(q - qInt) < 0.02 ? qInt : round2(q);
    }

    // if all 3 exist but inconsistent, try to fix qty as integer using amount/unit
    if (qty !== null && unit !== null && amt !== null) {
      const calc = round2(qty * unit);
      if (!approxEqual(calc, amt)) {
        const q = amt / unit;
        const qInt = Math.round(q);
        const calc2 = round2(qInt * unit);
        if (Math.abs(q - qInt) < 0.05 && approxEqual(calc2, amt, 0.1)) {
          qty = qInt;
        } else {
          // last resort: adjust unit to match amount/qty
          if (qty !== 0) unit = round2(amt / qty);
        }
      }
    }

    return {
      product_or_service: it.product_or_service ?? null,
      description: it.description ?? null,
      qty,
      unit_price: unit,
      amount: amt,
    };
  });

  // derive subtotal from items if missing
  const sumItems = round2(
    structured.line_items.reduce((s, it) => s + (toNumber(it.amount) || 0), 0),
  );
  if (structured.subtotal === null && sumItems) structured.subtotal = sumItems;

  // derive tax amount if missing but have subtotal + rate
  if (
    structured.tax_amount === null &&
    structured.subtotal !== null &&
    structured.tax_rate !== null
  ) {
    structured.tax_amount = round2(
      structured.subtotal * (structured.tax_rate / 100),
    );
  }

  // derive total if missing
  if (
    structured.total === null &&
    structured.subtotal !== null &&
    structured.tax_amount !== null
  ) {
    structured.total = round2(structured.subtotal + structured.tax_amount);
  }

  return structured;
}

app.post("/api/structure", async (req, res) => {
  try {
    const { text, fileName } = req.body;

    if (!text || !text.trim()) {
      return res.status(400).json({ error: "No OCR text provided." });
    }

    const system = `
You extract structured fields from OCR text of receipts/invoices/statements.
Return ONLY valid JSON. No markdown, no extra text.
Use null when unknown. Do not invent.
Prefer values that match arithmetic in the document.
`.trim();

    const user = `
File: ${fileName || "unknown"}

OCR TEXT:
${text}

Return this exact JSON shape:

{
  "doc_type": "invoice|receipt|statement|memo|other",
  "vendor_or_sender": string|null,
  "receipt_or_invoice_no": string|null,
  "date": string|null,
  "currency": string|null,

  "recipient_name": string|null,
  "recipient_address": string|null,

  "subtotal": number|null,
  "tax_rate": number|null,
  "tax_amount": number|null,
  "total": number|null,

  "line_items": [
    {
      "product_or_service": string|null,
      "description": string|null,
      "qty": number|null,
      "unit_price": number|null,
      "amount": number|null
    }
  ],

  "notes": string|null
}

Rules:
- date must be ISO if possible (YYYY-MM-DD)
- numbers must be plain numbers only (no commas, no currency symbol)
- If the document has "Receipt for #XXXX" or "Invoice #", put it into receipt_or_invoice_no
- If a table has Qty/Cost/Total: map to qty/unit_price/amount
- Enforce arithmetic where possible:
  - qty * unit_price = amount (rounding ok)
  - subtotal + tax_amount = total (rounding ok)
- If tax is shown like "Tax (13%) 456.30": tax_rate=13 and tax_amount=456.30
- If a memo: put summary into notes, leave line_items empty
`.trim();

    // ✅ Helpful error if missing key
    if (!process.env.GROQ_API_KEY) {
      return res.status(500).json({ error: "Missing GROQ_API_KEY in env." });
    }

    const completion = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      temperature: 0.1,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      response_format: { type: "json_object" },
    });

    const raw = completion.choices?.[0]?.message?.content || "{}";
    const parsed = JSON.parse(raw);
    const reconciled = reconcileMath(parsed);

    res.json({ structured: reconciled });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to structure OCR output." });
  }
});

// ✅ Render uses process.env.PORT, so this is perfect
const PORT = process.env.PORT || 5050;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
