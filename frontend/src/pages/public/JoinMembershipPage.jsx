import { Link } from "react-router-dom";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { Crown, Users, Heart, Trophy, Gamepad2, Mail } from "lucide-react";

export default function JoinMembershipPage() {
  useDocumentTitle(
    "Mitglied werden",
    "Mitglied werden bei THE LION SQUAD: eSports Verein, Gaming Community, Mitgliederbereich, Events, Turniere und Vorteile in Tirol."
  );

  return (
    <PublicLayout>
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(255,215,0,0.12),transparent_50%)]" />
        <div className="relative max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-16 md:py-24">
          <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#FFD700]">VEREINSMITGLIEDSCHAFT</span>
          <h1 className="mt-3 font-heading text-4xl md:text-6xl font-black uppercase leading-[1.05]">
            Werde Teil <br />des <span className="text-[#FFD700]">Rudels</span>
          </h1>
          <p className="mt-6 text-white/70 max-w-2xl text-lg">
            THE LION SQUAD ist ein offiziell eingetragener österreichischer eSports-Verein. Eine Community, die zusammenhält — online wie offline. Werde offizielles Vereinsmitglied und sei Teil von etwas Größerem.
          </p>

          <div className="mt-10 grid md:grid-cols-2 gap-5">
            <Card icon={Crown} title="Was du als Mitglied bekommst">
              <ul className="space-y-2.5 text-sm text-white/70">
                <li>• Zugang zum internen Mitgliederbereich</li>
                <li>• Exklusive Mitgliedervorteile, Rabatte und Partnerangebote</li>
                <li>• Mitglieder-only Turniere und Challenges</li>
                <li>• Frühere Anmeldung zu öffentlichen Events</li>
                <li>• Spezielle Mitglieder-Achievements</li>
                <li>• Eigene Mitgliedsnummer und Vereinsausweis</li>
                <li>• Stimmrecht in Vereinsversammlungen</li>
              </ul>
            </Card>
            <Card icon={Heart} title="Was wir vom Rudel erwarten">
              <ul className="space-y-2.5 text-sm text-white/70">
                <li>• Fairplay und Respekt gegenüber jedem im Verein</li>
                <li>• Zusammenhalt — keiner bleibt allein</li>
                <li>• Aktive Teilnahme an Events und der Community</li>
                <li>• Einhaltung der Vereinsregeln und Statuten</li>
                <li>• Regelmäßiger Mitgliedsbeitrag (Details auf Anfrage)</li>
                <li>• Lust auf Gaming, Spaß und echten Teamgeist</li>
              </ul>
            </Card>
          </div>

          <div className="mt-8 border border-white/10 rounded-sm bg-[#121212] p-6 md:p-8">
            <h2 className="font-heading text-2xl font-black uppercase">So wirst du Mitglied</h2>
            <ol className="mt-4 space-y-3 text-white/70 text-sm">
              <Step n="1" title="Account erstellen">Registriere dich auf dieser Plattform — du wirst dadurch Community-Spieler.</Step>
              <Step n="2" title="Profil ausfüllen">Vervollständige dein Profil mit Avatar, Lieblingsspielen und Socials.</Step>
              <Step n="3" title="Antrag stellen">Schreib uns eine kurze Mail oder melde dich im Discord. Der Vorstand prüft jeden Antrag persönlich.</Step>
              <Step n="4" title="Freischaltung">Nach der Aufnahme schaltet dich der Vorstand offiziell als Vereinsmitglied frei. Du erhältst eine E-Mail mit deiner Mitgliedsnummer.</Step>
            </ol>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link to="/register" data-testid="join-register-btn" className="inline-flex items-center gap-2 px-5 py-3 bg-[#FFD700] text-black font-bold uppercase tracking-wider rounded-sm hover:bg-[#e8c200] transition">
                <Users className="w-4 h-4" /> Jetzt registrieren
              </Link>
              <Link to="/contact" data-testid="join-contact-btn" className="inline-flex items-center gap-2 px-5 py-3 border border-white/20 hover:border-[#FFD700]/60 text-white font-bold uppercase tracking-wider rounded-sm transition">
                <Mail className="w-4 h-4" /> Kontakt aufnehmen
              </Link>
            </div>
          </div>

          <div className="mt-10 grid sm:grid-cols-3 gap-5">
            <Mini icon={Trophy} title="Erfolg" text="Wir treten in offiziellen Turnieren in Call of Duty, F1, Mario Kart und mehr an." />
            <Mini icon={Gamepad2} title="Vielfalt" text="Casual oder kompetitiv — bei uns ist jeder Spielstil willkommen." />
            <Mini icon={Heart} title="Familie" text="Online wie offline. Grillabende, LAN-Partys, Klettergarten — wir leben Community." />
          </div>
        </div>
      </section>
    </PublicLayout>
  );
}

function Card({ icon: Icon, title, children }) {
  return (
    <div className="border border-white/10 rounded-sm bg-[#121212] p-6">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-sm bg-[#FFD700]/10 border border-[#FFD700]/30 flex items-center justify-center">
          <Icon className="w-4 h-4 text-[#FFD700]" />
        </div>
        <h3 className="font-heading font-black uppercase text-lg">{title}</h3>
      </div>
      {children}
    </div>
  );
}

function Step({ n, title, children }) {
  return (
    <li className="flex gap-4">
      <div className="font-heading font-black text-[#FFD700] text-xl shrink-0 w-8">{n}</div>
      <div>
        <div className="font-bold text-white">{title}</div>
        <div className="text-white/60 text-sm mt-0.5">{children}</div>
      </div>
    </li>
  );
}

function Mini({ icon: Icon, title, text }) {
  return (
    <div className="border border-white/10 rounded-sm bg-[#0F0F0F] p-5">
      <Icon className="w-5 h-5 text-[#FFD700] mb-3" />
      <div className="font-heading font-black uppercase">{title}</div>
      <div className="text-sm text-white/60 mt-1">{text}</div>
    </div>
  );
}
