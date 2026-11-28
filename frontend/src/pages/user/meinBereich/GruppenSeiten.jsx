import { Suspense } from "react";
import { Link, useOutletContext, useSearchParams } from "react-router-dom";
import { Crown, Download, ShieldCheck, Trash2 } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { lazyPage } from "@/lib/chunkReload";
import { formatWhen } from "@/lib/datetime";
import { SkeletonList } from "@/components/tls/Skeleton";
import { BEREICH, VEREIN_SEITEN, gruppe, vereinPfad } from "@/lib/meinBereich";
import { RECHNUNGEN_REITER } from "@/lib/meinBereichSeiten";
import { DatenHerunterladen, KontoLoeschen } from "../PrivacyAccountPage";
import { BereichReiter, BereichSeite } from "./BereichSeite";

// Jede Seite bleibt ein eigener Teil, der erst beim Öffnen lädt - wie vorher unter ihren alten Adressen.
const ProfilePage = lazyPage(() => import("../ProfilePage"));
const MyMembershipPage = lazyPage(() => import("../MyMembershipPage"));
const ConsentsCard = lazyPage(() => import("../MyMembershipPage").then((m) => ({ default: m.ConsentsCard })));
const MyInvoicesPage = lazyPage(() => import("../MyInvoicesPage"));
const AccountDocumentsPage = lazyPage(() => import("../AccountDocumentsPage"));
const MyPrizesPage = lazyPage(() => import("../MyPrizesPage"));
const MyPenaltiesPage = lazyPage(() => import("../MyPenaltiesPage"));
const MemberAreaPage = lazyPage(() => import("../MemberAreaPage"));
const MemberMeetingsPage = lazyPage(() => import("../MemberMeetingsPage"));
const MemberHelperShiftsPage = lazyPage(() => import("../MemberHelperShiftsPage"));
const MemberDocumentsPage = lazyPage(() => import("../MemberDocumentsPage"));
const MemberNewsPage = lazyPage(() => import("../MemberNewsPage"));
const MemberBenefitsPage = lazyPage(() => import("../MemberBenefitsPage"));

/** Lädt der Inhalt noch, steht der Rahmen der Gruppe schon - Überschrift und Reiter springen nicht. */
function Inhalt({ children }) {
  return <Suspense fallback={<SkeletonList rows={3} label="Lade" />}>{children}</Suspense>;
}

// Die Gruppen von „Mein Bereich“ (#2059) - jede eine kurze Seite aus den vorhandenen Bausteinen, kein zweites System:
// die Einstellungen (ProfilePage) für Profil, Benachrichtigungen, Konto & Sicherheit und Datenschutz, die Seiten der
// Mitgliedschaft, der Rechnungen und des Vereins wie bisher, nur im gemeinsamen Rahmen.

export function ProfilSeite() {
  return <ProfilePage group="profil" />;
}

export function BenachrichtigungenSeite() {
  return <ProfilePage group="benachrichtigungen" />;
}

export function KontoSeite() {
  return <ProfilePage group="konto" />;
}

/** Datenschutz → Einwilligungen: die Bedingungen der Website für alle, die des Vereins für Mitglieder mit Vereinsakte. */
function Einwilligungen() {
  const { user } = useAuth();
  const { mitglied } = useOutletContext() || {};
  const since = user?.consent_updated_at ? formatWhen(user.consent_updated_at, { time: false, relative: false }) : "";
  return (
    <>
      <div className="border border-white/10 rounded-sm bg-[#121212] p-5" data-testid="consents-site">
        <h2 className="tls-type-section inline-flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-[#29B6E8]" aria-hidden="true" /> Website</h2>
        <p className="mt-2 tls-type-body text-white/70">
          Du hast der Datenschutzerklärung{user?.privacy_policy_version ? ` (Fassung ${user.privacy_policy_version})` : ""} und den Nutzungsbedingungen{user?.terms_version ? ` (Fassung ${user.terms_version})` : ""} zugestimmt{since ? ` – zuletzt am ${since}` : ""}.
          Ändert sich eine davon, fragt dich die Website beim nächsten Besuch.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Link to="/privacy" className="tls-btn tls-btn--quiet inline-flex min-h-11 items-center px-4 py-2 rounded-sm tls-type-label">Datenschutzerklärung lesen</Link>
          <Link to="/terms" className="tls-btn tls-btn--quiet inline-flex min-h-11 items-center px-4 py-2 rounded-sm tls-type-label">Nutzungsbedingungen lesen</Link>
        </div>
        <p className="mt-3 tls-type-small text-white/45">Newsletter und Mails stellst du unter <Link to={`${BEREICH}/benachrichtigungen`} className="text-[#29B6E8] hover:underline">Benachrichtigungen</Link> ein.</p>
      </div>
      {/* Die Einwilligungen aus der Mitgliederverwaltung (#329) - nur mit bestätigter Zuordnung, sonst zeigt die Karte nichts. */}
      {mitglied ? <Inhalt><ConsentsCard /></Inhalt> : null}
    </>
  );
}

// Reiter ohne Formular unter Datenschutz - außerhalb des Formulars, das Speichern der Sichtbarkeit läuft trotzdem weiter.
const DATENSCHUTZ_EXTRA = [
  { k: "einwilligungen", label: "Einwilligungen", icon: ShieldCheck, render: () => <Einwilligungen /> },
  { k: "daten", label: "Daten herunterladen", icon: Download, render: () => <DatenHerunterladen /> },
  { k: "loeschung", label: "Konto löschen", icon: Trash2, render: () => <KontoLoeschen /> },
];

export function DatenschutzSeite() {
  return <ProfilePage group="datenschutz" extraTabs={DATENSCHUTZ_EXTRA} />;
}

/** Mitgliedschaft: für Mitglieder die eigene Mitgliedschaft, sonst der Weg hinein. */
export function MitgliedschaftSeite() {
  const { mitglied } = useOutletContext() || {};
  const meta = gruppe("mitgliedschaft");
  return (
    <BereichSeite title={meta.label} intro={mitglied ? "Status, Ausweis, Beitrag, Wunschnummer und deine Daten beim Verein." : "Du bist noch kein Vereinsmitglied."} testId="mein-bereich-mitgliedschaft">
      {mitglied ? <Inhalt><MyMembershipPage /></Inhalt> : (
        <div className="border border-honor/30 bg-honor/[0.04] rounded-sm p-6" data-testid="membership-join">
          <Crown className="w-6 h-6 text-honor" aria-hidden="true" />
          <h2 className="mt-3 tls-type-section">Mitglied werden</h2>
          <p className="mt-2 max-w-xl tls-type-body text-white/70">Als Mitglied bekommst du deinen Ausweis, wählst deine Nummer und bist bei Versammlungen, Helferdiensten und internen Events dabei.</p>
          <Link to="/membership/join" data-testid="membership-join-cta" className="tls-btn tls-btn--honor mt-4 inline-flex min-h-11 items-center px-5 py-2.5 rounded-sm tls-type-label">Antrag stellen</Link>
          <p className="mt-3 tls-type-small text-white/45">Schon Mitglied, aber hier steht nichts? Melde dich beim Vorstand – er verbindet dein Konto mit deinem Eintrag.</p>
        </div>
      )}
    </BereichSeite>
  );
}

const RECHNUNGEN_SEITEN = {
  rechnungen: MyInvoicesPage,
  unterlagen: AccountDocumentsPage,
  gewinne: MyPrizesPage,
  strafen: MyPenaltiesPage,
};

/** Rechnungen & Unterlagen: vier Reiter, jeder eine der bisherigen Seiten. `?invoice=d-…` öffnet den Beleg wie bisher. */
export function RechnungenSeite() {
  const [params, setParams] = useSearchParams();
  const meta = gruppe("rechnungen");
  const wanted = params.get("tab") || "";
  const tab = RECHNUNGEN_SEITEN[wanted] ? wanted : "rechnungen";
  const label = RECHNUNGEN_REITER.find((item) => item.k === tab)?.label;
  const select = (next) => {
    const query = new URLSearchParams(params);
    if (next === "rechnungen") query.delete("tab");
    else query.set("tab", next);
    query.delete("invoice");
    setParams(query);
  };
  const Seite = RECHNUNGEN_SEITEN[tab];
  return (
    <BereichSeite
      title={meta.label}
      docTitle={label}
      intro="Deine Belege, persönlichen Unterlagen, Gewinne und Strafen – nur für dich."
      tabKey={tab}
      reiter={<BereichReiter items={RECHNUNGEN_REITER} active={tab} onSelect={select} label={meta.label} />}
      testId="mein-bereich-rechnungen"
    >
      <Inhalt><Seite /></Inhalt>
    </BereichSeite>
  );
}

/** Verein: die Übersicht wie im bisherigen Mitgliederbereich - nächste Versammlung, Helfen, News, Dokumente, Vorteile. */
export function VereinSeite() {
  const meta = gruppe("verein");
  return (
    <BereichSeite title={meta.label} intro="Versammlungen, Helferdienste, interne News, Dokumente und Vorteile." testId="mein-bereich-verein">
      <Inhalt><MemberAreaPage /></Inhalt>
    </BereichSeite>
  );
}

const VEREIN_KOMPONENTEN = {
  versammlungen: MemberMeetingsPage,
  helfen: MemberHelperShiftsPage,
  dokumente: MemberDocumentsPage,
  news: MemberNewsPage,
  vorteile: MemberBenefitsPage,
};

/** Eine Seite unter Verein (früher /members/<seite>) - mit dem Weg zurück zur Übersicht des Vereins. */
export function VereinUnterseite({ seite }) {
  const meta = VEREIN_SEITEN.find((item) => item.k === seite);
  const Seite = VEREIN_KOMPONENTEN[seite];
  return (
    <BereichSeite title={meta.heading || meta.label} docTitle={meta.label} back={{ to: vereinPfad(), label: "Verein", testId: "mein-bereich-back-verein" }} testId={`mein-bereich-verein-${seite}`}>
      <Inhalt><Seite /></Inhalt>
    </BereichSeite>
  );
}
