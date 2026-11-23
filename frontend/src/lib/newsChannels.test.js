import { describe, expect, it } from "vitest";
import {
  CHANNEL_HEADER,
  NEWS_CHANNEL_OPTIONS,
  channelChoice,
  channelHint,
  channelsFromChoice,
  isAppOnly,
  newsChannelBadge,
  newsChannelLabel,
} from "./newsChannels";

// Kanal einer News (#1532): Website und App, nur App oder nur Website. Alte News ohne Feld gelten als beides.
describe("newsChannels", () => {
  it("bietet die drei Wahlmöglichkeiten in fester Reihenfolge", () => {
    expect(NEWS_CHANNEL_OPTIONS.map((option) => [option.k, option.l])).toEqual([
      ["both", "Website und App"],
      ["app", "Nur App"],
      ["web", "Nur Website"],
    ]);
  });

  it("liest alte und kaputte Werte als beides", () => {
    for (const value of [undefined, null, [], ["fax"], "web", ["web", "app"], ["app", "web"]]) {
      expect(channelChoice(value)).toBe("both");
    }
    expect(channelChoice(["app"])).toBe("app");
    expect(channelChoice(["web", "web"])).toBe("web");
  });

  it("macht aus der Wahl die Liste für den Server", () => {
    expect(channelsFromChoice("both")).toEqual(["web", "app"]);
    expect(channelsFromChoice("app")).toEqual(["app"]);
    expect(channelsFromChoice("web")).toEqual(["web"]);
    expect(channelsFromChoice("quatsch")).toEqual(["web", "app"]);
  });

  it("zeigt ein Schild nur, wenn die News nicht überall erscheint", () => {
    expect(newsChannelBadge({ channels: ["web", "app"] })).toBeNull();
    expect(newsChannelBadge({})).toBeNull();
    expect(newsChannelBadge({ channels: ["app"] })).toEqual({ key: "app", label: "Nur App" });
    expect(newsChannelBadge({ channels: ["web"] })).toEqual({ key: "web", label: "Nur Website" });
    expect(newsChannelLabel(undefined)).toBe("Website und App");
    expect(isAppOnly({ channels: ["app"] })).toBe(true);
    expect(isAppOnly({ channels: ["web"] })).toBe(false);
    expect(isAppOnly(null)).toBe(false);
  });

  it("erklärt, was die Wahl bewirkt", () => {
    expect(channelHint("app")).toMatch(/nicht auf der Website/);
    expect(channelHint("app")).toMatch(/kein Newsletter/i);
    expect(channelHint("web")).toMatch(/nicht in der App/);
    expect(channelHint("both")).toMatch(/Website und in der App/);
  });

  it("nennt die Kopfzeile, mit der sich die Website beim Server meldet", () => {
    expect(CHANNEL_HEADER).toBe("X-LSW-Channel");
  });
});
