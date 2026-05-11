import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { api, formatApiError, resolveMediaUrl } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { Breadcrumbs } from "@/components/tls/Breadcrumbs";
import { StatusBadge } from "@/components/tls/StatusBadge";
import { PhaseBadge } from "@/components/tls/PhaseBadge";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { toast } from "sonner";
import { Calendar, Users, Trophy, MapPin, Gamepad2, Radio, Zap, X, Flag, MessageSquare, Send } from "lucide-react";
import { PrizeList } from "@/components/tls/PrizeList";
import { StreamEmbed } from "@/components/tls/StreamEmbed";
import { formatDateTime, getRegistrationState } from "@/lib/datetime";
import { renderMarkdownLite } from "@/lib/markdownLite";
import { formatTeamMode, formatTournamentFormat } from "@/lib/tournamentLabels";

export default function TournamentDetailPage() {
  const { slug } = useParams();
  const nav = useNavigate();
  const { user } = useAuth();
  const [t, setT] = useState(null);
  const [regs, setRegs] = useState([]);
  const [myReg, setMyReg] = useState(null);
  const [loading, setLoading] = useState(false);
  const [registerModal, setRegisterModal] = useState(false);

  const load = useCallback(async () => {
    const { data } = await api.get(`/tournaments/${slug}`);
    setT(data);
    const { data: r } = await api.get(`/tournaments/${data.id}/registrations`);
    setRegs(r);
    setMyReg(user ? r.find((x) => x.user_id === user.id) || null : null);
  }, [slug, user]);

  useEffect(() => {
    load();
    const iv = setInterval(load, 10000);
    return () => clearInterval(iv);
  }, [load]);

  useApiInvalidation(load, ["tournaments"]);

  const submitRegistration = async (playerIds = {}) => {
    if (!user) { nav(`/login?next=/tournaments/${slug}`); return; }
    setLoading(true);
    try {
      await api.post(`/tournaments/${t.id}/register`, {
        ingame_name: user.display_name || user.username,
        discord: user.discord_name,
        player_ids: playerIds,
        accept_rules: true, accept_privacy: true,
      });
      toast.success("Erfolgreich angemeldet!");
      setRegisterModal(false);
      load();
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail));
    } finally { setLoading(false); }
  };

  const handleRegister = async () => {
    if (!user) { nav(`/login?next=/tournaments/${slug}`); return; }
    if (t.game?.player_id_fields?.length) {
      setRegisterModal(true);
      return;
    }
    await submitRegistration();
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
            <img src={resolveMediaUrl(t.banner_url)} alt="" className="w-full h-full object-cover opacity-20" />
            <div className="absolute inset-0 bg-gradient-to-b from-transparent to-[#0A0A0A]" />
          </div>
        )}
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-14">
          <Breadcrumbs items={[{ label: "Home", to: "/" }, { label: "eSports", to: "/tournaments" }, { label: "Turniere", to: "/tournaments" }, { label: t.title }]} className="mb-4" />
          <div className="flex flex-wrap items-center gap-2 mb-4">
            <PhaseBadge phase={t.public_phase} status={t.status} size="lg" />
            <span className="text-[11px] font-bold uppercase tracking-widest text-[#29B6E8] border border-[#29B6E8]/30 rounded-sm px-2 py-1">{formatTournamentFormat(t.format)}</span>
            {t.game && <span className="text-white/60 text-sm">· {t.game.name}</span>}
          </div>
          <h1 data-testid="tournament-title" className="font-heading text-4xl md:text-6xl font-black uppercase leading-tight">{t.title}</h1>
          {t.description && <div className="mt-4 max-w-2xl prose-cms" dangerouslySetInnerHTML={{ __html: renderMarkdownLite(t.description) }} />}

          <div className="mt-8 grid grid-cols-2 md:grid-cols-4 gap-3 max-w-3xl">
            <InfoTile icon={Calendar} label="Start" value={formatDateTime(t.start_date)} />
            <InfoTile icon={Users} label="Teilnehmer" value={`${t.participant_count}/${t.max_participants}`} />
            <InfoTile icon={Gamepad2} label="Plattform" value={t.platform || "—"} />
            <InfoTile icon={Trophy} label="Format" value={formatTournamentFormat(t.format)} />
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
              Turnierbaum ansehen
            </Link>
            <Link to={`/tournaments/${t.slug || t.id}/standings`} data-testid="tournament-standings-link" className="px-6 py-3 border border-white/20 text-white font-bold uppercase tracking-wider rounded-sm hover:border-[#29B6E8]/60 hover:text-[#29B6E8] transition">
              Rangliste
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
          {!!t.related_f1_challenges?.length && (
            <section>
              <h2 className="font-heading text-2xl font-bold uppercase mb-3 flex items-center gap-2"><Flag className="w-4 h-4 text-[#29B6E8]" /> Fast-Lap Challenges beim Event</h2>
              <div className="grid sm:grid-cols-2 gap-3">
                {t.related_f1_challenges.map((c) => (
                  <Link key={c.id} to={`/fastlap/${c.slug || c.id}`} className="border border-white/10 hover:border-[#29B6E8]/50 rounded-sm bg-[#121212] p-4 transition">
                    <PhaseBadge phase={c.public_phase} status={c.status} />
                    <div className="mt-2 font-heading font-bold">{c.title}</div>
                    {c.start_date && <div className="mt-1 text-xs text-white/50">{formatDateTime(c.start_date)}</div>}
                  </Link>
                ))}
              </div>
            </section>
          )}
          {t.show_chat && <TournamentChat tournament={t} user={user} />}
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
          {t.location && <InfoRow icon={MapPin} label="Ort" value={t.location} />}
          {t.registration_open_from && <InfoRow icon={Calendar} label="Anmeldung öffnet" value={formatDateTime(t.registration_open_from)} />}
          {t.registration_open_until && <InfoRow icon={Calendar} label="Anmeldung endet" value={formatDateTime(t.registration_open_until)} />}
          {t.check_in_from && <InfoRow icon={Calendar} label="Check-in öffnet" value={formatDateTime(t.check_in_from)} />}
          {t.check_in_until && <InfoRow icon={Calendar} label="Check-in endet" value={formatDateTime(t.check_in_until)} />}
          {t.best_of > 1 && <InfoRow icon={Trophy} label="Best of" value={t.best_of} />}
          <InfoRow icon={Users} label="Modus" value={formatTeamMode(t.team_mode)} />
          {t.discord_link && <a href={t.discord_link} target="_blank" rel="noreferrer" className="block px-4 py-3 border border-white/10 rounded-sm text-center text-sm font-bold uppercase tracking-wider hover:border-[#29B6E8]/60 hover:text-[#29B6E8]">Discord</a>}
        </aside>
      </div>
      {registerModal && (
        <RegistrationModal
          tournament={t}
          user={user}
          loading={loading}
          onClose={() => setRegisterModal(false)}
          onSubmit={submitRegistration}
        />
      )}
    </PublicLayout>
  );
}

function TournamentChat({ tournament, user }) {
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [blocked, setBlocked] = useState("");
  const scrollRef = useRef(null);

  const load = useCallback(async () => {
    if (!user) return;
    try {
      const { data } = await api.get(`/tournaments/${tournament.id}/chat`);
      setMessages(data || []);
      setBlocked("");
    } catch (err) {
      setBlocked(err.response?.status === 403 ? "Chat nur für angemeldete Teilnehmer und Turnierleitung." : "Chat konnte nicht geladen werden.");
    }
  }, [tournament.id, user]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!user) return undefined;
    const timer = setInterval(load, 6000);
    return () => clearInterval(timer);
  }, [load, user]);
  useApiInvalidation(load, ["tournaments"]);

  useEffect(() => {
    const box = scrollRef.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [messages.length]);

  const send = async (event) => {
    event.preventDefault();
    const message = text.trim();
    if (!message) return;
    setLoading(true);
    try {
      const { data } = await api.post(`/tournaments/${tournament.id}/chat`, { message });
      setMessages((rows) => [...rows, data]);
      setText("");
      setBlocked("");
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail) || "Nachricht konnte nicht gesendet werden.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <section data-testid="tournament-chat">
      <h2 className="font-heading text-2xl font-bold uppercase mb-3 flex items-center gap-2">
        <MessageSquare className="w-4 h-4 text-[#29B6E8]" /> Turnier-Chat
      </h2>
      <div className="border border-white/10 rounded-sm bg-[#121212] overflow-hidden">
        {!user ? (
          <div className="p-5 text-sm text-white/55">
            <Link to={`/login?next=/tournaments/${tournament.slug || tournament.id}`} className="text-[#29B6E8] font-bold hover:text-white">Einloggen</Link>, um den Chat als Teilnehmer zu nutzen.
          </div>
        ) : blocked ? (
          <div className="p-5 text-sm text-white/45">{blocked}</div>
        ) : (
          <>
            <div ref={scrollRef} className="max-h-80 overflow-y-auto p-4 space-y-3">
              {messages.map((message) => {
                const mine = message.user_id === user.id;
                return (
                  <div key={message.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[85%] border rounded-sm px-3 py-2 ${mine ? "border-[#29B6E8]/40 bg-[#29B6E8]/10" : "border-white/10 bg-[#0A0A0A]"}`}>
                      <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-white/40">
                        <span className={mine ? "text-[#29B6E8]" : "text-white/55"}>{message.author?.display_name || message.author?.username || "Benutzer"}</span>
                        {message.created_at && <span>{new Date(message.created_at).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" })}</span>}
                      </div>
                      <div className="mt-1 whitespace-pre-wrap break-words text-sm text-white/85">{message.message}</div>
                    </div>
                  </div>
                );
              })}
              {messages.length === 0 && <div className="text-center py-8 text-sm text-white/35">Noch keine Nachrichten.</div>}
            </div>
            <form onSubmit={send} className="border-t border-white/10 p-3 flex gap-2">
              <input
                value={text}
                onChange={(event) => setText(event.target.value)}
                maxLength={1000}
                placeholder="Spielcode, Lobbycode oder Absprache schreiben..."
                className="flex-1 min-w-0 bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm focus:outline-none focus:border-[#29B6E8]"
              />
              <button disabled={loading || !text.trim()} className="inline-flex items-center gap-2 px-4 py-2 bg-[#29B6E8] text-black rounded-sm text-xs uppercase tracking-wider font-bold disabled:opacity-45">
                <Send className="w-3.5 h-3.5" /> Senden
              </button>
            </form>
          </>
        )}
      </div>
    </section>
  );
}

function RegistrationModal({ tournament, user, loading, onClose, onSubmit }) {
  const game = tournament.game || {};
  const fields = game.player_id_fields || [];
  const initial = { ...((user?.game_ids || {})[game.slug] || {}) };
  const [playerIds, setPlayerIds] = useState(initial);
  const set = (key, value) => setPlayerIds((cur) => ({ ...cur, [key]: value }));
  const submit = (e) => {
    e.preventDefault();
    onSubmit(playerIds);
  };
  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <form onSubmit={submit} className="w-full max-w-lg bg-[#121212] border border-white/10 rounded-sm p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="font-heading text-xl font-black uppercase">Turnier-Anmeldung</h3>
            <p className="text-xs text-white/50 mt-1">{game.name} benötigt zusätzliche Spieler-IDs.</p>
          </div>
          <button type="button" onClick={onClose} className="text-white/45 hover:text-white"><X className="w-5 h-5" /></button>
        </div>
        {fields.map((field) => (
          <label key={field.key} className="block">
            <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">{field.label}{field.required !== false ? " *" : ""}</div>
            <input
              value={playerIds[field.key] || ""}
              onChange={(e) => set(field.key, e.target.value)}
              required={field.required !== false}
              placeholder={field.help_text || field.label}
              className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm"
            />
          </label>
        ))}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="px-4 py-2 border border-white/15 text-white/70 rounded-sm text-xs uppercase tracking-wider font-bold">Abbrechen</button>
          <button disabled={loading} className="px-5 py-2 bg-[#29B6E8] text-black rounded-sm text-xs uppercase tracking-wider font-bold disabled:opacity-50">
            {loading ? "Sendet…" : "Anmelden"}
          </button>
        </div>
      </form>
    </div>
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
