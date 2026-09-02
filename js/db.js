/**
 * INDEXEDDB ENGINE - FAST STORE & CREW LOCAL DATABASE
 * Capable of storing and searching 34,000+ stores in milliseconds
 */

const DB_NAME = "MDS_Absen_DB";
const DB_VERSION = 1;

let dbInstance = null;

/**
 * Inisialisasi IndexedDB
 */
function initDB() {
  return new Promise((resolve, reject) => {
    if (dbInstance) {
      resolve(dbInstance);
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;

      // Store: Master Toko (34k+ data)
      if (!db.objectStoreNames.contains("stores")) {
        const storeOS = db.createObjectStore("stores", { keyPath: "id", autoIncrement: true });
        storeOS.createIndex("kodeToko", "kodeToko", { unique: false });
        storeOS.createIndex("namaToko", "namaToko", { unique: false });
        storeOS.createIndex("account", "account", { unique: false });
        storeOS.createIndex("searchIndex", "searchIndex", { unique: false });
      }

      // Store: Master Crew
      if (!db.objectStoreNames.contains("crew")) {
        const crewOS = db.createObjectStore("crew", { keyPath: "id" });
        crewOS.createIndex("nama", "nama", { unique: false });
        crewOS.createIndex("modul", "modul", { unique: false });
      }

      // Store: Riwayat Pengiriman Lokal
      if (!db.objectStoreNames.contains("history")) {
        const histOS = db.createObjectStore("history", { keyPath: "id", autoIncrement: true });
        histOS.createIndex("timestamp", "timestamp", { unique: false });
      }
    };

    request.onsuccess = (event) => {
      dbInstance = event.target.result;
      resolve(dbInstance);
    };

    request.onerror = (event) => {
      console.error("IndexedDB Error:", event.target.error);
      reject(event.target.error);
    };
  });
}

/**
 * Menyimpan puluhan ribu data toko secara batch (Sangat cepat)
 */
async function saveStoresBatch(stores) {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("stores", "readwrite");
    const storeOS = tx.objectStore("stores");

    // Kosongkan data lama sebelum isi yang baru
    storeOS.clear();

    for (let i = 0; i < stores.length; i++) {
      const item = stores[i];
      // Buat search index gabungan lowercase untuk pencarian kilat
      const searchIndex = `${item.kodeToko || ""} ${item.namaToko || ""} ${item.account || ""} ${item.kota || ""} ${item.kecamatan || ""}`.toLowerCase();
      
      storeOS.add({
        id: i + 1,
        kodeToko: item.kodeToko || "",
        namaToko: item.namaToko || "",
        account: item.account || "",
        dcName: item.dcName || "",
        kecamatan: item.kecamatan || "",
        kota: item.kota || "",
        lat: item.lat || null,
        lon: item.lon || null,
        searchIndex: searchIndex
      });
    }

    tx.oncomplete = () => {
      localStorage.setItem("mds_stores_count", stores.length);
      localStorage.setItem("mds_last_sync", new Date().toISOString());
      resolve(stores.length);
    };

    tx.onerror = (e) => {
      reject(e.target.error);
    };
  });
}

/**
 * Menyimpan daftar master crew
 */
async function saveCrewList(crews) {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("crew", "readwrite");
    const crewOS = tx.objectStore("crew");
    crewOS.clear();

    crews.forEach((c, idx) => {
      const cleanModul = (c.modul || "").replace(/\s+/g, "").toUpperCase();
      const uniqueKey = `${c.id || 'crew'}_${cleanModul}_${idx}`;

      crewOS.put({
        id: uniqueKey,
        crewCode: c.id || "",
        nama: c.nama || "",
        modul: c.modul || "",
        account: c.account || "",
        jabatan: c.jabatan || ""
      });
    });

    tx.oncomplete = () => resolve(crews.length);
    tx.onerror = (e) => reject(e.target.error);
  });
}

/**
 * Mengambil semua crew dari database
 */
async function getAllCrew() {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("crew", "readonly");
    const crewOS = tx.objectStore("crew");
    const request = crewOS.getAll();

    request.onsuccess = () => {
      const list = request.result || [];
      const normalized = list.map(c => ({
        id: c.crewCode || c.id,
        nama: c.nama || "",
        modul: c.modul || "",
        account: c.account || "",
        jabatan: c.jabatan || ""
      }));
      resolve(normalized);
    };
    request.onerror = (e) => reject(e.target.error);
  });
}

/**
 * Hitung jumlah toko di IndexedDB
 */
async function getStoresCount() {
  const db = await initDB();
  return new Promise((resolve) => {
    const tx = db.transaction("stores", "readonly");
    const storeOS = tx.objectStore("stores");
    const req = storeOS.count();
    req.onsuccess = () => resolve(req.result || 0);
    req.onerror = () => resolve(0);
  });
}

/**
 * Cek apakah toko di IndexedDB sudah memiliki data koordinat lat/lon
 */
async function checkIfStoresHaveCoordinates() {
  const db = await initDB();
  return new Promise((resolve) => {
    const tx = db.transaction("stores", "readonly");
    const storeOS = tx.objectStore("stores");
    const req = storeOS.openCursor();
    req.onsuccess = (e) => {
      const cursor = e.target.result;
      if (!cursor) {
        resolve(false);
        return;
      }
      const item = cursor.value;
      if (item && item.lat !== undefined && item.lat !== null && !isNaN(item.lat)) {
        resolve(true);
      } else {
        resolve(false);
      }
    };
    req.onerror = () => resolve(false);
  });
}

/**
 * Ambil detail toko berdasarkan Kode Toko dari IndexedDB
 */
async function getStoreByCode(kodeToko) {
  if (!kodeToko) return null;
  const cleanCode = kodeToko.toString().trim();
  const db = await initDB();

  return new Promise((resolve) => {
    const tx = db.transaction("stores", "readonly");
    const storeOS = tx.objectStore("stores");
    const idx = storeOS.index("kodeToko");
    const req = idx.get(cleanCode);

    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => resolve(null);
  });
}

/**
 * Simpan / Update Toko Kustom Manual ke IndexedDB
 */
async function saveCustomStore(store) {
  const db = await initDB();
  const searchIndex = `${store.kodeToko || ""} ${store.namaToko || ""} ${store.account || ""} ${store.kota || ""} ${store.kecamatan || ""}`.toLowerCase();

  return new Promise((resolve, reject) => {
    const tx = db.transaction("stores", "readwrite");
    const storeOS = tx.objectStore("stores");

    const record = {
      kodeToko: store.kodeToko.trim(),
      namaToko: store.namaToko.trim(),
      account: (store.account || "ALFAMART").toUpperCase(),
      dcName: store.dcName || "",
      kecamatan: store.kecamatan || "",
      kota: store.kota || "",
      lat: store.lat ? parseFloat(store.lat) : null,
      lon: store.lon ? parseFloat(store.lon) : null,
      searchIndex: searchIndex
    };

    // Cari apakah sudah ada id-nya
    const idx = storeOS.index("kodeToko");
    const req = idx.get(record.kodeToko);

    req.onsuccess = () => {
      if (req.result && req.result.id) {
        record.id = req.result.id;
        storeOS.put(record);
      } else {
        storeOS.add(record);
      }
    };

    tx.oncomplete = () => resolve(record);
    tx.onerror = (e) => reject(e.target.error);
  });
}

/**
 * Mesin Pencarian Toko Multi-Keyword & Filter Cepat (High Performance)
 */
async function searchStores({ query = "", accountFilter = "ALL", limit = 60 }) {
  const db = await initDB();
  const cleanQuery = query.trim().toLowerCase();
  const queryTokens = cleanQuery.split(/\s+/).filter(t => t.length > 0);
  const filterAccount = accountFilter.toUpperCase();

  return new Promise((resolve, reject) => {
    const tx = db.transaction("stores", "readonly");
    const storeOS = tx.objectStore("stores");
    const results = [];
    const seenCodes = new Set();

    const cursorRequest = storeOS.openCursor();

    cursorRequest.onsuccess = (event) => {
      const cursor = event.target.result;
      if (!cursor) {
        resolve(results);
        return;
      }

      const item = cursor.value;

      // Filter Akun (Alfamart, Indomaret, dll)
      let matchesAccount = true;
      if (filterAccount !== "ALL") {
        matchesAccount = (item.account || "").toUpperCase().includes(filterAccount);
      }

      if (matchesAccount) {
        // Filter Kata Kunci Pencarian (Multi-token match)
        let matchesQuery = true;
        if (queryTokens.length > 0) {
          const targetText = item.searchIndex;
          for (let i = 0; i < queryTokens.length; i++) {
            if (!targetText.includes(queryTokens[i])) {
              matchesQuery = false;
              break;
            }
          }
        }

        if (matchesQuery) {
          const codeKey = (item.kodeToko || "").trim().toUpperCase();
          if (!seenCodes.has(codeKey)) {
            seenCodes.add(codeKey);
            results.push(item);
            if (results.length >= limit) {
              resolve(results);
              return;
            }
          }
        }
      }

      cursor.continue();
    };

    cursorRequest.onerror = (e) => reject(e.target.error);
  });
}

/**
 * Simpan Riwayat Penginputan Rute
 */
async function saveHistoryEntry(entry) {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("history", "readwrite");
    const histOS = tx.objectStore("history");
    histOS.add({
      ...entry,
      timestamp: new Date().toISOString()
    });
    tx.oncomplete = () => resolve(true);
    tx.onerror = (e) => reject(e.target.error);
  });
}

/**
 * Ambil Riwayat Penginputan
 */
async function getHistoryEntries(limit = 20) {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("history", "readonly");
    const histOS = tx.objectStore("history");
    const req = histOS.getAll();
    req.onsuccess = () => {
      const list = (req.result || []).reverse().slice(0, limit);
      resolve(list);
    };
    req.onerror = (e) => reject(e.target.error);
  });
}
