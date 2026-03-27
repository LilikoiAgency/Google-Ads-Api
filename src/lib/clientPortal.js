import dbConnect from "./mongoose";
import crypto from "crypto";

const DB  = "tokensApi";
const COL = "ClientPortals";

async function col() {
  const client = await dbConnect();
  return client.db(DB).collection(COL);
}

export function generateToken() {
  return crypto.randomBytes(24).toString("hex");
}

export function slugify(name) {
  return (name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

// ── CRUD ──────────────────────────────────────────────────────────────────────

export async function getClients() {
  const c = await col();
  return c.find({}).sort({ name: 1 }).toArray();
}

export async function getClientBySlug(slug) {
  const c = await col();
  return c.findOne({ slug });
}

/**
 * Validate a portal access token.
 * Returns the client doc if valid, null otherwise.
 */
export async function validateClientAccess(slug, token) {
  if (!slug || !token) return null;
  const c = await col();
  return c.findOne({ slug, accessToken: token, active: true });
}

/**
 * Create a new client.
 * adAccounts shape: { google: [{accountId, label}], bing: [...], meta: [...] }
 * audienceLabSegments: ["key1", "key2"]
 */
export async function createClient(data) {
  const c = await col();
  const slug = data.slug || slugify(data.name);
  if (!slug) throw new Error("Name is required");
  const existing = await c.findOne({ slug });
  if (existing) throw new Error(`Slug "${slug}" is already taken`);

  const doc = {
    slug,
    name:        data.name,
    logo:        data.logo        || null,
    active:      data.active      !== false,
    accessToken: generateToken(),
    adAccounts: {
      google: Array.isArray(data.adAccounts?.google) ? data.adAccounts.google : [],
      bing:   Array.isArray(data.adAccounts?.bing)   ? data.adAccounts.bing   : [],
      meta:   Array.isArray(data.adAccounts?.meta)   ? data.adAccounts.meta   : [],
    },
    audienceLabSegments: Array.isArray(data.audienceLabSegments) ? data.audienceLabSegments : [],
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  await c.insertOne(doc);
  return doc;
}

export async function updateClient(slug, updates) {
  const c   = await col();
  const set = { ...updates, updatedAt: new Date() };
  // Protect immutable fields
  delete set.slug;
  delete set.accessToken;
  delete set._id;
  await c.updateOne({ slug }, { $set: set });
}

export async function regenerateToken(slug) {
  const c     = await col();
  const token = generateToken();
  await c.updateOne({ slug }, { $set: { accessToken: token, updatedAt: new Date() } });
  return token;
}

export async function deleteClient(slug) {
  const c = await col();
  await c.deleteOne({ slug });
}
