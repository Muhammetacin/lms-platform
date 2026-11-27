import { progressCount, progressStatus, type CourseProgress } from "@/lib/learning-progress";

export function LearnerCourseProgress({ progress }: { progress: CourseProgress }) {
  return (
    <div className="learner-course-progress">
      <p><strong>{progressStatus(progress)}</strong> · {progressCount(progress)}</p>
      {progress.total > 0 ? (
        <progress value={progress.completed} max={progress.total} aria-label="Afgeronde lessen" />
      ) : null}
    </div>
  );
}
