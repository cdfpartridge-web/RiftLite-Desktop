import { createLessonState, applyTutorialAction, LESSONS, type TutorialAction, type TutorialState } from "./newPlayerTutorial.js";

export const NEW_PLAYER_PROGRESS_KEY = "riftlite.new-player.progress.v1";
export const NEW_PLAYER_COURSE_VERSION = 14;
export const NEW_PLAYER_MIGRATION_NOTICE = "The course now has an earlier first-game path and separate decision practices. Older incompatible lesson checkpoints have been reset. Your read topics are still saved.";
export const NEW_PLAYER_UPGRADE_NOTICE = "A new board lesson explains one score per battlefield, per player, per turn. Your compatible lesson progress, read topics and saved choices are kept. The new lesson is ready when you are.";
export interface NewPlayerLessonProgress { actions: TutorialAction[]; completed: boolean }
export interface NewPlayerProgress {
  version: 1;
  courseVersion: typeof NEW_PLAYER_COURSE_VERSION;
  migrationNotice: string | null;
  lastLessonId: string | null;
  completedLessonIds: string[];
  readTopicIds: string[];
  lessons: Record<string, NewPlayerLessonProgress>;
}
export function initialNewPlayerProgress(): NewPlayerProgress {
  return { version: 1, courseVersion: NEW_PLAYER_COURSE_VERSION, migrationNotice: null, lastLessonId: null, completedLessonIds: [], readTopicIds: [], lessons: {} };
}
/** Resume the current lesson, then continue forwards within its path. Fill skipped lessons before leaving the path. */
export function nextGuidedLesson(progress: NewPlayerProgress, fromId = progress.lastLessonId) {
  const index = LESSONS.findIndex(lesson => lesson.id === fromId);
  const completed = new Set(progress.completedLessonIds);
  if (index < 0) return LESSONS.find(lesson => !completed.has(lesson.id) && progress.lessons[lesson.id]?.actions.length)
    ?? LESSONS.find(lesson => !completed.has(lesson.id));
  const current = LESSONS[index];
  if (!completed.has(current.id)) return current;
  const remaining = [...LESSONS.slice(index + 1), ...LESSONS.slice(0, index)].filter(lesson => !completed.has(lesson.id));
  return remaining.find(lesson => (lesson.path ?? "first-game") === (current.path ?? "first-game")) ?? remaining[0];
}
export function resumeLessonState(progress: NewPlayerProgress, id: string): TutorialState {
  let state = createLessonState(id);
  for (const action of (progress.lessons[id]?.actions ?? []).slice(0, 500)) {
    const next = applyTutorialAction(state, action);
    if (next.stepIndex === state.stepIndex) break;
    state = next;
  }
  return state;
}
export function saveLessonProgress(progress: NewPlayerProgress, state: TutorialState): NewPlayerProgress {
  const completedLessonIds = progress.completedLessonIds.filter((id) => id !== state.lessonId);
  if (state.completed) completedLessonIds.push(state.lessonId);
  return { ...progress, lastLessonId: state.lessonId, completedLessonIds,
    lessons: { ...progress.lessons, [state.lessonId]: { actions: structuredClone(state.actions), completed: state.completed } } };
}
// Cache only previously validated action records, never caller-owned boards or completion flags.
// Saving one lesson need not replay every unchanged completed lesson again.
const validatedRecords = new Map<string, NewPlayerLessonProgress>();
// A legacy Continue may otherwise match a new group introduction despite referring
// to a different keyword/position. These lessons received a new leading step in v8.
const VERSION_8_RESTARTED_LESSONS = new Set(LESSONS.filter(lesson => lesson.steps[0].id === "lesson-intro").map(lesson => lesson.id));
export function parseNewPlayerProgress(raw: string | null | undefined): NewPlayerProgress {
  const clean = initialNewPlayerProgress();
  if (!raw || raw.length > 500_000) return clean;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return clean;
    const input = value as Record<string, unknown>;
    if (input.version !== 1) return clean;
    clean.readTopicIds = Array.isArray(input.readTopicIds) ? [...new Set(input.readTopicIds.filter((id): id is string => typeof id === "string" && /^[a-z0-9-]{1,60}$/.test(id)))].slice(0, 50) : [];
    if (input.courseVersion !== NEW_PLAYER_COURSE_VERSION && input.courseVersion !== 3 && input.courseVersion !== 4 && input.courseVersion !== 5 && input.courseVersion !== 6 && input.courseVersion !== 7 && input.courseVersion !== 8 && input.courseVersion !== 9 && input.courseVersion !== 10 && input.courseVersion !== 11 && input.courseVersion !== 12 && input.courseVersion !== 13) {
      clean.migrationNotice = NEW_PLAYER_MIGRATION_NOTICE;
      return clean;
    }
    clean.migrationNotice = input.courseVersion !== NEW_PLAYER_COURSE_VERSION ? NEW_PLAYER_UPGRADE_NOTICE : input.migrationNotice === NEW_PLAYER_MIGRATION_NOTICE || input.migrationNotice === NEW_PLAYER_UPGRADE_NOTICE ? input.migrationNotice : null;
    const records = input.lessons && typeof input.lessons === "object" && !Array.isArray(input.lessons)
      ? input.lessons as Record<string, unknown> : {};
    let result = clean;
    for (const lesson of LESSONS) {
      const candidate = records[lesson.id];
      if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) continue;
      const actions = (candidate as Record<string, unknown>).actions;
      if (!Array.isArray(actions)) continue;
      if ((input.courseVersion as number)<11 && ["hidden-cards","keyword-equipment"].includes(lesson.id)) {
        result.lessons[lesson.id]={actions:[],completed:false};
        continue;
      }
      const bounded = actions.slice(0, 500);
      const key = `${input.courseVersion}:${lesson.id}:${(candidate as Record<string, unknown>).completed === true}:${JSON.stringify(bounded)}`;
      let record = validatedRecords.get(key);
      if (!record) {
        let state = createLessonState(lesson.id);
        for (const action of bounded) {
          if (!action || typeof action !== "object" || Array.isArray(action)) break;
          const next = applyTutorialAction(state, action as TutorialAction);
          if (next.stepIndex === state.stepIndex) break;
          state = next;
        }
        const legacyChanged = input.courseVersion !== NEW_PLAYER_COURSE_VERSION && (((input.courseVersion as number)<8 && VERSION_8_RESTARTED_LESSONS.has(lesson.id) && bounded.length > 0) || state.actions.length !== bounded.length || ((candidate as Record<string, unknown>).completed === true && !state.completed));
        record = legacyChanged ? { actions: [], completed: false } : { actions: structuredClone(state.actions), completed: state.completed };
        if (key.length <= 32000) {
          if (validatedRecords.size >= 256) validatedRecords.delete(validatedRecords.keys().next().value!);
          validatedRecords.set(key, record);
        }
      }
      result.lessons[lesson.id] = structuredClone(record);
      if (record.completed) result.completedLessonIds.push(lesson.id);
    }
    result.lastLessonId = typeof input.lastLessonId === "string" && LESSONS.some((l) => l.id === input.lastLessonId) ? input.lastLessonId : null;
    return result;
  } catch { return clean; }
}
export function serializeNewPlayerProgress(progress: NewPlayerProgress): string {
  // Model actions have already been applied to the board. Validate and migrate
  // when reading device storage, so accepting one move never replays the lesson.
  return JSON.stringify(progress);
}

/** Apply this tab's edits to the latest device save, including an intentional Back or Restart. */
export function mergeCourseProgress(before: NewPlayerProgress, edited: NewPlayerProgress, device: NewPlayerProgress): NewPlayerProgress {
  if (before === device) return edited;
  const lessons = { ...device.lessons };
  let selectedLessonChanged = before.lastLessonId !== edited.lastLessonId;
  for (const [id, checkpoint] of Object.entries(edited.lessons)) {
    const previous = before.lessons[id];
    if (previous === checkpoint) continue;
    const saved = device.lessons[id];
    if (previous && JSON.stringify(previous) === JSON.stringify(checkpoint)) continue;
    if (id === edited.lastLessonId) selectedLessonChanged = true;
    // If two copies of the same lesson diverged, keep the committed route. A
    // learner still on that route can extend it, including completing it.
    if (saved && JSON.stringify(saved) !== JSON.stringify(previous)) {
      if (saved.completed || saved.actions.length > checkpoint.actions.length) continue;
      if (JSON.stringify(saved.actions) !== JSON.stringify(checkpoint.actions.slice(0, saved.actions.length))) continue;
    }
    lessons[id] = checkpoint;
  }
  return {
    ...device, lessons,
    completedLessonIds: Object.keys(lessons).filter(id => lessons[id].completed),
    readTopicIds: [...new Set([...device.readTopicIds, ...edited.readTopicIds])],
    lastLessonId: selectedLessonChanged ? edited.lastLessonId : device.lastLessonId,
    migrationNotice: edited.migrationNotice === before.migrationNotice ? device.migrationNotice : edited.migrationNotice,
  };
}
