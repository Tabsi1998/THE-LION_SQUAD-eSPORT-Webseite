import { streamFormValues, streamPayload, twitchChannelOf } from "./tournamentStream";
import { describeStream } from "@/components/tls/StreamEmbed";

// Ein Weg für den Stream (#2111, F5): Plattform, Kanal oder Adresse, ein Haken - gespeichert in den bekannten Feldern.
test("ältere Turniere mit nur einem Twitch-Kanal erscheinen als Twitch mit Kanal", () => {
  expect(streamFormValues({ twitch_channel: "lion", twitch_enabled: true })).toEqual({ stream_platform: "twitch", stream_address: "lion", stream_embed: true });
  expect(streamFormValues({ stream_platform: "youtube", stream_url: "https://youtube.com/@lion", has_live_stream: true }))
    .toEqual({ stream_platform: "youtube", stream_address: "https://youtube.com/@lion", stream_embed: true });
  expect(streamFormValues({})).toEqual({ stream_platform: "", stream_address: "", stream_embed: false });
});

test("Twitch: Kanalname wird zur Adresse, die Turnierseite bettet ihn ein", () => {
  expect(twitchChannelOf("https://www.twitch.tv/Lion_Squad")).toBe("lion_squad");
  const payload = streamPayload({ stream_platform: "twitch", stream_address: "@Lion", stream_embed: true });
  expect(payload).toEqual({ stream_platform: "twitch", stream_url: "https://www.twitch.tv/lion", twitch_channel: "lion", has_live_stream: true, twitch_enabled: true });
  expect(describeStream(payload, "lionsquad.at")).toMatchObject({ platform: "twitch", url: "https://www.twitch.tv/lion" });
});

test("andere Plattformen: die Adresse bleibt, kein Twitch-Kanal; leer heißt kein Stream", () => {
  expect(streamPayload({ stream_platform: "kick", stream_address: " https://kick.com/lion ", stream_embed: false }))
    .toEqual({ stream_platform: "kick", stream_url: "https://kick.com/lion", twitch_channel: null, has_live_stream: false, twitch_enabled: false });
  expect(streamPayload({})).toEqual({ stream_platform: null, stream_url: null, twitch_channel: null, has_live_stream: false, twitch_enabled: false });
});
