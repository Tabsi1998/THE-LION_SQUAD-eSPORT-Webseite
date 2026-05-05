import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, resolveMediaUrl } from "@/lib/api";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { useAuth } from "@/context/AuthContext";
import { Crown, Users as UsersIcon, MapPin } from "lucide-react";

export default function MembersDirectoryPage() {
  const { isClubMember } = useAuth();
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get("/membership/public").then(({ data }) => setMembers(data)).catch(() => {}).finally(() => setLoading(false));
  }, []);

  return (
    <PublicLayout>
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 mb-10">
          <div>
            <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#FFD700]">DAS RUDEL</span>
            <h1 className="font-heading text-4xl md:text-5xl font-black uppercase mt-2">Vereinsmitglieder</h1>
            <p className="mt-3 text-white/60 max-w-2xl">
              Offizielle Mitglieder von THE LION SQUAD — eSports. Hier siehst du alle Spieler, die aktiv den Verein tragen, intern Verantwortung übernehmen und das Rudel ausmachen.
            </p>
          </div>
          {!isClubMember && (
            <Link to="/membership/join" data-testid="members-join-cta" className="inline-flex items-center gap-2 px-5 py-3 bg-[#FFD700] text-black font-bold uppercase tracking-wider rounded-sm hover:bg-[#e8c200] transition">
              <Crown className="w-4 h-4" /> Mitglied werden
            </Link>
          )}
        </div>

        {loading ? (
          <div className="text-white/40 text-sm">Lade …</div>
        ) : members.length === 0 ? (
          <div className="border border-dashed border-white/15 rounded-sm p-10 text-center text-white/50">
            <UsersIcon className="w-8 h-8 mx-auto opacity-40 mb-3" />
            <div className="font-heading font-bold text-lg">Noch keine öffentlichen Mitglieder</div>
            <div className="text-sm mt-2">Sobald Mitglieder ihre Profile öffentlich schalten, erscheinen sie hier.</div>
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {members.map((m) => (
              <Link
                key={m.username}
                to={`/u/${m.username}`}
                data-testid={`member-card-${m.username}`}
                className="group border border-white/10 hover:border-[#FFD700]/50 rounded-sm bg-[#121212] p-5 flex items-center gap-4 transition"
              >
                <div className="w-14 h-14 rounded-sm border border-[#FFD700]/40 bg-[#0A0A0A] flex items-center justify-center overflow-hidden">
                  {m.avatar_url ? (
                    <img src={resolveMediaUrl(m.avatar_url)} alt={m.display_name} className="w-full h-full object-cover" />
                  ) : (
                    <span className="font-heading font-black text-[#FFD700] text-xl">{(m.display_name || m.username)[0]}</span>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-heading font-bold text-white group-hover:text-[#FFD700] truncate flex items-center gap-1.5">
                    {m.display_name || m.username}
                    <Crown className="w-3.5 h-3.5 text-[#FFD700]" />
                  </div>
                  <div className="text-xs text-white/50 truncate">@{m.username}</div>
                  {m.internal_role && (
                    <div className="mt-1 text-[10px] uppercase tracking-widest text-[#FFD700]/80 font-bold">{m.internal_role}</div>
                  )}
                  {m.country && (
                    <div className="mt-1 inline-flex items-center gap-1 text-[10px] text-white/40 uppercase tracking-wider">
                      <MapPin className="w-2.5 h-2.5" /> {m.country}
                    </div>
                  )}
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </PublicLayout>
  );
}
