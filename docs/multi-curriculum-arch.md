---
name: Multi-curriculum extensible architecture
description: How the language/curriculum/level system is designed to be fully database-driven with no hard-coded frameworks.
---

## Architecture

### Tables (new)
- `languages` — ISO 639-1 codes, name, nameNative, rtl flag. Adding a new language = one INSERT.
- `curricula` — joins target_language_code + learner_language_code. Has levelFramework (informational string, not enforced). Adding a new curriculum = one INSERT + add levels with curriculum_id.

### Modified tables
- `levels.curriculum_id` — FK to curricula. Code is now unique per curriculum (composite unique index on curriculum_id+code), not globally. CEFR codes can exist in multiple curricula independently.
- `levels.lessonType` — changed from pgEnum to plain text so new lesson types can be added via INSERT only.
- `levels.type` (content_blocks) — same, plain text for extensibility.
- `student_profiles.current_level_id` — integer FK to levels.id, replaces old current_level_code string. Curriculum-scoped; ambiguity-free.
- `student_profiles.curriculum_id` — FK to curricula; which curriculum the student is enrolled in.
- `placement_results.assigned_level_id` — FK to levels.id (in addition to legacy assigned_level_code text).

### Placement test
Dynamic: looks up all levels for the student's curriculum ordered by `order`, maps score % to a level index. No CEFR codes hard-coded anywhere in application logic.

### Default curriculum
id=1, target=en, learner=ar, framework=CEFR_subdivided. New students are enrolled in the first active curriculum by default (auth.ts getDefaultCurriculumId()).

### How to add a new curriculum (zero code changes)
1. INSERT into languages for any new language codes needed.
2. INSERT into curricula with target/learner language codes and levelFramework label.
3. INSERT into levels with the new curriculum_id and any level structure (no code constraints).
4. INSERT lessons, content_blocks, vocabulary etc. belonging to those levels.
5. The existing API routes (GET /levels, GET /lessons, placement, dashboard) all resolve curriculum from the student's enrolled curriculum_id or fall back to the first active one.

**Why:** The requirement is that no code change should be needed when an admin creates a new level structure or target language.
