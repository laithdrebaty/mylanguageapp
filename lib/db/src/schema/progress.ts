import { pgTable, text, serial, integer, boolean, timestamp, real } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { lessonsTable } from "./levels";

export const lessonProgressTable = pgTable("lesson_progress", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  lessonId: integer("lesson_id").notNull().references(() => lessonsTable.id, { onDelete: "cascade" }),
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
});

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
