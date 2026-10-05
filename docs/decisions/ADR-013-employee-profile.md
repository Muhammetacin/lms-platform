# ADR-013: Organization-Scoped Employee Profiles

- **Status:** Accepted
- **Date:** 2026-10-05
- **Ticket:** LMS-013

## Context

LMS-012 uses `OrganizationMembership` as the tenant-owned employee boundary. The approved LMS-013 product decision adds job title, department, phone, and an organization-local employee number. A global `User` may have memberships in several organizations, so profile data must not change the identity record shared by those organizations. MEMBER also needs limited self-service while OWNER and ADMIN may manage profiles in their organization.

## Decisions

1. Reuse `OrganizationMembership`; add nullable `jobTitle`, `department`, `phone`, and `employeeNumber`. Keep email global on `User`, and keep role and activation under LMS-012.
2. Enforce employee-number uniqueness with a database unique key on `(organizationId, employeeNumber)`. Trim surrounding whitespace and preserve case, following existing exact-value conventions; equal values in different organizations remain valid.
3. OWNER and ADMIN read profiles in their organization and update all profile fields. MEMBER reads and updates only their own profile; they may edit `employeeName`, `jobTitle`, `department`, and `phone`, but never `employeeNumber`, identity, role, activation, or tenant fields.
4. Reuse the existing role hierarchy and add `VIEW_EMPLOYEE_PROFILES` at the minimum ADMIN role and `MANAGE_OWN_PROFILE` at the minimum MEMBER role. The handler separately verifies membership ownership for MEMBER requests. Do not add roles or change LMS-012 lifecycle operations.
5. Every profile query includes the requested membership ID and trusted organization ID. Return the same 404 for a cross-tenant or missing profile; a MEMBER's other membership is also concealed as not found.
6. Optional fields (`jobTitle`, `department`, `phone`, and `employeeNumber`) are trimmed, accept `null` to clear, reject blank strings and control characters, and use a 120 Unicode code point maximum. `employeeName` uses LMS-012's existing 2–120 code point rule and cannot be cleared by PATCH. Phone format is not parsed.
7. Do not create a profile-specific audit system. Use LMS-058's shared audit mechanism when it exists; no LMS-058 implementation is present in this repository.

## Consequences

The existing membership remains the only employee boundary. The migration adds a composite unique index; PostgreSQL permits multiple null employee numbers and the same non-null value in different organizations. Profile handlers use explicit response and mutation field maps. MEMBER profile access is limited to the authenticated user's membership even though the base organization-view capability includes all roles.

LMS-013 does not add avatars, other HR data, reactivation/deactivation, role changes, or audit infrastructure. Profile writes are not audit logged until the shared LMS-058 mechanism is available.

## Alternatives considered

- **Add an `EmployeeProfile` table:** rejected because `OrganizationMembership` already is the organization-specific employee relation and the approved profile fields are small scalar values.
- **Store profile fields on `User`:** rejected because values such as department, phone, and employee number can differ by organization and a global write would affect other memberships.
- **Add an `EMPLOYEE` or `LEARNER` role:** rejected because the product decision defines self-service for the existing MEMBER role.
- **Create a custom profile audit log:** rejected because the repository does not yet contain LMS-058's shared audit system.
