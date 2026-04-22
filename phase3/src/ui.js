/**
 * ui.js — Preview UI & Controls (Phase 3)
 *
 * Manages:
 *  • Format toggle (16:9 / 1:1 / 9:16)
 *  • Canvas scaling to fit the preview container
 *  • Row navigator (◀ / label / ▶) with row count display
 *  • Playback controls (Play, Stop)
 *  • Save Row button — writes current field/colour state back to Spreadsheet
 *  • Export CSV button — downloads the edited spreadsheet
 *  • Batch Export button — triggers full N × 3 export queue
 *  • Status bar messages
 *  • Brand colour picker (8 swatches)
 *  • Content text fields (Title / Subtitle / Baseline per format)
 *  • Highlight button — wraps selection in *asterisks*
 *
 * Public API (on global `UI` object):
 *   UI.init()
 *   UI.setStatus(message)
 *   UI.enableRowControls()          — enables nav + playback after CSV + assets loaded
 *   UI.enableSaveControls()         — enables Save Row + Export CSV buttons
 *   UI.enableBatchExport()          — enables Batch Export button
 *   UI.disableAllControls()         — disables everything (during recording)
 *   UI.getActiveFormat()
 *   UI.populateRow(rowObj)          — fills all fields from a row object
 *   UI.collectRowData()             — reads current field values into a row-shaped object
 *   UI.updateRowLabel(index, total) — updates the ◀ [name — 3/12] ▶ display
 *   UI.setActiveColor(hex)          — activates the matching swatch
 */

const UI = (() => {

  // ── DOM references ────────────────────────────────────────────────────────

  let btn16x9          = null;
  let btn1x1           = null;
  let btn9x16          = null;
  let btnPlay          = null;
  let btnReset         = null;
  let btnPrev          = null;
  let btnNext          = null;
  let btnSaveRow       = null;
  let btnExportCsv     = null;
  let btnBatchExport   = null;
  let rowLabel         = null;
  let statusText       = null;
  let previewCanvas    = null;
  let previewContainer = null;

  /** Currently active canvas format. */
  let activeFormat = '16x9';

  const formatButtons = () => ({ '16x9': btn16x9, '1x1': btn1x1, '9x16': btn9x16 });

  // ── Status bar ────────────────────────────────────────────────────────────

  /**
   * Updates the status bar text. Any module can call this.
   * @param {string} message
   */
  function setStatus(message) {
    if (statusText) statusText.textContent = message;
  }

  // ── Canvas scaling ────────────────────────────────────────────────────────

  /**
   * Scales the canvas CSS display size to fit the preview container while
   * preserving the canvas pixel aspect ratio.
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
      displayW = containerW;
      displayH = containerW / canvasAspect;
    } else {
      displayH = containerH;
      displayW = containerH * canvasAspect;
    }

    previewCanvas.style.width  = `${Math.round(displayW)}px`;
    previewCanvas.style.height = `${Math.round(displayH)}px`;
  }

  // ── Format toggle ─────────────────────────────────────────────────────────

  /**
   * Switches the active canvas format. Updates button styles, resizes the canvas,
   * rescales the preview, and keeps the content sidebar tab in sync.
   *
   * @param {string} format - '16x9', '1x1', or '9x16'.
   */
  function switchFormat(format) {
    activeFormat = format;

    const btns = formatButtons();
    Object.entries(btns).forEach(([key, btn]) => {
      if (btn) btn.classList.toggle('active', key === format);
    });

    Composer.setFormat(format);
    scaleCanvasToContainer();
    syncContentTab(format);

    const labels = { '16x9': '1920×1080', '1x1': '1200×1200', '9x16': '1080×1920' };
    setStatus(`Format: ${labels[format] ?? format}`);
  }

  // ── Row label ─────────────────────────────────────────────────────────────

  /**
   * Updates the row navigator label: "clip_001 — 1 / 12"
   *
   * @param {number} index - Zero-based current index.
   * @param {number} total - Total number of rows.
   * @param {string} name  - Row name from the CSV.
   */
  function updateRowLabel(index, total, name) {
    if (!rowLabel) return;
    rowLabel.textContent = total > 0
      ? `${name || '—'}  ·  ${index + 1} / ${total}`
      : 'No CSV loaded';
  }

  // ── Control state helpers ─────────────────────────────────────────────────

  /** Enables row navigation, playback, and format buttons. */
  function enableRowControls() {
    btnPrev.disabled  = false;
    btnNext.disabled  = false;
    btnPlay.disabled  = false;
    btnReset.disabled = false;
    previewCanvas.classList.add('ready');
  }

  /** Enables Save Row and Export CSV buttons. */
  function enableSaveControls() {
    btnSaveRow.disabled   = false;
    btnExportCsv.disabled = false;
  }

  /** Enables the Batch Export button (requires both CSV + assets loaded). */
  function enableBatchExport() {
    btnBatchExport.disabled = false;
  }

  /** Disables everything — used during recording to prevent interference. */
  function disableAllControls() {
    [btnPlay, btnReset, btnPrev, btnNext, btnSaveRow, btnExportCsv, btnBatchExport,
     btn16x9, btn1x1, btn9x16].forEach(btn => { if (btn) btn.disabled = true; });
    if (btnBatchExport) btnBatchExport.classList.add('recording');
  }

  /** Re-enables all controls after recording finishes. */
  function restoreAllControls() {
    if (btnBatchExport) btnBatchExport.classList.remove('recording');
    enableRowControls();
    enableSaveControls();
    enableBatchExport();
    Object.values(formatButtons()).forEach(btn => { if (btn) btn.disabled = false; });
  }

  // ── Colour picker ─────────────────────────────────────────────────────────

  /**
   * Activates the swatch with the given hex colour, updates the hex label,
   * and pushes both highlight and line colour to the Composer.
   *
   * @param {HTMLButtonElement} swatch
   */
  function activateSwatch(swatch) {
    const color = swatch.dataset.color;

    document.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('active'));
    swatch.classList.add('active');

    const hexLabel = document.getElementById('selected-color-hex');
    const colorDot = document.getElementById('selected-color-dot');
    if (hexLabel) hexLabel.textContent = color;
    if (colorDot) colorDot.style.background = color;

    Composer.setHighlightColor(color);
    Composer.setLineColor(color);
  }

  /**
   * Programmatically activates the swatch that matches the given hex value.
   * Falls back to the first swatch if no match is found.
   * Used when loading a row that has its own colour.
   *
   * @param {string} hex - '#rrggbb' colour from the CSV row.
   */
  function setActiveColor(hex) {
    const normalised = hex.toLowerCase().trim();
    const swatches   = document.querySelectorAll('.color-swatch');

    let matched = null;
    swatches.forEach(s => {
      if (s.dataset.color.toLowerCase() === normalised) matched = s;
    });

    // If no exact match, just update composer without changing swatch highlight
    if (matched) {
      activateSwatch(matched);
    } else {
      Composer.setHighlightColor(hex);
      Composer.setLineColor(hex);

      // Update the label to show whatever colour the row specified
      const hexLabel = document.getElementById('selected-color-hex');
      const colorDot = document.getElementById('selected-color-dot');
      if (hexLabel) hexLabel.textContent = hex;
      if (colorDot) colorDot.style.background = hex;
    }
  }

  // ── Content tabs ──────────────────────────────────────────────────────────

  /**
   * Switches the active sidebar tab without changing the canvas format.
   *
   * @param {string} format
   */
  function syncContentTab(format) {
    document.querySelectorAll('.content-tab').forEach(tab => {
      tab.classList.toggle('active', tab.dataset.format === format);
    });
    document.querySelectorAll('.content-pane').forEach(pane => {
      pane.classList.toggle('active', pane.id === `pane-${format}`);
    });
  }

  // ── Field helpers ─────────────────────────────────────────────────────────

  /**
   * Reads a textarea value by element ID. Returns '' if not found.
   * @param {string} id
   * @returns {string}
   */
  function getField(id) {
    const el = document.getElementById(id);
    return el ? el.value : '';
  }

  /**
   * Sets a textarea value by element ID. Silently ignores missing elements.
   * @param {string} id
   * @param {string} value
   */
  function setField(id, value) {
    const el = document.getElementById(id);
    if (el) el.value = value || '';
  }

  // ── Row populate / collect ────────────────────────────────────────────────

  /**
   * Fills all nine sidebar text fields from a CSV row object.
   * Also activates the correct colour swatch for the row.
   * Called whenever the user navigates to a new row.
   *
   * @param {Object} row - Row object from Spreadsheet.getRow().
   */
  function populateRow(row) {
    if (!row) return;

    setField('title-16x9',    row.title_16x9    || '');
    setField('subtitle-16x9', row.subtitle_16x9 || '');
    setField('baseline-16x9', row.baseline_16x9 || '');

    setField('title-1x1',     row.title_1x1     || '');
    setField('subtitle-1x1',  row.subtitle_1x1  || '');
    setField('baseline-1x1',  row.baseline_1x1  || '');

    setField('title-9x16',    row.title_9x16    || '');
    setField('subtitle-9x16', row.subtitle_9x16 || '');
    setField('baseline-9x16', row.baseline_9x16 || '');

    if (row.color) setActiveColor(row.color);
  }

  /**
   * Reads the current text field values and the active colour swatch,
   * returning them as a partial row object ready to be passed to
   * Spreadsheet.saveCurrentRow().
   *
   * @returns {Object} Row-shaped object with text + colour values.
   */
  function collectRowData() {
    const activeSwatch = document.querySelector('.color-swatch.active');
    const color        = activeSwatch ? activeSwatch.dataset.color : '#99cc00';

    return {
      color,
      title_16x9    : getField('title-16x9'),
      subtitle_16x9 : getField('subtitle-16x9'),
      baseline_16x9 : getField('baseline-16x9'),
      title_1x1     : getField('title-1x1'),
      subtitle_1x1  : getField('subtitle-1x1'),
      baseline_1x1  : getField('baseline-1x1'),
      title_9x16    : getField('title-9x16'),
      subtitle_9x16 : getField('subtitle-9x16'),
      baseline_9x16 : getField('baseline-9x16'),
    };
  }

  // ── Highlight button ──────────────────────────────────────────────────────

  /**
   * Wraps the currently selected text in a textarea with *asterisks* to mark
   * it as a highlighted keyword. Triggers a live canvas redraw afterwards.
   *
   * @param {string} fieldId - ID of the target textarea.
   */
  function applyHighlightToSelection(fieldId) {
    const textarea = document.getElementById(fieldId);
    if (!textarea) return;

    const start    = textarea.selectionStart;
    const end      = textarea.selectionEnd;
    if (start === end) return;

    const before   = textarea.value.slice(0, start);
    const selected = textarea.value.slice(start, end);
    const after    = textarea.value.slice(end);

    textarea.value = `${before}*${selected}*${after}`;
    textarea.setSelectionRange(start + 1, end + 1);
    textarea.focus();

    Composer.setRawContent(buildRawContent());
  }

  // ── Content string builder ────────────────────────────────────────────────

  /**
   * Builds a content-string from all nine text fields.
   * The string uses the same format as content.txt (TITLE 16X9: …) so it can
   * be fed directly into Composer.setRawContent() without changes.
   *
   * @returns {string}
   */
  function buildRawContent() {
    const suffixes = { '16x9': '16X9', '1x1': '1X1', '9x16': '9X16' };

    return ['16x9', '1x1', '9x16'].map(fmt => {
      const suffix   = suffixes[fmt];
      const title    = getField(`title-${fmt}`);
      const subtitle = getField(`subtitle-${fmt}`);
      const baseline = getField(`baseline-${fmt}`);

      return [
        `TITLE ${suffix}: `,
        title,
        `SUBTITLE ${suffix}: ${subtitle}`,
        `BASELINE ${suffix}: `,
        baseline,
      ].join('\n');
    }).join('\n\n');
  }

  // ── Event binding ─────────────────────────────────────────────────────────

  /**
   * Attaches all DOM event listeners.
   * Row navigation, playback, colour picker, content fields — everything.
   * Called once from init().
   */
  function bindEvents() {

    // ── Format toggle ──
    btn16x9.addEventListener('click', () => { if (activeFormat !== '16x9') switchFormat('16x9'); });
    btn1x1.addEventListener('click',  () => { if (activeFormat !== '1x1')  switchFormat('1x1'); });
    btn9x16.addEventListener('click', () => { if (activeFormat !== '9x16') switchFormat('9x16'); });

    // ── Playback ──
    btnPlay.addEventListener('click', () => {
      btnPlay.disabled  = true;
      btnReset.disabled = false;
      setStatus('Playing…');
      Composer.play();
    });

    btnReset.addEventListener('click', () => {
      Composer.reset();
      btnPlay.disabled = false;
      setStatus('Stopped.');
    });

    // ── Row navigation: delegate to main.js via custom events ──
    // UI fires events; main.js owns the Spreadsheet state.
    btnPrev.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('row-prev'));
    });

    btnNext.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('row-next'));
    });

    // ── Save Row ──
    btnSaveRow.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('row-save'));
      setStatus('Row saved.');
    });

    // ── Export CSV ──
    btnExportCsv.addEventListener('click', () => {
      Spreadsheet.exportCSV();
      setStatus('CSV downloaded.');
    });

    // ── Batch Export ──
    btnBatchExport.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('batch-export-start'));
    });

    // ── Canvas resize ──
    window.addEventListener('resize', scaleCanvasToContainer);
    window.addEventListener('canvas-resized', scaleCanvasToContainer);

    // ── Animation complete ──
    window.addEventListener('animation-complete', () => {
      btnPlay.disabled  = false;
      btnReset.disabled = false;
      setStatus('Playback complete.');
    });

    // ── Batch export complete ──
    window.addEventListener('batch-export-complete', () => {
      restoreAllControls();
      setStatus('Batch export complete — all files downloaded.');
    });

    // ── Colour swatches ──
    document.querySelectorAll('.color-swatch').forEach(swatch => {
      swatch.addEventListener('click', () => activateSwatch(swatch));
    });

    // ── Content tabs: clicking tab also switches canvas format ──
    document.querySelectorAll('.content-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        const fmt = tab.dataset.format;
        if (activeFormat !== fmt) switchFormat(fmt);
        else syncContentTab(fmt);
      });
    });

    // ── Text fields: live update canvas on every keystroke ──
    ['16x9', '1x1', '9x16'].forEach(fmt => {
      ['title', 'subtitle', 'baseline'].forEach(field => {
        const el = document.getElementById(`${field}-${fmt}`);
        if (el) el.addEventListener('input', () => Composer.setRawContent(buildRawContent()));
      });
    });

    // ── Highlight buttons ──
    document.querySelectorAll('.highlight-btn').forEach(btn => {
      btn.addEventListener('click', () => applyHighlightToSelection(btn.dataset.field));
    });
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /**
   * Initialises the UI module: resolves DOM references, scales canvas, binds events.
   * Must be called once after the DOM is ready.
   */
  function init() {
    btn16x9          = document.getElementById('btn-16x9');
    btn1x1           = document.getElementById('btn-1x1');
    btn9x16          = document.getElementById('btn-9x16');
    btnPlay          = document.getElementById('btn-play');
    btnReset         = document.getElementById('btn-reset');
    btnPrev          = document.getElementById('btn-prev');
    btnNext          = document.getElementById('btn-next');
    btnSaveRow       = document.getElementById('btn-save-row');
    btnExportCsv     = document.getElementById('btn-export-csv');
    btnBatchExport   = document.getElementById('btn-batch-export');
    rowLabel         = document.getElementById('row-label');
    statusText       = document.getElementById('status-text');
    previewCanvas    = document.getElementById('preview-canvas');
    previewContainer = document.getElementById('preview-container');

    bindEvents();
    scaleCanvasToContainer();
  }

  /**
   * Returns the currently active format key.
   * @returns {'16x9'|'1x1'|'9x16'}
   */
  function getActiveFormat() {
    return activeFormat;
  }

  return {
    init,
    setStatus,
    enableRowControls,
    enableSaveControls,
    enableBatchExport,
    disableAllControls,
    getActiveFormat,
    populateRow,
    collectRowData,
    updateRowLabel,
    setActiveColor,
  };

})();
