// Einstellungen (#223): Abschnitt „E-Mail-Versand über SMTP“ – nur Darstellung; Zustand und Handler bleiben in AdminSettingsPage.
import { formatApiError } from "@/lib/api";
import { SetupGuide } from "@/components/tls/SetupGuide";
import { toast } from "sonner";
import { Send, CheckCircle2, XCircle, AlertTriangle } from "lucide-react";

export function SmtpSection({ smtp, setSmtp, smtpTestEmail, setSmtpTestEmail, smtpDiag, smtpDeliverability, savingSmtp, saveSmtp, clearSmtpSecret, applySubmissionPreset, applyLocalIpPreset, sendSmtpTest, diagnoseSmtp, checkDeliverability }) {
  return (
    <div className="max-w-2xl space-y-4">
      <SetupGuide guideKey="smtp" />
      <div className="border border-white/10 bg-[#121212] rounded-sm p-5 space-y-3">
        <div className="flex items-center justify-between">
          <div className="font-heading font-bold uppercase">Eigener SMTP-Server</div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={smtp.enabled} onChange={(e) => setSmtp({ ...smtp, enabled: e.target.checked })} className="accent-[#29B6E8]" data-testid="smtp-enabled" />
            <span>Versand aktiv</span>
          </label>
        </div>
        <div className="border border-[#29B6E8]/25 bg-[#29B6E8]/5 rounded-sm p-4 text-xs text-white/65">
          <div className="font-bold uppercase tracking-widest text-[#29B6E8] mb-2">Einfacher Versand ohne Relay</div>
          <p>Wie beim OmniFM-Server: Host/IP, Port, User, Passwort, Absender. TLS steht auf Auto: 465 = SSL/TLS, 25 = ohne TLS, alles andere = STARTTLS. Die lokale IP als Host ist okay.</p>
          <div className="mt-3 flex flex-col sm:flex-row gap-2">
            <button type="button" onClick={applySubmissionPreset} data-testid="smtp-preset-submission" className="px-3 py-2 border border-[#29B6E8]/50 text-[#29B6E8] font-bold uppercase tracking-wider rounded-sm">
              Standard Auto Login
            </button>
            <button type="button" onClick={applyLocalIpPreset} data-testid="smtp-preset-local-ip" className="px-3 py-2 border border-[#FFD700]/50 text-[#FFD700] font-bold uppercase tracking-wider rounded-sm">
              Lokale IP vorbereiten
            </button>
          </div>
        </div>
        <div>
          <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">Provider</div>
          <select value={smtp.provider} onChange={(e) => setSmtp({ ...smtp, provider: e.target.value })} data-testid="smtp-provider" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm">
            <option value="smtp">SMTP (eigener Server)</option>
            <option value="resend">Resend (API)</option>
          </select>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="sm:col-span-2">
            <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">SMTP Host</div>
            <input value={smtp.smtp_host || ""} onChange={(e) => setSmtp({ ...smtp, smtp_host: e.target.value })} data-testid="smtp-host" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm font-mono" placeholder="mail.example.com" />
          </div>
          <div>
            <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">Port</div>
            <input type="number" value={smtp.smtp_port || 587} onChange={(e) => setSmtp({ ...smtp, smtp_port: parseInt(e.target.value, 10) })} data-testid="smtp-port" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm font-mono" />
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">SMTP Anmeldung</div>
            <select value={smtp.smtp_auth || "login"} onChange={(e) => setSmtp({ ...smtp, smtp_auth: e.target.value })} data-testid="smtp-auth" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm">
              <option value="login">Mit Benutzer/Passwort (empfohlen)</option>
              <option value="auto">Automatisch (Altbestand)</option>
              <option value="none">Ohne Anmeldung (lokaler Relay)</option>
            </select>
            <p className="mt-1 text-[11px] text-white/40">Für normalen Versand: Benutzer/Passwort auf Port 587.</p>
          </div>
          <div>
            <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">User</div>
            <input value={smtp.smtp_user || ""} onChange={(e) => setSmtp({ ...smtp, smtp_user: e.target.value })} data-testid="smtp-user" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm font-mono" />
          </div>
          <div>
            <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">Passwort {smtp.smtp_pass_masked && <span className="text-white/40 normal-case">(aktuell: {smtp.smtp_pass_masked})</span>}</div>
            <input type="password" value={smtp.smtp_pass || ""} onChange={(e) => setSmtp({ ...smtp, smtp_pass: e.target.value })} data-testid="smtp-pass" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm font-mono" placeholder="••••••" />
            {smtp.smtp_pass_masked && <button type="button" onClick={() => clearSmtpSecret().catch((e) => toast.error(formatApiError(e.response?.data?.detail)))} className="mt-2 text-[10px] uppercase font-bold text-[#FF6B6B]">Gespeichertes Passwort entfernen</button>}
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">Sicherheit</div>
            <select value={smtp.smtp_security || "auto"} onChange={(e) => setSmtp({ ...smtp, smtp_security: e.target.value })} data-testid="smtp-security" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm">
              <option value="auto">Auto nach Port</option>
              <option value="starttls">STARTTLS (587)</option>
              <option value="tls">SSL/TLS (465)</option>
              <option value="none">Keine (25)</option>
            </select>
          </div>
          <div>
            <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">TLS Zertifikat</div>
            <label className="h-[38px] flex items-center gap-2 bg-[#0A0A0A] border border-white/10 px-3 rounded-sm text-sm">
              <input type="checkbox" checked={smtp.smtp_tls_verify !== false} onChange={(e) => setSmtp({ ...smtp, smtp_tls_verify: e.target.checked })} data-testid="smtp-tls-verify" className="accent-[#29B6E8]" />
              <span>Prüfen</span>
            </label>
          </div>
          <div>
            <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">Absendername</div>
            <input value={smtp.sender_name || ""} onChange={(e) => setSmtp({ ...smtp, sender_name: e.target.value })} data-testid="smtp-sender-name" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm" placeholder="THE LION SQUAD" />
          </div>
          <div>
            <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">Absender E-Mail</div>
            <input type="email" value={smtp.sender_email || ""} onChange={(e) => setSmtp({ ...smtp, sender_email: e.target.value })} data-testid="smtp-sender-email" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm" placeholder="noreply@lionsquad.at" />
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">Technischer SMTP-Absender</div>
            <input
              type="email"
              value={smtp.smtp_envelope_from || ""}
              onChange={(e) => setSmtp({ ...smtp, smtp_envelope_from: e.target.value })}
              data-testid="smtp-envelope-from"
              className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm font-mono"
              placeholder="office@lionsquad.at"
            />
            <p className="mt-1 text-[11px] text-white/40">MAIL FROM / Return-Path. Leer = SMTP User.</p>
          </div>
          <div>
            <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">Antworten an</div>
            <input
              type="email"
              value={smtp.reply_to_email || ""}
              onChange={(e) => setSmtp({ ...smtp, reply_to_email: e.target.value })}
              data-testid="smtp-reply-to"
              className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm font-mono"
              placeholder="office@lionsquad.at"
            />
            <p className="mt-1 text-[11px] text-white/40">Reply-To für Rückfragen.</p>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">Message-ID Domain</div>
            <input
              value={smtp.message_id_domain || ""}
              onChange={(e) => setSmtp({ ...smtp, message_id_domain: e.target.value })}
              data-testid="smtp-message-id-domain"
              className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm font-mono"
              placeholder="lionsquad.at"
            />
            <p className="mt-1 text-[11px] text-white/40">Optional. Leer = Domain der Absender-E-Mail. Das ist nicht der SMTP Host.</p>
          </div>
          <div>
            <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">HELO/EHLO Name</div>
            <input
              value={smtp.smtp_helo_name || ""}
              onChange={(e) => setSmtp({ ...smtp, smtp_helo_name: e.target.value })}
              data-testid="smtp-helo-name"
              className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm font-mono"
              placeholder="lionsquad.at"
            />
            <p className="mt-1 text-[11px] text-white/40">Optional. Leer lassen ist erlaubt; dann nutzt die SMTP-Bibliothek ihren Standardnamen.</p>
          </div>
          <div className="text-xs text-white/45 flex items-end pb-1">
            Hinweis: Diese Domain-Felder sind Mail-Identität, nicht Verbindung. Der SMTP Host darf weiterhin nur die IP sein.
          </div>
        </div>
        <div className="border border-[#FFD700]/25 bg-[#FFD700]/5 rounded-sm p-4 text-xs text-white/60">
          <div className="font-bold uppercase tracking-widest text-[#FFD700] mb-2">DNS Checkliste gegen Spam</div>
          <p>Gmail bewertet die öffentliche Ausgangs-IP deines Mailservers. Wichtig sind SPF, DKIM, DMARC, PTR/rDNS und die Mailserver-Logs. Der SMTP Host in dieser App darf trotzdem eine lokale IP sein.</p>
        </div>
        <button onClick={saveSmtp} disabled={savingSmtp} data-testid="smtp-save" className="px-5 py-2 bg-[#29B6E8] text-black font-bold uppercase tracking-wider rounded-sm disabled:opacity-50">{savingSmtp ? "Speichere..." : "Speichern"}</button>
      </div>

      <div className="border border-white/10 bg-[#121212] rounded-sm p-5 space-y-3">
        <div className="font-heading font-bold uppercase">SMTP Testmail</div>
        <div className="flex flex-col sm:flex-row gap-2">
          <input type="email" placeholder="test@example.com" value={smtpTestEmail} onChange={(e) => setSmtpTestEmail(e.target.value)} data-testid="smtp-test-to" className="flex-1 bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm" />
          <button onClick={diagnoseSmtp} data-testid="smtp-diagnose" className="px-4 py-2 border border-[#FFD700] text-[#FFD700] font-bold uppercase tracking-wider rounded-sm inline-flex items-center justify-center gap-2"><AlertTriangle className="w-3.5 h-3.5" /> Diagnose</button>
          <button onClick={checkDeliverability} data-testid="smtp-deliverability" className="px-4 py-2 border border-[#00FF88] text-[#00FF88] font-bold uppercase tracking-wider rounded-sm inline-flex items-center justify-center gap-2"><CheckCircle2 className="w-3.5 h-3.5" /> Zustellbarkeit</button>
          <button onClick={sendSmtpTest} data-testid="smtp-test-send" className="px-4 py-2 border border-[#29B6E8] text-[#29B6E8] font-bold uppercase tracking-wider rounded-sm inline-flex items-center justify-center gap-2"><Send className="w-3.5 h-3.5" /> Senden</button>
        </div>
        {smtpDiag && (
          <div data-testid="smtp-diagnose-result" className={`border rounded-sm p-4 text-xs space-y-3 ${smtpDiag.ok ? "border-[#00FF88]/25 bg-[#00FF88]/5" : "border-[#FF3B30]/25 bg-[#FF3B30]/5"}`}>
            <div className="flex items-center gap-2 font-bold uppercase tracking-widest">
              {smtpDiag.ok ? <CheckCircle2 className="w-4 h-4 text-[#00FF88]" /> : <XCircle className="w-4 h-4 text-[#FF3B30]" />}
              SMTP Diagnose: {smtpDiag.ok ? "OK" : "Problem gefunden"}
            </div>
            <div className="grid sm:grid-cols-2 gap-2 text-white/55">
              <div>Host: <span className="font-mono text-white/75">{smtpDiag.host || "-"}</span></div>
              <div>Port: <span className="font-mono text-white/75">{smtpDiag.port || "-"}</span></div>
              <div>Security: <span className="font-mono text-white/75">{smtpDiag.security || "-"}</span></div>
              <div>AUTH: <span className="font-mono text-white/75">{smtpDiag.auth_supported ? "angeboten" : "nicht angeboten"}</span></div>
            </div>
            <div className="space-y-1">
              {(smtpDiag.steps || []).map((s, i) => (
                <div key={i} className="flex gap-2 text-white/70">
                  <span className={s.ok ? "text-[#00FF88]" : "text-[#FF3B30]"}>{s.ok ? "OK" : "NO"}</span>
                  <span className="break-words">{s.label}</span>
                </div>
              ))}
            </div>
            {(smtpDiag.port_checks || []).length > 0 && (
              <div className="border-t border-white/10 pt-3">
                <div className="font-bold uppercase tracking-widest text-white/55 mb-2">Port-Check</div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {(smtpDiag.port_checks || []).map((c, i) => (
                    <div key={`${c.port}-${c.security}-${i}`} className="border border-white/10 bg-black/20 rounded-sm p-2 text-white/65">
                      <div className="font-mono text-white/80">{c.port} / {String(c.security || "").toUpperCase()}</div>
                      <div>Verbindung: {c.connect_ok ? "OK" : "NO"}</div>
                      <div>AUTH: {c.auth_supported ? "ja" : "nein"}</div>
                      {c.error && <div className="text-[#FF3B30] break-words">{c.error}</div>}
                    </div>
                  ))}
                </div>
              </div>
            )}
            {(smtpDiag.recommendations || []).length > 0 && (
              <div className="border-t border-white/10 pt-3 space-y-1 text-white/70">
                {(smtpDiag.recommendations || []).map((r, i) => <div key={i}>{r}</div>)}
              </div>
            )}
          </div>
        )}
        {smtpDeliverability && (
          <div data-testid="smtp-deliverability-result" className={`border rounded-sm p-4 text-xs space-y-3 ${smtpDeliverability.ok ? "border-[#00FF88]/25 bg-[#00FF88]/5" : "border-[#FFD700]/25 bg-[#FFD700]/5"}`}>
            <div className="flex items-center gap-2 font-bold uppercase tracking-widest">
              {smtpDeliverability.ok ? <CheckCircle2 className="w-4 h-4 text-[#00FF88]" /> : <AlertTriangle className="w-4 h-4 text-[#FFD700]" />}
              Gmail Zustellbarkeit: {smtpDeliverability.ok ? "Basis OK" : "Prüfen"}
            </div>
            <div className="grid sm:grid-cols-3 gap-2 text-white/55">
              <div>From: <span className="font-mono text-white/75">{smtpDeliverability.from_domain || "-"}</span></div>
              <div>Envelope: <span className="font-mono text-white/75">{smtpDeliverability.envelope_domain || "-"}</span></div>
              <div>Message-ID: <span className="font-mono text-white/75">{smtpDeliverability.message_id_domain || "-"}</span></div>
            </div>
            <div className="space-y-1">
              {(smtpDeliverability.checks || []).map((c, i) => (
                <div key={i} className="flex gap-2 text-white/70">
                  <span className={c.ok ? "text-[#00FF88]" : c.severity === "error" ? "text-[#FF3B30]" : "text-[#FFD700]"}>{c.ok ? "OK" : c.severity === "error" ? "NO" : "INFO"}</span>
                  <span className="break-words"><strong>{c.label}:</strong> {c.detail}</span>
                </div>
              ))}
            </div>
            {(smtpDeliverability.recommendations || []).length > 0 && (
              <div className="border-t border-white/10 pt-3 space-y-1 text-white/70">
                {(smtpDeliverability.recommendations || []).map((r, i) => <div key={i}>{r}</div>)}
              </div>
            )}
          </div>
        )}
        <p className="text-xs text-white/50">Testet die SMTP-Verbindung direkt. Auto-TLS verhält sich wie beim OmniFM-Bot: Port 465 SSL/TLS, Port 25 plain, sonst STARTTLS.</p>
        <p className="text-xs text-white/50">Bei self-signed Zertifikat kann "TLS Zertifikat prüfen" deaktiviert werden; besser ist ein vertrauenswürdiges Zertifikat am Mailserver.</p>
      </div>
    </div>
  );
}
