import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  AccessUnavailableView,
  AdminCourseListView,
  AdminDashboardView,
  AdminNavigationView,
  AdminShellView,
  LogoutButtonView,
} from "../src/components/admin-portal-view.ts";
import { LoginFormView } from "../src/components/login-form-view.ts";
import {
  AuthorizationError,
  requireOrganizationPermission,
  type AuthorizationStore,
} from "../src/lib/authorization-core.ts";
import {
  homeDestination,
  isAdminRole,
  resolveAdminPortalAccess,
  type AdminPortalProfile,
} from "../src/lib/admin-portal-core.ts";
import {
  createLoginRequest,
  createLogoutRequest,
  loginErrorMessage,
} from "../src/lib/login-form-core.ts";
import { TenantContextError } from "../src/lib/tenant-context-core.ts";
import type { Course } from "../src/lib/course-core.ts";

const organizationId = "dc14fd7e-dd80-4c69-8b61-b1816c6627c6";
const userId = "8baa43c4-1cb3-4452-a6cd-d26f9ebef5d8";
const profile: AdminPortalProfile = {
  email: "owner@example.test",
  name: "Avery Owner",
  organizationName: "Northwind Safety",
};

function course(overrides: Partial<Course> & Pick<Course, "id" | "title" | "status">): Course {
  const now = new Date("2026-10-08T12:00:00.000Z");
  return {
    description: null,
    publishedAt: overrides.status === "PUBLISHED" ? now : null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

test("login form has labelled email and password fields without echoing credentials", () => {
  const markup = renderToStaticMarkup(createElement(LoginFormView, {
    pending: false,
    errorMessage: "Email or password is incorrect.",
    onSubmit: () => {},
  }));

  assert.match(markup, /LMS Platform/);
  assert.match(markup, /Sign in to your workspace/);
  assert.match(markup, /<label for="email">Email<\/label>/);
  assert.match(markup, /<input[^>]*type="email"[^>]*autocomplete="username"/i);
  assert.match(markup, /<label for="password">Password<\/label>/);
  assert.match(markup, /<input[^>]*type="password"[^>]*autocomplete="current-password"/i);
  assert.match(markup, /role="alert"/);
  assert.match(markup, /type="submit">Sign in<\/button>/);
  assert.doesNotMatch(markup, /value=/i);
  assert.doesNotMatch(markup, /known-password-sentinel/);
});

test("login submits JSON to the existing endpoint and maps errors without account disclosure", async () => {
  const request = createLoginRequest("owner@example.test", "known-password-sentinel");
  const url = new URL("/api/auth/login", "https://lms.example.test");
  assert.equal(url.pathname, "/api/auth/login");
  assert.equal(url.search, "");
  assert.equal(request.method, "POST");
  assert.equal(new Headers(request.headers).get("content-type"), "application/json");
  assert.deepEqual(JSON.parse(String(request.body)), {
    email: "owner@example.test",
    password: "known-password-sentinel",
  });
  assert.equal(request.credentials, "same-origin");
  assert.equal(loginErrorMessage("invalid_credentials"), "Email or password is incorrect.");
  assert.equal(loginErrorMessage("invalid_request"), "Sign-in failed. Please try again.");
  assert.equal(loginErrorMessage("authentication_unavailable"), "Sign in is temporarily unavailable.");
  assert.equal(loginErrorMessage("unexpected"), "Sign-in failed. Please try again.");

  const source = await readFile(new URL("../src/app/login/login-form.tsx", import.meta.url), "utf8");
  assert.match(source, /router\.replace\("\/admin"\)/);
  assert.match(source, /router\.refresh\(\)/);
  assert.doesNotMatch(source, /localStorage|sessionStorage|console\.(log|error)/);
});

test("logout calls the existing JSON endpoint and exposes a real sign-out control", () => {
  const request = createLogoutRequest();
  assert.equal(request.method, "POST");
  assert.equal(new Headers(request.headers).get("content-type"), "application/json");
  assert.equal(request.body, "{}");

  const markup = renderToStaticMarkup(createElement(LogoutButtonView, {
    onClick: () => {},
    errorMessage: "Sign out failed. Please try again.",
  }));
  assert.match(markup, /<button type="button"[^>]*>Sign out<\/button>/);
  assert.match(markup, /role="alert"/);
});

test("OWNER and ADMIN satisfy MANAGE_COURSES; MEMBER gets a safe access state before reads", async () => {
  for (const role of ["OWNER", "ADMIN"] as const) {
    assert.equal(isAdminRole(role), true);
    const authorizationStore: AuthorizationStore = {
      async findOrganizationRole() { return role; },
    };
    let profileReads = 0;
    const access = await resolveAdminPortalAccess({
      async requireTenantContext() { return { userId, organizationId, role }; },
      async requirePermission(orgId, permission) {
        assert.equal(orgId, organizationId);
        assert.equal(permission, "MANAGE_COURSES");
        return requireOrganizationPermission({ id: userId, email: profile.email, name: profile.name }, orgId, permission, authorizationStore);
      },
      store: { async getProfile() { profileReads += 1; return profile; } },
    });
    assert.equal(access.kind, "allowed");
    assert.equal(profileReads, 1);
  }

  assert.equal(isAdminRole("MEMBER"), false);
  const memberStore: AuthorizationStore = {
    async findOrganizationRole() { return "MEMBER"; },
  };
  let profileReads = 0;
  const memberAccess = await resolveAdminPortalAccess({
    async requireTenantContext() { return { userId, organizationId, role: "MEMBER" }; },
    async requirePermission(orgId, permission) {
      return requireOrganizationPermission({ id: userId, email: profile.email, name: profile.name }, orgId, permission, memberStore);
    },
    store: { async getProfile() { profileReads += 1; return profile; } },
  });
  assert.equal(memberAccess.kind, "forbidden");
  assert.equal(profileReads, 0);

  const denied = renderToStaticMarkup(createElement(AccessUnavailableView));
  assert.match(denied, /Access unavailable/);
  assert.match(denied, /This administration area is not available for your account\./);
});

test("admin shell shows the current user, organization, role, and accessible navigation", () => {
  const markup = renderToStaticMarkup(createElement(AdminShellView, {
    profile,
    role: "OWNER",
    navigation: createElement(AdminNavigationView, { pathname: "/admin/courses" }),
    logoutControl: createElement(LogoutButtonView, { onClick: () => {} }),
  }, createElement("section", null, createElement("h1", null, "Courses"))));

  assert.match(markup, /Avery Owner/);
  assert.match(markup, /Northwind Safety/);
  assert.match(markup, /OWNER/);
  assert.match(markup, /<header/);
  assert.match(markup, /<aside[^>]*aria-label="Admin workspace"/);
  assert.match(markup, /<nav[^>]*aria-label="Administration"/);
  assert.match(markup, /<main class="admin-main">/);
  assert.match(markup, /href="\/admin"[^>]*>Dashboard/);
  assert.match(markup, /href="\/admin\/courses"[^>]*aria-current="page"/);
  assert.doesNotMatch(markup, new RegExp(organizationId));
  assert.doesNotMatch(markup, new RegExp(userId));
  assert.equal((markup.match(/<h1\b/g) ?? []).length, 1);
});

test("dashboard renders organization-scoped counts and root routing has no marketing default", () => {
  const markup = renderToStaticMarkup(createElement(AdminDashboardView, {
    profile,
    counts: { total: 7, draft: 4, published: 3 },
  }));
  assert.match(markup, /Welcome back/);
  assert.match(markup, /Northwind Safety/);
  assert.match(markup, />7</);
  assert.match(markup, />4</);
  assert.match(markup, />3</);
  assert.equal(homeDestination(false), "/login");
  assert.equal(homeDestination(true), "/admin");
});

test("Course rows include status, dates, preview links, and no mutation controls", () => {
  const draftId = "36b95b4c-143e-4e65-a4af-97bc94a40e4d";
  const publishedId = "e10e27a7-e7b3-4610-b4d4-35fb1ab9b3d8";
  const markup = renderToStaticMarkup(createElement(AdminCourseListView, {
    courses: [
      course({ id: draftId, title: "Safety Training", status: "DRAFT", publishedAt: null }),
      course({ id: publishedId, title: "Fire Safety", status: "PUBLISHED" }),
    ],
  }));
  assert.match(markup, /Safety Training/);
  assert.match(markup, /Fire Safety/);
  assert.match(markup, /admin-status-badge is-draft[^>]*>DRAFT/);
  assert.match(markup, /admin-status-badge is-published[^>]*>PUBLISHED/);
  assert.match(markup, /Last updated/);
  assert.match(markup, /Published date/);
  assert.match(markup, new RegExp(`/courses/${draftId}/preview`));
  assert.match(markup, new RegExp(`/courses/${publishedId}/preview`));
  assert.equal((markup.match(/>Preview<\/a>/g) ?? []).length, 2);
  assert.doesNotMatch(markup, /Create course|Edit course|Delete course|Publish course/i);
});

test("empty Course state is clear and the responsive views use one main landmark", () => {
  const emptyCourses = renderToStaticMarkup(createElement(AdminCourseListView, { courses: [] }));
  assert.match(emptyCourses, /No courses yet\./);
  assert.match(emptyCourses, /Create your first course to start building training content\./);
  assert.match(emptyCourses, /href="\/admin\/courses\/new"[^>]*>Create course/);
  assert.doesNotMatch(emptyCourses, /Preview/);

  const shell = renderToStaticMarkup(createElement(AdminShellView, {
    profile,
    role: "ADMIN",
    navigation: createElement(AdminNavigationView, { pathname: "/admin" }),
    logoutControl: createElement(LogoutButtonView),
  }, createElement("h1", null, "Welcome back")));
  assert.equal((shell.match(/<main\b/g) ?? []).length, 1);
  assert.equal((shell.match(/<h1\b/g) ?? []).length, 1);
});

test("authorization and tenant-context failures fail closed without loading profile data", async () => {
  let profileReads = 0;
  const tenantFailure = await resolveAdminPortalAccess({
    async requireTenantContext() { throw new TenantContextError("unauthenticated"); },
    async requirePermission() { throw new Error("must not run"); },
    store: { async getProfile() { profileReads += 1; return profile; } },
  });
  assert.deepEqual(tenantFailure, { kind: "unauthenticated" });

  const authFailure = await resolveAdminPortalAccess({
    async requireTenantContext() { return { userId, organizationId, role: "MEMBER" }; },
    async requirePermission() { throw new AuthorizationError("authorization_unavailable"); },
    store: { async getProfile() { profileReads += 1; return profile; } },
  });
  assert.deepEqual(authFailure, { kind: "unavailable" });
  assert.equal(profileReads, 0);
});
