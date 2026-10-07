import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api, formatRequestError } from "@/lib/api";
import { AuthFormAlert } from "@/components/tls/AuthFormFields";
import { useSubmissionGuard } from "@/hooks/useSubmissionGuard";
import { dissolveSentence, sameTeamName } from "@/lib/teamPage";

// Team auflösen (#1274): ganz unten im Bearbeiten-Blatt statt rot neben „Bearbeiten“. Ein Satz sagt vorher, was
// passiert (Mitglieder, Chat, kommende Turnier-Anmeldungen); erst mit dem richtig eingetippten Teamnamen geht der Knopf.
// Läuft ein Turnier gerade, nennt die Vorschau es - auflösen geht dann erst, wenn die Turnierleitung es geklärt hat.

export function TeamDissolveSection({ team, onDissolved }) {
  const [preview, setPreview] = useState(null);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState("");
  const { submitting, submitOnce } = useSubmissionGuard();

  useEffect(() => {
    let alive = true;
    api.get(`/teams/${team.id}/dissolve-preview`)
      .then(({ data }) => { if (alive) setPreview(data); })
      .catch(() => { if (alive) setPreview(null); });
    return () => { alive = false; };
  }, [team.id]);

  const matches = sameTeamName(team, typed);
  const blocked = preview?.blocked || [];

  const dissolve = async () => {
    if (!matches || blocked.length) return;
    setError("");
    const attempt = await submitOnce(async () => {
      await api.delete(`/teams/${team.id}`, { params: { confirm: typed.trim() } });
      toast.success(`${team.name} ist aufgelöst.`);
      onDissolved?.();
    });
    if (attempt.started && attempt.error) setError(formatRequestError(attempt.error, "Auflösen hat nicht geklappt."));
  };

  return (
    <section className="border border-[#FF3B30]/35 bg-[#FF3B30]/[0.04] rounded-sm p-4 space-y-3" data-testid="team-dissolve">
      <div className="font-heading font-bold text-[#FF6B6B]">Team auflösen</div>
      <p className="text-sm text-white/70" data-testid="team-dissolve-sentence">{preview ? dissolveSentence(preview) : "Alle Mitglieder verlieren das Team und der Team-Chat wird gelöscht."}</p>
      {blocked.length ? (
        <div className="text-sm text-white/70 border border-white/10 rounded-sm p-3 bg-black/30" data-testid="team-dissolve-blocked">
          <div className="font-bold text-white">Gerade nicht möglich:</div>
          <ul className="mt-1 space-y-1">
            {blocked.map((row) => (
              <li key={row.registration_id}>
                <Link to={`/tournaments/${row.slug || row.tournament_id}`} className="text-[#29B6E8] hover:underline">{row.title}</Link> – {row.reason}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <label className="block">
        <span className="text-[11px] font-bold uppercase tracking-widest text-white/60">Zum Bestätigen den Teamnamen eintippen</span>
        <input
          value={typed}
          onChange={(event) => { setTyped(event.target.value); setError(""); }}
          placeholder={team.name}
          autoComplete="off"
          data-testid="team-dissolve-name"
          className="mt-1.5 w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm"
        />
      </label>
      {error ? <AuthFormAlert id="team-dissolve-error">{error}</AuthFormAlert> : null}
      <button
        type="button"
        onClick={dissolve}
        disabled={!matches || blocked.length > 0 || submitting}
        data-testid="team-dissolve-submit"
        className="tls-btn tls-btn--danger inline-flex items-center gap-2 px-4 py-2 rounded-sm text-xs uppercase tracking-wider font-bold disabled:opacity-40"
      >
        <Trash2 className="w-3.5 h-3.5" /> {submitting ? "Löse auf…" : "Team auflösen"}
      </button>
    </section>
  );
}

export default TeamDissolveSection;
