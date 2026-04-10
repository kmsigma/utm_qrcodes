// QR Codes page logic
// - Parses URL for UTM params and strips them from base URL
// - Builds final campaign URL from form fields
// - Saves/loads history to localStorage
// - Generates QR codes and supports center-image overlay
// - Provides copy and PNG download at 512x512

// Utility: debounce a function call
function debounce(fn, ms) {
  let timer;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
}

// Constants
const STORAGE_KEY = "qr_saved_urls_v1";
const UTM_KEYS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_id",
  "utm_term",
  "utm_content",
  "urm_content", // typo-tolerant: catches misspelled utm_content in pasted URLs
];

// DOM
const websiteEl = document.getElementById("website");
const utm_sourceEl = document.getElementById("utm_source");
const utm_mediumEl = document.getElementById("utm_medium");
const utm_campaignEl = document.getElementById("utm_campaign");
const utm_idEl = document.getElementById("utm_id");
const utm_termEl = document.getElementById("utm_term");
const utm_contentEl = document.getElementById("utm_content");
const finalUrlEl = document.getElementById("finalUrl");
const messageEl = document.getElementById("message");
const qrCanvas = document.getElementById("qrCanvas");
const saveBtn = document.getElementById("saveBtn");
const saveNameEl = document.getElementById("saveName");
const savedItemsEl = document.getElementById("savedItems");
const clearBtn = document.getElementById("clearBtn");
const clearHistoryBtn = document.getElementById("clearHistoryBtn");
const shareBtn = document.getElementById("shareBtn");
const copyBtn = document.getElementById("copyBtn");
const downloadBtn = document.getElementById("downloadBtn");
const centerUpload = document.getElementById("centerUpload");
const removeImageBtn = document.getElementById("removeImageBtn");
const statusEl = document.getElementById("status");
const clearHistoryModal = document.getElementById("clearHistoryModal");
const modalCancelBtn = document.getElementById("modalCancelBtn");
const modalConfirmBtn = document.getElementById("modalConfirmBtn");
const deleteItemModal = document.getElementById("deleteItemModal");
const deleteItemDetails = document.getElementById("deleteItemDetails");
const deleteItemCancelBtn = document.getElementById("deleteItemCancelBtn");
const deleteItemConfirmBtn = document.getElementById("deleteItemConfirmBtn");
const helpBtn = document.getElementById("helpBtn");
const helpPanel = document.getElementById("helpPanel");
const helpCloseBtn = document.getElementById("helpCloseBtn");

let pendingDeleteIdx = null;

let saved = [];
let centerImage = null;        // Image element for overlay
let centerImageDataUrl = null; // base64 data URL of current center image (for saving)
let lastQrUrl = null;          // most recently generated QR URL (for download reuse)
let lastDataUrl = null;        // most recently generated QR data URL

// Utility: try to create URL; if missing scheme, prefix https://
function safeParseUrl(raw) {
  try {
    return new URL(raw);
  } catch (e) {
    try {
      return new URL("https://" + raw);
    } catch (e2) {
      return null;
    }
  }
}

// Strip known UTM params from URL and return {baseUrl, extracted}
function stripAndExtractUTM(rawUrl) {
  const parsed = safeParseUrl(rawUrl);
  if (!parsed) return { baseUrl: rawUrl, extracted: {} };
  const params = parsed.searchParams;
  const extracted = {};
  for (const key of [...params.keys()]) {
    const kl = key.toLowerCase();
    if (UTM_KEYS.includes(kl)) {
      extracted[kl] = params.get(key);
      params.delete(key);
    }
  }
  const base =
    parsed.origin +
    parsed.pathname +
    (params.toString() ? "?" + params.toString() : "") +
    (parsed.hash || "");
  return { baseUrl: base, extracted };
}

// Build final campaign URL from base and utm map
function buildFinalUrl(baseUrl, utm) {
  try {
    const u = new URL(baseUrl);
    const sp = new URLSearchParams(u.search);
    for (const k of [
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_id",
      "utm_term",
      "utm_content",
    ]) {
      if (utm[k]) sp.set(k, utm[k]);
    }
    u.search = sp.toString();
    return u.toString();
  } catch (e) {
    // fallback: string concatenation for unparseable base URLs
    const parts = [];
    for (const k of [
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_id",
      "utm_term",
      "utm_content",
    ]) {
      if (utm[k])
        parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(utm[k])}`);
    }
    if (parts.length === 0) return baseUrl;
    return baseUrl + (baseUrl.includes("?") ? "&" : "?") + parts.join("&");
  }
}

// Load saved list from storage
function loadSaved() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    saved = raw ? JSON.parse(raw) : [];
  } catch (e) {
    saved = [];
  }
  renderSaved();
}

// Persist saved list
function persistSaved() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
}

// Render saved items column
function renderSaved() {
  savedItemsEl.innerHTML = "";
  document.querySelectorAll(".preview-box").forEach((n) => n.remove());
  clearHistoryBtn.style.display = saved.length === 0 ? "none" : "";
  if (saved.length === 0) {
    savedItemsEl.innerHTML = '<div class="empty">No saved URLs</div>';
    return;
  }
  saved.forEach((s, idx) => {
    const el = document.createElement("div");
    el.className = "saved-item";

    const left = document.createElement("div");
    left.className = "saved-summary";
    const titleDiv = document.createElement("div");
    titleDiv.className = "saved-title";
    const titleText =
      s.name || s.utm_campaign || s.utm_medium || s.baseUrl || "(untitled)";
    const strong = document.createElement("strong");
    strong.textContent = titleText;
    titleDiv.appendChild(strong);
    if (s.imageDataUrl) {
      const imgBadge = document.createElement("span");
      imgBadge.title = "Has center image";
      imgBadge.setAttribute("aria-label", "Has center image");
      imgBadge.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="currentColor" style="margin-left:5px;vertical-align:middle;opacity:0.5" viewBox="0 0 16 16"><path d="M6.002 5.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0"/><path d="M2.002 1a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V3a2 2 0 0 0-2-2zm12 1a1 1 0 0 1 1 1v6.5l-3.777-1.947a.5.5 0 0 0-.577.093l-3.71 3.71-2.66-1.772a.5.5 0 0 0-.63.062L1.002 12V3a1 1 0 0 1 1-1z"/></svg>`;
      titleDiv.appendChild(imgBadge);
    }
    left.appendChild(titleDiv);

    // Hover preview: appended to body to avoid scroll-container clipping
    const preview = document.createElement("div");
    preview.className = "preview-box";
    preview.style.display = "none";
    const urlEl = document.createElement("div");
    urlEl.className = "preview-url";
    urlEl.textContent = s.baseUrl || "";
    preview.appendChild(urlEl);

    const params = [
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_id",
      "utm_term",
      "utm_content",
    ];
    let hasParams = false;
    for (const p of params) {
      const v = s[p];
      if (v) {
        hasParams = true;
        const pEl = document.createElement("div");
        pEl.className = "preview-param";
        if (p === "utm_source" || p === "utm_medium") {
          pEl.innerHTML = `<strong>${escapeHtml(p)}:</strong> ${escapeHtml(v)}`;
        } else {
          pEl.textContent = `${p}: ${v}`;
        }
        preview.appendChild(pEl);
      }
    }
    if (!hasParams) {
      const none = document.createElement("div");
      none.className = "preview-param";
      none.textContent = "No UTM parameters";
      preview.appendChild(none);
    }

    document.body.appendChild(preview);
    el.addEventListener("mouseenter", () => {
      // Show off-screen first to measure true height before final positioning
      preview.style.visibility = "hidden";
      preview.style.display = "block";
      const previewH = preview.offsetHeight;

      const rect = el.getBoundingClientRect();
      const pad = 8;
      const previewW = 340;
      let leftPos = rect.right + pad;
      let topPos = rect.top;
      if (leftPos + previewW > window.innerWidth - 8) {
        leftPos = rect.left - previewW - pad;
        if (leftPos < 8) leftPos = 8;
      }
      if (topPos + previewH > window.innerHeight - 8)
        topPos = Math.max(8, window.innerHeight - previewH - 8);
      preview.style.left = leftPos + "px";
      preview.style.top = topPos + "px";
      preview.style.visibility = "";
    });
    el.addEventListener("mouseleave", () => {
      preview.style.display = "none";
    });

    const actions = document.createElement("div");

    const loadBtn = document.createElement("button");
    loadBtn.className = "saved-action-load";
    loadBtn.dataset.tooltip = "Load into form";
    loadBtn.setAttribute("aria-label", "Load into form");
    loadBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 16 16"><path fill-rule="evenodd" d="M6 3.5a.5.5 0 0 1 .5-.5h8a.5.5 0 0 1 .5.5v9a.5.5 0 0 1-.5.5h-8a.5.5 0 0 1-.5-.5v-2a.5.5 0 0 0-1 0v2A1.5 1.5 0 0 0 6.5 14h8a1.5 1.5 0 0 0 1.5-1.5v-9A1.5 1.5 0 0 0 14.5 2h-8A1.5 1.5 0 0 0 5 3.5v2a.5.5 0 0 0 1 0z"/><path fill-rule="evenodd" d="M11.854 8.354a.5.5 0 0 0 0-.708l-3-3a.5.5 0 1 0-.708.708L10.293 7.5H1.5a.5.5 0 0 0 0 1h8.793l-2.147 2.146a.5.5 0 0 0 .708.708z"/></svg>`;
    loadBtn.onclick = () => loadSavedItem(idx);

    const delBtn = document.createElement("button");
    delBtn.className = "saved-action-del";
    delBtn.dataset.tooltip = "Delete from history";
    delBtn.setAttribute("aria-label", "Delete from history");
    delBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 16 16"><path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5m2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5m3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0z"/><path d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4zM2.5 3h11V2h-11z"/></svg>`;
    delBtn.onclick = () => {
      pendingDeleteIdx = idx;
      populateDeleteModal(s);
      deleteItemModal.removeAttribute("hidden");
      deleteItemCancelBtn.focus();
    };

    actions.appendChild(loadBtn);
    actions.appendChild(delBtn);
    el.appendChild(left);
    el.appendChild(actions);
    savedItemsEl.appendChild(el);
  });
}

// HTML-escape text for innerHTML insertion
function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Load a saved entry into the form
function loadSavedItem(idx) {
  const s = saved[idx];
  if (!s) return;
  websiteEl.value = s.baseUrl || "";
  utm_sourceEl.value = s.utm_source || "";
  utm_mediumEl.value = s.utm_medium || "";
  utm_campaignEl.value = s.utm_campaign || "";
  utm_idEl.value = s.utm_id || "";
  utm_termEl.value = s.utm_term || "";
  utm_contentEl.value = s.utm_content || "";

  if (s.imageDataUrl) {
    const img = new Image();
    img.onload = () => {
      centerImage = img;
      centerImageDataUrl = s.imageDataUrl;
      removeImageBtn.style.display = "";
      updateAll();
    };
    img.src = s.imageDataUrl;
  } else {
    centerImage = null;
    centerImageDataUrl = null;
    centerUpload.value = "";
    removeImageBtn.style.display = "none";
    updateAll();
  }
}

// Save current form to history
function saveCurrent() {
  const base = (websiteEl.value || "").trim();
  if (!base || !utm_sourceEl.value.trim() || !utm_mediumEl.value.trim()) {
    statusEl.textContent = "Website URL, utm_source, and utm_medium are required before saving.";
    return;
  }
  const entry = {
    name: saveNameEl.value || "",
    baseUrl: base,
    utm_source: utm_sourceEl.value || "",
    utm_medium: utm_mediumEl.value || "",
    utm_campaign: utm_campaignEl.value || "",
    utm_id: utm_idEl.value || "",
    utm_term: utm_termEl.value || "",
    utm_content: utm_contentEl.value || "",
    finalUrl: finalUrlEl.value || "",
    imageDataUrl: centerImageDataUrl || null,
    ts: Date.now(),
  };
  saved.unshift(entry);
  if (saved.length > 200) saved.length = 200;
  persistSaved();
  renderSaved();
}

// Clear all input fields
function clearFields() {
  websiteEl.value = "";
  utm_sourceEl.value = "";
  utm_mediumEl.value = "";
  utm_campaignEl.value = "";
  utm_idEl.value = "";
  utm_termEl.value = "";
  utm_contentEl.value = "";
  saveNameEl.value = "";
  centerImage = null;
  centerImageDataUrl = null;
  centerUpload.value = "";
  removeImageBtn.style.display = "none";
  history.replaceState(null, "", window.location.pathname);
  updateAll();
}

// Generate QR and draw into visible canvas. If mandatory fields missing, clear canvas and show warning.
async function updateAll() {
  messageEl.textContent = "";
  messageEl.classList.remove("error");

  // detect if website contains utm params; if yes, populate empty fields
  const parsed = stripAndExtractUTM(websiteEl.value || "");
  if (Object.keys(parsed.extracted).length > 0) {
    for (const k of Object.keys(parsed.extracted)) {
      const v = parsed.extracted[k];
      if (!v) continue;
      if (k === "utm_source" && !utm_sourceEl.value) utm_sourceEl.value = v;
      if (k === "utm_medium" && !utm_mediumEl.value) utm_mediumEl.value = v;
      if (k === "utm_campaign" && !utm_campaignEl.value) utm_campaignEl.value = v;
      if (k === "utm_id" && !utm_idEl.value) utm_idEl.value = v;
      if (k === "utm_term" && !utm_termEl.value) utm_termEl.value = v;
      if ((k === "utm_content" || k === "urm_content") && !utm_contentEl.value)
        utm_contentEl.value = v;
    }
    websiteEl.value = parsed.baseUrl;
  }

  const base = websiteEl.value || "";
  const utm = {
    utm_source: utm_sourceEl.value.trim(),
    utm_medium: utm_mediumEl.value.trim(),
    utm_campaign: utm_campaignEl.value.trim(),
    utm_id: utm_idEl.value.trim(),
    utm_term: utm_termEl.value.trim(),
    utm_content: utm_contentEl.value.trim(),
  };
  const mandatoryOk =
    base.trim() !== "" && utm.utm_source !== "" && utm.utm_medium !== "";

  websiteEl.classList.toggle("input-error", base.trim() === "");
  utm_sourceEl.classList.toggle("input-error", utm.utm_source === "");
  utm_mediumEl.classList.toggle("input-error", utm.utm_medium === "");

  const final = buildFinalUrl(base, utm);
  finalUrlEl.value = final;
  finalUrlEl.style.height = "auto";
  finalUrlEl.style.height = finalUrlEl.scrollHeight + "px";

  if (!mandatoryOk) {
    const missing = [];
    if (base.trim() === "") missing.push("Website URL");
    if (utm.utm_source === "") missing.push("utm_source");
    if (utm.utm_medium === "") missing.push("utm_medium");
    messageEl.innerHTML =
      "<p>Missing required information:</p><ul><li>" +
      missing.join("</li><li>") +
      "</li></ul><p>Complete all required fields.</p>";
    messageEl.classList.add("error");
    clearCanvas();
    return;
  }

  try {
    const dataUrl = await QRCode.toDataURL(final, { width: 512, margin: 1 });
    lastQrUrl = final;
    lastDataUrl = dataUrl;
    const img = new Image();
    img.onload = () => {
      qrCanvas.style.display = "";
      const ctx = qrCanvas.getContext("2d");
      ctx.clearRect(0, 0, qrCanvas.width, qrCanvas.height);
      ctx.drawImage(img, 0, 0, qrCanvas.width, qrCanvas.height);
      if (centerImage) {
        const cw = qrCanvas.width;
        const ch = qrCanvas.height;
        const size = Math.floor(Math.min(cw, ch) * 0.22);
        const x = Math.floor((cw - size) / 2);
        const y = Math.floor((ch - size) / 2);
        ctx.fillStyle = "#fff";
        ctx.fillRect(x - 4, y - 4, size + 8, size + 8);
        ctx.drawImage(centerImage, x, y, size, size);
      }
    };
    img.src = dataUrl;
  } catch (err) {
    messageEl.textContent =
      "Error generating QR: " + (err && err.message ? err.message : String(err));
    clearCanvas();
  }
}

function clearCanvas() {
  const ctx = qrCanvas.getContext("2d");
  ctx.clearRect(0, 0, qrCanvas.width, qrCanvas.height);
  qrCanvas.style.display = "none";
}

// Encode an Image element to a compact URL-safe string.
// Tries WebP first (smaller); falls back to PNG if WebP encoding is unsupported.
// Format: one-char type prefix ("w" = webp, "p" = png) + URL-safe base64 (no padding).
function encodeImageForUrl(img) {
  const off = document.createElement("canvas");
  off.width = CENTER_IMAGE_SIZE;
  off.height = CENTER_IMAGE_SIZE;
  off.getContext("2d").drawImage(img, 0, 0, CENTER_IMAGE_SIZE, CENTER_IMAGE_SIZE);
  let dataUrl = off.toDataURL("image/webp", 0.9);
  const type = dataUrl.startsWith("data:image/webp") ? "w" : "p";
  if (type === "p") dataUrl = off.toDataURL("image/png");
  const b64 = dataUrl.split(",")[1];
  return type + b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

// Decode the URL-safe image string back to a data URL.
function decodeImageFromUrl(encoded) {
  const type = encoded[0];
  const b64safe = encoded.slice(1);
  const b64 = b64safe.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - b64.length % 4) % 4);
  const mime = type === "w" ? "image/webp" : "image/png";
  return `data:${mime};base64,${padded}`;
}

// Build a shareable URL encoding the current form state as query parameters
function buildShareUrl() {
  const params = new URLSearchParams();
  const base = websiteEl.value.trim();
  if (base)                          params.set("website",      base);
  if (utm_sourceEl.value.trim())     params.set("utm_source",   utm_sourceEl.value.trim());
  if (utm_mediumEl.value.trim())     params.set("utm_medium",   utm_mediumEl.value.trim());
  if (utm_campaignEl.value.trim())   params.set("utm_campaign", utm_campaignEl.value.trim());
  if (utm_idEl.value.trim())         params.set("utm_id",       utm_idEl.value.trim());
  if (utm_termEl.value.trim())       params.set("utm_term",     utm_termEl.value.trim());
  if (utm_contentEl.value.trim())    params.set("utm_content",  utm_contentEl.value.trim());
  if (saveNameEl.value.trim())       params.set("name",         saveNameEl.value.trim());
  if (centerImage)                   params.set("img",          encodeImageForUrl(centerImage));
  const qs = params.toString();
  return window.location.origin + window.location.pathname + (qs ? "?" + qs : "");
}

// Pre-populate form from URL query parameters (for shared links)
async function loadFromUrl() {
  const params = new URLSearchParams(window.location.search);
  if (params.size === 0) return;
  if (params.has("website"))      websiteEl.value       = params.get("website");
  if (params.has("utm_source"))   utm_sourceEl.value    = params.get("utm_source");
  if (params.has("utm_medium"))   utm_mediumEl.value    = params.get("utm_medium");
  if (params.has("utm_campaign")) utm_campaignEl.value  = params.get("utm_campaign");
  if (params.has("utm_id"))       utm_idEl.value        = params.get("utm_id");
  if (params.has("utm_term"))     utm_termEl.value      = params.get("utm_term");
  if (params.has("utm_content"))  utm_contentEl.value   = params.get("utm_content");
  if (params.has("name"))         saveNameEl.value      = params.get("name");
  if (params.has("img")) {
    const dataUrl = decodeImageFromUrl(params.get("img"));
    await new Promise(resolve => {
      const img = new Image();
      img.onload = () => {
        centerImage = img;
        centerImageDataUrl = dataUrl;
        removeImageBtn.style.display = "";
        resolve();
      };
      img.onerror = () => resolve(); // don't block if image fails to decode
      img.src = dataUrl;
    });
  }
}

// Copy final URL to clipboard
async function copyFinal() {
  try {
    await navigator.clipboard.writeText(finalUrlEl.value || "");
    statusEl.textContent = "Copied URL to clipboard.";
  } catch (e) {
    statusEl.textContent = "Copy failed: " + e.message;
  }
}

// Download PNG at 512x512 with optional center image overlay
async function downloadPNG() {
  const final = finalUrlEl.value || "";
  if (!final) {
    statusEl.textContent = "No URL to download.";
    return;
  }
  try {
    // reuse cached dataUrl if the URL hasn't changed since last QR generation
    const dataUrl = (lastQrUrl === final && lastDataUrl)
      ? lastDataUrl
      : await QRCode.toDataURL(final, { width: 512, margin: 1 });
    const img = new Image();
    img.onload = () => {
      const off = document.createElement("canvas");
      off.width = 512;
      off.height = 512;
      const ctx = off.getContext("2d");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, 512, 512);
      ctx.drawImage(img, 0, 0, 512, 512);
      if (centerImage) {
        const size = Math.floor(512 * 0.22);
        const x = Math.floor((512 - size) / 2);
        const y = x;
        ctx.fillStyle = "#fff";
        ctx.fillRect(x - 8, y - 8, size + 16, size + 16);
        ctx.drawImage(centerImage, x, y, size, size);
      }
      const medium = (utm_mediumEl.value || "").replace(/\s+/g, "_") || "medium";
      const camp = (utm_campaignEl.value || "").replace(/\s+/g, "_") || "campaign";
      const filename = `qr_${medium}_${camp}.png`;
      off.toBlob((blob) => {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(a.href);
      }, "image/png");
    };
    img.src = dataUrl;
  } catch (err) {
    statusEl.textContent =
      "Download error: " + (err && err.message ? err.message : String(err));
  }
}

// Handle center image upload — must be square; stored resized to 128×128
const CENTER_IMAGE_SIZE = 128;

function handleCenterUpload(file) {
  if (!file) {
    centerImage = null;
    centerImageDataUrl = null;
    removeImageBtn.style.display = "none";
    return;
  }
  const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB
  if (file.size > MAX_FILE_SIZE) {
    statusEl.textContent = "Image rejected: file must be 5 MB or smaller.";
    centerUpload.value = "";
    return;
  }
  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = () => {
      if (img.naturalWidth !== img.naturalHeight) {
        statusEl.textContent = `Image rejected: must be square (uploaded image is ${img.naturalWidth}×${img.naturalHeight}).`;
        centerUpload.value = "";
        return;
      }
      // Resize down to CENTER_IMAGE_SIZE for efficient storage
      const off = document.createElement("canvas");
      off.width = CENTER_IMAGE_SIZE;
      off.height = CENTER_IMAGE_SIZE;
      off.getContext("2d").drawImage(img, 0, 0, CENTER_IMAGE_SIZE, CENTER_IMAGE_SIZE);
      const resizedDataUrl = off.toDataURL("image/png");
      const resized = new Image();
      resized.onload = () => {
        centerImage = resized;
        centerImageDataUrl = resizedDataUrl;
        removeImageBtn.style.display = "";
        updateAll();
      };
      resized.src = resizedDataUrl;
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

function removeCenterImage() {
  centerImage = null;
  centerImageDataUrl = null;
  centerUpload.value = "";
  removeImageBtn.style.display = "none";
  updateAll();
}

// Populate delete-item modal with details about the item being deleted
function populateDeleteModal(s) {
  deleteItemDetails.innerHTML = "";

  const nameEl = document.createElement("div");
  nameEl.className = "detail-name";
  nameEl.textContent = s.name || s.utm_campaign || s.utm_medium || "(untitled)";
  deleteItemDetails.appendChild(nameEl);

  const urlEl = document.createElement("div");
  urlEl.className = "detail-url";
  urlEl.textContent = s.baseUrl || "";
  deleteItemDetails.appendChild(urlEl);

  const paramLines = [];
  if (s.utm_source)   paramLines.push(`utm_source: ${s.utm_source}`);
  if (s.utm_medium)   paramLines.push(`utm_medium: ${s.utm_medium}`);
  if (s.utm_campaign) paramLines.push(`utm_campaign: ${s.utm_campaign}`);
  if (s.utm_id)       paramLines.push(`utm_id: ${s.utm_id}`);
  if (s.utm_term)     paramLines.push(`utm_term: ${s.utm_term}`);
  if (s.utm_content)  paramLines.push(`utm_content: ${s.utm_content}`);

  if (paramLines.length > 0) {
    const paramsEl = document.createElement("div");
    paramsEl.className = "detail-params";
    paramsEl.textContent = paramLines.join(" · ");
    deleteItemDetails.appendChild(paramsEl);
  }
}

// Toggle field help text when ? button is clicked
document.querySelector(".form-col").addEventListener("click", (e) => {
  const btn = e.target.closest(".help-btn");
  if (!btn) return;
  btn.closest(".field").classList.toggle("help-visible");
});

// Event wiring
const debouncedUpdateAll = debounce(updateAll, 150);

websiteEl.addEventListener("input", debouncedUpdateAll);
utm_sourceEl.addEventListener("input", debouncedUpdateAll);
utm_mediumEl.addEventListener("input", debouncedUpdateAll);
utm_campaignEl.addEventListener("input", debouncedUpdateAll);
utm_idEl.addEventListener("input", debouncedUpdateAll);
utm_termEl.addEventListener("input", debouncedUpdateAll);
utm_contentEl.addEventListener("input", debouncedUpdateAll);
centerUpload.addEventListener("change", (e) => handleCenterUpload(e.target.files[0]));
saveBtn.addEventListener("click", saveCurrent);
clearBtn.addEventListener("click", clearFields);
clearHistoryBtn.addEventListener("click", () => {
  clearHistoryModal.removeAttribute("hidden");
  modalCancelBtn.focus();
});

modalCancelBtn.addEventListener("click", () => {
  clearHistoryModal.setAttribute("hidden", "");
  clearHistoryBtn.focus();
});

modalConfirmBtn.addEventListener("click", () => {
  clearHistoryModal.setAttribute("hidden", "");
  saved = [];
  persistSaved();
  renderSaved();
});

clearHistoryModal.addEventListener("click", (e) => {
  if (e.target === clearHistoryModal) {
    clearHistoryModal.setAttribute("hidden", "");
    clearHistoryBtn.focus();
  }
});

deleteItemCancelBtn.addEventListener("click", () => {
  deleteItemModal.setAttribute("hidden", "");
  pendingDeleteIdx = null;
});

deleteItemConfirmBtn.addEventListener("click", () => {
  if (pendingDeleteIdx !== null) {
    saved.splice(pendingDeleteIdx, 1);
    persistSaved();
    renderSaved();
  }
  deleteItemModal.setAttribute("hidden", "");
  pendingDeleteIdx = null;
});

deleteItemModal.addEventListener("click", (e) => {
  if (e.target === deleteItemModal) {
    deleteItemModal.setAttribute("hidden", "");
    pendingDeleteIdx = null;
  }
});

document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (!helpPanel.hasAttribute("hidden")) {
    closeHelp();
    return;
  }
  if (!clearHistoryModal.hasAttribute("hidden")) {
    clearHistoryModal.setAttribute("hidden", "");
    clearHistoryBtn.focus();
  }
  if (!deleteItemModal.hasAttribute("hidden")) {
    deleteItemModal.setAttribute("hidden", "");
    pendingDeleteIdx = null;
  }
});
shareBtn.addEventListener("click", async () => {
  const url = buildShareUrl();
  try {
    await navigator.clipboard.writeText(url);
    statusEl.textContent = centerImage
      ? "Share link copied (includes center image)."
      : "Share link copied to clipboard.";
  } catch (e) {
    statusEl.textContent = "Copy failed: " + e.message;
  }
});
copyBtn.addEventListener("click", copyFinal);
downloadBtn.addEventListener("click", downloadPNG);
removeImageBtn.addEventListener("click", removeCenterImage);

// Help panel open / close
function openHelp() {
  helpPanel.removeAttribute("hidden");
  helpBtn.setAttribute("aria-expanded", "true");
  helpCloseBtn.focus();
}

function closeHelp() {
  helpPanel.setAttribute("hidden", "");
  helpBtn.setAttribute("aria-expanded", "false");
  helpBtn.focus();
}

helpBtn.addEventListener("click", openHelp);
helpCloseBtn.addEventListener("click", closeHelp);
helpPanel.querySelector(".help-panel-backdrop").addEventListener("click", closeHelp);

// Initialize — loadFromUrl is async (image decode), so chain updateAll after it resolves
loadSaved();
loadFromUrl().then(() => updateAll());

// Populate footer version badge from the /version endpoint
fetch('/version')
  .then(r => r.json())
  .then(d => { const el = document.getElementById('appVersion'); if (el && d.version) el.textContent = `v${d.version}`; })
  .catch(() => {});
