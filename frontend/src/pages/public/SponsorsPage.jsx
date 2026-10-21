import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { API, api, resolveMediaUrl } from "@/lib/api";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { Reveal } from "@/components/tls/Reveal";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { SmartLogo } from "@/components/tls/SmartLogo";
import { ArrowRight, Calendar, Check, FileText, Handshake, Mail, Minus, Star } from "lucide-react";

const tierLabel = { main: "Hauptsponsor", platinum: "Platin", gold: "Gold", silver: "Silber", bronze: "Bronze" };
const tierColor = { main: "#29B6E8", platinum: "#E5E4E2", gold: "#FFD700", silver: "#C0C0C0", bronze: "#CD7F32" };
const tierGrid = {
  main: "md:grid-cols-1",
  platinum: "md:grid-cols-2",
  gold: "sm:grid-cols-2 md:grid-cols-3",
  silver: "sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5",
  bronze: "sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 2xl:grid-cols-6",
};
const tierCard = {
  main: "p-9 min-h-72 border-[#29B6E8]/25 bg-[#071114]",
  platinum: "p-8 min-h-64 border-white/15 bg-[#111111]",
  gold: "p-7 min-h-56 border-[#FFD700]/15 bg-[#101010]",
  silver: "p-5 min-h-44",
  bronze: "p-4 min-h-36",
};
const tierLogo = {
  main: "h-52 md:h-60",
  platinum: "h-44",
  gold: "h-36",
  silver: "h-28",
  bronze: "h-24",
};
// Banner aus dem Vereinsmodul (#880): im eigenen Seitenverhältnis, nur in der Höhe begrenzt - nichts wird abgeschnitten.
// Mit Banner rückt das Logo darunter kleiner zusammen.
const tierBanner = { main: "max-h-64", platinum: "max-h-48", gold: "max-h-36", silver: "max-h-28", bronze: "max-h-24" };
const tierLogoWithBanner = { main: "h-24 md:h-28", platinum: "h-20", gold: "h-16", silver: "h-14", bronze: "h-12" };

export default function SponsorsPage() {
  useDocumentTitle("Sponsoren", "Sponsoren, Hauptsponsoren und Unterstützer von THE LION SQUAD eSports, Turnieren, Events und Vereinsarbeit in Tirol.");
  const [list, setList] = useState([]);
  const [former, setFormer] = useState([]);
  // Sponsor werden (#1254): Zahlen, Leistungen je Stufe, „Unterlagen anfordern“ - ohne gepflegte Inhalte die kleine Karte.
  const [offer, setOffer] = useState(null);
  const load = useCallback(() => {
    api.get("/sponsors").then(({ data }) => setList(data)).catch(() => {});
    api.get("/sponsoring/offer").then(({ data }) => setOffer(data?.available ? data : null)).catch(() => setOffer(null));
    // Ehemalige Unterstützer (#405): abgelaufene Sponsoren mit Logo bleiben mit ihren Jahren sichtbar.
    api.get("/sponsors/former").then(({ data }) => setFormer(Array.isArray(data) ? data : [])).catch(() => setFormer([]));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useApiInvalidation(load, ["sponsors"]);

  const publicSponsors = list.filter((s) => s.logo_url);
  const grouped = publicSponsors.reduce((acc, s) => {
    const t = ["main", "platinum", "gold", "silver", "bronze"].includes(s.tier) ? s.tier : "bronze";
    (acc[t] = acc[t] || []).push(s);
    return acc;
  }, {});
  const order = ["main", "platinum", "gold", "silver", "bronze"];

  return (
    <PublicLayout>
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#FFD700]">UNSERE PARTNER</span>
        <h1 className="mt-3 font-heading text-4xl md:text-5xl font-black uppercase">Sponsoren</h1>
        <p className="mt-4 text-white/70 max-w-2xl">
          Diese Marken und Unternehmen unterstützen THE LION SQUAD — eSports. Ohne sie wären viele unserer Events, Turniere und Aktionen nicht möglich. Danke!
        </p>

        <Reveal className="tls-reveal-grid mt-8 grid md:grid-cols-3 gap-3">
          <SupportLink to="/events" icon={Calendar} label="Event-Sichtbarkeit" text="Sponsoren erscheinen dort, wo Events und Turniere stattfinden." />
          <SupportLink to="/partners" icon={Handshake} label="Partner-Netzwerk" text="Befreundete Vereine, Veranstalter und Communitys." />
          <SupportLink to={offer ? "/sponsors#sponsor-werden" : "/contact"} icon={ArrowRight} label="Sponsor werden" text="Kontakt für Kooperationen, Pakete und gemeinsame Aktionen." testId="sponsors-become-card" />
        </Reveal>

        {publicSponsors.length === 0 && (
          <div className="mt-12 border border-dashed border-white/15 rounded-sm p-12 text-center text-white/50">
            <Star className="w-10 h-10 mx-auto opacity-40 mb-4" />
            <div className="font-heading font-bold text-lg">Bald hier</div>
            <div className="text-sm mt-2">Sponsoren werden in Kürze veröffentlicht.</div>
          </div>
        )}

        <div className="mt-12 space-y-12">
          {order.map((t) => grouped[t]?.length ? (
            <div key={t}>
              <div className="flex items-center gap-3 mb-5">
                <Star className="w-4 h-4" style={{ color: tierColor[t] }} />
                <h2 className="font-heading text-xl font-black uppercase tracking-wider">{tierLabel[t] || t}</h2>
                <div className="flex-1 border-t border-white/10" />
              </div>
              <Reveal className={`tls-reveal-grid tls-dim-siblings grid gap-4 ${tierGrid[t] || tierGrid.bronze}`}>
                {grouped[t].map((s) => (
                  <a
                    key={s.id}
                    href={s.link || undefined}
                    target={s.link ? "_blank" : undefined}
                    rel="noreferrer"
                    aria-label={s.name}
                    data-testid={`sponsor-${s.id}`}
                    className={`tls-card tls-card--gold tls-reveal-item border border-white/10 rounded-sm bg-[#101010] group flex flex-col items-center justify-center gap-2 ${tierCard[t] || tierCard.bronze}`}
                  >
                    {s.banner_url ? (
                      <div className="w-full flex items-center justify-center overflow-hidden rounded-sm" data-testid={`sponsor-banner-${s.id}`}>
                        <img src={resolveMediaUrl(s.banner_url)} alt="" loading="lazy" className={`block w-full h-auto object-contain ${tierBanner[t] || tierBanner.bronze}`} />
                      </div>
                    ) : null}
                    <div className={`${(s.banner_url ? tierLogoWithBanner : tierLogo)[t] || tierLogo.bronze} w-full flex items-center justify-center overflow-hidden`}>
                      {s.logo_url ? (
                        <SmartLogo src={resolveMediaUrl(s.logo_url)} alt={s.name} className="max-w-full max-h-full w-auto h-auto" />
                      ) : (
                        <span className="sr-only">{s.name}</span>
                      )}
                    </div>
                    {s.since_year && ["main", "platinum", "gold"].includes(t) && (
                      <span className="text-[10px] uppercase tracking-widest font-bold text-white/40" data-testid={`sponsor-since-${s.id}`}>Seit {s.since_year} dabei</span>
                    )}
                  </a>
                ))}
              </Reveal>
            </div>
          ) : null)}
        </div>

        {offer ? <SponsorOffer offer={offer} /> : null}

        {former.length > 0 && (
          <div className="mt-16 border-t border-white/10 pt-10" data-testid="sponsors-former">
            <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-white/45">DANKE</span>
            <h2 className="mt-2 font-heading text-2xl font-black uppercase">Ehemalige Unterstützer</h2>
            <p className="mt-2 text-sm text-white/55 max-w-2xl">Sie haben den Verein ein Stück des Weges begleitet – ohne sie stünden wir nicht da, wo wir heute sind.</p>
            <Reveal className="tls-reveal-grid tls-dim-siblings mt-6 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
              {former.map((s) => (
                <a key={s.id} href={s.link || undefined} target={s.link ? "_blank" : undefined} rel="noreferrer" aria-label={s.name} data-testid={`sponsor-former-${s.id}`}
                  className="tls-card tls-card--gold tls-reveal-item border border-white/10 rounded-sm bg-[#0C0C0C] p-3 flex flex-col items-center gap-2">
                  <div className="h-16 w-full flex items-center justify-center overflow-hidden grayscale">
                    <SmartLogo src={resolveMediaUrl(s.logo_url)} alt={s.name} className="max-w-full max-h-full w-auto h-auto" />
                  </div>
                  <span className="text-[10px] uppercase tracking-widest font-bold text-white/40 tabular-nums">
                    {s.since_year && s.until_year && s.since_year !== s.until_year ? `${s.since_year}–${s.until_year}` : s.until_year || s.since_year || ""}
                  </span>
                </a>
              ))}
            </Reveal>
          </div>
        )}
      </section>
    </PublicLayout>
  );
}

export const OFFER_CONTACT = `/contact?topic=sponsorship&subject=${encodeURIComponent("Sponsoring: Unterlagen anfordern")}`;

/** „Sponsor werden“ (#1254): Zahlen, was jede Stufe bekommt (Handy untereinander, Tablet nebeneinander, PC als Tabelle). */
export function SponsorOffer({ offer }) {
  const tiers = (offer.tiers || []).filter((tier) => tierLabel[tier]);
  const benefits = offer.benefits || [];
  const numbers = offer.numbers || [];
  return (
    <section id="sponsor-werden" className="mt-16 border-t border-white/10 pt-10 scroll-mt-24" data-testid="sponsors-offer">
      <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8]">Für Firmen und Vereine</span>
      <h2 className="mt-2 font-heading text-3xl md:text-4xl font-black uppercase">Sponsor werden</h2>
      {offer.intro ? <p className="mt-3 text-white/70 max-w-2xl">{offer.intro}</p> : null}
      {numbers.length > 0 && (
        <dl className="mt-6 grid grid-cols-2 sm:grid-cols-4 gap-3 max-w-3xl" data-testid="sponsors-offer-numbers">
          {numbers.map((row) => (
            <div key={`${row.value}-${row.label}`} className="border border-white/10 rounded-sm bg-[#101010] p-4">
              <dt className="sr-only">{row.label}</dt>
              <dd className="font-heading text-3xl font-black tabular-nums">{row.value}</dd>
              <dd className="text-[11px] uppercase tracking-widest font-bold text-white/50">{row.label}</dd>
            </div>
          ))}
        </dl>
      )}
      {benefits.length > 0 && tiers.length > 0 && (
        <>
          <div className="mt-8 grid gap-3 md:grid-cols-3 lg:hidden" data-testid="sponsors-offer-cards">
            {tiers.map((tier) => (
              <div key={tier} className="border border-white/10 rounded-sm bg-[#101010] p-4" data-testid={`sponsors-offer-tier-${tier}`}>
                <div className="flex items-center gap-2 font-heading font-black uppercase"><Star className="w-4 h-4" style={{ color: tierColor[tier] }} /> {tierLabel[tier]}</div>
                <ul className="mt-3 space-y-2 text-sm text-white/75">
                  {benefits.filter((row) => row.tiers.includes(tier)).map((row) => (
                    <li key={row.label} className="flex gap-2"><Check className="w-4 h-4 shrink-0 text-[#29B6E8] mt-0.5" /> {row.label}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <table className="mt-8 hidden lg:table w-full max-w-4xl text-sm border border-white/10" data-testid="sponsors-offer-table">
            <thead>
              <tr className="bg-[#101010] text-left">
                <th className="px-4 py-3 font-bold text-white/60">Was ihr bekommt</th>
                {tiers.map((tier) => (
                  <th key={tier} className="px-4 py-3 text-center font-heading font-black uppercase" style={{ color: tierColor[tier] }}>{tierLabel[tier]}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {benefits.map((row) => (
                <tr key={row.label}>
                  <td className="px-4 py-3 text-white/80">{row.label}</td>
                  {tiers.map((tier) => (
                    <td key={tier} className="px-4 py-3 text-center">
                      {row.tiers.includes(tier) ? <Check className="inline w-4 h-4 text-[#29B6E8]" aria-label="ja" /> : <Minus className="inline w-4 h-4 text-white/20" aria-label="nein" />}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      <div className="mt-8 flex flex-col sm:flex-row gap-3">
        <Link to={OFFER_CONTACT} data-testid="sponsors-offer-contact" className="tls-btn tls-btn--primary inline-flex justify-center items-center gap-2 px-5 py-3 rounded-sm text-xs font-bold uppercase tracking-wider">
          <Mail className="w-4 h-4" /> Unterlagen anfordern
        </Link>
        {offer.pdf_url ? (
          <a href={`${API}${offer.pdf_url.replace(/^\/api/, "")}`} target="_blank" rel="noreferrer" data-testid="sponsors-offer-pdf" className="tls-btn tls-btn--secondary inline-flex justify-center items-center gap-2 px-5 py-3 rounded-sm text-xs font-bold uppercase tracking-wider">
            <FileText className="w-4 h-4" /> Mappe als PDF
          </a>
        ) : null}
      </div>
    </section>
  );
}

function SupportLink({ to, icon: Icon, label, text, testId }) {
  return (
    <Link to={to} data-testid={testId} className="tls-card tls-card--gold tls-reveal-item group rounded-sm border border-white/10 bg-[#101010] p-4">
      <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-[#FFD700]">
        <Icon className="h-3.5 w-3.5" /> {label}
      </div>
      <p className="mt-2 text-sm text-white/55 line-clamp-2">{text}</p>
      <span className="tls-card__title mt-3 inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-white/35">
        Öffnen <ArrowRight className="tls-card__arrow h-3 w-3" />
      </span>
    </Link>
  );
}
