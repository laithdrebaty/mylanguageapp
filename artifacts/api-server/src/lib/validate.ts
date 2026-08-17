/**
 * Input validation helpers for API routes.
 *
 * Uses zod (v3, installed in api-server) for schema-based validation.
 * Returns a 400 response on failure so routes stay clean.
 *
 * Usage:
 *   const body = validate(res, registerSchema, req.body);
 *   if (!body) return; // response already sent
 */

import { z } from "zod";
import type { Response } from "express";

export function validate<T>(
  res: Response,
  schema: z.ZodType<T>,
  data: unknown,
): T | null {
  const result = schema.safeParse(data);
  if (!result.success) {
    res.status(400).json({
      error: "Validation failed",
      details: result.error.errors.map((e) => ({
        path: e.path.join("."),
        message: e.message,
      })),
    });
    return null;
  }
  return result.data;
}

// ─── Shared schemas ────────────────────────────────────────────────────────────

export const registerSchema = z.object({
  name: z.string().min(1, "Name is required").max(100),
  email: z.string().email("Invalid email address"),
  password: z.string().min(6, "Password must be at least 6 characters").max(100),
  preferredLanguage: z.enum(["ar", "en"]).optional().default("ar"),
  country: z.string().length(2).optional().default("SY"),
});

export const loginSchema = z.object({
  email: z.string().min(1, "Email is required"),
  password: z.string().min(1, "Password is required"),
});

export const lessonCompleteSchema = z.object({
  score: z.number().min(0).max(100),
  totalQuestions: z.number().int().min(0).optional(),
  correctAnswers: z.number().int().min(0).optional(),
  speakingScore: z.number().min(0).max(100).nullable().optional(),
  timeSpentSeconds: z.number().int().min(0).optional(),
});

export const profileUpdateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  bio: z.string().max(500).nullable().optional(),
  preferredLanguage: z.enum(["ar", "en"]).optional(),
  country: z.string().length(2).optional(),
});

export const placementSubmitSchema = z.object({
  answers: z.array(
    z.object({
      questionId: z.number().int().positive(),
      selectedOptionId: z.string().min(1),
    }),
  ).min(1, "At least one answer is required"),
});

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
