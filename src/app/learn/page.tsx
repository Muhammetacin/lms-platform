import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { LogoutButton } from "@/components/logout-button";
import { PortalAccessNotice } from "@/components/portal-access-notice";
import { resolvePortalDestination } from "@/lib/portal-access";
import { getTenantContext } from "@/lib/tenant-context";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const metadata: Metadata = { title: "Mijn cursussen | LMS Platform" };

export default async function LearnerPage() {
  const destination = await resolvePortalDestination(getTenantContext);
  if (destination === "forbidden" || destination === "unavailable") {
    return <PortalAccessNotice reason={destination} />;
  }
  if (destination !== "/learn") redirect(destination);

  return (
    <div className="learner-shell" lang="nl">
      <header className="learner-header">
        <div className="learner-header-inner">
          <nav aria-label="Leeromgeving">
            <Link className="admin-brand learner-home-link" href="/learn" aria-current="page" aria-label="LMS Platform — Mijn cursussen">
              <span className="admin-brand-mark" aria-hidden="true">L</span>
              <span>LMS Platform</span>
            </Link>
          </nav>
          <LogoutButton language="nl" />
        </div>
      </header>
      <main className="learner-main">
        <h1>Mijn cursussen</h1>
        <section className="learner-empty" aria-labelledby="learner-empty-title">
          <h2 id="learner-empty-title">Je hebt nog geen cursussen</h2>
          <p>Zodra een cursus aan je is toegewezen, verschijnt die hier.</p>
        </section>
      </main>
    </div>
  );
}
