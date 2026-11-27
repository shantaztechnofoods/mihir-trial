// src/shared/ui/ThemeSwitch.jsx — Light / Dark segmented control (2026-11-05; Auto removed 2026-11-27).
// Used in the page header (compact, icons only) and in Settings → Appearance
// (with words). Per-browser choice; see src/shared/theme.js.
import React from "react";
import { Sun, Moon } from "lucide-react";
import { useThemeMode, setThemeMode, THEME_MODES, warmThemeSwitch, coolThemeSwitch } from "../theme.js";

const OPTIONS = [
  { id: "light", label: "Light", Icon: Sun },
  { id: "dark",  label: "Dark",  Icon: Moon },
];

const isPhone = () => { try { return window.matchMedia("(max-width: 639.98px)").matches; } catch { return false; } };

export function ThemeSwitch({ withLabels = false, className = "" }) {
  const mode = useThemeMode();
  return (
    <div role="radiogroup" aria-label="Colour mode" data-theme-switch={withLabels ? "full" : "compact"}
         className={`theme-switch${withLabels ? " theme-switch-full" : ""} ${className}`}
         // perf/inp-theme-toggle: get the dark-only sheet ready while the pointer / focus
         // is on the switch, so the tap itself only flips the tokens (see theme.js).
         onPointerEnter={warmThemeSwitch} onFocus={warmThemeSwitch}
         onPointerLeave={coolThemeSwitch} onBlur={coolThemeSwitch}>
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
