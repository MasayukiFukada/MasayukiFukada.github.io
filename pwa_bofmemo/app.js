if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("./sw.js")
      .then((registration) => {
        console.log("Service Worker registered: ", registration);
        registration.onupdatefound = () => {
          const installingWorker = registration.installing;
          if (installingWorker) {
            installingWorker.onstatechange = () => {
              if (installingWorker.state === "installed") {
                if (navigator.serviceWorker.controller) {
                  // New content is available, show a notification to the user.
                  if (confirm("新しいバージョンがあります。更新しまっか？")) {
                    window.location.reload();
                  }
                }
              }
            };
          }
        };
      })
      .catch((error) => {
        console.log("Service Worker registration failed: ", error);
      });
  });
}

const actionButton = document.getElementById("action-button");
const exportButton = document.getElementById("export-button");
const sendButton = document.getElementById("send-button");
const settingsButton = document.getElementById("settings-button");
const settingsPopup = document.getElementById("settings-popup");
const cancelSettingsButton = document.getElementById("cancel-settings");
const settingsForm = document.getElementById("settings-form");
const serverUrlInput = document.getElementById("server-url-input");
const pasteUrlBtn = document.getElementById("paste-url-btn");
const scanQrBtn = document.getElementById("scan-qr-btn");
const testConnectionBtn = document.getElementById("test-connection-btn");
const qrReaderContainer = document.getElementById("qr-reader-container");
const qrVideo = document.getElementById("qr-video");
const stopQrBtn = document.getElementById("stop-qr-btn");
const toastElement = document.getElementById("toast");


const memoPopup = document.getElementById("memo-popup");
// const memoPopupTitle = memoPopup.querySelector('h2');
const cancelMemoButton = document.getElementById("cancel-memo");
const memoListElement = document.getElementById("memo-list");
const memoForm = document.getElementById("memo-form");
const memoTitleInput = document.getElementById("memo-title");
const memoBodyTextarea = document.getElementById("memo-body");
const memoTimestampInput = document.getElementById("memo-timestamp");
const memoCategoryRadioGroup = document.getElementById("memo-category-radio");

let deleteMode = false;
let selectedMemoIds = new Set();
let expandedAdjustMemoIds = new Set();
let currentEditingMemoId = null;
let currentGpsLocation = "";
let qrStream = null;
let qrScanInterval = null;

const DEFAULT_SERVER_URL = "http://expenditure.local:3000";
const STORAGE_KEY_SERVER_URL = "expenditure_server_url";


function getCategoryIcon(category) {
  switch (category) {
    case 0:
      return "payments";
    case 1:
      return "numbers";
    case 2:
      return "phone";
    case 3:
      return "category";
    default:
      return "category";
  }
}

function formatShortDate(timestamp) {
  if (!timestamp) return "";
  const d = new Date(timestamp);
  const now = new Date();
  const m = (d.getMonth() + 1).toString().padStart(2, "0");
  const day = d.getDate().toString().padStart(2, "0");
  const h = d.getHours().toString().padStart(2, "0");
  const min = d.getMinutes().toString().padStart(2, "0");
  if (d.getFullYear() === now.getFullYear()) {
    return `${m}/${day} ${h}:${min}`;
  }
  const y = d.getFullYear().toString().slice(-2);
  return `${y}/${m}/${day} ${h}:${min}`;
}

function updateBodyInputMode(category) {
  switch (category) {
    case 0:
      memoBodyTextarea.setAttribute("inputmode", "decimal");
      break;
    case 1:
      memoBodyTextarea.setAttribute("inputmode", "numeric");
      break;
    case 2:
      memoBodyTextarea.setAttribute("inputmode", "tel");
      break;
    case 3:
      memoBodyTextarea.removeAttribute("inputmode");
      break;
    default:
      memoBodyTextarea.removeAttribute("inputmode");
  }
}

async function renderMemoList() {
  console.log(await getMemos()); // for debug
  const memos = await getMemos(); // Fetch memos from IndexedDB
  memos.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)); // 日付の降順にソート
  memoListElement.innerHTML = "";
  if (memos.length === 0) {
    memoListElement.innerHTML =
      "<p>まだメモあらへんわ。新しいメモ作ってみぃひん？</p>";
    actionButton.innerHTML = '<span class="material-icons">add</span>';
    deleteMode = false;
    actionButton.classList.remove("delete-mode");
    return;
  }

  memos.forEach((memo) => {
    const listItem = document.createElement("li");
    listItem.classList.add("memo-item");
    const categoryIndex = Number.isInteger(memo.category)
      ? memo.category
      : parseInt(memo.category, 10) || 0;
    listItem.classList.add(`category-${categoryIndex}`);
    if (selectedMemoIds.has(memo.id)) {
      listItem.classList.add("selected-for-delete");
    }

    const amountMatch = memo.body.match(/\d+/);
    const firstAmount = amountMatch ? parseInt(amountMatch[0], 10) : null;
    const isExpanded = expandedAdjustMemoIds.has(memo.id);

    listItem.innerHTML = `
      <div class="memo-item-main">
        <input type="checkbox" data-id="${memo.id}" ${selectedMemoIds.has(memo.id) ? "checked" : ""}>
        <div class="memo-item-content" data-id="${memo.id}">
          <div class="memo-item-header-row">
            <span class="material-icons category-icon">${getCategoryIcon(memo.category)}</span>
            <h3 class="memo-title">${memo.title}</h3>
            <div class="memo-item-header-right">
              ${
                firstAmount !== null
                  ? `
                <button type="button" class="memo-amount-badge ${isExpanded ? "active" : ""}" data-id="${memo.id}" title="タップで金額を微調整">
                  <span>¥${firstAmount.toLocaleString()}</span>
                  <span class="material-icons amount-expand-icon">${isExpanded ? "expand_less" : "expand_more"}</span>
                </button>
              `
                  : ""
              }
              ${
                memo.gps
                  ? `<button type="button" data-gps="${memo.gps}" class="open-map-button" title="マップを開く"><span class="material-icons">place</span></button>`
                  : ""
              }
            </div>
          </div>
          <div class="memo-item-sub-row">
            <p class="memo-body-preview">${memo.body || ""}</p>
            <span class="memo-timestamp">${formatShortDate(memo.timestamp)}</span>
          </div>
        </div>
      </div>
      ${
        firstAmount !== null
          ? `
      <div class="memo-item-adjust ${isExpanded ? "expanded" : ""}" id="adjust-panel-${memo.id}">
        <div class="memo-adjust-inner">
          <span class="memo-adjust-current">¥${firstAmount.toLocaleString()}</span>
          <div class="memo-btn-row">
            <button type="button" class="adjust-btn" data-id="${memo.id}" data-delta="-1000">-1,000</button>
            <button type="button" class="adjust-btn" data-id="${memo.id}" data-delta="-100">-100</button>
            <button type="button" class="adjust-btn" data-id="${memo.id}" data-delta="+100">+100</button>
            <button type="button" class="adjust-btn" data-id="${memo.id}" data-delta="+1000">+1,000</button>
          </div>
        </div>
      </div>
      `
          : ""
      }
    `;
    memoListElement.appendChild(listItem);
  });

  // Add event listeners for map buttons and checkboxes after rendering
  document.querySelectorAll(".open-map-button").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation(); // Prevent listItem click event
      const btn = event.target.closest(".open-map-button");
      const gps = btn.dataset.gps;
      if (gps) {
        window.open(
          `https://www.google.com/maps/search/?api=1&query=${gps}`,
          "_blank",
        );
      }
    });
  });

  // 金額バッジタップによる微調整アコーディオンのトグル展開
  document.querySelectorAll(".memo-amount-badge").forEach((badge) => {
    badge.addEventListener("click", (event) => {
      event.stopPropagation(); // 編集モーダルが開くのを防止
      const id = badge.dataset.id;
      const panel = document.getElementById(`adjust-panel-${id}`);
      const icon = badge.querySelector(".amount-expand-icon");
      if (expandedAdjustMemoIds.has(id)) {
        expandedAdjustMemoIds.delete(id);
        badge.classList.remove("active");
        if (panel) panel.classList.remove("expanded");
        if (icon) icon.textContent = "expand_more";
      } else {
        expandedAdjustMemoIds.add(id);
        badge.classList.add("active");
        if (panel) panel.classList.add("expanded");
        if (icon) icon.textContent = "expand_less";
      }
    });
  });

  document
    .querySelectorAll('.memo-item input[type="checkbox"]')
    .forEach((checkbox) => {
      checkbox.addEventListener("change", (event) => {
        event.stopPropagation(); // Prevent listItem click event
        const id = event.target.dataset.id;
        const listItem = event.target.closest(".memo-item");
        if (event.target.checked) {
          selectedMemoIds.add(id);
          listItem.classList.add("selected-for-delete");
        } else {
          selectedMemoIds.delete(id);
          listItem.classList.remove("selected-for-delete");
        }
        updateActionButton();
      });
    });

  document.querySelectorAll(".adjust-btn").forEach((btn) => {
    btn.addEventListener("click", async (event) => {
      event.stopPropagation();
      const button = event.target.closest(".adjust-btn");
      const id = button.dataset.id;
      const delta = parseInt(button.dataset.delta, 10);
      const memo = await getMemoById(id);
      if (memo) {
        memo.body = memo.body.replace(/\d+/, (match) => {
          return Math.max(0, parseInt(match, 10) + delta).toString();
        });
        await updateMemo(memo);
        renderMemoList();
      }
    });
  });

  document.querySelectorAll(".memo-item-content").forEach((contentDiv) => {
    contentDiv.addEventListener("click", async (event) => {
      // 金額バッジやマップボタンのクリック時は編集モーダルを開かない
      if (event.target.closest(".memo-amount-badge, .open-map-button")) {
        return;
      }
      const id = event.target.closest(".memo-item-content").dataset.id;
      currentEditingMemoId = id;
      const memoToEdit = await getMemoById(id);
      if (memoToEdit) {
        // memoPopupTitle.textContent = 'メモ編集';
        memoTitleInput.value = memoToEdit.title;
        // Set category for editing
        const categoryRadio = document.getElementById(
          `category-${memoToEdit.category}`,
        );
        if (categoryRadio) {
          categoryRadio.checked = true;
        }
        updateBodyInputMode(memoToEdit.category);
        memoBodyTextarea.value = memoToEdit.body;
        // Set timestamp for editing
        const date = new Date(memoToEdit.timestamp);
        const year = date.getFullYear();
        const month = (date.getMonth() + 1).toString().padStart(2, "0");
        const day = date.getDate().toString().padStart(2, "0");
        const hours = date.getHours().toString().padStart(2, "0");
        const minutes = date.getMinutes().toString().padStart(2, "0");
        memoTimestampInput.value = `${year}-${month}-${day}T${hours}:${minutes}`;
        memoPopup.classList.add("visible");
      }
    });
  });

  updateActionButton();
}

function updateActionButton() {
  if (selectedMemoIds.size > 0) {
    actionButton.innerHTML = '<span class="material-icons">delete</span>';
    actionButton.classList.add("delete-mode");
    deleteMode = true;
  } else {
    actionButton.innerHTML = '<span class="material-icons">add</span>';
    actionButton.classList.remove("delete-mode");
    deleteMode = false;
  }
}

async function requestLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject("Geolocation is not supported by your browser");
    } else {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const { latitude, longitude } = position.coords;
          currentGpsLocation = `${latitude},${longitude}`;
          resolve(currentGpsLocation);
        },
        (error) => {
          console.error("GPS location error:", error);
          currentGpsLocation = "";
          // Don't reject, just resolve with empty string so the app can continue
          resolve("");
        },
      );
    }
  });
}

actionButton.addEventListener("click", async () => {
  if (deleteMode) {
    if (confirm(`ほんまに ${selectedMemoIds.size} 件のメモを削除するんか？`)) {
      for (const id of selectedMemoIds) {
        await deleteMemo(id);
        expandedAdjustMemoIds.delete(id);
      }
      selectedMemoIds.clear();
      renderMemoList();
    }
  } else {
    currentEditingMemoId = null; // Reset for new memo
    // memoPopupTitle.textContent = '新規メモ';
    memoForm.reset();
    // Set current datetime as default for new memo
    const now = new Date();
    const year = now.getFullYear();
    const month = (now.getMonth() + 1).toString().padStart(2, "0");
    const day = now.getDate().toString().padStart(2, "0");
    const hours = now.getHours().toString().padStart(2, "0");
    const minutes = now.getMinutes().toString().padStart(2, "0");
    memoTimestampInput.value = `${year}-${month}-${day}T${hours}:${minutes}`;
    updateBodyInputMode(0); // デフォルトのカテゴリ0(金額)にリセット
    memoPopup.classList.add("visible");
    // Request location when opening the popup for a new memo
    requestLocation();
  }
});

cancelMemoButton.addEventListener("click", () => {
  memoPopup.classList.remove("visible");
  memoForm.reset();
  currentEditingMemoId = null;
});

memoPopup.addEventListener("click", (event) => {
  if (event.target === memoPopup) {
    memoPopup.classList.remove("visible");
    memoForm.reset();
    currentEditingMemoId = null;
  }
});

memoForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const selectedCategory = memoCategoryRadioGroup.querySelector(
    'input[name="memo-category"]:checked',
  );
  const memoData = {
    category: parseInt(selectedCategory ? selectedCategory.value : "0"),
    title: memoTitleInput.value,
    body: memoBodyTextarea.value,
    timestamp: new Date(memoTimestampInput.value),
  };

  if (currentEditingMemoId) {
    const existingMemo = await getMemoById(currentEditingMemoId);
    await updateMemo({ ...existingMemo, ...memoData });
  } else {
    await addMemo({
      ...memoData,
      id: crypto.randomUUID(),
      gps: currentGpsLocation,
    });
  }

  renderMemoList();
  memoPopup.classList.remove("visible");
  memoForm.reset();
  currentEditingMemoId = null;
  currentGpsLocation = ""; // Reset after use
});

memoCategoryRadioGroup.addEventListener("change", (event) => {
  if (event.target.name === "memo-category") {
    updateBodyInputMode(parseInt(event.target.value, 10));
  }
});

exportButton.addEventListener("click", async () => {
  const allMemos = await getMemos();
  const memos = allMemos.filter(
    (memo) => Number(memo.category ?? 0) === 0
  );
  if (memos.length === 0) {
    alert("エクスポート対象（金額）のメモがありまへん。");
    return;
  }

  const exportData = memos.map((memo) => {
    const date = new Date(memo.timestamp);
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    const dd = String(date.getDate()).padStart(2, "0");

    // 本文から数値を抽出（金額として扱う想定）
    const amountMatch = memo.body.match(/\d+/);
    const amount = amountMatch ? parseInt(amountMatch[0], 10) : 0;

    return {
      date: `${yyyy}-${mm}-${dd}`,
      note: memo.title,
      amount: amount,
    };
  });

  const jsonString = JSON.stringify(exportData, null, 2);

  try {
    await navigator.clipboard.writeText(jsonString);
    showToast("クリップボードにコピーしました！", "success");
  } catch (err) {
    console.error("Failed to copy: ", err);
    showToast("コピーに失敗しました。", "error");
  }
});

// Toast notification helper
function showToast(message, type = "info", duration = 3000) {
  if (!toastElement) return;
  toastElement.textContent = message;
  toastElement.className = `toast show ${type}`;
  setTimeout(() => {
    toastElement.classList.remove("show");
  }, duration);
}

// Server URL helper
function getServerUrl() {
  return localStorage.getItem(STORAGE_KEY_SERVER_URL) || DEFAULT_SERVER_URL;
}

function setServerUrl(url) {
  let cleanUrl = url.trim().replace(/\/+$/, "");
  if (!cleanUrl.startsWith("http://") && !cleanUrl.startsWith("https://")) {
    cleanUrl = `http://${cleanUrl}`;
  }
  localStorage.setItem(STORAGE_KEY_SERVER_URL, cleanUrl);
  return cleanUrl;
}

// Direct send to ExpenditureBook
sendButton.addEventListener("click", async () => {
  const allMemos = await getMemos();
  const memos = allMemos.filter(
    (memo) => Number(memo.category ?? 0) === 0
  );
  if (memos.length === 0) {
    showToast("送信対象（金額）のメモがありません。", "error");
    return;
  }

  const exportData = memos.map((memo) => {
    const date = new Date(memo.timestamp);
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    const dd = String(date.getDate()).padStart(2, "0");

    // 本文から数値を抽出（金額として扱う想定）
    const amountMatch = memo.body.match(/\d+/);
    const amount = amountMatch ? parseInt(amountMatch[0], 10) : 0;

    return {
      date: `${yyyy}-${mm}-${dd}`,
      note: memo.title,
      amount: amount,
    };
  });

  const serverUrl = getServerUrl();
  const endpoint = `${serverUrl}/api/import`;

  showToast(`送信中: ${endpoint}`, "info", 3000);

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(exportData),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (response.ok) {
      const result = await response.json();
      showToast(`🚀 ${result.count || exportData.length}件の支出を送信しました！`, "success", 4000);
    } else {
      throw new Error(`HTTP ${response.status} (${response.statusText || 'エラー'})`);
    }
  } catch (error) {
    console.error("Direct send failed:", error);
    const errMsg = error.name === 'AbortError' 
      ? 'タイムアウト (8秒): サーバーに繋がりません' 
      : `${error.message || error}`;
    showToast(`送信失敗: ${errMsg}`, "error", 6000);
  }
});

// Settings Dialog
settingsButton.addEventListener("click", () => {
  serverUrlInput.value = getServerUrl();
  settingsPopup.classList.add("visible");
});

cancelSettingsButton.addEventListener("click", () => {
  stopQrScanning();
  settingsPopup.classList.remove("visible");
});

settingsForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const url = serverUrlInput.value;
  const savedUrl = setServerUrl(url);
  stopQrScanning();
  settingsPopup.classList.remove("visible");
  showToast(`接続先を保存しました: ${savedUrl}`, "success");
});

pasteUrlBtn.addEventListener("click", async () => {
  try {
    const text = await navigator.clipboard.readText();
    if (text) {
      serverUrlInput.value = text.trim();
      showToast("URLを貼り付けました", "info");
    }
  } catch (err) {
    console.error("Clipboard paste error:", err);
    showToast("クリップボードからの読み取りが許可されていません", "error");
  }
});

testConnectionBtn.addEventListener("click", async () => {
  const inputUrl = serverUrlInput.value.trim() || getServerUrl();
  let cleanUrl = inputUrl.replace(/\/+$/, "");
  if (!cleanUrl.startsWith("http://") && !cleanUrl.startsWith("https://")) {
    cleanUrl = `http://${cleanUrl}`;
  }
  const testEndpoint = `${cleanUrl}/api/import`;

  showToast(`接続テスト中: ${testEndpoint}`, "info", 3000);

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const res = await fetch(testEndpoint, {
      method: "GET",
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (res.ok) {
      showToast("✅ 接続成功！サーバーと通信できました", "success", 4000);
    } else {
      showToast(`⚠️ 応答あり (HTTP ${res.status})`, "info", 4000);
    }
  } catch (err) {
    console.error("Test connection failed:", err);
    const reason = err.name === 'AbortError' ? 'タイムアウト' : (err.message || '通信エラー');
    showToast(`❌ 接続失敗 (${reason})。SSL証明書かURLを確認してください`, "error", 6000);
  }
});


// QR Code Scanning
scanQrBtn.addEventListener("click", async () => {
  if (qrStream) {
    stopQrScanning();
    return;
  }

  try {
    qrStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment" },
    });
    qrVideo.srcObject = qrStream;
    await qrVideo.play();
    qrReaderContainer.classList.remove("hidden");

    if ("BarcodeDetector" in window) {
      const barcodeDetector = new window.BarcodeDetector({
        formats: ["qr_code"],
      });

      qrScanInterval = setInterval(async () => {
        try {
          const barcodes = await barcodeDetector.detect(qrVideo);
          if (barcodes.length > 0) {
            const detectedValue = barcodes[0].rawValue;
            serverUrlInput.value = detectedValue;
            showToast("QRコードを認識しました！", "success");
            stopQrScanning();
          }
        } catch (e) {
          // ignore scan error
        }
      }, 500);
    } else {
      showToast("カメラを起動しました。QRのURLを確認して入力してください", "info");
    }
  } catch (err) {
    console.error("Camera access failed:", err);
    showToast("カメラの起動に失敗しました", "error");
  }
});

stopQrBtn.addEventListener("click", () => {
  stopQrScanning();
});

function stopQrScanning() {
  if (qrScanInterval) {
    clearInterval(qrScanInterval);
    qrScanInterval = null;
  }
  if (qrStream) {
    qrStream.getTracks().forEach((track) => track.stop());
    qrStream = null;
  }
  if (qrReaderContainer) {
    qrReaderContainer.classList.add("hidden");
  }
}

// Initial render
renderMemoList();

