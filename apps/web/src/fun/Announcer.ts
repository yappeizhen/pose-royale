/**
 * Web Speech announcer (plan §7 fun layer). A paper-thin wrapper around
 * `window.speechSynthesis` that:
 *   • picks a stable voice at init so pacing is consistent across calls
 *   • clamps rate/pitch to preserve energy without becoming grating
 *   • serializes utterances so back-to-back calls don't overlap into noise
 *
 * The rest of the app calls one of the high-level methods (`countdown`, `roundWinner`, etc.)
 * — this keeps the vocabulary curated, which means we can tune it centrally.
 */

export interface AnnouncerOptions {
  enabled?: boolean;
  rate?: number;
  pitch?: number;
  volume?: number;
}

type Enqueuable = () => SpeechSynthesisUtterance | null;

export class Announcer {
  private enabled: boolean;
  private rate: number;
  private pitch: number;
  private volume: number;
  private queue: Enqueuable[] = [];
  private speaking = false;
  private cachedVoice: SpeechSynthesisVoice | null = null;
  private readonly supported: boolean;

  constructor(opts: AnnouncerOptions = {}) {
    this.enabled = opts.enabled ?? true;
    this.rate = opts.rate ?? 1.05;
    this.pitch = opts.pitch ?? 1.0;
    this.volume = opts.volume ?? 0.9;
    this.supported = typeof window !== "undefined" && "speechSynthesis" in window;
    if (this.supported) {
      const pickVoice = () => {
        const voices = window.speechSynthesis.getVoices();
        // Prefer English-US default; fall back to the first available. Chrome fires
        // voiceschanged once voices are populated, which may be async.
        this.cachedVoice =
          voices.find((v) => v.default && v.lang.startsWith("en")) ??
          voices.find((v) => v.lang.startsWith("en")) ??
          voices[0] ??
          null;
      };
      pickVoice();
      window.speechSynthesis.addEventListener?.("voiceschanged", pickVoice);
    }
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.cancel();
  }

  cancel(): void {
    this.queue = [];
    this.speaking = false;
    if (this.supported) window.speechSynthesis.cancel();
  }

  say(text: string, overrides: Partial<AnnouncerOptions> = {}): void {
    if (!this.enabled || !this.supported || text.trim().length === 0) return;
    const utter = () => {
      const u = new SpeechSynthesisUtterance(text);
      u.rate = clamp(overrides.rate ?? this.rate, 0.5, 2);
      u.pitch = clamp(overrides.pitch ?? this.pitch, 0.5, 2);
      u.volume = clamp(overrides.volume ?? this.volume, 0, 1);
      if (this.cachedVoice) u.voice = this.cachedVoice;
      return u;
    };
    this.queue.push(utter);
    this.drain();
  }

  // ── Curated vocabulary ─────────────────────────────────────────────────
  countdown(n: 3 | 2 | 1 | 0): void {
    if (n === 0) this.say("Go!", { pitch: 1.3, rate: 1.15 });
    else this.say(`${n}`, { rate: 1.2 });
  }
  setlistReveal(first: string): void {
    this.say(`Your gauntlet opens with ${first}. Get ready.`);
  }
  roundStart(name: string, index: number, total: number): void {
    this.say(`Round ${index + 1} of ${total}. ${name}.`);
  }
  roundWinner(winnerName: string | null): void {
    if (winnerName) this.say(`${winnerName} takes the round.`);
    else this.say("Tied round.");
  }
  finalWinner(winnerName: string | null): void {
    if (winnerName) this.say(`${winnerName} wins the gauntlet!`, { pitch: 1.25 });
    else this.say("Dead heat. Sudden death incoming.");
  }
  suddenDeath(): void {
    this.say("Sudden death!", { pitch: 1.3, rate: 1.15 });
  }

  private drain(): void {
    if (!this.supported || this.speaking) return;
    const next = this.queue.shift();
    if (!next) return;
    const u = next();
    if (!u) {
      this.drain();
      return;
    }
    this.speaking = true;
    u.onend = () => {
      this.speaking = false;
      this.drain();
    };
    u.onerror = () => {
      this.speaking = false;
      this.drain();
    };
    window.speechSynthesis.speak(u);
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
