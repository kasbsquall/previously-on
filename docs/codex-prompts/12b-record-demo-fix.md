# Prompt 12b

Sent verbatim to Codex in session `01a174cd-3a2a-7f21-a9bf-1289a1e0b57a`.


`npm run record-demo` fails on the real run:

```
file:///.../src/record-demo.js:45
  const pendingEvent = new Promise(resolve => pipeline.once('pending', resolve));
TypeError: pipeline.once is not a function
```

The pipeline exposes its events through its emitter, not as `once` on the pipeline object. Fix it, add a test that runs `record-demo`'s capture against the real pipeline object (model and narrator mocked) so this cannot pass tests and fail for real again, then run `npm run record-demo` yourself only if `OPENAI_API_KEY` is set in `.env` (it is; this costs a few cents and is approved) and `npm run build:web`, and report the files written. Run `npm test`. Do not commit.
