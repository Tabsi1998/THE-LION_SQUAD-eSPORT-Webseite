import { ExternalLink } from "lucide-react";
import { Row, Section } from "./fields";
import { ProfileSwitch } from "./SwitchRow";
import { SOCIAL_PLATFORMS, normalizeSocialInput, socialProfileUrl } from "./socials";

// Socials (#258): je Feld ein Plattform-Symbol, eine eingefügte Adresse wird
// sofort zum Nutzernamen, daneben ein Vorschau-Link. Der Twitch-Schalter
// steht direkt beim Twitch-Feld.
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

function SocialField({ platform, value, onChange }) {
  const Icon = platform.icon;
  const testId = testIdFor(platform.k);
  const preview = socialProfileUrl(platform.k, value);
  return (
    <div>
      <label className="block">
        <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">
          <Icon className="w-3.5 h-3.5 text-[#29B6E8]" aria-hidden="true" /> {platform.l}
        </div>
        <input
          value={value ?? ""}
          onChange={(e) => onChange(whileTyping(platform.k, e.target.value))}
          onBlur={(e) => onChange(normalizeSocialInput(platform.k, e.target.value))}
          placeholder={platform.placeholder}
          data-testid={testId}
          className="w-full bg-[#0A0A0A] border border-white/10 focus:border-[#29B6E8] px-3 py-2 rounded-sm text-white"
        />
      </label>
      {preview ? (
        <a
          href={preview}
          target="_blank"
          rel="noopener noreferrer"
          data-testid={`${testId}-preview`}
          className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-white/45 hover:text-[#29B6E8] break-all"
        >
          <ExternalLink className="w-3 h-3 shrink-0" aria-hidden="true" /> {preview}
        </a>
      ) : null}
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

export function SocialsTab({ form, set }) {
  return (
    <Section>
      {ROWS.map((keys) => (
        <div key={keys.join("+")} className="space-y-4">
          <Row>
            {keys.map((key) => <SocialField key={key} platform={byKey[key]} value={form[key]} onChange={(v) => set(key, v)} />)}
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
      <SocialField platform={byKey.website} value={form.website} onChange={(v) => set("website", v)} />
    </Section>
  );
}
