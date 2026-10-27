# Prompt 4

Sent to Codex in session `01a174cd-3a2a-7f21-a9bf-1289a1e0b57a`. Model-provider details from the first version, later replaced by OpenAI (prompt 8), are omitted.


Review of the overlay and panel in a real browser found these problems. Fix them, keep the rest as is.

1. **Bullets disappear on the overlay.** `.bullet` has a base `opacity: 0` and only becomes visible through the `rise` animation under `.ticket.play`. Any later `renderCard(card, false)` (for example after an SSE `state` event while the card is on air, or an OBS reload) removes `play`, so the coupon shows the headline and three empty rows. Measured in the browser: all three `li.bullet` had computed opacity 0 about 1.5 s after approval. Make visibility not depend on the animation class (the `both` fill mode already hides the bullets during the delay), and make sure a state refresh never restarts or hides a card that is on air.
2. **Stamp covers the stub.** The RECAP stamp sits on top of the route arc, the BRB label and the "Raid from" line. Move it so it overlaps the perforation edge near the bottom of the coupon, without covering the headline, any bullet text, the arc or any stub text. Check it with bounding boxes for a card with 3 two-line bullets and for a card with 1 bullet.
3. **Fallback headline repeats the header.** The coupon header already says "PREVIOUSLY ON" and the channel name, and the fallback headline is "Previously on MeadowMoth", so the card reads the same thing twice. Change the fallback headline to `The last {N} min on stream`, where N is the window length in minutes, and update SPEC.md step 4.
4. **Fallback bullets repeat the trigger.** For a raid, the first fallback bullet is the raid event itself ("raid from CozyCampfire with 14 viewers"), which the stub already shows. Exclude the event that fired the trigger from the window used for bullets, and start every bullet with a capital letter.
5. **Demo mode always ignores the model.** `src/demo.js` forces the fallback, and the panel then says "No API key, quick recaps only" even when the model API key is set. In demo mode use the model when the key is present and the fallback when it is not, and make the panel's Model row tell the truth in both cases. The demo must still run with no key.
6. **Panel log layout.** In the card log the time column takes about a quarter of the width while the headline is squeezed. Give time a fixed narrow column, the trigger a medium one, and let the headline take the remaining space; on narrow screens stack them.

Add tests for 1 (rendering without `play` keeps bullets visible, checked on the CSS rule or with a DOM-free unit test of the render decision), 3 and 4. Run `npm test`, then `npm run demo` briefly, and report what you changed and what you could not check visually. Do not commit.
