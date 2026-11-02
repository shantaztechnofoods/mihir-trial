// Settings store — single row in public.settings keyed by 'org'.
// Dual path: localStorage when Supabase disabled, Supabase + local cache when enabled.

import { isSupabaseEnabled } from "../config/env.js";
import { getSupabase } from "../supabase/client.js";

const LOCAL_KEY = "erp_settings";

export function getSettingsLocal() {
  try { const s = localStorage.getItem(LOCAL_KEY); if (s) return JSON.parse(s); } catch {}
  return null;
}
function setSettingsLocal(v) {
  try { localStorage.setItem(LOCAL_KEY, JSON.stringify(v)); } catch {}
}

export async function loadSettings() {
  const mode = isSupabaseEnabled() ? "SUPABASE" : "LOCAL";
  console.info("[settings:load] start", { mode });
  if (!isSupabaseEnabled()) {
    const v = getSettingsLocal();
    console.info("[settings:load] local result", v ? "found" : "empty");
    return v;
  }
  const c = getSupabase();
  if (!c) {
    console.warn("[settings:load] supabase client null, falling back to local");
    return getSettingsLocal();
  }
  // Migration 053 — read through get_org_settings(), which strips the
  // WhatsApp / AI secret keys for everyone but a super admin (direct SELECT on
  // settings is super-admin only from 053 on). Until the migration is applied
  // the function does not exist, so fall back to the old table read.
  let value = null;
  const rpc = await c.rpc("get_org_settings");
  if (!rpc.error) {
    value = rpc.data ?? null;
    console.info("[settings:load] supabase rpc result", value ? "found" : "empty");
  } else if (isMissingFunctionError(rpc.error)) {
    console.warn("[settings:load] get_org_settings not deployed yet — falling back to settings table");
    const { data, error } = await c.from("settings").select("value").eq("key", "org").maybeSingle();
    if (error) {
      console.error("[settings:load] supabase error", error);
      return getSettingsLocal();
    }
    console.info("[settings:load] supabase result", data ? "found" : "empty");
    value = data?.value ?? null;
  } else {
    console.error("[settings:load] supabase rpc error", rpc.error);
    return getSettingsLocal();
  }
  if (value) setSettingsLocal(value);
  return value || null;
}

// "function public.get_org_settings() does not exist" (42883) or PostgREST's
// schema-cache variant (PGRST202) — the migration has not been applied yet.
function isMissingFunctionError(err) {
  if (!err) return false;
  if (err.code === "42883" || err.code === "PGRST202") return true;
  return /function .* does not exist|could not find the function|schema cache/i.test(err.message || err.details || err.hint || "");
}

export async function saveSettings(value) {
  const mode = isSupabaseEnabled() ? "SUPABASE" : "LOCAL";
  console.info("[settings:save] start", { mode, keys: Object.keys(value || {}) });
  setSettingsLocal(value); // always cache
  if (!isSupabaseEnabled()) {
    console.info("[settings:save] local-only ok");
    return { success: true };
  }
  const c = getSupabase();
  if (!c) {
    console.warn("[settings:save] supabase client null, saved local only");
    return { success: false, error: "Supabase client not initialized" };
  }
  const { error } = await c.from("settings").upsert({ key: "org", value }, { onConflict: "key" });
  if (error) {
    console.error("[settings:save] supabase upsert failed", error);
    return { success: false, error: error.message };
  }
  console.info("[settings:save] supabase ok");
  return { success: true };
}
