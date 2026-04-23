import { useCallback, useEffect } from "react";
import { useBackAction } from "./BackScope.js";

export interface BackButtonProps {
  /** Override navigate() for SPA routing. Without this, falls back to location.assign(to). */
  navigate?: (to: string) => void;
  /** Called before a forfeit/leave action to confirm. Defaults to window.confirm. */
  confirm?: (message: string) => boolean | Promise<boolean>;
  className?: string;
  label?: string;
}

/**
 * Context-aware back button. Every screen renders one at top-left.
 * Also binds to the Escape key so you always have a keyboard escape hatch.
 */
export function BackButton({
  navigate,
  confirm: confirmFn = (m) => Promise.resolve(window.confirm(m)),
  className,
  label = "Back",
}: BackButtonProps) {
  const action = useBackAction();

  const trigger = useCallback(async () => {
    switch (action.kind) {
      case "navigate":
        if (navigate) {
          navigate(action.to);
          break;
        }
        if (window.location.pathname !== action.to) {
          window.location.assign(action.to);
          break;
        }
        if (window.history.length > 1) window.history.back();
        break;
      case "leave-room":
        await action.onLeave();
        break;
      case "forfeit": {
        if (action.solo) {
          await action.onForfeit();
          break;
        }
        const ok = await confirmFn("Leave match? Your opponent will win by forfeit.");
        if (ok) await action.onForfeit();
        break;
      }
      case "custom":
        await action.run();
        break;
    }
  }, [action, navigate, confirmFn]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") void trigger();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [trigger]);

  const classes = className ? `back-button ${className}` : "back-button";
  return (
    <button
      type="button"
      className={classes}
      onClick={() => void trigger()}
      aria-label={label}
    >
      <span aria-hidden>←</span>
      <span>{label}</span>
    </button>
  );
}
