# Agent user assignments

## Active agents

| Agent | File | Runtime | Role | Status |
|-------|------|---------|------|--------|
| `ceo` | `.github/agents/ceo.agent.md` | GitHub Copilot CLI | Strategic orchestrator — directs jarvis6.0, manages org | **Active** |
| `jarvis6.0` | `.github/agents/jarvis6.0.agent.md` | GitHub Copilot CLI | VP Engineering — executor, dispatcher, primary implementor | **Active** |
| `jarvis6.0_vscode` | `.github/agents/jarvis6.0_vscode.agent.md` | VSCode Copilot | VP Engineering (local dev) — LSP/delve/gopls; IDE-native | **Active** |
| `reviewer` | `.github/agents/reviewer.agent.md` | PR review gatekeeper | QA gate — security, correctness, merge block authority | **Active** |
| `jarvis5.0` | `.github/agents/jarvis5.0.agent.md` | GitHub Copilot CLI | VP Engineering — superseded by jarvis6.0 | Deprecated |
| `jarvis5.0_vscode` | `.github/agents/jarvis5.0_vscode.agent.md` | VSCode Copilot | VP Engineering (local dev) — superseded by jarvis6.0_vscode | Deprecated |
| `jarvis4.0` | `.github/agents/jarvis4.0.agent.md` | GitHub Copilot CLI | — | Deprecated |
| `jarvis4.0_vscode` | `.github/agents/jarvis4.0_vscode.agent.md` | VSCode Copilot | — | Deprecated |

## GitHub identities

- **Repo owner**: `vNodesV` (user account, not org)
- **Approval authority**: `@vNodesV` (only user who can `/approve` PRs)
- **Bot**: `github-actions[bot]` (submits approved reviews via approval-gate workflow)

## Approval enforcement

- PR approval is enforced via `.github/workflows/approval-gate.yml`
- Triggered by `/approve` comment from `@vNodesV`
- Validates all CI/CodeQL/Dependency Review checks pass before approving
- Copilot delegation: `github-actions[bot]` can submit approval on behalf of `@vNodesV`
- No PAT or external secrets required — uses `GITHUB_TOKEN`

## Platform constraints

- Repo is a **user** account (`vNodesV`), not an organization — no team-based reviewer routing
- Agent logical IDs (e.g., `jarvis5.0`) are not GitHub usernames — they're local agent identifiers