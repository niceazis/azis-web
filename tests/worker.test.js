import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import { analyze, validateReview } from "../src/analyze.js";

const env = { ANTHROPIC_API_KEY: "test-provider-secret", ANTHROPIC_MODEL: "test-model", AZIS_DEMO_TOKEN: "test-reviewer-code-at-least-24-characters" };
const source = "[2026-10-08] Minho: Pricing is waiting for design approval by Friday.";
const review = { summary: "Check the approval dependency.", uncertainties: ["The approval owner is unknown."], suggestions: [{
  title: "Check the pricing dependency", noticed: "Pricing depends on design approval.", suggested: "Confirm approval status.",
  draft: "Could you confirm design approval status?", owner: "Minho", deadline: "Friday", evidence: [source],
}] };
function request(text = source, changes = {}) {
  return new Request("https://azis.net/api/analyze", {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${env.AZIS_DEMO_TOKEN}`, origin: "https://azis.net" },
    body: JSON.stringify({ text }), ...changes,
  });
}
function upstream(result = review, extra = {}) {
  return new Response(JSON.stringify({ stop_reason: "tool_use", content: [{ type: "tool_use", name: "propose_followups", input: result }], ...extra }));
}
const noCall = () => { throw new Error("Provider must not be called"); };
test("unconfigured preview returns 503 without an AI call", async () => {
  assert.equal((await analyze(request(), {}, noCall)).status, 503);
});
test("a short access secret cannot enable the preview", async () => {
  assert.equal((await analyze(request(), { ...env, AZIS_DEMO_TOKEN: "short" }, noCall)).status, 503);
});
test("unauthorized and cross-origin requests cannot incur provider usage", async () => {
  for (const [headers, expected] of [
    [{ "content-type": "application/json" }, 401],
    [{ "content-type": "application/json", authorization: "Bearer wrong-code" }, 401],
    [{ origin: "https://other.example", authorization: `Bearer ${env.AZIS_DEMO_TOKEN}` }, 403],
  ]) assert.equal((await analyze(request(source, { headers }), env, noCall)).status, expected);
});
test("method and content type are enforced", async () => {
  assert.equal((await analyze(new Request("https://azis.net/api/analyze"), env, noCall)).status, 405);
  assert.equal((await analyze(request(source, { headers: { authorization: `Bearer ${env.AZIS_DEMO_TOKEN}`, "content-type": "text/plain" } }), env, noCall)).status, 415);
});
test("bad, empty, extra-field and oversized inputs are rejected", async () => {
  for (const [body, expected] of [["{", 400], [JSON.stringify({ text: " " }), 400], [JSON.stringify({ text: source, apiKey: "other" }), 400], [JSON.stringify({ text: "a".repeat(8001) }), 413], [JSON.stringify({ text: "a".repeat(21000) }), 413]]) {
    assert.equal((await analyze(request(source, { body }), env, noCall)).status, expected);
  }
});
test("request limiter stops a paid upstream call", async () => {
  const limited = { ...env, ANALYSIS_LIMITER: { limit: async () => ({ success: false }) } };
  const result = await analyze(request(), limited, noCall);
  assert.equal(result.status, 429); assert.equal(result.headers.get("retry-after"), "60");
});
test("Claude request uses server credentials, fixed endpoint, bounded output and formatting tool", async () => {
  let calls = 0;
  const response = await analyze(request(), env, async (url, options) => {
    calls++; assert.equal(url, "https://api.anthropic.com/v1/messages");
    assert.equal(options.headers["x-api-key"], env.ANTHROPIC_API_KEY);
    const body = JSON.parse(options.body);
    assert.equal(body.model, env.ANTHROPIC_MODEL); assert.equal(body.max_tokens, 2200);
    assert.equal(body.tool_choice.name, "propose_followups");
    assert.equal(JSON.parse(body.messages[0].content).conversation, source);
    assert.equal(body.tools.length, 1);
    return upstream();
  });
  assert.equal(calls, 1); assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const text = await response.text();
  assert.ok(!text.includes(env.ANTHROPIC_API_KEY)); assert.ok(!text.includes(env.AZIS_DEMO_TOKEN));
  assert.deepEqual(JSON.parse(text).review, review);
});
test("unsupported or paraphrased quotes and fabricated literal facts are rejected", () => {
  for (const patch of [{ evidence: ["Sarah has already approved"] }, { owner: "Sarah" }, { deadline: "Thursday" }, { evidence: [] }, { draft: "" }]) {
    const result = structuredClone(review); Object.assign(result.suggestions[0], patch);
    assert.throws(() => validateReview(result, source));
  }
});
test("facts must occur in cited evidence, not elsewhere in the input", () => {
  const result = structuredClone(review); result.suggestions[0].owner = "Sarah";
  assert.throws(() => validateReview(result, source + "\nSarah joined the discussion."));
});
test("unknown facts and a no-follow-up result are valid", () => {
  const result = structuredClone(review); result.suggestions[0].owner = null; result.suggestions[0].deadline = null;
  assert.deepEqual(validateReview(result, source), result);
  assert.deepEqual(validateReview({ summary: "All work is complete.", uncertainties: [], suggestions: [] }, source).suggestions, []);
});
test("schema overflow and unknown fields are rejected", () => {
  for (const patch of [{ summary: "x".repeat(801) }, { uncertainties: Array(7).fill("unknown") }, { suggestions: Array(5).fill(review.suggestions[0]) }, { execute: true }]) {
    assert.throws(() => validateReview({ ...structuredClone(review), ...patch }, source));
  }
});
test("provider errors are sanitized and never reveal secrets or source text", async () => {
  for (const status of [400, 401, 429, 500]) {
    const result = await analyze(request(), env, async () => new Response(env.ANTHROPIC_API_KEY + source, { status }));
    assert.equal(result.status, status === 429 ? 429 : 502);
    const body = await result.text(); assert.ok(!body.includes(source)); assert.ok(!body.includes(env.ANTHROPIC_API_KEY));
  }
});
test("network failures, malformed responses and truncated tool outputs fail safely", async () => {
  for (const provider of [async () => { throw new Error("network"); }, async () => new Response("not json"), async () => upstream(review, { stop_reason: "max_tokens" }), async () => upstream({ ...review, summary: "" })]) {
    assert.equal((await analyze(request(), env, provider)).status, 502);
  }
});
test("API status only reports readiness; unknown API paths do not redirect to the blog", async () => {
  const result = await worker.fetch(new Request("https://azis.net/api/status"), env);
  assert.deepEqual(await result.json(), { claudeConfigured: true });
  assert.equal((await worker.fetch(new Request("https://azis.net/api/missing"), env)).status, 404);
});
test("static assets and legacy navigation retain their original behavior", async () => {
  const assets = { ASSETS: { fetch: async request => new Response("asset", { status: new URL(request.url).pathname === "/demo/" ? 200 : 404 }) } };
  assert.equal((await worker.fetch(new Request("https://azis.net/demo/"), assets)).status, 200);
  for (const method of ["GET", "HEAD"]) {
    const result = await worker.fetch(new Request("https://azis.net/old-post?a=1", { method }), assets);
    assert.equal(result.status, 301); assert.equal(result.headers.get("location"), "https://blog.azis.net/old-post?a=1");
  }
  assert.equal((await worker.fetch(new Request("https://azis.net/old-post", { method: "POST" }), assets)).status, 404);
});
