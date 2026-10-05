import "server-only";
import { Prisma } from "@/generated/prisma/client";
import {
  EmployeeConflictError,
  LastOwnerError,
  type Employee,
  type EmployeeStore,
} from "@/lib/employee-management-core";

export const employeeManagementStore: EmployeeStore = {
  async list(organizationId) {
    const { db } = await import("@/lib/db");
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
    const { db } = await import("@/lib/db");
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

  async create(organizationId, email, name) {
    const { db } = await import("@/lib/db");
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
    const { db } = await import("@/lib/db");
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

  async deactivate(organizationId, employeeId) {
    const { db } = await import("@/lib/db");
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
