import { ArrowDown, ArrowUp, MapPin, Plus, Trash2 } from "lucide-react";
import { toDateTimeLocalInput, normalizeDateTimeFields } from "@/lib/datetime";

// Standorte eines Events (#203): hinzufügen, entfernen, sortieren. Jeder Standort hat Name
// (optional), Adresse, eigene Zeiten und eine Platzzahl als Hinweis. Ein Event mit einem
// Standort nutzt weiter die Felder oben; die Liste hier ist für „2, 3 oder mehr“.
// Die Anmeldung bleibt je Event - die Platzzahl je Standort ist eine Angabe, kein Limit.

const DATE_FIELDS = ["start_date", "end_date", "door_time"];

export function emptyLocation() {
  return { key: "", name: "", address: "", postal_code: "", city: "", country: "Österreich", start_date: "", end_date: "", door_time: "", max_participants: "", note: "" };
}

export function locationsToForm(locations) {
  return (locations || []).map((place) => ({
    key: place.key || "",
    name: place.name || "",
    address: place.address || "",
    postal_code: place.postal_code || "",
    city: place.city || "",
    country: place.country || "",
    start_date: toDateTimeLocalInput(place.start_date),
    end_date: toDateTimeLocalInput(place.end_date),
    door_time: toDateTimeLocalInput(place.door_time),
    max_participants: place.max_participants ?? "",
    note: place.note || "",
  }));
}

export function formToLocations(form) {
  return (form || []).map((place, index) => {
    const payload = { ...place, key: place.key || `ort-${index + 1}`, max_participants: place.max_participants === "" ? null : Number(place.max_participants) };
    return normalizeDateTimeFields(payload, DATE_FIELDS);
  });
}

export function locationsFormError(form) {
  for (const [index, place] of (form || []).entries()) {
    if (!place.name?.trim() && !place.address?.trim() && !place.city?.trim()) return `Standort ${index + 1}: Name oder Adresse fehlt.`;
    if (place.max_participants !== "" && !/^\d+$/.test(String(place.max_participants))) return `Standort ${index + 1}: Plätze als Zahl.`;
  }
  return "";
}

export function EventLocationsSection({ value, onChange }) {
  const places = value || [];
  const setPlace = (index, patch) => onChange(places.map((place, i) => (i === index ? { ...place, ...patch } : place)));
  const move = (index, delta) => {
    const next = [...places];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };
  const error = locationsFormError(places);
  const input = "w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm";

  return (
    <section className="border border-[#9F7AEA]/30 rounded-sm p-4 space-y-3" data-testid="event-locations">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="font-heading text-lg font-black uppercase inline-flex items-center gap-2"><MapPin className="w-4 h-4 text-[#9F7AEA]" /> Standorte</h3>
        <button type="button" onClick={() => onChange([...places, emptyLocation()])} className="inline-flex items-center gap-2 px-3 py-2 border border-white/15 text-white/70 hover:text-white text-xs uppercase tracking-wider font-bold rounded-sm" data-testid="event-locations-add">
          <Plus className="w-3.5 h-3.5" /> Standort
        </button>
      </div>
      {!places.length ? (
        <p className="text-xs text-white/55">Findet das Event an mehreren Orten statt (Treffpunkt, Halle, Lokal), kommen sie hier hin – jeder mit eigenem Datum, Zeiten, Adresse und Karte. Mit einem Ort reichen die Felder oben.</p>
      ) : (
        <>
          <p className="text-xs text-white/55">Der erste Standort ist der Hauptort und steht auch in Listen und in der App. Die Anmeldung gilt für das ganze Event; „Plätze“ ist ein Hinweis, kein Limit.</p>
          {places.map((place, index) => (
            <div key={index} className="border border-white/10 rounded-sm p-3 grid gap-2 md:grid-cols-12" data-testid={`event-location-${index}`}>
              <div className="md:col-span-12 flex items-center justify-between gap-2 text-[11px] uppercase tracking-widest text-white/45 font-bold">
                <span>Standort {index + 1}{index === 0 ? " · Hauptort" : ""}</span>
                <span className="flex items-center gap-1">
                  <button type="button" onClick={() => move(index, -1)} disabled={index === 0} className="p-1.5 border border-white/10 rounded-sm disabled:opacity-30" aria-label={`Standort ${index + 1} nach oben`}><ArrowUp className="w-3.5 h-3.5" /></button>
                  <button type="button" onClick={() => move(index, 1)} disabled={index === places.length - 1} className="p-1.5 border border-white/10 rounded-sm disabled:opacity-30" aria-label={`Standort ${index + 1} nach unten`}><ArrowDown className="w-3.5 h-3.5" /></button>
                  <button type="button" onClick={() => onChange(places.filter((_, i) => i !== index))} className="p-1.5 border border-[#FF3B30]/40 text-[#FF3B30] rounded-sm" aria-label={`Standort ${index + 1} entfernen`}><Trash2 className="w-3.5 h-3.5" /></button>
                </span>
              </div>
              <label className="md:col-span-6 text-xs"><div className="uppercase tracking-widest text-white/45 font-bold mb-1">Veranstaltungsort (Name, optional)</div><input value={place.name} onChange={(ev) => setPlace(index, { name: ev.target.value })} className={input} placeholder="Vereinsheim, Gemeindesaal Telfs" data-testid={`event-location-name-${index}`} /></label>
              <label className="md:col-span-6 text-xs"><div className="uppercase tracking-widest text-white/45 font-bold mb-1">Adresse</div><input value={place.address} onChange={(ev) => setPlace(index, { address: ev.target.value })} className={input} placeholder="Bahnhofstraße 1" /></label>
              <label className="md:col-span-2 text-xs"><div className="uppercase tracking-widest text-white/45 font-bold mb-1">PLZ</div><input value={place.postal_code} onChange={(ev) => setPlace(index, { postal_code: ev.target.value })} className={input} placeholder="6410" /></label>
              <label className="md:col-span-4 text-xs"><div className="uppercase tracking-widest text-white/45 font-bold mb-1">Stadt</div><input value={place.city} onChange={(ev) => setPlace(index, { city: ev.target.value })} className={input} placeholder="Telfs" /></label>
              <label className="md:col-span-3 text-xs"><div className="uppercase tracking-widest text-white/45 font-bold mb-1">Land</div><input value={place.country} onChange={(ev) => setPlace(index, { country: ev.target.value })} className={input} placeholder="Österreich" /></label>
              <label className="md:col-span-3 text-xs"><div className="uppercase tracking-widest text-white/45 font-bold mb-1">Plätze (Hinweis)</div><input value={place.max_participants} onChange={(ev) => setPlace(index, { max_participants: ev.target.value })} inputMode="numeric" className={input} placeholder="optional" /></label>
              <label className="md:col-span-4 text-xs"><div className="uppercase tracking-widest text-white/45 font-bold mb-1">Start</div><input type="datetime-local" value={place.start_date} onChange={(ev) => setPlace(index, { start_date: ev.target.value })} className={input} /></label>
              <label className="md:col-span-4 text-xs"><div className="uppercase tracking-widest text-white/45 font-bold mb-1">Ende</div><input type="datetime-local" value={place.end_date} onChange={(ev) => setPlace(index, { end_date: ev.target.value })} className={input} /></label>
              <label className="md:col-span-4 text-xs"><div className="uppercase tracking-widest text-white/45 font-bold mb-1">Einlass</div><input type="datetime-local" value={place.door_time} onChange={(ev) => setPlace(index, { door_time: ev.target.value })} className={input} /></label>
              <label className="md:col-span-12 text-xs"><div className="uppercase tracking-widest text-white/45 font-bold mb-1">Hinweis</div><input value={place.note} onChange={(ev) => setPlace(index, { note: ev.target.value })} className={input} placeholder="z. B. Treffpunkt Parkplatz, Fahrt mit dem Bus" /></label>
            </div>
          ))}
          {error && <div className="text-xs text-[#FF3B30]" data-testid="event-locations-error">{error}</div>}
          <p className="text-xs text-white/45">Ohne eigene Zeit gilt für einen Standort die Zeit des Events. Die Karte sucht nach der Adresse; der Name steht daneben.</p>
        </>
      )}
    </section>
  );
}
