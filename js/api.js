/**
 * API & SYNC SERVICE - GOOGLE SHEETS & GAS COMMUNICATOR
 */

const API_CONFIG = {
  // URL Default Spreadsheet Master 34k/49k Toko & Crew
  MASTER_SHEET_ID: "16cokFfnQFIajmTd553TKy-CfkNFc1Gg7ElkhAer81QA",
  MASTER_STORE_GID: "1970488135", // GID Tab master_toko (49.469+ Seluruh Toko Lengkap)
  
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
 * Sinkronisasi Master Toko 49.000+ dari Google Spreadsheet
 */
async function syncMasterStoresFromSheet(onProgress) {
  // Unduh langsung dengan direct GID export (49.469+ toko lengkap)
  let url = `https://docs.google.com/spreadsheets/d/${API_CONFIG.MASTER_SHEET_ID}/export?format=csv&gid=${API_CONFIG.MASTER_STORE_GID}`;
  
  if (onProgress) onProgress("Mengunduh 49.000+ data toko & GPS...", 20);
  await new Promise(r => setTimeout(r, 40));
  
  let response = await fetch(url);
  if (!response.ok) {
    url = `https://docs.google.com/spreadsheets/d/${API_CONFIG.MASTER_SHEET_ID}/gviz/tq?tqx=out:csv&sheet=master_toko`;
    response = await fetch(url);
  }
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

  // Standar index kolom default (0:Code, 1:DcCode, 2:DcName, 3:StoreName, 4:Kec, 5:Kota, 6:PostCode, 7:Lat, 8:Lon, 9:Account)
  let codeIdx = 0;
  let dcIdx = 2;
  let nameIdx = 3;
  let kecIdx = 4;
  let kotaIdx = 5;
  let latIdx = 7;
  let lonIdx = 8;
  let typeIdx = 9;

  // Deteksi jika baris pertama memiliki header yang valid
  if (rows[0] && rows[0].length >= 8) {
    const headers = rows[0].map(h => (h || "").toString().toLowerCase().replace(/[^a-z0-9]/g, ""));
    const foundCode = headers.findIndex(h => h.includes("storecode") || h.includes("kodetoko") || h === "code");
    const foundName = headers.findIndex(h => h.includes("namatoko") || h.includes("storename"));
    const foundType = headers.findIndex(h => h.includes("tipe") || h.includes("account") || h.includes("type"));
    const foundDc = headers.findIndex(h => h.includes("dcname") || h.includes("dc"));
    const foundKec = headers.findIndex(h => h.includes("kecamatan"));
    const foundKota = headers.findIndex(h => h.includes("kabkota") || h.includes("kota"));
    const foundLat = headers.findIndex(h => h.includes("latitude") || h === "lat");
    const foundLon = headers.findIndex(h => h.includes("longitude") || h.includes("long") || h === "lon" || h === "lng");

    if (foundCode >= 0) codeIdx = foundCode;
    if (foundName >= 0) nameIdx = foundName;
    if (foundType >= 0) typeIdx = foundType;
    if (foundDc >= 0) dcIdx = foundDc;
    if (foundKec >= 0) kecIdx = foundKec;
    if (foundKota >= 0) kotaIdx = foundKota;
    if (foundLat >= 0) latIdx = foundLat;
    if (foundLon >= 0) lonIdx = foundLon;
  }

  const storeMap = new Map(); // key: kodeToko_account
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length < 4) continue;

    const kode = (row[codeIdx] || row[0] || "").toString().trim().toUpperCase();
    const nama = (row[nameIdx] || row[3] || "").toString().trim();

    // Skip baris header / sampah teks
    if (!kode || kode === "STORE CODE" || kode.includes(" ") || nama.length < 2) continue;

    const latRaw = row[latIdx] || row[7];
    const lonRaw = row[lonIdx] || row[8];
    const lat = latRaw ? parseFloat(latRaw.toString().replace(",", ".")) : null;
    const lon = lonRaw ? parseFloat(lonRaw.toString().replace(",", ".")) : null;

    const storeObj = {
      kodeToko: kode,
      namaToko: nama,
      account: (row[typeIdx] || row[9] || "ALFAMART").toString().trim().toUpperCase(),
      dcName: (row[dcIdx] || row[2] || "").toString().trim(),
      kecamatan: (row[kecIdx] || row[4] || "").toString().trim(),
      kota: (row[kotaIdx] || row[5] || "").toString().trim(),
      lat: !isNaN(lat) && lat !== null && lat !== 0 ? lat : null,
      lon: !isNaN(lon) && lon !== null && lon !== 0 ? lon : null
    };

    // De-duplikasi cerdas dengan Composite Key (Kode Toko + Akun):
    const uniqueKey = `${kode}_${storeObj.account}`;
    if (storeMap.has(uniqueKey)) {
      const existing = storeMap.get(uniqueKey);
      // Jika yang lama belum punya GPS tapi baris ini punya, update dengan yang punya GPS
      if ((!existing.lat || !existing.lon) && (storeObj.lat && storeObj.lon)) {
        storeMap.set(uniqueKey, storeObj);
      }
    } else {
      storeMap.set(uniqueKey, storeObj);
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

      if (nama && id && !crews.some(c => c.id === id && c.nama.toLowerCase() === nama.toLowerCase() && c.modul.toLowerCase() === modul.toLowerCase())) {
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

/**
 * Mengambil Status Monitoring Input Realtime Seluruh MDS per Rute
 */
async function fetchMdsMonitoringStatus(rute) {
  const gasUrl = API_CONFIG.getGasUrl();
  if (!gasUrl) throw new Error("URL Google Apps Script belum disetel");

  const queryUrl = `${gasUrl}?action=get_monitoring_status&rute=${encodeURIComponent(rute)}`;

  try {
    const response = await fetch(queryUrl);
    if (!response.ok) throw new Error(`HTTP Error: ${response.status}`);

    const result = await response.json();
    if (result.status === "success") {
      return result.data;
    } else {
      throw new Error(result.message || "Gagal mengambil status monitoring");
    }
  } catch (err) {
    console.error("Gagal mengambil status monitoring MDS:", err);
    throw err;
  }
}


