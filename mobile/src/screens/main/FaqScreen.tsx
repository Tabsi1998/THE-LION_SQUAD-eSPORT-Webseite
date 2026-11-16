import { Ionicons } from "@expo/vector-icons";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Linking, Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { useReduceMotion } from "../../components/motion";
import { Screen } from "../../components/Screen";
import { Body, Heading, Muted, Title } from "../../components/Text";
import { WEBSITE_BASE_URL } from "../../config";
import {
  alleFragen, faqBereich, faqBereichsliste, haeufigeFragen, hilfePfad, hilfeSchritte, sichtbareRollen, sucheFaq,
  type FaqAnleitung, type FaqBereich, type FaqBereichInhalt, type FaqFrage, type FaqTreffer,
} from "../../faq";
import { useFaqZugang } from "../../faq/useFaqZugang";
import { navigateToUrl, targetFromUrl } from "../../navigation/rootNavigation";
import type { AppStackParamList } from "../../navigation/types";
import { colors, motion, radius, surfaces } from "../../theme";

// FAQ in der App (#2449, Aufbau wie /faq im Web #2448): oben die Suche über Fragen und Schritte, darunter „Häufige
// Fragen“ zum Aufklappen, dann alle Bereiche mit Rollen-Filter. Vorne der App-eigene Bereich „LionsAPP“. Mitglieder- und
// Leitungsfragen kommen erst nach der Prüfung am Server dazu (useFaqZugang); ein älterer Server ohne /api/faq zeigt nur
// die öffentlichen Fragen. Anleitungen mit Bildern öffnen die Website (/faq/<thema>#<schritt>) im Browser.
// Bewegung nur mit Reanimated auf transform und opacity: Pfeil dreht, Antwort blendet ein - mit „Bewegung reduzieren“
// steht alles sofort da.

const EASE = Easing.bezier(motion.ease[0], motion.ease[1], motion.ease[2], motion.ease[3]);

const ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  app: "phone-portrait-outline", user: "person-outline", bell: "notifications-outline", badge: "ribbon-outline",
  calendar: "calendar-outline", trophy: "trophy-outline", list: "list-outline", users: "people-outline", "map-pin": "location-outline",
  gift: "gift-outline", hand: "hand-left-outline", clipboard: "clipboard-outline", shield: "shield-checkmark-outline",
};

function mehrzahl(anzahl: number, eins: string, viele: string) {
  return `${anzahl} ${anzahl === 1 ? eins : viele}`;
}

function umschalten(set: Set<string>, id: string): Set<string> {
  const next = new Set(set);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

/**
 * Ein Link aus der FAQ: zeigt die App die Seite selbst (Einstellungen, Kalender, Meine Gewinne …), öffnet sich der
 * Screen; sonst die Website im Browser - Anleitungen mit Bildern gibt es nur dort.
 */
export function oeffneFaqLink(to: string) {
  if (!to.startsWith("/")) return;
  if (navigateToUrl(to)) return;
  Linking.openURL(`${WEBSITE_BASE_URL}${to}`).catch(() => {});
}

/** Pfeil und Inhalt einer aufklappbaren Zeile: Drehen und Einblenden auf dem UI-Thread, mit „Bewegung reduzieren“ sofort. */
function useAufklappen(offen: boolean) {
  const reduce = useReduceMotion();
  const dreh = useSharedValue(offen ? 1 : 0);
  const sicht = useSharedValue(offen ? 1 : 0);
  // Beim ersten Zeichnen stehen die Werte schon richtig - keine Bewegung ins Leere.
  const erster = useRef(true);
  useEffect(() => {
    if (erster.current) {
      erster.current = false;
      return;
    }
    const ziel = offen ? 1 : 0;
    if (reduce) {
      dreh.value = ziel;
      sicht.value = ziel;
      return;
    }
    dreh.value = withTiming(ziel, { duration: motion.fast + 50, easing: EASE });
    if (offen) {
      sicht.value = 0;
      sicht.value = withTiming(1, { duration: motion.mid, easing: EASE });
    } else {
      sicht.value = 0;
    }
  }, [dreh, offen, reduce, sicht]);
  const pfeil = useAnimatedStyle(() => ({ transform: [{ rotate: `${dreh.value * 180}deg` }] }));
  const inhalt = useAnimatedStyle(() => ({ opacity: sicht.value, transform: [{ translateY: (sicht.value - 1) * 4 }] }));
  // Mit „Bewegung reduzieren“ feste Lagen statt geteilter Werte: nichts, das erst noch ankommen müsste.
  if (reduce) return { pfeil: offen ? styles.gedreht : null, inhalt: null };
  return { pfeil, inhalt };
}

type AnkerRef = (node: View | null) => void;

function Aufklapp({ offen, onToggle, label, kopf, children, testID, kopfStyle, ankerRef }: {
  offen: boolean;
  onToggle: () => void;
  label: string;
  kopf: React.ReactNode;
  children: React.ReactNode;
  testID: string;
  kopfStyle?: object;
  ankerRef?: AnkerRef;
}) {
  const { pfeil, inhalt } = useAufklappen(offen);
  return (
    <View style={styles.aufklapp} testID={testID} ref={ankerRef}>
      <Pressable
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ expanded: offen }}
        style={({ pressed }) => [styles.kopf, kopfStyle, pressed && styles.pressed]}
        testID={`${testID}-knopf`}
      >
        {kopf}
        <Animated.View style={pfeil}>
          <Ionicons name="chevron-down" size={18} color={offen ? colors.cyan : colors.muted} />
        </Animated.View>
      </Pressable>
      {offen ? (
        <Animated.View style={[styles.inhalt, inhalt]} testID={`${testID}-inhalt`}>
          {children}
        </Animated.View>
      ) : null}
    </View>
  );
}

function FrageZeile({ frage, offen, onToggle, bereich, suffix = "", ankerRef }: {
  frage: FaqFrage;
  offen: boolean;
  onToggle: () => void;
  bereich?: string;
  suffix?: string;
  ankerRef?: AnkerRef;
}) {
  return (
    <Aufklapp
      ankerRef={ankerRef}
      offen={offen}
      onToggle={onToggle}
      label={frage.frage}
      testID={`faq-frage-${frage.id}${suffix}`}
      kopf={<Body style={styles.frage}>{frage.frage}</Body>}
    >
      <Body style={styles.antwort}>{frage.antwort}</Body>
      <View style={styles.antwortFuss}>
        {frage.link ? (
          <Pressable
            onPress={() => oeffneFaqLink(frage.link?.to || "")}
            accessibilityRole="link"
            style={({ pressed }) => [styles.linkKnopf, pressed && styles.pressed]}
            testID={`faq-frage-link-${frage.id}${suffix}`}
          >
            <Body style={styles.linkText}>{frage.link.label}</Body>
            {/* Pfeil nur, wenn die App den Screen selbst hat - sonst das Zeichen für „öffnet im Browser“. */}
            <Ionicons name={targetFromUrl(frage.link.to) ? "arrow-forward" : "open-outline"} size={16} color={colors.cyan} testID={`faq-frage-link-symbol-${frage.id}${suffix}`} />
          </Pressable>
        ) : null}
        {bereich ? <Muted style={styles.bereichMarke}>{bereich}</Muted> : null}
      </View>
    </Aufklapp>
  );
}

function SchrittTreffer({ treffer }: { treffer: Extract<FaqTreffer, { art: "schritt" }> }) {
  const bereich = faqBereich(treffer.bereich)?.titel;
  return (
    <Pressable
      onPress={() => oeffneFaqLink(treffer.to)}
      accessibilityRole="link"
      accessibilityLabel={`${treffer.titel}. Schritt ${treffer.reihe}, ${treffer.thema.titel}. Öffnet die Anleitung auf der Website.`}
      style={({ pressed }) => [styles.treffer, pressed && styles.pressed]}
      testID={`faq-treffer-schritt-${treffer.id}`}
    >
      <View style={styles.flex}>
        <View style={styles.trefferMeta}>
          {bereich ? <Muted style={styles.trefferBereich}>{bereich}</Muted> : null}
          <Muted style={styles.trefferArt}>{`Schritt ${treffer.reihe} · ${treffer.thema.titel}`}</Muted>
        </View>
        <Body style={styles.trefferTitel}>{treffer.titel}</Body>
        <Muted numberOfLines={2}>{treffer.text}</Muted>
      </View>
      <Ionicons name="open-outline" size={16} color={colors.cyan} />
    </Pressable>
  );
}

function AnleitungZeile({ bereichId, anleitung }: { bereichId: string; anleitung: FaqAnleitung }) {
  const { thema, abschnitt } = anleitung;
  const schritte = abschnitt ? abschnitt.schritte.length : hilfeSchritte(thema).length;
  const titel = abschnitt ? `${thema.titel}: ${abschnitt.titel}` : thema.titel;
  return (
    <Pressable
      onPress={() => oeffneFaqLink(hilfePfad(thema.slug, abschnitt?.id || ""))}
      accessibilityRole="link"
      accessibilityLabel={`Anleitung ${titel}, ${mehrzahl(schritte, "Schritt", "Schritte")}. Öffnet die Website.`}
      style={({ pressed }) => [styles.anleitung, pressed && styles.pressed]}
      testID={`faq-anleitung-${bereichId}-${thema.slug}${abschnitt ? `-${abschnitt.id}` : ""}`}
    >
      <View style={styles.flex}>
        <Muted style={styles.anleitungArt}>{thema.zielgruppe ? `Anleitung · ${thema.zielgruppe}` : "Anleitung"}</Muted>
        <Body style={styles.anleitungTitel}>{titel}</Body>
      </View>
      <Muted style={styles.anleitungZahl}>{mehrzahl(schritte, "Schritt", "Schritte")}</Muted>
      <Ionicons name="open-outline" size={16} color={colors.cyan} />
    </Pressable>
  );
}

function BereichZeile({ bereich, inhalt, offen, onToggle, offeneFragen, onFrage, ankerRef }: {
  bereich: FaqBereich;
  inhalt: FaqBereichInhalt;
  offen: boolean;
  onToggle: () => void;
  offeneFragen: Set<string>;
  onFrage: (id: string) => void;
  ankerRef?: AnkerRef;
}) {
  const icon = (
    <View style={[styles.bereichIcon, inhalt.leer && styles.bereichIconLeer]}>
      <Ionicons name={ICONS[bereich.icon] || "list-outline"} size={20} color={inhalt.leer ? colors.muted : colors.cyan} />
    </View>
  );
  const text = (
    <View style={styles.flex}>
      <Body style={[styles.bereichTitel, inhalt.leer && styles.leerText]}>{bereich.titel}</Body>
      <Muted>{bereich.kurz}</Muted>
    </View>
  );
  if (inhalt.leer) {
    return (
      <View ref={ankerRef} style={[styles.kopf, styles.bereichKopf]} testID={`faq-bereich-${bereich.id}`} accessible accessibilityLabel={`${bereich.titel}, kommt bald`}>
        {icon}
        {text}
        <Muted style={styles.bald} testID={`faq-bereich-bald-${bereich.id}`}>Kommt bald</Muted>
      </View>
    );
  }
  const zaehler = [
    inhalt.anleitungen.length ? mehrzahl(inhalt.anleitungen.length, "Anleitung", "Anleitungen") : "",
    inhalt.fragen.length ? mehrzahl(inhalt.fragen.length, "Frage", "Fragen") : "",
  ].filter(Boolean).join(" · ");
  return (
    <Aufklapp
      ankerRef={ankerRef}
      offen={offen}
      onToggle={onToggle}
      label={`${bereich.titel}, ${zaehler}`}
      testID={`faq-bereich-${bereich.id}`}
      kopfStyle={styles.bereichKopf}
      kopf={<>{icon}{text}</>}
    >
      <Muted style={styles.zaehler}>{zaehler}</Muted>
      {inhalt.anleitungen.map((anleitung) => (
        <AnleitungZeile key={`${anleitung.thema.slug}-${anleitung.abschnitt?.id || ""}`} bereichId={bereich.id} anleitung={anleitung} />
      ))}
      {inhalt.fragen.map((frage) => (
        <FrageZeile key={frage.id} frage={frage} suffix="-bereich" offen={offeneFragen.has(`${frage.id}-bereich`)} onToggle={() => onFrage(`${frage.id}-bereich`)} />
      ))}
    </Aufklapp>
  );
}

type Props = { route?: { key?: string; params?: AppStackParamList["Faq"] } };

export function FaqScreen({ route }: Props = {}) {
  const zugang = useFaqZugang();
  const reduce = useReduceMotion();
  const ziel = route?.params;
  const [query, setQuery] = useState(() => ziel?.q || "");
  const [rolleWahl, setRolleWahl] = useState("");
  const [offeneFragen, setOffeneFragen] = useState<Set<string>>(() => new Set());
  const [offeneBereiche, setOffeneBereiche] = useState<Set<string>>(() => new Set());
  const scrollRef = useRef<ScrollView>(null);
  const inhaltRef = useRef<View>(null);
  const anker = useRef(new Map<string, View>());
  const ankerFuer = useCallback((key: string): AnkerRef => (node) => {
    if (node) anker.current.set(key, node);
    else anker.current.delete(key);
  }, []);
  const [scrollZiel, setScrollZiel] = useState("");
  const erledigt = useRef("");

  const rollen = sichtbareRollen(zugang.darf);
  // Eine Rolle, die nicht (mehr) angeboten wird - etwa Turnierleitung nach dem Abmelden - zählt als „Alle“.
  const rolle = rollen.some((row) => row.id === rolleWahl) ? rolleWahl : "";
  const fragen = useMemo(() => alleFragen(zugang.fragen), [zugang.fragen]);
  const results = useMemo(() => sucheFaq(query, { fragen, darf: zugang.darf }), [query, fragen, zugang.darf]);
  const haeufig = useMemo(() => haeufigeFragen({ fragen, darf: zugang.darf }), [fragen, zugang.darf]);
  const bereiche = useMemo(() => faqBereichsliste({ fragen, rolle, darf: zugang.darf }), [fragen, rolle, zugang.darf]);
  const searching = query.trim().length > 1;
  const frageUmschalten = (id: string) => setOffeneFragen((set) => umschalten(set, id));

  // Ein Link auf eine Frage (/faq#frage-<id>) oder einen Bereich (#bereich-<id>) klappt auf und scrollt hin - einmal je
  // Aufruf (wie FaqPage im Web). Geschützte Fragen stehen erst nach der Antwort des Servers da; bis dahin wartet der Anker.
  // Läuft eine Suche (?q=), sind die Häufigen ausgeblendet - dann steht die Frage in ihrem Bereich.
  useEffect(() => {
    const frageId = ziel?.frage || "";
    const bereichId = ziel?.bereich || "";
    const q = ziel?.q || "";
    const schluessel = `${route?.key || ""}|${frageId}|${bereichId}|${q}`;
    if (erledigt.current === schluessel || (!frageId && !bereichId && !q)) return;
    if (frageId) {
      const frage = fragen.find((row) => row.id === frageId);
      if (!frage && !zugang.geladen) return;
      erledigt.current = schluessel;
      setQuery(q);
      if (!frage) return;
      const imBereich = !frage.haeufig || q.trim().length > 1;
      setRolleWahl("");
      if (imBereich) {
        setOffeneBereiche((set) => new Set(set).add(frage.bereich));
        setOffeneFragen((set) => new Set(set).add(`${frage.id}-bereich`));
        setScrollZiel(`bereich-${frage.bereich}`);
      } else {
        setOffeneFragen((set) => new Set(set).add(frage.id));
        setScrollZiel(`frage-${frage.id}`);
      }
      return;
    }
    erledigt.current = schluessel;
    setQuery(q);
    if (bereichId) {
      setRolleWahl("");
      setOffeneBereiche((set) => new Set(set).add(bereichId));
      setScrollZiel(`bereich-${bereichId}`);
    }
  }, [fragen, route?.key, ziel?.bereich, ziel?.frage, ziel?.q, zugang.geladen]);

  useEffect(() => {
    if (!scrollZiel) return undefined;
    // Nach dem Zeichnen messen: erst dann steht die aufgeklappte Zeile an ihrem Platz.
    const timer = setTimeout(() => {
      const knoten = anker.current.get(scrollZiel);
      const basis = inhaltRef.current;
      setScrollZiel("");
      if (!knoten || !basis || typeof knoten.measureLayout !== "function") return;
      knoten.measureLayout(basis, (_x, y) => scrollRef.current?.scrollTo({ y: Math.max(0, y - 12), animated: !reduce }), () => undefined);
    }, 0);
    return () => clearTimeout(timer);
  }, [reduce, scrollZiel]);

  return (
    <Screen padded={false}>
      <ScrollView ref={scrollRef} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" testID="faq-screen">
        <View ref={inhaltRef} style={styles.content}>
        <View style={styles.hero}>
          <Muted style={styles.eyebrow}>FAQ</Muted>
          <Title>So geht&apos;s</Title>
          <Muted>Kurze Antworten zu App und Website. Anleitungen mit Bildern öffnen sich auf der Website.</Muted>
        </View>

        <View style={styles.suche} accessibilityRole="search">
          <Ionicons name="search" size={18} color={colors.muted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Frage oder Stichwort, z. B. Check-in"
            placeholderTextColor={colors.muted}
            accessibilityLabel="FAQ durchsuchen"
            returnKeyType="search"
            autoCorrect={false}
            style={styles.sucheFeld}
            testID="faq-search"
          />
          {query ? (
            <Pressable onPress={() => setQuery("")} accessibilityRole="button" accessibilityLabel="Suche leeren" style={styles.leeren} testID="faq-search-clear">
              <Ionicons name="close" size={18} color={colors.muted} />
            </Pressable>
          ) : null}
        </View>
        {/* Vorgelesen wird nur die Zahl der Treffer. */}
        <Muted accessibilityLiveRegion="polite" style={searching ? styles.ansage : styles.versteckt} testID="faq-results-ansage">
          {searching ? (results.length ? mehrzahl(results.length, "Treffer", "Treffer") : "Nichts gefunden") : ""}
        </Muted>

        {searching ? (
          <View style={styles.abschnitt} testID="faq-results">
            {results.length ? (
              <View style={styles.liste}>
                {results.map((treffer) => treffer.art === "frage" ? (
                  <FrageZeile
                    key={`frage-${treffer.id}`}
                    frage={treffer.frage}
                    suffix="-treffer"
                    bereich={faqBereich(treffer.bereich)?.titel}
                    offen={offeneFragen.has(`${treffer.id}-treffer`)}
                    onToggle={() => frageUmschalten(`${treffer.id}-treffer`)}
                  />
                ) : (
                  <SchrittTreffer key={`schritt-${treffer.id}`} treffer={treffer} />
                ))}
              </View>
            ) : (
              <Muted testID="faq-no-results">Probier ein anderes Wort oder schau unten in die Bereiche.</Muted>
            )}
          </View>
        ) : (
          <View style={styles.abschnitt} testID="faq-haeufig">
            <Heading accessibilityRole="header">Häufige Fragen</Heading>
            <View style={styles.liste}>
              {haeufig.map((frage) => (
                <FrageZeile
                  key={frage.id}
                  ankerRef={ankerFuer(`frage-${frage.id}`)}
                  frage={frage}
                  bereich={faqBereich(frage.bereich)?.titel}
                  offen={offeneFragen.has(frage.id)}
                  onToggle={() => frageUmschalten(frage.id)}
                />
              ))}
            </View>
          </View>
        )}

        <View style={styles.abschnitt} testID="faq-bereiche">
          <Heading accessibilityRole="header">Alle Bereiche</Heading>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} testID="faq-rollen">
            {/* Eine Rolle zur Zeit: Gruppe mit Radio-Knöpfen wie die Stufen der Benachrichtigungen und der Hinweis der Leitung. */}
            <View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel="Für wen?" testID="faq-rollen-gruppe">
            {[{ id: "", label: "Alle" }, ...rollen].map((row) => {
              const aktiv = rolle === row.id;
              return (
                <Pressable
                  key={row.id || "alle"}
                  onPress={() => setRolleWahl(row.id)}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: aktiv }}
                  style={({ pressed }) => [styles.chip, aktiv && styles.chipAktiv, pressed && styles.pressed]}
                  testID={`faq-rolle-${row.id || "alle"}`}
                >
                  <Body style={[styles.chipText, aktiv && styles.chipTextAktiv]}>{row.label}</Body>
                </Pressable>
              );
            })}
            </View>
          </ScrollView>
          {bereiche.length ? (
            <View style={styles.bereichListe} testID="faq-bereich-liste">
              {bereiche.map(({ bereich, inhalt }) => (
                <BereichZeile
                  key={bereich.id}
                  ankerRef={ankerFuer(`bereich-${bereich.id}`)}
                  bereich={bereich}
                  inhalt={inhalt}
                  offen={offeneBereiche.has(bereich.id)}
                  onToggle={() => setOffeneBereiche((set) => umschalten(set, bereich.id))}
                  offeneFragen={offeneFragen}
                  onFrage={frageUmschalten}
                />
              ))}
            </View>
          ) : (
            <Muted testID="faq-bereiche-leer">Für diese Auswahl gibt es noch nichts.</Muted>
          )}
        </View>

        <Pressable onPress={() => oeffneFaqLink("/contact")} accessibilityRole="link" style={({ pressed }) => [styles.kontakt, pressed && styles.pressed]} testID="faq-kontakt">
          <Muted style={styles.flex}>Nicht gefunden, was du suchst? Schreib uns.</Muted>
          <Ionicons name="open-outline" size={16} color={colors.cyan} />
        </Pressable>
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: 18, padding: 18, paddingBottom: 36 },
  hero: { gap: 6 },
  eyebrow: { color: colors.cyan, fontSize: 11, fontWeight: "900", letterSpacing: 2.4 },
  suche: {
    alignItems: "center", backgroundColor: colors.black, borderColor: colors.border, borderRadius: radius.sm, borderWidth: 1,
    flexDirection: "row", gap: 8, minHeight: 48, paddingLeft: 12,
  },
  sucheFeld: { color: colors.white, flex: 1, fontSize: 16, minHeight: 48, paddingVertical: 10 },
  leeren: { alignItems: "center", height: 48, justifyContent: "center", width: 48 },
  ansage: { fontSize: 12, fontWeight: "800", letterSpacing: 1.4, textTransform: "uppercase" },
  // Ohne Suche bleibt die Zeile da (die Ansage kommt so schon beim ersten Tippen), aber ohne Platz im Ablauf.
  versteckt: { height: 1, opacity: 0, position: "absolute", width: 1 },
  abschnitt: { gap: 10 },
  liste: { borderTopColor: colors.border, borderTopWidth: 1 },
  aufklapp: { borderBottomColor: colors.border, borderBottomWidth: 1 },
  kopf: { alignItems: "center", flexDirection: "row", gap: 12, minHeight: 52, paddingVertical: 10 },
  pressed: { opacity: 0.72 },
  gedreht: { transform: [{ rotate: "180deg" }] },
  frage: { flex: 1, fontWeight: "700" },
  inhalt: { gap: 6, paddingBottom: 14, paddingRight: 24 },
  antwort: { color: "rgba(255,255,255,0.82)", lineHeight: 22 },
  antwortFuss: { alignItems: "center", columnGap: 16, flexDirection: "row", flexWrap: "wrap" },
  linkKnopf: { alignItems: "center", flexDirection: "row", gap: 6, minHeight: 48 },
  linkText: { color: colors.cyan, fontWeight: "800" },
  bereichMarke: { fontSize: 11, fontWeight: "800", letterSpacing: 1.4, textTransform: "uppercase" },
  treffer: { alignItems: "flex-start", borderBottomColor: colors.border, borderBottomWidth: 1, flexDirection: "row", gap: 12, minHeight: 56, paddingVertical: 12 },
  trefferMeta: { alignItems: "center", columnGap: 8, flexDirection: "row", flexWrap: "wrap", rowGap: 4 },
  trefferBereich: {
    backgroundColor: "rgba(41,182,232,0.08)", borderColor: "rgba(41,182,232,0.3)", borderRadius: radius.sm, borderWidth: 1, color: colors.cyan,
    fontSize: 10, fontWeight: "900", letterSpacing: 1.2, paddingHorizontal: 6, paddingVertical: 1, textTransform: "uppercase",
  },
  trefferArt: { fontSize: 11, letterSpacing: 1.2, textTransform: "uppercase" },
  trefferTitel: { fontWeight: "800", marginTop: 4 },
  chips: { gap: 8, paddingVertical: 2 },
  chip: {
    alignItems: "center", borderColor: "rgba(255,255,255,0.15)", borderRadius: 24, borderWidth: 1, justifyContent: "center",
    minHeight: 48, minWidth: 48, paddingHorizontal: 16,
  },
  chipAktiv: { backgroundColor: colors.cyan, borderColor: colors.cyan },
  chipText: { color: "rgba(255,255,255,0.75)", fontSize: 13, fontWeight: "800", letterSpacing: 0.8, textTransform: "uppercase" },
  chipTextAktiv: { color: "#04141B" },
  bereichListe: { backgroundColor: surfaces.s1, borderColor: colors.border, borderRadius: radius.sm, borderWidth: 1, paddingHorizontal: 12 },
  bereichKopf: { minHeight: 64 },
  bereichIcon: { alignItems: "center", backgroundColor: "rgba(41,182,232,0.1)", borderRadius: radius.sm, height: 40, justifyContent: "center", width: 40 },
  bereichIconLeer: { backgroundColor: "rgba(255,255,255,0.04)" },
  bereichTitel: { fontWeight: "900", textTransform: "uppercase" },
  leerText: { color: colors.muted },
  bald: {
    borderColor: "rgba(255,255,255,0.15)", borderRadius: radius.sm, borderWidth: 1, fontSize: 10, fontWeight: "900", letterSpacing: 1.2,
    paddingHorizontal: 6, paddingVertical: 3, textTransform: "uppercase",
  },
  zaehler: { fontSize: 12 },
  anleitung: {
    alignItems: "center", backgroundColor: surfaces.base, borderColor: colors.border, borderRadius: radius.sm, borderWidth: 1,
    flexDirection: "row", gap: 10, minHeight: 48, paddingHorizontal: 12, paddingVertical: 8,
  },
  anleitungArt: { color: colors.cyan, fontSize: 10, fontWeight: "900", letterSpacing: 1.2, textTransform: "uppercase" },
  anleitungTitel: { fontWeight: "800" },
  anleitungZahl: { fontSize: 12 },
  kontakt: { alignItems: "center", flexDirection: "row", gap: 8, minHeight: 48 },
  flex: { flex: 1, minWidth: 0 },
});
