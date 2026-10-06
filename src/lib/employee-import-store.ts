import "server-only";
import type { EmployeeImportStore } from "./employee-import-core.ts";
import { createPrismaEmployeeImportStore } from "./employee-import-prisma-store.ts";

const storeForRequest = async () => {
  const { db } = await import("@/lib/db");
  return createPrismaEmployeeImportStore(db);
};

export const employeeImportStore: EmployeeImportStore = {
  async import(organizationId, rows) {
    return (await storeForRequest()).import(organizationId, rows);
  },
};
