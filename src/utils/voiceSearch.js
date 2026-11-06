// Voice search (2026-11-06) — turns spoken words into what a worker would
// type in the global search. Pure, no React, no storage.
//
//   "M ten" / "M-10" / "em 10" / "m10"      -> "M-10"
//   "S N 103" / "es en one oh three"        -> "SN-103"
//   "एम 10" / "એમ દસ" / "M १०"              -> "M-10"
//   "search for kneading machine."          -> "kneading machine"
//
// A run of single letters followed by a number becomes one code
// LETTERS-NUMBER. Other words stay as spoken (lower case), number words
// become digits. Letter names that are also everyday English words
// ("see", "you", "are", "why", "be", "tea"; Hindi/Gujarati "के"/"કે") are
// not treated as letters.

const DIGIT_SCRIPTS = /[०-९૦-૯]/g; // Devanagari ०-९, Gujarati ૦-૯
const toAsciiDigits = (s) => s.replace(DIGIT_SCRIPTS, (c) => String(c.charCodeAt(0) - (c.charCodeAt(0) >= 0x0AE6 ? 0x0AE6 : 0x0966)));

// Letter names -> letter (English spelling as dictation writes it, plus
// Devanagari / Gujarati spellings of the English letter names).
const LETTER_NAMES = {
  em: "m", emm: "m", en: "n", enn: "n", es: "s", ess: "s", ef: "f", eff: "f", el: "l", ell: "l", ex: "x",
  bee: "b", cee: "c", dee: "d", gee: "g", jay: "j", kay: "k", pee: "p", vee: "v", zed: "z", zee: "z", aitch: "h", ar: "r",
  "ए": "a", "बी": "b", "सी": "c", "डी": "d", "ई": "e", "एफ": "f", "जी": "g", "एच": "h", "आई": "i", "जे": "j",
  "एल": "l", "एम": "m", "एन": "n", "ओ": "o", "पी": "p", "क्यू": "q", "आर": "r", "एस": "s", "टी": "t", "यू": "u", "वी": "v",
  "एक्स": "x", "वाई": "y", "जेड": "z", "ज़ेड": "z",
  "એ": "a", "બી": "b", "સી": "c", "ડી": "d", "ઈ": "e", "એફ": "f", "જી": "g", "એચ": "h", "આઈ": "i", "જે": "j",
  "એલ": "l", "એમ": "m", "એન": "n", "ઓ": "o", "પી": "p", "આર": "r", "એસ": "s", "ટી": "t", "યુ": "u", "વી": "v",
  "એક્સ": "x", "વાય": "y", "ઝેડ": "z",
};

// Number words -> value. English (Latin and as Hindi/Gujarati script writes
// it) plus Hindi / Gujarati 1-10 in their own script.
const UNITS = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  "ज़ीरो": 0, "जीरो": 0, "वन": 1, "टू": 2, "थ्री": 3, "फोर": 4, "फ़ोर": 4, "फाइव": 5, "सिक्स": 6, "सेवन": 7, "एट": 8, "नाइन": 9,
  "ઝીરો": 0, "વન": 1, "ટુ": 2, "થ્રી": 3, "ફોર": 4, "ફાઇવ": 5, "સિક્સ": 6, "સેવન": 7, "એઇટ": 8, "નાઇન": 9,
  "एक": 1, "दो": 2, "तीन": 3, "चार": 4, "पांच": 5, "पाँच": 5, "छह": 6, "छः": 6, "सात": 7, "आठ": 8, "नौ": 9,
  "એક": 1, "બે": 2, "ત્રણ": 3, "ચાર": 4, "પાંચ": 5, "છ": 6, "સાત": 7, "આઠ": 8, "નવ": 9,
};
const TEENS = {
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
  "टेन": 10, "दस": 10, "ટેન": 10, "દસ": 10,
};
const TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const HUNDRED = new Set(["hundred", "हंड्रेड", "सौ", "હન્ડ્રેડ", "સો"]);

const LEAD_COMMANDS = /^(?:please\s+)?(?:search\s+for|search|find\s+me|find|show\s+me|show|open|look\s+for|go\s+to)\s+/i;

const isDigits = (t) => /^\d+$/.test(t);
const isNumWord = (t) => t in UNITS || t in TEENS || t in TENS || HUNDRED.has(t);
const isNumTok = (t) => isDigits(t) || isNumWord(t);
const isOh = (t) => t === "oh" || t === "o";

// A run of number tokens -> digits. "one oh three" / "1 0 3" -> "103";
// "twenty five" -> "25"; "one hundred three" -> "103"; "103" -> "103".
function runToNumber(run) {
  const single = run.every((t) => isOh(t) || (isDigits(t) ? t.length === 1 : (t in UNITS)));
  if (single && run.length > 1) return run.map((t) => (isOh(t) ? "0" : isDigits(t) ? t : String(UNITS[t]))).join("");
  let out = ""; let cur = null;
  const flush = () => { if (cur !== null) { out += String(cur); cur = null; } };
  for (const t of run) {
    if (isOh(t)) { flush(); out += "0"; continue; }
    if (isDigits(t)) { flush(); out += t; continue; }
    if (HUNDRED.has(t)) { cur = (cur || 1) * 100; continue; }
    const v = t in UNITS ? UNITS[t] : t in TEENS ? TEENS[t] : TENS[t];
    if (cur === null) cur = v;
    else if (cur % 100 === 0 && cur >= 100 && v < 100) cur += v;        // hundred three
    else if (cur % 10 === 0 && cur >= 20 && cur < 100 && v < 10) cur += v; // twenty five
    else { flush(); cur = v; }
  }
  flush();
  return out;
}

export function normalizeVoiceQuery(text) {
  // "SN 103" (capitals, as dictation writes codes) or "sn 103" (no vowel —
  // not a word) -> glued, so the code rule below picks it up.
  let s = toAsciiDigits(String(text || ""))
    .replace(/(^|[\s.,])([A-Z]{2,3})\s+(\d)/g, "$1$2$3")
    .toLowerCase()
    .replace(/(^|[\s.,])([b-df-hj-np-tv-z]{2,3})\s+(\d)/g, "$1$2$3");
  s = s.replace(/[.,!?।॥;:"“”'’()]/g, " ").replace(/\s+/g, " ").trim();
  s = s.replace(LEAD_COMMANDS, "");
  // Glued or hyphenated codes: "sn103", "sn-103", "m-10" -> "s n 103", "m 10".
  s = s.replace(/(^|\s)([a-z]{1,3})(?:\s*-\s*)?(\d+)(?=\s|$)/g, (_, pre, l, n) => `${pre}${LETTER_NAMES[l] || l.split("").join(" ")} ${n}`);
  s = s.replace(/-/g, " ");
  const toks = s.split(" ").filter(Boolean);

  const out = [];
  for (let i = 0; i < toks.length;) {
    // Try: letters (single letters or letter names) followed by a number run.
    let j = i; const letters = [];
    while (j < toks.length) {
      const t = toks[j];
      const l = /^[a-z]$/.test(t) ? t : LETTER_NAMES[t];
      if (!l) break;
      letters.push(l); j++;
    }
    let k = j; const nums = [];
    while (k < toks.length && (isNumTok(toks[k]) || (nums.length && isOh(toks[k])))) { nums.push(toks[k]); k++; }
    if (letters.length && nums.length) {
      out.push(`${letters.join("").toUpperCase()}-${runToNumber(nums)}`);
      i = k; continue;
    }
    // Plain number run.
    if (isNumTok(toks[i])) {
      let m = i; const run = [];
      while (m < toks.length && (isNumTok(toks[m]) || (run.length && isOh(toks[m])))) { run.push(toks[m]); m++; }
      out.push(runToNumber(run)); i = m; continue;
    }
    out.push(toks[i]); i++;
  }
  return out.join(" ").trim();
}
