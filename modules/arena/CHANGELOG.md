# Changelog

## 0.1.0 (unreleased)

- Arena v1, comprehension checks: `buildQuiz` gives 3 to 5 questions on one Docket file, each with
  quoted evidence (field, quote, link) verified word for word against the file before it is shown.
- Rule set `arena.rules/1` (title, classification, committee, theme, agenda step, council yes
  count, status; wrong options from other files of the same snapshot, deterministic).
- Seed set `arena.seed/1`: 8 hand-written questions on 3 files of the recorded snapshot (en, fr, de).
- `quizProblems` / `questionProblems` (shape of `spec/schemas/quiz.schema.json` plus answer and
  uniqueness checks) and `groundingProblems`. CLI `check-seed` checks the seed set against a snapshot.

### Deferred

- Sign-off of seed questions by advocates of each option (`QuizPool.signoffs` in the data model).
- A model-drafted path (Companion) whose quotes go through the same `groundingProblems` check.
- Opt-in anonymous pass-rate counts by language and region; nothing is sent in v1.
- Badges bound to a Door credential (`passed check for matter X`); the "understood" mark is local only.
- Questions from document text, once Docket extracts PDF text into the snapshot.
- Seed prompts in Luxembourgish and Portuguese.
