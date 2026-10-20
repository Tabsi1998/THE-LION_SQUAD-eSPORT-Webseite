import React, { useEffect, useMemo, useRef } from "react";
import { Animated, Image, PanResponder, Pressable, StyleSheet, View, type GestureResponderEvent, type PanResponderGestureState } from "react-native";
import { clampPan, isZoomed, pinchScale, settleZoom, touchDistance, ZOOM_RESET, type ZoomState } from "../lib/zoom";

// Bild mit Zwei-Finger-Zoom und Verschieben (#999). Früher zoomte nur die ScrollView von iOS (maximumZoomScale gilt
// auf Android nicht); jetzt rechnet die App selbst mit PanResponder, auf beiden Systemen gleich. Ein Finger ohne Zoom
// gehört dem Blättern der Galerie, ein Tipp dem Ein- und Ausblenden der Leiste. Wird das Bild verlassen (anderes Bild,
// Drehen), steht es wieder auf 1.

type Props = {
  uri: string;
  width: number;
  height: number;
  active: boolean;
  label: string;
  onTap: () => void;
  onZoomChange: (zoomed: boolean) => void;
  testID?: string;
};

type Touch = { pageX: number; pageY: number };

export function ZoomableImage({ uri, width, height, active, label, onTap, onZoomChange, testID }: Props) {
  const scale = useRef(new Animated.Value(1)).current;
  const translateX = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(0)).current;
  const zoom = useRef<ZoomState>(ZOOM_RESET);
  const gesture = useRef({ touches: 0, startDistance: 0, startScale: 1, lastDx: 0, lastDy: 0 });
  const size = useRef({ width, height });
  size.current = { width, height };
  const onZoomChangeRef = useRef(onZoomChange);
  onZoomChangeRef.current = onZoomChange;

  const responder = useMemo(() => {
    const apply = (next: ZoomState) => {
      zoom.current = next;
      scale.setValue(next.scale);
      translateX.setValue(next.x);
      translateY.setValue(next.y);
    };
    const wants = (event: GestureResponderEvent, state: PanResponderGestureState) =>
      event.nativeEvent.touches.length >= 2 || (isZoomed(zoom.current) && (Math.abs(state.dx) > 4 || Math.abs(state.dy) > 4));
    const baseline = (touches: Touch[], state: PanResponderGestureState) => {
      gesture.current = {
        touches: touches.length,
        startDistance: touches.length >= 2 ? touchDistance(touches[0], touches[1]) : 0,
        startScale: zoom.current.scale,
        lastDx: state.dx,
        lastDy: state.dy,
      };
    };
    const finish = () => {
      const next = settleZoom(zoom.current, size.current.width, size.current.height);
      zoom.current = next;
      // JS-Treiber wie die Geste selbst (setValue bei jeder Bewegung): eine Quelle für den Wert, auch in Tests ablesbar.
      Animated.parallel([
        Animated.spring(scale, { toValue: next.scale, useNativeDriver: false, bounciness: 0 }),
        Animated.spring(translateX, { toValue: next.x, useNativeDriver: false, bounciness: 0 }),
        Animated.spring(translateY, { toValue: next.y, useNativeDriver: false, bounciness: 0 }),
      ]).start();
      onZoomChangeRef.current(isZoomed(next));
    };
    return PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponderCapture: wants,
      onMoveShouldSetPanResponder: wants,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (event, state) => {
        baseline(event.nativeEvent.touches as Touch[], state);
        // Während der Geste blättert die Galerie nicht.
        onZoomChangeRef.current(true);
      },
      onPanResponderMove: (event, state) => {
        const touches = event.nativeEvent.touches as Touch[];
        // Kommt ein Finger dazu oder geht einer, springt der Mittelpunkt: neu ansetzen statt springen.
        if (touches.length !== gesture.current.touches) baseline(touches, state);
        const { startDistance, startScale, lastDx, lastDy } = gesture.current;
        const nextScale = touches.length >= 2 ? pinchScale(startScale, startDistance, touchDistance(touches[0], touches[1])) : zoom.current.scale;
        gesture.current.lastDx = state.dx;
        gesture.current.lastDy = state.dy;
        apply(clampPan({ scale: nextScale, x: zoom.current.x + state.dx - lastDx, y: zoom.current.y + state.dy - lastDy }, size.current.width, size.current.height));
      },
      onPanResponderRelease: finish,
      onPanResponderTerminate: finish,
    });
  }, [scale, translateX, translateY]);

  // Ein anderes Bild oder eine neue Fenstergröße (Drehen): wieder auf 1.
  useEffect(() => {
    if (zoom.current === ZOOM_RESET) return;
    zoom.current = ZOOM_RESET;
    scale.setValue(1);
    translateX.setValue(0);
    translateY.setValue(0);
    // Das sichtbare Bild gibt das Blättern wieder frei.
    if (active) onZoomChangeRef.current(false);
  }, [active, width, height, scale, translateX, translateY]);

  return (
    <View style={[styles.clip, { width, height }]}>
      <Animated.View
        {...responder.panHandlers}
        style={[styles.frame, { width, height, transform: [{ translateX }, { translateY }, { scale }] }]}
        testID={testID}
      >
        <Pressable onPress={onTap} style={[styles.frame, { width, height }]}>
          <Image source={{ uri }} style={{ width, height }} resizeMode="contain" accessibilityLabel={label} />
        </Pressable>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  clip: { overflow: "hidden" },
  frame: { alignItems: "center", justifyContent: "center" },
});
