import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowRight, Calendar, ExternalLink, Eye, Handshake, Newspaper, Radio, Users, Wrench, X } from "lucide-react";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { Breadcrumbs } from "@/components/tls/Breadcrumbs";
import { SmartLogo } from "@/components/tls/SmartLogo";
import { ExternalMediaNotice } from "@/components/tls/ExternalMediaNotice";
import { useCookieConsent } from "@/components/tls/CookieConsent";
import { ChannelIcon, channelColor } from "@/components/tls/ChannelIcon";
import { api, resolveMediaUrl } from "@/lib/api";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { useCanonicalSlugRedirect } from "@/hooks/useCanonicalSlugRedirect";
import { seoTextPreview } from "@/lib/textPreview";

// Partnerseite (#469 Teil 1): Kopf mit Logo, Art, „Partner seit“ und Kanal-Symbolen; links der
// laufende Twitch-Stream (nur wenn live), der Text über den Partner, seine Tools und Projekte
// (auf Wunsch hier eingebettet, nach Zustimmung zu externen Medien) und News, in denen er genannt
// wird; rechts die Kanäle mit Live-Stand und Discord-Online-Zahl sowie der Weg zur Zusammenarbeit.

export function twitchPlayerSrc(channel) {
  const params = new URLSearchParams({ channel, parent: window.location.hostname, muted: "true", autoplay: "false" });
  return `https://player.twitch.tv/?${params.toString()}`;
}

function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("de-DE", { day: "2-digit", month: "long", year: "numeric" });
}

export function channelDetail(channel, twitch, discord) {
  if (channel.key === "twitch") {
    if (twitch?.live) return { text: `Live · ${twitch.viewer_count || 0} Zuschauer`, tone: "#FF3B30" };
    if (twitch?.configured) return { text: "gerade offline", tone: "" };
    return { text: channel.handle ? `twitch.tv/${channel.handle}` : "", tone: "" };
  }
  if (channel.key === "discord") {
    if (discord?.enabled) return { text: `${discord.online || 0} gerade online${discord.name ? ` · ${discord.name}` : ""}`, tone: "#00FF88" };
    return { text: "Einladung", tone: "" };
  }
  try {
    return { text: new URL(channel.url).hostname.replace(/^www\./, ""), tone: "" };
  } catch {
    return { text: "", tone: "" };
  }
}

export default function PartnerDetailPage() {
  const { slug } = useParams();
  const [partner, setPartner] = useState(null);
  const [state, setState] = useState("loading");
  const [openTool, setOpenTool] = useState(null);
  const { hasConsent } = useCookieConsent();

  const load = useCallback(async () => {
    try {
      const { data } = await api.get(`/partners/${encodeURIComponent(slug)}`);
      setPartner(data);
      setState("ready");
    } catch {
      setPartner(null);
      setState("missing");
    }
  }, [slug]);
  useEffect(() => { load(); }, [load]);
  useApiInvalidation(load, ["partners", "news"]);
  useCanonicalSlugRedirect(slug, partner?.slug, "/partners");
  useDocumentTitle(partner?.name || "Partner", seoTextPreview(partner?.description, "Partner von THE LION SQUAD eSports."), { image: partner?.logo_url });

  if (state === "loading") {
    return <PublicLayout><div className="p-20 text-center font-display tracking-widest text-white/40">LADE PARTNER …</div></PublicLayout>;
  }
  if (!partner) {
    return (
      <PublicLayout>
        <div className="p-20 text-center" data-testid="partner-missing">
          <h1 className="font-heading text-3xl uppercase">Partner nicht gefunden</h1>
          <Link to="/partners" className="inline-block mt-4 text-[#29B6E8] hover:underline">← Alle Partner</Link>
        </div>
      </PublicLayout>
    );
  }

  const channels = Array.isArray(partner.channels) ? partner.channels : [];
  const tools = Array.isArray(partner.tools) ? partner.tools : [];
  const news = Array.isArray(partner.news) ? partner.news : [];
  const twitch = partner.twitch || null;
  const discord = partner.discord || null;
  const twitchChannel = channels.find((channel) => channel.key === "twitch") || null;
  const live = Boolean(twitch?.live && twitchChannel);
  const since = partner.since || (partner.since_year ? String(partner.since_year) : "");
  const embeddedTool = tools.find((tool) => tool.id === openTool) || null;
  const shared = partner.shared || {};
  const sharedEvents = Array.isArray(shared.events) ? shared.events : [];
  const sharedTournaments = Array.isArray(shared.tournaments) ? shared.tournaments : [];
  const hasMain = live || Boolean(partner.about) || tools.length > 0 || news.length > 0 || sharedEvents.length > 0 || sharedTournaments.length > 0;

  return (
    <PublicLayout>
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-6 pb-16" data-testid="partner-page">
        <Breadcrumbs items={[{ label: "Home", to: "/" }, { label: "Partner", to: "/partners" }, { label: partner.name }]} className="mb-6" />

        <header className="grid gap-0 lg:grid-cols-[18rem_minmax(0,1fr)] border border-white/10 rounded-sm bg-[#101010] overflow-hidden" data-testid="partner-hero">
          <div className="min-h-48 lg:min-h-full bg-[#070707] flex items-center justify-center p-8 border-b lg:border-b-0 lg:border-r border-white/10">
            {partner.logo_url ? (
              <SmartLogo src={resolveMediaUrl(partner.logo_url)} alt={partner.name} className="max-h-40 max-w-[80%] w-auto h-auto" />
            ) : (
              <Handshake className="w-14 h-14 text-[#29B6E8]" />
            )}
          </div>
          <div className="p-6 md:p-8 min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-widest font-bold text-[#29B6E8]">
              <span>{partner.kind || "Partner"}</span>
              {since && <span className="text-white/40">· Partner seit {since}</span>}
              {live && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 border border-[#FF3B30]/50 text-[#FF3B30] rounded-sm" data-testid="partner-live-pill">
                  <Radio className="w-3 h-3 animate-live" /> Live auf Twitch
                </span>
              )}
            </div>
            <h1 className="mt-2 font-heading font-black uppercase text-3xl md:text-5xl leading-tight break-words">{partner.name}</h1>
            {partner.description && <p className="mt-4 text-white/70 leading-relaxed max-w-2xl">{partner.description}</p>}
            {channels.length > 0 && (
              <div className="mt-5 flex flex-wrap gap-2" data-testid="partner-channel-icons">
                {channels.map((channel) => (
                  <a
                    key={channel.key}
                    href={channel.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={channel.label}
                    title={channel.label}
                    data-testid={`partner-icon-${channel.key}`}
                    className="inline-flex h-10 w-10 items-center justify-center border border-white/10 bg-[#0A0A0A] rounded-sm text-white/70 transition hover:text-[var(--c)] hover:border-[var(--c)]"
                    style={{ "--c": channelColor(channel.key) }}
                  >
                    <ChannelIcon kind={channel.key} className="w-4 h-4" />
                  </a>
                ))}
              </div>
            )}
          </div>
        </header>

        <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem] xl:grid-cols-[minmax(0,1fr)_24rem]">
          <div className="space-y-8 min-w-0">
            {live && <TwitchLiveSection channel={twitchChannel} twitch={twitch} hasConsent={hasConsent} />}

            {partner.about && (
              <section data-testid="partner-about">
                <SectionTitle icon={Handshake} kicker="Über den Partner" title={partner.name} />
                <div className="text-white/75 leading-relaxed whitespace-pre-line max-w-3xl">{partner.about}</div>
              </section>
            )}

            {tools.length > 0 && (
              <section data-testid="partner-tools">
                <SectionTitle icon={Wrench} color="#FFD700" kicker="Tools & Projekte" title={`Vom Partner (${tools.length})`} />
                <div className="grid gap-3 md:grid-cols-2">
                  {tools.map((tool) => (
                    <ToolCard key={tool.id} tool={tool} active={openTool === tool.id} onEmbed={tool.embed ? () => setOpenTool(openTool === tool.id ? null : tool.id) : null} />
                  ))}
                </div>
                {embeddedTool && <ToolEmbed tool={embeddedTool} hasConsent={hasConsent} onClose={() => setOpenTool(null)} />}
              </section>
            )}

            {(sharedEvents.length > 0 || sharedTournaments.length > 0) && (
              <section data-testid="partner-shared">
                <SectionTitle icon={Calendar} kicker="Gemeinsam" title="Events & Turniere" />
                <div className="grid gap-3 md:grid-cols-2">
                  {sharedEvents.map((event) => (
                    <SharedCard key={event.id} to={`/events/${event.slug || event.id}`} testId={`partner-event-${event.slug || event.id}`} kicker="Event" title={event.name} date={event.start_date} />
                  ))}
                  {sharedTournaments.map((tournament) => (
                    <SharedCard key={tournament.id} to={`/tournaments/${tournament.slug || tournament.id}`} testId={`partner-tournament-${tournament.slug || tournament.id}`} kicker={tournament.game?.name ? `Turnier · ${tournament.game.name}` : "Turnier"} title={tournament.title} date={tournament.start_date} />
                  ))}
                </div>
              </section>
            )}

            {news.length > 0 && (
              <section data-testid="partner-news">
                <SectionTitle icon={Newspaper} kicker="Gemeinsam" title="News mit dem Partner" />
                <div className="grid gap-3 md:grid-cols-2">
                  {news.map((post) => (
                    <Link key={post.id || post.slug} to={`/news/${post.slug}`} data-testid={`partner-news-${post.slug}`} className="flex gap-3 border border-white/10 rounded-sm bg-[#121212] p-3 hover:border-[#29B6E8]/60 transition min-w-0">
                      {post.banner_url ? (
                        <img src={resolveMediaUrl(post.banner_url)} alt="" className="w-20 h-16 object-cover rounded-sm shrink-0" />
                      ) : (
                        <div className="w-20 h-16 rounded-sm bg-[#0A0A0A] border border-white/10 flex items-center justify-center shrink-0"><Newspaper className="w-5 h-5 text-white/30" /></div>
                      )}
                      <div className="min-w-0">
                        <div className="font-heading font-bold leading-tight line-clamp-2">{post.title}</div>
                        {formatDate(post.published_at || post.created_at) && <div className="mt-1 text-[11px] text-white/45 inline-flex items-center gap-1"><Calendar className="w-3 h-3" /> {formatDate(post.published_at || post.created_at)}</div>}
                      </div>
                    </Link>
                  ))}
                </div>
              </section>
            )}

            {!hasMain && (
              <div className="border border-dashed border-white/15 rounded-sm px-6 py-14 text-center" data-testid="partner-empty">
                <Handshake className="w-8 h-8 mx-auto mb-3 text-white/25" />
                <div className="font-heading text-xl font-bold uppercase text-white/70">Mehr folgt</div>
                <p className="mt-2 text-sm text-white/45 max-w-md mx-auto">Kanäle, Projekte und gemeinsame News von {partner.name} erscheinen hier, sobald sie eingetragen sind.</p>
              </div>
            )}
          </div>

          <aside className="space-y-4 min-w-0" data-testid="partner-sidebar">
            {channels.length > 0 && <ChannelsCard channels={channels} twitch={twitch} discord={discord} />}
            <section className="border border-white/10 rounded-sm bg-[#121212] p-4" data-testid="partner-cooperation">
              <h2 className="font-heading text-lg font-bold uppercase flex items-center gap-2"><Users className="w-4 h-4 text-[#29B6E8]" /> Zusammenarbeit</h2>
              <p className="mt-2 text-sm text-white/55">Gemeinsame Events, Turniere und Community-Projekte mit {partner.name} laufen über den Verein.</p>
              <Link to="/contact" className="mt-3 inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-[#29B6E8] hover:text-white">Kontakt aufnehmen <ArrowRight className="w-3 h-3" /></Link>
            </section>
            <Link to="/partners" className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-white/40 hover:text-white">← Alle Partner</Link>
          </aside>
        </div>
      </section>
    </PublicLayout>
  );
}

// Gemeinsames Event oder Turnier (#469 Teil 2): Karte mit Art, Titel und Datum, führt zur Seite.
function SharedCard({ to, testId, kicker, title, date }) {
  return (
    <Link to={to} data-testid={testId} className="border border-white/10 rounded-sm bg-[#121212] p-3 hover:border-[#29B6E8]/60 transition min-w-0">
      <div className="text-[10px] uppercase tracking-widest font-bold text-[#29B6E8]">{kicker}</div>
      <div className="mt-1 font-heading font-bold leading-tight break-words">{title}</div>
      {formatDate(date) && <div className="mt-1 text-[11px] text-white/45 inline-flex items-center gap-1"><Calendar className="w-3 h-3" /> {formatDate(date)}</div>}
    </Link>
  );
}

function SectionTitle({ icon: Icon, color = "#29B6E8", kicker, title }) {
  return (
    <div className="mb-4">
      {kicker && <div className="text-[11px] uppercase tracking-[0.3em] font-bold" style={{ color }}>{kicker}</div>}
      <h2 className="mt-1 font-heading text-2xl font-bold uppercase flex items-center gap-2"><Icon className="w-5 h-5" style={{ color }} /> {title}</h2>
    </div>
  );
}

function TwitchLiveSection({ channel, twitch, hasConsent }) {
  return (
    <section data-testid="partner-twitch-live" className="border border-[#9146FF]/40 rounded-sm bg-[#121212] overflow-hidden min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-white/10">
        <h2 className="font-heading text-xl font-bold uppercase flex items-center gap-2">
          <ChannelIcon kind="twitch" className="w-5 h-5 text-[#9146FF]" /> Live auf Twitch
        </h2>
        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 border border-[#FF3B30]/50 text-[#FF3B30] text-[10px] uppercase tracking-widest rounded-sm font-bold">
          <Radio className="w-3 h-3 animate-live" /> Live · {twitch.viewer_count || 0} Zuschauer
        </span>
      </div>
      {hasConsent("external_media") ? (
        <div className="w-full bg-black aspect-video min-h-[180px] sm:min-h-0">
          <iframe title={`Twitch Stream ${channel.handle}`} src={twitchPlayerSrc(channel.handle)} className="block w-full h-full border-0" allow="autoplay; fullscreen; picture-in-picture" allowFullScreen />
        </div>
      ) : (
        <div className="p-4">
          <ExternalMediaNotice service="Twitch" reason="Der Twitch-Player wird erst nach Zustimmung zu externen Medien geladen." url={channel.url} accent="#9146FF" compact testId="partner-twitch-consent-notice" />
        </div>
      )}
      <div className="px-4 py-3 flex flex-wrap items-center justify-between gap-2 text-xs text-white/55">
        <span className="truncate min-w-0">{twitch.title || "Stream läuft"}{twitch.game_name ? ` · ${twitch.game_name}` : ""}</span>
        <a href={channel.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[#9146FF] hover:text-white font-bold uppercase tracking-wider text-[10px]">Bei Twitch öffnen <ExternalLink className="w-3 h-3" /></a>
      </div>
    </section>
  );
}

function ChannelsCard({ channels, twitch, discord }) {
  return (
    <section className="border border-white/10 rounded-sm bg-[#121212] p-4" data-testid="partner-channels">
      <h2 className="font-heading text-lg font-bold uppercase flex items-center gap-2"><Radio className="w-4 h-4 text-[#29B6E8]" /> Kanäle</h2>
      <div className="mt-3 grid gap-2">
        {channels.map((channel) => {
          const detail = channelDetail(channel, twitch, discord);
          const color = channelColor(channel.key);
          return (
            <a
              key={channel.key}
              href={channel.url}
              target="_blank"
              rel="noopener noreferrer"
              data-testid={`partner-channel-${channel.key}`}
              className="flex items-center gap-3 border rounded-sm px-3 py-2.5 border-white/10 bg-[#0A0A0A] hover:border-[var(--c)] transition min-w-0"
              style={{ "--c": color }}
            >
              <span className="w-10 h-10 shrink-0 rounded-sm flex items-center justify-center border-2 bg-black/40" style={{ borderColor: color, color }}>
                <ChannelIcon kind={channel.key} className="w-5 h-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-bold text-sm text-white truncate">{channel.label}</span>
                {detail.text && <span className="block text-[11px] truncate" style={{ color: detail.tone || "rgba(255,255,255,0.5)" }}>{detail.text}</span>}
              </span>
              {channel.key === "discord" && discord?.enabled ? (
                <span className="text-[10px] font-bold uppercase tracking-wider text-[#5865F2] shrink-0">Beitreten</span>
              ) : (
                <ExternalLink className="w-4 h-4 text-white/40 shrink-0" aria-hidden="true" />
              )}
            </a>
          );
        })}
      </div>
    </section>
  );
}

function ToolCard({ tool, active, onEmbed }) {
  return (
    <div className={`border rounded-sm bg-[#121212] overflow-hidden flex flex-col ${active ? "border-[#FFD700]/60" : "border-white/10"}`} data-testid={`partner-tool-${tool.id}`}>
      {tool.image_url && <img src={resolveMediaUrl(tool.image_url)} alt="" className="w-full h-36 object-cover border-b border-white/10" />}
      <div className="p-4 flex-1 min-w-0">
        <div className="font-heading font-bold text-lg leading-tight break-words">{tool.title}</div>
        {tool.description && <p className="mt-1 text-sm text-white/55">{tool.description}</p>}
      </div>
      <div className="px-4 pb-4 flex flex-wrap gap-2">
        {onEmbed && (
          <button type="button" onClick={onEmbed} data-testid={`partner-tool-embed-${tool.id}`} className={`inline-flex items-center gap-1.5 px-3 py-1.5 border rounded-sm text-[10px] font-bold uppercase tracking-wider transition ${active ? "border-[#FFD700] text-[#FFD700]" : "border-white/15 text-white/70 hover:text-[#FFD700] hover:border-[#FFD700]/60"}`}>
            <Eye className="w-3.5 h-3.5" /> {active ? "Ausblenden" : "Hier ansehen"}
          </button>
        )}
        <a href={tool.url} target="_blank" rel="noopener noreferrer" data-testid={`partner-tool-open-${tool.id}`} className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-white/15 rounded-sm text-[10px] font-bold uppercase tracking-wider text-white/70 hover:text-[#29B6E8] hover:border-[#29B6E8]/60 transition">
          Öffnen <ExternalLink className="w-3.5 h-3.5" />
        </a>
      </div>
    </div>
  );
}

// Eingebettet nur nach Zustimmung zu externen Medien - die Seite des Partners lädt sonst nichts.
function ToolEmbed({ tool, hasConsent, onClose }) {
  return (
    <div className="mt-4 border border-[#FFD700]/40 rounded-sm bg-[#0A0A0A] overflow-hidden" data-testid="partner-tool-embed">
      <div className="flex items-center justify-between gap-3 px-4 py-2 border-b border-white/10 text-xs">
        <span className="font-bold text-white/80 truncate">{tool.title}</span>
        <div className="flex items-center gap-3 shrink-0">
          <a href={tool.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[#29B6E8] hover:text-white font-bold uppercase tracking-wider text-[10px]">Direkt öffnen <ExternalLink className="w-3 h-3" /></a>
          <button type="button" onClick={onClose} aria-label="Einbettung schließen" className="text-white/50 hover:text-white"><X className="w-4 h-4" /></button>
        </div>
      </div>
      {hasConsent("external_media") ? (
        <>
          <iframe title={tool.title} src={tool.url} className="block w-full border-0 h-[70vh] min-h-[420px] bg-white" sandbox="allow-scripts allow-same-origin allow-popups allow-forms" loading="lazy" />
          <p className="px-4 py-2 text-[11px] text-white/40">Bleibt der Rahmen leer, lässt die Seite des Partners das Einbetten nicht zu – dann „Direkt öffnen“.</p>
        </>
      ) : (
        <div className="p-4">
          <ExternalMediaNotice service={tool.title} reason="Die Seite des Partners wird erst nach Zustimmung zu externen Medien geladen." url={tool.url} accent="#FFD700" compact testId="partner-tool-consent-notice" />
        </div>
      )}
    </div>
  );
}
