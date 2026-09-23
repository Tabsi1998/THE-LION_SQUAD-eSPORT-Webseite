// Footer (#403): drei Spalten mit den Hauptbereichen und ein Kontaktblock aus den öffentlichen
// Vereinsdaten - dieselben Werte wie Impressum und Kontaktseite (Rechtliches II), damit sich der
// Footer mit Dolibarr mitpflegt. Ohne React, damit es sich testen lässt.

export function footerColumns(settings = {}, { isMember = false } = {}) {
  const discord = String(settings?.discord_invite_url || "").trim();
  const join = [
    { to: "/community", label: "Community" },
    discord ? { href: discord, label: "Discord", external: true } : null,
    { to: "/calendar", label: "Kalender" },
    isMember ? { to: "/members/area", label: "Mitgliederbereich" } : { to: "/membership/join", label: "Mitglied werden" },
    { to: "/contact", label: "Kontakt" },
  ].filter(Boolean);
  return [
    {
      key: "club",
      title: "Verein",
      links: [
        { to: "/about", label: "Über uns" },
        { to: "/board", label: "Vorstand" },
        { to: "/references", label: "Referenzen" },
        { to: "/sponsors", label: "Sponsoren" },
        { to: "/partners", label: "Partner" },
        { to: "/galerie", label: "Galerie" },
      ],
    },
    {
      key: "esports",
      title: "eSports",
      links: [
        { to: "/tournaments", label: "Turniere" },
        { to: "/events", label: "Events" },
        { to: "/fastlap", label: "Fast Lap" },
        { to: "/seasons/current", label: "Jahreswertung" },
        { to: "/teams", label: "Teams" },
        { to: "/players", label: "Spieler" },
      ],
    },
    { key: "join", title: "Mitmachen", links: join },
  ];
}

/** Kontaktblock: nur, was gepflegt ist - eine leere Zeile gibt es nicht. */
export function contactLines(settings = {}) {
  const name = String(settings?.legal_name || settings?.club_name || "").trim();
  const street = String(settings?.street_address || "").trim();
  const place = [settings?.postal_code, settings?.city].map((part) => String(part || "").trim()).filter(Boolean).join(" ");
  const email = String(settings?.contact_email || "").trim();
  const zvr = String(settings?.zvr_number || "").trim();
  return {
    name: name || null,
    address: [street, place].filter(Boolean),
    email: email || null,
    zvr: zvr ? `ZVR ${zvr}` : null,
    any: Boolean(name || street || place || email || zvr),
  };
}
