import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, formatApiError, formatMemberSince } from "@/lib/api";
import { toastLoadFailed } from "@/lib/loadProblem";
import { useAuth } from "@/context/AuthContext";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { feeCard, formatDate } from "@/lib/dolibarr";
import { exitLine } from "@/lib/membershipMail";
import { MemberCardPanel } from "@/components/tls/MemberCardPanel";
import { SkeletonCards, SkeletonDetailHeader } from "@/components/tls/Skeleton";
import { SwitchRow } from "@/pages/user/profile/SwitchRow";
import { MemberFileAccountsCard } from "@/pages/user/MemberFileAccountsCard";
import JerseyNumberCard from "@/pages/user/JerseyNumberCard";
import { useConfirm } from "@/components/tls/ConfirmDialog";
import { toast } from "sonner";
import { Crown, Calendar, Hash, FileText, Eye, EyeOff, History, Wallet, Users, ShieldCheck } from "lucide-react";
import { viennaDate, viennaDateTime } from "@/lib/vienna";
import { LoadState, LoadStaleNotice } from "@/components/tls/LoadState";
import { useLoad } from "@/hooks/useLoad";
import { BEREICH, vereinPfad } from "@/lib/meinBereich";

const STATUS_LABELS = {
  active: "Aktives Mitglied", honorary: "Ehrenmitglied",
  pending: "Antrag offen", inactive: "Ruhend",
  former: "Ehemalig", blocked: "Gesperrt", none: "Keine Mitgliedschaft",
};
const TYPE_LABELS = {
  ordinary: "Ordentlich", supporting: "Unterstützend",
  honorary: "Ehrenmitglied", youth: "Jugend", guest: "Gast", former: "Ehemalig",
};

// Meine Mitgliedschaft (#295 ff., seit #2059 die Gruppe „Mitgliedschaft“ in „Mein Bereich“): oben Status und Ausweis,
// dann Beitrag, Wunschnummer und „Meine Daten“ (Anschrift und Telefon ändern, Austritt) - das, was man hier sucht. Die
// Einwilligungen stehen unter Datenschutz → Einwilligungen (ConsentsCard), Rechnungen unter Rechnungen & Unterlagen.
export default function MyMembershipPage() {
  const { user } = useAuth();
  // Ein Fehler beendet das Laden (#983, #1152; über useLoad): ohne Stand der Fehler mit „Nochmal versuchen“, mit Stand
  // bleibt er stehen - mit Hinweis.
  const membership = useLoad("membership/me", ({ signal }) => api.get("/membership/me", { signal }).then(({ data }) => data), { isEmpty: () => false });
  const data = membership.data;
  const load = membership.reload;
  useApiInvalidation(load, ["membership", "users"]);

  if (membership.status === "error") {
    return <LoadState load={membership} errorTitle="Mitgliedschaft konnte nicht geladen werden" />;
  }
  if (!data) return <div className="space-y-8"><SkeletonDetailHeader label="Lade Mitgliedschaft" /><SkeletonCards count={4} columns={4} image={false} label="Lade Mitgliedschaft" /></div>;

  const m = data.membership;
  const erp = data.dolibarr;
  const fee = feeCard(erp);
  const canAskForLink = erp?.connected && !erp.led_by_dolibarr && !["verified", "requested"].includes(erp.link?.status);
  const memberSince = m?.member_since ? new Date(m.member_since) : null;
  const yearsAsMember = memberSince ? Math.floor((Date.now() - memberSince.getTime()) / (1000 * 60 * 60 * 24 * 365.25)) : null;

  return (
    <div data-testid="my-membership">
        <LoadStaleNotice load={membership} className="mb-6" />

        {/* Status: Name, Nummer, Stand - die Überschrift der Gruppe steht darüber (Mein Bereich). */}
        <div className="border border-[#FFD700]/40 bg-gradient-to-br from-[#FFD700]/15 via-[#FFD700]/5 to-transparent rounded-sm p-6 md:p-8 relative overflow-hidden" data-testid="membership-status">
          <div className="absolute -right-8 -top-8 opacity-10" aria-hidden="true"><Crown className="w-48 h-48 text-[#FFD700]" /></div>
          <div className="relative">
            <h2 className="tls-wrap tls-type-section">{user?.display_name || user?.username}</h2>
            {m?.member_number && (
              <div className="mt-3 inline-flex items-center gap-2 text-[#FFD700] font-mono tls-type-card">
                <Hash className="w-4 h-4" /> {m.member_number}
              </div>
            )}
            <div className="mt-4 flex flex-wrap gap-3">
              <Pill icon={Crown} label={STATUS_LABELS[m?.member_status] || "—"} variant={m?.member_status === "active" || m?.member_status === "honorary" ? "gold" : "muted"} />
              {m?.membership_type && <Pill label={TYPE_LABELS[m.membership_type]} />}
              {m?.internal_role && <Pill label={m.internal_role} />}
            </div>
          </div>
        </div>

        {/* Stats */}
        <div className="mt-8 grid grid-cols-2 md:grid-cols-4 gap-4">
          <Stat icon={Calendar} label="Mitglied seit" value={formatMemberSince(m?.member_since, m?.member_since_precision)} />
          <Stat icon={History} label="Aktiv" value={yearsAsMember !== null ? `${yearsAsMember} Jahr${yearsAsMember === 1 ? "" : "e"}` : "—"} />
          <Stat icon={m?.show_member_number_publicly ? Eye : EyeOff} label="Nummer öffentlich" value={m?.show_member_number_publicly ? "Ja" : "Nein"} />
          <Stat icon={FileText} label="Mitgliedsart" value={m?.membership_type ? TYPE_LABELS[m.membership_type] : "—"} />
        </div>

        {/* Digitale Mitgliedskarte (#346): nur für aktive Mitglieder, der Server entscheidet */}
        {(m?.member_status === "active" || m?.member_status === "honorary") && <MemberCardPanel />}

        {/* Beitrag und Stand aus der Mitgliederverwaltung (#295) */}
        {fee && (
          <div id="beitrag" className={`mt-6 scroll-mt-32 border rounded-sm bg-[#121212] p-5 ${fee.tone === "warn" ? "border-[#FFD700]/40" : "border-white/10"}`} data-testid="membership-fee-card">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="tls-type-section inline-flex items-center gap-2"><Wallet className="w-4 h-4 text-[#FFD700]" /> Mitgliedsbeitrag</h2>
              <span className={`tls-type-label ${fee.tone === "warn" ? "text-[#FFD700]" : fee.tone === "info" ? "text-[#29B6E8]" : "text-ok"}`}>{fee.label}</span>
            </div>
            {fee.amount && <div className="mt-2 tls-type-section">{fee.amount} <span className="tls-type-small text-quiet font-normal">je Beitragsperiode</span></div>}
            <ul className="mt-2 space-y-1 tls-type-small text-white/75">
              {fee.lines.map((line) => <li key={line}>{line}</li>)}
            </ul>
            {!!erp.functions?.length && (
              <div className="mt-3 tls-type-small text-white/75">Funktion im Verein: {erp.functions.map((fn) => fn.label).join(", ")}</div>
            )}
            <div className={`mt-3 tls-type-small ${fee.stale ? "text-[#FFD700]" : "text-quiet"}`}>
              Stand aus der Mitgliederverwaltung vom {formatDate(fee.asOf)}{fee.stale ? " – seither nicht mehr abgeglichen" : ""}. Stimmt etwas nicht, melde dich beim Vorstand.
            </div>
          </div>
        )}
        {/* Meine Nummer (#2034): einmal wählen, danach nur über den Vorstand; der Server sagt, ob es sie gibt */}
        <div id="nummer" className="scroll-mt-32"><JerseyNumberCard /></div>

        {/* Eigene Daten und Austritt (#329 Teil 2): nur mit Bindung und Fähigkeit „eigene Daten“ */}
        {erp?.connected && <div id="meine-daten" className="scroll-mt-32"><SelfServiceCard /></div>}
        {/* Konten in der Mitgliederakte (#846): geprüfte Konten nur auf Wunsch in die Akte */}
        {erp?.connected && <MemberFileAccountsCard />}
        {/* Eigenes Website-Profil (#260): Gamertag, Kurztext, Spiele, Plattformen in der Vereinsakte, Anzeige nur mit Einwilligung */}
        {erp?.connected && <WebsiteProfileCard />}
        {erp?.connected && !erp.led_by_dolibarr && (
          <div className="mt-6 border border-white/10 rounded-sm bg-[#121212] p-5" data-testid="membership-link-card">
            <h2 className="tls-type-section">Bist du Vereinsmitglied?</h2>
            {erp.link?.status === "requested" ? (
              <p className="mt-2 tls-type-body text-white/70">Deine Anfrage vom {formatDate(erp.link.requested_at)} liegt beim Vorstand. Sobald sie bestätigt ist, erscheint hier dein Beitragsstand.</p>
            ) : erp.link?.status === "conflict" ? (
              <p className="mt-2 tls-type-body text-white/70">Deine Zuordnung braucht eine Klärung durch den Vorstand (z. B. geteilte E-Mail-Adresse in der Familie). Du musst nichts tun.</p>
            ) : (
              <p className="mt-2 tls-type-body text-white/70">Dein Konto ist noch keinem Mitglied in der Mitgliederverwaltung zugeordnet. Der Vorstand prüft und bestätigt die Zuordnung – eine Mitgliedsnummer allein reicht dafür nicht.</p>
            )}
            {canAskForLink && <LinkRequest onDone={load} />}
          </div>
        )}

        {/* Austritt ohne Dolibarr (#2125): eine Erklärung an den Vorstand; mit Dolibarr geht er über „Meine Daten“ */}
        {(m?.member_status === "active" || m?.member_status === "honorary") && !erp?.led_by_dolibarr && <SimpleExitCard exitRequest={m.exit_request} onChanged={load} />}

        {/* Mitgliedsnummer öffentlich (#2125): entscheidet das Mitglied selbst; Standard ist nein */}
        {m?.member_number && <NumberVisibilityCard membership={m} onChanged={load} />}

        {/* Vereinsakte verbinden (#324 Teil 1): Einladungscode vom Vorstand, danach eigene Unterlagen aus der Akte */}
        {erp?.connected && <IdentityCard />}
        {/* Mitgliederverzeichnis per Opt-in (#410): der Server sagt, ob die Person eintragen darf */}
        {(m?.member_status === "active" || m?.member_status === "honorary") && <DirectoryCard />}

        {/* Meine Einwilligungen (#329, Teil 1) stehen seit #2059 unter Datenschutz → Einwilligungen. */}
        {/* History */}
        {!!m?.history?.length && (
          <div className="mt-6 border border-white/10 rounded-sm bg-[#121212] p-5">
            <h2 className="tls-type-section mb-4 inline-flex items-center gap-2"><History className="w-4 h-4 text-[#FFD700]" /> Verlauf</h2>
            <div className="space-y-3">
              {m.history.slice().reverse().map((h, idx) => (
                <div key={idx} className="flex items-start gap-3 tls-type-small border-l-2 border-[#FFD700]/40 pl-4">
                  <div className="flex-1">
                    <div className="text-white">
                      Status:{" "}
                      <strong className="text-[#FFD700]">{STATUS_LABELS[h.to_status] || h.to_status || "—"}</strong>
                      {h.from_status && h.from_status !== h.to_status && (
                        <span className="text-white/40"> (vorher: {STATUS_LABELS[h.from_status] || h.from_status})</span>
                      )}
                    </div>
                    <div className="tls-type-small text-quiet mt-0.5">{viennaDateTime(h.at)}</div>
                    {h.source === "dolibarr" && <div className="tls-type-small text-white/45 mt-1">aus der Mitgliederverwaltung übernommen</div>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Weiter in „Mein Bereich“: was zur Mitgliedschaft gehört, aber eine eigene Gruppe hat. */}
        <div className="mt-8 flex flex-wrap gap-3" data-testid="membership-more">
          <Link to={vereinPfad("vorteile")} className="tls-btn tls-btn--secondary inline-flex min-h-11 items-center px-4 py-2 tls-type-label rounded-sm">Vorteile ansehen</Link>
          {erp?.led_by_dolibarr && <Link to={`${BEREICH}/rechnungen`} data-testid="membership-invoices-link" className="tls-btn tls-btn--secondary inline-flex min-h-11 items-center px-4 py-2 tls-type-label rounded-sm">Rechnungen</Link>}
          {erp?.led_by_dolibarr && <Link to={`${BEREICH}/datenschutz?tab=einwilligungen`} data-testid="membership-consents-link" className="tls-btn tls-btn--quiet inline-flex min-h-11 items-center px-4 py-2 tls-type-label rounded-sm">Einwilligungen</Link>}
        </div>
    </div>
  );
}

function NumberVisibilityCard({ membership, onChanged }) {
  const [busy, setBusy] = useState(false);
  const change = async (next) => {
    setBusy(true);
    try {
      await api.put("/membership/me/number-visibility", { public: next });
      toast.success(next ? "Deine Mitgliedsnummer steht jetzt auf deinem öffentlichen Profil." : "Deine Mitgliedsnummer ist nicht mehr öffentlich.");
      await onChanged();
    } catch (err) {
      toast.error(formatApiError(err?.response?.data?.detail) || "Das hat nicht geklappt.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mt-6 border border-white/10 rounded-sm bg-[#121212] p-5" data-testid="membership-number-card">
      <SwitchRow
        label="Mitgliedsnummer öffentlich zeigen"
        description="Auf deinem öffentlichen Profil. Das entscheidest nur du."
        checked={Boolean(membership.show_member_number_publicly)}
        onCheckedChange={change}
        disabled={busy}
        testId="membership-number-switch"
      />
    </div>
  );
}

// Einfache Austrittserklärung (#2125): die Mitgliedschaft läuft weiter, bis der Vorstand sie beendet - bis dahin lässt
// sich die Erklärung zurücknehmen. Eine Kündigungsfrist rechnet hier niemand, das entscheidet der Vorstand.
function SimpleExitCard({ exitRequest, onChanged }) {
  const confirm = useConfirm();
  const [wishedDay, setWishedDay] = useState("");
  const [busy, setBusy] = useState(false);
  const run = async (action, success) => {
    setBusy(true);
    try {
      await action();
      toast.success(success);
      await onChanged();
    } catch (err) {
      toast.error(formatApiError(err?.response?.data?.detail) || "Das hat nicht geklappt.");
    } finally {
      setBusy(false);
    }
  };
  const declare = async () => {
    if (!await confirm({
      title: "Austritt aus dem Verein erklären?",
      description: "Die Erklärung geht an den Vorstand. Du bleibst Mitglied, bis er die Mitgliedschaft beendet; bis dahin kannst du die Erklärung zurücknehmen.",
      confirmLabel: "Austritt erklären",
    })) return;
    await run(() => api.post("/membership/me/exit", wishedDay ? { wished_last_day: wishedDay } : {}), "Dein Austritt ist beim Vorstand eingegangen.");
  };
  return (
    <div className="mt-6 border border-white/10 rounded-sm bg-[#121212] p-5" data-testid="membership-exit-card">
      <h2 className="tls-type-section">Austritt</h2>
      {exitRequest ? (
        <div className="mt-2 space-y-3">
          <p className="tls-type-body text-white/70" data-testid="membership-exit-declared">{exitLine(exitRequest, viennaDate)} Der Vorstand beendet deine Mitgliedschaft und meldet sich, wenn Fragen offen sind.</p>
          <button type="button" onClick={() => run(() => api.delete("/membership/me/exit"), "Du hast die Erklärung zurückgenommen.")} disabled={busy} data-testid="membership-exit-withdraw" className="tls-btn tls-btn--secondary px-4 py-2 rounded-sm tls-type-label disabled:opacity-50">Erklärung zurücknehmen</button>
        </div>
      ) : (
        <div className="mt-3 flex flex-col sm:flex-row sm:items-end gap-3">
          <label className="block">
            <div className="tls-type-label text-white/60 mb-1.5">Wunschtermin (optional)</div>
            <input type="date" value={wishedDay} onChange={(event) => setWishedDay(event.target.value)} data-testid="membership-exit-date" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm" />
          </label>
          <button type="button" onClick={declare} disabled={busy} data-testid="membership-exit-button" className="tls-btn tls-btn--danger px-4 py-2 rounded-sm tls-type-label disabled:opacity-50">Austritt erklären</button>
        </div>
      )}
    </div>
  );
}

// Vereinsakte (#324 Teil 1, #531): Ab Vereinsmodul 1.4.0 reicht die bestätigte Zuordnung des Kontos zum
// Mitgliedseintrag - Unterlagen, eigene Daten und Website-Profil kommen dann von selbst (via "member").
// Der Einladungscode vom Vorstand (gilt eine Stunde, genau einmal) bleibt der Ersatzweg für ältere Module.
function IdentityCard() {
  const [state, setState] = useState(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    api.get("/membership/me/identity").then(({ data }) => setState(data && data.available === true ? data : null)).catch(() => setState(null));
  }, []);
  useEffect(() => { load(); }, [load]);
  const submit = async (event) => {
    event.preventDefault();
    if (!code.trim() || busy) return;
    setBusy(true);
    try {
      const { data } = await api.post("/membership/me/identity", { code: code.trim() });
      setState(data);
      setCode("");
      toast.success("Verbunden – deine Unterlagen aus der Vereinsakte stehen jetzt unter Vereinsdokumente.");
    } catch (err) {
      toast.error(formatApiError(err?.response?.data?.detail) || "Das hat nicht geklappt.");
    } finally {
      setBusy(false);
    }
  };
  if (!state) return null;
  const bound = state.status === "bound";
  const viaMember = bound && state.via === "member";
  const hint = state.status === "revoked"
    ? "Der Verein hat die Verbindung widerrufen. Mit einem neuen Code vom Vorstand verbindest du dein Konto wieder."
    : state.module_too_old
      ? `Dein Konto ist deinem Mitgliedseintrag${state.member_ref ? ` (Nr. ${state.member_ref})` : ""} zugeordnet. Damit deine Unterlagen ohne Code erscheinen, braucht der Verein das Vereinsmodul ab 1.4.0 – bis dahin geht es mit einem Einladungscode vom Vorstand.`
      : "Sobald dein Konto deinem Mitgliedseintrag zugeordnet ist – von selbst über deine bestätigte E-Mail-Adresse oder durch den Vorstand –, siehst du unter Vereinsdokumente auch deine persönlichen Unterlagen aus der Vereinsakte. Alternativ geht ein Einladungscode vom Vorstand (gilt eine Stunde, genau einmal).";
  return (
    <div className="mt-6 border border-white/10 rounded-sm bg-[#121212] p-5" data-testid="membership-identity-card">
      <h2 className="tls-type-section inline-flex items-center gap-2"><FileText className="w-4 h-4 text-[#FFD700]" /> Vereinsakte</h2>
      {bound ? (
        <div className="mt-2 tls-type-small text-white/70" data-testid="membership-identity-bound">
          {viaMember
            ? <>Dein Konto ist über deine Mitgliedsnummer{state.member_ref ? ` ${state.member_ref}` : ""} mit der Vereinsakte verbunden – Unterlagen, eigene Daten und dein Website-Profil kommen von selbst aus der Mitgliederverwaltung.</>
            : <>Dein Konto ist seit {formatDate(state.linked_at)} mit der Vereinsakte verbunden{state.capability_labels?.length ? ` (${state.capability_labels.join(", ")})` : ""}.</>}{" "}
          <Link to={vereinPfad("dokumente")} className="tls-btn tls-btn--quiet mt-2 inline-flex min-h-11 items-center px-3 py-2 rounded-sm tls-type-label" data-testid="membership-identity-documents">Zu den Vereinsdokumenten</Link>
          {viaMember && state.right_missing ? (
            <p className="mt-2 text-[#FFD700]/80" data-testid="membership-identity-right-missing">Die Website darf im Vereinsmodul noch nicht im Namen der Mitglieder handeln – der Vorstand richtet das Recht ein; bis dahin siehst du nur das Öffentliche.</p>
          ) : null}
        </div>
      ) : (
        <>
          <p className="mt-2 tls-type-body text-white/70" data-testid="membership-identity-hint">{hint}</p>
          <form onSubmit={submit} className="mt-3 flex flex-col sm:flex-row gap-2" data-testid="membership-identity-form">
            <input value={code} onChange={(e) => setCode(e.target.value)} maxLength={120} placeholder="Einladungscode" autoComplete="off" data-testid="membership-identity-code" className="flex-1 bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm" />
            <button type="submit" disabled={busy || !code.trim()} data-testid="membership-identity-claim" className="px-4 py-2 bg-[#FFD700] text-black tls-type-label rounded-sm disabled:opacity-50">{busy ? "Prüfe…" : "Verbinden"}</button>
          </form>
        </>
      )}
    </div>
  );
}

// Eigenes Website-Profil (#260, Vereine 1.2): die Felder, die der Verein in der Vereinsakte dafür gewählt hat.
// Der Vorstand sieht sie auf der Mitgliedskarte, die Website zeigt sie im Mitgliederverzeichnis – aber nur,
// wenn die Person der Nennung zugestimmt hat. Welche Felder das Mitglied selbst ändert, sagt `editable`.
export function websiteFieldText(field) {
  const value = field?.value;
  if (value === null || value === undefined || value === "" || (Array.isArray(value) && !value.length)) return "";
  const label = (code) => (field.options || []).find((o) => o.code === code)?.label || code;
  if (field.type === "boolean") return value ? "Ja" : "Nein";
  if (field.type === "multi" && Array.isArray(value)) return value.map(label).join(", ");
  if (field.type === "select") return label(value);
  return String(value);
}

export function websiteStateLine(view) {
  if (!view?.consent) return "Der Verein hat noch keine Einwilligung für das Website-Profil gewählt – dein Profil bleibt vorerst intern.";
  return view.given
    ? "Du hast der Nennung zugestimmt: Der Verein zeigt dieses Profil im Mitgliederverzeichnis."
    : "Sichtbar wird das Profil erst, wenn du der Nennung zugestimmt hast (siehe Einwilligungen).";
}

const sameValue = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

function WebsiteFieldInput({ field, value, onChange }) {
  const base = "w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm tls-type-small";
  const testId = `membership-website-${field.code}`;
  if (field.type === "textarea") return <textarea value={value ?? ""} onChange={(e) => onChange(e.target.value)} rows={3} maxLength={field.max_length || 2000} data-testid={testId} className={base} />;
  if (field.type === "boolean") return <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} data-testid={testId} className="w-4 h-4 accent-[#FFD700]" />;
  if (field.type === "select") {
    return (
      <select value={value ?? ""} onChange={(e) => onChange(e.target.value || null)} data-testid={testId} className={base}>
        <option value="">– keine Angabe –</option>
        {(field.options || []).map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}
      </select>
    );
  }
  if (field.type === "multi") {
    const chosen = Array.isArray(value) ? value : [];
    return (
      <div className="flex flex-wrap gap-2" data-testid={testId}>
        {(field.options || []).map((o) => (
          <label key={o.code} className={`px-2 py-1 border rounded-sm tls-type-small cursor-pointer ${chosen.includes(o.code) ? "border-[#FFD700] text-[#FFD700]" : "border-white/15 text-white/60"}`}>
            <input type="checkbox" className="sr-only" checked={chosen.includes(o.code)} onChange={(e) => onChange(e.target.checked ? [...chosen, o.code] : chosen.filter((c) => c !== o.code))} data-testid={`${testId}-${o.code}`} />
            {o.label}
          </label>
        ))}
      </div>
    );
  }
  const type = field.type === "number" ? "number" : field.type === "date" ? "date" : "text";
  return <input type={type} value={value ?? ""} onChange={(e) => onChange(e.target.value)} maxLength={field.max_length || 255} data-testid={testId} className={base} />;
}

function WebsiteProfileCard() {
  const [view, setView] = useState(null);
  const [draft, setDraft] = useState({});
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    api.get("/membership/me/website-profile").then(({ data }) => {
      setView(data && data.available === true ? data : null);
      setDraft({});
    }).catch(() => setView(null));
  }, []);
  useEffect(() => { load(); }, [load]);
  if (!view) return null;
  const fields = view.fields || [];
  const value = (field) => (field.code in draft ? draft[field.code] : field.value);
  const changed = Object.fromEntries(fields.filter((f) => f.editable && f.code in draft && !sameValue(draft[f.code], f.value)).map((f) => [f.code, draft[f.code]]));
  const save = async (event) => {
    event.preventDefault();
    if (busy || !Object.keys(changed).length) return;
    setBusy(true);
    try {
      const { data } = await api.put("/membership/me/website-profile", { fields: changed });
      setView(data);
      setDraft({});
      toast.success("Website-Profil gespeichert.");
    } catch (err) {
      toast.error(formatApiError(err?.response?.data?.detail) || "Das hat nicht geklappt.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mt-6 border border-white/10 rounded-sm bg-[#121212] p-5" data-testid="membership-website-card">
      <h2 className="tls-type-section inline-flex items-center gap-2"><Crown className="w-4 h-4 text-[#FFD700]" /> Mein Website-Profil</h2>
      <p className="mt-2 tls-type-small text-white/70" data-testid="membership-website-state">{websiteStateLine(view)}</p>
      {!fields.length && <p className="mt-3 tls-type-small text-white/50" data-testid="membership-website-empty">Der Verein hat noch keine Felder für das Website-Profil gewählt.</p>}
      <form onSubmit={save} className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3" data-testid="membership-website-form">
        {fields.map((field) => (
          <label key={field.code} className={`block ${field.type === "textarea" ? "sm:col-span-2" : ""}`}>
            <div className="tls-type-label text-white/60 mb-1.5">{field.label}{!field.editable && <span className="ml-2 normal-case tracking-normal text-white/35">pflegt der Verein</span>}</div>
            {field.editable
              ? <WebsiteFieldInput field={field} value={value(field)} onChange={(v) => setDraft((d) => ({ ...d, [field.code]: v }))} />
              : <div className="tls-type-small text-white/80" data-testid={`membership-website-${field.code}`}>{websiteFieldText(field) || "–"}</div>}
          </label>
        ))}
        {fields.some((f) => f.editable) && (
          <div className="sm:col-span-2">
            <button type="submit" disabled={busy || !Object.keys(changed).length} data-testid="membership-website-save" className="px-4 py-2 bg-[#FFD700] text-black tls-type-label rounded-sm disabled:opacity-50">{busy ? "Sende…" : "Profil speichern"}</button>
          </div>
        )}
      </form>
    </div>
  );
}

const SELF_FIELD_LABELS = {
  address: "Straße und Hausnummer", zip: "PLZ", town: "Ort", country_code: "Land (Kürzel, z. B. AT)",
  phone: "Telefon", phone_mobile: "Mobil", email: "E-Mail",
};

export function selfRequestLine(row) {
  if (!row) return "";
  if (row.kind === "exit") return `Austritt erklärt${row.notice_day ? ` am ${formatDate(row.notice_day)}` : ""} – letzter Tag ${formatDate(row.last_day)}${row.wished_too_early ? " (Wunschdatum lag vor der Kündigungsfrist)" : ""}`;
  const changes = Object.entries(row.changes || {}).map(([key, value]) => `${SELF_FIELD_LABELS[key] || key}: ${value}`).join(", ");
  return `Änderung: ${changes}`;
}

// Eigene Daten und Austritt (#329 Teil 2): die Daten kommen aus der Vereinsakte, Änderungen gehen mit dem
// gesehenen Stand dorthin (Felder aus `direct` übernimmt der Verein sofort, der Rest liegt beim Vorstand);
// den letzten Tag des Austritts rechnet der Verein, nie die Website.
function SelfServiceCard() {
  const confirm = useConfirm();
  const [view, setView] = useState(null);
  const [draft, setDraft] = useState({});
  const [wishedDay, setWishedDay] = useState("");
  const [busy, setBusy] = useState("");
  const load = useCallback(() => {
    api.get("/membership/me/self-service").then(({ data }) => {
      setView(data && data.available === true && data.profile ? data : null);
      setDraft({});
    }).catch(() => setView(null));
  }, []);
  useEffect(() => { load(); }, [load]);
  if (!view) return null;
  const { profile, changeable, requests } = view;
  const value = (key) => (key in draft ? draft[key] : profile[key] || "");
  const changed = Object.fromEntries(changeable.filter((key) => key in draft && draft[key] !== (profile[key] || "")).map((key) => [key, draft[key]]));
  const directLabels = (profile.direct || []).map((key) => SELF_FIELD_LABELS[key] || key);
  const save = async (event) => {
    event.preventDefault();
    if (busy || !Object.keys(changed).length) return;
    setBusy("save");
    try {
      const { data } = await api.post("/membership/me/self-service/changes", { version: profile.version, changes: changed });
      toast.success(data.status === "applied" ? "Übernommen – deine Daten sind aktuell." : "Eingereicht – der Vorstand prüft die Änderung.");
      load();
    } catch (err) {
      toast.error(formatApiError(err?.response?.data?.detail) || "Das hat nicht geklappt.");
    } finally {
      setBusy("");
    }
  };
  const leave = async () => {
    if (busy) return;
    const ok = await confirm({
      title: "Austritt aus dem Verein erklären?",
      description: `Die Erklärung geht heute bei der Vereinsverwaltung ein. Wann die Mitgliedschaft endet, ergibt die Kündigungsregel des Vereins${wishedDay ? ` – dein Wunschdatum ${formatDate(wishedDay)} gilt nur, wenn es nicht davor liegt` : ""}. Das lässt sich hier nicht zurücknehmen.`,
      confirmLabel: "Austritt erklären",
    });
    if (!ok) return;
    setBusy("exit");
    try {
      const { data } = await api.post("/membership/me/self-service/exit", wishedDay ? { wished_last_day: wishedDay } : {});
      toast.success(`Austritt eingegangen – letzter Tag: ${formatDate(data.last_day)}${data.wished_too_early ? " (dein Wunschdatum lag vor der Kündigungsfrist)" : ""}.`);
      load();
    } catch (err) {
      toast.error(formatApiError(err?.response?.data?.detail) || "Das hat nicht geklappt.");
    } finally {
      setBusy("");
    }
  };
  return (
    <div className="mt-6 border border-white/10 rounded-sm bg-[#121212] p-5" data-testid="membership-self-card">
      <h2 className="tls-type-section inline-flex items-center gap-2"><Users className="w-4 h-4 text-[#FFD700]" /> Meine Daten</h2>
      <p className="mt-2 tls-type-small text-white/70" data-testid="membership-self-identity">
        {profile.firstname} {profile.lastname} · {profile.member_type}{profile.ref ? ` · Nr. ${profile.ref}` : ""}{profile.birth ? ` · geboren ${formatDate(profile.birth)}` : ""}
      </p>
      {/* Einmalige Freigabe (#329, Vereine 1.8.0): der Vorstand gibt das Mitglied in Dolibarr für eine direkte Änderung frei. */}
      {profile.direct_once ? (
        <p className="mt-3 tls-type-body border border-ok/40 bg-ok/10 text-ok rounded-sm p-3" data-testid="membership-self-once">
          Der Vorstand hat dich für eine Änderung freigegeben: Deine nächste Änderung gilt sofort – auch eine neue E-Mail-Adresse.
        </p>
      ) : null}
      <p className="mt-1 tls-type-small text-white/45">Name und Geburtsdatum ändert nur der Vorstand. {profile.direct_once ? "" : `${directLabels.length ? `${directLabels.join(" und ")} übernimmt der Verein sofort; ` : ""}alles andere prüft der Vorstand. Eine neue E-Mail-Adresse braucht den Vorstand.`}</p>
      <form onSubmit={save} className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3" data-testid="membership-self-form">
        {changeable.map((key) => (
          <label key={key} className={`block ${key === "address" ? "sm:col-span-2" : ""}`}>
            <div className="tls-type-label text-white/60 mb-1.5">{SELF_FIELD_LABELS[key] || key}</div>
            <input value={value(key)} onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))} maxLength={200} data-testid={`membership-self-field-${key}`} className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm" />
          </label>
        ))}
        <div className="sm:col-span-2">
          <button type="submit" disabled={busy === "save" || !Object.keys(changed).length} data-testid="membership-self-save" className="px-4 py-2 bg-[#FFD700] text-black tls-type-label rounded-sm disabled:opacity-50">{busy === "save" ? "Sende…" : "Änderung senden"}</button>
        </div>
      </form>
      {requests.length > 0 && (
        <div className="mt-5 space-y-2" data-testid="membership-self-requests">
          <div className="tls-type-label text-white/60">Eingereicht</div>
          {requests.slice().reverse().map((row) => (
            <div key={row.external_id} className="tls-type-small border-l-2 border-[#FFD700]/40 pl-3" data-testid={`membership-self-request-${row.external_id}`}>
              <div className="text-white/80">{selfRequestLine(row)}</div>
              <div className="tls-type-small text-white/45">{row.status_label}{row.reason ? ` – ${row.reason}` : ""}{row.received_at ? ` · ${formatDate(row.received_at)}` : ""}</div>
            </div>
          ))}
        </div>
      )}
      <div className="mt-5 border-t border-white/10 pt-4">
        {profile.exit ? (
          <p className="tls-type-small text-white/70" data-testid="membership-self-exit-planned">
            Austritt {profile.exit.status === "done" ? "vollzogen" : "geplant"}: letzter Tag der Mitgliedschaft {formatDate(profile.exit.last_day)}{profile.exit.notice_day ? ` (Eingang ${formatDate(profile.exit.notice_day)})` : ""}.
          </p>
        ) : (
          <div className="flex flex-col sm:flex-row sm:items-end gap-3" data-testid="membership-self-exit">
            <label className="block">
              <div className="tls-type-small font-bold text-white/60 mb-1.5">Austritt – Wunschdatum (optional)</div>
              <input type="date" value={wishedDay} onChange={(e) => setWishedDay(e.target.value)} data-testid="membership-self-exit-date" className="bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm" />
            </label>
            <button type="button" onClick={leave} disabled={busy === "exit"} data-testid="membership-self-exit-button" className="px-4 py-2 border border-[#FF3B30]/60 text-[#FF3B30] tls-type-label rounded-sm disabled:opacity-50">Austritt erklären</button>
          </div>
        )}
      </div>
    </div>
  );
}

const CONSENT_STATE = {
  given: (row) => `Zugestimmt${row.moment ? ` am ${formatDate(row.moment)}` : ""} (Fassung ${row.version})`,
  withdrawn: (row) => `Widerrufen${row.moment ? ` am ${formatDate(row.moment)}` : ""}`,
  none: () => "Noch nicht entschieden",
};

// Meine Einwilligungen (#329, Teil 1; #1537): je Zweck der Stand, der in der Mitgliederverwaltung steht.
// Zustimmen nur nach dem Lesen der aktuellen Fassung (die Fassung geht mit), Widerrufen jederzeit -
// auch wenn es inzwischen einen neuen Text gibt. Der Text der zugestimmten Fassung bleibt lesbar; bei
// einer neuen Fassung stehen beide da (die alte, soweit die Website sie kennt). Ob ein Zweck Pflicht ist,
// sagt das Modul nicht - die Karte sagt dazu nichts. Antwortet die Mitgliederverwaltung nicht, steht das da.
const CONSENTS_HIDDEN = new Set(["not_connected", "not_linked"]);

// Der Text einer früheren Fassung kommt nicht vom Modul; die Website kennt ihn nur, wenn sie ihn selbst einmal gelesen hat
// (Codex-Prüfung #1547). Fehlt er, steht das ehrlich da - mit der aktuellen Fassung darunter.
function missingGivenText(row) {
  const which = row.moment ? `vom ${viennaDate(row.moment, { day: "2-digit", month: "2-digit", year: "numeric" })}` : row.version;
  return `Den Text der Fassung ${which}, der du zugestimmt hast, haben wir nicht. Aktuelle Fassung:`;
}

function ConsentTexts({ row }) {
  if (row.state === "given" && !row.text_changed) {
    return (
      <div data-testid={`consent-given-text-${row.code}`}>
        <div className="tls-type-label text-white/45">Deine Fassung {row.version}</div>
        <p className="mt-1 tls-type-body text-white/75 whitespace-pre-wrap">{row.given_text || row.text || "Der Text ist gerade nicht abrufbar."}</p>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {row.state === "given" && (row.given_text ? (
        <div data-testid={`consent-given-text-${row.code}`}>
          <div className="tls-type-label text-white/45">Zugestimmt hast du Fassung {row.version}</div>
          <p className="mt-1 tls-type-body text-white/60 whitespace-pre-wrap">{row.given_text}</p>
        </div>
      ) : (
        <div className="tls-type-small text-white/45" data-testid={`consent-given-missing-${row.code}`}>{missingGivenText(row)}</div>
      ))}
      <div data-testid={`consent-current-text-${row.code}`}>
        {row.state === "given" && row.given_text && <div className="tls-type-label text-[#FFD700]">Neue Fassung {row.current_version}</div>}
        <p className="mt-1 tls-type-body text-white/75 whitespace-pre-wrap">{row.text || "Der Text ist gerade nicht abrufbar – bitte später noch einmal öffnen."}</p>
      </div>
    </div>
  );
}

export function ConsentsCard() {
  const [state, setState] = useState(null);
  const [problem, setProblem] = useState(null);
  const [open, setOpen] = useState(null);
  const [busy, setBusy] = useState(false);
  const confirm = useConfirm();
  const load = useCallback(() => {
    api.get("/membership/me/consents").then(({ data }) => {
      if (data && data.available === true && Array.isArray(data.consents)) {
        setState(data);
        setProblem(null);
      } else if (data && CONSENTS_HIDDEN.has(data.reason)) {
        setState(null);
        setProblem(null);
      } else {
        setProblem({ text: data?.text || "" });
      }
    }).catch((error) => setProblem({ text: formatApiError(error?.response?.data?.detail) || "" }));
  }, []);
  useEffect(() => { load(); }, [load]);
  if (!state && !problem) return null;

  const decide = async (row, decision) => {
    if (decision === "given" && !await confirm({ title: `„${row.label}“ zustimmen?`, description: `Du stimmst der Fassung ${row.current_version} zu, die du gerade gelesen hast. Das gilt sofort in der Mitgliederverwaltung; widerrufen kannst du jederzeit.`, confirmLabel: "Zustimmen" })) return;
    if (decision === "withdrawn" && !await confirm({ title: `„${row.label}“ widerrufen?`, description: "Der Widerruf gilt sofort in der Mitgliederverwaltung. Du kannst später wieder zustimmen.", confirmLabel: "Widerrufen" })) return;
    setBusy(true);
    try {
      const body = decision === "given" ? { code: row.code, decision, version: row.current_version } : { code: row.code, decision };
      const { data } = await api.post("/membership/me/consents", body);
      if (Array.isArray(data?.consents)) setState((current) => ({ ...current, consents: data.consents }));
      else load();
      setOpen(null);
      toast.success(decision === "given" ? "Zustimmung gespeichert." : "Widerruf gespeichert.");
    } catch (err) {
      toast.error(formatApiError(err?.response?.data?.detail) || "Das hat nicht geklappt.");
      if (err?.response?.status === 400) load();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-6 border border-white/10 rounded-sm bg-[#121212] p-5" data-testid="membership-consents-card">
      <h2 className="tls-type-section inline-flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-[#FFD700]" /> Meine Einwilligungen</h2>
      <p className="mt-1 tls-type-small text-white/45">Jederzeit widerrufbar. Der Stand kommt aus der Mitgliederverwaltung; ein Widerruf gilt dort sofort.</p>
      {problem && (
        <div className="mt-4 border border-[#FFD700]/30 rounded-sm p-3" role="alert" data-testid="consents-error">
          <div className="tls-type-small text-white/80">Deine Einwilligungen wurden nicht geladen.</div>
          {problem.text && <div className="mt-1 tls-type-small text-white/50">{problem.text}</div>}
          <button type="button" onClick={load} data-testid="consents-retry" className="tls-btn tls-btn--secondary mt-3 inline-flex px-3 py-1.5 rounded-sm tls-type-label">Nochmal versuchen</button>
        </div>
      )}
      {state && (
        <div className="mt-4 space-y-3">
          {state.consents.map((row) => (
            <div key={row.code} className="border border-white/10 rounded-sm p-3" data-testid={`consent-${row.code}`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-bold text-white">{row.label}</div>
                  <div className={`tls-type-small ${row.state === "given" ? "text-ok" : row.state === "withdrawn" ? "text-[#FFD700]" : "text-white/45"}`} data-testid={`consent-state-${row.code}`}>{(CONSENT_STATE[row.state] || CONSENT_STATE.none)(row)}</div>
                  {row.text_changed && <div className="mt-1 tls-type-small text-[#FFD700]" data-testid={`consent-changed-${row.code}`}>Text geändert – bitte die neue Fassung lesen.</div>}
                </div>
                <div className="flex flex-wrap gap-2 shrink-0">
                  {open !== row.code && (
                    <button type="button" onClick={() => setOpen(row.code)} disabled={busy} data-testid={`consent-open-${row.code}`} className="px-3 py-1.5 border border-[#FFD700]/40 text-[#FFD700] rounded-sm tls-type-label disabled:opacity-50">{!row.can_give ? "Text lesen" : row.state === "given" ? "Neue Fassung lesen" : "Lesen und zustimmen"}</button>
                  )}
                  {row.can_withdraw && (
                    <button type="button" onClick={() => decide(row, "withdrawn")} disabled={busy} data-testid={`consent-withdraw-${row.code}`} className="px-3 py-1.5 border border-white/15 text-white/70 hover:text-[#FF3B30] hover:border-[#FF3B30]/40 rounded-sm tls-type-label disabled:opacity-50">Widerrufen</button>
                  )}
                </div>
              </div>
              {open === row.code && (
                <div className="mt-3 border-t border-white/10 pt-3" data-testid={`consent-text-${row.code}`}>
                  <ConsentTexts row={row} />
                  <div className="mt-3 flex flex-wrap gap-2">
                    {row.can_give && row.text && (
                      <button type="button" onClick={() => decide(row, "given")} disabled={busy} data-testid={`consent-give-${row.code}`} className="px-4 py-2 bg-[#FFD700] text-black tls-type-label rounded-sm disabled:opacity-50">Ich stimme zu</button>
                    )}
                    <button type="button" onClick={() => setOpen(null)} disabled={busy} className="px-4 py-2 border border-white/15 text-white/60 rounded-sm tls-type-label">{row.can_give && row.text ? "Abbrechen" : "Schließen"}</button>
                  </div>
                </div>
              )}
            </div>
          ))}
          {!state.consents.length && <div className="tls-type-small text-white/45">Der Verein hat derzeit keine Einwilligungstexte hinterlegt.</div>}
        </div>
      )}
    </div>
  );
}

function toDirectoryForm(entry) {
  return { gamertag: entry?.gamertag || "", games: (entry?.games || []).join(", "), platforms: (entry?.platforms || []).join(", "), bio: entry?.bio || "" };
}

function splitList(value) {
  return String(value || "").split(",").map((item) => item.trim()).filter(Boolean);
}

// Der eigene Eintrag im Mitgliederverzeichnis (#410): einschalten, Gamertag, Spiele, Plattformen
// und eine kurze Bio pflegen; Name und Foto kommen vom Konto. Gesperrt heißt: nur der Vorstand
// kann das aufheben.
function DirectoryCard() {
  const [entry, setEntry] = useState(null);
  const [form, setForm] = useState(toDirectoryForm(null));
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    api.get("/membership/me/directory").then(({ data }) => {
      if (data && typeof data.eligible === "boolean") { setEntry(data); setForm(toDirectoryForm(data.entry)); }
    }).catch(toastLoadFailed("Dein Eintrag im Mitgliederverzeichnis konnte nicht geladen werden."));
  }, []);
  useEffect(() => { load(); }, [load]);
  if (!entry?.eligible) return null;

  const save = async (patch, successText) => {
    setBusy(true);
    try {
      const { data } = await api.put("/membership/me/directory", patch);
      setEntry(data);
      setForm(toDirectoryForm(data.entry));
      toast.success(successText);
    } catch (err) {
      toast.error(formatApiError(err?.response?.data?.detail) || "Speichern hat nicht geklappt.");
    } finally {
      setBusy(false);
    }
  };
  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));
  const submit = (e) => {
    e.preventDefault();
    save({ gamertag: form.gamertag, games: splitList(form.games), platforms: splitList(form.platforms), bio: form.bio }, "Eintrag gespeichert.");
  };
  const inputClass = "w-full bg-[#0A0A0A] border border-white/10 focus:border-[#FFD700] px-3 py-2 rounded-sm text-white tls-type-small focus:outline-none";

  return (
    <div className="mt-6 border border-white/10 rounded-sm bg-[#121212] p-5" data-testid="membership-directory-card">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="tls-type-section inline-flex items-center gap-2"><Users className="w-4 h-4 text-[#FFD700]" /> Mitgliederverzeichnis</h2>
        {entry.listed && entry.slug && <Link to={`/members/${entry.slug}`} data-testid="membership-directory-link" className="tls-btn tls-btn--quiet inline-flex min-h-11 items-center px-3 py-2 rounded-sm tls-type-label">Meinen Eintrag ansehen</Link>}
      </div>
      {entry.blocked ? (
        <p className="mt-3 tls-type-body text-[#FFD700]" data-testid="membership-directory-blocked">Dein Eintrag ist von der Vereinsverwaltung gesperrt. Wenn du meinst, das stimmt nicht, melde dich beim Vorstand.</p>
      ) : (
        <div className="mt-3">
          <SwitchRow
            label="Im Mitgliederverzeichnis zeigen"
            description="Auf der öffentlichen Seite „Vereinsmitglieder“ mit Gamertag, Foto, Spielen und Plattformen. Du kannst das jederzeit wieder ausschalten."
            checked={entry.listed}
            onCheckedChange={(next) => save({ listed: next }, next ? "Du stehst jetzt im Mitgliederverzeichnis." : "Dein Eintrag ist nicht mehr öffentlich.")}
            disabled={busy}
            testId="membership-directory-switch"
          />
        </div>
      )}
      {entry.listed && !entry.blocked && (
        <form onSubmit={submit} className="mt-4 space-y-3" data-testid="membership-directory-form">
          <div className="grid sm:grid-cols-3 gap-3">
            <label className="block tls-type-label text-white/65">Gamertag
              <input value={form.gamertag} onChange={(e) => set("gamertag", e.target.value)} maxLength={40} data-testid="membership-directory-gamertag" className={`mt-1 ${inputClass} normal-case tracking-normal font-normal`} />
            </label>
            <label className="block tls-type-label text-white/65">Spiele
              <input value={form.games} onChange={(e) => set("games", e.target.value)} placeholder="F1 25, Rocket League" data-testid="membership-directory-games" className={`mt-1 ${inputClass} normal-case tracking-normal font-normal`} />
            </label>
            <label className="block tls-type-label text-white/65">Plattformen
              <input value={form.platforms} onChange={(e) => set("platforms", e.target.value)} placeholder="PC, PS5" data-testid="membership-directory-platforms" className={`mt-1 ${inputClass} normal-case tracking-normal font-normal`} />
            </label>
          </div>
          <label className="block tls-type-label text-white/65">Kurze Bio
            <textarea value={form.bio} onChange={(e) => set("bio", e.target.value)} rows={3} maxLength={2000} data-testid="membership-directory-bio" className={`mt-1 ${inputClass} normal-case tracking-normal font-normal`} />
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" disabled={busy} data-testid="membership-directory-save" className="px-4 py-2 bg-[#FFD700] text-black tls-type-label rounded-sm disabled:opacity-50">Eintrag speichern</button>
            <span className="tls-type-small text-white/45">{entry.editorial ? "Name, Foto und Funktion pflegt die Vereinsverwaltung an deinem Profil." : "Name und Foto kommen von deinem Konto (Profil bearbeiten)."}</span>
          </div>
        </form>
      )}
    </div>
  );
}

function LinkRequest({ onDone }) {
  const [ref, setRef] = useState("");
  const [busy, setBusy] = useState(false);
  const send = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await api.post("/membership/dolibarr/link-request", { member_ref: ref.trim() || null });
      toast.success("Anfrage gesendet – der Vorstand prüft sie.");
      onDone();
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mt-3 flex flex-col sm:flex-row gap-2">
      <input value={ref} onChange={(e) => setRef(e.target.value)} maxLength={40} placeholder="Mitgliedsnummer (falls bekannt)" data-testid="membership-link-ref"
        className="bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm sm:w-64" />
      <button type="button" onClick={send} disabled={busy} data-testid="membership-link-request"
        className="px-4 py-2 border border-[#FFD700]/50 text-[#FFD700] tls-type-label rounded-sm disabled:opacity-40">Zuordnung anfragen</button>
    </div>
  );
}

function Pill({ icon: Icon, label, variant }) {
  const cls = variant === "gold"
    ? "border-[#FFD700]/50 text-[#FFD700] bg-[#FFD700]/10"
    : "border-white/15 text-white/80";
  return (
    <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 tls-type-label border rounded-sm ${cls}`}>
      {Icon && <Icon className="w-3 h-3" />} {label}
    </span>
  );
}

function Stat({ icon: Icon, label, value }) {
  return (
    <div className="border border-white/10 rounded-sm bg-[#121212] p-4">
      <div className="flex items-center gap-2 tls-type-label text-white/50">
        <Icon className="w-3 h-3" /> {label}
      </div>
      <div className="mt-2 tls-type-num">{value}</div>
    </div>
  );
}
