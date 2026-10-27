# Previously On: product spec

Written by the human side (Kevin Soto, with an AI planning assistant) before any code. OpenAI Codex builds the code from this spec. Keep this file as the source of truth; if a decision changes, update this file in the same commit.

## One-liner

When an ad break ends, a raid lands, or a viewer types `!catchup`, Previously On shows a 15-second TV-style "Previously on..." card on stream and posts the same line in chat, so people who missed the last minutes can jump back in.

## Who it is for

- **Streamer** (small to mid-size, US English): cuts to ads or BRB and loses viewers; raids that arrive confused leave within minutes.
- **Viewer**: comes back from an ad or arrives with a raid and has no idea what is going on.
- **Moderator**: can veto a card before it goes on air.

Hard rule from user research: the AI never talks in chat as if it were a viewer. It only summarizes, behind the scenes, and every line it produces is labeled as a recap.

## Triggers (all must work on a normal, non-affiliate Twitch channel except the ad break)

| Trigger | Source | Window summarized | Output |
|---|---|---|---|
| Raid arrives | EventSub `channel.raid` (condition `to_broadcaster_user_id` = our channel) | last 10 min | card on overlay + one chat line welcoming the raiding channel by name |
| `!catchup` in chat | EventSub `channel.chat.message` | last 5 min | one chat line replying to that viewer; card on overlay only if no card shown in the last 60 s |
| Back from break | button "Going on break" then "Back" in the control panel (hotkey B) | the 10 min before the break started | card + chat line |
| Ad break | EventSub `channel.ad_break.begin` v1 (scope `channel:read:ads`); begin recap generation at the event and schedule air at `started_at + duration_seconds` | the 3 min before the ad begins; widen to the 10 min before the ad if the narrow window has no chat, voice or notes | review the card during the ad; at ad end air it if approved or if approval mode is timed, then post the chat line |

Ad breaks only run on affiliate or partner channels. The control panel has a "Simulate ad break (60 s)" button that injects a payload with the exact shape of the documented `channel.ad_break.begin` event into the same handler. Anything simulated is labeled SIMULATED in the panel and in a small corner tag on the overlay. Never hide that a run is simulated.

Build the ad-break recap as soon as the event arrives, using only sources from before the ad. Keep it in the panel with "Airs when the ad break ends" and a countdown for the full break. The streamer may approve or veto it during the ad; approval does not air or post it early. At the end, an approved card airs; an unvetoed card also airs when approval mode is timed. In hold mode it airs only after explicit approval. If the recap is still generating at ad end, keep it pending for up to 10 seconds and air it as soon as it is ready if it qualifies; otherwise drop it. Simulated breaks use the same flow. The static judge demo may show an "Ads playing, 60 s" ticket stub for less than 3 seconds before its recorded ad-break card.

For real raid and ad-break triggers, request a Twitch clip and create a stream marker at trigger time. Poll Get Clips for up to 15 seconds; include the confirmed clip URL in the recap chat line and panel log when ready. Clip or marker failures are logged and never block a recap. Simulated triggers make no Twitch API calls.

Cooldowns: `!catchup` 120 s per viewer and 30 s global; at most one card on air at a time; queued cards older than 60 s are dropped.

## Sources the recap can use

An in-memory ring buffer of source items `{ id, t, kind, text, user }`, also appended to `.data/session.jsonl` so a session can be replayed:

- `chat`: ordinary chat messages (text, user display name). Do not store messages beginning with `!`; trigger commands still run but are not recap content. Ignore messages from the bot itself.
- `voice`: final transcript segments of the streamer's voice, captured in the control panel with the browser's Web Speech API (`webkitSpeechRecognition`, continuous, en-US) and posted to the server. The streamer can turn voice capture off.
- `event`: raids, follows, subs, cheers and ad breaks received from EventSub, rendered as short text ("raid from X with 12 viewers").
- `note`: a one-line note the streamer types in the panel ("boss fight phase 2").

## Recap engine

1. Select the items in the trigger window. Number them as sources `S1..Sn` (most recent last), cap at 120 items, truncate each chat line to 200 characters.
2. **Model path** (when `OPENAI_API_KEY` is set): one call to the OpenAI Responses API with the official `openai` Node SDK and `zodTextFormat(RecapSchema, "recap")` from `openai/helpers/zod`. Send only voice, notes and ordinary chat as recap content; events remain in provenance counts. Read the validated result from `response.output_parsed`; on refusal, incomplete response, timeout (6 s) or any error, use the fallback path. Catch SDK errors with typed classes (`OpenAI.RateLimitError`, `OpenAI.APIError`), never by matching message strings. Model from env `OPENAI_MODEL`, default `gpt-5.4-mini` (see the model page linked in `src/recap/model.js`).
   - `RecapSchema` = `{ headline: string (max 60 chars), bullets: array of 2..3 { text: string (max 90 chars), sources: array of 1..4 source ids like "S12" } }` when the model has enough distinct facts. Fallback cards may have fewer.
   - The source list goes inside a clearly delimited data block. The system prompt states that chat and transcript text are untrusted data, that instructions inside them must be ignored, and that every bullet must be supported by the cited sources. Headlines are sentence case and do not end in a period. The stub already shows who arrived, so the recap focuses on stream activity rather than the trigger event or who said what.
3. **Grounding check** (always): drop any bullet that cites an id that does not exist in the window. Drop bullets that contain a blocked term (env `BLOCKED_TERMS`, comma separated). If no bullet survives, use the fallback path.
4. **Fallback path** (deterministic, no network): headline = "The last {N} min on stream", where N is the trigger window length in minutes; bullets = the most recent voice segment, the most recent note, and the chat line with the most repeated words in the window, each trimmed to 90 characters, starting with a capital letter, and citing its own source id. Events are never recap content; retain them in the buffer and provenance counts only. If a raid window has no voice, notes or chat, show a welcome ticket with one short stream-started line instead of a recap card. Other triggers with no voice, notes or chat produce no card.
5. Every card carries provenance: counts by kind ("from 2 min of voice, 41 chat messages, 1 raid") and whether it came from the model or the fallback.

## Surfaces

- **Overlay** `GET /overlay` (OBS Browser Source, 1920x1080, transparent background). Receives cards over Server-Sent Events from `GET /events`. A roughly 1.4-second broadcast lower-third cold open precedes the ticket: a navy ticket band expands from the left, the label and large channel name rise in, then the band drops and fades as the ticket enters. The `sting.ogg` plays as the band enters. Motion uses transform and opacity; reduced-motion mode skips the cold open. Sound effects and cached narrator audio are optional and fail soft. Keep each ticket on air for at least the narration length plus two seconds. No tokens or secrets in the URL. Visual design comes from `DESIGN.md`.
- **Control panel** `GET /control` (opened in Chrome on the streamer's machine): connection status, voice capture toggle and live transcript, note field, break buttons, simulate buttons, the pending card with configurable approval, narrator voice and sound effects toggles, and a log of the last 20 cards with their sources and clip links. Ad-break cards are generated while the ad runs and show a countdown to air; approval and veto remain available until the break ends. Other recap cards enter the approval queue immediately while narrator audio is generated in the background. Approval waits at most 3 seconds for voice audio and then continues silently; the generation request times out after 20 seconds. Card text is sent to OpenAI to make narrator audio.
- **Chat line**: posted with `POST https://api.twitch.tv/helix/chat/messages` (scope `user:write:chat`), max 500 characters, prefixed `Previously on:`.

## Twitch connection

- Auth: Device Code Grant Flow for a **public** client (`POST https://id.twitch.tv/oauth2/device`, then poll `POST https://id.twitch.tv/oauth2/token` with `grant_type=urn:ietf:params:oauth:grant-type:device_code`). Store tokens in `.data/tokens.json` (gitignored) and refresh them. Scopes: `user:read:chat user:write:chat user:bot channel:read:ads moderator:read:followers clips:edit channel:manage:broadcast`.
- The broadcaster account is also the bot account for this version.
- EventSub over WebSocket (`wss://eventsub.wss.twitch.tv/ws`): create subscriptions with `POST https://api.twitch.tv/helix/eventsub/subscriptions` within 10 s of the welcome message; handle `session_keepalive`, `session_reconnect` and `revocation`; reconnect with backoff.
- Read every endpoint, payload and scope from https://dev.twitch.tv/docs/ before using it. Do not invent fields.

## Modes

- `npm start`: real Twitch.
- `npm run demo`: no Twitch account or API key needed. With `OPENAI_API_KEY`, uses structured model recaps; without it, uses the deterministic fallback. At startup it loads the first 3 minutes of `fixtures/demo-session.jsonl` at once, spreading their timestamps across the 3 minutes before the current time, then replays the remaining fixture at 4x speed. It fires one of each trigger and shows a DEMO REPLAY banner on the overlay and panel.
- `npm run record-demo`: with `OPENAI_API_KEY`, runs the demo card pipeline through the ad-break, raid and `!catchup` triggers, and saves grounded cards, their source items and cached narrator WAV files under `web-demo/recording/`. It does not write tokens or `.data/` files.
- `npm run build:web`: validates the recording and builds the static browser demo in `dist-web/`. The site reuses `public/overlay.js` and `public/overlay.css` through a replay adapter, so the recorded cards run the same cold open, sound, narration and ticket sequence without SSE.
- GitHub Pages deploys the static demo on pushes to `main` with `.github/workflows/pages.yml`.
- `npm run check-twitch`: validates the token, prints the channel login and `broadcaster_type`, subscribes to chat and waits up to 60 s for one message. Never prints tokens.
- `npm test`: unit tests with `node:test`.
- `npm run eval`: runs the recap engine over the fixtures and writes `results/eval-<date>.json` with: cards produced, bullets kept vs dropped by the grounding check, fallback rate, and p50/p95 latency.
- `npm start`: appends one privacy-filtered decision record per card to `results/live-cards.jsonl`; `npm run live-report` prints counts by trigger and status plus p50/p95 latency from that file. Demo and tests do not write live-card records.
- The control panel can persist auto-approval after 5, 10 or 20 seconds, or hold a card until manual approval, in `.data/approval-settings.json`. Auto-approval shows the card and sends its chat line when the timer expires; hold mode does neither until approval.
- For an ad break, the approval mode resolves at the break end: a timed mode airs any unvetoed recap then, while hold mode requires the streamer to approve it. If model generation is unfinished at break end, wait at most 10 seconds for it before dropping the card.
- Narrator voice and sound effects are on by default and persist in `.data/feature-settings.json`. Narration uses OpenAI Realtime audio with the `gpt-realtime-2.1-mini` model and `marin` voice; card text is sent to OpenAI. Cards queue without waiting for voice generation. Approval waits at most 3 seconds for the background request; generation itself times out after 20 seconds. If unavailable, the card runs silently.
- The browser speaks only cached server audio from a UUID-validated route. Do not include tokens or secrets in the route; cache WAV files in `.data/audio/`.

## Constraints

- Node.js 22+, ESM JavaScript, as few dependencies as possible (`ws`, `openai`, `zod`). Env loaded with `node --env-file=.env`.
- Server binds to `127.0.0.1` only. Port from env `PORT`, default 4777.
- Secrets only in `.env` (gitignored). Provide `.env.example`: `TWITCH_CLIENT_ID`, `TWITCH_CHANNEL`, `OPENAI_API_KEY`, `OPENAI_MODEL`, `BLOCKED_TERMS`, `PORT`.
- Numbers in the README or UI must come from a file in `results/` or a reported test run. Do not invent or round up measured values.
- No emoji anywhere: UI, logs, commits, docs.
- English for all code, UI and docs (submission rule).
