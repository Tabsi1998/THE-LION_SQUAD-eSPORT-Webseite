import { Field, Input, Row, Section } from "./fields";

export function SocialsTab({ form, set }) {
  return (
    <>
                <Section>
                  <Row>
                    <Field label="Discord Name"><Input value={form.discord_name} onChange={(v) => set("discord_name", v)} testId="profile-discord" /></Field>
                    <Field label="Twitch"><Input value={form.twitch_handle} onChange={(v) => set("twitch_handle", v)} testId="profile-twitch" placeholder="tabsi98 oder https://www.twitch.tv/tabsi98" /></Field>
                  </Row>
                  {form.twitch_handle && (
                    <label aria-label="Twitch-Live-Embed im öffentlichen Profil zeigen" className="flex items-start gap-3 p-3 border border-[#9146FF]/30 bg-[#9146FF]/5 rounded-sm">
                      <input type="checkbox" checked={form.show_twitch_embed || false} onChange={(e) => set("show_twitch_embed", e.target.checked)} data-testid="profile-twitch-embed" className="accent-[#9146FF] mt-1" />
                      <div className="text-sm">
                        <div className="font-bold text-white">Twitch-Live-Embed im öffentlichen Profil zeigen</div>
                        <div className="text-white/60 text-xs mt-1">Wenn du live bist, erscheint dein Stream als eingebetteter Player auf deinem öffentlichen Profil.</div>
                      </div>
                    </label>
                  )}
                  <Row>
                    <Field label="YouTube"><Input value={form.youtube_handle} onChange={(v) => set("youtube_handle", v)} /></Field>
                    <Field label="Instagram"><Input value={form.instagram_handle} onChange={(v) => set("instagram_handle", v)} /></Field>
                  </Row>
                  <Row>
                    <Field label="TikTok"><Input value={form.tiktok_handle} onChange={(v) => set("tiktok_handle", v)} /></Field>
                    <Field label="X (Twitter)"><Input value={form.x_handle} onChange={(v) => set("x_handle", v)} /></Field>
                  </Row>
                  <Row>
                    <Field label="Steam ID"><Input value={form.steam_id} onChange={(v) => set("steam_id", v)} testId="profile-steam" /></Field>
                    <Field label="Epic"><Input value={form.epic_id} onChange={(v) => set("epic_id", v)} /></Field>
                  </Row>
                  <Row>
                    <Field label="PSN"><Input value={form.psn_id} onChange={(v) => set("psn_id", v)} /></Field>
                    <Field label="Xbox"><Input value={form.xbox_id} onChange={(v) => set("xbox_id", v)} /></Field>
                  </Row>
                  <Row>
                    <Field label="Nintendo Friend Code"><Input value={form.nintendo_fc} onChange={(v) => set("nintendo_fc", v)} placeholder="SW-XXXX-XXXX-XXXX" /></Field>
                    <Field label="EA ID"><Input value={form.ea_id} onChange={(v) => set("ea_id", v)} /></Field>
                  </Row>
                  <Row>
                    <Field label="Riot ID"><Input value={form.riot_id} onChange={(v) => set("riot_id", v)} /></Field>
                    <Field label="Battle.net"><Input value={form.battlenet_id} onChange={(v) => set("battlenet_id", v)} /></Field>
                  </Row>
                  <Field label="Website"><Input value={form.website} onChange={(v) => set("website", v)} placeholder="https://…" /></Field>
                </Section>
    </>
  );
}
