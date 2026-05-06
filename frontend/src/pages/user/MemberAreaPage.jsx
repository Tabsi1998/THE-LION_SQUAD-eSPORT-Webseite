import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { API, api, formatMemberSince, resolveMediaUrl } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { Crown, Gift, FileText, Bell, Calendar, Hash, Newspaper, Download, ArrowRight, User } from "lucide-react";

export default function MemberAreaPage() {
  const { user } = useAuth();
  const [benefits, setBenefits] = useState([]);
  const [my, setMy] = useState(null);
  const [docs, setDocs] = useState([]);
  const [internalNews, setInternalNews] = useState([]);

  const load = useCallback(() => {
    Promise.allSettled([
      api.get("/membership/benefits"),
      api.get("/membership/me"),
      api.get("/documents"),
      api.get("/news"),
    ]).then(([b, m, d, n]) => {
      if (b.status === "fulfilled") setBenefits(b.value.data);
      if (m.status === "fulfilled") setMy(m.value.data);
      if (d.status === "fulfilled") setDocs(d.value.data);
      if (n.status === "fulfilled") {
        setInternalNews(n.value.data.filter((x) => x.visibility === "members" || x.visibility === "internal").slice(0, 3));
      }
    });
  }, []);
  useEffect(() => { load(); }, [load]);
  useApiInvalidation(load, ["membership", "documents", "news", "users"]);

  const memberSince = my?.membership?.member_since
    ? formatMemberSince(my.membership.member_since, my.membership.member_since_precision)
    : null;

  return (
    <PublicLayout>
      <section className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        {/* Hero */}
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

        {/* Quick tiles */}
        <div className="mt-8 grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Tile to="/members/membership" icon={User} title="Mitgliedschaft" subtitle="Status, Nummer, Verlauf" testId="tile-membership" />
          <Tile to="/members/benefits" icon={Gift} title="Vorteile" subtitle={`${benefits.length} verfügbar`} testId="tile-benefits" />
          <Tile to="/members/documents" icon={Download} title="Dokumente" subtitle={`${docs.length} Downloads`} testId="tile-documents" />
          <Tile to="/members/news" icon={Newspaper} title="Interne News" subtitle={`${internalNews.length} aktuell`} testId="tile-news" />
        </div>

        {/* Recent benefits */}
        <div className="mt-10 grid lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <Section title="Mitgliedervorteile" icon={Gift} more={{ to: "/members/benefits", label: "Alle Vorteile" }}>
              {benefits.length === 0 ? (
                <Empty text="Aktuell keine Vorteile freigeschaltet." />
              ) : (
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
              )}
            </Section>

            <Section title="Vereinsdokumente" icon={FileText} more={{ to: "/members/documents", label: "Alle Dokumente" }}>
              {docs.length === 0 ? (
                <Empty text="Vorstandsdokumente, Protokolle und Downloads werden hier zentral abgelegt." />
              ) : (
                <div className="space-y-2">
                  {docs.slice(0, 4).map((d) => (
                    <div key={d.id} className="flex items-center gap-3 p-3 border border-white/10 rounded-sm hover:border-white/25 transition">
                      <FileText className="w-4 h-4 text-[#FFD700] shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="font-bold text-sm text-white truncate">{d.title}</div>
                        <div className="text-[10px] text-white/40 uppercase tracking-wider">{d.original_filename}</div>
                      </div>
                      <a href={`${API}/documents/${d.id}/download`} target="_blank" rel="noreferrer" download className="text-xs text-[#FFD700] font-bold uppercase tracking-wider hover:underline">↓</a>
                    </div>
                  ))}
                </div>
              )}
            </Section>
          </div>

          <div className="space-y-6">
            <Section title="Interne News" icon={Bell} more={internalNews.length ? { to: "/members/news", label: "Alle" } : null}>
              {internalNews.length === 0 ? <Empty text="Keine internen News." /> : (
                <div className="space-y-3">
                  {internalNews.map((n) => (
                    <Link key={n.id} to={`/news/${n.slug}`} className="block border-l-2 border-[#FFD700]/50 pl-3 hover:border-[#FFD700] transition">
                      <div className="text-[10px] uppercase tracking-widest text-white/40">{new Date(n.created_at).toLocaleDateString("de-DE")}</div>
                      <div className="font-bold text-white mt-0.5">{n.title}</div>
                    </Link>
                  ))}
                </div>
              )}
            </Section>
            <Section title="Interne Events" icon={Calendar}>
              <Empty text="Keine internen Events geplant." />
            </Section>
          </div>
        </div>
      </section>
    </PublicLayout>
  );
}

function Tile({ to, icon: Icon, title, subtitle, testId }) {
  return (
    <Link to={to} data-testid={testId} className="group border border-[#FFD700]/30 hover:border-[#FFD700]/70 rounded-sm bg-[#121212] p-5 transition flex flex-col">
      <div className="flex items-center justify-between">
        <Icon className="w-5 h-5 text-[#FFD700]" />
        <ArrowRight className="w-4 h-4 text-white/30 group-hover:text-[#FFD700] group-hover:translate-x-0.5 transition" />
      </div>
      <div className="mt-3 font-heading font-black uppercase">{title}</div>
      <div className="mt-1 text-[11px] uppercase tracking-widest text-white/40">{subtitle}</div>
    </Link>
  );
}

function Section({ title, icon: Icon, more, children }) {
  return (
    <div className="border border-white/10 rounded-sm bg-[#121212] p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-heading text-lg font-black uppercase flex items-center gap-2"><Icon className="w-4 h-4 text-[#FFD700]" /> {title}</h2>
        {more && <Link to={more.to} className="text-[10px] uppercase tracking-widest font-bold text-[#FFD700] hover:underline">{more.label} →</Link>}
      </div>
      {children}
    </div>
  );
}

function Empty({ text }) {
  return <div className="text-sm text-white/40 py-2">{text}</div>;
}
