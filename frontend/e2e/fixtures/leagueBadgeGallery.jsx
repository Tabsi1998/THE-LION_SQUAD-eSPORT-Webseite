// Nur für e2e/league-badge.spec.js: alle Stufen und Größen des Liga-Abzeichens (#1638) auf einer Fläche - es gibt (noch) keine Seite,
// die die Größe „Hero“ zeigt. Der Test lädt dieses Modul über den Vite-Dev-Server nach; es gehört nicht in den Build.
import { createRoot } from "react-dom/client";
import { LeagueBadge } from "@/components/tls/league/LeagueBadge";

const BADGES = [
  { level: 1, nickname: "Elite" },
  { level: 2, nickname: "Herausforderer" },
  { level: 3 },
  { level: 12, nickname: "Donaudampfschifffahrtsgesellschaft-Nachwuchsliga" },
  { level: 1, nickname: "Elite", champion: true },
  { level: 3, champion: true },
];

function Gallery() {
  return (
    <div data-testid="badge-gallery" style={{ background: "#0A0A0A", padding: 16, display: "grid", gap: 18, color: "#fff", maxWidth: "100%" }}>
      {["list", "card", "hero"].map((size) => (
        <section key={size} data-testid={`badge-gallery-${size}`} style={{ display: "grid", gap: 10, minWidth: 0 }}>
          <h2 style={{ fontSize: 11, letterSpacing: "0.2em", textTransform: "uppercase", color: "rgb(255 255 255 / 0.55)" }}>{size}</h2>
          <div style={{ display: "flex", flexWrap: "wrap", gap: size === "hero" ? 24 : 14, alignItems: "center", minWidth: 0 }}>
            {BADGES.map((badge, index) => (
              <div key={`${size}-${index}`} style={{ minWidth: 0, maxWidth: size === "hero" ? 340 : 260 }}>
                <LeagueBadge badge={badge} size={size} index={index} testId={`gallery-${size}-${index}`} />
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

export function mount() {
  document.getElementById("root")?.setAttribute("hidden", "");
  const host = document.createElement("div");
  host.id = "badge-gallery-host";
  document.body.appendChild(host);
  createRoot(host).render(<Gallery />);
}
