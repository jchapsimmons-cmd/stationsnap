/**
 * Cross-cutting "expiring soon" window, split into its own module so both `qualifications.ts`
 * (the overview/employee-view classification) and `@/server/notifications/service` (the Phase 16
 * expiring-soon notification scan) import the same constant without a circular dependency between
 * those two files — `qualifications.ts` itself calls into the notifications service to dispatch a
 * `qualification.revoked` notification. This is a fixed simplification for this phase —
 * `qualification_definitions` has no separate configurable "expiring soon" threshold — not a
 * value a manager can tune per definition.
 */
export const EXPIRING_SOON_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
