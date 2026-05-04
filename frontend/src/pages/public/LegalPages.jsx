import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { Breadcrumbs } from "@/components/tls/Breadcrumbs";

const UPDATED_AT = "04.05.2026";

function useBranding() {
  const [branding, setBranding] = useState({});
  useEffect(() => {
    api.get("/settings/branding").then(({ data }) => setBranding(data || {})).catch(() => {});
  }, []);
  return branding;
}

function LegalArticle({ title, intro, children }) {
  return (
    <PublicLayout>
      <article className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <Breadcrumbs items={[{ label: title }]} />
        <p className="mt-4 text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8]">Rechtliches</p>
        <h1 className="font-heading text-4xl md:text-5xl font-black uppercase mt-2">{title}</h1>
        <p className="mt-3 text-white/60 max-w-2xl">{intro}</p>
        <p className="mt-2 text-xs text-white/40">Stand: {UPDATED_AT}</p>
        <div className="mt-10 space-y-8 text-sm leading-relaxed text-white/75">{children}</div>
      </article>
    </PublicLayout>
  );
}

function Section({ title, children }) {
  return (
    <section className="border-t border-white/10 pt-6">
      <h2 className="font-heading text-2xl font-black uppercase text-white">{title}</h2>
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  );
}

function InfoList({ items }) {
  return (
    <dl className="grid sm:grid-cols-[180px_1fr] gap-x-5 gap-y-2">
      {items.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-white/45">{label}</dt>
          <dd className="text-white">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function ImprintPage() {
  const branding = useBranding();
  const clubName = branding.club_name || "THE LION SQUAD eSports";
  const domain = branding.domain || "https://lionsquad.at";
  const imprint = branding.imprint;

  return (
    <LegalArticle
      title="Impressum"
      intro="Anbieterkennzeichnung und Kontaktinformationen des Vereins."
    >
      <Section title="Medieninhaber und Betreiber">
        <InfoList
          items={[
            ["Verein", clubName],
            ["Rechtsform", "eingetragener Verein nach österreichischem Vereinsrecht"],
            ["Sitz", "Österreich"],
            ["Website", <a href={domain} className="text-[#29B6E8] hover:underline">{domain}</a>],
            ["E-Mail", <a href="mailto:info@lionsquad.at" className="text-[#29B6E8] hover:underline">info@lionsquad.at</a>],
          ]}
        />
        {imprint && (
          <div className="mt-4 rounded-sm border border-white/10 bg-[#121212] p-4 whitespace-pre-line text-white/80">
            {imprint}
          </div>
        )}
      </Section>

      <Section title="Vertretung und Vereinsdaten">
        <p>
          Vertretungsbefugte Organe, vollständige Zustelladresse und ZVR-Zahl sind in den
          Vereinsdaten zu führen und können im Admin-Bereich unter Branding/Impressum ergänzt
          werden. Diese Angaben sind im Rechtsverkehr aktuell zu halten.
        </p>
      </Section>

      <Section title="Vereinszweck und Inhalt">
        <p>
          Diese Website informiert über Aktivitäten, Turniere, Fast-Lap-Challenges, Events,
          Community-Angebote, Mitgliedschaft und organisatorische Themen von {clubName}.
        </p>
        <p>
          Inhalte werden mit größtmöglicher Sorgfalt erstellt. Für Aktualität, Richtigkeit und
          Vollständigkeit der Informationen wird keine Gewähr übernommen, soweit gesetzlich zulässig.
        </p>
      </Section>

      <Section title="Links">
        <p>
          Diese Website kann Links zu externen Angeboten enthalten. Für Inhalte externer Websites
          sind ausschließlich deren Betreiber verantwortlich. Bei Bekanntwerden rechtswidriger
          Inhalte werden entsprechende Links entfernt.
        </p>
      </Section>

      <Section title="Urheberrecht">
        <p>
          Texte, Bilder, Grafiken, Logos, Videos und sonstige Inhalte dieser Website unterliegen,
          soweit nicht anders angegeben, dem Urheberrecht bzw. den Nutzungsrechten des Vereins oder
          der jeweiligen Rechteinhaber. Eine Verwendung außerhalb der gesetzlich erlaubten Fälle
          bedarf der vorherigen Zustimmung.
        </p>
      </Section>

      <Section title="Datenschutz">
        <p>
          Informationen zur Verarbeitung personenbezogener Daten stehen in der{" "}
          <Link to="/privacy" className="text-[#29B6E8] hover:underline">Datenschutzerklärung</Link>.
        </p>
      </Section>
    </LegalArticle>
  );
}

export function PrivacyPage() {
  const branding = useBranding();
  const clubName = branding.club_name || "THE LION SQUAD eSports";
  const domain = branding.domain || "https://lionsquad.at";

  return (
    <LegalArticle
      title="Datenschutzerklärung"
      intro="Informationen zur Verarbeitung personenbezogener Daten auf dieser Vereinsplattform."
    >
      <Section title="Verantwortlicher">
        <InfoList
          items={[
            ["Verantwortlicher", clubName],
            ["Sitz", "Österreich"],
            ["Website", <a href={domain} className="text-[#29B6E8] hover:underline">{domain}</a>],
            ["Kontakt", <a href="mailto:info@lionsquad.at" className="text-[#29B6E8] hover:underline">info@lionsquad.at</a>],
            ["Datenschutz", <a href="mailto:datenschutz@lionsquad.at" className="text-[#29B6E8] hover:underline">datenschutz@lionsquad.at</a>],
          ]}
        />
      </Section>

      <Section title="Grundsätze">
        <p>
          Wir verarbeiten personenbezogene Daten nur, soweit dies für Betrieb, Sicherheit,
          Vereinsverwaltung, Community-Funktionen, Turniere, Veranstaltungen, Kommunikation oder
          gesetzliche Pflichten erforderlich ist.
        </p>
        <p>
          Rechtsgrundlagen sind insbesondere Vertragserfüllung bzw. vorvertragliche Maßnahmen,
          berechtigte Interessen, Einwilligung und gesetzliche Verpflichtungen nach Art. 6 DSGVO.
        </p>
      </Section>

      <Section title="Kategorien personenbezogener Daten">
        <ul className="list-disc pl-5 space-y-1">
          <li>Accountdaten: Benutzername, E-Mail-Adresse, Rollen, Login-Status.</li>
          <li>Profildaten: Anzeigename, Avatar, Banner, Bio, Land/Stadt, Social- und Gaming-Handles.</li>
          <li>Mitgliedschaftsdaten: Status, Mitgliedsart, Mitgliedsnummer, Eintrittsdatum, interne Rollen, Verlauf.</li>
          <li>Turnier- und Eventdaten: Anmeldungen, Check-ins, Teams, Matches, Ergebnisse, F1-Zeiten, Strafen.</li>
          <li>Kommunikationsdaten: Kontaktformular, Mitgliedsanträge, E-Mail-Logs, Benachrichtigungen.</li>
          <li>Technische Daten: IP-Adresse, Zeitpunkte, Browser-/Request-Daten, Sicherheits- und Fehlerlogs.</li>
          <li>Uploads: Bilder, Dokumente und Nachweise, soweit Nutzer oder Admins sie bereitstellen.</li>
        </ul>
      </Section>

      <Section title="Zwecke der Verarbeitung">
        <ul className="list-disc pl-5 space-y-1">
          <li>Bereitstellung und Absicherung der Website und API.</li>
          <li>Registrierung, Login, Rollen- und Rechteverwaltung.</li>
          <li>Organisation von Turnieren, Challenges, Teams, Events und Preisen.</li>
          <li>Bearbeitung von Mitgliedsanträgen und Verwaltung der Vereinsmitgliedschaft.</li>
          <li>Anzeige öffentlicher Profile, Ranglisten, Achievements und Community-Statistiken.</li>
          <li>Bearbeitung von Kontaktanfragen und Versand von System- oder Vereins-E-Mails.</li>
          <li>Erfüllung gesetzlicher Aufbewahrungs-, Nachweis- und Sicherheitsverpflichtungen.</li>
        </ul>
      </Section>

      <Section title="Öffentliche Profile und Achievements">
        <p>
          Spielerprofile können öffentlich sichtbar sein. Nutzer können die Sichtbarkeit ihres
          öffentlichen Profils im Profilbereich einschränken. Negative oder interne Achievements
          werden nicht öffentlich angezeigt.
        </p>
      </Section>

      <Section title="Kontaktformular und Mitgliedsantrag">
        <p>
          Angaben aus Formularen werden zur Bearbeitung der Anfrage, zur Kommunikation und zur
          Dokumentation verarbeitet. Bei Mitgliedsanträgen werden die Daten zusätzlich zur Prüfung,
          Aufnahme und Verwaltung der Mitgliedschaft genutzt.
        </p>
      </Section>

      <Section title="E-Mail und Benachrichtigungen">
        <p>
          Für Systemmails, Passwort-Reset, Mitgliedschaftsinformationen, Kontaktantworten und
          Benachrichtigungen können SMTP-Server oder E-Mail-Dienstleister eingesetzt werden.
          Dabei werden Empfängeradresse, Betreff, Inhalt, Versandstatus und technische Versanddaten
          verarbeitet.
        </p>
      </Section>

      <Section title="Cookies und lokale Speicherung">
        <p>
          Die Plattform verwendet technisch notwendige Cookies für Login, Session, Refresh-Token
          und CSRF-Schutz. Ohne diese Cookies sind geschützte Bereiche nicht nutzbar. Tracking- oder
          Marketing-Cookies sind nicht erforderlich für den Betrieb dieser Plattform.
        </p>
      </Section>

      <Section title="Empfänger und Auftragsverarbeiter">
        <p>
          Daten können an technische Dienstleister weitergegeben werden, soweit dies für Hosting,
          Datenbankbetrieb, E-Mail-Versand, Backups, Sicherheit oder Wartung erforderlich ist.
          Eine Weitergabe erfolgt nur im erforderlichen Umfang.
        </p>
        <p>
          Bei extern eingebundenen Diensten wie Discord, Twitch, YouTube oder ähnlichen Plattformen
          gelten zusätzlich die Datenschutzbedingungen der jeweiligen Anbieter, sobald deren Inhalte
          geöffnet oder eingebunden werden.
        </p>
      </Section>

      <Section title="Speicherdauer">
        <p>
          Daten werden nur so lange gespeichert, wie es für die jeweiligen Zwecke erforderlich ist.
          Account- und Profildaten bestehen grundsätzlich bis zur Löschung des Accounts. Turnier-,
          Vereins- und Nachweisdaten können länger gespeichert werden, soweit berechtigte Interessen,
          Dokumentationspflichten oder gesetzliche Aufbewahrungspflichten bestehen. Technische Logs
          werden regelmäßig begrenzt aufbewahrt.
        </p>
      </Section>

      <Section title="Sicherheit">
        <p>
          Passwörter werden nicht im Klartext gespeichert, sondern gehasht. Zugriffe auf geschützte
          Bereiche erfolgen rollenbasiert. Zusätzlich kommen Schutzmaßnahmen wie CSRF-Schutz,
          Zugriffsbeschränkungen und getrennte private Dokumentdownloads zum Einsatz.
        </p>
      </Section>

      <Section title="Betroffenenrechte">
        <p>
          Betroffene Personen haben nach Maßgabe der DSGVO Rechte auf Auskunft, Berichtigung,
          Löschung, Einschränkung, Datenübertragbarkeit, Widerspruch sowie Widerruf erteilter
          Einwilligungen. Zur Ausübung genügt eine Nachricht an{" "}
          <a href="mailto:datenschutz@lionsquad.at" className="text-[#29B6E8] hover:underline">datenschutz@lionsquad.at</a>.
        </p>
        <p>
          Außerdem besteht das Recht auf Beschwerde bei der Österreichischen Datenschutzbehörde,
          Barichgasse 40-42, 1030 Wien,{" "}
          <a href="https://www.dsb.gv.at/" target="_blank" rel="noreferrer" className="text-[#29B6E8] hover:underline">www.dsb.gv.at</a>.
        </p>
      </Section>

      <Section title="Änderungen">
        <p>
          Diese Datenschutzerklärung kann angepasst werden, wenn sich Funktionen, Dienstleister oder
          rechtliche Anforderungen ändern. Die jeweils aktuelle Fassung ist auf dieser Seite abrufbar.
        </p>
      </Section>
    </LegalArticle>
  );
}
