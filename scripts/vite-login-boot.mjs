// Login boot screen (2026-11-04, perf/login-fast) — a Vite plugin.
//
// The login screen used to appear only after the WHOLE app had downloaded and
// started (1.5 MB of JavaScript; ~4.4 s on a throttled phone). This plugin puts
// the login screen into index.html itself, so it paints with the HTML:
//
//   <!--login-boot-head-->  → critical CSS (the login rules, cut from
//                             src/world-ui.css + the tokens they use), the Inter
//                             preload, and the file lists the page needs later
//   <!--login-boot-->       → the login screen, rendered from the REAL
//                             src/app/LoginPage.jsx (src/app/loginBoot.jsx), plus
//                             a tiny script: password unlock-on-focus, Show,
//                             focus rings, Sign In queued until the app is up,
//                             and "preload the 3D logo chunk right after first paint"
//
// Build only, also: the app stylesheet stops blocking the first paint (it is
// preloaded and applied on load; main.jsx waits for it before React renders).
// LoginPage.jsx takes over from the boot copy on mount (readBootShell).
// Dev server: same boot screen (no preloads / file lists).
import fs from "node:fs";
import path from "node:path";

const LOGIN_START = "/* ═══ LOGIN";
const LOGIN_END = "/* ═══ STAFF MACHINE TRACKER";
const INTER = {
  latin: { file: "inter-latin-opsz-normal.woff2", range: "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD" },
  ext: { file: "inter-latin-ext-opsz-normal.woff2", range: "U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF" },
};

const between = (s, a, b) => { const i = s.indexOf(a); const j = s.indexOf(b, i + 1); if (i < 0 || j < 0) throw new Error(`login-boot: markers not found (${a} … ${b})`); return s.slice(i, j); };
const fontFace = (f, href) => `@font-face{font-family:'Inter';font-style:normal;font-display:swap;font-weight:100 900;src:url(${href}) format('woff2-variations'),url(${href}) format('woff2');unicode-range:${f.range}}`;

// The login rules exactly as the app stylesheet has them, plus the base rules
// (Tailwind preflight subset) they rely on. Everything here also exists in the
// app stylesheet, so nothing changes when that arrives.
export function criticalCss(root, fontHref) {
  const wu = fs.readFileSync(path.join(root, "src/world-ui.css"), "utf8");
  const tokens = (wu.match(/:root\s*\{[\s\S]*?\n\}/) || [""])[0];
  const login = between(wu, LOGIN_START, LOGIN_END);
  const keyframes = ["wu-rise", "wu-fade"].map((k) => (wu.match(new RegExp(`@keyframes ${k} \\{[^\\n]*\\}`)) || [""])[0]).join("\n");
  const made = (wu.match(/^\s*\.made-in-india[^\n]*$/gm) || []).join("\n");
  if (!tokens || !login.includes(".lg-card") || !made) throw new Error("login-boot: login styles not found in src/world-ui.css");
  const base = [
    "*,::before,::after{box-sizing:border-box;border:0 solid #e5e7eb}",
    "html{line-height:1.5;-webkit-text-size-adjust:100%;tab-size:4}",
    "html,body,#root{height:100%;margin:0;padding:0}",
    "body{line-height:inherit;font-family:var(--font-ui);font-optical-sizing:auto;font-feature-settings:\"cv02\",\"cv03\",\"cv04\",\"cv11\";-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;text-rendering:optimizeLegibility}",
    "h1,h2{font-size:inherit;font-weight:inherit}h1,h2,p{margin:0}",
    "button,input{font-family:inherit;font-feature-settings:inherit;font-variation-settings:inherit;font-size:100%;font-weight:inherit;line-height:inherit;letter-spacing:inherit;color:inherit;margin:0;padding:0}",
    "button{text-transform:none;background-color:transparent;background-image:none;cursor:pointer}:disabled{cursor:default}",
    "svg{display:block;vertical-align:middle}",
    ".sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border-width:0}",
    "[data-has-session] #login-boot{display:none}",
  ].join("\n");
  return [fontFace(INTER.ext, fontHref.ext), fontFace(INTER.latin, fontHref.latin), tokens, base, `@media screen{\n${keyframes}\n${made}\n}`, login].join("\n");
}

// Runs right after the boot markup is parsed (before first paint). Keep the
// hero rules in step with probeHero() in src/app/LoginPage.jsx.
const BOOT_JS = `(function(){
var R=document.getElementById("login-boot");if(!R)return;var B=window.__LOGIN_BOOT={submitted:false};
try{var c=String((JSON.parse(localStorage.getItem("erp_settings")||"{}")||{}).companyName||"").trim();if(c){var h=R.querySelector(".lg-card-head"),e=document.createElement("p");e.className="lg-eyebrow";e.textContent=c;h.insertBefore(e,h.firstChild);var t=R.querySelector("h1");if(t)t.textContent=t.textContent.replace(/^SHANTAZ/,c);}}catch(x){}
var hero="still";try{var n=navigator||{},rm=window.matchMedia&&window.matchMedia("(prefers-reduced-motion: reduce)").matches,low=(n.deviceMemory&&n.deviceMemory<=2)||(n.connection&&n.connection.saveData)||(n.hardwareConcurrency&&n.hardwareConcurrency<=2);hero=rm||low?"still":typeof window.WebGLRenderingContext==="undefined"?"css":"webgl";}catch(x){}
B.hero=hero;var P=R.querySelector(".lg-poster");if(P){if(hero!=="webgl")P.classList.remove("lg-poster--3d");P.setAttribute("data-hero",hero);}
var u=R.querySelector("#login-username"),p=R.querySelector("#login-password"),f=R.querySelector("form"),eye=R.querySelector(".lg-eye"),btn=R.querySelector(".lg-submit");
if(!u||!p||!f||!btn)return;
var open=function(){p.readOnly=false;};p.addEventListener("pointerdown",open);p.addEventListener("focus",open);
var fld=function(e,on){var x=e.target&&e.target.closest&&e.target.closest(".lg-field");if(x)x.classList[on?"add":"remove"]("is-focus");};
R.addEventListener("focusin",function(e){fld(e,1);});R.addEventListener("focusout",function(e){fld(e,0);});
if(eye)eye.addEventListener("click",function(){var s=p.type==="password";p.type=s?"text":"password";eye.setAttribute("aria-pressed",s?"true":"false");eye.setAttribute("aria-label",s?"Hide password":"Show password");open();p.focus();});
f.addEventListener("submit",function(e){e.preventDefault();if(B.submitted)return;if(!u.value.trim()||!p.value){(u.value.trim()?p:u).focus();return;}
B.submitted=true;btn.disabled=true;btn.classList.add("is-busy");btn.setAttribute("aria-busy","true");var i=btn.querySelector("svg");if(i){var s=document.createElement("span");s.className="lg-spin";s.setAttribute("aria-hidden","true");i.parentNode.replaceChild(s,i);}var l=btn.querySelector("span:last-child");if(l)l.textContent="Signing in\\u2026";});
if(hero==="webgl"){var F=(window.__LOGIN_BOOT_FILES&&window.__LOGIN_BOOT_FILES.three)||[];requestAnimationFrame(function(){setTimeout(function(){F.forEach(function(h){var l=document.createElement("link");l.rel="modulepreload";l.crossOrigin="";l.href=h;document.head.appendChild(l);});},0);});}
})();`;

// Stored sign-in → the app opens straight to its own "restoring" screen: hide the boot login.
const headJs = (files) => `window.__LOGIN_BOOT_FILES=${JSON.stringify(files)};try{if(localStorage.getItem("erp_supabase_session")||localStorage.getItem("erp_session"))document.documentElement.setAttribute("data-has-session","")}catch(e){}`;

async function renderMarkup(root, server) {
  // quiet: the app modules log their config when they load
  const keep = { log: console.log, info: console.info, warn: console.warn };
  let own = null;
  try {
    console.log = console.info = console.warn = () => {};
    if (!server) {
      const { createServer } = await import("vite");
      own = await createServer({
        configFile: false, root, mode: "production", logLevel: "silent", appType: "custom",
        server: { middlewareMode: true, hmr: false, watch: null, ws: false },
        optimizeDeps: { noDiscovery: true, include: [] }, esbuild: { jsx: "automatic" },
      });
    }
    const mod = await (own || server).ssrLoadModule("/src/app/loginBoot.jsx");
    return mod.renderLoginBoot();
  } finally {
    Object.assign(console, keep);
    if (own) await own.close();
  }
}

// The boot copy: same markup, its own id, a native submit that can never send
// the password anywhere, autofocus on the username (as the live screen).
export function bootMarkup(html) {
  let m = html;
  const swap = (re, to, what) => { if (!re.test(m)) throw new Error(`login-boot: ${what} not found in the rendered LoginPage`); m = m.replace(re, to); };
  swap(/data-login-screen="(?:true)?"/, 'id="login-boot" data-login-boot=""', "data-login-screen");
  swap(/<form /, '<form method="post" onsubmit="return false" ', "<form>");
  if (!/id="login-username"[^>]*autofocus/.test(m)) swap(/id="login-username"/, 'id="login-username" autofocus=""', "#login-username");
  if (!/class="[^"]*lg-poster/.test(m)) throw new Error("login-boot: the logo poster is missing from the rendered LoginPage");
  return m;
}

// chunk + every chunk it imports, minus what the entry already loads
function chunkFiles(bundle, facadeEnd, base) {
  const chunks = Object.values(bundle).filter((c) => c.type === "chunk");
  const byFile = new Map(chunks.map((c) => [c.fileName, c]));
  const entrySet = new Set();
  const walk = (f, set) => { if (set.has(f)) return; set.add(f); (byFile.get(f)?.imports || []).forEach((i) => walk(i, set)); };
  chunks.filter((c) => c.isEntry).forEach((c) => walk(c.fileName, entrySet));
  const ends = (id) => !!id && id.replace(/\\/g, "/").endsWith(facadeEnd);
  // the chunk whose entry module it is (Rollup may leave facadeModuleId empty when it merges modules)
  const top = chunks.find((c) => ends(c.facadeModuleId)) || chunks.find((c) => c.isDynamicEntry && (c.moduleIds || Object.keys(c.modules || {})).some(ends));
  if (!top) return [];
  const set = new Set(); walk(top.fileName, set);
  return [...set].filter((f) => !entrySet.has(f)).map((f) => base + f);
}

export default function loginBoot() {
  let root = process.cwd(), base = "/", isBuild = false;
  return {
    name: "shantaz-login-boot",
    configResolved(c) { root = c.root; base = c.base || "/"; isBuild = c.command === "build"; },
    transformIndexHtml: {
      order: "post",
      async handler(html, ctx) {
        if (!html.includes("<!--login-boot-->")) return html;
        let markup = "";
        try { markup = bootMarkup(await renderMarkup(root, ctx.server)); }
        catch (e) { if (isBuild) throw e; console.warn("[login-boot] skipped in dev:", e && e.message); }
        const bundle = ctx.bundle || null;
        const assetHref = (file) => {
          if (!bundle) return `/src/assets/fonts/${file}`;
          const stem = file.replace(/\.woff2$/, "");
          const a = Object.values(bundle).find((x) => x.type === "asset" && new RegExp(`(^|/)${stem}-[\\w-]+\\.woff2$`).test(x.fileName));
          if (!a) throw new Error(`login-boot: ${file} not in the build`);
          return base + a.fileName;
        };
        const fontHref = { latin: assetHref(INTER.latin.file), ext: assetHref(INTER.ext.file) };
        const files = bundle ? { three: chunkFiles(bundle, "/src/shared/components/LoginBrand3D.jsx", base), app: chunkFiles(bundle, "/src/app/App.jsx", base) } : { three: [], app: [] };
        if (bundle && (!files.three.length || !files.app.length)) throw new Error("login-boot: the 3D logo / app chunks were not found in the build");
        const head = [
          bundle ? `<link rel="preload" as="font" type="font/woff2" crossorigin href="${fontHref.latin}">` : "",
          `<style id="login-critical">${criticalCss(root, fontHref)}</style>`,
          `<script>${headJs(files)}</script>`,
        ].join("\n    ");
        let out = html.replace("<!--login-boot-head-->", head).replace("<!--login-boot-->", markup ? `${markup}<script>${BOOT_JS}</script>` : "");
        if (bundle) {
          // the app stylesheet no longer blocks the first paint (main.jsx waits for it before React renders)
          out = out.replace(/<link rel="stylesheet" crossorigin href="([^"]+\.css)">/g, (all, href) =>
            `<link rel="preload" as="style" crossorigin href="${href}" data-app-css onload="this.onload=null;this.rel='stylesheet'">\n    <noscript>${all}</noscript>`);
          if (!out.includes("data-app-css")) throw new Error("login-boot: app stylesheet link not found");
        }
        return out;
      },
    },
  };
}
