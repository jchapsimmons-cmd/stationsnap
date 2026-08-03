import { EmployeeSopLibrary } from "@/components/sops/employee-sop-library";

export default function ClosingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <EmployeeSopLibrary
      basePath="/employee/closing"
      title="Closing"
      description="Published closing procedures for your location."
      category="closing"
      emptyTitle="No closing procedures yet"
      emptyDescription="Your manager hasn't published any closing procedures here yet."
      searchParams={searchParams}
    />
  );
}
