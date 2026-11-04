// Erlaubte Ausrüstung öffentlich (docs/LIGA.md, C.4 #2287, Fabian Nr. 99): dieselbe Sicht wie der Baustein im Regelwerk - je Kategorie
// und Unterkategorie, was gespielt werden darf, mit Bild und Hinweis („nicht in …“, „nicht an …“). Eine ganz gesperrte Klasse ist eine
// kurze Zeile „Nicht erlaubt“. Der Server rechnet (`allowed_equipment`: aktive Bibliothek ohne die Sperrliste), hier wird nur gezeigt.
// Liga- und Matchseite nutzen sie, damit Spieler überall dasselbe lesen.
import { Ban, Check, ShieldCheck } from "lucide-react";
import { EquipmentThumb, SubcategoryIcon } from "@/components/tls/league/LoadoutBansView";
import { allowedCount, countText, ownRestrictionParts } from "@/lib/loadoutBans";

function SectionHead({ section }) {
  if (!section.label) return null;
  const banned = section.state === "banned";
  return (
    <div className="mb-2.5 flex flex-wrap items-center gap-x-2.5 gap-y-1" data-testid="allowed-section-head">
      <h4 className="flex min-w-0 items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-[#29B6E8]">
        <SubcategoryIcon src={section.icon_url} />
        <span className="break-words">{section.label}</span>
      </h4>
      {banned ? (
        <span className="inline-flex items-center gap-1.5 rounded-sm border border-warn/40 bg-warn/10 px-2 py-0.5 text-[11px] font-semibold text-warn" data-testid="allowed-banned">
          <Ban className="h-3 w-3" aria-hidden="true" /> Nicht erlaubt
        </span>
      ) : section.state === "all" ? (
        <span className="inline-flex items-center gap-1.5 rounded-sm border border-ok/30 bg-ok/10 px-2 py-0.5 text-[11px] font-semibold text-ok" data-testid="allowed-all">
          <Check className="h-3 w-3" aria-hidden="true" /> Alle erlaubt
        </span>
      ) : section.not_in?.length ? (
        <span className="text-[11px] font-semibold text-warn" data-testid="allowed-section-note">nicht in {section.not_in.join(", ")}</span>
      ) : null}
      {banned && section.banned?.length ? (
        <span className="min-w-0 basis-full text-xs text-white/55 break-words sm:basis-auto" data-testid="allowed-banned-names">{section.banned.join(", ")}</span>
      ) : null}
    </div>
  );
}

function EntryTile({ entry, section }) {
  const notes = ownRestrictionParts(entry, section);
  return (
    <li className="min-w-0" data-testid="allowed-entry">
      <EquipmentThumb src={entry.image_url} />
      <p className="mt-1.5 text-sm font-semibold leading-snug text-white break-words">{entry.name}</p>
      {notes.map((note) => <p key={note} className="text-[11px] font-semibold leading-snug text-warn break-words" data-testid="allowed-note">{note}</p>)}
    </li>
  );
}

// `hideTitle`: Die Überschrift steht schon außen (aufklappbarer Kasten der Matchseite).
export function AllowedEquipmentView({ data, title = "Erlaubte Ausrüstung", className = "mt-14", headingId = "allowed-equipment-title",
  testId = "allowed-equipment", hideTitle = false }) {
  if (!data || data.layout !== 3) return null;
  const categories = data.categories || [];
  return (
    <section className={className} {...(hideTitle ? { "aria-label": title } : { "aria-labelledby": headingId })} data-testid={testId}>
      {hideTitle ? null : (
        <h2 id={headingId} className="flex items-center gap-2 font-heading text-2xl font-black uppercase">
          <ShieldCheck className="h-5 w-5 text-[#29B6E8]" aria-hidden="true" />{title}
        </h2>
      )}
      <p className={`${hideTitle ? "" : "mt-1 "}max-w-2xl text-sm text-white/60`} data-testid={`${testId}-intro`}>
        {data.list ? "Erlaubt ist die Ausrüstung, die hier steht – Einschränkungen stehen beim Eintrag." : "Für diese Season ist nichts gesperrt – erlaubt ist die ganze Ausrüstung, die hier steht."}
      </p>
      {!categories.length ? <p className="mt-4 text-sm text-white/60">Zurzeit ist keine Ausrüstung erlaubt.</p> : null}
      <div className="mt-6 space-y-9">
        {categories.map((category) => (
          <div key={category.label} data-testid="allowed-group">
            <h3 className="flex flex-wrap items-baseline gap-x-2 border-b border-white/10 pb-2 font-heading text-lg font-bold uppercase leading-tight text-white">
              <span className="break-words">{category.label}</span>
              <span className="font-sans text-[11px] font-semibold normal-case tracking-normal text-white/45 tabular-nums">{countText(allowedCount(category), "erlaubt", "erlaubt")}</span>
            </h3>
            <div className="mt-4 space-y-6">
              {category.sections.map((section) => (
                <div key={section.label || "ohne"} data-testid="allowed-section">
                  <SectionHead section={section} />
                  {section.entries?.length ? (
                    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                      {section.entries.map((entry) => <EntryTile key={entry.name} entry={entry} section={section} />)}
                    </ul>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
