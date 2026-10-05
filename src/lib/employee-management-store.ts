import "server-only";
import type { EmployeeStore } from "./employee-management-core";
import { createPrismaEmployeeManagementStore } from "./employee-management-prisma-store";

const storeForRequest = async () => {
  const { db } = await import("@/lib/db");
  return createPrismaEmployeeManagementStore(db);
};

export const employeeManagementStore: EmployeeStore = {
  async list(organizationId) {
    return (await storeForRequest()).list(organizationId);
  },
  async get(organizationId, employeeId) {
    return (await storeForRequest()).get(organizationId, employeeId);
  },
  async create(organizationId, email, name) {
    return (await storeForRequest()).create(organizationId, email, name);
  },
  async updateName(organizationId, employeeId, name) {
    return (await storeForRequest()).updateName(organizationId, employeeId, name);
  },
  async deactivate(organizationId, employeeId) {
    return (await storeForRequest()).deactivate(organizationId, employeeId);
  },
};
