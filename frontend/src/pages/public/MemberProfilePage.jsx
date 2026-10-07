import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Crown, ExternalLink, Gamepad2, Monitor, Radio, Trophy, User as UserIcon } from "lucide-react";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { Breadcrumbs } from "@/components/tls/Breadcrumbs";
import { RichContent } from "@/components/tls/RichContent";
import { StreamEmbed } from "@/components/tls/StreamEmbed";
import { AccountLevelPill, AccountLevelProgress, accountLevelFrameClass } from "@/components/tls/AccountLevel";
import { LevelAvatarFrame } from "@/components/tls/LevelAvatarFrame";
import { CountLine, MedalStat, ReferenceCard, SectionTitle, entriesOf } from "@/components/tls/references/referenceParts";
import { api, resolveMediaUrl } from "@/lib/api";
import { seoTextPreview } from "@/lib/textPreview";
import { useCanonicalSlugRedirect } from "@/hooks/useCanonicalSlugRedirect";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";

export default function MemberProfilePage() {
  const { slug } = useParams();
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const seoDescription = seoTextPreview(profile?.bio, "Vereinsmitglied bei THE LION SQUAD eSports aus Tirol.");
  useDocumentTitle(profile?.display_name || "Vereinsmitglied", seoDescription, {
    image: profile?.avatar_url || profile?.banner_url,
    type: "profile",
    canonical: profile?.slug ? `${window.location.origin}/members/${profile.slug}` : undefined,
  });
  useCanonicalSlugRedirect(slug, profile?.slug, "/members");

  useEffect(() => {
    setLoading(true);
    api.get(`/membership/profiles/${slug}`)
      .then(({ data }) => setProfile(data))
      .catch(() => setProfile(null))
      .finally(() => setLoading(false));
  }, [slug]);

  return (
    <PublicLayout>
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
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

            <div className="mt-8 grid xl:grid-cols-[minmax(0,1fr)_21rem] gap-8 items-start">
              <div className="min-w-0">
                {profile.bio ? (
                  <RichContent text={profile.bio} />
                ) : (
                  <div className="text-white/45 text-sm">Noch keine Biografie hinterlegt.</div>
                )}
              </div>
              <aside className="space-y-4">
                <InfoPanel title="Profil">
                  <InfoChips icon={Gamepad2} label="Games" values={profile.games} />
                  <InfoChips icon={Monitor} label="Plattformen" values={profile.platforms} />
                  {/* Weitere Angaben aus der Vereinsakte (Vereine 1.2): Zusatzfelder, die keiner Spalte zugeordnet sind. */}
                  {(profile.extra_fields || []).length > 0 && (
                    <dl className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm" data-testid="member-extra-fields">
                      {profile.extra_fields.map((row) => (
                        <div key={row.code} className="flex gap-2">
                          <dt className="text-white/50 shrink-0">{row.label}:</dt>
                          <dd className="text-white/85">{row.value}</dd>
                        </div>
                      ))}
                    </dl>
                  )}
                  <LinkedAccountCard account={profile.linked_account} />
                </InfoPanel>
                <MemberTwitchEmbed account={profile.linked_account} />
                <Link to="/members" className="tls-btn tls-btn--quiet w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-sm text-xs font-bold uppercase tracking-wider">
                  <ArrowLeft className="w-4 h-4" /> Alle Mitglieder
                </Link>
              </aside>
            </div>
            <MemberReferences profile={profile} />
          </>
        )}
      </section>
    </PublicLayout>
  );
}

/** Der eigene Eintrag einer Teilnahme (#409): ein Einzelstarter zeigt seine Platzierung, ein Teammitglied die seines Teams. */
export function memberEntry(item) {
  return item.member_entry || entriesOf(item)[0] || item;
}

/**
 * Vereinsplatzierungen im Mitgliederprofil (#859): dieselben Bausteine wie die Referenzen-Seite - Medaillen mit
 * Zahlen, darunter Podest, Einzel und Team, dann je Teilnahme die Karte mit der Platzierung dieser Person.
 */
function MemberReferences({ profile }) {
  const references = profile.references || [];
  const stats = profile.reference_stats || {};
  if (!references.length) return null;
  return (
    <section className="mt-10 border-t border-white/10 pt-8" data-testid="member-references">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <SectionTitle icon={Trophy} accent="#FFD700" eyebrow="Referenzen" title="Vereinsplatzierungen" />
        <Link to={`/references?${new URLSearchParams({ member: profile.id, name: profile.gamertag || profile.display_name || "" })}`} data-testid="member-references-all" className="tls-btn tls-btn--quiet inline-flex items-center gap-2 px-3 py-2 text-xs font-bold uppercase tracking-wider rounded-sm">
          Alle Referenzen
        </Link>
      </div>
      <div className="mt-6 grid grid-cols-3 gap-2 sm:gap-3 max-w-3xl" data-testid="member-reference-numbers">
        <MedalStat medal="gold" value={stats.gold || 0} testId="member-reference-stat-gold" />
        <MedalStat medal="silver" value={stats.silver || 0} testId="member-reference-stat-silver" />
        <MedalStat medal="bronze" value={stats.bronze || 0} testId="member-reference-stat-bronze" />
      </div>
      <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm text-white/60">
        <CountLine label="Podestplätze" value={stats.podiums || 0} testId="member-reference-stat-podiums" />
        <CountLine label="als Einzelstarter" value={stats.solo || 0} testId="member-reference-stat-solo" />
        <CountLine label="im Team" value={stats.team || 0} testId="member-reference-stat-team" />
      </div>
      <div className="mt-6 grid lg:grid-cols-2 gap-3">
        {references.map((item) => <ReferenceCard key={item.id} item={item} entry={memberEntry(item)} testId={`member-reference-${item.id}`} />)}
      </div>
    </section>
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
    <div data-testid="member-profile-twitch-embed" className="border border-white/10 bg-[#121212] rounded-sm p-4">
      <div className="mb-3">
        <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-[#9146FF]">
          <Radio className="w-3 h-3" /> Twitch
        </div>
        <div className="mt-1 font-heading font-black uppercase text-sm">Stream</div>
      </div>
      <StreamEmbed source={{
        twitch_enabled: true,
        twitch_channel: account.twitch_handle,
        stream_platform: "twitch",
        stream_title: account.username ? `@${account.username}` : "Twitch",
        stream_url: twitchUrl,
      }} compact showExternalLink={false} />
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
        className={`tls-card mt-2 group block border ${accountLevelFrameClass(level)} bg-[#08151A] rounded-sm p-3`}
      >
        <div className="flex items-center gap-3">
          <LevelAvatarFrame level={level} compact className="w-14 h-14 shrink-0">
            {account.avatar_url ? (
              <img src={resolveMediaUrl(account.avatar_url)} alt="" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-white/25"><UserIcon className="w-6 h-6" /></div>
            )}
          </LevelAvatarFrame>
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
