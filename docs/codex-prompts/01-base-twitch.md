# Prompt 1

Sent verbatim to Codex in session `01a174cd-3a2a-7f21-a9bf-1289a1e0b57a`.


Read `SPEC.md` in this folder first. It is the product spec for "Previously On", a Twitch tool for the Codex x TwitchCon Hackathon. You are building it; I make the product decisions.

This first task covers only the foundation and the Twitch connection. Do not build the recap engine, overlay or control panel yet.

1. Create `AGENTS.md` with the working rules for this repo, taken from SPEC.md: Node 22 ESM JavaScript, minimal dependencies, server bound to 127.0.0.1, secrets only in `.env`, no emoji anywhere, English everywhere, no invented Twitch fields (check https://dev.twitch.tv/docs/ first), tests with `node:test`, small focused modules, and "update SPEC.md when a decision changes".
2. Initialize the project: `package.json` (type module, scripts `start`, `check-twitch`, `test`), `.gitignore` (`.env`, `.data/`, `node_modules/`, `results/raw/`), `.env.example`, and `git init`.
3. Twitch auth module: Device Code Grant Flow for a public client exactly as SPEC.md describes, token storage in `.data/tokens.json`, refresh before expiry, and a validate call on start. Print the user code and verification URL; never print tokens.
4. EventSub WebSocket client: connect, read the welcome, create the `channel.chat.message` and `channel.raid` subscriptions within 10 seconds, handle keepalive, reconnect and revocation, and emit normalized events (`{ kind, t, user, text, raw }`).
5. Chat sender: `sendChat(text)` using `POST /helix/chat/messages`, max 500 characters, and handle `is_sent: false` and `drop_reason`.
6. `npm run check-twitch`: as described in SPEC.md (prints login and `broadcaster_type`, waits up to 60 s for one chat message, prints it, then sends "Previously On check: connected." to chat).
7. Unit tests for: device flow polling states (`authorization_pending`, success, expired), EventSub message routing using sample payloads copied from the Twitch docs into `test/fixtures/`, and the 500-character chat limit.

Before writing code, show me a short plan (files and responsibilities). Then implement, run `npm test`, and finish with: what works, what you could not verify without my Twitch account, and the exact commands I should run next. Commit with a conventional commit message when tests pass.
