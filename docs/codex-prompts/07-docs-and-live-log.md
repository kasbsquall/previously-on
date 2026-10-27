# Prompt 7

Sent to Codex in session `01a174cd-3a2a-7f21-a9bf-1289a1e0b57a`. Model-provider details from the first version, later replaced by OpenAI (prompt 8), are omitted.


Last product fix, then the submission docs. The video does not exist yet; leave a clearly marked placeholder for it.

1. **The recap repeats the trigger.** On a simulated raid with the model path, the card said "CozyCampfire raids a rainy, cozy cottage stream" and its third bullet was "CozyCampfire raided the stream with 14 viewers", which the stub already shows. The trigger event is only excluded in the fallback path. Exclude the event that fired the trigger (raid, ad break) from the items sent to the model too, and tell the model in the system prompt that the stub already shows who arrived, so the headline and bullets are about what happened on the stream. Test it with the mocked client.
2. **Measured numbers need a source file.** SPEC.md says no number in the README or UI that does not come from `results/`. Append one JSON line per decided card to `results/live-cards.jsonl` in `npm start` mode (not in demo or tests): `{ at, mode, trigger, simulated, engine, latencyMs, bullets, droppedBullets, status }`, no chat text and no user names. Add a small `npm run live-report` that prints counts by trigger and status and p50/p95 latency from that file.
3. **LICENSE**: MIT, copyright 2026 Kevin Soto.
4. **README.md** for judges who may only skim it. Order:
   - Title, the one-liner "When an ad break ends, a raid lands or a viewer types !catchup, Previously On shows a 15-second TV-style recap card on stream and posts the same line in chat", and one sentence on who it is for (small streamers who lose viewers at every break; viewers who arrive mid-stream).
   - `[Video: coming soon]` placeholder line.
   - Screenshot block using `docs/media/overlay.png` and `docs/media/control.png` (I will add the files; reference them only).
   - "Try it in 2 minutes" with `npm install` and `npm run demo` (no Twitch account, no API key; with the model API key set it uses the model, without it the deterministic fallback), the two URLs, and what to click.
   - "How it works": triggers table (raid, `!catchup`, back from break, ad break) with the Twitch API each one uses; the recap engine (source window, model call with structured output, grounding check that drops bullets citing unknown sources, blocked terms, fallback, 5-second veto); privacy (server on 127.0.0.1, secrets in `.env`, chat text never leaves the machine except to the model call).
   - "Run it on your channel": Twitch app registration (public client, device code flow), `.env`, `npm start`, OBS browser source settings.
   - "What was tested on real Twitch": write the section from `results/live-cards.jsonl` if it has lines, otherwise say the live tests are documented in `docs/VERIFICATION.md` (I will write that file); do not type numbers by hand.
   - "Limits, said plainly": ad break needs an affiliate or partner channel and is simulated and labeled SIMULATED otherwise; voice capture needs Chrome's Web Speech API; recaps are only as good as the last minutes of chat, voice and notes; one channel per process.
   - "Built with Codex" linking `BUILT_WITH_CODEX.md` (I will write that file).
   - License.
5. **JUDGE.md**: a one-page path for a judge with no Twitch account: run the demo, what to look at in the panel and the overlay, how to veto a card, where to see the sources behind each bullet, and how to run `npm test` and `npm run eval`. Under 60 lines.

Plain English, sentence case, no emoji, no marketing words (no "seamless", "revolutionary", "game-changer"). Run `npm test` and report. Do not commit.
