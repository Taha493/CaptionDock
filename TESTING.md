# Manual test checklist

Run these on real YouTube after installing the extension (see README). Before you start, turn on debug mode (README, "Debug mode") and keep the YouTube tab's console open so you can see what CaptionDock logs.

Pick three videos:

- **A:** a podcast or talk with real (human-made) captions. In the CC menu, the language has no "(auto-generated)" label.
- **B:** a video with only auto-generated captions. The CC menu shows "English (auto-generated)".
- **C:** a video with no captions. The CC button is greyed out or missing (many music videos, some short clips).

## 1. Basics on video A

- [ ] The caption window button sits next to the CC button in the player.
- [ ] Hovering it shows "Open caption window (CaptionDock)".
- [ ] Turn CC **off**, then click the button. The window opens at about 480 x 260, CC turns on by itself, and within a couple of seconds the status reads **Live captions · English** (or the video's language).
- [ ] The current line is bright and slightly larger, earlier lines are dimmer, and later lines dimmer still.
- [ ] The highlight moves with the speech. Pause the video and the highlight stops; play again and it resumes.
- [ ] Console (debug on) shows a `hook: timedtext via xhr` (or `via fetch`) line with `cleaned:` greater than 0.

## 2. Seeking and speed

- [ ] Drag the YouTube progress bar back 30 seconds: the window jumps back to the matching line.
- [ ] Skip forward with the `L` key (10 s) a few times: the window keeps up.
- [ ] Set the playback speed to 2x, then to 0.5x: the highlight stays in sync at both speeds.
- [ ] Click a line from about a minute ago in the window: the video jumps there.

## 3. Scrolling

- [ ] Scroll up in the window with the mouse wheel: auto-scroll stops and **Jump to live** appears.
- [ ] Wait a few lines, then click **Jump to live**: the window scrolls back to the current line and follows it again.
- [ ] Click **Auto** to turn auto-scroll off: the window no longer follows. Click it again to turn it back on.

## 4. Settings

- [ ] `A+` / `A-` change the text size.
- [ ] The slider changes the background from grey to near black.
- [ ] **Hide YT** hides the captions over the video, and the window keeps working. Click it again to show them.
- [ ] Close and reopen the window: your settings are still there.

## 5. Background and other apps

- [ ] Switch to another browser tab: the window keeps updating.
- [ ] Switch to another app (a text editor, for example): the window stays visible on top and keeps updating. (On Linux Wayland, see the README if it goes behind.)
- [ ] Minimize the browser window, if your system allows that while audio plays: the window keeps updating.

## 6. Navigation

- [ ] With the window open, click a recommended video in YouTube (no page reload): the window empties, shows **Waiting for captions**, then loads the new video's captions. It stays open throughout.
- [ ] Press the browser's Back button: you return to the previous video and its captions load again.
- [ ] Open the YouTube home page while the video plays in the miniplayer: the window keeps showing that video's captions.

## 7. Auto-generated captions (video B)

- [ ] Open the window. The status reads **Live captions · English (auto-generated)**.
- [ ] Each spoken phrase appears once, with no repeated or half-repeated lines.
- [ ] Seeking and speed changes behave as in section 2.

## 8. No captions (video C)

- [ ] Open the window: after a moment it shows **No captions for this video** (or **Fallback mode** if YouTube does not say clearly; nothing appears in that case). No errors in the console.

## 9. Language and translation (video A or B)

- [ ] In the player's settings, change Subtitles/CC to another language: the window switches to it and the status shows the new language.
- [ ] Choose **Auto-translate** > another language: the window switches and the status says "translated to ...".

## 10. Ads (if you get them)

- [ ] During an ad, the status says **Ad playing, captions resume after it** and the transcript does not change.
- [ ] After the ad, the video's captions continue in sync. No ad text appears in the history.

## 11. Opening and closing

- [ ] Click the player button while the window is open: the window closes.
- [ ] Click it again: the window reopens (and loads instantly if the captions were already downloaded).
- [ ] Close the window with its own close button: the player button goes back to normal, and YouTube's captions are visible again if **Hide YT** was on.
- [ ] Reload the YouTube tab: the window closes (expected). Click the button again: it works.

## 12. Live stream (optional)

- [ ] Open a live stream with captions and then the window: after a few seconds it shows **Fallback mode** with a "Live stream" notice, and lines appear as they are spoken.

## 13. Extension reload

- [ ] With a YouTube tab and the window open, reload the extension in `chrome://extensions`: the window shows "CaptionDock was reloaded or updated. Refresh this YouTube tab".
- [ ] Refresh the tab: the button comes back and everything works.

If something fails, note the step, copy the `[CaptionDock]` console lines, and run `CaptionDock.debugInfo()` (with the console context set to **CaptionDock**). That is usually enough to find the cause.
