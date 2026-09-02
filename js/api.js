/**
 * API & SYNC SERVICE - GOOGLE SHEETS & GAS COMMUNICATOR
 */

const API_CONFIG = {
  // URL Default Spreadsheet Master 34k Toko & Crew
  MASTER_SHEET_ID: "16cokFfnQFIajmTd553TKy-CfkNFc1Gg7ElkhAer81QA",
  
  // URL Google Apps Script Web App Default
  DEFAULT_GAS_URL: "https://script.google.com/macros/s/AKfycby1QQCwXusMhaEtm79iVISFjrZ3H6RxGOTi3vTXcYF-Xvv9SOk-X4HkugRUEe1E2-pZHQ/exec",
  
  getGasUrl: () => localStorage.getItem("mds_gas_api_url") || API_CONFIG.DEFAULT_GAS_URL,
  setGasUrl: (url) => localStorage.setItem("mds_gas_api_url", url.trim())
};

/**
 * Fast & Safe CSV Stream Parser
 * Mengurai ribuan baris CSV Google Sheet dengan cepat
 */
function parseCSV(text) {
  const lines = text.split(/\r\n|\n/);
  const result = [];
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const row = [];
    let insideQuotes = false;
    let cell = "";

    for (let c = 0; c < line.length; c++) {
      const char = line[c];
      if (char === '"') {
        if (insideQuotes && line[c + 1] === '"') {
          cell += '"';
          c++; // skip escaped quote
        } else {
          insideQuotes = !insideQuotes;
        }
      } else if (char === ',' && !insideQuotes) {
        row.push(cell.trim());
        cell = "";
      } else {
        cell += char;
      }
    }
    row.push(cell.trim());
    result.push(row);
  }
  return result;
}

/**
 * Sinkronisasi Master Toko 34.000+ dari Google Spreadsheet
 */
async function syncMasterStoresFromSheet(onProgress) {
  const url = `https://docs.google.com/spreadsheets/d/${API_CONFIG.MASTER_SHEET_ID}/gviz/tq?tqx=out:csv&sheet=Master_Toko`;
  
  if (onProgress) onProgress("Mengunduh 34.000+ data toko dari Google Sheet...", 25);
  await new Promise(r => setTimeout(r, 40));
  
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Gagal mengunduh spreadsheet: status ${response.status}`);
  }

  if (onProgress) onProgress("Memproses baris CSV & koordinat GPS...", 55);
  await new Promise(r => setTimeout(r, 40));

  const csvText = await response.text();
  const rows = parseCSV(csvText);

  if (rows.length < 2) {
    throw new Error("Data spreadsheet kosong atau format tidak sesuai");
  }

  // Cari index kolom
  const headers = rows[0].map(h => h.toLowerCase().replace(/[^a-z0-9]/g, ""));
  const codeIdx = headers.findIndex(h => h.includes("storecode") || h.includes("kodetoko") || h.includes("code"));
  const nameIdx = headers.findIndex(h => h.includes("namatoko") || h.includes("storename") || h.includes("nama"));
  const typeIdx = headers.findIndex(h => h.includes("tipe") || h.includes("account") || h.includes("type"));
  const dcIdx = headers.findIndex(h => h.includes("dcname") || h.includes("dc"));
  const kecIdx = headers.findIndex(h => h.includes("kecamatan"));
  const kotaIdx = headers.findIndex(h => h.includes("kabkota") || h.includes("kota"));
  const latIdx = headers.findIndex(h => h.includes("latitude") || h.includes("lat"));
  const lonIdx = headers.findIndex(h => h.includes("longitude") || h.includes("long") || h.includes("lon") || h.includes("lng"));

  const storeMap = new Map(); // key: kodeToko
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const kode = (row[codeIdx >= 0 ? codeIdx : 0] || "").trim().toUpperCase();
    const nama = (row[nameIdx >= 0 ? nameIdx : 3] || "").trim();
    if (!kode && !nama) continue;

    const latRaw = row[latIdx >= 0 ? latIdx : 7];
    const lonRaw = row[lonIdx >= 0 ? lonIdx : 8];
    const lat = latRaw ? parseFloat(latRaw.replace(",", ".")) : null;
    const lon = lonRaw ? parseFloat(lonRaw.replace(",", ".")) : null;

    const storeObj = {
      kodeToko: kode,
      namaToko: nama,
      account: (row[typeIdx >= 0 ? typeIdx : 9] || "ALFAMART").trim().toUpperCase(),
      dcName: (row[dcIdx >= 0 ? dcIdx : 2] || "").trim(),
      kecamatan: (row[kecIdx >= 0 ? kecIdx : 5] || "").trim(),
      kota: (row[kotaIdx >= 0 ? kotaIdx : 6] || "").trim(),
      lat: !isNaN(lat) && lat !== null ? lat : null,
      lon: !isNaN(lon) && lon !== null ? lon : null
    };

    // De-duplikasi cerdas:
    // Jika kode toko sudah ada, prioritaskan record yang punya koordinat GPS lengkap
    if (storeMap.has(kode)) {
      const existing = storeMap.get(kode);
      if ((!existing.lat || !existing.lon) && (storeObj.lat && storeObj.lon)) {
        storeMap.set(kode, storeObj);
      }
    } else {
      storeMap.set(kode, storeObj);
    }
  }

  const stores = Array.from(storeMap.values());

  if (onProgress) onProgress(`Menyimpan ${stores.length.toLocaleString()} toko ke memori HP...`, 85);
  await new Promise(r => setTimeout(r, 40));

  await saveStoresBatch(stores);

  if (onProgress) onProgress("Peta siap!", 100);
  await new Promise(r => setTimeout(r, 40));

  return stores.length;
}

/**
 * Sinkronisasi Master Crew dari Google Spreadsheet
 */
async function syncMasterCrewFromSheet() {
  const url = `https://docs.google.com/spreadsheets/d/${API_CONFIG.MASTER_SHEET_ID}/gviz/tq?tqx=out:csv`;
  
  try {
    const response = await fetch(url);
    if (!response.ok) return [];

    const csvText = await response.text();
    const rows = parseCSV(csvText);
    if (rows.length < 2) return [];

    const crews = [];

    // 1. Ekstrak admin & management jika berada di baris atas/header spreadsheet
    const headerRowStr = rows[0] ? rows[0].join(" ") : "";
    if (headerRowStr.includes("Yohandi Pratama")) {
      crews.push({
        id: "RO036",
        nama: "Yohandi Pratama",
        modul: "LP4",
        account: "ALFAMART",
        jabatan: "Administrator & Merchandiser"
      });
    }

    // 2. Baris 1..N: Data Merchandiser Lapangan
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const id = (row[0] || "").toString().trim();
      const nama = (row[1] || "").toString().trim();
      const modul = (row[7] || row[6] || "").toString().trim();
      const account = (row[4] || "").toString().trim();
      const jabatan = (row[2] || "").toString().trim();

      if (nama && id && !crews.some(c => c.nama.toLowerCase() === nama.toLowerCase())) {
        crews.push({ id, nama, modul, account, jabatan });
      }
    }

    if (crews.length > 0) {
      await saveCrewList(crews);
    }
    return crews;
  } catch (err) {
    console.warn("Gagal sync master crew:", err);
    return [];
  }
}

/**
 * Mengirim Penginputan Rute ke Google Apps Script (GAS) Backend
 */
async function submitRouteAttendance({ module, crewCode, crewName, rute, stores }) {
  const gasUrl = API_CONFIG.getGasUrl();

  const payload = {
    module: module,
    crewCode: crewCode,
    crewName: crewName,
    rute: rute,
    stores: stores
  };

  // Jika URL GAS sudah dipasang
  if (gasUrl) {
    try {
      const response = await fetch(gasUrl, {
        method: "POST",
        mode: "no-cors", // Bypass CORS restrictions for Google Apps Script Web App
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });

      // Simpan ke riwayat lokal
      await saveHistoryEntry({
        module,
        crewCode,
        crewName,
        rute,
        storeCount: stores.length,
        stores: stores,
        status: "Terkirim ke Cloud (GAS)"
      });

      return {
        success: true,
        message: `Data ${stores.length} toko berhasil dikirim ke modul ${module} (Rute ${rute})!`
      };
    } catch (err) {
      console.error("Error submitting to GAS:", err);
      throw new Error(`Gagal mengirim ke Google Spreadsheet: ${err.message}`);
    }
  } else {
    // Mode Simulasi / Offline (Jika GAS URL belum diisi di Pengaturan)
    await saveHistoryEntry({
      module,
      crewCode,
      crewName,
      rute,
      storeCount: stores.length,
      stores: stores,
      status: "Tersimpan Lokal (Belum Pasang URL GAS)"
    });

    return {
      success: true,
      isLocal: true,
      message: `Jadwal ${stores.length} toko tersimpan di riwayat lokal!`
    };
  }
}

/**
 * Sinkronisasi Tambah / Edit Toko Manual Langsung ke Master Spreadsheet (GAS)
 */
async function syncCustomStoreToCloud(store) {
  const gasUrl = API_CONFIG.getGasUrl();
  if (!gasUrl) return { success: false, isOffline: true };

  const payload = {
    action: "save_custom_store",
    store: store
  };

  try {
    await fetch(gasUrl, {
      method: "POST",
      mode: "no-cors",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    return {
      success: true,
      message: `Toko ${store.namaToko} (${store.kodeToko}) disinkronkan ke Master Spreadsheet!`
    };
  } catch (err) {
    console.warn("Gagal sinkron toko ke Master Sheet:", err);
    return { success: false, error: err.message };
  }
}

/**
 * Sinkronisasi Tambah / Edit Crew User ke Master Spreadsheet (Sheet: master_user)
 */
async function syncCrewToCloud(crew) {
  const gasUrl = API_CONFIG.getGasUrl();
  if (!gasUrl) return { success: false, isOffline: true };

  const payload = {
    action: "save_crew",
    crew: crew
  };

  try {
    await fetch(gasUrl, {
      method: "POST",
      mode: "no-cors",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    return {
      success: true,
      message: `Crew ${crew.nama} disinkronkan ke Master Spreadsheet!`
    };
  } catch (err) {
    console.warn("Gagal sinkron crew ke Master Sheet:", err);
    return { success: false, error: err.message };
  }
}

/**
 * Mengambil Jadwal yang sudah terinput di Google Sheet melalui GAS API
 */
async function fetchSavedSchedule({ module, rute, crewCode }) {
  const gasUrl = API_CONFIG.getGasUrl();

  if (gasUrl) {
    try {
      let queryUrl = `${gasUrl}?action=get_schedule&module=${encodeURIComponent(module)}`;
      if (rute) queryUrl += `&rute=${encodeURIComponent(rute)}`;
      if (crewCode) queryUrl += `&crewCode=${encodeURIComponent(crewCode)}`;

      const response = await fetch(queryUrl);
      if (!response.ok) throw new Error(`HTTP Error: ${response.status}`);

      const result = await response.json();
      if (result.status === "success") {
        return result.data || [];
      } else {
        throw new Error(result.message || "Gagal mengambil data jadwal");
      }
    } catch (err) {
      console.warn("GAS fetch schedule failed, fallback to local history:", err);
    }
  }

  // Fallback: Ambil dari riwayat lokal
  const historyList = await getHistoryEntries(50);
  const matchedStores = [];

  historyList.forEach(hist => {
    if (hist.module === module && (!rute || hist.rute.toString() === rute.toString())) {
      (hist.stores || []).forEach(st => {
        matchedStores.push({
          account: st.account,
          kodeToko: st.kodeToko,
          namaToko: st.namaToko,
          kodeCrew: hist.crewCode,
          namaCrew: hist.crewName,
          rute: hist.rute,
          source: 'Lokal'
        });
      });
    }
  });

  return matchedStores;
}
/**
 * Ambil daftar toko yang sudah diklaim (dikover) oleh MDS manapun dari semua modul
 * Returns: Map { [kodeToko]: { namaCrew, kodeCrew, modul, rute } }
 */
async function fetchClaimedStores() {
  const gasUrl = API_CONFIG.getGasUrl();
  if (!gasUrl) return {};

  try {
    const queryUrl = `${gasUrl}?action=get_claimed_stores`;
    const response = await fetch(queryUrl);
    if (!response.ok) throw new Error(`HTTP Error: ${response.status}`);

    const result = await response.json();
    if (result.status === "success") {
      return result.data || {};
    } else {
      throw new Error(result.message || "Gagal mengambil data klaim toko");
    }
  } catch (err) {
    console.warn("Gagal mengambil claimed stores dari GAS:", err.message);
    return {};
  }
}

/**
 * Hapus 1 Toko dari Jadwal di Google Spreadsheet (GAS)
 */
async function deleteScheduledStoreFromCloud({ module, rute, crewCode, kodeToko }) {
  const gasUrl = API_CONFIG.getGasUrl();
  if (!gasUrl) throw new Error("URL Google Apps Script belum disetel");

  const payload = {
    action: "delete_scheduled_store",
    module: module,
    rute: rute,
    crewCode: crewCode,
    kodeToko: kodeToko
  };

  try {
    await fetch(gasUrl, {
      method: "POST",
      mode: "no-cors",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    return {
      success: true,
      message: `Toko ${kodeToko} berhasil dihapus dari jadwal Rute ${rute} di Google Sheet!`
    };
  } catch (err) {
    console.error("Gagal menghapus toko dari jadwal GAS:", err);
    throw new Error(`Gagal menghapus toko dari Google Sheet: ${err.message}`);
  }
}

