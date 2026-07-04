#!/usr/bin/env node

const remoteDefault = "https://expert-call.api.external.emazna.com";
const localDefault = "http://127.0.0.1:8765";
const defaultTimeoutMs = Number(process.env.EXPERT_CALL_TIMEOUT_MS || 30000);

function usage() {
  return [
    "Usage:",
    "  node scripts/query-registry.mjs health [--server=<url>] [--api-key=<key>]",
    "  node scripts/query-registry.mjs search <query> [--limit=8] [--debug] [--server=<url>] [--api-key=<key>]",
    "  node scripts/query-registry.mjs expert <expert-id> [--server=<url>] [--api-key=<key>]",
    "  node scripts/query-registry.mjs import-plan <expert-id> [--server=<url>] [--api-key=<key>]",
    "",
    "Environment:",
    "  EXPERT_CALL_API_URL or EXPERT_CALL_URL selects the registry endpoint.",
    "  EXPERT_CALL_API_KEY is sent as Authorization: Bearer <key>.",
    "  EXPERT_CALL_TIMEOUT_MS sets the per-request timeout in milliseconds. Default: 30000.",
    "  If no endpoint is set, an API key implies the remote default; otherwise local health is tried before remote."
  ].join("\n");
}

function fail(message, details = {}) {
  console.error(JSON.stringify({ ok: false, error: message, ...details }, null, 2));
  process.exit(1);
}

function parseArgs(argv) {
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(usage());
    process.exit(0);
  }

  const parsed = {
    command: argv[0],
    value: null,
    limit: 8,
    debug: false,
    serverUrl: null,
    apiKey: process.env.EXPERT_CALL_API_KEY || "",
    timeoutMs: defaultTimeoutMs
  };

  for (const arg of argv.slice(1)) {
    if (arg === "--debug") {
      parsed.debug = true;
    } else if (arg.startsWith("--limit=")) {
      parsed.limit = Number(arg.slice("--limit=".length));
    } else if (arg.startsWith("--server=")) {
      parsed.serverUrl = arg.slice("--server=".length);
    } else if (arg.startsWith("--api-key=")) {
      parsed.apiKey = arg.slice("--api-key=".length);
    } else if (arg.startsWith("--timeout-ms=")) {
      parsed.timeoutMs = Number(arg.slice("--timeout-ms=".length));
    } else if (!parsed.value) {
      parsed.value = arg;
    } else {
      parsed.value += ` ${arg}`;
    }
  }

  if (!["health", "search", "expert", "import-plan"].includes(parsed.command)) {
    fail(`Unknown command: ${parsed.command || "(missing)"}\n\n${usage()}`);
  }
  if (parsed.command !== "health" && !parsed.value) {
    fail(`Missing value for ${parsed.command}.\n\n${usage()}`);
  }
  if (!Number.isFinite(parsed.limit) || parsed.limit <= 0) parsed.limit = 8;
  if (!Number.isFinite(parsed.timeoutMs) || parsed.timeoutMs <= 0) parsed.timeoutMs = 30000;
  return parsed;
}

function authHeaders(apiKey) {
  return apiKey ? { authorization: `Bearer ${apiKey}` } : {};
}

async function requestJson(url, apiKey, options = {}) {
  const timeoutMs = options.timeoutMs || defaultTimeoutMs;
  const response = await fetch(url, {
    headers: authHeaders(apiKey),
    signal: options.signal || AbortSignal.timeout(timeoutMs)
  });
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = { raw: text };
  }
  if (!response.ok) {
    const hint =
      response.status === 401
        ? "Remote Expert Call API requires EXPERT_CALL_API_KEY. Configure it or use a local server."
        : undefined;
    const error = new Error(`GET ${url} failed with ${response.status}`);
    error.statusCode = response.status;
    error.payload = payload;
    error.hint = hint;
    throw error;
  }
  return payload;
}

async function isHealthy(url) {
  try {
    await requestJson(`${url.replace(/\/+$/, "")}/health`, "", {
      timeoutMs: 1000
    });
    return true;
  } catch {
    return false;
  }
}

async function resolveServerUrl(args) {
  const explicit = args.serverUrl || process.env.EXPERT_CALL_API_URL || process.env.EXPERT_CALL_URL;
  if (explicit) return explicit.replace(/\/+$/, "");
  if (args.apiKey) return remoteDefault;
  if (await isHealthy(localDefault)) return localDefault;
  return remoteDefault;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const serverUrl = await resolveServerUrl(args);
  let url;

  if (args.command === "health") {
    url = `${serverUrl}/health`;
  } else if (args.command === "search") {
    const params = new URLSearchParams({
      q: args.value,
      limit: String(args.limit)
    });
    if (args.debug) params.set("debug", "1");
    url = `${serverUrl}/search?${params.toString()}`;
  } else if (args.command === "expert") {
    url = `${serverUrl}/experts/${encodeURIComponent(args.value)}`;
  } else {
    url = `${serverUrl}/experts/${encodeURIComponent(args.value)}/import-plan`;
  }

  try {
    const payload = await requestJson(url, args.apiKey, { timeoutMs: args.timeoutMs });
    console.log(JSON.stringify({ ok: true, serverUrl, ...payload }, null, 2));
  } catch (error) {
    const isTimeout = error.name === "TimeoutError" || error.name === "AbortError";
    fail(isTimeout ? `Request timed out after ${args.timeoutMs}ms` : error.message, {
      serverUrl,
      statusCode: error.statusCode,
      hint: error.hint,
      payload: error.payload
    });
  }
}

main().catch((error) => fail(error.message));
