import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "@/lib/api";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { MemberCardArt } from "@/components/tls/MemberCardArt";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { useAuth } from "@/context/AuthContext";
import { MEMBERSHIP_STEPS, StepBar } from "@/components/tls/StepBar";
import { BENEFIT_ICONS, DEFAULT_JOIN_BENEFITS, feeAmount, feesStandLine, formatMoney } from "@/lib/membershipFees";
import { Crown, Mail, Star } from "lucide-react";

// Mitglied werden (#1251, #1335): auf der Bühne die Mitgliedskarte (Muster „Dein Name“, leicht schräg; am Handy gerade),
// daneben der goldene Knopf „Antrag stellen“ - Gold steht nur dort und auf der Karte. Darunter die vier Vorteile als
// Kacheln (Texte unter Verwaltung → Bewerbungen) und der Beitrag offen: die Mitgliedsarten aus Dolibarr mit Betrag, am
// Handy als Liste, ab Tablet als kleine Tabelle; antwortet Dolibarr nicht, der letzte Stand mit Datum, ganz ohne Stand
// „Die Beiträge nennen wir dir im Antrag“. Die Schrittleiste bleibt klein über dem Weg zum Antrag.

export default function JoinMembershipPage() {
  // Wer aus dem Mitgliederbereich hierher kam, erfährt warum - statt stumm umgeleitet zu werden (#364).
  const [params] = useSearchParams();
  const fromMembers = params.get("from") === "members";
  const { user } = useAuth();
  const [fees, setFees] = useState(null);
  const [page, setPage] = useState(null);
  useDocumentTitle(
    "Mitglied werden",
    "Mitglied werden bei THE LION SQUAD: eSports Verein, Gaming Community, Mitgliederbereich, Events, Turniere und Vorteile in Tirol."
  );
  useEffect(() => {
    api.get("/membership/fees").then(({ data }) => setFees(data || { available: false })).catch(() => setFees({ available: false }));
    api.get("/membership/join-page").then(({ data }) => setPage(data || null)).catch(() => setPage(null));
  }, []);
  const benefits = page?.benefits?.length ? page.benefits : DEFAULT_JOIN_BENEFITS;

  return (
    <PublicLayout>
      <section className="relative overflow-hidden border-b border-white/10" data-testid="join-stage">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_25%,rgba(255,255,255,0.06),transparent_55%)]" />
        <div className="relative max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12 md:py-20 grid gap-8 md:grid-cols-2 md:gap-x-12 items-center">
          <div className="min-w-0">
            {fromMembers && (
              <div className="mb-6 border border-[#29B6E8]/40 bg-[#29B6E8]/10 rounded-sm p-4 text-sm text-white/80" data-testid="join-from-members">
                Der Mitgliederbereich ist Vereinsmitgliedern vorbehalten. Sobald deine Mitgliedschaft bestätigt ist, findest du ihn rechts oben im Menü.
              </div>
            )}
            <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8]">Mitglied werden</span>
            <h1 className="mt-3 font-heading text-4xl md:text-6xl font-black uppercase leading-[1.05]">Werde Teil<br />des Rudels</h1>
            <p className="mt-6 text-white/70 max-w-xl text-lg">
              THE LION SQUAD ist ein offiziell eingetragener österreichischer eSports-Verein. Eine Community, die zusammenhält — online wie offline. Werde offizielles Vereinsmitglied und sei Teil von etwas Größerem.
            </p>
          </div>
          <div className="md:row-span-2 md:col-start-2 md:row-start-1 w-full max-w-[420px] mx-auto py-2 md:py-8" data-testid="join-card">
            <MemberCardArt name="Dein Name" number="0042" since={new Date().getFullYear()} typeLabel="Ordentliches Mitglied" tilt testId="join-card-art" />
          </div>
          <div className="flex flex-col sm:flex-row gap-3 md:col-start-1">
            <Link to="/membership/apply" data-testid="join-apply-btn" className="tls-btn tls-btn--honor inline-flex justify-center items-center gap-2 px-6 py-3.5 font-bold uppercase tracking-wider rounded-sm">
              <Crown className="w-4 h-4" /> Antrag stellen
            </Link>
            <a href="#beitrag" className="tls-btn tls-btn--quiet inline-flex justify-center items-center px-6 py-3.5 font-bold uppercase tracking-wider rounded-sm text-sm">Was kostet das?</a>
          </div>
        </div>
      </section>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12 space-y-14">
        {/* Was du als Mitglied bekommst - vier Kacheln mit Symbol und je einem Satz */}
        <section data-testid="join-benefits">
          <h2 className="font-heading text-2xl md:text-3xl font-black uppercase">Was du als Mitglied bekommst</h2>
          <ul className="mt-6 grid grid-cols-2 lg:grid-cols-4 gap-3">
            {benefits.map((benefit, index) => {
              const Icon = BENEFIT_ICONS[benefit.icon] || Star;
              return (
                <li key={`${benefit.title}-${index}`} className="border border-white/10 rounded-sm bg-[#121212] p-4 flex flex-col gap-2" data-testid={`join-benefit-${index}`}>
                  <Icon className="w-5 h-5 text-white/80" aria-hidden="true" />
                  <span className="font-bold leading-tight">{benefit.title}</span>
                  {benefit.text ? <span className="text-sm text-white/60">{benefit.text}</span> : null}
                </li>
              );
            })}
          </ul>
        </section>

        <FeeSection fees={fees} purpose={fees?.purpose || page?.fee_purpose || ""} />

        <section className="border border-white/10 rounded-sm bg-[#121212] p-6 md:p-8" data-testid="join-steps-section">
          {/* Schritt-Anzeige (#1081): ohne Konto beginnt der Weg beim Konto, mit Konto beim Antrag. */}
          <StepBar steps={MEMBERSHIP_STEPS} current={user ? 1 : 0} className="mb-6 max-w-md" testId="join-steps" />
          <h2 className="font-heading text-2xl font-black uppercase">So wirst du Mitglied</h2>
          <ol className="mt-4 space-y-3 text-white/70 text-sm">
            <Step n="1" title="Konto anlegen">Registriere dich auf dieser Seite – damit bist du Community-Spieler.</Step>
            <Step n="2" title="Antrag stellen">Den Antrag füllst du online aus; dort wählst du auch deine Mitgliedsart.</Step>
            <Step n="3" title="Prüfung">Der Vorstand prüft jeden Antrag persönlich und meldet sich per E-Mail.</Step>
            <Step n="4" title="Mitglied">Nach der Aufnahme bekommst du deine Mitgliedsnummer und die Mitgliedskarte.</Step>
          </ol>
          <div className="mt-6 flex flex-col sm:flex-row flex-wrap gap-3">
            {user ? null : (
              <Link to="/register" data-testid="join-register-btn" className="tls-btn tls-btn--primary inline-flex justify-center items-center gap-2 px-5 py-3 font-bold uppercase tracking-wider rounded-sm">
                Konto erstellen
              </Link>
            )}
            <Link to="/contact?topic=membership" data-testid="join-contact-btn" className="tls-btn tls-btn--secondary inline-flex justify-center items-center gap-2 px-5 py-3 font-bold uppercase tracking-wider rounded-sm">
              <Mail className="w-4 h-4" /> Fragen? Schreib uns
            </Link>
          </div>
        </section>

        <section data-testid="join-expectations">
          <h2 className="font-heading text-2xl font-black uppercase">Was wir vom Rudel erwarten</h2>
          <ul className="mt-4 grid sm:grid-cols-2 gap-x-8 gap-y-2.5 text-sm text-white/70 max-w-4xl">
            <li>• Fairplay und Respekt gegenüber jedem im Verein</li>
            <li>• Zusammenhalt — keiner bleibt allein</li>
            <li>• Aktive Teilnahme an Events und der Community</li>
            <li>• Einhaltung der Vereinsregeln und <Link to="/board#statuten" className="text-[#29B6E8] hover:underline">Statuten</Link></li>
            <li>• Den Mitgliedsbeitrag (siehe <a href="#beitrag" className="text-[#29B6E8] hover:underline">Beitrag</a>)</li>
            <li>• Lust auf Gaming, Spaß und echten Teamgeist</li>
          </ul>
        </section>
      </div>
    </PublicLayout>
  );
}

/** Der Beitrag offen (#1251): am Handy eine Liste, ab Tablet eine kleine Tabelle; dazu der Satz, wofür das Geld ist. */
export function FeeSection({ fees, purpose = "" }) {
  const list = fees?.available ? fees.fees || [] : [];
  const stand = feesStandLine(fees);
  return (
    <section id="beitrag" className="scroll-mt-24" data-testid="join-fees">
      <h2 className="font-heading text-2xl md:text-3xl font-black uppercase">Beitrag</h2>
      {!fees ? null : list.length ? (
        <>
          <ul className="mt-5 divide-y divide-white/10 border-y border-white/10 md:hidden" data-testid="join-fees-list">
            {list.map((fee) => (
              <li key={fee.id} className="py-3">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-bold">{fee.label}</span>
                  <span className="shrink-0 font-bold tabular-nums">{feeAmount(fee)}</span>
                </div>
                {fee.description ? <div className="text-sm text-white/55">{fee.description}</div> : null}
                {fee.admission_fee ? <div className="text-xs text-white/45">einmalig {formatMoney(fee.admission_fee, fee.currency)} Aufnahmegebühr</div> : null}
                {fee.prorated ? <div className="text-xs text-white/45">Eintritt unterm Jahr anteilig</div> : null}
              </li>
            ))}
          </ul>
          <table className="mt-5 hidden md:table w-full max-w-4xl text-sm border border-white/10" data-testid="join-fees-table">
            <thead>
              <tr className="bg-[#121212] text-left text-white/60">
                <th className="px-4 py-3 font-bold">Mitgliedsart</th>
                <th className="px-4 py-3 font-bold">Beitrag</th>
                <th className="px-4 py-3 font-bold">Aufnahmegebühr</th>
                <th className="px-4 py-3 font-bold">Gut zu wissen</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {list.map((fee) => (
                <tr key={fee.id}>
                  <td className="px-4 py-3 font-bold">{fee.label}</td>
                  <td className="px-4 py-3 tabular-nums">{feeAmount(fee)}</td>
                  <td className="px-4 py-3 tabular-nums">{fee.admission_fee ? formatMoney(fee.admission_fee, fee.currency) : "–"}</td>
                  <td className="px-4 py-3 text-white/60">{[fee.description, fee.prorated ? "Eintritt unterm Jahr anteilig" : ""].filter(Boolean).join(" · ") || "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {stand ? <p className="mt-3 text-xs text-white/50" data-testid="join-fees-stand">{stand}</p> : null}
        </>
      ) : (
        <p className="mt-3 text-white/70" data-testid="join-fees-none">Die Beiträge nennen wir dir im Antrag.</p>
      )}
      {purpose ? <p className="mt-4 text-white/70 max-w-3xl" data-testid="join-fees-purpose">{purpose}</p> : null}
    </section>
  );
}

function Step({ n, title, children }) {
  return (
    <li className="flex gap-4">
      <div className="font-heading font-black text-white/80 text-xl shrink-0 w-8 tabular-nums">{n}</div>
      <div>
        <div className="font-bold text-white">{title}</div>
        <div className="text-white/60 text-sm mt-0.5">{children}</div>
      </div>
    </li>
  );
}
