// UI P0 (2026-11-05) — the ONE sonner <Toaster/> for the signed-in app.
// Mounted once in src/app/App.jsx through LazyAppToaster (./lazyUi.js), so sonner
// is never part of the login/entry download. Show toasts with ./toast.js.
// Top-center keeps toasts clear of the phone bottom tab bar and sheet actions.
import { Toaster } from "sonner";

export default function AppToaster() {
  return (
    <Toaster
      position="top-center"
      closeButton
      duration={4000}
      visibleToasts={3}
      gap={8}
      offset={16}
      mobileOffset={12}
      containerAriaLabel="Notifications"
      toastOptions={{ className: "wu-toast", style: { fontFamily: "var(--font-ui)", borderRadius: "var(--r-ctl)" } }}
    />
  );
}
