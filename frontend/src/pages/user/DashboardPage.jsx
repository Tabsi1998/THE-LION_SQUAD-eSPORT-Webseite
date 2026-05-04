import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { StatusBadge } from "@/components/tls/StatusBadge";
import { Trophy, Flag, Bell } from "lucide-react";

export default function DashboardPage() {
  const { user } = useAuth();
  const [matches, setMatches] = useState([]);
  const [notifications, setNotifications] = useState([]);

  useEffect(() => {
    (async () => {
      const [m, n] = await Promise.allSettled([
        api.get("/matches/upcoming"),
        api.get("/admin/notifications"),
      ]);
      if (m.status === "fulfilled") setMatches(m.value.data);
      if (n.status === "fulfilled") setNotifications(n.value.data);
    })();
  }, []);

  return (
    <PublicLayout>
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="flex items-center gap-4 mb-10">
          <div className="w-16 h-16 border border-[#29B6E8]/50 rounded-sm bg-[#0A0A0A] flex items-center justify-center font-heading font-black text-2xl text-[#29B6E8]">
            {user?.display_name?.[0] || user?.username?.[0] || "L"}
          </div>
          <div>
            <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8]">Dashboard</span>
            <h1 className="font-heading text-3xl md:text-4xl font-black uppercase">{user?.display_name || user?.username}</h1>
          </div>
        </div>

        <div className="grid lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 border border-white/10 rounded-sm bg-[#121212] p-5">
            <h2 className="font-heading text-xl font-bold uppercase mb-4 flex items-center gap-2"><Trophy className="w-4 h-4 text-[#29B6E8]" /> Nächste Matches</h2>
            <div className="space-y-3">
              {matches.length === 0 && <div className="text-sm text-white/40">Keine geplanten Matches.</div>}
              {matches.map((m) => (
                <Link
                  key={m.id}
                  to={`/matches/${m.id}`}
                  data-testid={`dashboard-match-${m.id}`}
                  className="block border border-white/10 rounded-sm p-3 hover:border-[#29B6E8]/60 transition"
                >
                  <div className="flex items-center justify-between">
                    <div className="text-sm text-white">{m.round_name || `Runde ${m.round}`}</div>
                    <StatusBadge status={m.status} />
                  </div>
                  {m.scheduled_at && <div className="text-xs text-white/50 mt-1">{new Date(m.scheduled_at).toLocaleString("de-DE")}</div>}
                </Link>
              ))}
            </div>
          </div>
          <div className="border border-white/10 rounded-sm bg-[#121212] p-5">
            <h2 className="font-heading text-xl font-bold uppercase mb-4 flex items-center gap-2"><Bell className="w-4 h-4 text-[#29B6E8]" /> Benachrichtigungen</h2>
            <div className="space-y-3">
              {notifications.length === 0 && <div className="text-sm text-white/40">Keine Benachrichtigungen.</div>}
              {notifications.map((n) => (
                <div key={n.id} className="border-l-2 border-[#29B6E8]/50 pl-3 text-sm">
                  <div className="text-white">{n.title}</div>
                  <div className="text-white/50 text-xs">{new Date(n.created_at).toLocaleString("de-DE")}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-8 grid md:grid-cols-3 gap-4">
          <Link to="/profile" data-testid="dashboard-profile-link" className="border border-white/10 hover:border-[#29B6E8]/60 rounded-sm p-5 bg-[#121212] transition">
            <div className="text-[11px] uppercase tracking-widest text-[#29B6E8] font-bold">Profil</div>
            <div className="mt-2 font-heading text-lg font-bold">Einstellungen</div>
          </Link>
          <Link to="/tournaments" data-testid="dashboard-tournaments-link" className="border border-white/10 hover:border-[#29B6E8]/60 rounded-sm p-5 bg-[#121212] transition">
            <div className="text-[11px] uppercase tracking-widest text-[#29B6E8] font-bold">Turniere</div>
            <div className="mt-2 font-heading text-lg font-bold">Jetzt anmelden</div>
          </Link>
          <Link to="/f1" data-testid="dashboard-f1-link" className="border border-white/10 hover:border-[#29B6E8]/60 rounded-sm p-5 bg-[#121212] transition">
            <div className="text-[11px] uppercase tracking-widest text-[#29B6E8] font-bold">Fast Lap</div>
            <div className="mt-2 font-heading text-lg font-bold">Ranglisten</div>
          </Link>
          <Link to="/privacy-account" data-testid="dashboard-privacy-link" className="border border-white/10 hover:border-[#29B6E8]/60 rounded-sm p-5 bg-[#121212] transition">
            <div className="text-[11px] uppercase tracking-widest text-[#29B6E8] font-bold">DSGVO</div>
            <div className="mt-2 font-heading text-lg font-bold">Meine Daten</div>
          </Link>
        </div>
      </div>
    </PublicLayout>
  );
}
