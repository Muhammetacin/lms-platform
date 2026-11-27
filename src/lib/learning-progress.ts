export type CourseProgress = { completed: number; total: number };

export const progressLabels = {
  notStarted: "Nog niet gestart",
  inProgress: "Bezig",
  completed: "Afgerond",
};

export function progressStatus({ completed, total }: CourseProgress) {
  if (completed === 0) return progressLabels.notStarted;
  return completed === total ? progressLabels.completed : progressLabels.inProgress;
}

export function progressCount({ completed, total }: CourseProgress) {
  return `${completed} van ${total} ${total === 1 ? "les" : "lessen"} afgerond`;
}
