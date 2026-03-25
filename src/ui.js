/**
 * ui.js — Preview UI & Controls
 *
 * Manages:
 *  • Format toggle (16:9 ↔ 1:1) — updates the active button state and
 *    tells Composer to switch canvas dimensions.
 *  • Canvas scaling — keeps the preview canvas visually fitted inside the
 *    preview container at all times (on load, format switch, and window resize).
 *  • Playback controls — Play and Reset buttons.
 *  • Export controls — Record & Export button with recording state indicator.
 *  • Status bar — displays messages from any module.
 *  • Button enable/disable — buttons are disabled until assets are loaded.
 *
 * Public API (on global `UI` object):
 *   UI.init()
 *   UI.setStatus(message)
 *   UI.enableControls()      // called after assets load
 *   UI.getActiveFormat()     // '16x9' | '1x1'
 */

const UI = (() => {

  // ── DOM references ────────────────────────────────────────────────────────
  // These are resolved once in init() for efficiency.

  let btn16x9       = null;
  let btn1x1        = null;
  let btn9x16       = null;
  let btnPlay       = null;
  let btnReset      = null;
  let btnRecord     = null;
  let statusText    = null;
  let previewCanvas = null;
  let previewContainer = null;
  let folderInput   = null;

  // ── Active format state ───────────────────────────────────────────────────

  /** Currently selected format key. Kept in sync with the toggle buttons. */
  let activeFormat = '16x9';

  /** All format buttons — used for toggling the active class in one loop. */
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
   * The canvas element's width/height *attributes* set the rendering resolution
   * (e.g. 1920×1080). We override the *CSS* width/height to scale it down so
   * it fits the available screen space without affecting render quality.
   */
  function scaleCanvasToContainer() {
    if (!previewCanvas || !previewContainer) return;

    const PADDING      = 32;  // px of breathing room around the canvas
    const containerW   = previewContainer.clientWidth  - PADDING;
    const containerH   = previewContainer.clientHeight - PADDING;
    const canvasW      = previewCanvas.width;
    const canvasH      = previewCanvas.height;
    const canvasAspect = canvasW / canvasH;
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
   * Switches the active format, updates button styles, resizes the canvas,
   * and rescales the preview.
   *
   * @param {string} format - '16x9', '1x1', or '9x16'.
   */
  function switchFormat(format) {
    activeFormat = format;

    // Update active state on all format buttons
    const btns = formatButtons();
    Object.entries(btns).forEach(([key, btn]) => {
      if (btn) btn.classList.toggle('active', key === format);
    });

    // Tell the Composer to resize the canvas
    Composer.setFormat(format);

    // Re-fit the (now differently-sized) canvas in the preview area
    scaleCanvasToContainer();

    const labels = { '16x9': '1920×1080 (16:9)', '1x1': '1200×1200 (1:1)', '9x16': '1080×1920 (9:16)' };
    setStatus(`Format: ${labels[format] ?? format}`);
  }

  // ── Playback control helpers ──────────────────────────────────────────────

  /**
   * Puts all controls into "playing" state — disables Play, enables Reset.
   * Also disables Record so the user can't start a second recording.
   */
  function setPlayingState() {
    btnPlay.disabled   = true;
    btnReset.disabled  = false;
    btnRecord.disabled = true;
  }

  /**
   * Puts all controls back into "idle" state — enables Play and Record.
   */
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
    btnPlay.disabled    = true;
    btnReset.disabled   = true;
    btnRecord.disabled  = true;
    btnRecord.classList.add('recording');
    // Disable all format buttons during recording
    Object.values(formatButtons()).forEach(btn => { if (btn) btn.disabled = true; });
  }

  /**
   * Exits recording state — re-enables all controls.
   */
  function clearRecordingState() {
    btnRecord.classList.remove('recording');
    // Re-enable all format buttons
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

  // ── Event binding ─────────────────────────────────────────────────────────

  /**
   * Attaches all DOM event listeners.
   * Called once from init().
   */
  function bindEvents() {

    // ── Format toggle ──
    btn16x9.addEventListener('click', () => {
      if (activeFormat !== '16x9') switchFormat('16x9');
    });

    btn1x1.addEventListener('click', () => {
      if (activeFormat !== '1x1') switchFormat('1x1');
    });

    btn9x16.addEventListener('click', () => {
      if (activeFormat !== '9x16') switchFormat('9x16');
    });

    // ── Play ──
    btnPlay.addEventListener('click', () => {
      setPlayingState();
      setStatus('Playing…');
      Composer.play();
    });

    // ── Reset ──
    btnReset.addEventListener('click', () => {
      Composer.reset();
      setIdleState();
      setStatus('Reset — ready to play.');
    });

    // ── Record & Export ──
    btnRecord.addEventListener('click', () => {
      setRecordingState();
      setStatus(`Recording ${activeFormat} clip…`);
      Exporter.startRecording(activeFormat, setStatus);
    });

    // ── Folder input (file picker) ──
    // Handled in main.js via Watcher — we just listen for it here for UI state.
    // (See main.js onFolderSelected.)

    // ── Canvas resize on window resize ──
    window.addEventListener('resize', scaleCanvasToContainer);

    // ── Canvas resize when Composer switches format ──
    window.addEventListener('canvas-resized', scaleCanvasToContainer);

    // ── Animation complete: return to idle ──
    // Composer calls onComplete(); main.js dispatches a custom event.
    window.addEventListener('animation-complete', () => {
      setIdleState();
      setStatus('Playback complete.');
    });

    // ── Recording stopped ──
    window.addEventListener('recording-stopped', clearRecordingState);
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /**
   * Initialises the UI module.
   * Resolves DOM references, scales the canvas, and binds all event listeners.
   * Must be called after the DOM is ready.
   */
  function init() {
    // Resolve DOM references
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

    // Wire up all button/window events
    bindEvents();

    // Initial canvas scale (canvas is hidden until ready, but size is set)
    scaleCanvasToContainer();
  }

  /**
   * Returns the currently active format key.
   * Used by main.js to know which format to pass to Composer and Exporter.
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
  };

})();
