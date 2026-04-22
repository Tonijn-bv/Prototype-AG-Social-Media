/**
 * main.js — Application Bootstrap (Phase 3)
 *
 * Startup sequence:
 *   1. Wait for the DOM to be ready.
 *   2. Initialise UI and Composer.
 *   3. Handle CSV file picker — parse rows, update navigator.
 *   4. Handle shared assets picker — load logo + music, enable export.
 *   5. Wire row navigation (◀ / ▶ / save) — load images + content per row.
 *   6. Wire batch export — delegate to Exporter with a loadRowFn callback.
 *
 * State ownership:
 *   • Spreadsheet — owns all row data and the asset file index.
 *   • Composer    — owns the canvas, audio, and rendering state.
 *   • UI          — owns DOM state (button enable/disable, field values).
 *   • main.js     — coordinates between the three modules.
 */

(async function bootstrap() {

  // ── 1. Wait for the DOM ───────────────────────────────────────────────────

  await domReady();

  // ── 2. Initialise modules ─────────────────────────────────────────────────

  UI.init();
  UI.setStatus('Initialising…');

  const canvas = document.getElementById('preview-canvas');
  await Composer.init(canvas);

  // Relay the animation-complete event from Composer to the DOM so UI.js
  // can react without a direct import of Composer.
  Composer.onComplete(() => {
    window.dispatchEvent(new CustomEvent('animation-complete'));
  });

  UI.setStatus('Ready — load a CSV file to begin.');

  // ── 3. CSV file picker ────────────────────────────────────────────────────

  const csvInput = document.getElementById('csv-input');

  csvInput.addEventListener('change', async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    UI.setStatus('Parsing CSV…');

    try {
      const csvText  = await readFileAsText(file);
      const rowCount = Spreadsheet.loadCSV(csvText);

      if (rowCount === 0) {
        UI.setStatus('CSV loaded but contains no data rows.');
        return;
      }

      UI.setStatus(`CSV loaded — ${rowCount} row${rowCount > 1 ? 's' : ''}.`);

      // Load the first row into the sidebar fields (images load separately below)
      const firstRow = Spreadsheet.getRow(0);
      UI.populateRow(firstRow);
      updateRowLabel();

      // Enable save controls now that a CSV is loaded.
      UI.enableSaveControls();

      // Enable batch export only if shared assets are also ready.
      if (Spreadsheet.hasAssetsLoaded()) {
        UI.enableBatchExport();
        await loadCurrentRow();
      }

    } catch (err) {
      UI.setStatus(`CSV error: ${err.message}`);
      console.error('[Main] CSV loading failed:', err);
    }

    csvInput.value = '';
  });

  // ── 4. Shared assets picker ───────────────────────────────────────────────

  const assetsInput = document.getElementById('assets-input');

  assetsInput.addEventListener('change', async (event) => {
    const fileList = event.target.files;
    if (!fileList || fileList.length === 0) return;

    UI.setStatus('Loading shared assets…');

    // Index all files in the folder so per-row images can be resolved by name.
    Spreadsheet.loadSharedAssets(fileList);

    // Load logo and music — these are shared across all rows.
    const { logoFile, musicFile } = Spreadsheet.getSharedFiles();

    // Load the logo as an HTMLVideoElement (logo.webm with alpha channel).
    const logoVideo = logoFile ? await loadLogoVideo(logoFile) : null;

    // Pass shared assets to Composer (sets up audio routing, stores logo).
    Composer.setSharedAssets(logoVideo, musicFile);

    UI.setStatus('Shared assets loaded' + (logoFile ? ' (logo ✓)' : '') + (musicFile ? ' (music ✓)' : '') + '.');

    // Enable row controls now that images can be resolved.
    UI.enableRowControls();

    // Enable batch export only if a CSV is also loaded.
    if (Spreadsheet.hasCsvLoaded()) {
      UI.enableBatchExport();
      await loadCurrentRow();
    }

    assetsInput.value = '';
  });

  // ── 5. Row navigation ─────────────────────────────────────────────────────

  // ◀ Previous row
  window.addEventListener('row-prev', async () => {
    const index = Spreadsheet.getCurrentIndex();
    if (index <= 0) return;
    Spreadsheet.gotoRow(index - 1);
    updateRowLabel();
    await loadCurrentRow();
  });

  // ▶ Next row
  window.addEventListener('row-next', async () => {
    const index = Spreadsheet.getCurrentIndex();
    if (index >= Spreadsheet.getRowCount() - 1) return;
    Spreadsheet.gotoRow(index + 1);
    updateRowLabel();
    await loadCurrentRow();
  });

  // 💾 Save Row — write current UI state back into the in-memory row
  window.addEventListener('row-save', () => {
    const data = UI.collectRowData();
    Spreadsheet.saveCurrentRow(data);
    UI.setStatus('Row saved to memory. Use "Export CSV" to download.');
  });

  // ── 6. Batch export ───────────────────────────────────────────────────────

  window.addEventListener('batch-export-start', async () => {
    if (!Spreadsheet.hasCsvLoaded() || !Spreadsheet.hasAssetsLoaded()) {
      UI.setStatus('Batch export requires both a CSV and shared assets to be loaded.');
      return;
    }

    UI.disableAllControls();
    UI.setStatus('Starting batch export…');

    const allRows = [];
    for (let i = 0; i < Spreadsheet.getRowCount(); i++) {
      allRows.push(Spreadsheet.getRow(i));
    }

    const formats = ['16x9', '1x1', '9x16'];

    await Exporter.startBatchExport(
      allRows,
      // loadRowFn: called by Exporter before each row's recording starts.
      // Loads images into Composer so the canvas reflects the correct content.
      async (row) => {
        await applyRowToComposer(row);
      },
      formats,
      // onProgress: called after each clip (and at intermediate steps).
      (done, total, rowName, format, detail) => {
        const msg = detail
          ? detail
          : `Batch export: ${done}/${total} — ${rowName} / ${format}`;
        UI.setStatus(msg);
      }
    );
  });

})();

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Loads the current Spreadsheet row into Composer and the sidebar UI.
 * Resolves background + person images from the shared assets folder.
 * Updates the canvas to show the new row's end-state immediately.
 *
 * @returns {Promise<void>}
 */
async function loadCurrentRow() {
  const index = Spreadsheet.getCurrentIndex();
  const row   = Spreadsheet.getRow(index);
  if (!row) return;

  UI.setStatus(`Loading row ${index + 1}…`);

  // Fill sidebar text fields from the row object.
  UI.populateRow(row);

  // Load images and apply everything to Composer.
  await applyRowToComposer(row);

  const rowName = row.name || `row-${index + 1}`;
  UI.setStatus(`Row ${index + 1}: ${rowName}`);
}

/**
 * Loads a row's images and pushes all content to Composer.
 * Used both by loadCurrentRow() and by the batch export loadRowFn callback.
 *
 * @param {Object} row - Row object from Spreadsheet.
 * @returns {Promise<void>}
 */
async function applyRowToComposer(row) {
  // Load per-row images (background + person) from the shared assets folder.
  const { background, person } = await Spreadsheet.loadRowImages(
    // Find the index of this row object in the spreadsheet
    findRowIndex(row)
  );

  // Build the content string from all nine text fields (all formats combined).
  const rawContent = buildRawContentFromRow(row);

  // Push everything to Composer — this redraws the canvas end-state frame.
  Composer.setRowAssets(background, person, rawContent, row.color || '#99cc00');
}

/**
 * Builds a content-string from a row object.
 * The string follows the content.txt format (TITLE 16X9: …) so Composer can
 * parse it with the existing parseContent() function without any changes.
 *
 * @param {Object} row - Row object with title_16x9, subtitle_16x9 … fields.
 * @returns {string}
 */
function buildRawContentFromRow(row) {
  const sections = [
    ['16X9', row.title_16x9    || '', row.subtitle_16x9 || '', row.baseline_16x9 || ''],
    ['1X1',  row.title_1x1     || '', row.subtitle_1x1  || '', row.baseline_1x1  || ''],
    ['9X16', row.title_9x16    || '', row.subtitle_9x16 || '', row.baseline_9x16 || ''],
  ];

  return sections.map(([suffix, title, subtitle, baseline]) => [
    `TITLE ${suffix}: `,
    title,
    `SUBTITLE ${suffix}: ${subtitle}`,
    `BASELINE ${suffix}: `,
    baseline,
  ].join('\n')).join('\n\n');
}

/**
 * Finds the index of a row object by matching its `name` field.
 * Falls back to the current index if not found.
 *
 * @param {Object} row
 * @returns {number}
 */
function findRowIndex(row) {
  const count = Spreadsheet.getRowCount();
  for (let i = 0; i < count; i++) {
    const r = Spreadsheet.getRow(i);
    if (r && r.name === row.name && r.background === row.background) return i;
  }
  return Spreadsheet.getCurrentIndex();
}

/**
 * Updates the row navigator label in the toolbar.
 */
function updateRowLabel() {
  const index = Spreadsheet.getCurrentIndex();
  const total = Spreadsheet.getRowCount();
  const row   = Spreadsheet.getRow(index);
  UI.updateRowLabel(index, total, row?.name || '');
}

/**
 * Loads an HTMLVideoElement for the logo.webm file.
 * Sets muted + playsinline so autoplay works without user interaction.
 *
 * @param {File} file - The logo video file.
 * @returns {Promise<HTMLVideoElement>}
 */
function loadLogoVideo(file) {
  return new Promise((resolve) => {
    const url   = URL.createObjectURL(file);
    const video = document.createElement('video');

    video.muted      = true;
    video.playsInline = true;
    video.src        = url;

    video.addEventListener('loadedmetadata', () => resolve(video), { once: true });
    video.addEventListener('error', () => {
      console.warn('[Main] Logo video failed to load.');
      URL.revokeObjectURL(url);
      resolve(null);
    }, { once: true });

    video.load();
  });
}

/**
 * Reads a File as a plain text string.
 *
 * @param {File} file
 * @returns {Promise<string>}
 */
function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = (e) => resolve(e.target.result);
    reader.onerror = ()  => reject(new Error(`Could not read file: ${file.name}`));
    reader.readAsText(file);
  });
}

/**
 * Returns a Promise that resolves when the DOM is ready.
 * @returns {Promise<void>}
 */
function domReady() {
  return new Promise((resolve) => {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', resolve, { once: true });
    } else {
      resolve();
    }
  });
}
