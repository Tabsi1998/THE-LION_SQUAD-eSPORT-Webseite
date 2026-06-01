import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { CalendarDays, Newspaper, Search, Trophy, UserRound, Users, X } from "lucide-react";
import { api, resolveMediaUrl } from "@/lib/api";

const KIND_META = {
  tournament: { label: "Turnier", icon: Trophy },
  event: { label: "Event", icon: CalendarDays },
  news: { label: "News", icon: Newspaper },
  player: { label: "Spieler", icon: UserRound },
  team: { label: "Team", icon: Users },
};

const QUICK_LINKS = [
  { label: "Turniere", to: "/tournaments", kind: "tournament" },
  { label: "Events", to: "/events", kind: "event" },
  { label: "News", to: "/news", kind: "news" },
  { label: "Spieler", to: "/players", kind: "player" },
  { label: "Teams", to: "/teams", kind: "team" },
];

function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("de-DE", { dateStyle: "medium" });
}

export function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef(null);
  const location = useLocation();
  const trimmed = query.trim();

  useEffect(() => {
    setOpen(false);
  }, [location.pathname, location.search]);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event) => {
      if (event.key === "Escape") setOpen(false);
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    window.setTimeout(() => inputRef.current?.focus(), 50);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  useEffect(() => {
    if (!open || trimmed.length < 2) {
      setItems([]);
      setLoading(false);
      setError("");
      return undefined;
    }
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError("");
      try {
        const { data } = await api.get("/search", { params: { q: trimmed, limit: 5 } });
        setItems(Array.isArray(data?.items) ? data.items : []);
      } catch {
        setItems([]);
        setError("Suche ist gerade nicht erreichbar.");
      } finally {
        setLoading(false);
      }
    }, 180);
    return () => window.clearTimeout(timer);
  }, [open, trimmed]);

  const grouped = useMemo(() => {
    const map = new Map();
    items.forEach((item) => {
      const key = item.kind || "other";
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(item);
    });
    return [...map.entries()];
  }, [items]);

  const close = () => setOpen(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-10 w-10 items-center justify-center rounded-sm border border-white/10 text-white/70 transition hover:border-[#29B6E8]/50 hover:text-[#29B6E8] hover:bg-[#29B6E8]/10"
        aria-label="Suche öffnen"
        title="Suche"
        data-testid="global-search-open"
      >
        <Search className="h-4 w-4" />
      </button>

      {open && (
        <div className="fixed inset-0 z-[120] bg-black/75 backdrop-blur-sm px-3 py-4 sm:py-10" role="dialog" aria-modal="true" aria-label="Website durchsuchen">
          <button type="button" className="absolute inset-0 cursor-default" aria-label="Suche schließen" onClick={close} />
          <div className="relative mx-auto flex max-h-[calc(100vh-2rem)] w-full max-w-2xl flex-col overflow-hidden rounded-sm border border-white/10 bg-[#0A0A0A] shadow-2xl shadow-black/80">
            <div className="flex items-center gap-3 border-b border-white/10 px-4 py-3">
              <Search className="h-4 w-4 text-[#29B6E8]" />
              <input
                ref={inputRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Turniere, Events, News, Spieler, Teams suchen"
                className="min-w-0 flex-1 bg-transparent text-base text-white outline-none placeholder:text-white/35"
                data-testid="global-search-input"
              />
              <button type="button" onClick={close} className="p-2 text-white/50 transition hover:text-white" aria-label="Schließen">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="overflow-y-auto p-3">
              {trimmed.length < 2 ? (
                <div className="grid gap-2 sm:grid-cols-5">
                  {QUICK_LINKS.map((link) => {
                    const Icon = KIND_META[link.kind].icon;
                    return (
                      <Link
                        key={link.to}
                        to={link.to}
                        onClick={close}
                        className="flex min-h-20 flex-col items-center justify-center gap-2 rounded-sm border border-white/10 bg-white/[0.03] px-3 py-4 text-center text-xs font-bold uppercase tracking-wider text-white/70 transition hover:border-[#29B6E8]/45 hover:text-[#29B6E8]"
                      >
                        <Icon className="h-4 w-4" />
                        {link.label}
                      </Link>
                    );
                  })}
                </div>
              ) : loading ? (
                <div className="py-12 text-center text-xs font-display uppercase tracking-[0.3em] text-white/35">Suche läuft...</div>
              ) : error ? (
                <div className="py-12 text-center text-sm text-[#FF3B30]">{error}</div>
              ) : grouped.length ? (
                <div className="space-y-4">
                  {grouped.map(([kind, rows]) => (
                    <section key={kind}>
                      <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.25em] text-white/35">{KIND_META[kind]?.label || "Treffer"}</div>
                      <div className="space-y-1.5">
                        {rows.map((item) => (
                          <SearchResult key={`${item.kind}:${item.url}`} item={item} onClose={close} />
                        ))}
                      </div>
                    </section>
                  ))}
                </div>
              ) : (
                <div className="py-12 text-center text-sm text-white/45">Keine Treffer gefunden.</div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function SearchResult({ item, onClose }) {
  const meta = KIND_META[item.kind] || {};
  const Icon = meta.icon || Search;
  const date = formatDate(item.date);
  return (
    <Link
      to={item.url}
      onClick={onClose}
      className="flex items-center gap-3 rounded-sm border border-white/10 bg-[#121212] p-3 transition hover:border-[#29B6E8]/45 hover:bg-[#0F1D23]"
    >
      <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-sm border border-white/10 bg-black/30 text-[#29B6E8]">
        {item.image ? (
          <img src={resolveMediaUrl(item.image)} alt="" className="h-full w-full object-cover" loading="lazy" />
        ) : (
          <Icon className="h-5 w-5" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate font-heading text-sm font-bold uppercase text-white">{item.title}</div>
        {(item.subtitle || date) && (
          <div className="mt-0.5 truncate text-xs text-white/45">
            {[item.subtitle, date].filter(Boolean).join(" · ")}
          </div>
        )}
      </div>
      <span className="hidden text-[10px] font-bold uppercase tracking-wider text-[#29B6E8] sm:inline">{meta.label}</span>
    </Link>
  );
}
