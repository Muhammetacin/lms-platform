import { AuthorizationError, type OrganizationPermission } from "./authorization-core.ts";
import { isEmployeeId, normalizeEmployeeName } from "./employee-management-core.ts";
import type { TenantContext } from "./tenant-context-core.ts";
import { TenantContextError } from "./tenant-context-core.ts";

export type EmployeeProfile = {
  id: string;
  email: string;
  employeeName: string | null;
  jobTitle: string | null;
  department: string | null;
  phone: string | null;
  employeeNumber: string | null;
  role: "OWNER" | "ADMIN" | "MEMBER";
  active: boolean;
};

export type EmployeeProfileRecord = EmployeeProfile & { userId: string };

export type EmployeeProfileUpdate = {
  employeeName?: string;
  jobTitle?: string | null;
  department?: string | null;
  phone?: string | null;
  employeeNumber?: string | null;
};

export interface EmployeeProfileStore {
  getProfile(organizationId: string, employeeId: string): Promise<EmployeeProfileRecord | null>;
  updateProfile(
    organizationId: string,
    employeeId: string,
    update: EmployeeProfileUpdate,
  ): Promise<EmployeeProfileRecord | null>;
}

export class EmployeeNumberConflictError extends Error {
  constructor() {
    super("Employee number is already used in this organization.");
    this.name = "EmployeeNumberConflictError";
  }
}

export type EmployeeProfileDependencies = {
  requireTenantContext(): Promise<TenantContext>;
  requirePermission(
    organizationId: string,
    permission: OrganizationPermission,
  ): Promise<{ role: EmployeeProfile["role"] }>;
  store: EmployeeProfileStore;
  isTrustedRequest(request: Request): boolean;
  readBody(request: Request): Promise<unknown>;
  logError?(operation: "get" | "update"): void;
};

const privateJsonHeaders = { "Cache-Control": "no-store" };
const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: privateJsonHeaders });
const invalidEmployeeResponse = () => json({ error: "employee_not_found" }, 404);
const invalidRequestResponse = () => json({ error: "invalid_request" }, 400);

type NormalizedOptionalText =
  | { valid: true; value: string | null }
  | { valid: false };

function normalizeOptionalProfileText(value: unknown): NormalizedOptionalText {
  if (value === null) return { valid: true, value: null };
  if (typeof value !== "string") return { valid: false };

  const normalized = value.trim();
  if (
    [...normalized].length === 0 ||
    [...normalized].length > 120 ||
    /[\u0000-\u001f\u007f-\u009f\p{Cs}]/u.test(normalized)
  ) {
    return { valid: false };
  }
  return { valid: true, value: normalized };
}

/**
 * Optional profile strings are trimmed, limited to 120 Unicode code points,
 * and may be cleared with null. Blank strings are rejected like LMS-012 names.
 */
export function parseEmployeeProfileUpdate(
  value: unknown,
  canManageEmployeeNumber: boolean,
): EmployeeProfileUpdate | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;

  const input = value as Record<string, unknown>;
  const allowedKeys = canManageEmployeeNumber
    ? ["employeeName", "jobTitle", "department", "phone", "employeeNumber"]
    : ["employeeName", "jobTitle", "department", "phone"];
  const keys = Object.keys(input);
  if (keys.length === 0 || keys.some((key) => !allowedKeys.includes(key))) return null;

  const update: EmployeeProfileUpdate = {};
  if (Object.hasOwn(input, "employeeName")) {
    const employeeName = normalizeEmployeeName(input.employeeName);
    if (employeeName === null) return null;
    update.employeeName = employeeName;
  }

  for (const field of ["jobTitle", "department", "phone"] as const) {
    if (!Object.hasOwn(input, field)) continue;
    const normalized = normalizeOptionalProfileText(input[field]);
    if (!normalized.valid) return null;
    update[field] = normalized.value;
  }

  if (Object.hasOwn(input, "employeeNumber")) {
    const normalized = normalizeOptionalProfileText(input.employeeNumber);
    if (!normalized.valid) return null;
    update.employeeNumber = normalized.value;
  }

  return update;
}

function publicProfile(record: EmployeeProfileRecord): EmployeeProfile {
  return {
    id: record.id,
    email: record.email,
    employeeName: record.employeeName,
    jobTitle: record.jobTitle,
    department: record.department,
    phone: record.phone,
    employeeNumber: record.employeeNumber,
    role: record.role,
    active: record.active,
  };
}

function errorResponse(
  error: unknown,
  operation: "get" | "update",
  logError?: EmployeeProfileDependencies["logError"],
) {
  if (error instanceof AuthorizationError || error instanceof TenantContextError) {
    return json({ error: error.code }, error.status);
  }
  if (error instanceof EmployeeNumberConflictError) {
    return json({ error: "employee_number_already_exists" }, 409);
  }
  if (logError) logError(operation);
  else console.error("Employee profile request could not be completed.", { operation });
  return json({ error: "employee_profile_unavailable" }, 503);
}

export function createEmployeeProfileHandlers(dependencies: EmployeeProfileDependencies) {
  return {
    async GET(employeeId: string) {
      try {
        const tenant = await dependencies.requireTenantContext();
        const membership = await dependencies.requirePermission(
          tenant.organizationId,
          "VIEW_OWN_MEMBERSHIP",
        );
        const isMember = membership.role === "MEMBER";
        if (!isMember) await dependencies.requirePermission(tenant.organizationId, "VIEW_EMPLOYEE_PROFILES");
        if (!isEmployeeId(employeeId)) return invalidEmployeeResponse();

        const record = await dependencies.store.getProfile(tenant.organizationId, employeeId);
        if (!record || (isMember && record.userId !== tenant.userId)) {
          return invalidEmployeeResponse();
        }
        return json({ profile: publicProfile(record) });
      } catch (error) {
        return errorResponse(error, "get", dependencies.logError);
      }
    },

    async PATCH(request: Request, employeeId: string) {
      if (!dependencies.isTrustedRequest(request)) return json({ error: "invalid_request" }, 403);
      try {
        const tenant = await dependencies.requireTenantContext();
        const membership = await dependencies.requirePermission(
          tenant.organizationId,
          "VIEW_OWN_MEMBERSHIP",
        );
        const isMember = membership.role === "MEMBER";
        await dependencies.requirePermission(
          tenant.organizationId,
          isMember ? "MANAGE_OWN_PROFILE" : "MANAGE_MEMBERS",
        );
        if (!isEmployeeId(employeeId)) return invalidEmployeeResponse();

        const existing = await dependencies.store.getProfile(tenant.organizationId, employeeId);
        if (!existing || (isMember && existing.userId !== tenant.userId)) {
          return invalidEmployeeResponse();
        }

        const update = parseEmployeeProfileUpdate(await dependencies.readBody(request), !isMember);
        if (!update) return invalidRequestResponse();

        const updated = await dependencies.store.updateProfile(
          tenant.organizationId,
          employeeId,
          update,
        );
        if (!updated) return invalidEmployeeResponse();
        return json({ profile: publicProfile(updated) });
      } catch (error) {
        return errorResponse(error, "update", dependencies.logError);
      }
    },
  };
}
