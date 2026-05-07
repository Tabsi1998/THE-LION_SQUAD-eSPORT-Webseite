import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, resolveMediaUrl } from "@/lib/api";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { useAuth } from "@/context/AuthContext";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { Crown, Gamepad2, Monitor, ArrowRight, Users as UsersIcon } from "lucide-react";

function memberGamertag(member) {
  return member.gamertag || member.linked_account?.username || member.display_name;
}

function memberRealName(member) {
  const tag = memberGamertag(member);
  return member.real_name || (member.display_name && member.display_name !== tag ? member.display_name : "");
}

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
        <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4 mb-10 min-w-0">
          <div className="min-w-0">
            <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#FFD700]">DAS RUDEL</span>
            <h1 className="font-heading text-4xl md:text-5xl font-black uppercase mt-2 break-words">Vereinsmitglieder</h1>
            <p className="mt-3 text-white/60 max-w-2xl">
              Offizielle Mitglieder von THE LION SQUAD — eSports. Diese Übersicht wird redaktionell gepflegt und zeigt die Personen, die den Verein sichtbar mittragen.
            </p>
          </div>
          {!isClubMember && (
            <Link to="/membership/join" data-testid="members-join-cta" className="inline-flex items-center self-start shrink-0 gap-2 px-5 py-3 bg-[#FFD700] text-black font-bold uppercase tracking-wider rounded-sm hover:bg-[#e8c200] transition">
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
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-16 pt-8 min-w-0">
            {members.map((m) => (
              <Link
                key={m.slug}
                to={`/members/${m.slug}`}
                data-testid={`member-card-${m.slug}`}
                className="group relative block min-h-[30rem] sm:min-h-[33rem] overflow-visible min-w-0"
              >
                <div className="absolute inset-x-4 top-10 bottom-20 bg-[radial-gradient(circle_at_50%_18%,rgba(255,215,0,0.16),rgba(41,182,232,0.08)_35%,rgba(10,10,10,0)_72%)] opacity-90 group-hover:opacity-100 transition" />
                <div className="absolute inset-x-8 bottom-[5.4rem] h-10 bg-black/45 blur-2xl rounded-full" />
                <div className="relative h-[24rem] sm:h-[27rem] overflow-visible">
                  {m.photo_url ? (
                    <img
                      src={resolveMediaUrl(m.photo_url)}
                      alt=""
                      className="absolute left-1/2 -top-10 bottom-0 z-10 h-[118%] w-auto max-w-[112%] -translate-x-1/2 object-contain object-bottom drop-shadow-[0_26px_42px_rgba(0,0,0,0.58)] group-hover:scale-[1.035] group-hover:-translate-y-2 transition duration-500"
                    />
                  ) : (
                    <div className="absolute inset-0 z-10 flex items-center justify-center text-white/20">
                      <UsersIcon className="w-12 h-12" />
                    </div>
                  )}
                </div>
                <div className="relative z-20 -mt-14 mx-3 bg-gradient-to-t from-black via-black/90 to-black/55 px-4 py-4 shadow-[0_-18px_38px_rgba(0,0,0,0.55)]">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-heading font-black text-2xl md:text-[1.7rem] text-white group-hover:text-[#FFD700] uppercase leading-none truncate">
                        {memberGamertag(m)}
                      </div>
                      {memberRealName(m) && (
                        <div className="mt-1 text-xs font-semibold text-white/55 truncate">{memberRealName(m)}</div>
                      )}
                    </div>
                    <Crown className="w-4 h-4 mt-1 text-[#FFD700] shrink-0" />
                  </div>
                  {m.role_title && (
                    <div className="mt-2 text-[10px] uppercase tracking-widest text-[#FFD700]/90 font-bold">{m.role_title}</div>
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
                    <div className="flex items-center justify-between gap-2 pt-1">
                      {(m.level || m.age) && <div className="text-[10px] text-[#FFD700]/80 uppercase tracking-widest font-bold">Level {m.level || m.age}</div>}
                      {m.linked_account?.achievement_level && (
                        <div className="text-[10px] text-[#29B6E8] uppercase tracking-widest font-bold">
                          Account-Level {m.linked_account.achievement_level.level}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="mt-4 inline-flex items-center gap-2 text-[10px] uppercase tracking-widest font-bold text-white/45 group-hover:text-[#FFD700] transition">
                    Profil ansehen <ArrowRight className="w-3.5 h-3.5" />
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
