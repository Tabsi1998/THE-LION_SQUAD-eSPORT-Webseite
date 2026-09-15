import { MultiSelect } from "@/components/tls/MultiSelect";
import { INPUT_DEVICES, PLATFORMS, SUBSCRIPTIONS } from "./constants";
import { Field, Input, Row, Section } from "./fields";

export function GamingTab({ form, set, setGameId, gameIdGroups }) {
  return (
    <>
                <Section>
                  <Field label="Lieblingsspiele (Komma-getrennt)">
                    <Input value={form.favorite_games} onChange={(v) => set("favorite_games", v)} placeholder="Mario Kart, F1, Rocket League" testId="profile-fav-games" />
                  </Field>
                  <Field label="Plattformen (mehrere möglich)">
                    <MultiSelect options={PLATFORMS} value={form.main_platforms} onChange={(v) => set("main_platforms", v)} testId="profile-platforms" />
                  </Field>
                  <Field label="Eingabegeräte (mehrere möglich)">
                    <MultiSelect options={INPUT_DEVICES} value={form.input_devices} onChange={(v) => set("input_devices", v)} testId="profile-input-devices" />
                  </Field>
                  <Field label="Gaming-Abos (Game Pass, PS Plus, EA Play, …)">
                    <MultiSelect options={SUBSCRIPTIONS} value={form.gaming_subscriptions} onChange={(v) => set("gaming_subscriptions", v)} testId="profile-subs" />
                  </Field>
                  <Field label="Bevorzugte Rolle"><Input value={form.preferred_role} onChange={(v) => set("preferred_role", v)} placeholder="z.B. IGL, Support, Driver" /></Field>
                  {gameIdGroups.length > 0 && (
                    <div className="border border-white/10 rounded-sm bg-[#0A0A0A] p-5 space-y-4">
                      <div>
                        <h3 className="font-heading font-black uppercase">Spiel-IDs</h3>
                        <p className="text-xs text-white/50 mt-1">IDs können für Hauptspiele gelten und automatisch bei passenden Spielversionen verwendet werden, z.B. Activision ID für Call of Duty und BO6/BO7.</p>
                      </div>
                      {gameIdGroups.map((group) => (
                        <div key={group.slug} className="border-t border-white/10 pt-4 first:border-t-0 first:pt-0">
                          <div className="text-[11px] uppercase tracking-widest font-bold text-[#29B6E8] mb-1">{group.title}</div>
                          {group.games.length > 1 && <div className="text-[10px] text-white/40 mb-3">Gilt für: {group.games.join(", ")}</div>}
                          <Row>
                            {group.fields.map((field) => (
                              <Field key={field.key} label={`${field.label}${field.required !== false ? " *" : ""}`}>
                                <Input value={form.game_ids?.[group.slug]?.[field.key] || ""} onChange={(v) => setGameId(group.slug, field.key, v)} placeholder={field.help_text || field.label} />
                              </Field>
                            ))}
                          </Row>
                        </div>
                      ))}
                    </div>
                  )}
                </Section>
    </>
  );
}
