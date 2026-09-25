import { useState } from "react";
import { Link } from "react-router-dom";
import { BadgeCheck, ExternalLink, Lock, Unlink } from "lucide-react";
import { Row, Section } from "./fields";
import { ProfileSwitch } from "./SwitchRow";
import { SOCIAL_PLATFORMS, normalizeSocialInput, socialProfileUrl } from "./socials";
import { MANUAL_PLATFORM_OF, NOT_LINKABLE, PLATFORM_BY_FIELD, PLATFORM_LABELS, formatLinkedAt, linkForField, platformsOff } from "@/lib/platformLinks";
import { PlatformIcon, brandButtonStyle, linkButtonLabel, platformMeta } from "@/lib/platformBrand";

// Socials (#258, #260, #521): Wo die Plattform eine Anmeldung bietet, gibt es nur noch den offiziellen
// Knopf „Mit … verknüpfen“ - der Name kommt von der Plattform, tippen muss niemand mehr. Verknüpft
// steht der Name mit Häkchen und „seit …“, dazu „Verknüpfung lösen“. Von Hand eingetragen wird nur, was
// sich nicht verknüpfen lässt (PlayStation, Nintendo, EA, Instagram, Website) oder was die Website noch
// nicht eingerichtet hat. Die Sichtbarkeit je Konto regelt der Reiter Privatsphäre - auch für den
// verknüpften Namen.
const TEST_IDS = { discord_name: "profile-discord", twitch_handle: "profile-twitch", steam_id: "profile-steam" };
const LINK_ORDER = ["discord", "twitch", "steam", "battlenet", "x", "youtube", "tiktok", "riot", "xbox", "epic", "faceit", "startgg", "roblox", "osu", "lichess", "github", "kick", "reddit", "spotify", "threads", "facebook", "linkedin", "snapchat", "pinterest", "telegram", "wargaming", "bungie", "mastodon", "bluesky"];
const FIELD_BY_PLATFORM = Object.fromEntries(Object.entries(PLATFORM_BY_FIELD).map(([field, key]) => [key, field]));
const MANUAL_ROWS = [["instagram_handle", "psn_id"], ["nintendo_fc", "ea_id"]];

export function testIdFor(key) {
  return TEST_IDS[key] || `profile-${key.replace(/_(handle|id|name|fc)$/, "")}`;
}

// Beim Tippen bleibt der Text, wie er ist; nur eine Adresse (mit Host und Pfad) wird sofort bereinigt,
// damit Einfügen wie erwartet wirkt. Beim Verlassen des Felds wird vollständig bereinigt.
function whileTyping(key, value) {
  return /:\/\/|\.[a-z]{2,}\//i.test(value) ? normalizeSocialInput(key, value) : value;
}

const byKey = Object.fromEntries(SOCIAL_PLATFORMS.map((platform) => [platform.k, platform]));

function ManualField({ platform, value, onChange, note = "" }) {
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
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
        {preview ? (
          <a href={preview} target="_blank" rel="noopener noreferrer" data-testid={`${testId}-preview`} className="inline-flex items-center gap-1 text-[11px] text-white/45 hover:text-[#29B6E8] break-all">
            <ExternalLink className="w-3 h-3 shrink-0" aria-hidden="true" /> {preview}
          </a>
        ) : null}
        {note ? <span className="text-[11px] text-white/35" data-testid={`${testId}-not-linkable`}>{note}</span> : null}
      </div>
    </div>
  );
}

// Eine Zeile je verknüpfbarer Plattform: Logo in Plattformfarbe, Stand, offizieller Knopf oder „lösen“.
function LinkRow({ platformKey, link, available, form, set, onLink, onUnlink, input = null }) {
  const meta = platformMeta({ platform: platformKey });
  // Mastodon/Bluesky (#547 Welle 3): vor dem Start tippt die Person die Instanz bzw. den Handle ein.
  const [inputValue, setInputValue] = useState("");
  const inputMissing = Boolean(input?.required) && !inputValue.trim();
  const label = PLATFORM_LABELS[platformKey] || meta.label;
  const field = FIELD_BY_PLATFORM[platformKey];
  const testId = testIdFor(field);
  const since = link ? formatLinkedAt(link.linked_at) : "";
  const numericName = /^\d{17}$/.test(String(link?.display_name || ""));
  const linkedName = link ? (numericName ? `${label}-Profil ${link.display_name}` : (link.display_name || link.handle || label)) : "";
  return (
    <div data-testid={`${testId}-row`} className={`flex flex-wrap items-center gap-3 border rounded-sm px-3 py-2.5 bg-[#0A0A0A] ${link ? "border-[var(--social-color)]/60 shadow-[0_0_18px_-6px_var(--social-color)]" : "border-white/10"}`} style={{ "--social-color": meta.color }}>
      <span className="w-10 h-10 shrink-0 rounded-sm flex items-center justify-center border-2 border-[var(--social-color)] text-[var(--social-color)] bg-black/40">
        <PlatformIcon kind={meta.key} className="w-5 h-5" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-sm font-bold text-white">
          <span>{label}</span>
          {link && <span className="inline-flex items-center gap-1 text-[#00FF88] text-[11px] font-bold" data-testid={`${testId}-verified`}><BadgeCheck className="w-3.5 h-3.5" aria-hidden="true" /> verifiziert</span>}
        </div>
        {link ? (
          <div className="text-[11px] text-white/55 truncate" data-testid={`${testId}-linked-since`}>
            verknüpft als {linkedName}{since ? ` · seit ${since}` : ""}
          </div>
        ) : available ? (
          <div className="text-[11px] text-white/45">nicht verknüpft – einmal anmelden, der Name kommt von {label}.</div>
        ) : (
          <div className="text-[11px] text-white/45" data-testid={`${testId}-not-available`}>Auf der Website noch nicht eingerichtet – bis dahin von Hand:</div>
        )}
        {!link && !available && field ? (
          <input
            value={form[field] ?? ""}
            onChange={(e) => set(field, whileTyping(field, e.target.value))}
            onBlur={(e) => set(field, normalizeSocialInput(field, e.target.value))}
            placeholder={byKey[field]?.placeholder}
            data-testid={testId}
            className="mt-1.5 w-full max-w-sm bg-[#121212] border border-white/10 focus:border-[#29B6E8] px-3 py-1.5 rounded-sm text-sm text-white"
          />
        ) : null}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {link && link.url && (
          <a href={link.url} target="_blank" rel="noopener noreferrer" data-testid={`${testId}-official`} title={`Bei ${label} öffnen`} className="inline-flex items-center gap-1 text-[11px] text-[#29B6E8] hover:text-white">
            <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" /> öffnen
          </a>
        )}
        {link && (
          <button type="button" onClick={() => onUnlink(platformKey)} data-testid={`${testId}-unlink`} className="inline-flex items-center gap-1 px-2.5 py-1.5 border border-white/15 rounded-sm text-[11px] font-bold uppercase tracking-wider text-white/60 hover:text-[#FF3B30] hover:border-[#FF3B30]/50">
            <Unlink className="w-3.5 h-3.5" aria-hidden="true" /> Verknüpfung lösen
          </button>
        )}
        {!link && available && input && (
          <input
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder={input.placeholder || input.label}
            aria-label={`${label}: ${input.label}`}
            data-testid={`${testId}-input`}
            className="w-44 bg-[#121212] border border-white/10 focus:border-[#29B6E8] px-2.5 py-1.5 rounded-sm text-xs text-white"
          />
        )}
        {!link && available && (
          <button type="button" onClick={() => (input ? onLink(platformKey, inputValue.trim()) : onLink(platformKey))} disabled={inputMissing} data-testid={`${testId}-link`} style={brandButtonStyle(meta.key)}
            className="inline-flex items-center gap-2 px-3.5 py-2 border rounded-sm text-xs font-bold tracking-wide shadow-[0_0_16px_-8px_var(--social-color)] hover:brightness-110 transition">
            <PlatformIcon kind={meta.key} className="w-4 h-4" /> {linkButtonLabel(meta.key, label)}
          </button>
        )}
      </div>
    </div>
  );
}

export function SocialsTab({ form, set, links = null, onLink = () => {}, onUnlink = () => {} }) {
  const available = links?.available || {};
  const delivers = links?.platforms || {};
  const linkedRows = links?.links || [];
  // Abgehakt vom Verein (#558): weder Zeile noch Textfeld.
  const off = platformsOff(links?.disabled);
  const linkOrder = LINK_ORDER.filter((platformKey) => !off.has(platformKey));
  const manualKeys = MANUAL_ROWS.flat().filter((key) => !off.has(MANUAL_PLATFORM_OF[key]));
  const manualRows = [];
  for (let index = 0; index < manualKeys.length; index += 2) manualRows.push(manualKeys.slice(index, index + 2));
  const twitchLinked = Boolean(linkForField(linkedRows, "twitch_handle"));
  // „Gerade in Steam“ (#584): der Schalter erscheint nur mit verknüpftem Steam-Konto - von Hand eingetragene IDs zählen nicht.
  const steamLinked = Boolean(linkForField(linkedRows, "steam_id"));
  return (
    <Section>
      <div className="border border-[#29B6E8]/25 bg-[#29B6E8]/5 rounded-sm p-3 text-xs text-white/65" data-testid="profile-links-hint">
        <strong className="text-white">Konto verknüpfen statt tippen:</strong> Einmal bei der Plattform anmelden – der Name kommt von dort und trägt „verifiziert“, sichtbar für alle, die dein Profil sehen dürfen.
        {" "}Die Plattform liefert nur, was hier steht: {Object.values(delivers).map((p) => p.delivers).filter(Boolean).join("; ") || "Kennung und Nutzername"}.
        {" "}<Lock className="inline w-3 h-3 align-[-2px] text-white/45" aria-hidden="true" /> Wer welches Konto sieht, regelst du unter{" "}
        <Link to="/profile?tab=privacy" className="text-[#29B6E8] hover:underline" data-testid="profile-links-privacy">Privatsphäre</Link> – das gilt auch für verknüpfte Namen.
      </div>

      <div className="space-y-2" data-testid="profile-link-rows">
        {linkOrder.map((platformKey) => (
          <LinkRow
            key={platformKey}
            platformKey={platformKey}
            link={linkForField(linkedRows, FIELD_BY_PLATFORM[platformKey])}
            available={Boolean(available[platformKey])}
            form={form}
            set={set}
            onLink={onLink}
            onUnlink={onUnlink}
            input={delivers[platformKey]?.input || null}
          />
        ))}
      </div>

      {(twitchLinked || form.twitch_handle) ? (
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

      {steamLinked ? (
        <div className="flex items-start justify-between gap-4 p-3 border border-[#66c0f4]/30 bg-[#66c0f4]/5 rounded-sm" data-testid="profile-steam-status-row">
          <div className="text-sm">
            <div className="font-bold text-white">Meinen Steam-Status im Mitgliederbereich zeigen</div>
            <div className="text-white/60 text-xs mt-1">Mitglieder sehen unter „Gerade in Steam“, dass du online bist und was du gerade spielst – nur, wenn dein Steam-Profil öffentlich ist. Nie öffentlich, nie im Discord; kein Verlauf.</div>
          </div>
          <ProfileSwitch
            label="Meinen Steam-Status im Mitgliederbereich zeigen"
            checked={!!form.show_steam_status}
            onCheckedChange={(checked) => set("show_steam_status", checked)}
            testId="profile-steam-status"
            className="mt-0.5"
          />
        </div>
      ) : null}

      <div>
        <div className="text-[11px] font-bold uppercase tracking-widest text-white/45 mb-2">Von Hand – diese Plattformen bieten keine Anmeldung</div>
        <div className="space-y-4">
          {manualRows.map((keys) => (
            <Row key={keys.join("+")}>
              {keys.map((key) => (
                <ManualField key={key} platform={byKey[key]} value={form[key]} onChange={(v) => set(key, v)} note={NOT_LINKABLE[key] || ""} />
              ))}
            </Row>
          ))}
          <ManualField platform={byKey.website} value={form.website} onChange={(v) => set("website", v)} />
        </div>
      </div>
    </Section>
  );
}
