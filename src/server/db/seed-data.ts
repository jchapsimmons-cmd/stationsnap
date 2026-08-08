export const seedIds = {
  organization: "10000000-0000-4000-8000-000000000001",
  locations: {
    downtown: "20000000-0000-4000-8000-000000000001",
    riverside: "20000000-0000-4000-8000-000000000002",
  },
  stations: {
    grill: "30000000-0000-4000-8000-000000000001",
    fry: "30000000-0000-4000-8000-000000000002",
    prep: "30000000-0000-4000-8000-000000000003",
    frontCounter: "30000000-0000-4000-8000-000000000004",
  },
  managers: {
    owner: "40000000-0000-4000-8000-000000000001",
    downtown: "40000000-0000-4000-8000-000000000002",
    riverside: "40000000-0000-4000-8000-000000000003",
  },
  memberships: {
    owner: "50000000-0000-4000-8000-000000000001",
    downtown: "50000000-0000-4000-8000-000000000002",
    riverside: "50000000-0000-4000-8000-000000000003",
  },
} as const;

export const managerSeed = [
  {
    id: seedIds.managers.owner,
    email: "alex.owner@demo.stationsnap.test",
    displayName: "Alex Rivera",
  },
  {
    id: seedIds.managers.downtown,
    email: "jordan.manager@demo.stationsnap.test",
    displayName: "Jordan Lee",
  },
  {
    id: seedIds.managers.riverside,
    email: "sam.manager@demo.stationsnap.test",
    displayName: "Sam Morgan",
  },
] as const;

export const employeeSeed = [
  {
    id: "60000000-0000-4000-8000-000000000001",
    primaryLocationId: seedIds.locations.downtown,
    employeeNumber: "1001",
    displayName: "Maya Chen",
    jobRole: "Cook",
    language: "en" as const,
    // Phase 20: the one seed employee with SMS notifications opted in, so db:verify has a real
    // row to exercise the SMS delivery-attempt path (skipped in this Twilio-less environment,
    // the same way the existing manager seed exercises the SMTP-less email path).
    phone: "+15555550101",
    smsOptIn: true,
  },
  {
    id: "60000000-0000-4000-8000-000000000002",
    primaryLocationId: seedIds.locations.downtown,
    employeeNumber: "1002",
    displayName: "Luis Garcia",
    jobRole: "Prep Cook",
    language: "es" as const,
  },
  {
    id: "60000000-0000-4000-8000-000000000003",
    primaryLocationId: seedIds.locations.downtown,
    employeeNumber: "1003",
    displayName: "Taylor Brooks",
    jobRole: "Cashier",
    language: "en" as const,
  },
  {
    id: "60000000-0000-4000-8000-000000000004",
    primaryLocationId: seedIds.locations.riverside,
    employeeNumber: "2001",
    displayName: "Elena Ruiz",
    jobRole: "Cook",
    language: "es" as const,
  },
  {
    id: "60000000-0000-4000-8000-000000000005",
    primaryLocationId: seedIds.locations.riverside,
    employeeNumber: "2002",
    displayName: "Noah Williams",
    jobRole: "Cashier",
    language: "en" as const,
  },
] as const;
