// Sperrliste öffentlich (docs/LIGA.md, C.4 #2218): je Kategorie die gesperrten Einträge mit Bild, danach die Waffen, an denen nur
// einzelne Aufsätze gesperrt sind. Liest nur den Snapshot der Season (Name und Bild von damals), rechnet nichts. Die Verwaltung zeigt
// dieselbe Ansicht für Zuständige ohne Schreibrecht.
import { Ban, Crosshair } from "lucide-react";
import { LazyImg } from "@/components/tls/LazyImg";
import { countText, modesText, publicGroups } from "@/lib/loadoutBans";

// Kacheln im Raster: zwei Spalten am Handy, drei ab sm, vier ab lg - höchstens ~200 px breit.
const TILE_SIZES = "(min-width: 1024px) 200px, (min-width: 640px) 30vw, 45vw";

export function EquipmentThumb({ src, sizes = TILE_SIZES, className = "" }) {
  return (
    <span className={`relative block aspect-video overflow-hidden rounded-sm border border-white/10 bg-[#0A0A0A] ${className}`}>
      {src ? <LazyImg src={src} alt="" sizes={sizes} className="absolute inset-0 h-full w-full object-contain p-1.5" /> : (
        <span className="absolute inset-0 grid place-items-center text-white/25" aria-hidden="true" data-testid="equipment-thumb-empty">
          <Crosshair className="h-6 w-6" />
        </span>
      )}
    </span>
  );
}

function ModeNote({ entry }) {
  const all = !(entry.mode_labels || []).length;
  return (
    <span className={`text-[11px] ${all ? "text-white/50" : "font-semibold text-warn"}`} data-testid="loadout-ban-modes">
      {all ? "in allen Modi" : `nur ${modesText(entry)}`}
    </span>
  );
}

export function LoadoutBansView({ list, title = "Sperrliste", className = "mt-14", headingId = "loadout-bans-title", testId = "loadout-bans" }) {
  if (!list?.entries?.length) return null;
  const { groups, weapons } = publicGroups(list);
  return (
    <section className={className} aria-labelledby={headingId} data-testid={testId}>
      <h2 id={headingId} className="flex items-center gap-2 font-heading text-2xl font-black uppercase">
        <Ban className="h-4 w-4 text-[#29B6E8]" aria-hidden="true" />{title}
      </h2>
      <p className="mt-1 text-sm text-white/60">Gesperrt ist nur, was hier steht – alles andere ist erlaubt.</p>
      <div className="mt-5 space-y-7">
        {groups.map((group) => (
          <div key={group.label} data-testid="loadout-ban-group">
            <h3 className="mb-2 flex flex-wrap items-baseline gap-x-2 text-[11px] font-bold uppercase tracking-widest text-[#29B6E8]">
              {group.label}
              <span className="font-semibold normal-case tracking-normal text-white/45 tabular-nums">{countText(group.entries.length, "Eintrag", "Einträge")}</span>
            </h3>
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {group.entries.map((entry) => (
                <li key={entry.item_id || entry.name} className="min-w-0" data-testid="loadout-ban-entry">
                  <EquipmentThumb src={entry.image_url} />
                  <p className="mt-1.5 text-sm font-semibold leading-snug text-white break-words">{entry.name}</p>
                  <ModeNote entry={entry} />
                </li>
              ))}
            </ul>
          </div>
        ))}
        {weapons.length ? (
          <div data-testid="loadout-ban-weapons">
            <h3 className="mb-2 text-[11px] font-bold uppercase tracking-widest text-[#29B6E8]">Aufsätze an erlaubten Waffen</h3>
            <ul className="divide-y divide-white/10 border-y border-white/10">
              {weapons.map((entry) => (
                <li key={entry.item_id || entry.name} className="flex items-start gap-3 py-3" data-testid="loadout-ban-weapon">
                  <EquipmentThumb src={entry.image_url} sizes="96px" className="w-24 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-white break-words">{entry.name} <ModeNote entry={entry} /></p>
                    <p className="mt-1 text-[11px] font-bold uppercase tracking-wider text-white/45">Gesperrte Aufsätze</p>
                    <ul className="mt-1 flex flex-wrap gap-1.5">
                      {(entry.attachments || []).map((item) => (
                        <li key={item.item_id || item.name} className="max-w-full rounded-sm border border-white/10 bg-white/5 px-2 py-0.5 text-xs text-white/85 break-words">{item.name}</li>
                      ))}
                    </ul>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </section>
  );
}
