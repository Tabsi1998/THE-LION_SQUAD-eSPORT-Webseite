import { Ionicons } from "@expo/vector-icons";
import { NavigationContext, NavigationRouteContext } from "@react-navigation/native";
import React, { useContext, useEffect } from "react";
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { useAuth } from "../auth/AuthContext";
import { badgeText } from "../lib/chats";
import { isGuestUser } from "../live";
import { openDetail } from "../navigation/rootNavigation";
import { useOptionalNotifications } from "../notifications/NotificationContext";
import { colors } from "../theme";
import { Body, Title } from "./Text";

// Eine Kopfzeile für die fünf Tab-Übersichten (#1145): Titel links, rechts Lupe und Glocke mit Zahl - immer an derselben
// Stelle. Die Glocke schwebt nicht mehr über Bannern und Karten. Mit großer Schrift bricht der Titel um, Lupe und Glocke
// bleiben daneben erreichbar. Gäste haben keine Benachrichtigungen: bei ihnen steht nur die Lupe.

type Props = {
  title: string;
  /** Was rechts vor Lupe und Glocke steht (Profil: das Zahnrad zu den Einstellungen). */
  extra?: React.ReactNode;
  /** Unter der Titelzeile, etwa Saison-Figuren oder eine Unterzeile. */
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

/** Wer angemeldet ist - ohne Anmelde-Provider (Tests einzelner Screens) einfach niemand. */
function useSignedInUser() {
  try {
    return useAuth().user;
  } catch {
    return null;
  }
}

export function TabHeader({ title, extra, children, style, testID = "tab-header" }: Props) {
  const navigation = useContext(NavigationContext);
  const user = useSignedInUser();
  const signedIn = Boolean(user && !isGuestUser(user));
  const open = (screen: "Search" | "Notifications") => {
    if (navigation) navigation.navigate(screen as never);
    else openDetail(screen);
  };
  return (
    <View style={[styles.wrap, style]} testID={testID}>
      <View style={styles.row}>
        <Title style={styles.title} accessibilityRole="header" testID={`${testID}-title`}>{title}</Title>
        <View style={styles.actions}>
          {extra}
          <HeaderButton icon="search-outline" label="Suche" onPress={() => open("Search")} testID={`${testID}-search`} />
          {signedIn ? <BellButton onPress={() => open("Notifications")} testID={`${testID}-bell`} /> : null}
        </View>
      </View>
      {children}
    </View>
  );
}

export function HeaderButton({ icon, label, onPress, testID, tint = colors.white }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void; testID?: string; tint?: string }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={6}
      style={({ pressed }) => [styles.button, pressed && styles.pressed]}
      testID={testID}
    >
      <Ionicons name={icon} color={tint} size={20} />
    </Pressable>
  );
}

function BellButton({ onPress, testID, compact = false }: { onPress: () => void; testID?: string; compact?: boolean }) {
  const notifications = useOptionalNotifications();
  const unread = notifications?.unread ?? 0;
  return (
    <Pressable
      onPress={() => {
        void notifications?.load();
        onPress();
      }}
      accessibilityRole="button"
      accessibilityLabel={unread ? `${unread} ungelesene Benachrichtigungen` : "Benachrichtigungen"}
      accessibilityHint="Öffnet die Benachrichtigungen"
      hitSlop={6}
      style={({ pressed }) => [compact ? styles.compactButton : styles.button, pressed && styles.pressed]}
      testID={testID}
    >
      <Ionicons name="notifications-outline" color={unread ? colors.cyan : colors.white} size={compact ? 22 : 20} />
      {unread ? (
        <View style={styles.badge} testID={testID ? `${testID}-count` : undefined}>
          <Body style={styles.badgeText}>{badgeText(unread)}</Body>
        </View>
      ) : null}
    </Pressable>
  );
}

/** Die Glocke rechts in der Kopfzeile der Detail-Screens (#1145) - nur mit Konto. */
export function HeaderBell() {
  const navigation = useContext(NavigationContext);
  const user = useSignedInUser();
  if (!user || isGuestUser(user)) return null;
  return (
    <BellButton
      compact
      testID="header-bell"
      onPress={() => {
        if (navigation) navigation.navigate("Notifications" as never);
        else openDetail("Notifications");
      }}
    />
  );
}

/**
 * Tipp auf den aktiven Tab (#1144): liegt etwas über der Übersicht, geht der Stapel zurück (macht der Stapel selbst);
 * steht man schon auf der Übersicht, rollt die Liste ganz nach oben. Wie `useScrollToTop`, nur ohne Fehler außerhalb
 * einer Navigation (Tests einzelner Screens).
 */
export function useTabScrollToTop(ref: React.RefObject<{ scrollTo?: (options: { y: number; animated: boolean }) => void; scrollToOffset?: (options: { offset: number; animated: boolean }) => void } | null>) {
  const navigation = useContext(NavigationContext);
  const route = useContext(NavigationRouteContext);
  useEffect(() => {
    if (!navigation || !route) return undefined;
    const tabs = [];
    let current: typeof navigation | undefined = navigation;
    while (current) {
      if (current.getState()?.type === "tab") tabs.push(current);
      current = current.getParent();
    }
    const offs = tabs.map((tabNavigation) => tabNavigation.addListener("tabPress" as never, ((event: { defaultPrevented?: boolean }) => {
      const focused = navigation.isFocused();
      const first = navigation.getState()?.routes?.[0]?.key === route.key;
      requestAnimationFrame(() => {
        if (!focused || !first || event.defaultPrevented) return;
        const node = ref.current;
        if (node?.scrollToOffset) node.scrollToOffset({ offset: 0, animated: true });
        else node?.scrollTo?.({ y: 0, animated: true });
      });
    }) as never));
    return () => offs.forEach((off) => off());
  }, [navigation, ref, route]);
}

const styles = StyleSheet.create({
  wrap: {
    gap: 10,
    // Über den Karten darunter: Saison-Figuren am Kopf liegen sonst unter ihnen.
    zIndex: 2,
  },
  row: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: 12,
  },
  title: {
    flex: 1,
    flexShrink: 1,
    fontSize: 28,
    paddingTop: 2,
  },
  actions: {
    alignItems: "center",
    flexDirection: "row",
    flexShrink: 0,
    gap: 8,
  },
  button: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 20,
    borderWidth: 1,
    height: 40,
    justifyContent: "center",
    width: 40,
  },
  compactButton: {
    alignItems: "center",
    height: 40,
    justifyContent: "center",
    width: 40,
  },
  badge: {
    alignItems: "center",
    backgroundColor: colors.live,
    borderColor: colors.black,
    borderRadius: 9,
    borderWidth: 1,
    minWidth: 18,
    paddingHorizontal: 4,
    position: "absolute",
    right: -3,
    top: -4,
  },
  badgeText: {
    color: colors.white,
    fontSize: 10,
    fontWeight: "900",
    lineHeight: 15,
  },
  pressed: {
    opacity: 0.72,
  },
});
