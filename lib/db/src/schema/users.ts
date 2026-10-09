import { pgTable, text, serial, integer, timestamp, boolean, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { curriculaTable } from "./languages";
import { levelsTable } from "./levels";

export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  /**
   * Roles:
   *   student          — no CMS access
   *   admin            — full access
   *   content_manager  — create/edit/submit content; cannot publish or manage users
   *   content_reviewer — review and approve/reject; cannot publish
   */
  role: text("role", {
    enum: ["student", "admin", "content_manager", "content_reviewer"],
  }).notNull().default("student"),
  preferredLanguage: text("preferred_language", { enum: ["ar", "en"] }).notNull().default("ar"),
  country: text("country").notNull().default("SY"),
  /** How the student heard about the app. Asked at signup; drives the admin referral report. */
  referralSource: text("referral_source"),
  /** Free text when referralSource is "other" — kept separate so the enum stays reportable. */
  referralDetail: text("referral_detail"),
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
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  curriculumId: integer("curriculum_id").references(() => curriculaTable.id),
  currentLevelId: integer("current_level_id").references(() => levelsTable.id),
  streakDays: integer("streak_days").notNull().default(0),
  totalXp: integer("total_xp").notNull().default(0),
  placementCompleted: boolean("placement_completed").notNull().default(false),
  lastActivityAt: timestamp("last_activity_at", { withTimezone: true }).defaultNow(),
  bio: text("bio"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => ({
  userIdUnique: uniqueIndex("student_profiles_user_id_unique").on(table.userId),
}));

export type StudentProfile = typeof studentProfilesTable.$inferSelect;
