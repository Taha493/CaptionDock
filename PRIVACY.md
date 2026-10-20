# CaptionDock Privacy Policy

Last updated: October 20, 2026

CaptionDock is a browser extension that shows the captions of the YouTube video you are watching in a floating window. This policy explains what data it handles.

## Summary

CaptionDock does not collect, store, sell, or send any personal data. It has no servers, no accounts, no analytics, and no tracking.

## What the extension reads

- **Captions of the video you are watching.** When YouTube's own video player downloads a caption file, CaptionDock reads a copy of it inside your browser to show it in the floating window. If no caption file is seen, it reads the caption text that YouTube displays on the video instead.
- **The video's playback position**, so the right caption line can be highlighted.

This information is used only in your browser, only while the YouTube tab is open, and is never sent anywhere. Captions are kept in memory and are discarded when you close or reload the tab.

## What the extension stores

Your display settings (text size, background opacity, auto-scroll and "hide YouTube captions" preferences) and an optional debug flag are saved with the browser's `chrome.storage.local` storage, on your computer only. Removing the extension deletes them.

## Permissions

- **storage:** to save the display settings above.
- **Access to www.youtube.com:** to add the caption window button to the YouTube player and read the captions of the video you are watching. The extension does not run on any other website.

## Network requests

CaptionDock makes no network requests of its own and loads no remote code.

## Sharing

No data is shared with or sold to anyone, because no data leaves your browser.

## Changes

If this policy changes, the new version will be published at https://github.com/Taha493/CaptionDock/blob/main/PRIVACY.md with a new "Last updated" date.

## Contact

Questions: open an issue at https://github.com/Taha493/CaptionDock/issues
