import { pgTable, text, serial, integer, boolean, timestamp, real } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const subscriptionPlansTable = pgTable("subscription_plans", {
  id: serial("id").primaryKey(),
  code: text("code", { enum: ["free", "general_english", "professional_english"] }).notNull().unique(),
  name: text("name").notNull(),
  nameAr: text("name_ar").notNull(),
  description: text("description"),
  descriptionAr: text("description_ar"),
  priceUsd: real("price_usd").notNull().default(0),
  currency: text("currency").notNull().default("USD"),
  billingCycle: text("billing_cycle", { enum: ["monthly", "yearly"] }).notNull().default("monthly"),
  features: text("features").array().notNull().default([]),
  featuresAr: text("features_ar").array().notNull().default([]),
  includesConversationPartner: boolean("includes_conversation_partner").notNull().default(false),
  lessonsAccess: text("lessons_access", { enum: ["a1_only", "full", "professional_only"] }).notNull().default("a1_only"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type SubscriptionPlan = typeof subscriptionPlansTable.$inferSelect;

export const studentSubscriptionsTable = pgTable("student_subscriptions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  planCode: text("plan_code").notNull(),
  planName: text("plan_name").notNull(),
  planNameAr: text("plan_name_ar").notNull(),
  status: text("status", { enum: ["active", "pending_payment", "expired", "cancelled"] }).notNull().default("pending_payment"),
  paymentMethod: text("payment_method"),
  paymentReference: text("payment_reference"),
  paymentNote: text("payment_note"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type StudentSubscription = typeof studentSubscriptionsTable.$inferSelect;
