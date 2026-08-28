/**
 * CMS API utilities
 * Typed fetch wrappers for all CMS endpoints.
 * Uses the Vite BASE_URL so paths work when the app is served under a sub-path.
 */

const base = () => `${import.meta.env.BASE_URL.replace(/\/$/, "")}/api`;

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const r = await fetch(`${base()}${path}`, {
    method,
    credentials: "include",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) {
    let msg = `${method} ${path} → ${r.status}`;
    try { const e = await r.json(); msg = e.error ?? JSON.stringify(e); } catch {}
    throw new Error(msg);
  }
  return r.json();
}

const get = <T>(path: string) => request<T>("GET", path);
const post = <T>(path: string, body?: unknown) => request<T>("POST", path, body);
const patch = <T>(path: string, body: unknown) => request<T>("PATCH", path, body);
const del = <T>(path: string) => request<T>("DELETE", path);

// ─── Types ────────────────────────────────────────────────────────────────

export type LessonStatus = "draft" | "in_review" | "approved" | "published" | "archived";

export interface CMSLesson {
  id: number; levelId: number; levelCode?: string; curriculumId?: number;
  title: string; titleAr: string; subtitle?: string | null;
  description?: string | null; status: LessonStatus;
  lessonType: string; estimatedMinutes: number; order: number;
  xpReward: number; passingScore: number; difficulty?: string | null;
  tags?: string[] | null; objectives?: string[] | null;
  objectivesAr?: string[] | null; teacherNotes?: string | null;
  contentVersion?: number; createdAt?: string; updatedAt?: string;
}

export interface CMSBlock {
  id: number; lessonId: number; type: string; order: number;
  title?: string | null; titleAr?: string | null;
  instructions?: string | null; instructionsAr?: string | null;
  content?: string | null; contentAr?: string | null;
  audioNote?: string | null; prompt?: string | null; promptAr?: string | null;
  exampleAudio?: string | null; isRequired: boolean;
  estimatedMinutes?: number | null; isActive: boolean; config?: unknown;
  exercise?: CMSExercise | null; options?: CMSOption[];
}

export interface CMSExercise {
  id: number; lessonId: number; contentBlockId?: number | null;
  exerciseType: string; question: string; questionAr?: string | null;
  correctOptionId: string; explanation?: string | null;
  prompt?: string | null; promptAr?: string | null;
  modelAnswer?: string | null; modelAnswerAr?: string | null;
  expectedConcepts?: string | null; difficulty?: string | null; points?: number;
}

export interface CMSOption {
  id?: number; exerciseId?: number; optionId: string; text: string; textAr?: string | null;
}

export interface CMSVocabItem {
  id: number; levelId: number; lessonId?: number | null;
  word: string; translation: string; definition?: string | null;
  partOfSpeech?: string | null; exampleSentence?: string | null;
  exampleSentenceAr?: string | null; pronunciation?: string | null;
  difficulty?: string | null; tags?: string[] | null;
}

export interface CMSStats {
  languages: number; curricula: number; levels: number; vocabulary: number;
  lessons: { draft: number; in_review: number; approved: number; published: number; archived: number; total: number };
  recentLessons: CMSLesson[];
}

// ─── Dashboard ────────────────────────────────────────────────────────────

export const cmsApi = {
  stats: () => get<CMSStats>("/cms/stats"),

  // Lessons
  lessons: {
    list: (params?: Record<string, string | number | undefined>) => {
      const q = new URLSearchParams();
      if (params) Object.entries(params).forEach(([k, v]) => v !== undefined && q.set(k, String(v)));
      return get<{ lessons: CMSLesson[]; total: number; page: number; limit: number }>(`/cms/lessons?${q}`);
    },
    get: (id: number) => get<CMSLesson>(`/cms/lessons/${id}`),
    create: (body: Partial<CMSLesson>) => post<{ id: number; status: string }>("/cms/lessons", body),
    update: (id: number, body: Partial<CMSLesson>) => patch<{ id: number }>(`/cms/lessons/${id}`, body),
    duplicate: (id: number) => post<{ id: number; status: string }>(`/cms/lessons/${id}/duplicate`),
    submit: (id: number) => post<{ id: number; status: string }>(`/cms/lessons/${id}/submit`),
    approve: (id: number) => post<{ id: number; status: string }>(`/cms/lessons/${id}/approve`),
    reject: (id: number, notes?: string) => post<{ id: number; status: string }>(`/cms/lessons/${id}/reject`, { notes }),
    publish: (id: number) => post<{ id: number; status: string }>(`/cms/lessons/${id}/publish`),
    unpublish: (id: number) => post<{ id: number; status: string }>(`/cms/lessons/${id}/unpublish`),
    archive: (id: number) => post<{ id: number; status: string }>(`/cms/lessons/${id}/archive`),
    restore: (id: number) => post<{ id: number; status: string }>(`/cms/lessons/${id}/restore`),
    delete: (id: number) => del<{ deleted: boolean }>(`/cms/lessons/${id}`),
    preview: (id: number) => get<{ isPreview: boolean; lesson: CMSLesson; contentBlocks: CMSBlock[]; vocabulary: CMSVocabItem[] }>(`/cms/lessons/${id}/preview`),
  },

  // Blocks
  blocks: {
    list: (lessonId: number) => get<CMSBlock[]>(`/cms/lessons/${lessonId}/blocks`),
    create: (lessonId: number, body: Partial<CMSBlock>) => post<CMSBlock>(`/cms/lessons/${lessonId}/blocks`, body),
    update: (lessonId: number, blockId: number, body: Partial<CMSBlock>) => patch<CMSBlock>(`/cms/lessons/${lessonId}/blocks/${blockId}`, body),
    delete: (lessonId: number, blockId: number) => del<{ deleted: boolean }>(`/cms/lessons/${lessonId}/blocks/${blockId}`),
    reorder: (lessonId: number, blockIds: number[]) => post<{ reordered: boolean }>(`/cms/lessons/${lessonId}/blocks/reorder`, { blockIds }),
    createExercise: (lessonId: number, blockId: number, body: Partial<CMSExercise> & { options?: CMSOption[] }) =>
      post<CMSExercise>(`/cms/lessons/${lessonId}/blocks/${blockId}/exercise`, body),
    updateExercise: (lessonId: number, exerciseId: number, body: Partial<CMSExercise> & { options?: CMSOption[] }) =>
      patch<CMSExercise>(`/cms/lessons/${lessonId}/exercises/${exerciseId}`, body),
    deleteExercise: (lessonId: number, exerciseId: number) =>
      del<{ deleted: boolean }>(`/cms/lessons/${lessonId}/exercises/${exerciseId}`),
  },

  // Catalog
  languages: {
    list: () => get<any[]>("/cms/languages"),
    create: (body: any) => post<any>("/cms/languages", body),
    update: (id: number, body: any) => patch<any>(`/cms/languages/${id}`, body),
  },
  curricula: {
    list: () => get<any[]>("/cms/curricula"),
    create: (body: any) => post<any>("/cms/curricula", body),
    update: (id: number, body: any) => patch<any>(`/cms/curricula/${id}`, body),
  },
  levels: {
    list: (curriculumId?: number) => get<any[]>(`/cms/levels${curriculumId ? `?curriculumId=${curriculumId}` : ""}`),
    create: (body: any) => post<any>("/cms/levels", body),
    update: (id: number, body: any) => patch<any>(`/cms/levels/${id}`, body),
    reorder: (levelIds: number[]) => post<any>("/cms/levels/reorder", { levelIds }),
  },

  // Vocabulary
  vocabulary: {
    list: (params?: Record<string, string | number | undefined>) => {
      const q = new URLSearchParams();
      if (params) Object.entries(params).forEach(([k, v]) => v !== undefined && q.set(k, String(v)));
      return get<{ items: CMSVocabItem[]; total: number; page: number; limit: number }>(`/cms/vocabulary?${q}`);
    },
    create: (body: Partial<CMSVocabItem>) => post<CMSVocabItem>("/cms/vocabulary", body),
    update: (id: number, body: Partial<CMSVocabItem>) => patch<CMSVocabItem>(`/cms/vocabulary/${id}`, body),
    delete: (id: number) => del<{ deleted: boolean }>(`/cms/vocabulary/${id}`),
  },

  // Media
  media: {
    list: (page = 1) => get<{ items: any[]; total: number }>(`/cms/media?page=${page}`),
    create: (body: any) => post<any>("/cms/media", body),
    delete: (id: number) => del<any>(`/cms/media/${id}`),
  },

  // Reviews + audit
  reviews: {
    queue: () => get<any[]>("/cms/reviews"),
    forLesson: (lessonId: number) => get<any[]>(`/cms/reviews/lesson/${lessonId}`),
  },
  audit: {
    list: (params?: Record<string, string | number | undefined>) => {
      const q = new URLSearchParams();
      if (params) Object.entries(params).forEach(([k, v]) => v !== undefined && q.set(k, String(v)));
      return get<{ logs: any[]; total: number; page: number; limit: number }>(`/cms/audit?${q}`);
    },
  },
};
