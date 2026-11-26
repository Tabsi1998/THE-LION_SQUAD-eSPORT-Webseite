import { BereichReiter } from "@/pages/user/meinBereich/BereichSeite";

// Die Reiter einer Einstellungs-Gruppe in „Mein Bereich“ (#2059): Grunddaten · Gaming & Spiel-IDs · Socials unter Profil,
// Sicherheit · Darstellung · Kalender-Abo · App & Rechtliches unter Konto & Sicherheit … Die Gruppen selbst stehen in der
// Seitenleiste; hier nur die Reiter der einen Gruppe, als Knöpfe mit den alten Kennungen (profile-tab-…).
export function ProfileNav({ tabs, tab, onSelect, label = "Einstellungen" }) {
  if (!tabs || tabs.length < 2) return null;
  return <BereichReiter items={tabs} active={tab} onSelect={onSelect} label={label} testIdPrefix="profile-tab-" />;
}
