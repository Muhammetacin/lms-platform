import { Prisma } from "../generated/prisma/client.ts";
import type { PrismaClient } from "../generated/prisma/client.ts";
import {
  EmployeeConflictError,
  LastOwnerError,
  type Employee,
  type EmployeeStore,
} from "./employee-management-core.ts";
import {
  EmployeeNumberConflictError,
  type EmployeeProfileRecord,
  type EmployeeProfileStore,
  type EmployeeProfileUpdate,
} from "./employee-profile-core.ts";

/**
 * Build the production employee store over a Prisma client. Exported so the
 * same query implementation can be exercised against PostgreSQL in tests.
 */
export function createPrismaEmployeeManagementStore(
  db: PrismaClient,
): EmployeeStore & EmployeeProfileStore {
  return {
    async list(organizationId) {
      const rows = await db.organizationMembership.findMany({
        where: { organizationId },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: 100,
        select: {
          id: true,
          employeeName: true,
          active: true,
          role: true,
          user: { select: { email: true } },
        },
      });
      return rows.map(({ id, employeeName, active, role, user }) => ({
        id,
        email: user.email,
        name: employeeName,
        active,
        role,
      }));
    },

    async get(organizationId, employeeId) {
      const row = await db.organizationMembership.findFirst({
        where: { id: employeeId, organizationId },
        select: {
          id: true,
          employeeName: true,
          active: true,
          role: true,
          user: { select: { email: true } },
        },
      });
      return row ? toEmployee(row) : null;
    },

    async getProfile(organizationId, employeeId) {
      const row = await db.organizationMembership.findFirst({
        where: { id: employeeId, organizationId },
        select: {
          id: true,
          employeeName: true,
          jobTitle: true,
          department: true,
          phone: true,
          employeeNumber: true,
          active: true,
          role: true,
          user: { select: { id: true, email: true } },
        },
      });
      return row ? toEmployeeProfile(row) : null;
    },

    async create(organizationId, email, name) {
      try {
        return await db.$transaction(async (transaction) => {
          const user = await transaction.user.upsert({
            where: { email },
            update: {},
            create: { email },
            select: { id: true },
          });
          const membership = await transaction.organizationMembership.create({
            data: { userId: user.id, organizationId, employeeName: name },
            select: {
              id: true,
              employeeName: true,
              active: true,
              role: true,
              user: { select: { email: true } },
            },
          });
          return toEmployee(membership);
        });
      } catch (error) {
        if (
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          error.code === "P2002"
        ) {
          throw new EmployeeConflictError();
        }
        throw error;
      }
    },

    async updateName(organizationId, employeeId, name) {
      return db.$transaction(async (transaction) => {
        const updated = await transaction.organizationMembership.updateMany({
          where: { id: employeeId, organizationId },
          data: { employeeName: name },
        });
        if (updated.count !== 1) return null;
        const row = await transaction.organizationMembership.findFirst({
          where: { id: employeeId, organizationId },
          select: {
            id: true,
            employeeName: true,
            active: true,
            role: true,
            user: { select: { email: true } },
          },
        });
        return row ? toEmployee(row) : null;
      });
    },

    async updateProfile(organizationId, employeeId, update: EmployeeProfileUpdate) {
      const data: {
        employeeName?: string;
        jobTitle?: string | null;
        department?: string | null;
        phone?: string | null;
        employeeNumber?: string | null;
      } = {};
      if (update.employeeName !== undefined) data.employeeName = update.employeeName;
      if (update.jobTitle !== undefined) data.jobTitle = update.jobTitle;
      if (update.department !== undefined) data.department = update.department;
      if (update.phone !== undefined) data.phone = update.phone;
      if (update.employeeNumber !== undefined) data.employeeNumber = update.employeeNumber;

      try {
        return await db.$transaction(async (transaction) => {
          const updated = await transaction.organizationMembership.updateMany({
            where: { id: employeeId, organizationId },
            data,
          });
          if (updated.count !== 1) return null;
          const row = await transaction.organizationMembership.findFirst({
            where: { id: employeeId, organizationId },
            select: {
              id: true,
              employeeName: true,
              jobTitle: true,
              department: true,
              phone: true,
              employeeNumber: true,
              active: true,
              role: true,
              user: { select: { id: true, email: true } },
            },
          });
          return row ? toEmployeeProfile(row) : null;
        });
      } catch (error) {
        if (isUniqueConstraintViolation(error)) throw new EmployeeNumberConflictError();
        throw error;
      }
    },

    async deactivate(organizationId, employeeId) {
      return db.$transaction(async (transaction) => {
        const where = { id: employeeId, organizationId };
        const target = await transaction.organizationMembership.findFirst({
          where,
          select: { id: true, role: true, active: true },
        });
        if (!target) return null;
        if (target.active && target.role === "OWNER") {
          const activeOwners = await transaction.organizationMembership.count({
            where: { organizationId, role: "OWNER", active: true },
          });
          if (activeOwners <= 1) throw new LastOwnerError();
        }
        await transaction.organizationMembership.updateMany({
          where: { ...where, active: true },
          data: { active: false },
        });
        const row = await transaction.organizationMembership.findFirst({
          where,
          select: {
            id: true,
            employeeName: true,
            active: true,
            role: true,
            user: { select: { email: true } },
          },
        });
        return row ? toEmployee(row) : null;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    },
  };
}

function isUniqueConstraintViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2002"
  );
}

function toEmployee(row: {
  id: string;
  employeeName: string | null;
  active: boolean;
  role: Employee["role"];
  user: { email: string };
}): Employee {
  return {
    id: row.id,
    email: row.user.email,
    name: row.employeeName,
    role: row.role,
    active: row.active,
  };
}

function toEmployeeProfile(row: {
  id: string;
  employeeName: string | null;
  jobTitle: string | null;
  department: string | null;
  phone: string | null;
  employeeNumber: string | null;
  active: boolean;
  role: Employee["role"];
  user: { id: string; email: string };
}): EmployeeProfileRecord {
  return {
    id: row.id,
    userId: row.user.id,
    email: row.user.email,
    employeeName: row.employeeName,
    jobTitle: row.jobTitle,
    department: row.department,
    phone: row.phone,
    employeeNumber: row.employeeNumber,
    role: row.role,
    active: row.active,
  };
}
