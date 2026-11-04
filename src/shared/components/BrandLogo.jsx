import React, { useEffect, useState } from "react";
import { SUPABASE_URL } from "../../config/env.js";

// The original SHANTAZ logo, shown exactly as uploaded — never redrawn,
// recoloured or re-encoded. Source order:
//   1. `logo` prop (Settings → Company logo, the ERP's own copy)
//   2. the copy cached in this browser the last time (1) was available —
//      this is what lets the login screen, which loads before any settings
//      exist, show the real logo
//   3. the copy in the public `item-media` storage bucket
//   4. a plain text wordmark, only if every image fails to load.
const CACHE_KEY = "shantaz.brandLogo.v1";
const BUCKET_LOGO =
  "/storage/v1/object/public/item-media/photos/9e93b796-1abf-42f4-9387-bc65db9d008b-Shantaz_Logo_bg___1_.png";

const readCache = () => { try { return localStorage.getItem(CACHE_KEY) || ""; } catch { return ""; } };
const writeCache = (v) => { try { if (v && v.length < 900000) localStorage.setItem(CACHE_KEY, v); } catch {} };

export default function BrandLogo({ logo = "", size = 44, className = "", rounded = 12, label = "SHANTAZ" }) {
  const bucket = SUPABASE_URL ? SUPABASE_URL.replace(/\/$/, "") + BUCKET_LOGO : "";
  const sources = [logo, readCache(), bucket].filter(Boolean);
  const [idx, setIdx] = useState(0);
  useEffect(() => { setIdx(0); }, [logo]);
  useEffect(() => { if (logo) writeCache(logo); }, [logo]);
  const src = sources[idx];
  const box = {
    width: size, height: size, borderRadius: rounded, flexShrink: 0, overflow: "hidden",
    background: "#E8E8E8", display: "flex", alignItems: "center", justifyContent: "center",
  };
  return (
    <span className={`brand-logo ${className}`} style={box} role="img" aria-label="SHANTAZ — Innovation for Life">
      {src ? (
        <img src={src} alt="" draggable={false}
             onError={() => setIdx((i) => i + 1)}
             style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }} />
      ) : (
        <span style={{ color: "#E10E1A", fontWeight: 800, fontSize: Math.max(8, size / 7.2), letterSpacing: ".02em" }}>{label}</span>
      )}
    </span>
  );
}
