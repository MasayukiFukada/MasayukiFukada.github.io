// Service Worker Registration
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("./sw.js")
      .then((registration) => {
        registration.onupdatefound = () => {
          const installingWorker = registration.installing;
          if (installingWorker) {
            installingWorker.onstatechange = () => {
              if (installingWorker.state === "installed" && navigator.serviceWorker.controller) {
                if (confirm("新しいバージョンがあります。更新しますか？")) {
                  window.location.reload();
                }
              }
            };
          }
        };
      })
      .catch((error) => {
        console.log("Service Worker registration failed:", error);
      });
  });
}

// DOM Elements
const actionButton = document.getElementById("action-button");
const sendButton = document.getElementById("send-button");
const exportButton = document.getElementById("export-button");
const settingsButton = document.getElementById("settings-button");
const statusDot = document.getElementById("connection-status-dot");
const memoListElement = document.getElementById("memo-list");
const emptyStateElement = document.getElementById("empty-state");
const filterAllBtn = document.getElementById("filter-all");
const filterUnsentBtn = document.getElementById("filter-unsent");

// Popups
const memoPopup = document.getElementById("memo-popup");
const popupTitle = document.getElementById("popup-title");
const memoForm = document.getElementById("memo-form");
const memoTitleInput = document.getElementById("memo-title");
const memoBodyInput = document.getElementById("memo-body");
const memoUseGpsCheckbox = document.getElementById("memo-use-gps");
const gpsStatusSpan = document.getElementById("gps-status");
const memoTimestampInput = document.getElementById("memo-timestamp");
const cancelMemoButton = document.getElementById("cancel-memo");

// Settings
const settingsPopup = document.getElementById("settings-popup");
const settingsForm = document.getElementById("settings-form");
const serverUrlInput = document.getElementById("server-url-input");
const pasteUrlBtn = document.getElementById("paste-url-btn");
const scanQrBtn = document.getElementById("scan-qr-btn");
const testConnectionBtn = document.getElementById("test-connection-btn");
const cancelSettingsButton = document.getElementById("cancel-settings");
const qrReaderContainer = document.getElementById("qr-reader-container");
const qrVideo = document.getElementById("qr-video");
const stopQrBtn = document.getElementById("stop-qr-btn");
const toastElement = document.getElementById("toast");

// States
const DEFAULT_SERVER_URL = "http://whyve.local:3000";
const STORAGE_KEY_SERVER_URL = "whyve_server_url";

let currentFilter = "all"; // "all" | "unsent"
let currentEditingId = null;
let currentGpsLocation = null;
let connectionState = "offline"; // "online" | "offline" | "checking" | "queued"
let isSending = false;
let healthCheckTimer = null;
let qrStream = null;

// Helpers
function getServerUrl() {
  return localStorage.getItem(STORAGE_KEY_SERVER_URL) || DEFAULT_SERVER_URL;
}

function setServerUrl(url) {
  const cleanUrl = url.replace(/\/+$/, "");
  localStorage.setItem(STORAGE_KEY_SERVER_URL, cleanUrl);
}

function showToast(message, type = "info", duration = 3000) {
  if (!toastElement) return;
  toastElement.textContent = message;
  toastElement.className = `toast ${type} show`;
  setTimeout(() => {
    toastElement.className = "toast";
  }, duration);
}

function formatDate(timestamp) {
  if (!timestamp) return "";
  const d = new Date(timestamp);
  const m = (d.getMonth() + 1).toString().padStart(2, "0");
  const day = d.getDate().toString().padStart(2, "0");
  const h = d.getHours().toString().padStart(2, "0");
  const min = d.getMinutes().toString().padStart(2, "0");
  return `${m}/${day} ${h}:${min}`;
}

function getSeverityMeta(severity) {
  switch (Number(severity)) {
    case 1:
      return { emoji: "😐", label: "ちょっと不便", class: "severity-1" };
    case 2:
      return { emoji: "😣", label: "割と困る", class: "severity-2" };
    case 3:
      return { emoji: "😫", label: "激しくストレス", class: "severity-3" };
    default:
      return { emoji: "😣", label: "割と困る", class: "severity-2" };
  }
}

// Connection & Health Check
function updateConnectionStatus(newState) {
  connectionState = newState;
  if (!statusDot) return;

  statusDot.className = `status-dot ${newState}`;

  if (newState === "online") {
    sendButton.title = "Whyveへ直接送信 (接続中)";
  } else if (newState === "queued") {
    sendButton.title = "接続待機中 (PC起動時に自動送信)";
  } else if (newState === "checking") {
    sendButton.title = "接続確認中...";
  } else {
    sendButton.title = "Whyveへ直接送信 (未接続 - タップで起動時自動送信を予約)";
  }
}

async function checkHealth({ silent = true } = {}) {
  const serverUrl = getServerUrl();
  const endpoint = `${serverUrl}/api/health`;

  if (connectionState !== "queued") {
    updateConnectionStatus("checking");
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2500);

    const res = await fetch(endpoint, {
      method: "GET",
      cache: "no-store",
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (res.ok) {
      const wasQueued = connectionState === "queued";
      updateConnectionStatus("online");
      if (wasQueued) {
        showToast("⚡ PC接続を確認しました！不便さデータを自動送信します...", "info", 3000);
        executeSendInconveniences();
      }
      return true;
    } else {
      if (connectionState !== "queued") {
        updateConnectionStatus("offline");
      }
      return false;
    }
  } catch {
    if (connectionState !== "queued") {
      updateConnectionStatus("offline");
    }
    return false;
  }
}

function scheduleHealthCheck() {
  if (healthCheckTimer) clearTimeout(healthCheckTimer);

  if (document.hidden) return;

  const nextInterval = connectionState === "online" ? 25000 : 7000;
  healthCheckTimer = setTimeout(async () => {
    await checkHealth();
    scheduleHealthCheck();
  }, nextInterval);
}

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    checkHealth().finally(() => scheduleHealthCheck());
  } else {
    if (healthCheckTimer) clearTimeout(healthCheckTimer);
  }
});

// Send Inconveniences to Whyve Server
async function executeSendInconveniences() {
  if (isSending) return;
  isSending = true;

  const allItems = await getInconveniences();
  const unsentItems = allItems.filter((item) => item.synced !== true);

  if (unsentItems.length === 0) {
    showToast("送信対象（未送信）の不便さメモはありません。", "info");
    isSending = false;
    updateConnectionStatus("online");
    return;
  }

  const payload = unsentItems.map((item) => ({
    id: item.id,
    title: item.title,
    description: item.description || "",
    severity: Number(item.severity || 2),
    location: item.location,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt || item.createdAt,
  }));

  const serverUrl = getServerUrl();
  const endpoint = `${serverUrl}/api/inconveniences/batch`;

  showToast(`送信中: ${payload.length}件の不便さを送信しています...`, "info", 3000);

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (response.ok) {
      const result = await response.json();
      const syncedIds = unsentItems.map((item) => item.id);
      await markAsSynced(syncedIds);
      updateConnectionStatus("online");
      showToast(`🚀 ${result.count || payload.length}件の不便さをWhyveへ送信しました！`, "success", 4000);
      renderList();
    } else {
      throw new Error(`HTTP ${response.status} (${response.statusText || "エラー"})`);
    }
  } catch (error) {
    const errMsg = error.name === "AbortError"
      ? "タイムアウト: サーバーに繋がりません"
      : `${error.message || error}`;
    showToast(`送信失敗: ${errMsg}`, "error", 5000);
    updateConnectionStatus("offline");
  } finally {
    isSending = false;
    scheduleHealthCheck();
  }
}

// Send Button Click
sendButton.addEventListener("click", async () => {
  if (isSending) return;

  const allItems = await getInconveniences();
  const unsentItems = allItems.filter((item) => item.synced !== true);

  if (unsentItems.length === 0) {
    showToast("送信対象の不便さメモはありません（すべて送信済み）。", "info");
    return;
  }

  if (connectionState === "queued") {
    showToast("📡 すでに接続待機キューに入っています。PC起動後に自動送信されます。", "info", 4000);
    return;
  }

  if (connectionState === "online") {
    await executeSendInconveniences();
    return;
  }

  showToast("🔍 接続確認中...", "info", 1500);
  const isOnline = await checkHealth();
  if (isOnline) {
    await executeSendInconveniences();
  } else {
    updateConnectionStatus("queued");
    showToast(`📡 PC接続待機中: 起動を検知次第、${unsentItems.length}件を自動送信します`, "info", 5000);
    scheduleHealthCheck();
  }
});

// Export to Clipboard
exportButton.addEventListener("click", async () => {
  const allItems = await getInconveniences();
  if (allItems.length === 0) {
    showToast("コピーするメモがありません", "error");
    return;
  }

  const exportData = {
    app: "Whyve",
    version: 1,
    exportedAt: new Date().toISOString(),
    itemCount: allItems.length,
    inconveniences: allItems.map((item) => ({
      id: item.id,
      title: item.title,
      description: item.description || "",
      severity: Number(item.severity || 2),
      location: item.location,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt || item.createdAt,
    })),
  };

  try {
    await navigator.clipboard.writeText(JSON.stringify(exportData, null, 2));
    showToast(`📋 ${allItems.length}件の不便さをJSONでコピーしました！`, "success");
  } catch {
    showToast("クリップボードへのコピーに失敗しました", "error");
  }
});

// Render Inconveniences List
async function renderList() {
  const items = await getInconveniences();
  const filtered = currentFilter === "unsent"
    ? items.filter((item) => item.synced !== true)
    : items;

  memoListElement.innerHTML = "";

  if (filtered.length === 0) {
    emptyStateElement.classList.remove("hidden");
    return;
  }
  emptyStateElement.classList.add("hidden");

  for (const item of filtered) {
    const meta = getSeverityMeta(item.severity);
    const li = document.createElement("li");
    li.className = `memo-item ${meta.class}`;

    const isSynced = item.synced === true;
    const syncBadgeHtml = isSynced
      ? `<span class="sync-badge synced"><span class="material-icons" style="font-size:12px;">check_circle</span> 送信済</span>`
      : `<span class="sync-badge unsent">未送信</span>`;

    const locationHtml = item.location
      ? `<span class="location-indicator" title="GPS記録あり"><span class="material-icons">place</span> GPS</span>`
      : "";

    li.innerHTML = `
      <div class="memo-item-content">
        <div class="memo-item-header">
          <div class="memo-badges">
            <span class="severity-pill">${meta.emoji} ${meta.label}</span>
            ${syncBadgeHtml}
          </div>
          <span class="memo-date">${formatDate(item.createdAt)}</span>
        </div>
        <h3 class="memo-title">${escapeHtml(item.title)}</h3>
        ${item.description ? `<p class="memo-body">${escapeHtml(item.description)}</p>` : ""}
        <div class="memo-footer">
          <div>${locationHtml}</div>
          <button class="memo-actions-btn delete-btn" title="削除">
            <span class="material-icons">delete_outline</span>
          </button>
        </div>
      </div>
    `;

    // タップで編集
    const content = li.querySelector(".memo-item-content");
    content.addEventListener("click", (e) => {
      if (e.target.closest(".delete-btn")) return;
      openEditModal(item);
    });

    // 削除ボタン
    const delBtn = li.querySelector(".delete-btn");
    delBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (confirm(`「${item.title}」を削除しますか？`)) {
        await deleteInconvenience(item.id);
        showToast("削除しました", "info");
        renderList();
      }
    });

    memoListElement.appendChild(li);
  }
}

function escapeHtml(str) {
  if (!str) return "";
  return str.replace(/[&<>'"]/g, (tag) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;",
  }[tag] || tag));
}

// Filter buttons
filterAllBtn.addEventListener("click", () => {
  currentFilter = "all";
  filterAllBtn.classList.add("active");
  filterUnsentBtn.classList.remove("active");
  renderList();
});

filterUnsentBtn.addEventListener("click", () => {
  currentFilter = "unsent";
  filterUnsentBtn.classList.add("active");
  filterAllBtn.classList.remove("active");
  renderList();
});

// GPS handling
memoUseGpsCheckbox.addEventListener("change", () => {
  if (memoUseGpsCheckbox.checked) {
    gpsStatusSpan.textContent = "📍 位置情報を取得中...";
    if (!navigator.geolocation) {
      gpsStatusSpan.textContent = "GPS非対応のブラウザです";
      memoUseGpsCheckbox.checked = false;
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        currentGpsLocation = {
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
        };
        gpsStatusSpan.textContent = `📍 取得完了 (${pos.coords.latitude.toFixed(4)}, ${pos.coords.longitude.toFixed(4)})`;
      },
      (err) => {
        gpsStatusSpan.textContent = "位置情報の取得に失敗しました";
        memoUseGpsCheckbox.checked = false;
        currentGpsLocation = null;
      },
      { timeout: 7000 }
    );
  } else {
    currentGpsLocation = null;
    gpsStatusSpan.textContent = "";
  }
});

// Modal Open/Close
actionButton.addEventListener("click", () => {
  currentEditingId = null;
  popupTitle.textContent = "不便さを記録";
  memoForm.reset();
  document.getElementById("severity-2").checked = true;
  currentGpsLocation = null;
  gpsStatusSpan.textContent = "";

  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  memoTimestampInput.value = now.toISOString().slice(0, 16);

  memoPopup.classList.add("visible");
  setTimeout(() => memoTitleInput.focus(), 150);
});

function openEditModal(item) {
  currentEditingId = item.id;
  popupTitle.textContent = "不便さを編集";
  memoTitleInput.value = item.title;
  memoBodyInput.value = item.description || "";

  const sevRadio = document.getElementById(`severity-${item.severity || 2}`);
  if (sevRadio) sevRadio.checked = true;

  if (item.location) {
    memoUseGpsCheckbox.checked = true;
    currentGpsLocation = item.location;
    gpsStatusSpan.textContent = `📍 記録済み (${item.location.latitude.toFixed(4)}, ${item.location.longitude.toFixed(4)})`;
  } else {
    memoUseGpsCheckbox.checked = false;
    currentGpsLocation = null;
    gpsStatusSpan.textContent = "";
  }

  const d = new Date(item.createdAt || Date.now());
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  memoTimestampInput.value = d.toISOString().slice(0, 16);

  memoPopup.classList.add("visible");
}

cancelMemoButton.addEventListener("click", () => {
  memoPopup.classList.remove("visible");
});

// Form Submit
memoForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const title = memoTitleInput.value.trim();
  if (!title) return;

  const description = memoBodyInput.value.trim();
  const selectedSeverity = document.querySelector('input[name="memo-severity"]:checked');
  const severity = selectedSeverity ? Number(selectedSeverity.value) : 2;

  const timestampStr = memoTimestampInput.value;
  const createdAt = timestampStr ? new Date(timestampStr).getTime() : Date.now();
  const now = Date.now();

  if (currentEditingId) {
    const existing = await getInconvenienceById(currentEditingId);
    if (existing) {
      await updateInconvenience({
        ...existing,
        title,
        description,
        severity,
        location: currentGpsLocation || existing.location,
        createdAt,
        updatedAt: now,
        synced: false, // 編集した場合は未送信に戻す
      });
      showToast("更新しました", "success");
    }
  } else {
    const newItem = {
      id: crypto.randomUUID ? crypto.randomUUID() : `item-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      title,
      description,
      severity,
      location: currentGpsLocation,
      createdAt,
      updatedAt: now,
      synced: false,
    };
    await addInconvenience(newItem);
    showToast("不便さを記録しました！", "success");
  }

  memoPopup.classList.remove("visible");
  renderList();
});

// Settings Modal
settingsButton.addEventListener("click", () => {
  serverUrlInput.value = getServerUrl();
  settingsPopup.classList.add("visible");
});

cancelSettingsButton.addEventListener("click", () => {
  stopQrScanner();
  settingsPopup.classList.remove("visible");
});

settingsForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const url = serverUrlInput.value.trim();
  if (url) {
    setServerUrl(url);
    showToast("サーバー設定を保存しました", "success");
    settingsPopup.classList.remove("visible");
    checkHealth({ silent: false });
  }
});

pasteUrlBtn.addEventListener("click", async () => {
  try {
    const text = await navigator.clipboard.readText();
    if (text) {
      serverUrlInput.value = text.trim();
      showToast("クリップボードから貼付しました", "info");
    }
  } catch {
    showToast("貼付に失敗しました", "error");
  }
});

testConnectionBtn.addEventListener("click", async () => {
  const url = serverUrlInput.value.trim().replace(/\/+$/, "");
  if (!url) return;
  showToast("接続テスト中...", "info", 1500);

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(`${url}/api/health`, {
      method: "GET",
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (res.ok) {
      showToast("✅ 接続成功！サーバーと通信できました", "success", 4000);
    } else {
      showToast(`⚠️ 応答あり (HTTP ${res.status})`, "error", 4000);
    }
  } catch (err) {
    showToast("❌ 接続失敗: サーバーに到達できませんでした", "error", 4000);
  }
});

// QR Scanner (Stub/Camera)
scanQrBtn.addEventListener("click", async () => {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    showToast("カメラ機能がサポートされていません", "error");
    return;
  }

  try {
    qrStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment" },
    });
    qrVideo.srcObject = qrStream;
    qrVideo.setAttribute("playsinline", true);
    await qrVideo.play();
    qrReaderContainer.classList.remove("hidden");
  } catch {
    showToast("カメラの起動に失敗しました", "error");
  }
});

function stopQrScanner() {
  if (qrStream) {
    qrStream.getTracks().forEach((track) => track.stop());
    qrStream = null;
  }
  if (qrReaderContainer) {
    qrReaderContainer.classList.add("hidden");
  }
}

stopQrBtn.addEventListener("click", () => {
  stopQrScanner();
});

// Initial boot
renderList();
setTimeout(() => {
  checkHealth().finally(() => scheduleHealthCheck());
}, 400);
