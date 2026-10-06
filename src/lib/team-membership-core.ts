import { AuthorizationError, type OrganizationPermission } from "./authorization-core.ts";
import type { TenantContext } from "./tenant-context-core.ts";
import { TenantContextError } from "./tenant-context-core.ts";
import { isTeamId } from "./team-core.ts";

export type TeamMember = {
  id: string;
  email: string;
  employeeName: string | null;
  jobTitle: string | null;
  department: string | null;
};

export interface TeamMembershipStore {
  list(organizationId: string, teamId: string): Promise<TeamMember[] | null>;
  add(organizationId: string, teamId: string, employeeId: string): Promise<TeamMember>;
  remove(organizationId: string, teamId: string, employeeId: string): Promise<boolean>;
}

export class TeamMembershipConflictError extends Error {
  constructor() {
    super("The employee already belongs to this Team.");
    this.name = "TeamMembershipConflictError";
  }
}

export class TeamMembershipTargetNotFoundError extends Error {
  readonly target: "team" | "employee";

  constructor(target: "team" | "employee") {
    super("The requested Team membership target was not found.");
    this.name = "TeamMembershipTargetNotFoundError";
    this.target = target;
  }
}

export type TeamMembershipDependencies = {
  requireTenantContext(): Promise<TenantContext>;
  requirePermission(organizationId: string, permission: OrganizationPermission): Promise<unknown>;
  store: TeamMembershipStore;
  isTrustedRequest(request: Request): boolean;
  readBody(request: Request): Promise<unknown>;
  logError?(operation: "list" | "add" | "remove"): void;
};

const privateJsonHeaders = { "Cache-Control": "no-store" };
const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: privateJsonHeaders });
const invalidRequest = () => json({ error: "invalid_request" }, 400);
const teamNotFound = () => json({ error: "team_not_found" }, 404);
const employeeNotFound = () => json({ error: "employee_not_found" }, 404);
const membershipNotFound = () => json({ error: "team_membership_not_found" }, 404);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isEmployeeMembershipId(value: unknown): value is string {
  return typeof value === "string" && uuidPattern.test(value);
}

export function parseTeamMemberAdd(value: unknown): { employeeId: string } | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (Object.keys(input).length !== 1 || !Object.hasOwn(input, "employeeId")) return null;
  return isEmployeeMembershipId(input.employeeId) ? { employeeId: input.employeeId } : null;
}

function errorResponse(
  error: unknown,
  operation: "list" | "add" | "remove",
  logError?: TeamMembershipDependencies["logError"],
) {
  if (error instanceof AuthorizationError || error instanceof TenantContextError) {
    return json({ error: error.code }, error.status);
  }
  if (error instanceof TeamMembershipConflictError) {
    return json({ error: "team_membership_conflict" }, 409);
  }
  if (error instanceof TeamMembershipTargetNotFoundError) {
    return error.target === "team" ? teamNotFound() : employeeNotFound();
  }
  if (logError) logError(operation);
  else console.error("Team membership request could not be completed.", { operation });
  return json({ error: "team_membership_unavailable" }, 503);
}

export function createTeamMembershipHandlers(dependencies: TeamMembershipDependencies) {
  return {
    async GET(teamId: string) {
      try {
        const tenant = await dependencies.requireTenantContext();
        await dependencies.requirePermission(tenant.organizationId, "VIEW_ORGANIZATION");
        if (!isTeamId(teamId)) return teamNotFound();
        const members = await dependencies.store.list(tenant.organizationId, teamId);
        if (members === null) return teamNotFound();
        return json({ members });
      } catch (error) {
        return errorResponse(error, "list", dependencies.logError);
      }
    },

    async POST(request: Request, teamId: string) {
      if (!dependencies.isTrustedRequest(request)) return json({ error: "invalid_request" }, 403);
      try {
        const tenant = await dependencies.requireTenantContext();
        await dependencies.requirePermission(tenant.organizationId, "MANAGE_TEAMS");
        if (!isTeamId(teamId)) return teamNotFound();
        const input = parseTeamMemberAdd(await dependencies.readBody(request));
        if (!input) return invalidRequest();
        const member = await dependencies.store.add(tenant.organizationId, teamId, input.employeeId);
        return json({ member }, 201);
      } catch (error) {
        return errorResponse(error, "add", dependencies.logError);
      }
    },

    async DELETE(request: Request, teamId: string, employeeId: string) {
      if (!dependencies.isTrustedRequest(request)) return json({ error: "invalid_request" }, 403);
      try {
        const tenant = await dependencies.requireTenantContext();
        await dependencies.requirePermission(tenant.organizationId, "MANAGE_TEAMS");
        if (!isTeamId(teamId) || !isEmployeeMembershipId(employeeId)) return membershipNotFound();
        if (!await dependencies.store.remove(tenant.organizationId, teamId, employeeId)) {
          return membershipNotFound();
        }
        return json({ removed: true });
      } catch (error) {
        return errorResponse(error, "remove", dependencies.logError);
      }
    },
  };
}
