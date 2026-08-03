import { redirect } from "next/navigation";
import { requireEmployeePage } from "@/server/auth/authorization";

export default async function EmployeePrimaryStationPage() {
  await requireEmployeePage("/employee/station");
  redirect("/employee/stations");
}
