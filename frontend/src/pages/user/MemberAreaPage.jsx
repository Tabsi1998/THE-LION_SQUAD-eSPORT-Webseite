import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { API, api, formatApiError, formatMemberSince, resolveMediaUrl } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { MemberCardArt } from "@/components/tls/MemberCardArt";
import { BoardAvatar } from "@/components/tls/BoardPortrait";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { feeBadge } from "@/lib/dolibarr";
import { motionAllowed } from "@/lib/motion";
import {
  AREA_JUMPS, MEETING_ANSWERS, areaCard, boardContacts, dateTileParts, eventDateLine, helperEvents, isRecent, jumpEntries, memberEvents, memberNews,
} from "@/lib/memberArea";
import { AlertCircle, Bell, Cake, Calendar, CheckCircle2, Eye, FileText, Gamepad2, Gift, HandHelping, MapPin, MessageCircle, Users, Vote } from "lucide-react";
import { SteamPresence } from "@/components/tls/SteamPresence";
import { useSeason } from "@/seasons/SeasonContext";
import { StickerClaim } from "@/seasons/birthday/StickerClaim";
import { DiscordServerList } from "@/components/tls/DiscordServerTile";
import { DiscordVoice } from "@/components/tls/DiscordNow";
import { viennaDate, viennaDay } from "@/lib/vienna";

// Der Mitgliederbereich (#284, #1336, #1257): oben die eigene Mitgliedskarte mit „Hallo“, „Mitglied seit“ und dem
// Beitragsstand, darunter die Sprungleiste mit dem, was offen ist („Versammlung · 1 offen“) - am Handy eine Zeile zum
// Wischen, am PC links fest. Gold steht nur an der Karte und am Strich unter dem aktiven Eintrag; Verweise sind Cyan,
// Symbole ruhig in Textfarbe. Darunter nur Abschnitte mit Inhalt - die Zusage zur Versammlung geht direkt in der Karte.
// Die Zahlen kommen vom Server (/membership/area-summary) - dieselben wie an den Kacheln auf /verein und in der App.
// Eigene Unterlagen und Rechnungen stehen nicht hier, sondern im Profil („Nur für dich“, #1255).

// Bis zu dieser Linie unter dem oberen Rand (Kopf der Website plus Sprungleiste) gilt ein Abschnitt als erreicht.
const SPY_LINE = 160;
const AREA_ORDER = AREA_JUMPS.map((jump) => jump.key);

/** Welcher Abschnitt gerade oben steht - nach einem Sprung bleibt der gewählte aktiv, bis das Scrollen vorbei ist. */
function useActiveSection(keys) {
  const signature = keys.join("|");
  const [active, setActive] = useState(keys[0] || "");
  const pinned = useRef("");
  useEffect(() => {
    const list = signature ? signature.split("|") : [];
    if (!list.length) return undefined;
    let frame = 0;
    let settle = 0;
    const update = () => {
      frame = 0;
      let current = list[0];
      for (const key of list) {
        const element = document.getElementById(key);
        if (element && element.getBoundingClientRect().top <= SPY_LINE) current = key;
      }
      setActive(current);
    };
    const onScroll = () => {
      if (pinned.current) {
        window.clearTimeout(settle);
        settle = window.setTimeout(() => { pinned.current = ""; }, 250);
        return;
      }
      if (!frame) frame = window.requestAnimationFrame(update);
    };
    if (!pinned.current) update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame) window.cancelAnimationFrame(frame);
      window.clearTimeout(settle);
    };
  }, [signature]);
  const pin = useCallback((key) => {
    pinned.current = key;
    setActive(key);
  }, []);
  return [active, pin];
}

export default function MemberAreaPage() {
  const { user } = useAuth();
  const [benefits, setBenefits] = useState([]);
  const [me, setMe] = useState(null);
  const [docs, setDocs] = useState([]);
  const [internalNews, setInternalNews] = useState([]);
  // Interne Events (#283): die Event-Liste liefert, was ich sehen darf; hier
  // bleiben nur Mitglieder- und interne Events, die noch anstehen.
  const [internalEvents, setInternalEvents] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [discordUrl, setDiscordUrl] = useState("");
  // Was offen ist (#1257): offene Versammlungen und Abstimmungen, freie Plätze, neue News und Dokumente, die nächste
  // Versammlung mit meiner Antwort.
  const [summary, setSummary] = useState(null);
  // Helferdienste (#331): Veranstaltungen mit freien Plätzen oder eigenen Diensten aus der Vereinsakte.
  const [helping, setHelping] = useState(null);
  // „Gerade in Steam“ (#584): nur Mitglieder mit verknüpftem Konto und Opt-in, nur der aktuelle Stand.
  const [steam, setSteam] = useState(null);
  // „Discord jetzt“ (#581): online und je belegtem Sprachkanal die Zahl - nie Namen.
  const [discordVoice, setDiscordVoice] = useState(null);
  // Discord-Server des Vereins (#626): alle eingeschalteten, mit „Du bist dabei“ für mich.
  const [discordServers, setDiscordServers] = useState(null);
  const [answering, setAnswering] = useState("");
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(() => {
    Promise.allSettled([
      api.get("/membership/benefits"),
      api.get("/membership/me"),
      api.get("/documents", { params: { scope: "club" } }),
      api.get("/news"),
      api.get("/events?upcoming=true&compact=true&limit=48"),
      api.get("/board?active_only=true"),
      api.get("/settings/public"),
      api.get("/membership/area-summary"),
      api.get("/membership/me/helper-shifts"),
      api.get("/membership/steam-presence"),
      api.get("/membership/discord-servers"),
      api.get("/membership/discord-voice"),
    ]).then(([b, m, d, n, e, p, s, sm, hs, sp, ds, dv]) => {
      if (b.status === "fulfilled") setBenefits(Array.isArray(b.value.data) ? b.value.data : []);
      if (m.status === "fulfilled") setMe(m.value.data && typeof m.value.data === "object" ? m.value.data : null);
      if (d.status === "fulfilled") setDocs(Array.isArray(d.value.data) ? d.value.data : []);
      if (n.status === "fulfilled") setInternalNews(memberNews(n.value.data));
      if (e.status === "fulfilled") setInternalEvents(memberEvents(e.value.data));
      if (p.status === "fulfilled") setContacts(boardContacts(p.value.data));
      if (s.status === "fulfilled") setDiscordUrl(s.value.data?.discord_invite_url || "");
      if (sm.status === "fulfilled" && sm.value.data && typeof sm.value.data === "object" && !Array.isArray(sm.value.data)) setSummary(sm.value.data);
      if (hs.status === "fulfilled" && hs.value.data?.available) setHelping(hs.value.data);
      if (sp.status === "fulfilled" && sp.value.data?.available) setSteam(sp.value.data);
      if (ds.status === "fulfilled") setDiscordServers(ds.value.data);
      if (dv.status === "fulfilled" && dv.value.data?.available) setDiscordVoice(dv.value.data);
      setLoaded(true);
    });
  }, []);
  useEffect(() => { load(); }, [load]);
  useApiInvalidation(load, ["membership", "documents", "news", "users", "events", "board", "settings"]);

  const nextMeeting = summary?.next_meeting || null;
  const openBallots = Number(summary?.ballots_open) || 0;
  const helpingEvents = helperEvents(helping);
  const helpingSomething = Boolean(helping && (helping.my_count || helping.open_places));
  const showMeetings = Boolean(nextMeeting || openBallots);
  const present = new Set(["karte", showMeetings && "versammlung", helpingSomething && "helfen", internalNews.length && "news", docs.length && "dokumente"].filter(Boolean));
  const [active, pin] = useActiveSection(AREA_ORDER.filter((key) => present.has(key)));
  const nothingYet = loaded && !internalEvents.length && !docs.length && !benefits.length && !internalNews.length && !showMeetings && !helpingSomething;

  const jump = useCallback((key) => {
    const element = document.getElementById(key);
    if (!element) return;
    pin(key);
    element.scrollIntoView?.({ behavior: motionAllowed() ? "smooth" : "auto", block: "start" });
    element.focus?.({ preventScroll: true });
    try {
      window.history.replaceState(window.history.state, "", `#${key}`);
    } catch {
      // Ohne Verlauf (Vorschau) bleibt die Adresse, wie sie ist.
    }
  }, [pin]);

  // Ein Link mit Anker (/members/area#versammlung) springt nach dem Laden dorthin.
  useEffect(() => {
    if (!loaded) return;
    const key = window.location.hash.replace(/^#/, "");
    const element = key && AREA_ORDER.includes(key) ? document.getElementById(key) : null;
    if (element) {
      pin(key);
      element.scrollIntoView?.({ block: "start" });
    }
  }, [loaded, pin]);

  const answer = async (meeting, response) => {
    setAnswering(String(meeting.id));
    try {
      const { data } = await api.put(`/membership/me/meetings/${meeting.id}/response`, { response });
      setSummary((current) => {
        if (!current?.next_meeting || current.next_meeting.id !== meeting.id) return current;
        const before = current.next_meeting;
        return {
          ...current,
          meetings_open: Math.max(0, (Number(current.meetings_open) || 0) - (before.response ? 0 : 1)),
          next_meeting: { ...before, response: data?.response || response, response_label: data?.response_label || before.response_label },
        };
      });
      toast.success(response === "yes" ? "Zugesagt." : response === "no" ? "Abgesagt." : "Als „vielleicht“ vermerkt.");
    } catch (err) {
      toast.error(formatApiError(err?.response?.data?.detail) || "Das hat nicht geklappt.");
    } finally {
      setAnswering("");
    }
  };

  return (
    <PublicLayout>
      <section className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 md:py-12">
        <AreaHead user={user} me={me} discordUrl={discordUrl} />

        <BirthdayNote />

        <div className="mt-6 xl:mt-10 xl:grid xl:grid-cols-[11rem_minmax(0,1fr)] xl:gap-10">
          <JumpBar entries={jumpEntries(summary)} present={present} active={active} onJump={jump} />

          <div className="min-w-0 mt-6 xl:mt-0">
            {nothingYet ? (
              <div data-testid="member-area-empty" className="mb-6 border border-white/10 rounded-sm bg-[#121212] p-8 text-center">
                <Bell className="w-6 h-6 text-white/55 mx-auto" aria-hidden="true" />
                <p className="mt-3 text-sm text-white/70">Neues erscheint hier, sobald der Verein etwas freischaltet: interne Events, Dokumente, Vorteile, interne News.</p>
                <p className="mt-1 text-xs text-white/45">Bis dahin: „Meine Mitgliedschaft“ und Discord oben neben deiner Karte.</p>
              </div>
            ) : null}

            <div className="grid lg:grid-cols-3 xl:grid-cols-5 gap-6">
              <div className="lg:col-span-2 xl:col-span-3 space-y-6 min-w-0">
                {showMeetings ? (
                  <AreaSection id="versammlung" title="Versammlungen" icon={Vote} testId="member-area-meetings" more={{ to: "/members/meetings", label: "Alle Versammlungen" }}>
                    <div className="space-y-4">
                      {openBallots ? (
                        <Link to="/members/meetings" data-testid="member-area-open-ballots" className="block border-l-2 border-[#29B6E8] pl-3 text-sm font-bold text-[#29B6E8] hover:text-white transition">
                          {openBallots === 1 ? "Eine Abstimmung ist offen" : `${openBallots} Abstimmungen sind offen`} – jetzt abstimmen
                        </Link>
                      ) : null}
                      {nextMeeting ? <MeetingCard meeting={nextMeeting} busy={answering === String(nextMeeting.id)} onAnswer={answer} /> : null}
                    </div>
                  </AreaSection>
                ) : null}

                {helpingSomething ? (
                  <AreaSection id="helfen" title="Helferdienste" icon={HandHelping} testId="member-area-helping" more={{ to: "/members/helfen", label: "Alle Helferdienste" }}>
                    <div className="space-y-4">
                      {helping.my_count ? <p data-testid="member-area-helping-mine" className="text-sm text-white">Du bist bei {helping.my_count === 1 ? "einem Dienst" : `${helping.my_count} Diensten`} eingetragen.</p> : null}
                      {helping.open_places ? (
                        <Link to="/members/helfen" data-testid="member-area-helping-open" className="block text-sm font-bold text-[#29B6E8] hover:text-white transition">
                          {helping.open_places === 1 ? "Ein freier Platz" : `${helping.open_places} freie Plätze`} – der Verein braucht Hände
                        </Link>
                      ) : null}
                      {helpingEvents.map((event) => (
                        <Link key={event.id} to="/members/helfen" data-testid={`member-area-helping-event-${event.id}`} className="group flex items-center gap-4">
                          <DateTile day={event.day} />
                          <span className="min-w-0">
                            <span className="block font-bold text-white break-words group-hover:text-[#29B6E8] transition">{event.label}</span>
                            <span className="block text-xs text-white/55">{helperLine(event)}</span>
                          </span>
                        </Link>
                      ))}
                    </div>
                  </AreaSection>
                ) : null}

                {internalNews.length ? (
                  <AreaSection id="news" title="Interne News" icon={Bell} testId="member-area-news" more={{ to: "/members/news", label: "Alle" }}>
                    <div className="space-y-3">
                      {internalNews.map((post) => (
                        <Link key={post.id} to={`/news/${post.slug}`} className="group block border-l-2 border-white/15 pl-3 hover:border-[#29B6E8] transition">
                          <div className="text-[10px] uppercase tracking-widest text-white/45">
                            {viennaDate(post.published_at || post.created_at)}
                            {isRecent(post.published_at || post.created_at) ? <span className="ml-2 font-bold text-[#29B6E8]" data-testid={`member-area-news-new-${post.id}`}>neu</span> : null}
                          </div>
                          <div className="font-bold text-white mt-0.5 break-words group-hover:text-[#29B6E8] transition">{post.title}</div>
                        </Link>
                      ))}
                    </div>
                  </AreaSection>
                ) : null}

                {docs.length ? (
                  <AreaSection id="dokumente" title="Vereinsdokumente" icon={FileText} testId="member-area-documents" more={{ to: "/members/documents", label: "Alle Dokumente" }}>
                    <div className="space-y-2">
                      {docs.slice(0, 4).map((doc) => (
                        <div key={doc.id} className="flex items-center gap-3 p-3 border border-white/10 rounded-sm hover:border-white/25 transition">
                          <FileText className="w-4 h-4 text-white/55 shrink-0" aria-hidden="true" />
                          <div className="flex-1 min-w-0">
                            <div className="font-bold text-sm text-white truncate">{doc.title}</div>
                            <div className="text-[10px] text-white/45 uppercase tracking-wider truncate">
                              {isRecent(doc.created_at) ? <span className="mr-2 font-bold text-[#29B6E8]">neu</span> : null}
                              {doc.original_filename}
                            </div>
                          </div>
                          <a href={`${API}/documents/${doc.id}/view`} target="_blank" rel="noreferrer" className="inline-flex shrink-0 items-center gap-1 text-xs text-[#29B6E8] font-bold uppercase tracking-wider hover:underline">
                            <Eye className="w-3 h-3" aria-hidden="true" /> ansehen
                          </a>
                        </div>
                      ))}
                    </div>
                  </AreaSection>
                ) : null}

                {benefits.length ? (
                  <AreaSection title="Mitgliedervorteile" icon={Gift} testId="member-area-benefits" more={{ to: "/members/benefits", label: "Alle Vorteile" }}>
                    <div className="space-y-3">
                      {benefits.slice(0, 3).map((benefit) => (
                        <div key={benefit.id} className="flex items-start gap-4 p-3 border border-white/10 rounded-sm hover:border-white/25 transition">
                          <div className="w-10 h-10 rounded-sm bg-[#0A0A0A] border border-white/15 flex items-center justify-center shrink-0 overflow-hidden">
                            {benefit.image_url ? <img src={resolveMediaUrl(benefit.image_url)} alt="" className="w-full h-full object-cover" /> : <Gift className="w-4 h-4 text-white/55" aria-hidden="true" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="font-bold text-white break-words">{benefit.title}</div>
                            {benefit.description ? <div className="text-xs text-white/60 mt-0.5 line-clamp-2">{benefit.description}</div> : null}
                          </div>
                          {benefit.link_url ? <a href={benefit.link_url} target="_blank" rel="noreferrer" className="text-xs uppercase tracking-wider text-[#29B6E8] hover:underline shrink-0">öffnen →</a> : null}
                        </div>
                      ))}
                    </div>
                  </AreaSection>
                ) : null}
              </div>

              <div className="xl:col-span-2 space-y-6 min-w-0">
                {internalEvents.length ? (
                  <AreaSection title="Interne Events" icon={Calendar} testId="member-area-events" more={{ to: "/events", label: "Alle Events" }}>
                    <div className="space-y-4">
                      {internalEvents.slice(0, 3).map((event) => (
                        <Link key={event.id} to={`/events/${event.slug}`} data-testid={`member-area-event-${event.id}`} className="group flex items-center gap-4">
                          <DateTile day={viennaDay(event.start_date)} />
                          <span className="min-w-0">
                            <span className="block text-[10px] uppercase tracking-widest text-white/45">{eventDateLine(event)}</span>
                            <span className="block font-bold text-white mt-0.5 break-words group-hover:text-[#29B6E8] transition">{event.name}</span>
                            {event.location ? <span className="mt-0.5 inline-flex items-center gap-1 text-xs text-white/50"><MapPin className="w-3 h-3" aria-hidden="true" /> {event.location}</span> : null}
                          </span>
                        </Link>
                      ))}
                    </div>
                  </AreaSection>
                ) : null}

                {discordVoice ? (
                  <AreaSection title="Discord jetzt" icon={MessageCircle} testId="member-area-discord-now">
                    <DiscordVoice data={discordVoice} />
                  </AreaSection>
                ) : null}

                {discordServers?.servers?.length ? (
                  <AreaSection title="Discord-Server" icon={MessageCircle} testId="member-area-discord-servers">
                    <DiscordServerList data={discordServers} testId="member-area-discord-server" />
                  </AreaSection>
                ) : null}

                {steam ? (
                  <AreaSection title="Gerade in Steam" icon={Gamepad2} testId="member-area-steam">
                    <SteamPresence data={steam} />
                  </AreaSection>
                ) : null}

                {contacts.length ? (
                  <AreaSection title="Ansprechpartner" icon={Users} testId="member-area-board" more={{ to: "/board", label: "Vorstand" }}>
                    <div className="space-y-4">
                      {contacts.map((contact) => <BoardAvatar key={contact.id} contact={contact} quiet testId={`member-area-contact-${contact.id}`} />)}
                    </div>
                  </AreaSection>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </section>
    </PublicLayout>
  );
}

/** Oben: die eigene Karte (ein Tipp öffnet sie mit Prüfcode), daneben Gruß, „Mitglied seit“ und der Beitragsstand. */
function AreaHead({ user, me, discordUrl }) {
  const card = areaCard(user, me);
  const fee = feeBadge(me?.dolibarr);
  const membership = me?.membership || {};
  const since = membership.member_since ? formatMemberSince(membership.member_since, membership.member_since_precision || "day") : "";
  const name = user?.display_name || user?.username || "";
  return (
    <header id="karte" tabIndex={-1} data-testid="member-area-head" className={`scroll-mt-32 xl:scroll-mt-28 grid gap-5 md:items-center focus:outline-none ${card ? "md:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] md:gap-8" : ""}`}>
      {card ? (
        <Link to="/members/membership#mitgliedskarte" data-testid="member-area-card-link" aria-label="Mitgliedskarte mit Prüfcode öffnen" className="block w-full rounded-[14px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#29B6E8]">
          <MemberCardArt name={card.name} number={card.number} since={card.since} typeLabel={card.typeLabel} validUntil={card.validUntil} testId="member-area-card" />
        </Link>
      ) : null}
      <div className="min-w-0">
        <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-white/50">Mitgliederbereich</span>
        <h1 className="font-heading text-3xl md:text-4xl font-black uppercase mt-1 break-words" data-testid="member-area-greeting">Hallo, {name}</h1>
        {since || membership.internal_role ? (
          <p className="mt-2 text-sm text-white/70 flex flex-wrap gap-x-4 gap-y-1">
            {since ? <span data-testid="member-area-since">Mitglied seit <strong className="text-white">{since}</strong></span> : null}
            {membership.internal_role ? <span>Rolle: <strong className="text-white">{membership.internal_role}</strong></span> : null}
          </p>
        ) : null}
        {fee ? <FeeBadge badge={fee} /> : null}
        <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-xs font-bold uppercase tracking-wider">
          <Link to="/members/membership" data-testid="member-area-my-membership" className="text-[#29B6E8] hover:underline">Meine Mitgliedschaft</Link>
          {discordUrl ? (
            <a href={discordUrl} target="_blank" rel="noreferrer" data-testid="member-area-discord" className="inline-flex items-center gap-1.5 text-[#29B6E8] hover:underline">
              <MessageCircle className="w-3.5 h-3.5" aria-hidden="true" /> Discord
            </a>
          ) : null}
        </div>
      </div>
    </header>
  );
}

const FEE_TONES = {
  ok: { icon: CheckCircle2, className: "border-[#00FF88]/40 bg-[#00FF88]/10 text-[#00FF88]" },
  warn: { icon: AlertCircle, className: "border-[#FF3B30]/50 bg-[#FF3B30]/10 text-[#FF8A80]" },
  plain: { icon: null, className: "border-white/15 bg-white/5 text-white/70" },
};

/** Das Schild „Beitrag bezahlt“ / „Beitrag offen“ - dieselben Daten wie „Meine Mitgliedschaft“. */
function FeeBadge({ badge }) {
  const tone = FEE_TONES[badge.tone] || FEE_TONES.plain;
  const Icon = tone.icon;
  return (
    <span data-testid="member-area-fee" data-tone={badge.tone} className={`mt-3 inline-flex items-center gap-1.5 rounded-sm border px-2 py-1 text-[11px] font-bold uppercase tracking-wider ${tone.className}`}>
      {Icon ? <Icon className="w-3.5 h-3.5" aria-hidden="true" /> : null}
      {badge.text}
    </span>
  );
}

/**
 * Die Sprungleiste (#1257): ein Tipp springt zum Abschnitt - oder, wenn er gerade nicht auf der Seite steht, zur eigenen
 * Seite. Der aktive Eintrag trägt den goldenen Strich (#1336); die Zahl steht in Cyan daneben.
 */
function JumpBar({ entries, present, active, onJump }) {
  const listRef = useRef(null);
  // Am Handy wandert die Zeile mit: der aktive Eintrag bleibt sichtbar, auch wenn er rechts außerhalb stand.
  useEffect(() => {
    const list = listRef.current;
    const item = list?.querySelector('[data-active="1"]');
    if (!list || !item || list.scrollWidth <= list.clientWidth) return;
    const listBox = list.getBoundingClientRect();
    const itemBox = item.getBoundingClientRect();
    if (itemBox.left < listBox.left || itemBox.right > listBox.right) {
      list.scrollBy?.({ left: itemBox.left - listBox.left - 16, behavior: motionAllowed() ? "smooth" : "auto" });
    }
  }, [active]);
  return (
    <nav aria-label="Mitgliederbereich" data-testid="member-area-links" className="tls-area-jump">
      <ul ref={listRef} className="tls-area-jump__list">
        {entries.map((entry) => {
          const here = present.has(entry.key);
          const current = here && active === entry.key;
          const props = {
            "data-testid": `member-area-jump-${entry.key}`,
            "data-active": current ? "1" : "0",
            "aria-current": current ? "location" : undefined,
            "aria-label": entry.note ? `${entry.label}, ${entry.note}` : undefined,
            className: "tls-area-jump__item",
          };
          const content = (
            <>
              <span>{entry.label}</span>
              {entry.note ? <span className="tls-area-jump__count"><span className="tls-area-jump__dot" aria-hidden="true"> · </span>{entry.note}</span> : null}
            </>
          );
          return (
            <li key={entry.key}>
              {here ? (
                <a href={`#${entry.key}`} onClick={(event) => { event.preventDefault(); onJump(entry.key); }} {...props}>{content}</a>
              ) : (
                <Link to={entry.to} {...props}>{content}</Link>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Ein Abschnitt mit einheitlichem Kopf: der Verweis rutscht in die nächste Zeile, statt die Überschrift zu überdecken. */
function AreaSection({ id, title, icon: Icon, more, testId, children }) {
  return (
    <section id={id} tabIndex={id ? -1 : undefined} data-testid={testId} className="scroll-mt-32 xl:scroll-mt-28 border border-white/10 rounded-sm bg-[#121212] p-5 focus:outline-none">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="min-w-0 font-heading text-lg font-black uppercase inline-flex items-center gap-2" data-testid={testId ? `${testId}-title` : undefined}>
          <Icon className="w-4 h-4 shrink-0 text-white/55" aria-hidden="true" /> {title}
        </h2>
        {more ? (
          <Link to={more.to} data-testid={testId ? `${testId}-more` : undefined} className="shrink-0 text-[11px] uppercase tracking-widest font-bold text-[#29B6E8] hover:underline">
            {more.label} →
          </Link>
        ) : null}
      </div>
      {children}
    </section>
  );
}

/** Datums-Kachel für Termine: Monat und Tag; Vorleser hören das ganze Datum. */
function DateTile({ day }) {
  const parts = dateTileParts(day);
  return (
    <span className="tls-date-tile" data-testid="member-area-date-tile">
      <span className="tls-date-tile__month" aria-hidden="true">{parts?.month || "–"}</span>
      <span className="tls-date-tile__day font-heading" aria-hidden="true">{parts?.day || "?"}</span>
      {parts ? <span className="sr-only">{parts.full}</span> : null}
    </span>
  );
}

function helperLine(event) {
  const places = Number(event.open_places) || 0;
  return [
    places ? (places === 1 ? "1 freier Platz" : `${places} freie Plätze`) : "",
    (event.mine || []).length ? "du hilfst mit" : "",
    event.place || "",
  ].filter(Boolean).join(" · ");
}

/** Die nächste Versammlung mit Datums-Kachel - Zusage direkt hier („Ich komme / Vielleicht / Nein“). */
function MeetingCard({ meeting, busy, onAnswer }) {
  const meta = [meeting.kind_label, meeting.time ? `${meeting.time} Uhr` : "", meeting.format_label].filter(Boolean).join(" · ");
  return (
    <div data-testid={`member-area-meeting-${meeting.id}`}>
      <div className="flex gap-4">
        <DateTile day={meeting.day} />
        <div className="min-w-0 flex-1">
          {meta ? <div className="text-[10px] uppercase tracking-widest text-white/45">{meta}</div> : null}
          <Link to="/members/meetings" className="mt-0.5 block font-bold text-white break-words hover:text-[#29B6E8] transition">{meeting.title}</Link>
          {meeting.place ? <div className="mt-0.5 inline-flex items-center gap-1 text-xs text-white/50"><MapPin className="w-3 h-3" aria-hidden="true" /> {meeting.place}</div> : null}
        </div>
      </div>
      {/* Am Handy unter der Kachel über die ganze Breite (eine Zeile), ab Tablet bündig mit dem Text. */}
      <div className="sm:pl-16">
        {meeting.can_respond ? (
          <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Kommst du?">
            {MEETING_ANSWERS.map(([code, label]) => (
              <button
                key={code}
                type="button"
                aria-pressed={meeting.response === code}
                disabled={busy}
                onClick={() => { if (meeting.response !== code) onAnswer(meeting, code); }}
                data-testid={`member-area-answer-${code}`}
                className={`tls-btn ${meeting.response === code ? "tls-btn--primary" : "tls-btn--quiet"} px-3 py-1.5 rounded-sm text-[11px] font-bold uppercase tracking-wider`}
              >
                {label}
              </button>
            ))}
          </div>
        ) : null}
        <p className="mt-2 text-xs text-white/50" data-testid="member-area-answer">Deine Antwort: <strong className="text-white">{meeting.response_label || "noch keine Antwort"}</strong></p>
      </div>
    </div>
  );
}

/** Am Vereinsgeburtstag (#644): der Hinweis mit dem Jahres-Sticker für Mitglieder - nur, solange die Saison läuft. */
export function BirthdayNote() {
  const { seasons } = useSeason();
  const birthday = (seasons || []).find((season) => season.key === "club_birthday");
  if (!birthday) return null;
  const years = Number(birthday.data?.years);
  return (
    <div data-testid="member-area-birthday" className="mt-6 border border-[#29B6E8]/40 bg-[#29B6E8]/5 rounded-sm p-5 flex flex-col sm:flex-row sm:items-center gap-4">
      <Cake className="w-7 h-7 text-[#29B6E8] shrink-0" aria-hidden="true" />
      <div className="flex-1 min-w-0">
        <div className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8]">Vereinsgeburtstag</div>
        <p className="mt-1 text-sm text-white/80">{years > 0 ? `Heute vor ${years} ${years === 1 ? "Jahr" : "Jahren"} wurde der Verein gegründet.` : "Heute hat der Verein Geburtstag."} Als Mitglied bekommst du dazu einen Jahres-Sticker für den Chat – jedes Jahr einen anderen.</p>
      </div>
      <StickerClaim testId="member-area-birthday-sticker" />
    </div>
  );
}
