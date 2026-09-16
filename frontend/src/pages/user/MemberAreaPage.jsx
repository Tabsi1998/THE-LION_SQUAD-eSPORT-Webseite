import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { API, api, formatMemberSince, resolveMediaUrl } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { boardContacts, eventDateLine, memberEvents, memberNews } from "@/lib/memberArea";
import { Crown, Gift, FileText, Bell, Calendar, Hash, Eye, MapPin, Users, MessageCircle } from "lucide-react";

// Der Mitgliederbereich (#284): oben die Mitgliedschaft, eine Zeile Verweise,
// darunter nur Karten mit Inhalt. Vorher standen vier Kacheln und darunter
// dieselben Themen noch einmal als Karten, drei davon leer.
const LINKS = [
  { to: "/members/membership", label: "Mitgliedschaft" },
  { to: "/members/benefits", label: "Vorteile" },
  { to: "/members/documents", label: "Dokumente" },
  { to: "/members/news", label: "Interne News" },
  { to: "/board", label: "Vorstand" },
];

export default function MemberAreaPage() {
  const { user } = useAuth();
  const [benefits, setBenefits] = useState([]);
  const [my, setMy] = useState(null);
  const [docs, setDocs] = useState([]);
  const [internalNews, setInternalNews] = useState([]);
  // Interne Events (#283): die Event-Liste liefert, was ich sehen darf; hier
  // bleiben nur Mitglieder- und interne Events, die noch anstehen.
  const [internalEvents, setInternalEvents] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [discordUrl, setDiscordUrl] = useState("");
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(() => {
    Promise.allSettled([
      api.get("/membership/benefits"),
      api.get("/membership/me"),
      api.get("/documents"),
      api.get("/news"),
      api.get("/events?upcoming=true&compact=true&limit=48"),
      api.get("/board?active_only=true"),
      api.get("/settings/public"),
    ]).then(([b, m, d, n, e, p, s]) => {
      if (b.status === "fulfilled") setBenefits(Array.isArray(b.value.data) ? b.value.data : []);
      if (m.status === "fulfilled") setMy(m.value.data);
      if (d.status === "fulfilled") setDocs(Array.isArray(d.value.data) ? d.value.data : []);
      if (n.status === "fulfilled") setInternalNews(memberNews(n.value.data));
      if (e.status === "fulfilled") setInternalEvents(memberEvents(e.value.data));
      if (p.status === "fulfilled") setContacts(boardContacts(p.value.data));
      if (s.status === "fulfilled") setDiscordUrl(s.value.data?.discord_invite_url || "");
      setLoaded(true);
    });
  }, []);
  useEffect(() => { load(); }, [load]);
  useApiInvalidation(load, ["membership", "documents", "news", "users", "events", "board", "settings"]);

  const memberSince = my?.membership?.member_since
    ? formatMemberSince(my.membership.member_since, my.membership.member_since_precision)
    : null;
  const nothingYet = loaded && !internalEvents.length && !docs.length && !benefits.length && !internalNews.length;

  return (
    <PublicLayout>
      <section className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        {/* Kopf: Mitgliedschaft */}
        <div className="border border-[#FFD700]/40 bg-gradient-to-r from-[#FFD700]/10 via-[#FFD700]/5 to-transparent rounded-sm p-6 md:p-8">
          <div className="flex flex-col md:flex-row items-start md:items-center gap-4 md:gap-6">
            <div className="w-16 h-16 rounded-sm bg-[#FFD700]/20 border border-[#FFD700]/50 flex items-center justify-center">
              <Crown className="w-7 h-7 text-[#FFD700]" />
            </div>
            <div className="flex-1">
              <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#FFD700]">MITGLIEDERBEREICH</span>
              <h1 className="font-heading text-3xl md:text-4xl font-black uppercase mt-1">Willkommen, {user?.display_name || user?.username}</h1>
              <div className="mt-2 text-sm text-white/70 flex flex-wrap gap-x-4 gap-y-1">
                {my?.membership?.member_number && (
                  <span className="inline-flex items-center gap-1.5"><Hash className="w-3 h-3 text-[#FFD700]" /> <strong className="text-[#FFD700] font-mono">{my.membership.member_number}</strong></span>
                )}
                {memberSince && <span>Mitglied seit <strong className="text-white">{memberSince}</strong></span>}
                {my?.membership?.internal_role && <span>Rolle: <strong className="text-white">{my.membership.internal_role}</strong></span>}
              </div>
            </div>
            <Link to="/members/membership" data-testid="member-area-my-membership" className="px-4 py-2 bg-[#FFD700] text-black font-bold uppercase tracking-wider text-xs rounded-sm hover:bg-[#e8c200]">
              Meine Mitgliedschaft
            </Link>
          </div>
        </div>

        {/* Eine Zeile Verweise statt Kacheln */}
        <nav aria-label="Mitgliederbereich" data-testid="member-area-links" className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-[11px] font-bold uppercase tracking-widest">
          {LINKS.map((link) => (
            <Link key={link.to} to={link.to} className="text-white/55 hover:text-[#FFD700] transition">{link.label}</Link>
          ))}
          {discordUrl ? (
            <a href={discordUrl} target="_blank" rel="noreferrer" data-testid="member-area-discord" className="inline-flex items-center gap-1.5 text-[#5865F2] hover:text-white transition">
              <MessageCircle className="w-3.5 h-3.5" /> Discord
            </a>
          ) : null}
        </nav>

        {nothingYet ? (
          <div data-testid="member-area-empty" className="mt-10 border border-white/10 rounded-sm bg-[#121212] p-8 text-center">
            <Bell className="w-6 h-6 text-[#FFD700] mx-auto" />
            <p className="mt-3 text-sm text-white/70">Neues erscheint hier, sobald der Verein etwas freischaltet: interne Events, Dokumente, Vorteile, interne News.</p>
            <p className="mt-1 text-xs text-white/40">Bis dahin: Vorstand und Discord über die Verweise oben.</p>
          </div>
        ) : null}

        <div className="mt-8 grid lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            {internalEvents.length ? (
              <Section title="Interne Events" icon={Calendar} testId="member-area-events" more={{ to: "/events", label: "Alle Events" }}>
                <div className="space-y-3">
                  {internalEvents.slice(0, 3).map((ev) => (
                    <Link key={ev.id} to={`/events/${ev.slug}`} data-testid={`member-area-event-${ev.id}`} className="block border-l-2 border-[#FFD700]/50 pl-3 hover:border-[#FFD700] transition">
                      <div className="text-[10px] uppercase tracking-widest text-white/40">{eventDateLine(ev)}</div>
                      <div className="font-bold text-white mt-0.5">{ev.name}</div>
                      {ev.location && <div className="text-xs text-white/50 mt-0.5 inline-flex items-center gap-1"><MapPin className="w-3 h-3" /> {ev.location}</div>}
                    </Link>
                  ))}
                </div>
              </Section>
            ) : null}

            {docs.length ? (
              <Section title="Vereinsdokumente" icon={FileText} testId="member-area-documents" more={{ to: "/members/documents", label: "Alle Dokumente" }}>
                <div className="space-y-2">
                  {docs.slice(0, 4).map((d) => (
                    <div key={d.id} className="flex items-center gap-3 p-3 border border-white/10 rounded-sm hover:border-white/25 transition">
                      <FileText className="w-4 h-4 text-[#FFD700] shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="font-bold text-sm text-white truncate">{d.title}</div>
                        <div className="text-[10px] text-white/40 uppercase tracking-wider">{d.original_filename}</div>
                      </div>
                      <a href={`${API}/documents/${d.id}/view`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-[#FFD700] font-bold uppercase tracking-wider hover:underline"><Eye className="w-3 h-3" /> ansehen</a>
                    </div>
                  ))}
                </div>
              </Section>
            ) : null}

            {benefits.length ? (
              <Section title="Mitgliedervorteile" icon={Gift} testId="member-area-benefits" more={{ to: "/members/benefits", label: "Alle Vorteile" }}>
                <div className="space-y-3">
                  {benefits.slice(0, 3).map((b) => (
                    <div key={b.id} className="flex items-start gap-4 p-3 border border-white/10 rounded-sm hover:border-[#FFD700]/30 transition">
                      <div className="w-10 h-10 rounded-sm bg-[#0A0A0A] border border-[#FFD700]/30 flex items-center justify-center shrink-0 overflow-hidden">
                        {b.image_url ? <img src={resolveMediaUrl(b.image_url)} alt="" className="w-full h-full object-cover" /> : <Gift className="w-4 h-4 text-[#FFD700]" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-bold text-white">{b.title}</div>
                        {b.description && <div className="text-xs text-white/60 mt-0.5 line-clamp-2">{b.description}</div>}
                      </div>
                      {b.link_url && <a href={b.link_url} target="_blank" rel="noreferrer" className="text-xs uppercase tracking-wider text-[#FFD700] hover:underline shrink-0">öffnen →</a>}
                    </div>
                  ))}
                </div>
              </Section>
            ) : null}
          </div>

          <div className="space-y-6">
            {internalNews.length ? (
              <Section title="Interne News" icon={Bell} testId="member-area-news" more={{ to: "/members/news", label: "Alle" }}>
                <div className="space-y-3">
                  {internalNews.map((n) => (
                    <Link key={n.id} to={`/news/${n.slug}`} className="block border-l-2 border-[#FFD700]/50 pl-3 hover:border-[#FFD700] transition">
                      <div className="text-[10px] uppercase tracking-widest text-white/40">{new Date(n.created_at).toLocaleDateString("de-DE")}</div>
                      <div className="font-bold text-white mt-0.5">{n.title}</div>
                    </Link>
                  ))}
                </div>
              </Section>
            ) : null}

            {contacts.length ? (
              <Section title="Ansprechpartner" icon={Users} testId="member-area-board" more={{ to: "/board", label: "Vorstand" }}>
                <div className="space-y-3">
                  {contacts.map((c) => (
                    <Link key={c.id} to={c.profileUrl} className="flex items-center gap-3 group">
                      <span className="w-10 h-10 rounded-sm border border-white/10 bg-[#0A0A0A] overflow-hidden inline-flex items-center justify-center shrink-0">
                        {c.avatar ? <img src={resolveMediaUrl(c.avatar)} alt="" className="w-full h-full object-cover" /> : <Users className="w-4 h-4 text-white/40" />}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-[10px] uppercase tracking-widest text-[#FFD700]">{c.title}</span>
                        <span className="block font-bold text-white truncate group-hover:text-[#FFD700] transition">{c.name}</span>
                      </span>
                    </Link>
                  ))}
                </div>
              </Section>
            ) : null}
          </div>
        </div>
      </section>
    </PublicLayout>
  );
}

function Section({ title, icon: Icon, more, testId, children }) {
  return (
    <div className="border border-white/10 rounded-sm bg-[#121212] p-5" data-testid={testId}>
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-heading text-lg font-black uppercase flex items-center gap-2"><Icon className="w-4 h-4 text-[#FFD700]" /> {title}</h2>
        {more && <Link to={more.to} className="text-[10px] uppercase tracking-widest font-bold text-[#FFD700] hover:underline">{more.label} →</Link>}
      </div>
      {children}
    </div>
  );
}
