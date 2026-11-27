/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
    "./App.jsx",
  ],
  theme: {
    extend: {},
  },
  plugins: [],
  // perf/inp-theme-toggle (2026-11-27): Tailwind's ~50 "--tw-*" default custom
  // properties were set on EVERY element (* , ::before, ::after); every full
  // restyle (theme switch, page switch) rebuilt them per element. With this
  // flag the same defaults are set only on elements that use a utility that
  // reads them (shadow, ring, transform, filter …). Same computed styles.
  experimental: { optimizeUniversalDefaults: true },
}
