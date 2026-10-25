import { EmployeeOverview } from "@/components/employee-management";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function AdminEmployeesPage() {
  return <EmployeeOverview />;
}
