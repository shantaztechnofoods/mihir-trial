// Automatic build tag (2026-11-06). Feature PRs no longer hand-edit the build tag:
// the source keeps APP_BUILD = "auto" (src/shared/buildInfo.js) and
// APP_BUILD_TAG = "auto" (src/main.jsx), and this plugin swaps "auto" for
// "<IST date>-<commit>" when Vite builds or serves the app. Several PRs can now be
// open at once without colliding on the tag lines.
import { execSync } from "node:child_process";

export function buildId() {
  const sha = (process.env.VERCEL_GIT_COMMIT_SHA || process.env.GITHUB_SHA || (() => {
    try { return execSync("git rev-parse HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); } catch { return ""; }
  })()).slice(0, 7);
  const day = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10); // IST date
  return sha ? `${day}-${sha}` : `${day}-dev`;
}

export default function buildIdPlugin() {
  const id = buildId();
  const files = [/src[\\/]shared[\\/]buildInfo\.js$/, /src[\\/]main\.jsx$/];
  return {
    name: "erp-build-id",
    enforce: "pre",
    transform(code, file) {
      if (!files.some((re) => re.test(file))) return null;
      const out = code
        .replace(/(APP_BUILD\s*=\s*)"auto"/, `$1${JSON.stringify(id)}`)
        .replace(/(APP_BUILD_TAG\s*=\s*)"auto"/, `$1${JSON.stringify(id)}`);
      return out === code ? null : { code: out, map: null };
    },
  };
}
