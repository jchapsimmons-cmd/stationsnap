import {
  boolean,
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
    uploaderManagerUserId: uuid("uploader_manager_user_id")
      .notNull()
      .references(() => managerUsers.id, { onDelete: "restrict" }),
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
