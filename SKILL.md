---
name: expert-call
description: Search the remote Expert Call registry for task-specific experts/skills and decide whether to apply one. Use when a task may benefit from specialized workflows, domain experts, file-format specialists, research/database skills, creative production skills, legal/finance/accounting helpers, sales/marketing helpers, or any situation where Codex should discover and optionally clone a relevant expert before proceeding. Uses https://expert-call.api.external.emazna.com.
---

# Expert Call

## Overview

Expert Call lets an agent ask a registry which specialist should help with the current task. Treat registry results as recommendations, not automatic authority.

Default remote API: `https://expert-call.api.external.emazna.com`

Use the remote API by default. Hosted search currently does not require an API key. If `EXPERT_CALL_API_URL` or `EXPERT_CALL_URL` is set, use that endpoint. If a future/private endpoint requires authentication, send `EXPERT_CALL_API_KEY` as a bearer token.

Do not silently fall back to a local registry. Most users will not have a local Expert Call API running, and a local fallback can make a failed remote search look successful. Use a local registry only when the user or environment explicitly sets `EXPERT_CALL_API_URL`, `EXPERT_CALL_URL`, or `--server` to that local URL.

Search can combine BM25 keyword ranking, Capability Graph, Query Understanding, and lightweight embeddings. Hosted deployments may disable embeddings for latency; the registry still returns TopK candidates for the calling LLM to inspect and choose what, if anything, to apply.

## Setup For Distributed Use

Set these environment variables when using the hosted registry:

- `EXPERT_CALL_API_URL=https://expert-call.api.external.emazna.com`
- `EXPERT_CALL_API_KEY=<provided key>` is optional and only needed when the selected endpoint requires authentication.
- `EXPERT_CALL_TIMEOUT_MS=30000` may be adjusted when a slow registry needs more time.

If the remote API returns `401`, ask the user to provide/configure an API key for that endpoint. Do not silently pretend a search was performed.

## Workflow

1. Infer whether the user's task would benefit from a specialist even if the user did not ask for one. For example, "明日の研究の着手発表で使うスライドを作りたい" should trigger a search for slide and research-presentation experts.
2. From this skill directory, run `node scripts/query-registry.mjs health`. If the registry is unavailable, tell the user briefly and continue with built-in skills or general reasoning.
3. Search with `node scripts/query-registry.mjs search "<task summary>" --limit=8`. Use direct HTTP only if the script is unavailable.
4. If the task has multiple dimensions, keep the natural user wording in `query`; do not reduce it to one keyword. Useful dimensions include artifact type, domain, deadline, risk, and output format.
5. Inspect the top candidates. Prefer candidates with clear match reasons, known source/license, and an index-approved body/import policy.
6. For local or metadata-only candidates, apply the best candidate when it clearly fits.
7. When a broad local expert and a concrete external GitHub skill both match, use the local expert as routing context and the external skill for detailed procedure if it would improve the task.
8. For an external GitHub candidate whose detailed procedure, references, scripts, or assets would improve the task, run `node scripts/query-registry.mjs import-plan <expert-id>`.
9. If `importPlan.canUseAsTemporaryContext` and `importPlan.localClone.canLocalClone` are true, run `node scripts/clone-expert.mjs <expert-id>` from this skill directory. The script uses the same `EXPERT_CALL_API_URL` and optional `EXPERT_CALL_API_KEY` environment variables. Read the cloned `SKILL.md` and only the task-relevant files it directly references. Treat the clone under `experts/` as a private local cache, not central registry content.
10. After selecting and loading an external skill, operationalize it: turn the task-relevant instructions into a compact execution checklist or plan, then use that checklist while doing the task. Do not merely mention that the skill exists. Skip items only when they are irrelevant, unsafe, unavailable in the current environment, or outside the user's requested scope.
11. Do not add hard-coded instructions for specific external skills into this Expert Call skill. Specific review checklists, file-format workflows, tool commands, or domain practices belong in the selected external skill and its referenced files.
12. Ask the user before using source-available/unknown/proprietary skill bodies, running cloned scripts, accessing secrets, making external writes, touching production systems, or installing a cloned expert as a persistent skill. Reading an index-approved MIT/Apache-style skill as temporary context does not need separate user approval.
13. After use, optionally record an event with `POST /events` including `expertId`, `type`, `outcome`, and a short task note.

## Query Examples

Cross-platform script:

```bash
node scripts/query-registry.mjs health
node scripts/query-registry.mjs search "明日の研究の着手発表で使うスライドを作りたい" --limit=5
node scripts/query-registry.mjs import-plan anthropic-webapp-testing
node scripts/clone-expert.mjs anthropic-webapp-testing
```

Direct curl:

```bash
curl "https://expert-call.api.external.emazna.com/search?q=contract%20review&limit=3"
```

Structured search:

```json
{
  "query": "明日の研究の着手発表で使うスライドを作りたい",
  "limit": 5,
  "maxRisk": "medium"
}
```

## Result Handling

Use returned fields this way:

- `expert.name` and `expert.summary`: explain what kind of specialist is being called.
- `ranking.matchReasons`: justify why the candidate fits.
- `ranking.bm25Score`: keyword relevance, useful for rare explicit terms such as `着手発表`, `PPTX`, or `NDA`.
- `ranking.graphScore`: action/artifact/domain fit, useful for understanding that `作る + スライド + 研究` maps to a research-presentation expert.
- `ranking.queryCapabilityNodes` and `ranking.expertCapabilityNodes`: compact graph nodes inferred from the request and expert metadata.
- `riskLevel`: decide whether user approval is needed.
- `source.license` and `bodyPolicy`: decide whether full skill text may be fetched or stored.
- `importPlan.canUseAsTemporaryContext`: true means the registry already approved reading the external body as temporary task context.
- `importPlan.localClone`: clone URL, ref, skill path, and cache subdirectory for external skills with references/assets.
- `typicalTasks`, `inputs`, `outputs`: shape the execution plan.

Only request `debug=1` when diagnosing ranking behavior. Normal search results should stay compact so the agent sees only the top candidates and short ranking evidence.

## Copyright And License Guardrails

Do not copy third-party skill bodies into the central registry unless a permissive license, explicit permission, or user-owned source allows it. Prefer indexing metadata: name, source URL, license, hash, summary, capabilities, inputs, outputs, risks, and short non-substitutive excerpts.

For runtime use, distinguish reading from redistributing. If the registry import plan says an external GitHub skill is open-source and `canUseAsTemporaryContext` is true, clone it into `experts/` when the body, references, scripts, or assets are useful. Do not run cloned scripts unless the task specifically requires it and normal safety checks pass.

For public registries, avoid redistributing full `SKILL.md` bodies by default. For private local caches, store full bodies only when the index-time license policy allows that use. Unknown, source-available, or repository-terms skills remain metadata-only unless the user explicitly approves a permitted source.
