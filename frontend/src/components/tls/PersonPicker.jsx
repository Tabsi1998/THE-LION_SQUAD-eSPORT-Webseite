import { useEffect, useId, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { api, formatRequestError, resolveMediaUrl } from "@/lib/api";
import { INPUT_CLASS } from "@/components/tls/FormFields";

// Personen wählen (#1354): eine Suche für die ganze Verwaltung - Fahrer und Fast-Lap-Team, Teilnehmer und Helfer im
// Turnier, Speziallinks, Vorstandsposten, Einladungen. Name tippen, Treffer mit Bild und einer Zeile Zusammenhang
// („Mitglied“, „Team Lions Rocket“, „angemeldet“), zuletzt Gewählte oben. Keine E-Mail-Adressen, keine Rollen: der
// Server (GET /admin/people/search) liefert je Zweck höchstens zehn Treffer und prüft, wer den Zweck abfragen darf.
// Fehlt das Recht, steht an dieser Stelle ein Satz - der Rest der Seite geht weiter.

const RECENT_LIMIT = 5;
const DEBOUNCE_MS = 200;

function recentKey(purpose) {
  return `tls_person_picker_recent_${purpose}`;
}

/** Zuletzt Gewählte je Zweck - nur im eigenen Browser, nur Kennung, Name, Bild und Zusammenhang. */
export function readRecent(purpose) {
  try {
    const rows = JSON.parse(window.localStorage.getItem(recentKey(purpose)) || "[]");
    return Array.isArray(rows) ? rows.filter((row) => row && row.id && row.name).slice(0, RECENT_LIMIT) : [];
  } catch {
    return [];
  }
}

export function rememberRecent(purpose, person) {
  if (!person?.id) return;
  try {
    const entry = { id: person.id, name: person.name, avatar_url: person.avatar_url || null, context: person.context || "" };
    const rows = [entry, ...readRecent(purpose).filter((row) => row.id !== person.id)].slice(0, RECENT_LIMIT);
    window.localStorage.setItem(recentKey(purpose), JSON.stringify(rows));
  } catch {
    // Ohne Speicher (privates Fenster) gibt es eben keine Liste „zuletzt gewählt“.
  }
}

export function PersonAvatar({ person, size = "w-8 h-8" }) {
  if (person?.avatar_url) return <img src={resolveMediaUrl(person.avatar_url)} alt="" className={`${size} rounded-sm object-cover shrink-0`} />;
  const letter = String(person?.name || "?").trim().charAt(0).toUpperCase() || "?";
  return <span aria-hidden="true" className={`${size} rounded-sm bg-[#0A0A0A] border border-white/10 shrink-0 inline-flex items-center justify-center text-xs font-bold text-white/60`}>{letter}</span>;
}

/**
 * @param purpose   Zweck der Suche: tournament, fastlap, access_links, board, invite
 * @param contextId Turnier oder Fast Lap, für die gesucht wird
 * @param value     gewählte Person ({ id, name, avatar_url, context }) oder null
 * @param onChange  bekommt die Person oder null („Andere Person wählen“)
 */
export function PersonPicker({ purpose, contextId = null, value = null, onChange, label = "Person", placeholder = "Name tippen …", hint = "", testId = "person-picker", disabled = false, emptyText = "Niemand mit diesem Namen." }) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState([]);
  const [state, setState] = useState("idle"); // idle | loading | ready | error
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const [recent, setRecent] = useState(() => readRecent(purpose));
  const boxRef = useRef(null);
  const listId = useId();

  useEffect(() => { setRecent(readRecent(purpose)); }, [purpose]);

  useEffect(() => {
    const needle = query.trim();
    if (!needle || value) {
      setHits([]);
      setState("idle");
      return undefined;
    }
    let cancelled = false;
    setState("loading");
    const timer = setTimeout(() => {
      api.get("/admin/people/search", { params: { purpose, q: needle, ...(contextId ? { context_id: contextId } : {}) }, skipInvalidation: true })
        .then(({ data }) => {
          if (cancelled) return;
          setHits(Array.isArray(data) ? data : []);
          setState("ready");
          setError("");
        })
        .catch((failure) => {
          if (cancelled) return;
          setHits([]);
          setState("error");
          setError(failure?.response?.status === 403
            ? formatRequestError(failure, "Dafür fehlt dir das Recht, Personen zu suchen.")
            : "Die Suche geht gerade nicht – bitte gleich noch einmal versuchen.");
        });
    }, DEBOUNCE_MS);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [query, purpose, contextId, value]);

  useEffect(() => {
    if (!open) return undefined;
    const close = (event) => { if (boxRef.current && !boxRef.current.contains(event.target)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const choose = (person) => {
    rememberRecent(purpose, person);
    setRecent(readRecent(purpose));
    setQuery("");
    setOpen(false);
    onChange?.(person);
  };

  if (value) {
    return (
      <div className="min-w-0" data-testid={testId}>
        {label && <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">{label}</div>}
        <div className="flex items-center gap-3 border border-[#29B6E8]/30 bg-[#29B6E8]/5 rounded-sm px-3 py-2" data-testid={`${testId}-selected`}>
          <PersonAvatar person={value} />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold truncate">{value.name}</div>
            {value.context && <div className="text-[11px] text-white/50 truncate">{value.context}</div>}
          </div>
          {!disabled && (
            <button type="button" onClick={() => onChange?.(null)} aria-label="Andere Person wählen" data-testid={`${testId}-clear`} className="p-1 text-white/50 hover:text-white">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    );
  }

  const showRecent = open && !query.trim() && recent.length > 0;
  const showHits = open && query.trim().length > 0;
  return (
    <div className="relative min-w-0" ref={boxRef} data-testid={testId}>
      {label && <label htmlFor={`${listId}-input`} className="block text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">{label}</label>}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" aria-hidden="true" />
        <input
          id={`${listId}-input`}
          value={query}
          disabled={disabled}
          onChange={(event) => { setQuery(event.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={(event) => { if (event.key === "Escape") setOpen(false); }}
          placeholder={placeholder}
          autoComplete="off"
          role="combobox"
          aria-expanded={showRecent || showHits}
          aria-controls={`${listId}-list`}
          data-testid={`${testId}-search`}
          className={`${INPUT_CLASS} pl-9`}
        />
      </div>
      {hint && <div className="mt-1 text-xs text-white/45">{hint}</div>}
      {state === "error" && <div className="mt-2 text-xs text-[#FFB4AE]" role="alert" data-testid={`${testId}-error`}>{error}</div>}
      {(showRecent || (showHits && state !== "error")) && (
        <div id={`${listId}-list`} role="listbox" className="mt-2 sm:absolute sm:inset-x-0 sm:top-full sm:mt-1 z-30 max-h-72 overflow-y-auto border border-white/10 bg-[#121212] rounded-sm shadow-2xl shadow-black/50 divide-y divide-white/5" data-testid={`${testId}-list`}>
          {showRecent && <div className="px-3 pt-2 pb-1 text-[10px] font-bold uppercase tracking-widest text-white/40">Zuletzt gewählt</div>}
          {(showRecent ? recent : hits).map((person) => (
            <button
              key={person.id}
              type="button"
              role="option"
              aria-selected="false"
              onClick={() => choose(person)}
              data-testid={`${testId}-option-${person.id}`}
              className="w-full text-left px-3 py-2 hover:bg-white/5 focus:bg-white/5 focus:outline-none transition flex items-center gap-3"
            >
              <PersonAvatar person={person} size="w-7 h-7" />
              <span className="min-w-0">
                <span className="block text-sm font-semibold truncate">{person.name}</span>
                {person.context && <span className="block text-[11px] text-white/45 truncate">{person.context}</span>}
              </span>
            </button>
          ))}
          {showHits && state === "loading" && !hits.length && <div className="px-3 py-3 text-xs text-white/40" role="status">Suche …</div>}
          {showHits && state === "ready" && !hits.length && <div className="px-3 py-3 text-xs text-white/40" data-testid={`${testId}-empty`}>{emptyText}</div>}
        </div>
      )}
    </div>
  );
}

export default PersonPicker;
