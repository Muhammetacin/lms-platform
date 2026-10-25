import { TeamOverview } from "@/components/team-management";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function AdminTeamsPage() {
  return <TeamOverview />;
}
