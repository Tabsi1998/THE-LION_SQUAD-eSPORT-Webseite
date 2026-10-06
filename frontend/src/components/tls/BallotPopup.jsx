import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { Vote, X } from "lucide-react";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";

// Abstimmung live (#844): Öffnet die Versammlungsleitung in Dolibarr eine Abstimmung, erscheint sie auf jeder Seite -
// für angemeldete Mitglieder mit offenem Stimmrecht. Antwort wählen, „Stimme abgeben“, fertig. „Später“ macht daraus
// ein Band am unteren Rand, bis abgestimmt ist oder die Abstimmung schließt. Geheime Wahlen laufen auf Papier im Saal -
// dafür gibt es nur den Hinweis. Im Admin und auf Anzeige-Seiten bleibt es still, wie bei den Zeremonien.

const QUIET_PREFIXES = ["/admin", "/display", "/setup", "/consent"];

export function rightLabel(right) {
  return right.for === "proxy" ? `Vollmacht für ${right.name || "ein Mitglied"}` : "Deine Stimme";
}

function Choice({ ballot, right, chosen, onChoose, disabled }) {
  return (
    <div className="space-y-2" data-testid={`ballot-right-${right.right_id}`}>
      <div className="text-[11px] font-bold uppercase tracking-widest text-white/55">{rightLabel(right)}</div>
      <div className="flex flex-wrap gap-2">
        {ballot.options.map((option) => (
          <button key={option.code} type="button" disabled={disabled} onClick={() => onChoose(option.code)}
            data-testid={`ballot-option-${right.right_id}-${option.code}`} aria-pressed={chosen === option.code}
            className={`min-h-11 px-4 py-2 rounded-sm border text-sm font-bold transition disabled:opacity-40 ${chosen === option.code ? "border-[#29B6E8] bg-[#29B6E8]/15 text-[#29B6E8]" : "border-white/15 text-white/80 hover:border-white/40"}`}>
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function BallotPopup({ quietPrefixes = QUIET_PREFIXES }) {
  const { user, isClubMember } = useAuth();
  const { pathname } = useLocation();
  const [view, setView] = useState(null);
  const [later, setLater] = useState(() => new Set());
  const [chosen, setChosen] = useState({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const timer = useRef(null);
  const active = Boolean(user && isClubMember);

  const load = useCallback(async () => {
    if (!active) return;
    try {
      const { data } = await api.get("/membership/me/ballots/open");
      setView(data);
    } catch {
      // still: ein Fehler beim Nachsehen soll keine Seite stören
    }
  }, [active]);

  useEffect(() => {
    load();
  }, [load]);
  useApiInvalidation(load, ["ballots"]);
  useEffect(() => {
    clearTimeout(timer.current);
    const seconds = Number(view?.poll_seconds || 0);
    if (active && seconds > 0) timer.current = setTimeout(load, seconds * 1000);
    return () => clearTimeout(timer.current);
  }, [active, view, load]);

  if (!active || !view?.ballots?.length || quietPrefixes.some((prefix) => pathname.startsWith(prefix))) return null;
  const pending = view.ballots.filter((ballot) => !later.has(ballot.id));
  const ballot = pending[0] || null;
  const waiting = view.ballots.filter((item) => later.has(item.id) && item.can_vote);

  const postpone = (id) => {
    setLater((current) => new Set([...current, id]));
    setMessage("");
  };
  const reopen = (id) => setLater((current) => new Set([...current].filter((item) => item !== id)));

  const cast = async () => {
    const rights = ballot.rights.filter((right) => right.can_use && chosen[`${ballot.id}:${right.right_id}`]);
    if (!rights.length) return;
    setBusy(true);
    setMessage("");
    try {
      for (const right of rights) {
        await api.post(`/membership/me/ballots/${ballot.id}/votes`, { right_id: right.right_id, option: chosen[`${ballot.id}:${right.right_id}`] });
      }
      toast.success("Danke – deine Stimme ist angekommen.");
      await load();
    } catch (err) {
      setMessage(formatApiError(err.response?.data?.detail) || "Die Stimme ist nicht angekommen – bitte noch einmal versuchen.");
      await load();
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {ballot ? (
        <div className="fixed inset-0 z-[90] grid place-items-center bg-black/70 p-4" role="dialog" aria-modal="true" aria-labelledby="ballot-popup-title" data-testid="ballot-popup">
          <div className="w-full max-w-lg rounded-sm border border-[#29B6E8]/40 bg-[#0F1012] p-5 shadow-2xl space-y-4">
            <div className="flex items-start gap-3">
              <Vote className="w-6 h-6 text-[#29B6E8] shrink-0 mt-0.5" />
              <div className="min-w-0">
                <div className="text-[11px] font-bold uppercase tracking-widest text-[#29B6E8]">Abstimmung offen{ballot.meeting ? ` · ${ballot.meeting}` : ""}</div>
                <h2 id="ballot-popup-title" className="font-heading text-xl font-black leading-tight mt-1">{ballot.question}</h2>
                {ballot.item ? <div className="text-xs text-white/45 mt-1">Tagesordnungspunkt {ballot.item} · {ballot.kind_label}</div> : null}
              </div>
              <button type="button" onClick={() => postpone(ballot.id)} aria-label="Später" className="ml-auto text-white/50 hover:text-white" data-testid="ballot-popup-later-x">
                <X className="w-5 h-5" />
              </button>
            </div>
            {ballot.secret ? (
              <p className="text-sm text-white/75 border border-[#FFD700]/40 bg-[#FFD700]/10 rounded-sm p-3" data-testid="ballot-popup-secret">
                Geheime Wahl auf Papier: Den Stimmzettel bekommst du im Saal. Über die Website wird hier nicht abgestimmt.
              </p>
            ) : (
              <>
                <p className="text-xs text-white/55" data-testid="ballot-popup-open-note">Offene Abstimmung: Deine Stimme wird mit deinem Namen gespeichert. Eine Stimme lässt sich nicht ändern.</p>
                <div className="space-y-4">
                  {ballot.rights.filter((right) => right.can_use).map((right) => (
                    <Choice key={right.right_id} ballot={ballot} right={right} disabled={busy} chosen={chosen[`${ballot.id}:${right.right_id}`]}
                      onChoose={(code) => setChosen((current) => ({ ...current, [`${ballot.id}:${right.right_id}`]: code }))} />
                  ))}
                </div>
              </>
            )}
            {message ? <p className="text-sm text-white/80" role="status" data-testid="ballot-popup-message">{message}</p> : null}
            <div className="flex flex-wrap justify-end gap-2">
              <button type="button" onClick={() => postpone(ballot.id)} className="px-4 py-2 rounded-sm border border-white/15 text-white/70 text-xs font-bold uppercase tracking-wider" data-testid="ballot-popup-later">
                {ballot.secret ? "Verstanden" : "Später"}
              </button>
              {!ballot.secret ? (
                <button type="button" onClick={cast} disabled={busy || !ballot.rights.some((right) => right.can_use && chosen[`${ballot.id}:${right.right_id}`])}
                  data-testid="ballot-popup-cast" className="tls-btn tls-btn--primary px-4 py-2 rounded-sm text-xs font-bold uppercase tracking-wider disabled:opacity-40">
                  Stimme abgeben
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
      {!ballot && waiting.length ? (
        <button type="button" onClick={() => reopen(waiting[0].id)} data-testid="ballot-band"
          className="fixed bottom-20 lg:bottom-4 left-1/2 -translate-x-1/2 z-[80] max-w-[calc(100%-2rem)] truncate rounded-full border border-[#29B6E8]/50 bg-[#0F1012]/95 px-4 py-2 text-sm font-bold text-[#29B6E8] shadow-lg">
          Abstimmung offen: {waiting[0].question} – jetzt abstimmen
        </button>
      ) : null}
    </>
  );
}
