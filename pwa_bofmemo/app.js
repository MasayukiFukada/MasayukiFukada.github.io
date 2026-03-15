if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js')
      .then(registration => {
        console.log('Service Worker registered: ', registration);
        registration.onupdatefound = () => {
          const installingWorker = registration.installing;
          if (installingWorker) {
            installingWorker.onstatechange = () => {
              if (installingWorker.state === 'installed') {
                if (navigator.serviceWorker.controller) {
                  // New content is available, show a notification to the user.
                  if (confirm('新しいバージョンがあります。更新しまっか？')) {
                    window.location.reload();
                  }
                }
              }
            };
          }
        };
      })
      .catch(error => {
        console.log('Service Worker registration failed: ', error);
      });
  });
}

const actionButton = document.getElementById('action-button');
const memoPopup = document.getElementById('memo-popup');
// const memoPopupTitle = memoPopup.querySelector('h2');
const cancelMemoButton = document.getElementById('cancel-memo');
const memoListElement = document.getElementById('memo-list');
const memoForm = document.getElementById('memo-form');
const memoTitleInput = document.getElementById('memo-title');
const memoBodyTextarea = document.getElementById('memo-body');
const memoTimestampInput = document.getElementById('memo-timestamp');
const memoCategoryRadioGroup = document.getElementById('memo-category-radio');

let deleteMode = false;
let selectedMemoIds = new Set();
let currentEditingMemoId = null;
let currentGpsLocation = '';

function getCategoryIcon(category) {
  switch (category) {
    case 0: return 'payments';
    case 1: return 'numbers';
    case 2: return 'phone';
    case 3: return 'category';
    default: return 'category';
  }
}

async function renderMemoList() {
  console.log(await getMemos()); // for debug
  const memos = await getMemos(); // Fetch memos from IndexedDB
  memos.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)); // 日付の降順にソート
  memoListElement.innerHTML = '';
  if (memos.length === 0) {
    memoListElement.innerHTML = '<p>まだメモあらへんわ。新しいメモ作ってみぃひん？</p>';
    actionButton.innerHTML = '<span class="material-icons">add</span>';
    deleteMode = false;
    actionButton.classList.remove('delete-mode');
    return;
  }

  memos.forEach(memo => {
    const listItem = document.createElement('li');
    listItem.classList.add('memo-item');
    if (selectedMemoIds.has(memo.id)) {
      listItem.classList.add('selected-for-delete');
    }
    listItem.innerHTML = `
      <input type="checkbox" data-id="${memo.id}" ${selectedMemoIds.has(memo.id) ? 'checked' : ''}>
      <div class="memo-item-content" data-id="${memo.id}">
        <span class="material-icons category-icon">${getCategoryIcon(memo.category)}</span>
        <h3>${memo.title}</h3>
        <p class="memo-body-preview">${memo.body}</p>
        <p class="memo-timestamp">${new Date(memo.timestamp).toLocaleString()}</p>
      </div>
      <div class="memo-item-actions">
        ${memo.gps ? `<button data-gps="${memo.gps}" class="open-map-button"><span class="material-icons">map</span></button>` : ''}
      </div>
    `;
    memoListElement.appendChild(listItem);
  });

  // Add event listeners for map buttons and checkboxes after rendering
  document.querySelectorAll('.open-map-button').forEach(button => {
    button.addEventListener('click', (event) => {
      event.stopPropagation(); // Prevent listItem click event
      const button = event.target.closest('.open-map-button');
      const gps = button.dataset.gps;
      if (gps) {
        window.open(`https://www.google.com/maps/search/?api=1&query=${gps}`, '_blank');
      }
    });
  });

  document.querySelectorAll('.memo-item input[type="checkbox"]').forEach(checkbox => {
    checkbox.addEventListener('change', (event) => {
      event.stopPropagation(); // Prevent listItem click event
      const id = event.target.dataset.id;
      const listItem = event.target.closest('.memo-item');
      if (event.target.checked) {
        selectedMemoIds.add(id);
        listItem.classList.add('selected-for-delete');
      } else {
        selectedMemoIds.delete(id);
        listItem.classList.remove('selected-for-delete');
      }
      updateActionButton();
    });
  });

  document.querySelectorAll('.memo-item-content').forEach(contentDiv => {
    contentDiv.addEventListener('click', async (event) => {
      const id = event.target.closest('.memo-item-content').dataset.id;
      currentEditingMemoId = id;
      const memoToEdit = await getMemoById(id);
      if (memoToEdit) {
        // memoPopupTitle.textContent = 'メモ編集';
        memoTitleInput.value = memoToEdit.title;
        // Set category for editing
        const categoryRadio = document.getElementById(`category-${memoToEdit.category}`);
        if (categoryRadio) {
          categoryRadio.checked = true;
        }
        memoBodyTextarea.value = memoToEdit.body;
        // Set timestamp for editing
        const date = new Date(memoToEdit.timestamp);
        const year = date.getFullYear();
        const month = (date.getMonth() + 1).toString().padStart(2, '0');
        const day = date.getDate().toString().padStart(2, '0');
        const hours = date.getHours().toString().padStart(2, '0');
        const minutes = date.getMinutes().toString().padStart(2, '0');
        memoTimestampInput.value = `${year}-${month}-${day}T${hours}:${minutes}`;
        memoPopup.classList.add('visible');
      }
    });
  });

  updateActionButton();
}

function updateActionButton() {
  if (selectedMemoIds.size > 0) {
    actionButton.innerHTML = '<span class="material-icons">delete</span>';
    actionButton.classList.add('delete-mode');
    deleteMode = true;
  } else {
    actionButton.innerHTML = '<span class="material-icons">add</span>';
    actionButton.classList.remove('delete-mode');
    deleteMode = false;
  }
}

async function requestLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject('Geolocation is not supported by your browser');
    } else {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const { latitude, longitude } = position.coords;
          currentGpsLocation = `${latitude},${longitude}`;
          resolve(currentGpsLocation);
        },
        (error) => {
          console.error('GPS location error:', error);
          currentGpsLocation = '';
          // Don't reject, just resolve with empty string so the app can continue
          resolve('');
        }
      );
    }
  });
}

actionButton.addEventListener('click', async () => {
  if (deleteMode) {
    if (confirm(`ほんまに ${selectedMemoIds.size} 件のメモを削除するんか？`)) {
      for (const id of selectedMemoIds) {
        await deleteMemo(id);
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
    const month = (now.getMonth() + 1).toString().padStart(2, '0');
    const day = now.getDate().toString().padStart(2, '0');
    const hours = now.getHours().toString().padStart(2, '0');
    const minutes = now.getMinutes().toString().padStart(2, '0');
    memoTimestampInput.value = `${year}-${month}-${day}T${hours}:${minutes}`;
    memoPopup.classList.add('visible');
    // Request location when opening the popup for a new memo
    requestLocation();
  }
});

cancelMemoButton.addEventListener('click', () => {
  memoPopup.classList.remove('visible');
  memoForm.reset();
  currentEditingMemoId = null;
});

memoPopup.addEventListener('click', (event) => {
  if (event.target === memoPopup) {
    memoPopup.classList.remove('visible');
    memoForm.reset();
    currentEditingMemoId = null;
  }
});

memoForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  const selectedCategory = memoCategoryRadioGroup.querySelector('input[name="memo-category"]:checked');
  const memoData = {
    category: parseInt(selectedCategory ? selectedCategory.value : '0'),
    title: memoTitleInput.value,
    body: memoBodyTextarea.value,
    timestamp: new Date(memoTimestampInput.value),
  };

  if (currentEditingMemoId) {
    const existingMemo = await getMemoById(currentEditingMemoId);
    await updateMemo({ ...existingMemo, ...memoData });
  } else {
    await addMemo({ ...memoData, id: crypto.randomUUID(), gps: currentGpsLocation });
  }

  renderMemoList();
  memoPopup.classList.remove('visible');
  memoForm.reset();
  currentEditingMemoId = null;
  currentGpsLocation = ''; // Reset after use
});

// Initial render
renderMemoList();
