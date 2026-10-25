import { EmployeeProfilePage } from "@/components/employee-management";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function AdminEmployeeProfilePage({
  params,
}: {
  params: Promise<{ employeeId: string }>;
}) {
  const { employeeId } = await params;
  return <EmployeeProfilePage employeeId={employeeId} />;
}
