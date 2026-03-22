# Acceptance Criteria

Replace or refine these criteria so the planner has an explicit finish line.

- [ ] Frontend loads from the deployed host and serves the SPA without 5xx errors.
- [ ] Backend `/ready` reports `status: ok`, `db: ok`, and the deployed git SHA.
- [ ] Session status, login flow, and at least one authenticated demo workflow work after deploy.
- [ ] A core portfolio or automation data path returns valid data without fatal regressions.
- [ ] Deployments use immutable image tags and can be rolled back to the last known-good version.
