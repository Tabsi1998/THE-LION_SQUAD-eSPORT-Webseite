// Erlaubte Ausrüstung öffentlich (docs/LIGA.md, C.4 #2287, Fabian Nr. 99): dieselbe Sicht wie der Baustein im Regelwerk - je Kategorie
// und Unterkategorie, was gespielt werden darf, mit Bild und Hinweis („nicht in …“ bzw. „nur in …“, #2298). Eine ganz gesperrte Klasse ist
// eine kurze Zeile „Nicht erlaubt“. Der Server rechnet (`allowed_equipment`: aktive Bibliothek ohne die Sperrliste), hier wird nur gezeigt.
// Liga- und Matchseite nutzen sie, damit Spieler überall dasselbe lesen.
// Aufsätze je Waffe (#2299, `layout: 4`): Die Waffenkarte sagt „14 Aufsätze · 2 gesperrt“ und klappt darunter über die ganze Breite die
// erlaubten Aufsätze je Slot auf. Ältere Schnappschüsse (`layout: 3`, Aufsätze als eigene Liste mit „nicht an …“) zeigt sie wie damals.
// Ab `layout: 5` (#2305) tragen die Slots auch ihre ganz gesperrten Aufsätze (fürs Regelwerk) - ein Slot ohne erlaubten fällt hier weg. Die
// Zeile „Gesperrt: …“ steht ganz oben im Kasten, weil man das zuerst wissen will (Fabian, 05.11.); eine Umkehrung „nur erlaubt“ braucht es
// hier nicht, der Kasten zeigt die erlaubten ohnehin mit Bild.
import { useState } from "react";
import { Ban, Check, ChevronDown, ShieldCheck } from "lucide-react";
import { EquipmentThumb, SubcategoryIcon } from "@/components/tls/league/LoadoutBansView";
import { StaggerIn } from "@/components/tls/motion/StaggerIn";
import { allowedCount, attachmentsSummary, countText, everywhereText, modesNote, ownRestrictionParts } from "@/lib/loadoutBans";

const LAYOUTS = [3, 4, 5];
// Kleine Kacheln der Aufsätze: drei Spalten am Handy, bis sechs am PC.
const SMALL_TILE = "(min-width: 1024px) 140px, (min-width: 640px) 22vw, 30vw";

function SectionHead({ section }) {
  if (!section.label) return null;
  const banned = section.state === "banned";
  const note = modesNote(section);
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
      ) : note ? (
        <span className="text-[11px] font-semibold text-warn" data-testid="allowed-section-note">{note}</span>
      ) : null}
      {banned && section.banned?.length ? (
        <span className="min-w-0 basis-full text-xs text-white/55 break-words sm:basis-auto" data-testid="allowed-banned-names">{section.banned.join(", ")}</span>
      ) : null}
    </div>
  );
}

function Notes({ entry, section }) {
  return ownRestrictionParts(entry, section).map((note) => (
    <p key={note} className="text-[11px] font-semibold leading-snug text-warn break-words" data-testid="allowed-note">{note}</p>
  ));
}

function EntryTile({ entry, section }) {
  return (
    <li className="min-w-0" data-testid="allowed-entry">
      <EquipmentThumb src={entry.image_url} />
      <p className="mt-1.5 text-sm font-semibold leading-snug text-white break-words">{entry.name}</p>
      <Notes entry={entry} section={section} />
    </li>
  );
}

// Eine Waffe mit passenden Aufsätzen: die ganze Karte ist der Knopf (große Fläche, Tastatur, `aria-expanded`).
function WeaponTile({ entry, section, open, panelId, onToggle }) {
  return (
    <li className="min-w-0" data-testid="allowed-entry">
      <button type="button" onClick={onToggle} aria-expanded={open} aria-controls={panelId} data-testid="allowed-weapon-toggle"
        className="group block w-full rounded-sm text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#29B6E8]">
        <EquipmentThumb src={entry.image_url} className={`transition-shadow duration-fast ${open ? "ring-1 ring-[#29B6E8]/70" : "group-hover:ring-1 group-hover:ring-white/25"}`} />
        <span className="mt-1.5 block text-sm font-semibold leading-snug text-white break-words">{entry.name}</span>
        <Notes entry={entry} section={section} />
        <span className={`mt-1 inline-flex items-center gap-1 text-[11px] font-semibold tabular-nums transition-colors duration-fast ${open ? "text-[#29B6E8]" : "text-white/60 group-hover:text-white"}`}
          data-testid="allowed-weapon-summary">
          {attachmentsSummary(entry.attachments)}
          <ChevronDown className={`h-3.5 w-3.5 transition-transform duration-fast ${open ? "rotate-180" : ""}`} aria-hidden="true" />
        </span>
      </button>
    </li>
  );
}

function AttachmentsPanel({ entry, id }) {
  const { banned = [] } = entry.attachments || {};
  const groups = (entry.attachments?.groups || []).filter((group) => group.entries?.length);
  return (
    <li id={id} className="col-span-full min-w-0 rounded-sm border border-[#29B6E8]/30 bg-[#0A0A0A] p-3 sm:p-4" data-testid="allowed-attachments"
      aria-label={`Aufsätze für ${entry.name}`}>
      <p className="text-[11px] font-bold uppercase tracking-widest text-white/60">Erlaubte Aufsätze für <span className="text-white">{entry.name}</span></p>
      {!groups.length ? <p className="mt-2 text-sm text-white/70">Keine Aufsätze erlaubt.</p> : null}
      <div className="mt-3 space-y-4">
        {groups.map((group) => (
          <div key={group.label || "ohne"} data-testid="allowed-slot">
            {group.label ? (
              <p className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] font-bold uppercase tracking-widest text-[#29B6E8]">
                <SubcategoryIcon src={group.icon_url} className="h-4 w-4" />
                <span className="break-words">{group.label}</span>
                {modesNote(group) ? <span className="font-semibold normal-case tracking-normal text-warn">{modesNote(group)}</span> : null}
              </p>
            ) : null}
            <StaggerIn as="ul" className="grid grid-cols-3 gap-2.5 sm:grid-cols-4 lg:grid-cols-6">
              {group.entries.map((item) => (
                <li key={item.name} className="min-w-0" data-testid="allowed-attachment">
                  <EquipmentThumb src={item.image_url} sizes={SMALL_TILE} />
                  <p className="mt-1 text-xs font-semibold leading-snug text-white break-words">{item.name}</p>
                  <Notes entry={item} section={group} />
                </li>
              ))}
            </StaggerIn>
          </div>
        ))}
      </div>
      {banned.length || entry.attachments?.banned_everywhere ? (
        <p className="mt-4 border-t border-white/10 pt-2.5 text-xs text-white/60 break-words" data-testid="allowed-attachments-banned">
          {banned.length ? <><span className="font-semibold text-warn">Gesperrt:</span> {banned.join(", ")}</> : null}
          {/* Die an keiner Waffe erlaubten stehen einmal unter den Waffen (Fabian, 04.11.) - hier nur die Zahl, damit „K gesperrt“ aufgeht. */}
          {entry.attachments?.banned_everywhere ? (
            <span data-testid="allowed-attachments-everywhere">{banned.length ? " · " : ""}dazu {entry.attachments.banned_everywhere === 1 ? "1 Aufsatz, der an keiner Waffe erlaubt ist" : `${entry.attachments.banned_everywhere} Aufsätze, die an keiner Waffe erlaubt sind`}</span>
          ) : null}
        </p>
      ) : null}
    </li>
  );
}

function Section({ section, sectionKey }) {
  const [open, setOpen] = useState(() => new Set());
  const toggle = (name) => setOpen((current) => {
    const next = new Set(current);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    return next;
  });
  if (!section.entries?.length) return null;
  // `grid-flow-row-dense`: Der aufgeklappte Kasten füllt die nächste Zeile, die übrigen Karten rücken in die Lücke davor.
  return (
    <ul className="grid grid-flow-row-dense grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {section.entries.map((entry, index) => {
        if (!entry.attachments) return <EntryTile key={entry.name} entry={entry} section={section} />;
        const panelId = `aufsaetze-${sectionKey}-${index}`;
        return [
          <WeaponTile key={entry.name} entry={entry} section={section} open={open.has(entry.name)} panelId={panelId} onToggle={() => toggle(entry.name)} />,
          open.has(entry.name) ? <AttachmentsPanel key={`${entry.name}-aufsaetze`} entry={entry} id={panelId} /> : null,
        ];
      })}
    </ul>
  );
}

// `hideTitle`: Die Überschrift steht schon außen (aufklappbarer Kasten der Matchseite).
export function AllowedEquipmentView({ data, title = "Erlaubte Ausrüstung", className = "mt-14", headingId = "allowed-equipment-title",
  testId = "allowed-equipment", hideTitle = false }) {
  if (!data || !LAYOUTS.includes(data.layout)) return null;
  const categories = data.categories || [];
  const nowhere = everywhereText(data);
  const lastWeapons = categories.map((category) => category.role).lastIndexOf("weapon");
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
        {categories.map((category, categoryIndex) => (
          <div key={category.label} data-testid="allowed-group">
            <h3 className="flex flex-wrap items-baseline gap-x-2 border-b border-white/10 pb-2 font-heading text-lg font-bold uppercase leading-tight text-white">
              <span className="break-words">{category.label}</span>
              <span className="font-sans text-[11px] font-semibold normal-case tracking-normal text-white/45 tabular-nums">{countText(allowedCount(category), "erlaubt", "erlaubt")}</span>
            </h3>
            <div className="mt-4 space-y-6">
              {category.sections.map((section, sectionIndex) => (
                <div key={section.label || "ohne"} data-testid="allowed-section">
                  <SectionHead section={section} />
                  <Section section={section} sectionKey={`${testId}-${categoryIndex}-${sectionIndex}`} />
                </div>
              ))}
            </div>
            {nowhere && categoryIndex === lastWeapons ? (
              <p className="mt-6 flex flex-wrap items-baseline gap-x-2 gap-y-1 rounded-sm border border-warn/30 bg-warn/5 px-3 py-2 text-sm text-white/80 break-words"
                data-testid="allowed-nowhere">
                <span className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-warn">
                  <Ban className="h-3 w-3" aria-hidden="true" /> An keiner Waffe erlaubt
                </span>
                <span className="min-w-0">{nowhere}</span>
              </p>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}
