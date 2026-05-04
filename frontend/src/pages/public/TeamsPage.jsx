import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { Users } from "lucide-react";

export default function TeamsPage() {
  const [list, setList] = useState([]);
  useEffect(() => { api.get("/teams").then(({ data }) => setList(data)); }, []);
  return (
    <PublicLayout>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8]">Teams</span>
        <h1 className="mt-2 font-heading text-4xl md:text-6xl font-black uppercase">Teams & Clans</h1>
        <div className="mt-10 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {list.map((t) => (
            <Link key={t.id} to={`/teams/${t.id}`} data-testid={`team-card-${t.tag}`} className="group block border border-white/10 hover:border-[#29B6E8]/60 rounded-sm p-5 bg-[#121212] transition">
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 bg-[#0A0A0A] border border-white/10 rounded-sm flex items-center justify-center">
                  {t.logo_url ? <img src={t.logo_url} alt={t.name} className="w-full h-full object-cover" /> : <span className="font-heading font-black text-[#29B6E8]">{t.tag}</span>}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[10px] uppercase tracking-widest text-[#29B6E8] font-bold">[{t.tag}]</div>
                  <h3 className="font-heading text-xl font-bold group-hover:text-[#29B6E8] transition truncate">{t.name}</h3>
                  <div className="text-xs text-white/50 inline-flex items-center gap-1 mt-0.5">
                    <Users className="w-3.5 h-3.5" /> {t.member_ids?.length || 0} Mitglieder
                  </div>
                </div>
              </div>
              {t.description && <p className="mt-3 text-sm text-white/60 line-clamp-2">{t.description}</p>}
            </Link>
          ))}
          {list.length === 0 && <div className="col-span-full text-center py-20 text-white/40 font-display tracking-widest">KEINE TEAMS</div>}
        </div>
      </div>
    </PublicLayout>
  );
}
