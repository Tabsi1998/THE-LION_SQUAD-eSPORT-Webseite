// Adressen aus einem Türchen (#641, #642): seit #921 derselbe Weg wie für jeden Link in der App (`lib/openLink`) - eigene
// Seiten im Screen, alles andere im Browser, fremde Adressen nie als eigener Screen.
export { WEB_BASE_URL, ownPath } from "../lib/siteUrls";
export { openLink as openDoorLink, type LinkResult } from "../lib/openLink";
