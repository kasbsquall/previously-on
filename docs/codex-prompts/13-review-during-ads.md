# Prompt 13

Sent verbatim to Codex in session `01a174cd-3a2a-7f21-a9bf-1289a1e0b57a`.


A second blind review put Previously On second. The streamer judge's main objection: "the auto-approve timer can post AI text I never read." The ad break gives us the answer: the streamer is free while the ads run. Three changes.

1. **Review while the ads run.** Today the ad-break card is built when the break ends. Build it when `channel.ad_break.begin` arrives, from the window before the ad (the ad itself adds nothing to recap), and keep it waiting in the panel for the whole break, showing "Airs when the ad break ends" with a countdown to the end. The streamer can approve, veto or edit nothing else; at the end of the break the card airs if it was approved, or if it was not vetoed and the approval mode is timed. In "Hold until I approve" mode it airs only if approved. If the break ends while the model is still working, air as soon as the card is ready, within 10 s, or drop it. The overlay and chat timing stay "when the break ends". Keep the 3-minute window with the 10-minute widening. The simulated ad break and the recorded judge demo follow the same flow (the judge page can show a short "Ads playing, 60 s" stub before the card airs; keep it under 3 s of real time there). Tests for approve-during-ad, veto-during-ad, hold mode, and card-not-ready-at-end.
2. **Judge page bug.** In `dist-web`, the source lines are visible even when "Show sources" is unchecked. Hidden by default, shown when checked.
3. **README.** Under the one-liner, add one "Why" line: Twitch's CEO said in September 2026 that "at any given moment of a stream, probably only 10 percent of your community is there" (https://www.tubefilter.com/2026/09/29/twitch-clips-recaps-feed-streamer-highlights/), and ad breaks are when viewers leave. In the three points, say the streamer reviews the ad-break card while the ads run, so nothing airs unread unless they choose a timer. Keep the README under 9,000 characters. Re-run `npm run record-demo` only if the recording format changes (the key is in `.env`; approved), then `npm run build:web`.

Update `SPEC.md`. Run `npm test` and report. Do not commit.
