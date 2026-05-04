/**
 * Phase D — Statische Vereins-Sub-Pages (Vorstand, Werte/Ziele).
 * Werden später (Phase F: Web-CMS) editierbar gemacht.
 */
import { PublicLayout } from "@/components/tls/PublicLayout";
import { Breadcrumbs } from "@/components/tls/Breadcrumbs";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { Crown, Heart, Target, Sparkles } from "lucide-react";

export function BoardPage() {
  useDocumentTitle("Vorstand", "Der Vorstand von THE LION SQUAD eSports.");
  return (
    <PublicLayout>
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <Breadcrumbs items={[{ label: "Home", to: "/" }, { label: "Verein", to: "/about" }, { label: "Vorstand" }]} className="mb-6" />
        <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#FFD700]">Organisation</span>
        <h1 className="mt-2 font-heading text-4xl md:text-5xl font-black uppercase">Vorstand</h1>
        <p className="mt-4 text-white/70 max-w-2xl">
          Das Team hinter THE LION SQUAD — eSports. Ehrenamtlich, leidenschaftlich, mit klarem Fokus auf Community und Fairplay.
        </p>

        <div className="mt-10 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {[
            { role: "Obmann / Präsident", desc: "Vereinsleitung, Strategie, externe Vertretung." },
            { role: "Schriftführer", desc: "Protokolle, Kommunikation, Vereinsregister." },
            { role: "Kassier", desc: "Finanzen, Mitgliedsbeiträge, Sponsoren-Abrechnung." },
            { role: "Event-Koordinator", desc: "Planung & Durchführung von Vereinsevents." },
            { role: "eSports-Lead", desc: "Turniere, Brackets, Rangliste, Fairplay." },
            { role: "Community Manager", desc: "Discord, Social Media, Mitgliederbetreuung." },
          ].map((m) => (
            <div key={m.role} className="border border-white/10 rounded-sm p-5 bg-[#121212] hover:border-[#FFD700]/40 transition">
              <Crown className="w-5 h-5 text-[#FFD700] mb-3" />
              <div className="font-heading font-bold uppercase">{m.role}</div>
              <p className="mt-2 text-sm text-white/60">{m.desc}</p>
              <div className="mt-3 text-[10px] uppercase tracking-widest text-white/40">Position offen — wird befüllt</div>
            </div>
          ))}
        </div>

        <div className="mt-10 border border-white/10 bg-[#121212] rounded-sm p-6">
          <h2 className="font-heading text-xl font-bold uppercase mb-2">Statuten & Vereinsregister</h2>
          <p className="text-sm text-white/60">
            THE LION SQUAD — eSports ist ein eingetragener österreichischer eSports-Verein. Statuten und ZVR-Nummer werden im Mitgliederbereich nach Login angezeigt.
          </p>
        </div>
      </div>
    </PublicLayout>
  );
}

export function ValuesPage() {
  useDocumentTitle("Werte & Ziele", "Werte und Ziele des Vereins THE LION SQUAD eSports.");
  return (
    <PublicLayout>
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <Breadcrumbs items={[{ label: "Home", to: "/" }, { label: "Verein", to: "/about" }, { label: "Werte & Ziele" }]} className="mb-6" />
        <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8]">Identität</span>
        <h1 className="mt-2 font-heading text-4xl md:text-5xl font-black uppercase">Werte & Ziele</h1>
        <p className="mt-4 text-white/70 max-w-2xl">
          Was uns ausmacht, wofür wir stehen, und wohin wir wollen.
        </p>

        <div className="mt-10 grid grid-cols-1 md:grid-cols-3 gap-5">
          {[
            { icon: Heart, title: "Rudel-Mentalität", text: "Wir gewinnen gemeinsam, wir verlieren gemeinsam, wir feiern gemeinsam. Niemand wird zurückgelassen." },
            { icon: Sparkles, title: "Fairplay", text: "Respekt vor Gegnern, Schiedsrichtern, Teammates. Cheating, Toxic Behaviour und Diskriminierung haben bei uns keinen Platz." },
            { icon: Target, title: "Ambition", text: "Spaß zuerst — aber wir wollen besser werden, lernen, wachsen. Ob Casual oder Competitive: Jeder Pixel zählt." },
          ].map((v) => (
            <div key={v.title} className="border border-white/10 rounded-sm p-6 bg-gradient-to-br from-white/[0.02] to-transparent">
              <v.icon className="w-6 h-6 text-[#29B6E8] mb-3" />
              <div className="font-heading text-lg font-black uppercase">{v.title}</div>
              <p className="mt-2 text-sm text-white/70 leading-relaxed">{v.text}</p>
            </div>
          ))}
        </div>

        <div className="mt-10 border-t border-white/10 pt-8">
          <h2 className="font-heading text-2xl font-bold uppercase mb-4">Unsere Ziele</h2>
          <ul className="space-y-3 text-white/80 max-w-2xl">
            <li>🦁 <strong>Eine Heimat schaffen</strong> für eSports-Begeisterte aller Plattformen, Spiele und Skill-Level.</li>
            <li>🏁 <strong>Reguläre Vereinsevents</strong> (online & offline) mit Pokal, Preisen und gutem Essen.</li>
            <li>🏆 <strong>Eigene Turnierserie</strong> mit Season Pass, Achievements und Hall of Fame.</li>
            <li>🎮 <strong>Förderung des Nachwuchses</strong> — auch für Kinder & Jugendliche, mit klaren Regeln und sicheren Strukturen.</li>
            <li>🤝 <strong>Kooperationen mit anderen Vereinen</strong>, Streamern, Spielentwicklern und Sponsoren.</li>
          </ul>
        </div>
      </div>
    </PublicLayout>
  );
}
