import { Link2 } from "lucide-react";

// Plattform-Konten verknüpfen (#260): die Discord-App und der optionale Steam-Schlüssel. Twitch
// nutzt die Helix-App aus dem Twitch-Reiter. Die Rückrufadressen stehen hier zum Kopieren – die
// gehören in die jeweilige Entwickler-Konsole, sonst lehnt die Plattform die Anmeldung ab.

const PLATFORMS = [
  { key: "discord", label: "Discord", where: "Discord Developer Portal → deine App → OAuth2 → Redirects" },
  { key: "twitch", label: "Twitch", where: "Twitch Developer Console → deine App → OAuth Redirect URLs" },
  { key: "steam", label: "Steam", where: "keine App nötig – Steam fragt nur diese Adresse zurück" },
];

function SecretInput({ label, value, masked, onChange, onClear, testId, placeholder }) {
  return (
    <label className="block">
      <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">
        {label} {masked && <span className="text-white/40 normal-case">(aktuell gespeichert)</span>}
      </div>
      <input type="password" value={value || ""} onChange={(e) => onChange(e.target.value)} data-testid={testId} autoComplete="off" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm font-mono" placeholder={masked ? "Leer lassen, um das Gespeicherte zu behalten" : placeholder} />
      {masked && <button type="button" onClick={onClear} className="mt-2 text-[10px] uppercase font-bold text-[#FF6B6B]">Gespeichertes entfernen</button>}
    </label>
  );
}

export function PlatformLinkSettings({ brand, setBrandField, saving, onSave, onClearSecret }) {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const discordReady = Boolean(brand.discord_client_id && (brand.discord_client_secret || brand.discord_client_secret_masked));
  const twitchReady = Boolean(brand.twitch_client_id && (brand.twitch_client_secret || brand.twitch_client_secret_masked));
  return (
    <div className="border border-white/10 bg-[#121212] rounded-sm p-5 space-y-4" data-testid="platform-link-settings">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="font-heading font-bold uppercase text-sm inline-flex items-center gap-2"><Link2 className="w-4 h-4 text-[#29B6E8]" /> Konten verknüpfen (Discord, Twitch, Steam)</div>
          <p className="text-xs text-white/50 mt-1">Mitglieder verknüpfen ihr Discord-, Twitch- oder Steam-Konto im Profil per Anmeldung bei der Plattform – der Eintrag wird befüllt und als „verifiziert“ markiert. Dafür braucht die Website eine Discord-App; Twitch nimmt die Helix-App aus dem Twitch-Reiter, Steam braucht keine.</p>
          <ul className="text-xs text-white/50 mt-2 space-y-1 list-disc pl-4" data-testid="platform-link-howto">
            <li><strong className="text-white/70">Discord:</strong> Client ID und Client Secret stehen im Discord Developer Portal bei derselben App wie der Bot (Reiter OAuth2). Ohne beides bleibt „Mit Discord verknüpfen“ im Profil ausgegraut.</li>
            <li><strong className="text-white/70">Twitch:</strong> in der Twitch Developer Console bei der App unter „OAuth Redirect URLs“ die Rückrufadresse unten genau so eintragen (ohne Schrägstrich am Ende), Client-Typ „Confidential“. Fehlt sie, lehnt Twitch die Anmeldung ab – der Grund steht dann im Profil.</li>
            <li><strong className="text-white/70">Steam:</strong> nichts einzurichten; der Schlüssel liefert nur den Anzeigenamen statt der SteamID.</li>
          </ul>
        </div>
        <div className="text-[10px] font-bold uppercase tracking-wider text-right space-y-1 shrink-0">
          <div className={discordReady ? "text-[#00FF88]" : "text-[#FFD700]"} data-testid="platform-link-discord-state">Discord: {discordReady ? "bereit" : "fehlt"}</div>
          <div className={twitchReady ? "text-[#00FF88]" : "text-[#FFD700]"}>Twitch: {twitchReady ? "bereit" : "fehlt"}</div>
          <div className="text-[#00FF88]">Steam: bereit</div>
        </div>
      </div>
      <div className="grid md:grid-cols-2 gap-3">
        <label className="block">
          <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">Discord Client ID</div>
          <input value={brand.discord_client_id || ""} onChange={(e) => setBrandField("discord_client_id", e.target.value)} data-testid="discord-client-id" autoComplete="off" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm font-mono" placeholder="Application ID aus dem Developer Portal" />
        </label>
        <SecretInput label="Discord Client Secret" value={brand.discord_client_secret} masked={brand.discord_client_secret_masked} onChange={(v) => setBrandField("discord_client_secret", v)} onClear={() => onClearSecret("discord_client_secret")} testId="discord-client-secret" placeholder="Client Secret eintragen" />
        <SecretInput label="Steam Web-API-Schlüssel (optional)" value={brand.steam_api_key} masked={brand.steam_api_key_masked} onChange={(v) => setBrandField("steam_api_key", v)} onClear={() => onClearSecret("steam_api_key")} testId="steam-api-key" placeholder="nur für den Anzeigenamen; ohne bleibt die SteamID" />
      </div>
      <div className="border border-white/10 rounded-sm p-3 text-xs space-y-1.5" data-testid="platform-link-redirects">
        <div className="font-bold uppercase tracking-wider text-white/60">Rückrufadressen – in die Entwickler-Konsole eintragen</div>
        {PLATFORMS.map((platform) => (
          <div key={platform.key} className="flex flex-wrap gap-x-3 gap-y-0.5">
            <code className="text-[#29B6E8] break-all">{origin}/api/platform-links/{platform.key}/callback</code>
            <span className="text-white/45">{platform.label}: {platform.where}</span>
          </div>
        ))}
      </div>
      <button type="button" onClick={onSave} disabled={saving} data-testid="platform-link-save" className="px-5 py-2 bg-[#29B6E8] text-black font-bold uppercase tracking-wider rounded-sm text-xs disabled:opacity-50">{saving ? "Speichere..." : "Speichern"}</button>
    </div>
  );
}
