# Prompt 15

Sent verbatim to Codex in session `01a174cd-3a2a-7f21-a9bf-1289a1e0b57a`.


Two bugs from the live takes on 27 October.

1. Wrong wording while a card is being built. In `src/cards/pipeline.js` the placeholder headline is always "Preparing the recap from before the ad.", so a BRB card (and a raid or `!catchup` card if they use this path) shows the wrong break in the panel. Make the placeholder headline match the trigger: ad break, BRB break, raid, `!catchup`. Keep the existing subtitle logic. Add a test per trigger.

2. The OBS browser source stops showing cards after a server restart. In the take, the server was restarted while OBS kept the overlay page open; afterwards the server marked a card as on air, but nothing appeared on stream until the browser source was refreshed by hand. Reproduce it (overlay open, restart the server, air a card), find the cause in `public/overlay.js` and the SSE endpoint, and fix it so the overlay recovers by itself: reconnect with a short backoff when the stream drops or closes, and on every (re)connect load the current state so a card already on air still shows. Same for the control panel (`public/control.js`) if it has the same problem. Add tests for the server side of this (for example, the state a new connection receives) and describe in your reply how you checked the browser side.

Run `npm test` and report. Do not commit.
