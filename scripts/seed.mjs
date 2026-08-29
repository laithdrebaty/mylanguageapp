#!/usr/bin/env node
/**
 * Seed the baseline data a student needs in order to get anywhere.
 *
 * Without this, a fresh database is a dead end: `student_profiles.current_level_id`
 * is null, the only way to set it is the placement test, and the placement test
 * has no questions — so every level and lesson stays LOCKED forever.
 *
 * Seeds (idempotent — safe to re-run, keyed on natural identifiers):
 *   - 3 subscription plans
 *   - 2 languages + 1 CEFR curriculum
 *   - 12 CEFR levels (A1.1 → C2.2)
 *   - 10 placement questions with 4 options each
 *
 * Usage: DATABASE_URL=postgresql://... node scripts/seed.mjs
 */
import pg from 'pg';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL must be set.');
  process.exit(1);
}

const PLANS = [
  {
    code: 'free', name: 'Free', nameAr: 'مجاني',
    priceUsd: 0, lessonsAccess: 'a1_only',
    description: 'Access to A1.1 only',
    descriptionAr: 'الوصول إلى المستوى A1.1 فقط',
  },
  {
    code: 'general_english', name: 'General English', nameAr: 'الإنجليزية العامة',
    priceUsd: 2, lessonsAccess: 'full',
    description: 'Full access to A1–C2',
    descriptionAr: 'وصول كامل من A1 إلى C2',
  },
  {
    code: 'professional_english', name: 'Professional English', nameAr: 'الإنجليزية المهنية',
    priceUsd: 4, lessonsAccess: 'full',
    description: 'Full access plus business vocabulary',
    descriptionAr: 'وصول كامل بالإضافة إلى مفردات الأعمال',
  },
];

const LEVELS = [
  ['A1.1', 'Beginner 1', 'مبتدئ ١'],
  ['A1.2', 'Beginner 2', 'مبتدئ ٢'],
  ['A2.1', 'Elementary 1', 'أساسي ١'],
  ['A2.2', 'Elementary 2', 'أساسي ٢'],
  ['B1.1', 'Intermediate 1', 'متوسط ١'],
  ['B1.2', 'Intermediate 2', 'متوسط ٢'],
  ['B2.1', 'Upper Intermediate 1', 'فوق المتوسط ١'],
  ['B2.2', 'Upper Intermediate 2', 'فوق المتوسط ٢'],
  ['C1.1', 'Advanced 1', 'متقدم ١'],
  ['C1.2', 'Advanced 2', 'متقدم ٢'],
  ['C2.1', 'Proficient 1', 'متمكن ١'],
  ['C2.2', 'Proficient 2', 'متمكن ٢'],
];

/** 10 questions, ascending difficulty. `c` marks the correct option. */
const QUESTIONS = [
  {
    q: 'Choose the correct greeting: "____ morning!"',
    ar: 'اختر التحية الصحيحة: "____ morning!"',
    opts: [['a', 'Good', true], ['b', 'Well', false], ['c', 'Nice', false], ['d', 'Fine', false]],
  },
  {
    q: '"My name ____ Sara."',
    ar: '"My name ____ Sara."',
    opts: [['a', 'am', false], ['b', 'is', true], ['c', 'are', false], ['d', 'be', false]],
  },
  {
    q: 'Which is a number? ',
    ar: 'أي مما يلي رقم؟',
    opts: [['a', 'Blue', false], ['b', 'Seven', true], ['c', 'Table', false], ['d', 'Run', false]],
  },
  {
    q: '"She ____ to school every day."',
    ar: '"She ____ to school every day."',
    opts: [['a', 'go', false], ['b', 'goes', true], ['c', 'going', false], ['d', 'gone', false]],
  },
  {
    q: 'Choose the past tense of "eat".',
    ar: 'اختر صيغة الماضي من الفعل "eat".',
    opts: [['a', 'eated', false], ['b', 'eaten', false], ['c', 'ate', true], ['d', 'eating', false]],
  },
  {
    q: '"I have lived here ____ 2019."',
    ar: '"I have lived here ____ 2019."',
    opts: [['a', 'since', true], ['b', 'for', false], ['c', 'from', false], ['d', 'during', false]],
  },
  {
    q: '"If I ____ more time, I would travel."',
    ar: '"If I ____ more time, I would travel."',
    opts: [['a', 'have', false], ['b', 'had', true], ['c', 'has', false], ['d', 'having', false]],
  },
  {
    q: 'Which word means "extremely tired"?',
    ar: 'أي كلمة تعني "متعب جداً"؟',
    opts: [['a', 'Exhausted', true], ['b', 'Excited', false], ['c', 'Enormous', false], ['d', 'Efficient', false]],
  },
  {
    q: 'Choose the best formal alternative to "get in touch with".',
    ar: 'اختر البديل الرسمي الأنسب لعبارة "get in touch with".',
    opts: [['a', 'Reach out', false], ['b', 'Contact', true], ['c', 'Ring up', false], ['d', 'Catch', false]],
  },
  {
    q: '"Had she known, she ____ differently."',
    ar: '"Had she known, she ____ differently."',
    opts: [
      ['a', 'would act', false],
      ['b', 'would have acted', true],
      ['c', 'will act', false],
      ['d', 'acted', false],
    ],
  },
];

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();

try {
  await client.query('BEGIN');

  // ── Subscription plans ────────────────────────────────────────────────────
  for (const p of PLANS) {
    await client.query(
      `INSERT INTO subscription_plans
         (code, name, name_ar, price_usd, lessons_access, description, description_ar)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (code) DO NOTHING`,
      [p.code, p.name, p.nameAr, p.priceUsd, p.lessonsAccess, p.description, p.descriptionAr],
    );
  }
  console.log(`Subscription plans: ${PLANS.length} ensured.`);

  // ── Languages ─────────────────────────────────────────────────────────────
  await client.query(
    `INSERT INTO languages (code, name, name_native, rtl)
     VALUES ('en','English','English',false), ('ar','Arabic','العربية',true)
     ON CONFLICT (code) DO NOTHING`,
  );

  // ── Curriculum ────────────────────────────────────────────────────────────
  let { rows: cur } = await client.query(
    `SELECT id FROM curricula
      WHERE target_language_code = 'en' AND learner_language_code = 'ar'
      LIMIT 1`,
  );
  if (cur.length === 0) {
    ({ rows: cur } = await client.query(
      `INSERT INTO curricula
         (target_language_code, learner_language_code, name, name_in_learner_language, level_framework)
       VALUES ('en','ar','CEFR English','الإنجليزية حسب الإطار الأوروبي','CEFR')
       RETURNING id`,
    ));
  }
  const curriculumId = cur[0].id;
  console.log(`Curriculum id ${curriculumId}.`);

  // ── Levels ────────────────────────────────────────────────────────────────
  // The placement test maps a score across however many levels exist, so all 12
  // must be present for the assignment spread to be meaningful.
  for (const [i, [code, name, nameAr]] of LEVELS.entries()) {
    await client.query(
      `INSERT INTO levels (curriculum_id, code, name, name_ar, "order")
       SELECT $1,$2,$3,$4,$5
       WHERE NOT EXISTS (
         SELECT 1 FROM levels WHERE curriculum_id = $1 AND code = $2
       )`,
      [curriculumId, code, name, nameAr, i + 1],
    );
  }
  console.log(`Levels: ${LEVELS.length} ensured.`);

  // ── Placement test ────────────────────────────────────────────────────────
  for (const [i, item] of QUESTIONS.entries()) {
    const order = i + 1;
    const { rows: existing } = await client.query(
      `SELECT id FROM placement_questions WHERE "order" = $1 LIMIT 1`,
      [order],
    );
    if (existing.length > 0) continue;

    const { rows: [q] } = await client.query(
      `INSERT INTO placement_questions (question_text, question_text_ar, type, "order")
       VALUES ($1,$2,'mcq',$3) RETURNING id`,
      [item.q, item.ar, order],
    );
    for (const [optionId, text, isCorrect] of item.opts) {
      await client.query(
        `INSERT INTO placement_options (question_id, option_id, text, is_correct)
         VALUES ($1,$2,$3,$4)`,
        [q.id, optionId, text, isCorrect],
      );
    }
  }
  console.log(`Placement questions: ${QUESTIONS.length} ensured.`);

  await client.query('COMMIT');
  console.log('Seed complete.');
} catch (err) {
  await client.query('ROLLBACK');
  throw err;
} finally {
  await client.end();
}
