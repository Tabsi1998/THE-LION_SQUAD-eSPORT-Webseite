import { useCallback, useEffect, useMemo, useState } from "react";
import { BellRing, CheckCircle2, ChevronDown, RefreshCw, Search, Send, Smartphone, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/api";
import { AdminLayout } from "@/components/tls/AdminLayout";
import { useConfirm } from "@/components/tls/ConfirmDialog";
import { viennaDateTime } from "@/lib/vienna";
import { pushErrorLabel, pushStateLabel } from "@/lib/pushStatus";
import { ShortCaps } from "@/components/tls/ShortCaps";

// Push-Tests (#2119 ML8): in Alltagssprache - „angenommen“ (der Push-Dienst hat die Nachricht genommen) und „zugestellt“
// (Apple oder Google haben sie ans Handy gegeben) statt Ticket und Receipt.
function devices(count) {
  const value = Number(count) || 0;
  return value === 1 ? "1 Gerät" : `${value} Geräte`;
}

// Abgemeldete Geräte (#2467): kein Fehler der Person, sondern ein altes Handy oder eine frühere Installation.
const OLD_DEVICE_TEXT = "abgemeldet – App gelöscht oder neu installiert";

function activeDevices(count) {
  const value = Number(count) || 0;
  return value === 0 ? "kein Gerät aktiv" : `${devices(value)} aktiv`;
}

function oldDevices(count) {
  const value = Number(count) || 0;
  return value === 1 ? "1 altes" : `${value} alte`;
}

function formatTime(value) {
  if (!value) return "-";
  try {
    return viennaDateTime(value);
  } catch {
    return value;
  }
}

function userLabel(user) {
  return user?.display_name || user?.username || user?.email || user?.id?.slice(0, 8) || "Benutzer";
}

export default function AdminMobilePushPage() {
  const [q, setQ] = useState("");
  const [users, setUsers] = useState([]);
  const [selected, setSelected] = useState(null);
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [showOld, setShowOld] = useState(false);
  const confirm = useConfirm();
  const [form, setForm] = useState({
    title: "Push an dein Handy",
    body: "Wenn du diese Nachricht am Handy siehst, funktionieren Push-Benachrichtigungen.",
  });

  const selectedUser = useMemo(
    () => users.find((user) => user.id === selected) || status?.user || null,
    [selected, status, users],
  );

  const loadUsers = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: "80" });
      if (q.trim()) params.set("q", q.trim());
      const { data } = await api.get(`/admin/mobile-push/users?${params.toString()}`);
      const rows = Array.isArray(data) ? data : [];
      setUsers(rows);
      if (!selected && rows[0]?.id) setSelected(rows[0].id);
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
    } finally {
      setLoading(false);
    }
  }, [q, selected]);

  const loadStatus = useCallback(async (userId = selected) => {
    if (!userId) {
      setStatus(null);
      return;
    }
    try {
      const { data } = await api.get(`/admin/mobile-push/status/${userId}`);
      setStatus(data);
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
    }
  }, [selected]);

  useEffect(() => { loadUsers(); }, [loadUsers]);
  useEffect(() => { loadStatus(selected); }, [loadStatus, selected]);
  // Eine andere Person: ihre alten Geräte beginnen wieder eingeklappt.
  useEffect(() => { setShowOld(false); }, [selected]);

  const activeTokens = useMemo(() => (status?.tokens || []).filter((token) => token.enabled !== false), [status]);
  const oldTokens = useMemo(() => (status?.tokens || []).filter((token) => token.enabled === false), [status]);
  const oldCount = Number.isFinite(Number(status?.disabled_count)) ? Number(status.disabled_count) : oldTokens.length;

  const sendTest = async () => {
    if (!selected || busy) return;
    setBusy(true);
    try {
      const { data } = await api.post("/admin/mobile-push/test", { user_id: selected, ...form });
      const count = Number(data?.notification?.push_sent_count || 0);
      toast.success(count > 0 ? `Test an ${devices(count)} geschickt.` : "Im Postfach angelegt – aber auf keinem Handy ist die App mit Push angemeldet.");
      await loadStatus(selected);
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
    } finally {
      setBusy(false);
    }
  };

  const checkReceipts = async () => {
    if (!selected || busy) return;
    setBusy(true);
    try {
      const { data } = await api.post(`/admin/mobile-push/receipts/${selected}`);
      toast.success(`Zustellung für ${devices(data?.checked)} nachgefragt.`);
      await loadStatus(selected);
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
    } finally {
      setBusy(false);
    }
  };

  const checkAllReceipts = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const { data } = await api.post("/admin/mobile-push/receipts");
      toast.success(`Zustellung für ${devices(data?.checked)} nachgefragt, ${devices(data?.disabled)} abgemeldet.`);
      await loadUsers();
      await loadStatus(selected);
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
    } finally {
      setBusy(false);
    }
  };

  const removeOld = async () => {
    if (!selected || busy || !oldCount) return;
    const ok = await confirm({
      title: "Alte Geräte entfernen?",
      description: `${oldCount === 1 ? "Der abgemeldete Eintrag" : `Die ${oldCount} abgemeldeten Einträge`} von ${userLabel(selectedUser)} ${oldCount === 1 ? "wird" : "werden"} gelöscht. Aktive Handys bleiben angemeldet. Der Schritt steht im Adminprotokoll.`,
      confirmLabel: "Entfernen",
    });
    if (!ok) return;
    setBusy(true);
    try {
      const { data } = await api.delete(`/admin/mobile-push/old-devices/${selected}`);
      const removed = Number(data?.removed || 0);
      toast.success(removed === 1 ? "1 altes Gerät entfernt." : `${removed} alte Geräte entfernt.`);
      setShowOld(false);
      await loadUsers();
      await loadStatus(selected);
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AdminLayout>
      <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
        <div>
          <span className="tls-type-label text-[#29B6E8]">System</span>
          <h1 className="tls-type-title mt-1"><ShortCaps>Push-Tests</ShortCaps></h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={checkAllReceipts}
            disabled={busy}
            className="inline-flex items-center gap-2 border border-white/10 bg-[#121212] px-3 py-2 rounded-sm tls-type-label hover:border-[#29B6E8]/50 disabled:opacity-50"
          >
            <BellRing className="w-4 h-4" /> Zustellung für alle prüfen
          </button>
          <button
            onClick={() => { loadUsers(); loadStatus(); }}
            className="inline-flex items-center gap-2 border border-white/10 bg-[#121212] px-3 py-2 rounded-sm tls-type-label hover:border-[#29B6E8]/50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} /> Aktualisieren
          </button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
        <section className="border border-white/10 bg-[#121212] rounded-sm overflow-hidden">
          <div className="p-3 border-b border-white/10">
            <label className="relative block">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
              <input
                value={q}
                onChange={(event) => setQ(event.target.value)}
                placeholder="Benutzer suchen..."
                className="w-full bg-[#0A0A0A] border border-white/10 pl-9 pr-3 py-2.5 rounded-sm text-sm"
              />
            </label>
          </div>
          <div className="max-h-[620px] overflow-y-auto divide-y divide-white/5">
            {users.map((user) => (
              <button
                key={user.id}
                type="button"
                data-testid={`push-user-${user.id}`}
                onClick={() => setSelected(user.id)}
                className={`w-full p-4 text-left hover:bg-white/5 ${selected === user.id ? "bg-[#29B6E8]/10" : ""}`}
              >
                <div className="flex items-start gap-3">
                  <Smartphone className={`w-5 h-5 mt-0.5 ${user.has_enabled_token ? "text-[#29B6E8]" : "text-white/25"}`} />
                  <div className="min-w-0 flex-1">
                    <div className="font-bold tls-wrap">{userLabel(user)}</div>
                    <div className="tls-type-small text-white/45 tls-wrap">
                      @{user.username || "-"} · {activeDevices(user.enabled_token_count)}
                      {Number(user.disabled_token_count) > 0 ? <span className="text-white/50"> · {oldDevices(user.disabled_token_count)}</span> : null}
                    </div>
                    <div className="tls-type-small text-white/35 mt-1">Zuletzt angemeldet: {formatTime(user.latest_updated_at)}</div>
                    {/* Rot nur bei einem Fehler an einem aktiven Gerät (#2467). */}
                    {user.active_error ? (
                      <div className="tls-type-small text-[#FF6B61] mt-1 tls-wrap" title={user.active_error}>{pushErrorLabel(user.active_error)}</div>
                    ) : null}
                  </div>
                </div>
              </button>
            ))}
            {!users.length && (
              <div className="p-8 text-center text-white/40">{loading ? "Lade Geräte …" : "Kein Konto mit angemeldetem Handy gefunden"}</div>
            )}
          </div>
        </section>

        <section className="space-y-4">
          <div className="border border-white/10 bg-[#121212] rounded-sm p-4">
            <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
              <div>
                <div className="tls-type-label text-white/40">Zielgerät</div>
                <h2 className="tls-type-section">{userLabel(selectedUser)}</h2>
                <p className="tls-type-small text-white/45">{selectedUser?.email || selectedUser?.id || "Kein Benutzer ausgewählt"}</p>
              </div>
              <span className={`inline-flex items-center gap-2 border px-3 py-2 rounded-sm tls-type-label ${status?.has_enabled_token ? "border-[#29B6E8]/40 text-[#29B6E8]" : "border-[#FFCC00]/40 text-[#FFD95A]"}`}>
                <CheckCircle2 className="w-4 h-4" /> {status?.enabled_count || 0} aktiv
              </span>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <label>
                <span className="block tls-type-small text-white/45 mb-1">Titel</span>
                <input
                  value={form.title}
                  onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
                  className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm"
                />
              </label>
              <label>
                <span className="block tls-type-small text-white/45 mb-1">Text</span>
                <input
                  value={form.body}
                  onChange={(event) => setForm((current) => ({ ...current, body: event.target.value }))}
                  className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm"
                />
              </label>
            </div>
            <div className="flex flex-wrap gap-2 mt-4">
              <button
                onClick={sendTest}
                disabled={!selected || busy}
                className="inline-flex items-center gap-2 bg-[#29B6E8] text-black px-4 py-2 rounded-sm tls-type-label disabled:opacity-50"
              >
                <Send className="w-4 h-4" /> Test senden
              </button>
              <button
                onClick={checkReceipts}
                disabled={!selected || busy}
                className="inline-flex items-center gap-2 border border-white/10 px-4 py-2 rounded-sm tls-type-label text-white/70 disabled:opacity-50"
              >
                <BellRing className="w-4 h-4" /> Zustellung prüfen
              </button>
            </div>
            <p className="mt-3 tls-type-small text-white/45">Der Test landet als „Test: …“ im Postfach der Person und geht als Push an ihre aktiven Handys.</p>
          </div>

          <div className="border border-white/10 bg-[#121212] rounded-sm overflow-hidden">
            <div className="p-4 border-b border-white/10">
              <h3 className="tls-type-label">Angemeldete Handys</h3>
              <p className="tls-type-small text-white/45 mt-1">„Angenommen“: der Push-Dienst hat die Nachricht genommen. „Zugestellt“: Apple oder Google haben sie ans Handy gegeben.</p>
            </div>
            <div className="md:hidden divide-y divide-white/5">
              {activeTokens.map((token, index) => (
                <article key={`${token.token_preview}-card-${index}`} className="p-4 space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-mono tls-type-small text-white/65 truncate">{token.token_preview}</div>
                      <div className="tls-type-small text-white/45 mt-1">{token.platform || "-"} · {token.enabled === false ? "inaktiv" : "aktiv"}</div>
                    </div>
                    <span className={`tls-type-label border px-2 py-1 rounded-sm ${token.enabled === false ? "border-[#FFCC00]/40 text-[#FFD95A]" : "border-[#00FF88]/40 text-[#00FF88]"}`}>
                      {token.enabled === false ? "Aus" : "An"}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 tls-type-small">
                    <div className="border border-white/10 bg-[#0A0A0A] rounded-sm p-2">
                      <div className="text-white/35 tls-type-label">Angenommen</div>
                      <div>{pushStateLabel(token.last_ticket_status)}</div>
                      {token.last_ticket_error ? <div className="text-[#FF6B61] break-words" title={token.last_ticket_error}>{pushErrorLabel(token.last_ticket_error)}</div> : null}
                    </div>
                    <div className="border border-white/10 bg-[#0A0A0A] rounded-sm p-2">
                      <div className="text-white/35 tls-type-label">Zugestellt</div>
                      <div>{pushStateLabel(token.last_receipt_status)}</div>
                      {token.last_receipt_error ? <div className="text-[#FF6B61] break-words" title={token.last_receipt_error}>{pushErrorLabel(token.last_receipt_error)}</div> : null}
                    </div>
                  </div>
                  <div className="tls-type-small text-white/40">Letzter Versand: {formatTime(token.last_sent_at)}</div>
                </article>
              ))}
              {!activeTokens.length && (
                <div className="text-center py-10 text-white/40">Auf keinem Handy dieser Person ist die App mit Push angemeldet</div>
              )}
            </div>
            <div className="hidden md:block tls-swipe pb-0">
              <table className="w-full tls-type-small min-w-[760px]">
                <thead className="bg-[#0A0A0A] tls-type-label text-white/50">
                  <tr>
                    <th className="text-left px-4 py-3">Gerät (Kennung)</th>
                    <th className="text-left px-4 py-3">System</th>
                    <th className="text-left px-4 py-3">Aktiv</th>
                    <th className="text-left px-4 py-3">Angenommen</th>
                    <th className="text-left px-4 py-3">Zugestellt</th>
                    <th className="text-left px-4 py-3">Letzter Versand</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {activeTokens.map((token, index) => (
                    <tr key={`${token.token_preview}-${index}`}>
                      <td className="px-4 py-3 font-mono tls-type-small text-white/65">{token.token_preview}</td>
                      <td className="px-4 py-3">{token.platform || "-"}</td>
                      <td className="px-4 py-3">{token.enabled === false ? "Nein" : "Ja"}</td>
                      <td className="px-4 py-3 tls-type-small">
                        <div>{pushStateLabel(token.last_ticket_status)}</div>
                        {token.last_ticket_error ? <div className="text-[#FF6B61]" title={token.last_ticket_error}>{pushErrorLabel(token.last_ticket_error)}</div> : null}
                      </td>
                      <td className="px-4 py-3 tls-type-small">
                        <div>{pushStateLabel(token.last_receipt_status)}</div>
                        {token.last_receipt_error ? <div className="text-[#FF6B61]" title={token.last_receipt_error}>{pushErrorLabel(token.last_receipt_error)}</div> : null}
                      </td>
                      <td className="px-4 py-3 text-white/50 tls-type-small">{formatTime(token.last_sent_at)}</td>
                    </tr>
                  ))}
                  {!activeTokens.length && (
                    <tr>
                      <td colSpan="6" className="text-center py-10 text-white/40">Auf keinem Handy dieser Person ist die App mit Push angemeldet</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {oldCount > 0 && (
              <div className="border-t border-white/10" data-testid="push-old-devices">
                <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                  <button
                    type="button"
                    onClick={() => setShowOld((open) => !open)}
                    aria-expanded={showOld}
                    aria-controls="push-old-devices-list"
                    data-testid="push-old-devices-toggle"
                    className="inline-flex items-center gap-2 -mx-1 px-1 py-1 rounded-sm tls-type-label text-white/60 hover:text-white/85 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#29B6E8]"
                  >
                    <ChevronDown className={`w-4 h-4 transition-transform duration-200 ease-out motion-reduce:transition-none ${showOld ? "rotate-180" : ""}`} />
                    Alte Geräte ({oldCount})
                  </button>
                  <button
                    type="button"
                    onClick={removeOld}
                    disabled={busy}
                    data-testid="push-old-devices-remove"
                    className="inline-flex items-center gap-2 border border-white/10 px-3 py-2 rounded-sm tls-type-label text-white/60 hover:border-[#FF6B61]/50 hover:text-[#FF6B61] disabled:opacity-50"
                  >
                    <Trash2 className="w-4 h-4" /> Alte Geräte entfernen
                  </button>
                </div>
                {/* Immer im DOM, damit aria-controls ein Ziel hat; eingeklappt nur verborgen. */}
                <ul id="push-old-devices-list" data-testid="push-old-devices-list" hidden={!showOld} className="divide-y divide-white/5 border-t border-white/5 bg-[#0E0E0E]">
                    {oldTokens.map((token, index) => (
                      <li key={`${token.token_preview}-old-${index}`} className="px-4 py-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-white/55">
                        <div className="min-w-0">
                          <div className="font-mono tls-type-small text-white/50 truncate">{token.token_preview}</div>
                          <div className="tls-type-small mt-0.5">{token.platform || "-"} · <span>{OLD_DEVICE_TEXT}</span></div>
                        </div>
                        <div className="tls-type-small text-white/50">Abgemeldet: {formatTime(token.disabled_at || token.updated_at)}</div>
                      </li>
                    ))}
                    {oldCount > oldTokens.length && (
                      <li className="px-4 py-3 tls-type-small text-white/50">… und {oldCount - oldTokens.length} weitere</li>
                    )}
                </ul>
              </div>
            )}
          </div>
        </section>
      </div>
    </AdminLayout>
  );
}
