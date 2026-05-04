import { PublicLayout } from "@/components/tls/PublicLayout";
import { Handshake } from "lucide-react";

export default function PartnersPage() {
  return (
    <PublicLayout>
      <section className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8]">COMMUNITY</span>
        <h1 className="mt-3 font-heading text-4xl md:text-5xl font-black uppercase">Partner</h1>
        <p className="mt-4 text-white/70 max-w-2xl">
          Befreundete Vereine, Veranstalter und Communitys, mit denen wir zusammenarbeiten.
        </p>

        <div className="mt-12 grid sm:grid-cols-2 gap-5">
          <a href="https://www.gamersheaven.tirol/" target="_blank" rel="noreferrer" className="border border-white/10 hover:border-[#29B6E8]/60 rounded-sm bg-[#121212] p-6 transition group">
            <Handshake className="w-7 h-7 text-[#29B6E8] mb-4" />
            <h3 className="font-heading font-black uppercase text-lg">Gamers Heaven Tirol</h3>
            <p className="mt-2 text-sm text-white/65">Die größte Gaming-Messe Tirols. Wir sind regelmäßig mit Stand und Turnieren vor Ort.</p>
            <span className="mt-4 inline-block text-xs uppercase tracking-wider font-bold text-[#29B6E8] group-hover:underline">gamersheaven.tirol →</span>
          </a>
        </div>

        <div className="mt-10 border border-dashed border-white/15 rounded-sm p-10 text-center text-white/50">
          Du willst Partner werden? <a href="mailto:info@thelionsquad.at" className="text-[#29B6E8] hover:underline">Schreib uns</a>.
        </div>
      </section>
    </PublicLayout>
  );
}
