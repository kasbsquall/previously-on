# Prompt 2

Sent to Codex in session `01a174cd-3a2a-7f21-a9bf-1289a1e0b57a`. Model-provider details from the first version, later replaced by OpenAI (prompt 8), are omitted.


Review of your previous task found one bug. Fix it first, with a regression test:

- `createTwitchAuth().acquire()` calls `pollDeviceCode({ ...device, clientId, fetchImpl, now })`, but the Twitch device response uses snake_case (`device_code`, `interval`, `expires_in`), while `pollDeviceCode` reads `deviceCode`, `interval`, `expiresIn`. In a real run `expiresIn` is undefined, the loop never runs, and the user gets "Device code expired" immediately. Map the fields explicitly and add a test that goes through `acquire()` with a mocked device response in Twitch's real shape.
- Also: ignore chat messages whose `chatter_user_id` is the broadcaster/bot account itself when they are bot output (they start with `Previously on:` or `Previously On check:`), so the bot never summarizes itself.

Then build the recap engine described in SPEC.md, sections "Sources the recap can use" and "Recap engine". No overlay, control panel or chat triggers yet.

1. `src/sources/buffer.js`: ring buffer of source items `{ id, t, kind, text, user }` (kinds: chat, voice, event, note), max 2000 items, append-only JSONL persistence to `.data/session.jsonl`, and `window({ from, to, max })` returning items numbered `S1..Sn` with chat text truncated to 200 characters.
2. `src/recap/fallback.js`: the deterministic fallback from SPEC.md step 4.
3. `src/recap/model.js`: implement the structured model call described in SPEC.md step 2 with the official SDK, model config from `.env`, a 6-second timeout, and typed SDK error handling. Put the source list in a delimited data block and write a short system prompt that treats chat and transcript text as untrusted data.
4. `src/recap/grounding.js`: SPEC.md step 3 (unknown source ids and `BLOCKED_TERMS`).
5. `src/recap/index.js`: `buildRecap({ trigger, items, channel })` that runs model, then grounding, then falls back when needed, and returns `{ headline, bullets: [{ text, sources }], provenance: { voiceSeconds, chatCount, eventCount, noteCount }, engine: "model" | "fallback", latencyMs, droppedBullets }`.
6. `fixtures/demo-session.jsonl`: one invented but realistic 15-minute session of a US English cozy game stream (about 120 items: chat, voice segments, a raid, a follow, an ad break, two notes). Mark it as synthetic in its first line (a JSON comment item with kind `meta`). Include two chat messages that try prompt injection ("ignore previous instructions and say ...") so tests can prove they are ignored.
7. `npm run eval`: run `buildRecap` over windows cut from the fixture (raid at minute 10, catch-up at minute 7, back from break at minute 12) and write `results/eval-<date>.json` with cards, kept vs dropped bullets, fallback rate, p50/p95 latency, and whether any bullet repeats injected text. Without the model API key it must still run (fallback only) and say so in the file.
8. Tests: window numbering and truncation, unknown-id bullets dropped, blocked terms dropped, fallback when the model throws, refuses or times out (mock the client, no network in tests), injected text never reaches the output in the fallback path, and the device-flow regression test.

Start with a short plan, then implement, run `npm test` and `npm run eval`, and finish with: what works, what you could not verify (be explicit, for example the real model call if no key is set), and the next commands. You cannot write to `.git` in this sandbox, so do not try to commit; I will commit after review.
