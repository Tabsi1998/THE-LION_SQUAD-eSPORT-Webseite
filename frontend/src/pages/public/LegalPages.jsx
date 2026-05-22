import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { Breadcrumbs } from "@/components/tls/Breadcrumbs";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";

const UPDATED_AT = "18.05.2026";

function useBranding() {
  const [branding, setBranding] = useState({});
  const load = useCallback(() => {
    api.get("/settings/public").then(({ data }) => setBranding(data || {})).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);
  useApiInvalidation(load, ["settings", "branding"]);
  return branding;
}

function valueOrOpen(value) {
  return value && String(value).trim() ? value : "Noch im Adminbereich zu hinterlegen";
}

function addressLines(branding) {
  return [
    branding.street_address,
    branding.address_extra,
    [branding.postal_code, branding.city].filter(Boolean).join(" "),
    [branding.state, branding.country].filter(Boolean).join(", "),
  ].filter(Boolean);
}

function LegalArticle({ title, intro, children }) {
  useDocumentTitle(title, intro, { robots: "noindex, follow" });

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
    <dl className="grid sm:grid-cols-[210px_1fr] gap-x-5 gap-y-2">
      {items.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-white/45">{label}</dt>
          <dd className="text-white break-words">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function TextBlock({ children }) {
  if (!children) return null;
  return (
    <div className="rounded-sm border border-white/10 bg-[#121212] p-4 whitespace-pre-line text-white/80">
      {children}
    </div>
  );
}

export function ImprintPage() {
  const branding = useBranding();
  const clubName = branding.club_name || "THE LION SQUAD";
  const legalName = branding.legal_name || clubName;
  const domain = branding.domain || "https://lionsquad.at";
  const contactEmail = branding.contact_email || "office@lionsquad.at";
  const privacyEmail = branding.privacy_contact_email || contactEmail;
  const lines = addressLines(branding);

  return (
    <LegalArticle
      title="Impressum"
      intro="Anbieterkennzeichnung, Offenlegung und Kontaktinformationen des Vereins."
    >
      <Section title="Medieninhaber und Betreiber">
        <InfoList
          items={[
            ["Verein", legalName],
            ["Rechtsform", branding.legal_form || "eingetragener Verein nach österreichischem Vereinsrecht"],
            ["ZVR-Zahl", valueOrOpen(branding.zvr_number)],
            ["Vereinssitz", branding.registered_seat || branding.city || "Tirol, Österreich"],
            ["Adresse", lines.length ? lines.map((line) => <div key={line}>{line}</div>) : valueOrOpen("")],
            ["Website", <a href={domain} className="text-[#29B6E8] hover:underline">{domain}</a>],
            ["E-Mail", <a href={`mailto:${contactEmail}`} className="text-[#29B6E8] hover:underline">{contactEmail}</a>],
            ["Telefon", valueOrOpen(branding.phone)],
          ]}
        />
      </Section>

      <Section title="Vertretung und Verantwortung">
        <InfoList
          items={[
            ["Vertretungsbefugt", valueOrOpen(branding.representative_name)],
            ["Funktion", branding.representative_role || "Obmann/Obfrau bzw. vertretungsbefugtes Vereinsorgan"],
            ["Inhaltlich verantwortlich", valueOrOpen(branding.content_responsible || branding.representative_name)],
            ["Vereinsbehoerde", branding.register_authority || "Vereinsbehoerde am Vereinssitz in Tirol"],
          ]}
        />
      </Section>

      <Section title="Grundlegende Richtung">
        <p>
          Diese Website ist das offizielle Informations- und Serviceangebot von {legalName}. Sie
          informiert über den Verein, Mitgliedschaft, Vorstand, Veranstaltungen, Community,
          eSports-Turniere, Fast-Lap-Challenges, Ranglisten, News, Sponsoren und Kontaktmöglichkeiten.
        </p>
        <p>
          Der Vereinssitz liegt in Tirol. Die Vereinstätigkeit ist nicht auf Gewinn gerichtet,
          soweit sich aus den Statuten nichts anderes ergibt.
        </p>
      </Section>

      <Section title="Turniere, Startgeld und Preise">
        <p>
          Auf der Plattform können auch Turniere oder Veranstaltungen mit Startgeld, Sachpreisen
          oder sonstigen Gewinnen angekündigt werden. Die konkreten Teilnahmebedingungen,
          Altersgrenzen, Regeln, Kosten, Zahlungsmodalitäten, Fristen und Preisbedingungen ergeben
          sich jeweils aus der Turnier- oder Eventbeschreibung und den dort verlinkten Regeln.
        </p>
        {branding.paid_tournaments_enabled ? (
          <p>
            Bezahlte Turniere können stattfinden. Die Website stellt dafür organisatorische
            Informationen bereit; die jeweilige Ausschreibung ist für Details maßgeblich.
          </p>
        ) : (
          <p>
            Sofern kein Startgeld ausgewiesen ist, ist die Teilnahme kostenlos. Bezahlte Formate
            werden gesondert und transparent in der jeweiligen Ausschreibung gekennzeichnet.
          </p>
        )}
        {branding.tournament_terms_url && (
          <p>
            Aktuelle Teilnahmebedingungen:{" "}
            <a href={branding.tournament_terms_url} className="text-[#29B6E8] hover:underline">
              {branding.tournament_terms_url}
            </a>
          </p>
        )}
      </Section>

      <Section title="UID und wirtschaftliche Angaben">
        <InfoList
          items={[
            ["UID-Nummer", branding.vat_number || "Nicht hinterlegt bzw. nicht anwendbar"],
          ]}
        />
      </Section>

      <Section title="Haftung und externe Links">
        <p>
          Die Inhalte dieser Website werden mit Sorgfalt erstellt und gepflegt. Für Aktualität,
          Richtigkeit und Vollständigkeit wird, soweit gesetzlich zulässig, keine Gewähr
          übernommen. Inhalte können sich kurzfristig ändern, insbesondere bei Turnieren,
          Events, Ranglisten und organisatorischen Hinweisen.
        </p>
        <p>
          Diese Website kann Links zu externen Angeboten enthalten. Für externe Inhalte sind
          ausschließlich deren Betreiber verantwortlich. Bei Bekanntwerden rechtswidriger Inhalte
          werden entsprechende Links entfernt.
        </p>
      </Section>

      <Section title="Urheberrecht">
        <p>
          Texte, Bilder, Grafiken, Logos, Videos, Turnierdaten und sonstige Inhalte dieser Website
          unterliegen, soweit nicht anders angegeben, dem Urheberrecht bzw. den Nutzungsrechten des
          Vereins oder der jeweiligen Rechteinhaber. Eine Verwendung außerhalb der gesetzlich
          erlaubten Fälle bedarf der vorherigen Zustimmung.
        </p>
      </Section>

      <Section title="Datenschutzkontakt">
        <p>
          Datenschutzanfragen können an{" "}
          <a href={`mailto:${privacyEmail}`} className="text-[#29B6E8] hover:underline">{privacyEmail}</a>{" "}
          gerichtet werden. Weitere Informationen stehen in der{" "}
          <Link to="/privacy" className="text-[#29B6E8] hover:underline">Datenschutzerklärung</Link>.
        </p>
      </Section>

      {(branding.imprint || branding.legal_extra) && (
        <Section title="Ergänzende Angaben">
          <TextBlock>{[branding.imprint, branding.legal_extra].filter(Boolean).join("\n\n")}</TextBlock>
        </Section>
      )}
    </LegalArticle>
  );
}

export function PrivacyPage() {
  const branding = useBranding();
  const clubName = branding.legal_name || branding.club_name || "THE LION SQUAD";
  const domain = branding.domain || "https://lionsquad.at";
  const contactEmail = branding.contact_email || "office@lionsquad.at";
  const privacyEmail = branding.privacy_contact_email || contactEmail;
  const lines = addressLines(branding);

  return (
    <LegalArticle
      title="Datenschutzerklärung"
      intro="Informationen zur Verarbeitung personenbezogener Daten auf dieser Vereinsplattform."
    >
      <Section title="Verantwortlicher">
        <InfoList
          items={[
            ["Verantwortlicher", clubName],
            ["Adresse", lines.length ? lines.map((line) => <div key={line}>{line}</div>) : valueOrOpen("")],
            ["Website", <a href={domain} className="text-[#29B6E8] hover:underline">{domain}</a>],
            ["Kontakt", <a href={`mailto:${contactEmail}`} className="text-[#29B6E8] hover:underline">{contactEmail}</a>],
            ["Datenschutz", <a href={`mailto:${privacyEmail}`} className="text-[#29B6E8] hover:underline">{privacyEmail}</a>],
          ]}
        />
      </Section>

      <Section title="Grundsätze und Rechtsgrundlagen">
        <p>
          Wir verarbeiten personenbezogene Daten ausschließlich auf Grundlage der DSGVO, des
          österreichischen Datenschutzgesetzes und sonstiger anwendbarer Vorschriften. Maßgebliche
          Rechtsgrundlagen sind insbesondere Art. 6 Abs. 1 lit. b DSGVO für Vertrag,
          Mitgliedschaft und vorvertragliche Maßnahmen, Art. 6 Abs. 1 lit. c DSGVO für rechtliche
          Pflichten, Art. 6 Abs. 1 lit. f DSGVO für berechtigte Interessen sowie Art. 6 Abs. 1
          lit. a DSGVO für Einwilligungen.
        </p>
        <p>
          Berechtigte Interessen sind insbesondere sicherer Websitebetrieb, Missbrauchsschutz,
          Vereinsorganisation, nachvollziehbare Turnierverwaltung, Kommunikation und technische
          Fehleranalyse.
        </p>
      </Section>

      <Section title="Kategorien personenbezogener Daten">
        <ul className="list-disc pl-5 space-y-1">
          <li>Accountdaten: Benutzername, Anzeigename, E-Mail-Adresse, Passwort-Hash, Rollen, Login-Status.</li>
          <li>Profildaten: Avatar, Banner, Bio, Geburtsdatum, Ort, Land, Social- und Gaming-Handles.</li>
          <li>Mitgliedschaftsdaten: Antrag, Status, Mitgliedsnummer, Eintrittsdatum, Funktion, Verlauf.</li>
          <li>Turnier- und Eventdaten: Anmeldungen, Check-ins, Teams, Spiele, Ergebnisse, F1-Zeiten, Preise, Strafen.</li>
          <li>Zahlungs- und Nachweisdaten, sofern bei kostenpflichtigen Turnieren oder Mitgliedschaft erforderlich.</li>
          <li>Kommunikationsdaten: Kontaktformular, E-Mails, Systemnachrichten, Discord-Benachrichtigungen.</li>
          <li>Technische Daten: IP-Adresse, Zeitpunkte, Browser-/Request-Daten, Sicherheits- und Fehlerlogs.</li>
          <li>Uploads: Bilder, Dokumente und Nachweise, soweit Nutzer oder Admins sie bereitstellen.</li>
        </ul>
      </Section>

      <Section title="Zwecke der Verarbeitung">
        <ul className="list-disc pl-5 space-y-1">
          <li>Bereitstellung, Absicherung und Wartung der Website und API.</li>
          <li>Registrierung, Login, Rollen- und Rechteverwaltung.</li>
          <li>Organisation von Verein, Mitgliedschaft, Vorstand, Dokumenten und Mitgliederbereich.</li>
          <li>Organisation von Turnieren, Challenges, Teams, Events, Preisen und Ranglisten.</li>
          <li>Bearbeitung von Kontaktanfragen, Mitgliedsanträgen und Supportfällen.</li>
          <li>Versand von Systemmails, Passwort-Reset, Turnier- und Vereinsbenachrichtigungen.</li>
          <li>Erfüllung gesetzlicher Aufbewahrungs-, Nachweis- und Sicherheitsverpflichtungen.</li>
        </ul>
      </Section>

      <Section title="Öffentliche Profile, Ranglisten und Achievements">
        <p>
          Nutzerprofile, Ranglisten, Turnierergebnisse und Achievements können öffentlich sichtbar
          sein, soweit dies für Community- und Wettbewerbsfunktionen vorgesehen ist. Nutzer können
          die Sichtbarkeit ihres öffentlichen Profils im Profilbereich einschränken. Negative oder
          geheime Fun-/Negative-Achievements werden erst nach Freischaltung im Profil angezeigt.
        </p>
        <p>
          Öffentliche Community-Profile registrierter Benutzer werden nicht in die Sitemap aufgenommen
          und mit einem technischen Noindex-Hinweis für Suchmaschinen versehen. Sichtbar bleiben sie
          nur, wenn die Profilfreigabe aktiv ist. Offizielle Vereinsmitglieder-Profile werden separat
          gepflegt und können als Teil der Vereinsdarstellung öffentlich auffindbar sein.
        </p>
      </Section>

      <Section title="Suchmaschinen und Crawler">
        <p>
          Öffentliche Vereinsseiten, News, Events, Turniere, Fast-Lap-Challenges, Galerie, Teams,
          Sponsoren, Partner und offizielle Vereinsmitglieder können von Suchmaschinen erfasst
          werden. Interne Bereiche, Accounts, private Mitgliederbereiche, Dokumente sowie rechtliche
          Pflichtseiten werden nicht aktiv zur Indexierung eingereicht bzw. mit Noindex oder
          Zugriffsbeschränkungen versehen.
        </p>
      </Section>

      <Section title="Mitgliederdokumente">
        <p>
          Dokumente im Mitgliederbereich sind nicht öffentlich. Sie sind nur für berechtigte
          Vorstands-/Adminrollen und aktive Vereinsmitglieder vorgesehen. Standardmäßig werden
          Dokumente inline zur Ansicht bereitgestellt; ein Download wird nur angeboten, wenn dies
          für das jeweilige Dokument freigegeben ist.
        </p>
      </Section>

      <Section title="Kontaktformular und Mitgliedsantrag">
        <p>
          Angaben aus Formularen werden zur Bearbeitung der Anfrage, zur Kommunikation und zur
          Dokumentation verarbeitet. Bei Mitgliedsanträgen werden die Daten zusätzlich zur Prüfung,
          Aufnahme und Verwaltung der Mitgliedschaft genutzt.
        </p>
      </Section>

      <Section title="E-Mail, SMTP und Discord">
        <p>
          Für Systemmails, Passwort-Reset, Mitgliedschaftsinformationen, Kontaktantworten und
          Benachrichtigungen können eigene SMTP-Server oder E-Mail-Dienstleister eingesetzt werden.
          Dabei werden Empfängeradresse, Betreff, Inhalt, Versandstatus und technische Versanddaten
          verarbeitet.
        </p>
        <p>
          Wenn Discord-Webhooks aktiviert sind, können Ereignisse wie Turniere, Spiele,
          Achievements oder Tests in einen konfigurierten Discord-Kanal übermittelt werden.
        </p>
      </Section>

      <Section title="Hosting, Logs und Backups">
        <p>
          Die Plattform verarbeitet Daten auf den eingesetzten Servern, Datenbanken und
          Backup-Speichern. Technische Logs dienen Sicherheit, Fehleranalyse und Betrieb.
        </p>
        <InfoList
          items={[
            ["Hosting / Betrieb", branding.hosting_provider || "Vom Verein bzw. beauftragten Dienstleistern betrieben"],
            ["Hosting-Region", branding.hosting_country || "Österreich/EU"],
          ]}
        />
      </Section>

      <Section title="Cookies und lokale Speicherung">
        <p>
          Die Plattform verwendet technisch notwendige Cookies und lokale Speichermechanismen für
          Login, Session, Refresh-Token, CSRF-Schutz und grundlegende Bedienfunktionen. Ohne diese
          Funktionen sind geschützte Bereiche nicht nutzbar. Tracking- oder Marketing-Cookies sind
          für den Betrieb dieser Plattform nicht erforderlich.
        </p>
        <p>
          Statistikdienste wie Google Analytics oder Plausible werden nur verwendet, wenn sie im
          Adminbereich aktiviert und von Besuchern im Cookie-/Consent-Dialog erlaubt wurden.
        </p>
      </Section>

      <Section title="Empfänger und Auftragsverarbeiter">
        <p>
          Daten können an technische Dienstleister weitergegeben werden, soweit dies für Hosting,
          Datenbankbetrieb, E-Mail-Versand, Backups, Sicherheit, Wartung oder Support erforderlich
          ist. Eine Weitergabe erfolgt nur im erforderlichen Umfang.
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
          Vereins-, Zahlungs- und Nachweisdaten können länger gespeichert werden, soweit berechtigte
          Interessen, Dokumentationspflichten oder gesetzliche Aufbewahrungspflichten bestehen.
          Technische Logs werden regelmäßig begrenzt aufbewahrt.
        </p>
      </Section>

      <Section title="Sicherheit">
        <p>
          Passwörter werden nicht im Klartext gespeichert, sondern gehasht. Zugriffe auf geschützte
          Bereiche erfolgen rollenbasiert. Zusätzlich kommen Schutzmaßnahmen wie CSRF-Schutz,
          Zugriffsbeschränkungen, private Dokumentansichten, optional freigegebene Downloads,
          SMTP-Diagnose und Audit-Logs zum Einsatz.
        </p>
      </Section>

      <Section title="Betroffenenrechte">
        <p>
          Betroffene Personen haben nach Maßgabe der DSGVO Rechte auf Information, Auskunft,
          Berichtigung, Löschung, Einschränkung, Datenübertragbarkeit, Widerspruch sowie Widerruf
          erteilter Einwilligungen. Zur Ausübung genügt eine Nachricht an{" "}
          <a href={`mailto:${privacyEmail}`} className="text-[#29B6E8] hover:underline">{privacyEmail}</a>.
        </p>
        <p>
          Außerdem besteht das Recht auf Beschwerde bei der Österreichischen Datenschutzbehörde,
          Barichgasse 40-42, 1030 Wien,{" "}
          <a href="https://www.dsb.gv.at/" target="_blank" rel="noreferrer" className="text-[#29B6E8] hover:underline">www.dsb.gv.at</a>.
        </p>
      </Section>

      {(branding.privacy_policy || branding.privacy_extra) && (
        <Section title="Ergänzende Datenschutzhinweise">
          <TextBlock>{[branding.privacy_policy, branding.privacy_extra].filter(Boolean).join("\n\n")}</TextBlock>
        </Section>
      )}

      <Section title="Änderungen">
        <p>
          Diese Datenschutzerklärung kann angepasst werden, wenn sich Funktionen, Dienstleister,
          Turnierformate oder rechtliche Anforderungen ändern. Die jeweils aktuelle Fassung ist auf
          dieser Seite abrufbar.
        </p>
      </Section>
    </LegalArticle>
  );
}
