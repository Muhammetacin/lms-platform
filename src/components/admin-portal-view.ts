import { createElement as h, type ReactNode } from "react";
import type { Course } from "../lib/course-core.ts";
import type {
  AdminDashboardCounts,
  AdminPortalProfile,
} from "../lib/admin-portal-core.ts";
import type { OrganizationRole } from "../generated/prisma/enums.ts";

export function AccessUnavailableView() {
  return h("main", { className: "admin-unavailable" },
    h("section", { className: "admin-unavailable-card", "aria-labelledby": "access-unavailable-title" },
      h("p", { className: "admin-eyebrow" }, "LMS Platform"),
      h("h1", { id: "access-unavailable-title" }, "Access unavailable"),
      h("p", null, "This administration area is not available for your account."),
    ),
  );
}

export function AdminDataUnavailableView() {
  return h("section", { className: "admin-data-unavailable", role: "alert" },
    h("h1", null, "Admin portal temporarily unavailable"),
    h("p", null, "Please try again in a little while."),
  );
}

export function AdminNavigationView({ pathname }: { pathname: string }) {
  const dashboardActive = pathname === "/admin" || pathname === "/admin/";
  const coursesActive = pathname === "/admin/courses" || pathname.startsWith("/admin/courses/");

  return h("nav", { className: "admin-nav", "aria-label": "Administration" },
    h("ul", null,
      h("li", null, h("a", {
        href: "/admin",
        className: dashboardActive ? "admin-nav-link is-active" : "admin-nav-link",
        "aria-current": dashboardActive ? "page" : undefined,
      }, "Dashboard")),
      h("li", null, h("a", {
        href: "/admin/courses",
        className: coursesActive ? "admin-nav-link is-active" : "admin-nav-link",
        "aria-current": coursesActive ? "page" : undefined,
      }, "Courses")),
    ),
  );
}

export function LogoutButtonView({
  pending = false,
  errorMessage = null,
  onClick,
}: {
  pending?: boolean;
  errorMessage?: string | null;
  onClick?(): void;
}) {
  return h("div", { className: "admin-logout" },
    h("button", { type: "button", onClick, disabled: pending }, pending ? "Signing out…" : "Sign out"),
    errorMessage ? h("p", { className: "admin-logout-error", role: "alert" }, errorMessage) : null,
  );
}

export function AdminShellView({
  profile,
  role,
  navigation,
  logoutControl,
  children,
}: {
  profile: AdminPortalProfile;
  role: OrganizationRole;
  navigation: ReactNode;
  logoutControl: ReactNode;
  children?: ReactNode;
}) {
  const displayName = profile.name?.trim() || profile.email;
  return h("div", { className: "admin-shell" },
    h("header", { className: "admin-header" },
      h("a", { className: "admin-brand", href: "/admin", "aria-label": "LMS Platform dashboard" },
        h("span", { className: "admin-brand-mark", "aria-hidden": true }, "L"),
        h("span", null, "LMS Platform"),
      ),
      h("div", { className: "admin-header-details" },
        h("div", { className: "admin-organization" },
          h("span", { className: "admin-header-label" }, "Organization"),
          h("strong", null, profile.organizationName),
        ),
        h("div", { className: "admin-user" },
          h("span", { className: "admin-user-name" }, displayName),
          h("span", { className: "admin-role" }, role),
        ),
      ),
    ),
    h("div", { className: "admin-layout" },
      h("aside", { className: "admin-sidebar", "aria-label": "Admin workspace" },
        h("p", { className: "admin-sidebar-label" }, "Workspace"),
        navigation,
        h("div", { className: "admin-sidebar-footer" }, logoutControl),
      ),
      h("main", { className: "admin-main" }, children),
    ),
  );
}

export function AdminDashboardView({
  profile,
  counts,
}: {
  profile: AdminPortalProfile;
  counts: AdminDashboardCounts;
}) {
  const displayName = profile.name?.trim() || profile.email;
  const cards: Array<[string, string | number, string]> = [
    ["Organization", profile.organizationName, "admin-stat-organization"],
    ["Courses", counts.total, ""],
    ["Draft", counts.draft, ""],
    ["Published", counts.published, ""],
  ];

  return h("div", { className: "admin-page dashboard-page" },
    h("p", { className: "admin-eyebrow" }, "Dashboard"),
    h("h1", null, "Welcome back"),
    h("p", { className: "admin-welcome-name" }, displayName),
    h("section", { className: "admin-stat-grid", "aria-label": "Organization course summary" },
      cards.map(([label, value, className]) => h("article", {
        className: `admin-stat-card ${className}`.trim(),
        key: label,
      },
      h("h2", null, label),
      h("p", null, value),
      )),
    ),
  );
}

function displayDate(value: Date): string {
  return new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(value);
}

export function AdminCourseListView({ courses }: { courses: Course[] }) {
  return h("div", { className: "admin-page courses-page" },
    h("header", { className: "admin-page-header" },
      h("div", null,
        h("p", { className: "admin-eyebrow" }, "Administration"),
        h("h1", null, "Courses"),
      ),
      h("a", { className: "primary-action", href: "/admin/courses/new" }, "New course"),
    ),
    courses.length === 0
      ? h("section", { className: "admin-empty-state", "aria-labelledby": "empty-courses-title" },
          h("h2", { id: "empty-courses-title" }, "No courses yet."),
          h("p", null, "Create your first course to start building training content."),
          h("a", { className: "primary-action empty-state-action", href: "/admin/courses/new" }, "Create course"),
        )
      : h("ul", { className: "admin-course-list", "aria-label": "Courses" },
          courses.map((course) => {
            const statusClass = course.status === "PUBLISHED" ? "is-published" : "is-draft";
            const publishedAt = course.publishedAt?.toISOString() ?? null;
            return h("li", { key: course.id },
              h("article", { className: "admin-course-row" },
                h("div", { className: "admin-course-title" }, h("h2", null, course.title)),
                h("dl", { className: "admin-course-meta" },
                  h("div", null,
                    h("dt", null, "Status"),
                    h("dd", null, h("span", { className: `admin-status-badge ${statusClass}` }, course.status)),
                  ),
                  h("div", null,
                    h("dt", null, "Last updated"),
                    h("dd", null, h("time", { dateTime: course.updatedAt.toISOString() }, displayDate(course.updatedAt))),
                  ),
                  h("div", null,
                    h("dt", null, "Published date"),
                    h("dd", null, publishedAt
                      ? h("time", { dateTime: publishedAt }, displayDate(course.publishedAt!))
                      : "—"),
                  ),
                ),
                h("div", { className: "course-row-actions" },
                  h("a", { className: "secondary-action", href: `/admin/courses/${encodeURIComponent(course.id)}` }, "Manage"),
                  h("a", { className: "admin-preview-link", href: `/courses/${encodeURIComponent(course.id)}/preview` }, "Preview"),
                ),
              ),
            );
          }),
        ),
  );
}
