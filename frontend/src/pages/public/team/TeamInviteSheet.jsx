import { useCallback, useEffect, useState } from "react";
import { Copy, RefreshCw, Search, Share2, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { api, formatRequestError } from "@/lib/api";
import { SideSheet } from "@/components/tls/SideSheet";
import { BrandedQRCode } from "@/components/tls/BrandedQRCode";
import { AuthFormAlert } from "@/components/tls/AuthFormFields";
import { useConfirm } from "@/components/tls/ConfirmDialog";
import { useSubmissionGuard } from "@/hooks/useSubmissionGuard";

// „Einladen“ auf der Team-Seite (#1191): Link mit QR-Code - wer ihn öffnet, landet im Team und tippt nur noch
// „Beitreten“. Neu erzeugen macht den alten Link ungültig. Darunter der Join-Code als Rückfall und die Suche nach
// Benutzern für eine persönliche Einladung.

async function copy(value, message) {
  try {
    await navigator.clipboard.writeText(value || "");
    toast.success(message);
  } catch {
    toast.error("Kopieren hat nicht geklappt.");
  }
}

export function TeamInviteSheet({ team, onClose }) {
  const [link, setLink] = useState(null);
  const [error, setError] = useState("");
  const confirm = useConfirm();
  const { submitting, submitOnce } = useSubmissionGuard();

  const load = useCallback(async () => {
    try {
      const { data } = await api.get(`/teams/${team.id}/invite-link`);
      setLink(data);
      setError("");
    } catch (err) {
      setError(formatRequestError(err, "Der Einladungs-Link konnte nicht geladen werden."));
    }
  }, [team.id]);

  useEffect(() => { load(); }, [load]);

  const renew = async () => {
    if (!await confirm({
      title: "Neuen Link erzeugen?",
      description: "Der bisherige Link und sein QR-Code gelten danach nicht mehr. Wer schon im Team ist, bleibt drin.",
      confirmLabel: "Neuen Link erzeugen",
      tone: "info",
    })) return;
    const attempt = await submitOnce(async () => {
      const { data } = await api.post(`/teams/${team.id}/invite-link`);
      setLink(data);
      toast.success("Neuer Link ist da – der alte gilt nicht mehr.");
    });
    if (attempt.started && attempt.error) setError(formatRequestError(attempt.error, "Neuer Link hat nicht geklappt."));
  };

  const share = async () => {
    if (!link?.url) return;
    if (navigator.share) {
      try {
        await navigator.share({ title: `${team.name} – Einladung`, text: `Komm in unser Team ${team.name} bei THE LION SQUAD:`, url: link.url });
        return;
      } catch (err) {
        if (err?.name === "AbortError") return;
      }
    }
    copy(link.url, "Link kopiert.");
  };

  return (
    <SideSheet title="Ins Team einladen" eyebrow={`[${team.tag}] ${team.name}`} onClose={onClose} testId="team-invite-sheet">
      {error ? <AuthFormAlert id="team-invite-link-error">{error}</AuthFormAlert> : null}
      <section className="border border-white/10 bg-[#121212] rounded-sm p-4 space-y-4" data-testid="team-invite-link">
        <div className="flex flex-col sm:flex-row items-center gap-4">
          {link?.url ? <BrandedQRCode value={link.url} size={168} className="shrink-0" /> : <div className="w-[168px] h-[168px] bg-white/5 rounded-sm animate-pulse" />}
          <div className="min-w-0 text-center sm:text-left">
            <div className="font-bold">QR-Code zeigen oder Link teilen</div>
            <p className="mt-1 text-xs text-white/55">Wer den Link öffnet, landet hier im Team und tippt nur noch „Beitreten“ – in der App und auf der Website.</p>
          </div>
        </div>
        <div className="flex gap-2">
          <input readOnly value={link?.url || ""} aria-label="Einladungs-Link" data-testid="team-invite-url" className="flex-1 min-w-0 bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-xs text-white/75" />
          <button type="button" onClick={() => copy(link?.url, "Link kopiert.")} disabled={!link} aria-label="Link kopieren" data-testid="team-invite-copy" className="tls-btn tls-btn--secondary px-3 py-2 rounded-sm"><Copy className="w-4 h-4" /></button>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={share} disabled={!link} data-testid="team-invite-share" className="tls-btn tls-btn--primary inline-flex items-center gap-2 px-4 py-2 rounded-sm text-xs uppercase tracking-wider font-bold disabled:opacity-50">
            <Share2 className="w-3.5 h-3.5" /> Link teilen
          </button>
          <button type="button" onClick={renew} disabled={!link || submitting} data-testid="team-invite-renew" className="tls-btn tls-btn--quiet inline-flex items-center gap-2 px-4 py-2 rounded-sm text-xs uppercase tracking-wider font-bold disabled:opacity-50">
            <RefreshCw className="w-3.5 h-3.5" /> Neuen Link erzeugen
          </button>
        </div>
      </section>

      {team.join_code ? (
        <section className="border border-[#FFD700]/25 bg-[#FFD700]/5 rounded-sm p-4" data-testid="team-join-code-box">
          <div className="text-[11px] uppercase tracking-widest text-[#FFD700] font-bold">Join-Code</div>
          <p className="mt-1 text-xs text-white/55">Falls der Link nicht geht: Code auf der Team-Seite unter „Team beitreten“ eingeben.</p>
          <div className="mt-2 flex gap-2">
            <code className="flex-1 bg-black/40 border border-white/10 px-3 py-2 rounded-sm text-sm">{team.join_code}</code>
            <button type="button" onClick={() => copy(team.join_code, "Join-Code kopiert.")} aria-label="Join-Code kopieren" className="tls-btn tls-btn--secondary px-3 py-2 rounded-sm"><Copy className="w-4 h-4" /></button>
          </div>
        </section>
      ) : null}

      <InviteMemberPanel team={team} />
    </SideSheet>
  );
}

export function InviteMemberPanel({ team }) {
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState([]);
  const [loading, setLoading] = useState(false);
  const { submitting: inviting, submitOnce } = useSubmissionGuard();
  const [inviteError, setInviteError] = useState("");

  useEffect(() => {
    const needle = query.trim();
    if (needle.length < 2) {
      setCandidates([]);
      return undefined;
    }
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const { data } = await api.get(`/teams/${team.id}/invite-candidates?q=${encodeURIComponent(needle)}`);
        setCandidates(data || []);
      } catch {
        setCandidates([]);
      } finally {
        setLoading(false);
      }
    }, 220);
    return () => clearTimeout(timer);
  }, [query, team.id]);

  const invite = async (user) => {
    setInviteError("");
    const attempt = await submitOnce(async () => {
      await api.post(`/teams/${team.id}/invites`, { user_id: user.id });
      toast.success(`${user.display_name || user.username} eingeladen.`);
      setCandidates((rows) => rows.map((row) => row.id === user.id ? { ...row, has_pending_invite: true } : row));
    });
    if (attempt.started && attempt.error) {
      const message = formatRequestError(attempt.error, "Einladung konnte nicht gesendet werden.");
      setInviteError(message);
      toast.error(message);
    }
  };

  return (
    <section className="border border-[#29B6E8]/25 bg-[#29B6E8]/5 rounded-sm p-4 space-y-3" data-testid="team-invite-members">
      <div>
        <div className="text-[11px] uppercase tracking-widest text-[#29B6E8] font-bold">Persönlich einladen</div>
        <p className="mt-1 text-xs text-white/45">Benutzer suchen – die Einladung landet bei ihnen in der Glocke.</p>
      </div>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/35" />
        <input
          value={query}
          onChange={(e) => { setQuery(e.target.value); setInviteError(""); }}
          placeholder="Username suchen"
          className="w-full bg-[#0A0A0A] border border-white/10 pl-9 pr-3 py-2 rounded-sm text-sm"
        />
      </div>
      <div className="space-y-2">
        {loading && <div className="text-xs text-white/40">Suche läuft...</div>}
        {candidates.map((candidate) => (
          <div key={candidate.id} className="flex items-center gap-2 border border-white/10 bg-[#0A0A0A] rounded-sm p-2">
            <div className="min-w-0 flex-1">
              <div className="font-bold text-sm truncate">{candidate.display_name || candidate.username}</div>
              <div className="text-xs text-white/40 truncate">@{candidate.username}</div>
            </div>
            <button
              type="button"
              disabled={candidate.has_pending_invite || inviting}
              onClick={() => invite(candidate)}
              className="tls-btn tls-btn--secondary shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-sm text-[10px] uppercase tracking-wider font-bold disabled:opacity-45 disabled:pointer-events-none"
            >
              <UserPlus className="w-3.5 h-3.5" /> {candidate.has_pending_invite ? "Offen" : "Einladen"}
            </button>
          </div>
        ))}
        {query.trim().length >= 2 && !loading && candidates.length === 0 && <div className="text-xs text-white/35">Keine passenden Benutzer gefunden.</div>}
        {inviteError && <AuthFormAlert id="team-invite-error">{inviteError}</AuthFormAlert>}
      </div>
    </section>
  );
}

export default TeamInviteSheet;
