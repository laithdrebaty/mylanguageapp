import {
  pgTable,
  serial,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  real,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { levelsTable } from "./levels";

/**
 * A quiz is an ordered sequence of content blocks — the same block model
 * lessons use — assembled on a timeline by a teacher.
 *
 * Blocks live in `content_blocks`, which is parented by EITHER `lesson_id` OR
 * `quiz_id` (exactly one, enforced by a CHECK constraint). Sharing the block
 * table means the student renderer, the block editor, and AI assessment all
 * work against one shape instead of two parallel ones.
 */
export const quizzesTable = pgTable("quizzes", {
  id: serial("id").primaryKey(),

  title: text("title").notNull(),
  titleAr: text("title_ar").notNull(),
  description: text("description"),
  descriptionAr: text("description_ar"),
  instructions: text("instructions"),
  instructionsAr: text("instructions_ar"),

  /** Optional placement in the curriculum. A quiz can stand alone. */
  levelId: integer("level_id").references(() => levelsTable.id),

  /** Null = untimed. Otherwise the whole attempt must finish within this. */
  timeLimitSec: integer("time_limit_sec"),
  /** Null = unlimited retries. */
  maxAttempts: integer("max_attempts"),
  passingScore: integer("passing_score").notNull().default(75),
  xpReward: integer("xp_reward").notNull().default(50),
  /** Present blocks in random order (blocks with pinned order stay put). */
  shuffleBlocks: boolean("shuffle_blocks").notNull().default(false),
  /** Show per-question feedback as the student goes, vs. only at the end. */
  revealAnswers: text("reveal_answers").notNull().default("after_submit"),

  /**
   * Same CMS lifecycle as lessons: draft → in_review → approved → published
   * → archived. Student APIs only ever serve 'published'.
   */
  status: text("status").notNull().default("draft"),
  contentVersion: integer("content_version").notNull().default(1),

  tags: text("tags").array(),
  teacherNotes: text("teacher_notes"),

  createdBy: integer("created_by").references(() => usersTable.id),
  softDeletedAt: timestamp("soft_deleted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});
export type Quiz = typeof quizzesTable.$inferSelect;
export type NewQuiz = typeof quizzesTable.$inferInsert;

/**
 * One student's run at a quiz. Created when they start, finalised on submit.
 * Kept separate from lesson progress because a quiz can be retaken and each
 * attempt is scored independently.
 */
export const quizAttemptsTable = pgTable("quiz_attempts", {
  id: serial("id").primaryKey(),
  quizId: integer("quiz_id")
    .notNull()
    .references(() => quizzesTable.id, { onDelete: "cascade" }),
  userId: integer("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),

  /** Which version of the quiz this attempt saw. */
  contentVersion: integer("content_version").notNull().default(1),
  /** in_progress | submitted | grading | graded | abandoned */
  status: text("status").notNull().default("in_progress"),

  /** 0-100, null until grading finishes. */
  score: real("score"),
  passed: boolean("passed"),
  /** Blocks still waiting on an AI or teacher verdict. */
  pendingReviewCount: integer("pending_review_count").notNull().default(0),

  startedAt: timestamp("started_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  gradedAt: timestamp("graded_at", { withTimezone: true }),
});
export type QuizAttempt = typeof quizAttemptsTable.$inferSelect;

/**
 * One answer to one block within an attempt.
 *
 * `response` is a JSON bag whose shape depends on the block type — selected
 * option ids for MCQ, text for writing, a media_assets key for speaking.
 * Grading is deliberately split: `autoScore` lands immediately for
 * objectively-checkable blocks, while AI/teacher verdicts fill in later.
 */
export const quizResponsesTable = pgTable("quiz_responses", {
  id: serial("id").primaryKey(),
  attemptId: integer("attempt_id")
    .notNull()
    .references(() => quizAttemptsTable.id, { onDelete: "cascade" }),
  blockId: integer("block_id").notNull(),

  response: jsonb("response"),
  /** Uploaded audio/video for speaking blocks — a media_assets key. */
  mediaKey: text("media_key"),
  /** Speech-to-text output, once transcription completes. */
  transcript: text("transcript"),

  /** 0-100. Null while awaiting assessment. */
  score: real("score"),
  /** auto | ai | teacher | pending */
  gradedBy: text("graded_by").notNull().default("pending"),
  feedback: text("feedback"),
  feedbackAr: text("feedback_ar"),

  /** Provider/model/token accounting for any AI call made on this response. */
  aiMeta: jsonb("ai_meta"),

  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }),
});
export type QuizResponse = typeof quizResponsesTable.$inferSelect;
