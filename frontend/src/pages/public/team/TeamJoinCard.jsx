import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { LogIn, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { api, formatRequestError } from "@/lib/api";
import { AuthFormAlert } from "@/components/tls/AuthFormFields";
import { useSubmissionGuard } from "@/hooks/useSubmissionGuard";

// Einladungs-Link (#1191): Wer /teams/<id>?einladung=<schlüssel> öffnet, sieht oben die Einladung und tippt nur noch
// „Beitreten“ - ohne Konto erst anmelden, danach geht es genau hierher zurück. Ein alter Link sagt, dass er nicht mehr
// gilt, und nennt den Join-Code als Rückfall.

export function TeamJoinCard({ teamId, token, user, onJoined }) {
  const location = useLocation();
  const [check, setCheck] = useState(null);
  const [error, setError] = useState("");
  const { submitting, submitOnce } = useSubmissionGuard();

  useEffect(() => {
    let alive = true;
    api.get(`/teams/${teamId}/invite-link/check`, { params: { token } })
      .then(({ data }) => { if (alive) setCheck(data); })
      .catch(() => { if (alive) setCheck({ valid: false, team: null, already_member: false }); });
    return () => { alive = false; };
  }, [teamId, token, user?.id]);

  if (!check || check.already_member) return null;
  const teamName = check.team?.name || "dieses Team";
  const next = encodeURIComponent(`${location.pathname}${location.search}`);

  if (!check.valid) {
    return (
      <section className="border border-white/15 bg-[#121212] rounded-sm p-4" data-testid="team-join-invalid">
        <div className="font-bold">Dieser Einladungs-Link gilt nicht mehr</div>
        <p className="mt-1 text-sm text-white/60">Frag im Team nach einem neuen Link – oder gib den Join-Code unter „Team beitreten“ ein.</p>
      </section>
    );
  }

  const join = async () => {
    setError("");
    const attempt = await submitOnce(async () => {
      await api.post(`/teams/${teamId}/join-link`, { token });
      toast.success(`Willkommen bei ${teamName}!`);
      await onJoined?.();
    });
    if (attempt.started && attempt.error) setError(formatRequestError(attempt.error, "Beitreten hat nicht geklappt."));
  };

  return (
    <section className="border border-[#29B6E8]/40 bg-[#29B6E8]/[0.07] rounded-sm p-4 sm:p-5" data-testid="team-join-invite">
      <div className="text-[11px] uppercase tracking-widest text-[#29B6E8] font-bold">Einladung</div>
      <div className="mt-1 font-heading text-xl font-bold">Du bist eingeladen: {teamName}</div>
      <p className="mt-1 text-sm text-white/60">{check.team?.member_count ? `${check.team.member_count} Mitglieder warten schon. ` : ""}Ein Tipp, und du bist dabei.</p>
      {error ? <div className="mt-3"><AuthFormAlert id="team-join-invite-error">{error}</AuthFormAlert></div> : null}
      <div className="mt-4 flex flex-wrap gap-2">
        {user ? (
          <button type="button" onClick={join} disabled={submitting} data-testid="team-join-invite-submit" className="tls-btn tls-btn--primary inline-flex items-center gap-2 px-5 py-2.5 rounded-sm text-xs uppercase tracking-wider font-bold disabled:opacity-50">
            <UserPlus className="w-4 h-4" /> {submitting ? "Trete bei…" : "Beitreten"}
          </button>
        ) : (
          <Link to={`/login?next=${next}`} data-testid="team-join-invite-login" className="tls-btn tls-btn--primary inline-flex items-center gap-2 px-5 py-2.5 rounded-sm text-xs uppercase tracking-wider font-bold">
            <LogIn className="w-4 h-4" /> Anmelden und beitreten
          </Link>
        )}
      </div>
      {!user ? <p className="mt-2 text-xs text-white/45">Noch kein Konto? Erst <Link to="/register" className="text-[#29B6E8] hover:underline">registrieren</Link>, dann den Link noch einmal öffnen.</p> : null}
    </section>
  );
}

export default TeamJoinCard;
