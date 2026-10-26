# Demo recording

`public/demo.webm` walks through login, hourly and exact modes, zoom/reset, the summary table, session restoration after reload, an empty shift and logout against the assignment API. It runs for 2:40 at 1440 × 900, 25 fps. See `QA.md` for the other checks.

To record again, start the app locally and run:

```bash
npx --yes --package @playwright/cli playwright-cli -s=novigo-demo open http://localhost:5173
npx --yes --package @playwright/cli playwright-cli -s=novigo-demo resize 1440 900
npx --yes --package @playwright/cli playwright-cli -s=novigo-demo video-start public/demo.webm --size=1440x900 --fps=25 --cursor
npx --yes --package @playwright/cli playwright-cli -s=novigo-demo video-show-actions
```

Use snapshots to find the current controls, walk through the app, and add chapter cards with `video-chapter`. Finish with `video-stop`. The CLI may need to install Chromium or ffmpeg first.

`public/demo.html` plays the recording. Vercel serves both demo files directly, outside the app's route rewrite.

`performance-check.mjs` runs separately; its generated data is not part of the demo.
