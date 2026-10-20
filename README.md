# CaptionDock

A browser extension that shows a YouTube video's captions in a small floating window that stays above your other windows, with a scrollable history. Listen to a podcast while you work, and when you miss a line, glance at the window instead of switching back to YouTube and rewinding.

- Current line highlighted in sync with the video, earlier lines kept above it.
- Scroll back to re-read; click any line to jump the video there.
- Follows you from video to video in the same tab.
- Everything stays in your browser: no servers, no analytics, no network requests of its own.

## Requirements

| Browser | Minimum version |
| --- | --- |
| Google Chrome | 116 |
| Microsoft Edge | 116 |
| Brave | any release based on Chromium 116 or newer (late 2023 onward) |

The floating window uses a browser feature called **Document Picture-in-Picture**, which arrived in Chromium 116. To see your version, open `chrome://settings/help` (in Brave: `brave://settings/help`).

**Linux on Wayland (for example GNOME):** Wayland does not let apps force their own windows to stay on top, so the caption window may go behind other apps. See [Keep the window on top on Linux](#keep-the-window-on-top-on-linux-wayland).

## Install (first time)

An extension is a folder of files that the browser loads. The main file is `manifest.json`, which tells the browser the extension's name, the permissions it needs, and which scripts to run on which sites. You don't need any build tools. The browser reads this folder directly.

1. Open the extensions page. Type `chrome://extensions` in the address bar (Edge: `edge://extensions`, Brave: `brave://extensions`) and press Enter.
2. Turn on **Developer mode** with the toggle in the top right corner. This adds a row of extra buttons.
3. Click **Load unpacked**. "Unpacked" means a plain folder instead of a packaged store download.
4. Select the `CaptionDock` folder (the one that contains `manifest.json`) and confirm.
5. A **CaptionDock** card appears. Optional: click the puzzle piece icon in the toolbar and pin CaptionDock. The extension has no toolbar popup, so pinning only shows the icon.
6. **Refresh any YouTube tabs that were already open.** The browser only adds the extension's scripts to pages loaded after you install it.

## Use it

1. Open a YouTube video that has captions (the **CC** button in the player is not greyed out).
2. In the player's control bar, next to the CC button, click the new **caption window** button (a small rectangle with two lines).
3. A floating window opens. CaptionDock turns on CC in the player if it was off, because YouTube only downloads captions while CC is on.
4. Move and resize the window wherever you like. The browser remembers its position and size for next time.
5. Click the button again to close the window, or close it normally.

In the window:

| Control | What it does |
| --- | --- |
| Status (left) | **Live captions**: the full transcript is loaded and in sync. **Fallback mode**: reading captions off the screen (see below). **No captions found**: the video has none. **Waiting for captions**: still loading. |
| `A-` / `A+` | Text size |
| Slider | Background darkness. The window is a normal OS window, so it can't be see-through. |
| `Auto` | Auto-scroll to the current line |
| `Hide YT` | Hide YouTube's own captions over the video while the window is open |
| Click a line | Jump the video to that line |
| Scroll up | Pauses auto-scroll. **Jump to live** brings you back. |

Settings are saved and shared across tabs.

### Keep the window on top on Linux (Wayland)

On Windows, macOS and Linux X11 sessions, the window stays on top by itself. On Wayland (the default on GNOME and KDE today) the desktop decides, so if the window drops behind other apps:

- **GNOME:** click inside the caption window, press `Alt+Space`, and choose **Always on Top**. Repeat this each time you open the window.
- **KDE Plasma:** right-click the window's title bar (or press `Alt+F3`) and choose **More Actions > Keep Above Others**. To make it permanent, add a Window Rule for it.
- **Any desktop:** run the browser through XWayland, where Chromium can set the "on top" flag itself. Open `brave://flags/#ozone-platform-hint` (Chrome: `chrome://flags/#ozone-platform-hint`), set it to **X11**, and restart the browser.

## After you change the code

1. Go to `chrome://extensions` and click the **reload** (circular arrow) icon on the CaptionDock card.
2. **Refresh the YouTube tab.** The scripts already running in an open tab belong to the old version. Reloading the extension disconnects them but doesn't replace them, so you only get the new code after the page reloads. Until then, the window shows: "CaptionDock was reloaded or updated. Refresh this YouTube tab".

## How it works

```
YouTube tab
 |
 |- hook.js (runs inside YouTube's own JavaScript, from the very start of page load)
 |     Wraps fetch() and XMLHttpRequest. When YouTube's player downloads a caption
 |     file (/api/timedtext), copies the text and passes it on with window.postMessage.
 |
 |- content.js and friends (run in the extension's isolated world)
 |     - Adds the button to the player.
 |     - Parses caption files (youtube-adapter.js), cleans and dedupes them
 |       (transcript-store.js), and keeps the newest track per video.
 |     - Opens the floating window with documentPictureInPicture.requestWindow().
 |
 '- Floating window (pip-ui.js)
       Built from the YouTube tab. On every animation frame it reads the video's
       currentTime and binary-searches the transcript for the current line.
       This keeps running when the YouTube tab is in the background because the
       floating window is visible.
```

Some terms:

- **Content script:** a script the extension adds to a web page. It can see and change the page's HTML, but by default it runs in an **isolated world**, a separate JavaScript space from the page's own scripts.
- **MAIN world:** the page's own JavaScript space. `hook.js` has to run there to wrap the `fetch` that YouTube's player uses.
- **Why not download captions directly?** YouTube's caption URLs now return an empty response unless the request carries a token that only YouTube's own player scripts create. So CaptionDock reads what the player already downloaded.
- **Fallback mode:** if no caption download is seen within about 5 seconds (live streams, or YouTube changed something), CaptionDock watches the caption text drawn over the video and builds a history from it. Only lines that played while the window was open appear, and timing is approximate.
- **Ads:** caption files for ads belong to a different video id and are ignored. While an ad plays, the window shows "Ad playing" and pauses.
- **No service worker:** many extensions have a background script (service worker). CaptionDock doesn't need one.

### Files

| Path | Purpose |
| --- | --- |
| `manifest.json` | Extension description: permissions (`storage` only), which scripts run on `www.youtube.com` |
| `src/hook.js` | MAIN world network hook; also answers player info questions (has captions? live?) |
| `src/config.js` | Constants, message names, debug logging |
| `src/youtube-adapter.js` | **All YouTube-specific selectors, URLs and caption parsers. Look here first when YouTube changes something.** |
| `src/transcript-store.js` | Cleaning, dedupe, binary search, fallback transcript builder |
| `src/settings.js` | Saved settings (`chrome.storage.local`) |
| `src/pip-ui.js`, `src/pip-styles.js` | Floating window UI and its CSS (kept as a JS string; see the comment in the file) |
| `src/content.js` | The controller that ties it all together |
| `src/page.css` | Styles added to YouTube itself (the button; hiding native captions) |
| `icons/` | Placeholder icons (regenerate with `node scripts/make-icons.js`) |
| `tests/` | Unit tests, sample caption files, browser smoke tests |
| `scripts/` | Project checks, packaging, and the icon and promo tile generators |
| `store/` | Chrome Web Store listing text and images |
| `PRIVACY.md` | Privacy policy (linked from the store listing) |

Only `manifest.json`, `src/` and `icons/` go into the store package. Everything else is for development, and Chrome ignores it when you load the folder unpacked.

## Debug mode

Debug mode prints what CaptionDock sees to the YouTube tab's console: every caption download it catches, how many lines it parsed, mode changes (live, fallback), navigation, and CC handling.

1. On the YouTube tab, open DevTools: `F12` or `Ctrl+Shift+J` (Mac: `Cmd+Option+J`), then the **Console** tab.
2. Above the console, find the dropdown that says **top**. Change it to **CaptionDock**. This runs your commands inside the extension's isolated world, where it can use `chrome.storage`.
3. Run:
   ```js
   chrome.storage.local.set({ debug: true })
   ```
   It takes effect immediately and stays on until you run it again with `false`.
4. With **CaptionDock** still selected, `CaptionDock.debugInfo()` prints a snapshot: current video, mode, whether the hook answered, player info, stored transcripts.

Alternatively, set `DEBUG: true` in `src/config.js` and reload the extension and the tab.

Log lines start with `[CaptionDock]`. Type `CaptionDock` in the console's filter box to see only those.

## Where to look when something breaks

| What | Where |
| --- | --- |
| CaptionDock's logs and warnings | DevTools console of the **YouTube tab**. All of CaptionDock's code runs there, including the code that draws the floating window. |
| Extension errors | `chrome://extensions` > CaptionDock card > **Errors** button (it only appears when there are errors) |
| The floating window's HTML/CSS | Right-click inside the window > **Inspect**, if your browser offers it. Otherwise, in the YouTube tab console: `documentPictureInPicture.window.document` |

## Troubleshooting

| Problem | What to try |
| --- | --- |
| No button in the player | Refresh the tab (always needed after installing or reloading the extension). Make sure it is a normal `youtube.com/watch` page, not Shorts or an embedded player. If the control bar can't be found, a **Caption window** button appears in the bottom right corner of the page instead. |
| "needs Chrome, Edge or Brave version 116 or newer" | Update the browser. |
| Status stuck on **Waiting for captions** | Turn on CC in the player yourself. Check that the video has captions (the CC button is not greyed out). After about 5 seconds CaptionDock switches to fallback mode. |
| **Fallback mode** on a normal video | YouTube may have changed how it loads captions. Turn on debug mode and look for `hook: timedtext` lines. If there are none, update `src/youtube-adapter.js` / `src/hook.js`. Refreshing the tab sometimes helps. |
| **No captions found** | The video really has no captions (not even auto-generated). Nothing to show. |
| Captions are in the wrong language | Change the language in YouTube's player settings. The newest track YouTube downloads wins. If switching back to a language you used earlier doesn't update the window, pick a different language and then the one you want, or refresh the tab. |
| Window shows "CaptionDock was reloaded or updated" | Refresh the YouTube tab. |
| Window goes behind other apps (Linux) | See [Keep the window on top on Linux](#keep-the-window-on-top-on-linux-wayland). |
| Window closed by itself | It belongs to the YouTube tab. Closing or fully reloading that tab closes it, and so does another site opening its own picture-in-picture window. |
| Lines out of sync | Click a line or seek in YouTube. Sync uses the video clock directly, so this should only happen in fallback mode, where times are when CaptionDock saw the text. |

## Known limitations

- The window closes when its YouTube tab closes or reloads. Navigating between videos inside the tab keeps it open.
- Only one picture-in-picture window can exist in the browser at a time.
- The window can be darker or lighter but never see-through. Picture-in-picture windows are opaque OS windows.
- On Linux Wayland, "always on top" depends on the desktop (see above).
- Live streams and premieres use fallback mode: no history from before you opened the window, approximate timing.
- In fallback mode with the YouTube tab in the background, the browser may slow the page down, so new lines can arrive about a second late.
- Only `www.youtube.com` watch pages. Not supported: `m.youtube.com`, YouTube Music, Shorts, embedded players on other sites.
- YouTube changes its page without notice. When it does, the fix usually goes in `src/youtube-adapter.js`.

## Development checks

Node.js 22 or newer is enough. There is nothing to install.

```sh
node --test                                # unit tests: caption parsers, dedupe, binary search
node scripts/check.js                      # manifest, syntax, no em dashes, no innerHTML/eval
node tests/smoke/run.js                    # browser smoke test with a fake YouTube page (needs python3 and Chrome/Brave)
node tests/smoke/run.js --extension brave  # loads the real extension in headless Brave against a fake youtube.com
```

The smoke tests use a throwaway browser profile and only connect to `127.0.0.1`.

## Releasing to the Chrome Web Store

1. Bump `version` in `manifest.json`. Every upload needs a higher version than the last one.
2. Run the checks above, then `node scripts/package.js`. This writes `dist/captiondock-<version>.zip`, which contains only `manifest.json`, `src/` and `icons/`.
3. In the [Developer Dashboard](https://chrome.google.com/webstore/devconsole), open CaptionDock, go to **Package**, upload the zip, and submit for review.

Listing text, permission justifications and image specs are in [store/listing.md](store/listing.md). Regenerate the images with `node scripts/make-icons.js` and `node scripts/make-promo-tile.js`.

## Privacy

CaptionDock has one permission, `storage`, used for your settings. It runs only on `https://www.youtube.com/*`, makes no network requests of its own, loads no remote code, and sends nothing anywhere. Full policy: [PRIVACY.md](PRIVACY.md).

## License

[MIT](LICENSE). CaptionDock is an independent project and is not affiliated with or endorsed by YouTube or Google.
