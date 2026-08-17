/**
 * CMS Audit Logger
 *
 * Write-only helper that appends rows to cms_audit_logs.
 * Never fails loudly — a logging failure must not break the user's action.
 *
 * Usage:
 *   await audit(userId, 'publish', 'lesson', lessonId, 'approved', 'published', { title: lesson.title });
 */

import { pool } from "@workspace/db";
import { logger } from "../lib/logger";

export async function audit(
  userId: number,
  action: string,
  contentType: string,
  contentId: number | null,
  prevStatus: string | null,
  newStatus: string | null,
  meta?: Record<string, unknown>,
): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO cms_audit_logs (user_id, action, content_type, content_id, prev_status, new_status, meta)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [userId, action, contentType, contentId, prevStatus, newStatus, meta ? JSON.stringify(meta) : null],
    );
  } catch (err) {
    logger.warn({ err, userId, action, contentType, contentId }, "Failed to write audit log entry");
  }
}
