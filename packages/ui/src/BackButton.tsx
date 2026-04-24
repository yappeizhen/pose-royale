import { useCallback, useEffect, useRef, useState } from "react";
import { useBackAction } from "./BackScope.js";

export interface BackButtonProps {
  /** Override navigate() for SPA routing. Without this, falls back to location.assign(to). */
  navigate?: (to: string) => void;
  /**
   * Override the in-app confirm prompt. Receives the message and returns true to proceed.
   * Defaults to a themed modal rendered by this component (see `.confirm-dialog` styles).
   * Pass your own for tests or if you need to integrate with a different dialog system.
   */
  confirm?: (message: string) => boolean | Promise<boolean>;
  className?: string;
  label?: string;
}

interface PendingConfirm {
  message: string;
  resolve: (ok: boolean) => void;
}

/**
 * Context-aware back button. Every screen renders one at top-left.
 * Also binds to the Escape key so you always have a keyboard escape hatch.
 *
 * Forfeit actions (both solo and multiplayer) always prompt for confirmation via a
 * themed modal — native `window.confirm` is visually jarring and breaks the game's
 * aesthetic. Consumers can override the prompt via the `confirm` prop (useful in tests).
 */
export function BackButton({
  navigate,
  confirm: confirmOverride,
  className,
  label = "Back",
}: BackButtonProps) {
  const action = useBackAction();

  // Pending confirm request; non-null means the modal is open awaiting a choice.
  const [pending, setPending] = useState<PendingConfirm | null>(null);

  /**
   * Resolves to true if the user accepts the message. If `confirmOverride` is provided
   * we defer to it (bypassing the modal). Otherwise we open the in-app dialog and the
   * returned promise resolves when the user clicks Cancel or Confirm.
   */
  const askConfirm = useCallback(
    (message: string): Promise<boolean> => {
      if (confirmOverride) {
        return Promise.resolve(confirmOverride(message));
      }
      return new Promise((resolve) => {
        setPending({ message, resolve });
      });
    },
    [confirmOverride],
  );

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
        // Both solo and multiplayer prompt — leaving mid-gauntlet throws away the
        // player's progress either way, and multiplayer additionally hands the match
        // to the opponent. The message adapts so the stakes are clear.
        const message = action.solo
          ? "Exit the gauntlet? Your scores from this match will be lost."
          : "Exit the match? Your scores will be lost and your opponent wins by forfeit.";
        const ok = await askConfirm(message);
        if (ok) await action.onForfeit();
        break;
      }
      case "custom":
        await action.run();
        break;
    }
  }, [action, navigate, askConfirm]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // While the confirm modal is open we let its own handler own Escape so that
      // tapping Esc cancels the prompt instead of re-triggering the back action.
      if (pending) return;
      if (e.key === "Escape") void trigger();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [trigger, pending]);

  const handleResolve = useCallback(
    (ok: boolean) => {
      if (!pending) return;
      pending.resolve(ok);
      setPending(null);
    },
    [pending],
  );

  const classes = className ? `back-button ${className}` : "back-button";
  return (
    <>
      <button
        type="button"
        className={classes}
        onClick={() => void trigger()}
        aria-label={label}
      >
        <span aria-hidden>←</span>
        <span>{label}</span>
      </button>
      {pending ? (
        <ConfirmDialog
          message={pending.message}
          onCancel={() => handleResolve(false)}
          onConfirm={() => handleResolve(true)}
        />
      ) : null}
    </>
  );
}

interface ConfirmDialogProps {
  message: string;
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * Themed confirm modal used for forfeit/exit prompts. Positioned via `.confirm-dialog*`
 * classes in the consumer app (apps/web/src/index.css) so the UI package stays CSS-free.
 *
 * Keyboard: Escape cancels, Enter confirms. Focus traps onto the confirm button on open
 * so keyboard users can immediately hit Enter if they know what they want.
 */
function ConfirmDialog({ message, onCancel, onConfirm }: ConfirmDialogProps) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    confirmRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      } else if (e.key === "Enter") {
        e.preventDefault();
        onConfirm();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel, onConfirm]);

  return (
    <div
      className="confirm-dialog__backdrop"
      onClick={onCancel}
      role="presentation"
    >
      <div
        className="confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-message"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="confirm-dialog-title" className="confirm-dialog__title">
          Hold up!
        </h2>
        <p id="confirm-dialog-message" className="confirm-dialog__message">
          {message}
        </p>
        <div className="confirm-dialog__actions">
          <button
            type="button"
            className="confirm-dialog__btn confirm-dialog__btn--cancel"
            onClick={onCancel}
          >
            Keep playing
          </button>
          <button
            ref={confirmRef}
            type="button"
            className="confirm-dialog__btn confirm-dialog__btn--confirm"
            onClick={onConfirm}
          >
            Exit
          </button>
        </div>
      </div>
    </div>
  );
}
