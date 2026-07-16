import { qGet, qRun } from "../db/query.js";
import { broadcast } from "./realtime.js";
import { logActivitySync } from "./activityLog.js";
import type { Request } from "express";

export const OUR_STORY_SLUG = "about-our-story";

export type SiteContentRow = {
  id: number;
  slug: string;
  title: string;
  subtitle: string | null;
  body: string;
  quote: string | null;
  image_url: string | null;
  status: "draft" | "published";
  updated_at: string;
  updated_by: number | null;
  published_at: string | null;
};

export type SiteContentPublic = {
  slug: string;
  title: string;
  subtitle: string;
  body: string;
  quote: string;
  imageUrl: string | null;
  updatedAt: string;
  publishedAt: string | null;
};

export type SiteContentAdmin = SiteContentPublic & {
  id: number;
  status: "draft" | "published";
  updatedBy: number | null;
};

const TITLE_MAX = 120;
const SUBTITLE_MAX = 240;
const BODY_MAX = 20_000;
const QUOTE_MAX = 500;

export function formatSiteContent(row: SiteContentRow): SiteContentAdmin {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title || "",
    subtitle: row.subtitle || "",
    body: row.body || "",
    quote: row.quote || "",
    imageUrl: row.image_url || null,
    status: row.status === "draft" ? "draft" : "published",
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
    publishedAt: row.published_at,
  };
}

export function toPublicContent(row: SiteContentRow): SiteContentPublic {
  const full = formatSiteContent(row);
  return {
    slug: full.slug,
    title: full.title,
    subtitle: full.subtitle,
    body: full.body,
    quote: full.quote,
    imageUrl: full.imageUrl,
    updatedAt: full.updatedAt,
    publishedAt: full.publishedAt,
  };
}

export async function getSiteContent(slug: string): Promise<SiteContentRow | undefined> {
  return qGet<SiteContentRow>("SELECT * FROM site_content WHERE slug = ?", slug);
}

export async function getPublishedSiteContent(slug: string): Promise<SiteContentRow | undefined> {
  return qGet<SiteContentRow>(
    "SELECT * FROM site_content WHERE slug = ? AND status = 'published'",
    slug,
  );
}

export type SiteContentInput = {
  title?: string;
  subtitle?: string;
  body?: string;
  quote?: string;
  imageUrl?: string | null;
  removeImage?: boolean;
  status?: "draft" | "published";
};

export function validateSiteContentInput(input: SiteContentInput): string | null {
  if (input.title !== undefined) {
    const t = String(input.title).trim();
    if (!t) return "Title is required";
    if (t.length > TITLE_MAX) return `Title must be ${TITLE_MAX} characters or fewer`;
  }
  if (input.subtitle !== undefined && String(input.subtitle).length > SUBTITLE_MAX) {
    return `Subtitle must be ${SUBTITLE_MAX} characters or fewer`;
  }
  if (input.body !== undefined && String(input.body).length > BODY_MAX) {
    return `Body must be ${BODY_MAX} characters or fewer`;
  }
  if (input.quote !== undefined && String(input.quote).length > QUOTE_MAX) {
    return `Quote must be ${QUOTE_MAX} characters or fewer`;
  }
  if (input.status !== undefined && input.status !== "draft" && input.status !== "published") {
    return "Status must be draft or published";
  }
  return null;
}

export async function upsertSiteContent(
  slug: string,
  input: SiteContentInput,
  actorId: number,
  req?: Request,
): Promise<SiteContentRow> {
  const err = validateSiteContentInput(input);
  if (err) throw new Error(err);

  const existing = await getSiteContent(slug);
  const ts = new Date().toISOString();
  const title = input.title !== undefined ? String(input.title).trim() : (existing?.title || "Our Story");
  if (!title) throw new Error("Title is required");

  const subtitle = input.subtitle !== undefined ? String(input.subtitle) : (existing?.subtitle ?? "");
  const body = input.body !== undefined ? String(input.body) : (existing?.body ?? "");
  const quote = input.quote !== undefined ? String(input.quote) : (existing?.quote ?? "");
  let imageUrl = existing?.image_url ?? null;
  if (input.removeImage) imageUrl = null;
  else if (input.imageUrl !== undefined) imageUrl = input.imageUrl;

  const status = input.status ?? existing?.status ?? "published";
  const publishedAt = status === "published"
    ? (existing?.published_at && existing.status === "published" ? existing.published_at : ts)
    : existing?.published_at ?? null;

  if (existing) {
    await qRun(`
      UPDATE site_content SET
        title = ?, subtitle = ?, body = ?, quote = ?, image_url = ?,
        status = ?, updated_at = ?, updated_by = ?, published_at = ?
      WHERE slug = ?
    `, title, subtitle, body, quote, imageUrl, status, ts, actorId, publishedAt, slug);
  } else {
    await qRun(`
      INSERT INTO site_content
        (slug, title, subtitle, body, quote, image_url, status, updated_at, updated_by, published_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, slug, title, subtitle, body, quote, imageUrl, status, ts, actorId, publishedAt);
  }

  const row = (await getSiteContent(slug))!;

  if (req) {
    logActivitySync({
      req,
      userId: actorId,
      eventType: status === "published" ? "site_content_publish" : "site_content_update",
      eventCategory: "administration",
      description: status === "published"
        ? `Published About → Our Story content`
        : `Updated About → Our Story content`,
      affectedObject: `site_content:${slug}`,
    });
  }

  if (status === "published") {
    broadcast("content:update", { slug });
  }

  return row;
}
