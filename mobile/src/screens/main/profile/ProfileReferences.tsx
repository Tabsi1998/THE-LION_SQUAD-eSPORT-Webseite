import React, { useEffect, useMemo, useState } from "react";
import { Linking, Pressable, StyleSheet, View } from "react-native";
import { Button } from "../../../components/Button";
import { Chevron, MedalMark, PathStrip, PlaceRing, Reveal, SectionLabel, ink, medalTone } from "../../../components/references/parts";
import { Body, Muted } from "../../../components/Text";
import type { MemberPlacements } from "../../../lib/memberPlacements";
import { memberPaths, profileGroups, profileHead, profileRows, type ProfileRow } from "../../../lib/profileReferences";
import type { SeasonTarget } from "../../../lib/references";
import { WEB_BASE_URL } from "../../../lib/siteUrls";
import { colors, surfaces } from "../../../theme";
import type { PersonalReferenceItem } from "../../../types";
import { TournamentPathPanel } from "./TournamentPath";

// Profil-Reiter „Referenzen“ (#1945) nach dem freigegebenen Entwurf „AppProfil“ (21.10.2026), wie das Mitgliederprofil
// im Web (#1944): Kopf ohne Nullen (mit Podest nur die vorhandenen Medaillen, sonst „Bestes Ergebnis“; dazu Teilnahmen,
// Spiele, „dabei seit“), der Liga-Weg der Person zum Wischen und die Chronik je Jahr. Eine Zeile klappt auf: bei einer
// Vereinsplatzierung Team, Aufstellung (die Person hervorgehoben) und „Saison ansehen“ - ohne Saison „Im Web öffnen“;
// bei einem eigenen Turnier sein Weg (#1193). Immer nur eine Zeile ist offen. Daten: lib/profileReferences.ts.

const ACTIONS: Record<string, string> = { tournament: "Turnier ansehen", fastlap: "Fast Lap ansehen", season: "Jahreswertung ansehen" };

export function ProfileReferences({ personal, club, username, own = false, publicView = false, onOpenSeason, onOpenPersonal, empty }: {
  personal: PersonalReferenceItem[];
  club: MemberPlacements | null;
  username?: string | null;
  own?: boolean;
  publicView?: boolean;
  onOpenSeason: (target: SeasonTarget) => void;
  onOpenPersonal: (item: PersonalReferenceItem) => void;
  /** Was ohne Einträge dasteht (Hinweis oder Fehler mit „Nochmal versuchen“). */
  empty: React.ReactNode;
}) {
  const rows = useMemo(() => profileRows({ personal, club: club?.references, memberId: club?.profileId, lineages: club?.lineages }), [personal, club]);
  const head = useMemo(() => profileHead(rows), [rows]);
  const paths = useMemo(() => memberPaths(club?.lineages, club?.references, club?.profileId || ""), [club]);
  const groups = useMemo(() => profileGroups(rows), [rows]);
  const [openId, setOpenId] = useState<string | null>(null);

  if (!rows.length) return <>{empty}</>;

  return (
    <View style={styles.wrap} testID="profile-references">
      <View style={styles.head} testID="profile-references-head">
        {head.medals.length ? (
          <View style={styles.medals}>
            {head.medals.map((medal, index) => {
              const place = medal.key === "gold" ? 1 : medal.key === "silver" ? 2 : 3;
              return (
                <View key={medal.key} style={[styles.medal, index > 0 && styles.medalDivider]} accessible accessibilityLabel={`${medal.count} ${medal.label}`}>
                  <MedalMark placement={place} size={30} />
                  <Body style={[styles.medalCount, { color: medalTone(place)?.fg }]}>{String(medal.count)}</Body>
                  <Muted style={styles.medalLabel}>{medal.label}</Muted>
                </View>
              );
            })}
          </View>
        ) : head.best ? (
          <View style={styles.best}>
            <PlaceRing placement={head.best.placement} size={52} />
            <View style={styles.flex}>
              <Muted style={styles.label}>Bestes Ergebnis</Muted>
              <Body style={styles.bestTitle}>{head.best.title}</Body>
              {head.best.sub ? <Muted style={styles.bestSub}>{head.best.sub}</Muted> : null}
            </View>
          </View>
        ) : null}
        {head.facts.length ? (
          <View style={[styles.facts, (head.medals.length || head.best) ? styles.factsDivided : null]}>
            {head.facts.map((fact) => (
              <View key={fact.key} style={styles.fact} accessible accessibilityLabel={`${fact.value} ${fact.label}`}>
                <Body style={styles.factValue}>{fact.value}</Body>
                <Muted style={styles.factLabel}>{fact.label}</Muted>
              </View>
            ))}
          </View>
        ) : null}
      </View>

      {paths.map((path) => (
        <View key={path.key} style={styles.path}>
          <SectionLabel>{`Liga-Weg · ${path.title}`}</SectionLabel>
          <PathStrip tiles={path.tiles} testID={`profile-references-path-${path.key}`} />
        </View>
      ))}

      {groups.map((group) => (
        <View key={group.key || "none"} testID={`profile-references-year-${group.key || "none"}`}>
          <View style={styles.yearHead}>
            <Body style={styles.year} accessibilityRole="header">{group.label}</Body>
            <Muted style={styles.yearCount}>{group.count}</Muted>
          </View>
          <View style={styles.list}>
            {group.rows.map((row) => (
              <ChronicleRow
                key={row.id}
                row={row}
                open={openId === row.id}
                onToggle={() => setOpenId((current) => (current === row.id ? null : row.id))}
                username={username}
                own={own}
                publicView={publicView}
                onOpenSeason={onOpenSeason}
                onOpenPersonal={onOpenPersonal}
              />
            ))}
          </View>
        </View>
      ))}
    </View>
  );
}

function ChronicleRow({ row, open, onToggle, username, own, publicView, onOpenSeason, onOpenPersonal }: {
  row: ProfileRow;
  open: boolean;
  onToggle: () => void;
  username?: string | null;
  own: boolean;
  publicView: boolean;
  onOpenSeason: (target: SeasonTarget) => void;
  onOpenPersonal: (item: PersonalReferenceItem) => void;
}) {
  // Einmal aufgeklappt bleibt der Inhalt gebaut (nur verborgen) - ein geladener Turnierweg lädt nicht noch einmal.
  const [wasOpen, setWasOpen] = useState(open);
  const [round, setRound] = useState(0);
  useEffect(() => {
    if (open) setWasOpen(true);
  }, [open]);
  const opened = open || wasOpen;
  const toggle = () => {
    if (!open) setRound((value) => value + 1);
    onToggle();
  };
  const season = row.season;
  const personal = row.personal;
  const showPath = row.source === "tournament" && Boolean(personal?.target_id) && Boolean(username);
  return (
    <View style={styles.rowWrap}>
      <Pressable
        onPress={toggle}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={[row.placement ? `${row.placement}. Platz` : "", row.title, row.sub].filter(Boolean).join(", ")}
        style={({ pressed }) => [styles.row, pressed && styles.pressed]}
        testID={`profile-reference-${row.id}`}
      >
        <PlaceRing placement={row.placement} />
        <View style={styles.flex}>
          <Body style={styles.rowTitle}>{row.title}</Body>
          {row.sub ? <Muted style={styles.rowSub}>{row.sub}</Muted> : null}
        </View>
        <Chevron open={open} />
      </Pressable>
      {opened ? (
        <Reveal trigger={round} style={[styles.detail, !open && styles.hidden]} testID={open ? `profile-reference-detail-${row.id}` : undefined}>
          {row.detail ? <Muted style={styles.detailText}>{row.detail}</Muted> : null}
          {row.lineup.length ? (
            <>
              {/* Einsätze in der Saison (#1931) wie im Web: „Aufstellung · 5 von 7 Spielen“, die Zahl leiser. */}
              <Muted
                style={styles.label}
                accessibilityLabel={["Aufstellung", row.played].filter(Boolean).join(" · ")}
                testID={`profile-reference-lineup-${row.id}`}
              >
                Aufstellung
                {row.played ? <Muted style={styles.labelPlayed}>{` · ${row.played}`}</Muted> : null}
              </Muted>
              <View style={styles.lineup}>
                {row.lineup.map((person, index) => (
                  <View
                    key={`${person.name}-${index}`}
                    style={[styles.person, person.me && styles.personMe]}
                    accessible
                    accessibilityLabel={person.me ? `${person.name}, du` : person.name}
                    testID={person.me ? "lineup-me" : undefined}
                  >
                    <Body style={[styles.personName, person.me && styles.personNameMe]}>{person.name}</Body>
                  </View>
                ))}
              </View>
            </>
          ) : row.played ? (
            <Muted style={styles.detailText} testID={`profile-reference-played-${row.id}`}>{`Einsätze · ${row.played}`}</Muted>
          ) : null}
          {showPath && personal ? <TournamentPathPanel item={personal} username={username} own={own} publicView={publicView} /> : null}
          {row.source === "club" ? (
            season ? (
              <Button label="Saison ansehen" compact onPress={() => onOpenSeason(season)} style={styles.action} testID={`profile-reference-season-${row.id}`} />
            ) : (
              <Button label="Im Web öffnen" variant="quiet" compact icon="open-outline" onPress={() => { Linking.openURL(`${WEB_BASE_URL}/references/${encodeURIComponent(row.referenceId || "")}`).catch(() => {}); }} style={styles.action} />
            )
          ) : personal?.target_id ? (
            <Button label={ACTIONS[row.source] || "Ansehen"} variant="secondary" compact onPress={() => onOpenPersonal(personal)} style={styles.action} />
          ) : null}
        </Reveal>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 14 },
  head: { backgroundColor: surfaces.s1, borderColor: ink.cardLine, borderRadius: 12, borderWidth: 1, gap: 14, padding: 16 },
  medals: { flexDirection: "row" },
  medal: { flex: 1, gap: 4, paddingHorizontal: 10 },
  medalDivider: { borderLeftColor: ink.line, borderLeftWidth: 1 },
  medalCount: { fontSize: 32, fontVariant: ["tabular-nums"], fontWeight: "800", lineHeight: 36 },
  medalLabel: { color: ink.second, fontSize: 11, fontWeight: "800", letterSpacing: 1.5, textTransform: "uppercase" },
  best: { alignItems: "center", flexDirection: "row", gap: 14 },
  flex: { flex: 1, minWidth: 0 },
  label: { color: ink.muted, fontSize: 11, fontWeight: "800", letterSpacing: 1.8, textTransform: "uppercase" },
  labelPlayed: { color: ink.quiet, fontWeight: "600" },
  bestTitle: { color: ink.text, fontSize: 16, fontWeight: "700" },
  bestSub: { color: ink.quiet, fontSize: 13 },
  facts: { flexDirection: "row", gap: 8 },
  factsDivided: { borderTopColor: ink.line, borderTopWidth: 1, paddingTop: 12 },
  fact: { flex: 1, minWidth: 0 },
  factValue: { color: ink.text, fontSize: 26, fontVariant: ["tabular-nums"], fontWeight: "800", lineHeight: 30 },
  factLabel: { color: ink.muted, fontSize: 12 },
  path: { gap: 8 },
  yearHead: { alignItems: "baseline", flexDirection: "row", gap: 10, paddingVertical: 8 },
  year: { color: ink.text, fontSize: 28, fontVariant: ["tabular-nums"], fontWeight: "800", lineHeight: 32 },
  yearCount: { color: ink.quiet, fontSize: 13 },
  list: { borderTopColor: "rgba(255,255,255,0.1)", borderTopWidth: 1 },
  rowWrap: { borderBottomColor: ink.rowLine, borderBottomWidth: 1 },
  row: { alignItems: "center", flexDirection: "row", gap: 12, minHeight: 64, paddingHorizontal: 2, paddingVertical: 12 },
  rowTitle: { color: ink.text, fontSize: 15, fontWeight: "700", lineHeight: 20 },
  rowSub: { color: ink.muted, fontSize: 13 },
  detail: { gap: 10, paddingBottom: 16, paddingLeft: 52, paddingRight: 2 },
  hidden: { display: "none" },
  detailText: { color: ink.second, fontSize: 13 },
  lineup: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  person: { backgroundColor: surfaces.s2, borderColor: "rgba(255,255,255,0.12)", borderRadius: 999, borderWidth: 1, paddingHorizontal: 9, paddingVertical: 3 },
  personMe: { backgroundColor: "rgba(41,182,232,0.12)", borderColor: colors.cyan },
  personName: { color: ink.soft, fontSize: 13, fontWeight: "500", lineHeight: 18 },
  personNameMe: { color: ink.text, fontWeight: "700" },
  action: { alignSelf: "flex-start" },
  pressed: { opacity: 0.72 },
});
