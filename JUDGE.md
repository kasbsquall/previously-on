# Judge guide

This guide uses the local demo and does not require a Twitch account.

## Start the demo

1. Install dependencies and run the demo:

   ```sh
   npm install
   npm run demo
   ```

2. Open the control panel at `http://127.0.0.1:4777/control`.
3. Open the overlay at `http://127.0.0.1:4777/overlay`.
4. The demo replays a synthetic stream session and runs simulated triggers. Cards with simulated triggers carry a SIMULATED label.

## Review and moderate a card

- In the panel, find the “Waiting to board” card and its countdown.
- Choose **Approve now** to show it on the overlay, or **Veto** to discard it.
- The overlay shows the recap headline, source-based bullets, trigger details and provenance.
- In the panel log, expand a card row to see each bullet's cited source IDs and the corresponding source text.
- Use **Simulate raid**, **Simulate !catchup** or **Simulate ad break (60 s)** to try additional triggers.

## Run the checks

```sh
npm test
npm run eval
```

`npm test` runs the unit suite. `npm run eval` evaluates recap windows from the synthetic fixture and writes its results under `results/`.
