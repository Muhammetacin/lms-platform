import { Prisma } from "../generated/prisma/client.ts";
import type { PrismaClient } from "../generated/prisma/client.ts";
import {
  EMPLOYEE_IMPORT_MAX_ERRORS,
  EmployeeImportConflictError,
  type EmployeeImportRow,
  type EmployeeImportRowError,
  type EmployeeImportStore,
} from "./employee-import-core.ts";

/** Production create-only import store. It never updates a User or membership. */
export function createPrismaEmployeeImportStore(db: PrismaClient): EmployeeImportStore {
  return {
    async import(organizationId, rows) {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          await db.$transaction(async (transaction) => {
            const conflicts = await findOrganizationConflicts(
              transaction,
              organizationId,
              rows,
            );
            if (conflicts.length > 0) throw new EmployeeImportConflictError(conflicts);

            // Existing global identities are intentionally kept as-is. PostgreSQL
            // skips only exact User.email conflicts, then membership creation
            // remains all-or-nothing in this same serializable transaction.
            await transaction.user.createMany({
              data: rows.map(({ email }) => ({ email })),
              skipDuplicates: true,
            });
            const users = await transaction.user.findMany({
              where: { email: { in: rows.map(({ email }) => email) } },
              select: { id: true, email: true },
            });
            const userIdByEmail = new Map(users.map(({ id, email }) => [email, id]));
            if (userIdByEmail.size !== rows.length) {
              throw new Error("Employee import could not resolve all user identities.");
            }

            await transaction.organizationMembership.createMany({
              data: rows.map((row) => ({
                userId: userIdByEmail.get(row.email)!,
                organizationId,
                role: "MEMBER" as const,
                active: true,
                employeeName: row.name,
                jobTitle: row.jobTitle,
                department: row.department,
                phone: row.phone,
                employeeNumber: row.employeeNumber,
              })),
            });
          }, {
            isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
            maxWait: 30_000,
            timeout: 60_000,
          });

          return rows.length;
        } catch (error) {
          if (error instanceof EmployeeImportConflictError) throw error;

          if (isPrismaCode(error, "P2002") || isPrismaCode(error, "P2034")) {
            // Re-check outside the rolled-back transaction so concurrent import
            // or manual-create races become row-level conflicts without exposing
            // Prisma's constraint details.
            const conflicts = await findOrganizationConflicts(db, organizationId, rows);
            if (conflicts.length > 0) throw new EmployeeImportConflictError(conflicts);

            if (attempt === 0) continue;
          }
          throw error;
        }
      }

      throw new Error("Employee import transaction retry limit exceeded.");
    },
  };
}

async function findOrganizationConflicts(
  client: Prisma.TransactionClient | PrismaClient,
  organizationId: string,
  rows: EmployeeImportRow[],
): Promise<EmployeeImportRowError[]> {
  const emails = [...new Set(rows.map(({ email }) => email))];
  const employeeNumbers = [...new Set(
    rows.flatMap(({ employeeNumber }) => employeeNumber === null ? [] : [employeeNumber]),
  )];
  const clauses = [
    ...(emails.length > 0 ? [{ user: { is: { email: { in: emails } } } }] : []),
    ...(employeeNumbers.length > 0 ? [{ employeeNumber: { in: employeeNumbers } }] : []),
  ];

  if (clauses.length === 0) return [];
  const existing = await client.organizationMembership.findMany({
    where: { organizationId, OR: clauses },
    select: { employeeNumber: true, user: { select: { email: true } } },
  });
  const existingEmails = new Set(existing.map(({ user }) => user.email));
  const existingNumbers = new Set(
    existing.flatMap(({ employeeNumber }) => employeeNumber === null ? [] : [employeeNumber]),
  );
  const errors: EmployeeImportRowError[] = [];
  for (const row of rows) {
    if (existingEmails.has(row.email)) {
      errors.push({ row: row.row, field: "email", code: "employee_already_exists" });
    }
    if (row.employeeNumber !== null && existingNumbers.has(row.employeeNumber)) {
      errors.push({ row: row.row, field: "employeeNumber", code: "employee_number_conflict" });
    }
    if (errors.length >= EMPLOYEE_IMPORT_MAX_ERRORS) break;
  }
  return errors;
}

function isPrismaCode(error: unknown, code: "P2002" | "P2034"): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}
