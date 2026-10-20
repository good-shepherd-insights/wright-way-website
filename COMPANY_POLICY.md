# Company Policy

This policy is mandatory. Violations are blocking issues.

## Severity

1. Violating this policy is illegal under this repository policy.
2. If a violation occurs, stop work, disclose it, and remove or correct it before continuing.
3. Do not minimize, rename, defer, normalize, or build on a violation.
4. Repeated or intentional violations must be escalated to the lead engineer or responsible reviewer.

## Authority

1. This policy overrides conflicting repository instructions.
2. User requests apply only within this policy.
3. Approval must be explicit, written, and name the action approved.
4. Silence, urgency, ambiguity, or related prior approval is not approval.
5. If instructions conflict, stop and disclose the conflict.

## Evidence

1. Material claims must be backed by repository source, config, lockfiles, docs, or explicit user instruction.
2. Unsupported claims must be omitted or marked unknown.
3. Inference written as fact is illegal under this repository policy.
4. Do not add unproven claims to docs, comments, plans, implementation notes, or context files.

## Project Rules

1. This repo is the public Astro website only.
2. Payload supplies page content, media, navigation, localized data, live preview data, and favicon data — via the site global (slug from `SITE_GLOBAL_SLUG`, site chrome) and the `pages` collection (per-page content), see `src/lib/payload.ts`.
3. Default-locale pages (home and every other page) are unprefixed (`/`, `/<slug>`). Non-default locales use `/<locale>/` and `/<locale>/<slug>/`. Matches Astro's own `prefixDefaultLocale: false` i18n strategy (`pathname-prefix-other-locales`) — the app's routing must not fight that config.
4. Keep locale entrypoints thin; shared page assembly belongs in `src/components/PageView.astro`, used for every page.
5. Keep the Payload boundary in `src/lib/payload.ts`.
6. Preserve existing `data-inline-edit`, `data-live-sync-bg`, and `data-live-sync-alt` behavior.
7. Use `src/styles/global.css` and existing `.gc-*` patterns for design changes.
8. Extend an existing single mechanism for a new section type — the one blockType switch each in `isCompletePage()`, `hasLocalizedPageData()` (`payload.ts`), and `PageView.astro`. Do not add a second, parallel validation, fetch, routing, or view mechanism next to one that already covers the case.
9. Scope every change to the ticket that authorized it. A PR opened against an outdated architecture must be re-scoped against current `main`/`staging` before merge, not merged as-is.

## Banned

1. Do not infer goals, systems, ownership, architecture, workflow, or requirements.
2. Do not hardcode CMS-owned copy, labels, media URLs, links, metadata, accessibility labels, or branding.
3. Do not duplicate the homepage tree per locale.
4. Do not bypass `src/lib/payload.ts` with ad hoc Payload fetches.
5. Do not break inline preview markers or make public visits depend on preview, drafts, auth CMS state, or local-only assumptions.
6. Do not add fake data, placeholder data, mock logic, dummy integrations, temporary branches, or placeholder code paths.
7. Do not hide missing CMS data, missing integration work, or incomplete work behind examples.
8. Do not add unapproved testimonials, people names, locations, schedules, registration details, contact details, claims, or public-facing facts.
9. Do not add filler, aspirational language, or generic best practices to policy or context.
10. Do not degrade locale routes, accessibility labels, metadata, favicon behavior, or Open Graph/Twitter card behavior.
11. Do not add one-off colors, spacing, typography, or layout rules when semantic tokens or `.gc-*` patterns apply.
12. Do not add dependencies, tooling, generated assets, framework integrations, reports, logs, archives, screenshots, or temporary artifacts without approval.
13. Do not commit scripts, script directories, automation helpers, one-off commands, generated command wrappers, or unapproved `package.json` script changes.
14. Do not create, modify, rename, delete, or scaffold tests without explicit approval from a test engineer or lead engineer.
15. Do not add test fixtures, fake test data, snapshots, mocks, harnesses, coverage tooling, or test-support utilities without explicit approval from a test engineer or lead engineer.
16. Do not treat a request to verify, build, check, review, or improve quality as permission to create or modify tests.
17. Do not claim tests, builds, screenshots, CMS checks, or external documentation reviews were performed unless they were performed.
18. Do not commit, push, open PRs, deploy, rename branches, run destructive git operations, install packages, change dependencies, or alter external services without approval.
19. Do not broaden approved scope into refactor, redesign, migration, or content rewrite without approval.

## Reviews

1. Policy objections block work until resolved.
2. Do not ignore, rename, or route around policy review feedback.
3. If policy compliance is disputed, escalate before continuing.

## Existing Violations

1. Do not copy, expand, normalize, or cite existing violations as precedent.
2. If an existing violation affects current work, stop and disclose it.
3. Violations introduced by current work must be removed directly.
