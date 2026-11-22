import { LESSONS } from "./newPlayerTutorial.js";

/** Capability checkpoints divide the full path; they do not remove or gate lessons. */
export const NEW_PLAYER_MILESTONES = [
  { id: "take-a-turn", title: "I can take a turn", endLessonId: "power-and-champion", goal: "Set up the table, choose which opening cards to keep and make enough energy and power for your first plays.", next: "Next we’ll send a unit out to conquer and see whether we can keep that battlefield." },
  { id: "conquer-and-hold", title: "I can conquer and hold", endLessonId: "scoring-once-per-turn", goal: "Take a battlefield and keep it, then check which ones you and the other player have each scored this turn.", next: "Next, what do you do when there’s already an enemy unit where you want to go?" },
  { id: "respond-and-fight", title: "I can respond and resolve combat", endLessonId: "practice-reactions", goal: "Look at both sides of a fight, choose when to respond and work out who’s left once damage is dealt.", next: "Now we’ll see when conquering or holding can give you the point that wins the game." },
  { id: "earn-the-win", title: "I can earn the winning point", endLessonId: "practice-final-point", goal: "Find a way to get point eight and talk through why it works with this board.", next: "You can try another decision, see what you remember, or choose a deck and look through the hand you’d like to start with." },
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
