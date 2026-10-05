/**
 * Gemeinsames für die Reiter im Erfolge-Admin (E10, #620): Materialien und Kategorien mit Namen, die
 * Personensuche, die Stufen-Auswahl (nach Kategorie gruppiert, nur Namen), Rechte und kleine Bausteine.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Crown, Search, X } from "lucide-react";
import { api, formatApiError, resolveMediaUrl } from "@/lib/api";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { INPUT_CLASS } from "@/components/tls/FormFields";
import { asInstant, viennaDate, viennaDateTime } from "@/lib/vienna";

const LEVEL_NAMES = { 1: "Bronze", 2: "Silber", 3: "Gold", 4: "Platin", 5: "Legendär" };
// Erfolge II (#611): Material statt Level - Holz bis Diamant, dazu Legendär und Geheim.
export const MATERIALS = {
  wood: ["Holz", "#A0703C"], iron: ["Eisen", "#9AA0A6"], bronze: ["Bronze", "#CD7F32"], silver: ["Silber", "#C0C0C0"],
  gold: ["Gold", "#FFD700"], platinum: ["Platin", "#29B6E8"], diamond: ["Diamant", "#B9F2FF"], legendary: ["Legendär", "#FF3B30"], hidden: ["Geheim", "#A855F7"],
};
export const LADDER = ["wood", "iron", "bronze", "silver", "gold", "platinum", "diamond"];

export function materialLabel(tier) {
  if (tier?.material && MATERIALS[tier.material]) return MATERIALS[tier.material][0];
  return tier?.material_name || LEVEL_NAMES[tier?.level] || "?";
}
export function materialColor(tier) {
  if (tier?.material && MATERIALS[tier.material]) return MATERIALS[tier.material][1];
  return tier?.material_color || "#CD7F32";
}

export const CATEGORIES = [
  { value: "match", label: "Spielen" },
  { value: "tournament", label: "Turnier" },
  { value: "fastlap", label: "Fast Lap" },
  { value: "season", label: "Saison" },
  { value: "team", label: "Team" },
  { value: "community", label: "Community" },
  { value: "creator", label: "Streaming & Creator" },
  { value: "profile", label: "Profil & Konto" },
  { value: "club", label: "Verein (nur Mitglieder)" },
  { value: "special", label: "Besonders" },
  { value: "hidden", label: "Geheim" },
  { value: "negative", label: "Negativ" },
];
const LEGACY_CATEGORIES = { content: "creator", progression: "profile" };
export function categoryOf(group) {
  if (group?.is_negative) return "negative";
  const raw = group?.category || "special";
  return LEGACY_CATEGORIES[raw] || raw;
}
export function categoryLabel(key) {
  return CATEGORIES.find((c) => c.value === key)?.label || key || "";
}

// Was im Protokoll steht - als Wort, nicht als Schlüssel.
export const EVENT_KINDS = {
  award: "Vergabe", revoke: "Rücknahme", bulk_award: "Massenvergabe", xp: "XP-Korrektur", prestige_reset: "Prestige zurückgesetzt",
  season_award: "Saisonabschluss", import: "Katalog-Import", group_create: "Gruppe angelegt", group_update: "Gruppe geändert",
  group_delete: "Gruppe gelöscht", tier_create: "Stufe angelegt", tier_update: "Stufe geändert", tier_delete: "Stufe gelöscht",
  incident: "Vorfall", evaluate_all: "Alle ausgewertet",
};

export const XP_SOURCES = {
  match_played: "Match gespielt", match_won: "Match gewonnen", tournament_registered: "Turnieranmeldung", checked_in: "Check-in",
  tournament_completed: "Turnier beendet", podium_1: "Platz 1", podium_2: "Platz 2", podium_3: "Platz 3", lap_valid: "Gültige Runde",
  personal_best: "Persönliche Bestzeit", pole: "Pole", event_attended: "Event besucht", discord_message: "Discord-Nachricht",
  community_chat: "Community-Chat", team_chat: "Team-Chat", daily_login: "Täglicher Besuch", friend: "Freundschaft",
  team_joined: "Team beigetreten", season_completed: "Saison abgeschlossen", meeting: "Versammlung", helper_hour: "Helferstunde",
  vote: "Abstimmung", achievement: "Erfolg", correction: "Korrektur",
};

export function errorText(err, fallback = "Das hat nicht geklappt.") {
  return formatApiError(err?.response?.data?.detail) || fallback;
}

export function formatWhen(value, withTime = true) {
  if (!value) return "–";
  const date = asInstant(value);
  if (Number.isNaN(date.getTime())) return "–";
  return withTime ? viennaDateTime(date, { dateStyle: "short", timeStyle: "short" }) : viennaDate(date);
}

export function personName(person) {
  return person?.display_name || person?.user_name || person?.username || "Unbekannt";
}

/** Eine Datei vom Server holen und speichern (CSV, JSON). */
export async function download(path, filename) {
  const { data } = await api.get(path, { responseType: "blob" });
  const blob = data instanceof Blob ? data : new Blob([typeof data === "string" ? data : JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/** Darf diese Person Massenvergabe, Import und XP-Eingriffe? (Vorstand oder Systemverwaltung) */
export function useBoardRights() {
  const [board, setBoard] = useState(false);
  useEffect(() => {
    let alive = true;
    api.get("/admin/achievements/me").then(({ data }) => { if (alive) setBoard(Boolean(data?.board)); }).catch(() => {});
    return () => { alive = false; };
  }, []);
  return board;
}

/** Gruppen und Stufen für Auswahl und Anzeige - Namen statt Schlüssel. */
export function useCatalog() {
  const [groups, setGroups] = useState([]);
  const [tiers, setTiers] = useState([]);
  const load = useCallback(async () => {
    try {
      const [g, t] = await Promise.all([api.get("/admin/achievements/groups"), api.get("/admin/achievements/tiers")]);
      setGroups(Array.isArray(g.data) ? g.data : []);
      setTiers(Array.isArray(t.data) ? t.data : []);
    } catch {
      /* die Reiter zeigen dann leere Listen */
    }
  }, []);
  useEffect(() => { load(); }, [load]);
  useApiInvalidation(load, ["achievements"]);
  const byCode = useMemo(() => Object.fromEntries(groups.map((g) => [g.code, g])), [groups]);
  return { groups, tiers, groupsByCode: byCode, reload: load };
}

export function Panel({ title, hint, icon: Icon, accent = "#FFD700", actions, children, testId, className = "" }) {
  return (
    <section className={`border border-white/10 bg-[#121212] rounded-sm ${className}`} data-testid={testId}>
      {(title || actions) && (
        <header className="px-4 sm:px-5 pt-4 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            {title && (
              <h2 className="text-[11px] font-bold uppercase tracking-widest text-white/80 inline-flex items-center gap-2">
                {Icon && <Icon className="w-3.5 h-3.5" style={{ color: accent }} />} {title}
              </h2>
            )}
            {hint && <p className="mt-1 text-xs text-white/50 max-w-2xl">{hint}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className="p-4 sm:p-5">{children}</div>
    </section>
  );
}

export function Stat({ label, value, hint, accent = "#FFD700", testId }) {
  // Wörter (seltenste Stufe, Kategorie) kleiner und umbrechend statt abgeschnitten; Zahlen groß.
  const wordy = typeof value === "string" && value.length > 7;
  return (
    <div className="border border-white/10 bg-[#0F0F10] rounded-sm px-4 py-3 min-w-0" data-testid={testId}>
      <div className="text-[10px] font-bold uppercase tracking-widest text-white/45">{label}</div>
      <div className={`mt-1 font-heading font-black tabular-nums break-words ${wordy ? "text-lg leading-tight" : "text-2xl truncate"}`} style={{ color: accent }}>{value}</div>
      {hint && <div className="mt-0.5 text-[11px] text-white/50">{hint}</div>}
    </div>
  );
}

/** Datei wählen - ein eigener Knopf statt des Browser-Felds (das spricht sonst die Sprache des Browsers). */
export function FilePick({ label = "Datei wählen", accept, onFile, testId }) {
  return (
    <label className="inline-flex items-center gap-2 px-3 py-1.5 border border-white/20 text-white/70 hover:text-white text-[10px] font-bold uppercase tracking-widest rounded-sm cursor-pointer focus-within:ring-1 focus-within:ring-[#29B6E8]">
      {label}
      <input type="file" accept={accept} onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ""; }} data-testid={testId} className="sr-only" />
    </label>
  );
}

/** Waagrechte Balken mit Beschriftung - für Verteilungen und Anteile. */
export function Bars({ rows, accent = "#29B6E8", testId, unit = "" }) {
  const max = Math.max(1, ...rows.map((row) => row.value || 0));
  return (
    <div className="space-y-1.5" data-testid={testId}>
      {rows.map((row) => (
        <div key={row.key} className="grid grid-cols-[minmax(0,7.5rem)_1fr_auto] items-center gap-2 text-xs" data-testid={testId ? `${testId}-${row.key}` : undefined}>
          <span className="text-white/60 truncate">{row.label}</span>
          <span className="h-2.5 bg-white/5 rounded-sm overflow-hidden">
            <span className="block h-full rounded-sm" style={{ width: `${Math.round(((row.value || 0) / max) * 100)}%`, backgroundColor: row.color || accent }} />
          </span>
          <span className="tabular-nums text-white/70 min-w-[2.5rem] text-right">{row.value || 0}{unit}</span>
        </div>
      ))}
    </div>
  );
}

export function MaterialChip({ tier, className = "" }) {
  return (
    <span className={`text-[10px] font-bold uppercase tracking-widest ${className}`} style={{ color: materialColor(tier) }}>{materialLabel(tier)}</span>
  );
}

/** Personensuche: tippen, auswählen; die Auswahl bleibt als Chip stehen. */
export function PersonPicker({ value, onChange, testId = "person", label = "Person" }) {
  const [q, setQ] = useState("");
  const [users, setUsers] = useState([]);
  useEffect(() => {
    if (value) return undefined;
    const timer = setTimeout(() => {
      api.get(`/admin/achievements/users/search?q=${encodeURIComponent(q)}`).then(({ data }) => setUsers(Array.isArray(data) ? data : [])).catch(() => setUsers([]));
    }, 200);
    return () => clearTimeout(timer);
  }, [q, value]);

  if (value) {
    return (
      <div className="flex items-center gap-3 border border-[#FFD700]/30 bg-[#FFD700]/5 rounded-sm px-3 py-2" data-testid={`${testId}-selected`}>
        {value.avatar_url ? <img src={resolveMediaUrl(value.avatar_url)} alt="" className="w-8 h-8 rounded-sm object-cover" /> : <div className="w-8 h-8 rounded-sm bg-[#0A0A0A] border border-white/10" />}
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold truncate">{personName(value)}</div>
          <div className="text-[10px] text-white/45 truncate">@{value.username}{value.is_club_member ? " · Vereinsmitglied" : ""}</div>
        </div>
        <button type="button" onClick={() => onChange(null)} aria-label="Andere Person wählen" data-testid={`${testId}-clear`} className="p-1 text-white/50 hover:text-white">
          <X className="w-4 h-4" />
        </button>
      </div>
    );
  }
  return (
    <div>
      <label className="block">
        <span className="text-[10px] font-bold uppercase tracking-widest text-white/50">{label}</span>
        <span className="relative mt-1 block">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
          <input value={q} onChange={(e) => setQ(e.target.value)} data-testid={`${testId}-search`} placeholder="Name, Benutzername oder E-Mail …" className={`${INPUT_CLASS} pl-9`} />
        </span>
      </label>
      <div className="mt-2 max-h-60 overflow-y-auto divide-y divide-white/5 border border-white/5 rounded-sm">
        {users.map((u) => (
          <button key={u.id} type="button" onClick={() => onChange(u)} data-testid={`${testId}-option-${u.id}`} className="w-full text-left px-3 py-2 hover:bg-white/5 transition flex items-center gap-3">
            {u.avatar_url ? <img src={resolveMediaUrl(u.avatar_url)} alt="" className="w-7 h-7 rounded-sm object-cover" /> : <div className="w-7 h-7 rounded-sm bg-[#0A0A0A] border border-white/10" />}
            <div className="min-w-0">
              <div className="text-sm font-semibold truncate">{personName(u)}</div>
              <div className="text-[10px] text-white/40 truncate">@{u.username}</div>
            </div>
            {u.is_club_member && <Crown className="ml-auto w-3.5 h-3.5 text-[#FFD700]" aria-label="Vereinsmitglied" />}
          </button>
        ))}
        {!users.length && <div className="px-3 py-5 text-center text-xs text-white/40">Keine Treffer.</div>}
      </div>
    </div>
  );
}

/** Stufen-Auswahl, nach Kategorie gruppiert: „Gruppe · Material · Stufe“ - nur Namen. */
export function TierSelect({ tiers, groupsByCode, value, onChange, testId, label = "Stufe", filter }) {
  const sections = useMemo(() => {
    const out = new Map(CATEGORIES.map((c) => [c.value, []]));
    for (const tier of tiers) {
      const group = groupsByCode[tier.group_code];
      if (!group || (filter && !filter(tier, group))) continue;
      const key = categoryOf(group);
      if (!out.has(key)) out.set(key, []);
      out.get(key).push({ tier, group });
    }
    return [...out.entries()].filter(([, rows]) => rows.length);
  }, [tiers, groupsByCode, filter]);
  return (
    <label className="block">
      <span className="text-[10px] font-bold uppercase tracking-widest text-white/50">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} data-testid={testId} className={`${INPUT_CLASS} mt-1`}>
        <option value="">— wählen —</option>
        {sections.map(([key, rows]) => (
          <optgroup key={key} label={categoryLabel(key)}>
            {rows.map(({ tier, group }) => (
              <option key={tier.code} value={tier.code}>{`${group.name} · ${materialLabel(tier)} · ${tier.name}${tier.member_only ? " (nur Mitglieder)" : ""}`}</option>
            ))}
          </optgroup>
        ))}
      </select>
    </label>
  );
}

export function BoardOnly({ board, children, what = "Das" }) {
  if (board) return children;
  return (
    <p className="text-xs text-white/50 border border-white/10 bg-[#0F0F10] rounded-sm px-3 py-2" data-testid="board-only">
      {what} dürfen nur der Vorstand oder die Systemverwaltung.
    </p>
  );
}
