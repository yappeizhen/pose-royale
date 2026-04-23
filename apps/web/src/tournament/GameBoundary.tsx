import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  /** Called once when the child throws. The orchestrator uses it to score a 0 for the round. */
  onCrash: (err: Error, info: ErrorInfo) => void;
  fallback?: ReactNode;
}

interface State {
  crashed: boolean;
}

/**
 * Wraps a game's mount node. On crash: emit a 0 for the round and advance — no game failure
 * should kill the tournament (plan §4, §9 edge case #5).
 *
 * React 19 still requires a class component for `componentDidCatch` / `getDerivedStateFromError`.
 */
export class GameBoundary extends Component<Props, State> {
  override state: State = { crashed: false };

  static getDerivedStateFromError(): State {
    return { crashed: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    this.props.onCrash(error, info);
  }

  override render(): ReactNode {
    if (this.state.crashed) {
      return (
        this.props.fallback ?? (
          <div role="alert" className="crash-notice">
            <p className="crash-notice__title">That round crashed — sorry!</p>
            <p className="crash-notice__body">Scoring 0 and moving on…</p>
          </div>
        )
      );
    }
    return this.props.children;
  }
}
