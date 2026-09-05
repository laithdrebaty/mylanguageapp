/**
 * What a student is good at, what needs work, and what to do about it.
 *
 * Spec section 8 asks the system to analyse performance across lessons and
 * assessments, identify patterns, and advise where to put effort. Section 9 then
 * draws a hard line around that advice: it may recommend repeating a lesson,
 * reviewing existing vocabulary, repeating pronunciation practice, or doing
 * exercises that already exist — and it may NOT invent a new learning path,
 * skip curriculum content, or pull the student out of the planned sequence.
 *
 * That boundary is enforced structurally, not by asking a model nicely. The
 * recommendations are *selected from rows in the curriculum* by code here. The
 * model is handed the finished list and asked only to write a sentence about
 * it. It has no way to invent a recommendation, because it is never asked for
 * one.
 *
 * The spec is also explicit that the system should not push AI activities just
 * because AI exists. Nothing here recommends an AI conversation.
 */

import { eq, and, desc, gte, inArray, isNotNull, sql } from "drizzle-orm";
import {
  db,
  learningActivityAttemptsTable,
  quizResponsesTable,
  quizAttemptsTable,
  lessonProgressTable,
  lessonsTable,
  levelsTable,
  contentBlocksTable,
  studentProfilesTable,
  type AITask,
} from "@workspace/db";
import { z } from "zod";
import {
  buildSkillProfile,
  primaryFocus,
  type SkillEvidence,
  type SkillProfile,
  type Skill,
} from "./scoring/skill-profile";
import { resolveTaskConfig, computeCostUsd } from "./ai-config";
import { chatJson } from "./ai-providers/openai-compatible";
import { checkAndIncrement, recordUsage } from "./ai-quota";
import { publishedLessonFilter } from "./learning";
import { logger } from "../lib/logger";

const TASK: AITask = "weakness_analysis";

/** How far back to look. Older than this says little about a student today. */
const LOOKBACK_DAYS = 120;

/**
 * A dedicated assessment says more about a skill than one question does.
 * These are relative weights, not scores.
 */
const WEIGHT_SPEECH = 3;
const WEIGHT_WRITTEN = 2;
const WEIGHT_OBJECTIVE = 1;
const WEIGHT_LESSON = 1;

// ─── Recommendations ──────────────────────────────────────────────────────────

export type RecommendationKind =
  | "reread_lesson"
  | "repeat_pronunciation"
  | "practise_words"
  | "redo_lesson";

export interface Recommendation {
  kind: RecommendationKind;
  /** Which skill this addresses. */
  skill: Skill;
  /** Always an existing lesson. Null only for a word-practice item. */
  lessonId: number | null;
  lessonTitle: string | null;
  lessonTitleAr: string | null;
  /** Specific words the student got wrong, for pronunciation practice. */
  words?: string[];
  /** Why it is being suggested, in Arabic. */
  reasonAr: string;
}

export interface WeaknessReport {
  profile: SkillProfile;
  focus: Skill | null;
  recommendations: Recommendation[];
  /** Arabic advice. Null when the AI task is off or unavailable. */
  advice: string | null;
  /** True when there is too little history to say anything useful. */
  insufficientEvidence: boolean;
}

// ─── Evidence gathering ───────────────────────────────────────────────────────

/**
 * Everything recorded about this student, mapped onto skills.
 *
 * Each source contributes to the skills it actually says something about. A
 * pronunciation score says nothing about grammar; a multiple-choice answer says
 * something about comprehension and nothing about speaking. Mapping loosely
 * would produce a confident-looking profile built on irrelevant evidence.
 */
async function gatherEvidence(userId: number): Promise<SkillEvidence[]> {
  const since = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000);
  const evidence: SkillEvidence[] = [];

  // ── Spoken work, from lessons and from quizzes ──────────────────────────
  const spokenActivities = await db
    .select({
      pronunciation: learningActivityAttemptsTable.pronunciationScore,
      fluency: learningActivityAttemptsTable.fluencyScore,
      at: learningActivityAttemptsTable.submittedAt,
    })
    .from(learningActivityAttemptsTable)
    .where(
      and(
        eq(learningActivityAttemptsTable.userId, userId),
        gte(learningActivityAttemptsTable.submittedAt, since),
        isNotNull(learningActivityAttemptsTable.fluencyScore),
      ),
    );

  const spokenResponses = await db
    .select({
      pronunciation: quizResponsesTable.pronunciationScore,
      fluency: quizResponsesTable.fluencyScore,
      at: quizResponsesTable.createdAt,
    })
    .from(quizResponsesTable)
    .innerJoin(quizAttemptsTable, eq(quizAttemptsTable.id, quizResponsesTable.attemptId))
    .where(
      and(
        eq(quizAttemptsTable.userId, userId),
        gte(quizResponsesTable.createdAt, since),
        isNotNull(quizResponsesTable.fluencyScore),
      ),
    );

  for (const row of [...spokenActivities, ...spokenResponses]) {
    const at = row.at ?? new Date();
    if (row.pronunciation !== null) {
      evidence.push({
        skill: "pronunciation",
        score: row.pronunciation,
        at,
        weight: WEIGHT_SPEECH,
        source: "speaking task",
      });
    }
    if (row.fluency !== null) {
      evidence.push({
        skill: "fluency",
        score: row.fluency,
        at,
        weight: WEIGHT_SPEECH,
        source: "speaking task",
      });
      // Speaking overall: how well they actually spoke, whatever the passage.
      evidence.push({
        skill: "speaking",
        score:
          row.pronunciation !== null
            ? Math.round(row.pronunciation * 0.5 + row.fluency * 0.5)
            : row.fluency,
        at,
        weight: WEIGHT_SPEECH,
        source: "speaking task",
      });
    }
  }

  // ── Written work: the per-dimension sub-scores from AI grading ──────────
  // This is why those were stored separately rather than collapsed into one
  // mark — "weak grammar across six answers" is a finding; "scored 62" is not.
  const written = await db
    .select({
      aiMeta: quizResponsesTable.aiMeta,
      at: quizResponsesTable.createdAt,
    })
    .from(quizResponsesTable)
    .innerJoin(quizAttemptsTable, eq(quizAttemptsTable.id, quizResponsesTable.attemptId))
    .where(
      and(
        eq(quizAttemptsTable.userId, userId),
        gte(quizResponsesTable.createdAt, since),
        isNotNull(quizResponsesTable.aiMeta),
      ),
    );

  const activityWritten = await db
    .select({
      aiMeta: learningActivityAttemptsTable.aiMeta,
      at: learningActivityAttemptsTable.submittedAt,
    })
    .from(learningActivityAttemptsTable)
    .where(
      and(
        eq(learningActivityAttemptsTable.userId, userId),
        gte(learningActivityAttemptsTable.submittedAt, since),
        isNotNull(learningActivityAttemptsTable.aiMeta),
      ),
    );

  for (const row of [...written, ...activityWritten]) {
    const dims = (row.aiMeta as { dimensions?: Record<string, number> } | null)?.dimensions;
    if (!dims) continue;
    const at = row.at ?? new Date();

    const map: Array<[string, Skill]> = [
      ["grammar", "grammar"],
      ["vocabulary", "vocabulary"],
      ["relevance", "comprehension"],
      ["clarity", "writing"],
    ];

    for (const [key, skill] of map) {
      const value = dims[key];
      if (typeof value === "number") {
        evidence.push({
          skill,
          score: value,
          at,
          weight: WEIGHT_WRITTEN,
          source: "written answer",
        });
      }
    }
  }

  // ── Objective questions ─────────────────────────────────────────────────
  // Multiple choice tests whether they understood; spelling tests the word.
  const objective = await db
    .select({
      score: quizResponsesTable.score,
      type: contentBlocksTable.type,
      at: quizResponsesTable.createdAt,
    })
    .from(quizResponsesTable)
    .innerJoin(quizAttemptsTable, eq(quizAttemptsTable.id, quizResponsesTable.attemptId))
    .innerJoin(contentBlocksTable, eq(contentBlocksTable.id, quizResponsesTable.blockId))
    .where(
      and(
        eq(quizAttemptsTable.userId, userId),
        gte(quizResponsesTable.createdAt, since),
        eq(quizResponsesTable.gradedBy, "auto"),
        isNotNull(quizResponsesTable.score),
        inArray(contentBlocksTable.type, ["mcq", "multi_select", "spelling"]),
      ),
    );

  for (const row of objective) {
    if (row.score === null) continue;
    evidence.push({
      skill: row.type === "spelling" ? "vocabulary" : "comprehension",
      score: row.score,
      at: row.at ?? new Date(),
      weight: WEIGHT_OBJECTIVE,
      source: row.type,
    });
  }

  // ── Lesson outcomes ─────────────────────────────────────────────────────
  // A blunt signal, but it covers students who have done lessons and no
  // assessments yet — otherwise their profile would be entirely empty.
  const lessons = await db
    .select({
      score: lessonProgressTable.bestScore,
      at: lessonProgressTable.updatedAt,
    })
    .from(lessonProgressTable)
    .where(
      and(
        eq(lessonProgressTable.userId, userId),
        gte(lessonProgressTable.updatedAt, since),
        isNotNull(lessonProgressTable.bestScore),
      ),
    );

  for (const row of lessons) {
    if (row.score === null) continue;
    evidence.push({
      skill: "comprehension",
      score: row.score,
      at: row.at ?? new Date(),
      weight: WEIGHT_LESSON,
      source: "lesson",
    });
  }

  return evidence;
}

// ─── Choosing what to recommend ───────────────────────────────────────────────

/** Words the student actually got wrong, most recent first. */
async function recentProblemWords(userId: number, limit = 8): Promise<string[]> {
  const rows = await db
    .select({ metrics: learningActivityAttemptsTable.speechMetrics })
    .from(learningActivityAttemptsTable)
    .where(
      and(
        eq(learningActivityAttemptsTable.userId, userId),
        isNotNull(learningActivityAttemptsTable.speechMetrics),
      ),
    )
    .orderBy(desc(learningActivityAttemptsTable.submittedAt))
    .limit(10);

  const quizRows = await db
    .select({ metrics: quizResponsesTable.speechMetrics })
    .from(quizResponsesTable)
    .innerJoin(quizAttemptsTable, eq(quizAttemptsTable.id, quizResponsesTable.attemptId))
    .where(
      and(
        eq(quizAttemptsTable.userId, userId),
        isNotNull(quizResponsesTable.speechMetrics),
      ),
    )
    .orderBy(desc(quizResponsesTable.createdAt))
    .limit(10);

  const seen = new Set<string>();
  for (const row of [...rows, ...quizRows]) {
    const words = (row.metrics as { problemWords?: string[] } | null)?.problemWords;
    if (!Array.isArray(words)) continue;
    for (const word of words) {
      if (typeof word === "string" && word.length > 1) seen.add(word);
      if (seen.size >= limit) return [...seen];
    }
  }
  return [...seen];
}

/**
 * Pick what the student should do next, entirely from the curriculum.
 *
 * Every recommendation points at a lesson that exists and that this student has
 * already been given. Nothing here can produce a suggestion outside the planned
 * sequence, because there is nowhere for one to come from.
 */
async function chooseRecommendations(
  userId: number,
  profile: SkillProfile,
  focus: Skill | null,
): Promise<Recommendation[]> {
  if (!focus) return [];

  const [studentProfile] = await db
    .select({ currentLevelId: studentProfilesTable.currentLevelId })
    .from(studentProfilesTable)
    .where(eq(studentProfilesTable.userId, userId))
    .limit(1);

  if (!studentProfile?.currentLevelId) return [];

  const [level] = await db
    .select({ curriculumId: levelsTable.curriculumId, order: levelsTable.order })
    .from(levelsTable)
    .where(eq(levelsTable.id, studentProfile.currentLevelId))
    .limit(1);

  if (!level) return [];

  // Lessons the student has already reached — at or below their current level.
  // Recommending something ahead of them would be exactly the "skip the
  // sequence" that section 9 forbids.
  const weakest = await db
    .select({
      lessonId: lessonProgressTable.lessonId,
      bestScore: lessonProgressTable.bestScore,
      title: lessonsTable.title,
      titleAr: lessonsTable.titleAr,
      lessonType: lessonsTable.lessonType,
    })
    .from(lessonProgressTable)
    .innerJoin(lessonsTable, eq(lessonsTable.id, lessonProgressTable.lessonId))
    .innerJoin(levelsTable, eq(levelsTable.id, lessonsTable.levelId))
    .where(
      and(
        eq(lessonProgressTable.userId, userId),
        eq(levelsTable.curriculumId, level.curriculumId),
        sql`${levelsTable.order} <= ${level.order}`,
        publishedLessonFilter(),
        isNotNull(lessonProgressTable.bestScore),
      ),
    )
    .orderBy(lessonProgressTable.bestScore)
    .limit(5);

  const recommendations: Recommendation[] = [];

  if (focus === "pronunciation" || focus === "fluency" || focus === "speaking") {
    const words = await recentProblemWords(userId);

    // The spec's own worked example: go back and read the previous lesson texts
    // while listening to the original recordings, especially the difficult words.
    const readingLesson =
      weakest.find((l) => ["reading", "pronunciation", "speaking"].includes(l.lessonType)) ??
      weakest[0];

    if (readingLesson) {
      recommendations.push({
        kind: "repeat_pronunciation",
        skill: focus,
        lessonId: readingLesson.lessonId,
        lessonTitle: readingLesson.title,
        lessonTitleAr: readingLesson.titleAr,
        words,
        reasonAr: "أعد قراءة نص هذا الدرس بصوت عالٍ مع الاستماع للتسجيل الأصلي.",
      });
    }

    if (words.length > 0) {
      recommendations.push({
        kind: "practise_words",
        skill: focus,
        lessonId: null,
        lessonTitle: null,
        lessonTitleAr: null,
        words,
        reasonAr: "تدرّب على نطق هذه الكلمات التي واجهت صعوبة فيها.",
      });
    }
  }

  // Whatever the focus, the lessons they scored worst on are the ones to redo.
  for (const lesson of weakest.slice(0, 3)) {
    if (recommendations.some((r) => r.lessonId === lesson.lessonId)) continue;
    recommendations.push({
      kind: lesson.bestScore !== null && lesson.bestScore < 75 ? "redo_lesson" : "reread_lesson",
      skill: focus,
      lessonId: lesson.lessonId,
      lessonTitle: lesson.title,
      lessonTitleAr: lesson.titleAr,
      reasonAr:
        lesson.bestScore !== null && lesson.bestScore < 75
          ? "أعد هذا الدرس — نتيجتك فيه كانت منخفضة."
          : "راجع هذا الدرس لتثبيت ما تعلمته.",
    });
  }

  return recommendations.slice(0, 4);
}

// ─── The advice sentence ──────────────────────────────────────────────────────

const adviceSchema = z.object({ adviceAr: z.string().min(1).max(500) });

/**
 * One short model call turning the profile into advice.
 *
 * The model is given the numbers and the already-chosen recommendations, and
 * asked to write about them. It is told in as many words that it may not invent
 * a recommendation and may not suggest AI conversation practice — but the real
 * guarantee is structural: nothing it writes is ever parsed back into an
 * action. The recommendations the student sees are the ones code selected.
 */
async function writeAdvice(
  profile: SkillProfile,
  focus: Skill,
  recommendations: Recommendation[],
  ctx: { userId: number; subscriptionPlan: string | null },
): Promise<string | null> {
  let config;
  try {
    config = await resolveTaskConfig(TASK);
  } catch {
    return null;
  }

  try {
    await checkAndIncrement({
      userId: ctx.userId,
      subscriptionPlan: ctx.subscriptionPlan,
      task: TASK,
      feature: "conversation_assist",
    });
  } catch {
    return null;
  }

  const facts = [
    `The skill most worth working on is: ${focus}.`,
    ...profile.skills
      .filter((s) => s.score !== null && s.confidence !== "low" && s.confidence !== "none")
      .map((s) => `${s.skill}: ${s.score}/100 (${s.confidence} confidence, ${s.trend})`),
    profile.strengths.length ? `Doing well at: ${profile.strengths.join(", ")}.` : "",
    "",
    "The student has already been given these things to do:",
    ...recommendations.map((r) =>
      r.lessonTitle
        ? `- ${r.kind}: "${r.lessonTitle}"`
        : `- ${r.kind}: ${(r.words ?? []).join(", ")}`,
    ),
  ]
    .filter(Boolean)
    .join("\n");

  const started = Date.now();
  let succeeded = false;
  let usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

  try {
    const result = await chatJson(
      config,
      [
        {
          role: "system",
          content: [
            "You advise an Arabic-speaking student learning English.",
            "",
            "You are given measurements that have already been computed, and a",
            "list of things from their existing course that have already been",
            "chosen for them. Write two or three short sentences IN ARABIC:",
            "name one thing they are doing well, then the one skill to work on,",
            "then point at the work already chosen for them.",
            "",
            "You must NOT invent new exercises, suggest material outside their",
            "course, tell them to skip ahead, or recommend conversation practice",
            "with an AI. Do not contradict the numbers and do not restate them",
            "all — pick what matters.",
            "",
            'Reply with ONLY a JSON object: {"adviceAr": "..."}',
          ].join("\n"),
        },
        { role: "user", content: facts },
      ],
      (value) => adviceSchema.parse(value),
    );

    usage = result.usage;
    succeeded = true;
    return result.value.adviceAr.trim();
  } catch (err) {
    // The profile and the recommendations stand on their own. Losing the
    // sentence is a degradation, not a failure.
    logger.info(
      { err: err instanceof Error ? err.message : err },
      "Weakness advice sentence unavailable",
    );
    return null;
  } finally {
    void recordUsage({
      userId: ctx.userId,
      subscriptionPlan: ctx.subscriptionPlan,
      task: TASK,
      feature: "conversation_assist",
      provider: config.providerLabel,
      modelId: config.modelId,
      tokensUsed: usage.totalTokens,
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      costUsd: computeCostUsd(config, usage) ?? undefined,
      succeeded,
      latencyMs: Date.now() - started,
    });
  }
}

// ─── Entry point ──────────────────────────────────────────────────────────────

/**
 * The full picture for one student.
 *
 * `withAdvice` is off by default: the profile and recommendations cost nothing
 * and can be shown on every dashboard load, while the sentence costs a model
 * call and should be asked for deliberately.
 */
export async function getWeaknessReport(
  userId: number,
  opts: { subscriptionPlan?: string | null; withAdvice?: boolean } = {},
): Promise<WeaknessReport> {
  const evidence = await gatherEvidence(userId);
  const profile = buildSkillProfile(evidence);
  const focus = primaryFocus(profile);

  // Nothing supportable to say. Better to admit that than to manufacture a
  // weakness from three answers.
  const insufficientEvidence =
    profile.skills.every((s) => s.confidence === "none" || s.confidence === "low");

  const recommendations = insufficientEvidence
    ? []
    : await chooseRecommendations(userId, profile, focus);

  let advice: string | null = null;
  if (opts.withAdvice && focus && !insufficientEvidence) {
    advice = await writeAdvice(profile, focus, recommendations, {
      userId,
      subscriptionPlan: opts.subscriptionPlan ?? null,
    });
  }

  return { profile, focus, recommendations, advice, insufficientEvidence };
}
