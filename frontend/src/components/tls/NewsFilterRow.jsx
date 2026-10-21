import { useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { newsCategoryLabel } from "@/lib/newsCategories";

// Filter der News (#1249, Fabians Wahl vom 07.10. zu #1342): eine Zeile weicher Knöpfe zum Wischen - aktiv gefüllt in
// Cyan, sonst leise -, nur Kategorien mit Artikeln samt Anzahl (der Server zählt je Besucher, `/news-meta` → in_use).
// Die Suche ist ein Symbol am Ende der Zeile und klappt zum Feld auf; sie nimmt keine eigene Reihe ein.

function Pill({ id, label, count, active, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      data-testid={`news-filter-${id}`}
      className={`tls-news-pill shrink-0 inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-bold whitespace-nowrap ${active ? "bg-[#29B6E8] text-black" : "bg-white/[0.05] text-white/65 hover:bg-white/[0.09] hover:text-white"}`}
    >
      {label}
      <span className={`tabular-nums text-[11px] font-semibold ${active ? "text-black/60" : "text-white/40"}`}>{count}</span>
    </button>
  );
}

export function NewsFilterRow({ categories = [], active = "", onSelect, query = "", onQuery }) {
  const [searchOpen, setSearchOpen] = useState(Boolean(query.trim()));
  const inputRef = useRef(null);
  const focusOnOpen = useRef(false);

  useEffect(() => {
    if (query.trim()) setSearchOpen(true);
  }, [query]);

  useEffect(() => {
    if (searchOpen && focusOnOpen.current) {
      focusOnOpen.current = false;
      inputRef.current?.focus();
    }
  }, [searchOpen]);

  const total = categories.reduce((sum, row) => sum + (Number(row.count) || 0), 0);
  const rows = active && !categories.some((row) => row.k === active)
    ? [...categories, { k: active, l: newsCategoryLabel(active), count: 0 }]
    : categories;

  const openSearch = () => {
    focusOnOpen.current = true;
    setSearchOpen(true);
  };
  const closeSearch = () => {
    onQuery("");
    setSearchOpen(false);
  };

  return (
    <div className="flex items-center gap-2 min-w-0" data-testid="news-filters">
      <div
        className="tls-news-pills flex flex-nowrap items-center gap-2 tls-swipe min-w-0 flex-1 py-1"
        data-testid="news-filter-row"
        role="group"
        aria-label="Kategorien"
      >
        <Pill id="all" label="Alle" count={total} active={!active} onClick={() => onSelect("")} />
        {rows.map((row) => (
          <Pill key={row.k} id={row.k} label={row.l} count={row.count} active={active === row.k} onClick={() => onSelect(row.k)} />
        ))}
      </div>
      {searchOpen ? (
        <div className="tls-news-search relative shrink-0 w-44 sm:w-64">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-white/40" aria-hidden="true" />
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") closeSearch();
            }}
            placeholder="News suchen"
            aria-label="News suchen"
            data-testid="news-search"
            className="w-full rounded-full border border-white/10 bg-[#0A0A0A] py-1.5 pl-8 pr-9 text-sm text-white outline-none transition-colors placeholder:text-white/30 focus:border-[#29B6E8]/60"
          />
          <button
            type="button"
            onClick={closeSearch}
            aria-label="Suche leeren"
            className="absolute right-1 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-white/45 transition-colors hover:bg-white/10 hover:text-white"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={openSearch}
          aria-label="News suchen"
          data-testid="news-search-open"
          className="tls-news-pill shrink-0 inline-flex h-8 w-8 items-center justify-center rounded-full bg-white/[0.05] text-white/65 hover:bg-white/[0.09] hover:text-white"
        >
          <Search className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
