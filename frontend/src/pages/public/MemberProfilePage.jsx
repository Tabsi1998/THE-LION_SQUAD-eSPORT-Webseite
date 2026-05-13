import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Crown, ExternalLink, Gamepad2, Medal, Monitor, Radio, Trophy, User as UserIcon, Users } from "lucide-react";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { Breadcrumbs } from "@/components/tls/Breadcrumbs";
import { RichContent } from "@/components/tls/RichContent";
import { StreamEmbed } from "@/components/tls/StreamEmbed";
import { AccountLevelPill, AccountLevelProgress, accountAvatarFrameClass, accountLevelFrameClass } from "@/components/tls/AccountLevel";
import { api, resolveMediaUrl } from "@/lib/api";
import { gameLabel } from "@/lib/gameLabels";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";

export default function MemberProfilePage() {
  const { slug } = useParams();
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  useDocumentTitle(profile?.display_name || "Vereinsmitglied", profile?.bio || "Vereinsmitglied bei THE LION SQUAD eSports.", {
    image: profile?.avatar_url || profile?.banner_url,
    type: "profile",
    canonical: profile?.slug ? `${window.location.origin}/members/${profile.slug}` : undefined,
  });

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
                <MemberTwitchEmbed account={profile.linked_account} />
                <MemberReferences profile={profile} />
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

function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("de-DE", { dateStyle: "medium" });
}

function referencePlacementText(item) {
  if (item.placement_label) return item.placement_label;
  if (!item.placement) return "Teilnahme";
  return `Platz ${item.placement}${item.participant_count ? ` von ${item.participant_count}` : ""}`;
}

function referenceTone(item) {
  if (item.medal === "gold") return "border-[#FFD700]/45 bg-[#FFD700]/10 text-[#FFD700]";
  if (item.medal === "silver") return "border-white/30 bg-white/10 text-white";
  if (item.medal === "bronze") return "border-[#CD7F32]/45 bg-[#CD7F32]/10 text-[#CD7F32]";
  return "border-[#29B6E8]/30 bg-[#29B6E8]/10 text-[#29B6E8]";
}

function MemberReferences({ profile }) {
  const references = profile.references || [];
  const stats = profile.reference_stats || {};
  if (!references.length) return null;
  return (
    <section className="mt-8">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.3em] text-[#FFD700]">
            <Trophy className="w-3.5 h-3.5" /> Referenzen
          </div>
          <h2 className="mt-1 font-heading text-2xl font-black uppercase">Vereinsplatzierungen</h2>
        </div>
        <Link to="/references" className="inline-flex items-center gap-2 border border-[#29B6E8]/45 px-3 py-2 text-xs font-bold uppercase tracking-wider text-[#29B6E8] hover:bg-[#29B6E8]/10 rounded-sm">
          Alle Referenzen <ExternalLink className="w-3.5 h-3.5" />
        </Link>
      </div>
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 mb-4">
        <ReferenceStat label="Gold" value={stats.gold || 0} color="#FFD700" />
        <ReferenceStat label="Silber" value={stats.silver || 0} color="#D8DDE5" />
        <ReferenceStat label="Bronze" value={stats.bronze || 0} color="#CD7F32" />
        <ReferenceStat label="Podest" value={stats.podiums || 0} color="#29B6E8" />
        <ReferenceStat label="Solo" value={stats.solo || 0} />
        <ReferenceStat label="Team" value={stats.team || 0} />
      </div>
      <div className="space-y-3">
        {references.map((item) => <MemberReferenceCard key={item.id} item={item} />)}
      </div>
    </section>
  );
}

function ReferenceStat({ label, value, color = "#FFFFFF" }) {
  return (
    <div className="border border-white/10 bg-[#121212] rounded-sm px-3 py-2">
      <div className="text-[10px] uppercase tracking-widest text-white/40 font-bold">{label}</div>
      <div className="font-display text-xl font-bold tabular-nums" style={{ color }}>{value}</div>
    </div>
  );
}

function MemberReferenceCard({ item }) {
  const members = item.lineup_members || [];
  const otherLineup = (item.lineup || []).filter(Boolean);
  return (
    <Link to={`/references/${item.id}`} className="block border border-white/10 bg-[#121212] rounded-sm hover:border-[#29B6E8]/55 transition">
      <div className="p-4 flex gap-4">
        <div className={`w-16 shrink-0 border rounded-sm flex flex-col items-center justify-center ${referenceTone(item)}`}>
          {item.placement ? (
            <>
              <Medal className="w-5 h-5 mb-1" />
              <span className="font-display text-2xl font-black tabular-nums">{item.placement}.</span>
            </>
          ) : (
            <>
              <Trophy className="w-5 h-5 mb-1" />
              <span className="text-[10px] uppercase tracking-widest font-black">Dabei</span>
            </>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`inline-flex px-2 py-1 border rounded-sm text-[10px] uppercase tracking-widest font-bold ${referenceTone(item)}`}>{referencePlacementText(item)}</span>
            <span className="text-[10px] uppercase tracking-widest text-[#29B6E8] font-bold">{gameLabel(item.game) || item.game_name || "Extern"}</span>
            {formatDate(item.start_date) && <span className="text-[10px] uppercase tracking-widest text-white/35">{formatDate(item.start_date)}</span>}
          </div>
          <div className="mt-2 font-heading text-lg font-black uppercase leading-tight break-words">{item.title}</div>
          <div className="mt-1 text-xs text-white/55 truncate">{item.team_name || item.organizer || "THE LION SQUAD"}</div>
          {(members.length > 0 || otherLineup.length > 0) && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {members.map((member) => (
                <span key={member.profile_id || member.display_name} className="inline-flex items-center gap-1.5 border border-[#29B6E8]/25 bg-[#29B6E8]/10 rounded-sm px-2 py-1 text-xs text-white/75">
                  {member.avatar_url ? <img src={resolveMediaUrl(member.avatar_url)} alt="" className="w-4 h-4 rounded-sm object-cover" /> : <Users className="w-3 h-3 text-white/35" />}
                  {member.display_name}
                </span>
              ))}
              {otherLineup.map((name) => <span key={name} className="border border-white/10 bg-black/30 rounded-sm px-2 py-1 text-xs text-white/50">{name}</span>)}
            </div>
          )}
        </div>
        <ExternalLink className="w-4 h-4 text-white/25 shrink-0 mt-1" />
      </div>
    </Link>
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
    <div className="relative min-h-[25rem] overflow-visible bg-[#0D0D0D] rounded-sm">
      {profile.cover_url && (
        <img src={resolveMediaUrl(profile.cover_url)} alt="" className="absolute inset-0 w-full h-full object-cover opacity-32" />
      )}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_25%_25%,rgba(255,215,0,0.13),rgba(41,182,232,0.07)_36%,rgba(10,10,10,0)_70%)]" />
      <div className="absolute inset-0 bg-gradient-to-t from-[#0A0A0A] via-[#0A0A0A]/68 to-[#0A0A0A]/10" />
      <div className="relative z-10 min-h-[25rem] grid md:grid-cols-[18rem_1fr] gap-4 items-end p-5 sm:p-8">
        <div className="relative h-80 md:h-[22rem] flex items-end justify-center md:justify-start -mb-10 md:-mb-12">
          <div className="absolute inset-x-8 bottom-5 h-10 bg-black/50 blur-2xl rounded-full" />
          {profile.photo_url ? (
            <img src={resolveMediaUrl(profile.photo_url)} alt="" className="relative z-10 max-h-[122%] w-full object-contain object-bottom drop-shadow-[0_30px_48px_rgba(0,0,0,0.62)]" />
          ) : (
            <div className="relative z-10 w-44 h-56 flex items-center justify-center text-white/20"><UserIcon className="w-12 h-12" /></div>
          )}
        </div>
        <div className="pb-3 md:pb-8">
          <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#FFD700]">Vereinsmitglied</span>
          <h1 className="mt-2 font-heading text-5xl md:text-7xl font-black uppercase leading-none break-words">{memberGamertag(profile)}</h1>
          {memberRealName(profile) && <p className="mt-2 text-white/60 font-bold">{memberRealName(profile)}</p>}
          {profile.role_title && <p className="mt-2 text-[#FFD700] font-bold uppercase tracking-wider">{profile.role_title}</p>}
        </div>
      </div>
    </div>
  );
}

function MemberTwitchEmbed({ account }) {
  if (!account?.show_twitch_embed || !account?.twitch_handle) return null;
  const twitchUrl = `https://www.twitch.tv/${account.twitch_handle}`;
  return (
    <div className="mt-8" data-testid="member-profile-twitch-embed">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.3em] text-[#9146FF]">
            <Radio className="w-3.5 h-3.5" /> Twitch
          </div>
          <h2 className="mt-1 font-heading text-2xl font-black uppercase">Stream im Vereinsprofil</h2>
          <p className="mt-1 text-xs text-white/45">
            Eingebettet vom verknuepften normalen Profil {account.username ? `@${account.username}` : ""}.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {account.profile_url && (
            <Link to={account.profile_url} className="inline-flex items-center gap-2 border border-[#29B6E8]/45 px-3 py-2 text-xs font-bold uppercase tracking-wider text-[#29B6E8] hover:bg-[#29B6E8]/10 rounded-sm">
              Normales Profil <ExternalLink className="w-3.5 h-3.5" />
            </Link>
          )}
          <a href={twitchUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 border border-[#9146FF]/50 px-3 py-2 text-xs font-bold uppercase tracking-wider text-[#b88cff] hover:bg-[#9146FF]/10 rounded-sm">
            Twitch <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>
      </div>
      <StreamEmbed source={{
        twitch_enabled: true,
        twitch_channel: account.twitch_handle,
        stream_platform: "twitch",
        stream_title: "Twitch Stream",
        stream_url: twitchUrl,
      }} />
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
        className={`mt-2 group block border ${accountLevelFrameClass(level)} bg-[#08151A] rounded-sm p-3 hover:border-[#29B6E8] hover:bg-[#0B1D24] transition`}
      >
        <div className="flex items-center gap-3">
          <div className={`w-14 h-14 rounded-sm border ${accountAvatarFrameClass(level)} bg-[#0A0A0A] overflow-hidden shrink-0`}>
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
              <AccountLevelPill level={level} className="shrink-0 px-1.5 py-0 text-[9px]" />
              <div className="flex-1"><AccountLevelProgress level={level} progress={progress} compact /></div>
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
