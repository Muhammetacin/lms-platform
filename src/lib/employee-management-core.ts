import {
  AuthorizationError,
  type OrganizationPermission,
} from "./authorization-core.ts";
import type { TenantContext } from "./tenant-context-core.ts";
import { TenantContextError } from "./tenant-context-core.ts";

export type Employee = {
  id: string;
  email: string;
  name: string | null;
  role: "OWNER" | "ADMIN" | "MEMBER";
  active: boolean;
};

export class EmployeeConflictError extends Error {
  constructor() {
    super("Employee already exists in this organization.");
    this.name = "EmployeeConflictError";
  }
}

export class LastOwnerError extends Error {
  constructor() {
    super("The last active organization owner cannot be deactivated.");
    this.name = "LastOwnerError";
  }
}

export interface EmployeeStore {
  list(organizationId: string): Promise<Employee[]>;
  get(organizationId: string, employeeId: string): Promise<Employee | null>;
  create(
    organizationId: string,
    email: string,
    name: string,
  ): Promise<Employee>;
  updateName(
    organizationId: string,
    employeeId: string,
    name: string,
  ): Promise<Employee | null>;
  deactivate(
    organizationId: string,
    employeeId: string,
  ): Promise<Employee | null>;
}

export type EmployeeManagementDependencies = {
  requireTenantContext(): Promise<TenantContext>;
  requirePermission(
    organizationId: string,
    permission: OrganizationPermission,
  ): Promise<unknown>;
  store: EmployeeStore;
  isTrustedRequest(request: Request): boolean;
  readBody(request: Request): Promise<unknown>;
  logError?(operation: "list" | "get" | "create" | "update" | "deactivate"): void;
};

const privateJsonHeaders = { "Cache-Control": "no-store" };
const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: privateJsonHeaders });

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isEmployeeId(value: unknown): value is string {
  return typeof value === "string" && uuidPattern.test(value);
}

export function normalizeEmployeeName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim();
  return (
    [...name].length >= 2 &&
    [...name].length <= 120 &&
    !/[\u0000-\u001f\u007f-\u009f\p{Cs}]/u.test(name)
  ) ? name : null;
}

export function normalizeEmployeeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim();
  return Buffer.byteLength(email, "utf8") <= 254 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    ? email
    : null;
}

export function parseEmployeeCreate(value: unknown): { email: string; name: string } | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const name = normalizeEmployeeName(input.name);
  if (
    Object.keys(input).some((key) => key !== "email" && key !== "name") ||
    name === null
  ) return null;

  const email = normalizeEmployeeEmail(input.email);
  if (email === null) return null;

  return { email, name };
}

export function parseEmployeeUpdate(value: unknown): { name: string } | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const name = normalizeEmployeeName(input.name);
  if (Object.keys(input).length !== 1 || !Object.hasOwn(input, "name") || name === null) {
    return null;
  }
  return { name };
}

function errorResponse(
  error: unknown,
  operation: "list" | "get" | "create" | "update" | "deactivate",
  logError?: EmployeeManagementDependencies["logError"],
) {
  if (error instanceof AuthorizationError || error instanceof TenantContextError) {
    return json({ error: error.code }, error.status);
  }
  if (error instanceof EmployeeConflictError) return json({ error: "employee_already_exists" }, 409);
  if (error instanceof LastOwnerError) return json({ error: "last_owner_required" }, 409);
  if (logError) logError(operation);
  else console.error("Employee management request could not be completed.", { operation });
  return json({ error: "employee_management_unavailable" }, 503);
}

export function createEmployeeManagementHandlers(dependencies: EmployeeManagementDependencies) {
  return {
    async GET() {
      try {
        const tenant = await dependencies.requireTenantContext();
        await dependencies.requirePermission(tenant.organizationId, "VIEW_ORGANIZATION");
        return json({ employees: await dependencies.store.list(tenant.organizationId) });
      } catch (error) {
        return errorResponse(error, "list", dependencies.logError);
      }
    },

    async POST(request: Request) {
      if (!dependencies.isTrustedRequest(request)) return json({ error: "invalid_request" }, 403);
      try {
        const tenant = await dependencies.requireTenantContext();
        await dependencies.requirePermission(tenant.organizationId, "MANAGE_MEMBERS");
        const employee = parseEmployeeCreate(await dependencies.readBody(request));
        if (!employee) return json({ error: "invalid_request" }, 400);
        return json({ employee: await dependencies.store.create(tenant.organizationId, employee.email, employee.name) }, 201);
      } catch (error) {
        return errorResponse(error, "create", dependencies.logError);
      }
    },

    async GET_ONE(employeeId: string) {
      try {
        const tenant = await dependencies.requireTenantContext();
        await dependencies.requirePermission(tenant.organizationId, "VIEW_ORGANIZATION");
        if (!isEmployeeId(employeeId)) return json({ error: "employee_not_found" }, 404);
        const employee = await dependencies.store.get(tenant.organizationId, employeeId);
        if (!employee) return json({ error: "employee_not_found" }, 404);
        return json({ employee });
      } catch (error) {
        return errorResponse(error, "get", dependencies.logError);
      }
    },

    async PATCH(request: Request, employeeId: string) {
      if (!dependencies.isTrustedRequest(request)) return json({ error: "invalid_request" }, 403);
      try {
        const tenant = await dependencies.requireTenantContext();
        await dependencies.requirePermission(tenant.organizationId, "MANAGE_MEMBERS");
        if (!isEmployeeId(employeeId)) return json({ error: "employee_not_found" }, 404);
        const update = parseEmployeeUpdate(await dependencies.readBody(request));
        if (!update) return json({ error: "invalid_request" }, 400);
        const employee = await dependencies.store.updateName(tenant.organizationId, employeeId, update.name);
        if (!employee) return json({ error: "employee_not_found" }, 404);
        return json({ employee });
      } catch (error) {
        return errorResponse(error, "update", dependencies.logError);
      }
    },

    async DEACTIVATE(request: Request, employeeId: string) {
      if (!dependencies.isTrustedRequest(request)) return json({ error: "invalid_request" }, 403);
      try {
        const tenant = await dependencies.requireTenantContext();
        await dependencies.requirePermission(tenant.organizationId, "MANAGE_MEMBERS");
        if (!isEmployeeId(employeeId)) return json({ error: "employee_not_found" }, 404);
        const existing = await dependencies.store.get(tenant.organizationId, employeeId);
        if (!existing) return json({ error: "employee_not_found" }, 404);
        if (existing.role === "OWNER") {
          await dependencies.requirePermission(tenant.organizationId, "MANAGE_ORGANIZATION_OWNERSHIP");
        }
        const employee = await dependencies.store.deactivate(tenant.organizationId, employeeId);
        if (!employee) return json({ error: "employee_not_found" }, 404);
        return json({ employee });
      } catch (error) {
        return errorResponse(error, "deactivate", dependencies.logError);
      }
    },
  };
}
