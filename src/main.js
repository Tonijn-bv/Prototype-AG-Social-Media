/**
 * main.js — Application Bootstrap
 *
 * Entry point. Wires together Watcher, Composer, Exporter and UI.
 *
 * Startup sequence:
 *   1. Wait for the DOM to be ready.
 *   2. Initialise UI (resolves DOM references, binds buttons).
 *   3. Initialise Composer (sets up canvas for the default 16:9 format,
 *      pre-loads fonts).
 *   4. Listen for the folder-picker input — when the user selects the
 *      watchfolder directory, process it with Watcher and hand the loaded
 *      assets to Composer.
 *   5. Set up the animation-complete bridge so Composer → UI can communicate.
 */

(async function bootstrap() {

  // ── 1. Wait for the DOM ───────────────────────────────────────────────────

  await domReady();

  // ── 2. Initialise the UI module ───────────────────────────────────────────

  UI.init();
  UI.setStatus('Initialising…');

  // ── 3. Initialise the Composer ────────────────────────────────────────────

  const canvas = document.getElementById('preview-canvas');

  await Composer.init(canvas);

  // Register the animation-complete callback.
  // Composer calls this when the clip finishes playing; we relay it as a
  // custom DOM event so UI.js can react without a direct dependency on Composer.
  Composer.onComplete(() => {
    window.dispatchEvent(new CustomEvent('animation-complete'));
  });

  UI.setStatus('Ready — load the watch folder to begin.');

  // ── 4. Handle folder selection ────────────────────────────────────────────

  const folderInput = document.getElementById('folder-input');

  folderInput.addEventListener('change', async (event) => {
    const fileList = event.target.files;

    if (!fileList || fileList.length === 0) {
      UI.setStatus('No files selected.');
      return;
    }

    UI.setStatus('Loading assets…');

    try {
      // Process the selected files through Watcher.
      // Watcher matches filenames case-insensitively and loads images/text.
      const { images, audioFile, contentText } = await Watcher.processFiles(
        fileList,
        (message) => UI.setStatus(message)  // progress updates go to the status bar
      );

      // Pass the loaded assets to the Composer.
      // Composer will parse content.txt and draw the end-state frame immediately.
      Composer.setAssets(images, audioFile, contentText);

      // Enable playback and export buttons now that we have assets
      UI.enableControls();

    } catch (error) {
      UI.setStatus(`Error loading assets: ${error.message}`);
      console.error('[Main] Asset loading failed:', error);
    }

    // Reset the input value so re-selecting the same folder fires the change event again
    folderInput.value = '';
  });

})();

// ── Helper ────────────────────────────────────────────────────────────────────

/**
 * Returns a promise that resolves when the DOM content has finished loading.
 * If the DOM is already ready (e.g. the script ran after DOMContentLoaded),
 * the promise resolves immediately.
 *
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
