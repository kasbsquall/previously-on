# Prompt 6

Sent verbatim to Codex in session `01a174cd-3a2a-7f21-a9bf-1289a1e0b57a`.


The real raid test failed: artemander95 raided artemita95 ("Raid created" in chat) but no raid card was built and nothing from the raid reached the buffer.

1. **EventSub reconnect loop.** `GET /helix/eventsub/subscriptions` shows 199 subscriptions for our client, almost all `websocket_disconnected`, a new set of three (`channel.chat.message`, `channel.raid`, `channel.ad_break.begin`) created every ~11 s since the chat went quiet. Cause: in `src/twitch/eventsub.js`, `resetKeepalive` terminates the socket after exactly `keepalive_timeout_seconds` (10 s). Twitch sends its keepalive at about that same interval, so on a quiet channel the timer races the keepalive and the socket is killed every cycle; while chat was busy the timer kept being reset, which is why the earlier `!catchup` tests worked. Raids that arrive during the gaps are lost. Fix: wait the keepalive timeout plus a grace period (for example timeout + 5 s, check the Twitch EventSub WebSocket docs for the recommended handling), and log every reconnect with its reason (keepalive timeout, close code, session_reconnect, error) on one line, without tokens. Add a test with fake timers: keepalives arriving every 10 s with a 10 s timeout must not cause a reconnect over 2 minutes.
2. **Chat commands are not content.** The last card's headline was "A viewer tested the catchup command in chat" and provenance said 13 chat messages because every `!catchup` was stored as a chat source. Do not store chat messages that start with `!` in the source buffer (they still trigger commands), and do not count them in provenance.
3. **Chat-only recaps narrate the chat.** With only chat sources the model writes "A viewer asked whether the bridge was finished". The card is for someone who just arrived: in the system prompt, ask it to describe what is happening on the stream as reported by the sources ("The bridge is still unfinished; the river is done and the forest is next"), not who said what, and never to invent facts beyond the sources.

4. **Empty recap card.** A second raid did arrive (between reconnects) and went on air with headline "The last 10 min on stream", zero bullets and provenance all zero, because nothing else had happened in the 10-minute window. Never put a card with no recap lines on the overlay. When the window has no sources besides the trigger itself, the raid still gets its chat welcome line, and the overlay shows a short welcome ticket instead of a recap (coupon: "Welcome, raiders from {name}" and one line "The stream just got started, nothing to catch up on yet"; stub as usual; engine tag hidden). Add a test.

Run `npm test` and report. Do not commit.
