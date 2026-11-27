import Link from "next/link";
import type { ReactNode } from "react";
import { LogoutButton } from "@/components/logout-button";

export function LearnerShell({ children, home = false, catalog = false }: {
  children: ReactNode;
  home?: boolean;
  catalog?: boolean;
}) {
  return (
    <div className="learner-shell" lang="nl">
      <header className="learner-header">
        <div className="learner-header-inner">
          <nav className="learner-navigation" aria-label="Leeromgeving">
            <Link className="admin-brand learner-home-link" href="/learn"
              aria-current={home ? "page" : undefined} aria-label="LMS Platform — Mijn cursussen">
              <span className="admin-brand-mark" aria-hidden="true">L</span>
              <span>Mijn cursussen</span>
            </Link>
            <Link className="learner-catalog-link" href="/learn/catalog" aria-current={catalog ? "page" : undefined}>
              Catalogus
            </Link>
          </nav>
          <LogoutButton language="nl" />
        </div>
      </header>
      <main className="learner-main">{children}</main>
    </div>
  );
}
