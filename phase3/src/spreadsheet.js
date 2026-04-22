/**
 * spreadsheet.js — CSV Spreadsheet Manager
 *
 * Parses a CSV file where each row is one video clip. Manages an in-memory
 * array of row objects, resolves per-row image files from the shared assets
 * folder, and can export the (possibly edited) data back as a CSV download.
 *
 * Expected CSV columns (header row required, order must match):
 *   name, color, background, person,
 *   title_16x9, subtitle_16x9, baseline_16x9,
 *   title_1x1,  subtitle_1x1,  baseline_1x1,
 *   title_9x16, subtitle_9x16, baseline_9x16
 *
 * The `background` and `person` columns hold filenames that are matched
 * case-insensitively against the files in the shared assets folder.
 *
 * Public API (on global `Spreadsheet` object):
 *   Spreadsheet.loadCSV(csvText)          — parse CSV text and store rows
 *   Spreadsheet.loadSharedAssets(files)   — index files from assets folder
 *   Spreadsheet.getRowCount()             — total number of data rows
 *   Spreadsheet.getRow(index)             — get a row object by index
 *   Spreadsheet.getCurrentIndex()         — currently active row index
 *   Spreadsheet.saveCurrentRow(data)      — write edited UI values back
 *   Spreadsheet.loadRowImages(index)      — resolve background + person images
 *   Spreadsheet.exportCSV()              — download the (edited) CSV file
 *   Spreadsheet.hasCsvLoaded()            — true after a CSV is parsed
 *   Spreadsheet.hasAssetsLoaded()         — true after shared assets are indexed
 *   Spreadsheet.getSharedFiles()          — returns { logoFile, musicFile }
 */

const Spreadsheet = (() => {

  // ── Internal state ────────────────────────────────────────────────────────

  /** All data rows, each an object keyed by column name. */
  let rows = [];

  /** Index of the currently previewed row (-1 = none loaded). */
  let currentIndex = -1;

  /**
   * All files from the shared assets folder, indexed by their lowercased
   * full relative path AND by their bare filename. This allows CSV entries
   * like "backgrounds/forest.png" or just "forest.png" to both match.
   * @type {Map<string, File>}
   */
  let assetFileMap = new Map();

  // ── CSV Parsing ───────────────────────────────────────────────────────────

  /**
   * Parses a raw CSV text string into an array of string arrays (rows × fields).
   * Handles quoted fields (which may contain commas and newlines) and
   * escaped double-quotes ("") inside quoted fields.
   *
   * @param {string} text - Raw CSV file contents.
   * @returns {string[][]} Array of rows; each row is an array of field strings.
   */
  function parseCSVText(text) {
    const result = [];
    let fields   = [];
    let field    = '';
    let inQuotes = false;
    let i        = 0;

    while (i < text.length) {
      const ch   = text[i];
      const next = text[i + 1];

      if (inQuotes) {
        if (ch === '"' && next === '"') {
          // Escaped double-quote inside a quoted field — emit a single "
          field += '"';
          i += 2;
        } else if (ch === '"') {
          // End of quoted field
          inQuotes = false;
          i++;
        } else {
          // Regular character inside quotes (may include commas and newlines)
          field += ch;
          i++;
        }
      } else {
        if (ch === '"') {
          // Start of a quoted field
          inQuotes = true;
          i++;
        } else if (ch === ',') {
          // Field separator
          fields.push(field);
          field = '';
          i++;
        } else if (ch === '\r' && next === '\n') {
          // Windows line ending — end of row
          fields.push(field);
          if (fields.some(f => f.trim() !== '')) result.push(fields);
          fields = [];
          field  = '';
          i += 2;
        } else if (ch === '\n' || ch === '\r') {
          // Unix/Mac line ending — end of row
          fields.push(field);
          if (fields.some(f => f.trim() !== '')) result.push(fields);
          fields = [];
          field  = '';
          i++;
        } else {
          field += ch;
          i++;
        }
      }
    }

    // Handle the last field / row (no trailing newline)
    if (field || fields.length > 0) {
      fields.push(field);
      if (fields.some(f => f.trim() !== '')) result.push(fields);
    }

    return result;
  }

  /**
   * Converts a raw CSV text string into an array of row objects.
   * The first row of the CSV is treated as the header row; its values
   * become the keys of each subsequent row object.
   *
   * @param {string} csvText - Raw CSV file contents.
   * @returns {Object[]} Array of row objects, one per data row.
   */
  function parseCSV(csvText) {
    const rawRows = parseCSVText(csvText);
    if (rawRows.length < 2) return [];

    // Normalise header names: lowercase, trim, spaces → underscores
    const headers = rawRows[0].map(h => h.trim().toLowerCase().replace(/\s+/g, '_'));

    return rawRows.slice(1).map(values => {
      const obj = {};
      headers.forEach((header, i) => {
        obj[header] = (values[i] ?? '').trim();
      });
      return obj;
    });
  }

  // ── Public: load CSV ──────────────────────────────────────────────────────

  /**
   * Parses a raw CSV text string and stores the resulting rows in memory.
   * Returns the number of rows parsed.
   *
   * @param {string} csvText - Raw contents of the .csv file.
   * @returns {number} Number of data rows loaded (excludes the header row).
   */
  function loadCSV(csvText) {
    rows         = parseCSV(csvText);
    currentIndex = rows.length > 0 ? 0 : -1;
    return rows.length;
  }

  // ── Public: shared assets ─────────────────────────────────────────────────

  /**
   * Indexes all files from the shared assets folder into an internal Map.
   * Files are keyed by:
   *   1. Their full relative path (lowercased), e.g. "backgrounds/forest.png"
   *   2. Their bare filename (lowercased), e.g. "forest.png"
   * This lets CSV values use either form and still match.
   *
   * @param {FileList} fileList - Files from the webkitdirectory picker.
   */
  function loadSharedAssets(fileList) {
    assetFileMap.clear();

    for (const file of fileList) {
      // webkitRelativePath gives "FolderName/sub/file.ext" — strip the root folder
      const relativePath = file.webkitRelativePath
        ? file.webkitRelativePath.split('/').slice(1).join('/').toLowerCase()
        : file.name.toLowerCase();

      const bareName = file.name.toLowerCase();

      assetFileMap.set(relativePath, file);
      // Only set bareName if not already set (avoids collisions between subfolders)
      if (!assetFileMap.has(bareName)) {
        assetFileMap.set(bareName, file);
      }
    }

    console.log(`[Spreadsheet] Indexed ${assetFileMap.size} asset paths.`);
  }

  /**
   * Finds a file in the indexed asset map by the name from the CSV.
   * Tries exact match first, then falls back to bare filename match.
   *
   * @param {string} csvFilename - Filename as written in the CSV column.
   * @returns {File|null} The matching File, or null if not found.
   */
  function findFile(csvFilename) {
    if (!csvFilename) return null;
    const key = csvFilename.toLowerCase().replace(/\\/g, '/');

    if (assetFileMap.has(key)) return assetFileMap.get(key);

    // Try bare filename only (ignores any subdirectory prefix in the CSV)
    const bareName = key.split('/').pop();
    return assetFileMap.get(bareName) ?? null;
  }

  /**
   * Returns the shared logo and music files from the indexed asset map.
   * Filenames are matched case-insensitively.
   *
   * @returns {{ logoFile: File|null, musicFile: File|null }}
   */
  function getSharedFiles() {
    return {
      logoFile  : findFile('logo.webm') || findFile('logo.mp4') || findFile('logo.png'),
      musicFile : findFile('music.mp3') || findFile('music.mp4') || findFile('music.wav'),
    };
  }

  // ── Public: row navigation ────────────────────────────────────────────────

  /**
   * Returns the total number of data rows.
   * @returns {number}
   */
  function getRowCount() {
    return rows.length;
  }

  /**
   * Returns the index of the currently active row.
   * @returns {number} -1 if no CSV has been loaded.
   */
  function getCurrentIndex() {
    return currentIndex;
  }

  /**
   * Returns a copy of the row object at the given index, or null if out of range.
   * Returns a copy so callers cannot accidentally mutate the stored row.
   *
   * @param {number} index - Zero-based row index.
   * @returns {Object|null}
   */
  function getRow(index) {
    if (index < 0 || index >= rows.length) return null;
    return { ...rows[index] };
  }

  /**
   * Sets the current row index and returns the row object.
   * Clamps the index to [0, rowCount - 1].
   *
   * @param {number} index - Desired row index.
   * @returns {Object|null} The row at the clamped index.
   */
  function gotoRow(index) {
    currentIndex = Math.max(0, Math.min(index, rows.length - 1));
    return getRow(currentIndex);
  }

  // ── Public: save row ──────────────────────────────────────────────────────

  /**
   * Writes edited UI values back into the in-memory row at currentIndex.
   * This persists text field and colour changes so they survive row navigation
   * and are included in the next CSV export.
   *
   * @param {Object} data - Object with any subset of the row's column keys.
   */
  function saveCurrentRow(data) {
    if (currentIndex < 0 || currentIndex >= rows.length) return;
    Object.assign(rows[currentIndex], data);
  }

  // ── Public: load row images ───────────────────────────────────────────────

  /**
   * Loads the background and person images for the given row from the indexed
   * asset files. Returns a Promise that resolves to { background, person }
   * where each value is an HTMLImageElement (or null if the file was not found).
   *
   * @param {number} index - Row index to load images for.
   * @returns {Promise<{ background: HTMLImageElement|null, person: HTMLImageElement|null }>}
   */
  async function loadRowImages(index) {
    const row = getRow(index);
    if (!row) return { background: null, person: null };

    const backgroundFile = findFile(row.background);
    const personFile     = findFile(row.person);

    const [background, person] = await Promise.all([
      backgroundFile ? loadImageFromFile(backgroundFile) : Promise.resolve(null),
      personFile     ? loadImageFromFile(personFile)     : Promise.resolve(null),
    ]);

    if (!backgroundFile) console.warn(`[Spreadsheet] Background file not found: "${row.background}"`);
    if (!personFile)     console.warn(`[Spreadsheet] Person file not found: "${row.person}"`);

    return { background, person };
  }

  /**
   * Loads a File as an HTMLImageElement via a temporary blob URL.
   * Revokes the blob URL after the image has loaded to avoid memory leaks.
   *
   * @param {File} file - The image file to load.
   * @returns {Promise<HTMLImageElement>}
   */
  function loadImageFromFile(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();

      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve(img);
      };

      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error(`Failed to load image: ${file.name}`));
      };

      img.src = url;
    });
  }

  // ── Public: CSV export ────────────────────────────────────────────────────

  /**
   * Serialises the current in-memory rows back to CSV text and triggers
   * a browser download of the file named "clips-edited.csv".
   * Includes a header row. Fields that contain commas or newlines are
   * automatically wrapped in double-quotes.
   */
  function exportCSV() {
    if (rows.length === 0) return;

    // Use the column order that matches the expected import format
    const columns = [
      'name', 'color', 'background', 'person',
      'title_16x9', 'subtitle_16x9', 'baseline_16x9',
      'title_1x1',  'subtitle_1x1',  'baseline_1x1',
      'title_9x16', 'subtitle_9x16', 'baseline_9x16',
    ];

    // Quote a field value if it contains commas, newlines, or double-quotes
    function quoteField(value) {
      const str = String(value ?? '');
      if (str.includes(',') || str.includes('\n') || str.includes('"')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    }

    const headerRow = columns.join(',');
    const dataRows  = rows.map(row =>
      columns.map(col => quoteField(row[col] ?? '')).join(',')
    );

    const csvText = [headerRow, ...dataRows].join('\n');
    const blob    = new Blob([csvText], { type: 'text/csv' });
    const url     = URL.createObjectURL(blob);
    const link    = document.createElement('a');

    link.href     = url;
    link.download = 'clips-edited.csv';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // ── Public: state checks ──────────────────────────────────────────────────

  /**
   * Returns true if a CSV has been loaded and contains at least one data row.
   * @returns {boolean}
   */
  function hasCsvLoaded() {
    return rows.length > 0;
  }

  /**
   * Returns true if the shared assets folder has been indexed.
   * @returns {boolean}
   */
  function hasAssetsLoaded() {
    return assetFileMap.size > 0;
  }

  // ── Public API ────────────────────────────────────────────────────────────

  return {
    loadCSV,
    loadSharedAssets,
    getRowCount,
    getRow,
    getCurrentIndex,
    gotoRow,
    saveCurrentRow,
    loadRowImages,
    exportCSV,
    hasCsvLoaded,
    hasAssetsLoaded,
    getSharedFiles,
  };

})();
