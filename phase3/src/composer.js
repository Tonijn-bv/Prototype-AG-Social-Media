/**
 * composer.js — Animation Timeline & Canvas Renderer (Phase 3)
 *
 * Identical drawing engine to Phase 2, adapted for the spreadsheet workflow:
 *  • Shared assets (logo, music) are loaded once via setSharedAssets().
 *  • Per-row assets (background, person, content, colour) change on every row
 *    navigation via setRowAssets().
 *
 * Layer drawing order (bottom → top):
 *   1. background     — full bleed, Ken-Burns zoom
 *   2. curvedline     — SVG path, slides up + fades in  (0 – 800 ms)
 *   3. person         — full canvas, Ken-Burns zoom
 *   4. title text     — fades + slides from left        (500 – 1200 ms)
 *   5. subtitle text  — fades in after title
 *   6. baseline bar   — slides in from left
 *   7. logo           — slides up from below            (200 – 1000 ms)
 *
 * Public API (on global `Composer` object):
 *   init(canvasElement)
 *   setSharedAssets(logoVideoElement, audioFile)   ← Phase 3
 *   setRowAssets(backgroundImg, personImg, rawContent, colorHex)  ← Phase 3
 *   setFormat(formatKey)       // '16x9' | '1x1' | '9x16'
 *   play()
 *   pause()
 *   reset()
 *   getCanvas()
 *   getAudioStream()
 *   setAudioLoop(bool)
 *   isPlaying()
 *   onComplete(callback)
 *   getTotalDuration()
 *   setHighlightColor(hex)
 *   setLineColor(hex)
 *   setRawContent(rawText)
 */

const Composer = (() => {

  // ── Format definitions ────────────────────────────────────────────────────

  const FORMATS = {
    '16x9': { width: 1920, height: 1080 },
    '1x1' : { width: 1200, height: 1200 },
    '9x16': { width: 1080, height: 1920 },
  };

  // ── Animation timings (milliseconds) ──────────────────────────────────────

  const TIMINGS = {
    curvedline : { startMs:    0, endMs:  800 },
    logo       : { startMs:  200, endMs: 1000 },
    title      : { startMs:  500, endMs: 1200 },
    subtitle   : { startMs: 1000, endMs: 1600 },
    baseline   : { startMs: 1400, endMs: 2000 },
  };

  const TOTAL_DURATION_MS = 8000;

  // ── SVG curved-line path (from docs/CurvedLine.svg) ──────────────────────

  const CURVED_LINE_PATH    = 'M580.14,911.71h-264.2v-63.91h264.2c54.14,0,79.65-12.7,107.78-36.13,36.73-30.6,76.09-50.97,148.8-50.97l2635.23-.22v62.92l-2635.23,1.21c-54.14,0-79.65,12.7-107.78,36.13-36.73,30.6-76.09,50.98-148.8,50.98Z';
  const CURVED_LINE_SVG_H   = 1008;
  const CURVED_LINE_OPACITY = 0.65;

  const CURVED_LINE_GRAD = [
    { offset: 0,    alpha: 1.00 },
    { offset: 0.52, alpha: 0.88 },
    { offset: 0.54, alpha: 0.80 },
    { offset: 0.57, alpha: 0.61 },
    { offset: 0.63, alpha: 0.30 },
    { offset: 0.67, alpha: 0.00 },
  ];

  const CURVED_LINE_GRAD_X1 = 315.93;
  const CURVED_LINE_GRAD_X2 = 3471.94;
  const CURVED_LINE_GRAD_Y  = 836.09;

  // ── Module state ──────────────────────────────────────────────────────────

  let canvasElement      = null;
  let ctx                = null;
  let currentFormat      = '16x9';

  // Colour state — updated per row or by the sidebar colour picker
  let currentHighlightColor = '#99cc00';
  let currentLineColor      = '#99cc00';

  // Per-row visual assets (change on each row navigation)
  let backgroundImg      = null;  // HTMLImageElement
  let personImg          = null;  // HTMLImageElement

  // Shared assets (set once when the assets folder is loaded)
  let logoVideoElement   = null;  // HTMLVideoElement (logo.webm)
  let audioElement       = null;  // HTMLAudioElement (music.mp3)
  let audioContext       = null;  // AudioContext — created on first user gesture
  let audioStreamDest    = null;  // MediaStreamDestinationNode

  let currentContent     = null;  // Parsed content { titleLines, subtitle, baselineLines }
  let currentRawContent  = null;  // Raw content string — re-parsed on format switch

  let animationFrameId   = null;
  let animationStartTime = null;
  let playing            = false;
  let completeCallback   = null;

  // ── Easing & interpolation helpers ───────────────────────────────────────

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  /**
   * Converts a hex colour and alpha value to an rgba() string.
   * @param {string} hex   - '#rrggbb'
   * @param {number} alpha - 0–1
   * @returns {string}
   */
  function hexToRgba(hex, alpha) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
  }

  /**
   * Returns eased animation progress (0–1) for a given elapsed time and window.
   * @param {number} elapsedMs
   * @param {number} startMs
   * @param {number} endMs
   * @returns {number}
   */
  function getProgress(elapsedMs, startMs, endMs) {
    const linear = clamp((elapsedMs - startMs) / (endMs - startMs), 0, 1);
    return easeOutCubic(linear);
  }

  // ── Layout calculation ────────────────────────────────────────────────────

  /**
   * Returns pixel positions and sizes for every element based on canvas dimensions.
   * Portrait (9:16) values are ×1.25 the original baseline for better readability.
   *
   * @param {number} w - Canvas width.
   * @param {number} h - Canvas height.
   * @returns {object}
   */
  function getLayout(w, h) {
    const sx = w / 1920;
    const sy = h / 1080;

    return {
      curvedLine: {
        x          : 0,
        maxDisplayH: h * 0.9,
      },

      ...(h > w ? {
        // ── 9:16 portrait layout — all values ×1.25 ──
        title: {
          x          : 94,
          y          : 375,
          fontSize   : 85,
          lineHeight : 106,
          slideOffset: Math.round(100 * sx),
        },
        subtitle: {
          x          : 94,
          fontSize   : 53,
          gapFromTitle: 81,
        },
        baseline: {
          x          : 94,
          yTop       : 1063,
          fontSize   : 60,
          boxHeight  : 73,
          lineGap    : Math.round(8  * sy),
          paddingX   : Math.round(14 * sx),
        },
      } : {
        // ── 16:9 and 1:1 layout (scaled from 1920 × 1080 reference) ──
        title: {
          x          : 88  * sx,
          y          : 155 * sy,
          fontSize   : Math.round(70 * sy),
          lineHeight : Math.round(90 * sy),
          slideOffset: 80  * sx,
        },
        subtitle: {
          x          : 88  * sx,
          fontSize   : Math.round(43 * sy),
          gapFromTitle: Math.round(75 * sy),
        },
        baseline: {
          x          : 88  * sx,
          yTop       : w === h ? 600 : 460 * sy,
          fontSize   : Math.round(50 * sy),
          boxHeight  : Math.round(55 * sy),
          lineGap    : Math.round(6  * sy),
          paddingX   : Math.round(11 * sx),
        },
      }),

      logo: {
        fallbackWidth : 180 * sx,
        paddingRight  : 50  * sx,
        paddingBottom : 50  * sy,
      },
    };
  }

  // ── Content parsing ───────────────────────────────────────────────────────

  /**
   * Parses the raw content string, selecting the section for the active format.
   * Supports format-specific keys (TITLE 16X9:) and generic fallback (TITLE:).
   *
   * @param {string} rawText - Multi-line content string.
   * @param {string} format  - '16x9', '1x1', or '9x16'.
   * @returns {{ titleLines: Array, subtitle: string, baselineLines: string[] }}
   */
  function parseContent(rawText, format) {
    const lines     = rawText.split('\n').map(l => l.trim());
    const fmtSuffix = format === '1x1' ? '1X1' : format === '9x16' ? '9X16' : '16X9';

    const targetKeyMap = {
      [`TITLE ${fmtSuffix}:`]    : 'title',
      [`SUBTITLE ${fmtSuffix}:`] : 'subtitle',
      [`BASELINE ${fmtSuffix}:`] : 'baseline',
      'TITLE:'                    : 'title',
      'SUBTITLE:'                 : 'subtitle',
      'BASELINE:'                 : 'baseline',
    };

    const allHeaders = [
      'TITLE 16X9:', 'SUBTITLE 16X9:', 'BASELINE 16X9:',
      'TITLE 1X1:',  'SUBTITLE 1X1:',  'BASELINE 1X1:',
      'TITLE 9X16:', 'SUBTITLE 9X16:', 'BASELINE 9X16:',
      'TITLE:',       'SUBTITLE:',       'BASELINE:',
    ];

    const buckets    = { title: [], subtitle: [], baseline: [] };
    let   currentKey = null;

    for (const line of lines) {
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
          currentKey = null;
        } else if (currentKey && line) {
          buckets[currentKey].push(line);
        }
      }
    }

    const titleLines    = buckets.title.map(l => parseTitleSegments(l));
    const baselineLines = buckets.baseline;
    const subtitle      = buckets.subtitle.join(' ');

    return { titleLines, subtitle, baselineLines };
  }

  /**
   * Splits a title string into highlight segments.
   * Words wrapped in *asterisks* are flagged as highlighted.
   *
   * @param {string} title
   * @returns {Array<{text: string, highlight: boolean}>}
   */
  function parseTitleSegments(title) {
    const segments  = [];
    const pattern   = /\*([^*]+)\*/g;
    let   lastIndex = 0;
    let   match;

    while ((match = pattern.exec(title)) !== null) {
      if (match.index > lastIndex) {
        segments.push({ text: title.slice(lastIndex, match.index), highlight: false });
      }
      segments.push({ text: match[1], highlight: true });
      lastIndex = match.index + match[0].length;
    }

    if (lastIndex < title.length) {
      segments.push({ text: title.slice(lastIndex), highlight: false });
    }

    return segments;
  }

  // ── Draw functions (one per layer) ───────────────────────────────────────

  /**
   * Draws an image using "cover" fit — scaled to fill the canvas, centred.
   * Any overflow is clipped by the canvas edge.
   *
   * @param {HTMLImageElement} img
   * @param {number} w
   * @param {number} h
   * @param {number} xOffset - Extra horizontal shift (negative = left).
   */
  function drawImageCover(img, w, h, xOffset = 0) {
    const imageAspect  = img.naturalWidth / img.naturalHeight;
    const canvasAspect = w / h;

    let drawW, drawH, offsetX, offsetY;

    if (imageAspect > canvasAspect) {
      drawH   = h;
      drawW   = h * imageAspect;
      offsetX = (w - drawW) / 2;
      offsetY = 0;
    } else {
      drawW   = w;
      drawH   = w / imageAspect;
      offsetX = 0;
      offsetY = (h - drawH) / 2;
    }

    ctx.drawImage(img, offsetX + xOffset, offsetY, drawW, drawH);
  }

  /**
   * Layer 1 — Background: cover-fit with Ken-Burns zoom 100% → 115% over 8 s.
   *
   * @param {number} w
   * @param {number} h
   * @param {number} elapsedMs
   */
  function drawBackground(w, h, elapsedMs) {
    const t     = Math.min(elapsedMs / 8000, 1);
    const eased = 1 - Math.pow(1 - t, 3);
    const scale = 1 + eased * 0.15;

    if (backgroundImg) {
      ctx.save();
      ctx.translate(w / 2, h / 2);
      ctx.scale(scale, scale);
      ctx.translate(-w / 2, -h / 2);
      const bgXOffset = currentFormat === '1x1' ? -w * 0.15 : currentFormat === '9x16' ? -w * 0.20 : 0;
      drawImageCover(backgroundImg, w, h, bgXOffset);
      ctx.restore();
    } else {
      ctx.fillStyle = '#1a1a2e';
      ctx.fillRect(0, 0, w, h);
    }
  }

  /**
   * Layer 2 — Curved line: SVG path drawn on canvas, slides up + fades in over 0–800 ms.
   * Fill colour uses the active brand colour with the original SVG gradient stops.
   *
   * @param {number} progress - 0–1
   * @param {number} w
   * @param {number} h
   */
  function drawCurvedLine(progress, w, h) {
    if (progress === 0) return;

    ctx.save();

    // Uniform scale — the SVG is intentionally wider than the canvas and bleeds right.
    const scale = h / CURVED_LINE_SVG_H;
    ctx.scale(scale, scale);

    // Align left edge (path starts at x=315.93 in SVG space) + format offset.
    const formatOffset = currentFormat === '9x16' ? (-w * 0.40) / scale
                       : currentFormat === '1x1'  ? (-w * 0.10) / scale
                       : 0;
    ctx.translate(-CURVED_LINE_GRAD_X1 + formatOffset, 0);

    // Slide up from below the canvas bottom.
    const slideY = lerp(CURVED_LINE_SVG_H, 0, progress);
    ctx.translate(0, slideY);

    const grad = ctx.createLinearGradient(
      CURVED_LINE_GRAD_X1, CURVED_LINE_GRAD_Y,
      CURVED_LINE_GRAD_X2, CURVED_LINE_GRAD_Y
    );
    CURVED_LINE_GRAD.forEach(stop => {
      grad.addColorStop(stop.offset, hexToRgba(currentLineColor, stop.alpha));
    });

    ctx.globalAlpha = CURVED_LINE_OPACITY * progress;
    ctx.fillStyle   = grad;
    ctx.fill(new Path2D(CURVED_LINE_PATH));

    ctx.restore();
  }

  /**
   * Layer 3 — Person: cover-fit with Ken-Burns zoom 100% → 120% over 8 s.
   *
   * @param {number} w
   * @param {number} h
   * @param {number} elapsedMs
   */
  function drawPerson(w, h, elapsedMs) {
    if (!personImg) return;

    const t     = Math.min(elapsedMs / 8000, 1);
    const eased = 1 - Math.pow(1 - t, 3);
    const scale = 1 + eased * 0.20;

    const personXOffset = currentFormat === '1x1' ? -w * 0.15 : currentFormat === '9x16' ? -w * 0.30 : 0;

    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.scale(scale, scale);
    ctx.translate(-w / 2, -h / 2);
    drawImageCover(personImg, w, h, personXOffset);
    ctx.restore();
  }

  /**
   * Layer 4a — Title: each line fades + slides from the left independently.
   *
   * @param {number[]} lineProgressValues
   * @param {number} w
   * @param {number} h
   */
  function drawTitle(lineProgressValues, w, h) {
    if (!currentContent) return;

    const layout    = getLayout(w, h);
    const { title } = layout;

    ctx.font         = `italic bold ${title.fontSize}px 'Geogrotesque', sans-serif`;
    ctx.textBaseline = 'alphabetic';

    currentContent.titleLines.forEach((segments, lineIndex) => {
      const progress = lineProgressValues[lineIndex] ?? 0;
      if (progress === 0) return;

      const finalX   = title.x;
      const currentX = lerp(finalX - title.slideOffset, finalX, progress);
      const lineY    = title.y + lineIndex * title.lineHeight;

      ctx.globalAlpha = progress;

      let drawX = currentX;
      for (const segment of segments) {
        ctx.fillStyle = segment.highlight ? currentHighlightColor : '#FFFFFF';
        ctx.fillText(segment.text, drawX, lineY);
        drawX += ctx.measureText(segment.text).width;
      }
    });

    ctx.globalAlpha = 1;
  }

  /**
   * Layer 4b — Subtitle: fades in after the last title line.
   *
   * @param {number} progress
   * @param {number} w
   * @param {number} h
   */
  function drawSubtitle(progress, w, h) {
    if (!currentContent || progress === 0) return;

    const layout            = getLayout(w, h);
    const { title, subtitle } = layout;
    const numTitleLines     = (currentContent.titleLines || []).length;
    const subtitleY         = title.y + (numTitleLines - 1) * title.lineHeight + subtitle.gapFromTitle;

    ctx.globalAlpha  = progress;
    ctx.fillStyle    = '#FFFFFF';
    ctx.font         = `500 ${subtitle.fontSize}px 'Geogrotesque', sans-serif`;
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(currentContent.subtitle, subtitle.x, subtitleY);
    ctx.globalAlpha  = 1;
  }

  /**
   * Layer 4c — Baseline: each line gets its own green box that wipes in from the left.
   *
   * @param {number[]} lineProgressValues
   * @param {number} w
   * @param {number} h
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
      if (progress === 0) return;

      const lineTextWidth = ctx.measureText(line).width;
      const boxWidth      = lineTextWidth + baseline.paddingX * 2;
      const boxX          = baseline.x;
      const boxY          = baseline.yTop + i * (baseline.boxHeight + baseline.lineGap);
      const revealedWidth = lerp(0, boxWidth, progress);
      const radius        = 4 * (h / 1080);

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
   * Layer 5 — Logo: slides up from below the canvas over 200–1000 ms.
   * Prefers the animated video element; falls back to a static image.
   *
   * @param {number} progress
   * @param {number} w
   * @param {number} h
   */
  function drawLogo(progress, w, h) {
    const source = logoVideoElement;
    if (!source || progress === 0) return;

    const layout   = getLayout(w, h);
    const { logo } = layout;

    const isVideo = source instanceof HTMLVideoElement;
    const srcW    = isVideo ? source.videoWidth  : source.naturalWidth;
    const srcH    = isVideo ? source.videoHeight : source.naturalHeight;
    if (!srcW || !srcH) return;

    let displayW, displayH, drawX, finalY;

    if (srcW >= w * 0.9) {
      const scale = currentFormat === '9x16' ? 0.60 : 1.0;
      displayH = h * scale;
      displayW = (srcW / srcH) * displayH;
      drawX    = w - displayW;
      finalY   = h - displayH;
    } else {
      displayW = logo.fallbackWidth;
      displayH = (srcH / srcW) * displayW;
      drawX    = w - displayW - logo.paddingRight;
      finalY   = h - displayH - logo.paddingBottom;
    }

    const currentY = lerp(h, finalY, progress);
    ctx.drawImage(source, drawX, currentY, displayW, displayH);
  }

  // ── Frame renderer ────────────────────────────────────────────────────────

  /**
   * Draws a single frame. All layers are composited in z-order.
   *
   * @param {number} elapsedMs
   */
  function drawFrame(elapsedMs) {
    const w = canvasElement.width;
    const h = canvasElement.height;

    ctx.clearRect(0, 0, w, h);

    drawBackground(w, h, elapsedMs);

    drawCurvedLine(
      getProgress(elapsedMs, TIMINGS.curvedline.startMs, TIMINGS.curvedline.endMs),
      w, h
    );

    drawPerson(w, h, elapsedMs);

    const titleLineCount = (currentContent?.titleLines ?? []).length || 1;
    const titleLineProgressValues = Array.from({ length: titleLineCount }, (_, i) => {
      const lineStart = TIMINGS.title.startMs + i * 400;
      return getProgress(elapsedMs, lineStart, lineStart + 900);
    });
    drawTitle(titleLineProgressValues, w, h);

    const subtitleStart = TIMINGS.title.startMs + (titleLineCount - 1) * 400 + 400;
    drawSubtitle(getProgress(elapsedMs, subtitleStart, subtitleStart + 900), w, h);

    const baselineStart     = subtitleStart + 400;
    const baselineLineCount = (currentContent?.baselineLines ?? []).length || 1;
    const baselineLineProgressValues = Array.from({ length: baselineLineCount }, (_, i) => {
      const lineStart = baselineStart + i * 400;
      return getProgress(elapsedMs, lineStart, lineStart + 900);
    });
    drawBaseline(baselineLineProgressValues, w, h);

    drawLogo(
      getProgress(elapsedMs, TIMINGS.logo.startMs, TIMINGS.logo.endMs),
      w, h
    );
  }

  // ── Animation loop ────────────────────────────────────────────────────────

  /**
   * Main rAF loop — computes elapsed time, draws the frame, schedules the next
   * tick or fires the completion callback.
   *
   * @param {DOMHighResTimeStamp} timestamp
   */
  function animationLoop(timestamp) {
    if (!playing) return;

    if (animationStartTime === null) animationStartTime = timestamp;

    const elapsedMs = timestamp - animationStartTime;
    drawFrame(elapsedMs);

    if (elapsedMs < TOTAL_DURATION_MS) {
      animationFrameId = requestAnimationFrame(animationLoop);
    } else {
      drawFrame(TOTAL_DURATION_MS);
      playing = false;
      if (completeCallback) completeCallback();
    }
  }

  // ── Audio helpers ─────────────────────────────────────────────────────────

  /**
   * Sets up a new HTMLAudioElement for the given music file.
   * Should only be called once (when shared assets are loaded).
   * Revokes any previous blob URL.
   *
   * @param {File} audioFile
   */
  function setupAudio(audioFile) {
    if (audioElement) {
      audioElement.pause();
      URL.revokeObjectURL(audioElement.src);
      audioElement = null;
    }
    audioStreamDest = null;

    if (!audioFile) return;

    audioElement      = new Audio();
    audioElement.src  = URL.createObjectURL(audioFile);
    audioElement.loop = false;
  }

  /**
   * Returns a MediaStream containing the music audio track, for mixing into
   * a MediaRecorder alongside the canvas stream. Built once per audio file.
   *
   * @returns {MediaStream|null}
   */
  function getAudioStream() {
    if (!audioElement) return null;

    if (!audioStreamDest) {
      if (!audioContext) audioContext = new AudioContext();
      const source    = audioContext.createMediaElementSource(audioElement);
      audioStreamDest = audioContext.createMediaStreamDestination();
      source.connect(audioContext.destination);
      source.connect(audioStreamDest);
    }

    return audioStreamDest.stream;
  }

  function playAudio() {
    if (!audioElement) return;
    audioElement.currentTime = 0;
    audioElement.play().catch(err => {
      console.warn('[Composer] Audio autoplay blocked:', err.message);
    });
  }

  /**
   * Controls audio looping. Set to false during export (single pass).
   * @param {boolean} loop
   */
  function setAudioLoop(loop) {
    if (audioElement) audioElement.loop = loop;
  }

  function pauseAudio() {
    if (audioElement) audioElement.pause();
  }

  function stopAudio() {
    if (!audioElement) return;
    audioElement.pause();
    audioElement.currentTime = 0;
  }

  // ── Canvas setup ──────────────────────────────────────────────────────────

  /**
   * Applies canvas pixel dimensions for the active format and fires a
   * 'canvas-resized' event so the preview panel rescales itself.
   */
  function applyFormatDimensions() {
    const format = FORMATS[currentFormat];
    canvasElement.width  = format.width;
    canvasElement.height = format.height;
    window.dispatchEvent(new CustomEvent('canvas-resized'));
  }

  // ── Font loading ──────────────────────────────────────────────────────────

  /**
   * Pre-loads Geogrotesque weights needed for canvas text rendering.
   * The Canvas API does not use CSS fonts until they have been requested once.
   *
   * @returns {Promise<void>}
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
   * Initialises the composer. Must be called once before everything else.
   *
   * @param {HTMLCanvasElement} canvas
   * @returns {Promise<void>}
   */
  async function init(canvas) {
    canvasElement = canvas;
    ctx           = canvas.getContext('2d');
    applyFormatDimensions();
    await preloadFonts();
  }

  /**
   * Stores the shared assets that stay constant across all rows:
   * the animated logo video and the background music file.
   * Call this once when the shared assets folder is loaded.
   *
   * @param {HTMLVideoElement|null} logoVideo - Animated logo (logo.webm).
   * @param {File|null}            audioFile - Background music file.
   */
  function setSharedAssets(logoVideo, audioFile) {
    logoVideoElement = logoVideo;
    setupAudio(audioFile);
  }

  /**
   * Loads the per-row visual assets and redraws the end-state frame.
   * Call this whenever the user navigates to a new spreadsheet row.
   *
   * @param {HTMLImageElement|null} background - The row's background image.
   * @param {HTMLImageElement|null} person     - The row's person image.
   * @param {string}               rawContent  - Content string for all formats.
   * @param {string}               colorHex   - Brand colour hex (#rrggbb).
   */
  function setRowAssets(background, person, rawContent, colorHex) {
    backgroundImg         = background;
    personImg             = person;
    currentRawContent     = rawContent || 'TITLE: Add your *title*\nSUBTITLE: Subtitle\nBASELINE: Baseline';
    currentContent        = parseContent(currentRawContent, currentFormat);
    currentHighlightColor = colorHex || '#99cc00';
    currentLineColor      = colorHex || '#99cc00';

    // Show the end-state frame immediately so the user sees the composition.
    drawFrame(TOTAL_DURATION_MS);
  }

  /**
   * Switches the active format, redraws the end-state frame.
   *
   * @param {string} formatKey - '16x9', '1x1', or '9x16'.
   */
  function setFormat(formatKey) {
    if (!FORMATS[formatKey]) {
      console.warn('[Composer] Unknown format:', formatKey);
      return;
    }
    currentFormat = formatKey;
    applyFormatDimensions();

    if (currentRawContent) {
      currentContent = parseContent(currentRawContent, currentFormat);
    }

    if (!playing) {
      drawFrame(currentContent ? TOTAL_DURATION_MS : 0);
    }
  }

  /**
   * Starts (or restarts) the animation from frame 0.
   * Also starts logo video and music playback.
   */
  function play() {
    if (animationFrameId !== null) cancelAnimationFrame(animationFrameId);

    animationStartTime = null;
    playing            = true;

    if (logoVideoElement) {
      logoVideoElement.currentTime = 0;
      logoVideoElement.play();
    }

    playAudio();
    animationFrameId = requestAnimationFrame(animationLoop);
  }

  /**
   * Pauses the animation at the current frame.
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
   * Stops the animation and returns to the static end-state frame.
   */
  function reset() {
    pause();
    if (logoVideoElement) logoVideoElement.currentTime = 0;
    stopAudio();
    animationStartTime = null;
    drawFrame(TOTAL_DURATION_MS);
  }

  function getCanvas()    { return canvasElement; }
  function isAnimationPlaying() { return playing; }
  function onComplete(cb) { completeCallback = cb; }
  function getTotalDuration()   { return TOTAL_DURATION_MS; }

  /**
   * Updates the highlight colour and redraws. Also updates the line colour
   * (both always share the same brand colour in Phase 3).
   *
   * @param {string} hex
   */
  function setHighlightColor(hex) {
    currentHighlightColor = hex;
    if (!playing) drawFrame(currentContent ? TOTAL_DURATION_MS : 0);
  }

  /**
   * Updates the curved-line fill colour and redraws.
   *
   * @param {string} hex
   */
  function setLineColor(hex) {
    currentLineColor = hex;
    if (!playing) drawFrame(currentContent ? TOTAL_DURATION_MS : 0);
  }

  /**
   * Replaces the content string, re-parses, and redraws.
   * Called by the sidebar text fields on every keystroke.
   *
   * @param {string} rawText
   */
  function setRawContent(rawText) {
    currentRawContent = rawText;
    currentContent    = parseContent(currentRawContent, currentFormat);
    if (!playing) drawFrame(currentContent ? TOTAL_DURATION_MS : 0);
  }

  return {
    init,
    setSharedAssets,
    setRowAssets,
    setFormat,
    play,
    pause,
    reset,
    getCanvas,
    getAudioStream,
    setAudioLoop,
    isPlaying      : isAnimationPlaying,
    onComplete,
    getTotalDuration,
    setHighlightColor,
    setLineColor,
    setRawContent,
  };

})();
