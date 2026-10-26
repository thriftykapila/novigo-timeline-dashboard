# Demo recording

The submitted `public/demo.webm` is an actual browser walkthrough against the assignment backend. It covers login, hourly and exact modes, zoom/reset, the summary table, page reload with session restoration, a future empty shift and logout. Readable chapter cards explain the steps. The recording is 2:40, 1440 × 900 at 25 fps, approximately 13 MB; representative decoded frames were visually reviewed. Additional acceptance checks are recorded in `QA.md`.

To record another walkthrough, run the app locally and use a recent Playwright CLI:

```bash
npx --yes --package @playwright/cli playwright-cli -s=novigo-demo open http://localhost:5173
npx --yes --package @playwright/cli playwright-cli -s=novigo-demo resize 1440 900
npx --yes --package @playwright/cli playwright-cli -s=novigo-demo video-start public/demo.webm --size=1440x900 --fps=25 --cursor
npx --yes --package @playwright/cli playwright-cli -s=novigo-demo video-show-actions
```

Take snapshots to get current element references, perform the actual workflow, and use `video-chapter` for explanatory cards. Stop with `video-stop`. The CLI may ask to install its matching browser or ffmpeg runtime.

`public/demo.html` hosts the video in an ordinary HTML player. Both video files and the HTML player are excluded from the SPA catch-all rewrite. Keep the video under GitHub's individual-file limit.

The separate performance fixture in `performance-check.mjs` is for verification and is not used in this recording.
