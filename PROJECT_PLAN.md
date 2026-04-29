# ExerciseTracker Production Plan

## Summary

ExerciseTracker is a mobile-first installable PWA for Android, also usable on desktop from the same web app. Version one is a free personal workout tracker for a single user.

The application supports Monday-Saturday workout templates, workout logging, guided rest timers, manual exercise-order selection during workouts, offline use, light/dark display modes, per-exercise progress history, weight charts, personal bests, plateau visibility, and JSON/CSV export.

## Technical Direction

- React + TypeScript frontend.
- Vite build and development tooling.
- React Router app routing.
- Local browser storage for the editable plan and completed history.
- IndexedDB through Dexie for active-workout persistence and a local sync queue that can support a future backend.
- PWA manifest and service worker for Android installation and desktop access.
- No account authorisation or sign-in flow in v1.

## Core Product Model

The default workout structure is 6 workout days, 5 exercises per day, and 3 sets per exercise, but the data model remains flexible for future exceptions.

Core entities:

- `workout_templates`: named weekly plans.
- `template_days`: weekday or named-day entries inside a template.
- `template_exercises`: ordered exercises for a day.
- `template_sets`: target values for each planned set.
- `workout_sessions`: dated workout logs created from a template-day snapshot.
- `session_sets`: actual completed set results.
- `rest_events`: optional logged recovery periods between completed sets.
- `band_colours`: custom resistance band palette.

Supported set modes:

- `weighted_reps`: target and actual `weight_kg` plus `reps`.
- `timed_hold`: target and actual `seconds`.
- `band_reps`: one or more selected band colours plus `reps`.

Workout logging:

- The Home and Workout entry points default to the template day matching today's weekday.
- Session snapshots preserve the plan as it existed at workout time.
- Each set has a one-tap complete action that copies target values into actual values.
- Completed sets can be uncompleted if selected in error.
- Actual reps, seconds, weight, or band colours can be edited when performance differs.
- The active workout view emphasises only the current exercise and advances when all sets for that exercise are complete.
- The current exercise can be manually changed from the exercise progress strip; when a manually selected exercise is completed, the app returns to the earliest incomplete exercise.
- After a set is completed, the app starts a rest timer if another set remains.
- Rest duration is fixed in v1: 3 minutes after sets in the first exercise, 2 minutes after all later exercise sets.
- No timer starts after the final set.
- The timer screen shows countdown, next exercise/set, and a skip control.
- When the timer ends, the app plays a short alarm sound, shows a visual completion state, and uses vibration where supported.
- Active workout progress and rest state are cached locally so workouts survive refreshes and offline use.

Progress:

- Exercise history over time.
- PBs for highest weight, highest reps at a weight, longest hold, and best band/reps result.
- Volume trends for weighted exercises.
- Simple plateau detection after 3 completed appearances without improvement.
- Future workout targets remain manual in v1.

## Production Phases

1. Project scaffold and foundation: React/Vite/TypeScript PWA, routing, app shell, local storage, service worker, and baseline test tooling.
2. Plan builder: Monday-Saturday template management, day editor, exercise/set targets, set removal, measurement mode selection, and custom band colour management.
3. Workout execution: mobile-first active workout, one-tap set completion, quick edits, session completion/history, rest timers, alarm sound, and local persistence.
4. Analytics and export: per-day exercise progress, PB summaries, plateau indicators, weight-over-time charts, deletable session history, JSON backup, and CSV workout export.
5. Hardening: empty/loading/error states, accessibility pass, responsive testing, offline edge cases, deployment documentation, and PWA sound verification.
6. Future sync option: if cross-device continuity becomes important, add a private backend or managed sync layer with a deliberately scoped authentication model.

## Test Plan

- Unit tests for set-mode validation, rest-duration calculation, PB calculation, plateau detection, and export formatting.
- Integration tests for template-to-session snapshot creation, one-tap completion, rest timer start/skip/finish, and offline persistence.
- Mobile viewport tests for plan editing, active workout logging, rest timer display, dark mode, and progress drilldowns.
- Desktop viewport tests for per-day progress, session deletion controls, analytics, and export.
- Manual PWA checks on Android: installability, launch icon, offline active-workout logging, rest alarm sound after prior user interaction, and session persistence after refresh.

## Assumptions

- The app is for one user and does not need accounts, roles, sharing, or authorisation.
- Data lives locally in the browser unless a future sync phase is intentionally added.
- Weight means exercise load in kilograms, not body weight.
- Bodyweight-rep exercises are out of scope unless added as a later mode.
- Browser/PWA audio restrictions mean alarm audio must be initialised during the user-driven workout flow and backed by visual feedback.
- Reminders, notifications, coaching, shared plans, automatic progression, and body-weight tracking are later-phase features.
