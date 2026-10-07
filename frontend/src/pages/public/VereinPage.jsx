import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Calendar, ChevronRight, Crown, FileText, Gift, HandHelping, Image as ImageIcon, Medal, Newspaper, QrCode, Shield, Users, Vote } from "lucide-react";
import { api, formatMemberSince, resolveMediaUrl } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { SponsorTicker } from "@/components/tls/SponsorTicker";
import { PartnerTicker } from "@/components/tls/PartnerTicker";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { memberNews } from "@/lib/memberArea";
import { viennaDate } from "@/lib/vienna";

// /verein (#1147): das Ziel des Eintrags „Verein“ in der Handy-Leiste - derselbe Aufbau wie der Tab in der App.
// Mitglieder sehen oben kurz ihren Mitgliederbereich (mit dem Weg zu /members/area), alle anderen „Mitglied werden“ mit
// drei Gründen. Darunter für alle: neueste News, Galerie, Über uns, Referenzen, Sponsoren und Partner. Am PC bleibt das
// Menü „Verein“ mit denselben Seiten. Rechnungen stehen im Profil, interne Termine unter Events (#1150).

export const MEMBER_TILES = [
  { key: "card", to: "/members/membership#mitgliedskarte", label: "Karte", icon: QrCode },
  { key: "membership", to: "/members/membership", label: "Mitgliedschaft", icon: Crown },
  { key: "meetings", to: "/members/meetings", label: "Versammlungen", icon: Vote },
  { key: "helping", to: "/members/helfen", label: "Helfen", icon: HandHelping },
  { key: "documents", to: "/members/documents", label: "Dokumente", icon: FileText },
  { key: "benefits", to: "/members/benefits", label: "Vorteile", icon: Gift },
];

export const JOIN_REASONS = [
  { icon: QrCode, title: "Mitgliedskarte", detail: "Vorteile bei unseren Partnern" },
  { icon: Users, title: "Mitreden", detail: "Versammlungen und Abstimmungen" },
  { icon: Calendar, title: "Interne Events", detail: "Vereinsabende, Trainings" },
];

function newsDate(post) {
  const value = post.published_at || post.created_at;
  return value ? viennaDate(value, { day: "2-digit", month: "2-digit", year: "numeric" }) : "";
}

function SectionHead({ icon: Icon, title, to, label = "Alle", testId }) {
  return (
    <div className="flex items-end justify-between gap-3 mb-4 min-w-0">
      <h2 className="min-w-0 font-heading text-xl md:text-2xl font-black uppercase inline-flex items-center gap-2"><Icon className="w-5 h-5 shrink-0 text-[#29B6E8]" /> {title}</h2>
      {to ? <Link to={to} data-testid={testId} className="shrink-0 text-xs font-bold uppercase tracking-wider text-[#29B6E8] hover:underline inline-flex items-center gap-1">{label} <ArrowRight className="w-3.5 h-3.5" /></Link> : null}
    </div>
  );
}

export default function VereinPage() {
  const { user, isClubMember } = useAuth();
  const member = Boolean(user && isClubMember);
  const [news, setNews] = useState([]);
  const [albums, setAlbums] = useState([]);
  const [references, setReferences] = useState([]);
  const [membership, setMembership] = useState(null);
  const [docs, setDocs] = useState([]);
  useDocumentTitle("Verein", "Alles vom Verein an einem Ort: Mitgliederbereich oder Mitglied werden, News, Galerie, Referenzen, Sponsoren und Partner.");

  const load = useCallback(async () => {
    const [newsResult, galleryResult, referenceResult] = await Promise.allSettled([
      api.get("/news"),
      api.get("/gallery?compact=true&limit=6"),
      api.get("/references"),
    ]);
    const posts = newsResult.status === "fulfilled" ? (Array.isArray(newsResult.value.data) ? newsResult.value.data : newsResult.value.data?.items || []) : [];
    setNews(posts);
    setAlbums(galleryResult.status === "fulfilled" && Array.isArray(galleryResult.value.data) ? galleryResult.value.data.slice(0, 3) : []);
    const refData = referenceResult.status === "fulfilled" ? referenceResult.value.data : [];
    setReferences((Array.isArray(refData) ? refData : refData?.items || []).slice(0, 3));
    if (member) {
      const [my, documents] = await Promise.allSettled([api.get("/membership/me"), api.get("/documents")]);
      setMembership(my.status === "fulfilled" ? my.value.data?.membership || null : null);
      setDocs(documents.status === "fulfilled" && Array.isArray(documents.value.data) ? documents.value.data : []);
    }
  }, [member]);

  useEffect(() => { load(); }, [load]);
  useApiInvalidation(load, ["news", "gallery", "references", "membership", "documents"]);

  const internal = member ? memberNews(news, 2) : [];
  const publicNews = news.filter((post) => !internal.some((item) => item.id === post.id)).slice(0, 3);
  const sinceYear = membership?.member_since ? String(membership.member_since).slice(0, 4) : "";

  return (
    <PublicLayout>
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 md:py-12 space-y-10" data-testid="verein-page">
        <header>
          <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8]">THE LION SQUAD</span>
          <h1 className="mt-2 font-heading text-4xl md:text-6xl font-black uppercase">Verein</h1>
        </header>

        {member ? (
          <div className="border border-[#FFD700]/45 bg-[#FFD700]/[0.06] rounded-sm p-5 md:p-6" data-testid="verein-member-area">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#FFD700]">Mitgliederbereich</span>
              {sinceYear ? <span className="border border-[#FFD700]/50 rounded-sm px-2 py-0.5 text-[11px] font-bold uppercase text-[#FFD700]" data-testid="verein-member-since">Seit {sinceYear}</span> : null}
            </div>
            {membership?.member_since ? <p className="mt-2 text-sm text-white/60">Mitglied seit {formatMemberSince(membership.member_since, membership.member_since_precision || "day")}</p> : null}
            <div className="mt-4 grid grid-cols-3 md:grid-cols-6 gap-2">
              {MEMBER_TILES.map((tile) => (
                <Link key={tile.key} to={tile.to} data-testid={`verein-tile-${tile.key}`} className="relative min-h-20 flex flex-col items-center justify-center gap-2 rounded-sm border border-[#FFD700]/30 bg-[#FFD700]/[0.04] px-2 py-3 text-xs font-bold text-white/85 hover:border-[#FFD700]/70 transition">
                  <tile.icon className="w-5 h-5 text-[#FFD700]" />
                  {tile.label}
                  {tile.key === "documents" && docs.length ? <span className="absolute top-1.5 right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-[#FF3B30] text-white text-[10px] leading-[18px] text-center">{docs.length}</span> : null}
                </Link>
              ))}
            </div>
            {internal.length ? (
              <div className="mt-4 border-t border-[#FFD700]/20 pt-3 space-y-1" data-testid="verein-internal-news">
                <span className="text-[10px] font-bold uppercase tracking-[0.25em] text-[#FFD700]">Interne News</span>
                {internal.map((post) => (
                  <Link key={post.id} to={`/news/${post.slug || post.id}`} className="flex items-center gap-3 min-h-11 text-sm hover:text-[#FFD700]">
                    <Newspaper className="w-4 h-4 text-[#FFD700] shrink-0" />
                    <span className="flex-1 min-w-0 truncate font-bold">{post.title}</span>
                    <span className="text-xs text-white/45 shrink-0">{newsDate(post)}</span>
                  </Link>
                ))}
              </div>
            ) : null}
            <Link to="/members/area" data-testid="verein-member-area-link" className="mt-4 inline-flex items-center gap-1 text-xs font-bold uppercase tracking-wider text-[#FFD700] hover:underline">Zum Mitgliederbereich <ArrowRight className="w-3.5 h-3.5" /></Link>
          </div>
        ) : (
          <div className="border border-[#29B6E8]/40 bg-[#29B6E8]/[0.05] rounded-sm p-5 md:p-6 max-w-3xl" data-testid="verein-join">
            <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8]">Mitglied werden</span>
            <h2 className="mt-1 font-heading text-2xl font-black uppercase">Mehr vom Verein</h2>
            <ul className="mt-3 divide-y divide-white/10">
              {JOIN_REASONS.map((reason) => (
                <li key={reason.title} className="flex items-center gap-3 py-3">
                  <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-sm bg-[#29B6E8]/12 text-[#29B6E8]"><reason.icon className="w-4 h-4" /></span>
                  <span><span className="block font-bold">{reason.title}</span><span className="block text-sm text-white/55">{reason.detail}</span></span>
                </li>
              ))}
            </ul>
            <Link to="/membership/join" data-testid="verein-join-apply" className="tls-btn tls-btn--primary mt-3 inline-flex w-full sm:w-auto justify-center px-6 py-3 rounded-sm text-xs font-bold uppercase tracking-wider">Antrag stellen</Link>
          </div>
        )}

        <div>
          <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-white/40">Vom Verein</span>
          <div className="mt-4 grid grid-cols-1 gap-8 lg:grid-cols-2">
            <section className="min-w-0" data-testid="verein-news">
              <SectionHead icon={Newspaper} title="News" to="/news" label="Alle News" testId="verein-news-all" />
              {publicNews.length ? (
                <div className="space-y-2">
                  {publicNews.map((post) => (
                    <Link key={post.id} to={`/news/${post.slug || post.id}`} className="flex items-center gap-3 border border-white/10 bg-[#121212] rounded-sm p-3 hover:border-[#29B6E8]/45 transition">
                      <span className="min-w-0 flex-1">
                        <span className="block font-heading font-bold uppercase text-sm truncate">{post.title}</span>
                        <span className="block text-xs text-white/45">{newsDate(post)}</span>
                      </span>
                      <ChevronRight className="w-4 h-4 text-white/35 shrink-0" />
                    </Link>
                  ))}
                </div>
              ) : <p className="text-sm text-white/45">Noch keine News.</p>}
            </section>

            <section className="min-w-0" data-testid="verein-gallery">
              <SectionHead icon={ImageIcon} title="Galerie" to="/galerie" testId="verein-gallery-all" />
              {albums.length ? (
                <div className="grid grid-cols-3 gap-2">
                  {albums.map((album) => (
                    <Link key={album.id} to={`/galerie/${album.slug}`} className="aspect-video rounded-sm overflow-hidden border border-white/10 bg-[#0A0A0A] relative group" aria-label={album.title}>
                      {album.cover_url ? <img src={resolveMediaUrl(album.cover_url)} alt="" loading="lazy" className="w-full h-full object-cover group-hover:scale-105 transition" /> : <span className="flex h-full items-center justify-center"><ImageIcon className="w-6 h-6 text-white/15" /></span>}
                      <span className="absolute inset-x-0 bottom-0 bg-black/60 px-2 py-1 text-[10px] font-bold uppercase truncate">{album.title}</span>
                    </Link>
                  ))}
                </div>
              ) : <p className="text-sm text-white/45">Noch keine Alben.</p>}
            </section>

            <section className="min-w-0" data-testid="verein-about">
              <SectionHead icon={Shield} title="Über uns" to="/about" label="Mehr" testId="verein-about-more" />
              <div className="border border-white/10 bg-[#121212] rounded-sm p-4 text-sm text-white/65 space-y-2">
                <p>Wer wir sind, wofür wir stehen und wer im Vorstand für dich da ist.</p>
                <div className="flex flex-wrap gap-3 text-xs font-bold uppercase tracking-wider">
                  <Link to="/board" className="text-[#29B6E8] hover:underline">Vorstand</Link>
                  <Link to="/values" className="text-[#29B6E8] hover:underline">Werte &amp; Ziele</Link>
                  <Link to="/members" className="text-[#29B6E8] hover:underline">Vereinsmitglieder</Link>
                  <Link to="/contact" className="text-[#29B6E8] hover:underline">Kontakt</Link>
                </div>
              </div>
            </section>

            <section className="min-w-0" data-testid="verein-references">
              <SectionHead icon={Medal} title="Referenzen" to="/references" testId="verein-references-all" />
              {references.length ? (
                <div className="space-y-2">
                  {references.map((ref) => (
                    <Link key={ref.id} to={`/references/${ref.id}`} className="flex items-center gap-3 border border-white/10 bg-[#121212] rounded-sm p-3 hover:border-[#29B6E8]/45 transition">
                      <span className="min-w-0 flex-1 font-bold text-sm truncate">{ref.title || ref.name}</span>
                      <ChevronRight className="w-4 h-4 text-white/35 shrink-0" />
                    </Link>
                  ))}
                </div>
              ) : <p className="text-sm text-white/45">Referenzen des Vereins stehen hier, sobald welche eingetragen sind.</p>}
            </section>
          </div>
        </div>

        <section className="space-y-8 border-t border-white/10 pt-8" data-testid="verein-sponsors">
          <SponsorTicker compact placement="footer" heading="Sponsoren" />
          <PartnerTicker />
          <div className="flex flex-wrap gap-4 text-xs font-bold uppercase tracking-wider">
            <Link to="/sponsors" className="text-[#29B6E8] hover:underline">Alle Sponsoren</Link>
            <Link to="/partners" className="text-[#29B6E8] hover:underline">Alle Partner</Link>
          </div>
        </section>
      </section>
    </PublicLayout>
  );
}
