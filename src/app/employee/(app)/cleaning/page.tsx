import { EmployeeSopLibrary } from "@/components/sops/employee-sop-library";

export default function CleaningPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <EmployeeSopLibrary
      basePath="/employee/cleaning"
      title="Cleaning"
      description="Published cleaning procedures for your location."
      category="cleaning"
      emptyTitle="No cleaning procedures yet"
      emptyDescription="Your manager hasn't published any cleaning procedures here yet."
      searchParams={searchParams}
    />
  );
}
