import { useCallback, useEffect, useState } from "react";
import { useParams, Link, useSearchParams } from "react-router-dom";
import { API, api, formatRequestError, parseTimeStr, resolveMediaUrl } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { PublicLoadingState } from "@/components/tls/PublicLoadingState";
import { Breadcrumbs } from "@/components/tls/Breadcrumbs";
import { PhaseBadge } from "@/components/tls/PhaseBadge";
import { PrizeList } from "@/components/tls/PrizeList";
import { StreamEmbed } from "@/components/tls/StreamEmbed";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { useCanonicalSlugRedirect } from "@/hooks/useCanonicalSlugRedirect";
import { Tv, Trophy, Flag, Calendar, Trash2, FileDown } from "lucide-react";
import { formatDateTime, getRegistrationState, hasOnlineRegistration } from "@/lib/datetime";
import { renderMarkdownLite } from "@/lib/markdownLite";
import { seoTextPreview } from "@/lib/textPreview";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { useConfirm } from "@/components/tls/ConfirmDialog";
import { toast } from "sonner";

const PUBLIC_RESULT_STATUSES = new Set(["completed", "results_published", "archived"]);

function f1ResultQuery(values = {}) {
  const params = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => {
    if (value) params.set(key, value);
  });
  const query = params.toString();
  return query ? `?${query}` : "";
}

export default function F1DetailPage() {
  const { slug } = useParams();
  const [searchParams] = useSearchParams();
  const accessToken = searchParams.get("access") || "";
  const { user } = useAuth();
  const [challenge, setChallenge] = useState(null);
  const [activeTrack, setActiveTrack] = useState(null);
  const [board, setBoard] = useState(null);
  const [championship, setChampionship] = useState(null);
  const [tab, setTab] = useState("track"); // track | championship
  const seoDescription = seoTextPreview(challenge?.description || challenge?.rules, "F1 Fast-Lap-Challenge von THE LION SQUAD mit Leaderboard, Strecken und Championship-Wertung.");
  useDocumentTitle(challenge?.title || "Fast Lap", seoDescription, {
    image: challenge?.banner_url,
    canonical: challenge?.slug ? `${window.location.origin}/fastlap/${challenge.slug}` : undefined,
  });
  useCanonicalSlugRedirect(slug, challenge?.slug, "/fastlap");

  const loadChallenge = useCallback(async () => {
    const accessConfig = { params: accessToken ? { access: accessToken } : undefined };
    const { data } = await api.get(`/f1/challenges/${slug}`, accessConfig);
    setChallenge(data);
    setActiveTrack((current) => {
      if (current && data.tracks?.some((tr) => tr.id === current)) return current;
      return data.tracks?.[0]?.id || null;
    });
    if (data.is_championship) {
      const { data: cs } = await api.get(`/f1/challenges/${data.id}/championship`, accessConfig);
      setChampionship(cs);
    } else {
      setChampionship(null);
    }
  }, [slug, accessToken]);

  useEffect(() => {
    loadChallenge();
  }, [loadChallenge]);

  useApiInvalidation(loadChallenge, ["f1"]);

  const loadBoard = useCallback(async () => {
    if (!challenge?.id || !activeTrack) return;
    const { data } = await api.get(`/f1/challenges/${challenge.id}/leaderboard`, {
      params: { track_id: activeTrack, ...(accessToken ? { access: accessToken } : {}) },
    });
    setBoard(data);
  }, [challenge?.id, activeTrack, accessToken]);

  useEffect(() => {
    loadBoard();
    const iv = setInterval(loadBoard, 10000);
    return () => clearInterval(iv);
  }, [loadBoard]);

  useApiInvalidation(loadBoard, ["f1"]);

  if (!challenge) return <PublicLayout><PublicLoadingState label="Lade Fast Lap" /></PublicLayout>;

  const hasOnlineSubmission = hasOnlineRegistration(challenge);
  const registration = hasOnlineSubmission ? getRegistrationState(challenge, "Einreichung") : null;
  const showResultPdf = PUBLIC_RESULT_STATUSES.has(challenge.status);

  return (
    <PublicLayout>
      <div className="relative border-b border-white/10 overflow-hidden bg-grid-dense">
        {challenge.banner_url && <img src={resolveMediaUrl(challenge.banner_url)} className="absolute inset-0 w-full h-full object-cover opacity-25" alt="" />}
        <div className="absolute inset-0 bg-gradient-to-b from-[#0A0A0A]/70 to-[#0A0A0A]" />
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-14">
          <Breadcrumbs items={[{ label: "Home", to: "/" }, { label: "eSports", to: "/esports" }, { label: "Fast Lap", to: "/fastlap" }, { label: challenge.title }]} className="mb-3" />
          <Link to="/fastlap" className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8] hover:text-white">← Fast Lap Challenges</Link>
          <div className="mt-2 flex flex-wrap items-center gap-3 mb-3">
            <PhaseBadge phase={challenge.public_phase} status={challenge.status} size="lg" />
            {challenge.is_championship && <span className="text-[11px] font-bold uppercase tracking-wider text-[#FFD700] border border-[#FFD700]/40 px-2 py-1 rounded-sm">Championship</span>}
          </div>
          <h1 data-testid="f1-challenge-title" className="font-heading text-4xl md:text-6xl font-black uppercase leading-tight">{challenge.title}</h1>
          {challenge.description && <div className="mt-3 max-w-2xl prose-cms" dangerouslySetInnerHTML={{ __html: renderMarkdownLite(challenge.description) }} />}
          {challenge.event && (
            <Link to={`/events/${challenge.event.slug || challenge.event.id}`} className="mt-4 inline-flex items-center gap-2 border border-[#9F7AEA]/40 text-[#9F7AEA] hover:bg-[#9F7AEA]/10 px-3 py-2 rounded-sm text-xs uppercase tracking-wider font-bold">
              <Calendar className="w-3.5 h-3.5" /> Teil von {challenge.event.name}
            </Link>
          )}
          {registration && (
            <div className={`mt-5 border rounded-sm px-4 py-3 text-sm max-w-3xl ${
              registration.canRegister
                ? "border-[#00FF88]/30 bg-[#00FF88]/5 text-[#00FF88]"
                : registration.state === "scheduled"
                  ? "border-[#29B6E8]/30 bg-[#29B6E8]/5 text-[#29B6E8]"
                  : "border-white/10 bg-[#121212] text-white/60"
            }`}>
              <div className="font-bold uppercase tracking-wider text-xs">{registration.label}</div>
              <div className="mt-1 text-white/55">
                {challenge.registration_open_from && <span>Öffnet: {formatDateTime(challenge.registration_open_from)}</span>}
                {challenge.registration_open_from && challenge.registration_open_until && <span className="mx-2 text-white/20">·</span>}
                {challenge.registration_open_until && <span>Endet: {formatDateTime(challenge.registration_open_until)}</span>}
                {!challenge.registration_open_from && !challenge.registration_open_until && <span>Zeiten werden durch Admins oder Moderatoren eingetragen.</span>}
              </div>
            </div>
          )}
          {(challenge.block_club_member_results || challenge.allow_club_reference_times !== false) && (
            <div className="mt-4 border border-[#FFD700]/25 bg-[#FFD700]/5 rounded-sm px-4 py-3 text-sm max-w-3xl">
              <div className="font-bold uppercase tracking-wider text-xs text-[#FFD700]">Vereins-Referenzzeiten</div>
              <div className="mt-1 text-white/60">
                {challenge.block_club_member_results
                  ? "Diese Challenge ist für externe Teilnehmer gewertet. Vereinsmitglieder erscheinen nur als Referenzzeiten außer Wertung."
                  : "Vereins-Referenzzeiten sind separat möglich und zählen nicht zur offiziellen Rangliste."}
                {challenge.show_club_reference_times === false && <span> Die Referenzen sind aktuell nur intern sichtbar.</span>}
              </div>
            </div>
          )}
          <div className="mt-6 flex flex-wrap gap-3">
            <Link to={`/display/f1/${challenge.id}${activeTrack ? `?track=${activeTrack}` : ""}`} target="_blank" data-testid="f1-tv-link" className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#29B6E8] text-black font-bold uppercase tracking-wider rounded-sm hover:bg-[#1E95C2] transition">
              <Tv className="w-4 h-4" /> TV / Beamer Modus
            </Link>
            {showResultPdf && (
              <a
                href={`${API}/exports/f1/${challenge.slug || challenge.id}/leaderboard.pdf${f1ResultQuery({ track_id: activeTrack, access: accessToken })}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 px-5 py-2.5 border border-[#29B6E8]/45 text-[#29B6E8] font-bold uppercase tracking-wider rounded-sm hover:bg-[#29B6E8]/10 transition"
              >
                <FileDown className="w-4 h-4" /> Ergebnis-PDF
              </a>
            )}
            {showResultPdf && challenge.is_championship && (
              <a
                href={`${API}/exports/f1/${challenge.slug || challenge.id}/championship.pdf${f1ResultQuery({ access: accessToken })}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 px-5 py-2.5 border border-[#FFD700]/40 text-[#FFD700] font-bold uppercase tracking-wider rounded-sm hover:bg-[#FFD700]/10 transition"
              >
                <Trophy className="w-4 h-4" /> Gesamtwertung-PDF
              </a>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-8">
        {(challenge.has_live_stream || (challenge.twitch_enabled && challenge.twitch_channel)) && (
          <section data-testid="f1-stream"><StreamEmbed source={challenge} /></section>
        )}
        {(challenge.prize_places?.length > 0) && (
          <section>
            <h2 className="font-heading text-xl font-bold uppercase mb-3 flex items-center gap-2"><Trophy className="w-4 h-4 text-[#FFD700]" /> Preise</h2>
            <PrizeList prizePlaces={challenge.prize_places} />
          </section>
        )}
        {challenge.is_championship && (
          <div className="flex gap-2 mb-6">
            <button
              data-testid="f1-tab-track"
              onClick={() => setTab("track")}
              className={`px-4 py-2 text-xs font-bold uppercase tracking-wider rounded-sm border transition ${tab === "track" ? "bg-[#29B6E8] text-black border-[#29B6E8]" : "text-white/70 border-white/10 hover:border-[#29B6E8]/40"}`}
            >
              Strecken-Rangliste
            </button>
            <button
              data-testid="f1-tab-championship"
              onClick={() => setTab("championship")}
              className={`px-4 py-2 text-xs font-bold uppercase tracking-wider rounded-sm border transition ${tab === "championship" ? "bg-[#29B6E8] text-black border-[#29B6E8]" : "text-white/70 border-white/10 hover:border-[#29B6E8]/40"}`}
            >
              Gesamtwertung
            </button>
          </div>
        )}

        {tab === "track" && (
          <div className="grid lg:grid-cols-4 gap-6">
            <aside>
              <div className="text-[11px] uppercase tracking-widest font-bold text-white/50 mb-3">Strecken</div>
              <div className="space-y-2">
                {challenge.tracks?.map((tr) => (
                  <button
                    key={tr.id}
                    data-testid={`f1-track-${tr.id}`}
                    onClick={() => setActiveTrack(tr.id)}
                    className={`w-full text-left p-3 border rounded-sm transition flex items-center gap-3 ${
                      activeTrack === tr.id ? "border-[#29B6E8] bg-[#29B6E8]/10" : "border-white/10 hover:border-[#29B6E8]/40"
                    }`}
                  >
                    {tr.image_url ? (
                      <img src={resolveMediaUrl(tr.image_url)} alt="" className="w-20 h-12 object-contain rounded-sm bg-black/40 border border-white/5" />
                    ) : (
                      <div className="w-20 h-12 rounded-sm bg-[#0A0A0A] border border-white/5" />
                    )}
                    <div className="min-w-0">
                      <div className="font-heading font-bold truncate">{tr.name}</div>
                      <div className="text-[10px] uppercase tracking-widest text-white/50">{tr.country}</div>
                    </div>
                  </button>
                ))}
              </div>
            </aside>
            <div className="lg:col-span-3">
              {board?.track?.image_url ? (
                <div className="mb-5 rounded-sm overflow-hidden border border-white/10 bg-[#050505] aspect-[21/9] flex items-center justify-center">
                  <img src={resolveMediaUrl(board.track.image_url)} alt={board.track.name} className="w-full h-full object-contain" />
                </div>
              ) : null}
              {challenge.can_manage_times && activeTrack && (
                <InlineFastLapTimeEntry
                  challenge={challenge}
                  trackId={activeTrack}
                  currentUser={user}
                  onSaved={loadBoard}
                />
              )}
              <div className="border border-white/10 rounded-sm bg-[#121212] overflow-hidden">
                <div className="p-4 border-b border-white/10 flex items-center justify-between">
                  <h3 className="font-heading text-xl font-bold">{board?.track?.name || "—"}</h3>
                  <span className="text-[11px] uppercase tracking-widest text-white/50 font-display">{board?.entries?.length || 0} Fahrer</span>
                </div>
                <table className="w-full text-sm">
                  <thead className="bg-[#0A0A0A] text-[11px] uppercase tracking-widest text-white/50">
                    <tr>
                      <th className="text-left px-4 py-3 w-12">#</th>
                      <th className="text-left px-4 py-3">Fahrer</th>
                      <th className="text-right px-4 py-3 font-display">Beste Zeit</th>
                      <th className="text-right px-4 py-3">Abstand</th>
                      <th className="text-right px-4 py-3">Versuche</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {board?.entries?.map((e) => (
                      <tr key={e.user_id} data-testid={`f1-row-${e.rank}`} className={e.rank <= 3 ? "bg-[#29B6E8]/5" : ""}>
                        <td className={`px-4 py-3 font-display font-bold ${e.rank === 1 ? "text-[#FFD700]" : e.rank === 2 ? "text-white/80" : e.rank === 3 ? "text-[#CD7F32]" : "text-[#29B6E8]"}`}>{e.rank}</td>
                        <td className="px-4 py-3">{e.display_name}</td>
                        <td className="px-4 py-3 text-right font-display font-bold text-white tabular-nums">
                          <span className="inline-flex items-center gap-1.5">
                            {e.time_str}
                            {e.penalty_seconds > 0 && (
                              <span
                                title={`+${e.penalty_seconds}s Strafzeit · ${e.penalty_note || "ohne Begründung"}`}
                                data-testid={`f1-penalty-${e.user_id}`}
                                className="inline-flex items-center gap-1 text-[10px] font-bold text-[#FF3B30] bg-[#FF3B30]/10 px-1.5 py-0.5 rounded-sm normal-case"
                              >
                                +{e.penalty_seconds}s ⓘ
                              </span>
                            )}
                          </span>
                          {e.penalty_note && (
                            <div className="text-[10px] font-normal text-[#FF3B30]/80 italic mt-0.5 text-right max-w-[260px] ml-auto">
                              „{e.penalty_note}"
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right text-white/60 tabular-nums">{e.gap_str || "—"}</td>
                        <td className="px-4 py-3 text-right text-white/50">{e.attempts}</td>
                      </tr>
                    ))}
                    {(!board || board.entries?.length === 0) && <tr><td colSpan="5" className="text-center py-10 text-white/40">Noch keine Zeiten</td></tr>}
                  </tbody>
                </table>
              </div>
              <ClubReferenceTimes entries={board?.club_reference_entries || []} />
            </div>
          </div>
        )}

        {tab === "championship" && championship && (
          <div className="border border-white/10 rounded-sm bg-[#121212] overflow-hidden">
            <div className="p-4 border-b border-white/10 flex items-center gap-2">
              <Trophy className="w-4 h-4 text-[#FFD700]" />
              <h3 className="font-heading text-xl font-bold">Championship Gesamtwertung</h3>
            </div>
            <table className="w-full text-sm">
              <thead className="bg-[#0A0A0A] text-[11px] uppercase tracking-widest text-white/50">
                <tr>
                  <th className="text-left px-4 py-3 w-12">#</th>
                  <th className="text-left px-4 py-3">Fahrer</th>
                  <th className="text-right px-4 py-3">Siege</th>
                  <th className="text-right px-4 py-3">Rennen</th>
                  <th className="text-right px-4 py-3 font-display">Punkte</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {championship.standings.map((s) => (
                  <tr key={s.user_id} className={s.rank <= 3 ? "bg-[#FFD700]/5" : ""}>
                    <td className={`px-4 py-3 font-display font-bold ${s.rank === 1 ? "text-[#FFD700]" : s.rank === 2 ? "text-white/80" : s.rank === 3 ? "text-[#CD7F32]" : "text-[#29B6E8]"}`}>{s.rank}</td>
                    <td className="px-4 py-3 text-white">{s.display_name}</td>
                    <td className="px-4 py-3 text-right">{s.wins}</td>
                    <td className="px-4 py-3 text-right">{s.races}</td>
                    <td className="px-4 py-3 text-right font-display font-bold text-[#29B6E8] text-lg">{s.points}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </PublicLayout>
  );
}

function InlineFastLapTimeEntry({ challenge, trackId, currentUser, onSaved }) {
  const confirm = useConfirm();
  const [users, setUsers] = useState([]);
  const [times, setTimes] = useState([]);
  const [form, setForm] = useState({ user_id: "", time_str: "", penalty_seconds: 0, proof_url: "", admin_note: "", score_scope: "official" });
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));

  useEffect(() => {
    if (!challenge?.id) return;
    api.get(`/f1/challenges/${challenge.id}/assignable-users`)
      .then(({ data }) => setUsers(data || []))
      .catch(() => setUsers([]));
  }, [challenge?.id]);

  const loadTimes = useCallback(async () => {
    if (!challenge?.id || !trackId) return;
    try {
      const { data } = await api.get(`/f1/challenges/${challenge.id}/times?track_id=${trackId}`);
      setTimes((data || []).slice(0, 25));
    } catch {
      setTimes([]);
    }
  }, [challenge?.id, trackId]);

  useEffect(() => {
    loadTimes();
  }, [loadTimes]);

  useApiInvalidation(loadTimes, ["f1"]);

  const selectedUser = users.find((item) => item.id === form.user_id);
  const forceReferenceScope = !!challenge?.block_club_member_results && !!selectedUser?.is_club_member;

  useEffect(() => {
    if (forceReferenceScope && form.score_scope !== "club_reference") {
      setForm((current) => ({ ...current, score_scope: "club_reference" }));
    }
  }, [forceReferenceScope, form.score_scope]);

  const submit = async (event) => {
    event.preventDefault();
    const ms = parseTimeStr(form.time_str);
    if (!ms) {
      toast.error("Ungültiges Zeitformat. Beispiel: 1:24.587");
      return;
    }
    const penalty = Number(form.penalty_seconds) || 0;
    if (penalty > 0 && (form.admin_note || "").trim().length < 5) {
      toast.error("Bei Strafzeit ist eine Begründung Pflicht.");
      return;
    }
    setSaving(true);
    try {
      await api.post(`/f1/challenges/${challenge.id}/times`, {
        user_id: form.user_id,
        track_id: trackId,
        time_ms: ms,
        penalty_seconds: penalty,
        proof_url: form.proof_url || null,
        admin_note: form.admin_note?.trim() || null,
        score_scope: form.score_scope || "official",
      });
      toast.success("Zeit eingetragen.");
      setForm((current) => ({ ...current, time_str: "", penalty_seconds: 0, proof_url: "", admin_note: "" }));
      await loadTimes();
      onSaved();
    } catch (err) {
      toast.error(formatRequestError(err, "Zeit konnte nicht eingetragen werden."));
    } finally {
      setSaving(false);
    }
  };

  const deleteTime = async (time) => {
    const ok = await confirm({
      title: "Zeit löschen?",
      description: `${time.user?.display_name || time.user?.username || "Fahrer"} - ${time.time_str} wird aus der Challenge entfernt.`,
      confirmLabel: "Zeit löschen",
      tone: "danger",
    });
    if (!ok) return;
    setDeletingId(time.id);
    try {
      await api.delete(`/f1/times/${time.id}`);
      toast.success("Zeit gelöscht.");
      await loadTimes();
      onSaved();
    } catch (err) {
      toast.error(formatRequestError(err, "Zeit konnte nicht gelöscht werden."));
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="mb-5 border border-[#29B6E8]/25 bg-[#29B6E8]/5 rounded-sm p-4">
      <form onSubmit={submit}>
        <div className="flex items-center justify-between gap-3 mb-3">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-widest text-[#29B6E8]">Zeit erfassen</div>
            <div className="text-xs text-white/45 mt-1">Direkt für Zeitnehmer, Schiedsrichter und Organisation.</div>
          </div>
          {currentUser && <div className="text-[10px] uppercase tracking-widest text-white/35">{currentUser.display_name || currentUser.username}</div>}
        </div>
        <div className="grid md:grid-cols-[minmax(12rem,1fr)_9rem_11rem_8rem_auto] gap-2 items-end">
          <label className="block">
            <span className="block text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1">Fahrer</span>
            <select value={form.user_id} onChange={(e) => set("user_id", e.target.value)} required className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm">
              <option value="">- auswählen -</option>
              {users.map((item) => <option key={item.id} value={item.id}>{item.display_name || item.username || item.email}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="block text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1">Zeit</span>
            <input value={form.time_str} onChange={(e) => set("time_str", e.target.value)} required placeholder="1:24.587" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm font-display tabular-nums" />
          </label>
          <label className="block">
            <span className="block text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1">Wertung</span>
            <select value={form.score_scope} onChange={(e) => set("score_scope", e.target.value)} className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm">
              <option value="official" disabled={forceReferenceScope}>Offiziell</option>
              <option value="club_reference">Referenz</option>
            </select>
          </label>
          <label className="block">
            <span className="block text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1">Strafe</span>
            <input type="number" step="0.1" value={form.penalty_seconds} onChange={(e) => set("penalty_seconds", e.target.value)} className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm" />
          </label>
          <button disabled={saving} className="px-4 py-2 bg-[#29B6E8] text-black font-bold uppercase tracking-wider rounded-sm text-sm disabled:opacity-50">Speichern</button>
        </div>
        <div className="mt-2 grid md:grid-cols-2 gap-2">
          <input value={form.proof_url} onChange={(e) => set("proof_url", e.target.value)} placeholder="Proof URL optional" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm" />
          <input value={form.admin_note} onChange={(e) => set("admin_note", e.target.value)} placeholder={Number(form.penalty_seconds) > 0 ? "Begründung für Strafe" : "Notiz optional"} className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm" />
        </div>
        {forceReferenceScope && <div className="mt-2 text-[10px] text-[#FFD700] uppercase tracking-widest">Vereinsmitglied: nur Referenzzeit möglich.</div>}
      </form>

      <div className="mt-4 border-t border-white/10 pt-3">
        <div className="mb-2 flex items-center justify-between gap-3">
          <div className="text-[11px] font-bold uppercase tracking-widest text-white/55">Letzte Zeiten</div>
          <div className="text-[10px] uppercase tracking-widest text-white/35">{times.length} Einträge</div>
        </div>
        <div className="grid md:grid-cols-2 gap-2">
          {times.slice(0, 8).map((time) => (
            <div key={time.id} className={`border rounded-sm px-3 py-2 flex items-center justify-between gap-3 ${time.is_invalid ? "border-[#FF3B30]/35 bg-[#FF3B30]/5" : "border-white/10 bg-[#0A0A0A]/70"}`}>
              <div className="min-w-0">
                <div className="font-bold text-sm truncate">{time.user?.display_name || time.user?.username || "Unbekannt"}</div>
                <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-wider text-white/42">
                  <span>#{time.attempt_number || "-"}</span>
                  {(time.score_scope || "official") === "club_reference" && <span className="text-[#FFD700]">Referenz</span>}
                  {time.penalty_seconds > 0 && <span className="text-[#FF3B30]">+{time.penalty_seconds}s</span>}
                  {time.proof_url && <a href={time.proof_url} target="_blank" rel="noreferrer" className="text-[#29B6E8] hover:underline">Proof</a>}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className={`font-display font-bold tabular-nums ${time.is_invalid ? "line-through text-white/40" : "text-white"}`}>{time.time_str}</span>
                <button
                  type="button"
                  onClick={() => deleteTime(time)}
                  disabled={deletingId === time.id}
                  className="p-1.5 text-white/42 hover:text-[#FF3B30] disabled:opacity-40"
                  title="Zeit löschen"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
          {times.length === 0 && <div className="md:col-span-2 text-center py-5 text-sm text-white/40 border border-dashed border-white/10 rounded-sm">Noch keine Zeiten auf dieser Strecke.</div>}
        </div>
      </div>
    </div>
  );
}

function ClubReferenceTimes({ entries }) {
  if (!entries?.length) return null;
  return (
    <div className="mt-4 border border-[#FFD700]/20 bg-[#FFD700]/5 rounded-sm p-4">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-widest text-[#FFD700]">Vereins-Referenz</div>
          <div className="text-xs text-white/50 mt-0.5">Top 3 außer Wertung als Zielzeit zum Schlagen.</div>
        </div>
        <Flag className="w-4 h-4 text-[#FFD700]" />
      </div>
      <div className="grid sm:grid-cols-3 gap-2">
        {entries.map((entry) => (
          <div key={entry.user_id} className="border border-white/10 bg-[#0A0A0A]/60 rounded-sm px-3 py-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-display font-bold text-[#FFD700]">#{entry.rank}</span>
              <span className="font-display font-bold tabular-nums text-white">{entry.time_str}</span>
            </div>
            <div className="mt-1 text-sm font-bold truncate">{entry.display_name}</div>
            <div className="text-[10px] uppercase tracking-widest text-white/40">{entry.attempts} Versuche</div>
          </div>
        ))}
      </div>
    </div>
  );
}
