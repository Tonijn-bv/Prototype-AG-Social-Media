/**
 * transcoder.js — In-browser MOV → WebM VP9 alpha transcoder
 *
 * Uses FFmpeg.wasm (compiled to WebAssembly) to transcode an Apple ProRes 4444
 * .mov file (with alpha channel) to WebM / VP9 with alpha — entirely in the
 * browser, no server required.
 *
 * FFmpeg.wasm is loaded lazily on first use. The ~30 MB core wasm file is
 * fetched from jsDelivr and cached in memory for the lifetime of the page.
 *
 * NOTE: This module does NOT use @ffmpeg/util. All file I/O uses native browser
 * APIs (file.arrayBuffer(), fetch(), Blob, URL.createObjectURL) to avoid
 * dependency on a second CDN package with uncertain global variable names.
 *
 * Public API (on global `Transcoder` object):
 *   Transcoder.toWebMAlpha(file, onStatus)
 *     → Promise<string>  (blob URL of the output .webm)
 */

const Transcoder = (() => {

  /** Singleton FFmpeg instance — created once, reused for every transcode. */
  let ffmpegInstance = null;

  // ── Helpers ────────────────────────────────────────────────────────────────

  /**
   * Fetches a remote URL and returns a local blob URL with the given MIME type.
   * This sidesteps CORS and MIME-type restrictions that block direct CDN URLs
   * in some browsers when the page is opened as file://.
   *
   * @param {string} url      - Remote URL to fetch.
   * @param {string} mimeType - MIME type for the resulting blob (e.g. 'text/javascript').
   * @returns {Promise<string>} A blob: URL pointing to the fetched content.
   */
  async function toBlobURL(url, mimeType) {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
    }
    const buffer = await response.arrayBuffer();
    const blob   = new Blob([buffer], { type: mimeType });
    return URL.createObjectURL(blob);
  }

  // ── Initialisation ─────────────────────────────────────────────────────────

  /**
   * Loads and initialises the FFmpeg.wasm engine. Safe to call multiple times —
   * subsequent calls return immediately once the engine is already loaded.
   *
   * Uses the single-threaded core (@ffmpeg/core) which does not require
   * SharedArrayBuffer and therefore works without special HTTP headers.
   *
   * @param {function(string): void} onStatus - Status bar callback.
   */
  async function ensureLoaded(onStatus) {
    if (ffmpegInstance) return;

    // Guard: verify the FFmpeg.wasm UMD bundle was loaded before this script.
    if (typeof FFmpegWASM === 'undefined' || typeof FFmpegWASM.FFmpeg === 'undefined') {
      throw new Error(
        'FFmpeg.wasm is not loaded. Make sure the ffmpeg.js CDN script appears before transcoder.js in index.html.'
      );
    }

    onStatus('Loading FFmpeg.wasm — this may take a moment on first use…');

    // jsDelivr mirror — more reliable than unpkg for WASM MIME types.
    const BASE_URL = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/umd';

    const { FFmpeg } = FFmpegWASM;
    ffmpegInstance = new FFmpeg();

    // Route FFmpeg console output to the browser console for debugging.
    ffmpegInstance.on('log', ({ message }) => {
      console.log('[FFmpeg]', message);
    });

    // Fetch the JS and WASM files ourselves and wrap them in blob: URLs.
    // This avoids CORS / MIME-type issues that occur when FFmpeg.wasm tries
    // to load() from a direct https:// URL in a file:// page context.
    const [coreURL, wasmURL] = await Promise.all([
      toBlobURL(`${BASE_URL}/ffmpeg-core.js`,   'text/javascript'),
      toBlobURL(`${BASE_URL}/ffmpeg-core.wasm`, 'application/wasm'),
    ]);

    await ffmpegInstance.load({ coreURL, wasmURL });

    onStatus('FFmpeg.wasm ready.');
  }

  // ── Transcoding ────────────────────────────────────────────────────────────

  /**
   * Transcodes a .mov file (Apple ProRes 4444 with alpha) to WebM / VP9 with
   * a full alpha channel (yuva420p pixel format).
   *
   * Transcode settings:
   *   - Codec:   libvpx-vp9
   *   - Pixel format: yuva420p  (VP9 alpha channel)
   *   - Bitrate: quality mode (-b:v 0 -crf 15) — good quality, reasonable size
   *   - Audio:   stripped (-an) — this project uses a separate music track
   *
   * @param {File}                   file     - The .mov source file from the
   *                                            directory picker.
   * @param {function(string): void} onStatus - Status bar callback for progress
   *                                            messages.
   * @returns {Promise<string>} A blob URL pointing to the transcoded .webm file.
   *                            The caller is responsible for revoking it when done.
   */
  async function toWebMAlpha(file, onStatus) {
    await ensureLoaded(onStatus);

    onStatus(`Transcoding ${file.name} → WebM VP9 with alpha…`);

    // Report progress as a percentage while FFmpeg runs.
    const onProgress = ({ progress }) => {
      if (progress > 0) {
        onStatus(`Transcoding… ${Math.round(progress * 100)}%`);
      }
    };
    ffmpegInstance.on('progress', onProgress);

    try {
      // Read the source file directly via the browser File API — no fetchFile needed.
      const inputData = new Uint8Array(await file.arrayBuffer());

      // Write the source bytes into FFmpeg's virtual in-memory filesystem.
      await ffmpegInstance.writeFile('input.mov', inputData);

      // Run the transcode command.
      await ffmpegInstance.exec([
        '-i',       'input.mov',
        '-c:v',     'libvpx-vp9',   // VP9 codec — the only browser-native codec
                                     // that supports a real alpha channel
        '-pix_fmt', 'yuva420p',      // YUV + alpha — required for transparency
        '-b:v',     '0',             // disable target bitrate; use quality mode
        '-crf',     '15',            // quality: 0 = lossless, 63 = worst; 10–20 is good
        '-an',                       // strip audio (separate music track used instead)
        'output.webm',
      ]);

      // Read the output back from the virtual filesystem.
      const outputData = await ffmpegInstance.readFile('output.webm');

      // Wrap the output bytes in a Blob and return a browser-usable URL.
      const blob = new Blob([outputData.buffer], { type: 'video/webm' });
      onStatus(`Transcoding complete — ${file.name} ready.`);
      return URL.createObjectURL(blob);

    } finally {
      // Always remove the progress listener and clean up virtual FS entries,
      // even if the transcode fails.
      ffmpegInstance.off('progress', onProgress);

      try { await ffmpegInstance.deleteFile('input.mov');  } catch (_) {}
      try { await ffmpegInstance.deleteFile('output.webm'); } catch (_) {}
    }
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  return {
    toWebMAlpha,
  };

})();
