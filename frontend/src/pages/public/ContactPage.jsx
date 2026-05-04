import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { Mail, MessageSquare, MapPin } from "lucide-react";

export default function ContactPage() {
  const [branding, setBranding] = useState(null);
  useEffect(() => { api.get("/settings/public").then(({ data }) => setBranding(data)).catch(() => {}); }, []);

  return (
    <PublicLayout>
      <section className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8]">KONTAKT</span>
        <h1 className="mt-3 font-heading text-4xl md:text-5xl font-black uppercase">Sag Hallo</h1>
        <p className="mt-4 text-white/70 max-w-2xl">
          Du hast Fragen, willst Mitglied werden, möchtest uns als Sponsor unterstützen oder einfach nur Hallo sagen? Wir freuen uns auf dich.
        </p>

        <div className="mt-10 grid md:grid-cols-2 gap-5">
          <a href="https://discord.com/invite/thelionsquadesports" target="_blank" rel="noreferrer" data-testid="contact-discord" className="border border-white/10 hover:border-[#5865F2]/60 rounded-sm bg-[#121212] p-6 transition group">
            <MessageSquare className="w-7 h-7 text-[#5865F2] mb-4" />
            <h3 className="font-heading font-black uppercase text-lg">Discord Server</h3>
            <p className="mt-2 text-sm text-white/65">Der schnellste Weg zu uns. Klick rein, sag Hallo, oder ping einen Mod.</p>
            <span className="mt-4 inline-block text-xs uppercase tracking-wider font-bold text-[#5865F2] group-hover:underline">Beitreten →</span>
          </a>
          <a href="mailto:info@thelionsquad.at" data-testid="contact-email" className="border border-white/10 hover:border-[#29B6E8]/60 rounded-sm bg-[#121212] p-6 transition group">
            <Mail className="w-7 h-7 text-[#29B6E8] mb-4" />
            <h3 className="font-heading font-black uppercase text-lg">E-Mail</h3>
            <p className="mt-2 text-sm text-white/65">Für Anfragen rund um Mitgliedschaft, Sponsoring oder Presse.</p>
            <span className="mt-4 inline-block text-xs uppercase tracking-wider font-bold text-[#29B6E8] group-hover:underline">info@thelionsquad.at</span>
          </a>
        </div>

        <div className="mt-10 border border-white/10 rounded-sm bg-[#121212] p-6">
          <div className="flex items-start gap-4">
            <MapPin className="w-5 h-5 text-[#29B6E8] mt-1" />
            <div>
              <h3 className="font-heading font-black uppercase">THE LION SQUAD — eSports</h3>
              <p className="mt-2 text-sm text-white/65">Offiziell eingetragener Verein, Österreich.</p>
              <p className="mt-1 text-sm text-white/50">Vereinsdaten und ZVR-Nummer findest du im <Link to="/imprint" className="text-[#29B6E8] hover:underline">Impressum</Link>.</p>
            </div>
          </div>
        </div>
      </section>
    </PublicLayout>
  );
}
