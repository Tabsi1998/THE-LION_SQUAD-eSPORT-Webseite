import { useEffect, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { api, formatApiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { Breadcrumbs } from "@/components/tls/Breadcrumbs";
import { StatusBadge } from "@/components/tls/StatusBadge";
import { toast } from "sonner";
import { Calendar, Users, Trophy, MapPin, Gamepad2, Radio, Zap, Twitch } from "lucide-react";
import { PrizeList } from "@/components/tls/PrizeList";
import { StreamEmbed } from "@/components/tls/StreamEmbed";
import { formatDateTime, getRegistrationState } from "@/lib/datetime";

export default function TournamentDetailPage() {
  const { slug } = useParams();
  const nav = useNavigate();
  const { user } = useAuth();
  const [t, setT] = useState(null);
  const [regs, setRegs] = useState([]);
  const [myReg, setMyReg] = useState(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    const { data } = await api.get(`/tournaments/${slug}`);
    setT(data);
    const { data: r } = await api.get(`/tournaments/${data.id}/registrations`);
    setRegs(r);
    if (user) setMyReg(r.find((x) => x.user_id === user.id) || null);
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [slug, user?.id]);

  const handleRegister = async () => {
    if (!user) { nav(`/login?next=/tournaments/${slug}`); return; }
    setLoading(true);
    try {
      await api.post(`/tournaments/${t.id}/register`, {
        ingame_name: user.display_name || user.username,
        discord: user.discord_name,
        accept_rules: true, accept_privacy: true,
      });
      toast.success("Erfolgreich angemeldet!");
      load();
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail));
    } finally { setLoading(false); }
  };

  const handleCheckin = async () => {
    try {
      await api.post(`/tournaments/${t.id}/checkin`);
      toast.success("Check-in erfolgt.");
      load();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };

  if (!t) return <PublicLayout><div className="p-20 text-center font-display tracking-widest text-white/40">LADE …</div></PublicLayout>;

  const registration = getRegistrationState(t, "Anmeldung");

  return (
    <PublicLayout>
      <div className="relative border-b border-white/10 bg-grid-dense">
        {t.banner_url && (
          <div className="absolute inset-0">
            <img src={t.banner_url} alt="" className="w-full h-full object-cover opacity-20" />
            <div className="absolute inset-0 bg-gradient-to-b from-transparent to-[#0A0A0A]" />
          </div>
        )}
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-14">
          <Breadcrumbs items={[{ label: "Home", to: "/" }, { label: "eSports", to: "/tournaments" }, { label: "Turniere", to: "/tournaments" }, { label: t.title }]} className="mb-4" />
          <div className="flex flex-wrap items-center gap-2 mb-4">
            <StatusBadge status={t.status} size="lg" />
            <span className="text-[11px] font-bold uppercase tracking-widest text-[#29B6E8] border border-[#29B6E8]/30 rounded-sm px-2 py-1">{t.format?.replace("_", " ")}</span>
            {t.game && <span className="text-white/60 text-sm">· {t.game.name}</span>}
          </div>
          <h1 data-testid="tournament-title" className="font-heading text-4xl md:text-6xl font-black uppercase leading-tight">{t.title}</h1>
          {t.description && <p className="mt-4 text-white/70 max-w-2xl">{t.description}</p>}

          <div className="mt-8 grid grid-cols-2 md:grid-cols-4 gap-3 max-w-3xl">
            <InfoTile icon={Calendar} label="Start" value={formatDateTime(t.start_date)} />
            <InfoTile icon={Users} label="Teilnehmer" value={`${t.participant_count}/${t.max_participants}`} />
            <InfoTile icon={Gamepad2} label="Plattform" value={t.platform || "—"} />
            <InfoTile icon={Trophy} label="Format" value={t.format?.replace("_", " ")} />
          </div>

          <div className={`mt-5 border rounded-sm px-4 py-3 text-sm max-w-3xl ${
            registration.canRegister
              ? "border-[#00FF88]/30 bg-[#00FF88]/5 text-[#00FF88]"
              : registration.state === "scheduled"
                ? "border-[#29B6E8]/30 bg-[#29B6E8]/5 text-[#29B6E8]"
                : "border-white/10 bg-[#121212] text-white/60"
          }`}>
            <div className="font-bold uppercase tracking-wider text-xs">{registration.label}</div>
            <div className="mt-1 text-white/55">
              {t.registration_open_from && <span>Öffnet: {formatDateTime(t.registration_open_from)}</span>}
              {t.registration_open_from && t.registration_open_until && <span className="mx-2 text-white/20">·</span>}
              {t.registration_open_until && <span>Endet: {formatDateTime(t.registration_open_until)}</span>}
              {!t.registration_open_from && !t.registration_open_until && <span>Status wird vom Admin gesteuert.</span>}
            </div>
          </div>

          <div className="mt-8 flex flex-wrap gap-3">
            {registration.canRegister && !myReg && (
              <button
                data-testid="tournament-register-btn"
                onClick={handleRegister}
                disabled={loading}
                className="px-6 py-3 bg-[#29B6E8] text-black font-bold uppercase tracking-wider rounded-sm hover:bg-[#1E95C2] disabled:opacity-50 transition"
              >
                {loading ? "Wird gesendet…" : "Jetzt anmelden"}
              </button>
            )}
            {!registration.canRegister && !myReg && (
              <button
                type="button"
                disabled
                className="px-6 py-3 border border-white/10 text-white/35 font-bold uppercase tracking-wider rounded-sm cursor-not-allowed"
              >
                {registration.label}
              </button>
            )}
            {myReg && myReg.status === "approved" && t.status === "check_in" && (
              <button onClick={handleCheckin} data-testid="tournament-checkin-btn" className="px-6 py-3 bg-[#FFD700] text-black font-bold uppercase tracking-wider rounded-sm hover:bg-[#EAC200] transition">
                Check-in
              </button>
            )}
            {myReg && <StatusBadge status={myReg.status} size="lg" />}
            <Link to={`/tournaments/${t.slug || t.id}/bracket`} data-testid="tournament-bracket-link" className="px-6 py-3 border border-white/20 text-white font-bold uppercase tracking-wider rounded-sm hover:border-[#29B6E8]/60 hover:text-[#29B6E8] transition">
              Bracket ansehen
            </Link>
            <Link to={`/tournaments/${t.slug || t.id}/standings`} data-testid="tournament-standings-link" className="px-6 py-3 border border-white/20 text-white font-bold uppercase tracking-wider rounded-sm hover:border-[#29B6E8]/60 hover:text-[#29B6E8] transition">
              Standings
            </Link>
            {t.stream_link && (
              <a href={t.stream_link} target="_blank" rel="noreferrer" data-testid="tournament-stream-link" className="px-6 py-3 border border-[#FF3B30]/40 text-[#FF3B30] font-bold uppercase tracking-wider rounded-sm hover:bg-[#FF3B30]/10 transition inline-flex items-center gap-2">
                <Radio className="w-4 h-4" /> Stream
              </a>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 grid lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-8">
          {t.rules && (
            <section>
              <h2 className="font-heading text-2xl font-bold uppercase mb-3 flex items-center gap-2"><Zap className="w-4 h-4 text-[#29B6E8]" /> Regeln</h2>
              <div className="text-white/80 whitespace-pre-line border border-white/10 rounded-sm p-5 bg-[#121212]">{t.rules}</div>
            </section>
          )}
          {(t.prize_places?.length || t.prize_pool) && (
            <section>
              <h2 className="font-heading text-2xl font-bold uppercase mb-3 flex items-center gap-2"><Trophy className="w-4 h-4 text-[#FFD700]" /> Preise</h2>
              <PrizeList prizePlaces={t.prize_places} prizePool={t.prize_pool} />
            </section>
          )}
          {(t.has_live_stream || (t.twitch_enabled && t.twitch_channel)) && (
            <section data-testid="tournament-stream"><StreamEmbed source={t} /></section>
          )}
          <section>
            <h2 className="font-heading text-2xl font-bold uppercase mb-3">Teilnehmer ({regs.length})</h2>
            <div className="border border-white/10 rounded-sm divide-y divide-white/5 bg-[#121212]">
              {regs.map((r, i) => (
                <div key={r.id} className="flex items-center justify-between px-4 py-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="font-display font-bold text-[#29B6E8] w-6">{i + 1}</span>
                    <span className="text-white truncate">{r.display_name || r.ingame_name || r.user?.display_name || "—"}</span>
                    {r.team && <span className="text-white/40 text-xs">[{r.team.tag}]</span>}
                  </div>
                  <StatusBadge status={r.status} />
                </div>
              ))}
              {regs.length === 0 && <div className="p-6 text-white/40 text-sm text-center">Noch keine Teilnehmer</div>}
            </div>
          </section>
        </div>
        <aside className="space-y-4">
          {t.location && <InfoRow icon={MapPin} label="Location" value={t.location} />}
          {t.registration_open_from && <InfoRow icon={Calendar} label="Anmeldung öffnet" value={formatDateTime(t.registration_open_from)} />}
          {t.registration_open_until && <InfoRow icon={Calendar} label="Anmeldung endet" value={formatDateTime(t.registration_open_until)} />}
          {t.check_in_from && <InfoRow icon={Calendar} label="Check-in öffnet" value={formatDateTime(t.check_in_from)} />}
          {t.check_in_until && <InfoRow icon={Calendar} label="Check-in endet" value={formatDateTime(t.check_in_until)} />}
          {t.best_of > 1 && <InfoRow icon={Trophy} label="Best of" value={t.best_of} />}
          <InfoRow icon={Users} label="Modus" value={t.team_mode} />
          {t.discord_link && <a href={t.discord_link} target="_blank" rel="noreferrer" className="block px-4 py-3 border border-white/10 rounded-sm text-center text-sm font-bold uppercase tracking-wider hover:border-[#29B6E8]/60 hover:text-[#29B6E8]">Discord</a>}
        </aside>
      </div>
    </PublicLayout>
  );
}

function InfoTile({ icon: Icon, label, value }) {
  return (
    <div className="border border-white/10 rounded-sm bg-[#121212] px-4 py-3">
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-widest text-white/50"><Icon className="w-3.5 h-3.5" /> {label}</div>
      <div className="mt-1 font-display font-bold text-lg text-white truncate">{value}</div>
    </div>
  );
}
function InfoRow({ icon: Icon, label, value }) {
  return (
    <div className="border border-white/10 rounded-sm p-4 bg-[#121212]">
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-widest text-white/50"><Icon className="w-3.5 h-3.5" /> {label}</div>
      <div className="mt-1 text-white">{value}</div>
    </div>
  );
}
