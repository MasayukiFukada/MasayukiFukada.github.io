const DB_NAME = "WhyveMemoDB";
const DB_VERSION = 1;
const STORE_NAME = "inconveniences";

let db;

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
        store.createIndex("createdAt", "createdAt", { unique: false });
        store.createIndex("synced", "synced", { unique: false });
      }
    };

    request.onsuccess = (event) => {
      db = event.target.result;
      resolve(db);
    };

    request.onerror = (event) => {
      reject("IndexedDB error: " + event.target.errorCode);
    };
  });
}

async function addInconvenience(item) {
  await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.add(item);

    request.onsuccess = () => resolve();
    request.onerror = (event) => reject("Error adding inconvenience: " + event.target.errorCode);
  });
}

async function getInconveniences() {
  await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], "readonly");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.getAll();

    request.onsuccess = () => {
      // createdAt 降順でソート
      const items = (request.result || []).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      resolve(items);
    };
    request.onerror = (event) => reject("Error getting inconveniences: " + event.target.errorCode);
  });
}

async function getInconvenienceById(id) {
  await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], "readonly");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(id);

    request.onsuccess = () => resolve(request.result);
    request.onerror = (event) => reject("Error getting inconvenience by ID: " + event.target.errorCode);
  });
}

async function updateInconvenience(item) {
  await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.put(item);

    request.onsuccess = () => resolve();
    request.onerror = (event) => reject("Error updating inconvenience: " + event.target.errorCode);
  });
}

async function deleteInconvenience(id) {
  await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.delete(id);

    request.onsuccess = () => resolve();
    request.onerror = (event) => reject("Error deleting inconvenience: " + event.target.errorCode);
  });
}

async function markAsSynced(ids) {
  await openDB();
  const idSet = new Set(ids);
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.getAll();

    request.onsuccess = () => {
      const items = request.result || [];
      for (const item of items) {
        if (idSet.has(item.id)) {
          item.synced = true;
          item.syncedAt = Date.now();
          store.put(item);
        }
      }
      resolve();
    };

    transaction.oncomplete = () => resolve();
    transaction.onerror = (event) => reject("Error marking as synced: " + event.target.errorCode);
  });
}
