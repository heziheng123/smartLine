# E2E baseline diagnostic

## Scope

Read-only evidence for the CI gate that is blocking the dependency-audit PR. This change adds no application, schema, sync, or test behavior.

## Evidence

- The dependency PR changes only `package-lock.json`; its lockfile resolves `browserslist` to `4.28.8`.
- `npm.cmd audit --audit-level=moderate --package-lock-only` reports `0 vulnerabilities` for that lockfile.
- The GitHub CI retry passed install, audit, type/security/domain checks, lint, and build. It failed only at `npm.cmd run test:e2e`.
- CI reported `308 passed`, `122 skipped`, and `22 failed`. A full local `npm.cmd run test:e2e` also failed, with 29 failing E2E result folders.

## Failure clusters

The failures span existing UI suites rather than the lockfile change:

- app shell and knowledge graph layout assertions;
- mind-map timeline, release, and tools workflows across desktop and small-screen projects;
- workspace-audit and multi-device-sync UI workflows.

The CI logs include click timeouts, layout-size assertions, and a sync-payload assertion. A retry failed again, so this is not a transient runner failure.

## Gate

Do not merge the dependency PR while this CI check is red. Do not skip the E2E suite, loosen all timeouts, delete history, or change schema/account binding to make the check pass.

The next code phase must isolate one failure cluster at a time, add or keep a focused reproducer, and land as its own reversible PR.
