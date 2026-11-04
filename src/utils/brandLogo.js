// The owner's real SHANTAZ logo (cleaned CorelDRAW vector, true colours) for
// printed documents: report letterheads, the trial certificate and the
// History & Reports PDF. A data URI so it also prints from pop-up windows
// that have no base URL, and stays vector (sharp at any print size).
import svgRaw from "../assets/shantaz-logo.svg?raw";

export const BRAND_LOGO_SVG = svgRaw;
export const BRAND_LOGO_DATA_URI = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svgRaw);
