import React, { useMemo, useState } from "react";
import { StyleSheet, View, type LayoutChangeEvent } from "react-native";
import { SvgXml } from "react-native-svg";
import { DoorTile } from "./DoorTile";
import { cellOf, columnsFor, doorOrder, doorVariant, hingeAt, DOORS, type Calendar, type Door } from "./doors";
import { sceneSvg } from "./scene";

// Das Brett des Adventkalenders in der App (#641, #642): dasselbe Winterbild wie im Web (ohne Weichzeichner), darauf
// 24 Türchen in der Anordnung des Jahres. Die Breite bestimmt die Spalten (3 am Handy, 4 oder 6 am Tablet).

type Props = {
  calendar: Calendar;
  busyDay?: number | null;
  still?: boolean;
  onOpen: (door: Door) => void;
  onShow: (door: Door) => void;
  onLocked: (door: Door) => void;
};

export function AdventBoard({ calendar, busyDay = null, still = false, onOpen, onShow, onLocked }: Props) {
  const [width, setWidth] = useState(0);
  const year = calendar.year || new Date().getFullYear();
  const xml = useMemo(() => sceneSvg(year, { filters: false }), [year]);
  const order = useMemo(() => doorOrder(calendar.order), [calendar.order]);
  const doors = useMemo(() => new Map((calendar.doors || []).map((door) => [door.day, door])), [calendar.doors]);
  const variants = useMemo(() => new Map((calendar.doors || []).map((door) => [door.day, doorVariant(door.seed)])), [calendar.doors]);
  const columns = columnsFor(width);
  const rows = DOORS / columns;
  const size = width > 0 ? width / columns : 0;
  const today = !calendar.catch_up ? calendar.newest_door : null;

  const onLayout = (event: LayoutChangeEvent) => {
    const measured = Math.floor(event.nativeEvent.layout.width);
    if (measured > 0 && measured !== width) setWidth(measured);
  };
  const press = (door: Door) => {
    if (door.state === "locked") onLocked(door);
    else if (door.state === "opened") onShow(door);
    else if (busyDay === null) onOpen(door);
  };

  return (
    <View style={styles.frame} testID="advent-frame">
      <View style={styles.inlay} pointerEvents="none" />
      <View onLayout={onLayout} style={[styles.board, size ? { height: size * rows } : styles.unmeasured]} testID="advent-board" accessibilityLabel={`Adventkalender ${year}: 24 Türchen`}>
        {size > 0 ? (
          <>
            <View style={StyleSheet.absoluteFill} pointerEvents="none" testID="advent-scene">
              <SvgXml xml={xml} width={width} height={size * rows} />
            </View>
            <View style={styles.grid}>
              {order.map((day, index) => {
                const door = doors.get(day);
                const variant = variants.get(day);
                if (!door || !variant) return <View key={day} style={{ width: size, height: size }} />;
                const cell = cellOf(index, columns);
                return (
                  <DoorTile
                    key={day}
                    door={door}
                    variant={{ ...variant, hinge: hingeAt(variant.hinge, cell, columns) }}
                    cell={cell}
                    rows={rows}
                    size={size}
                    today={today === day}
                    busy={busyDay === day}
                    still={still}
                    onPress={press}
                  />
                );
              })}
            </View>
          </>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { padding: 8, borderRadius: 14, backgroundColor: "#120e07", borderWidth: 1, borderColor: "rgba(233, 196, 106, 0.42)" },
  inlay: { position: "absolute", top: 3, left: 3, right: 3, bottom: 3, borderRadius: 11, borderWidth: 1, borderColor: "rgba(233, 196, 106, 0.28)" },
  board: { borderRadius: 8, overflow: "hidden", backgroundColor: "#0a1230" },
  unmeasured: { minHeight: 240 },
  grid: { flexDirection: "row", flexWrap: "wrap" },
});
