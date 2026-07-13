# QA Test Plans

Test plans and acceptance criteria produced by the `quality-agent` subagent live here, one file per feature: `YYYY-MM-DD-<feature-slug>-test-plan.md`, mirroring the `docs/superpowers/plans` / `docs/superpowers/specs` naming convention already used in this repo.

Each file should cover: user flows (happy path + edge cases), acceptance criteria in testable form, and the test plan (which cases map to which acceptance criteria, and at what level — unit/integration/e2e). The developer subagent implements against these via TDD; it does not author them.
