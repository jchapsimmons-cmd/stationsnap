import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const recordStatus = pgEnum("record_status", ["active", "disabled"]);
export const membershipRole = pgEnum("membership_role", ["owner", "manager"]);
export const preferredLanguage = pgEnum("preferred_language", ["en", "es"]);
export const actorType = pgEnum("actor_type", ["manager", "employee", "system", "anonymous"]);
export const loginOutcome = pgEnum("login_outcome", ["success", "failure", "locked", "disabled"]);
export const sopCategory = pgEnum("sop_category", [
  "recipe",
  "cleaning",
  "opening",
  "closing",
  "safety",
  "equipment",
  "customer_service",
  "general_procedure",
]);
export const sopLifecycleStatus = pgEnum("sop_lifecycle_status", [
  "draft",
  "published",
  "archived",
]);
export const sopDifficulty = pgEnum("sop_difficulty", ["beginner", "intermediate", "advanced"]);
export const sopMaterialKind = pgEnum("sop_material_kind", ["material", "ingredient"]);
export const sopRetrainingRuleType = pgEnum("sop_retraining_rule_type", [
  "none",
  "all_qualified",
  "selected_roles",
  "selected_locations",
]);
export const fileMediaType = pgEnum("file_media_type", ["image", "video"]);
export const fileStatus = pgEnum("file_status", ["processing", "ready", "failed"]);
export const qrTargetType = pgEnum("qr_target_type", ["station", "sop"]);
export const qrCodeStatus = pgEnum("qr_code_status", ["active", "revoked"]);
export const qrScanResult = pgEnum("qr_scan_result", [
  "resolved",
  "revoked",
  "unavailable",
  "invalid",
]);
export const trainingRequirementState = pgEnum("training_requirement_state", [
  "disabled",
  "optional",
  "required",
]);
export const trainingMode = pgEnum("training_mode", ["learn", "guided", "test", "demonstration"]);
export const trainingQuestionType = pgEnum("training_question_type", [
  "single_choice",
  "multiple_choice",
  "true_false",
]);
export const trainingQuestionPlacement = pgEnum("training_question_placement", [
  "before_step",
  "after_step",
  "final",
]);
export const trainingExplanationPolicy = pgEnum("training_explanation_policy", [
  "never",
  "on_incorrect",
  "always",
]);
export const trainingAssignmentStatus = pgEnum("training_assignment_status", [
  "assigned",
  "in_progress",
  "completed",
  "failed",
  "cancelled",
]);
export const trainingSessionStatus = pgEnum("training_session_status", [
  "in_progress",
  "awaiting_approval",
  "passed",
  "failed",
]);
export const trainingStepProgressStatus = pgEnum("training_step_progress_status", [
  "pending",
  "in_progress",
  "completed",
]);
export const trainingEvidenceType = pgEnum("training_evidence_type", ["photo", "video"]);
export const trainingEvidenceStatus = pgEnum("training_evidence_status", [
  "pending",
  "approved",
  "rejected",
]);
export const approvalSubmissionStatus = pgEnum("approval_submission_status", [
  "pending",
  "approved",
  "rejected",
  "needs_correction",
]);
export const approvalDecisionType = pgEnum("approval_decision_type", [
  "approved",
  "rejected",
  "needs_correction",
]);
export const qualificationStatus = pgEnum("qualification_status", ["active", "revoked"]);
export const trainingPathVersionPolicy = pgEnum("training_path_version_policy", [
  "current_version",
  "any_passed_version",
]);
export const checklistType = pgEnum("checklist_type", [
  "opening",
  "closing",
  "cleaning",
  "prep",
  "custom",
]);
export const checklistRecurrenceType = pgEnum("checklist_recurrence_type", [
  "once",
  "daily",
  "weekly",
]);
export const checklistRunStatus = pgEnum("checklist_run_status", [
  "in_progress",
  "awaiting_approval",
  "submitted",
  "rejected",
]);
export const checklistItemProgressStatus = pgEnum("checklist_item_progress_status", [
  "pending",
  "in_progress",
  "completed",
]);
export const checklistEvidenceType = pgEnum("checklist_evidence_type", ["photo"]);
export const checklistEvidenceStatus = pgEnum("checklist_evidence_status", [
  "pending",
  "approved",
  "rejected",
]);
export const checklistApprovalSubmissionStatus = pgEnum("checklist_approval_submission_status", [
  "pending",
  "approved",
  "rejected",
  "needs_correction",
]);
export const checklistApprovalDecisionType = pgEnum("checklist_approval_decision_type", [
  "approved",
  "rejected",
  "needs_correction",
]);

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

export const organizations = pgTable(
  "organizations",
  {
    id: uuid("id").primaryKey(),
    accessSlug: text("access_slug").notNull(),
    name: text("name").notNull(),
    logoUrl: text("logo_url"),
    defaultLanguage: preferredLanguage("default_language").notNull().default("en"),
    timezone: text("timezone").notNull(),
    status: recordStatus("status").notNull().default("active"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("organizations_access_slug_uidx").on(table.accessSlug),
    index("organizations_status_idx").on(table.status),
  ],
);

export const locations = pgTable(
  "locations",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    accessSlug: text("access_slug").notNull(),
    name: text("name").notNull(),
    timezone: text("timezone").notNull(),
    status: recordStatus("status").notNull().default("active"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("locations_org_name_uidx").on(table.organizationId, table.name),
    uniqueIndex("locations_org_slug_uidx").on(table.organizationId, table.accessSlug),
    unique("locations_id_org_unique").on(table.id, table.organizationId),
    index("locations_org_status_idx").on(table.organizationId, table.status),
  ],
);

export const stations = pgTable(
  "stations",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    locationId: uuid("location_id").notNull(),
    name: text("name").notNull(),
    imageUrl: text("image_url"),
    description: text("description").notNull().default(""),
    displayOrder: integer("display_order").notNull(),
    status: recordStatus("status").notNull().default("active"),
    ...timestamps,
  },
  (table) => [
    foreignKey({
      columns: [table.locationId, table.organizationId],
      foreignColumns: [locations.id, locations.organizationId],
      name: "stations_location_org_fk",
    }).onDelete("restrict"),
    uniqueIndex("stations_location_name_uidx").on(table.locationId, table.name),
    uniqueIndex("stations_location_order_uidx").on(table.locationId, table.displayOrder),
    unique("stations_id_org_location_unique").on(table.id, table.organizationId, table.locationId),
    index("stations_org_location_status_idx").on(
      table.organizationId,
      table.locationId,
      table.status,
    ),
  ],
);

export const managerUsers = pgTable("manager_users", {
  id: uuid("id").primaryKey(),
  email: text("email").notNull().unique(),
  displayName: text("display_name").notNull(),
  passwordHash: text("password_hash"),
  status: recordStatus("status").notNull().default("active"),
  ...timestamps,
});

export const managerMemberships = pgTable(
  "manager_memberships",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    managerUserId: uuid("manager_user_id")
      .notNull()
      .references(() => managerUsers.id, { onDelete: "restrict" }),
    role: membershipRole("role").notNull(),
    status: recordStatus("status").notNull().default("active"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("manager_memberships_org_user_uidx").on(table.organizationId, table.managerUserId),
    unique("manager_memberships_id_org_unique").on(table.id, table.organizationId),
    unique("manager_memberships_id_org_user_unique").on(
      table.id,
      table.organizationId,
      table.managerUserId,
    ),
    index("manager_memberships_org_status_idx").on(table.organizationId, table.status),
  ],
);

export const managerLocationAccess = pgTable(
  "manager_location_access",
  {
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    membershipId: uuid("membership_id").notNull(),
    locationId: uuid("location_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.membershipId, table.locationId] }),
    foreignKey({
      columns: [table.membershipId, table.organizationId],
      foreignColumns: [managerMemberships.id, managerMemberships.organizationId],
      name: "manager_location_access_membership_org_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.locationId, table.organizationId],
      foreignColumns: [locations.id, locations.organizationId],
      name: "manager_location_access_location_org_fk",
    }).onDelete("cascade"),
    index("manager_location_access_org_location_idx").on(table.organizationId, table.locationId),
  ],
);

export const employees = pgTable(
  "employees",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    primaryLocationId: uuid("primary_location_id").notNull(),
    employeeNumber: text("employee_number").notNull(),
    displayName: text("display_name").notNull(),
    jobRole: text("job_role").notNull(),
    language: preferredLanguage("preferred_language").notNull().default("en"),
    pinHash: text("pin_hash"),
    status: recordStatus("status").notNull().default("active"),
    ...timestamps,
  },
  (table) => [
    foreignKey({
      columns: [table.primaryLocationId, table.organizationId],
      foreignColumns: [locations.id, locations.organizationId],
      name: "employees_location_org_fk",
    }).onDelete("restrict"),
    uniqueIndex("employees_org_number_uidx").on(table.organizationId, table.employeeNumber),
    unique("employees_id_org_unique").on(table.id, table.organizationId),
    unique("employees_id_org_location_unique").on(
      table.id,
      table.organizationId,
      table.primaryLocationId,
    ),
    index("employees_org_location_status_idx").on(
      table.organizationId,
      table.primaryLocationId,
      table.status,
    ),
  ],
);

export const managerSessions = pgTable(
  "manager_sessions",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    membershipId: uuid("membership_id").notNull(),
    managerUserId: uuid("manager_user_id")
      .notNull()
      .references(() => managerUsers.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.membershipId, table.organizationId],
      foreignColumns: [managerMemberships.id, managerMemberships.organizationId],
      name: "manager_sessions_membership_org_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.membershipId, table.organizationId, table.managerUserId],
      foreignColumns: [
        managerMemberships.id,
        managerMemberships.organizationId,
        managerMemberships.managerUserId,
      ],
      name: "manager_sessions_membership_org_user_fk",
    }).onDelete("cascade"),
    uniqueIndex("manager_sessions_token_hash_uidx").on(table.tokenHash),
    index("manager_sessions_user_expiry_idx").on(table.managerUserId, table.expiresAt),
  ],
);

export const employeeSessions = pgTable(
  "employee_sessions",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    locationId: uuid("location_id").notNull(),
    employeeId: uuid("employee_id").notNull(),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.employeeId, table.organizationId],
      foreignColumns: [employees.id, employees.organizationId],
      name: "employee_sessions_employee_org_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.employeeId, table.organizationId, table.locationId],
      foreignColumns: [employees.id, employees.organizationId, employees.primaryLocationId],
      name: "employee_sessions_employee_org_location_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.locationId, table.organizationId],
      foreignColumns: [locations.id, locations.organizationId],
      name: "employee_sessions_location_org_fk",
    }).onDelete("cascade"),
    uniqueIndex("employee_sessions_token_hash_uidx").on(table.tokenHash),
    index("employee_sessions_employee_expiry_idx").on(table.employeeId, table.expiresAt),
  ],
);

export const passwordResetTokens = pgTable(
  "password_reset_tokens",
  {
    id: uuid("id").primaryKey(),
    managerUserId: uuid("manager_user_id")
      .notNull()
      .references(() => managerUsers.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("password_reset_tokens_hash_uidx").on(table.tokenHash),
    index("password_reset_tokens_user_expiry_idx").on(table.managerUserId, table.expiresAt),
  ],
);

export const authRateLimits = pgTable("auth_rate_limits", {
  keyHash: text("key_hash").primaryKey(),
  failures: integer("failures").notNull().default(0),
  windowStartedAt: timestamp("window_started_at", { withTimezone: true }).notNull(),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const loginAttempts = pgTable(
  "login_attempts",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id").references(() => organizations.id, {
      onDelete: "set null",
    }),
    actorKind: actorType("actor_type").notNull(),
    subjectHash: text("subject_hash").notNull(),
    ipHash: text("ip_hash").notNull(),
    outcome: loginOutcome("outcome").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("login_attempts_subject_created_idx").on(table.subjectHash, table.createdAt)],
);

export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id").references(() => organizations.id, {
      onDelete: "restrict",
    }),
    locationId: uuid("location_id"),
    actorKind: actorType("actor_type").notNull(),
    actorId: uuid("actor_id"),
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: uuid("target_id"),
    metadata: jsonb("metadata")
      .$type<Record<string, string | number | boolean | null>>()
      .notNull()
      .default({}),
    requestId: text("request_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.locationId, table.organizationId],
      foreignColumns: [locations.id, locations.organizationId],
      name: "audit_events_location_org_fk",
    }).onDelete("restrict"),
    index("audit_events_org_created_idx").on(table.organizationId, table.createdAt),
    index("audit_events_action_created_idx").on(table.action, table.createdAt),
  ],
);

export const files = pgTable(
  "files",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    uploaderManagerUserId: uuid("uploader_manager_user_id").references(() => managerUsers.id, {
      onDelete: "restrict",
    }),
    uploaderEmployeeId: uuid("uploader_employee_id"),
    objectKey: text("object_key").notNull(),
    originalName: text("original_name").notNull(),
    mediaType: fileMediaType("media_type").notNull(),
    mimeType: text("mime_type").notNull(),
    byteSize: integer("byte_size").notNull(),
    checksum: text("checksum").notNull(),
    status: fileStatus("status").notNull().default("processing"),
    width: integer("width"),
    height: integer("height"),
    durationSeconds: integer("duration_seconds"),
    ...timestamps,
  },
  (table) => [
    foreignKey({
      columns: [table.uploaderEmployeeId, table.organizationId],
      foreignColumns: [employees.id, employees.organizationId],
      name: "files_uploader_employee_org_fk",
    }).onDelete("restrict"),
    check(
      "files_uploader_actor_check",
      sql`(uploader_manager_user_id is not null) <> (uploader_employee_id is not null)`,
    ),
    uniqueIndex("files_object_key_uidx").on(table.objectKey),
    unique("files_id_org_unique").on(table.id, table.organizationId),
    index("files_org_status_idx").on(table.organizationId, table.status),
  ],
);

export const sops = pgTable(
  "sops",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    locationId: uuid("location_id").notNull(),
    stationId: uuid("station_id"),
    category: sopCategory("category").notNull(),
    status: sopLifecycleStatus("status").notNull().default("draft"),
    currentVersionId: uuid("current_version_id"),
    createdByManagerUserId: uuid("created_by_manager_user_id")
      .notNull()
      .references(() => managerUsers.id, { onDelete: "restrict" }),
    ...timestamps,
  },
  (table) => [
    foreignKey({
      columns: [table.locationId, table.organizationId],
      foreignColumns: [locations.id, locations.organizationId],
      name: "sops_location_org_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.stationId, table.organizationId, table.locationId],
      foreignColumns: [stations.id, stations.organizationId, stations.locationId],
      name: "sops_station_org_location_fk",
    }).onDelete("restrict"),
    unique("sops_id_org_unique").on(table.id, table.organizationId),
    index("sops_org_location_status_idx").on(
      table.organizationId,
      table.locationId,
      table.status,
      table.updatedAt,
    ),
    index("sops_org_category_idx").on(table.organizationId, table.category),
    index("sops_org_station_idx").on(table.organizationId, table.stationId),
  ],
);

export const sopVersions = pgTable(
  "sop_versions",
  {
    id: uuid("id").primaryKey(),
    sopId: uuid("sop_id").notNull(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    versionNumber: integer("version_number").notNull(),
    status: sopLifecycleStatus("status").notNull().default("draft"),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    category: sopCategory("category").notNull(),
    estimatedMinutes: integer("estimated_minutes"),
    difficulty: sopDifficulty("difficulty").notNull().default("beginner"),
    coverImageFileId: uuid("cover_image_file_id"),
    sourceVideoFileId: uuid("source_video_file_id"),
    revision: integer("revision").notNull().default(1),
    changeSummary: text("change_summary").notNull().default(""),
    sourceVersionId: uuid("source_version_id"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    publishedByManagerUserId: uuid("published_by_manager_user_id").references(
      () => managerUsers.id,
      { onDelete: "restrict" },
    ),
    ...timestamps,
  },
  (table) => [
    foreignKey({
      columns: [table.sopId, table.organizationId],
      foreignColumns: [sops.id, sops.organizationId],
      name: "sop_versions_sop_org_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.coverImageFileId, table.organizationId],
      foreignColumns: [files.id, files.organizationId],
      name: "sop_versions_cover_file_org_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.sourceVideoFileId, table.organizationId],
      foreignColumns: [files.id, files.organizationId],
      name: "sop_versions_source_file_org_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.sourceVersionId, table.sopId],
      foreignColumns: [table.id, table.sopId],
      name: "sop_versions_source_version_sop_fk",
    }).onDelete("set null"),
    unique("sop_versions_sop_version_number_uidx").on(table.sopId, table.versionNumber),
    unique("sop_versions_id_sop_unique").on(table.id, table.sopId),
    unique("sop_versions_id_org_unique").on(table.id, table.organizationId),
    index("sop_versions_org_status_idx").on(table.organizationId, table.status),
  ],
);

export const sopMaterials = pgTable(
  "sop_materials",
  {
    id: uuid("id").primaryKey(),
    sopVersionId: uuid("sop_version_id").notNull(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    kind: sopMaterialKind("kind").notNull(),
    name: text("name").notNull(),
    quantity: text("quantity").notNull().default(""),
    unit: text("unit").notNull().default(""),
    displayOrder: integer("display_order").notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.sopVersionId, table.organizationId],
      foreignColumns: [sopVersions.id, sopVersions.organizationId],
      name: "sop_materials_version_org_fk",
    }).onDelete("cascade"),
    index("sop_materials_version_order_idx").on(table.sopVersionId, table.displayOrder),
  ],
);

export const sopWarnings = pgTable(
  "sop_warnings",
  {
    id: uuid("id").primaryKey(),
    sopVersionId: uuid("sop_version_id").notNull(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    text: text("text").notNull(),
    displayOrder: integer("display_order").notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.sopVersionId, table.organizationId],
      foreignColumns: [sopVersions.id, sopVersions.organizationId],
      name: "sop_warnings_version_org_fk",
    }).onDelete("cascade"),
    index("sop_warnings_version_order_idx").on(table.sopVersionId, table.displayOrder),
  ],
);

export const sopSteps = pgTable(
  "sop_steps",
  {
    id: uuid("id").primaryKey(),
    sopVersionId: uuid("sop_version_id").notNull(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    displayOrder: integer("display_order").notNull(),
    title: text("title"),
    instruction: text("instruction").notNull(),
    imageFileId: uuid("image_file_id"),
    videoFileId: uuid("video_file_id"),
    warning: text("warning"),
    quantity: text("quantity"),
    unit: text("unit"),
    equipmentSetting: text("equipment_setting"),
    timerSeconds: integer("timer_seconds"),
    isRequired: boolean("is_required").notNull().default(true),
    ...timestamps,
  },
  (table) => [
    foreignKey({
      columns: [table.sopVersionId, table.organizationId],
      foreignColumns: [sopVersions.id, sopVersions.organizationId],
      name: "sop_steps_version_org_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.imageFileId, table.organizationId],
      foreignColumns: [files.id, files.organizationId],
      name: "sop_steps_image_file_org_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.videoFileId, table.organizationId],
      foreignColumns: [files.id, files.organizationId],
      name: "sop_steps_video_file_org_fk",
    }).onDelete("restrict"),
    unique("sop_steps_id_org_unique").on(table.id, table.organizationId),
    index("sop_steps_version_order_idx").on(table.sopVersionId, table.displayOrder),
  ],
);

export const sopRetrainingRules = pgTable(
  "sop_retraining_rules",
  {
    id: uuid("id").primaryKey(),
    sopVersionId: uuid("sop_version_id").notNull(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    ruleType: sopRetrainingRuleType("rule_type").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.sopVersionId, table.organizationId],
      foreignColumns: [sopVersions.id, sopVersions.organizationId],
      name: "sop_retraining_rules_version_org_fk",
    }).onDelete("cascade"),
    unique("sop_retraining_rules_version_uidx").on(table.sopVersionId),
    unique("sop_retraining_rules_id_org_unique").on(table.id, table.organizationId),
  ],
);

export const sopRetrainingRuleRoles = pgTable(
  "sop_retraining_rule_roles",
  {
    id: uuid("id").primaryKey(),
    ruleId: uuid("rule_id").notNull(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    jobRole: text("job_role").notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.ruleId, table.organizationId],
      foreignColumns: [sopRetrainingRules.id, sopRetrainingRules.organizationId],
      name: "sop_retraining_rule_roles_rule_org_fk",
    }).onDelete("cascade"),
    unique("sop_retraining_rule_roles_rule_role_uidx").on(table.ruleId, table.jobRole),
  ],
);

export const sopRetrainingRuleLocations = pgTable(
  "sop_retraining_rule_locations",
  {
    id: uuid("id").primaryKey(),
    ruleId: uuid("rule_id").notNull(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    locationId: uuid("location_id").notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.ruleId, table.organizationId],
      foreignColumns: [sopRetrainingRules.id, sopRetrainingRules.organizationId],
      name: "sop_retraining_rule_locations_rule_org_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.locationId, table.organizationId],
      foreignColumns: [locations.id, locations.organizationId],
      name: "sop_retraining_rule_locations_location_org_fk",
    }).onDelete("cascade"),
    unique("sop_retraining_rule_locations_rule_location_uidx").on(table.ruleId, table.locationId),
  ],
);

export const sopRecentViews = pgTable(
  "sop_recent_views",
  {
    id: uuid("id").primaryKey(),
    employeeId: uuid("employee_id").notNull(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    sopId: uuid("sop_id").notNull(),
    lastViewedAt: timestamp("last_viewed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.employeeId, table.organizationId],
      foreignColumns: [employees.id, employees.organizationId],
      name: "sop_recent_views_employee_org_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.sopId, table.organizationId],
      foreignColumns: [sops.id, sops.organizationId],
      name: "sop_recent_views_sop_org_fk",
    }).onDelete("cascade"),
    unique("sop_recent_views_employee_sop_uidx").on(table.employeeId, table.sopId),
    index("sop_recent_views_employee_viewed_idx").on(table.employeeId, table.lastViewedAt),
  ],
);

export const qrCodes = pgTable(
  "qr_codes",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    locationId: uuid("location_id").notNull(),
    targetType: qrTargetType("target_type").notNull(),
    targetId: uuid("target_id").notNull(),
    label: text("label").notNull().default(""),
    tokenHash: text("token_hash").notNull(),
    status: qrCodeStatus("status").notNull().default("active"),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdByManagerUserId: uuid("created_by_manager_user_id")
      .notNull()
      .references(() => managerUsers.id, { onDelete: "restrict" }),
    ...timestamps,
  },
  (table) => [
    foreignKey({
      columns: [table.locationId, table.organizationId],
      foreignColumns: [locations.id, locations.organizationId],
      name: "qr_codes_location_org_fk",
    }).onDelete("restrict"),
    unique("qr_codes_id_org_unique").on(table.id, table.organizationId),
    uniqueIndex("qr_codes_token_hash_uidx").on(table.tokenHash),
    index("qr_codes_org_location_status_idx").on(
      table.organizationId,
      table.locationId,
      table.status,
    ),
  ],
);

export const qrScanEvents = pgTable(
  "qr_scan_events",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id").references(() => organizations.id, {
      onDelete: "restrict",
    }),
    qrCodeId: uuid("qr_code_id").references(() => qrCodes.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    result: qrScanResult("result").notNull(),
    employeeId: uuid("employee_id"),
    ipHash: text("ip_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("qr_scan_events_qr_created_idx").on(table.qrCodeId, table.createdAt),
    index("qr_scan_events_token_created_idx").on(table.tokenHash, table.createdAt),
  ],
);

export const trainingConfigs = pgTable(
  "training_configs",
  {
    id: uuid("id").primaryKey(),
    sopVersionId: uuid("sop_version_id").notNull(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    requirementState: trainingRequirementState("requirement_state").notNull().default("disabled"),
    defaultMode: trainingMode("default_mode").notNull().default("learn"),
    allowBacktracking: boolean("allow_backtracking").notNull().default(true),
    requireSequentialProgress: boolean("require_sequential_progress").notNull().default(true),
    requireFullVideoWatch: boolean("require_full_video_watch").notNull().default(false),
    requireEvidenceApproval: boolean("require_evidence_approval").notNull().default(true),
    passingScorePercent: integer("passing_score_percent").notNull().default(80),
    maxAttempts: integer("max_attempts").notNull().default(3),
    qualificationValidityDays: integer("qualification_validity_days"),
    retrainingGraceDays: integer("retraining_grace_days"),
    ...timestamps,
  },
  (table) => [
    foreignKey({
      columns: [table.sopVersionId, table.organizationId],
      foreignColumns: [sopVersions.id, sopVersions.organizationId],
      name: "training_configs_version_org_fk",
    }).onDelete("cascade"),
    unique("training_configs_version_uidx").on(table.sopVersionId),
    unique("training_configs_id_org_unique").on(table.id, table.organizationId),
  ],
);

export const stepTrainingRequirements = pgTable(
  "step_training_requirements",
  {
    id: uuid("id").primaryKey(),
    stepId: uuid("step_id").notNull(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    requireFullVideo: boolean("require_full_video").notNull().default(false),
    requireConfirmation: boolean("require_confirmation").notNull().default(false),
    requireTimer: boolean("require_timer").notNull().default(false),
    requireQuestion: boolean("require_question").notNull().default(false),
    requirePhoto: boolean("require_photo").notNull().default(false),
    requireVideo: boolean("require_video").notNull().default(false),
    requireApproval: boolean("require_approval").notNull().default(false),
    ...timestamps,
  },
  (table) => [
    foreignKey({
      columns: [table.stepId, table.organizationId],
      foreignColumns: [sopSteps.id, sopSteps.organizationId],
      name: "step_training_requirements_step_org_fk",
    }).onDelete("cascade"),
    unique("step_training_requirements_step_uidx").on(table.stepId),
    unique("step_training_requirements_id_org_unique").on(table.id, table.organizationId),
  ],
);

export const trainingQuestions = pgTable(
  "training_questions",
  {
    id: uuid("id").primaryKey(),
    sopVersionId: uuid("sop_version_id").notNull(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    stepId: uuid("step_id"),
    type: trainingQuestionType("type").notNull(),
    text: text("text").notNull(),
    explanation: text("explanation").notNull().default(""),
    points: integer("points").notNull().default(1),
    placement: trainingQuestionPlacement("placement").notNull(),
    displayOrder: integer("display_order").notNull(),
    explanationPolicy: trainingExplanationPolicy("explanation_policy")
      .notNull()
      .default("on_incorrect"),
    ...timestamps,
  },
  (table) => [
    foreignKey({
      columns: [table.sopVersionId, table.organizationId],
      foreignColumns: [sopVersions.id, sopVersions.organizationId],
      name: "training_questions_version_org_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.stepId, table.organizationId],
      foreignColumns: [sopSteps.id, sopSteps.organizationId],
      name: "training_questions_step_org_fk",
    }).onDelete("cascade"),
    unique("training_questions_id_org_unique").on(table.id, table.organizationId),
    index("training_questions_version_step_order_idx").on(
      table.sopVersionId,
      table.stepId,
      table.displayOrder,
    ),
  ],
);

export const trainingQuestionChoices = pgTable(
  "training_question_choices",
  {
    id: uuid("id").primaryKey(),
    questionId: uuid("question_id").notNull(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    text: text("text").notNull(),
    isCorrect: boolean("is_correct").notNull().default(false),
    displayOrder: integer("display_order").notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.questionId, table.organizationId],
      foreignColumns: [trainingQuestions.id, trainingQuestions.organizationId],
      name: "training_question_choices_question_org_fk",
    }).onDelete("cascade"),
    index("training_question_choices_question_order_idx").on(table.questionId, table.displayOrder),
  ],
);

export const trainingAssignments = pgTable(
  "training_assignments",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    locationId: uuid("location_id").notNull(),
    employeeId: uuid("employee_id").notNull(),
    sopVersionId: uuid("sop_version_id").notNull(),
    requiredMode: trainingMode("required_mode").notNull(),
    status: trainingAssignmentStatus("status").notNull().default("assigned"),
    assignedByManagerUserId: uuid("assigned_by_manager_user_id").references(() => managerUsers.id, {
      onDelete: "restrict",
    }),
    dueAt: timestamp("due_at", { withTimezone: true }),
    dueTimezone: text("due_timezone"),
    retrainingGeneration: integer("retraining_generation").notNull().default(0),
    ...timestamps,
  },
  (table) => [
    foreignKey({
      columns: [table.locationId, table.organizationId],
      foreignColumns: [locations.id, locations.organizationId],
      name: "training_assignments_location_org_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.employeeId, table.organizationId, table.locationId],
      foreignColumns: [employees.id, employees.organizationId, employees.primaryLocationId],
      name: "training_assignments_employee_org_location_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.sopVersionId, table.organizationId],
      foreignColumns: [sopVersions.id, sopVersions.organizationId],
      name: "training_assignments_version_org_fk",
    }).onDelete("restrict"),
    unique("training_assignments_id_org_unique").on(table.id, table.organizationId),
    unique("training_assignments_employee_version_generation_uidx").on(
      table.employeeId,
      table.sopVersionId,
      table.retrainingGeneration,
    ),
    index("training_assignments_org_location_status_idx").on(
      table.organizationId,
      table.locationId,
      table.status,
    ),
    index("training_assignments_employee_status_idx").on(table.employeeId, table.status),
  ],
);

export const trainingSessions = pgTable(
  "training_sessions",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    assignmentId: uuid("assignment_id").notNull(),
    attemptNumber: integer("attempt_number").notNull(),
    mode: trainingMode("mode").notNull(),
    status: trainingSessionStatus("status").notNull().default("in_progress"),
    currentStepId: uuid("current_step_id"),
    scorePercent: integer("score_percent"),
    revision: integer("revision").notNull().default(1),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    lastResumedAt: timestamp("last_resumed_at", { withTimezone: true }).notNull().defaultNow(),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    foreignKey({
      columns: [table.assignmentId, table.organizationId],
      foreignColumns: [trainingAssignments.id, trainingAssignments.organizationId],
      name: "training_sessions_assignment_org_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.currentStepId, table.organizationId],
      foreignColumns: [sopSteps.id, sopSteps.organizationId],
      name: "training_sessions_current_step_org_fk",
    }).onDelete("set null"),
    unique("training_sessions_id_org_unique").on(table.id, table.organizationId),
    unique("training_sessions_assignment_attempt_uidx").on(table.assignmentId, table.attemptNumber),
    index("training_sessions_assignment_status_idx").on(table.assignmentId, table.status),
  ],
);

export const trainingStepProgress = pgTable(
  "training_step_progress",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    sessionId: uuid("session_id").notNull(),
    stepId: uuid("step_id").notNull(),
    status: trainingStepProgressStatus("status").notNull().default("pending"),
    confirmed: boolean("confirmed").notNull().default(false),
    videoWatchedFully: boolean("video_watched_fully").notNull().default(false),
    timerCompleted: boolean("timer_completed").notNull().default(false),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    foreignKey({
      columns: [table.sessionId, table.organizationId],
      foreignColumns: [trainingSessions.id, trainingSessions.organizationId],
      name: "training_step_progress_session_org_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.stepId, table.organizationId],
      foreignColumns: [sopSteps.id, sopSteps.organizationId],
      name: "training_step_progress_step_org_fk",
    }).onDelete("cascade"),
    unique("training_step_progress_session_step_uidx").on(table.sessionId, table.stepId),
  ],
);

export const trainingAnswers = pgTable(
  "training_answers",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    sessionId: uuid("session_id").notNull(),
    questionId: uuid("question_id").notNull(),
    selectedChoiceIds: jsonb("selected_choice_ids").$type<string[]>().notNull().default([]),
    isCorrect: boolean("is_correct").notNull().default(false),
    pointsAwarded: integer("points_awarded").notNull().default(0),
    answeredAt: timestamp("answered_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.sessionId, table.organizationId],
      foreignColumns: [trainingSessions.id, trainingSessions.organizationId],
      name: "training_answers_session_org_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.questionId, table.organizationId],
      foreignColumns: [trainingQuestions.id, trainingQuestions.organizationId],
      name: "training_answers_question_org_fk",
    }).onDelete("cascade"),
    unique("training_answers_session_question_uidx").on(table.sessionId, table.questionId),
  ],
);

export const trainingEvidence = pgTable(
  "training_evidence",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    sessionId: uuid("session_id").notNull(),
    stepId: uuid("step_id"),
    fileId: uuid("file_id").notNull(),
    evidenceType: trainingEvidenceType("evidence_type").notNull(),
    submissionGeneration: integer("submission_generation").notNull().default(1),
    status: trainingEvidenceStatus("status").notNull().default("pending"),
    employeeNote: text("employee_note").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.sessionId, table.organizationId],
      foreignColumns: [trainingSessions.id, trainingSessions.organizationId],
      name: "training_evidence_session_org_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.stepId, table.organizationId],
      foreignColumns: [sopSteps.id, sopSteps.organizationId],
      name: "training_evidence_step_org_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.fileId, table.organizationId],
      foreignColumns: [files.id, files.organizationId],
      name: "training_evidence_file_org_fk",
    }).onDelete("restrict"),
    unique("training_evidence_session_step_generation_uidx").on(
      table.sessionId,
      table.stepId,
      table.submissionGeneration,
    ),
    index("training_evidence_session_idx").on(table.sessionId),
  ],
);

export const approvalSubmissions = pgTable(
  "approval_submissions",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    sessionId: uuid("session_id").notNull(),
    submissionGeneration: integer("submission_generation").notNull().default(1),
    status: approvalSubmissionStatus("status").notNull().default("pending"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.sessionId, table.organizationId],
      foreignColumns: [trainingSessions.id, trainingSessions.organizationId],
      name: "approval_submissions_session_org_fk",
    }).onDelete("cascade"),
    unique("approval_submissions_id_org_unique").on(table.id, table.organizationId),
    unique("approval_submissions_session_generation_uidx").on(
      table.sessionId,
      table.submissionGeneration,
    ),
    index("approval_submissions_org_status_idx").on(table.organizationId, table.status),
    index("approval_submissions_org_status_submitted_idx").on(
      table.organizationId,
      table.status,
      table.submittedAt,
    ),
  ],
);

/**
 * One immutable row per manager decision on an approval submission. The application layer only
 * ever inserts here: a decision is never updated or deleted, so a submission's full review
 * history — including every superseded correction round — stays readable forever.
 * `pinConfirmationAuditEventId` is the documented optional PIN-confirmation reference; managers
 * do not hold PINs today, so it is written as null until a PIN re-entry flow exists.
 */
export const approvalDecisions = pgTable(
  "approval_decisions",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    submissionId: uuid("submission_id").notNull(),
    decision: approvalDecisionType("decision").notNull(),
    note: text("note").notNull().default(""),
    decidedByManagerUserId: uuid("decided_by_manager_user_id")
      .notNull()
      .references(() => managerUsers.id, { onDelete: "restrict" }),
    pinConfirmationAuditEventId: uuid("pin_confirmation_audit_event_id").references(
      () => auditEvents.id,
      { onDelete: "restrict" },
    ),
    decidedAt: timestamp("decided_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.submissionId, table.organizationId],
      foreignColumns: [approvalSubmissions.id, approvalSubmissions.organizationId],
      name: "approval_decisions_submission_org_fk",
    }).onDelete("restrict"),
    unique("approval_decisions_id_org_unique").on(table.id, table.organizationId),
    index("approval_decisions_submission_decided_idx").on(table.submissionId, table.decidedAt),
    index("approval_decisions_org_decided_idx").on(table.organizationId, table.decidedAt),
  ],
);

/**
 * One row per `needs_correction` decision. The manager note is not copied here: it lives on the
 * owning `approval_decisions` row, so the required-note rule is validated and stored exactly once.
 * `replacementGeneration` is the approval-submission generation the employee's resubmission will
 * take; it is deliberately independent of `training_evidence.submission_generation`, which counts
 * evidence revisions within a live session. Resolution is the only mutation: the original evidence
 * and the decision that requested the fix always stay linked and readable.
 */
export const correctionRequests = pgTable(
  "correction_requests",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    submissionId: uuid("submission_id").notNull(),
    decisionId: uuid("decision_id").notNull(),
    replacementGeneration: integer("replacement_generation").notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedSubmissionId: uuid("resolved_submission_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.submissionId, table.organizationId],
      foreignColumns: [approvalSubmissions.id, approvalSubmissions.organizationId],
      name: "correction_requests_submission_org_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.decisionId, table.organizationId],
      foreignColumns: [approvalDecisions.id, approvalDecisions.organizationId],
      name: "correction_requests_decision_org_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.resolvedSubmissionId, table.organizationId],
      foreignColumns: [approvalSubmissions.id, approvalSubmissions.organizationId],
      name: "correction_requests_resolved_submission_org_fk",
    }).onDelete("restrict"),
    unique("correction_requests_decision_uidx").on(table.decisionId),
    uniqueIndex("correction_requests_open_submission_uidx")
      .on(table.submissionId)
      .where(sql`resolved_at is null`),
    index("correction_requests_org_submission_idx").on(table.organizationId, table.submissionId),
  ],
);

/**
 * One row per awardable qualification. Deliberately no standalone manager route: a definition is
 * always created and edited together with its one owning `training_paths` row, in the same
 * request. `locationId`/`stationId` are copied from the owning path at creation and never change.
 */
export const qualificationDefinitions = pgTable(
  "qualification_definitions",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    locationId: uuid("location_id").notNull(),
    stationId: uuid("station_id"),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    defaultValidityDays: integer("default_validity_days"),
    status: recordStatus("status").notNull().default("active"),
    ...timestamps,
  },
  (table) => [
    foreignKey({
      columns: [table.locationId, table.organizationId],
      foreignColumns: [locations.id, locations.organizationId],
      name: "qualification_definitions_location_org_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.stationId, table.organizationId, table.locationId],
      foreignColumns: [stations.id, stations.organizationId, stations.locationId],
      name: "qualification_definitions_station_org_location_fk",
    }).onDelete("restrict"),
    unique("qualification_definitions_id_org_unique").on(table.id, table.organizationId),
    uniqueIndex("qualification_definitions_org_name_uidx").on(table.organizationId, table.name),
    index("qualification_definitions_org_location_status_idx").on(
      table.organizationId,
      table.locationId,
      table.status,
    ),
  ],
);

/**
 * A manager-composed ordered list of SOPs, scoped to one location (and optionally one station
 * within it), that awards its 1:1 `qualificationDefinitionId` once every required item is
 * satisfied. `locationId`/`stationId` are immutable after creation, unlike stations, which do
 * allow moving location.
 */
export const trainingPaths = pgTable(
  "training_paths",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    locationId: uuid("location_id").notNull(),
    stationId: uuid("station_id"),
    qualificationDefinitionId: uuid("qualification_definition_id").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    enforceOrder: boolean("enforce_order").notNull().default(true),
    status: recordStatus("status").notNull().default("active"),
    ...timestamps,
  },
  (table) => [
    foreignKey({
      columns: [table.locationId, table.organizationId],
      foreignColumns: [locations.id, locations.organizationId],
      name: "training_paths_location_org_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.stationId, table.organizationId, table.locationId],
      foreignColumns: [stations.id, stations.organizationId, stations.locationId],
      name: "training_paths_station_org_location_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.qualificationDefinitionId, table.organizationId],
      foreignColumns: [qualificationDefinitions.id, qualificationDefinitions.organizationId],
      name: "training_paths_definition_org_fk",
    }).onDelete("restrict"),
    unique("training_paths_id_org_unique").on(table.id, table.organizationId),
    unique("training_paths_definition_uidx").on(table.qualificationDefinitionId),
    uniqueIndex("training_paths_org_location_title_uidx").on(
      table.organizationId,
      table.locationId,
      table.title,
    ),
    index("training_paths_org_location_status_idx").on(
      table.organizationId,
      table.locationId,
      table.status,
    ),
  ],
);

/**
 * One ordered SOP entry within a training path. Application-level rules (enforced in the service
 * layer, not here) require every referenced SOP to be published and to belong to the same
 * location as the owning path.
 */
export const trainingPathItems = pgTable(
  "training_path_items",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    pathId: uuid("path_id").notNull(),
    sopId: uuid("sop_id").notNull(),
    isRequired: boolean("is_required").notNull().default(true),
    displayOrder: integer("display_order").notNull(),
    versionPolicy: trainingPathVersionPolicy("version_policy").notNull().default("current_version"),
    ...timestamps,
  },
  (table) => [
    foreignKey({
      columns: [table.pathId, table.organizationId],
      foreignColumns: [trainingPaths.id, trainingPaths.organizationId],
      name: "training_path_items_path_org_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.sopId, table.organizationId],
      foreignColumns: [sops.id, sops.organizationId],
      name: "training_path_items_sop_org_fk",
    }).onDelete("restrict"),
    unique("training_path_items_id_org_unique").on(table.id, table.organizationId),
    unique("training_path_items_path_sop_uidx").on(table.pathId, table.sopId),
    unique("training_path_items_path_order_uidx").on(table.pathId, table.displayOrder),
  ],
);

/**
 * One row per qualification "episode": a fresh award after expiry or revocation gets a new row,
 * so history is retained and never overwritten, mirroring `sop_versions`/`approval_decisions`
 * immutability. `status` deliberately only ever holds `active`/`revoked` — expiry is always
 * derived at read time by comparing `expiresAt` to `now()`, never stored as a status, per
 * data-model.md's "cached status only if transactionally maintained" rule. The partial unique
 * index below is the DB-enforced half of the "at most one active episode per employee+definition"
 * lifecycle rule; the award algorithm in `qualifications.ts` is the other half.
 */
export const employeeQualifications = pgTable(
  "employee_qualifications",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    employeeId: uuid("employee_id").notNull(),
    definitionId: uuid("definition_id").notNull(),
    sourcePathId: uuid("source_path_id").notNull(),
    awardedAt: timestamp("awarded_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    status: qualificationStatus("status").notNull().default("active"),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedByManagerUserId: uuid("revoked_by_manager_user_id").references(() => managerUsers.id, {
      onDelete: "restrict",
    }),
    revokedNote: text("revoked_note").notNull().default(""),
    ...timestamps,
  },
  (table) => [
    foreignKey({
      columns: [table.employeeId, table.organizationId],
      foreignColumns: [employees.id, employees.organizationId],
      name: "employee_qualifications_employee_org_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.definitionId, table.organizationId],
      foreignColumns: [qualificationDefinitions.id, qualificationDefinitions.organizationId],
      name: "employee_qualifications_definition_org_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.sourcePathId, table.organizationId],
      foreignColumns: [trainingPaths.id, trainingPaths.organizationId],
      name: "employee_qualifications_source_path_org_fk",
    }).onDelete("restrict"),
    unique("employee_qualifications_id_org_unique").on(table.id, table.organizationId),
    uniqueIndex("employee_qualifications_active_employee_definition_uidx")
      .on(table.employeeId, table.definitionId)
      .where(sql`status = 'active'`),
    index("employee_qualifications_org_status_expiry_idx").on(
      table.organizationId,
      table.status,
      table.expiresAt,
    ),
    index("employee_qualifications_employee_status_idx").on(table.employeeId, table.status),
  ],
);

/**
 * Links a qualification episode to the specific passed `training_sessions` rows that proved it —
 * one per required path item satisfied. Renewing a still-active episode replaces these rows
 * (delete + reinsert) rather than accumulating stale proof.
 */
export const qualificationSupportingSessions = pgTable(
  "qualification_supporting_sessions",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    qualificationId: uuid("qualification_id").notNull(),
    sessionId: uuid("session_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.qualificationId, table.organizationId],
      foreignColumns: [employeeQualifications.id, employeeQualifications.organizationId],
      name: "qualification_supporting_sessions_qualification_org_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.sessionId, table.organizationId],
      foreignColumns: [trainingSessions.id, trainingSessions.organizationId],
      name: "qualification_supporting_sessions_session_org_fk",
    }).onDelete("restrict"),
    unique("qualification_supporting_sessions_qualification_session_uidx").on(
      table.qualificationId,
      table.sessionId,
    ),
    index("qualification_supporting_sessions_qualification_idx").on(table.qualificationId),
  ],
);

/**
 * A manager-owned checklist definition, scoped to one location (and optionally one station).
 * Unlike SOPs, checklists are not versioned in this phase: edits apply in place, and items are
 * disabled rather than deleted once a run has referenced them, so historical runs keep resolving
 * their items. `recurrenceType` drives the occurrence key `checklist_runs` computes at start time.
 */
export const checklists = pgTable(
  "checklists",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    locationId: uuid("location_id").notNull(),
    stationId: uuid("station_id"),
    type: checklistType("type").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    recurrenceType: checklistRecurrenceType("recurrence_type").notNull().default("once"),
    status: recordStatus("status").notNull().default("active"),
    createdByManagerUserId: uuid("created_by_manager_user_id")
      .notNull()
      .references(() => managerUsers.id, { onDelete: "restrict" }),
    ...timestamps,
  },
  (table) => [
    foreignKey({
      columns: [table.locationId, table.organizationId],
      foreignColumns: [locations.id, locations.organizationId],
      name: "checklists_location_org_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.stationId, table.organizationId, table.locationId],
      foreignColumns: [stations.id, stations.organizationId, stations.locationId],
      name: "checklists_station_org_location_fk",
    }).onDelete("restrict"),
    unique("checklists_id_org_unique").on(table.id, table.organizationId),
    index("checklists_org_location_status_idx").on(
      table.organizationId,
      table.locationId,
      table.status,
      table.updatedAt,
    ),
    index("checklists_org_station_idx").on(table.organizationId, table.stationId),
  ],
);

export const checklistItems = pgTable(
  "checklist_items",
  {
    id: uuid("id").primaryKey(),
    checklistId: uuid("checklist_id").notNull(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    displayOrder: integer("display_order").notNull(),
    title: text("title").notNull(),
    instructions: text("instructions").notNull().default(""),
    isRequired: boolean("is_required").notNull().default(true),
    timerSeconds: integer("timer_seconds"),
    requirePhoto: boolean("require_photo").notNull().default(false),
    requireApproval: boolean("require_approval").notNull().default(false),
    requireNote: boolean("require_note").notNull().default(false),
    referenceFileId: uuid("reference_file_id"),
    status: recordStatus("status").notNull().default("active"),
    ...timestamps,
  },
  (table) => [
    foreignKey({
      columns: [table.checklistId, table.organizationId],
      foreignColumns: [checklists.id, checklists.organizationId],
      name: "checklist_items_checklist_org_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.referenceFileId, table.organizationId],
      foreignColumns: [files.id, files.organizationId],
      name: "checklist_items_reference_file_org_fk",
    }).onDelete("restrict"),
    unique("checklist_items_id_org_unique").on(table.id, table.organizationId),
    index("checklist_items_checklist_order_idx").on(table.checklistId, table.displayOrder),
    index("checklist_items_checklist_status_idx").on(table.checklistId, table.status),
  ],
);

/**
 * One employee's attempt at a checklist. `occurrenceKey` is computed server-side from
 * `recurrenceType` at start time (`once:<runId>` never collides; `daily:<date>` and
 * `weekly:<isoWeekStart>` are computed in the location's IANA timezone) and, together with the
 * partial unique index below, is the DB-enforced half of duplicate-occurrence prevention — a
 * `rejected` run does not count, so a rejected attempt can always be retried.
 */
export const checklistRuns = pgTable(
  "checklist_runs",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    locationId: uuid("location_id").notNull(),
    checklistId: uuid("checklist_id").notNull(),
    employeeId: uuid("employee_id").notNull(),
    occurrenceKey: text("occurrence_key").notNull(),
    status: checklistRunStatus("status").notNull().default("in_progress"),
    revision: integer("revision").notNull().default(1),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    lastResumedAt: timestamp("last_resumed_at", { withTimezone: true }).notNull().defaultNow(),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    foreignKey({
      columns: [table.locationId, table.organizationId],
      foreignColumns: [locations.id, locations.organizationId],
      name: "checklist_runs_location_org_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.checklistId, table.organizationId],
      foreignColumns: [checklists.id, checklists.organizationId],
      name: "checklist_runs_checklist_org_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.employeeId, table.organizationId, table.locationId],
      foreignColumns: [employees.id, employees.organizationId, employees.primaryLocationId],
      name: "checklist_runs_employee_org_location_fk",
    }).onDelete("restrict"),
    unique("checklist_runs_id_org_unique").on(table.id, table.organizationId),
    uniqueIndex("checklist_runs_checklist_employee_occurrence_uidx")
      .on(table.checklistId, table.employeeId, table.occurrenceKey)
      .where(sql`status <> 'rejected'`),
    index("checklist_runs_org_location_status_idx").on(
      table.organizationId,
      table.locationId,
      table.status,
      table.updatedAt,
    ),
    index("checklist_runs_employee_status_idx").on(table.employeeId, table.status),
  ],
);

export const checklistItemProgress = pgTable(
  "checklist_item_progress",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    runId: uuid("run_id").notNull(),
    itemId: uuid("item_id").notNull(),
    status: checklistItemProgressStatus("status").notNull().default("pending"),
    timerCompleted: boolean("timer_completed").notNull().default(false),
    employeeNote: text("employee_note").notNull().default(""),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    foreignKey({
      columns: [table.runId, table.organizationId],
      foreignColumns: [checklistRuns.id, checklistRuns.organizationId],
      name: "checklist_item_progress_run_org_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.itemId, table.organizationId],
      foreignColumns: [checklistItems.id, checklistItems.organizationId],
      name: "checklist_item_progress_item_org_fk",
    }).onDelete("restrict"),
    unique("checklist_item_progress_id_org_unique").on(table.id, table.organizationId),
    unique("checklist_item_progress_run_item_uidx").on(table.runId, table.itemId),
    index("checklist_item_progress_run_idx").on(table.runId),
  ],
);

export const checklistEvidence = pgTable(
  "checklist_evidence",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    progressId: uuid("progress_id").notNull(),
    fileId: uuid("file_id").notNull(),
    evidenceType: checklistEvidenceType("evidence_type").notNull().default("photo"),
    submissionGeneration: integer("submission_generation").notNull().default(1),
    status: checklistEvidenceStatus("status").notNull().default("pending"),
    employeeNote: text("employee_note").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.progressId, table.organizationId],
      foreignColumns: [checklistItemProgress.id, checklistItemProgress.organizationId],
      name: "checklist_evidence_progress_org_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.fileId, table.organizationId],
      foreignColumns: [files.id, files.organizationId],
      name: "checklist_evidence_file_org_fk",
    }).onDelete("restrict"),
    unique("checklist_evidence_progress_generation_uidx").on(
      table.progressId,
      table.submissionGeneration,
    ),
    index("checklist_evidence_progress_idx").on(table.progressId),
  ],
);

/**
 * Dedicated checklist approval/correction tables — deliberately not sharing `approval_submissions`
 * et al. with SOP training, per data-model.md's "otherwise use dedicated checklist decision
 * tables" fallback. Structure mirrors the training approval tables exactly (see notes there) so
 * the manager review flow and correction lifecycle behave identically for both domains.
 */
export const checklistApprovalSubmissions = pgTable(
  "checklist_approval_submissions",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    runId: uuid("run_id").notNull(),
    submissionGeneration: integer("submission_generation").notNull().default(1),
    status: checklistApprovalSubmissionStatus("status").notNull().default("pending"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.runId, table.organizationId],
      foreignColumns: [checklistRuns.id, checklistRuns.organizationId],
      name: "checklist_approval_submissions_run_org_fk",
    }).onDelete("cascade"),
    unique("checklist_approval_submissions_id_org_unique").on(table.id, table.organizationId),
    unique("checklist_approval_submissions_run_generation_uidx").on(
      table.runId,
      table.submissionGeneration,
    ),
    index("checklist_approval_submissions_org_status_idx").on(table.organizationId, table.status),
    index("checklist_approval_submissions_org_status_submitted_idx").on(
      table.organizationId,
      table.status,
      table.submittedAt,
    ),
  ],
);

export const checklistApprovalDecisions = pgTable(
  "checklist_approval_decisions",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    submissionId: uuid("submission_id").notNull(),
    decision: checklistApprovalDecisionType("decision").notNull(),
    note: text("note").notNull().default(""),
    decidedByManagerUserId: uuid("decided_by_manager_user_id")
      .notNull()
      .references(() => managerUsers.id, { onDelete: "restrict" }),
    decidedAt: timestamp("decided_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.submissionId, table.organizationId],
      foreignColumns: [checklistApprovalSubmissions.id, checklistApprovalSubmissions.organizationId],
      name: "checklist_approval_decisions_submission_org_fk",
    }).onDelete("restrict"),
    unique("checklist_approval_decisions_id_org_unique").on(table.id, table.organizationId),
    index("checklist_approval_decisions_submission_decided_idx").on(
      table.submissionId,
      table.decidedAt,
    ),
    index("checklist_approval_decisions_org_decided_idx").on(table.organizationId, table.decidedAt),
  ],
);

export const checklistCorrectionRequests = pgTable(
  "checklist_correction_requests",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    submissionId: uuid("submission_id").notNull(),
    decisionId: uuid("decision_id").notNull(),
    replacementGeneration: integer("replacement_generation").notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedSubmissionId: uuid("resolved_submission_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.submissionId, table.organizationId],
      foreignColumns: [checklistApprovalSubmissions.id, checklistApprovalSubmissions.organizationId],
      name: "checklist_correction_requests_submission_org_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.decisionId, table.organizationId],
      foreignColumns: [checklistApprovalDecisions.id, checklistApprovalDecisions.organizationId],
      name: "checklist_correction_requests_decision_org_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.resolvedSubmissionId, table.organizationId],
      foreignColumns: [checklistApprovalSubmissions.id, checklistApprovalSubmissions.organizationId],
      name: "checklist_correction_requests_resolved_submission_org_fk",
    }).onDelete("restrict"),
    unique("checklist_correction_requests_decision_uidx").on(table.decisionId),
    uniqueIndex("checklist_correction_requests_open_submission_uidx")
      .on(table.submissionId)
      .where(sql`resolved_at is null`),
    index("checklist_correction_requests_org_submission_idx").on(
      table.organizationId,
      table.submissionId,
    ),
  ],
);
