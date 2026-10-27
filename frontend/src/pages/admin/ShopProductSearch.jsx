import { useState } from "react";
import { Link2, Search } from "lucide-react";
import { api, formatRequestError } from "@/lib/api";
import { viennaDateTime } from "@/lib/vienna";

// Produktsuche im Printful-Katalog (#2069) für Schritt 1: Die Produktnummer steht im Printful-Dashboard nirgends. Gesucht
// wird über Name, Marke, Modell und Kategorie - oder über einen Link aus dem Dashboard (nur bei eindeutigem Treffer).
// Der Katalog kommt aus dem Zwischenspeicher der Website (ein Tag); „Übernehmen“ setzt die Nummer.

const INPUT = "mt-1 w-full min-h-10 bg-black/40 border border-white/15 rounded-sm px-3 text-sm placeholder:text-white/35 focus:border-brand outline-none disabled:opacity-50";
const BUTTON = "tls-btn tls-btn--secondary min-h-10 px-4 text-xs font-bold uppercase tracking-wider rounded-sm inline-flex items-center gap-1.5 disabled:opacity-40";

export default function ProductSearch({ disabled, current, onPick }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [link, setLink] = useState("");
  const [answer, setAnswer] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const ask = async (params) => {
    setBusy(true);
    setError("");
    try {
      const { data } = await api.get("/admin/shop/printful-catalog", { params });
      setAnswer(data);
    } catch (failure) {
      setError(formatRequestError(failure, "Der Printful-Katalog lässt sich gerade nicht laden."));
    } finally {
      setBusy(false);
    }
  };
  const searchByName = (event) => {
    event.preventDefault();
    ask({ q: query.trim(), ...(category ? { category_id: Number(category) } : {}) });
  };
  const searchByLink = (event) => {
    event.preventDefault();
    if (link.trim()) ask({ link: link.trim() });
  };

  return (
    <div className="space-y-3" data-testid="shop-product-search">
      <p className="text-sm text-white/70">Ein Produkt je Modell – Farben und Größen wählst du im nächsten Schritt.</p>
      <form className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,14rem)_auto] sm:items-end" onSubmit={searchByName} role="search">
        <label className="block text-sm"><span className="text-white/70">Suche im Printful-Katalog</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} maxLength={120} placeholder="z. B. Gildan 5000, Snapback, Trikot, Tasse"
            className={INPUT} disabled={disabled} data-testid="shop-search-query" />
        </label>
        <label className="block text-sm"><span className="text-white/70">Kategorie</span>
          <select value={category} onChange={(event) => setCategory(event.target.value)} className={INPUT} disabled={disabled || !answer?.categories?.length} data-testid="shop-search-category">
            <option value="">Alle Kategorien</option>
            {(answer?.categories || []).map((row) => <option key={row.id} value={row.id}>{`${"– ".repeat(row.depth)}${row.title}`}</option>)}
          </select>
        </label>
        <button type="submit" disabled={disabled || busy} className={BUTTON} data-testid="shop-search-submit">
          <Search className="w-3.5 h-3.5" aria-hidden="true" /> {busy ? "Sucht …" : "Suchen"}
        </button>
      </form>
      <form className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end" onSubmit={searchByLink}>
        <label className="block text-sm"><span className="text-white/70">Oder Link aus dem Printful-Dashboard einfügen</span>
          <input value={link} onChange={(event) => setLink(event.target.value)} maxLength={500} placeholder="https://www.printful.com/dashboard/custom/…/unisex-classic-tee-gildan-5000"
            className={INPUT} disabled={disabled} data-testid="shop-search-link" />
        </label>
        <button type="submit" disabled={disabled || busy || !link.trim()} className={BUTTON} data-testid="shop-search-link-submit">
          <Link2 className="w-3.5 h-3.5" aria-hidden="true" /> Link prüfen
        </button>
      </form>
      {error && <p className="text-xs text-warn" role="alert" data-testid="shop-search-error">{error}</p>}
      {answer && (
        <div className="space-y-2" aria-live="polite">
          <p className="text-xs text-white/50" data-testid="shop-search-meta">
            {answer.link ? answer.link.detail : `${answer.total} Treffer${answer.total > answer.results.length ? `, die ersten ${answer.results.length}` : ""}`}
            {` · Katalog vom ${viennaDateTime(answer.fetched_at)}`}{answer.stale ? " (Printful gerade nicht erreichbar – letzter Stand)" : ""}
          </p>
          <ul className="divide-y divide-white/10 border border-white/10 rounded-sm" data-testid="shop-search-results">
            {answer.results.map((row) => (
              <li key={row.id} className="flex items-center gap-3 p-2" data-testid={`shop-search-hit-${row.id}`}>
                <div className="w-14 h-14 shrink-0 bg-white/5 rounded-sm overflow-hidden flex items-center justify-center">
                  {row.image ? <img src={row.image} alt="" referrerPolicy="no-referrer" loading="lazy" className="max-w-full max-h-full object-contain" /> : null}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-bold text-sm truncate">{row.name}</div>
                  <div className="text-xs text-white/55">
                    Nr. <span className="tabular-nums">{row.id}</span>{row.techniques.length ? ` · ${row.techniques.join(", ")}` : ""} · {row.colors} Farben · {row.sizes} Größen
                    {row.is_discontinued ? <span className="text-warn"> · eingestellt</span> : null}
                  </div>
                </div>
                <button type="button" disabled={disabled || row.is_discontinued} onClick={() => onPick(row.id)} aria-pressed={current === row.id}
                  className={`tls-btn ${current === row.id ? "tls-btn--primary" : "tls-btn--secondary"} min-h-9 px-3 text-xs font-bold uppercase tracking-wider rounded-sm disabled:opacity-40`}
                  data-testid={`shop-search-pick-${row.id}`}>
                  {current === row.id ? "Gewählt" : "Übernehmen"}
                </button>
              </li>
            ))}
            {!answer.results.length && <li className="p-3 text-sm text-white/55">Nichts gefunden – andere Wörter oder eine Kategorie versuchen.</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
