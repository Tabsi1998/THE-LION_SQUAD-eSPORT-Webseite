import { Link } from "react-router-dom";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { Breadcrumbs } from "@/components/tls/Breadcrumbs";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { usePublicSiteSettings } from "@/hooks/usePublicSiteSettings";
import { analyticsText, emailProviderText, hostingText, mediaScanText, normalizeFacts, privacySections } from "@/lib/privacyFacts";

function formatLegalDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("de-AT", { day: "2-digit", month: "2-digit", year: "numeric" }).format(date);
}

function addressLines(branding) {
  return [
    branding.street_address,
    branding.address_extra,
    [branding.postal_code, branding.city].filter(Boolean).join(" "),
    [branding.state, branding.country].filter(Boolean).join(", "),
  ].filter(Boolean);
}

function LegalArticle({ title, intro, updatedAt, children }) {
  useDocumentTitle(title, intro, { robots: "noindex, follow" });
  const formattedUpdatedAt = formatLegalDate(updatedAt);

  return (
    <PublicLayout>
      <article className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <Breadcrumbs items={[{ label: title }]} />
        <p className="mt-4 text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8]">Rechtliches</p>
        <h1 className="font-heading text-4xl md:text-5xl font-black uppercase mt-2">{title}</h1>
        <p className="mt-3 text-white/60 max-w-2xl">{intro}</p>
        {formattedUpdatedAt && <p className="mt-2 text-xs text-white/40">Stand: {formattedUpdatedAt}</p>}
        <div className="mt-10 space-y-8 text-sm leading-relaxed text-white/75">{children}</div>
      </article>
    </PublicLayout>
  );
}

function Section({ title, children, id }) {
  return (
    <section className="border-t border-white/10 pt-6" id={id}>
      <h2 className="font-heading text-2xl font-black uppercase text-white">{title}</h2>
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  );
}

function InfoList({ items }) {
  const configuredItems = items.filter(([, value]) => value !== null && value !== undefined && value !== "");
  if (!configuredItems.length) return null;
  return (
    <dl className="grid sm:grid-cols-[210px_1fr] gap-x-5 gap-y-2">
      {configuredItems.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-white/45">{label}</dt>
          <dd className="text-white break-words">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function LegalDataNotice({ branding }) {
  if (branding.legal_ready !== false) return null;
  return (
    <div data-testid="legal-data-incomplete" className="rounded-sm border border-amber-300/30 bg-amber-300/10 p-4 text-amber-100">
      Die rechtlichen Kontaktdaten sind derzeit nicht vollständig verfügbar. Bitte nutze bei Fragen das Kontaktformular.
    </div>
  );
}

function EmailLink({ email }) {
  if (!email) return null;
  return <a href={`mailto:${email}`} className="text-[#29B6E8] hover:underline">{email}</a>;
}

function WebsiteLink({ url }) {
  if (!url) return null;
  return <a href={url} className="text-[#29B6E8] hover:underline">{url}</a>;
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
  const branding = usePublicSiteSettings();
  const clubName = branding.club_name || "THE LION SQUAD";
  const legalName = branding.legal_name || clubName;
  const domain = branding.domain;
  const contactEmail = branding.contact_email;
  const privacyEmail = branding.privacy_contact_email || contactEmail;
  const lines = addressLines(branding);

  return (
    <LegalArticle
      title="Impressum"
      intro="Anbieterkennzeichnung, Offenlegung und Kontaktinformationen des Vereins."
      updatedAt={branding.legal_updated_at}
    >
      <LegalDataNotice branding={branding} />
      <Section title="Medieninhaber und Betreiber">
        <InfoList
          items={[
            ["Verein", legalName],
            ["Rechtsform", branding.legal_form],
            ["ZVR-Zahl", branding.zvr_number],
            ["Vereinssitz", branding.registered_seat || branding.city],
            ["Adresse", lines.length ? lines.map((line) => <div key={line}>{line}</div>) : ""],
            ["Website", domain ? <WebsiteLink url={domain} /> : ""],
            ["E-Mail", contactEmail ? <EmailLink email={contactEmail} /> : ""],
            ["Telefon", branding.phone],
          ]}
        />
      </Section>

      <Section title="Vertretung und Verantwortung">
        <InfoList
          items={[
            ["Vertretungsbefugt", branding.representative_name],
            ["Funktion", branding.representative_role],
            ["Inhaltlich verantwortlich", branding.content_responsible || branding.representative_name],
            ["Vereinsbehörde", branding.register_authority],
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
          {branding.registered_seat && <>Der Vereinssitz liegt in {branding.registered_seat}. </>}
          Die Vereinstätigkeit ist nicht auf Gewinn gerichtet, soweit sich aus den Statuten nichts anderes ergibt.
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

      {branding.vat_number && (
        <Section title="UID und wirtschaftliche Angaben">
          <InfoList items={[["UID-Nummer", branding.vat_number]]} />
        </Section>
      )}

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

      {privacyEmail && <Section title="Datenschutzkontakt">
        <p>
          Datenschutzanfragen können an{" "}
          <EmailLink email={privacyEmail} />{" "}
          gerichtet werden. Weitere Informationen stehen in der{" "}
          <Link to="/privacy" className="text-[#29B6E8] hover:underline">Datenschutzerklärung</Link>.
        </p>
      </Section>}

      {branding.legal_extra && (
        <Section title="Ergänzende Angaben">
          <TextBlock>{branding.legal_extra}</TextBlock>
        </Section>
      )}
    </LegalArticle>
  );
}

export function PrivacyPage() {
  const branding = usePublicSiteSettings();
  const clubName = branding.legal_name || branding.club_name || "THE LION SQUAD";
  const domain = branding.domain;
  const contactEmail = branding.contact_email;
  const privacyEmail = branding.privacy_contact_email || contactEmail;
  const lines = addressLines(branding);
  // Rechtliches II: die Abschnitte kommen aus den Schaltern, die wirklich an sind - keine Möglichkeitsform.
  const facts = normalizeFacts(branding.privacy_facts);
  const sections = privacySections(facts);
  const shows = (key) => sections.includes(key);
  const legalSource = branding.legal_source || {};

  return (
    <LegalArticle
      title="Datenschutzerklärung"
      intro="Informationen zur Verarbeitung personenbezogener Daten auf dieser Vereinsplattform."
      updatedAt={branding.legal_updated_at}
    >
      <LegalDataNotice branding={branding} />
      <Section title="Verantwortlicher">
        <InfoList
          items={[
            ["Verantwortlicher", clubName],
            ["Adresse", lines.length ? lines.map((line) => <div key={line}>{line}</div>) : ""],
            ["Website", domain ? <WebsiteLink url={domain} /> : ""],
            ["Kontakt", contactEmail ? <EmailLink email={contactEmail} /> : ""],
            ["Datenschutz", privacyEmail ? <EmailLink email={privacyEmail} /> : ""],
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

      <Section title="Konto und Anmeldung">
        <p data-testid="privacy-account">
          Die Anmeldung läuft mit Benutzername und Passwort (Passwörter nur als Hash gespeichert),
          auf Wunsch mit einem <strong>Passkey</strong> (WebAuthn): Der Schlüssel bleibt auf deinem
          Gerät oder in deinem Passwort-Manager, die Website speichert nur den öffentlichen Teil und
          eine Kennung – kein Dritter ist beteiligt. Die optionale Zwei-Faktor-Anmeldung nutzt eine
          Authenticator-App auf deinem Gerät.
          {facts.google_login ? (
            <span data-testid="privacy-google-login">
              {" "}Zusätzlich bieten wir <strong>„Mit Google anmelden“</strong> an (Google Ireland Ltd.).
              Dabei erhalten wir von Google nur E-Mail-Adresse, Name und eine Konto-Kennung, um dein
              Konto zuzuordnen; Google erfährt, dass du dich bei uns anmeldest. Rechtsgrundlage ist die
              Erfüllung des Nutzungsverhältnisses (Art. 6 Abs. 1 lit. b DSGVO); die Verknüpfung lässt sich
              im Profil trennen.
            </span>
          ) : (
            <span data-testid="privacy-no-google-login"> Eine Anmeldung über Google oder andere Anbieter bieten wir nicht an.</span>
          )}
        </p>
      </Section>

      <Section title="E-Mail-Versand">
        <p data-testid="privacy-email">
          Systemmails (Bestätigung, Passwort-Reset, Mitgliedschaft, Turnier- und Vereinsnachrichten)
          enthalten Empfängeradresse, Betreff und Inhalt; Versandzeitpunkt und -status werden für die
          Fehlersuche kurz protokolliert. {emailProviderText(facts.email_provider)}
        </p>
      </Section>

      {shows("discord") && (
        <Section title="Discord">
          {facts.discord.webhooks && (
            <p data-testid="privacy-discord-webhooks">
              Ereignisse des Vereins – neue Turniere, Events, News, Ergebnisse und Erfolge – werden
              automatisch in Kanäle unseres Discord-Servers gepostet (Discord Inc., USA;
              EU-Standardvertragsklauseln). Dabei gehen nur die auf der Website ohnehin öffentlichen
              Angaben mit: Anzeigenamen, Teamnamen, Ergebnisse, Bilder der Beiträge. Interne
              Vereinsinhalte werden nur in interne Kanäle gepostet.
            </p>
          )}
          {facts.discord.bot && (
            <p data-testid="privacy-discord-bot">
              Auf unserem Discord-Server läuft der Vereins-Bot. Er zählt für Mitglieder, die ihr
              Discord-Konto im Profil verknüpft haben, die <strong>Anzahl</strong> ihrer Nachrichten
              (nie den Inhalt – der Bot hat kein Recht, Nachrichten zu lesen), gleicht die Rollen
              „Mitglied“, „Vorstand“ und „Turnierleitung“ mit dem Vereinsstand ab und beantwortet
              Befehle wie „nächstes Event“. Nicht verknüpfte Konten werden ignoriert. Grundlage ist unser
              berechtigtes Interesse an einer gepflegten Community (Art. 6 Abs. 1 lit. f DSGVO); die
              Verknüpfung lässt sich jederzeit im Profil trennen.
            </p>
          )}
        </Section>
      )}

      <Section title="Verknüpfte Plattform-Konten">
        <p data-testid="privacy-platform-links">
          Wer im Profil ein Discord-, Twitch- oder Steam-Konto verknüpft, meldet sich dafür bei der
          jeweiligen Plattform an. Die Website erhält dabei nur die Kennung und den Nutzer- bzw.
          Anzeigenamen des Kontos (bei Steam die SteamID64) und speichert sie zusammen mit dem
          Zeitpunkt der Verknüpfung, um den Eintrag als verifiziert zu kennzeichnen. Keine Passwörter,
          keine Freundeslisten, keine Nachrichten. Die Verknüpfung lässt sich im Profil jederzeit
          trennen; sie ist Teil des Datenexports und wird bei der Anonymisierung gelöscht.
        </p>
      </Section>

      {shows("media_scan") && (
        <Section title="Automatische Bildprüfung">
          <p data-testid="privacy-media-scan">
            Bilder, die Nutzer hochladen (Chat-Anhänge, Profil- und Teambilder), werden automatisch auf
            Nacktheit und Gewalt geprüft, bevor oder kurz nachdem sie sichtbar werden.{" "}
            {mediaScanText(facts.media_scan.provider)} Auffällige Bilder sieht nur die Moderation des
            Vereins; entfernte Originale werden nach einer Aufbewahrungsfrist endgültig gelöscht. Grundlage
            sind unser berechtigtes Interesse an einer sicheren Community und der Jugendschutz (Art. 6 Abs. 1
            lit. f DSGVO); gegen eine Entscheidung kann man sich bei der Moderation melden.
          </p>
        </Section>
      )}

      {shows("dolibarr") && (
        <Section title="Mitgliederverwaltung">
          <p data-testid="privacy-dolibarr">
            Mitgliedschaft, Beiträge, Funktionen und Vereinsdokumente verwalten wir in unserer eigenen
            Vereinsverwaltung (Dolibarr) auf einem System des Vereins – kein Dritter. Die Website liest
            daraus nur, was sie für den Mitgliederbereich braucht (Mitgliedsstand, Beitragsstand, eigene
            Belege, freigegebene Dokumente), und nur für die angemeldete Person selbst.
            {facts.dolibarr_billing && (
              <span data-testid="privacy-dolibarr-billing">
                {" "}Für kostenpflichtige Events und Startgelder legt die Website dort Rechnungen an (Name,
                E-Mail, Vorgang, Betrag); Belege bleiben nach dem Steuerrecht sieben Jahre in der
                Buchhaltung, auch nach einer Kontolöschung.
              </span>
            )}
            {legalSource.dolibarr && (
              <span data-testid="privacy-legal-source"> Auch Vereinsname, Anschrift, ZVR und vertretungsbefugte Person im Impressum kommen aus dieser Vereinsverwaltung.</span>
            )}
          </p>
        </Section>
      )}

      <Section title="LionsAPP">
        <p data-testid="privacy-app">
          Die LionsAPP (Android) nutzt dasselbe Konto wie die Website und verarbeitet dieselben Daten.
          Zusätzlich: <strong>Push-Nachrichten</strong> laufen über Firebase Cloud Messaging (Google
          Ireland Ltd.); dafür speichern wir ein Geräte-Token, das du in den Einstellungen der App
          jederzeit abschalten kannst. <strong>Absturzberichte</strong> gehen an Firebase Crashlytics
          (Google Ireland Ltd.): Gerätemodell, Android-Version, App-Version, Zeitpunkt und die Stelle
          im Programm – keine Namen, keine Nachrichten, keine Inhalte; Löschung nach 90 Tagen; Google
          kann die Daten in den USA verarbeiten (EU-Standardvertragsklauseln, Art. 46 DSGVO);
          Grundlage ist unser berechtigtes Interesse an einer stabilen App (Art. 6 Abs. 1 lit. f
          DSGVO). Die optionale App-Sperre (Fingerabdruck, Gesicht, Gerätecode) prüft das Gerät
          selbst – biometrische Daten verlassen es nie. Das Konto lässt sich in der App löschen (siehe
          unten).
        </p>
      </Section>

      <Section title="Hosting, Logs und Backups">
        <p>
          Die Plattform verarbeitet Daten auf den eingesetzten Servern, Datenbanken und
          Backup-Speichern. Technische Logs dienen Sicherheit, Fehleranalyse und Betrieb.
          {hostingText(facts.hosting) ? ` ${hostingText(facts.hosting)}` : ""}
        </p>
        <InfoList items={[
          ["Hosting / Betrieb", branding.hosting_provider],
          ["Hosting-Region", branding.hosting_country],
        ]} />
      </Section>

      <Section title="Cookies, Statistik und lokale Speicherung">
        <p>
          Die Plattform verwendet technisch notwendige Cookies und lokale Speichermechanismen für
          Login, Session, Refresh-Token, CSRF-Schutz und grundlegende Bedienfunktionen. Ohne diese
          Funktionen sind geschützte Bereiche nicht nutzbar. Tracking- oder Marketing-Cookies sind
          für den Betrieb dieser Plattform nicht erforderlich.
        </p>
        <p data-testid="privacy-analytics">{analyticsText(facts.analytics)}</p>
      </Section>

      <Section title="Empfänger und Auftragsverarbeiter">
        <p>Daten erhalten nur die Stellen, die für den Betrieb nötig sind – und nur im nötigen Umfang. Stand heute:</p>
        <ul className="list-disc pl-5 space-y-1" data-testid="privacy-recipients">
          <li>Hosting und Datenbank: {hostingText(facts.hosting) || "eingesetzte Server und Backup-Speicher des Vereins"}</li>
          {facts.email_provider === "resend" && <li>E-Mail-Versand: Resend, Inc. (Auftragsverarbeiter)</li>}
          {facts.email_provider === "smtp" && <li>E-Mail-Versand: eigener Mailserver des Vereins</li>}
          <li>Push-Nachrichten und Absturzberichte der App: Google Ireland Ltd. (Firebase, Auftragsverarbeiter)</li>
          {facts.google_login && <li>Anmeldung mit Google: Google Ireland Ltd.</li>}
          {facts.analytics === "google" && <li>Statistik: Google Ireland Ltd. (Google Analytics, nur mit Einwilligung)</li>}
          {facts.analytics === "plausible" && <li>Statistik: Plausible Insights OÜ (ohne Cookies)</li>}
          {(facts.discord.webhooks || facts.discord.bot) && <li>Discord Inc.: Vereinsserver (Meldungen, Bot)</li>}
          {facts.twitch_embed && <li>Twitch (Amazon): eingebetteter Stream, erst nach Zustimmung zu externen Medien</li>}
          {facts.dolibarr && <li>Vereinsverwaltung Dolibarr: eigenes System des Vereins, kein Dritter</li>}
        </ul>
        <p>
          Bei extern eingebundenen Diensten wie Discord, Twitch oder YouTube gelten zusätzlich die
          Datenschutzbedingungen der jeweiligen Anbieter, sobald deren Inhalte geöffnet werden; eingebettete
          Player laden erst nach deiner Zustimmung zu externen Medien.
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

      {/* Konto löschen (#390): öffentlich lesbar, weil Google Play einen Link dorthin verlangt. */}
      <Section title="Konto löschen" id="account-deletion">
        <p>
          Du kannst dein Konto jederzeit selbst löschen – in der LionsAPP unter Profil → Einstellungen
          (Zahnrad) → „Konto löschen“, oder auf der Website nach der Anmeldung unter{" "}
          <Link to="/privacy-account" className="text-[#29B6E8] hover:underline">Datenschutz → Meine Daten → „Account anonymisieren“</Link>.
          Ein Login ist dafür nötig, damit niemand ein fremdes Konto löscht; wer sich nicht mehr
          anmelden kann, schreibt an{" "}
          {privacyEmail ? <EmailLink email={privacyEmail} /> : <Link to="/contact" className="text-[#29B6E8] hover:underline">das Kontaktformular</Link>}.
        </p>
        <p>
          Gelöscht bzw. überschrieben werden Name, E-Mail-Adresse, Profiltexte, Bilder, verknüpfte
          Konten (Discord, Twitch, Steam), Push-Geräte, Freundschaften und Anmeldedaten; eigene
          Chatnachrichten werden als „gelöscht“ markiert. Erhalten bleiben Turnier-Ergebnisse ohne
          Namen (sportliche Integrität) und – wenn du Rechnungen hattest – die Belege in der
          Vereinsbuchhaltung, weil das Steuerrecht sieben Jahre Aufbewahrung verlangt; der Auftrag
          auf der Website behält dann nur Betrag und Belegnummer. Die Löschung wirkt sofort und
          lässt sich nicht rückgängig machen.
        </p>
      </Section>

      <Section title="Betroffenenrechte">
        <p>
          Betroffene Personen haben nach Maßgabe der DSGVO Rechte auf Information, Auskunft,
          Berichtigung, Löschung, Einschränkung, Datenübertragbarkeit, Widerspruch sowie Widerruf
          erteilter Einwilligungen. Zur Ausübung nutze bitte{" "}
          {privacyEmail ? <EmailLink email={privacyEmail} /> : <Link to="/contact" className="text-[#29B6E8] hover:underline">das Kontaktformular</Link>}.
        </p>
        <p>
          Außerdem besteht das Recht auf Beschwerde bei der Österreichischen Datenschutzbehörde,
          Barichgasse 40-42, 1030 Wien,{" "}
          <a href="https://www.dsb.gv.at/" target="_blank" rel="noreferrer" className="text-[#29B6E8] hover:underline">www.dsb.gv.at</a>.
        </p>
      </Section>

      {branding.privacy_extra && (
        <Section title="Ergänzende Datenschutzhinweise">
          <TextBlock>{branding.privacy_extra}</TextBlock>
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

export function TermsPage() {
  const branding = usePublicSiteSettings();
  const clubName = branding.legal_name || branding.club_name || "THE LION SQUAD";

  return (
    <LegalArticle
      title="Nutzungsbedingungen"
      intro={`Regeln für Accounts, Community-Funktionen und Wettbewerbe von ${clubName}.`}
      updatedAt={branding.legal_updated_at}
    >
      <Section title="Geltungsbereich">
        <p>Diese Bedingungen gelten für die Nutzung der Website, der mobilen App, von Community-Funktionen sowie für Anmeldungen zu Turnieren und Vereinsveranstaltungen.</p>
      </Section>
      <Section title="Account und Sicherheit">
        <p>Angaben müssen wahrheitsgemäß sein. Zugangsdaten dürfen nicht weitergegeben werden. Missbrauch, Umgehung von Sperren und automatisierte Angriffe sind untersagt.</p>
      </Section>
      <Section title="Community-Regeln">
        <p>Beleidigungen, Bedrohungen, Diskriminierung, Belästigung, Spam, Betrug und rechtswidrige Inhalte sind nicht erlaubt. Inhalte können gemeldet und bei Verstößen moderiert werden.</p>
      </Section>
      <Section title="Wettbewerbe">
        <p>Zusätzliche Turnierregeln, Teilnahmevoraussetzungen und Entscheidungen der Turnierleitung gelten für den jeweiligen Wettbewerb. Manipulation, Cheating und falsche Ergebnisangaben können zum Ausschluss führen.</p>
      </Section>
      <Section title="Verfügbarkeit und Haftung">
        <p>Ein unterbrechungsfreier Betrieb kann nicht garantiert werden. Gesetzlich zwingende Ansprüche bleiben unberührt. Für externe Dienste und verlinkte Inhalte gelten zusätzlich deren Bedingungen.</p>
      </Section>
      <Section title="Beendigung und Änderungen">
        <p>Accounts können selbst beendet oder bei schweren beziehungsweise wiederholten Verstößen eingeschränkt werden. Wesentliche Änderungen werden mit einer neuen Versionskennung zur erneuten Bestätigung vorgelegt.</p>
      </Section>
      {branding.terms_of_use && (
        <Section title="Ergänzende Bedingungen des Vereins">
          <TextBlock>{branding.terms_of_use}</TextBlock>
        </Section>
      )}
      <Section title="Kontakt">
        <p>Fragen zu diesen Bedingungen können über <Link to="/contact" className="text-[#29B6E8] hover:underline">das Kontaktformular</Link> gestellt werden.</p>
      </Section>
    </LegalArticle>
  );
}
