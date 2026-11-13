import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Search, UserX, Undo2, Users } from "lucide-react";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/api";
import { useLiveRefresh } from "@/hooks/useLiveRefresh";
import { CountUp, Glow } from "@/components/tls/motion";
import { viennaTime } from "@/lib/vienna";
import { checkinStatusText, placementMessage } from "@/lib/tournamentFillIn";
import {
  checkinCounterText, checkinCounts, checkinFilter, checkinMatches, checkinSummary, feeAmount, memberGroups, shownStatus,
} from "@/lib/tournamentCheckin";

// Reiter „Check-in“ der Turnierleitung (#1161): vor Ort checkt nur die Turnierleitung ein - am Handy mit einem Tipp.
// Oben „13 von 16 da“, darunter die Suche; je Zeile „Da“, „Rückgängig“ und „Nicht erschienen“. Teams stehen als eine
// Zeile da, mit Aufstellung oder Mitgliedern. Ein offenes Startgeld trägt ein Etikett.
// Der Zähler stimmt sofort: der Tipp setzt den Stand gleich (optimistisch), der Server bestätigt - geht es schief, springt
// die Zeile zurück und eine Meldung sagt warum. Gespeichert wird über denselben Weg wie in der App.

const FILTERS = [
  ["missing", "Fehlen noch"],
  ["present", "Da"],
  ["all", "Alle"],
];

export function CheckinBoard({ slug, tournamentId, eventId }) {
  const [board, setBoard] = useState(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  // Was gerade gespeichert wird: Kennung → neuer Stand. Gilt vor dem Stand vom Server, bis der Server antwortet.
  const [pending, setPending] = useState({});
  // Frisch abgehakt (diese Sitzung): nur dort zeichnet sich das Häkchen nach - nicht bei allem, was schon da war.
  const [fresh, setFresh] = useState({});
  // Rückfrage vor „Nicht erschienen“ (Review M2): rückt dann jemand von der Warteliste nach, erst bestätigen lassen.
  const [asking, setAsking] = useState("");

  const load = useCallback(async () => {
    try {
      const { data } = await api.get(`/tournaments/${encodeURIComponent(slug)}/lead/checkin`);
      setBoard(data);
      setError("");
    } catch (err) {
      setError(formatApiError(err.response?.data?.detail) || "Die Liste lässt sich gerade nicht laden.");
    }
  }, [slug]);

  useEffect(() => { load(); }, [load]);
  // Zwei Helfer am Einlass: was der andere abhakt, kommt hier an.
  useLiveRefresh(load, ["tournaments"], { fallbackMs: 15000, tournamentId, eventId });

  const rows = useMemo(() => board?.rows || [], [board]);
  // Freigeben steht in der Turnierverwaltung, Reiter Teilnehmer.
  const adminUrl = `/admin/tournaments/${encodeURIComponent(board?.tournament?.id || tournamentId || slug)}?tab=participants`;
  const counts = checkinCounts(rows, pending);
  const shown = useMemo(
    () => rows.filter((row) => checkinMatches(row, query) && checkinFilter(row, filter, pending)),
    [rows, query, filter, pending],
  );

  const ask = (row, status) => {
    if (status === "no_show" && board?.waitlist_moves_up) {
      setAsking(row.id);
      return;
    }
    setStatus(row, status);
  };

  const setStatus = async (row, status) => {
    setAsking("");
    if (pending[row.id]) return;
    setPending((now) => ({ ...now, [row.id]: status }));
    if (status === "checked_in") setFresh((now) => ({ ...now, [row.id]: true }));
    try {
      const { data } = await api.post(`/tournaments/${encodeURIComponent(tournamentId || slug)}/registrations/${row.id}/checkin`, { status });
      if (status === "no_show") toast.success(checkinStatusText(status, data));
      const placed = placementMessage(data?.placement);
      if (placed) toast[placed.tone](placed.text);
      // Der Stand des Servers übernimmt; erst dann fällt die vorläufige Anzeige weg (kein Zurückspringen dazwischen).
      setBoard((now) => (now ? { ...now, rows: now.rows.map((item) => (item.id === row.id ? { ...item, status: data?.status || status, checked_in: (data?.status || status) === "checked_in", checked_in_at: data?.checked_in_at || null } : item)) } : now));
    } catch (err) {
      setFresh((now) => ({ ...now, [row.id]: false }));
      toast.error(`${row.name}: ${formatApiError(err.response?.data?.detail) || "Das hat nicht geklappt – bitte noch einmal."}`);
    } finally {
      setPending((now) => {
        const next = { ...now };
        delete next[row.id];
        return next;
      });
    }
  };

  if (error && !board) {
    return <div className="mt-5 rounded-sm border border-white/10 bg-surface-1 p-6 text-center text-white/60" data-testid="lead-checkin-error">{error}</div>;
  }
  if (!board) return <div className="py-10 text-center text-white/40">Wird geladen …</div>;

  return (
    <div className="mt-5" data-testid="lead-checkin">
      <CheckinCounter counts={counts} />

      <label className="relative mt-4 block">
        <span className="sr-only">Suchen</span>
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" aria-hidden="true" />
        {/* 16 px Schrift: sonst zoomt das iPhone beim Antippen in die Seite. */}
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          enterKeyHint="search"
          autoComplete="off"
          placeholder={board.team_mode ? "Team, Kürzel oder Mitglied suchen" : "Name oder Spielname suchen"}
          className="min-h-[48px] w-full rounded-sm border border-white/10 bg-surface-0 py-3 pl-10 pr-3 text-base text-white placeholder:text-white/35 focus:border-brand/60 focus:outline-none"
          data-testid="lead-checkin-search"
        />
      </label>

      <div className="mt-3 grid grid-cols-3 gap-1 rounded-sm border border-white/10 bg-white/5 p-1" role="group" aria-label="Filter" data-testid="lead-checkin-filters">
        {FILTERS.map(([key, label]) => {
          const number = key === "missing" ? counts.missing : key === "present" ? counts.present : counts.total;
          return (
            <button key={key} type="button" aria-pressed={filter === key} onClick={() => setFilter(key)} className={`tls-lead-tap min-h-[44px] rounded-sm text-[11px] sm:text-xs font-bold uppercase tracking-wider ${filter === key ? "bg-brand text-black" : "text-white/60"}`} data-testid={`lead-checkin-filter-${key}`}>
              {label} ({number})
            </button>
          );
        })}
      </div>

      <ul className="mt-3 space-y-2" data-testid="lead-checkin-list">
        {shown.map((row) => (
          <CheckinRow key={row.id} row={row} status={shownStatus(row, pending)} saving={Boolean(pending[row.id])} fresh={Boolean(fresh[row.id])} asking={asking === row.id} adminUrl={adminUrl} onStatus={(status) => ask(row, status)} onConfirm={() => setStatus(row, "no_show")} onCancel={() => setAsking("")} />
        ))}
      </ul>
      {rows.length === 0 ? (
        <div className="mt-3 rounded-sm border border-white/10 bg-surface-1 p-6 text-center text-white/50" data-testid="lead-checkin-empty">Noch keine Anmeldungen.</div>
      ) : shown.length === 0 ? (
        <div className="mt-3 rounded-sm border border-white/10 bg-surface-1 p-6 text-center text-white/50" data-testid="lead-checkin-none">
          {query ? `Niemand passt zu „${query}“.` : filter === "missing" ? "Alle da – niemand fehlt mehr." : "Hier ist gerade niemand."}
        </div>
      ) : null}

      <p className="mt-4 text-xs text-white/40">
        {board.tournament?.self_checkin
          ? "Spieler können auch selbst einchecken – was hier steht, gilt für beide Wege. "
          : "Vor Ort checkt nur die Turnierleitung ein. "}
        Jeder Tipp steht im Protokoll (wer, wann, was). Freigeben, Ablehnen und das PDF stehen in der Turnierverwaltung.
      </p>
    </div>
  );
}

/** „13 von 16 da“ mit Balken - die Zahl zählt beim Abhaken vom alten Stand hoch, der Balken wächst mit. */
function CheckinCounter({ counts }) {
  const previous = useRef(0);
  const from = previous.current;
  useEffect(() => { previous.current = counts.present; }, [counts.present]);
  const share = counts.total ? counts.present / counts.total : 0;
  const summary = checkinSummary(counts);
  return (
    <div className="rounded-sm border border-white/10 bg-surface-1 p-4" data-testid="lead-checkin-counter">
      <div className="flex items-baseline gap-2" aria-live="polite" aria-atomic="true">
        <span className="sr-only">{checkinCounterText(counts)}</span>
        <span aria-hidden="true" className="font-heading text-4xl font-black leading-none text-white">
          <CountUp value={counts.present} from={from} playKey={String(counts.present)} duration={360} whenVisible={false} flash={false} data-testid="lead-checkin-present" />
        </span>
        <span aria-hidden="true" className="text-sm font-bold uppercase tracking-wider text-white/55">von <span className="tabular-nums" data-testid="lead-checkin-total">{counts.total}</span> da</span>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/10" aria-hidden="true">
        <div className="tls-lead-checkin-bar h-full w-full origin-left rounded-full bg-ok" style={{ transform: `scaleX(${share})` }} />
      </div>
      {summary ? <div className="mt-2 text-xs text-white/55" data-testid="lead-checkin-summary">{summary}</div> : null}
    </div>
  );
}

function CheckMark({ draw }) {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" aria-hidden="true">
      <path d="M5 12.5l4.5 4.5L19 7.5" pathLength="1" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className={draw ? "tls-lead-check-draw" : undefined} />
    </svg>
  );
}

function StatusChips({ row, status }) {
  const amount = feeAmount(row);
  return (
    <div className="mt-1 flex flex-wrap gap-1.5">
      {row.fee === "open" ? (
        <span className="rounded-sm border border-warn/50 bg-warn/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-warn" data-testid={`lead-checkin-fee-${row.id}`}>
          Startgeld offen{amount ? ` · ${amount}` : ""}
        </span>
      ) : null}
      {status === "pending" ? <span className="rounded-sm border border-white/20 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white/60">Freigabe offen</span> : null}
      {row.onsite ? <span className="rounded-sm border border-brand/40 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-brand">Vor Ort angemeldet</span> : null}
      {status === "no_show" ? <span className="rounded-sm border border-warn/50 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-warn">Nicht erschienen</span> : null}
    </div>
  );
}

function TeamMembers({ row }) {
  const groups = memberGroups(row);
  if (!(row.members || []).length) return null;
  return (
    <div className="mt-2 border-t border-white/10 pt-2" data-testid={`lead-checkin-members-${row.id}`}>
      <div className="flex items-center gap-1.5 text-[11px] text-white/50">
        <Users className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span>{row.lineup_set ? "Aufstellung" : "Keine Aufstellung – ganzes Team"} · {row.members_present} von {row.members.length} sagen „Ich bin da“</span>
      </div>
      {groups.map((group) => (
        <div key={group.key} className="mt-1.5 flex flex-wrap items-center gap-1">
          {group.label ? <span className="mr-0.5 text-[10px] font-bold uppercase tracking-wider text-white/40">{group.label}</span> : null}
          {group.members.map((member) => (
            <span key={member.id} className={`max-w-full rounded-sm border px-1.5 py-0.5 text-[11px] [overflow-wrap:anywhere] ${member.present ? "border-ok/40 text-white/85" : "border-white/10 text-white/50"}`}>
              {member.present ? <span className="sr-only">da: </span> : null}{member.name}{member.leader ? " (Leitung)" : ""}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}

/** Die Rückfrage in der Zeile - kein Browser-Dialog. Fokus auf „Abbrechen“, Escape bricht ab. */
function NoShowQuestion({ row, onConfirm, onCancel }) {
  const cancel = useRef(null);
  const close = useRef(onCancel);
  close.current = onCancel;
  useEffect(() => {
    cancel.current?.focus();
    const onKey = (event) => { if (event.key === "Escape") close.current(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  return (
    <div
      role="alertdialog"
      aria-labelledby={`lead-checkin-ask-text-${row.id}`}
      className="tls-lead-ask mt-3 rounded-sm border border-warn/40 bg-warn/[0.07] p-3"
      data-testid={`lead-checkin-ask-${row.id}`}
    >
      <p id={`lead-checkin-ask-text-${row.id}`} className="text-sm text-white/85">
        <span className="font-bold text-white">{row.name} nicht erschienen?</span> Dann rückt jemand von der Warteliste nach – das lässt sich nicht einfach rückgängig machen.
      </p>
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        <button ref={cancel} type="button" onClick={onCancel} className="tls-btn tls-btn--quiet tls-lead-tap min-h-[44px] rounded-sm px-4 text-xs font-bold uppercase tracking-wider" data-testid={`lead-checkin-ask-cancel-${row.id}`}>Abbrechen</button>
        <button type="button" onClick={onConfirm} className="tls-btn tls-btn--danger tls-lead-tap min-h-[44px] rounded-sm px-4 text-xs font-bold uppercase tracking-wider" data-testid={`lead-checkin-ask-confirm-${row.id}`}>Ja, nicht erschienen</button>
      </div>
    </div>
  );
}

export function CheckinRow({ row, status, saving, fresh, asking = false, adminUrl = "", onStatus, onConfirm, onCancel }) {
  const here = status === "checked_in";
  const gone = status === "no_show";
  const at = here && row.checked_in_at ? viennaTime(row.checked_in_at, { hour: "2-digit", minute: "2-digit" }) : "";
  return (
    <li
      className={`tls-lead-checkin-row rounded-sm border p-3 ${here ? "border-ok/45 bg-ok/[0.06]" : gone ? "border-warn/30 bg-surface-1" : "border-white/10 bg-surface-1"}`}
      data-testid={`lead-checkin-row-${row.id}`}
      data-status={status}
    >
      <div className="flex items-center gap-3">
        {/* Frisch abgehakt: der Kreis leuchtet einmal grün auf, während sich das Häkchen nachzeichnet. */}
        <Glow key={here ? "here" : "open"} as="div" active={here && fresh} tone="ok" style={{ "--tls-glow-radius": "9999px" }} className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-2 ${here ? "border-ok bg-ok/15 text-ok" : "border-white/15 text-transparent"}`} data-testid={`lead-checkin-mark-${row.id}`}>
          {here ? <CheckMark draw={fresh} /> : null}
        </Glow>
        <div className="min-w-0 flex-1">
          <div className="font-bold text-white [overflow-wrap:anywhere]">
            {row.team_tag ? <span className="mr-1 text-brand">[{row.team_tag}]</span> : null}{row.name}
          </div>
          {row.ingame_name ? <div className="text-xs text-white/50 [overflow-wrap:anywhere]">{row.ingame_name}</div> : null}
          {here ? <div className="text-[11px] font-bold uppercase tracking-wider text-ok">Da{at ? ` · ${at}` : ""}</div> : null}
          <StatusChips row={row} status={status} />
        </div>
        {here || gone ? (
          <button type="button" disabled={saving} onClick={() => onStatus("approved")} className="tls-btn tls-btn--quiet tls-lead-tap inline-flex min-h-[48px] shrink-0 items-center gap-1.5 rounded-sm px-3 text-xs font-bold uppercase tracking-wider" data-testid={`lead-checkin-undo-${row.id}`}>
            <Undo2 className="h-4 w-4" aria-hidden="true" /> Rückgängig
          </button>
        ) : status === "pending" ? (
          // Freigabe offen (Review M3): erst freigeben - die Freigabe prüft Platz und Startgeld. Abhaken geht danach.
          <a href={adminUrl} className="tls-btn tls-btn--secondary tls-lead-tap inline-flex min-h-[48px] max-w-[9rem] shrink-0 items-center rounded-sm px-3 text-center text-[11px] font-bold uppercase leading-tight tracking-wider" data-testid={`lead-checkin-approve-${row.id}`}>
            Erst freigeben
          </a>
        ) : (
          <button type="button" disabled={saving} onClick={() => onStatus("checked_in")} className="tls-btn tls-btn--primary tls-lead-tap min-h-[48px] min-w-[5.5rem] shrink-0 rounded-sm px-4 text-sm font-black uppercase tracking-wider" data-testid={`lead-checkin-here-${row.id}`} aria-label={`${row.name} ist da`}>
            Da
          </button>
        )}
      </div>
      {asking ? <NoShowQuestion row={row} onConfirm={onConfirm} onCancel={onCancel} /> : null}
      {!here && !gone && !asking ? (
        <div className="mt-2 flex justify-end">
          <button type="button" disabled={saving} onClick={() => onStatus("no_show")} className="tls-lead-tap inline-flex min-h-[44px] items-center gap-1.5 rounded-sm px-2 text-[11px] font-bold uppercase tracking-wider text-white/50 hover:text-warn" data-testid={`lead-checkin-noshow-${row.id}`} aria-label={`${row.name} nicht erschienen`}>
            <UserX className="h-4 w-4" aria-hidden="true" /> Nicht erschienen
          </button>
        </div>
      ) : null}
      {row.kind === "team" ? <TeamMembers row={row} /> : null}
    </li>
  );
}

export default CheckinBoard;
