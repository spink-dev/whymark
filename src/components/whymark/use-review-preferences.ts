"use client";

import { useMemo, useSyncExternalStore } from "react";
import { PREFERENCES_KEY, parsePreferences, type ReviewPreferences } from "@/lib/review-preferences";

let sessionValue: string | null = null;
let storageFailed = false;
const eventName = "whymark-preferences";
function subscribe(notify: () => void) {
  window.addEventListener("storage", notify);
  window.addEventListener(eventName, notify);
  return () => { window.removeEventListener("storage", notify); window.removeEventListener(eventName, notify); };
}
function snapshot() {
  if (storageFailed) return sessionValue;
  try { return localStorage.getItem(PREFERENCES_KEY); } catch { storageFailed = true; return sessionValue; }
}
function update(value: ReviewPreferences) {
  sessionValue = JSON.stringify(value);
  try { localStorage.setItem(PREFERENCES_KEY, sessionValue); } catch { storageFailed = true; }
  window.dispatchEvent(new Event(eventName));
}
export function useReviewPreferences(): [ReviewPreferences, (value: ReviewPreferences) => void] {
  const raw = useSyncExternalStore(subscribe, snapshot, () => null);
  const value = useMemo(() => parsePreferences(raw), [raw]);
  return [value, update];
}
