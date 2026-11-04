// src/modules/whatsapp/waHelpers.js — moved verbatim from the former single-file src/App.jsx
// (module-folder split, 2026-11-04). Behaviour is unchanged; see this folder's README.md.


// Same name always gets the same avatar colour, so a person is recognisable
// down the list without storing anything.
export const WA_AVATAR_COLORS = ["#0ea5e9", "#8b5cf6", "#ec4899", "#f59e0b", "#10b981", "#6366f1", "#ef4444", "#14b8a6"];

export function waAvatarColor(seed = "") {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return WA_AVATAR_COLORS[h % WA_AVATAR_COLORS.length];
}

// ── WhatsApp number book ─────────────────────────────────────────────────
// Chakra only knows the digits a message came from, so without this the inbox
// reads as a column of phone numbers and nobody can tell the packing supervisor
// from a wrong number. The book lives in the same settings row as the rest of
// the WhatsApp config, so it follows the operator across devices and the
// alert sender keeps reading the plain comma list it always has.
export function waParseDirectory(raw) {
  if (Array.isArray(raw)) return raw;
  try {
    const v = JSON.parse(raw || "[]");
    return Array.isArray(v) ? v : [];
  } catch { return []; }
}

// WhatsApp hands back "919327443134", a person types "+91 93274 43134", and
// both have to match the same row. Comparing only the last 10 digits sidesteps
// country code, spaces and the leading +.
export function waPhoneKey(phone = "") {
  const d = String(phone).replace(/[^0-9]/g, "");
  return d.length > 10 ? d.slice(-10) : d;
}

// ── Unread tracking ──────────────────────────────────────────────────────
// Chakra's chat list carries no unread flag, so "seen" is kept here: the
// timestamp of the newest message that was on screen when a thread was last
// opened. Stored in localStorage rather than settings because it is per-person
// — the owner reading a message should not clear it for the store operator.
export const WA_SEEN_KEY = "erp_wa_seen";

export function waReadSeen() {
  try { return JSON.parse(localStorage.getItem(WA_SEEN_KEY) || "{}") || {}; } catch { return {}; }
}

export function waWriteSeen(map) {
  try { localStorage.setItem(WA_SEEN_KEY, JSON.stringify(map)); } catch {}
  // The ERP sidebar badge lives outside this page, so it is told directly
  // instead of polling localStorage.
  try { window.dispatchEvent(new Event("erp-wa-seen")); } catch {}
}

export function waUnreadCount(chats = [], seen = {}) {
  return chats.filter((c) =>
    c.lastDirection === "inbound" &&
    Number(c.lastTs || 0) > Number(seen[c.id] || 0)
  ).length;
}

// ── Alert dispatch ───────────────────────────────────────────────────────
// Every ERP alert goes through here. Plain text only reaches someone who has
// messaged the business number in the last 24 hours; an approved template
// reaches anyone. So when an alert template is chosen in WhatsApp → Templates,
// it is used, and the plain text is kept as the fallback — if the template is
// paused or rejected by Meta, a recipient inside the 24h window still gets the
// alert rather than nothing.
//
// params: the template's {{1}}..{{5}} — type, machine, department, details,
// time. The text message is unchanged from before templates existed.
export function waAlertTime() {
  return new Date().toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

export async function waDispatch(settings, to, message, params) {
  if (!settings?.waApiKey || !to || !message) return;
  const { callWhatsAppFn } = await import("../../stores/adminApi.js");
  const base = { apiKey: settings.waApiKey, pluginId: settings.waPluginId || "", phoneId: settings.waPhoneId || "" };
  const tplName = settings.waAlertTemplate;
  const phones = String(to).split(",").map((p) => p.trim()).filter(Boolean);
  for (const phone of phones) {
    (async () => {
      let res = null;
      if (tplName && Array.isArray(params)) {
        res = await callWhatsAppFn("whatsapp-send", {
          ...base, to: phone,
          template: { name: tplName, language: settings.waAlertTemplateLang || "en", params },
        }).catch((e) => ({ success: false, error: e?.message }));
        if (!res?.success) console.warn("[WhatsApp] template alert failed, falling back to text", phone, res?.error);
      }
      if (!res?.success) {
        res = await callWhatsAppFn("whatsapp-send", { ...base, to: phone, message })
          .catch((e) => ({ success: false, error: e?.message }));
      }
      if (!res?.success) console.warn("[WhatsApp] alert failed for", phone, res?.error);
      if (window.__waLog) window.__waLog(phone, message, res?.success ? "sent" : "failed");
    })();
  }
}
