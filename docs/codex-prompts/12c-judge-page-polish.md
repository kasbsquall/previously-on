# Prompt 12c

Sent verbatim to Codex in session `01a174cd-3a2a-7f21-a9bf-1289a1e0b57a`.


Browser review of the judge page in `dist-web/`: the lower-third cold open and the ticket play correctly. Two fixes.

1. The stage is empty on load, so a judge who does not click sees only a background. On load, play the ad-break card once with sound off (browsers block audio before a click); the three buttons replay cards with sound as today. Respect `prefers-reduced-motion` (show the finished ticket without the cold open).
2. The heading "Come back to the story." does not say what the product is. Use: eyebrow "Recorded demo", H1 "Previously On", and under it "When viewers come back from an ad break, or join mid-stream, a 15-second recap plays on stream. These three cards were recorded from a real run." Keep the honest recording line at the bottom.

Rebuild with `npm run build:web`, run `npm test`, report. Do not commit.
