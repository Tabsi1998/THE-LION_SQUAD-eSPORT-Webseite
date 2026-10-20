import React, { useCallback, useEffect, useRef, useState } from "react";
import type { LayoutChangeEvent, NativeSyntheticEvent, TextLayoutEventData, TextProps } from "react-native";
import { Title } from "./Text";

/** Ein Wort, das über zwei Zeilen zerrissen wurde: die Zeile endet mit einem Buchstaben, die nächste beginnt mit einem. */
export function breaksInsideWord(lines: ReadonlyArray<{ text: string }>): boolean {
  const letter = /[0-9A-Za-zÀ-ÖØ-öø-ÿ]/;
  return lines.some((line, index) => index < lines.length - 1 && letter.test(line.text.slice(-1)) && letter.test(lines[index + 1].text.charAt(0)));
}

const TITLE_SIZE = 30;

/**
 * Ein Titel, der kein Wort zerreißt. Android bricht ein zu langes Wort sonst mitten im Wort um („Willkomm|en“ auf der
 * Startseite, „Regenbog|en-Boulevard“ im Fast-Lap-Kopf, #1867). Dann wird die Schrift in Schritten kleiner, bis kein
 * Wort mehr zerrissen ist, höchstens bis `minScale` - Umbrüche an Leerzeichen und nach Bindestrichen bleiben erlaubt.
 * Neuer Text oder mehr Platz beginnen wieder bei voller Größe. Wird die Spalte schmaler, setzt nichts zurück: Android
 * meldet die Zeilen dann nur einmal, ein Zurücksetzen im selben Durchgang hätte das Verkleinern wieder aufgehoben.
 */
export function FitTitle({ text, minScale, ...props }: Omit<TextProps, "children" | "onLayout" | "onTextLayout" | "style"> & { text: string; minScale: number }) {
  const [scale, setScale] = useState(1);
  const width = useRef(0);
  const shownText = useRef(text);
  useEffect(() => {
    if (shownText.current === text) return;
    shownText.current = text;
    setScale(1);
  }, [text]);
  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const next = Math.round(event.nativeEvent.layout.width);
    if (width.current && next > width.current + 1) setScale(1);
    width.current = next;
  }, []);
  const onTextLayout = useCallback((event: NativeSyntheticEvent<TextLayoutEventData>) => {
    if (!breaksInsideWord(event.nativeEvent.lines)) return;
    setScale((current) => (current > minScale ? Math.max(minScale, Math.round((current - 0.05) * 100) / 100) : current));
  }, [minScale]);
  return (
    // Vorgabe (#1867): einfache Umbruch-Strategie, keine Silbentrennung - Android trennt sonst auch ohne Not im Wort.
    <Title textBreakStrategy="simple" android_hyphenationFrequency="none" {...props} onLayout={onLayout} onTextLayout={onTextLayout} style={scale < 1 ? { fontSize: Math.round(TITLE_SIZE * scale) } : null}>
      {text}
    </Title>
  );
}
