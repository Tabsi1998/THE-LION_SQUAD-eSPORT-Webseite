import { Clock, ShieldAlert } from "lucide-react";

// Wortfilter (#417): Web und App zeigen denselben Zustand. „Wird geprüft“ sieht nur der Absender -
// der Server liefert zurückgehaltene Nachrichten an niemanden sonst.
export const MODERATION_STATE_TEXT = {
  held: "Wird geprüft – nur du siehst diese Nachricht",
  rejected: "Von der Moderation zurückgewiesen – nur du siehst sie noch",
};

export function ModerationStateBadge({ moderation, className = "" }) {
  const state = moderation?.state;
  const text = MODERATION_STATE_TEXT[state];
  if (!text) return null;
  const Icon = state === "rejected" ? ShieldAlert : Clock;
  return (
    <div data-testid="moderation-state" data-state={state} className={`mt-1 inline-flex items-center gap-1 text-[10px] uppercase tracking-widest font-bold ${state === "rejected" ? "text-[#FF3B30]" : "text-[#FFD700]"} ${className}`}>
      <Icon className="w-3 h-3" /> {text}
    </div>
  );
}
