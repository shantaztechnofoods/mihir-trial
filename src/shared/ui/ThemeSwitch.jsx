// src/shared/ui/ThemeSwitch.jsx — Light / Dark / Auto segmented control (2026-11-05).
// Used in the page header (compact, icons only) and in Settings → Appearance
// (with words). Per-browser choice; see src/shared/theme.js.
import React from "react";
import { Sun, Moon, SunMoon } from "lucide-react";
import { useThemeMode, setThemeMode, THEME_MODES } from "../theme.js";

const OPTIONS = [
  { id: "light", label: "Light", Icon: Sun },
  { id: "dark",  label: "Dark",  Icon: Moon },
  { id: "auto",  label: "Auto",  Icon: SunMoon, hint: "Follow this device" },
];

const isPhone = () => { try { return window.matchMedia("(max-width: 639.98px)").matches; } catch { return false; } };

export function ThemeSwitch({ withLabels = false, className = "" }) {
  const mode = useThemeMode();
  return (
    <div role="radiogroup" aria-label="Colour mode" data-theme-switch={withLabels ? "full" : "compact"}
         className={`theme-switch${withLabels ? " theme-switch-full" : ""} ${className}`}>
      {OPTIONS.map(({ id, label, Icon, hint }) => {
        const on = mode === id;
        return (
          <button key={id} type="button" role="radio" aria-checked={on} data-theme-option={id}
                  aria-label={withLabels ? undefined : `${label} mode${hint ? ` (${hint.toLowerCase()})` : ""}`}
                  title={hint ? `${label} — ${hint}` : `${label} mode`}
                  // On a phone header only the current mode shows (CSS); tapping it moves to the next one.
                  onClick={() => setThemeMode(on && !withLabels && isPhone() ? THEME_MODES[(THEME_MODES.indexOf(id) + 1) % THEME_MODES.length] : id)}>
            <Icon size={withLabels ? 16 : 15} strokeWidth={1.9} aria-hidden="true" />
            {withLabels && <span>{label}</span>}
          </button>
        );
      })}
    </div>
  );
}

export default ThemeSwitch;
