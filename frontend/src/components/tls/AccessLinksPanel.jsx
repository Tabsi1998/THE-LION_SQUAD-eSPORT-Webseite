import { useCallback, useEffect, useState } from "react";
import { api, formatRequestError } from "@/lib/api";
import { Copy, Link2, Plus, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";

const TARGET_LABELS = {
  event: "Event",
  tournament: "Turnier",
  fastlap: "Fast-Lap",
};

function linkStateLabel(link) {
  if (link.is_active === false) return "Deaktiviert";
  if (link.is_expired) return "Abgelaufen";
  if (link.is_exhausted) return "Limit erreicht";
  return "Aktiv";
}

function linkStateClass(link) {
  if (link.is_active === false) return "text-white/40";
  if (link.is_expired || link.is_exhausted) return "text-[#FF3B30]";
  return "text-[#00FF88]";
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

export function AccessLinksPanel({ targetType, targetId, allowRegister = false }) {
  const [links, setLinks] = useState([]);
  const [users, setUsers] = useState([]);
  const [busy, setBusy] = useState(false);
  const [includeRegister, setIncludeRegister] = useState(allowRegister);
  const [note, setNote] = useState("");
  const [expiresInDays, setExpiresInDays] = useState("");
  const [maxUses, setMaxUses] = useState("");
  const [userId, setUserId] = useState("");
  const [email, setEmail] = useState("");
  const [notifyUser, setNotifyUser] = useState(false);
  const [createdUrl, setCreatedUrl] = useState("");
  const [includeInactive, setIncludeInactive] = useState(false);

  const load = useCallback(async () => {
    if (!targetType || !targetId) return;
    const { data } = await api.get("/access-links", {
      params: { target_type: targetType, target_id: targetId, include_inactive: includeInactive },
    });
    setLinks(data || []);
  }, [targetType, targetId, includeInactive]);

  useEffect(() => {
    load().catch(() => setLinks([]));
  }, [load]);

  useEffect(() => {
    api.get("/users")
      .then(({ data }) => setUsers((data || []).filter((user) => user?.id)))
      .catch(() => setUsers([]));
  }, []);

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
        user_id: userId || null,
        email: email.trim() || null,
        note: note.trim() || null,
        notify_user: notifyUser && !!userId,
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

  return (
    <section className="border border-[#FFD700]/25 bg-[#FFD700]/5 rounded-sm p-4 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="inline-flex items-center gap-2 text-[11px] uppercase tracking-widest font-bold text-[#FFD700]">
            <Link2 className="w-3.5 h-3.5" /> Speziallinks
          </div>
          <p className="mt-1 text-xs text-white/50">
            Gezielt Zugriff auf gesperrte oder interne {TARGET_LABELS[targetType] || "Inhalte"} geben.
          </p>
        </div>
        <button
          type="button"
          onClick={create}
          disabled={busy}
          className="inline-flex items-center gap-2 px-3 py-2 bg-[#FFD700] text-black rounded-sm text-xs uppercase tracking-wider font-bold disabled:opacity-50"
        >
          <Plus className="w-3.5 h-3.5" /> Erstellen
        </button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border border-white/10 bg-[#0A0A0A]/50 rounded-sm px-3 py-2">
        <label className="inline-flex items-center gap-2 text-xs text-white/65">
          <input type="checkbox" checked={includeInactive} onChange={(event) => setIncludeInactive(event.target.checked)} className="accent-[#FFD700]" />
          Deaktivierte anzeigen
        </label>
        <button
          type="button"
          onClick={cleanup}
          disabled={busy}
          className="inline-flex items-center gap-2 px-3 py-2 border border-white/10 text-white/65 rounded-sm text-xs uppercase tracking-wider font-bold hover:text-white disabled:opacity-50"
        >
          <RefreshCw className="w-3.5 h-3.5" /> Alte deaktivieren
        </button>
      </div>

      {createdUrl && (
        <div className="flex flex-wrap items-center gap-2 border border-[#00FF88]/25 bg-[#00FF88]/10 rounded-sm p-3">
          <div className="min-w-0 flex-1">
            <div className="text-[10px] uppercase tracking-widest font-bold text-[#00FF88]">Gerade erstellt</div>
            <div className="mt-1 text-xs text-white/75 break-all">{createdUrl}</div>
          </div>
          <button
            type="button"
            onClick={async () => {
              await copyText(createdUrl);
              toast.success("Link kopiert.");
            }}
            className="inline-flex items-center gap-2 px-3 py-2 border border-[#00FF88]/35 text-[#00FF88] rounded-sm text-xs uppercase tracking-wider font-bold"
          >
            <Copy className="w-3.5 h-3.5" /> Kopieren
          </button>
        </div>
      )}

      <div className="grid md:grid-cols-[1fr_8rem_8rem_auto] gap-2 items-end">
        <label className="block">
          <span className="block text-[11px] uppercase tracking-widest font-bold text-white/45 mb-1.5">Notiz</span>
          <input
            value={note}
            onChange={(event) => setNote(event.target.value)}
            maxLength={500}
            placeholder="z.B. Gastteam, Presse, externer Fahrer"
            className="w-full bg-[#0A0A0A] border border-white/10 rounded-sm px-3 py-2 text-sm"
          />
        </label>
        <label className="block">
          <span className="block text-[11px] uppercase tracking-widest font-bold text-white/45 mb-1.5">Gültig Tage</span>
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
          <span className="block text-[11px] uppercase tracking-widest font-bold text-white/45 mb-1.5">Max.</span>
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
          <label className="inline-flex items-center gap-2 text-xs text-white/70 pb-2">
            <input type="checkbox" checked={includeRegister} onChange={(event) => setIncludeRegister(event.target.checked)} className="accent-[#FFD700]" />
            Anmeldung freigeben
          </label>
        )}
      </div>

      <div className="grid md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-2 items-end">
        <label className="block">
          <span className="block text-[11px] uppercase tracking-widest font-bold text-white/45 mb-1.5">User optional</span>
          <select
            value={userId}
            onChange={(event) => {
              const nextUserId = event.target.value;
              setUserId(nextUserId);
              const selected = users.find((user) => user.id === nextUserId);
              if (selected?.email) setEmail(selected.email);
            }}
            className="w-full bg-[#0A0A0A] border border-white/10 rounded-sm px-3 py-2 text-sm"
          >
            <option value="">nicht gebunden</option>
            {users.map((user) => (
              <option key={user.id} value={user.id}>
                {user.display_name || user.username || user.email} {user.email ? `(${user.email})` : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="block text-[11px] uppercase tracking-widest font-bold text-white/45 mb-1.5">E-Mail optional</span>
          <input
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="name@example.com"
            className="w-full bg-[#0A0A0A] border border-white/10 rounded-sm px-3 py-2 text-sm"
          />
        </label>
        <label className="inline-flex items-center gap-2 text-xs text-white/70 pb-2">
          <input type="checkbox" checked={notifyUser} disabled={!userId} onChange={(event) => setNotifyUser(event.target.checked)} className="accent-[#FFD700] disabled:opacity-40" />
          User benachrichtigen
        </label>
      </div>

      <div className="space-y-2">
        {links.map((link) => (
          <div key={link.id} className="flex flex-wrap items-center justify-between gap-3 border border-white/10 bg-[#0A0A0A]/70 rounded-sm px-3 py-2">
            <div className="min-w-0">
              <div className="text-xs font-bold text-white/80">
                <span className={linkStateClass(link)}>{linkStateLabel(link)}</span>
                <span className="text-white/30"> · </span>
                {(link.grants || []).join(", ")} {link.note ? <span className="text-white/40 font-normal">- {link.note}</span> : null}
              </div>
              <div className="mt-0.5 text-[10px] uppercase tracking-widest text-white/35">
                {link.use_count || 0}{link.max_uses ? `/${link.max_uses}` : ""} Aktionen
                {link.expires_at ? ` · bis ${new Date(link.expires_at).toLocaleDateString("de-DE")}` : " · ohne Ablauf"}
                {link.last_used_at ? ` · zuletzt ${new Date(link.last_used_at).toLocaleDateString("de-DE")}` : " · nie geöffnet"}
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
                className="p-2 border border-[#FF3B30]/35 text-[#FF3B30] rounded-sm hover:bg-[#FF3B30]/10 disabled:opacity-50"
                title="Deaktivieren"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        ))}
        {links.length === 0 && <div className="text-xs text-white/40 border border-dashed border-white/10 rounded-sm p-3">Noch keine aktiven Speziallinks.</div>}
      </div>
    </section>
  );
}
