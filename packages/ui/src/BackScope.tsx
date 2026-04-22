/* eslint-disable react-refresh/only-export-components --
 * This file co-locates the <BackScope> provider and the `useBackAction` hook on purpose — they
 * are one concept and always imported together. React-refresh still works for the provider; the
 * tradeoff for the hook losing HMR is worth the cleaner import surface for consumers.
 */
import { createContext, useContext, useMemo, type ReactNode } from "react";

export type BackAction =
  | { kind: "navigate"; to: string }
  | { kind: "leave-room"; onLeave: () => void | Promise<void> }
  | { kind: "forfeit"; onForfeit: () => void | Promise<void>; solo?: boolean }
  | { kind: "custom"; label: string; run: () => void | Promise<void> };

interface BackScopeValue {
  action: BackAction;
}

const BackScopeContext = createContext<BackScopeValue | null>(null);

interface BackScopeProps {
  action: BackAction;
  children: ReactNode;
}

/**
 * Wraps a screen with its back-action. Every screen MUST have one (enforced by lint).
 *
 * Example:
 *   <BackScope action={{ kind: "navigate", to: "/" }}>
 *     <HomeScreen />
 *   </BackScope>
 */
export function BackScope({ action, children }: BackScopeProps) {
  const value = useMemo(() => ({ action }), [action]);
  return <BackScopeContext.Provider value={value}>{children}</BackScopeContext.Provider>;
}

export function useBackAction(): BackAction {
  const ctx = useContext(BackScopeContext);
  if (!ctx) {
    throw new Error(
      "useBackAction() must be used inside <BackScope>. Every screen needs one — see plan §1.",
    );
  }
  return ctx.action;
}
