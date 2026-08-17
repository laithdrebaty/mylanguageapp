import { pgTable, text, serial, timestamp, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: text("role", { enum: ["student", "admin"] }).notNull().default("student"),
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
  currentLevelCode: text("current_level_code").notNull().default("A1.1"),
  streakDays: serial("streak_days").notNull(),
  totalXp: serial("total_xp").notNull(),
  placementCompleted: boolean("placement_completed").notNull().default(false),
  lastActivityAt: timestamp("last_activity_at", { withTimezone: true }).defaultNow(),
  bio: text("bio"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type StudentProfile = typeof studentProfilesTable.$inferSelect;
