import { redirect } from "next/navigation";
import { PortalAccessNotice } from "@/components/portal-access-notice";
import { resolvePortalDestination } from "@/lib/portal-access";
import { getTenantContext } from "@/lib/tenant-context";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function LearnerPage() {
  const destination = await resolvePortalDestination(getTenantContext);
  if (destination === "forbidden" || destination === "unavailable") {
    return <PortalAccessNotice reason={destination} />;
  }
  if (destination !== "/learn") redirect(destination);

  return <main><h1>Mijn cursussen</h1></main>;
}
