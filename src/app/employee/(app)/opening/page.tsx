import { EmployeeSopLibrary } from "@/components/sops/employee-sop-library";

export default function OpeningPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <EmployeeSopLibrary
      basePath="/employee/opening"
      title="Opening"
      description="Published opening procedures for your location."
      category="opening"
      emptyTitle="No opening procedures yet"
      emptyDescription="Your manager hasn't published any opening procedures here yet."
      searchParams={searchParams}
    />
  );
}
