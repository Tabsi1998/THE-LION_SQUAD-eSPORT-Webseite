import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, formatApiError } from "@/lib/api";
import { AdminLayout } from "@/components/tls/AdminLayout";
import { AdminSheet } from "@/components/tls/AdminSheet";
import { FormGrid } from "@/components/tls/AdminForm";
import { CheckField, TextAreaField, TextField } from "@/components/tls/FormFields";
import { PersonPicker } from "@/components/tls/PersonPicker";
import { useConfirm } from "@/components/tls/ConfirmDialog";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { toast } from "sonner";
import { ChevronDown, Crown, Plus } from "lucide-react";
import { viennaDate, viennaDateTime } from "@/lib/vienna";
import { CLUB_ACCESS, boardSentence, clearSentence, postTitle } from "@/lib/boardRights";

// Vorstand (#1355): Posten als Liste mit „Besetzen“ bzw. „Ändern“. Besetzt wird über die Personensuche, nur mit
// Vereinsmitgliedern; vorher sagt ein Satz, welche Rechte der Posten bringt, und eine Rückfrage bestätigt es. Führt
// Dolibarr den Vorstand, ist die Liste nur zum Lesen; kommen die Rechte aus Dolibarr-Funktionen, ist ein Posten hier nur
// für die Anzeige. Löschen steht unter „Mehr“.

function errorText(error, fallback) {
  return formatApiError(error?.response?.data?.detail) || fallback;
}

function holderName(person) {
  return person?.display_name || person?.name || "";
}

export default function AdminBoardPage() {
  const [positions, setPositions] = useState([]);
  const [state, setState] = useState({ dolibarr_leads: false, rights_from_dolibarr: false });
  const [editing, setEditing] = useState(null);
  const [creating, setCreating] = useState(false);
  const [assigning, setAssigning] = useState(null); // { position, deputy }
  const [menuFor, setMenuFor] = useState(null);
  // Vorstand aus Dolibarr (#326 Teil 2): führt Dolibarr, ist die Liste hier nur der Rückfall - und nur zum Lesen.
  const [source, setSource] = useState(null);
  const [dolibarrBoard, setDolibarrBoard] = useState([]);
  const confirm = useConfirm();

  const load = useCallback(async () => {
    const [p, s, st] = await Promise.all([
      api.get("/board?manual=true"),
      api.get("/board/source").catch(() => ({ data: null })),
      api.get("/board/admin/state").catch(() => ({ data: null })),
    ]);
    setPositions(Array.isArray(p.data) ? p.data : []);
    setSource(s.data);
    setState(st.data || { dolibarr_leads: Boolean(s.data?.dolibarr), rights_from_dolibarr: false });
    if (s.data?.dolibarr) {
      try {
        const { data } = await api.get("/board?active_only=true");
        setDolibarrBoard(Array.isArray(data) ? data : []);
      } catch {
        setDolibarrBoard([]);
      }
    } else {
      setDolibarrBoard([]);
    }
  }, []);
  useEffect(() => { load().catch((error) => toast.error(errorText(error, "Der Vorstand lässt sich gerade nicht laden."))); }, [load]);
  useApiInvalidation(load, ["board", "membership"]);

  const readOnly = Boolean(state.dolibarr_leads);
  const rightsFromDolibarr = Boolean(state.rights_from_dolibarr);

  const patch = async (position, body, success) => {
    try {
      await api.patch(`/board/${position.id}`, body);
      toast.success(success);
      setMenuFor(null);
      await load();
      return true;
    } catch (error) {
      toast.error(errorText(error, "Das hat nicht geklappt."));
      return false;
    }
  };

  const toggle = (position) => patch(position, { is_active: !position.is_active }, position.is_active ? "Posten ist inaktiv." : "Posten ist aktiv.");

  const clearHolder = async (position, deputy) => {
    const holder = holderName(deputy ? position.deputy_user : position.user);
    if (!await confirm({
      title: deputy ? "Vertretung entfernen?" : "Posten leeren?",
      description: clearSentence({ holderName: holder, position, deputy, rightsFromDolibarr }),
      confirmLabel: "Entfernen",
    })) return;
    await patch(position, { [deputy ? "deputy_user_id" : "user_id"]: "" }, deputy ? "Vertretung entfernt." : "Posten ist offen.");
  };

  const remove = async (position) => {
    if (!await confirm({
      title: "Posten löschen?",
      description: `„${postTitle(position)}“ wird gelöscht. ${position.user ? `${holderName(position.user)} verliert damit diesen Posten.` : ""}`.trim(),
      confirmLabel: "Löschen",
    })) return;
    try {
      await api.delete(`/board/${position.id}`);
      toast.success("Posten gelöscht.");
      setMenuFor(null);
      await load();
    } catch (error) {
      toast.error(errorText(error, "Löschen hat nicht geklappt."));
    }
  };

  return (
    <AdminLayout>
      <div className="flex items-start justify-between gap-4 mb-6 flex-wrap">
        <div>
          <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#FFD700]">Verein</span>
          <h1 className="font-heading text-3xl md:text-4xl font-black uppercase mt-1">Vorstand</h1>
          <p className="mt-2 text-white/60 text-sm max-w-2xl" data-testid="board-rights-intro">
            {rightsFromDolibarr
              ? "Die Rechte kommen aus den Funktionen in Dolibarr – ein Posten hier ist nur für die Anzeige auf der Website."
              : `Wer einen aktiven Posten hält oder vertritt, bekommt die Vereinsverwaltung: ${CLUB_ACCESS}. Besetzt wird deshalb nur mit Vereinsmitgliedern und erst nach einer Rückfrage.`}
            {" "}Obmann oder Obfrau: der Titel richtet sich nach dem Geschlecht im Profil.
          </p>
          <p className="mt-2 text-white/50 text-xs max-w-xl" data-testid="board-photo-hint">
            Die Fotos kommen aus den <Link to="/admin/member-profiles" className="text-[#29B6E8] hover:text-white">Mitgliederprofilen</Link>. Am schönsten freigestellt (ohne Hintergrund) – der Verein legt seinen dahinter; Fotos mit Hintergrund stehen einheitlich in Vereinsfarben. Offene Funktionen zeigt die Vorstandsseite als „Wir suchen …“ mit dem Satz, den du hier je Funktion einträgst.
          </p>
        </div>
        {!readOnly && (
          <button onClick={() => setCreating(true)} data-testid="board-new-btn" className="px-5 py-2.5 bg-[#FFD700] text-black font-bold uppercase tracking-wider rounded-sm inline-flex items-center gap-2"><Plus className="w-4 h-4" /> Eigener Posten</button>
        )}
      </div>

      {source?.dolibarr && (
        <div className="mb-6 border border-[#29B6E8]/40 bg-[#29B6E8]/5 rounded-sm p-4 space-y-3" data-testid="board-dolibarr">
          <div className="font-heading font-bold uppercase text-[#29B6E8]">Der Vorstand kommt aus Dolibarr</div>
          <p className="text-sm text-white/70">
            Der Schalter „Vereinsdaten aus Dolibarr übernehmen“ ist an (<Link to="/admin/club" className="text-[#29B6E8] hover:text-white">Verein → Vereinsdaten</Link>).
            Die Vorstandsseite, „Über uns“ und die Ansprechpartner auf der Startseite zeigen die Funktionen und Inhaber aus dem Vereinsmodul
            (Stand {source.fetched_at ? viennaDateTime(source.fetched_at, { dateStyle: "short", timeStyle: "short" }) : "–"}, stündlich nachgelesen).
            Funktionen und Inhaber pflegst du in Dolibarr; ein Name erscheint nur, wenn die Person der Nennung zugestimmt hat. Die Liste unten ist nur zum Lesen.
          </p>
          {dolibarrBoard.length > 0 && (
            <ul className="text-sm divide-y divide-white/5" data-testid="board-dolibarr-rows">
              {dolibarrBoard.map((p) => (
                <li key={p.id} className="py-2 flex flex-wrap items-center gap-x-3 gap-y-1" data-testid={`board-dolibarr-${p.slug}`}>
                  <span className="font-bold">{p.display_title}</span>
                  <span className="text-white/70">{p.user ? p.user.display_name : p.name_withheld ? "Name nicht freigegeben" : "unbesetzt"}</span>
                  {p.represents && <span className="text-[10px] uppercase tracking-widest text-[#FFD700]">vertritt nach außen</span>}
                  {p.vacant ? <VacancyTextField slug={p.slug} value={p.vacancy_text || ""} onSaved={load} /> : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {source && source.switch_on && !source.has_board && (
        <div className="mb-6 border border-[#FFD700]/40 bg-[#FFD700]/5 rounded-sm p-4 text-sm text-white/70" data-testid="board-dolibarr-missing">
          „Vereinsdaten aus Dolibarr“ ist an, aber Dolibarr hat noch keinen Vorstand geliefert – bis dahin gilt die Liste unten. Nachlesen geht unter <Link to="/admin/club" className="text-[#29B6E8] hover:text-white">Verein → Vereinsdaten</Link>.
        </div>
      )}

      <ul className="space-y-2" data-testid="board-list">
        {positions.map((p) => (
          <li key={p.id} data-testid={`board-row-${p.slug}`} className={`border border-white/10 bg-[#121212] rounded-sm p-4 ${p.is_active ? "" : "opacity-60"}`}>
            <div className="flex flex-wrap items-start gap-4">
              <div className="flex items-start gap-3 min-w-[12rem] flex-1">
                <Crown className="w-4 h-4 text-[#FFD700] shrink-0 mt-1" />
                <div className="min-w-0">
                  <div className="font-semibold">{postTitle(p)}</div>
                  <div className="text-xs text-white/40">{p.is_active ? "aktiv" : "inaktiv"}{p.is_default ? " · Standard" : " · eigener Posten"}</div>
                </div>
              </div>
              <div className="min-w-[12rem] flex-1 text-sm">
                <div data-testid={`board-holder-${p.slug}`}>{p.user ? <><span className="font-semibold">{holderName(p.user)}</span>{p.user_since ? <span className="text-white/40 text-xs"> · seit {viennaDate(p.user_since)}</span> : null}</> : <span className="text-white/45">offen</span>}</div>
                {p.allow_deputy && <div className="text-xs text-white/50 mt-0.5" data-testid={`board-deputy-${p.slug}`}>Vertretung: {p.deputy_user ? holderName(p.deputy_user) : "keine"}</div>}
              </div>
              {!readOnly && (
                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" onClick={() => setAssigning({ position: p, deputy: false })} data-testid={`board-assign-${p.slug}`} className={`px-3 py-1.5 rounded-sm text-[11px] font-bold uppercase tracking-wider ${p.user ? "border border-white/15 text-white/80 hover:text-white" : "bg-[#FFD700] text-black"}`}>
                    {p.user ? "Ändern" : "Besetzen"}
                  </button>
                  {p.allow_deputy && (
                    <button type="button" onClick={() => setAssigning({ position: p, deputy: true })} data-testid={`board-assign-deputy-${p.slug}`} className="px-3 py-1.5 border border-white/15 text-white/70 hover:text-white rounded-sm text-[11px] font-bold uppercase tracking-wider">
                      Vertretung
                    </button>
                  )}
                  <button type="button" onClick={() => setMenuFor(menuFor === p.id ? null : p.id)} aria-expanded={menuFor === p.id} data-testid={`board-more-${p.slug}`} className="inline-flex items-center gap-1 px-3 py-1.5 border border-white/10 text-white/60 hover:text-white rounded-sm text-[11px] font-bold uppercase tracking-wider">
                    Mehr <ChevronDown className={`w-3 h-3 transition ${menuFor === p.id ? "rotate-180" : ""}`} />
                  </button>
                </div>
              )}
            </div>
            {!readOnly && menuFor === p.id && (
              <div className="mt-3 border-t border-white/10 pt-3 flex flex-wrap gap-x-4 gap-y-2 text-xs" data-testid={`board-menu-${p.slug}`}>
                <button type="button" onClick={() => { setEditing(p); setMenuFor(null); }} className="text-[#29B6E8] hover:underline">Bezeichnung bearbeiten</button>
                <button type="button" onClick={() => toggle(p)} data-testid={`board-toggle-${p.slug}`} className="text-white/70 hover:text-white">{p.is_active ? "Deaktivieren" : "Aktivieren"}</button>
                {p.user && <button type="button" onClick={() => clearHolder(p, false)} data-testid={`board-clear-${p.slug}`} className="text-white/70 hover:text-white">Posten leeren</button>}
                {p.deputy_user && <button type="button" onClick={() => clearHolder(p, true)} className="text-white/70 hover:text-white">Vertretung entfernen</button>}
                {!p.is_default && <button type="button" onClick={() => remove(p)} data-testid={`board-delete-${p.slug}`} className="text-[#FF6B6B] hover:underline">Löschen</button>}
              </div>
            )}
          </li>
        ))}
        {!positions.length && <li className="py-10 text-center text-white/40 text-sm">Noch keine Posten.</li>}
      </ul>

      {assigning && (
        <AssignSheet
          position={assigning.position}
          deputy={assigning.deputy}
          rightsFromDolibarr={rightsFromDolibarr}
          onClose={() => setAssigning(null)}
          onAssigned={async () => { setAssigning(null); await load(); }}
        />
      )}
      {(creating || editing) && (
        <BoardForm position={editing} onClose={() => { setEditing(null); setCreating(false); }} onSaved={load} />
      )}
    </AdminLayout>
  );
}

// „Wir suchen …“ (#1252): ein Satz zum Aufwand je offener Funktion - auch für Funktionen aus Dolibarr.
export function vacancyPayload(slug, vacancy, deputy, allowDeputy) {
  const texts = { [slug]: vacancy || "" };
  if (allowDeputy) texts[`${slug}-stv`] = deputy || "";
  return { texts };
}

function VacancyTextField({ slug, value, onSaved }) {
  const [text, setText] = useState(value);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setText(value); }, [value]);
  const save = async () => {
    setBusy(true);
    try {
      await api.put("/board/vacancy-texts", { texts: { [slug]: text } });
      toast.success("Satz für „Wir suchen …“ gespeichert");
      onSaved?.();
    } catch (err) { toast.error(formatApiError(err.response?.data?.detail) || "Fehler"); }
    setBusy(false);
  };
  return (
    <span className="basis-full flex flex-col sm:flex-row gap-2" data-testid={`board-vacancy-text-${slug}`}>
      <input value={text} onChange={(e) => setText(e.target.value)} maxLength={300} placeholder="Wir suchen …: ein Satz zum Aufwand, z. B. „Zwei Stunden im Monat, Einschulung inklusive.“" aria-label={`Satz für die offene Funktion ${slug}`}
        className="flex-1 bg-[#0A0A0A] border border-white/10 px-2 py-1.5 rounded-sm text-xs" />
      <button type="button" onClick={save} disabled={busy || text === value} className="px-3 py-1.5 border border-[#29B6E8]/50 text-[#29B6E8] rounded-sm text-[11px] font-bold uppercase tracking-wider disabled:opacity-40">Speichern</button>
    </span>
  );
}

// Besetzen im Seitenblatt: Personensuche (nur Vereinsmitglieder), der Satz zu den Rechten, dann die Rückfrage.
function AssignSheet({ position, deputy, rightsFromDolibarr, onClose, onAssigned }) {
  const [person, setPerson] = useState(null);
  const [saving, setSaving] = useState(false);
  const confirm = useConfirm();
  const current = deputy ? position.deputy_user : position.user;
  const title = deputy ? `Vertretung für ${postTitle(position)}` : postTitle(position);
  const sentence = person ? boardSentence({ person, position, deputy, rightsFromDolibarr }) : "";

  const submit = async (event) => {
    event.preventDefault();
    if (!person) {
      toast.error("Bitte ein Vereinsmitglied suchen und wählen.");
      return;
    }
    if (!await confirm({ title: `${title} besetzen?`, description: sentence, confirmLabel: "Besetzen", tone: rightsFromDolibarr || person.has_account === false ? "info" : "danger" })) return;
    setSaving(true);
    try {
      await api.patch(`/board/${position.id}`, { [deputy ? "deputy_user_id" : "user_id"]: person.id });
      toast.success(`${person.name} ist ${title}.`);
      await onAssigned();
    } catch (error) {
      toast.error(errorText(error, "Besetzen hat nicht geklappt."));
      setSaving(false);
    }
  };

  return (
    <AdminSheet title={`${title} besetzen`} eyebrow="Vorstand" accent="#FFD700" onClose={onClose} onSubmit={submit} saving={saving} submitLabel="Besetzen" savingLabel="Besetze …" submitTestId="board-assign-save" testId="board-assign-sheet">
      <p className="text-sm text-white/60">Jetzt: {current ? <span className="text-white font-semibold">{holderName(current)}</span> : "offen"}. Gesucht werden nur Vereinsmitglieder.</p>
      <PersonPicker purpose="board" value={person} onChange={setPerson} label="Vereinsmitglied" placeholder="Name tippen …" testId="board-person" emptyText="Kein Vereinsmitglied mit diesem Namen." />
      {sentence && (
        <div className={`border rounded-sm p-3 text-sm ${rightsFromDolibarr || person?.has_account === false ? "border-white/15 bg-white/5 text-white/70" : "border-[#FFD700]/40 bg-[#FFD700]/5 text-white/80"}`} data-testid="board-assign-sentence">
          {sentence}
        </div>
      )}
    </AdminSheet>
  );
}

function BoardForm({ position, onClose, onSaved }) {
  const isNew = !position;
  const [form, setForm] = useState({
    title_male: position?.title_male || "",
    title_female: position?.title_female || "",
    description: position?.description || "",
    allow_deputy: position?.allow_deputy ?? true,
    order_index: position?.order_index ?? 99,
    is_active: position?.is_active ?? true,
    slug: position?.slug || "",
  });
  const [vacancy, setVacancy] = useState(position?.vacancy_text || "");
  const [deputyVacancy, setDeputyVacancy] = useState(position?.deputy_vacancy_text || "");
  const [saving, setSaving] = useState(false);

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const { data } = isNew ? await api.post("/board", form) : await api.patch(`/board/${position.id}`, form);
      const slug = data?.slug || position?.slug;
      if (slug) await api.put("/board/vacancy-texts", vacancyPayload(slug, vacancy, deputyVacancy, form.allow_deputy));
      toast.success("Gespeichert");
      onSaved();
      onClose();
    } catch (err) { toast.error(errorText(err, "Speichern hat nicht geklappt.")); }
    setSaving(false);
  };

  // Seitenblatt statt Fenster (#435).
  return (
    <AdminSheet title={isNew ? "Neuer Posten" : "Posten bearbeiten"} eyebrow="Vorstand" accent="#FFD700" onClose={onClose} onSubmit={save} saving={saving} submitTestId="board-save" testId="board-sheet">
      <TextField label="Bezeichnung (männlich)" value={form.title_male} onChange={(v) => setForm({ ...form, title_male: v })} testId="board-title-m" required />
      <TextField label="Bezeichnung (weiblich, optional)" value={form.title_female || ""} onChange={(v) => setForm({ ...form, title_female: v })} testId="board-title-f" />
      <TextAreaField label="Beschreibung (optional)" value={form.description || ""} onChange={(v) => setForm({ ...form, description: v })} testId="board-desc" />
      <TextField label="Wenn offen: ein Satz zum Aufwand (für „Wir suchen …“)" value={vacancy} onChange={setVacancy} maxLength={300} testId="board-vacancy" placeholder="Zwei Stunden im Monat, Einschulung inklusive." />
      {form.allow_deputy && <TextField label="Stellvertretung offen: ein Satz zum Aufwand" value={deputyVacancy} onChange={setDeputyVacancy} maxLength={300} testId="board-deputy-vacancy" />}
      <FormGrid>
        <CheckField label="Vertretung erlaubt" checked={form.allow_deputy} onChange={(v) => setForm({ ...form, allow_deputy: v })} testId="board-allow-deputy" accent="#FFD700" />
        <CheckField label="Aktiv" checked={form.is_active} onChange={(v) => setForm({ ...form, is_active: v })} testId="board-active" accent="#FFD700" />
      </FormGrid>
    </AdminSheet>
  );
}
