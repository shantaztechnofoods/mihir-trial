// SHANTAZ ERP — Machine Tracker hooks (folder-replace Phase C, docs/SHELL-CONTEXT.md).
// Moved verbatim from src/app/App.jsx. A hook must run before App's auth-gate
// early returns, where the shell object does not exist yet, so App.jsx calls
// useMachineTrackerHooks({ … }) at the hook's old place with the values it reads
// (same hook order, same deps).
import { useCallback } from "react";
import { writeLastSeenReady } from "../../utils/readyPopup.js";

export function useMachineTrackerHooks(hookShell) {
  const { readyUid, setReadySeen } = hookShell;
  const markReadySeen = useCallback(() => {
    const now = Date.now();
    writeLastSeenReady(readyUid, now);
    setReadySeen((prev) => ({ ...prev, at: now }));
  }, [readyUid]);
  return { markReadySeen };
}
