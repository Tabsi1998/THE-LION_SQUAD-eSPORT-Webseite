import { MessageSquare, ShieldCheck } from "lucide-react";
import { DIRECT_MESSAGE_PRIVACY } from "./constants";
import { Section } from "./fields";
import { AutosaveStatus, SwitchRow } from "./SwitchRow";
import { QUICK_VISIBILITY, VISIBILITY_LEVELS, fieldLevel, groupLevel, visibilityGroupsFor } from "./visibility";

// Privatsphäre in drei Karten (#257): öffentliches Profil, Direktnachrichten
// und die Sichtbarkeit der Felder in Gruppen mit Schnellwahl. Newsletter und
// Benachrichtigungen haben ihren eigenen Reiter. Alles hier speichert von
// selbst, deshalb gibt es keinen Speichern-Knopf mehr.
export function PrivacyTab({ form, set, setVisibility, setVisibilityGroup, autosave, disabled = [] }) {
  const visibility = form.profile_visibility || {};
  const groups = visibilityGroupsFor(disabled);
  const publicProfile = !!form.privacy_public_profile;
  return (
    <Section>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-white/60">Wer was von deinem Profil sieht.</p>
        <AutosaveStatus status={autosave.status} message={autosave.message} />
      </div>

      <SwitchRow
        label="Öffentliches Profil"
        description="Wenn aktiv, sind Avatar, Bio, Achievements, Stats und die freigegebenen Felder für andere sichtbar. Wenn aus, sieht niemand dein Profil."
        checked={publicProfile}
        onCheckedChange={(checked) => set("privacy_public_profile", checked)}
        testId="profile-privacy"
      />

      <div className="border border-white/10 rounded-sm p-5 bg-[#0A0A0A]">
        <div className="flex items-start gap-3 mb-4">
          <MessageSquare className="w-5 h-5 text-[#29B6E8] mt-1 shrink-0" />
          <div>
            <h3 className="font-heading font-black uppercase mb-1">Direktnachrichten</h3>
            <p className="text-xs text-white/50">Lege fest, wer dir private Nachrichten über die Webseite senden darf.</p>
          </div>
        </div>
        <select
          value={form.dm_privacy || "everyone"}
          onChange={(e) => set("dm_privacy", e.target.value)}
          aria-label="Wer darf mir schreiben"
          data-testid="profile-dm-privacy"
          className="w-full bg-[#121212] border border-white/10 px-3 py-2 rounded-sm text-sm"
        >
          {DIRECT_MESSAGE_PRIVACY.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </div>

      <div className="border border-white/10 rounded-sm p-5 bg-[#0A0A0A]">
        <div className="flex items-start gap-3 mb-4">
          <ShieldCheck className="w-5 h-5 text-[#29B6E8] mt-1 shrink-0" />
          <div>
            <h3 className="font-heading font-black uppercase mb-1">Sichtbarkeit der Felder</h3>
            <p className="text-xs text-white/50">Je Gruppe eine Schnellwahl für alle Felder; darunter lässt sich jedes Feld einzeln anders stellen.</p>
          </div>
        </div>
        {publicProfile ? null : (
          <p className="text-[11px] text-[#FFD700] mb-4" data-testid="profile-visibility-hint">
            Solange das Profil nicht öffentlich ist, sieht niemand diese Felder. Die Stufen gelten, sobald du es einschaltest.
          </p>
        )}
        <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-1 text-xs mb-5">
          {VISIBILITY_LEVELS.map((level) => (
            <div key={level.k} className="flex gap-2">
              <dt className="font-bold text-white/80 shrink-0">{level.l}:</dt>
              <dd className="text-white/50">{level.d}</dd>
            </div>
          ))}
        </dl>
        <div className="space-y-3">
          {groups.map((group) => {
            const current = groupLevel(visibility, group);
            return (
              <div key={group.k} className="border border-white/10 rounded-sm bg-[#121212] p-4" data-testid={`profile-vis-group-${group.k}`}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-bold text-white">{group.l}</div>
                    <div className="text-xs text-white/50 mt-0.5">{group.fields.map((field) => field.l).join(" · ")}</div>
                  </div>
                  <div role="group" aria-label={`Alle Felder in ${group.l} auf`} className="flex flex-wrap gap-1">
                    {QUICK_VISIBILITY.map((level) => {
                      const active = current === level.k;
                      return (
                        <button
                          key={level.k}
                          type="button"
                          aria-pressed={active}
                          title={level.d}
                          onClick={() => setVisibilityGroup(group, level.k)}
                          data-testid={`profile-vis-group-${group.k}-${level.k}`}
                          className={`min-h-9 px-3 rounded-sm border text-[11px] font-bold uppercase tracking-wider transition ${active ? "border-[#29B6E8]/55 bg-[#29B6E8]/10 text-[#29B6E8]" : "border-white/10 text-white/55 hover:text-white hover:border-white/25"}`}
                        >
                          {level.l}
                        </button>
                      );
                    })}
                  </div>
                </div>
                {current === "mixed" ? (
                  <p className="text-[11px] text-[#FFD700] mt-2" data-testid={`profile-vis-group-${group.k}-mixed`}>Gemischt: Die Felder dieser Gruppe haben unterschiedliche Stufen.</p>
                ) : null}
                {current === "admins" ? (
                  <p className="text-[11px] text-white/50 mt-2">Alle Felder dieser Gruppe stehen auf „Nur Admins“.</p>
                ) : null}
                <details className="mt-3">
                  <summary className="cursor-pointer select-none text-xs text-white/60 hover:text-white">Einzelne Felder ({group.fields.length})</summary>
                  <div className="mt-3 space-y-2">
                    {group.fields.map((field) => (
                      <div key={field.k} className="flex items-center justify-between gap-3">
                        <span className="text-sm text-white/80">{field.l}</span>
                        <select
                          value={fieldLevel(visibility, field.k)}
                          onChange={(e) => setVisibility(field.k, e.target.value)}
                          aria-label={`${field.l} sichtbar für`}
                          data-testid={`profile-vis-${field.k}`}
                          className="bg-[#0A0A0A] border border-white/10 px-2 py-1 rounded-sm text-xs"
                        >
                          {VISIBILITY_LEVELS.map((level) => <option key={level.k} value={level.k}>{level.l} – {level.d}</option>)}
                        </select>
                      </div>
                    ))}
                  </div>
                </details>
              </div>
            );
          })}
        </div>
      </div>
    </Section>
  );
}
