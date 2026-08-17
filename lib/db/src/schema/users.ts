import { pgTable, text, serial, integer, timestamp, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { curriculaTable } from "./languages";
import { levelsTable } from "./levels";

export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: text("role", { enum: ["student", "admin"] }).notNull().default("student"),
  /** Interface language preference — independent of the target/learner language of a curriculum */
  preferredLanguage: text("preferred_language", { enum: ["ar", "en"] }).notNull().default("ar"),
  country: text("country").notNull().default("SY"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertUserSchema = createInsertSchema(usersTable).omit({
  id: true, createdAt: true, updatedAt: true, passwordHash: true,
});
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;

export const studentProfilesTable = pgTable("student_profiles", {
  id: serial("id").primaryKey(),
  userId: serial("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  /**
   * Which curriculum the student is currently enrolled in.
   * Nullable so a profile can exist before curriculum assignment.
   * Set at registration time (defaulting to the platform's primary curriculum)
   * or when a student explicitly switches curriculum.
   */
  curriculumId: integer("curriculum_id").references(() => curriculaTable.id),
  /**
   * FK to the level the student is currently working on within their curriculum.
   * Replaces the old string currentLevelCode field — level IDs are curriculum-scoped
   * so a student in curriculum A and a student in curriculum B can both be on "level 1"
   * without ambiguity.
   * Nullable until placement test assigns a level.
   */
  currentLevelId: integer("current_level_id").references(() => levelsTable.id),
  streakDays: serial("streak_days").notNull(),
  totalXp: serial("total_xp").notNull(),
  placementCompleted: boolean("placement_completed").notNull().default(false),
  lastActivityAt: timestamp("last_activity_at", { withTimezone: true }).defaultNow(),
  bio: text("bio"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type StudentProfile = typeof studentProfilesTable.$inferSelect;
