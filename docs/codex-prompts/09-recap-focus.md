# Prompt 9

Sent verbatim to Codex in session `01a174cd-3a2a-7f21-a9bf-1289a1e0b57a`.


Demo run with the real OpenAI model (gpt-5.4-mini). The raid card was good ("Greenhouse repairs and forest exploring wrapped up." with three stream bullets), but two ad-break cards came out as "A raid landed as the ad break began." and "A raid brings 14 viewers to the stream.": Twitch events still in the window (an earlier raid, follows, the ad break) take over the recap, which is useless for a viewer coming back from an ad.

1. Events (raid, follow, ad break) are not recap content. Send only voice, notes and chat to the model and to the fallback bullets; keep events in the buffer and in the provenance counts only. If no voice, notes or chat remain, behave like the empty-raid case (welcome ticket for a raid; no card for the other triggers). Test it.
2. Headlines end without a period. Tell the model and strip a trailing period in code.
3. In "Hold until I approve" mode, the pending card's stub shows only a small "Hold until I approve" line in a large empty area. Show the same stub layout as the timer, with the hourglass icon and a large "Hold" in place of the countdown, and no meter.

Run `npm test` and report. Do not commit.
