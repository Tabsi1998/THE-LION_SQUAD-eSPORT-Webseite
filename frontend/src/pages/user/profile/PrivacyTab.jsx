import { Bell, MessageSquare } from "lucide-react";
import { DIRECT_MESSAGE_PRIVACY, EMAIL_PREFERENCES, NOTIFICATION_CHANNELS, VISIBILITY, notificationPreferenceKey } from "./constants";
import { Section } from "./fields";

export function PrivacyTab({ form, set, setVisibility, setNotificationPreference, notificationEnabled, notificationTopicEnabled }) {
  return (
    <>
                <Section>
                  <label aria-label="Öffentliches Profil" className="flex items-start gap-3 p-4 border border-white/10 rounded-sm bg-[#0A0A0A]">
                    <input type="checkbox" checked={form.privacy_public_profile} onChange={(e) => set("privacy_public_profile", e.target.checked)} data-testid="profile-privacy" className="accent-[#29B6E8] mt-1" />
                    <div>
                      <div className="font-bold text-white">Öffentliches Profil</div>
                      <div className="text-sm text-white/60 mt-1">Wenn aktiv, sind Avatar, Bio, Achievements, Stats und öffentliche Socials für jeden sichtbar.</div>
                    </div>
                  </label>

                  <label aria-label="Newsletter" className="flex items-start gap-3 p-4 border border-white/10 rounded-sm bg-[#0A0A0A]">
                    <input type="checkbox" checked={form.newsletter_consent} onChange={(e) => set("newsletter_consent", e.target.checked)} className="accent-[#29B6E8] mt-1" />
                    <div>
                      <div className="font-bold text-white">Newsletter</div>
                      <div className="text-sm text-white/60 mt-1">Ich willige separat ein, Newsletter, Event-Hinweise und Vereinsnews per E-Mail zu erhalten. Jederzeit widerrufbar.</div>
                    </div>
                  </label>

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
                      data-testid="profile-dm-privacy"
                      className="w-full bg-[#121212] border border-white/10 px-3 py-2 rounded-sm text-sm"
                    >
                      {DIRECT_MESSAGE_PRIVACY.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </select>
                  </div>

                  <div className="border border-white/10 rounded-sm p-5 bg-[#0A0A0A]">
                    <div className="flex items-start gap-3 mb-4">
                      <Bell className="w-5 h-5 text-[#29B6E8] mt-1 shrink-0" />
                      <div>
                        <h3 className="font-heading font-black uppercase mb-1">Benachrichtigungen</h3>
                        <p className="text-xs text-white/50">Steuere getrennt, ob Hinweise per E-Mail, Push oder In-App ankommen. Account- und Sicherheitsmails bleiben immer aktiv.</p>
                      </div>
                    </div>
                    <div className="text-[11px] uppercase tracking-widest font-bold text-white/45 mb-2">Kanäle</div>
                    <div className="grid sm:grid-cols-3 gap-3 mb-5">
                      {NOTIFICATION_CHANNELS.map((pref) => {
                        const checked = notificationEnabled(pref.k);
                        return (
                          <label key={pref.k} aria-label={pref.l} className={`flex items-start gap-3 border rounded-sm p-3 ${checked ? "border-[#29B6E8]/45 bg-[#29B6E8]/5" : "border-white/10 bg-[#121212]"}`}>
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(e) => setNotificationPreference(pref.k, e.target.checked)}
                              data-testid={`profile-notification-channel-${pref.k}`}
                              className="accent-[#29B6E8] mt-1"
                            />
                            <div className="min-w-0">
                              <div className="flex items-center gap-2 font-bold text-white text-sm">
                                <Bell className="w-3.5 h-3.5 text-[#29B6E8]" /> {pref.l}
                              </div>
                              <div className="text-xs text-white/50 mt-1">{pref.d}</div>
                            </div>
                          </label>
                        );
                      })}
                    </div>
                    <div className="text-[11px] uppercase tracking-widest font-bold text-white/45 mb-2">Jede Benachrichtigung pro Kanal</div>
                    <div className="overflow-x-auto border border-white/10 rounded-sm">
                      <table className="w-full min-w-[720px] text-sm">
                        <thead className="bg-[#121212] text-[10px] uppercase tracking-widest text-white/45">
                          <tr>
                            <th className="text-left px-3 py-3">Benachrichtigung</th>
                            {NOTIFICATION_CHANNELS.map((channel) => (
                              <th key={channel.k} className="text-center px-3 py-3">{channel.l}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-white/10">
                          {EMAIL_PREFERENCES.map((topic) => (
                            <tr key={topic.k} className="bg-[#0A0A0A]">
                              <td className="px-3 py-3 align-top">
                                <div className="font-bold text-white">{topic.l}</div>
                                <div className="text-xs text-white/50 mt-1">{topic.d}</div>
                                {topic.requiresNewsletter && !form.newsletter_consent ? (
                                  <div className="text-[11px] text-[#FFD700] mt-1">E-Mail benötigt Newsletter-Zustimmung.</div>
                                ) : null}
                              </td>
                              {NOTIFICATION_CHANNELS.map((channel) => {
                                const key = notificationPreferenceKey(channel.k, topic.k);
                                const channelEnabled = notificationEnabled(channel.k);
                                const disabled = !channelEnabled || (channel.k === "email" && topic.requiresNewsletter && !form.newsletter_consent);
                                const checked = channelEnabled && notificationTopicEnabled(channel.k, topic);
                                return (
                                  <td key={key} className="px-3 py-3 text-center align-top">
                                    <label className={`inline-flex items-center justify-center gap-2 px-2 py-1.5 border rounded-sm ${checked ? "border-[#29B6E8]/45 bg-[#29B6E8]/10" : "border-white/10 bg-[#121212]"} ${disabled ? "opacity-45" : ""}`}>
                                      <input
                                        type="checkbox"
                                        checked={checked}
                                        disabled={disabled}
                                        onChange={(e) => setNotificationPreference(key, e.target.checked)}
                                        data-testid={`profile-notification-${channel.k}-${topic.k}`}
                                        className="accent-[#29B6E8]"
                                      />
                                      <span className="text-[11px] font-bold uppercase tracking-wider">{checked ? "An" : "Aus"}</span>
                                    </label>
                                  </td>
                                );
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div className="border border-white/10 rounded-sm p-5 bg-[#0A0A0A]">
                    <h3 className="font-heading font-black uppercase mb-1">Sichtbarkeit einzelner Felder</h3>
                    <p className="text-xs text-white/50 mb-4">Wähle, wer welches Feld sehen darf. Standard: öffentlich.</p>
                    <div className="space-y-2">
                      {[
                        { k: "discord", l: "Discord" },
                        { k: "email", l: "E-Mail" },
                        { k: "city", l: "Wohnort" },
                        { k: "country", l: "Land" },
                        { k: "birth_date", l: "Geburtsdatum" },
                        { k: "twitch", l: "Twitch" },
                        { k: "steam", l: "Steam" },
                        { k: "psn", l: "PSN" },
                        { k: "xbox", l: "Xbox" },
                        { k: "youtube", l: "YouTube" },
                        { k: "instagram", l: "Instagram" },
                        { k: "x", l: "X / Twitter" },
                        { k: "epic", l: "Epic" },
                        { k: "nintendo", l: "Nintendo Friend Code" },
                        { k: "ea", l: "EA ID" },
                        { k: "riot", l: "Riot ID" },
                        { k: "battlenet", l: "Battle.net" },
                        { k: "main_platforms", l: "Plattformen" },
                        { k: "input_devices", l: "Eingabegeräte" },
                        { k: "favorite_games", l: "Lieblingsspiele" },
                      ].map((f) => (
                        <div key={f.k} className="flex items-center justify-between gap-3">
                          <span className="text-sm text-white/80">{f.l}</span>
                          <select
                            value={form.profile_visibility?.[f.k] || "public"}
                            onChange={(e) => setVisibility(f.k, e.target.value)}
                            data-testid={`profile-vis-${f.k}`}
                            className="bg-[#121212] border border-white/10 px-2 py-1 rounded-sm text-xs"
                          >
                            {VISIBILITY.map((v) => <option key={v.k} value={v.k}>{v.l}</option>)}
                          </select>
                        </div>
                      ))}
                    </div>
                  </div>
                </Section>
    </>
  );
}
