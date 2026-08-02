import {
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const recordStatus = pgEnum("record_status", ["active", "disabled"]);
export const membershipRole = pgEnum("membership_role", ["owner", "manager"]);
export const preferredLanguage = pgEnum("preferred_language", ["en", "es"]);

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

export const organizations = pgTable(
  "organizations",
  {
    id: uuid("id").primaryKey(),
    name: text("name").notNull(),
    defaultLanguage: preferredLanguage("default_language").notNull().default("en"),
    timezone: text("timezone").notNull(),
    status: recordStatus("status").notNull().default("active"),
    ...timestamps,
  },
  (table) => [index("organizations_status_idx").on(table.status)],
);

export const locations = pgTable(
  "locations",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    timezone: text("timezone").notNull(),
    status: recordStatus("status").notNull().default("active"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("locations_org_name_uidx").on(table.organizationId, table.name),
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
    locationId: uuid("location_id")
      .notNull()
      .references(() => locations.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    displayOrder: integer("display_order").notNull(),
    status: recordStatus("status").notNull().default("active"),
    ...timestamps,
  },
  (table) => [
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
    index("manager_memberships_org_status_idx").on(table.organizationId, table.status),
  ],
);

export const managerLocationAccess = pgTable(
  "manager_location_access",
  {
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    membershipId: uuid("membership_id")
      .notNull()
      .references(() => managerMemberships.id, { onDelete: "cascade" }),
    locationId: uuid("location_id")
      .notNull()
      .references(() => locations.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.membershipId, table.locationId] }),
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
    primaryLocationId: uuid("primary_location_id")
      .notNull()
      .references(() => locations.id, { onDelete: "restrict" }),
    employeeNumber: text("employee_number").notNull(),
    displayName: text("display_name").notNull(),
    jobRole: text("job_role").notNull(),
    language: preferredLanguage("preferred_language").notNull().default("en"),
    status: recordStatus("status").notNull().default("active"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("employees_org_number_uidx").on(table.organizationId, table.employeeNumber),
    index("employees_org_location_status_idx").on(
      table.organizationId,
      table.primaryLocationId,
      table.status,
    ),
  ],
);
