import { Ionicons } from "@expo/vector-icons";
import React, { useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { api, errorMessage } from "../lib/api";
import { friendPlaces, friendsSentence, type EventFriend, type EventFriendsData } from "../lib/eventRecap";
import { colors, radius } from "../theme";
import { Button } from "./Button";
import { Card } from "./Card";
import { MediaImage } from "./MediaImage";
import { Body, Heading, Muted } from "./Text";

// Freunde beim Event (#1188): wie im Web (FriendsAtEvent) - nur mit Konto, nur bestätigte Freunde, die es erlauben; was
// gezeigt wird, entscheidet allein der Server. Dazu einmal der Hinweis mit „Ausschalten“.

type Props = {
  eventKey: string;
  signedIn: boolean;
  over?: boolean;
  onOpenProfile?: (username: string) => void;
};

const SHOWN = 8;
const EVENT_VIOLET = "#9F7AEA";

function initials(name: string): string {
  return String(name || "?").trim().split(/\s+/).slice(0, 2).map((part) => part[0] || "").join("").toUpperCase() || "?";
}

function FriendRow({ friend, onOpenProfile }: { friend: EventFriend; onOpenProfile?: (username: string) => void }) {
  const content = (
    <>
      <MediaImage
        uri={friend.avatar_url}
        style={styles.avatar}
        fallback={<Body style={styles.initials}>{initials(friend.display_name)}</Body>}
      />
      <View style={styles.flex}>
        <Body style={styles.strong}>{friend.display_name}</Body>
        <Muted>{friendPlaces(friend).join(" · ")}</Muted>
      </View>
    </>
  );
  if (friend.username && onOpenProfile) {
    return (
      <Pressable onPress={() => onOpenProfile(friend.username as string)} accessibilityRole="link" style={styles.row} testID={`event-friend-${friend.id}`}>
        {content}
      </Pressable>
    );
  }
  return <View style={styles.row} testID={`event-friend-${friend.id}`}>{content}</View>;
}

export function FriendsAtEventCard({ eventKey, signedIn, over = false, onOpenProfile }: Props) {
  const [data, setData] = useState<EventFriendsData | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let alive = true;
    setData(null);
    if (!signedIn) return undefined;
    api.get<EventFriendsData>(`/events/${eventKey}/friends`)
      .then(({ data: body }) => { if (alive) setData(body && Array.isArray(body.friends) ? body : null); })
      .catch(() => { if (alive) setData(null); });
    return () => { alive = false; };
  }, [eventKey, signedIn]);

  if (!signedIn || !data || (!data.friends.length && !data.hint && !message)) return null;

  const answerHint = async (turnOff: boolean) => {
    setBusy(true);
    setMessage("");
    try {
      await api.post("/users/me/friends-hint", { turn_off: turnOff });
      setData((current) => (current ? { ...current, hint: false, sharing: turnOff ? false : current.sharing } : current));
      if (turnOff) setMessage("Ausgeschaltet. Einschalten kannst du es unter Einstellungen → Privatsphäre.");
    } catch (err) {
      setMessage(errorMessage(err, "Das hat nicht geklappt."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card style={styles.card} testID="event-friends">
      {data.hint ? (
        <View style={styles.hint} testID="event-friends-hint">
          <Body>Deine Freunde sehen, zu welchen Events du angemeldet bist.</Body>
          <View style={styles.buttons}>
            <Button label="Verstanden" variant="quiet" onPress={() => { void answerHint(false); }} disabled={busy} testID="event-friends-hint-ok" />
            <Button label="Ausschalten" variant="secondary" onPress={() => { void answerHint(true); }} disabled={busy} testID="event-friends-hint-off" />
          </View>
        </View>
      ) : null}
      {message ? <Muted testID="event-friends-message">{message}</Muted> : null}
      {data.friends.length ? (
        <>
          <View style={styles.titleRow}>
            <Ionicons name="people-outline" size={18} color={EVENT_VIOLET} />
            <Heading>{over ? "Deine Freunde waren dabei" : "Von deinen Freunden dabei"}</Heading>
          </View>
          <Muted testID="event-friends-sentence">{friendsSentence(data.friends, { over })}.</Muted>
          {data.friends.slice(0, SHOWN).map((friend) => <FriendRow key={friend.id} friend={friend} onOpenProfile={onOpenProfile} />)}
          {data.friends.length > SHOWN ? <Muted>und {data.friends.length - SHOWN} weitere</Muted> : null}
        </>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: 10 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  hint: { gap: 10, padding: 12, borderRadius: radius.sm, borderWidth: 1, borderColor: "rgba(159,122,234,0.45)", backgroundColor: "rgba(159,122,234,0.08)" },
  buttons: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 4 },
  avatar: { width: 36, height: 36, borderRadius: 18, overflow: "hidden", backgroundColor: "rgba(159,122,234,0.25)", alignItems: "center", justifyContent: "center" },
  initials: { fontSize: 12, fontWeight: "700", color: colors.white },
  strong: { fontWeight: "700", color: colors.white },
  flex: { flex: 1 },
});
