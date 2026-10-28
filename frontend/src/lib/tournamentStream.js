// Stream eines Turniers (#2111, F5): vorher gab es drei Wege für denselben Stream - „Alter Stream-Verweis“,
// „Twitch-Kanal“ und „Stream-Plattform“ mit „Stream-URL“ - und drei Haken. Jetzt: Plattform, Kanal oder Adresse, ein
// Haken „auf der Turnierseite zeigen“. Gespeichert wird weiter in den bekannten Feldern, damit Turnierseite, App,
// Erfolge und Discord unverändert lesen (`components/tls/StreamEmbed.jsx` `describeStream`).

/** Der Twitch-Kanal aus „lion“, „@lion“, „twitch.tv/lion“ oder „https://www.twitch.tv/lion“. */
export function twitchChannelOf(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const parsed = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw.replace(/^@/, "")}`);
    if (/(^|\.)twitch\.tv$/i.test(parsed.hostname)) {
      return (parsed.pathname.split("/").filter(Boolean)[0] || "").replace(/^@/, "").toLowerCase();
    }
  } catch {
    // weiter unten: ein nackter Kanalname
  }
  return raw.replace(/^@/, "").split(/[/?#]/)[0].toLowerCase();
}

/** Formularwerte aus einem gespeicherten Turnier - auch aus älteren mit nur `twitch_channel`. */
export function streamFormValues(source = {}) {
  const legacyChannel = String(source?.twitch_channel || "").trim();
  return {
    stream_platform: source?.stream_platform || (legacyChannel ? "twitch" : ""),
    stream_address: source?.stream_url || legacyChannel || "",
    stream_embed: source?.has_live_stream === true || Boolean(source?.twitch_enabled && legacyChannel),
  };
}

/** Was gespeichert wird: Plattform und Adresse, der Twitch-Kanal (nur bei Twitch) und der eine Haken für beide Schalter. */
export function streamPayload({ stream_platform: platform = "", stream_address: address = "", stream_embed: embed = false } = {}) {
  const text = String(address || "").trim();
  const channel = platform === "twitch" ? twitchChannelOf(text) : "";
  const url = !text ? null : channel && !/^https?:\/\//i.test(text) ? `https://www.twitch.tv/${channel}` : text;
  return {
    stream_platform: platform || null,
    stream_url: url,
    twitch_channel: channel || null,
    has_live_stream: Boolean(embed),
    twitch_enabled: Boolean(embed),
  };
}

export const STREAM_ADDRESS_HINT = {
  twitch: "Kanalname oder https://twitch.tv/…",
  youtube: "https://youtube.com/@kanal oder Link zum Video",
  kick: "https://kick.com/…",
  custom: "https://…",
  "": "https://…",
};
