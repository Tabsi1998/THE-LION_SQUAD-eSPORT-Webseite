import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, formatRequestError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { AdminLayout } from "@/components/tls/AdminLayout";
import { AdminSheet } from "@/components/tls/AdminSheet";
import { CheckField, SelectField, TextField } from "@/components/tls/FormFields";
import { useConfirm } from "@/components/tls/ConfirmDialog";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { useModalBehavior } from "@/hooks/useModalBehavior";
import { toast } from "sonner";
import { AREA_HINTS, AREA_LABELS, GRANTABLE_AREAS, ROLE_AREAS, roleLabel } from "@/lib/permissions";
import { banState, effectiveAreas, invitationText, rightsChange } from "@/lib/userRights";
import { viennaDate } from "@/lib/vienna";
import { AlertTriangle, ChevronDown, Pencil, Plus, ShieldCheck, X } from "lucide-react";

// Alle Benutzer (#1357): die Liste ist nur zum Lesen - Name, Konto-Art, Rolle als Wort, Bereiche als Schilder, gesperrt
// ja/nein. „Bearbeiten“ öffnet ein Seitenblatt: Rolle und Freigaben ändert nur der Superadmin, erst mit „Speichern“ und
// einer Rückfrage mit Satz; gesperrt wird dort mit dem Grund-Fenster, die Person bekommt den Grund per Mail. Zum
// Mitgliedsantrag eingeladen wird auf „Bewerbungen“ - hier steht nur der Stand. Quelle der Wahrheit: docs/ROLLEN.md.
const ROLE_OPTIONS = ["player", "moderator", "tournament_admin", "club_admin", "superadmin"];
export const ROLE_INFO = {
  player: { can: ["Teilnahme, Profil, App, eigene Anmeldungen"], cannot: ["Adminbereich – außer mit Freigabe oder Vorstandsposten"] },
  moderator: { can: ["Meldungen, Chats, Wortfilter, Bildprüfung und Verwarnungen", "Als Helfer eingetragen: genau die Rechte dieses Einsatzes"], cannot: ["Turniere, Fast Lap, Events und Exporte – außer als Helfer", "Redaktion, Mitgliederdaten"] },
  tournament_admin: { can: ["Turniere, Events, Stationen, Fast Lap, Saisons, Gewinne", "Moderation"], cannot: ["News, Galerie, Sponsoren (Redaktion)", "Mitglieder, Dokumente, Einstellungen"] },
  club_admin: { can: ["Alle Bereiche inklusive System"], cannot: ["Rollen und Freigaben vergeben", "Konten mit Adminbereich bannen"] },
  superadmin: { can: ["Alles, dazu Rollen, Freigaben und Setup"], cannot: ["andere Superadmin-Konten bannen"] },
};
// Bannen: jedes Mal mit Grund (steht im Protokoll und in der Mail an die Person).
const BAN_REASON_MIN = 5;

function day(value) {
  try {
    return viennaDate(value);
  } catch {
    return "";
  }
}

function displayName(user) {
  return user?.display_name || user?.username || "Konto";
}

/** Bereiche einer Zeile als Schilder: aus Rolle und Freigaben, dazu „über Vorstand“, wenn der Server das meldet. */
function areaBadges(user) {
  const areas = effectiveAreas(user.role, user.areas).map((area) => ({ key: area, label: AREA_LABELS[area] }));
  if (user.areas_from_board && !areas.some((area) => area.key === "club")) areas.push({ key: "club-board", label: "Vereinsverwaltung über Vorstand" });
  return areas;
}

function accountKind(user) {
  return user.is_club_member ? "Vereinsmitglied" : "Community";
}

function statusText(user) {
  if (user.is_banned) return "gesperrt";
  if (user.password_setup_required) return "Zugangs-Mail offen";
  return "";
}

export default function AdminUsersPage() {
  const { isSuperAdmin, user: me } = useAuth();
  const [list, setList] = useState([]);
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const load = useCallback(async () => {
    const { data } = await api.get(`/users${q ? `?q=${encodeURIComponent(q)}` : ""}`);
    setList(Array.isArray(data) ? data : []);
  }, [q]);

  useEffect(() => { load().catch((error) => toast.error(formatRequestError(error, "Die Benutzer lassen sich gerade nicht laden."))); }, [load]);
  useApiInvalidation(load, ["users"]);

  const roleCounts = useMemo(() => list.reduce((acc, user) => {
    const role = user.role || "player";
    acc[role] = (acc[role] || 0) + 1;
    return acc;
  }, {}), [list]);
  const editing = list.find((user) => user.id === editingId) || null;
  // Fest, damit das Blatt beim Neuladen der Liste den Fokus nicht verliert.
  const closeSheet = useCallback(() => setEditingId(null), []);

  return (
    <AdminLayout>
      <div className="flex items-end justify-between gap-4 flex-wrap mb-6">
        <div>
          <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8]">Mitglieder</span>
          <h1 className="font-heading text-3xl md:text-4xl font-black uppercase mt-1">Alle Benutzer</h1>
          <p className="mt-2 max-w-2xl text-sm text-white/55">Die Liste ist zum Lesen. „Bearbeiten“ öffnet das Konto: {isSuperAdmin ? "Rolle und Freigaben ändern sich erst mit „Speichern“ und einer Rückfrage." : "Rolle und Bereiche stehen dort als Text; Spieler-Konten sperrst du mit Grund."}</p>
        </div>
        {isSuperAdmin && (
          <button onClick={() => setCreating(true)} data-testid="user-create-open" className="inline-flex items-center gap-2 px-4 py-2 bg-[#29B6E8] text-black rounded-sm text-xs font-bold uppercase tracking-wider">
            <Plus className="w-3.5 h-3.5" /> Benutzer anlegen
          </button>
        )}
      </div>
      <input placeholder="Name, Benutzername oder E-Mail suchen …" value={q} onChange={(e) => setQ(e.target.value)} data-testid="users-search" className="w-full max-w-md bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm mb-4" />

      <details className="mb-5 border border-white/10 bg-[#121212] rounded-sm group" data-testid="roles-info">
        <summary className="cursor-pointer list-none px-4 py-3 flex items-center justify-between gap-3">
          <span className="text-[11px] font-bold uppercase tracking-widest text-[#29B6E8]">Was die Rollen dürfen</span>
          <ChevronDown className="w-4 h-4 text-white/50 transition group-open:rotate-180" />
        </summary>
        <div className="px-4 pb-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <p className="text-xs text-white/50 max-w-2xl">Die Rolle ist die Grundstufe; einzelne Bereiche (Turnierleitung, Redaktion, Vereinsverwaltung, Finanzen) gibt der Superadmin je Person frei. Wer einen Vorstandsposten hält, hat die Vereinsverwaltung von selbst.</p>
            <Link to="/admin/audit?action=user.role_change" className="inline-flex items-center gap-2 rounded-sm border border-white/15 px-3 py-2 text-xs font-bold uppercase tracking-wider text-white/65 hover:border-[#29B6E8]/45 hover:text-white">
              <ShieldCheck className="h-3.5 w-3.5" /> Rollen-Protokoll
            </Link>
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {ROLE_OPTIONS.map((role) => {
              const info = ROLE_INFO[role] || { can: [], cannot: [] };
              const count = roleCounts[role] || 0;
              return (
                <div key={role} className={`rounded-sm border px-3 py-3 ${role === "superadmin" ? "border-[#FFD700]/25 bg-[#FFD700]/5" : "border-white/10 bg-black/15"}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-bold text-white">{roleLabel(role)}</div>
                      <ul className="mt-1 text-[11px] leading-relaxed text-white/55" data-testid={`role-can-${role}`}>
                        {info.can.map((line) => <li key={line}>✓ {line}</li>)}
                      </ul>
                      {info.cannot.length ? (
                        <ul className="mt-1 text-[11px] leading-relaxed text-white/35" data-testid={`role-cannot-${role}`}>
                          {info.cannot.map((line) => <li key={line}>✗ {line}</li>)}
                        </ul>
                      ) : null}
                    </div>
                    <div className="font-heading text-2xl font-black tabular-nums text-[#29B6E8]">{count}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </details>

      {/* PC: Tabelle; Tablet und Handy: Karten - beides nur zum Lesen. */}
      <div className="hidden lg:block border border-white/10 rounded-sm bg-[#121212] overflow-x-auto">
        <table className="w-full text-sm" data-testid="users-table">
          <thead className="bg-[#0A0A0A] text-[11px] uppercase tracking-widest text-white/50">
            <tr>
              <th className="text-left px-4 py-3">Name</th>
              <th className="text-left px-4 py-3">Konto</th>
              <th className="text-left px-4 py-3">Rolle</th>
              <th className="text-left px-4 py-3">Bereiche</th>
              <th className="text-left px-4 py-3">Stand</th>
              <th className="text-right px-4 py-3"><span className="sr-only">Aktion</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {list.map((u) => (
              <tr key={u.id} className={u.is_banned ? "opacity-60" : ""} data-testid={`user-row-${u.username}`}>
                <td className="px-4 py-3">
                  <div className="font-semibold">{displayName(u)}</div>
                  <div className="text-xs text-white/40">@{u.username}</div>
                </td>
                <td className="px-4 py-3 text-white/70 text-xs">{accountKind(u)}</td>
                <td className="px-4 py-3" data-testid={`user-role-${u.username}`}>{roleLabel(u.role || "player")}</td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1" data-testid={`user-areas-${u.username}`}>
                    {areaBadges(u).map((area) => <span key={area.key} className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-sm border border-[#29B6E8]/30 text-[#29B6E8]">{area.label}</span>)}
                    {!areaBadges(u).length && <span className="text-xs text-white/35">–</span>}
                  </div>
                </td>
                <td className="px-4 py-3 text-xs">
                  {statusText(u) ? <span className={u.is_banned ? "text-[#FF6B6B] font-bold" : "text-[#FFD700]"}>{statusText(u)}</span> : <span className="text-white/35">–</span>}
                </td>
                <td className="px-4 py-3 text-right">
                  <button type="button" onClick={() => setEditingId(u.id)} data-testid={`user-edit-${u.username}`} className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-white/15 text-white/80 hover:border-[#29B6E8]/50 hover:text-white rounded-sm text-[11px] font-bold uppercase tracking-wider">
                    <Pencil className="w-3 h-3" /> Bearbeiten
                  </button>
                </td>
              </tr>
            ))}
            {!list.length && <tr><td colSpan="6" className="px-4 py-10 text-center text-white/40">Keine Konten gefunden.</td></tr>}
          </tbody>
        </table>
      </div>
      <ul className="lg:hidden space-y-2" data-testid="users-cards">
        {list.map((u) => (
          <li key={u.id} className={`border border-white/10 bg-[#121212] rounded-sm p-3 ${u.is_banned ? "opacity-70" : ""}`}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="font-semibold truncate">{displayName(u)}</div>
                <div className="text-xs text-white/45 truncate">@{u.username} · {accountKind(u)} · {roleLabel(u.role || "player")}</div>
              </div>
              <button type="button" onClick={() => setEditingId(u.id)} data-testid={`user-edit-card-${u.username}`} className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 border border-white/15 text-white/80 rounded-sm text-[11px] font-bold uppercase tracking-wider">
                <Pencil className="w-3 h-3" /> Bearbeiten
              </button>
            </div>
            {(areaBadges(u).length > 0 || statusText(u)) && (
              <div className="mt-2 flex flex-wrap gap-1">
                {areaBadges(u).map((area) => <span key={area.key} className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-sm border border-[#29B6E8]/30 text-[#29B6E8]">{area.label}</span>)}
                {statusText(u) && <span className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-sm border ${u.is_banned ? "border-[#FF3B30]/40 text-[#FF6B6B]" : "border-[#FFD700]/40 text-[#FFD700]"}`}>{statusText(u)}</span>}
              </div>
            )}
          </li>
        ))}
        {!list.length && <li className="py-10 text-center text-white/40 text-sm">Keine Konten gefunden.</li>}
      </ul>

      {creating && <CreateUserModal onClose={() => setCreating(false)} onCreated={load} onSaved={() => { setCreating(false); load(); }} />}
      {editing && <UserSheet key={editing.id} target={editing} me={me} isSuperAdmin={isSuperAdmin} onClose={closeSheet} onChanged={load} />}
    </AdminLayout>
  );
}

// Das Blatt eines Kontos: Konto, Rolle und Freigaben, Sperren, Mehr. Ändern nur mit „Speichern“ und Rückfrage.
function UserSheet({ target, me, isSuperAdmin, onClose, onChanged }) {
  const confirm = useConfirm();
  const name = displayName(target);
  const [role, setRole] = useState(target.role || "player");
  const [grants, setGrants] = useState(() => (Array.isArray(target.areas) ? target.areas.filter((area) => GRANTABLE_AREAS.includes(area)) : []));
  const [saving, setSaving] = useState(false);
  const [banOpen, setBanOpen] = useState(false);
  const [deleteName, setDeleteName] = useState("");
  const [moreOpen, setMoreOpen] = useState(false);
  const change = rightsChange({ name, fromRole: target.role || "player", toRole: role, fromGrants: target.areas || [], toGrants: grants });
  const ban = banState({ target, me, isSuperAdmin });
  const invitation = invitationText(target.membership_invitation, day);

  const toggleGrant = (area) => setGrants((current) => (current.includes(area) ? current.filter((a) => a !== area) : [...current, area]));

  const save = async (event) => {
    event.preventDefault();
    if (!isSuperAdmin) return;
    if (!change.changed) {
      toast.info("Keine Änderung zum Speichern.");
      return;
    }
    const approved = await confirm({
      title: `Rechte von ${name} ändern?`,
      description: change.sentence,
      confirmLabel: "Speichern",
      tone: change.risky ? "danger" : "info",
    });
    if (!approved) return;
    setSaving(true);
    try {
      if (change.grantsChanged) await api.put(`/users/${target.id}/areas`, { areas: grants });
      if (change.roleChanged) await api.post(`/users/${target.id}/role`, { role });
      toast.success(`Rechte von ${name} gespeichert.`);
      await onChanged();
    } catch (error) {
      toast.error(formatRequestError(error, "Die Rechte konnten nicht gespeichert werden."));
    } finally {
      setSaving(false);
    }
  };

  const unban = async () => {
    if (!await confirm({ title: `${name} entsperren?`, description: `${name} kann sich danach wieder anmelden.`, confirmLabel: "Entsperren", tone: "info" })) return;
    try {
      await api.post(`/users/${target.id}/unban`);
      toast.success(`${name} ist entsperrt.`);
      await onChanged();
    } catch (error) {
      toast.error(formatRequestError(error, "Entsperren hat nicht geklappt."));
    }
  };

  const resendAccess = async () => {
    if (!await confirm({ title: "Zugangs-Mail erneut senden?", description: `${name} bekommt eine neue Mail mit einem Link, um das Passwort zu setzen. Der alte Link bleibt bis zu seinem Ablauf gültig.`, confirmLabel: "Senden", tone: "info" })) return;
    try {
      const { data } = await api.post(`/users/${target.id}/invite`);
      if (data?.invite_url && navigator.clipboard) await navigator.clipboard.writeText(data.invite_url).catch(() => null);
      toast.success(data?.invite_url ? "Zugangs-Mail gesendet und Link kopiert." : "Zugangs-Mail gesendet.");
      await onChanged();
    } catch (error) {
      toast.error(formatRequestError(error, "Die Zugangs-Mail konnte nicht gesendet werden."));
    }
  };

  const removeAccount = async () => {
    if (deleteName.trim() !== name) return;
    try {
      await api.delete(`/users/${target.id}`);
      toast.success(`${name} ist gelöscht (anonymisiert).`);
      onClose();
      await onChanged();
    } catch (error) {
      toast.error(formatRequestError(error, "Löschen hat nicht geklappt."));
    }
  };

  return (
    <>
      <AdminSheet
        title={name}
        eyebrow="Konto"
        onClose={onClose}
        onSubmit={isSuperAdmin ? save : undefined}
        saving={saving}
        submitLabel="Speichern"
        submitTestId="user-sheet-save"
        cancelLabel={isSuperAdmin ? "Abbrechen" : "Schließen"}
        testId="user-sheet"
      >
        <section className="space-y-2" data-testid="user-sheet-account">
          <div className="text-[11px] font-bold uppercase tracking-widest text-white/60">Konto</div>
          <dl className="grid grid-cols-[8rem_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-sm">
            <dt className="text-white/45">Benutzername</dt><dd className="min-w-0 break-words">@{target.username}</dd>
            <dt className="text-white/45">E-Mail</dt><dd className="min-w-0 break-words">{target.email || "–"}</dd>
            <dt className="text-white/45">Konto-Art</dt><dd>{accountKind(target)}</dd>
            {target.created_at && <><dt className="text-white/45">Angelegt</dt><dd>{day(target.created_at)}</dd></>}
            <dt className="text-white/45">Stand</dt><dd>{target.is_banned ? "gesperrt" : target.password_setup_required ? "Zugangs-Mail offen – Passwort noch nicht gesetzt" : "aktiv"}</dd>
          </dl>
          {invitation ? (
            <p className="text-xs text-white/60" data-testid="user-sheet-invitation">{invitation} <Link to="/admin/membership-applications" className="text-[#29B6E8] hover:underline">Bewerbungen</Link></p>
          ) : !target.is_club_member ? (
            <p className="text-xs text-white/45" data-testid="user-sheet-invitation">Zum Mitgliedsantrag einladen: auf <Link to="/admin/membership-applications" className="text-[#29B6E8] hover:underline">Bewerbungen</Link>.</p>
          ) : null}
        </section>

        <section className="space-y-3 border-t border-white/10 pt-4" data-testid="user-sheet-rights">
          <div className="text-[11px] font-bold uppercase tracking-widest text-white/60">Rolle und Freigaben</div>
          {isSuperAdmin ? (
            <>
              <SelectField label="Rolle" value={role} onChange={setRole} options={ROLE_OPTIONS.map((r) => [r, roleLabel(r)])} testId="user-sheet-role" />
              <div>
                <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">Freigaben</div>
                <div className="grid sm:grid-cols-2 gap-2">
                  {GRANTABLE_AREAS.map((area) => {
                    const fromRole = (ROLE_AREAS[role] || []).includes(area);
                    return (
                      <label key={area} className={`flex items-start gap-2 text-sm border border-white/10 rounded-sm px-3 py-2 ${fromRole ? "opacity-60" : ""}`} title={AREA_HINTS[area]}>
                        <input type="checkbox" className="mt-0.5 accent-[#29B6E8]" checked={fromRole || grants.includes(area)} disabled={fromRole} onChange={() => toggleGrant(area)} data-testid={`user-sheet-area-${area}`} />
                        <span><span className="font-semibold">{AREA_LABELS[area]}</span>{fromRole && <span className="block text-[11px] text-white/45">schon in der Rolle</span>}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
              {change.changed ? <p className="text-xs text-[#FFD700]" data-testid="user-sheet-pending">{change.sentence} Gespeichert wird erst mit „Speichern“.</p> : null}
            </>
          ) : (
            <dl className="grid grid-cols-[8rem_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-sm" data-testid="user-sheet-rights-read">
              <dt className="text-white/45">Rolle</dt><dd>{roleLabel(target.role || "player")}</dd>
              <dt className="text-white/45">Bereiche</dt><dd>{areaBadges(target).map((area) => area.label).join(", ") || "keine"}</dd>
            </dl>
          )}
        </section>

        <section className="space-y-2 border-t border-white/10 pt-4" data-testid="user-sheet-ban">
          <div className="text-[11px] font-bold uppercase tracking-widest text-white/60">Sperren</div>
          {ban.canAct ? (
            target.is_banned ? (
              <button type="button" onClick={unban} data-testid="user-sheet-unban" className="tls-btn tls-btn--secondary px-4 py-2 rounded-sm text-xs font-bold uppercase tracking-wider">Entsperren</button>
            ) : (
              <div className="space-y-2">
                <p className="text-xs text-white/50">Gesperrt wird mit Grund. Die Person bekommt den Grund per Mail; er steht auch im Protokoll.</p>
                <button type="button" onClick={() => setBanOpen(true)} data-testid="user-sheet-ban-open" className="tls-btn tls-btn--danger px-4 py-2 rounded-sm text-xs font-bold uppercase tracking-wider">Sperren …</button>
              </div>
            )
          ) : (
            <p className="text-sm text-white/55" data-testid="user-sheet-ban-locked">{ban.text}</p>
          )}
        </section>

        {isSuperAdmin && (
          <section className="border-t border-white/10 pt-4" data-testid="user-sheet-more">
            <button type="button" onClick={() => setMoreOpen((open) => !open)} aria-expanded={moreOpen} data-testid="user-sheet-more-toggle" className="inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-white/60 hover:text-white">
              Mehr <ChevronDown className={`w-3.5 h-3.5 transition ${moreOpen ? "rotate-180" : ""}`} />
            </button>
            {moreOpen && (
              <div className="mt-3 space-y-4">
                <div className="space-y-1.5">
                  <button type="button" onClick={resendAccess} data-testid="user-sheet-resend-access" className="tls-btn tls-btn--secondary px-4 py-2 rounded-sm text-xs font-bold uppercase tracking-wider">Zugangs-Mail erneut senden</button>
                  <p className="text-xs text-white/45">Ein neuer Link, um das Passwort zu setzen – etwa wenn die erste Mail nicht ankam.</p>
                </div>
                {target.id !== me?.id && target.role !== "superadmin" && (
                  <div className="border border-[#FF3B30]/30 rounded-sm p-3 space-y-2" data-testid="user-sheet-delete-box">
                    <div className="text-xs font-bold text-[#FF6B6B]">Konto löschen</div>
                    <p className="text-xs text-white/55">Anmeldung und persönliche Daten werden entfernt; Ergebnisse bleiben ohne Namen erhalten. Zum Bestätigen den Namen eintippen: <strong className="text-white">{name}</strong></p>
                    <input value={deleteName} onChange={(event) => setDeleteName(event.target.value)} aria-label="Namen zum Löschen eintippen" data-testid="user-sheet-delete-name" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm" />
                    <button type="button" disabled={deleteName.trim() !== name} onClick={removeAccount} data-testid="user-sheet-delete" className="tls-btn tls-btn--danger px-4 py-2 rounded-sm text-xs font-bold uppercase tracking-wider disabled:opacity-40">Endgültig löschen</button>
                  </div>
                )}
              </div>
            )}
          </section>
        )}
      </AdminSheet>
      {banOpen && <BanDialog target={target} onCancel={() => setBanOpen(false)} onBanned={async () => { setBanOpen(false); await onChanged(); }} />}
    </>
  );
}

// Sperren im Fenster: nennt die Person, verlangt einen Grund und bestätigt erst mit dem Knopf.
function BanDialog({ target, onCancel, onBanned }) {
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const dialogRef = useModalBehavior(true, onCancel);
  const name = target.display_name || target.username;
  const trimmed = reason.trim();
  const missing = Math.max(0, BAN_REASON_MIN - trimmed.length);

  const submit = async (event) => {
    event.preventDefault();
    if (missing || saving) return;
    setSaving(true);
    try {
      await api.post(`/users/${target.id}/ban`, { reason: trimmed });
      toast.success(`${name} ist gesperrt.`);
      onBanned();
    } catch (e) {
      toast.error(formatRequestError(e, "Sperren hat nicht geklappt."));
      setSaving(false);
    }
  };

  return (
    <div
      role="presentation"
      className="fixed inset-0 z-[110] bg-black/75 backdrop-blur-sm p-4 flex items-center justify-center"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel(); }}
    >
      <form ref={dialogRef} tabIndex={-1} onSubmit={submit} role="dialog" aria-modal="true" aria-labelledby="ban-dialog-title" data-testid="ban-dialog" className="w-full max-w-md bg-[#121212] border border-white/10 rounded-sm shadow-2xl focus:outline-none">
        <div className="flex items-start gap-3 p-5 border-b border-white/10">
          <div className="w-10 h-10 rounded-sm border border-[#FF3B30]/45 text-[#FF3B30] bg-[#FF3B30]/10 flex items-center justify-center shrink-0">
            <AlertTriangle className="w-5 h-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 id="ban-dialog-title" className="font-heading font-black uppercase text-lg break-words">{name} sperren?</h2>
            <p className="mt-1 text-sm text-white/60 leading-relaxed">{name} (@{target.username}) kann sich danach nicht mehr anmelden und bekommt eine Mail mit dem Grund. Der Grund steht auch im Protokoll.</p>
            <label htmlFor="ban-reason" className="mt-4 block text-[11px] font-bold uppercase tracking-widest text-white/60">Grund (Pflicht)</label>
            <textarea
              id="ban-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder={`Warum wird das Konto gesperrt? Mindestens ${BAN_REASON_MIN} Zeichen.`}
              maxLength={500}
              data-testid="ban-dialog-reason"
              className="mt-1 input min-h-24 resize-y"
            />
            {trimmed && missing ? <p className="mt-1 text-xs text-[#FFD700]" data-testid="ban-dialog-hint">Noch {missing} Zeichen.</p> : null}
          </div>
          <button type="button" onClick={onCancel} className="p-1 text-white/45 hover:text-white" aria-label="Schließen">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-5 flex flex-col-reverse sm:flex-row gap-2 sm:justify-end">
          <button type="button" onClick={onCancel} data-testid="ban-dialog-cancel" className="tls-btn tls-btn--quiet px-4 py-2 rounded-sm text-xs font-bold uppercase tracking-wider">
            Abbrechen
          </button>
          <button type="submit" disabled={Boolean(missing) || saving} data-testid="ban-dialog-confirm" className="tls-btn tls-btn--danger px-4 py-2 rounded-sm text-xs font-black uppercase tracking-wider disabled:opacity-50 disabled:cursor-not-allowed">
            {saving ? "Sperre …" : "Sperren"}
          </button>
        </div>
      </form>
    </div>
  );
}

function CreateUserModal({ onClose, onSaved, onCreated }) {
  const [form, setForm] = useState({ username: "", display_name: "", email: "", gender: "", role: "player", is_active: true, privacy_public_profile: false, send_invite: true });
  const [saving, setSaving] = useState(false);
  const [inviteUrl, setInviteUrl] = useState("");
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const { data } = await api.post("/users", { ...form, gender: form.gender || null });
      Promise.resolve(onCreated?.()).catch(() => null);
      if (data.invite_url) {
        setInviteUrl(data.invite_url);
        if (navigator.clipboard) await navigator.clipboard.writeText(data.invite_url).catch(() => null);
        toast.success("Benutzer angelegt, Zugangs-Mail gesendet und Link kopiert.");
      } else {
        toast.success("Benutzer angelegt.");
        onSaved();
      }
    } catch (err) {
      toast.error(formatRequestError(err, "Benutzer konnte nicht angelegt werden.", { name: form.username }));
    }
    setSaving(false);
  };

  // Seitenblatt statt Fenster (#435). Nach dem Anlegen zeigt das Blatt den Link und hat nur noch „Schließen“.
  return (
    <AdminSheet
      title="Benutzer anlegen"
      eyebrow="Alle Benutzer"
      onClose={inviteUrl ? onSaved : onClose}
      cancelLabel={inviteUrl ? "Schließen" : "Abbrechen"}
      onSubmit={inviteUrl ? undefined : submit}
      saving={saving}
      submitLabel="Anlegen & Zugangs-Mail senden"
      submitTestId="create-user-submit"
      testId="create-user-sheet"
    >
      <TextField label="Username" value={form.username} onChange={(v) => set("username", v)} required testId="create-user-username" />
      <TextField label="Anzeigename" value={form.display_name} onChange={(v) => set("display_name", v)} testId="create-user-display" />
      <TextField label="E-Mail" type="email" value={form.email} onChange={(v) => set("email", v)} required testId="create-user-email" />
      <SelectField label="Geschlecht" value={form.gender || ""} onChange={(v) => set("gender", v)} options={[["", "Keine Angabe"], ["male", "Männlich"], ["female", "Weiblich"], ["diverse", "Divers"]]} testId="create-user-gender" />
      <div className="border border-[#29B6E8]/25 bg-[#29B6E8]/5 p-3 rounded-sm text-sm text-white/70">
        Die Person bekommt per E-Mail einen einmaligen Link und setzt ihr Passwort selbst.
      </div>
      <SelectField label="Rolle" value={form.role} onChange={(v) => set("role", v)} options={ROLE_OPTIONS.map((r) => [r, roleLabel(r)])} testId="create-user-role" />
      <CheckField label="Aktiv" checked={form.is_active} onChange={(v) => set("is_active", v)} testId="create-user-active" />
      <CheckField label="Öffentliches Profil" checked={form.privacy_public_profile} onChange={(v) => set("privacy_public_profile", v)} testId="create-user-public" />
      {inviteUrl && (
        <div className="border border-[#FFD700]/30 bg-[#FFD700]/10 p-3 rounded-sm" data-testid="create-user-invite">
          <div className="text-[11px] uppercase tracking-widest text-[#FFD700] font-bold">Link zum Passwort-Setzen</div>
          <div className="mt-1 text-xs break-all text-white/80">{inviteUrl}</div>
        </div>
      )}
    </AdminSheet>
  );
}
