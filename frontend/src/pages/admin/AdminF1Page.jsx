import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import { AdminLayout } from "@/components/tls/AdminLayout";
import { StatusBadge } from "@/components/tls/StatusBadge";
import { Plus, Flag } from "lucide-react";

export default function AdminF1Page() {
  const [list, setList] = useState([]);
  useEffect(() => { api.get("/f1/challenges").then(({ data }) => setList(data)); }, []);
  return (
    <AdminLayout>
      <div className="flex items-center justify-between mb-8">
        <div>
          <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8]">F1 Fast Lap</span>
          <h1 className="font-heading text-3xl md:text-4xl font-black uppercase">Challenges</h1>
        </div>
        <Link to="/admin/f1/new" data-testid="admin-f1-new-btn" className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#29B6E8] text-black font-bold uppercase tracking-wider rounded-sm hover:bg-[#1E95C2]">
          <Plus className="w-4 h-4" /> Neue Challenge
        </Link>
      </div>
      <div className="space-y-3">
        {list.map((c) => (
          <Link key={c.id} to={`/admin/f1/${c.id}`} data-testid={`admin-f1-row-${c.slug}`} className="block border border-white/10 hover:border-[#29B6E8]/60 rounded-sm p-5 bg-[#121212] transition">
            <div className="flex items-center gap-4">
              <Flag className="w-6 h-6 text-[#29B6E8]" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2"><StatusBadge status={c.status} /></div>
                <h3 className="font-heading text-xl font-bold">{c.title}</h3>
                <div className="text-xs text-white/50">{c.track_count} Strecken · {c.participant_count} Fahrer</div>
              </div>
            </div>
          </Link>
        ))}
        {list.length === 0 && <div className="text-center py-16 text-white/40 font-display tracking-widest">KEINE CHALLENGES</div>}
      </div>
    </AdminLayout>
  );
}
