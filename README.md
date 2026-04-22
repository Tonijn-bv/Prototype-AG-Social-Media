# AG Social Media Clips — Prototype

Browser-based animation composer that layers assets (images, text, logo, audio) into short animated clips, exportable as `.mp4` (H.264) or `.webm` video. No server required — runs entirely in the browser as a local file.

**Phase 2 adds:** brand colour picker, sidebar text input fields (replaces `content.txt` editing), and an SVG-based curved line that recolours with the picker.

**Phase 3 adds:** spreadsheet-driven workflow — load a CSV where each row is one clip, navigate rows with ◀ ▶, save edits back, and batch-export all rows × all 3 formats in one go. Lives in [`/phase3/`](phase3/).

---

## Phase 2 — How to run

1. Open `index.html` directly in **Chrome or Edge** (file:// works, no server needed).
2. Click **Load Watch Folder** and select the `watchfolder/` directory.
3. Press **▶ Play** to preview the animation with music.
4. Press **⏺ Record & Export** to capture and download the clip.

---

## Phase 3 — How to run

1. Open `phase3/index.html` in **Chrome or Edge**.
2. Click **Load CSV** and select your spreadsheet (see `phase3/sample-clips.csv` for the format).
3. Click **Load Shared Assets** and select the folder containing `logo.webm`, `music.mp3`, and all background/person images.
4. Use **◀ ▶** to navigate rows — the canvas updates instantly per row.
5. Edit text or colour, then click **Save Row** to keep changes in memory.
6. Click **Export CSV** to download the edited spreadsheet.
7. Click **Batch Export** to record all rows × all 3 formats automatically.

### Phase 3 — CSV format

One row per clip. Author in Excel or Google Sheets and export as `.csv`.

```
name,color,background,person,title_16x9,subtitle_16x9,baseline_16x9,title_1x1,subtitle_1x1,baseline_1x1,title_9x16,subtitle_9x16,baseline_9x16
clip_001,#99cc00,bg_anna.png,person_anna.png,"Your *title*","Subtitle","Baseline",...
```

| Column | Description |
|---|---|
| `name` | Used as the output filename prefix (`clip_001-16x9.mp4`) |
| `color` | Brand hex colour (`#99cc00`) — controls highlighted text and curved line |
| `background` | Filename of the background image in the shared assets folder |
| `person` | Filename of the person image in the shared assets folder |
| `title_16x9` … `baseline_9x16` | Text per field per format — wrap `*words*` to highlight |

Logo, music, and the curved line are **shared** across all rows (loaded once from the assets folder).

> Chrome 130+ and Safari are recommended — both support H.264 MP4 export natively. Older Chrome versions export WebM VP9 instead.

---

## Folder structure

```
project-root/
├── index.html              — main entry point
├── README.md               — this file
├── CLAUDE.md               — Claude Code instructions
├── src/
│   ├── main.js             — bootstrap, wires all modules together
│   ├── composer.js         — canvas renderer + animation timeline
│   ├── exporter.js         — MediaRecorder video export
│   ├── watcher.js          — asset loading (Option A: directory picker)
│   └── ui.js               — format toggle, preview scaling, button state
├── styles/
│   └── main.css            — dark editor UI, @font-face declarations
├── docs/
│   ├── fonts/Geogrotesque Family/  — .otf font files
│   ├── Example-16x9.mp4    — reference clip (do not modify)
│   └── Example-1x1.mp4     — reference clip (do not modify)
└── watchfolder/            — hot-swappable assets
    ├── Background.png       — background image
    ├── CurvedLine.png       — decorative overlay
    ├── Person.png           — person photo (1920×1080 transparent PNG)
    ├── logo.webm            — AG logo animation (WebM VP9 with alpha, from After Effects)
    ├── Music.mp3            — background music (looped during preview, one pass in export)
    └── content.txt          — text content (see format below)
```

---

## content.txt format

The file contains **three separate sections** — one per output format. Each section uses a format suffix (`16X9`, `1X1`, or `9X16`) so the composer picks the correct copy when the format is toggled.

Values can span multiple lines. Lines below a key belong to that key until the next key appears.

```
TITLE 16X9:
Line one of title
*highlighted line two*
SUBTITLE 16X9: Single line subtitle
BASELINE 16X9:
First baseline line
Second baseline line

TITLE 1X1:
Line one
Line two
*highlighted line three*
SUBTITLE 1X1: Single line subtitle
BASELINE 1X1:
First baseline line
Second baseline line

TITLE 9X16:
Line one
Line two
*highlighted line three*
SUBTITLE 9X16: Single line subtitle
BASELINE 9X16:
First baseline line
Second baseline line
```

- Words or entire lines wrapped in `*asterisks*` render in **green (#D4F9B0)**.
- `SUBTITLE` is always single-line (multi-lines are joined with a space).
- `BASELINE` lines each get their own separate green box.
- Generic keys (`TITLE:`, `SUBTITLE:`, `BASELINE:`) are supported as a fallback for files without format suffixes.

---

## Output formats

Toggle between formats in the toolbar before exporting.

| Format | Dimensions     | Filename              | Use case               |
|--------|----------------|-----------------------|------------------------|
| 16:9   | 1920 × 1080 px | `clip-16x9.mp4/.webm` | YouTube / web          |
| 1:1    | 1200 × 1200 px | `clip-1x1.mp4/.webm`  | Instagram / social     |
| 9:16   | 1080 × 1920 px | `clip-9x16.mp4/.webm` | Stories / Reels / TikTok |

The file extension is determined automatically: `.mp4` (H.264) on Chrome 130+ and Safari, `.webm` (VP9) on older browsers.

Each format reads its own content section from `content.txt` and re-parses automatically when the format toggle is switched.

---

## Visual layer order (bottom → top)

1. `Background.png` — cover-fit, Ken-Burns zoom
2. **Curved line (SVG path)** — drawn on canvas from `docs/CurvedLine.svg`, left-anchored, slides up from below + fades in (0–800 ms). Fill colour controlled by the brand colour picker.
3. `Person.png` — cover-fit, Ken-Burns zoom
4. Title text — fades + slides from left, lines stagger in
5. Subtitle text — fades + slides in after last title line
6. Baseline boxes — wipe in from left, lines stagger in
7. `logo.webm` — animated logo, slides up from below (200–1000 ms)

---

## Animation timings

| Element          | Slide-in duration | Stagger between lines |
|------------------|-------------------|-----------------------|
| CurvedLine       | 800 ms            | —                     |
| Title lines      | 900 ms            | 400 ms                |
| Subtitle         | 900 ms            | —                     |
| Baseline lines   | 900 ms            | 400 ms                |
| Logo             | 800 ms            | —                     |

Subtitle starts 400 ms after the last title line begins. Baseline starts 400 ms after the subtitle begins.

---

## Ken-Burns zoom (background & person)

Both `Background.png` and `Person.png` animate with a slow ease-out zoom over the full 8-second clip duration.

| Layer          | Start scale | End scale | Easing         |
|----------------|-------------|-----------|----------------|
| Background.png | 100%        | 115%      | Cubic ease-out |
| Person.png     | 100%        | 120%      | Cubic ease-out |

The 5% difference in end scale creates a **fake parallax effect** — the person appears to move forward relative to the background.

---

## Cover-fit image rendering & horizontal offsets

All full-canvas layers are drawn using **cover fit** — scaled proportionally to fill the canvas height, no distortion. Horizontal position is adjusted per format to better frame the subject area of the 16:9 source images.

### Background.png

| Format | Horizontal position         |
|--------|-----------------------------|
| 16:9   | Centred (no offset)         |
| 1:1    | 15% of canvas width left    |
| 9:16   | 20% of canvas width left    |

### Person.png

| Format | Horizontal position         |
|--------|-----------------------------|
| 16:9   | Centred (no offset)         |
| 1:1    | 15% of canvas width left    |
| 9:16   | 30% of canvas width left    |

The larger offset difference between background (20%) and person (30%) in 9:16 preserves the parallax effect.

### Curved line (SVG)

| Format | Anchor | Extra offset |
|--------|--------|--------------|
| 16:9   | Left   | none         |
| 1:1    | Left   | 10% of canvas width left |
| 9:16   | Left   | 40% of canvas width left |

### Logo.png

| Format | Anchor       | Scale              |
|--------|--------------|--------------------|
| 16:9   | Bottom-right | 100% of canvas height |
| 1:1    | Bottom-right | 100% of canvas height |
| 9:16   | Bottom-right | 60% of canvas height  |

---

## Typography

All text uses **Geogrotesque** (loaded from `docs/fonts/` via `@font-face`), falling back to `sans-serif`.

### 16:9 and 1:1 (scaled from 1920 × 1080 reference)

| Element       | Weight         | Size (1080 ref) | Colour                                      |
|---------------|----------------|-----------------|---------------------------------------------|
| Title         | Bold Italic    | 70 px           | White `#FFFFFF` / Green `#D4F9B0` for `*highlighted*` words |
| Subtitle      | Medium (500)   | 43 px           | White `#FFFFFF`                             |
| Baseline text | SemiBold (600) | 50 px           | White `#FFFFFF` on green `#A4CB3F`          |

### 9:16 (absolute values, sized for 1080px canvas width — scaled ×1.25 vs. original)

| Element       | Weight         | Size   | Colour                                      |
|---------------|----------------|--------|---------------------------------------------|
| Title         | Bold Italic    | 85 px  | White `#FFFFFF` / active brand colour for `*highlighted*` words |
| Subtitle      | Medium (500)   | 53 px  | White `#FFFFFF`                             |
| Baseline text | SemiBold (600) | 60 px  | White `#FFFFFF` on active brand colour      |

Font sizes in 9:16 use absolute pixel values rather than the `sy` scale factor, because `sy = 1920/1080 ≈ 1.78` would produce oversized text on the narrow 1080px canvas. All values are ×1.25 the original portrait baseline for better readability on the tall canvas.

---

## Layout positions

### 16:9 and 1:1 (scaled from 1920 × 1080 reference)

| Element              | 16:9 value                          | 1:1 override                       |
|----------------------|-------------------------------------|------------------------------------|
| Title line 1         | x=88, y=155 (baseline)              | —                                  |
| Title line height    | 90 px                               | —                                  |
| Subtitle gap         | 75 px below last title baseline     | —                                  |
| Baseline yTop        | 460 px (scaled by sy)               | 600 px (absolute on 1200px canvas) |
| Baseline box height  | 55 px (scaled)                      | —                                  |
| Baseline line gap    | 6 px                                | —                                  |
| Baseline paddingX    | 11 px each side                     | —                                  |

### 9:16 (absolute values on 1080 × 1920 canvas — all ×1.25)

| Element              | Value                              |
|----------------------|------------------------------------|
| Text left padding (x)| 94 px                              |
| Title y              | 375 px                             |
| Title line height    | 106 px                             |
| Subtitle gap         | 81 px below last title baseline    |
| Baseline yTop        | 1063 px                            |
| Baseline box height  | 73 px                              |

---

## Baseline boxes — design notes

- Each line of BASELINE text gets its **own separate green box** (`#A4CB3F`).
- Box width auto-sizes to the line's text width + 11 px padding on each side.
- Boxes have **4 px rounded corners** (scaled by `sy`).
- Boxes are left-aligned, stacked vertically with a 6 px gap.
- Text is vertically centred inside each box.
- Animation: each box wipes in from the left individually, staggered 400 ms apart.

---

## Asset loading — Option A

`watcher.js` uses `<input type="file" webkitdirectory>`. The user selects the `watchfolder/` directory; the browser grants access to all files inside.

Filenames are matched **case-insensitively**. Known variants:

| Asset key    | Accepted filenames              | Notes                                      |
|--------------|---------------------------------|--------------------------------------------|
| background   | background.png, backgound.png   |                                            |
| curvedline   | curvedline.png                  |                                            |
| person       | person.png                      |                                            |
| logoVideo    | logo.webm                       | WebM VP9 with alpha — export from AE via fnord plugin |
| music        | music.mp3                       | Loops during preview; one pass in export   |
| content      | content.txt                     |                                            |

---

## Export notes

- Export uses the **MediaRecorder API**.
- **Preferred format: H.264 MP4** (`clip-16x9.mp4`) on Chrome 130+ and Safari. Falls back to WebM VP9 on older browsers. The filename extension is set automatically.
- The animation resets to frame 0 before recording starts.
- Recording stops automatically when the clip finishes (8 seconds total).
- **Audio is included** in the export. Music is routed through the Web Audio API (`AudioContext → MediaElementSourceNode → MediaStreamDestinationNode`) so the audio track is captured alongside the canvas video.
- Music plays **one pass only** — both during export and during normal preview. Audio does not loop, consistent with the visual animation.

---

## Phase 2 features

| Feature | Description |
|---|---|
| Brand colour picker | 8 colour swatches in the sidebar; selected colour controls highlighted title text and the curved line fill |
| Sidebar text inputs | Title, Subtitle and Baseline fields per format (16:9, 1:1, 9:16) replace manual `content.txt` editing |
| Highlight button | Select text in the Title field and press **H** to wrap it in `*asterisks*` for green highlighting |
| SVG curved line | `CurvedLine.png` bitmap replaced by a canvas-drawn SVG path (`docs/CurvedLine.svg`) that recolours live |
| 9:16 text scaling | All 9:16 font sizes and positions scaled ×1.25 for better readability on the tall portrait canvas |
| Stop button | "Reset" button renamed to "Stop" |
| Audio single-pass | Audio no longer loops — one pass only, consistent with the visual animation |

## Known issues / next steps

- No open issues after Phase 2.
