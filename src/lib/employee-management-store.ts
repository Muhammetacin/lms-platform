import "server-only";
import type { EmployeeStore } from "./employee-management-core";
import type { EmployeeProfileStore } from "./employee-profile-core";
import { createPrismaEmployeeManagementStore } from "./employee-management-prisma-store";

const storeForRequest = async () => {
  const { db } = await import("@/lib/db");
  return createPrismaEmployeeManagementStore(db);
};

export const employeeManagementStore: EmployeeStore & EmployeeProfileStore = {
  async list(organizationId) {
    return (await storeForRequest()).list(organizationId);
  },
  async get(organizationId, employeeId) {
    return (await storeForRequest()).get(organizationId, employeeId);
  },
  async getProfile(organizationId, employeeId) {
    return (await storeForRequest()).getProfile(organizationId, employeeId);
  },
  async create(organizationId, email, name, actorUserId) {
    return (await storeForRequest()).create(organizationId, email, name, actorUserId);
  },
  async updateName(organizationId, employeeId, name, actorUserId) {
    return (await storeForRequest()).updateName(organizationId, employeeId, name, actorUserId);
  },
  async updateProfile(organizationId, employeeId, update, actorUserId) {
    return (await storeForRequest()).updateProfile(organizationId, employeeId, update, actorUserId);
  },
  async deactivate(organizationId, employeeId, actorUserId) {
    return (await storeForRequest()).deactivate(organizationId, employeeId, actorUserId);
  },
};
