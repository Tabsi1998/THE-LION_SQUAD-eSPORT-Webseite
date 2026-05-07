import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Crown, ExternalLink, Gamepad2, Monitor, User as UserIcon } from "lucide-react";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { Breadcrumbs } from "@/components/tls/Breadcrumbs";
import { RichContent } from "@/components/tls/RichContent";
import { api, resolveMediaUrl } from "@/lib/api";

export default function MemberProfilePage() {
  const { slug } = useParams();
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.get(`/membership/profiles/${slug}`)
      .then(({ data }) => setProfile(data))
      .catch(() => setProfile(null))
      .finally(() => setLoading(false));
  }, [slug]);

  return (
    <PublicLayout>
      <section className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <Breadcrumbs items={[{ label: "Home", to: "/" }, { label: "Vereinsmitglieder", to: "/members" }, { label: profile?.display_name || "Profil" }]} className="mb-6" />

        {loading ? (
          <div className="text-white/40 text-sm">Lade Profil...</div>
        ) : !profile ? (
          <div className="border border-dashed border-white/15 bg-[#121212] rounded-sm p-12 text-center">
            <UserIcon className="w-9 h-9 mx-auto text-white/20 mb-3" />
            <h1 className="font-heading text-2xl font-black uppercase">Mitglied nicht gefunden</h1>
            <Link to="/members" className="mt-4 inline-flex items-center gap-2 text-[#29B6E8] text-sm font-bold uppercase tracking-wider">
              <ArrowLeft className="w-4 h-4" /> Zur Übersicht
            </Link>
          </div>
        ) : (
          <>
            <MemberHero profile={profile} />

            <div className="mt-8 grid lg:grid-cols-[1fr_20rem] gap-8">
              <div className="min-w-0">
                {profile.bio ? (
                  <RichContent text={profile.bio} />
                ) : (
                  <div className="text-white/45 text-sm">Noch keine Biografie hinterlegt.</div>
                )}
              </div>
              <aside className="space-y-4">
                <InfoPanel title="Profil">
                  {(profile.level || profile.age) && <InfoLine label="Level" value={`Level ${profile.level || profile.age}`} />}
                  <InfoChips icon={Gamepad2} label="Games" values={profile.games} />
                  <InfoChips icon={Monitor} label="Plattformen" values={profile.platforms} />
                  <LinkedAccountCard account={profile.linked_account} />
                </InfoPanel>
                <Link to="/members" className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 border border-white/10 text-white/70 rounded-sm text-xs font-bold uppercase tracking-wider hover:text-white hover:bg-white/5">
                  <ArrowLeft className="w-4 h-4" /> Alle Mitglieder
                </Link>
              </aside>
            </div>
          </>
        )}
      </section>
    </PublicLayout>
  );
}

function memberGamertag(profile) {
  return profile?.gamertag || profile?.linked_account?.username || profile?.display_name;
}

function memberRealName(profile) {
  const tag = memberGamertag(profile);
  return profile?.real_name || (profile?.display_name && profile.display_name !== tag ? profile.display_name : "");
}

function MemberHero({ profile }) {
  return (
    <div className="relative min-h-[24rem] overflow-hidden bg-[#101010] rounded-sm">
      {(profile.cover_url || profile.photo_url) && (
        <img src={resolveMediaUrl(profile.cover_url || profile.photo_url)} alt="" className="absolute inset-0 w-full h-full object-cover opacity-35" />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-[#0A0A0A] via-[#0A0A0A]/65 to-transparent" />
      <div className="relative z-10 min-h-[24rem] grid md:grid-cols-[17rem_1fr] gap-4 items-end p-5 sm:p-8">
        <div className="relative h-72 md:h-80 flex items-end justify-center md:justify-start -mb-8 md:-mb-10">
          {profile.photo_url ? (
            <img src={resolveMediaUrl(profile.photo_url)} alt="" className="max-h-[115%] w-full object-contain object-bottom drop-shadow-[0_26px_44px_rgba(0,0,0,0.55)]" />
          ) : (
            <div className="w-44 h-56 flex items-center justify-center text-white/20"><UserIcon className="w-12 h-12" /></div>
          )}
        </div>
        <div className="pb-3 md:pb-8">
          <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#FFD700]">Vereinsmitglied</span>
          <h1 className="mt-2 font-heading text-5xl md:text-7xl font-black uppercase leading-none">{memberGamertag(profile)}</h1>
          {memberRealName(profile) && <p className="mt-2 text-white/60 font-bold">{memberRealName(profile)}</p>}
          {profile.role_title && <p className="mt-2 text-[#FFD700] font-bold uppercase tracking-wider">{profile.role_title}</p>}
        </div>
      </div>
    </div>
  );
}

function LinkedAccountCard({ account }) {
  if (!account?.profile_url) return null;
  const level = account.achievement_level?.level || 1;
  const progress = account.achievement_level?.progress || 0;
  return (
    <div>
      <div className="text-[10px] uppercase tracking-widest text-white/40 font-bold">Plattformkonto</div>
      <Link
        to={account.profile_url}
        className="mt-2 group block border border-[#29B6E8]/30 bg-[#08151A] rounded-sm p-3 hover:border-[#29B6E8] hover:bg-[#0B1D24] transition"
      >
        <div className="flex items-center gap-3">
          <div className="w-14 h-14 rounded-sm border border-white/10 bg-[#0A0A0A] overflow-hidden shrink-0">
            {account.avatar_url ? (
              <img src={resolveMediaUrl(account.avatar_url)} alt="" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-white/25"><UserIcon className="w-6 h-6" /></div>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-heading font-black uppercase truncate text-white group-hover:text-[#29B6E8]">{account.display_name || account.username}</div>
            <div className="text-xs text-white/45 truncate">@{account.username}</div>
            <div className="mt-2 flex items-center gap-2">
              <span className="text-[10px] uppercase tracking-widest font-bold text-[#FFD700]">Level {level}</span>
              <div className="h-1 flex-1 bg-white/10 rounded-full overflow-hidden">
                <div className="h-full bg-[#FFD700]" style={{ width: `${progress}%` }} />
              </div>
            </div>
          </div>
          <ExternalLink className="w-4 h-4 text-white/35 group-hover:text-[#29B6E8] shrink-0" />
        </div>
      </Link>
    </div>
  );
}

function InfoPanel({ title, children }) {
  return (
    <div className="border border-white/10 bg-[#121212] rounded-sm p-5">
      <div className="font-heading font-black uppercase flex items-center gap-2">
        <Crown className="w-4 h-4 text-[#FFD700]" /> {title}
      </div>
      <div className="mt-4 space-y-4">{children}</div>
    </div>
  );
}

function InfoLine({ label, value }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-widest text-white/40 font-bold">{label}</div>
      <div className="mt-1 text-white/85 font-bold">{value}</div>
    </div>
  );
}

function InfoChips({ icon: Icon, label, values }) {
  if (!values?.length) return null;
  return (
    <div>
      <div className="text-[10px] uppercase tracking-widest text-white/40 font-bold flex items-center gap-1.5"><Icon className="w-3 h-3" /> {label}</div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {values.map((value) => <span key={value} className="px-2 py-1 bg-white/5 border border-white/10 rounded-sm text-xs text-white/70">{value}</span>)}
      </div>
    </div>
  );
}
