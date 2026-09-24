import { BadgeCheck, ExternalLink, Link2, Unlink } from "lucide-react";
import { Row, Section } from "./fields";
import { ProfileSwitch } from "./SwitchRow";
import { SOCIAL_PLATFORMS, normalizeSocialInput, socialProfileUrl } from "./socials";
import { NOT_LINKABLE, PLATFORM_BY_FIELD, formatLinkedAt, linkForField } from "@/lib/platformLinks";

// Socials (#258): je Feld ein Plattform-Symbol, eine eingefügte Adresse wird
// sofort zum Nutzernamen, daneben ein Vorschau-Link. Der Twitch-Schalter
// steht direkt beim Twitch-Feld.
// Discord, Twitch und Steam lassen sich verknüpfen (#260): dann ist das Feld
// gesperrt und trägt „verifiziert“; „Trennen“ lässt den Text stehen.
const TEST_IDS = { discord_name: "profile-discord", twitch_handle: "profile-twitch", steam_id: "profile-steam" };

function testIdFor(key) {
  return TEST_IDS[key] || `profile-${key.replace(/_(handle|id|name|fc)$/, "")}`;
}

// Beim Tippen bleibt der Text, wie er ist; nur eine Adresse (mit Host und
// Pfad) wird sofort bereinigt, damit Einfügen wie erwartet wirkt. Beim
// Verlassen des Felds wird vollständig bereinigt (führendes @, Leerzeichen).
function whileTyping(key, value) {
  return /:\/\/|\.[a-z]{2,}\//i.test(value) ? normalizeSocialInput(key, value) : value;
}

function SocialField({ platform, value, onChange, link, linkable, onLink, onUnlink }) {
  const Icon = platform.icon;
  const testId = testIdFor(platform.k);
  const preview = socialProfileUrl(platform.k, value);
  const platformKey = PLATFORM_BY_FIELD[platform.k];
  return (
    <div>
      <label className="block">
        <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">
          <Icon className="w-3.5 h-3.5 text-[#29B6E8]" aria-hidden="true" /> {platform.l}
          {link && <span className="inline-flex items-center gap-1 text-[#00FF88] normal-case tracking-normal" data-testid={`${testId}-verified`}><BadgeCheck className="w-3.5 h-3.5" aria-hidden="true" /> verifiziert</span>}
        </div>
        <input
          value={value ?? ""}
          onChange={(e) => onChange(whileTyping(platform.k, e.target.value))}
          onBlur={(e) => onChange(normalizeSocialInput(platform.k, e.target.value))}
          placeholder={platform.placeholder}
          data-testid={testId}
          disabled={Boolean(link)}
          className="w-full bg-[#0A0A0A] border border-white/10 focus:border-[#29B6E8] px-3 py-2 rounded-sm text-white disabled:opacity-70"
        />
      </label>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
        {preview ? (
          <a
            href={preview}
            target="_blank"
            rel="noopener noreferrer"
            data-testid={`${testId}-preview`}
            className="inline-flex items-center gap-1 text-[11px] text-white/45 hover:text-[#29B6E8] break-all"
          >
            <ExternalLink className="w-3 h-3 shrink-0" aria-hidden="true" /> {preview}
          </a>
        ) : null}
        {platformKey && link && (
          <>
            <span className="text-[11px] text-white/45" data-testid={`${testId}-linked-since`}>
              verknüpft{link.display_name ? ` als ${link.display_name}` : ""}{formatLinkedAt(link.linked_at) ? ` seit ${formatLinkedAt(link.linked_at)}` : ""}
            </span>
            {link.url && (
              <a href={link.url} target="_blank" rel="noopener noreferrer" data-testid={`${testId}-official`} className="inline-flex items-center gap-1 text-[11px] text-[#29B6E8] hover:text-white">
                <ExternalLink className="w-3 h-3 shrink-0" aria-hidden="true" /> Bei {platform.l} öffnen
              </a>
            )}
            <button type="button" onClick={() => onUnlink(platformKey)} data-testid={`${testId}-unlink`} className="inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider text-white/55 hover:text-[#FF3B30]">
              <Unlink className="w-3 h-3" aria-hidden="true" /> Trennen
            </button>
          </>
        )}
        {platformKey && !link && (
          <button type="button" onClick={() => onLink(platformKey)} disabled={!linkable} title={linkable ? undefined : "Auf der Website noch nicht eingerichtet"} data-testid={`${testId}-link`} className="inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider text-[#29B6E8] hover:text-white disabled:opacity-40 disabled:cursor-not-allowed">
            <Link2 className="w-3 h-3" aria-hidden="true" /> Mit {platform.l} verknüpfen
          </button>
        )}
        {!platformKey && NOT_LINKABLE[platform.k] && (
          <span className="text-[11px] text-white/35" data-testid={`${testId}-not-linkable`}>{NOT_LINKABLE[platform.k]}</span>
        )}
      </div>
    </div>
  );
}

const byKey = Object.fromEntries(SOCIAL_PLATFORMS.map((platform) => [platform.k, platform]));
const ROWS = [
  ["discord_name", "twitch_handle"],
  ["youtube_handle", "instagram_handle"],
  ["tiktok_handle", "x_handle"],
  ["steam_id", "epic_id"],
  ["psn_id", "xbox_id"],
  ["nintendo_fc", "ea_id"],
  ["riot_id", "battlenet_id"],
];

export function SocialsTab({ form, set, links = null, onLink = () => {}, onUnlink = () => {} }) {
  const available = links?.available || {};
  const delivers = links?.platforms || {};
  const linkedRows = links?.links || [];
  return (
    <Section>
      <div className="border border-[#29B6E8]/25 bg-[#29B6E8]/5 rounded-sm p-3 text-xs text-white/65" data-testid="profile-links-hint">
        <strong className="text-white">Konto verknüpfen statt tippen:</strong> Wo ein Knopf „verknüpfen“ steht, meldest du dich einmal bei der Plattform an – der Eintrag wird befüllt und trägt „verifiziert“, sichtbar im öffentlichen Profil und bei Turnieren. Die Website erhält dabei nur {Object.keys(delivers).map((key) => delivers[key]?.delivers).filter(Boolean).join("; ") || "Kennung und Nutzername des Kontos"}. Trennen geht jederzeit; der Text bleibt dann stehen, das Häkchen nicht.
      </div>
      {ROWS.map((keys) => (
        <div key={keys.join("+")} className="space-y-4">
          <Row>
            {keys.map((key) => (
              <SocialField
                key={key}
                platform={byKey[key]}
                value={form[key]}
                onChange={(v) => set(key, v)}
                link={linkForField(linkedRows, key)}
                linkable={Boolean(available[PLATFORM_BY_FIELD[key]])}
                onLink={onLink}
                onUnlink={onUnlink}
              />
            ))}
          </Row>
          {keys.includes("twitch_handle") && form.twitch_handle ? (
            <div className="flex items-start justify-between gap-4 p-3 border border-[#9146FF]/30 bg-[#9146FF]/5 rounded-sm">
              <div className="text-sm">
                <div className="font-bold text-white">Twitch-Live-Embed im öffentlichen Profil zeigen</div>
                <div className="text-white/60 text-xs mt-1">Wenn du live bist, erscheint dein Stream als eingebetteter Player auf deinem öffentlichen Profil.</div>
              </div>
              <ProfileSwitch
                label="Twitch-Live-Embed im öffentlichen Profil zeigen"
                checked={!!form.show_twitch_embed}
                onCheckedChange={(checked) => set("show_twitch_embed", checked)}
                testId="profile-twitch-embed"
                className="mt-0.5"
              />
            </div>
          ) : null}
        </div>
      ))}
      <SocialField platform={byKey.website} value={form.website} onChange={(v) => set("website", v)} link={null} linkable={false} onLink={onLink} onUnlink={onUnlink} />
    </Section>
  );
}
