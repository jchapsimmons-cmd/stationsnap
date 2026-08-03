export const CATEGORY_OPTIONS = [
  { value: "recipe", label: "Recipe" },
  { value: "cleaning", label: "Cleaning" },
  { value: "opening", label: "Opening" },
  { value: "closing", label: "Closing" },
  { value: "safety", label: "Safety" },
  { value: "equipment", label: "Equipment" },
  { value: "customer_service", label: "Customer Service" },
  { value: "general_procedure", label: "General Procedure" },
] as const;

export const DIFFICULTY_OPTIONS = [
  { value: "beginner", label: "Beginner" },
  { value: "intermediate", label: "Intermediate" },
  { value: "advanced", label: "Advanced" },
] as const;

export const STATUS_OPTIONS = [
  { value: "draft", label: "Draft" },
  { value: "published", label: "Published" },
  { value: "archived", label: "Archived" },
] as const;

export function categoryLabel(value: string): string {
  return CATEGORY_OPTIONS.find((option) => option.value === value)?.label ?? value;
}

export function difficultyLabel(value: string): string {
  return DIFFICULTY_OPTIONS.find((option) => option.value === value)?.label ?? value;
}
