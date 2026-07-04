# Expert Call Skill

This repository contains only the distributable Expert Call skill for AI agents.

Expert Call lets an agent search the hosted Expert Call registry and choose a task-specific expert or skill when the user's request would benefit from specialized practice.

## Install

Copy this repository into your agent's local skills directory, or ask the agent to install it from:

```text
https://github.com/Emazna/expert-call-skill
```

Configure the hosted registry:

```powershell
$env:EXPERT_CALL_API_URL="https://expert-call.api.external.emazna.com"
$env:EXPERT_CALL_API_KEY="<provided key>"
```

## Smoke Test

From this repository:

```powershell
node scripts\query-registry.mjs health
node scripts\query-registry.mjs search "明日の研究の着手発表で使うスライドを作りたい" --limit=3
```

## Notes

- This repository intentionally does not contain the Expert Call backend, database schema, crawler, deployment config, internal registry data, or API secrets.
- Hosted search requires an API key for endpoints other than `/health`.
- External skill bodies are imported on demand according to the registry import plan.

