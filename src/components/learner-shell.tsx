import Link from "next/link";
import type { ReactNode } from "react";
import { LogoutButton } from "@/components/logout-button";

export function LearnerShell({ children, home = false }: { children: ReactNode; home?: boolean }) {
  return (
    <div className="learner-shell" lang="nl">
      <header className="learner-header">
        <div className="learner-header-inner">
          <nav aria-label="Leeromgeving">
            <Link className="admin-brand learner-home-link" href="/learn"
              aria-current={home ? "page" : undefined} aria-label="LMS Platform — Mijn cursussen">
              <span className="admin-brand-mark" aria-hidden="true">L</span>
              <span>LMS Platform</span>
            </Link>
          </nav>
          <LogoutButton language="nl" />
        </div>
      </header>
      <main className="learner-main">{children}</main>
    </div>
  );
}
