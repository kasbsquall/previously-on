# Verification on real Twitch

What was tested against live Twitch and OBS, what broke, and what is still untested. Tests ran on 2026-10-25 and 2026-10-26 (UTC) with two test accounts: `artemita95` (the streamer running Previously On) and `artemander95` (a viewer and the raiding channel).

## Tested live

| Test | Result | Evidence |
|---|---|---|
| Device code login, read chat, write chat (`npm run check-twitch`) | Logged in as the streamer, read a message from the second account over EventSub, posted "Previously On check: connected." | Prompt 1 review |
| `!catchup` from a viewer, first try | The card was built, approved, shown and posted. It used only the streamer's note, because the PC clock was about a minute behind Twitch and the chat looked like it came from the future. | Fixed in prompt 5 |
| `!catchup` after the clock fix | Each bullet cited one of the viewer's three messages (written in Spanish, recapped in English). The bot's earlier reply was no longer read as a source. | Prompt 5 review |
| Overlay in OBS 32.1.2 (browser source, 1920x1080) | The ticket appeared bottom-left over the scene during a real `!catchup`. | Screenshot from the streamer's OBS preview |
| Real raid, `artemander95` to `artemita95` | `channel.raid` arrived and a card went on air. It was empty, because nothing else had happened in the 10-minute window. The test also exposed an EventSub reconnect loop on quiet channels. | Fixed in prompt 6 |
| Quiet-channel connection after the fix | 3 minutes with no chat: the same three subscriptions stayed enabled and no reconnect was logged. | Prompt 6 review |

Twitch's own raid settings blocked the first attempts: the receiving channel required a 30-day-old account and a followed channel. A streamer trying this with a brand-new test account will hit the same wall.

## Not tested live yet

- A real ad break. The test channel is not an affiliate, so ad breaks are simulated with the documented `channel.ad_break.begin` payload and labeled SIMULATED.
- The welcome ticket for a raid with nothing to recap, and the recap wording after prompts 6 and 7, on a live channel.
- Voice capture with the Web Speech API during a real stream.

Measured latencies from live runs go to `results/live-cards.jsonl`, and `npm run live-report` summarizes them. This file will be updated after the final recorded raid.
