import { Bell } from "lucide-react";
import { EMAIL_PREFERENCES, NOTIFICATION_CHANNELS, notificationPreferenceKey } from "./constants";
import { Section } from "./fields";
import { AutosaveStatus, ProfileSwitch, SwitchRow } from "./SwitchRow";

// Eigener Reiter für Benachrichtigungen (#257): Kanäle, die Tabelle je Art
// und der Newsletter, der vorher unter „Privatsphäre“ stand. Schalter statt
// Kästchen; ein Kanal, der oben aus ist, graut seine Spalte aus. Am PC bleibt
// der Tabellenkopf beim Scrollen sichtbar; am Handy scrollt die Tabelle
// seitwärts, weil ein Scrollrahmen und ein klebender Kopf sich ausschließen.
export function NotificationsTab({ form, set, setNotificationPreference, notificationEnabled, notificationTopicEnabled, autosave }) {
  return (
    <Section>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-white/60">Steuere getrennt, ob Hinweise per E-Mail, Push oder In-App ankommen. Account- und Sicherheitsmails bleiben immer aktiv.</p>
        <AutosaveStatus status={autosave.status} message={autosave.message} />
      </div>

      <div>
        <div className="text-[11px] uppercase tracking-widest font-bold text-white/45 mb-2">Kanäle</div>
        <div className="grid sm:grid-cols-3 gap-3">
          {NOTIFICATION_CHANNELS.map((channel) => (
            <SwitchRow
              key={channel.k}
              label={channel.l}
              description={channel.d}
              checked={notificationEnabled(channel.k)}
              onCheckedChange={(checked) => setNotificationPreference(channel.k, checked)}
              testId={`profile-notification-channel-${channel.k}`}
            />
          ))}
        </div>
      </div>

      <div className="border border-white/10 rounded-sm p-5 bg-[#0A0A0A]">
        <div className="flex items-start gap-3 mb-4">
          <Bell className="w-5 h-5 text-[#29B6E8] mt-1 shrink-0" />
          <div>
            <h3 className="font-heading font-black uppercase mb-1">Jede Benachrichtigung pro Kanal</h3>
            <p className="text-xs text-white/50">Ein ausgeschalteter Kanal blendet seine Spalte aus; die Einstellungen darin bleiben erhalten.</p>
          </div>
        </div>
        <div className="overflow-x-auto md:overflow-visible -mx-5 px-5">
          <table className="w-full min-w-[560px] md:min-w-0 text-sm border-separate border-spacing-0">
            <thead className="md:sticky md:top-20 z-10 bg-[#121212] text-[10px] uppercase tracking-widest text-white/45">
              <tr>
                <th scope="col" className="text-left px-3 py-3 border-b border-white/10">Benachrichtigung</th>
                {NOTIFICATION_CHANNELS.map((channel) => {
                  const enabled = notificationEnabled(channel.k);
                  return (
                    <th key={channel.k} scope="col" className={`text-center px-3 py-3 border-b border-white/10 ${enabled ? "" : "opacity-40"}`} data-testid={`profile-notification-column-${channel.k}`}>
                      {channel.l}
                      {enabled ? null : <span className="block normal-case tracking-normal font-normal text-[10px]">Kanal aus</span>}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {EMAIL_PREFERENCES.map((topic) => (
                <tr key={topic.k}>
                  <td className="px-3 py-3 align-top border-b border-white/10">
                    <div className="font-bold text-white">{topic.l}</div>
                    <div className="text-xs text-white/50 mt-1">{topic.d}</div>
                    {topic.requiresNewsletter && !form.newsletter_consent ? (
                      <div className="text-[11px] text-[#FFD700] mt-1">Per E-Mail nur mit Newsletter-Zustimmung (unten).</div>
                    ) : null}
                  </td>
                  {NOTIFICATION_CHANNELS.map((channel) => {
                    const key = notificationPreferenceKey(channel.k, topic.k);
                    const channelEnabled = notificationEnabled(channel.k);
                    const disabled = !channelEnabled || (channel.k === "email" && topic.requiresNewsletter && !form.newsletter_consent);
                    const checked = channelEnabled && notificationTopicEnabled(channel.k, topic);
                    return (
                      <td key={key} className={`px-3 py-3 text-center align-top border-b border-white/10 ${channelEnabled ? "" : "opacity-40"}`}>
                        <ProfileSwitch
                          label={`${topic.l} per ${channel.l}`}
                          checked={checked}
                          disabled={disabled}
                          onCheckedChange={(value) => setNotificationPreference(key, value)}
                          testId={`profile-notification-${channel.k}-${topic.k}`}
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <SwitchRow
        label="Newsletter"
        description="Ich willige separat ein, Newsletter, Event-Hinweise und Vereinsnews per E-Mail zu erhalten. Jederzeit widerrufbar."
        checked={!!form.newsletter_consent}
        onCheckedChange={(checked) => set("newsletter_consent", checked)}
        testId="profile-newsletter"
      />
    </Section>
  );
}
