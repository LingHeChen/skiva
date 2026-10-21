# Agent integration

The client provides a filesystem. An Agent can maintain its own discovery index or loaded prompt text, so a successful FUSE refresh does not prove that a running Agent has refreshed its internal state.

## Project adapters

| Agent | Project search root | Adapter |
|---|---|---|
| Codex CLI | `.agents/skills/<skill>/SKILL.md` | `--agent codex` |
| Claude Code | `.claude/skills/<skill>/SKILL.md` | `--agent claude` |
| OpenCode | `.opencode/skills/<skill>/SKILL.md` | `--agent opencode` |

```bash
python3 scripts/agent-link.py \
  --source-mount-path /srv/agent-skills \
  --project /workspace/project \
  --agent codex
python3 scripts/agent-link.py --source-mount-path /srv/agent-skills --project /workspace/project --agent codex --check
```

The adapter refuses to overwrite existing paths, does not modify global user configuration, and checks directory/file readability. In a Linux deployment that disallows symlinks, mount FUSE directly at the Agent's configured search root, or use an operator-managed read-only bind mount. Do not give application containers broad privileges by default.

## Required runtime acceptance

For each exact Agent version and sandbox policy, record:

1. Launch with a dedicated test project and verified mount. Confirm both expected Skill names appear in discovery.
2. Invoke a benign Skill; verify its SKILL.md and referenced guide can be read through the sandbox.
3. Publish a changed canary snapshot. Verify new filesystem opens change; determine whether the Agent needs a new task/session or restart to reload its index.
4. Start a task with a pinned mount, publish another snapshot, and verify all task reads remain on the pinned snapshot.
5. Revoke its client. Check online reads fail and offline behavior matches the selected policy.
6. Repeat with any symlink/bind-mount deployment path and record differences.

Executed runtime discovery checks (no model invocation):

- Codex CLI 0.163.0: `app-server skills/list` found the project symlink Skill; `forceReload` picked up changed metadata.
- Claude Code 2.1.236: stream initialization returned the project Skill in command metadata.
- OpenCode 1.19.3: `debug skill --pure` found the project symlink Skill. A project-local binary was used because the pre-existing 1.1.20 executable did not run successfully; global installation was not changed.

Repeatable checks: `scripts/check-codex-discovery.py`, `check-claude-discovery.py`, `check-opencode-discovery.py` (set `SKIVA_OPENCODE_BIN` for another local binary). Logs are under `test-results/agent-adapters/`.

These discovery checks ran on the macOS host, separately from real Linux FUSE tests. They do not certify combined Linux Agent sandbox access, model invocation, or in-memory context refresh during an existing task. Complete the deployment-specific acceptance above before rollout.

## Sources and compatibility tracking

Check the official docs for the deployed version:
- [Codex Skills](https://developers.openai.com/codex/skills/)
- [Claude Code Skills](https://code.claude.com/docs/en/skills)
- [OpenCode Skills](https://opencode.ai/docs/skills/)

These references identify configuration conventions, not runtime acceptance evidence. Symlink behavior has varied by Agent version; direct mounts are preferable when available. Never promise an in-memory Agent index will refresh merely because dynamic FUSE opens see a new snapshot.
