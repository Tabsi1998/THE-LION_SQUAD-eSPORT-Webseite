// Sperrliste als Liste der Sperren (docs/LIGA.md, C.4 #2218, gruppiert #2287): je Kategorie die gesperrten Einträge mit Bild, darin je
// Unterkategorie ein Abschnitt - eine ganz gesperrte Klasse sagt „Ganze Klasse gesperrt“ und zeigt ihre Einträge von heute. Danach die
// Waffen, an denen nur einzelne Aufsätze gesperrt sind. Die Verwaltung zeigt sie Zuständigen ohne Schreibrecht. Öffentlich steht seit
// Nr. 99 die erlaubte Ausrüstung (AllowedEquipmentView); Bild-Bausteine (EquipmentThumb, SubcategoryIcon) nutzen beide.
import { Ban, Crosshair } from "lucide-react";
import { LazyImg } from "@/components/tls/LazyImg";
import { countText, differsFromSection, modesText, publicGroups } from "@/lib/loadoutBans";

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

/** Symbol einer Unterkategorie (#2287): klein und quadratisch vor dem Namen; ohne Bild nichts. */
export function SubcategoryIcon({ src, className = "h-5 w-5" }) {
  if (!src) return null;
  return (
    <span className={`relative inline-block shrink-0 overflow-hidden rounded-sm ${className}`} aria-hidden="true">
      <LazyImg src={src} alt="" sizes="24px" className="absolute inset-0 h-full w-full object-contain" />
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

function SectionHead({ section }) {
  if (!section.label) return null;
  return (
    <div className="mb-2.5 flex flex-wrap items-center gap-x-2.5 gap-y-1" data-testid="loadout-ban-section-head">
      <h4 className="flex min-w-0 items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-[#29B6E8]">
        <SubcategoryIcon src={section.icon_url} />
        <span className="break-words">{section.label}</span>
      </h4>
      {section.all ? (
        <span className="inline-flex items-center gap-1.5 rounded-sm border border-warn/40 bg-warn/10 px-2 py-0.5 text-[11px] font-semibold text-warn"
          data-testid="loadout-ban-class">
          <Ban className="h-3 w-3" aria-hidden="true" />
          Ganze Klasse gesperrt · {section.mode_labels.length ? `nur ${section.mode_labels.join(", ")}` : "in allen Modi"}
        </span>
      ) : null}
    </div>
  );
}

function EntryTile({ entry, section }) {
  // In einer ganz gesperrten Klasse sagt die Karte die Modi nur, wenn der Eintrag anders gilt als die Klasse.
  const note = !section.all || differsFromSection(entry, section);
  return (
    <li className="min-w-0" data-testid="loadout-ban-entry">
      <EquipmentThumb src={entry.image_url} />
      <p className="mt-1.5 text-sm font-semibold leading-snug text-white break-words">{entry.name}</p>
      {note ? <ModeNote entry={entry} /> : null}
    </li>
  );
}

// `hideTitle`: Die Überschrift steht schon außen (etwa im aufklappbaren Kasten der Matchseite) - `title` bleibt der Name des Abschnitts.
export function LoadoutBansView({ list, title = "Sperrliste", className = "mt-14", headingId = "loadout-bans-title", testId = "loadout-bans", hideTitle = false }) {
  if (!list?.entries?.length) return null;
  const { categories, weapons } = publicGroups(list);
  if (!categories.length && !weapons.length) return null;
  return (
    <section className={className} {...(hideTitle ? { "aria-label": title } : { "aria-labelledby": headingId })} data-testid={testId}>
      {hideTitle ? null : (
        <h2 id={headingId} className="flex items-center gap-2 font-heading text-2xl font-black uppercase">
          <Ban className="h-4 w-4 text-[#29B6E8]" aria-hidden="true" />{title}
        </h2>
      )}
      <p className={`${hideTitle ? "" : "mt-1 "}text-sm text-white/60`}>Gesperrt ist nur, was hier steht – alles andere ist erlaubt.</p>
      <div className="mt-6 space-y-9">
        {categories.map((category) => (
          <div key={category.label} data-testid="loadout-ban-group">
            <h3 className="flex flex-wrap items-baseline gap-x-2 border-b border-white/10 pb-2 font-heading text-lg font-bold uppercase leading-tight text-white">
              <span className="break-words">{category.label}</span>
              <span className="font-sans text-[11px] font-semibold normal-case tracking-normal text-white/45 tabular-nums">{countText(category.count, "Eintrag", "Einträge")}</span>
            </h3>
            <div className="mt-4 space-y-6">
              {category.sections.map((section) => (
                <div key={section.key || "ohne"} data-testid="loadout-ban-section">
                  <SectionHead section={section} />
                  <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                    {section.entries.map((entry) => <EntryTile key={entry.item_id || entry.name} entry={entry} section={section} />)}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        ))}
        {weapons.length ? (
          <div data-testid="loadout-ban-weapons">
            <h3 className="border-b border-white/10 pb-2 font-heading text-lg font-bold uppercase leading-tight text-white">Aufsätze an erlaubten Waffen</h3>
            <ul className="divide-y divide-white/10 border-b border-white/10">
              {weapons.map((entry) => (
                <li key={entry.item_id || entry.name} className="flex items-start gap-3 py-3" data-testid="loadout-ban-weapon">
                  <EquipmentThumb src={entry.image_url} sizes="96px" className="w-24 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-white break-words">{entry.name} <ModeNote entry={entry} /></p>
                    <p className="mt-1 text-[11px] font-bold uppercase tracking-wider text-white/45">Gesperrte Aufsätze</p>
                    <ul className="mt-1 flex flex-wrap gap-1.5">
                      {(entry.attachments || []).map((item) => (
                        <li key={item.item_id || item.name} className="max-w-full rounded-sm border border-white/10 bg-white/5 px-2 py-0.5 text-xs text-white/85 break-words">
                          {item.name}
                          {/* Eigene Modi je Aufsatz (#2299). */}
                          {item.mode_labels?.length ? <span className="text-warn"> · nur {item.mode_labels.join(", ")}</span> : null}
                        </li>
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
