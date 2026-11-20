import { LESSONS } from "./newPlayerTutorial.js";

/** Capability checkpoints divide the full path; they do not remove or gate lessons. */
export const NEW_PLAYER_MILESTONES = [
  { id: "take-a-turn", title: "I can take a turn", endLessonId: "power-and-champion", goal: "Set up, choose an opening hand and pay for your cards.", next: "Next, use your units to conquer and hold a battlefield." },
  { id: "conquer-and-hold", title: "I can conquer and hold", endLessonId: "scoring-once-per-turn", goal: "Conquer and hold, and track each player’s scoring separately during a turn.", next: "Next, make a plan when another unit stands in your way." },
  { id: "respond-and-fight", title: "I can respond and resolve combat", endLessonId: "practice-reactions", goal: "Read the position, respond to spells and work out what survives a fight.", next: "Next, use conquering and holding to earn your final point." },
  { id: "earn-the-win", title: "I can earn the winning point", endLessonId: "practice-final-point", goal: "Choose a legal route to your last point, and explain why it wins.", next: "Try another decision practice, check what you learned, or choose a deck and learn its opening plan." },
] as const;

export function newPlayerMilestoneProgress(completedLessonIds: readonly string[]) {
  const firstGame = LESSONS.filter(lesson => (lesson.path ?? "first-game") === "first-game");
  let start = 0;
  return NEW_PLAYER_MILESTONES.map(milestone => {
    const end = firstGame.findIndex(lesson => lesson.id === milestone.endLessonId);
    const lessons = firstGame.slice(start, end + 1);
    start = end + 1;
    const completed = lessons.filter(lesson => completedLessonIds.includes(lesson.id)).length;
    return { ...milestone, lessons, completed, complete: lessons.length > 0 && completed === lessons.length, nextLesson: lessons.find(lesson => !completedLessonIds.includes(lesson.id)) };
  });
}
