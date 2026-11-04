import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// 2026-11-04 (fix/perf-1) — open the connection to Supabase while the HTML is
// still parsing (DNS + TLS ≈ 100–300 ms on a phone), so the first login / data
// request does not pay for it. Only added when a Supabase URL is configured.
function supabasePreconnect(url) {
  return {
    name: 'supabase-preconnect',
    transformIndexHtml() {
      let origin = '';
      try { origin = url ? new URL(url).origin : ''; } catch { origin = ''; }
      if (!origin) return [];
      return [
        { tag: 'link', attrs: { rel: 'preconnect', href: origin, crossorigin: '' }, injectTo: 'head-prepend' },
        { tag: 'link', attrs: { rel: 'dns-prefetch', href: origin }, injectTo: 'head-prepend' },
      ];
    },
  };
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const supaUrl = (process.env.VITE_SUPABASE_URL || env.VITE_SUPABASE_URL || '').trim();
  return {
    plugins: [react(), supabasePreconnect(supaUrl)],
    esbuild: {
      // Strip noisy dev logging from production bundles. console.warn / console.error
      // are intentionally KEPT so production issues remain diagnosable.
      pure: ['console.log', 'console.info', 'console.debug'],
    },
    build: {
      // The app is one large App.jsx. Vendor deps are split out below; heavy
      // libraries that only some screens need (recharts, xlsx) and the admin-only
      // pages are loaded on demand with dynamic import() — see LazyCharts.jsx.
      chunkSizeWarningLimit: 1400,
      rollupOptions: {
        output: {
          // Split stable third-party deps out of the main app chunk for better
          // long-term caching (vendor code changes far less often than app code).
          // Function form so react-dom + scheduler really land in react-vendor
          // (the object form left them inside the charts chunk). 'charts' and
          // xlsx are only reached through dynamic import(), so neither is part
          // of the first download (tests/e2e/perf-budget.mjs checks this).
          manualChunks(id) {
            if (!id.includes('node_modules')) return undefined;
            if (/node_modules\/(react|react-dom|scheduler)\//.test(id)) return 'react-vendor';
            if (id.includes('node_modules/@supabase/')) return 'supabase';
            // recharts and the packages only it uses: one named on-demand chunk.
            if (/node_modules\/(recharts|recharts-scale|react-smooth|victory-vendor|d3-[a-z-]+|internmap|decimal\.js-light|lodash)\//.test(id)) return 'charts';
            return undefined;
          },
        },
      },
    },
  };
})
