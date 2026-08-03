import { EmployeeSopLibrary } from "@/components/sops/employee-sop-library";

export default function RecipesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <EmployeeSopLibrary
      basePath="/employee/recipes"
      title="Recipes"
      description="Published recipe procedures for your location."
      category="recipe"
      emptyTitle="No recipes yet"
      emptyDescription="Your manager hasn't published any recipes here yet."
      searchParams={searchParams}
    />
  );
}
