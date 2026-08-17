import { pgTable, text, serial, boolean, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

/**
 * Supported languages — both learner languages (the student's native language)
 * and target languages (the language being learned).
 * Adding a new language here is the only code-free step needed before
 * creating a curriculum that uses it.
 */
export const languagesTable = pgTable("languages", {
  id: serial("id").primaryKey(),
  /** ISO 639-1 code: 'en', 'ar', 'de', 'fr', 'tr', … */
  code: text("code").notNull().unique(),
  /** English display name */
  name: text("name").notNull(),
  /** Native display name (e.g. 'العربية' for Arabic) */
  nameNative: text("name_native").notNull(),
  /** true for right-to-left languages */
  rtl: boolean("rtl").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Language = typeof languagesTable.$inferSelect;

/**
 * A curriculum ties a target language + learner language together and owns
 * its own level hierarchy. Multiple curricula can use the same target language
 * (e.g. English for Arabic speakers vs. English for French speakers) and each
 * can define a completely different level framework.
 *
 * Adding a new curriculum requires only inserting a row here plus the desired
 * levels — no code changes are needed.
 */
export const curriculaTable = pgTable("curricula", {
  id: serial("id").primaryKey(),
  /** FK to languages.code — the language students are learning */
  targetLanguageCode: text("target_language_code")
    .notNull()
    .references(() => languagesTable.code),
  /** FK to languages.code — the student's native/interface language */
  learnerLanguageCode: text("learner_language_code")
    .notNull()
    .references(() => languagesTable.code),
  /** Human-readable curriculum name in English */
  name: text("name").notNull(),
  /** Curriculum name in the learner's language */
  nameInLearnerLanguage: text("name_in_learner_language").notNull(),
  /**
   * Descriptive tag for the level framework used by this curriculum.
   * Purely informational — does not constrain what level codes you can create.
   * Examples: 'CEFR', 'CEFR_subdivided', 'HSK', 'JLPT', 'custom'
   */
  levelFramework: text("level_framework").notNull().default("custom"),
  description: text("description"),
  descriptionInLearnerLanguage: text("description_in_learner_language"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Curriculum = typeof curriculaTable.$inferSelect;
