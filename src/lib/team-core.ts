import { AuthorizationError, type OrganizationPermission } from "./authorization-core.ts";
import type { TenantContext } from "./tenant-context-core.ts";
import { TenantContextError } from "./tenant-context-core.ts";

export type Team = {
  id: string;
  name: string;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type TeamCreate = { name: string; description: string | null };
export type TeamUpdate = { name?: string; description?: string | null };

export interface TeamStore {
  list(organizationId: string): Promise<Team[]>;
  get(organizationId: string, teamId: string): Promise<Team | null>;
  create(organizationId: string, input: TeamCreate): Promise<Team>;
  update(organizationId: string, teamId: string, input: TeamUpdate): Promise<Team | null>;
  delete(organizationId: string, teamId: string): Promise<boolean>;
}

export class TeamNameConflictError extends Error {
  constructor() {
    super("Team name is already used in this organization.");
    this.name = "TeamNameConflictError";
  }
}

export type TeamDependencies = {
  requireTenantContext(): Promise<TenantContext>;
  requirePermission(organizationId: string, permission: OrganizationPermission): Promise<unknown>;
  store: TeamStore;
  isTrustedRequest(request: Request): boolean;
  readBody(request: Request): Promise<unknown>;
  logError?(operation: "list" | "get" | "create" | "update" | "delete"): void;
};

const privateJsonHeaders = { "Cache-Control": "no-store" };
const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: privateJsonHeaders });
const teamNotFound = () => json({ error: "team_not_found" }, 404);
const invalidRequest = () => json({ error: "invalid_request" }, 400);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const controlCharacterPattern = /[\u0000-\u001f\u007f-\u009f\p{Cs}]/u;

export function isTeamId(value: unknown): value is string {
  return typeof value === "string" && uuidPattern.test(value);
}

function normalizeTeamName(value: unknown): string | null {
  if (typeof value !== "string" || controlCharacterPattern.test(value)) return null;
  const name = value.trim();
  const length = [...name].length;
  return length >= 2 && length <= 120 ? name : null;
}

type NormalizedDescription = { valid: true; value: string | null } | { valid: false };

function normalizeDescription(value: unknown): NormalizedDescription {
  if (value === null) return { valid: true, value: null };
  if (typeof value !== "string" || controlCharacterPattern.test(value)) return { valid: false };
  const description = value.trim();
  if ([...description].length > 500) return { valid: false };
  return { valid: true, value: description.length === 0 ? null : description };
}

export function parseTeamCreate(value: unknown): TeamCreate | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some((key) => key !== "name" && key !== "description")) return null;
  const name = normalizeTeamName(input.name);
  if (name === null) return null;

  let description: string | null = null;
  if (Object.hasOwn(input, "description")) {
    const normalized = normalizeDescription(input.description);
    if (!normalized.valid) return null;
    description = normalized.value;
  }
  return { name, description };
}

export function parseTeamUpdate(value: unknown): TeamUpdate | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const keys = Object.keys(input);
  if (keys.length === 0 || keys.some((key) => key !== "name" && key !== "description")) return null;

  const update: TeamUpdate = {};
  if (Object.hasOwn(input, "name")) {
    const name = normalizeTeamName(input.name);
    if (name === null) return null;
    update.name = name;
  }
  if (Object.hasOwn(input, "description")) {
    const description = normalizeDescription(input.description);
    if (!description.valid) return null;
    update.description = description.value;
  }
  return update;
}

function errorResponse(
  error: unknown,
  operation: "list" | "get" | "create" | "update" | "delete",
  logError?: TeamDependencies["logError"],
) {
  if (error instanceof AuthorizationError || error instanceof TenantContextError) {
    return json({ error: error.code }, error.status);
  }
  if (error instanceof TeamNameConflictError) return json({ error: "team_name_conflict" }, 409);
  if (logError) logError(operation);
  else console.error("Team request could not be completed.", { operation });
  return json({ error: "team_management_unavailable" }, 503);
}

export function createTeamHandlers(dependencies: TeamDependencies) {
  return {
    async GET(_request?: Request) {
      void _request;
      try {
        const tenant = await dependencies.requireTenantContext();
        await dependencies.requirePermission(tenant.organizationId, "VIEW_ORGANIZATION");
        return json({ teams: await dependencies.store.list(tenant.organizationId) });
      } catch (error) {
        return errorResponse(error, "list", dependencies.logError);
      }
    },

    async POST(request: Request) {
      if (!dependencies.isTrustedRequest(request)) return json({ error: "invalid_request" }, 403);
      try {
        const tenant = await dependencies.requireTenantContext();
        await dependencies.requirePermission(tenant.organizationId, "MANAGE_TEAMS");
        const input = parseTeamCreate(await dependencies.readBody(request));
        if (!input) return invalidRequest();
        return json({ team: await dependencies.store.create(tenant.organizationId, input) }, 201);
      } catch (error) {
        return errorResponse(error, "create", dependencies.logError);
      }
    },

    async GET_ONE(teamId: string) {
      try {
        const tenant = await dependencies.requireTenantContext();
        await dependencies.requirePermission(tenant.organizationId, "VIEW_ORGANIZATION");
        if (!isTeamId(teamId)) return teamNotFound();
        const team = await dependencies.store.get(tenant.organizationId, teamId);
        if (!team) return teamNotFound();
        return json({ team });
      } catch (error) {
        return errorResponse(error, "get", dependencies.logError);
      }
    },

    async PATCH(request: Request, teamId: string) {
      if (!dependencies.isTrustedRequest(request)) return json({ error: "invalid_request" }, 403);
      try {
        const tenant = await dependencies.requireTenantContext();
        await dependencies.requirePermission(tenant.organizationId, "MANAGE_TEAMS");
        if (!isTeamId(teamId)) return teamNotFound();
        const input = parseTeamUpdate(await dependencies.readBody(request));
        if (!input) return invalidRequest();
        const team = await dependencies.store.update(tenant.organizationId, teamId, input);
        if (!team) return teamNotFound();
        return json({ team });
      } catch (error) {
        return errorResponse(error, "update", dependencies.logError);
      }
    },

    async DELETE(request: Request, teamId: string) {
      if (!dependencies.isTrustedRequest(request)) return json({ error: "invalid_request" }, 403);
      try {
        const tenant = await dependencies.requireTenantContext();
        await dependencies.requirePermission(tenant.organizationId, "MANAGE_TEAMS");
        if (!isTeamId(teamId)) return teamNotFound();
        if (!await dependencies.store.delete(tenant.organizationId, teamId)) return teamNotFound();
        return json({ deleted: true });
      } catch (error) {
        return errorResponse(error, "delete", dependencies.logError);
      }
    },
  };
}
