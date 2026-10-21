import React from "react";
import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, View } from "react-native";
import { Button } from "./Button";
import { Body, Muted } from "./Text";
import { formatDateTime } from "../lib/format";
import { SIGNUP_STATE, seatsLine, signupAction, signupItems, stateLine, type SignupItem } from "../lib/newsCards";
import { colors, kindColors, radius, surfaces } from "../theme";
import type { NewsPost } from "../types";

// News führen direkt zur Anmeldung (#1912, App-Teil von #1266) - wie NewsSignupCard.jsx im Web: unter dem ersten
// Absatz je verknüpftem Turnier oder Event eine Karte mit Beginn, freien Plätzen und „Anmelden“; ist die Anmeldung zu,
// steht dort der Stand. „Anmelden“ öffnet das Turnier bzw. Event, dort kommt das Bestätigungs-Blatt (#1904).

type Props = { post: NewsPost; onOpen: (item: SignupItem) => void };

function SignupCard({ item, onOpen }: { item: SignupItem; onOpen: (item: SignupItem) => void }) {
  const { signup } = item;
  const accent = item.kind === "event" ? kindColors.event : kindColors.tournament;
  const open = signup.state === "open";
  const seats = seatsLine(signup);
  const state = stateLine(signup);
  const stateColor = (SIGNUP_STATE[signup.state] || SIGNUP_STATE.none).color;
  return (
    <View style={[styles.card, { borderLeftColor: accent }]} testID={`news-signup-${item.id}`}>
      <View style={styles.head}>
        <View style={[styles.icon, { backgroundColor: `${accent}1f` }]}>
          <Ionicons name={item.kind === "event" ? "calendar-outline" : "trophy-outline"} color={accent} size={16} />
        </View>
        <View style={styles.text}>
          <Body style={styles.title}>{item.title}</Body>
          {signup.start_date ? <Muted style={styles.meta}>{formatDateTime(signup.start_date)}</Muted> : null}
          {seats ? (
            <View style={styles.seats}>
              <Ionicons name="people-outline" color="rgba(255,255,255,0.4)" size={13} />
              <Muted style={styles.meta} testID={`news-signup-${item.id}-seats`}>{seats}</Muted>
            </View>
          ) : null}
          {state && !open ? <Muted style={[styles.state, { color: stateColor }]} testID={`news-signup-${item.id}-state`}>{state}</Muted> : null}
        </View>
      </View>
      <Button
        label={signupAction(item)}
        variant={open ? "primary" : "quiet"}
        onPress={() => onOpen(item)}
        testID={`news-signup-${item.id}-go`}
      />
    </View>
  );
}

export function NewsSignupCards({ post, onOpen }: Props) {
  const items = signupItems(post);
  if (!items.length) return null;
  return (
    <View style={styles.list} testID="news-signups">
      {items.map((item) => <SignupCard key={item.key} item={item} onOpen={onOpen} />)}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: 10, marginVertical: 6 },
  card: {
    backgroundColor: surfaces.s1,
    borderColor: colors.border,
    borderLeftWidth: 3,
    borderRadius: radius.sm,
    borderWidth: 1,
    gap: 12,
    padding: 14,
  },
  head: { alignItems: "flex-start", flexDirection: "row", gap: 12 },
  icon: { alignItems: "center", borderRadius: radius.sm, height: 34, justifyContent: "center", width: 34 },
  text: { flex: 1, gap: 3, minWidth: 0 },
  title: { fontSize: 17, fontWeight: "900", lineHeight: 21 },
  meta: { color: "rgba(255,255,255,0.65)", fontSize: 13 },
  seats: { alignItems: "center", flexDirection: "row", gap: 5 },
  state: { fontSize: 11, fontWeight: "800", letterSpacing: 0.8, marginTop: 2, textTransform: "uppercase" },
});
