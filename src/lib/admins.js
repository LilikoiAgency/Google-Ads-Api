/**
 * admins.js
 *
 * Standalone admin email list — safe to import from both client and server code.
 * (audienceLabSegments.js pulls in MongoDB and can't be used in client components.)
 */

export const ADMIN_EMAILS = ["frank@lilikoiagency.com"];

export function isAdmin(email) {
  return ADMIN_EMAILS.includes((email || "").toLowerCase());
}
