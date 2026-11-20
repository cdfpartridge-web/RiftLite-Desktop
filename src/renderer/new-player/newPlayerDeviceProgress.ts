import { NEW_PLAYER_PROGRESS_KEY, initialNewPlayerProgress, mergeCourseProgress, parseNewPlayerProgress, serializeNewPlayerProgress, type NewPlayerProgress } from "../../shared/newPlayerProgress";

type Change = { before: NewPlayerProgress; edited: NewPlayerProgress };
const prefix = NEW_PLAYER_PROGRESS_KEY + ".pending.";
const tabId = Math.random().toString(36).slice(2);
let sequence = 0;
let storedText: string | null | undefined;
let stored = initialNewPlayerProgress();
let current = stored;
let waitingForLock = false;
let warning = "";
const sessionOnly = new Map<string, Change>();
const stagedHere = new Map<string, Change>();
const listeners = new Set<(progress: NewPlayerProgress, message: string) => void>();
const saveWarning = "Your progress is available for this session, but could not be saved on this device. Keep this window open to continue.";

function readDevice() {
  const text = window.localStorage.getItem(NEW_PLAYER_PROGRESS_KEY);
  if (text !== storedText) {
    stored = parseNewPlayerProgress(text);
    storedText = text;
  }
  return stored;
}

function pendingKeys() {
  const storage = window.localStorage;
  const keys = new Set(sessionOnly.keys());
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key?.startsWith(prefix)) keys.add(key);
  }
  for (const key of stagedHere.keys()) if (!keys.has(key)) stagedHere.delete(key);
  return [...keys].sort();
}

function readChange(key: string): Change | null {
  // These actions were already accepted by this tab's teaching board. Only
  // checkpoints read from another document need replay validation.
  const known = sessionOnly.get(key) ?? stagedHere.get(key);
  if (known) return known;
  const text = window.localStorage.getItem(key);
  if (!text || text.length > 500_000) return null;
  try {
    const record = JSON.parse(text);
    if (!record?.before || !record?.edited) return null;
    return { before: parseNewPlayerProgress(JSON.stringify(record.before)), edited: parseNewPlayerProgress(JSON.stringify(record.edited)) };
  } catch { return null; }
}

function applyPending(keys: string[]) {
  let result = readDevice();
  for (const key of keys) {
    const change = readChange(key);
    if (change) result = mergeCourseProgress(change.before, change.edited, result);
  }
  return result;
}

export function loadCourseProgress() {
  try { current = applyPending(pendingKeys()); } catch { /* Retain this session's progress when storage is unavailable. */ }
  return current;
}

export function courseSaveWarning() { return warning; }

function flush() {
  try {
    const keys = pendingKeys();
    const result = applyPending(keys);
    if (keys.length) {
      const text = serializeNewPlayerProgress(result);
      window.localStorage.setItem(NEW_PLAYER_PROGRESS_KEY, text);
      stored = result;
      storedText = text;
      // Each key belongs to a single edit, so a later writer cannot replace it
      // between committing this snapshot and removing its completed edits.
      for (const key of keys) {
        window.localStorage.removeItem(key);
        sessionOnly.delete(key);
        stagedHere.delete(key);
      }
    }
    current = result;
    warning = "";
  } catch { warning = saveWarning; }
  for (const listener of listeners) listener(current, warning);
}

function scheduleFlush() {
  if (waitingForLock) return;
  try {
    if (navigator.locks) {
      waitingForLock = true;
      void navigator.locks.request(NEW_PLAYER_PROGRESS_KEY, () => {
        waitingForLock = false;
        flush();
      }).catch(() => { waitingForLock = false; flush(); });
      return;
    }
  } catch { /* Some browser contexts disallow locks. */ }
  flush();
}

export function saveCourseProgress(before: NewPlayerProgress, edited: NewPlayerProgress) {
  current = edited;
  const key = prefix + Date.now().toString().padStart(15, "0") + "." + tabId + "." + String(++sequence).padStart(8, "0");
  const changed = Object.entries(edited.lessons).filter(([id, checkpoint]) => before.lessons[id] !== checkpoint);
  const change = {
    before: { ...before, lessons: Object.fromEntries(changed.filter(([id]) => before.lessons[id]).map(([id]) => [id, before.lessons[id]])) },
    edited: { ...edited, lessons: Object.fromEntries(changed) },
  };
  // A phone can suspend or destroy the document before it acquires the lock.
  // Stage just the affected checkpoints synchronously so any tab can finish it.
  try {
    window.localStorage.setItem(key, JSON.stringify(change));
    stagedHere.set(key, change);
  }
  catch { sessionOnly.set(key, change); }
  scheduleFlush();
}

export function subscribeCourseProgress(listener: (progress: NewPlayerProgress, message: string) => void) {
  listeners.add(listener);
  const storageChanged = (event: StorageEvent) => {
    if (event.key === null || event.key === NEW_PLAYER_PROGRESS_KEY || (event.key?.startsWith(prefix) && event.newValue)) scheduleFlush();
  };
  const onVisibility = () => { if (!document.hidden) scheduleFlush(); };
  window.addEventListener("storage", storageChanged);
  window.addEventListener("pageshow", scheduleFlush);
  document.addEventListener("visibilitychange", onVisibility);
  scheduleFlush();
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", storageChanged);
    window.removeEventListener("pageshow", scheduleFlush);
    document.removeEventListener("visibilitychange", onVisibility);
  };
}

