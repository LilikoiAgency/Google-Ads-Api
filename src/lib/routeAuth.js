import { getServerSession } from "next-auth";
import { authOptions, allowedEmailDomain } from "./auth";
import { isAdmin } from "./admins";

export async function getAllowedSession() {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email?.toLowerCase() || "";

  if (!email.endsWith(`@${allowedEmailDomain}`)) {
    return { session: null, email: "", status: 401, error: "Unauthorized" };
  }

  return { session, email, status: 200, error: null };
}

export async function getAdminSession() {
  const allowed = await getAllowedSession();

  if (allowed.error) {
    return allowed;
  }

  if (!isAdmin(allowed.email)) {
    return { ...allowed, session: null, status: 403, error: "Forbidden" };
  }

  return allowed;
}
