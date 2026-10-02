import React, { useId } from "react";
import Svg, { Circle, Defs, Ellipse, G, LinearGradient, Path, RadialGradient, Rect, Stop } from "react-native-svg";
import { BOOT_COLORS as C, BOOT_PATHS as P, BOOT_VIEWBOX, FUR, FUR_BAND, TREATS, USED_TILT, bootWidth, leafPath } from "./boot";

// Der Stiefel als Bild (X3 #736) - wie BootArt im Web, aber in zwei Ebenen: der Gutschein (VoucherSvg) liegt hinter
// dem Stiefel und steckt so hinter Mandarine und Fellrand wie im Web; beim Öffnen steigt er allein heraus. Gleiche
// Zeichenfläche für beide.

const VIEWBOX = `${BOOT_VIEWBOX.x} ${BOOT_VIEWBOX.y} ${BOOT_VIEWBOX.width} ${BOOT_VIEWBOX.height}`;

function useSvgIds(): string {
  return useId().replace(/[^a-zA-Z0-9]/g, "");
}

/** Der Stiefel ohne Gutschein: `used` gekippt, die Mandarine nachgerutscht. */
export function BootSvg({ height, used = false }: { height: number; used?: boolean }) {
  const ids = useSvgIds();
  const tangerine = used ? TREATS.tangerine.used : TREATS.tangerine.full;
  const { chocolate, nut } = TREATS;
  return (
    <Svg width={bootWidth(height)} height={height} viewBox={VIEWBOX} testID="nikolaus-boot-svg">
      <Defs>
        <LinearGradient id={`${ids}felt`} x1="0" y1="0" x2="1" y2="0">
          <Stop offset="0" stopColor={C.feltDark} />
          <Stop offset="0.55" stopColor={C.felt} />
          <Stop offset="1" stopColor={C.feltSide} />
        </LinearGradient>
        <LinearGradient id={`${ids}shade`} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0.62" stopColor="#000" stopOpacity={0} />
          <Stop offset="1" stopColor="#000" stopOpacity={0.28} />
        </LinearGradient>
        <RadialGradient id={`${ids}tangerine`} cx="0.38" cy="0.35" r="0.7">
          <Stop offset="0" stopColor={C.tangerineLight} />
          <Stop offset="0.7" stopColor={C.tangerine} />
          <Stop offset="1" stopColor={C.tangerineDark} />
        </RadialGradient>
      </Defs>
      <G rotation={used ? USED_TILT.angle : 0} originX={USED_TILT.cx} originY={USED_TILT.cy}>
        <G rotation={chocolate.rotate} originX={chocolate.cx} originY={chocolate.cy}>
          <Rect x={chocolate.x} y={chocolate.y} width={chocolate.width} height={chocolate.height} rx={chocolate.rx} fill={C.chocolate} />
          <Rect x={chocolate.x} y={chocolate.wrapperY} width={chocolate.width} height={chocolate.wrapperHeight} rx={1} fill={C.wrapper} />
          <Path d={P.chocolateLines} stroke={C.chocolateLine} strokeWidth={0.7} />
        </G>
        <Circle cx={tangerine.cx} cy={tangerine.cy} r={TREATS.tangerine.r} fill={`url(#${ids}tangerine)`} />
        <Path d={leafPath(tangerine)} fill={C.leaf} />
        <Ellipse cx={nut.cx} cy={nut.cy} rx={nut.rx} ry={nut.ry} fill={C.nut} />
        <Path d={P.nutLine} stroke={C.nutLine} strokeWidth={0.6} fill="none" />
        <Path d={P.shaft} fill={`url(#${ids}felt)`} />
        <Path d={P.shaft} fill={`url(#${ids}shade)`} />
        <Path d={P.seam} stroke={C.seam} strokeWidth={0.7} strokeDasharray="1.6 1.4" opacity={0.8} />
        <Path d={P.sole} fill={C.sole} />
        <Path d={P.shine} stroke="#ffffff" strokeWidth={1.6} strokeLinecap="round" opacity={0.22} fill="none" />
        <Rect x={FUR_BAND.x} y={FUR_BAND.y} width={FUR_BAND.width} height={FUR_BAND.height} rx={FUR_BAND.rx} fill={C.furBase} />
        {FUR.map(([x, y, r]) => <Circle key={`${x}-${y}`} cx={x} cy={y} r={r} fill={C.fur} />)}
        <Path d={P.furShadow} stroke={C.furShadow} strokeWidth={0.8} fill="none" opacity={0.9} />
      </G>
    </Svg>
  );
}

/** Der Gutschein allein, auf derselben Zeichenfläche - hinter den Stiefel gelegt. */
export function VoucherSvg({ height }: { height: number }) {
  const { voucher } = TREATS;
  return (
    <Svg width={bootWidth(height)} height={height} viewBox={VIEWBOX}>
      <G rotation={voucher.rotate} originX={voucher.cx} originY={voucher.cy}>
        <Rect x={voucher.x} y={voucher.y} width={voucher.width} height={voucher.height} rx={voucher.rx} fill={C.voucher} stroke={C.voucherEdge} strokeWidth={0.6} />
        <Path d={P.star} fill={C.star} />
      </G>
    </Svg>
  );
}
