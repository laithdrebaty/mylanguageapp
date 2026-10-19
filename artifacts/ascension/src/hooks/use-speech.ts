/**
 * Speaking the tutor's replies aloud, using the browser's own voice.
 *
 * WHY THE BROWSER AND NOT A PROVIDER
 * ───────────────────────────────────
 * A paid text-to-speech API bills per character, and the tutor is the side that
 * talks. `speechSynthesis` ships in every browser: no account, no key, no
 * per-use cost, and it keeps working when the network does not. For a $2/month
 * plan that is the difference between the feature being free and being the
 * second-largest line on the AI bill.
 *
 * The trade is voice quality, which varies by platform. If that is judged too
 * poor later, this hook is the only place that changes — the component calls
 * `speak(text)` either way.
 *
 * WHAT THE PLATFORM MAKES AWKWARD
 * ────────────────────────────────
 *   Voices load late      getVoices() is empty on first call in Chrome until
 *                         the voiceschanged event fires, so an English voice
 *                         is picked lazily rather than once on mount.
 *   Autoplay is gated     Safari and mobile Chrome refuse to speak until the
 *                         user has interacted with the page. The student has
 *                         pressed a button to start the conversation, which
 *                         satisfies it; a greeting spoken on page load would
 *                         not, and would fail silently.
 *   Utterances queue      Speaking a new reply while the last is still going
 *                         would read them back to back, so each call cancels
 *                         what is in flight.
 */

import { useCallback, useEffect, useRef, useState } from "react";

const PREFERENCE_KEY = "enstep.tutorVoice.enabled";

/** Slower than default: this is a learner listening in a second language. */
const RATE = 0.9;

/**
 * Just below default. The flat, slightly-high default reading is most of what
 * makes a synthesised voice sound mechanical; dropping it a little lands closer
 * to a speaking register without tipping into the comical.
 */
const PITCH = 0.95;

function supported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

/** Remembered per browser, so a student who muted the tutor stays muted. */
function loadPreference(): boolean {
  try {
    const raw = window.localStorage.getItem(PREFERENCE_KEY);
    return raw === null ? true : raw === "1";
  } catch {
    // Private windows and blocked site data both throw here.
    return true;
  }
}

/**
 * How good a voice is likely to sound, high score first.
 *
 * There is no quality field on `SpeechSynthesisVoice` — only `name`, `lang` and
 * `localService` — so the name is the only signal available. These are the
 * published names of the neural voices on each platform; anything unrecognised
 * scores 0 and still beats a voice we actively avoid.
 */
const VOICE_TIERS: Array<{ score: number; match: RegExp }> = [
  // Chrome/Edge network neural voices — the best available for free.
  { score: 100, match: /\b(aria|jenny|guy|michelle|ana)\b.*online|online.*natural/i },
  { score: 90, match: /google (us|uk) english/i },
  { score: 80, match: /\bnatural\b|\bneural\b/i },
  // Apple's better-than-default voices, shipped locally.
  { score: 70, match: /\b(ava|samantha|serena|allison|siri)\b/i },
  // Known-poor legacy voices: audibly robotic, worse than anything above.
  { score: -100, match: /\b(albert|bad news|bahh|bells|boing|bubbles|cellos|good news|jester|organ|superstar|trinoids|whisper|wobble|zarvox)\b/i },
  { score: -50, match: /\b(espeak|festival|pico|flite)\b/i },
];

function voiceScore(voice: SpeechSynthesisVoice): number {
  for (const tier of VOICE_TIERS) {
    if (tier.match.test(voice.name)) return tier.score;
  }
  return 0;
}

/** Sort comparator: better voice first, en-US breaking an otherwise exact tie. */
function voicePreference(a: SpeechSynthesisVoice, b: SpeechSynthesisVoice): number {
  const byScore = voiceScore(b) - voiceScore(a);
  if (byScore !== 0) return byScore;
  const aUs = a.lang.toLowerCase() === "en-us" ? 1 : 0;
  const bUs = b.lang.toLowerCase() === "en-us" ? 1 : 0;
  return bUs - aUs;
}

export interface SpeechController {
  /** False when the browser has no speech synthesis at all — hide the control. */
  available: boolean;
  enabled: boolean;
  setEnabled: (on: boolean) => void;
  speaking: boolean;
  /** Says it aloud, cancelling anything still in flight. No-op when disabled. */
  speak: (text: string) => void;
  stop: () => void;
}

export function useSpeech(): SpeechController {
  const [available] = useState(supported);
  const [enabled, setEnabledState] = useState<boolean>(() => supported() && loadPreference());
  const [speaking, setSpeaking] = useState(false);

  // Held in a ref so `speak` does not need to be rebuilt when a voice arrives.
  const voiceRef = useRef<SpeechSynthesisVoice | null>(null);

  useEffect(() => {
    if (!available) return;

    const pick = () => {
      const voices = window.speechSynthesis.getVoices();
      if (voices.length === 0) return;
      // An English voice is the point — the tutor speaks English.
      const english = voices.filter((v) => v.lang.toLowerCase().startsWith("en"));
      if (english.length === 0) {
        voiceRef.current = null;
        return;
      }
      // Best available, rather than fastest to start. This used to prefer
      // `localService` to avoid the pause while a network voice is fetched, but
      // the local OS voices are the robotic ones; the network neural voices
      // ("Google US English", "Microsoft Aria Online") are the single biggest
      // quality difference available without paying a TTS provider per
      // character. The fetch costs a short delay on the first utterance only.
      voiceRef.current = [...english].sort(voicePreference)[0] ?? null;
    };

    pick();
    window.speechSynthesis.addEventListener("voiceschanged", pick);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", pick);
  }, [available]);

  // Leaving the lesson mid-sentence should not keep the tutor talking.
  useEffect(() => {
    if (!available) return;
    return () => window.speechSynthesis.cancel();
  }, [available]);

  const setEnabled = useCallback(
    (on: boolean) => {
      setEnabledState(on);
      if (!on && supported()) {
        window.speechSynthesis.cancel();
        setSpeaking(false);
      }
      try {
        window.localStorage.setItem(PREFERENCE_KEY, on ? "1" : "0");
      } catch {
        // A remembered preference is a convenience, not a requirement.
      }
    },
    [],
  );

  const speak = useCallback(
    (text: string) => {
      if (!available || !enabled) return;
      const trimmed = text.trim();
      if (!trimmed) return;

      window.speechSynthesis.cancel();

      const utterance = new SpeechSynthesisUtterance(trimmed);
      utterance.lang = voiceRef.current?.lang ?? "en-US";
      utterance.rate = RATE;
      utterance.pitch = PITCH;
      if (voiceRef.current) utterance.voice = voiceRef.current;

      utterance.onstart = () => setSpeaking(true);
      utterance.onend = () => setSpeaking(false);
      // Autoplay refusal and interruption both land here. Failing quietly is
      // right: the reply is already on screen, so the student loses nothing.
      utterance.onerror = () => setSpeaking(false);

      window.speechSynthesis.speak(utterance);
    },
    [available, enabled],
  );

  const stop = useCallback(() => {
    if (!available) return;
    window.speechSynthesis.cancel();
    setSpeaking(false);
  }, [available]);

  return { available, enabled, setEnabled, speaking, speak, stop };
}
