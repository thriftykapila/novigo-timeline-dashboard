# Record your demo

Aim for about 3 minutes. Start signed out, use a desktop browser at 100% zoom, and keep the app visible while explaining each step.

| Step | Show                                                                                                                           | Say                                                                                                                                        |
| ---- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 1    | Open `/dashboard` while signed out, then log in with `analytics_user` / `dashboard123`. Optionally submit an empty form first. | “The dashboard is protected and authenticates against the supplied backend.”                                                               |
| 2    | Select **Line1 SPI**, **1 September 2026**, **06:00–14:30**. Briefly open the machine and shift menus.                         | “Machines and shifts come from the API. All displayed times are in IST.”                                                                   |
| 3    | Keep **Show individual produces** off. Point to the totals, chart and legend.                                                  | “This view combines hourly production counts with runtime and downtime bands.”                                                             |
| 4    | Turn individual produces on and hover a PASS and a FAIL.                                                                       | “This fetches individual parts. Circles are passes, crosses are failures, and the tooltip shows the exact IST timestamp and part details.” |
| 5    | Drag across the chart, then click **Reset zoom** or double-click.                                                              | “I can inspect a smaller window and return to the full shift. Failure markers are retained.”                                               |
| 6    | Scroll to the hourly table and across its columns.                                                                             | “The table shows counts, machine time in minutes, and cycle times in seconds. Blank cycle values mean unavailable data.”                   |
| 7    | Change the date to **2 September**, then select **23:00–06:00**. Point to `(+1 day)`.                                          | “Filters fetch the selected window, including shifts that cross midnight.”                                                                 |
| 8    | Click **Refresh**, then reload the browser.                                                                                    | “Refresh fetches a new snapshot. Reload restores the session after validating it with the backend.”                                        |
| 9    | Select **1 January 2027**, show the empty state, then sign out.                                                                | “Future hours stay blank. Logout clears the session and returns to login.”                                                                 |

Close with: “I used sessionStorage, a shared API client and a canvas chart. I also tested 20,000 markers separately.”

The live first shift previously returned 326 produces; use the current values on screen and don't describe it as 20,000 live points. If you mention the source-data note, explain that the backend supplies overlapping intervals and UTC-aligned hourly buckets; the details are in NOTES.md.
