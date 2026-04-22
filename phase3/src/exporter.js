/**
 * exporter.js — Single & Batch Video Export (Phase 3)
 *
 * Two export modes:
 *
 *   Single export  — records the current row + current format as one clip.
 *   Batch export   — iterates every row × every format (3N total clips),
 *                    queuing each recording sequentially. Files download
 *                    automatically as each clip finishes.
 *
 * Each clip is 8 seconds. Keep the browser tab focused during batch export —
 * browsers throttle requestAnimationFrame for background tabs, which will
 * corrupt the recording timing.
 *
 * Output format: H.264 MP4 on Chrome 130+ and Safari; WebM VP9 fallback.
 * File naming: `{rowName}-{format}.mp4` (or .webm).
 *
 * Public API (on global `Exporter` object):
 *   Exporter.startSingleExport(rowName, format, onStatus)
 *   Exporter.startBatchExport(rows, loadRowFn, formats, onProgress)
 *   Exporter.isRecording()
 */

const Exporter = (() => {

  let mediaRecorder  = null;
  let recordedChunks = [];
  let recording      = false;

  // ── Codec selection ───────────────────────────────────────────────────────

  /**
   * Returns the best supported MediaRecorder MIME type.
   * Prefers H.264 MP4 (universally playable); falls back to WebM.
   *
   * @returns {string}
   */
  function getSupportedMimeType() {
    const candidates = [
      'video/mp4;codecs=avc1,mp4a.40.2',
      'video/mp4;codecs=avc1',
      'video/mp4',
      'video/webm;codecs=vp9',
      'video/webm;codecs=vp8',
      'video/webm',
    ];

    for (const mimeType of candidates) {
      if (MediaRecorder.isTypeSupported(mimeType)) return mimeType;
    }

    return '';
  }

  /**
   * Derives the file extension from the MIME type.
   * @param {string} mimeType
   * @returns {'mp4'|'webm'}
   */
  function getExtension(mimeType) {
    return mimeType.startsWith('video/mp4') ? 'mp4' : 'webm';
  }

  // ── Core recording ────────────────────────────────────────────────────────

  /**
   * Records a single clip for the current canvas state (row already loaded).
   * Returns a Promise that resolves after the recording stops and the file
   * has been downloaded.
   *
   * @param {string}               filename - Suggested download filename (without extension).
   * @param {function(string):void} onStatus - Status bar callback.
   * @returns {Promise<void>}
   */
  function recordClip(filename, onStatus) {
    return new Promise((resolve, reject) => {
      if (recording) {
        reject(new Error('Recording already in progress.'));
        return;
      }

      const canvas = Composer.getCanvas();
      if (!canvas) {
        onStatus('Export failed: no canvas found.');
        reject(new Error('No canvas.'));
        return;
      }

      // ── Build the media stream ─────────────────────────────────────────

      const CAPTURE_FPS = 30;
      const stream      = canvas.captureStream(CAPTURE_FPS);

      // Mix in the audio track if music is loaded.
      const audioStream = Composer.getAudioStream();
      if (audioStream) {
        audioStream.getAudioTracks().forEach(track => stream.addTrack(track));
      }

      // ── Set up MediaRecorder ───────────────────────────────────────────

      const mimeType   = getSupportedMimeType();
      const recOptions = mimeType ? { mimeType } : {};

      try {
        mediaRecorder = new MediaRecorder(stream, recOptions);
      } catch (err) {
        onStatus(`Export failed: ${err.message}`);
        reject(err);
        return;
      }

      recordedChunks = [];
      recording      = true;

      // Accumulate data chunks as they arrive from the encoder.
      mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          recordedChunks.push(event.data);
        }
      };

      // When recording stops, assemble the Blob and download it.
      mediaRecorder.onstop = () => {
        recording = false;

        const finalMime = mimeType || 'video/webm';
        const blob      = new Blob(recordedChunks, { type: finalMime });
        recordedChunks  = [];

        const fullFilename = `${filename}.${getExtension(finalMime)}`;
        downloadBlob(blob, fullFilename);
        onStatus(`Downloaded: ${fullFilename}`);

        resolve();
      };

      mediaRecorder.onerror = (event) => {
        recording = false;
        onStatus(`Export error: ${event.error}`);
        reject(event.error);
      };

      // When the animation completes, flush and stop the recorder.
      Composer.onComplete(() => {
        if (mediaRecorder && mediaRecorder.state === 'recording') {
          mediaRecorder.requestData();
          setTimeout(() => mediaRecorder.stop(), 200);
        }
      });

      // ── Start recording ────────────────────────────────────────────────

      Composer.setAudioLoop(false);
      Composer.reset();
      mediaRecorder.start(100);  // 100 ms slices
      Composer.play();
    });
  }

  // ── Public: single export ─────────────────────────────────────────────────

  /**
   * Records the currently loaded row + format as one clip and downloads it.
   * The canvas must already show the correct row (call loadRowFn first).
   *
   * @param {string}               rowName  - Used in the output filename.
   * @param {string}               format   - '16x9', '1x1', or '9x16'.
   * @param {function(string):void} onStatus - Status bar callback.
   */
  async function startSingleExport(rowName, format, onStatus) {
    Composer.setFormat(format);
    await recordClip(`${rowName}-${format}`, onStatus);
    window.dispatchEvent(new CustomEvent('recording-stopped'));
  }

  // ── Public: batch export ──────────────────────────────────────────────────

  /**
   * Iterates all rows × all requested formats, recording one clip per
   * combination. Downloads each file as it finishes.
   *
   * Each row is loaded via the provided `loadRowFn` before recording starts.
   * This keeps the exporter decoupled from main.js asset-loading logic.
   *
   * NOTE: Keep the browser tab in the foreground during batch export.
   * Background tabs throttle requestAnimationFrame and will distort timing.
   *
   * @param {Object[]}                  rows       - Array of row objects from Spreadsheet.
   * @param {function(Object):Promise}  loadRowFn  - Async fn that loads a row's assets
   *                                                 into Composer and returns when ready.
   * @param {string[]}                  formats    - Format keys to export per row.
   * @param {function(number, number, string, string):void} onProgress
   *        Called after each clip: (completedCount, totalCount, rowName, format).
   */
  async function startBatchExport(rows, loadRowFn, formats, onProgress) {
    if (recording) {
      console.warn('[Exporter] Batch export called while recording is in progress.');
      return;
    }

    const total = rows.length * formats.length;
    let   done  = 0;

    for (const row of rows) {
      // Load this row's images, content, and colour into the Composer.
      await loadRowFn(row);

      for (const format of formats) {
        Composer.setFormat(format);

        const rowName  = row.name || `row-${rows.indexOf(row) + 1}`;
        const filename = `${rowName}-${format}`;

        onProgress(done, total, rowName, format);

        await recordClip(filename, (msg) => onProgress(done, total, rowName, format, msg));

        done++;
        onProgress(done, total, rowName, format);
      }
    }

    // Notify the UI that all clips have been exported.
    window.dispatchEvent(new CustomEvent('batch-export-complete'));
  }

  // ── Download helper ───────────────────────────────────────────────────────

  /**
   * Triggers a browser file download for the given Blob.
   *
   * @param {Blob}   blob
   * @param {string} filename
   */
  function downloadBlob(blob, filename) {
    const url  = URL.createObjectURL(blob);
    const link = document.createElement('a');

    link.href     = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /**
   * Returns true while a recording is in progress.
   * @returns {boolean}
   */
  function isRecording() {
    return recording;
  }

  return {
    startSingleExport,
    startBatchExport,
    isRecording,
  };

})();
