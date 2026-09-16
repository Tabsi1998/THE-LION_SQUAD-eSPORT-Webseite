// Länder als Auswahl statt Freitext (#258). Die Codes sind ISO 3166-1
// alpha-2; die deutschen Namen liefert der Browser (Intl.DisplayNames), damit
// keine 249 Namen im Code stehen und Schreibweisen mit dem System übereinstimmen.

export const COUNTRY_CODES = `
AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ
BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ
CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ
DE DJ DK DM DO DZ
EC EE EG EH ER ES ET
FI FJ FK FM FO FR
GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY
HK HM HN HR HT HU
ID IE IL IM IN IO IQ IR IS IT
JE JM JO JP
KE KG KH KI KM KN KP KR KW KY KZ
LA LB LC LI LK LR LS LT LU LV LY
MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ
NA NC NE NF NG NI NL NO NP NR NU NZ
OM
PA PE PF PG PH PK PL PM PN PR PS PT PW PY
QA
RE RO RS RU RW
SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ
TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ
UA UG UM US UY UZ
VA VC VE VG VI VN VU
WF WS
YE YT
ZA ZM ZW
`.trim().split(/\s+/);

// Die Vereinsländer zuerst, der Rest alphabetisch nach deutschem Namen.
export const PINNED_COUNTRIES = ["AT", "DE", "CH"];

let displayNames = null;
try {
  displayNames = typeof Intl !== "undefined" && Intl.DisplayNames
    ? new Intl.DisplayNames(["de"], { type: "region" })
    : null;
} catch {
  displayNames = null;
}

export function isCountryCode(value) {
  return typeof value === "string" && COUNTRY_CODES.includes(value.toUpperCase());
}

export function countryName(code) {
  if (!code) return "";
  const upper = String(code).trim().toUpperCase();
  if (!isCountryCode(upper)) return String(code);
  try {
    return displayNames?.of(upper) || upper;
  } catch {
    return upper;
  }
}

const collator = new Intl.Collator("de", { sensitivity: "base" });

export const COUNTRY_OPTIONS = (() => {
  const rest = COUNTRY_CODES
    .filter((code) => !PINNED_COUNTRIES.includes(code))
    .map((code) => ({ code, name: countryName(code) }))
    .sort((a, b) => collator.compare(a.name, b.name));
  return [...PINNED_COUNTRIES.map((code) => ({ code, name: countryName(code) })), ...rest];
})();
