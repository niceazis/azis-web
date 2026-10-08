# AZIS — Proactive Team Agent

AZIS is an early-stage software venture in Seoul, South Korea. The project started in August 2026; **business registration is planned**. This repository does not claim a registered legal entity, existing customers, or measured productivity gains.

- Website: https://azis.net
- Founder: MyoungGee Back
- Contact: azis@azis.net
- Source: https://github.com/niceazis/azis-web

## First customer and product hypothesis

Initial target: project managers and team leads at software teams of 5–30 people. The first use case is reviewing approval dependencies and missing handoffs before a software release.

The hypothesis is that a review containing a source quote, an uncertainty, a proposed next step, and an editable follow-up draft can reduce manual reconstruction of work context. Customer demand and time savings have not yet been measured.

## Current state

| Capability | State |
| --- | --- |
| Company and product site | Implemented |
| Public fictional scenarios and pattern matching | Implemented; browser simulation, no AI calls |
| Simulated approvals | Implemented; page state only |
| Claude Messages API analysis endpoint | Implemented in Worker source; requires secrets and deployment activation |
| Evidence validation, unknown owner/deadline, editable drafts | Implemented; quotes checked literally, interpretations need review |
| Accept/dismiss and copy draft | Implemented; never sends a message |
| Ten fictional evaluation cases | Included; expected behavior, not measured model performance |
| Live Claude evaluation | Pending; automated tests mock the provider |
| Customer pilot | Planned; no existing customer claim |
| Slack, Teams and email connections | Planned |
| Persistent monitoring, execution and audit history | Planned |
| Business registration in South Korea | Planned |

## Architecture

The existing Cloudflare Worker serves `public/` through the `ASSETS` binding and redirects legacy navigation URLs to `blog.azis.net`. API routes are handled before the legacy fallback.

- `GET /api/status`: configuration readiness only, never credentials.
- `POST /api/analyze`: access-controlled Claude analysis, input capped at 8,000 characters, output capped at 2,200 tokens, 25-second upstream timeout.
- Claude's `propose_followups` tool formats a result; it does not run an action.
- Each suggestion includes verbatim source evidence. A quote not found in the input rejects the entire result. Owner and deadline must be quoted literal facts, otherwise `null`.
- Literal checks cannot prove the model interpreted the context correctly. Every draft requires human review.
- No database or automatic sending integration is configured. AZIS application code does not log conversation text or credentials. Cloudflare and Anthropic logging/retention depend on account settings and their policies.

## Run and test

Node.js 22 or newer is required. The application and unit tests have no npm runtime dependencies.

```sh
npm test
npm run dev
```

`npm run dev` uses Wrangler via `npx`; the rate-limit binding requires Wrangler 4.36.0 or newer. No API credentials are needed for the public simulation or automated tests.

For a local Claude preview, create the ignored `.dev.vars` file using `vi .dev.vars`:

```dotenv
ANTHROPIC_API_KEY=<your Anthropic API key>
AZIS_DEMO_TOKEN=<random reviewer code of at least 24 characters>
```

The model ID is configurable through `ANTHROPIC_MODEL` in `wrangler.jsonc` (initially `claude-haiku-4-5`). Choose an available model in your Claude Console before live evaluation. Never put an API key in HTML, frontend JavaScript, a URL, or a Git commit. The reviewer code is separate from the Anthropic API key, is not stored in browser storage, and should be rotated after a review.

Open the local `/demo/` page. The Claude availability badge is based on the deployed server configuration, not a hardcoded claim. Enter the reviewer code and select **Analyze with Claude** to initiate a paid API request.

## Production activation

Set secrets on the **azis-web** Worker through Cloudflare's secrets interface or Wrangler:

```sh
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put AZIS_DEMO_TOKEN
npm run deploy
```

Secret commands prompt for their values; do not paste secrets into chat or this repository. Configure model availability and provider spending limits in Claude Console before sharing access. The preview is private to reviewers with the access code, not an unrestricted public AI endpoint.

The included `ANALYSIS_LIMITER` allows approximately five requests per minute per Cloudflare location for this preview. Namespace `2026100901` is task-specific; if that namespace is already used in the account, choose another unique integer string. Cloudflare's limiter is approximate and local to each location; **it is not a global spending cap**.

Claude calls incur Anthropic API charges when activated. Exact cost depends on the chosen model and actual input/output token counts. Unit tests and simulation do not incur Anthropic usage. Cloudflare hosting follows the account's existing plan.

Cloudflare credentials and Anthropic secrets are not part of this repository. Repository publication alone does not prove that production deployed or that the live Claude integration works. After activation, run the [validation procedure](docs/validation.md), then update the site and this status table with the verified result.

## Development and evaluation evidence

- [Ten fictional cases and pass/fail criteria](docs/validation.md)
- [First customer pilot plan](docs/pilot.md)
- [Automated Worker tests](tests/worker.test.js)
- [Fictional case data](public/demo/cases.json)

These materials demonstrate implementation and a reproducible evaluation plan, not customer traction or Anthropic program acceptance.

## Reproducible live evaluation

`npm run evaluate` records real Claude responses for all ten fictional cases; it requires `ANTHROPIC_API_KEY` and `ANTHROPIC_MODEL` in the process environment. The [validation guide](docs/validation.md#record-actual-claude-responses) also documents a hosted route using an AZIS reviewer code.

The public `/evidence/` page renders the recorded report, including errors and human-review status. No actual run or model pass result is claimed until credentials are configured and the evaluation is executed. The checked-in report remains explicitly pending.
