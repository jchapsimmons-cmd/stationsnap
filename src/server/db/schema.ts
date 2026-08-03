import {
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
