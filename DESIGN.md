# DESIGN: Boarding Stub

Visual direction for the overlay card and the control panel. Chosen by the product owner on 2026-10-25 out of three prototypes. The approved prototype is `design/reference.html` (open it in a browser; the stream background is `design/reference-bg.png`, an original generated image, not a real game). This file wins where it differs from the prototype: it fixes two problems the prototype has (card too large, dead space in the stub).

## Idea

The card is a boarding pass stub for someone arriving at the stream: a coupon on the left with the recap, a tear-off stub on the right with who is arriving and where the recap came from. A red "RECAP" stamp lands on it when it enters. When the moderator vetoes a card in the panel, the pending stub tears off along the perforation.

Tone: warm paper, printed ink, transit-ticket order. It must read in 3 seconds over any game, at 1080p, through Twitch compression.

## Tokens

```css
:root{
  --paper:oklch(96% .012 85);
  --paper-2:oklch(92.5% .016 85);
  --paper-3:oklch(89% .02 85);
  --ink:oklch(24% .03 260);
  --ink-2:oklch(42% .03 260);
  --navy:oklch(34% .09 262);
  --navy-2:oklch(42% .1 262);
  --red:oklch(56% .19 28);      /* stamp, veto, countdown, SIMULATED */
  --carbon:oklch(42% .11 300);  /* provenance and engine label only */
  --perf:oklch(84% .015 85);    /* perforation dots, meter track */
  --ok:oklch(55% .12 150);      /* connected, shown */
  --rule:color-mix(in oklab, var(--ink) 14%, transparent);
  --r:6px;                      /* the only radius, everywhere (4px for tiny tags) */
  --ease:cubic-bezier(.23,1,.32,1);
}
```

- Never pure black or pure white. Shadows are tinted warm: `oklch(24% .05 60 / .3)`.
- Paper surfaces carry the SVG grain from the prototype (`--grain`, about 9% alpha).
- Red covers less than 5% of the card: stamp, arrival dot, SIMULATED tag.

## Type

- One family: **Hanken Grotesk** (SIL OFL). Self-host it, do not load Google Fonts at runtime (the overlay must render offline in OBS). Use `@fontsource-variable/hanken-grotesk` and serve its files from the local server, or vendor the woff2 plus its OFL license into `public/fonts/`.
- All numbers: `font-variant-numeric: tabular-nums lining-nums slashed-zero`.
- Headlines `text-wrap: balance`, body lines `text-wrap: pretty`.
- No uppercase except the small labels (`Previously on`, `Arriving`, stamp), tracked `.09em`.

## Icons

Phosphor, **Light** weight only, one size per context. Self-host (`@phosphor-icons/web` light CSS and font served locally, or inline the few SVGs used). Never emoji. Icons used: film-slate (show label), airplane-landing (stub label), cpu (AI recap), list-numbers, plugs-connected, broadcast, microphone, coffee, door-open, timer, ticket, hourglass-medium, check, x, clock-counter-clockwise, check-circle, x-circle, chat-circle-text, note-pencil, users-three, arrow-counter-clockwise. Bullet icons on the card: use one neutral icon per bullet by source kind (chat-circle-text for chat, microphone for voice, lightning for event, note-pencil for note), from the first source the bullet cites. Do not try to guess topical icons.

## Overlay card (`/overlay`, 1920x1080, transparent body)

### Size and place (fixes the prototype)

- The whole ticket is **at most 640 px wide and at most 380 px tall** on the 1920x1080 canvas (one third of the width). The prototype is 908 px wide; that is too much.
- Anchored bottom-left, 48 px from the left and bottom edges. Never crosses the horizontal center of the screen.
- Coupon 452 px wide, stub 188 px wide.

### Coupon (left)

- Navy header 44 px tall: film-slate icon + `PREVIOUSLY ON` (13 px, 700, tracked) on the left, channel display name (17 px, 700) on the right.
- Body padding 18 px 24 px 18 px 22 px.
- Headline: 30 px, 700, line-height 1.06, letter-spacing -.022em, max 2 lines (60 characters max from the engine).
- Bullets: 1 to 3, separated by 1 px `--rule` lines. Grid `24px 1fr`, icon 20 px navy, text 17 px / 1.28 / 500, max 2 lines each.
- The inner hairline frame from the prototype (`::after`, navy 38%) stays.

### Stub (right, fixes the dead space)

The stub is a compact stack with **no `margin-top: auto` and no empty band**. Content goes top to bottom with 8 to 12 px gaps, and whatever height is left goes to the bottom padding only if the coupon is taller. Order:

1. Label row 44 px tall (same height as the coupon header): airplane-landing + `ARRIVING`.
2. Route arc SVG (BRB to LIVE, dotted, 40 px tall), drawn on entry.
3. The trigger block, which depends on the trigger:

| Trigger | Small line (13 px, ink-2) | Big line | Number |
|---|---|---|---|
| Raid | `Raid from` | raider display name, 22 px 700 | viewer count, 48 px 700 carbon, + `viewers` |
| `!catchup` | `Asked by` | viewer display name, 22 px 700 | none |
| Back from break | `Back from` | `Break`, 22 px 700 | minutes away, 48 px, + `min` |
| Ad break ended | `Back from` | `Ad break`, 22 px 700 | seconds, 48 px, + `s` |

4. Provenance (13 px, 500, carbon), straight under the trigger block: `from 4 min of voice, 38 chat messages, 1 raid`. Only kinds with a count above zero.
5. Engine tag: `AI recap` (cpu icon) when `engine` is `model`; `Quick recap, no AI` when `engine` is `fallback`. Carbon background, paper text, radius 4 px.

Long names: truncate with an ellipsis at one line. A Twitch display name can be 25 characters.

### Stamp

Red `RECAP` / `CATCH UP` stamp, rotated -9deg, over the top-right corner of the coupon (where it overlaps the stub edge), `mix-blend-mode: multiply`, about 26 px type. It must not cover the headline text.

### SIMULATED and DEMO

- Anything simulated gets a red `SIMULATED` tag (11 px, 700, tracked, radius 4 px) in the stub label row. Never hidden.
- `npm run demo` shows a small `DEMO REPLAY` tag in the top-right corner of the overlay, same style, navy.

### Motion (all under 300 ms per step; `transform` and `opacity` only, plus `stroke-dashoffset` for the arc)

Entry choreography, exactly as the prototype:

1. Coupon and stub slide in from `translateX(-120px)` with opacity, 280 ms, stub 60 ms later.
2. Bullets rise from `translateY(6px)`, 240 ms each, starting at 220 ms, 30 ms apart.
3. Arc draws (`stroke-dashoffset`), 280 ms, starts at 280 ms.
4. Stamp drops from `rotate(-16deg) scale(1.7)` to `rotate(-9deg) scale(1)`, 150 ms, at 560 ms; the ticket does a 4 px thud at 710 ms.

On air for 15 s, then exit: coupon slides out to the left with opacity, 200 ms. A new card that arrives while one is on air replaces it (exit, then entry).

`prefers-reduced-motion: reduce`: no animation; the card appears and disappears.

## Control panel (`/control`, Chrome on the streamer's machine)

Page background `--paper-2` with grain. Title `Check-in desk`, subtitle `Every card waits 5 s here before it goes on stream`. Three slips (paper cards, radius 6 px, 1 px perf bottom shadow) in a grid that becomes one column under 640 px.

1. **Connection slip**: Twitch status (Connected / Reconnecting / Offline, with a breathing dot), Voice capture state, Model state (`AI recap on` or `No API key, quick recaps only`). Buttons: `Going on break`, `Back` (only enabled while on break), `Simulate ad break (60 s)`, `Simulate raid`, `Simulate !catchup`. Simulated triggers are labeled SIMULATED everywhere they show up.
2. **Waiting to board slip**: the pending card as a miniature ticket (same coupon and stub primitive): trigger line, SIMULATED tag if it applies, headline, line count and provenance. Stub shows `Auto-approves in`, a 76 px countdown 5 to 0 in red, and a meter that shrinks with `scaleX`. Buttons `Approve now` (navy, primary) and `Veto` (red outline). On veto the miniature stub tears off (prototype `tear` animation) and nothing is shown or posted. Empty state: `No card waiting. The next one appears after an ad break, a raid or a viewer's !catchup.`
3. **Voice and notes slip**: voice capture toggle with the live transcript (last 3 final segments, interim text in ink-2 italic), a one-line note field with `Add note`, and a short message if the browser has no Web Speech API (`Voice capture needs Chrome. You can still add notes.`).
4. **Log slip** (full width under the three): the last 20 cards with time, trigger, headline, engine and Shown or Vetoed. Clicking a row expands its bullets with the cited source ids and the source text, so the streamer can see why each line was written.

Every button has hover, focus-visible (2 px navy outline, 3 px offset), active (`scale(.97)`) and disabled states, min height 44 px. While the server is connecting, show skeleton lines, never placeholder numbers.

## Wording

Sentence case, plain words, no exclamation marks, no emoji. The card never speaks as a viewer and always says it is a recap and where it came from. All UI text in English.
