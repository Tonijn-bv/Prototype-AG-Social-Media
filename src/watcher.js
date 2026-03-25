/**
 * watcher.js — Asset Loading (Option A: Directory Picker)
 *
 * Strategy: use <input type="file" webkitdirectory> so the user selects the
 * watchfolder/ directory directly in the browser. No server required — the
 * page can be opened as a local file (file://).
 *
 * Recognised assets (matched case-insensitively):
 *   background  →  background.png  | backgound.png  (handles the typo in the sample)
 *   curvedline  →  curvedline.png
 *   person      →  person.png
 *   logo        →  logo.png
 *   logoVideo   →  logo.mov        (ProRes 4444 — auto-transcoded to WebM VP9)
 *   music       →  music.mp3
 *   content     →  content.txt
 *
 * When both logo.png and logo.mov are present, logo.mov takes priority.
 *
 * Public API (exposed on the global `Watcher` object):
 *   Watcher.processFiles(fileList, onProgress)
 *     → Promise<{ images, audioFile, contentText }>
 */

const Watcher = (() => {

  // ── Known filenames per asset key ─────────────────────────────────────────

  /**
   * Maps an internal asset key to one or more accepted filenames (lower-case).
   * Add extra variants here if the user renames files.
   */
  const FILE_MAP = {
    background : ['background.png', 'backgound.png'],  // 'backgound' handles the typo in the sample
    curvedline : ['curvedline.png'],
    person     : ['person.png'],
    logo       : ['logo.png'],
    logoVideo  : ['logo.webm'],  // WebM VP9 with alpha — export directly from After Effects via fnord WebM plugin
    music      : ['music.mp3'],
    content    : ['content.txt'],
  };

  // ── File matching ──────────────────────────────────────────────────────────

  /**
   * Resolves a browser File object to one of our known asset keys.
   * Matching is case-insensitive so "Background.PNG" still works.
   *
   * @param {File} file - The File object from the directory picker.
   * @returns {string|null} An asset key (e.g. 'background') or null if unknown.
   */
  function matchAssetKey(file) {
    const lowercaseName = file.name.toLowerCase();
    for (const [key, variants] of Object.entries(FILE_MAP)) {
      if (variants.includes(lowercaseName)) {
        return key;
      }
    }
    return null;
  }

  // ── Loaders ───────────────────────────────────────────────────────────────

  /**
   * Loads a WebM video file as a ready-to-use HTMLVideoElement for canvas compositing.
   * The video is muted, playsInline, and preloaded so it can be drawn to canvas
   * immediately via ctx.drawImage().
   *
   * Expected source: WebM VP9 with yuva420p alpha channel, exported from After Effects
   * using the fnord WebM exporter plugin.
   *
   * @param {File}                    file     - The .webm source file.
   * @param {function(string): void}  onStatus - Status callback for progress.
   * @returns {Promise<HTMLVideoElement>}
   */
  function loadVideoFile(file, onStatus) {
    onStatus(`Loading ${file.name}…`);

    return new Promise((resolve, reject) => {
      const video        = document.createElement('video');
      video.src          = URL.createObjectURL(file);
      video.muted        = true;   // required for autoplay and canvas export
      video.playsInline  = true;   // prevents fullscreen on iOS
      video.preload      = 'auto';

      // Resolve once enough data is available to draw the first frame.
      video.onloadeddata = () => resolve(video);
      video.onerror      = () => reject(new Error(`Failed to load video: ${file.name}`));

      video.load();
    });
  }

  /**
   * Creates an HTMLImageElement from a File and resolves when the image has
   * fully decoded. Uses a blob URL so no server is needed.
   *
   * @param {File} file - An image File (PNG, JPG, etc.).
   * @returns {Promise<HTMLImageElement>} The loaded image element.
   */
  function loadImageFromFile(file) {
    return new Promise((resolve, reject) => {
      const blobUrl = URL.createObjectURL(file);
      const img = new Image();

      img.onload = () => {
        // Keep the blob URL alive — the composer will use it to draw.
        resolve(img);
      };

      img.onerror = () => {
        URL.revokeObjectURL(blobUrl);
        reject(new Error(`Failed to load image: ${file.name}`));
      };

      img.src = blobUrl;
    });
  }

  /**
   * Reads a text File and returns its contents as a plain string.
   *
   * @param {File} file - A text File (e.g. content.txt).
   * @returns {Promise<string>} The UTF-8 file contents.
   */
  function readTextFromFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload  = (event) => resolve(event.target.result);
      reader.onerror = ()      => reject(new Error(`Failed to read: ${file.name}`));
      reader.readAsText(file, 'utf-8');
    });
  }

  // ── Main entry point ──────────────────────────────────────────────────────

  /**
   * Processes the FileList returned by the directory picker input.
   * Iterates through every file, matches it to a known asset key, and loads
   * it into the appropriate data structure.
   *
   * @param {FileList} fileList - Files from `<input webkitdirectory>`.
   * @param {function(string): void} onProgress - Called with a human-readable
   *   status string after each file is processed.
   * @returns {Promise<{
   *   images: Object.<string, HTMLImageElement>,
   *   audioFile: File|null,
   *   contentText: string|null
   * }>} Loaded assets. `images` keys match FILE_MAP image keys.
   */
  async function processFiles(fileList, onProgress) {
    const images      = {};   // { background, curvedline, person, logo }
    let   audioFile   = null; // The raw File for the music (loaded lazily by Audio)
    let   contentText = null; // Raw string from content.txt

    let loadedCount = 0;
    const files = Array.from(fileList);

    for (const file of files) {
      // Skip macOS metadata files and other hidden files
      if (file.name.startsWith('.')) continue;

      const key = matchAssetKey(file);
      if (key === null) continue; // unrecognised file — skip silently

      onProgress(`Loading ${file.name}…`);

      try {
        if (key === 'content') {
          // Parse the text content inline
          contentText = await readTextFromFile(file);

        } else if (key === 'music') {
          // Keep a reference to the File — Audio will create a blob URL on play
          audioFile = file;

        } else if (key === 'logoVideo') {
          // ProRes 4444 .mov — transcode in-browser to WebM VP9 with alpha,
          // then wrap in an HTMLVideoElement ready for canvas compositing.
          images.logoVideo = await loadVideoFile(file, onProgress);

        } else {
          // Static image asset (background, curvedline, person, logo)
          images[key] = await loadImageFromFile(file);
        }

        loadedCount++;

      } catch (error) {
        // Report the error but continue loading the remaining files
        onProgress(`Warning: ${error.message}`);
        console.warn('[Watcher]', error);
      }
    }

    const summary = buildSummary(images, audioFile, contentText);
    onProgress(`Loaded ${loadedCount} asset(s). ${summary}`);

    return { images, audioFile, contentText };
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  /**
   * Builds a short human-readable summary of what was found / missing.
   * Useful for the status bar so the user knows if something is absent.
   *
   * @param {Object} images      - Loaded image map.
   * @param {File|null} audioFile - Music file or null.
   * @param {string|null} contentText - Content text or null.
   * @returns {string} E.g. "Missing: person, music."
   */
  function buildSummary(images, audioFile, contentText) {
    const missing = [];
    const expectedImages = ['background', 'curvedline', 'person', 'logo'];

    for (const key of expectedImages) {
      // logo is satisfied by either logo.png (images.logo) or logo.mov (images.logoVideo)
      if (key === 'logo' && images.logoVideo) continue;
      if (!images[key]) missing.push(key);
    }
    if (!audioFile)   missing.push('music');
    if (!contentText) missing.push('content.txt');

    if (missing.length === 0) return 'All assets present.';
    return `Missing: ${missing.join(', ')}.`;
  }

  // ── Public API ────────────────────────────────────────────────────────────

  return {
    processFiles,
  };

})();
