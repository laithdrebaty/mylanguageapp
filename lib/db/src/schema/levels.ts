import { pgTable, text, serial, integer, boolean, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { curriculaTable } from "./languages";

/**
 * Levels belong to a curriculum and are ordered within it.
 * The code (e.g. "A1.1") is only unique per curriculum — two different
 * curricula may both have a level called "A1.1" without conflict.
 *
 * The level system (CEFR, HSK, custom, …) is entirely determined by which
 * codes and names you insert — the schema imposes no framework constraints.
 */
export const levelsTable = pgTable("levels", {
  id: serial("id").primaryKey(),
  /** Which curriculum this level belongs to */
  curriculumId: integer("curriculum_id")
    .notNull()
    .references(() => curriculaTable.id),
  /** Level code within this curriculum — unique per curriculum, not globally */
  code: text("code").notNull(),
  name: text("name").notNull(),
  nameAr: text("name_ar").notNull(),
  description: text("description"),
  descriptionAr: text("description_ar"),
  /** Ordering within the curriculum — determines progression sequence */
  order: integer("order").notNull(),
  totalLessons: integer("total_lessons").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  /** Codes are unique per curriculum — not globally */
  curriculumCodeUnique: uniqueIndex("levels_curriculum_code_unique").on(
    table.curriculumId,
    table.code,
  ),
}));

export type Level = typeof levelsTable.$inferSelect;

export const lessonsTable = pgTable("lessons", {
  id: serial("id").primaryKey(),
  levelId: integer("level_id").notNull().references(() => levelsTable.id),
  title: text("title").notNull(),
  titleAr: text("title_ar").notNull(),
  description: text("description"),
  descriptionAr: text("description_ar"),
  order: integer("order").notNull(),
  /**
   * Lesson type — configurable at insert time. Not constrained to the
   * hard-coded enum so new types can be added without schema changes.
   * Common values: general, reading, pronunciation, speaking, vocabulary,
   * grammar, conversation — but any string is valid.
   */
  lessonType: text("lesson_type").notNull().default("general"),
  /** Configurable duration in minutes — not hard-coded */
  estimatedMinutes: integer("estimated_minutes").notNull().default(35),
  isPublished: boolean("is_published").notNull().default(false),
  xpReward: integer("xp_reward").notNull().default(50),
  /** Minimum percentage (0-100) to pass this lesson */
  passingScore: integer("passing_score").notNull().default(75),
  objectives: text("objectives").array(),
  objectivesAr: text("objectives_ar").array(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type Lesson = typeof lessonsTable.$inferSelect;

/**
 * Content blocks are the building blocks of a lesson.
 * Block types are stored as plain text so new block types (video, quiz_set,
 * word_match, …) can be added by inserting rows — no schema change needed.
 *
 * Required vs. optional blocks: add an `is_required` boolean column if needed;
 * currently all blocks are considered required for scoring purposes.
 */
export const contentBlocksTable = pgTable("content_blocks", {
  id: serial("id").primaryKey(),
  lessonId: integer("lesson_id").notNull().references(() => lessonsTable.id, { onDelete: "cascade" }),
  /**
   * Block type string — extensible without schema change.
   * Known values: text, audio_placeholder, vocabulary_list, mcq,
   *   speaking_prompt, pronunciation_guide, dialogue
   */
  type: text("type").notNull(),
  order: integer("order").notNull(),
  content: text("content"),
  contentAr: text("content_ar"),
  audioNote: text("audio_note"),
  prompt: text("prompt"),
  promptAr: text("prompt_ar"),
  exampleAudio: text("example_audio"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ContentBlock = typeof contentBlocksTable.$inferSelect;

export const exercisesTable = pgTable("exercises", {
  id: serial("id").primaryKey(),
  lessonId: integer("lesson_id").notNull().references(() => lessonsTable.id, { onDelete: "cascade" }),
  contentBlockId: integer("content_block_id"),
  question: text("question").notNull(),
  questionAr: text("question_ar"),
  correctOptionId: text("correct_option_id").notNull(),
  explanation: text("explanation"),
  explanationAr: text("explanation_ar"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Exercise = typeof exercisesTable.$inferSelect;

export const exerciseOptionsTable = pgTable("exercise_options", {
  id: serial("id").primaryKey(),
  exerciseId: integer("exercise_id").notNull().references(() => exercisesTable.id, { onDelete: "cascade" }),
  optionId: text("option_id").notNull(), // 'a', 'b', 'c', 'd'
  text: text("text").notNull(),
  textAr: text("text_ar"),
});

export type ExerciseOption = typeof exerciseOptionsTable.$inferSelect;

export const vocabularyTable = pgTable("vocabulary", {
  id: serial("id").primaryKey(),
  levelId: integer("level_id").notNull().references(() => levelsTable.id),
  lessonId: integer("lesson_id").references(() => lessonsTable.id),
  word: text("word").notNull(),
  translation: text("translation").notNull(),
  exampleSentence: text("example_sentence"),
  exampleSentenceAr: text("example_sentence_ar"),
  pronunciation: text("pronunciation"),
  audioNote: text("audio_note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Vocabulary = typeof vocabularyTable.$inferSelect;
