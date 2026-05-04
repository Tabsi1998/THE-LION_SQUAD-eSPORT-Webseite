import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { useAuth } from "@/context/AuthContext";
import { Crown, Gift, FileText, Bell, Calendar } from "lucide-react";

export default function MemberAreaPage() {
  const { user } = useAuth();
  const [benefits, setBenefits] = useState([]);
  const [my, setMy] = useState(null);

  useEffect(() => {
    Promise.allSettled([
      api.get("/membership/benefits"),
      api.get("/membership/me"),
    ]).then(([b, m]) => {
      if (b.status === "fulfilled") setBenefits(b.value.data);
      if (m.status === "fulfilled") setMy(m.value.data);
    });
  }, []);

  const memberSince = my?.membership?.member_since ? new Date(my.membership.member_since).toLocaleDateString("de-DE") : null;

  return (
    <PublicLayout>
      <section className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="border border-[#FFD700]/40 bg-gradient-to-r from-[#FFD700]/10 via-[#FFD700]/5 to-transparent rounded-sm p-6 md:p-8">
          <div className="flex flex-col md:flex-row items-start md:items-center gap-4 md:gap-6">
            <div className="w-16 h-16 rounded-sm bg-[#FFD700]/20 border border-[#FFD700]/50 flex items-center justify-center">
              <Crown className="w-7 h-7 text-[#FFD700]" />
            </div>
            <div className="flex-1">
              <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#FFD700]">MITGLIEDERBEREICH</span>
              <h1 className="font-heading text-3xl md:text-4xl font-black uppercase mt-1">Willkommen, {user?.display_name || user?.username}</h1>
              <div className="mt-2 text-sm text-white/70">
                {my?.membership?.member_number && (
                  <span className="inline-block mr-4">Mitgliedsnr.: <strong className="text-[#FFD700]">{my.membership.member_number}</strong></span>
                )}
                {memberSince && <span className="inline-block">Mitglied seit: <strong className="text-white">{memberSince}</strong></span>}
                {my?.membership?.internal_role && <span className="inline-block ml-4">Rolle: <strong className="text-white">{my.membership.internal_role}</strong></span>}
              </div>
            </div>
          </div>
        </div>

        <div className="mt-10 grid lg:grid-cols-3 gap-5">
          <div className="lg:col-span-2 space-y-5">
            <div className="border border-white/10 rounded-sm bg-[#121212] p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-heading text-xl font-black uppercase flex items-center gap-2"><Gift className="w-4 h-4 text-[#FFD700]" /> Mitgliedervorteile</h2>
                <Link to="/members/benefits" data-testid="member-area-all-benefits" className="text-xs uppercase tracking-wider text-[#FFD700] hover:underline">Alle ansehen</Link>
              </div>
              {benefits.length === 0 ? (
                <div className="text-sm text-white/40">Aktuell sind keine Mitgliedervorteile freigeschaltet. Schau bald wieder vorbei.</div>
              ) : (
                <div className="space-y-3">
                  {benefits.slice(0, 4).map((b) => (
                    <BenefitRow key={b.id} b={b} />
                  ))}
                </div>
              )}
            </div>

            <div className="border border-white/10 rounded-sm bg-[#121212] p-6">
              <h2 className="font-heading text-xl font-black uppercase flex items-center gap-2 mb-4"><FileText className="w-4 h-4 text-[#FFD700]" /> Vereinsdokumente</h2>
              <div className="text-sm text-white/40">Statuten, Protokolle und interne Dokumente werden hier zentral abgelegt. Der Vorstand pflegt den Bereich.</div>
            </div>
          </div>

          <div className="space-y-5">
            <div className="border border-white/10 rounded-sm bg-[#121212] p-5">
              <h3 className="font-heading text-lg font-black uppercase flex items-center gap-2 mb-3"><Bell className="w-4 h-4 text-[#FFD700]" /> Interne News</h3>
              <div className="text-sm text-white/40">Keine internen News.</div>
            </div>
            <div className="border border-white/10 rounded-sm bg-[#121212] p-5">
              <h3 className="font-heading text-lg font-black uppercase flex items-center gap-2 mb-3"><Calendar className="w-4 h-4 text-[#FFD700]" /> Interne Events</h3>
              <div className="text-sm text-white/40">Keine internen Events geplant.</div>
            </div>
            <Link to="/dashboard" data-testid="member-area-back" className="block px-4 py-3 border border-white/10 rounded-sm hover:border-[#29B6E8]/60 text-center text-xs uppercase tracking-wider font-bold text-white/60 hover:text-[#29B6E8] transition">
              Zurück zum Dashboard
            </Link>
          </div>
        </div>
      </section>
    </PublicLayout>
  );
}

function BenefitRow({ b }) {
  return (
    <div className="flex items-start gap-4 p-3 border border-white/10 rounded-sm hover:border-[#FFD700]/30 transition">
      <div className="w-10 h-10 rounded-sm bg-[#0A0A0A] border border-[#FFD700]/30 flex items-center justify-center shrink-0 overflow-hidden">
        {b.image_url ? <img src={b.image_url} alt="" className="w-full h-full object-cover" /> : <Gift className="w-4 h-4 text-[#FFD700]" />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-bold text-white">{b.title}</div>
        {b.description && <div className="text-xs text-white/60 mt-0.5 line-clamp-2">{b.description}</div>}
        {b.category && <div className="text-[10px] uppercase tracking-widest text-[#FFD700]/70 mt-1">{b.category}</div>}
      </div>
      {b.link_url && (
        <a href={b.link_url} target="_blank" rel="noreferrer" className="text-xs uppercase tracking-wider text-[#FFD700] hover:underline shrink-0">öffnen →</a>
      )}
    </div>
  );
}
