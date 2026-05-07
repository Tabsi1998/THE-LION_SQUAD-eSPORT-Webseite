import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, resolveMediaUrl } from "@/lib/api";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { useAuth } from "@/context/AuthContext";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { Crown, Gamepad2, Monitor, Users as UsersIcon } from "lucide-react";

export default function MembersDirectoryPage() {
  const { isClubMember } = useAuth();
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    api.get("/membership/profiles").then(({ data }) => setMembers(data)).catch(() => {}).finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);
  useApiInvalidation(load, ["membership", "users"]);

  return (
    <PublicLayout>
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 mb-10">
          <div>
            <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#FFD700]">DAS RUDEL</span>
            <h1 className="font-heading text-4xl md:text-5xl font-black uppercase mt-2">Vereinsmitglieder</h1>
            <p className="mt-3 text-white/60 max-w-2xl">
              Offizielle Mitglieder von THE LION SQUAD — eSports. Diese Übersicht wird redaktionell gepflegt und zeigt die Personen, die den Verein sichtbar mittragen.
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
            <div className="text-sm mt-2">Sobald Admins Vereinsmitglieder freigeben, erscheinen sie hier.</div>
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {members.map((m) => (
              <Link
                key={m.slug}
                to={`/members/${m.slug}`}
                data-testid={`member-card-${m.slug}`}
                className="group border border-white/10 hover:border-[#FFD700]/50 rounded-sm bg-[#121212] overflow-hidden transition"
              >
                <div className="aspect-[4/3] bg-[#0A0A0A] overflow-hidden">
                  {m.photo_url ? (
                    <img src={resolveMediaUrl(m.photo_url)} alt="" className="w-full h-full object-cover group-hover:scale-105 transition duration-500" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-white/20">
                      <UsersIcon className="w-12 h-12" />
                    </div>
                  )}
                </div>
                <div className="p-5">
                  <div className="font-heading font-black text-white group-hover:text-[#FFD700] uppercase flex items-center gap-1.5">
                    {m.display_name}
                    <Crown className="w-3.5 h-3.5 text-[#FFD700]" />
                  </div>
                  {m.role_title && (
                    <div className="mt-1 text-[10px] uppercase tracking-widest text-[#FFD700]/80 font-bold">{m.role_title}</div>
                  )}
                  <div className="mt-4 space-y-2">
                    {!!m.games?.length && (
                      <div className="flex items-start gap-2 text-xs text-white/55">
                        <Gamepad2 className="w-3.5 h-3.5 mt-0.5 text-[#29B6E8]" />
                        <span className="line-clamp-1">{m.games.join(", ")}</span>
                      </div>
                    )}
                    {!!m.platforms?.length && (
                      <div className="flex items-start gap-2 text-xs text-white/55">
                        <Monitor className="w-3.5 h-3.5 mt-0.5 text-[#29B6E8]" />
                        <span className="line-clamp-1">{m.platforms.join(", ")}</span>
                      </div>
                    )}
                    {m.age && <div className="text-[10px] text-white/35 uppercase tracking-wider">{m.age} Jahre</div>}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </PublicLayout>
  );
}
