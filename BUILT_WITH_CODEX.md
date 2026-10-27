# Built with Codex

**Codex session ID:** `01a174cd-3a2a-7f21-a9bf-1289a1e0b57a`

Every line of product code in this repository was written by OpenAI Codex in that one session. The session was continued prompt after prompt with `codex exec resume`, so the whole build is a single thread.

## Who did what

| Who | What |
|---|---|
| Kevin Soto (product owner) | Picked the idea and the visual direction, set up the Twitch app and two test accounts, ran every live test on Twitch and in OBS, and approved each step. |
| Planning assistant | Wrote `SPEC.md`, `DESIGN.md`, this file, `docs/VERIFICATION.md` and the prompts below. Ran each prompt in Codex for Kevin. Reviewed every result in a real browser and against live Twitch, wrote the next prompt from what broke, and made the git commits. Codex's sandbox cannot write to `.git`. |
| OpenAI Codex (`gpt-6-luna`, the Codex CLI that ships with the ChatGPT desktop app) | Wrote all of `src/`, `public/`, `test/`, `fixtures/`, `AGENTS.md`, `README.md`, `JUDGE.md` and `LICENSE`, ran the tests, and checked Twitch's documentation before using any endpoint. |

At runtime, the recaps come from the OpenAI Responses API. The hackathon rules ask for Codex to build the project. They do not restrict which model the product calls.

## The ten prompts

The prompt records are in [`docs/codex-prompts/`](docs/codex-prompts/). Each one started with what the review of the previous block found.

| # | Prompt | What Codex built | What review caught next |
|---|---|---|---|
| 1 | [Base and Twitch connection](docs/codex-prompts/01-base-twitch.md) | Device code auth, EventSub WebSocket client, chat sender, `npm run check-twitch`, tests | The device flow passed Twitch's snake_case response to code that read camelCase, so a real login failed at once |
| 2 | [Recap engine](docs/codex-prompts/02-recap-engine.md) | The device flow fix with a regression test, source buffer, model call with structured output, grounding check, fallback, synthetic fixture, `npm run eval` | Nothing blocking. First run against the real model passed |
| 3 | [Surfaces and triggers](docs/codex-prompts/03-surfaces.md) | Local server, SSE overlay, control panel with 5-second veto, raid, `!catchup`, break and ad-break triggers, `npm run demo` | In the browser: bullets could vanish after a refresh, the stamp covered the stub, and the fallback headline repeated the header |
| 4 | [Review fixes](docs/codex-prompts/04-review-fixes.md) | Fixes for the browser review, model in demo mode, log layout | First live test on Twitch |
| 5 | [Live test fixes](docs/codex-prompts/05-live-test-fixes.md) | One clock for all sources, the bot ignores its own replies, cleaner chat line and headlines | Live raid test |
| 6 | [Keepalive and commands](docs/codex-prompts/06-keepalive-and-commands.md) | Keepalive grace period, `!` commands kept out of recaps, welcome ticket when a raid has nothing to recap | The recap repeated the raid that the stub already shows |
| 7 | [Docs and live log](docs/codex-prompts/07-docs-and-live-log.md) | Trigger excluded from the model's sources, `results/live-cards.jsonl`, README, JUDGE.md, license | A blind review of the README asked for the late viewer first and visible proof, and a simulated raid in the demo still repeated the raid |
| 8 | [OpenAI recap and approval settings](docs/codex-prompts/08-openai-and-approval.md) | Responses API, configurable approval hold and timer, judge-facing README updates | With the real model, ad-break cards recapped the raid and follows instead of the stream |
| 9 | [Recap focus](docs/codex-prompts/09-recap-focus.md) | Twitch events kept out of recap content, headlines without a period, hold-mode stub | Simulate ad break showed a raw Node error, and the demo no longer produced ad-break cards |
| 10 | [Ad break fixes](docs/codex-prompts/10-ad-break-fixes.md) | Serializable ad-break result, plain panel errors, demo replay on the live clock, ad-break window that widens to 10 minutes, a log line when a card is dropped | Checked in the browser: all four triggers produce a card in the demo |

## Commits

Commits marked "Written by OpenAI Codex" contain only Codex's code. The others hold the spec, the design direction and recorded results. Run `git log` to see them all.

## Where Codex is visible in the product

- `AGENTS.md`, written by Codex in prompt 1, holds the working rules it followed in every later prompt.
- Every Twitch endpoint, payload and scope was checked against https://dev.twitch.tv/docs/ before use, as `AGENTS.md` requires. The simulated ad break uses the documented `channel.ad_break.begin` payload shape.
- The tests Codex wrote (`npm test`) cover the bugs found in each review, so every fix has a regression test.
