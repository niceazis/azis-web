import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { evaluateCases, markdownReport, main } from "../scripts/evaluate.js";

const cases = JSON.parse(await readFile(new URL("../public/demo/cases.json", import.meta.url), "utf8"));
test("live runner fails without real credentials and creates no fabricated report", async () => {
  await assert.rejects(main([], {}), /real Claude evaluation/);
});
test("hosted runner rejects a non-AZIS destination before sending credentials", async () => {
  await assert.rejects(main(["--base-url", "https://untrusted.example"], { AZIS_DEMO_TOKEN: "fake-token-long-enough-for-a-test" }), /only supports/);
});
test("all ten fictional cases are uniquely identified and specify expected behavior", () => {
  assert.equal(cases.length, 10); assert.equal(new Set(cases.map(c => c.id)).size, 10);
  for (const item of cases) { assert.ok(item.text.includes("2026-10-08")); assert.ok(item.expectations.length > 0); }
});
test("successful responses are recorded as unreviewed, never automatically passed", async () => {
  const result = await evaluateCases(cases, async () => new Response(JSON.stringify({ mode: "claude", model: "test-model",
    review: { summary: "Review needed", uncertainties: [], suggestions: [] } })), { model: "test-model" });
  assert.equal(result.recordedResponses, 10); assert.equal(result.humanReviewedCases, 0);
  assert.ok(result.records.every(x => x.humanVerdict === "not_reviewed"));
  assert.ok(markdownReport(result).includes("no pass rate is claimed"));
});
test("errors stay in the report, unsupported quotes fail, and raw exceptions remain private", async () => {
  const result = await evaluateCases(cases.slice(0, 3), async text => {
    if (text === cases[0].text) return new Response(JSON.stringify({ error: "Temporarily unavailable" }), { status: 503 });
    if (text === cases[1].text) throw new Error("secret-token-do-not-publish");
    return new Response(JSON.stringify({ mode: "claude", model: "test-model", review: {
      summary: "Review", uncertainties: [], suggestions: [{ title: "Title", noticed: "Concern", suggested: "Action", draft: "Draft", owner: null, deadline: null, evidence: ["fabricated quote"] }],
    } }));
  }, { model: "test-model" });
  assert.equal(result.failedRequests, 3); assert.equal(result.recordedResponses, 0);
  assert.ok(!JSON.stringify(result).includes("secret-token"));
});
