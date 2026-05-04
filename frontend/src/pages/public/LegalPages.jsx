import { PublicLayout } from "@/components/tls/PublicLayout";

export function PrivacyPage() {
  return (
    <PublicLayout>
      <div className="max-w-3xl mx-auto px-4 py-12">
        <h1 className="font-heading text-4xl font-black uppercase">Datenschutzerklärung</h1>
        <div className="mt-6 text-white/80 space-y-4 text-sm leading-relaxed">
          <p>Diese TLS ARENA Instanz wird vom THE LION SQUAD eSports Verein gehostet. Wir erfassen nur die Daten, die für die Turnierverwaltung notwendig sind.</p>
          <p>Personenbezogene Daten (E-Mail, Benutzername, Discord-Name, Spielernamen) werden ausschließlich für die Verwaltung von Turnieranmeldungen, Check-in und Ergebnisdarstellung verwendet.</p>
          <p>Passwörter werden ausschließlich als bcrypt-Hashes gespeichert. Spielerprofile sind standardmäßig öffentlich sichtbar — dies kann im Profil deaktiviert werden.</p>
          <p>Rechte: Auskunft, Löschung, Berichtigung, Einschränkung der Verarbeitung. Kontakt: <strong>datenschutz@thelionsquad.at</strong>.</p>
        </div>
      </div>
    </PublicLayout>
  );
}

export function ImprintPage() {
  return (
    <PublicLayout>
      <div className="max-w-3xl mx-auto px-4 py-12">
        <h1 className="font-heading text-4xl font-black uppercase">Impressum</h1>
        <div className="mt-6 text-white/80 space-y-2 text-sm">
          <p><strong>THE LION SQUAD eSports Verein</strong></p>
          <p>Wien, Österreich</p>
          <p>Kontakt: info@thelionsquad.at</p>
          <p>Vereinsregister: ZVR-Nr. 0000000000</p>
        </div>
      </div>
    </PublicLayout>
  );
}
