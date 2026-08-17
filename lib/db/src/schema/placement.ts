import { pgTable, text, serial, integer, boolean, timestamp, real } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { levelsTable } from "./levels";
import { curriculaTable } from "./languages";

export const placementQuestionsTable = pgTable("placement_questions", {
  id: serial("id").primaryKey(),
  questionText: text("question_text").notNull(),
  questionTextAr: text("question_text_ar").notNull(),
  type: text("type", { enum: ["mcq", "fill_blank"] }).notNull().default("mcq"),
  order: integer("order").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type PlacementQuestion = typeof placementQuestionsTable.$inferSelect;

export const placementOptionsTable = pgTable("placement_options", {
  id: serial("id").primaryKey(),
  questionId: integer("question_id").notNull().references(() => placementQuestionsTable.id, { onDelete: "cascade" }),
  optionId: text("option_id").notNull(), // 'a', 'b', 'c', 'd'
  text: text("text").notNull(),
  textAr: text("text_ar"),
  isCorrect: boolean("is_correct").notNull().default(false),
});

export type PlacementOption = typeof placementOptionsTable.$inferSelect;

export const placementResultsTable = pgTable("placement_results", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  /** Which curriculum was being tested */
  curriculumId: integer("curriculum_id").references(() => curriculaTable.id),
  score: integer("score").notNull(),
  total: integer("total").notNull(),
  percentage: real("percentage").notNull(),
  /** Human-readable level code for historical reference */
  assignedLevelCode: text("assigned_level_code").notNull(),
  /** FK to the actual level record assigned */
  assignedLevelId: integer("assigned_level_id").references(() => levelsTable.id),
  completedAt: timestamp("completed_at", { withTimezone: true }).notNull().defaultNow(),
});

export type PlacementResult = typeof placementResultsTable.$inferSelect;
