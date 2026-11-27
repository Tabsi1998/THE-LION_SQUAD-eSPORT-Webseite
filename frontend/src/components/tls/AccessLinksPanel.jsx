import { useCallback, useEffect, useState } from "react";
import { api, formatRequestError } from "@/lib/api";
import { Copy, Link2, Plus, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { viennaDate } from "@/lib/vienna";
import { PersonPicker } from "@/components/tls/PersonPicker";

// Wofür der Link gilt, im Satz „Gezielt Zugriff auf ein gesperrtes oder internes … geben“ (#2262: vorher „interne Turnier“).
const TARGET_PHRASES = {
  event: "ein gesperrtes oder internes Event",
  tournament: "ein gesperrtes oder internes Turnier",
  fastlap: "eine gesperrte oder interne Fast-Lap",
};

/** Der Satz unter der Überschrift: „Gezielt Zugriff auf ein gesperrtes oder internes Turnier geben.“ */
export function accessLinksHint(kind) {
  if (kind === "staffel") return "Gezielt Zugriff auf die Staffel geben, solange sie nicht öffentlich ist.";
  return `Gezielt Zugriff auf ${TARGET_PHRASES[kind] || "gesperrte oder interne Inhalte"} geben.`;
}

function linkStateLabel(link) {
  if (link.is_active === false) return "Deaktiviert";
  if (link.is_expired) return "Abgelaufen";
  if (link.is_exhausted) return "Limit erreicht";
  return "Aktiv";
}

function linkStateClass(link) {
  if (link.is_active === false) return "text-white/40";
  if (link.is_expired || link.is_exhausted) return "text-quiet";
  return "text-ok";
}

function absoluteUrl(path) {
  if (!path) return "";
  if (/^https?:\/\//i.test(path)) return path;
  return `${window.location.origin}${path}`;
}

async function copyText(value) {
  if (!value) return;
  await navigator.clipboard?.writeText(value).catch(() => null);
}

// `bare` (#2262, Staffel-Seite): ohne eigenen Rahmen und ohne eigene Überschrift - die Seite setzt beides, keine Karte in der Karte.
// `kind`: wie die Liste das Ziel nennt (`staffel` statt `tournament`), die Anfragen gehen weiter an `targetType`.
export function AccessLinksPanel({ targetType, targetId, allowRegister = false, collapsible = false, bare = false, kind = "" }) {
  const [links, setLinks] = useState([]);
  const [busy, setBusy] = useState(false);
  const [includeRegister, setIncludeRegister] = useState(allowRegister);
  const [note, setNote] = useState("");
  const [expiresInDays, setExpiresInDays] = useState("");
  const [maxUses, setMaxUses] = useState("");
  // Gebundene Person (#1354): aus der Personensuche - die Adresse für den Link holt der Server selbst aus dem Konto.
  const [person, setPerson] = useState(null);
  const [email, setEmail] = useState("");
  const [notifyUser, setNotifyUser] = useState(false);
  const [createdUrl, setCreatedUrl] = useState("");
  const [includeInactive, setIncludeInactive] = useState(false);
  const [loadError, setLoadError] = useState("");
  // In der Staffel heißen sie wie auf der Seite „Zugangslinks“ - ein Wort für eine Sache.
  const word = kind === "staffel" ? "Zugangslinks" : "Speziallinks";

  const load = useCallback(async () => {
    if (!targetType || !targetId) return;
    const { data } = await api.get("/access-links", {
      params: { target_type: targetType, target_id: targetId, include_inactive: includeInactive },
    });
    setLinks(data || []);
    setLoadError("");
  }, [targetType, targetId, includeInactive]);

  // Ladefehler sichtbar (#2262): sonst stünde „Noch keine aktiven Speziallinks“ da, obwohl es welche gibt.
  useEffect(() => {
    load().catch((failure) => {
      setLinks([]);
      setLoadError(formatRequestError(failure, `Die ${word} ließen sich nicht laden.`));
    });
  }, [load, word]);

  const create = async () => {
    setBusy(true);
    try {
      const days = Number(expiresInDays || 0);
      const max = Number(maxUses || 0);
      const expiresAt = days > 0 ? new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString() : null;
      const grants = ["view", ...(includeRegister && allowRegister ? ["register"] : [])];
      const { data } = await api.post("/access-links", {
        target_type: targetType,
        target_id: targetId,
        grants,
        expires_at: expiresAt,
        max_uses: max > 0 ? max : null,
        user_id: person?.id || null,
        email: person ? null : email.trim() || null,
        note: note.trim() || null,
        notify_user: notifyUser && !!person,
      });
      const url = data.absolute_url || absoluteUrl(data.url);
      setCreatedUrl(url);
      await copyText(url);
      toast.success("Speziallink erstellt und kopiert.");
      setNote("");
      setExpiresInDays("");
      setMaxUses("");
      await load();
    } catch (err) {
      toast.error(formatRequestError(err, "Speziallink konnte nicht erstellt werden."));
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (link) => {
    setBusy(true);
    try {
      await api.delete(`/access-links/${link.id}`);
      toast.success("Speziallink deaktiviert.");
      await load();
    } catch (err) {
      toast.error(formatRequestError(err, "Speziallink konnte nicht deaktiviert werden."));
    } finally {
      setBusy(false);
    }
  };

  const cleanup = async () => {
    setBusy(true);
    try {
      const { data } = await api.post("/access-links/cleanup", null, {
        params: { target_type: targetType, target_id: targetId },
      });
      toast.success(data.deactivated ? `${data.deactivated} Speziallink(s) deaktiviert.` : "Keine alten Speziallinks gefunden.");
      await load();
    } catch (err) {
      toast.error(formatRequestError(err, "Speziallinks konnten nicht aufgeräumt werden."));
    } finally {
      setBusy(false);
    }
  };

  const title = (
    <div>
      <div className="inline-flex items-center gap-2 tls-type-label text-brand">
        <Link2 className="w-3.5 h-3.5" /> Speziallinks
      </div>
      <p className="mt-1 tls-type-small text-white/50">
        {accessLinksHint(kind || targetType)}
      </p>
    </div>
  );
  const createButton = (
    <button
      type="button"
      onClick={create}
      disabled={busy}
      className="tls-btn tls-btn--primary inline-flex items-center gap-2 px-3 py-2 rounded-sm tls-type-label disabled:opacity-50"
    >
      <Plus className="w-3.5 h-3.5" /> Erstellen
    </button>
  );

  const body = (
    <>
      {collapsible && <div className="flex justify-end">{createButton}</div>}
      <div className="flex flex-wrap items-center justify-between gap-2 border border-white/10 bg-[#0A0A0A]/50 rounded-sm px-3 py-2">
        <label className="inline-flex items-center gap-2 tls-type-small text-white/65">
          <input type="checkbox" checked={includeInactive} onChange={(event) => setIncludeInactive(event.target.checked)} className="accent-brand" />
          Deaktivierte anzeigen
        </label>
        <button
          type="button"
          onClick={cleanup}
          disabled={busy}
          className="tls-btn tls-btn--quiet inline-flex items-center gap-2 px-3 py-2 rounded-sm tls-type-label disabled:opacity-50"
        >
          <RefreshCw className="w-3.5 h-3.5" /> Alte deaktivieren
        </button>
      </div>

      {createdUrl && (
        <div className="flex flex-wrap items-center gap-2 border border-ok/25 bg-ok/10 rounded-sm p-3">
          <div className="min-w-0 flex-1">
            <div className="tls-type-label text-ok">Gerade erstellt</div>
            <div className="mt-1 tls-type-small text-white/75 break-all">{createdUrl}</div>
          </div>
          <button
            type="button"
            onClick={async () => {
              await copyText(createdUrl);
              toast.success("Link kopiert.");
            }}
            className="tls-btn tls-btn--secondary inline-flex items-center gap-2 px-3 py-2 rounded-sm tls-type-label"
          >
            <Copy className="w-3.5 h-3.5" /> Kopieren
          </button>
        </div>
      )}

      <div className="grid md:grid-cols-[1fr_8rem_8rem_auto] gap-2 items-end">
        <label className="block">
          <span className="block tls-type-label text-white/45 mb-1.5">Notiz</span>
          <input
            value={note}
            onChange={(event) => setNote(event.target.value)}
            maxLength={500}
            placeholder="z.B. Gastteam, Presse, externer Fahrer"
            className="w-full bg-[#0A0A0A] border border-white/10 rounded-sm px-3 py-2 text-sm"
          />
        </label>
        <label className="block">
          <span className="block tls-type-label text-white/45 mb-1.5">Gültig Tage</span>
          <input
            type="number"
            min="1"
            max="365"
            value={expiresInDays}
            onChange={(event) => setExpiresInDays(event.target.value)}
            placeholder="offen"
            className="w-full bg-[#0A0A0A] border border-white/10 rounded-sm px-3 py-2 text-sm"
          />
        </label>
        <label className="block">
          <span className="block tls-type-label text-white/45 mb-1.5">Max.</span>
          <input
            type="number"
            min="1"
            max="10000"
            value={maxUses}
            onChange={(event) => setMaxUses(event.target.value)}
            placeholder="offen"
            className="w-full bg-[#0A0A0A] border border-white/10 rounded-sm px-3 py-2 text-sm"
          />
        </label>
        {allowRegister && (
          <label className="inline-flex items-center gap-2 tls-type-small text-white/70 pb-2">
            <input type="checkbox" checked={includeRegister} onChange={(event) => setIncludeRegister(event.target.checked)} className="accent-brand" />
            Anmeldung freigeben
          </label>
        )}
      </div>

      <div className="grid md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-2 items-end">
        <PersonPicker purpose="access_links" contextId={targetType === "tournament" ? targetId : null} value={person} onChange={setPerson} label="Person (optional)" placeholder="Name tippen …" testId={`access-link-person-${targetType}`} />
        {person ? (
          <div className="tls-type-small text-white/50 pb-2">Der Link gilt nur für dieses Konto; die Adresse kommt aus dem Konto.</div>
        ) : (
          <label className="block">
            <span className="block tls-type-label text-white/45 mb-1.5">E-Mail optional (ohne Konto)</span>
            <input
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="name@example.com"
              className="w-full bg-[#0A0A0A] border border-white/10 rounded-sm px-3 py-2 text-sm"
            />
          </label>
        )}
        <label className="inline-flex items-center gap-2 tls-type-small text-white/70 pb-2">
          <input type="checkbox" checked={notifyUser} disabled={!person} onChange={(event) => setNotifyUser(event.target.checked)} className="accent-brand disabled:opacity-40" />
          Person benachrichtigen
        </label>
      </div>

      <div className="space-y-2">
        {links.map((link) => (
          <div key={link.id} className="flex flex-wrap items-center justify-between gap-3 border border-white/10 bg-[#0A0A0A]/70 rounded-sm px-3 py-2">
            <div className="min-w-0">
              <div className="tls-type-small font-bold text-white/80">
                <span className={linkStateClass(link)}>{linkStateLabel(link)}</span>
                <span className="text-white/30"> · </span>
                {(link.grants || []).join(", ")} {link.note ? <span className="text-white/40 font-normal">- {link.note}</span> : null}
              </div>
              <div className="mt-0.5 tls-type-small text-quiet">
                {link.use_count || 0}{link.max_uses ? `/${link.max_uses}` : ""} Aktionen
                {link.expires_at ? ` · bis ${viennaDate(link.expires_at)}` : " · ohne Ablauf"}
                {link.last_used_at ? ` · zuletzt ${viennaDate(link.last_used_at)}` : " · nie geöffnet"}
                {link.user_id ? " · usergebunden" : ""}
                {link.email ? ` · ${link.email}` : ""}
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => toast.info("Der vollständige Link ist nur direkt beim Erstellen sichtbar.")}
                className="p-2 border border-white/10 text-white/45 rounded-sm"
                title="Link-Hinweis"
              >
                <Copy className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => revoke(link)}
                disabled={busy || link.is_active === false}
                className="p-2 border border-live/35 text-live rounded-sm hover:bg-live/10 disabled:opacity-50"
                title="Deaktivieren"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        ))}
        {loadError ? <div role="alert" className="tls-type-small text-warn border border-warn/40 bg-warn/10 rounded-sm p-3" data-testid="access-links-error">{loadError}</div> : null}
        {links.length === 0 && !loadError && <div className="tls-type-small text-quiet border border-dashed border-white/10 rounded-sm p-3">Noch keine aktiven {word}.</div>}
      </div>
    </>
  );

  // Eingeklappt braucht die Tafel rund 40 statt 700 Pixel. Auf der
  // Turnierseite stand sie am Telefon zwischen Kopf und Reitern und schob
  // damit die eigentliche Arbeit unter den Bildschirmrand. Der Knopf
  // "Erstellen" wandert dabei in den Inhalt: ein Knopf in der Aufklappzeile
  // würde beim Drücken auch die Tafel zuklappen.
  if (collapsible) {
    return (
      <details className="border border-brand/25 bg-brand/5 rounded-sm p-4 group" data-testid="access-links-details">
        <summary className="cursor-pointer list-none flex items-start justify-between gap-3">
          {title}
          <span className="text-brand shrink-0 transition-transform group-open:rotate-90">→</span>
        </summary>
        <div className="mt-4 space-y-4">{body}</div>
      </details>
    );
  }

  if (bare) {
    return (
      <div className="space-y-4" data-testid="access-links-bare">
        <div className="flex justify-end">{createButton}</div>
        {body}
      </div>
    );
  }

  return (
    <section className="border border-brand/25 bg-brand/5 rounded-sm p-4 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        {title}
        {createButton}
      </div>
      {body}
    </section>
  );
}
