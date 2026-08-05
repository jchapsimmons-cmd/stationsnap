/**
 * The Owner's fixed email from the demo seed (`src/server/db/seed-data.ts`), used to sign in as
 * the organization's Owner; the password is generated per run by `e2e/run.ts`. Everything the
 * critical-path spec exercises below the Owner login — locations, stations, employees, SOPs — is
 * created fresh through the UI so concurrent viewport projects never collide, even though they
 * share one database and app server.
 */
export const SEED_OWNER_EMAIL = "alex.owner@demo.stationsnap.test";

/** A minimal but byte-valid 1x1 transparent PNG, used as training-evidence upload proof. Its
 * signature passes the server's magic-byte upload validator (`matchesDeclaredSignature`), which is
 * all the app checks for this test's uploads. */
export const SAMPLE_PHOTO_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);
