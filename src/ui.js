/**
 * ui.js — Preview UI, Controls & Sidebar
 *
 * Manages:
 *  • Format toggle (16:9 / 1:1 / 9:16) — updates button state, switches canvas
 *    dimensions, and keeps the sidebar content tab in sync.
 *  • Canvas scaling — keeps the preview canvas fitted inside the container at
 *    all times (on load, format switch, and window resize).
 *  • Playback controls — Play and Reset buttons.
 *  • Export controls — Record & Export button with recording state indicator.
 *  • Status bar — displays messages from any module.
 *  • Button enable/disable — disabled until assets are loaded.
 *
 *  Phase 2 additions:
 *  • Colour picker — 8 brand-colour swatches that update the canvas immediately.
 *  • Content text fields — title/subtitle/baseline per format, with a Highlight
 *    button that wraps the current text selection in *asterisks*.
 *  • populateFromContent() — pre-fills all text fields from a raw content string
 *    (called by main.js after the watchfolder is loaded).
 *
 * Public API (on global `UI` object):
 *   UI.init()
 *   UI.setStatus(message)
 *   UI.enableControls()
 *   UI.getActiveFormat()
 *   UI.populateFromContent(rawText)   ← Phase 2
 */

const UI = (() => {

  // ── DOM references ────────────────────────────────────────────────────────
  // Resolved once in init() for performance.

  let btn16x9          = null;
  let btn1x1           = null;
  let btn9x16          = null;
  let btnPlay          = null;
  let btnReset         = null;
  let btnRecord        = null;
  let statusText       = null;
  let previewCanvas    = null;
  let previewContainer = null;
  let folderInput      = null;

  // ── Active state ──────────────────────────────────────────────────────────

  /** Currently active canvas format key. */
  let activeFormat = '16x9';

  /** Helper: returns a map of all three format buttons for bulk operations. */
  const formatButtons = () => ({ '16x9': btn16x9, '1x1': btn1x1, '9x16': btn9x16 });

  // ── Status bar ────────────────────────────────────────────────────────────

  /**
   * Updates the text shown in the status bar at the bottom of the page.
   * Any module can call UI.setStatus() to report progress or errors.
   *
   * @param {string} message - Human-readable status message.
   */
  function setStatus(message) {
    if (statusText) statusText.textContent = message;
  }

  // ── Canvas scaling ────────────────────────────────────────────────────────

  /**
   * Scales the canvas CSS display size to fit inside the preview container
   * while preserving the canvas's pixel aspect ratio.
   *
   * The canvas *attributes* set rendering resolution (e.g. 1920 × 1080).
   * We override the *CSS* width/height to scale it down visually.
   */
  function scaleCanvasToContainer() {
    if (!previewCanvas || !previewContainer) return;

    const PADDING         = 32;
    const containerW      = previewContainer.clientWidth  - PADDING;
    const containerH      = previewContainer.clientHeight - PADDING;
    const canvasW         = previewCanvas.width;
    const canvasH         = previewCanvas.height;
    const canvasAspect    = canvasW / canvasH;
    const containerAspect = containerW / containerH;

    let displayW, displayH;

    if (canvasAspect > containerAspect) {
      // Canvas is wider than the container — fit by width
      displayW = containerW;
      displayH = containerW / canvasAspect;
    } else {
      // Canvas is taller (or same) — fit by height
      displayH = containerH;
      displayW = containerH * canvasAspect;
    }

    previewCanvas.style.width  = `${Math.round(displayW)}px`;
    previewCanvas.style.height = `${Math.round(displayH)}px`;
  }

  // ── Format toggle ─────────────────────────────────────────────────────────

  /**
   * Switches the active canvas format.
   * Updates toolbar button styles, resizes the canvas, rescales the preview,
   * and keeps the sidebar content tab in sync so the user always edits the
   * text for the format they are currently previewing.
   *
   * @param {string} format - '16x9', '1x1', or '9x16'.
   */
  function switchFormat(format) {
    activeFormat = format;

    // Update toolbar format button active state
    const btns = formatButtons();
    Object.entries(btns).forEach(([key, btn]) => {
      if (btn) btn.classList.toggle('active', key === format);
    });

    // Tell the Composer to resize the canvas for the new format
    Composer.setFormat(format);

    // Re-fit the (now differently sized) canvas in the preview area
    scaleCanvasToContainer();

    // Keep the sidebar content tab in sync
    syncContentTab(format);

    const labels = { '16x9': '1920×1080 (16:9)', '1x1': '1200×1200 (1:1)', '9x16': '1080×1920 (9:16)' };
    setStatus(`Format: ${labels[format] ?? format}`);
  }

  // ── Playback state helpers ─────────────────────────────────────────────────

  /** Puts all controls into "playing" state — disables Play and Record. */
  function setPlayingState() {
    btnPlay.disabled   = true;
    btnReset.disabled  = false;
    btnRecord.disabled = true;
  }

  /** Puts all controls back into "idle" state — enables Play and Record. */
  function setIdleState() {
    btnPlay.disabled   = false;
    btnReset.disabled  = false;
    btnRecord.disabled = false;
  }

  /**
   * Puts all controls into "recording" state — disables everything except the
   * status bar so the user can see progress.
   */
  function setRecordingState() {
    btnPlay.disabled   = true;
    btnReset.disabled  = true;
    btnRecord.disabled = true;
    btnRecord.classList.add('recording');
    // Disable all format buttons during recording
    Object.values(formatButtons()).forEach(btn => { if (btn) btn.disabled = true; });
  }

  /** Exits recording state — re-enables all controls. */
  function clearRecordingState() {
    btnRecord.classList.remove('recording');
    Object.values(formatButtons()).forEach(btn => { if (btn) btn.disabled = false; });
    setIdleState();
  }

  // ── Button enable / disable ───────────────────────────────────────────────

  /**
   * Enables the playback and export buttons.
   * Called by main.js after assets have been loaded successfully.
   */
  function enableControls() {
    btnPlay.disabled   = false;
    btnReset.disabled  = false;
    btnRecord.disabled = false;

    // Show the canvas and hide the placeholder
    previewCanvas.classList.add('ready');
  }

  // ── Phase 2: Colour picker ────────────────────────────────────────────────

  /**
   * Activates the given swatch, updates the hex label, and pushes both
   * the highlight colour and the curved-line colour to the Composer.
   * Both elements always share the same active brand colour.
   *
   * @param {HTMLButtonElement} swatch - The swatch element that was clicked.
   */
  function activateSwatch(swatch) {
    const color = swatch.dataset.color;

    // Mark the clicked swatch as active; deactivate all others
    document.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('active'));
    swatch.classList.add('active');

    // Update the hex label and the small colour dot
    const hexLabel = document.getElementById('selected-color-hex');
    const colorDot = document.getElementById('selected-color-dot');
    if (hexLabel) hexLabel.textContent = color;
    if (colorDot) colorDot.style.background = color;

    // Push both colour roles to the Composer so the canvas updates immediately
    Composer.setHighlightColor(color);
    Composer.setLineColor(color);
  }

  // ── Phase 2: Content text fields ──────────────────────────────────────────

  /**
   * Builds a content.txt-format string from all nine textarea fields
   * (Title / Subtitle / Baseline for each of the three formats).
   * This string is passed to Composer.setRawContent() so the existing
   * parseContent() function can handle it without changes.
   *
   * @returns {string} Multi-line content string in the expected format.
   */
  function buildRawContent() {
    const formatSuffixes = { '16x9': '16X9', '1x1': '1X1', '9x16': '9X16' };

    return ['16x9', '1x1', '9x16'].map(fmt => {
      const suffix   = formatSuffixes[fmt];
      const title    = getField(`title-${fmt}`);
      const subtitle = getField(`subtitle-${fmt}`);
      const baseline = getField(`baseline-${fmt}`);

      // Each section header is on its own line; content follows as continuation
      // lines — this matches the format the existing parseContent() expects.
      return [
        `TITLE ${suffix}: `,
        title,
        `SUBTITLE ${suffix}: ${subtitle}`,
        `BASELINE ${suffix}: `,
        baseline,
      ].join('\n');
    }).join('\n\n');
  }

  /**
   * Safe wrapper for reading a textarea value by element ID.
   * Returns an empty string if the element is not found.
   *
   * @param {string} id - The textarea's element ID.
   * @returns {string}
   */
  function getField(id) {
    const el = document.getElementById(id);
    return el ? el.value : '';
  }

  /**
   * Switches the active content tab in the sidebar to match the given format.
   * Does NOT switch the canvas format — call switchFormat() for that.
   *
   * @param {string} format - '16x9', '1x1', or '9x16'.
   */
  function syncContentTab(format) {
    // Map format key to pane ID suffix (16x9 → 16x9, 1x1 → 1x1, 9x16 → 9x16)
    document.querySelectorAll('.content-tab').forEach(tab => {
      tab.classList.toggle('active', tab.dataset.format === format);
    });
    document.querySelectorAll('.content-pane').forEach(pane => {
      pane.classList.toggle('active', pane.id === `pane-${format}`);
    });
  }

  /**
   * Wraps the currently selected text in a textarea with *asterisks* to mark
   * it as a highlighted keyword. After wrapping, triggers a content update
   * so the canvas reflects the change immediately.
   *
   * @param {string} fieldId - The ID of the target textarea element.
   */
  function applyHighlightToSelection(fieldId) {
    const textarea = document.getElementById(fieldId);
    if (!textarea) return;

    const start    = textarea.selectionStart;
    const end      = textarea.selectionEnd;

    // Nothing selected — do nothing
    if (start === end) return;

    const before   = textarea.value.slice(0, start);
    const selected = textarea.value.slice(start, end);
    const after    = textarea.value.slice(end);

    // Wrap the selection in asterisks
    textarea.value = `${before}*${selected}*${after}`;

    // Restore the selection range shifted by the leading '*' we inserted
    textarea.setSelectionRange(start + 1, end + 1);
    textarea.focus();

    // Propagate the change to the Composer
    Composer.setRawContent(buildRawContent());
  }

  // ── Phase 2: Public — populate fields from content string ─────────────────

  /**
   * Pre-fills all nine sidebar text fields from a raw content.txt string.
   * Called by main.js after the watchfolder has been loaded so the text
   * fields always start in sync with the loaded assets.
   *
   * Supports both format-specific keys (TITLE 16X9:) and multi-line
   * continuation: it collects all lines between a key and the next header.
   *
   * @param {string} rawText - Raw contents of content.txt (or equivalent).
   */
  function populateFromContent(rawText) {
    if (!rawText) return;

    // All known section header prefixes — used to detect where a section ends
    const allHeaders = [
      'TITLE 16X9:', 'SUBTITLE 16X9:', 'BASELINE 16X9:',
      'TITLE 1X1:',  'SUBTITLE 1X1:',  'BASELINE 1X1:',
      'TITLE 9X16:', 'SUBTITLE 9X16:', 'BASELINE 9X16:',
      'TITLE:',       'SUBTITLE:',       'BASELINE:',
    ];

    /**
     * Extracts the content lines for a given header key from rawText.
     * Returns the lines joined with newlines (so multi-line titles are preserved).
     *
     * @param {string} key - Section header prefix, e.g. 'TITLE 16X9:'.
     * @returns {string}
     */
    function extractSection(key) {
      const lines     = rawText.split('\n');
      const result    = [];
      let collecting  = false;

      for (const rawLine of lines) {
        const line = rawLine.trim();

        if (line.startsWith(key)) {
          collecting = true;
          // Inline content (same line as the key)
          const rest = line.slice(key.length).trim();
          if (rest) result.push(rest);
          continue;
        }

        if (collecting) {
          // Stop if we hit any other section header
          if (allHeaders.some(h => line.startsWith(h))) break;
          // Accumulate non-empty continuation lines
          if (line) result.push(line);
        }
      }

      return result.join('\n');
    }

    // Fill each field for every format
    const formatSuffixes = { '16x9': '16X9', '1x1': '1X1', '9x16': '9X16' };

    ['16x9', '1x1', '9x16'].forEach(fmt => {
      const suffix   = formatSuffixes[fmt];
      const titleEl    = document.getElementById(`title-${fmt}`);
      const subtitleEl = document.getElementById(`subtitle-${fmt}`);
      const baselineEl = document.getElementById(`baseline-${fmt}`);

      // Prefer format-specific keys; fall back to generic keys for the 16x9 case
      if (titleEl)    titleEl.value    = extractSection(`TITLE ${suffix}:`)    || extractSection('TITLE:');
      if (subtitleEl) subtitleEl.value = extractSection(`SUBTITLE ${suffix}:`) || extractSection('SUBTITLE:');
      if (baselineEl) baselineEl.value = extractSection(`BASELINE ${suffix}:`) || extractSection('BASELINE:');
    });
  }

  // ── Event binding ─────────────────────────────────────────────────────────

  /**
   * Attaches all DOM event listeners for toolbar buttons, the canvas resize
   * observer, the colour picker, and the sidebar content fields.
   * Called once from init().
   */
  function bindEvents() {

    // ── Toolbar: format toggle ──
    btn16x9.addEventListener('click', () => {
      if (activeFormat !== '16x9') switchFormat('16x9');
    });
    btn1x1.addEventListener('click', () => {
      if (activeFormat !== '1x1') switchFormat('1x1');
    });
    btn9x16.addEventListener('click', () => {
      if (activeFormat !== '9x16') switchFormat('9x16');
    });

    // ── Toolbar: play ──
    btnPlay.addEventListener('click', () => {
      setPlayingState();
      setStatus('Playing…');
      Composer.play();
    });

    // ── Toolbar: reset ──
    btnReset.addEventListener('click', () => {
      Composer.reset();
      setIdleState();
      setStatus('Reset — ready to play.');
    });

    // ── Toolbar: record & export ──
    btnRecord.addEventListener('click', () => {
      setRecordingState();
      setStatus(`Recording ${activeFormat} clip…`);
      Exporter.startRecording(activeFormat, setStatus);
    });

    // ── Canvas resize on window resize ──
    window.addEventListener('resize', scaleCanvasToContainer);

    // ── Canvas resize when Composer switches format ──
    window.addEventListener('canvas-resized', scaleCanvasToContainer);

    // ── Animation complete: return to idle ──
    window.addEventListener('animation-complete', () => {
      setIdleState();
      setStatus('Playback complete.');
    });

    // ── Recording stopped ──
    window.addEventListener('recording-stopped', clearRecordingState);

    // ── Sidebar: colour swatches ──
    document.querySelectorAll('.color-swatch').forEach(swatch => {
      swatch.addEventListener('click', () => activateSwatch(swatch));
    });

    // ── Sidebar: content tabs ──
    // Clicking a content tab switches both the visible pane AND the canvas format
    // so the user always previews the format they are editing.
    document.querySelectorAll('.content-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        const fmt = tab.dataset.format;
        if (activeFormat !== fmt) {
          switchFormat(fmt);
        } else {
          // Format is already active — just make sure the pane is visible
          syncContentTab(fmt);
        }
      });
    });

    // ── Sidebar: text fields — live update on every keystroke ──
    ['16x9', '1x1', '9x16'].forEach(fmt => {
      ['title', 'subtitle', 'baseline'].forEach(field => {
        const el = document.getElementById(`${field}-${fmt}`);
        if (el) {
          el.addEventListener('input', () => {
            Composer.setRawContent(buildRawContent());
          });
        }
      });
    });

    // ── Sidebar: highlight buttons ──
    // Each button wraps the current text selection in *asterisks*.
    document.querySelectorAll('.highlight-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        applyHighlightToSelection(btn.dataset.field);
      });
    });
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /**
   * Initialises the UI module.
   * Resolves all DOM references, scales the canvas, and binds event listeners.
   * Must be called once after the DOM is ready (from main.js).
   */
  function init() {
    btn16x9          = document.getElementById('btn-16x9');
    btn1x1           = document.getElementById('btn-1x1');
    btn9x16          = document.getElementById('btn-9x16');
    btnPlay          = document.getElementById('btn-play');
    btnReset         = document.getElementById('btn-reset');
    btnRecord        = document.getElementById('btn-record');
    statusText       = document.getElementById('status-text');
    previewCanvas    = document.getElementById('preview-canvas');
    previewContainer = document.getElementById('preview-container');
    folderInput      = document.getElementById('folder-input');

    bindEvents();
    scaleCanvasToContainer();
  }

  /**
   * Returns the currently active format key.
   * Used by main.js and Exporter to know which format to pass to Composer.
   *
   * @returns {'16x9'|'1x1'|'9x16'}
   */
  function getActiveFormat() {
    return activeFormat;
  }

  return {
    init,
    setStatus,
    enableControls,
    getActiveFormat,
    populateFromContent,  // Phase 2
  };

})();
