# Prompt 14b

Sent verbatim to Codex in session `01a174cd-3a2a-7f21-a9bf-1289a1e0b57a`.


Live test against the real OBS 32.1.2 (obs-websocket 5.7.3): `npm run check-obs` works and `SetCurrentProgramScene` does switch the scene (a later `GetCurrentProgramScene` returns the new one), but `CurrentProgramSceneChanged` never arrives. A raw client identified with `eventSubscriptions: 2047` received only `SceneTransitionStarted` and `SceneTransitionEnded` on each switch. So the BRB trigger never fires on the real setup.

Fix in `src/obs/client.js`: also subscribe to transition events; on `SceneTransitionEnded` (and on `CurrentProgramSceneChanged` if it does arrive) call `GetCurrentProgramScene`; and while connected, poll `GetCurrentProgramScene` every 2 seconds as a fallback. Emit `program-scene` only when the scene name actually changes, so the break never starts twice. Tests for the transition path, the poll path and the no-duplicate rule. Run `npm test` and report. Do not commit.
