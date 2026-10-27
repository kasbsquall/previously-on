# Prompt 5

Sent verbatim to Codex in session `01a174cd-3a2a-7f21-a9bf-1289a1e0b57a`.


First live test on real Twitch (artemander95 chatting in artemita95's channel, then `!catchup`) found these problems. Fix them and add regression tests.

1. **Clock skew drops the whole chat.** The card used only the panel note (`provenance.chatCount` was 0) although `.data/session.jsonl` holds the three chat messages and the `!catchup`. Cause: chat items are stored with Twitch's timestamp (from the EventSub message metadata), while the window end is `now()` from the local clock, and this machine's clock is about 61 s behind Twitch (local `02:22:52Z` vs Twitch `Date: 02:23:53 GMT`). Every chat message looked like it came from the future. Store every source item with the local receive time as `t` (keep Twitch's timestamp as `twitchTime` if useful), so all window math uses one clock. Test: a chat event whose Twitch timestamp is 90 s ahead of the local clock is still inside a catch-up window built right after it.
2. **The bot reads its own replies.** The bot's reply was stored as a chat source with text `@artemander95 Previously on: ...` (Twitch prefixes replies with the mention), so the self-filter that checks `startsWith('Previously on:')` misses it and the next card can summarize the bot. Ignore every chat message sent by the bot account itself when it is bot output, matching an optional leading `@name ` before `Previously on:` or `Previously On check:`. Better still, also remember the `message_id`s returned by `sendChat` and drop those.
3. **The chat line repeats itself.** Posted line: `Previously on: @artemander95, Previously: Castle Tower Construction. artemita95 has been working on building the castle tower`. The reply already shows who it answers, so do not put `@user` in the text of a reply. Format: `Previously on: {headline}. {first bullet}` (and the second bullet if it fits in 500 characters).
4. **Model headlines.** The model returned `Previously: Castle Tower Construction` and earlier `MeadowMoth Wraps Up the Cottage Garden`. In the system prompt: the headline is one plain sentence in sentence case, never starts with `Previously`, and names what happened. Also strip a leading `Previously on:` / `Previously:` in code as a safety net. Chat sources may be in any language; the card is always in English.
5. **Overlay polish from the browser review.** The headline wraps to 3 lines because its max width is about 270 px; let it use the full coupon body width (about 400 px) so 60 characters fit in 2 lines at 30 px. The RECAP stamp hangs below the ticket's bottom edge; keep it fully inside the ticket bounds, on the perforation, not over any text.
6. Demo runs create a new `.data/demo-session-<pid>.jsonl` each time. Delete it when the demo process exits.

Run `npm test` and report. Do not commit.
