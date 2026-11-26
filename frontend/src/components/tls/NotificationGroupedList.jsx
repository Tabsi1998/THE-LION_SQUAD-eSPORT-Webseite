import { useMemo, useRef, useState } from "react";
import {
  Award, BadgeCheck, Gift, HeartHandshake, House, Inbox, MessageCircle, Newspaper, Receipt, ShieldCheck, Swords, Trophy,
} from "lucide-react";
import { NotificationRow } from "@/components/tls/NotificationRow";
import { TOPIC_LABELS, groupNotifications, topicCounts } from "@/lib/notificationGroups";
import "./notificationList.css";

// Glocke und Postfach aufgeräumt (#1205, #1662): Abschnitte Heute, Gestern, Früher; Themen zum Antippen; Gleichartiges
// eines Tages in einer Zeile. Jedes Thema hat ein Symbol statt eines Kennworts, dringende Meldungen sind rot markiert.
// Neue Meldungen, die bei offener Liste ankommen, gleiten sanft hinein - die Liste selbst erscheint ohne Bewegung.
const TOPIC_ICONS = {
  match_reminders: Swords,
  tournament_updates: Trophy,
  prize_updates: Gift,
  achievements: Award,
  billing_updates: Receipt,
  membership_updates: BadgeCheck,
  community_messages: MessageCircle,
  news_events: Newspaper,
  club_internal: House,
  helper_shifts: HeartHandshake,
  account: ShieldCheck,
};
const IMPORTANCE_TONE = { urgent: "text-[#FF3B30]", important: "text-[#29B6E8]", normal: "text-white/45" };
const FRESH_MS = 700;

export function TopicIcon({ bundle, compact = false }) {
  const Icon = TOPIC_ICONS[bundle.topic] || ShieldCheck;
  const label = TOPIC_LABELS[bundle.topic] || TOPIC_LABELS.account;
  return (
    <span className={`shrink-0 mt-0.5 ${IMPORTANCE_TONE[bundle.importance] || IMPORTANCE_TONE.normal}`} title={label} data-topic={bundle.topic}>
      <Icon className={compact ? "w-3.5 h-3.5" : "w-4 h-4"} aria-hidden="true" />
      <span className="sr-only">{bundle.importance === "urgent" ? `Dringend, ${label}` : label}</span>
    </span>
  );
}

/** Merkt sich, wann eine Zeile zum ersten Mal da war - was bei offener Liste dazukommt, gilt kurz als „neu“. */
function useFreshness(ids) {
  const firstSeen = useRef(null);
  if (firstSeen.current === null) firstSeen.current = new Map(ids.map((id) => [id, 0]));
  const now = Date.now();
  for (const id of ids) if (!firstSeen.current.has(id)) firstSeen.current.set(id, now);
  return (id) => {
    const at = firstSeen.current.get(id);
    return Boolean(at) && now - at < FRESH_MS;
  };
}

export function NotificationGroupedList({
  rows, tab = "all", onOpen, onDelete, pendingIds, compact = false, testIdPrefix = "notification-row", emptyText, testId = "notification-groups",
}) {
  const [topic, setTopic] = useState("");
  const topics = useMemo(() => topicCounts(rows), [rows]);
  const activeTopic = topics.some((entry) => entry.key === topic) ? topic : "";
  const groups = useMemo(() => groupNotifications(rows, { tab, topic: activeTopic }), [rows, tab, activeTopic]);
  const isFresh = useFreshness(groups.flatMap((group) => group.bundles.map((bundle) => bundle.id)));
  const pad = compact ? "px-3" : "px-4";

  return (
    <div data-testid={testId}>
      {topics.length > 1 ? (
        <div className={`tls-swipe tls-note-topics ${pad} py-2 border-b border-white/5`} role="group" aria-label="Nach Thema filtern" data-testid={`${testId}-topics`}>
          {[{ key: "", label: "Alle", count: rows.length }, ...topics].map((entry) => (
            <button
              key={entry.key || "all"}
              type="button"
              aria-pressed={activeTopic === entry.key}
              onClick={() => setTopic(entry.key)}
              className="tls-note-chip"
              data-active={activeTopic === entry.key ? "true" : "false"}
              data-testid={`${testId}-topic-${entry.key || "all"}`}
            >
              {entry.key ? <TopicIcon bundle={{ topic: entry.key, importance: "normal" }} compact /> : null}
              <span>{entry.label}</span>
              <span className="tls-note-chip__count">{entry.count}</span>
            </button>
          ))}
        </div>
      ) : null}
      {groups.length === 0 ? (
        <div className="px-4 py-10 text-center text-white/40" data-testid={`${testId}-empty`}>
          <Inbox className="w-8 h-8 mx-auto mb-2 opacity-50" aria-hidden="true" />
          <div className="text-sm">{activeTopic ? `Nichts zu „${TOPIC_LABELS[activeTopic]}“.` : emptyText || "Keine Benachrichtigungen."}</div>
        </div>
      ) : (
        groups.map((group) => (
          <section key={group.key} aria-label={group.label} data-testid={`${testId}-day-${group.key}`}>
            <h3 className={`tls-note-day ${pad}`}>{group.label}</h3>
            {group.bundles.map((bundle) => (
              <div key={bundle.id} className="tls-note-row" data-fresh={isFresh(bundle.id) ? "true" : undefined}>
                <NotificationRow
                  bundle={bundle}
                  onOpen={onOpen}
                  onDelete={onDelete}
                  compact={compact}
                  testIdPrefix={testIdPrefix}
                  pending={bundle.ids.some((id) => pendingIds?.has?.(id))}
                  leading={<TopicIcon bundle={bundle} compact={compact} />}
                />
              </div>
            ))}
          </section>
        ))
      )}
    </div>
  );
}
