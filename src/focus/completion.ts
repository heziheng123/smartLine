import type { FocusSession } from './types';

export interface FocusCompletionPreferences {
  sound: boolean;
  browserNotification: boolean;
}

export interface FocusCompletionSummary {
  activeSeconds: number;
  interruptions: number;
  targetStatus?: 'reached' | 'early';
  targetDeltaSeconds?: number;
}

const STORAGE_KEY = 'smartline-focus-completion-preferences-v1';
const defaults: FocusCompletionPreferences = { sound: false, browserNotification: false };
let audioContext: AudioContext | null = null;

export function loadFocusCompletionPreferences(): FocusCompletionPreferences {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Partial<FocusCompletionPreferences> | null;
    return { sound: value?.sound === true, browserNotification: value?.browserNotification === true };
  } catch {
    return defaults;
  }
}

export function saveFocusCompletionPreferences(value: FocusCompletionPreferences): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
}

export function primeFocusCompletionSound(): void {
  if (typeof window === 'undefined' || !window.AudioContext) return;
  audioContext ??= new window.AudioContext();
  void audioContext.resume();
}

export function summarizeFocusCompletion(session: FocusSession): FocusCompletionSummary {
  if (session.mode === 'free') return { activeSeconds: session.activeSeconds, interruptions: session.interruptions.length };
  const targetDeltaSeconds = session.activeSeconds - session.targetMinutes * 60;
  return {
    activeSeconds: session.activeSeconds,
    interruptions: session.interruptions.length,
    targetStatus: targetDeltaSeconds >= 0 ? 'reached' : 'early',
    targetDeltaSeconds: Math.abs(targetDeltaSeconds),
  };
}

export function signalFocusTargetReached(subjectName: string, targetMinutes: number, preferences: FocusCompletionPreferences): void {
  if (preferences.sound) {
    primeFocusCompletionSound();
    if (audioContext) {
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      oscillator.frequency.value = 880;
      gain.gain.setValueAtTime(.05, audioContext.currentTime);
      gain.gain.exponentialRampToValueAtTime(.001, audioContext.currentTime + .45);
      oscillator.connect(gain).connect(audioContext.destination);
      oscillator.start();
      oscillator.stop(audioContext.currentTime + .45);
    }
  }
  if (preferences.browserNotification && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    new Notification('专注目标已完成', { body: `${subjectName} · ${targetMinutes} 分钟目标已完成` });
  }
}
