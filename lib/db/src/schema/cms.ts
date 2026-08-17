/**
 * CMS-specific tables: media assets, audit logs, lesson reviews.
 * These are internal admin tables not exposed to students.
 */

import { pgTable, text, serial, integer, real, jsonb, timestamp } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { lessonsTable } from "./levels";

/**
 * Stores references/metadata for media files.
 * Actual file bytes live in object storage (CDN/S3).
 * This table holds only the key (path/URL) and descriptive metadata.
 */
export const mediaAssetsTable = pgTable("media_assets", {
  id: serial("id").primaryKey(),
  /** Storage key / URL reference. Format depends on storage provider. */
  key: text("key").notNull(),
  originalName: text("original_name"),
  mimeType: text("mime_type").notNull(),
  sizeBytes: integer("size_bytes"),
  durationSec: real("duration_sec"),
  language: text("language"),
  speaker: text("speaker"),
  accent: text("accent"),
  transcript: text("transcript"),
  createdBy: integer("created_by").references(() => usersTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type MediaAsset = typeof mediaAssetsTable.$inferSelect;

/**
 * Append-only audit log for significant CMS actions.
 * Never update or delete rows from this table.
 */
export const cmsAuditLogsTable = pgTable("cms_audit_logs", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id),
  /** Action verb: create | update | publish | unpublish | archive | restore | delete | submit_review | approve | reject | duplicate */
  action: text("action").notNull(),
  /** Content entity type: lesson | content_block | exercise | vocabulary | language | curriculum | level | media */
  contentType: text("content_type").notNull(),
  contentId: integer("content_id"),
  prevStatus: text("prev_status"),
  newStatus: text("new_status"),
  /** Optional JSON bag of additional context (title, level, etc.) */
  meta: jsonb("meta"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type CmsAuditLog = typeof cmsAuditLogsTable.$inferSelect;

/**
 * Records the review decisions made on lessons during the review workflow.
 */
export const lessonReviewsTable = pgTable("lesson_reviews", {
  id: serial("id").primaryKey(),
  lessonId: integer("lesson_id").notNull().references(() => lessonsTable.id, { onDelete: "cascade" }),
  reviewerId: integer("reviewer_id").notNull().references(() => usersTable.id),
  /** approved | rejected */
  decision: text("decision").notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type LessonReview = typeof lessonReviewsTable.$inferSelect;
