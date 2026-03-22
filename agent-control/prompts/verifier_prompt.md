Optional verifier prompt template.

Use this only if you later decide to add an LLM-assisted verifier on top of the deterministic HTTP and browser smoke checks.

Inputs to inspect:
- `{acceptance_criteria_path}`
- `{current_state_path}`
- `{verification_report_path}`
- browser screenshots, console logs, or HTTP artifacts captured during verification

Required report schema:
{
  "status": "pass|partial_pass|fail",
  "version": "git-sha",
  "passed": [],
  "failed": [],
  "regressions": [],
  "notes": [],
  "recommended_action": "continue|fix|rollback"
}
