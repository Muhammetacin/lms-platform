export type CourseProgress = { completed: number; total: number };

export function progressStatus({ completed, total }: CourseProgress) {
  if (completed === 0) return "Nog niet gestart";
  return completed === total ? "Afgerond" : "Bezig";
}

export function progressCount({ completed, total }: CourseProgress) {
  return `${completed} van ${total} ${total === 1 ? "les" : "lessen"} afgerond`;
}
