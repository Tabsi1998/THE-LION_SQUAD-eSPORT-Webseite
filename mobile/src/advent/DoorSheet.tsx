import { Ionicons } from "@expo/vector-icons";
import React, { useEffect, useState } from "react";
import { Image, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { errorMessage, resolveMediaUrl } from "../lib/api";
import { useSeasonOverlay } from "../seasons/anchors";
import { GOLD, KIND_ICONS, SERIF } from "./DoorTile";
import { dayLabel, opensLabel, type Door, type DoorContent, type PrizeState } from "./doors";
import type { QuizResult } from "./useAdventCalendar";

// Der Inhalt eines Türchens in der App (#641, #642): derselbe Inhalt wie im Web. Videos und Clips bettet die App
// nicht ein - sie öffnen sich bei YouTube oder Twitch, erst nach dem Tippen. Das Quiz löst nach der Antwort auf,
// bei der Verlosung ist Mitmachen ein eigener Knopf.

export const KIND_LABELS: Record<string, string> = {
  text: "Gruß", image: "Bild", video: "Video", clip: "Clip", news: "News", event: "Event", member_spotlight: "Mitglied der Woche", sticker: "Sticker", quiz: "Quiz", prize: "Gewinn",
};
const CARD_KICKER: Record<string, string> = { news: "News-Beitrag", event: "Event", member_spotlight: "Mitglied der Woche" };
const LETTERS = ["A", "B", "C"];

function GoldButton({ label, onPress, quiet = false, disabled = false, icon, testID }: { label: string; onPress: () => void; quiet?: boolean; disabled?: boolean; icon?: keyof typeof Ionicons.glyphMap; testID?: string }) {
  return (
    <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} testID={testID} style={({ pressed }) => [styles.button, quiet ? styles.buttonQuiet : styles.buttonGold, disabled && styles.disabled, pressed && !disabled && styles.pressed]}>
      {icon ? <Ionicons name={icon} size={16} color={quiet ? "#f4ecdc" : "#1c1303"} /> : null}
      <Text style={[styles.buttonLabel, quiet && styles.buttonLabelQuiet]}>{label}</Text>
    </Pressable>
  );
}

function Note({ children, tone = "plain", testID }: { children: React.ReactNode; tone?: "plain" | "good" | "bad"; testID?: string }) {
  return (
    <View style={[styles.note, tone === "good" && styles.noteGood, tone === "bad" && styles.noteBad]} testID={testID} accessibilityLiveRegion="polite">
      <Text style={styles.noteText}>{children}</Text>
    </View>
  );
}

export function QuizBlock({ day, quiz, onAnswer }: { day: number; quiz: NonNullable<DoorContent["quiz"]>; onAnswer: (day: number, choice: number) => Promise<QuizResult> }) {
  const [result, setResult] = useState<QuizResult | null>(null);
  const [choice, setChoice] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  useEffect(() => {
    setResult(null);
    setChoice(null);
    setProblem("");
  }, [day]);

  const pick = async (index: number) => {
    if (busy || result) return;
    setBusy(true);
    setChoice(index);
    setProblem("");
    try {
      setResult(await onAnswer(day, index));
    } catch (failure) {
      setChoice(null);
      setProblem(errorMessage(failure, "Die Antwort ist nicht angekommen. Versuch es noch einmal."));
    } finally {
      setBusy(false);
    }
  };
  const state = (index: number) => (!result ? "open" : index === result.correct_index ? "right" : index === choice ? "wrong" : "other");

  return (
    <View style={styles.block} testID="advent-quiz">
      <Text style={styles.question}>{quiz.question}</Text>
      {(quiz.answers || []).map((answer, index) => {
        const mark = state(index);
        return (
          <Pressable
            key={index}
            accessibilityRole="button"
            accessibilityState={{ disabled: busy || Boolean(result), selected: choice === index }}
            disabled={busy || Boolean(result)}
            onPress={() => pick(index)}
            testID={`advent-quiz-answer-${index}`}
            style={({ pressed }) => [styles.answer, mark === "right" && styles.answerRight, mark === "wrong" && styles.answerWrong, mark === "other" && styles.answerOther, pressed && styles.pressed]}
          >
            <View style={[styles.letter, mark === "right" && styles.letterRight, mark === "wrong" && styles.letterWrong]}>
              {mark === "right" ? <Ionicons name="checkmark" size={15} color="#5fd38d" /> : <Text style={[styles.letterText, mark === "wrong" && { color: "#ff7a6b" }]}>{LETTERS[index]}</Text>}
            </View>
            <Text style={styles.answerText}>{answer}</Text>
          </Pressable>
        );
      })}
      {result ? (
        <Note tone={result.correct ? "good" : "bad"} testID="advent-quiz-result">
          <Text style={styles.strong}>{result.correct ? "Richtig!" : `Leider nein – richtig ist „${result.correct_answer}“.`}</Text>
          {result.explanation ? ` ${result.explanation}` : ""}
        </Note>
      ) : null}
      {!result && quiz.done ? <Note testID="advent-quiz-done">Du hast bei diesem Quiz schon mitgemacht – raten darfst du trotzdem noch einmal.</Note> : null}
      {problem ? <Note tone="bad" testID="advent-quiz-problem">{problem}</Note> : null}
    </View>
  );
}

export const PRIZES_URL = "/me/prizes";

export function PrizeBlock({ day, prize, signedIn, onRaffle, onLogin, onLink }: { day: number; prize: PrizeState; signedIn: boolean; onRaffle: (day: number, join: boolean) => Promise<PrizeState>; onLogin?: () => void; onLink?: (url: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const [terms, setTerms] = useState(false);
  useEffect(() => {
    setProblem("");
    setTerms(false);
  }, [day]);

  const act = async (join: boolean) => {
    if (busy) return;
    setBusy(true);
    setProblem("");
    try {
      await onRaffle(day, join);
    } catch (failure) {
      setProblem(errorMessage(failure, join ? "Das Mitmachen hat nicht geklappt. Versuch es noch einmal." : "Das Zurückziehen hat nicht geklappt."));
    } finally {
      setBusy(false);
    }
  };
  const closes = opensLabel(prize.closes_at);
  return (
    <View style={styles.prize} testID="advent-prize">
      <View style={styles.prizeHead}>
        <View style={styles.prizeIcon}><Ionicons name="gift-outline" size={22} color="#1c1303" /></View>
        <View style={styles.flex}>
          <Text style={styles.prizeLabel}>{prize.label}</Text>
          {prize.value ? <Text style={styles.prizeValue}>{prize.value}</Text> : null}
        </View>
      </View>
      <View style={styles.facts}>
        <Text style={styles.fact}>{prize.winners === 1 ? "1 Gewinn" : `${prize.winners} Gewinne`}</Text>
        <Text style={styles.fact} testID="advent-prize-entries">{prize.entries === 1 ? "1 Person macht mit" : `${prize.entries} Personen machen mit`}</Text>
        {prize.status === "open" && closes ? <Text style={styles.fact}>Teilnahme bis {closes}</Text> : null}
        {prize.audience === "members" ? <Text style={styles.fact}>Nur für Vereinsmitglieder</Text> : null}
      </View>
      {prize.hint ? <Note tone={prize.won || prize.entered ? "good" : "plain"} testID="advent-prize-hint">{prize.hint}</Note> : null}
      <View style={styles.actions}>
        {prize.can_enter ? <GoldButton label="Mitmachen" onPress={() => act(true)} disabled={busy} testID="advent-prize-enter" /> : null}
        {prize.can_withdraw ? <GoldButton label="Teilnahme zurückziehen" quiet onPress={() => act(false)} disabled={busy} testID="advent-prize-withdraw" /> : null}
        {!signedIn && prize.status === "open" && onLogin ? <GoldButton label="Anmelden" icon="log-in-outline" onPress={onLogin} testID="advent-prize-login" /> : null}
        {prize.won && onLink ? <GoldButton label="Meine Gewinne" icon="gift-outline" onPress={() => onLink(PRIZES_URL)} testID="advent-prize-mine" /> : null}
      </View>
      {problem ? <Note tone="bad" testID="advent-prize-problem">{problem}</Note> : null}
      {prize.terms?.length ? (
        <View testID="advent-prize-terms">
          <Pressable accessibilityRole="button" accessibilityState={{ expanded: terms }} onPress={() => setTerms((open) => !open)} style={styles.termsHead} testID="advent-prize-terms-toggle">
            <Ionicons name={terms ? "chevron-down" : "chevron-forward"} size={14} color={GOLD} />
            <Text style={styles.termsTitle}>Teilnahmebedingungen</Text>
          </Pressable>
          {terms ? prize.terms.map((line, index) => <Text key={index} style={styles.term}>{index + 1}. {line}</Text>) : null}
        </View>
      ) : null}
    </View>
  );
}

type SheetProps = {
  door: Door | null;
  signedIn: boolean;
  onClose: () => void;
  onAnswer: (day: number, choice: number) => Promise<QuizResult>;
  onRaffle: (day: number, join: boolean) => Promise<PrizeState>;
  /** Eine Adresse öffnen: eigene Seiten im Screen der App, alles andere im Browser. */
  onLink: (url: string) => void;
  onLogin?: () => void;
};

export function DoorSheet({ door, signedIn, onClose, onAnswer, onRaffle, onLink, onLogin }: SheetProps) {
  const visible = Boolean(door?.content);
  useSeasonOverlay("advent-door", visible);
  const content = door?.content;
  const card = content?.card;
  const cardMeta = !card ? "" : content?.kind === "event" ? [dayLabel(card.date), card.location].filter(Boolean).join(" · ") : content?.kind === "news" ? card.excerpt || dayLabel(card.date) : card.role || "";
  return (
    <Modal animationType="fade" onRequestClose={onClose} transparent visible={visible}>
      <View style={styles.backdrop}>
        <View style={styles.sheet} testID="advent-sheet" accessibilityViewIsModal>
          {door && content ? (
            <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
              <View style={styles.eyebrow}>
                <Ionicons name={KIND_ICONS[content.kind] || "document-text-outline"} size={14} color={GOLD} />
                <Text style={styles.eyebrowText}>TÜRCHEN {door.day} · {(KIND_LABELS[content.kind] || "Gruß").toUpperCase()}</Text>
              </View>
              <Text style={styles.title} accessibilityRole="header" testID="advent-sheet-title">{content.title}</Text>
              {content.kind === "sticker" && content.sticker?.url ? (
                <Image source={{ uri: resolveMediaUrl(content.sticker.url) }} style={styles.sticker} resizeMode="contain" accessibilityLabel={content.sticker.name || "Sticker"} testID="advent-sticker" />
              ) : null}
              {content.kind !== "sticker" && content.media_url ? (
                <Image source={{ uri: resolveMediaUrl(content.media_url) }} style={styles.image} resizeMode="contain" accessibilityLabel={content.kind === "image" ? content.title : undefined} testID="advent-image" />
              ) : null}
              {content.body ? <Text style={styles.body} testID="advent-text">{content.body}</Text> : null}
              {content.kind === "video" && content.video?.url ? <GoldButton label="Video auf YouTube ansehen" icon="logo-youtube" quiet onPress={() => onLink(String(content.video?.url))} testID="advent-video" /> : null}
              {content.kind === "clip" && content.clip?.url ? <GoldButton label="Clip auf Twitch ansehen" icon="logo-twitch" quiet onPress={() => onLink(String(content.clip?.url))} testID="advent-clip" /> : null}
              {card ? (
                <Pressable accessibilityRole={card.url ? "link" : undefined} disabled={!card.url} onPress={() => card.url && onLink(card.url)} style={({ pressed }) => [styles.card, pressed && styles.pressed]} testID="advent-card">
                  {card.image_url ? <Image source={{ uri: resolveMediaUrl(card.image_url) }} style={styles.cardImage} resizeMode="cover" /> : null}
                  <View style={styles.cardText}>
                    <Text style={styles.cardKicker}>{(CARD_KICKER[content.kind] || "").toUpperCase()}</Text>
                    <Text style={styles.cardTitle}>{card.title || card.name}</Text>
                    {cardMeta ? <Text style={styles.cardMeta}>{cardMeta}</Text> : null}
                  </View>
                  {card.url ? <Ionicons name="chevron-forward" size={16} color={GOLD} /> : null}
                </Pressable>
              ) : null}
              {content.quiz ? <QuizBlock day={door.day} quiz={content.quiz} onAnswer={onAnswer} /> : null}
              {content.prize ? <PrizeBlock day={door.day} prize={content.prize} signedIn={signedIn} onRaffle={onRaffle} onLogin={onLogin} onLink={onLink} /> : null}
              {content.link?.url ? <GoldButton label={content.link.label || "Mehr dazu"} icon={content.link.url.startsWith("/") ? "arrow-forward" : "open-outline"} quiet onPress={() => onLink(String(content.link?.url))} testID="advent-link" /> : null}
            </ScrollView>
          ) : null}
          <Pressable accessibilityRole="button" accessibilityLabel="Schließen" onPress={onClose} style={styles.close} hitSlop={8} testID="advent-sheet-close">
            <Ionicons name="close" size={18} color="rgba(255,255,255,0.8)" />
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.8)", justifyContent: "center", padding: 12 },
  sheet: { maxHeight: "92%", borderRadius: 14, borderWidth: 1, borderColor: "rgba(233, 196, 106, 0.45)", backgroundColor: "#0e0b07", overflow: "hidden" },
  content: { padding: 20, paddingTop: 22, gap: 14 },
  close: { position: "absolute", top: 10, right: 10, width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.5)", borderWidth: 1, borderColor: "rgba(255,255,255,0.12)" },
  eyebrow: { flexDirection: "row", alignItems: "center", gap: 7, paddingRight: 44 },
  eyebrowText: { color: GOLD, fontSize: 11, fontWeight: "800", letterSpacing: 2 },
  title: { color: "#fff6e0", fontFamily: SERIF, fontSize: 26, lineHeight: 31, fontWeight: "600", paddingRight: 36 },
  body: { color: "rgba(244, 236, 220, 0.88)", fontSize: 15.5, lineHeight: 24 },
  image: { width: "100%", aspectRatio: 16 / 10, borderRadius: 8, backgroundColor: "#000" },
  sticker: { width: 180, height: 180, alignSelf: "center" },
  block: { gap: 10 },
  question: { color: "#fff6e0", fontFamily: SERIF, fontSize: 19, lineHeight: 25, fontWeight: "600" },
  answer: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 50, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 8, borderWidth: 1, borderColor: "rgba(233, 196, 106, 0.32)", backgroundColor: "rgba(255,255,255,0.04)" },
  answerRight: { borderColor: "#5fd38d", backgroundColor: "rgba(95, 211, 141, 0.14)" },
  answerWrong: { borderColor: "#ff7a6b", backgroundColor: "rgba(255, 122, 107, 0.12)" },
  answerOther: { opacity: 0.55 },
  answerText: { flex: 1, color: "#f4ecdc", fontSize: 15, lineHeight: 21 },
  letter: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "rgba(233, 196, 106, 0.6)" },
  letterRight: { borderColor: "#5fd38d" },
  letterWrong: { borderColor: "#ff7a6b" },
  letterText: { color: GOLD, fontFamily: SERIF, fontSize: 14, fontWeight: "600" },
  note: { paddingHorizontal: 14, paddingVertical: 12, borderRadius: 8, borderWidth: 1, borderColor: "rgba(233, 196, 106, 0.28)", backgroundColor: "rgba(233, 196, 106, 0.07)" },
  noteGood: { borderColor: "rgba(95, 211, 141, 0.5)", backgroundColor: "rgba(95, 211, 141, 0.1)" },
  noteBad: { borderColor: "rgba(255, 122, 107, 0.5)", backgroundColor: "rgba(255, 122, 107, 0.09)" },
  noteText: { color: "#f4ecdc", fontSize: 14, lineHeight: 21 },
  strong: { fontWeight: "800" },
  prize: { gap: 12, padding: 16, borderRadius: 12, borderWidth: 1, borderColor: "rgba(233, 196, 106, 0.45)", backgroundColor: "rgba(233, 196, 106, 0.06)" },
  prizeHead: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  prizeIcon: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: GOLD },
  prizeLabel: { color: "#fff6e0", fontFamily: SERIF, fontSize: 20, lineHeight: 25, fontWeight: "600" },
  prizeValue: { marginTop: 2, color: "rgba(244, 236, 220, 0.7)", fontSize: 14, lineHeight: 20 },
  facts: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  fact: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 99, borderWidth: 1, borderColor: "rgba(255,255,255,0.14)", backgroundColor: "rgba(0,0,0,0.25)", color: "rgba(244, 236, 220, 0.85)", fontSize: 12, overflow: "hidden" },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  termsHead: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 36 },
  termsTitle: { color: GOLD, fontSize: 13, fontWeight: "800" },
  term: { marginTop: 6, color: "rgba(244, 236, 220, 0.8)", fontSize: 13.5, lineHeight: 20 },
  card: { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 10, borderWidth: 1, borderColor: "rgba(233, 196, 106, 0.3)", backgroundColor: "rgba(255,255,255,0.03)", overflow: "hidden", paddingRight: 12 },
  cardImage: { width: 92, alignSelf: "stretch", minHeight: 84 },
  cardText: { flex: 1, paddingVertical: 12, paddingLeft: 14, gap: 3 },
  cardKicker: { color: GOLD, fontSize: 10.5, fontWeight: "800", letterSpacing: 1.6 },
  cardTitle: { color: "#f4ecdc", fontSize: 16, lineHeight: 21, fontWeight: "700" },
  cardMeta: { color: "rgba(244, 236, 220, 0.62)", fontSize: 13, lineHeight: 18 },
  button: { minHeight: 46, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingHorizontal: 18, paddingVertical: 10, borderRadius: 8, borderWidth: 1, alignSelf: "flex-start" },
  buttonGold: { backgroundColor: GOLD, borderColor: "rgba(233, 196, 106, 0.7)" },
  buttonQuiet: { backgroundColor: "rgba(255,255,255,0.05)", borderColor: "rgba(233, 196, 106, 0.4)" },
  buttonLabel: { color: "#1c1303", fontSize: 13, fontWeight: "800", letterSpacing: 0.8, textTransform: "uppercase" },
  buttonLabelQuiet: { color: "#f4ecdc" },
  disabled: { opacity: 0.55 },
  pressed: { opacity: 0.85 },
  flex: { flex: 1 },
});
