/**
 * composer.js — Animation Timeline & Canvas Renderer
 *
 * Responsible for:
 *  • Setting canvas dimensions for the active format (16:9 or 1:1).
 *  • Storing loaded assets (images + parsed content).
 *  • Running a requestAnimationFrame loop that draws every frame.
 *  • Applying per-element animation based on elapsed time.
 *  • Playing/pausing background music via an HTMLAudioElement.
 *
 * Layer drawing order (bottom → top):
 *   1. background.png   — full bleed, no animation
 *   2. curvedline.png   — slides up from below + fades in  (0 – 800 ms)
 *   3. person.png       — static, right side
 *   4. title text       — fades + slides from left         (500 – 1200 ms)
 *   5. subtitle text    — fades in                         (1000 – 1600 ms)
 *   6. baseline bar     — slides in from left              (1400 – 2000 ms)
 *   7. logo.png         — slides up from below             (200 – 1000 ms)
 *
 * Public API (on global `Composer` object):
 *   init(canvasElement)
 *   setAssets(images, audioFile, content)
 *   setFormat(formatKey)       // '16x9' | '1x1'
 *   play()
 *   pause()
 *   reset()
 *   getCanvas()
 *   isPlaying()
 *   onComplete(callback)
 */

const Composer = (() => {

  // ── Format definitions ────────────────────────────────────────────────────

  /**
   * Supported output formats and their canvas pixel dimensions.
   * Both formats are always supported; the user toggles between them.
   */
  const FORMATS = {
    '16x9': { width: 1920, height: 1080 },
    '1x1' : { width: 1200, height: 1200 },
    '9x16': { width: 1080, height: 1920 },
  };

  // ── Animation timings (milliseconds) ──────────────────────────────────────

  /**
   * Each entry defines when an element's entrance animation starts and ends.
   * After its endMs the element stays fully visible until the clip ends.
   */
  const TIMINGS = {
    curvedline : { startMs:    0, endMs:  800 },
    logo       : { startMs:  200, endMs: 1000 },
    title      : { startMs:  500, endMs: 1200 },
    subtitle   : { startMs: 1000, endMs: 1600 },
    baseline   : { startMs: 1400, endMs: 2000 },
  };

  /** Total clip length in milliseconds (animations finish at 2 s, clip holds until 8 s). */
  const TOTAL_DURATION_MS = 8000;

  // ── SVG curved-line path (from docs/CurvedLine.svg) ──────────────────────

  /**
   * Path data extracted from docs/CurvedLine.svg (viewBox 0 0 3471.94 1008).
   * Drawn on the canvas with ctx.scale so the shape fills the canvas correctly.
   */
  const CURVED_LINE_PATH   = 'M580.14,911.71h-264.2v-63.91h264.2c54.14,0,79.65-12.7,107.78-36.13,36.73-30.6,76.09-50.97,148.8-50.97l2635.23-.22v62.92l-2635.23,1.21c-54.14,0-79.65,12.7-107.78,36.13-36.73,30.6-76.09,50.98-148.8,50.98Z';
  const CURVED_LINE_SVG_H  = 1008;     // SVG viewBox height (used for uniform scaling)
  const CURVED_LINE_OPACITY = 0.65;    // <g> opacity from the SVG source

  /**
   * Gradient stop positions (0–1) and their opacity values, taken directly
   * from the linearGradient in CurvedLine.svg.
   * The fill colour changes per brand-colour selection; only opacity varies.
   */
  const CURVED_LINE_GRAD = [
    { offset: 0,    alpha: 1.00 },
    { offset: 0.52, alpha: 0.88 },
    { offset: 0.54, alpha: 0.80 },
    { offset: 0.57, alpha: 0.61 },
    { offset: 0.63, alpha: 0.30 },
    { offset: 0.67, alpha: 0.00 },
  ];

  // Gradient start/end x coordinates in SVG units (horizontal gradient, y is constant)
  const CURVED_LINE_GRAD_X1 = 315.93;
  const CURVED_LINE_GRAD_X2 = 3471.94;
  const CURVED_LINE_GRAD_Y  = 836.09;

  // ── Module state ──────────────────────────────────────────────────────────

  let canvasElement      = null;  // HTMLCanvasElement
  let ctx                = null;  // CanvasRenderingContext2D
  let currentFormat      = '16x9';

  // ── Brand colour state (Phase 2) ─────────────────────────────────────────
  // Both values are updated together by the colour picker in the sidebar.
  // Default: Green Corporate (#99cc00).

  /** Colour used for *highlighted* keywords in the title text. */
  let currentHighlightColor = '#99cc00';

  /** Fill colour used for the SVG curved-line element. */
  let currentLineColor      = '#99cc00';
  let currentAssets      = {};    // { background, curvedline, person, logo } — HTMLImageElements
  let currentContent     = null;  // Parsed content: { titleLines, subtitle, baselineLines }
  let currentRawContent  = null;  // Raw content.txt text — kept so format switches can re-parse
  let logoVideoElement   = null;  // HTMLVideoElement for animated logo (logo.mov → WebM VP9)
  let audioElement          = null;  // HTMLAudioElement for background music
  let audioContext          = null;  // AudioContext — created once on first user gesture
  let audioStreamDest       = null;  // MediaStreamDestinationNode — provides capturable audio track
  let animationFrameId   = null;  // ID from requestAnimationFrame
  let animationStartTime = null;  // performance.now() timestamp when play() was called
  let playing            = false;
  let completeCallback   = null;  // Called when the full clip has played through

  // ── Easing & interpolation helpers ───────────────────────────────────────

  /**
   * Clamps a value between min and max.
   * @param {number} value
   * @param {number} min
   * @param {number} max
   * @returns {number}
   */
  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  /**
   * Converts a 6-digit hex colour string and an alpha value to an rgba() string.
   * Used to build canvas linear gradients with the active brand colour.
   *
   * @param {string} hex   - Colour in '#rrggbb' format.
   * @param {number} alpha - Opacity 0–1.
   * @returns {string} e.g. 'rgba(153,204,0,0.88)'
   */
  function hexToRgba(hex, alpha) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }

  /**
   * Linear interpolation between a and b by factor t (0–1).
   * @param {number} a - Start value.
   * @param {number} b - End value.
   * @param {number} t - Progress 0–1.
   * @returns {number}
   */
  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  /**
   * Cubic ease-out: fast start, decelerates to rest.
   * Gives elements a snappy feel when they arrive at their final position.
   * @param {number} t - Linear progress 0–1.
   * @returns {number} Eased progress 0–1.
   */
  function easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
  }

  /**
   * Returns the eased animation progress (0–1) for a given elapsed time
   * and a [startMs, endMs] window.
   * Returns 0 before the window, 1 after it, and an eased value within it.
   *
   * @param {number} elapsedMs - Milliseconds since animation start.
   * @param {number} startMs   - When this element's animation begins.
   * @param {number} endMs     - When it finishes.
   * @returns {number} Eased progress 0–1.
   */
  function getProgress(elapsedMs, startMs, endMs) {
    const linear = clamp((elapsedMs - startMs) / (endMs - startMs), 0, 1);
    return easeOutCubic(linear);
  }

  // ── Layout calculation ────────────────────────────────────────────────────

  /**
   * Computes pixel positions and sizes for every element based on the current
   * canvas dimensions. All values are derived from the 1920 × 1080 reference
   * design, scaled proportionally so the layout works for both formats.
   *
   * @param {number} w - Canvas width in pixels.
   * @param {number} h - Canvas height in pixels.
   * @returns {object} Layout config object.
   */
  function getLayout(w, h) {
    // Scale factors relative to 1920 × 1080 reference
    const sx = w / 1920;
    const sy = h / 1080;

    return {
      // CurvedLine: left side.
      // If the image is full-canvas (1920×1080 type), draw it full-size.
      // If it's a smaller decorative asset, scale its height to ~90% canvas height.
      curvedLine: {
        x            : 0,
        maxDisplayH  : h * 0.9,
      },

      // Portrait (9:16) flag — used to override font sizes and positions that
      // would otherwise be distorted by the large sy scale factor (1920/1080 ≈ 1.78).
      // In portrait mode fonts are sized relative to canvas width instead.
      // isSquare flag used for the 1:1 baseline yTop override.
      ...(h > w ? {
        // ── 9:16 portrait layout (1080 × 1920) ──
        // All values scaled ×1.25 vs. the original portrait baseline so that
        // text and spacing appear proportionally larger on the tall canvas.
        title: {
          x          : 94,
          y          : 375,           // absolute px — upper portion of the tall canvas
          fontSize   : 85,            // 68 × 1.25
          lineHeight : 106,           // 85 × 1.25
          slideOffset: Math.round(100 * sx),
        },
        subtitle: {
          x          : 94,
          fontSize   : 53,            // 42 × 1.25
          gapFromTitle: 81,           // 65 × 1.25
        },
        baseline: {
          x          : 94,
          yTop       : 1063,          // 850 × 1.25 — mid-frame on 1920px canvas
          fontSize   : 60,            // 48 × 1.25
          boxHeight  : 73,            // 58 × 1.25
          lineGap    : Math.round(8  * sy),
          paddingX   : Math.round(14 * sx),
        },
      } : {
        // ── 16:9 and 1:1 layout (scaled from 1920 × 1080 reference) ──
        title: {
          x            : 88  * sx,
          y            : 155 * sy,     // first line baseline (~14% from top)
          fontSize     : Math.round(70 * sy),
          lineHeight   : Math.round(90 * sy),  // 1.28× font size
          slideOffset  : 80  * sx,
        },
        subtitle: {
          x            : 88  * sx,
          fontSize     : Math.round(43 * sy),
          gapFromTitle : Math.round(75 * sy),  // title last-baseline → subtitle baseline
        },
        // Baseline — a LEFT-ALIGNED green box sized to fit its text.
        // In 1:1 format (w === h) yTop is overridden to 600px because the
        // 3-line title pushes the stack lower than in 16:9.
        baseline: {
          x            : 88  * sx,
          yTop         : w === h ? 600 : 460 * sy,
          fontSize     : Math.round(50 * sy),
          boxHeight    : Math.round(55 * sy),
          lineGap      : Math.round(6  * sy),
          paddingX     : Math.round(11 * sx),
        },
      }),

      // Logo: bottom-right corner.
      // Full-canvas transparent PNG → drawn full-size.
      // Small standalone logo → drawn at fallbackWidth in the corner.
      logo: {
        fallbackWidth  : 180 * sx,
        paddingRight   : 50  * sx,
        paddingBottom  : 50  * sy,
      },
    };
  }

  // ── Content parsing ───────────────────────────────────────────────────────

  /**
   * Parses a raw content.txt string into a structured content object.
   * Expected format (one field per line):
   *   TITLE: Your title with *highlighted* words
   *   SUBTITLE: Your subtitle
   *   BASELINE: Your baseline text
   *
   * @param {string} rawText - Contents of content.txt.
   * @returns {{ title: string, subtitle: string, baseline: string,
   *             titleSegments: Array<{text: string, highlight: boolean}> }}
   */
  /**
   * Parses a raw content.txt string into a structured content object,
   * selecting the section that matches the active format.
   *
   * The file supports two section styles:
   *   - Format-specific:  "TITLE 16X9:", "TITLE 1X1:", etc.
   *   - Generic fallback: "TITLE:", "SUBTITLE:", "BASELINE:"
   *
   * Format-specific keys take priority. When a key for the OTHER format is
   * encountered the parser stops accumulating, so sections stay isolated.
   *
   * @param {string} rawText - Contents of content.txt.
   * @param {string} format  - Active format key: '16x9', '1x1', or '9x16'.
   * @returns {{ titleLines: Array, subtitle: string, baselineLines: string[] }}
   */
  function parseContent(rawText, format) {
    const lines     = rawText.split('\n').map(l => l.trim());
    const fmtSuffix = format === '1x1' ? '1X1' : format === '9x16' ? '9X16' : '16X9';

    // Keys for the active format, checked first (insertion order is preserved).
    // Generic keys act as a fallback for files that don't use format suffixes.
    const targetKeyMap = {
      [`TITLE ${fmtSuffix}:`]    : 'title',
      [`SUBTITLE ${fmtSuffix}:`] : 'subtitle',
      [`BASELINE ${fmtSuffix}:`] : 'baseline',
      'TITLE:'                    : 'title',
      'SUBTITLE:'                 : 'subtitle',
      'BASELINE:'                 : 'baseline',
    };

    // All known section headers — used to detect the other format's keys so
    // we can stop accumulating lines into the wrong bucket.
    // IMPORTANT: all three formats must be listed here, otherwise lines from
    // an unlisted format's section leak into the previous bucket.
    const allHeaders = [
      'TITLE 16X9:', 'SUBTITLE 16X9:', 'BASELINE 16X9:',
      'TITLE 1X1:',  'SUBTITLE 1X1:',  'BASELINE 1X1:',
      'TITLE 9X16:', 'SUBTITLE 9X16:', 'BASELINE 9X16:',
      'TITLE:',       'SUBTITLE:',       'BASELINE:',
    ];

    const buckets    = { title: [], subtitle: [], baseline: [] };
    let   currentKey = null;

    for (const line of lines) {
      // Try to match a key for the active format first.
      let matched = false;
      for (const [prefix, bucket] of Object.entries(targetKeyMap)) {
        if (line.startsWith(prefix)) {
          currentKey = bucket;
          const rest = line.slice(prefix.length).trim();
          if (rest) buckets[bucket].push(rest);
          matched = true;
          break;
        }
      }

      if (!matched) {
        if (allHeaders.some(h => line.startsWith(h))) {
          // Header for the other format — stop accumulating until our next key.
          currentKey = null;
        } else if (currentKey && line) {
          // Continuation line for the current bucket.
          buckets[currentKey].push(line);
        }
      }
    }

    // titleLines: one entry per line, each pre-split into highlight segments
    const titleLines    = buckets.title.map(l => parseTitleSegments(l));
    // baselineLines: plain strings, one per line
    const baselineLines = buckets.baseline;
    // subtitle stays single-line (join with space if somehow multi-line)
    const subtitle      = buckets.subtitle.join(' ');

    return { titleLines, subtitle, baselineLines };
  }

  /**
   * Splits a title string into text segments, flagging words wrapped in
   * *asterisks* as highlighted (green).
   *
   * Example:
   *   "Votre *succès* avec *AG*"
   *   → [ {text:'Votre ', highlight:false},
   *        {text:'succès', highlight:true},
   *        {text:' avec ', highlight:false},
   *        {text:'AG',     highlight:true} ]
   *
   * @param {string} title - Raw title string from content.txt.
   * @returns {Array<{text: string, highlight: boolean}>}
   */
  function parseTitleSegments(title) {
    const segments  = [];
    const pattern   = /\*([^*]+)\*/g;
    let   lastIndex = 0;
    let   match;

    while ((match = pattern.exec(title)) !== null) {
      // Normal text before this highlight
      if (match.index > lastIndex) {
        segments.push({ text: title.slice(lastIndex, match.index), highlight: false });
      }
      // Highlighted keyword (without the asterisks)
      segments.push({ text: match[1], highlight: true });
      lastIndex = match.index + match[0].length;
    }

    // Any remaining normal text after the last highlight
    if (lastIndex < title.length) {
      segments.push({ text: title.slice(lastIndex), highlight: false });
    }

    return segments;
  }

  // ── Draw functions (one per layer) ───────────────────────────────────────

  /**
   * Draws an image onto the canvas using "cover" fit — the image is scaled
   * proportionally so it fills the entire canvas without distortion, centred
   * both horizontally and vertically. Any overflow is clipped by the canvas edge.
   *
   * This ensures that for a square 1:1 canvas, a 16:9 source image keeps its
   * correct proportions (equal overshoot on left and right) instead of being
   * stretched to fill the square.
   *
   * @param {HTMLImageElement} img     - The image to draw.
   * @param {number}           w       - Canvas width.
   * @param {number}           h       - Canvas height.
   * @param {number}           xOffset - Extra horizontal shift in pixels applied
   *                                     after centering (negative = shift left).
   *                                     Defaults to 0.
   */
  function drawImageCover(img, w, h, xOffset = 0) {
    const imageAspect  = img.naturalWidth / img.naturalHeight;
    const canvasAspect = w / h;

    let drawW, drawH, offsetX, offsetY;

    if (imageAspect > canvasAspect) {
      // Image is wider than canvas — fit by height, overshoot left/right equally.
      drawH   = h;
      drawW   = h * imageAspect;
      offsetX = (w - drawW) / 2;  // negative → centred overshoot
      offsetY = 0;
    } else {
      // Image is taller than canvas — fit by width, overshoot top/bottom equally.
      drawW   = w;
      drawH   = w / imageAspect;
      offsetX = 0;
      offsetY = (h - drawH) / 2;  // negative → centred overshoot
    }

    // Apply the extra horizontal shift (e.g. to fake a parallax pan).
    ctx.drawImage(img, offsetX + xOffset, offsetY, drawW, drawH);
  }

  /**
   * Layer 1 — Background: draws background.png full-bleed with a slow Ken-Burns
   * zoom from 100% → 110% over 8 000 ms, using an ease-out curve so the zoom
   * starts fast and gradually settles — no hard linear ramp.
   *
   * Ease-out formula: scale = 1 - (1 - t)^3  mapped onto the [1.00, 1.15] range,
   * where t = clamp(elapsedMs / 5000, 0, 1).
   *
   * To keep the zoom centred the canvas is translated to its midpoint, scaled,
   * then translated back before drawing.
   *
   * @param {number} w         - Canvas width.
   * @param {number} h         - Canvas height.
   * @param {number} elapsedMs - Milliseconds elapsed since the animation started.
   */
  function drawBackground(w, h, elapsedMs) {
    // t goes from 0 → 1 over the first 8 seconds, then stays at 1.
    const t = Math.min(elapsedMs / 8000, 1);

    // Ease-out cubic: fast start, decelerates toward the end.
    const eased = 1 - Math.pow(1 - t, 3);

    // Interpolate scale between 1.00 (start) and 1.15 (end).
    // Slower zoom vs. person.png's 1.20 creates a fake parallax depth effect.
    const scale = 1 + eased * 0.15;

    if (currentAssets.background) {
      // Translate to canvas centre, scale, then translate back so the zoom
      // is anchored to the middle of the frame rather than the top-left corner.
      ctx.save();
      ctx.translate(w / 2, h / 2);
      ctx.scale(scale, scale);
      ctx.translate(-w / 2, -h / 2);
      // In 1:1 format shift 15% left; in 9:16 shift 30% left to better frame
      // the subject area of the wide 16:9 source image on the tall canvas.
      const bgXOffset = currentFormat === '1x1' ? -w * 0.15 : currentFormat === '9x16' ? -w * 0.20 : 0;
      drawImageCover(currentAssets.background, w, h, bgXOffset);
      ctx.restore();
    } else {
      // Fallback: solid dark background (no zoom needed)
      ctx.fillStyle = '#1a1a2e';
      ctx.fillRect(0, 0, w, h);
    }
  }

  /**
   * Layer 2 — CurvedLine: draws the SVG path from docs/CurvedLine.svg onto the
   * canvas, filled with a horizontal gradient in the active brand colour.
   * Slides up from below the frame while fading in, over 0 – 800 ms.
   *
   * Approach: the SVG has a viewBox of 3471.94 × 1008. We apply ctx.scale so
   * that the SVG coordinate space maps exactly onto the canvas dimensions, then
   * draw the path and gradient in SVG units. This preserves the exact shape and
   * gradient proportions at any canvas resolution.
   *
   * In 9:16 format the element is shifted 25 % to the left (same offset used
   * by the previous bitmap version) to follow the background/person composition.
   *
   * @param {number} progress - Eased progress 0 (off screen) → 1 (final position).
   * @param {number} w        - Canvas width in pixels.
   * @param {number} h        - Canvas height in pixels.
   */
  function drawCurvedLine(progress, w, h) {
    if (progress === 0) return;

    ctx.save();

    // Use a UNIFORM scale based on canvas height only.
    // The SVG viewBox (3471.94 × 1008) is much wider than the canvas — this is
    // intentional: the shape anchors to the left edge and bleeds off the right,
    // exactly as the original 1920 × 1080 PNG did.
    // Using separate scaleX / scaleY would squish the shape horizontally.
    const scale = h / CURVED_LINE_SVG_H;
    ctx.scale(scale, scale);

    // Align left edge: the path's leftmost point is at x = CURVED_LINE_GRAD_X1
    // (315.93 SVG units). Shifting by that amount places the shape flush with
    // the left edge of the canvas.
    // Format-specific offsets shift the shape further left so the visible
    // portion of the curve suits the composition of each aspect ratio.
    const formatOffset = currentFormat === '9x16' ? (-w * 0.40) / scale
                       : currentFormat === '1x1'  ? (-w * 0.10) / scale
                       : 0;
    ctx.translate(-CURVED_LINE_GRAD_X1 + formatOffset, 0);

    // Slide up animation: the whole SVG-space is translated vertically.
    // finalY = 0 (shape at its designed position); startY = CURVED_LINE_SVG_H
    // (shape sits one full SVG height below, i.e. off the bottom of the canvas).
    const slideY = lerp(CURVED_LINE_SVG_H, 0, progress);
    ctx.translate(0, slideY);

    // Build horizontal linear gradient in SVG-space coordinates using the
    // active brand colour. The stop positions and opacities come directly
    // from the linearGradient in CurvedLine.svg.
    const grad = ctx.createLinearGradient(
      CURVED_LINE_GRAD_X1, CURVED_LINE_GRAD_Y,
      CURVED_LINE_GRAD_X2, CURVED_LINE_GRAD_Y
    );
    CURVED_LINE_GRAD.forEach(stop => {
      grad.addColorStop(stop.offset, hexToRgba(currentLineColor, stop.alpha));
    });

    // Apply the SVG <g> group opacity combined with the fade-in progress.
    ctx.globalAlpha = CURVED_LINE_OPACITY * progress;
    ctx.fillStyle   = grad;

    // Draw the path from the SVG <path d="…"> element.
    ctx.fill(new Path2D(CURVED_LINE_PATH));

    ctx.restore();
  }

  /**
   * Layer 3 — Person: draws person.png as a full-canvas overlay (1920×1080 PNG
   * with transparency, same treatment as background.png). Drawn at 0,0 filling
   * the entire canvas. Animates with a slow Ken-Burns zoom from 100% → 115%
   * over 8 000 ms using the same cubic ease-out curve as the background layer.
   *
   * @param {number} w         - Canvas width.
   * @param {number} h         - Canvas height.
   * @param {number} elapsedMs - Milliseconds elapsed since the animation started.
   */
  function drawPerson(w, h, elapsedMs) {
    if (!currentAssets.person) return;

    // t goes from 0 → 1 over the first 8 seconds, then stays at 1.
    const t = Math.min(elapsedMs / 8000, 1);

    // Ease-out cubic: fast start, decelerates toward the end.
    const eased = 1 - Math.pow(1 - t, 3);

    // Interpolate scale between 1.00 (start) and 1.20 (end).
    // Stronger zoom vs. background's 1.15 creates a fake parallax depth effect.
    const scale = 1 + eased * 0.20;

    // Translate to canvas centre, scale, then translate back so the zoom
    // is anchored to the middle of the frame rather than the top-left corner.
    // In 1:1 format shift 15% left; in 9:16 shift 30% left to match the
    // background offset for a consistent parallax composition.
    const personXOffset = currentFormat === '1x1' ? -w * 0.15 : currentFormat === '9x16' ? -w * 0.30 : 0;

    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.scale(scale, scale);
    ctx.translate(-w / 2, -h / 2);
    drawImageCover(currentAssets.person, w, h, personXOffset);
    ctx.restore();
  }

  /**
   * Layer 4a — Title: white text with green (#D4F9B0) highlighted keywords.
   * Fades in and slides from the left over 500 – 1200 ms.
   *
   * @param {number} progress - Eased progress 0 → 1.
   * @param {number} w        - Canvas width.
   * @param {number} h        - Canvas height.
   */
  /**
   * Draws the title text onto the canvas.
   * Each line receives its own progress value so lines animate in one after another.
   *
   * @param {number[]} lineProgressValues - Array of eased progress (0–1) per title line.
   * @param {number}   w                  - Canvas width.
   * @param {number}   h                  - Canvas height.
   */
  function drawTitle(lineProgressValues, w, h) {
    if (!currentContent) return;

    const layout    = getLayout(w, h);
    const { title } = layout;

    ctx.font         = `italic bold ${title.fontSize}px 'Geogrotesque', sans-serif`;
    ctx.textBaseline = 'alphabetic';

    const lineHeight = title.lineHeight;

    currentContent.titleLines.forEach((segments, lineIndex) => {
      const progress = lineProgressValues[lineIndex] ?? 0;
      if (progress === 0) return; // not yet started — skip this line entirely

      // Each line slides in from the left and fades in independently
      const finalX   = title.x;
      const currentX = lerp(finalX - title.slideOffset, finalX, progress);
      const lineY    = title.y + lineIndex * lineHeight;

      ctx.globalAlpha = progress;

      let drawX = currentX;
      for (const segment of segments) {
        // Use the active brand colour for highlighted keywords; plain white otherwise.
        ctx.fillStyle = segment.highlight ? currentHighlightColor : '#FFFFFF';
        ctx.fillText(segment.text, drawX, lineY);
        drawX += ctx.measureText(segment.text).width;
      }
    });

    ctx.globalAlpha = 1;
  }

  /**
   * Layer 4b — Subtitle: single-colour white text, fades in over 1000 – 1600 ms.
   *
   * @param {number} progress - Eased progress 0 → 1.
   * @param {number} w        - Canvas width.
   * @param {number} h        - Canvas height.
   */
  function drawSubtitle(progress, w, h) {
    if (!currentContent || progress === 0) return;

    const layout       = getLayout(w, h);
    const { title, subtitle } = layout;

    // Compute y dynamically so subtitle always sits below however many title
    // lines are present. gapFromTitle is measured last-title-baseline → subtitle-baseline.
    const numTitleLines = (currentContent.titleLines || []).length;
    const subtitleY     = title.y + (numTitleLines - 1) * title.lineHeight + subtitle.gapFromTitle;

    ctx.globalAlpha  = progress;
    ctx.fillStyle    = '#FFFFFF';
    ctx.font         = `500 ${subtitle.fontSize}px 'Geogrotesque', sans-serif`;
    ctx.textBaseline = 'alphabetic';

    ctx.fillText(currentContent.subtitle, subtitle.x, subtitleY);

    ctx.globalAlpha = 1;
  }

  /**
   * Layer 4c — Baseline bar: a full-width green (#A4CB3F) rectangle with
   * white semibold text centred inside it. Slides in from the left over
   * 1400 – 2000 ms.
   *
   * Each baseline line gets its own progress value so boxes wipe in one after another.
   *
   * @param {number[]} lineProgressValues - Array of eased progress (0–1) per baseline line.
   * @param {number}   w                  - Canvas width.
   * @param {number}   h                  - Canvas height.
   */
  function drawBaseline(lineProgressValues, w, h) {
    if (!currentContent) return;

    const layout       = getLayout(w, h);
    const { baseline } = layout;
    const lines        = currentContent.baselineLines;
    if (lines.length === 0) return;

    ctx.font         = `600 ${baseline.fontSize}px 'Geogrotesque', sans-serif`;
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign    = 'left';

    lines.forEach((line, i) => {
      const progress = lineProgressValues[i] ?? 0;
      if (progress === 0) return; // not yet started — skip

      const lineTextWidth = ctx.measureText(line).width;
      const boxWidth      = lineTextWidth + baseline.paddingX * 2;
      const boxX          = baseline.x;
      const boxY          = baseline.yTop + i * (baseline.boxHeight + baseline.lineGap);

      // Box wipes in from the left
      const revealedWidth = lerp(0, boxWidth, progress);

      // 4 px rounded corners at the 1080p reference height, scaled to canvas.
      const radius = 4 * (h / 1080);

      ctx.save();
      ctx.beginPath();
      ctx.roundRect(boxX, boxY, revealedWidth, baseline.boxHeight, radius);
      ctx.clip();

      ctx.fillStyle = '#A4CB3F';
      ctx.beginPath();
      ctx.roundRect(boxX, boxY, boxWidth, baseline.boxHeight, radius);
      ctx.fill();

      ctx.fillStyle = '#FFFFFF';
      const textX   = boxX + baseline.paddingX;
      const textY   = boxY + baseline.boxHeight / 2 + baseline.fontSize * 0.35;
      ctx.fillText(line, textX, textY);

      ctx.restore();
    });
  }

  /**
   * Layer 5 — Logo: transparent PNG, slides up from below the frame over
   * 200 – 1000 ms.
   *
   * If the logo image is full-canvas size (same logic as CurvedLine), it is
   * drawn as a full-canvas overlay. Otherwise it is placed in the bottom-right
   * corner at a proportional fallback size.
   *
   * @param {number} progress - Eased progress 0 (off screen) → 1 (final position).
   * @param {number} w        - Canvas width.
   * @param {number} h        - Canvas height.
   */
  function drawLogo(progress, w, h) {
    // Prefer the animated video logo (logo.mov) over the static image (logo.png).
    const source = logoVideoElement || currentAssets.logo;
    if (!source || progress === 0) return;

    const layout    = getLayout(w, h);
    const { logo }  = layout;

    // Resolve natural dimensions — video uses videoWidth/videoHeight,
    // image uses naturalWidth/naturalHeight.
    const isVideo = source instanceof HTMLVideoElement;
    const srcW    = isVideo ? source.videoWidth  : source.naturalWidth;
    const srcH    = isVideo ? source.videoHeight : source.naturalHeight;

    // Skip drawing if the video hasn't decoded its first frame yet.
    if (!srcW || !srcH) return;

    let displayW, displayH, drawX, finalY;

    if (srcW >= w * 0.9) {
      // Full-canvas transparent overlay: scale to fill canvas height,
      // anchor bottom-right — horizontal overshoot bleeds off the left.
      // In 9:16 scale to 60% so the logo isn't oversized on the narrow canvas.
      const scale = currentFormat === '9x16' ? 0.60 : 1.0;
      displayH = h * scale;
      displayW = (srcW / srcH) * displayH;
      drawX    = w - displayW;   // right-anchored
      finalY   = h - displayH;   // bottom-anchored
    } else {
      // Small standalone logo mark: scale to fallbackWidth, keep aspect ratio.
      displayW = logo.fallbackWidth;
      displayH = (srcH / srcW) * displayW;
      drawX    = w - displayW - logo.paddingRight;
      finalY   = h - displayH - logo.paddingBottom;
    }

    // Slide up from below: starts just off the canvas bottom, arrives at finalY.
    const startY   = h;
    const currentY = lerp(startY, finalY, progress);

    ctx.drawImage(source, drawX, currentY, displayW, displayH);
  }

  // ── Frame renderer ────────────────────────────────────────────────────────

  /**
   * Draws a single frame of the animation onto the canvas.
   * Called by the animation loop on every requestAnimationFrame tick.
   * Layers are drawn in z-order (background first, logo last).
   *
   * @param {number} elapsedMs - Milliseconds elapsed since the animation started.
   */
  function drawFrame(elapsedMs) {
    const w = canvasElement.width;
    const h = canvasElement.height;

    // Clear the canvas before drawing the new frame
    ctx.clearRect(0, 0, w, h);

    // ── Layer 1: Background ──
    drawBackground(w, h, elapsedMs);

    // ── Layer 2: CurvedLine (0 – 800 ms) ──
    drawCurvedLine(
      getProgress(elapsedMs, TIMINGS.curvedline.startMs, TIMINGS.curvedline.endMs),
      w, h
    );

    // ── Layer 3: Person (static, always visible once assets loaded) ──
    drawPerson(w, h, elapsedMs);

    // ── Layer 4a: Title — each line staggers in 200 ms after the previous ──
    // Line 0: 500 – 1400 ms  |  Line 1: 900 – 1800 ms  |  Line 2: 1300 – 2200 ms …
    // Slide-in duration is 900 ms. Stagger between lines is 400 ms.
    const titleLineCount = (currentContent?.titleLines ?? []).length || 1;
    const titleLineProgressValues = Array.from({ length: titleLineCount }, (_, i) => {
      const lineStart = TIMINGS.title.startMs + i * 400;
      const lineEnd   = lineStart + 900;
      return getProgress(elapsedMs, lineStart, lineEnd);
    });
    drawTitle(titleLineProgressValues, w, h);

    // ── Layer 4b: Subtitle — appears after the last title line ──
    // Starts 400 ms after the last title line begins, giving a natural cascade.
    // Slide-in duration is 900 ms (50% slower than the original 600 ms).
    const subtitleStart = TIMINGS.title.startMs + (titleLineCount - 1) * 400 + 400;
    drawSubtitle(
      getProgress(elapsedMs, subtitleStart, subtitleStart + 900),
      w, h
    );

    // ── Layer 4c: Baseline — starts 400 ms after the subtitle, then each line
    // staggers in 200 ms after the previous ──
    // Slide-in duration is 900 ms (50% slower than the original 600 ms). Stagger between lines is 400 ms.
    const baselineStart     = subtitleStart + 400;
    const baselineLineCount = (currentContent?.baselineLines ?? []).length || 1;
    const baselineLineProgressValues = Array.from({ length: baselineLineCount }, (_, i) => {
      const lineStart = baselineStart + i * 400;
      const lineEnd   = lineStart + 900;
      return getProgress(elapsedMs, lineStart, lineEnd);
    });
    drawBaseline(baselineLineProgressValues, w, h);

    // ── Layer 5: Logo (200 – 1000 ms) ──
    drawLogo(
      getProgress(elapsedMs, TIMINGS.logo.startMs, TIMINGS.logo.endMs),
      w, h
    );
  }

  // ── Animation loop ────────────────────────────────────────────────────────

  /**
   * The main animation loop, driven by requestAnimationFrame.
   * Computes elapsed time, draws the current frame, and either schedules
   * the next tick or fires the completion callback when the clip ends.
   *
   * @param {DOMHighResTimeStamp} timestamp - Current time from rAF.
   */
  function animationLoop(timestamp) {
    if (!playing) return;

    // Record the start time on the very first tick
    if (animationStartTime === null) {
      animationStartTime = timestamp;
    }

    const elapsedMs = timestamp - animationStartTime;

    // Draw the current frame
    drawFrame(elapsedMs);

    if (elapsedMs < TOTAL_DURATION_MS) {
      // Schedule the next frame
      animationFrameId = requestAnimationFrame(animationLoop);
    } else {
      // Clip has finished — draw the final static frame and stop
      drawFrame(TOTAL_DURATION_MS);
      playing = false;
      if (completeCallback) completeCallback();
    }
  }

  // ── Audio helpers ─────────────────────────────────────────────────────────

  /**
   * Creates an HTMLAudioElement for the given music File.
   * Revokes any previously created blob URL to avoid memory leaks.
   *
   * @param {File} audioFile - The music file from the watchfolder.
   */
  function setupAudio(audioFile) {
    // Clean up the previous audio element if one exists
    if (audioElement) {
      audioElement.pause();
      URL.revokeObjectURL(audioElement.src);
      audioElement = null;
    }

    // Reset the stream destination so getAudioStream() rewires on next call
    audioStreamDest = null;

    if (!audioFile) return;

    audioElement      = new Audio();
    audioElement.src  = URL.createObjectURL(audioFile);
    audioElement.loop = false;
  }

  /**
   * Returns a MediaStream containing the music audio track, suitable for
   * mixing into a MediaRecorder alongside the canvas video stream.
   *
   * On first call, creates an AudioContext and routes the HTMLAudioElement
   * through it: audioElement → MediaElementSourceNode → two destinations:
   *   1. audioContext.destination  — so music still plays through speakers
   *   2. MediaStreamDestinationNode — so the audio track can be captured
   *
   * Safe to call multiple times — the graph is only built once per audio file.
   *
   * @returns {MediaStream|null} Audio-only MediaStream, or null if no music is loaded.
   */
  function getAudioStream() {
    if (!audioElement) return null;

    // Build the Web Audio routing graph on first call (or after a new file is loaded).
    if (!audioStreamDest) {
      // AudioContext must be created inside a user-gesture call stack.
      // startRecording() is triggered by a button click, so this is safe.
      if (!audioContext) {
        audioContext = new AudioContext();
      }

      const source = audioContext.createMediaElementSource(audioElement);
      audioStreamDest = audioContext.createMediaStreamDestination();

      // Connect to speakers so audio is audible during preview/export
      source.connect(audioContext.destination);
      // Connect to stream destination so the track can be captured by MediaRecorder
      source.connect(audioStreamDest);
    }

    return audioStreamDest.stream;
  }

  /**
   * Starts audio playback from the beginning.
   * Silently ignores autoplay policy rejections (common in browsers).
   */
  function playAudio() {
    if (!audioElement) return;
    audioElement.currentTime = 0;
    audioElement.play().catch(err => {
      console.warn('[Composer] Audio autoplay blocked:', err.message);
    });
  }

  /**
   * Sets whether the background music loops.
   * Pass false before recording so the export contains exactly one pass of audio.
   * Pass true to restore looping for normal preview playback.
   *
   * @param {boolean} loop
   */
  function setAudioLoop(loop) {
    if (audioElement) audioElement.loop = loop;
  }

  /** Pauses audio playback without resetting position. */
  function pauseAudio() {
    if (audioElement) audioElement.pause();
  }

  /** Stops audio and resets to the beginning. */
  function stopAudio() {
    if (!audioElement) return;
    audioElement.pause();
    audioElement.currentTime = 0;
  }

  // ── Canvas setup ──────────────────────────────────────────────────────────

  /**
   * Applies the canvas pixel dimensions for the active format and triggers a
   * UI resize event so the preview panel can rescale.
   */
  function applyFormatDimensions() {
    const format = FORMATS[currentFormat];
    canvasElement.width  = format.width;
    canvasElement.height = format.height;

    // Notify the UI module that the canvas size changed
    window.dispatchEvent(new CustomEvent('canvas-resized'));
  }

  // ── Font loading ──────────────────────────────────────────────────────────

  /**
   * Pre-loads the three Geogrotesque weights needed for canvas text rendering.
   * Fonts declared in CSS via @font-face are not automatically available to
   * the Canvas API until they have been requested at least once.
   * This function triggers loading and waits for all three weights to be ready.
   *
   * @returns {Promise<void>} Resolves when fonts are ready.
   */
  async function preloadFonts() {
    try {
      await Promise.all([
        document.fonts.load("italic bold 70px 'Geogrotesque'"),
        document.fonts.load("500 43px 'Geogrotesque'"),
        document.fonts.load("600 50px 'Geogrotesque'"),
      ]);
    } catch (err) {
      console.warn('[Composer] Font preload failed — falling back to sans-serif:', err);
    }
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /**
   * Initialises the composer with a canvas element and loads the default format.
   * Must be called before any other method.
   *
   * @param {HTMLCanvasElement} canvas - The preview/export canvas element.
   * @returns {Promise<void>}
   */
  async function init(canvas) {
    canvasElement = canvas;
    ctx           = canvas.getContext('2d');
    applyFormatDimensions();
    await preloadFonts();
  }

  /**
   * Stores loaded assets and parsed content, then draws the first static frame
   * so the user immediately sees a preview.
   *
   * @param {Object.<string, HTMLImageElement>} images - Loaded image map from Watcher.
   * @param {File|null}   audioFile   - Music file (or null).
   * @param {string|null} contentText - Raw content.txt text (or null).
   */
  function setAssets(images, audioFile, contentText) {
    currentAssets     = images || {};

    // If an animated logo video was loaded (logo.mov → WebM VP9), store it
    // separately so drawLogo can prefer it over the static logo.png fallback.
    logoVideoElement  = currentAssets.logoVideo || null;

    currentRawContent = contentText || 'TITLE: Add your *title* here\nSUBTITLE: Add your subtitle\nBASELINE: Your baseline text';
    currentContent    = parseContent(currentRawContent, currentFormat);

    setupAudio(audioFile);

    // Draw the final-state frame immediately (progress=1 for all layers)
    // so the user sees the composed result before pressing Play.
    drawFrame(TOTAL_DURATION_MS);
  }

  /**
   * Switches the active format and redraws.
   *
   * @param {string} formatKey - '16x9' or '1x1'.
   */
  function setFormat(formatKey) {
    if (!FORMATS[formatKey]) {
      console.warn('[Composer] Unknown format:', formatKey);
      return;
    }
    currentFormat = formatKey;
    applyFormatDimensions();

    // Re-parse content for the new format so the correct title/subtitle/baseline
    // section from content.txt is used.
    if (currentRawContent) {
      currentContent = parseContent(currentRawContent, currentFormat);
    }

    // Redraw the current state at the new dimensions
    if (playing) {
      // Keep playing — the loop will draw with the new dimensions automatically
    } else {
      // If assets are loaded, always show the full end-state so the user can
      // immediately see the composed layout for the new format without pressing Play.
      // Fall back to frame 0 (blank canvas) only before any assets are loaded.
      drawFrame(currentContent ? TOTAL_DURATION_MS : 0);
    }
  }

  /**
   * Starts (or restarts) the animation from frame 0.
   * Also starts background music playback.
   */
  function play() {
    // Cancel any running loop before starting a new one
    if (animationFrameId !== null) {
      cancelAnimationFrame(animationFrameId);
    }

    animationStartTime = null; // will be set on the first rAF tick
    playing            = true;

    // Start the logo video from the beginning in sync with the animation.
    if (logoVideoElement) {
      logoVideoElement.currentTime = 0;
      logoVideoElement.play();
    }

    playAudio();
    animationFrameId = requestAnimationFrame(animationLoop);
  }

  /**
   * Pauses the animation at the current frame.
   * Audio is also paused.
   */
  function pause() {
    playing = false;
    if (animationFrameId !== null) {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
    }
    if (logoVideoElement) logoVideoElement.pause();
    pauseAudio();
  }

  /**
   * Resets the animation to frame 0 (the static end-state is shown immediately).
   * Stops audio.
   */
  function reset() {
    pause();
    if (logoVideoElement) logoVideoElement.currentTime = 0;
    stopAudio();
    animationStartTime = null;

    // Draw the fully-animated final frame as a static preview
    drawFrame(TOTAL_DURATION_MS);
  }

  /**
   * Returns the canvas element (used by Exporter to capture a stream).
   * @returns {HTMLCanvasElement}
   */
  function getCanvas() {
    return canvasElement;
  }

  /**
   * Returns true while the animation loop is running.
   * @returns {boolean}
   */
  function isAnimationPlaying() {
    return playing;
  }

  /**
   * Registers a callback to be called when the full clip finishes playing.
   * Used by Exporter to stop recording at the right moment.
   *
   * @param {function} callback
   */
  function onComplete(callback) {
    completeCallback = callback;
  }

  /**
   * Returns the total clip duration in milliseconds.
   * Used by Exporter to set a maximum recording time.
   * @returns {number}
   */
  function getTotalDuration() {
    return TOTAL_DURATION_MS;
  }

  // ── Phase 2: brand colour + direct content API ────────────────────────────

  /**
   * Sets the colour used for *highlighted* title keywords and redraws the
   * current static frame so the change is visible immediately.
   * Called by the colour picker in the sidebar.
   *
   * @param {string} hex - Colour in '#rrggbb' format.
   */
  function setHighlightColor(hex) {
    currentHighlightColor = hex;
    if (!playing) drawFrame(currentContent ? TOTAL_DURATION_MS : 0);
  }

  /**
   * Sets the fill colour for the SVG curved-line element and redraws.
   * Called by the colour picker in the sidebar (usually together with
   * setHighlightColor so both elements share the same brand colour).
   *
   * @param {string} hex - Colour in '#rrggbb' format.
   */
  function setLineColor(hex) {
    currentLineColor = hex;
    if (!playing) drawFrame(currentContent ? TOTAL_DURATION_MS : 0);
  }

  /**
   * Replaces the raw content string (previously sourced from content.txt) with
   * the text entered directly in the sidebar input fields, then re-parses and
   * redraws the current frame.
   *
   * The string must follow the same format as content.txt:
   *   TITLE 16X9: …   SUBTITLE 16X9: …   BASELINE 16X9: …
   *   TITLE 1X1: …    etc.
   *
   * @param {string} rawText - Full content string built from the sidebar fields.
   */
  function setRawContent(rawText) {
    currentRawContent = rawText;
    currentContent    = parseContent(currentRawContent, currentFormat);
    if (!playing) drawFrame(currentContent ? TOTAL_DURATION_MS : 0);
  }

  return {
    init,
    setAssets,
    setFormat,
    play,
    pause,
    reset,
    getCanvas,
    getAudioStream,
    setAudioLoop,
    isPlaying        : isAnimationPlaying,
    onComplete,
    getTotalDuration,
    // Phase 2 — brand colour + direct content
    setHighlightColor,
    setLineColor,
    setRawContent,
  };

})();
