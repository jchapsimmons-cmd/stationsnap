export const CHECKLIST_TYPE_LABELS: Record<string, string> = {
  opening: "Opening",
  closing: "Closing",
  cleaning: "Cleaning",
  prep: "Prep",
  custom: "Custom",
};

export const CHECKLIST_RECURRENCE_LABELS: Record<string, string> = {
  once: "On demand",
  daily: "Once per day",
  weekly: "Once per week",
};

export const CHECKLIST_STATUS_LABELS: Record<string, string> = {
  active: "Active",
  disabled: "Disabled",
};

export const CHECKLIST_STATUS_TONE: Record<
  string,
  "neutral" | "success" | "warning" | "danger" | "info"
> = {
  active: "success",
  disabled: "warning",
};

export const CHECKLIST_RUN_STATUS_LABELS: Record<string, string> = {
  in_progress: "In progress",
  awaiting_approval: "Awaiting review",
  submitted: "Submitted",
  rejected: "Rejected",
};

export const CHECKLIST_RUN_STATUS_TONE: Record<
  string,
  "neutral" | "success" | "warning" | "danger" | "info"
> = {
  in_progress: "warning",
  awaiting_approval: "info",
  submitted: "success",
  rejected: "danger",
};

export const CHECKLIST_APPROVAL_DECISION_LABELS: Record<string, string> = {
  approved: "Approved",
  rejected: "Rejected",
  needs_correction: "Correction requested",
};
