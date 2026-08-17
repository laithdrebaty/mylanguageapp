import { pgTable, text, serial, integer, boolean, timestamp } from "drizzle-orm/pg-core";

export const levelsTable = pgTable("levels", {
  id: serial("id").primaryKey(),
  code: text("code").notNull().unique(), // e.g. "A1.1", "A1.2"
  name: text("name").notNull(),
  nameAr: text("name_ar").notNull(),
  description: text("description"),
  descriptionAr: text("description_ar"),
  order: integer("order").notNull(),
  totalLessons: integer("total_lessons").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Level = typeof levelsTable.$inferSelect;

export const lessonsTable = pgTable("lessons", {
  id: serial("id").primaryKey(),
  levelId: integer("level_id").notNull().references(() => levelsTable.id),
  title: text("title").notNull(),
  titleAr: text("title_ar").notNull(),
  description: text("description"),
  descriptionAr: text("description_ar"),
  order: integer("order").notNull(),
  lessonType: text("lesson_type", {
    enum: ["general", "reading", "pronunciation", "speaking", "vocabulary", "grammar", "conversation"],
  }).notNull().default("general"),
  estimatedMinutes: integer("estimated_minutes").notNull().default(35),
  isPublished: boolean("is_published").notNull().default(false),
  xpReward: integer("xp_reward").notNull().default(50),
  passingScore: integer("passing_score").notNull().default(75), // percentage
  objectives: text("objectives").array(),
  objectivesAr: text("objectives_ar").array(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type Lesson = typeof lessonsTable.$inferSelect;

export const contentBlocksTable = pgTable("content_blocks", {
  id: serial("id").primaryKey(),
  lessonId: integer("lesson_id").notNull().references(() => lessonsTable.id, { onDelete: "cascade" }),
  type: text("type", {
    enum: ["text", "audio_placeholder", "vocabulary_list", "mcq", "speaking_prompt", "pronunciation_guide", "dialogue"],
  }).notNull(),
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
