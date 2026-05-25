<script setup lang="ts">
defineOptions({ name: 'HelpTab' })
</script>

<template>
  <div class="help-tab">
    <h2>Help</h2>
    <p class="help-note">Complete documentation with screenshots coming soon.</p>

    <section class="help-section">
      <h3>Capture Profiles</h3>
      <p>
        Profiles store your camera settings, grid layout, and inference
        preferences. Switch between profiles from the capture screen using
        the dropdown at the top.
      </p>
      <ul>
        <li><strong>Create</strong> — tap the profile dropdown and choose "+ New profile"</li>
        <li><strong>Edit</strong> — tap "Edit current profile" or open the editor from the profile picker</li>
        <li><strong>Delete</strong> — open the profile editor and use the Delete button at the bottom</li>
      </ul>
    </section>

    <section class="help-section">
      <h3>Tiling &amp; Grid Editor</h3>
      <p>
        In <strong>Tiled</strong> mode, the camera frame is divided into a grid.
        Each cell runs the detector independently, giving higher effective
        resolution for small or distant plates.
      </p>
      <ul>
        <li>Open the grid editor by tapping the &#x2370; button on the capture screen</li>
        <li>Tap a cell to toggle it on or off</li>
        <li>Disabled cells skip inference — use this to focus on the road area</li>
        <li>Adjust the grid size in the profile editor (1×1 through 4×4)</li>
        <li><strong>Whole-frame</strong> mode runs the detector on the entire frame (480p)</li>
      </ul>
    </section>

    <section class="help-section">
      <h3>Models</h3>
      <p>
        Choose a detector and OCR model in the Settings tab. Larger models
        are more accurate but slower. The default selection balances speed
        and accuracy for mobile use.
      </p>
      <p>
        <strong>Note:</strong> You must stop inference before changing models.
        The status bar shows the current backend (WASM or WebGPU).
      </p>
    </section>

    <section class="help-section">
      <h3>Filtering &amp; Recording</h3>
      <p>
        The filtering pipeline removes low-confidence and duplicate detections
        before they are recorded. Choose a preset in Settings:
      </p>
      <ul>
        <li><strong>Conservative</strong> — few false logs, may miss low-quality reads</li>
        <li><strong>Balanced</strong> — recommended default</li>
        <li><strong>Permissive</strong> — log more, risk of duplicates</li>
        <li><strong>Log All</strong> — no filtering (raw study mode)</li>
      </ul>
      <p>
        Advanced users can tune individual thresholds (detector confidence,
        OCR confidence, character confidence, bounding box area) and the
        K-of-N stabilizer.
      </p>
    </section>

    <section class="help-section">
      <h3>Status Bar</h3>
      <ul>
        <li><strong>FPS</strong> — frames per second being processed</li>
        <li><strong>TPS</strong> — tiles per second (shown when grid has multiple tiles)</li>
        <li><strong>WASM / WEBGPU</strong> — current inference backend</li>
        <li><strong>Performance dot</strong> — green (on target), yellow (struggling), red (overloaded)</li>
        <li><strong>OFFLINE</strong> — no network connection</li>
        <li><strong>CAM ERR / MODEL ERR</strong> — hardware or model issue</li>
      </ul>
    </section>

    <section class="help-section">
      <h3>Overlay Indicators</h3>
      <ul>
        <li><strong>Green box + plate text</strong> — successful detection &amp; OCR</li>
        <li><strong>Yellow dot at centroid</strong> — detector found a plate but OCR could not read it</li>
      </ul>
    </section>

    <hr class="help-divider" />

    <section class="help-section">
      <h3>About ALPRme</h3>
      <p>
        On-device license plate detection and OCR for dash camera use.
        All inference runs locally — no plate data leaves your device.
      </p>
    </section>

    <section class="help-section">
      <h3>Libraries</h3>
      <ul>
        <li><a href="https://vuejs.org/" target="_blank" rel="noopener">Vue 3</a> — reactive UI framework</li>
        <li><a href="https://vitejs.dev/" target="_blank" rel="noopener">Vite</a> — build tooling &amp; dev server</li>
        <li><a href="https://onnxruntime.ai/" target="_blank" rel="noopener">ONNX Runtime Web</a> — on-device neural network inference (Microsoft)</li>
        <li><a href="https://dexie.org/" target="_blank" rel="noopener">Dexie.js</a> — IndexedDB wrapper for session &amp; profile storage</li>
        <li><a href="https://leafletjs.com/" target="_blank" rel="noopener">Leaflet</a> — interactive maps for session review</li>
        <li><a href="https://primevue.org/" target="_blank" rel="noopener">PrimeVue</a> &amp; PrimeIcons — UI components</li>
        <li><a href="https://www.npmjs.com/package/magvar" target="_blank" rel="noopener">magvar</a> — magnetic declination for compass heading correction</li>
        <li><a href="https://developer.chrome.com/docs/workbox" target="_blank" rel="noopener">Workbox</a> — service worker &amp; PWA offline support</li>
        <li><a href="https://github.com/ankandrew/fast-alpr" target="_blank" rel="noopener">fast-alpr</a> — Python reference ALPR pipeline (MIT)</li>
        <li><a href="https://github.com/ankandrew/fast-plate-ocr" target="_blank" rel="noopener">fast-plate-ocr</a> — Python reference OCR (MIT)</li>
        <li><a href="https://github.com/ankandrew/open-image-models" target="_blank" rel="noopener">open-image-models</a> — Python reference detection (MIT)</li>
      </ul>
    </section>

    <section class="help-section">
      <h3>Models</h3>
      <ul>
        <li><strong>YOLOv9-t</strong> (256×256, 384×384, 512×512) — license plate detection by <a href="https://github.com/ankandrew" target="_blank" rel="noopener">@ankandrew</a> (MIT)</li>
        <li><strong>CCT XS v2 / CCT S v2</strong> (128×64) — license plate OCR with 66-country region recognition by <a href="https://github.com/ankandrew" target="_blank" rel="noopener">@ankandrew</a> (MIT)</li>
      </ul>
    </section>

    <section class="help-section">
      <h3>Evaluation Data</h3>
      <ul>
        <li><a href="https://huggingface.co/datasets/UniqueData/license_plates" target="_blank" rel="noopener">UniqueData/license_plates</a> — HuggingFace dataset used for cross-model parity evaluation</li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
.help-tab {
  position: absolute;
  inset: 0;
  z-index: 5;
  overflow-y: auto;
  background: #111;
  padding: 16px;
  padding-top: max(16px, env(safe-area-inset-top, 0px));
  padding-bottom: 80px;
  padding-left: max(16px, env(safe-area-inset-left, 0px));
  padding-right: max(16px, env(safe-area-inset-right, 0px));
  box-sizing: border-box;
  color: #ccc;
}

.help-tab h2 {
  margin: 0 0 6px;
  font-size: 18px;
  color: #fff;
}

.help-note {
  font-size: 12px;
  color: #ffaa55;
  margin: 0 0 20px;
}

.help-section {
  margin-bottom: 20px;
}

.help-section h3 {
  margin: 0 0 6px;
  font-size: 13px;
  color: #aaa;
}

.help-section p {
  margin: 0 0 8px;
  font-size: 12px;
  line-height: 1.6;
  color: #999;
}

.help-section ul {
  margin: 0 0 8px;
  padding: 0 0 0 16px;
  list-style: disc;
  font-size: 12px;
  line-height: 1.7;
  color: #999;
}

.help-section strong {
  color: #ccc;
}

.help-divider {
  border: none;
  border-top: 1px solid #333;
  margin: 24px 0 20px;
}

.help-section a {
  color: #7af;
  text-decoration: none;
}
</style>
