# Chrome Web Store listing

Copy-paste text for the Chrome Web Store Developer Dashboard, field by field.

## Package

Upload `dist/captiondock-<version>.zip`, built with `node scripts/package.js`.

## Store listing tab

**Name** (comes from manifest.json): CaptionDock

**Summary** (comes from the manifest `description`, 132 characters max):

> Shows YouTube captions in a floating always-on-top window with a scrollable history.

**Description:**

```
Missed a line in a YouTube podcast while working in another app? CaptionDock shows the video's captions in a small floating window that stays above your other windows, so you can glance at it and re-read what was just said without switching back to YouTube and rewinding.

FEATURES
- Floating caption window that stays on top of other apps while you work
- The current line is highlighted in sync with the video
- Scroll back through earlier lines to re-read anything you missed
- Click any line to jump the video to that moment
- Works with human-made and auto-generated captions, and with auto-translate
- Follows you from video to video in the same tab
- Adjustable text size and background, optional hiding of the captions on the video
- Works when the YouTube tab is in the background

HOW TO USE
1. Open a YouTube video that has captions.
2. Click the caption window button next to the CC button in the player.
3. Move and resize the floating window wherever you like.

PRIVACY
CaptionDock runs only on youtube.com, makes no network requests of its own, collects no data and has no analytics. Your display settings are saved in your browser only.

REQUIREMENTS
Chrome, Edge or Brave version 116 or newer. On Linux with Wayland, use your desktop's "Always on top" option if the window goes behind other apps.

CaptionDock is an independent project and is not affiliated with or endorsed by YouTube or Google.

Source code: https://github.com/Taha493/CaptionDock
```

**Category:** Productivity (alternative: Accessibility)

**Language:** English

**Store icon:** `store/store-icon-128.png`

**Screenshots** (at least 1, up to 5; 1280x800 or 640x400, PNG or JPEG): take real ones, see "Screenshots" below.

**Small promo tile** (440x280): `store/promo-tile-440x280.png`

**Homepage URL:** https://github.com/Taha493/CaptionDock

**Support URL:** https://github.com/Taha493/CaptionDock/issues

## Privacy tab

**Single purpose description:**

> CaptionDock shows the captions of the YouTube video the user is watching in a floating window that stays on top of other windows, with a scrollable history of earlier lines.

**Permission justification, storage:**

> Saves the user's display settings for the caption window (text size, background opacity, auto-scroll, and whether to hide YouTube's own captions) on the user's computer.

**Permission justification, host permission (https://www.youtube.com/\*):**

> The extension adds a button to the YouTube video player, reads the captions that YouTube's player downloads for the video being watched, and reads the video's playback position to highlight the current line. It runs only on youtube.com and sends nothing anywhere.

**Are you using remote code?** No, I am not using remote code.

**Data usage:** tick none of the data types. CaptionDock does not collect or transmit user data.
Then tick all three certifications (no selling data, no unrelated use, no creditworthiness use).

**Privacy policy URL:** https://github.com/Taha493/CaptionDock/blob/main/PRIVACY.md

## Distribution tab

**Visibility:** Public (or Unlisted to share a link with friends first)

**Regions:** All regions

## Test instructions (for the reviewer, optional field)

```
1. Open any YouTube video with captions, for example a TED talk.
2. Click the caption window button (a rectangle with two lines) next to the CC button in the player's control bar.
3. A floating window opens and shows the captions in sync with the video. Scroll it, or click a line to seek.
No account or login is needed.
```

## Screenshots

Take 2 to 4 real screenshots at 1280x800:

1. Set the browser window to about 1280x800 (or take a larger screenshot and crop or scale it).
2. Play a video with good captions and open the caption window next to the player or over another app.
3. Good shots: the window over a text editor while the video plays in the background; the window showing scroll history with "Jump to live"; the player button next to CC.
4. Use the GNOME screenshot tool (`Print Screen`), then crop to 1280x800 with any image editor.

Do not put YouTube's logo in the store icon or promo tile, and do not use "YouTube" in the extension name. Saying it works "for YouTube" in the description is fine.
