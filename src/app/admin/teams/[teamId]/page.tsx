import { TeamDetailPage } from "@/components/team-management";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function AdminTeamDetailPage({
  params,
}: {
  params: Promise<{ teamId: string }>;
}) {
  const { teamId } = await params;
  return <TeamDetailPage key={teamId} teamId={teamId} />;
}
