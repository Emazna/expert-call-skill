#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const scriptDir = path.dirname(scriptPath);
const skillRoot = path.resolve(scriptDir, "..");
const expertsDir = path.join(skillRoot, "experts");
const defaultServerUrl =
  process.env.EXPERT_CALL_API_URL ||
  process.env.EXPERT_CALL_URL ||
  "https://expert-call.api.external.emazna.com";
const defaultTimeoutMs = Number(process.env.EXPERT_CALL_TIMEOUT_MS || 30000);

function usage() {
  return [
    "Usage: node scripts/clone-expert.mjs <expert-id> [--server=<url>] [--api-key=<key>] [--refresh]",
    "",
    "Clones an index-approved open-source external expert into this skill's experts/ cache.",
    "The script only clones and locates files; it does not run cloned scripts.",
    "",
    "Environment:",
    "  EXPERT_CALL_API_URL or EXPERT_CALL_URL selects the registry endpoint.",
    "  EXPERT_CALL_API_KEY is optional and sent as Authorization: Bearer <key> when set.",
    "  EXPERT_CALL_TIMEOUT_MS sets the import-plan request timeout in milliseconds. Default: 30000.",
    "  Local registries are used only when explicitly selected with --server or EXPERT_CALL_API_URL."
  ].join("\n");
}

function parseArgs(argv) {
  const parsed = {
    expertId: null,
    serverUrl: defaultServerUrl,
    apiKey: process.env.EXPERT_CALL_API_KEY || "",
    refresh: false,
    timeoutMs: defaultTimeoutMs
  };

  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") {
      console.log(usage());
      process.exit(0);
    } else if (arg === "--refresh") {
      parsed.refresh = true;
    } else if (arg.startsWith("--server=")) {
      parsed.serverUrl = arg.slice("--server=".length);
    } else if (arg.startsWith("--api-key=")) {
      parsed.apiKey = arg.slice("--api-key=".length);
    } else if (arg.startsWith("--timeout-ms=")) {
      parsed.timeoutMs = Number(arg.slice("--timeout-ms=".length));
    } else if (!parsed.expertId) {
      parsed.expertId = arg;
    } else {
      fail(`Unexpected argument: ${arg}`);
    }
  }

  if (!parsed.expertId) fail("Missing expert id.\n\n" + usage());
  if (!Number.isFinite(parsed.timeoutMs) || parsed.timeoutMs <= 0) parsed.timeoutMs = 30000;
  return parsed;
}

function fail(message, details = {}) {
  console.error(JSON.stringify({ ok: false, error: message, ...details }, null, 2));
  process.exit(1);
}

function isInside(parent, child) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: "utf8",
    shell: false,
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit"
  });

  if (result.status !== 0) {
    const stderr = (result.stderr || "").trim();
    const stdout = (result.stdout || "").trim();
    throw new Error(`${command} ${args.join(" ")} failed${stderr ? `: ${stderr}` : stdout ? `: ${stdout}` : ""}`);
  }

  return (result.stdout || "").trim();
}

async function fetchJson(url, apiKey, timeoutMs) {
  const response = await fetch(url, {
    headers: apiKey ? { authorization: `Bearer ${apiKey}` } : {},
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!response.ok) {
    const hint =
      response.status === 401
        ? "This Expert Call endpoint requires EXPERT_CALL_API_KEY. Configure it before retrying."
        : "";
    throw new Error(`GET ${url} failed with ${response.status}${hint ? `. ${hint}` : ""}`);
  }
  return response.json();
}

async function removeSafe(target) {
  const resolvedTarget = path.resolve(target);
  const resolvedExpertsDir = path.resolve(expertsDir);
  if (!isInside(resolvedExpertsDir, resolvedTarget)) {
    throw new Error(`Refusing to remove path outside experts cache: ${resolvedTarget}`);
  }
  await rm(resolvedTarget, { recursive: true, force: true });
}

async function cloneRepository(plan, destination) {
  const { cloneUrl, ref } = plan.localClone;
  const baseArgs = ["clone", "--depth=1"];
  if (ref) baseArgs.push("--branch", ref);
  baseArgs.push(cloneUrl, destination);

  try {
    run("git", baseArgs);
  } catch (error) {
    await removeSafe(destination);
    if (!ref) throw error;
    run("git", ["clone", "--depth=1", cloneUrl, destination]);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const serverUrl = args.serverUrl.replace(/\/+$/, "");
  const importPlanUrl = `${serverUrl}/experts/${encodeURIComponent(args.expertId)}/import-plan`;
  let importPlanResponse;
  try {
    importPlanResponse = await fetchJson(importPlanUrl, args.apiKey, args.timeoutMs);
  } catch (error) {
    if (error.name === "TimeoutError" || error.name === "AbortError") {
      fail(`Import plan request timed out after ${args.timeoutMs}ms`, { importPlanUrl });
    }
    throw error;
  }
  const { importPlan } = importPlanResponse;

  if (!importPlan?.localClone?.canLocalClone) {
    fail("This expert is not approved for local clone by the registry import plan.", {
      expertId: args.expertId,
      importPlan
    });
  }

  const cloneSubdir = importPlan.localClone.cacheSubdir;
  const destination = path.resolve(expertsDir, cloneSubdir);
  const resolvedExpertsDir = path.resolve(expertsDir);
  if (!isInside(resolvedExpertsDir, destination)) {
    fail("Computed clone destination escapes the experts cache.", { destination });
  }

  await mkdir(expertsDir, { recursive: true });

  if (existsSync(destination)) {
    if (!existsSync(path.join(destination, ".git"))) {
      fail("Clone destination exists but is not a git repository.", { destination });
    }
    if (args.refresh) {
      run("git", ["-C", destination, "fetch", "--depth=1", "origin", importPlan.localClone.ref]);
      run("git", ["-C", destination, "checkout", "--detach", "FETCH_HEAD"]);
    }
  } else {
    await cloneRepository(importPlan, destination);
  }

  const skillFile = importPlan.localClone.skillFile
    ? path.join(destination, importPlan.localClone.skillFile)
    : null;
  const skillDir = skillFile
    ? path.dirname(skillFile)
    : importPlan.localClone.skillPath
      ? path.join(destination, importPlan.localClone.skillPath)
      : destination;
  const skillMd = skillFile || path.join(skillDir, "SKILL.md");
  if (!existsSync(skillMd)) {
    fail("Clone succeeded, but the expected skill file was not found.", {
      destination,
      skillDir,
      skillMd
    });
  }

  const commit = run("git", ["-C", destination, "rev-parse", "HEAD"], { capture: true });
  console.log(JSON.stringify({
    ok: true,
    expertId: importPlan.expertId,
    name: importPlan.name,
    license: importPlan.source?.license || "unknown",
    repository: importPlan.source?.repository || null,
    sourceUrl: importPlan.source?.sourceUrl || null,
    cacheDir: destination,
    skillDir,
    skillMd,
    packageRoot: importPlan.localClone.packageRoot
      ? path.join(destination, importPlan.localClone.packageRoot)
      : skillDir,
    packageFiles: importPlan.localClone.packageFiles || null,
    commit,
    note: "Read SKILL.md and task-relevant referenced files. Do not run cloned scripts without a separate safety check."
  }, null, 2));
}

main().catch((error) => fail(error.message));
