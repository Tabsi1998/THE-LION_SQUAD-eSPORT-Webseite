import { useCallback, useEffect, useState } from "react";
import { useParams, Link, useSearchParams } from "react-router-dom";
import { api, formatRequestError, resolveMediaUrl } from "@/lib/api";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { PublicLoadingState } from "@/components/tls/PublicLoadingState";
import { Breadcrumbs } from "@/components/tls/Breadcrumbs";
import { PhaseBadge } from "@/components/tls/PhaseBadge";
import { RichContent } from "@/components/tls/RichContent";
import { useCookieConsent } from "@/components/tls/CookieConsent";
import { ExternalMediaNotice } from "@/components/tls/ExternalMediaNotice";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { useCanonicalSlugRedirect } from "@/hooks/useCanonicalSlugRedirect";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { renderMarkdownLite } from "@/lib/markdownLite";
import { seoTextPreview } from "@/lib/textPreview";
import { formatTournamentDisplay } from "@/lib/tournamentLabels";
import { gameLabel } from "@/lib/gameLabels";
import { useAuth } from "@/context/AuthContext";
import { toast } from "sonner";
import { MapPin, Calendar, Mail, Image as ImageIcon, Newspaper, Crown, Lock, Users, ExternalLink, Trophy, Flag, UserPlus, CheckCircle, XCircle, Radio } from "lucide-react";

const TYPE_LABELS = {
  club_evening: "Vereinsabend", lan_party: "LAN-Party", public_event: "Public Event",
  community_evening: "Community-Abend", grill_evening: "Grillabend",
  mario_kart_event: "Mario Kart Event", f1_event: "F1 Event", expo: "Messe / Expo",
  online_event: "Online Event", internal: "Interner Termin",
  sponsor_action: "Sponsorenaktion", tournament_finals: "Turnier-Finals", general: "Event",
};

function fullAddress(e) {
  const cityLine = [e.postal_code, e.city].filter(Boolean).join(" ");
  return [e.address, cityLine, e.country].filter(Boolean).join(", ");
}

function mapEmbedUrl(e) {
  const query = [e.location, fullAddress(e)].filter(Boolean).join(", ");
  return query ? `https://www.google.com/maps?q=${encodeURIComponent(query)}&output=embed` : "";
}

function sponsorKey(sponsor) {
  const logo = String(sponsor.logo_url || "").trim().toLowerCase();
  if (logo) return `logo:${logo}`;
  const id = String(sponsor.id || "").trim().toLowerCase();
  if (id) return `id:${id}`;
  return `${sponsor.link || ""}|${sponsor.name || ""}`.toLowerCase();
}

function uniqueLogoSponsors(sponsors = []) {
  const seen = new Set();
  return sponsors.filter((sponsor) => {
    if (!sponsor.logo_url) return false;
    const key = sponsorKey(sponsor);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export default function EventDetailPage() {
  const { slug } = useParams();
  const [searchParams] = useSearchParams();
  const accessToken = searchParams.get("access") || "";
  const { user } = useAuth();
  const [e, setE] = useState(null);
  const [error, setError] = useState(null);
  const { hasConsent } = useCookieConsent();
  const seoDescription = seoTextPreview(e?.description || e?.program, "Gaming Event von THE LION SQUAD eSports in Tirol.");
  useDocumentTitle(e?.name || "Event", seoDescription, {
    image: e?.banner_url,
    type: "event",
    canonical: e?.slug ? `${window.location.origin}/events/${e.slug}` : undefined,
  });
  useCanonicalSlugRedirect(slug, e?.slug, "/events");

  const load = useCallback(() => {
    return api.get(`/events/${slug}`, { params: accessToken ? { access: accessToken } : undefined }).then(({ data }) => {
      setE(data);
      setError(null);
    }).catch((err) => {
      setError(err.response?.status === 403 ? "Dieses Event ist nicht öffentlich zugänglich." : "Event nicht gefunden.");
    });
  }, [slug, accessToken]);

  useEffect(() => {
    load();
  }, [load]);

  useApiInvalidation(load, ["events", "tournaments", "f1", "gallery", "news"]);

  if (error) return (
    <PublicLayout>
      <div className="max-w-2xl mx-auto px-6 py-20 text-center">
        <h1 className="font-heading text-3xl font-black">{error}</h1>
        <Link to="/events" className="mt-6 inline-flex text-[#9F7AEA]">← Zurück zu Events</Link>
      </div>
    </PublicLayout>
  );
  if (!e) return <PublicLayout><PublicLoadingState label="Lade Event" /></PublicLayout>;

  const eventSponsors = uniqueLogoSponsors(e.sponsors || []);
  const organizerName = e.organizer_name || (e.owned_by_club ? "THE LION SQUAD - eSports" : "");
  const liveUrl = `/events/${e.slug || e.id}/live${accessSuffix(accessToken)}`;

  return (
    <PublicLayout>
      <div className="relative border-b border-white/10">
        {e.banner_url && <img src={resolveMediaUrl(e.banner_url)} className="absolute inset-0 w-full h-full object-cover opacity-25" alt="" />}
        <div className="absolute inset-0 bg-gradient-to-b from-[#0A0A0A]/40 via-[#0A0A0A]/80 to-[#0A0A0A]" />
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-14 min-w-0">
          <Breadcrumbs items={[{ label: "Home", to: "/" }, { label: "Events", to: "/events" }, { label: e.name }]} className="mb-4" />
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#9F7AEA]">{TYPE_LABELS[e.event_type] || "EVENT"}</span>
            <PhaseBadge phase={e.public_phase || e.event_phase} status={e.status || "draft"} size="md" />
            {e.visibility === "members" && <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-widest font-bold text-[#FFD700]"><Crown className="w-3 h-3" /> Mitglieder</span>}
            {e.visibility === "internal" && <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-widest font-bold text-white/60"><Lock className="w-3 h-3" /> Intern</span>}
          </div>
          <h1 className="mt-3 font-heading text-4xl md:text-6xl font-black uppercase leading-tight break-words">{e.name}</h1>
          {e.description && <div className="mt-3 max-w-2xl prose-cms" dangerouslySetInnerHTML={{ __html: renderMarkdownLite(e.description) }} />}
          <div className="mt-6 flex flex-wrap gap-5 text-sm text-white/70 min-w-0">
            {e.start_date && <span className="inline-flex min-w-0 items-center gap-2"><Calendar className="w-4 h-4 text-[#9F7AEA] shrink-0" /><span className="min-w-0 break-words">{new Date(e.start_date).toLocaleString("de-DE", { dateStyle: "long", timeStyle: "short" })}</span></span>}
            {(e.location || fullAddress(e)) && <span className="inline-flex min-w-0 items-center gap-2"><MapPin className="w-4 h-4 text-[#9F7AEA] shrink-0" /><span className="min-w-0 break-words">{[e.location, fullAddress(e)].filter(Boolean).join(", ")}</span></span>}
            {e.contact && <span className="inline-flex min-w-0 items-center gap-2"><Mail className="w-4 h-4 text-[#9F7AEA] shrink-0" /><span className="min-w-0 break-all">{e.contact}</span></span>}
            {e.max_participants && <span className="inline-flex items-center gap-2"><Users className="w-4 h-4 text-[#9F7AEA] shrink-0" />max. {e.max_participants}</span>}
            {e.has_registration && e.registration_summary && <span className="inline-flex items-center gap-2"><UserPlus className="w-4 h-4 text-[#9F7AEA] shrink-0" />{e.registration_summary.reserved_seats || 0}{e.max_participants ? `/${e.max_participants}` : ""} Plätze reserviert</span>}
            {organizerName && (
              e.organizer_url ? (
                <a href={e.organizer_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 text-[#29B6E8] hover:underline">
                  <ExternalLink className="w-4 h-4" /> {organizerName}
                </a>
              ) : <span className="inline-flex items-center gap-2">{organizerName}</span>
            )}
          </div>
          {(e.tournaments?.length || e.f1_challenges?.length) && (
            <div className="mt-7 flex flex-wrap gap-3">
              <Link to={liveUrl} className="inline-flex items-center gap-2 px-4 py-2 bg-[#29B6E8] text-black text-xs uppercase tracking-wider font-bold rounded-sm hover:bg-white transition">
                <Radio className="w-4 h-4" /> Live verfolgen
              </Link>
              <Link to={`/display/event/${e.id}`} className="inline-flex items-center gap-2 px-4 py-2 border border-white/15 text-white/70 text-xs uppercase tracking-wider font-bold rounded-sm hover:border-[#29B6E8]/45 hover:text-white transition">
                <ExternalLink className="w-4 h-4" /> Display
              </Link>
            </div>
          )}
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 space-y-12 min-w-0">
        {(e.has_registration || (e.show_map && mapEmbedUrl(e))) && (
          <div className="grid lg:grid-cols-2 gap-5 min-w-0">
            {e.has_registration && (
              <EventRegistrationPanel event={e} user={user} accessToken={accessToken} onChanged={load} />
            )}
            {e.show_map && mapEmbedUrl(e) && hasConsent("external_media") && (
              <div className="border border-white/10 bg-[#121212] rounded-sm overflow-hidden">
                <iframe title={`Karte ${e.name}`} src={mapEmbedUrl(e)} className="w-full h-72 border-0" loading="lazy" referrerPolicy="no-referrer-when-downgrade" />
              </div>
            )}
            {e.show_map && mapEmbedUrl(e) && !hasConsent("external_media") && (
              <ExternalMediaNotice
                service="Google Maps"
                reason="Die Karte wird erst nach Zustimmung zu externen Medien geladen, weil dabei Daten an Google uebertragen werden koennen."
                url={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([e.location, fullAddress(e)].filter(Boolean).join(", "))}`}
                accent="#9F7AEA"
                testId="event-map-consent-notice"
              />
            )}
          </div>
        )}

        {e.program && (
          <div>
            <h2 className="font-heading text-2xl font-black uppercase mb-4">Programm</h2>
            <RichContent text={e.program} embeds={e.content_embeds || []} className="border border-white/10 bg-[#121212] p-6 rounded-sm text-white/85" />
          </div>
        )}

        {!!e.tournaments?.length && (
          <div>
            <h2 className="font-heading text-2xl font-black uppercase mb-5">Turniere</h2>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 min-w-0">
              {e.tournaments.map((t) => <EventTournamentEmbed key={t.id} tournament={t} accessToken={accessToken} />)}
            </div>
          </div>
        )}

        {!!e.f1_challenges?.length && (
          <div>
            <h2 className="font-heading text-2xl font-black uppercase mb-5">Fast-Lap Challenges</h2>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 min-w-0">
              {e.f1_challenges.map((c) => <EventFastLapEmbed key={c.id} challenge={c} accessToken={accessToken} />)}
            </div>
          </div>
        )}

        {!!e.albums?.length && (
          <div>
            <h2 className="font-heading text-2xl font-black uppercase mb-5 inline-flex items-center gap-2"><ImageIcon className="w-5 h-5 text-[#29B6E8]" /> Galerie</h2>
            <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-4">
              {e.albums.map((a) => (
                <Link key={a.id} to={`/galerie/${a.slug}`} className="border border-white/10 hover:border-[#29B6E8]/50 rounded-sm bg-[#121212] overflow-hidden">
                  <div className="aspect-video bg-[#0A0A0A] overflow-hidden">
                    {a.cover_url ? <img src={resolveMediaUrl(a.cover_url)} alt={a.title} className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center"><ImageIcon className="w-8 h-8 text-white/15" /></div>}
                  </div>
                  <div className="p-4"><div className="font-heading font-bold">{a.title}</div></div>
                </Link>
              ))}
            </div>
          </div>
        )}

        {!!e.news?.length && (
          <div>
            <h2 className="font-heading text-2xl font-black uppercase mb-5 inline-flex items-center gap-2"><Newspaper className="w-5 h-5 text-[#29B6E8]" /> Verknüpfte News</h2>
            <div className="grid sm:grid-cols-2 gap-4">
              {e.news.map((n) => (
                <Link key={n.id} to={`/news/${n.slug}`} className="border border-white/10 hover:border-[#29B6E8]/50 rounded-sm bg-[#121212] p-4 transition">
                  <div className="text-[10px] uppercase tracking-widest text-white/40">{new Date(n.published_at || n.created_at).toLocaleDateString("de-DE")}</div>
                  <div className="font-heading font-bold mt-1">{n.title}</div>
                  {n.excerpt && <div className="text-xs text-white/60 mt-1 line-clamp-2">{n.excerpt}</div>}
                </Link>
              ))}
            </div>
          </div>
        )}

        {!!eventSponsors.length && (
          <div>
            <h2 className="font-heading text-2xl font-black uppercase mb-5">Unterstützt von</h2>
            <div className="flex flex-wrap items-center gap-8 border-y border-white/10 py-6 min-w-0">
              {eventSponsors.map((s) => (
                <a key={sponsorKey(s)} href={s.link || "#"} target={s.link ? "_blank" : undefined} rel="noreferrer" aria-label={s.name} className="group inline-flex items-center justify-center min-w-32">
                  <img src={resolveMediaUrl(s.logo_url)} alt="" className="max-h-14 max-w-44 object-contain opacity-80 group-hover:opacity-100 transition" />
                </a>
              ))}
            </div>
          </div>
        )}
      </div>
    </PublicLayout>
  );
}

const EVENT_REGISTRATION_LABELS = {
  registered: "Angemeldet",
  waitlist: "Warteliste",
  checked_in: "Eingecheckt",
  cancelled: "Storniert",
  no_show: "Nicht erschienen",
};

function EventRegistrationPanel({ event, user, accessToken = "", onChanged }) {
  const [companionCount, setCompanionCount] = useState(0);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const summary = event.registration_summary || {};
  const own = event.own_registration;
  const activeOwn = own && !["cancelled", "no_show"].includes(own.status);
  const phaseState = event.public_phase?.state || event.event_phase?.state || event.status;
  const registrationOpen = phaseState === "registration_open";
  const maxCompanions = event.allow_companions ? Number(event.max_companions_per_registration || 0) : 0;
  const loginTarget = typeof window !== "undefined" ? `/login?next=${encodeURIComponent(`${window.location.pathname}${window.location.search}`)}` : "/login";
  const hasRegisterAccess = event.access_link?.grants?.includes("register");

  useEffect(() => {
    setCompanionCount(0);
    setNote("");
  }, [event.id]);

  const register = async (ev) => {
    ev.preventDefault();
    setSaving(true);
    try {
      await api.post(`/events/${event.id}/registrations`, {
        companion_count: Number(companionCount || 0),
        note: note || null,
      }, { params: accessToken ? { access: accessToken } : undefined });
      toast.success("Anmeldung gespeichert.");
      await onChanged();
    } catch (err) {
      toast.error(formatRequestError(err, "Anmeldung konnte nicht gespeichert werden."));
    } finally {
      setSaving(false);
    }
  };

  const cancel = async () => {
    setSaving(true);
    try {
      await api.delete(`/events/${event.id}/registrations/me`);
      toast.success("Anmeldung storniert.");
      await onChanged();
    } catch (err) {
      toast.error(formatRequestError(err, "Anmeldung konnte nicht storniert werden."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="border border-white/10 bg-[#121212] rounded-sm p-5">
      <div className="text-[11px] uppercase tracking-widest font-bold text-[#9F7AEA]">Anmeldung</div>
      <h2 className="mt-2 font-heading text-2xl font-black uppercase">{event.registration_url ? "Registrierung möglich" : "Event-Anmeldung"}</h2>
      <div className="mt-4 grid grid-cols-3 gap-2">
        <MiniStat label="Reserviert" value={`${summary.reserved_seats || 0}${event.max_participants ? `/${event.max_participants}` : ""}`} />
        <MiniStat label="Anmeldungen" value={summary.registered_count || 0} />
        <MiniStat label="Begleitp." value={summary.companion_count || 0} />
      </div>
      {!!summary.waitlist_count && (
        <div className="mt-2 text-xs text-[#FFD700]">{summary.waitlist_count} Anmeldung(en) auf der Warteliste.</div>
      )}
      <div className="mt-4 space-y-1 text-sm text-white/65">
        {event.registration_opens_at && <div>Öffnet: {new Date(event.registration_opens_at).toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short" })}</div>}
        {event.registration_closes_at && <div>Schließt: {new Date(event.registration_closes_at).toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short" })}</div>}
        {summary.spots_left != null && <div>Freie Plätze: {summary.spots_left}</div>}
      </div>
      {event.registration_url ? (
        <a href={event.registration_url} target="_blank" rel="noreferrer" className="mt-5 inline-flex items-center gap-2 px-4 py-2 bg-[#9F7AEA] text-black text-xs uppercase tracking-wider font-bold rounded-sm">
          Anmelden <ExternalLink className="w-3.5 h-3.5" />
        </a>
      ) : activeOwn ? (
        <div className="mt-5 border border-[#10B981]/30 bg-[#10B981]/10 rounded-sm p-4">
          <div className="inline-flex items-center gap-2 text-[#10B981] text-sm font-bold uppercase tracking-wider">
            <CheckCircle className="w-4 h-4" /> {EVENT_REGISTRATION_LABELS[own.status] || own.status}
          </div>
          <div className="mt-2 text-sm text-white/65">
            {own.status === "waitlist"
              ? `Du stehst mit ${own.seat_count || 1} Platz/Plätzen auf der Warteliste${own.companion_count ? `, davon ${own.companion_count} Begleitperson(en)` : ""}.`
              : `${own.seat_count || 1} Platz/Plätze reserviert${own.companion_count ? `, davon ${own.companion_count} Begleitperson(en)` : ""}.`}
          </div>
          <button type="button" disabled={saving} onClick={cancel} className="mt-4 inline-flex items-center gap-2 px-3 py-2 border border-[#FF3B30]/40 text-[#FF3B30] hover:bg-[#FF3B30]/10 text-xs uppercase tracking-wider font-bold rounded-sm disabled:opacity-50">
            <XCircle className="w-3.5 h-3.5" /> Stornieren
          </button>
        </div>
      ) : !registrationOpen && !hasRegisterAccess ? (
        <div className="mt-5 border border-white/10 rounded-sm p-4 text-sm text-white/55">Die Anmeldung ist aktuell nicht offen.</div>
      ) : !user ? (
        <Link to={loginTarget} className="mt-5 inline-flex items-center gap-2 px-4 py-2 bg-[#9F7AEA] text-black text-xs uppercase tracking-wider font-bold rounded-sm">
          Einloggen zum Anmelden
        </Link>
      ) : (
        <form onSubmit={register} className="mt-5 space-y-3">
          {event.allow_companions && (
            <label className="block">
              <div className="text-[11px] uppercase tracking-widest text-white/50 font-bold mb-1.5">Begleitpersonen</div>
              <input type="number" min="0" max={maxCompanions} value={companionCount} onChange={(ev) => setCompanionCount(ev.target.value)} className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm" />
              <div className="mt-1 text-xs text-white/40">Maximal {maxCompanions} pro Anmeldung.</div>
            </label>
          )}
          <label className="block">
            <div className="text-[11px] uppercase tracking-widest text-white/50 font-bold mb-1.5">Hinweis optional</div>
            <textarea value={note} onChange={(ev) => setNote(ev.target.value)} rows={3} maxLength={500} className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm" placeholder="z.B. komme etwas später" />
          </label>
          <button disabled={saving} className="inline-flex items-center gap-2 px-4 py-2 bg-[#9F7AEA] text-black text-xs uppercase tracking-wider font-bold rounded-sm disabled:opacity-50">
            <UserPlus className="w-3.5 h-3.5" /> {saving ? "Speichere..." : "Anmelden"}
          </button>
        </form>
      )}
      {!!event.registrations?.length && (
        <div className="mt-6 border-t border-white/10 pt-4">
          <div className="text-[11px] uppercase tracking-widest font-bold text-white/45 mb-2">Angemeldet</div>
          <div className="space-y-1.5">
            {event.registrations.slice(0, 12).map((registration) => (
              <div key={registration.id} className="flex items-center justify-between gap-3 text-sm border border-white/5 bg-black/15 rounded-sm px-3 py-2">
                <span className="truncate">{registration.display_name || "Teilnehmer"}</span>
                <span className="text-xs text-white/45 shrink-0">{registration.seat_count || 1} Platz/Plätze</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function MiniStat({ label, value }) {
  return (
    <div className="border border-white/10 bg-[#0A0A0A] rounded-sm p-3">
      <div className="text-[10px] uppercase tracking-widest text-white/40">{label}</div>
      <div className="mt-1 font-heading text-xl font-black">{value}</div>
    </div>
  );
}

function accessSuffix(accessToken) {
  return accessToken ? `?access=${encodeURIComponent(accessToken)}` : "";
}

function EventTournamentEmbed({ tournament, accessToken = "" }) {
  const [bracket, setBracket] = useState(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let active = true;
    api.get(`/tournaments/${tournament.id}/bracket`, { params: tournament.access_link && accessToken ? { access: accessToken } : undefined })
      .then(({ data }) => { if (active) setBracket(data); })
      .catch(() => { if (active) setBracket(null); })
      .finally(() => { if (active) setLoaded(true); });
    return () => { active = false; };
  }, [tournament.id, tournament.access_link, accessToken]);

  const matches = (bracket?.matches || []).slice(0, 4);
  const regMap = new Map((bracket?.registrations || []).map((r) => [r.id, r]));

  return (
    <div className="border border-white/10 rounded-sm bg-[#121212] overflow-hidden min-w-0">
      <Link to={`/tournaments/${tournament.slug || tournament.id}${tournament.access_link ? accessSuffix(accessToken) : ""}`} className="block p-5 hover:bg-white/[0.03] transition">
        <div className="flex flex-wrap items-center gap-2">
          <Trophy className="w-4 h-4 text-[#FFD700]" />
          <PhaseBadge phase={tournament.public_phase} status={tournament.status} />
          {tournament.start_date && <span className="text-xs text-white/45">{new Date(tournament.start_date).toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short" })}</span>}
        </div>
        <h3 className="mt-3 font-heading text-xl font-black uppercase leading-tight hover:text-[#FFD700] transition break-words">{tournament.title}</h3>
        <div className="mt-2 flex flex-wrap gap-3 text-xs text-white/55">
          {tournament.game && <span>{gameLabel(tournament.game)}</span>}
          {tournament.format && <span>{formatTournamentDisplay(tournament)}</span>}
          {Number.isFinite(tournament.participant_count) && <span>{tournament.participant_count}/{tournament.max_participants} Teilnehmer</span>}
        </div>
      </Link>
      <div className="border-t border-white/10 p-5">
        <div className="flex items-center justify-between gap-3 mb-3 min-w-0">
          <div className="text-[10px] uppercase tracking-widest font-bold text-white/45">Turnierbaum-Vorschau</div>
          <Link to={`/tournaments/${tournament.slug || tournament.id}/bracket`} className="text-[10px] uppercase tracking-widest font-bold text-[#29B6E8] hover:text-white">Öffnen</Link>
        </div>
        {!loaded ? (
          <div className="text-sm text-white/40 py-4">Lade Turnierbaum…</div>
        ) : matches.length ? (
          <div className="space-y-2">
            {matches.map((match) => (
              <div key={match.id} className="border border-white/10 bg-black/20 rounded-sm px-3 py-2">
                <div className="text-[10px] uppercase tracking-widest text-white/35">{match.round_name || `Runde ${match.round}`}</div>
                <div className="mt-1 text-sm text-white/75 flex items-center justify-between gap-3 min-w-0">
                  <span className="truncate">{registrationName(regMap, match.participant_a_id)}</span>
                  <span className="text-white/30">vs</span>
                  <span className="truncate text-right">{registrationName(regMap, match.participant_b_id)}</span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-sm text-white/45 border border-dashed border-white/10 rounded-sm p-4">Turnierbaum wurde noch nicht generiert.</div>
        )}
      </div>
    </div>
  );
}

function EventFastLapEmbed({ challenge, accessToken = "" }) {
  const [board, setBoard] = useState(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let active = true;
    api.get(`/f1/challenges/${challenge.id}/leaderboard`, { params: challenge.access_link && accessToken ? { access: accessToken } : undefined })
      .then(({ data }) => { if (active) setBoard(data); })
      .catch(() => { if (active) setBoard(null); })
      .finally(() => { if (active) setLoaded(true); });
    return () => { active = false; };
  }, [challenge.id, challenge.access_link, accessToken]);

  const entries = (board?.entries || []).slice(0, 3);

  return (
    <div className="border border-white/10 rounded-sm bg-[#121212] overflow-hidden min-w-0">
      <Link to={`/fastlap/${challenge.slug || challenge.id}${challenge.access_link ? accessSuffix(accessToken) : ""}`} className="block p-5 hover:bg-white/[0.03] transition">
        <div className="flex flex-wrap items-center gap-2">
          <Flag className="w-4 h-4 text-[#29B6E8]" />
          <PhaseBadge phase={challenge.public_phase} status={challenge.status} />
          {challenge.start_date && <span className="text-xs text-white/45">{new Date(challenge.start_date).toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short" })}</span>}
        </div>
        <h3 className="mt-3 font-heading text-xl font-black uppercase leading-tight hover:text-[#29B6E8] transition break-words">{challenge.title}</h3>
        {challenge.description && <p className="mt-2 text-sm text-white/55 line-clamp-2">{challenge.description}</p>}
      </Link>
      <div className="border-t border-white/10 p-5">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-3 mb-3 min-w-0">
          <div className="text-[10px] uppercase tracking-widest font-bold text-white/45 break-words">Top 3{board?.track?.name ? ` · ${board.track.name}` : ""}</div>
          <Link to={`/fastlap/${challenge.slug || challenge.id}${challenge.access_link ? accessSuffix(accessToken) : ""}`} className="text-[10px] uppercase tracking-widest font-bold text-[#29B6E8] hover:text-white">Rangliste</Link>
        </div>
        {!loaded ? (
          <div className="text-sm text-white/40 py-4">Lade Zeiten…</div>
        ) : entries.length ? (
          <div className="space-y-2">
            {entries.map((entry) => (
              <div key={entry.user_id} className="flex items-center justify-between gap-3 border border-white/10 bg-black/20 rounded-sm px-3 py-2">
                <div className="flex items-center gap-3 min-w-0">
                  <span className={`font-display font-black w-6 ${entry.rank === 1 ? "text-[#FFD700]" : entry.rank === 2 ? "text-white/75" : "text-[#CD7F32]"}`}>{entry.rank}</span>
                  <span className="truncate text-sm text-white/80">{entry.display_name || entry.username}</span>
                </div>
                <span className="font-display text-sm text-[#29B6E8] tabular-nums">{entry.time_str}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-sm text-white/45 border border-dashed border-white/10 rounded-sm p-4">Noch keine gültigen Zeiten eingetragen.</div>
        )}
      </div>
    </div>
  );
}

function registrationName(regMap, id) {
  const reg = regMap.get(id);
  if (!id) return "Offen";
  return reg?.display_name || reg?.user?.display_name || reg?.ingame_name || "Offen";
}
