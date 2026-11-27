import type { Prisma } from "../generated/prisma/client.ts";

type LockedCourse = { status: "DRAFT" | "PUBLISHED"; publishedAt: Date | null };

export async function lockCourseStructure(
  transaction: Prisma.TransactionClient,
  organizationId: string,
  courseId: string,
): Promise<LockedCourse | null> {
  const rows = await transaction.$queryRaw<LockedCourse[]>`
    SELECT "status", "publishedAt"
    FROM "Course"
    WHERE "id" = ${courseId}::uuid
      AND "organizationId" = ${organizationId}::uuid
    FOR UPDATE
  `;
  return rows[0] ?? null;
}
