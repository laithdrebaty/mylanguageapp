import {
  pgTable,
  text,
  serial,
  integer,
  boolean,
  timestamp,
  real,
  jsonb,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { lessonsTable, contentBlocksTable, exercisesTable } from "./levels";

export const lessonProgressTable = pgTable("lesson_progress", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  lessonId: integer("lesson_id").notNull().references(() => lessonsTable.id, { onDelete: "cascade" }),
  /** Pinned content version this progress record refers to */
  contentVersion: integer("content_version").notNull().default(1),
  status: text("status", {
    enum: ["not_started", "in_progress", "completed", "passed", "failed"],
  }).notNull().default("not_started"),
  bestScore: real("best_score"),
  lastScore: real("last_score"),
  speakingScore: real("speaking_score"),
  attempts: integer("attempts").notNull().default(0),
  passed: boolean("passed").notNull().default(false),
  xpEarned: integer("xp_earned").notNull().default(0),
  timeSpentSeconds: integer("time_spent_seconds").notNull().default(0),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => ({
  userLessonUnique: uniqueIndex("lesson_progress_user_lesson_unique").on(table.userId, table.lessonId),
  userIdIdx: index("lesson_progress_user_id_idx").on(table.userId),
}));

export type LessonProgress = typeof lessonProgressTable.$inferSelect;

export const exerciseAttemptsTable = pgTable("exercise_attempts", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  exerciseId: integer("exercise_id").notNull(),
  selectedOptionId: text("selected_option_id").notNull(),
  correct: boolean("correct").notNull(),
  attemptedAt: timestamp("attempted_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ExerciseAttempt = typeof exerciseAttemptsTable.$inferSelect;

/**
 * Server-authoritative per-block completion record.
 * Unique per user + lesson + block + contentVersion so that
 * revisits on a newer content version start fresh.
 */
export const lessonBlockProgressTable = pgTable("lesson_block_progress", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  lessonId: integer("lesson_id").notNull().references(() => lessonsTable.id, { onDelete: "cascade" }),
  blockId: integer("block_id").notNull().references(() => contentBlocksTable.id, { onDelete: "cascade" }),
  contentVersion: integer("content_version").notNull().default(1),
  completedAt: timestamp("completed_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => ({
  userLessonBlockVersionUnique: uniqueIndex("lbp_user_lesson_block_version_unique").on(
    table.userId, table.lessonId, table.blockId, table.contentVersion,
  ),
  userLessonIdx: index("lbp_user_lesson_idx").on(table.userId, table.lessonId),
}));

export type LessonBlockProgress = typeof lessonBlockProgressTable.$inferSelect;

/**
 * Detailed activity attempt log for learning analytics and server-side grading.
 */
export const learningActivityAttemptsTable = pgTable("learning_activity_attempts", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  lessonId: integer("lesson_id").notNull().references(() => lessonsTable.id, { onDelete: "cascade" }),
  blockId: integer("block_id").notNull().references(() => contentBlocksTable.id, { onDelete: "cascade" }),
  /** Nullable — passive/reading blocks have no exercise */
  exerciseId: integer("exercise_id").references(() => exercisesTable.id, { onDelete: "set null" }),
  contentVersion: integer("content_version").notNull().default(1),
  /**
   * Activity type: mcq | speaking | pronunciation | open_ended |
   *                fill_blank | translation | passive
   */
  activityType: text("activity_type").notNull(),
  /**
   * Client-generated idempotency key — unique per user so duplicate
   * submissions return the original attempt unchanged.
   */
  clientSubmissionId: text("client_submission_id").notNull(),
  /** For MCQ */
  selectedOptionId: text("selected_option_id"),
  /** For open-ended / fill-blank / translation */
  responseText: text("response_text"),
  /** Storage key for recorded media (speaking / pronunciation) */
  mediaReference: text("media_reference"),
  /** Duration of audio recording in seconds */
  recordingDurationSeconds: integer("recording_duration_seconds"),
  /** Server-graded correctness (null for pending / non-gradable) */
  isCorrect: boolean("is_correct"),
  /** Weighted score 0–100 or null */
  score: real("score"),
  /**
   * Evaluation status:
   *   graded   — server has a final result
   *   pending  — awaiting async AI evaluation
   *   skipped  — not evaluated (passive block)
   */
  evaluationStatus: text("evaluation_status", {
    enum: ["graded", "pending", "skipped"],
  }).notNull().default("graded"),
  /** Arbitrary metadata (client timing, retries, etc.) */
  metadata: jsonb("metadata"),
  submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  userClientSubmissionIdUnique: uniqueIndex("laa_user_client_submission_id_unique").on(
    table.userId, table.clientSubmissionId,
  ),
  userLessonIdx: index("laa_user_lesson_idx").on(table.userId, table.lessonId),
  userBlockIdx: index("laa_user_block_idx").on(table.userId, table.blockId),
}));

export type LearningActivityAttempt = typeof learningActivityAttemptsTable.$inferSelect;
