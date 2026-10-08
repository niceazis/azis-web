import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { randomBytes } from "node:crypto";
import { analyze, validateReview } from "../src/analyze.js";

export async function evaluateCases(cases, runCase, { model, now = () => new Date(), clock = () => performance.now() } = {}) {
  const startedAt = now().toISOString();
  const records = [];
  for (const item of cases) {
    const start = clock();
    try {
      const response = await runCase(item.text);
      const body = await response.json();
      if (!response.ok) {
        records.push({ id: item.id, label: item.label, expectations: item.expectations, status: "error", httpStatus: response.status,
          error: body.error ?? "Analysis unavailable.", elapsedMs: Math.round(clock() - start), humanVerdict: "not_reviewed" });
        continue;
      }
      if (body.mode !== "claude") throw new Error("Not a Claude response");
      validateReview(body.review, item.text);
      records.push({ id: item.id, label: item.label, source: item.text, expectations: item.expectations, status: "recorded",
        model: body.model, elapsedMs: Math.round(clock() - start), review: body.review, humanVerdict: "not_reviewed" });
    } catch {
      // Never serialize raw exceptions, headers, credentials or upstream bodies.
      records.push({ id: item.id, label: item.label, expectations: item.expectations, status: "error",
        error: "Request failed or response did not satisfy evidence checks.", elapsedMs: Math.round(clock() - start), humanVerdict: "not_reviewed" });
    }
  }
  return { schemaVersion: 1, status: "live_run_recorded_pending_human_review", startedAt, completedAt: now().toISOString(), model,
    fictionalInputs: true, totalCases: records.length, recordedResponses: records.filter(r => r.status === "recorded").length,
    failedRequests: records.filter(r => r.status === "error").length, humanReviewedCases: 0, records,
    limitations: "Recorded responses are not pass results. Literal evidence checks do not establish semantic accuracy. Human review and customer validation remain required." };
}
export function markdownReport(report) {
  const lines = ["# AZIS live Claude evaluation", "", `Run: ${report.startedAt}`, `Configured model: ${report.model}`, "",
    `Cases: ${report.totalCases}; recorded responses: ${report.recordedResponses}; failed requests: ${report.failedRequests}.`, "",
    "All inputs are fictional. **Human evaluation is pending; no pass rate is claimed.**", "", report.limitations, ""];
  for (const record of report.records) {
    lines.push(`## ${record.id}: ${record.label}`, "", `Request status: ${record.status}; human verdict: ${record.humanVerdict}; elapsed: ${record.elapsedMs} ms.`, "",
      "Expected behavior:", ...record.expectations.map(x => "- " + x), "");
    if (record.status === "error") lines.push(`Error: ${record.error}`, "");
    else lines.push("Actual recorded output:", "", "```json", JSON.stringify(record.review, null, 2), "```", "");
  }
  return lines.join("\n");
}
export async function main(args = process.argv.slice(2), env = process.env) {
  const hostedIndex = args.indexOf("--base-url");
  const hosted = hostedIndex >= 0 ? args[hostedIndex + 1] : null;
  const outIndex = args.indexOf("--output");
  const output = outIndex >= 0 ? args[outIndex + 1] : "public/evidence/results.json";
  if (!output || (hostedIndex >= 0 && !hosted)) throw new Error("Provide a value for --output or --base-url.");
  if (hosted) {
    const url = new URL(hosted);
    if (url.origin !== "https://azis.net") throw new Error("Hosted evaluation only supports https://azis.net.");
    if (!env.AZIS_DEMO_TOKEN || env.AZIS_DEMO_TOKEN.length < 24) throw new Error("AZIS_DEMO_TOKEN is required for hosted evaluation. No requests made.");
    const status = await fetch(new URL("/api/status", url), { signal: AbortSignal.timeout(10000) });
    if (!status.ok || !(await status.json()).claudeConfigured) throw new Error("The deployed Claude preview is not activated. No analysis requests made.");
  } else if (!env.ANTHROPIC_API_KEY || !env.ANTHROPIC_MODEL) {
    throw new Error("ANTHROPIC_API_KEY and ANTHROPIC_MODEL are required for a real Claude evaluation. No report generated.");
  }
  const cases = JSON.parse(await readFile(new URL("../public/demo/cases.json", import.meta.url), "utf8"));
  const localEnv = { ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY, ANTHROPIC_MODEL: env.ANTHROPIC_MODEL, AZIS_DEMO_TOKEN: randomBytes(32).toString("hex") };
  let calls = 0;
  const runCase = async text => {
    if (hosted) {
      // Deployed preview is limited to approximately 5 requests/minute per location.
      if (calls++) await new Promise(resolve => setTimeout(resolve, 13000));
      return fetch(new URL("/api/analyze", hosted), { method: "POST", signal: AbortSignal.timeout(35000),
        headers: { "content-type": "application/json", authorization: `Bearer ${env.AZIS_DEMO_TOKEN}` }, body: JSON.stringify({ text }) });
    }
    return analyze(new Request("https://azis.net/api/analyze", { method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${localEnv.AZIS_DEMO_TOKEN}` }, body: JSON.stringify({ text }) }), localEnv);
  };
  const report = await evaluateCases(cases, runCase, { model: hosted ? "See each recorded response" : env.ANTHROPIC_MODEL });
  await mkdir(dirname(resolve(output)), { recursive: true });
  await writeFile(output, JSON.stringify(report, null, 2) + "\n");
  await writeFile(output.replace(/\.json$/, "") + ".md", markdownReport(report));
  process.stdout.write(`Recorded ${report.recordedResponses}/${report.totalCases} responses; ${report.failedRequests} errors. Human evaluation is pending.\n`);
  return report;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { process.stderr.write(error.message + "\n"); process.exitCode = 1; });
}
