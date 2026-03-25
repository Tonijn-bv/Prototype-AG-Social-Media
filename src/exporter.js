/**
 * exporter.js — Video Export via MediaRecorder API
 *
 * Records the canvas as a .webm video file using the browser-native
 * MediaRecorder API. No server or external library required.
 *
 * Export flow:
 *   1. User clicks "Record & Export".
 *   2. Exporter resets the animation to frame 0.
 *   3. MediaRecorder begins capturing the canvas stream.
 *   4. The animation plays in full.
 *   5. When the animation completes, recording stops.
 *   6. The browser triggers a .webm download named after the active format.
 *
 * Output format: H.264 MP4 is preferred (universally playable). Chrome 130+
 * and Safari both support MP4 recording natively via MediaRecorder. Older
 * browsers fall back to WebM VP9/VP8. The downloaded filename uses the correct
 * extension (.mp4 or .webm) based on what the browser actually recorded.
 *
 * Audio: music is routed through the Web Audio API (AudioContext →
 * MediaElementSourceNode → MediaStreamDestinationNode) so its track can be
 * added to the canvas MediaStream before MediaRecorder starts.
 *
 * Public API (on global `Exporter` object):
 *   Exporter.startRecording(format)   // '16x9' | '1x1'
 *   Exporter.isRecording()            // boolean
 */

const Exporter = (() => {

  // ── State ─────────────────────────────────────────────────────────────────

  let mediaRecorder  = null;   // Active MediaRecorder instance
  let recordedChunks = [];     // Accumulates Blob chunks from MediaRecorder
  let recording      = false;  // Whether a recording is in progress

  // ── Codec selection ───────────────────────────────────────────────────────

  /**
   * Returns the best supported MIME type for the current browser.
   *
   * Prefers H.264 MP4 — universally playable on all devices and platforms.
   * Chrome 130+ and Safari both support MP4 recording natively via MediaRecorder.
   * Falls back to WebM VP9/VP8 for older Chrome versions.
   *
   * @returns {string} A MIME type string, e.g. 'video/mp4;codecs=avc1'.
   */
  function getSupportedMimeType() {
    const candidates = [
      'video/mp4;codecs=avc1,mp4a.40.2',  // H.264 video + AAC audio (Chrome 130+, Safari)
      'video/mp4;codecs=avc1',             // H.264 video only
      'video/mp4',                          // MP4 — browser picks codec
      'video/webm;codecs=vp9',             // VP9 fallback (older Chrome)
      'video/webm;codecs=vp8',             // VP8 fallback
      'video/webm',
    ];

    for (const mimeType of candidates) {
      if (MediaRecorder.isTypeSupported(mimeType)) {
        return mimeType;
      }
    }

    return '';
  }

  /**
   * Derives the output file extension from the recorded MIME type.
   * MP4 variants produce .mp4; everything else produces .webm.
   *
   * @param {string} mimeType - The MIME type string used for recording.
   * @returns {string} 'mp4' or 'webm'.
   */
  function getExtension(mimeType) {
    return mimeType.startsWith('video/mp4') ? 'mp4' : 'webm';
  }

  // ── Recording ─────────────────────────────────────────────────────────────

  /**
   * Captures the canvas as a .webm video for the full animation duration.
   * Resets the animation to frame 0 before recording starts, then plays
   * through to completion before triggering a file download.
   *
   * @param {string} format - Active format key ('16x9' or '1x1'), used to
   *   name the downloaded file.
   * @param {function(string): void} onStatus - Callback for status bar updates.
   */
  function startRecording(format, onStatus) {
    if (recording) {
      console.warn('[Exporter] Recording already in progress.');
      return;
    }

    const canvas = Composer.getCanvas();
    if (!canvas) {
      onStatus('Export failed: no canvas found.');
      return;
    }

    // ── 1. Set up the canvas media stream ──────────────────────────────────

    // captureStream() returns a MediaStream from the canvas at the given FPS.
    // 30 fps gives smooth motion; reduce to 25 if performance is a concern.
    const CAPTURE_FPS = 30;
    const stream      = canvas.captureStream(CAPTURE_FPS);

    // Mix in the audio track if music is loaded.
    // Composer routes the HTMLAudioElement through Web Audio so we can capture
    // it as a MediaStream track alongside the canvas video track.
    const audioStream = Composer.getAudioStream();
    if (audioStream) {
      audioStream.getAudioTracks().forEach(track => stream.addTrack(track));
    }

    // ── 2. Configure MediaRecorder ─────────────────────────────────────────

    const mimeType    = getSupportedMimeType();
    const recOptions  = mimeType ? { mimeType } : {};

    try {
      mediaRecorder = new MediaRecorder(stream, recOptions);
    } catch (err) {
      onStatus(`Export failed: MediaRecorder error — ${err.message}`);
      console.error('[Exporter] MediaRecorder creation failed:', err);
      return;
    }

    recordedChunks = [];
    recording      = true;

    // ── 3. Collect data chunks as they arrive ──────────────────────────────

    mediaRecorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        recordedChunks.push(event.data);
      }
    };

    // ── 4. When recording stops, assemble and download the file ───────────

    mediaRecorder.onstop = () => {
      recording = false;

      // Restore looping so music loops again during preview after export
      Composer.setAudioLoop(true);

      // Assemble all chunks into a single Blob
      const finalMime = mimeType || 'video/webm';
      const blob      = new Blob(recordedChunks, { type: finalMime });
      recordedChunks  = [];

      // Trigger browser download — use .mp4 or .webm depending on what was recorded
      const filename  = `clip-${format}.${getExtension(finalMime)}`;
      downloadBlob(blob, filename);

      onStatus(`Export complete — downloading ${filename}`);

      // Notify the UI that recording is done
      window.dispatchEvent(new CustomEvent('recording-stopped'));
    };

    mediaRecorder.onerror = (event) => {
      recording = false;
      onStatus(`Export error: ${event.error}`);
      console.error('[Exporter] MediaRecorder error:', event.error);
      window.dispatchEvent(new CustomEvent('recording-stopped'));
    };

    // ── 5. Register a completion hook on the composer ─────────────────────

    // When the animation finishes, stop the recorder.
    // A small timeout ensures the last frame is flushed into a data chunk.
    Composer.onComplete(() => {
      if (mediaRecorder && mediaRecorder.state === 'recording') {
        // Request a final data chunk before stopping
        mediaRecorder.requestData();
        setTimeout(() => {
          mediaRecorder.stop();
        }, 200);
      }
    });

    // ── 6. Reset animation and start recording ────────────────────────────

    onStatus(`Recording ${format} clip…`);

    // Disable music looping so the export contains exactly one pass of audio.
    // Looping is restored in onstop once the recording is complete.
    Composer.setAudioLoop(false);

    // Reset to frame 0 first
    Composer.reset();

    // Start collecting data in 100 ms slices (more slices = safer recovery on error)
    mediaRecorder.start(100);

    // Play the animation — Composer will call onComplete() when it ends
    Composer.play();
  }

  // ── Download helper ───────────────────────────────────────────────────────

  /**
   * Triggers a browser file download for the given Blob.
   * Creates a temporary <a> element, clicks it programmatically, then removes it.
   *
   * @param {Blob}   blob     - The file data to download.
   * @param {string} filename - The suggested filename for the download.
   */
  function downloadBlob(blob, filename) {
    const url  = URL.createObjectURL(blob);
    const link = document.createElement('a');

    link.href     = url;
    link.download = filename;

    // The link must be in the DOM for Firefox to trigger the download
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    // Revoke the blob URL after a short delay to free memory
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /**
   * Returns true while a recording is in progress.
   * Used by UI to disable other controls during export.
   *
   * @returns {boolean}
   */
  function isRecording() {
    return recording;
  }

  return {
    startRecording,
    isRecording,
  };

})();
