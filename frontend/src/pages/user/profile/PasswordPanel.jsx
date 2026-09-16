import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { KeyRound } from "lucide-react";
import { toast } from "sonner";
import { api, formatRequestError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";

// Passwort ändern im Reiter Sicherheit (#258). Der Endpunkt gab es schon,
// eine Oberfläche dafür nicht. Das Backend meldet danach alle Geräte ab,
// deshalb führt der Weg direkt zur Anmeldung. Kein eigenes <form>, weil das
// Profil schon in einem Formular steckt.
export const MIN_PASSWORD_LENGTH = 10;

const inputClass = "w-full bg-[#0A0A0A] border border-white/10 focus:border-[#29B6E8] px-3 py-2 rounded-sm text-white";

export function PasswordPanel({ googleOnly = false }) {
  const auth = useAuth();
  const navigate = useNavigate();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [repeat, setRepeat] = useState("");
  const [busy, setBusy] = useState(false);

  const tooShort = next.length > 0 && next.length < MIN_PASSWORD_LENGTH;
  const mismatch = repeat.length > 0 && repeat !== next;
  const ready = !googleOnly && current.length > 0 && next.length >= MIN_PASSWORD_LENGTH && repeat === next && !busy;

  const submit = async () => {
    if (!ready) return;
    setBusy(true);
    try {
      await api.post("/auth/change-password", { current_password: current, new_password: next });
      setCurrent("");
      setNext("");
      setRepeat("");
      toast.success("Passwort geändert. Alle Geräte wurden abgemeldet, bitte melde dich neu an.");
      if (typeof auth?.logout === "function") {
        try {
          await auth.logout();
        } catch {
          // Die Sitzung ist serverseitig ohnehin beendet.
        }
      }
      navigate("/login");
    } catch (err) {
      toast.error(formatRequestError(err, "Passwort konnte nicht geändert werden."));
    } finally {
      setBusy(false);
    }
  };
  const onEnter = (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      submit();
    }
  };

  return (
    <div className="border border-white/10 rounded-sm p-5 bg-[#0A0A0A]" data-testid="profile-password-panel">
      <div className="flex items-start gap-3 mb-4">
        <KeyRound className="w-5 h-5 text-[#29B6E8] mt-1 shrink-0" />
        <div>
          <h3 className="font-heading font-black uppercase mb-1">Passwort ändern</h3>
          <p className="text-xs text-white/50">
            {googleOnly
              ? "Dein Konto meldet sich über Google an und hat kein Passwort. Ein Passwort setzt du über „Passwort vergessen“ auf der Anmeldeseite."
              : `Mindestens ${MIN_PASSWORD_LENGTH} Zeichen. Nach dem Wechsel werden alle Geräte abgemeldet, auch dieses.`}
          </p>
        </div>
      </div>
      {googleOnly ? null : (
        <div className="grid gap-4 sm:grid-cols-3">
          <label className="block">
            <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">Aktuelles Passwort</div>
            <input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} onKeyDown={onEnter} data-testid="profile-password-current" className={inputClass} />
          </label>
          <label className="block">
            <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">Neues Passwort</div>
            <input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} onKeyDown={onEnter} data-testid="profile-password-new" className={inputClass} />
            {tooShort ? <div className="text-[11px] text-[#FFD700] mt-1">Noch {MIN_PASSWORD_LENGTH - next.length} Zeichen.</div> : null}
          </label>
          <label className="block">
            <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">Neues Passwort wiederholen</div>
            <input type="password" autoComplete="new-password" value={repeat} onChange={(e) => setRepeat(e.target.value)} onKeyDown={onEnter} data-testid="profile-password-repeat" className={inputClass} />
            {mismatch ? <div className="text-[11px] text-[#FFD700] mt-1">Die Passwörter stimmen nicht überein.</div> : null}
          </label>
          <div className="sm:col-span-3">
            <button
              type="button"
              onClick={submit}
              disabled={!ready}
              data-testid="profile-password-submit"
              className="inline-flex items-center gap-2 px-6 py-3 bg-[#29B6E8] text-black font-bold uppercase tracking-wider rounded-sm hover:bg-[#1E95C2] disabled:opacity-50 transition text-xs"
            >
              {busy ? "Ändere…" : "Passwort ändern"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
