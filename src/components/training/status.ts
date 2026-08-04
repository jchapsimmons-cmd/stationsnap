export const TRAINING_MODE_LABELS: Record<string, string> = {
  learn: "Learn",
  guided: "Guided",
  test: "Test",
  demonstration: "Demonstration",
};

export const ASSIGNMENT_STATUS_TONE: Record<
  string,
  "neutral" | "success" | "warning" | "danger" | "info"
> = {
  assigned: "info",
  in_progress: "warning",
  completed: "success",
  failed: "danger",
  cancelled: "neutral",
};

export const ASSIGNMENT_STATUS_LABELS: Record<string, string> = {
  assigned: "Assigned",
  in_progress: "In progress",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
};

export const ASSIGNMENT_SKIP_REASON_LABELS: Record<string, string> = {
  duplicate_active: "Already has an active or completed assignment for this SOP version",
  employee_inactive: "This employee is disabled",
  location_mismatch: "This employee is not at the SOP's location",
  not_found: "Employee not found",
};
