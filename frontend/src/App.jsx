import React, { useMemo, useState } from "react";
import {
  Upload,
  Loader2,
  Trash2,
  ScanText,
  Brain,
  FileText,
  Table2,
  Code2,
  X,
} from "lucide-react";
import { ocrAny } from "./lib/ocr";

const ALLOWED = [
  "application/pdf",
  "image/tiff",
  "image/png",
  "image/jpeg",
  "image/jpg",
];

function bytesToMB(bytes) {
  return (bytes / 1024 / 1024).toFixed(2) + " MB";
}

function StatusPill({ status }) {
  const map = {
    pending: "bg-slate-100 text-slate-700",
    ocr_done: "bg-blue-100 text-blue-700",
    struct_done: "bg-emerald-100 text-emerald-700",
    error: "bg-red-100 text-red-700",
  };
  const label = {
    pending: "Pending",
    ocr_done: "OCR Done",
    struct_done: "Structured",
    error: "Error",
  };
  return (
    <span
      className={`px-2 py-1 rounded-full text-[11px] font-semibold ${
        map[status] || "bg-slate-100 text-slate-700"
      }`}
    >
      {label[status] || "Pending"}
    </span>
  );
}

/** Receipt-style view (Structured tab) */
function ReceiptView({ data }) {
  if (!data) return null;

  const items = Array.isArray(data.line_items) ? data.line_items : [];

  const money = (n) => {
    if (n === null || n === undefined || Number.isNaN(Number(n))) return "-";
    return Number(n).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  };

  const currency = data.currency || "";

  const showMoney = (n) => {
    if (n === null || n === undefined || Number.isNaN(Number(n))) return "-";
    return `${currency ? currency + " " : ""}${money(n)}`;
  };

  const subtotal =
    data.subtotal ??
    items.reduce((sum, it) => sum + (Number(it.amount) || 0), 0);

  const taxRate = data.tax_rate;
  const taxAmount = data.tax_amount;
  const total = data.total;

  const headerTitle =
    data.doc_type === "invoice"
      ? "Invoice"
      : data.doc_type === "receipt"
        ? "Receipt"
        : "Document";

  const numberLabel = data.receipt_or_invoice_no
    ? `${data.receipt_or_invoice_no}`
    : null;

  return (
    <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
      {/* Header */}
      <div className="p-5 md:p-6 border-b border-slate-200">
        <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-6">
          {/* Vendor / Recipient */}
          <div className="min-w-0">
            <div className="text-lg md:text-xl font-bold text-slate-900">
              {data.vendor_or_sender || "—"}
            </div>
            <div className="text-xs text-slate-500 mt-1">
              {data.doc_type ? data.doc_type.toUpperCase() : "DOCUMENT"}
            </div>

            {(data.recipient_name || data.recipient_address) && (
              <div className="mt-5">
                <div className="text-[11px] font-bold uppercase text-slate-500">
                  Recipient
                </div>
                <div className="text-sm font-semibold text-slate-900 mt-1">
                  {data.recipient_name || "—"}
                </div>
                {data.recipient_address && (
                  <div className="text-sm text-slate-600 whitespace-pre-wrap">
                    {data.recipient_address}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Meta box */}
          <div className="md:w-[360px] w-full">
            <div className="rounded-xl border border-slate-200 overflow-hidden">
              <div className="bg-emerald-600 text-white px-4 py-3 font-bold flex items-center justify-between">
                <span>{headerTitle}</span>
                {numberLabel ? (
                  <span className="text-xs font-semibold opacity-95">
                    {numberLabel}
                  </span>
                ) : null}
              </div>

              <div className="bg-slate-50 px-4 py-3 text-sm text-slate-700 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">Date</span>
                  <span className="font-semibold">{data.date || "—"}</span>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-slate-500">Currency</span>
                  <span className="font-semibold">{currency || "—"}</span>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-slate-500">Doc Type</span>
                  <span className="font-semibold">{data.doc_type || "—"}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Items table */}
      <div className="p-5 md:p-6">
        <div className="overflow-auto rounded-xl border border-slate-200">
          <table className="min-w-full text-sm">
            <thead className="bg-emerald-600 text-white text-xs uppercase sticky top-0">
              <tr>
                <th className="text-left px-4 py-3 w-[22%]">
                  Product / Service
                </th>
                <th className="text-left px-4 py-3 w-[40%]">Description</th>
                <th className="text-right px-4 py-3 w-[8%]">Qty</th>
                <th className="text-right px-4 py-3 w-[15%]">Unit Price</th>
                <th className="text-right px-4 py-3 w-[15%]">Amount</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-100 bg-white">
              {items.length === 0 ? (
                <tr>
                  <td className="px-4 py-5 text-slate-500" colSpan={5}>
                    No line items found.
                  </td>
                </tr>
              ) : (
                items.map((it, idx) => (
                  <tr key={idx} className="hover:bg-slate-50">
                    <td className="px-4 py-3 text-slate-900">
                      {it.product_or_service || "—"}
                    </td>
                    <td className="px-4 py-3 text-slate-700">
                      {it.description || "—"}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-900">
                      {it.qty ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-900">
                      {it.unit_price == null ? "—" : money(it.unit_price)}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-slate-900">
                      {it.amount == null ? "—" : money(it.amount)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Totals + Notes */}
        <div className="mt-6 grid grid-cols-1 md:grid-cols-12 gap-6">
          <div className="md:col-span-6 text-sm text-slate-600">
            {data.notes ? (
              <>
                <div className="font-semibold text-slate-700 mb-1">Notes</div>
                <div className="whitespace-pre-wrap">{data.notes}</div>
              </>
            ) : (
              <div className="text-slate-400">—</div>
            )}
          </div>

          <div className="md:col-span-6 md:flex md:justify-end">
            <div className="w-full md:w-[380px] rounded-xl border border-slate-200 bg-white">
              <div className="px-4 py-3 border-b border-slate-200 font-semibold text-slate-800">
                Totals
              </div>

              <div className="p-4 space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-600">Subtotal</span>
                  <span className="font-medium text-slate-900">
                    {showMoney(subtotal)}
                  </span>
                </div>

                <div className="flex justify-between">
                  <span className="text-slate-600">
                    Tax{taxRate != null ? ` (${taxRate}%)` : ""}
                  </span>
                  <span className="font-medium text-slate-900">
                    {taxAmount == null ? "—" : showMoney(taxAmount)}
                  </span>
                </div>

                <div className="border-t border-slate-200 pt-3 flex justify-between">
                  <span className="font-semibold text-slate-800">Total</span>
                  <span className="font-bold text-slate-900">
                    {total == null ? "—" : showMoney(total)}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Extra metadata */}
        <div className="mt-5 text-xs text-slate-500">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div>
              <span className="font-semibold text-slate-600">Reference:</span>{" "}
              {data.receipt_or_invoice_no || "—"}
            </div>
            <div className="sm:text-right">
              <span className="font-semibold text-slate-600">Doc Type:</span>{" "}
              {data.doc_type || "—"}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [items, setItems] = useState([]);
  const [busy, setBusy] = useState(false);
  const [activeId, setActiveId] = useState(null);
  const [progress, setProgress] = useState(null);
  const [tab, setTab] = useState("structured"); // ocr | structured | json
  const [isDragging, setIsDragging] = useState(false);

  const active = useMemo(
    () => items.find((x) => x.id === activeId),
    [items, activeId],
  );

  function addFiles(fileList) {
    const files = Array.from(fileList || []);
    const ok = files.filter(
      (f) => ALLOWED.includes(f.type) || /\.tif{1,2}$/i.test(f.name),
    );

    const mapped = ok.map((file) => ({
      id: crypto.randomUUID(),
      file,
      status: "pending",
      ocrText: "",
      structured: null,
      err: null,
    }));

    setItems((prev) => [...prev, ...mapped]);
    if (!activeId && mapped[0]) setActiveId(mapped[0].id);
  }

  function remove(id) {
    setItems((prev) => prev.filter((x) => x.id !== id));
    if (activeId === id) setActiveId(null);
  }

  async function runOcr() {
    if (!items.some((x) => x.status === "pending")) return;

    setBusy(true);
    setProgress(null);

    for (const it of items) {
      if (it.status !== "pending") continue;

      try {
        setProgress({ file: it.file.name, stage: "starting" });

        const text = await ocrAny(it.file, (p) => {
          setProgress({ file: it.file.name, ...p });
        });

        setItems((prev) =>
          prev.map((x) =>
            x.id === it.id ? { ...x, ocrText: text, status: "ocr_done" } : x,
          ),
        );

        if (!activeId) setActiveId(it.id);
        setTab("ocr");
      } catch (e) {
        console.error("OCR ERROR:", e);
        setItems((prev) =>
          prev.map((x) =>
            x.id === it.id
              ? { ...x, status: "error", err: e?.message || "OCR failed." }
              : x,
          ),
        );
      }
    }

    setProgress(null);
    setBusy(false);
  }

  async function structureWithGroq() {
    if (!active?.ocrText?.trim()) return;

    setBusy(true);
    try {
      const res = await fetch("http://localhost:5050/api/structure", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileName: active.file.name,
          text: active.ocrText,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Request failed");

      setItems((prev) =>
        prev.map((x) =>
          x.id === active.id
            ? { ...x, structured: data.structured, status: "struct_done" }
            : x,
        ),
      );

      setTab("structured");
    } catch (e) {
      setItems((prev) =>
        prev.map((x) =>
          x.id === active.id
            ? {
                ...x,
                status: "error",
                err: e?.message || "Structuring failed.",
              }
            : x,
        ),
      );
    } finally {
      setBusy(false);
    }
  }

  function clearAll() {
    setItems([]);
    setActiveId(null);
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      {/* Top bar */}
      <div className="sticky top-0 z-10 bg-white/80 backdrop-blur border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div>
            <div className="text-lg font-bold tracking-tight">
              OCR <span className="text-blue-600">Scan</span>
            </div>
            <div className="text-xs text-slate-500">
              Upload → OCR → Groq → Structured View
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={runOcr}
              disabled={busy || !items.some((x) => x.status === "pending")}
              className="px-3 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white text-sm font-semibold inline-flex items-center gap-2"
            >
              {busy ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <ScanText className="w-4 h-4" />
              )}
              Run OCR
            </button>

            <button
              onClick={structureWithGroq}
              disabled={busy || !active?.ocrText?.trim()}
              className="px-3 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 disabled:bg-slate-300 text-white text-sm font-semibold inline-flex items-center gap-2"
            >
              <Brain className="w-4 h-4" />
              Structure
            </button>
          </div>
        </div>
      </div>

      <main className="max-w-7xl mx-auto p-6 grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: Upload + Queue */}
        <section className="lg:col-span-5 space-y-6">
          {/* Upload */}
          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="p-5 border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-2 font-semibold">
                <Upload className="w-4 h-4 text-blue-600" />
                Upload Files
              </div>

              <div className="text-xs text-slate-500">
                PDF / TIF / PNG / JPG
              </div>
            </div>

            <div className="p-5">
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDragging(true);
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setIsDragging(false);
                  addFiles(e.dataTransfer.files);
                }}
                className={`rounded-2xl border-2 border-dashed p-6 text-center transition
                  ${
                    isDragging
                      ? "border-blue-500 bg-blue-50"
                      : "border-slate-200 hover:border-slate-300 bg-slate-50"
                  }`}
              >
                <input
                  type="file"
                  multiple
                  accept=".pdf,.tif,.tiff,.png,.jpg,.jpeg"
                  onChange={(e) => addFiles(e.target.files)}
                  className="hidden"
                  id="file-input"
                />
                <label htmlFor="file-input" className="cursor-pointer block">
                  <div className="mx-auto w-12 h-12 rounded-2xl bg-white border border-slate-200 flex items-center justify-center mb-3">
                    <Upload className="w-5 h-5 text-slate-700" />
                  </div>
                  <div className="text-sm font-semibold text-slate-900">
                    Drag & drop files here, or click to browse
                  </div>
                  <div className="text-xs text-slate-500 mt-1">
                    Best results: clear scans, 300 DPI, straight pages
                  </div>
                </label>
              </div>

              {progress && (
                <div className="mt-4 rounded-xl border border-slate-200 bg-white p-3">
                  <div className="text-xs font-semibold text-slate-900 truncate">
                    {progress.file}
                  </div>
                  <div className="text-xs text-slate-500 mt-1">
                    {progress.stage === "pdf" || progress.stage === "tiff"
                      ? `Processing ${progress.stage} page ${progress.page}/${progress.totalPages}`
                      : "Processing..."}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Queue */}
          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            <div className="p-5 border-b border-slate-200 flex items-center justify-between">
              <div className="font-semibold">Queue</div>
              <div className="flex items-center gap-2">
                <div className="text-xs text-slate-500">
                  {items.length} file{items.length !== 1 ? "s" : ""}
                </div>
                <button
                  onClick={clearAll}
                  className="text-xs text-red-600 hover:underline inline-flex items-center gap-1"
                >
                  <X className="w-3 h-3" />
                  Clear
                </button>
              </div>
            </div>

            <div className="overflow-auto max-h-[420px]">
              {items.length === 0 ? (
                <div className="p-6 text-sm text-slate-500 text-center">
                  No files yet. Add a PDF/TIF/PNG/JPG to start.
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-slate-600 text-xs uppercase sticky top-0">
                    <tr>
                      <th className="text-left px-4 py-3">File</th>
                      <th className="text-left px-4 py-3">Status</th>
                      <th className="text-right px-4 py-3">Size</th>
                      <th className="text-right px-4 py-3">Action</th>
                    </tr>
                  </thead>

                  <tbody className="divide-y divide-slate-100">
                    {items.map((it) => (
                      <tr
                        key={it.id}
                        onClick={() => setActiveId(it.id)}
                        className={`cursor-pointer ${
                          activeId === it.id
                            ? "bg-blue-50"
                            : "hover:bg-slate-50"
                        }`}
                      >
                        <td className="px-4 py-3">
                          <div className="font-medium text-slate-900 truncate max-w-[260px]">
                            {it.file.name}
                          </div>
                          <div className="text-xs text-slate-500">
                            {it.file.type || "unknown"}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <StatusPill status={it.status} />
                        </td>
                        <td className="px-4 py-3 text-right text-slate-700">
                          {bytesToMB(it.file.size)}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              remove(it.id);
                            }}
                            className="inline-flex items-center justify-center p-2 rounded-lg hover:bg-red-50 text-slate-500 hover:text-red-600"
                            title="Remove"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {active?.err && (
              <div className="p-4 border-t border-slate-200 text-sm text-red-600">
                {active.err}
              </div>
            )}
          </div>
        </section>

        {/* Right: Results */}
        <section className="lg:col-span-7">
          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden min-h-[720px] flex flex-col">
            <div className="p-5 border-b border-slate-200">
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-slate-900 truncate">
                    {active ? active.file.name : "Results"}
                  </div>
                  <div className="text-xs text-slate-500 mt-1">
                    {active
                      ? "View OCR text and receipt-style structured output"
                      : "Select a file from the queue"}
                  </div>
                </div>

                {active && (
                  <div className="flex items-center gap-2">
                    <StatusPill status={active.status} />
                  </div>
                )}
              </div>

              {/* Tabs */}
              <div className="mt-4 flex gap-2">
                <button
                  onClick={() => setTab("ocr")}
                  className={`px-3 py-2 rounded-xl text-sm font-semibold inline-flex items-center gap-2 border ${
                    tab === "ocr"
                      ? "bg-slate-900 text-white border-slate-900"
                      : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50"
                  }`}
                >
                  <FileText className="w-4 h-4" />
                  OCR Text
                </button>

                <button
                  onClick={() => setTab("structured")}
                  className={`px-3 py-2 rounded-xl text-sm font-semibold inline-flex items-center gap-2 border ${
                    tab === "structured"
                      ? "bg-slate-900 text-white border-slate-900"
                      : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50"
                  }`}
                >
                  <Table2 className="w-4 h-4" />
                  Receipt View
                </button>

                <button
                  onClick={() => setTab("json")}
                  className={`px-3 py-2 rounded-xl text-sm font-semibold inline-flex items-center gap-2 border ${
                    tab === "json"
                      ? "bg-slate-900 text-white border-slate-900"
                      : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50"
                  }`}
                >
                  <Code2 className="w-4 h-4" />
                  Raw JSON
                </button>
              </div>
            </div>

            <div className="p-5 flex-1">
              {!active ? (
                <div className="h-full flex items-center justify-center text-slate-500">
                  Select a file on the left to see results.
                </div>
              ) : tab === "ocr" ? (
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <pre className="text-xs whitespace-pre-wrap max-h-[560px] overflow-auto">
                    {active.ocrText || "Run OCR to generate extracted text..."}
                  </pre>
                </div>
              ) : tab === "structured" ? (
                active.structured ? (
                  <ReceiptView data={active.structured} />
                ) : (
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-6 text-sm text-slate-600">
                    Run OCR first, then click <b>Structure</b> to generate the
                    receipt view.
                  </div>
                )
              ) : (
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <pre className="text-xs whitespace-pre-wrap max-h-[560px] overflow-auto">
                    {active.structured
                      ? JSON.stringify(active.structured, null, 2)
                      : "No JSON yet. Click Structure after OCR."}
                  </pre>
                </div>
              )}
            </div>
          </div>

          <div className="text-xs text-slate-500 mt-4">
            Developed: <span className="font-mono">Kling</span> Salam
          </div>
        </section>
      </main>
    </div>
  );
}
