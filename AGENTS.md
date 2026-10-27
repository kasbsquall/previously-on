# Repository working rules

- Use Node.js 22 or newer with ESM JavaScript.
- Keep dependencies minimal.
- Bind the server to `127.0.0.1` only.
- Store secrets only in `.env`; never log tokens or secrets.
- Do not use emoji anywhere in code, UI, logs, commits, or documentation.
- Use English for code, UI, and documentation.
- Do not invent Twitch fields. Check https://dev.twitch.tv/docs/ before using Twitch endpoints, payloads, or scopes.
- Write tests with `node:test`.
- Keep modules small and focused.
- Update `SPEC.md` when a product decision changes.
