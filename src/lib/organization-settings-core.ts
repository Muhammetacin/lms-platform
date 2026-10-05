import {
  AuthorizationError,
  type OrganizationPermission,
} from "./authorization-core.ts";
import type { TenantContext } from "./tenant-context-core.ts";
import { TenantContextError } from "./tenant-context-core.ts";

export type OrganizationSettings = { name: string; slug: string };

export interface OrganizationSettingsStore {
  findSettings(organizationId: string): Promise<OrganizationSettings | null>;
  updateName(
    organizationId: string,
    name: string,
  ): Promise<OrganizationSettings | null>;
}

export type OrganizationSettingsRouteDependencies = {
  requireTenantContext(): Promise<TenantContext>;
  requirePermission(
    organizationId: string,
    permission: OrganizationPermission,
  ): Promise<unknown>;
  store: OrganizationSettingsStore;
  isTrustedRequest(request: Request): boolean;
  readBody(request: Request): Promise<unknown>;
  logError?(operation: "read" | "update"): void;
};

const privateJsonHeaders = { "Cache-Control": "no-store" };
const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: privateJsonHeaders });

export function parseOrganizationSettingsUpdate(
  value: unknown,
): { name: string } | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }

  const input = value as Record<string, unknown>;
  if (Object.keys(input).some((key) => key !== "name") || typeof input.name !== "string") {
    return null;
  }

  const name = input.name.trim();
  if (
    [...name].length < 2 ||
    [...name].length > 120 ||
    /[\u0000-\u001f\u007f-\u009f\p{Cs}]/u.test(name)
  ) {
    return null;
  }

  return { name };
}

function errorResponse(
  error: unknown,
  operation: "read" | "update",
  logError?: (operation: "read" | "update") => void,
) {
  if (error instanceof AuthorizationError || error instanceof TenantContextError) {
    return json({ error: error.code }, error.status);
  }

  if (logError) logError(operation);
  else {
    console.error("Organization settings request could not be completed.", {
      operation,
    });
  }
  return json({ error: "organization_settings_unavailable" }, 503);
}

export function createOrganizationSettingsHandlers(
  dependencies: OrganizationSettingsRouteDependencies,
) {
  return {
    async GET() {
      try {
        const tenant = await dependencies.requireTenantContext();
        await dependencies.requirePermission(
          tenant.organizationId,
          "VIEW_ORGANIZATION",
        );
        const settings = await dependencies.store.findSettings(
          tenant.organizationId,
        );
        if (!settings) return json({ error: "organization_not_found" }, 404);
        return json({ organization: settings });
      } catch (error) {
        return errorResponse(error, "read", dependencies.logError);
      }
    },

    async PATCH(request: Request) {
      if (!dependencies.isTrustedRequest(request)) {
        return json({ error: "invalid_request" }, 403);
      }

      try {
        const tenant = await dependencies.requireTenantContext();
        await dependencies.requirePermission(
          tenant.organizationId,
          "MANAGE_ORGANIZATION_SETTINGS",
        );

        const update = parseOrganizationSettingsUpdate(
          await dependencies.readBody(request),
        );
        if (!update) return json({ error: "invalid_request" }, 400);

        const settings = await dependencies.store.updateName(
          tenant.organizationId,
          update.name,
        );
        if (!settings) return json({ error: "organization_not_found" }, 404);
        return json({ organization: settings });
      } catch (error) {
        return errorResponse(error, "update", dependencies.logError);
      }
    },
  };
}
