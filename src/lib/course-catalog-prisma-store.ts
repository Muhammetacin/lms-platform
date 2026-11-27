import { Prisma, type PrismaClient } from "../generated/prisma/client.ts";
import { isCourseId } from "./course-core.ts";
import { accessibleCourseWhere, activeLearnerMembership, type LearnerIdentity } from "./learner-course-prisma-store.ts";

export function listCourseCatalog(db: PrismaClient, identity: LearnerIdentity) {
  return db.$transaction(async (transaction) => {
    if (!await activeLearnerMembership(transaction, identity)) return [];

    const catalog = { organizationId: identity.organizationId, status: "PUBLISHED", catalogListed: true } as const;
    const courses = await transaction.course.findMany({
      where: catalog,
      orderBy: [{ title: "asc" }, { id: "asc" }],
      select: { id: true, title: true, description: true },
    });
    const accessible = await transaction.course.findMany({
      where: { ...catalog, AND: accessibleCourseWhere(identity) },
      select: { id: true },
    });
    const accessibleIds = new Set(accessible.map(({ id }) => id));
    return courses.map((course) => ({ ...course, accessible: accessibleIds.has(course.id) }));
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}

export async function setCourseCatalogListing(db: PrismaClient, organizationId: string, courseId: string, catalogListed: boolean) {
  if (!isCourseId(courseId)) return false;
  const updated = await db.course.updateMany({
    where: { id: courseId, organizationId, status: "PUBLISHED" },
    data: { catalogListed },
  });
  return updated.count === 1;
}

export async function enrollInCatalogCourse(db: PrismaClient, identity: LearnerIdentity, courseId: string) {
  if (!isCourseId(courseId)) return false;
  const { organizationId, userId } = identity;

  return db.$transaction(async (transaction) => {
    // Serialize eligibility with catalog changes and membership deactivation.
    const [member] = await transaction.$queryRaw<{ id: string }[]>`
      SELECT member.id
      FROM "OrganizationMembership" member
      JOIN "Course" course ON course."organizationId" = member."organizationId"
      WHERE member."organizationId" = ${organizationId}::uuid AND member."userId" = ${userId}::uuid
        AND member.active AND member.role = 'MEMBER'
        AND course.id = ${courseId}::uuid AND course.status = 'PUBLISHED'
        AND (course."catalogListed" OR EXISTS (
          SELECT 1 FROM "CourseEnrollment" enrollment
          WHERE enrollment."courseId" = course.id AND enrollment."membershipId" = member.id
            AND enrollment."organizationId" = course."organizationId"
        ))
      FOR SHARE OF course, member
    `;
    if (!member) return false;

    await transaction.courseEnrollment.createMany({
      data: { courseId, membershipId: member.id, organizationId },
      skipDuplicates: true,
    });
    return true;
  });
}
