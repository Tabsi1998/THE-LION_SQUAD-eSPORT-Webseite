import { Link } from "react-router-dom";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { Heart, Users, Trophy, Gamepad2, Mountain } from "lucide-react";

export default function AboutPage() {
  return (
    <PublicLayout>
      {/* Hero */}
      <section className="relative overflow-hidden border-b border-white/10">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_30%,rgba(41,182,232,0.18),transparent_55%)]" />
        <div className="relative max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-20 md:py-28">
          <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8]">DER VEREIN</span>
          <h1 className="mt-3 font-heading text-5xl md:text-7xl font-black uppercase leading-[0.95]">
            Ein Rudel.<br />Eine Familie.
          </h1>
          <p className="mt-6 text-white/70 max-w-3xl text-lg">
            THE LION SQUAD ist ein offiziell eingetragener österreichischer eSports-Verein mit einem klaren Ziel: <strong className="text-white">eSports und Gaming fördern</strong> — und zeigen, was Gaming wirklich bedeutet.
          </p>
        </div>
      </section>

      {/* Was uns ausmacht */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="grid md:grid-cols-2 gap-12 items-start">
          <div>
            <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8]">WAS UNS AUSMACHT</span>
            <h2 className="mt-3 font-heading text-3xl md:text-4xl font-black uppercase">Mehr als nur Zocken</h2>
            <p className="mt-5 text-white/70 leading-relaxed">
              Bei uns geht es nicht nur ums Zocken, sondern um <strong className="text-white">Gemeinschaft, Spaß und Zusammenhalt</strong>. Egal ob Anfänger oder Pro — niemand bleibt allein oder wird im Stich gelassen.
            </p>
            <p className="mt-4 text-white/70 leading-relaxed">
              Wir halten zusammen, stehen füreinander ein und leben eine starke, offene Community. Diese Energie, diesen Spaß und diesen Teamgeist tragen wir nach außen — in unsere Events, Turniere und alles, was wir gemeinsam aufbauen.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Pillar icon={Heart} label="Fairplay" />
            <Pillar icon={Users} label="Gemeinschaft" />
            <Pillar icon={Trophy} label="Erfolg" />
            <Pillar icon={Gamepad2} label="Leidenschaft" />
          </div>
        </div>
      </section>

      {/* Was wird gespielt */}
      <section className="border-t border-white/10 bg-[#0F0F0F]">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
          <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8]">WAS WIR SPIELEN</span>
          <h2 className="mt-3 font-heading text-3xl md:text-4xl font-black uppercase">Vom Casual bis zum Cup</h2>
          <p className="mt-4 text-white/70 max-w-3xl leading-relaxed">
            Wir spielen Games, in denen wir auch aktiv in Turnieren vertreten sind — unter anderem <strong className="text-white">Call of Duty</strong> und <strong className="text-white">F1</strong>. Gleichzeitig sind wir offen für viele weitere Spiele wie Rocket League, World of Warcraft, Age of Empires, Minecraft, Mario Kart, Super Smash Bros. und vieles mehr.
          </p>
          <p className="mt-4 text-white/70 max-w-3xl leading-relaxed">
            Bei uns ist jeder willkommen, Neues auszuprobieren — egal ob kompetitiv, casual oder einfach nur zum Spaß. <strong className="text-white">Leistung ist cool, aber Gemeinschaft steht immer an erster Stelle.</strong>
          </p>
        </div>
      </section>

      {/* Offline */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="grid md:grid-cols-3 gap-5">
          <div className="md:col-span-2">
            <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8]">AUCH OFFLINE</span>
            <h2 className="mt-3 font-heading text-3xl md:text-4xl font-black uppercase">Gaming endet nicht am Bildschirm</h2>
            <p className="mt-5 text-white/70 leading-relaxed">
              Wir treffen uns regelmäßig zu gemütlichen <strong className="text-white">Grillabenden</strong>, spielen <strong className="text-white">Karten- und Brettspiele</strong> oder unternehmen gemeinsame Aktivitäten, um den Teamgeist und den Zusammenhalt zu stärken.
            </p>
            <p className="mt-4 text-white/70 leading-relaxed">
              Ob Klettergarten, interne LAN-Party oder einfach ein entspannter Abend — bei uns zählt das Miteinander, online wie offline.
            </p>
          </div>
          <div className="border border-white/10 rounded-sm bg-[#121212] p-6 self-center">
            <Mountain className="w-7 h-7 text-[#29B6E8] mb-3" />
            <h3 className="font-heading font-black uppercase text-lg">Off-Game Aktivitäten</h3>
            <ul className="mt-3 space-y-1.5 text-sm text-white/70">
              <li>• Grillabende</li>
              <li>• Brett- & Kartenspiele</li>
              <li>• LAN-Partys</li>
              <li>• Klettergarten-Trips</li>
              <li>• Gamers Heaven Messe</li>
            </ul>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-white/10 bg-gradient-to-b from-[#0F0F0F] to-black">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-20 text-center">
          <h2 className="font-heading text-3xl md:text-5xl font-black uppercase">Du willst Teil des Rudels werden?</h2>
          <p className="mt-4 text-white/70 max-w-2xl mx-auto">Registriere dich jetzt, lerne uns kennen und bewirb dich auf eine offizielle Vereinsmitgliedschaft.</p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link to="/register" data-testid="about-cta-register" className="px-7 py-3.5 bg-[#29B6E8] text-black font-bold uppercase tracking-wider rounded-sm hover:bg-[#1E95C2] transition">
              Account erstellen
            </Link>
            <Link to="/membership/join" data-testid="about-cta-join" className="px-7 py-3.5 border-2 border-[#FFD700] text-[#FFD700] font-bold uppercase tracking-wider rounded-sm hover:bg-[#FFD700] hover:text-black transition">
              Mitglied werden
            </Link>
          </div>
        </div>
      </section>
    </PublicLayout>
  );
}

function Pillar({ icon: Icon, label }) {
  return (
    <div className="border border-white/10 rounded-sm bg-[#121212] p-5 hover:border-[#29B6E8]/50 transition">
      <Icon className="w-6 h-6 text-[#29B6E8] mb-3" />
      <div className="font-heading font-black uppercase text-sm">{label}</div>
    </div>
  );
}
