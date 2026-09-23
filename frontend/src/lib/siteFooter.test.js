import { contactLines, footerButtons, footerColumns } from "./siteFooter";

// Footer (#403): Spalten aus festen Wegen plus Discord, wenn ein Link gepflegt ist; der
// Kontaktblock zeigt nur, was da ist.

test("drei Spalten; Discord nur mit Link; Mitglieder sehen den Mitgliederbereich statt Mitglied werden", () => {
  const plain = footerColumns({});
  expect(plain.map((column) => column.title)).toEqual(["Verein", "eSports", "Mitmachen"]);
  expect(plain[2].links.map((link) => link.label)).toEqual(["Community", "Kalender", "Mitglied werden", "Kontakt"]);

  const withDiscord = footerColumns({ discord_invite_url: "https://discord.gg/lions" }, { isMember: true });
  expect(withDiscord[2].links.find((link) => link.label === "Discord")).toEqual({ href: "https://discord.gg/lions", label: "Discord", external: true });
  expect(withDiscord[2].links.map((link) => link.label)).toContain("Mitgliederbereich");
  expect(withDiscord[2].links.map((link) => link.label)).not.toContain("Mitglied werden");
});

test("Kontaktblock aus den öffentlichen Vereinsdaten - leer bleibt leer", () => {
  expect(contactLines({ legal_name: "THE LION SQUAD - eSPORTS", street_address: "Teststraße 1", postal_code: "6410", city: "Telfs", contact_email: "office@example.test", zvr_number: "123456789" }))
    .toEqual({ name: "THE LION SQUAD - eSPORTS", address: ["Teststraße 1", "6410 Telfs"], email: "office@example.test", zvr: "ZVR 123456789", any: true });
  expect(contactLines({ club_name: "THE LION SQUAD", city: "Telfs" })).toEqual({ name: "THE LION SQUAD", address: ["Telfs"], email: null, zvr: null, any: true });
  expect(contactLines({}).any).toBe(false);
});

test("Knopfleiste (#425): Discord nur mit Link, der Play-Badge erst mit Play-Store-Link", () => {
  expect(footerButtons({})).toEqual({ discord: null, playStoreUrl: null, playSoonLabel: "LionsAPP – bald bei Google Play" });
  const both = footerButtons({ discord_invite_url: "https://discord.com/invite/lions", play_store_url: "https://play.google.com/store/apps/details?id=at.lionsquad.app" });
  expect(both.discord).toBe("https://discord.com/invite/lions");
  expect(both.playStoreUrl).toBe("https://play.google.com/store/apps/details?id=at.lionsquad.app");
  expect(footerButtons({ play_store_url: "javascript:alert(1)" }).playStoreUrl).toBeNull();
  expect(footerButtons({ play_store_url: "https://example.test/app" }).playStoreUrl).toBeNull();
});
