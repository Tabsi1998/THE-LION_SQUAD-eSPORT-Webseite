// „Übernahme neu berechnen“ (F.2, #1627, Entscheidung Nr. 162) in der neuen Season: Wurde der Endstand der Vorgänger-Season korrigiert,
// folgen die übernommenen Teams ohne Staffel dem neuen Stand. Erst die Vorschau, dann ausführen. Zugeteilte und abgemeldete Teams bleiben
// und stehen unter „Bitte von Hand prüfen“. Was geht, sagt der Server.
import { useEffect, useState } from "react";
import { CircleAlert } from "lucide-react";
import { toast } from "sonner";
import { AdminSheet } from "@/components/tls/AdminSheet";
import { api, formatApiError } from "@/lib/api";

const KIND_TEXT = {
  moved: "Neue Liga", updated: "Platz oder Zone neu", added: "Kommt dazu", reactivated: "Wieder dabei", revoked: "Übernahme zurückgenommen",
};

function changeLine(change) {
  if (change.kind === "moved") return `${change.from_label} → ${change.to_label}`;
  if (change.kind === "revoked") return `bisher ${change.from_label} – nicht mehr in der neuen Season`;
  return change.to_label || change.from_label || "";
}

export function SeasonRecomputeSheet({ season, onClose, onDone }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(null);
  useEffect(() => {
    let alive = true;
    api.get(`/admin/leagues/seasons/${season.id}/successor/recompute`)
      .then(({ data: body }) => alive && setData(body))
      .catch((failure) => alive && setError(formatApiError(failure.response?.data?.detail) || "Die Vorschau konnte nicht geladen werden."));
    return () => { alive = false; };
  }, [season.id]);

  const submit = async (event) => {
    event.preventDefault();
    if (!data?.can_run || !data.changes.length || saving) return;
    setSaving(true);
    try {
      const { data: answer } = await api.post(`/admin/leagues/seasons/${season.id}/successor/recompute`, { confirm: true, stamp: data.stamp });
      toast.success(`Übernahme neu berechnet: ${answer.changed} ${answer.changed === 1 ? "Änderung" : "Änderungen"}.`);
      // Bleibt etwas von Hand zu prüfen, steht es nach dem Ausführen da - sonst ist die Arbeit getan.
      if (answer.manual?.length) {
        setDone(answer);
        setSaving(false);
      } else {
        onDone();
      }
    } catch (failure) {
      toast.error(formatApiError(failure.response?.data?.detail));
      setSaving(false);
    }
  };

  return (
    <AdminSheet title="Übernahme neu berechnen" eyebrow={season.name} size="lg" onClose={done ? onDone : onClose} onSubmit={submit} saving={saving}
      submitLabel="Jetzt neu berechnen" savingLabel="Berechne …" submitTestId="recompute-run" submitDisabled={Boolean(done) || !data?.can_run || !data?.changes?.length}
      cancelLabel={done ? "Schließen" : "Abbrechen"} testId="recompute-sheet">
      {done ? (
        <section aria-labelledby="recompute-done-manual" className="space-y-2 text-sm" data-testid="recompute-done">
          <p className="text-ok">Neu berechnet: {done.changed} {done.changed === 1 ? "Änderung" : "Änderungen"}.</p>
          <h3 id="recompute-done-manual" className="text-[11px] font-bold uppercase tracking-[0.2em] text-warn">Bitte von Hand prüfen ({done.manual.length})</h3>
          <ul className="space-y-1 text-white/80" data-testid="recompute-done-manual">
            {done.manual.map((row) => (
              <li key={row.application_id} className="[overflow-wrap:anywhere]">
                {row.display_name} – {row.why}{row.to_label ? ` · laut Endstand jetzt ${row.to_label}` : " · laut Endstand nicht mehr dabei"}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {error ? <p className="text-sm text-warn" role="alert">{error}</p> : null}
      {!data && !error ? <p className="text-sm text-white/45" aria-busy="true">Lade Vorschau …</p> : null}
      {data && !done ? (
        <div className="space-y-5 text-sm">
          <p className="text-white/75">
            Aus dem heutigen Endstand von {data.predecessor.name}. Nur Teams ohne Staffel folgen ihm; wer nicht mehr dabei ist, wird zurückgenommen
            (nichts wird gelöscht). Captains, deren Liga sich ändert, bekommen eine Nachricht.
          </p>
          {data.problems.length ? (
            <ul className="space-y-1 text-warn" data-testid="recompute-problems">
              {data.problems.map((text) => <li key={text} className="flex gap-2"><CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /> <span>{text}</span></li>)}
            </ul>
          ) : null}
          {data.can_run && !data.changes.length ? <p className="text-ok" data-testid="recompute-nothing">Alles passt zum Endstand – nichts zu ändern.</p> : null}
          {data.changes.length ? (
            <section aria-labelledby="recompute-changes" className="space-y-2">
              <h3 id="recompute-changes" className="text-[11px] font-bold uppercase tracking-[0.2em] text-white/50">Änderungen ({data.changes.length})</h3>
              <ul className="divide-y divide-white/5 rounded-sm border border-white/10 bg-[#0A0A0A]" data-testid="recompute-changes">
                {data.changes.map((change) => (
                  <li key={`${change.kind}-${change.squad_id}`} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-3 py-2" data-testid={`recompute-change-${change.squad_id}`}>
                    <span className="min-w-0 font-semibold text-white [overflow-wrap:anywhere]">{change.display_name}</span>
                    <span className={`text-xs font-bold uppercase tracking-wider ${change.kind === "revoked" ? "text-warn" : "text-[#29B6E8]"}`}>{KIND_TEXT[change.kind]}</span>
                    <span className="text-xs text-white/60">{changeLine(change)}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {data.manual.length ? (
            <section aria-labelledby="recompute-manual" className="space-y-2">
              <h3 id="recompute-manual" className="text-[11px] font-bold uppercase tracking-[0.2em] text-warn">Bitte von Hand prüfen ({data.manual.length})</h3>
              <p className="text-xs text-white/60">Diese Teams sind schon zugeteilt oder abgemeldet – die Berechnung lässt sie, wie sie sind.</p>
              <ul className="space-y-1 text-white/80" data-testid="recompute-manual">
                {data.manual.map((row) => (
                  <li key={row.application_id} className="[overflow-wrap:anywhere]">
                    {row.display_name} – {row.why}{row.to_label ? ` · laut Endstand jetzt ${row.to_label}` : " · laut Endstand nicht mehr dabei"}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      ) : null}
    </AdminSheet>
  );
}
