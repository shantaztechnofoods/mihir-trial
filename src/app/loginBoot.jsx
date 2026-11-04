// BUILD-TIME ONLY (never imported by the app). scripts/vite-login-boot.mjs
// renders the real login screen (LoginPage.jsx) to static HTML with this, and
// puts it into index.html, so the sign-in card shows — and can be typed into —
// before any JavaScript has downloaded. Rendering the component itself (not a
// hand-made copy) keeps the boot copy identical to the live screen.
// LoginPage takes over from it on mount (readBootShell in LoginPage.jsx).
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AuthContext } from "../auth/AuthContext.jsx";
import LoginPage from "./LoginPage.jsx";

// Never called: the boot copy's Sign In is queued until the app has loaded.
const notYet = async () => ({ success: false, error: "Still loading — please try again." });

export function renderLoginBoot() {
  return renderToStaticMarkup(
    React.createElement(AuthContext.Provider, { value: { login: notYet } }, React.createElement(LoginPage)),
  );
}
