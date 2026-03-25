# AG Social Media Clips — Claude Code Instructions

## Project Overview

Build a **browser-based animation composer** that layers assets (images, text, logo, audio)
into short animated clips, exportable as video in two aspect ratios.
This is a **local prototype** — no backend server required; everything runs in the browser.

---

## Tech Stack Preferences

- **Vanilla HTML + CSS + JavaScript** (keep dependencies minimal for a prototype)
- Use the **Web Animations API** or **GSAP** (loaded from CDN) for timeline-based animations
- Use **Canvas API** or **CSS layers** for compositing the visual layers
- For video export: **CCapture.js** or **MediaRecorder API** (browser-native, no server needed)
- Audio: **Web Audio API** (for background music playback during preview)
- Fonts: load **Geogrotesque** from `docs/fonts/` using `@font-face`

---

## Output Formats

Always support both aspect ratios simultaneously. Build a toggle or tabs so the user
can preview both before exporting.

| Format | Dimensions     | Use case        |
|--------|----------------|-----------------|
| 16:9   | 1920 × 1080 px | YouTube / web   |
| 1:1    | 1200 × 1200 px | Instagram / social |

---

## Folder Structure

Stick to this layout — do not invent new folders without asking.

```
project-root/
├── CLAUDE.md               ← this file (Claude Code reads it on start)
├── index.html              ← main entry point, opened in browser
├── src/
│   ├── main.js             ← bootstraps the app, wires everything together
│   ├── composer.js         ← builds and runs the animation timeline
│   ├── exporter.js         ← handles video/frame export logic
│   ├── watcher.js          ← watches/loads assets from the watch folder
│   └── ui.js               ← controls the preview UI and format toggle
├── styles/
│   └── main.css            ← layout, font declarations, preview panel styling
├── docs/
│   ├── fonts/              ← Geogrotesque font files (.woff2 / .otf)
│   ├── Example-1x1.mp4     ← reference clip (do not modify)
│   └── Example-16x9.mp4    ← reference clip (do not modify)
└── watchfolder/            ← hot-swappable assets (user drops files here)
    ├── background.png
    ├── Curvedline.png
    ├── person.png
    ├── logo.png
    ├── Music.mp3
    └── content.txt         ← plain text file: title | subtitle | baseline text
```

---

## Visual Layer Order (bottom → top)

Render layers in this exact z-order. Each layer is a positioned element or canvas layer.

1. `background.png` — full bleed, fills the frame
2. `Curvedline.png` — transparent PNG, **animates upward** from below the frame
3. `person.png` — transparent PNG, centered-right, **no animation** (static)
4. Text overlays — title, subtitle, baseline bar (see Typography section)
5. `logo.png` — transparent PNG (1920×1080), bottom-right corner, **animates up** from below

---

## Animation Behaviour

Keep animations simple and consistent. All timings are approximate — adjust if needed
after comparing with the example clips in `docs/`.

| Element        | Animation                          | Timing        |
|----------------|------------------------------------|---------------|
| Curvedline     | Slides in from bottom, fades in    | 0s – 0.8s     |
| Title text     | Fades + slides in from left        | 0.5s – 1.2s   |
| Subtitle text  | Fades in after title               | 1.0s – 1.6s   |
| Baseline bar   | Slides in from left                | 1.4s – 2.0s   |
| Logo           | Slides in from bottom              | 0.2s – 1.0s   |
| Music          | Starts immediately, looped         | 0s →          |

---

## Typography

Load Geogrotesque from `docs/fonts/` using `@font-face`. Always fall back to `sans-serif`.

```css
/* Example @font-face pattern — repeat for each weight needed */
@font-face {
  font-family: 'Geogrotesque';
  src: url('../docs/fonts/Geogrotesque-BoldItalic.woff2') format('woff2');
  font-weight: 700;
  font-style: italic;
}
```

| Text element   | Color                                    | Font weight    | Size  |
|----------------|------------------------------------------|----------------|-------|
| Title          | White (`#FFFFFF`), green (`#D4F9B0`) keywords | Bold Italic | 70px  |
| Subtitle       | White (`#FFFFFF`)                        | Medium         | 43px  |
| Baseline text  | White (`#FFFFFF`) on green bg `#A4CB3F`  | Semibold       | 50px  |

**Title keyword highlighting:** wrap highlighted words in `<span class="highlight">`.
Parse them from `content.txt` using a simple delimiter (e.g. `*keyword*` → highlighted).

---

## Asset Loading from Watch Folder

Since this runs locally in a browser (no file system access by default), use one of:
- **Option A (recommended for prototype):** a simple `<input type="file" multiple webkitdirectory>`
  that lets the user select the `watchfolder/` directory — the browser gives access to all files.
- **Option B:** hardcode relative paths and ask the user to serve the folder with
  `npx serve .` or Python's `http.server` — then fetch assets via relative URLs.

Document which approach is active in a comment at the top of `watcher.js`.

---

## Content File Format (`content.txt`)

Keep it simple — one field per line:

```
TITLE: Your title here with *green* keywords *highlighted*
SUBTITLE: Your subtitle text here
BASELINE: Your baseline slogan here
```

The parser in `composer.js` should read these three fields and apply them to the overlay.

---

## Export

Use the **MediaRecorder API** to capture the canvas/preview as a `.webm` file.
Provide a simple "Record" button in the UI that:
1. Resets the animation to frame 0
2. Starts MediaRecorder on the canvas stream
3. Plays the full animation (≈ 5–10 seconds)
4. Stops recording and triggers a browser download of the `.webm` file

Export one format at a time. Label the downloaded file with the aspect ratio:
`clip-16x9.webm` or `clip-1x1.webm`.

---

## Code Style Rules

- **Comment every function** — explain what it does, its parameters, and return value.
- **Comment every animation step** — this is a learner project; clarity over brevity.
- Use `const` and `let` (never `var`).
- Keep functions small and single-purpose (one job per function).
- No TypeScript for now — plain JS is fine for a prototype.
- Prefer readable variable names over short ones (`backgroundLayer` not `bg`).

---

## What Claude Code Should Do First

When starting a new session, Claude Code should:

1. Read this file (`CLAUDE.md`) completely before writing any code.
2. Check if `index.html` exists — if not, scaffold the full folder structure first.
3. Ask the user which asset-loading approach (A or B above) they prefer before writing `watcher.js`.
4. Build and test one layer at a time: background → curved line → person → text → logo.
5. Only add export functionality (`exporter.js`) once the animation preview works correctly.

---

## Out of Scope (for this prototype)

- No user accounts, login, or cloud storage
- No backend server or database
- No direct `.mp4` export (`.webm` is sufficient for prototype validation)
- No drag-and-drop timeline editor (hardcoded timings are fine)
