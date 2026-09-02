/**
 * GOOGLE APPS SCRIPT - BACKEND API WEB ABSEN MDS
 * 
 * Script ini menangani:
 * 1. Menerima data rute yang diinput MDS dari Web Absen
 * 2. Menuliskan data secara otomatis ke 3 Target Spreadsheet:
 *    - Spreadsheet Modul (DK1..DK6, LK1..LK5, LP1..LP4) -> Sheet 'Master_Toko'
 *    - Spreadsheet Data External -> Sheet 'Master_Toko2'
 *    - Spreadsheet Absen -> Sheet 'Toko_Absen'
 * 3. Menyediakan sinkronisasi data master toko & crew
 */

// ==========================================
// KONFIGURASI ID SPREADSHEET
// ==========================================
const CONFIG = {
  // Master Spreadsheet Utama (Crew & Master Toko 34k)
  MASTER_DATABASE_ID: "16cokFfnQFIajmTd553TKy-CfkNFc1Gg7ElkhAer81QA",

  // Modul DK (DK1 - DK6)
  DK: {
    MODULES: {
      "DK1": "1asDdjDm0kUfFmICLtkhJ5VBhmKUels2c-H8Cd22qYvk",
      "DK2": "14d0LUW73TveimrVC5QZ5Aq8fanWFTa-endNTq5UgxU0",
      "DK3": "1PyP2gDOltePqcadtcOzncjb8vYpqlYcUu31N_JYu_gQ",
      "DK4": "1jiN7bi-Uc104X5Ug2p2hYlI163h-ycQ8hEqHyt4zoKw",
      "DK5": "1QWf1cG5byneFDGmy_m2eUe_aUUUtztBc8ERgfGjjmb4",
      "DK6": "1VV6E_MuBUNgQMopvTezXDRlHpa6Z1fKfHOlew--cPBY"
    },
    ABSEN_ID: "1A-Z_cGLRuB3_2D3_ZDF_z5Q9zoLJlwarV0pDyu69-cY",
    EXTERNAL_ID: "1xQWISX8v_NGaCbw5Ih7uOe8mTZF-nR0x5UvoZS5Up40"
  },

  // Modul LK (LK1 - LK5)
  LK: {
    MODULES: {
      "LK1": "1LdoLka5rw1m8fuhOhYqvs6v0hgbY766sdlVj_JcMrb4",
      "LK2": "1LjRvlTow7wcLDJHipCw-H2mdn5Wh7YuwBf7Ab5kN1BM",
      "LK3": "1EuxP8f8D4Vya5kdN1_0QVCDP1dPvAkrMKErnRCO4jJM",
      "LK4": "1GRuXwLgO_zsuW6Ai49h9w1QTFxM_TQVxBs6xWKpqEhY",
      "LK5": "1GyTFOp8siIXfLpUmEv935hZ0976-fXqXgiwz5Juq92A"
    },
    ABSEN_ID: "1CPBD6M_C15_oYnegBG_dz1xb5eGUXR6USkNUnUvkZ2s",
    EXTERNAL_ID: "1V7bkEA6_-lzeu4pSAiHR9kHr0a2TLAZp4mt-ttxRyMU"
  },

  // Modul LP (LP1 - LP4)
  LP: {
    MODULES: {
      "LP1": "1356ZShL_ZQaO0pwI7msWcQmINpyKCxhizMzt8c5cKpo",
      "LP2": "1Dy6Zb6e9eWLOuLcWaUiKYWpIuv2mpz-leGJwiJu20Ss",
      "LP3": "1S__W_tKymV2xwqx_-vthpPt5jn5u7t3ePlgPqM1opMM",
      "LP4": "1kUWJIQxtSkjebZMualR2bIV6HyGxp-baDVz1s-7KspU"
    },
    ABSEN_ID: "15xkzv8Q2ZIuPH4P1KzlILKWMsl2i4VkuAE9WD3IDR4Q",
    EXTERNAL_ID: "1FWBdjYAbKSDz8Dk-mcmpv_z6AuJC9BMfUUNe4_ISfo0"
  }
};

// Nama Sheet Standar
const SHEET_NAMES = {
  MODULE_MASTER: "Master_Toko",
  EXTERNAL_MASTER: "Master_Toko2",
  ABSEN: "Toko_Absen"
};

/**
 * Handle HTTP GET Request (Health check & Data Sync)
 */
function doGet(e) {
  try {
    const action = e && e.parameter ? e.parameter.action : "ping";

    if (action === "ping") {
      return jsonResponse({
        status: "success",
        message: "API Web Absen MDS is active and running!",
        timestamp: new Date().toISOString()
      });
    }

    if (action === "get_crew") {
      const crewList = fetchCrewList();
      return jsonResponse({
        status: "success",
        total: crewList.length,
        data: crewList
      });
    }

    if (action === "get_schedule") {
      const moduleParam = e.parameter.module;
      const ruteParam = e.parameter.rute;
      const crewCodeParam = e.parameter.crewCode;

      if (!moduleParam) {
        throw new Error("Parameter 'module' wajib diisi");
      }

      const scheduleData = fetchModuleSchedule(moduleParam, ruteParam, crewCodeParam);
      return jsonResponse({
        status: "success",
        total: scheduleData.length,
        data: scheduleData
      });
    }

    if (action === "get_claimed_stores") {
      // Scan semua modul (DK, LK, LP) untuk cari toko yang sudah diklaim MDS manapun
      const ruteParam = e.parameter.rute; // optional - filter per rute
      const claimed = fetchAllClaimedStores(ruteParam);
      return jsonResponse({
        status: "success",
        total: Object.keys(claimed).length,
        data: claimed
      });
    }

    return jsonResponse({
      status: "error",
      message: "Action tidak dikenal"
    });
  } catch (error) {
    return jsonResponse({
      status: "error",
      message: error.toString()
    });
  }
}

/**
 * Handle HTTP POST Request (Menerima Penginputan Rute)
 */
function doPost(e) {
  try {
    let payload;
    if (e.postData && e.postData.contents) {
      payload = JSON.parse(e.postData.contents);
    } else if (e.parameter && e.parameter.data) {
      payload = JSON.parse(e.parameter.data);
    } else {
      throw new Error("Payload kosong atau format tidak valid");
    }

    // Aksi 1: Sinkronisasi Tambah / Edit Toko Manual Langsung ke Master Spreadsheet
    if (payload.action === "save_store" || payload.action === "save_custom_store") {
      const storeData = payload.store || payload;
      const res = saveOrUpdateMasterStore(storeData);
      return jsonResponse({
        status: "success",
        message: `Toko ${storeData.namaToko} (${storeData.kodeToko}) berhasil disinkronkan ke Master Spreadsheet!`,
        details: res
      });
    }

    // Aksi 2: Sinkronisasi Tambah / Edit Crew User Langsung ke Master Spreadsheet
    if (payload.action === "save_crew" || payload.action === "save_user") {
      const crewData = payload.crew || payload;
      const res = saveOrUpdateMasterCrew(crewData);
      return jsonResponse({
        status: "success",
        message: `Data crew ${crewData.nama} berhasil disinkronkan ke Master Spreadsheet!`,
        details: res
      });
    }

    // Aksi 3: Hapus 1 Toko dari Jadwal di Google Spreadsheet
    if (payload.action === "delete_scheduled_store" || payload.action === "delete_store_schedule") {
      const { module, rute, crewCode, kodeToko } = payload;
      const res = deleteStoreFromAllSpreadsheets(module, rute, crewCode, kodeToko);
      return jsonResponse({
        status: "success",
        message: `Toko ${kodeToko} berhasil dihapus dari jadwal Rute ${rute} di Google Sheet!`,
        details: res
      });
    }

    // Aksi 4: Penginputan Rute Absen (Distribusi ke 4 Spreadsheet)
    const { module, crewCode, crewName, rute, stores } = payload;

    if (!module || !crewName || !rute || !stores || !stores.length) {
      throw new Error("Data input tidak lengkap. Harap periksa modul, crew, rute, dan daftar toko.");
    }

    // Normalisasi format modul (Contoh: "LP 4" atau "LP4" -> "LP4", group "LP")
    const cleanModule = module.toUpperCase().replace(/\s+/g, "");
    const groupKey = cleanModule.substring(0, 2); // "DK", "LK", atau "LP"

    const groupConfig = CONFIG[groupKey];
    if (!groupConfig) {
      throw new Error(`Kategori modul '${groupKey}' tidak ditemukan dalam konfigurasi`);
    }

    const moduleSpreadsheetId = groupConfig.MODULES[cleanModule];
    if (!moduleSpreadsheetId) {
      throw new Error(`Spreadsheet untuk sub-modul '${cleanModule}' tidak ditemukan`);
    }

    const externalSpreadsheetId = groupConfig.EXTERNAL_ID;
    const absenSpreadsheetId = groupConfig.ABSEN_ID;

    // Siapkan baris data dengan format:
    // ACCOUNT | KODE TOKO | NAMA TOKO | KODE CREW | NAMA CREW | RUTE
    const rowsToAdd = stores.map(store => {
      return [
        (store.account || "").toString().trim().toUpperCase(),
        (store.kodeToko || store.kode || "").toString().trim(),
        (store.namaToko || store.nama || "").toString().trim(),
        (crewCode || "").toString().trim(),
        (crewName || "").toString().trim(),
        rute.toString().trim()
      ];
    });

    const results = {
      moduleTarget: { success: false, name: cleanModule, count: 0 },
      externalTarget: { success: false, name: "Data External (" + groupKey + ")", count: 0 },
      absenTarget: { success: false, name: "Toko Absen (" + groupKey + ")", count: 0 }
    };

    // 1. Tulis ke Spreadsheet Modul (Sheet: Master_Toko)
    try {
      appendRowsToSheet(moduleSpreadsheetId, SHEET_NAMES.MODULE_MASTER, rowsToAdd);
      results.moduleTarget.success = true;
      results.moduleTarget.count = rowsToAdd.length;
    } catch (err) {
      results.moduleTarget.error = err.toString();
    }

    // 2. Tulis ke Spreadsheet Data External (Sheet: Master_Toko2)
    try {
      appendRowsToSheet(externalSpreadsheetId, SHEET_NAMES.EXTERNAL_MASTER, rowsToAdd);
      results.externalTarget.success = true;
      results.externalTarget.count = rowsToAdd.length;
    } catch (err) {
      results.externalTarget.error = err.toString();
    }

    // 3. Tulis ke Spreadsheet Toko Absen (Sheet: Toko_Absen)
    try {
      appendRowsToSheet(absenSpreadsheetId, SHEET_NAMES.ABSEN, rowsToAdd);
      results.absenTarget.success = true;
      results.absenTarget.count = rowsToAdd.length;
    } catch (err) {
      results.absenTarget.error = err.toString();
    }

    // 4. Tulis Rekap Global ke Master Spreadsheet (Sheet: Rekap_Rute)
    // Lengkap dengan Status Kunjungan (Kunjungan Pertama / Re-Visit) & Alasan Re-Visit
    const nowFormatted = Utilities.formatDate(new Date(), "Asia/Jakarta", "yyyy-MM-dd HH:mm:ss");
    const rekapRows = stores.map(store => {
      const statusKunjungan = store.statusKunjungan || (store.isRevisit ? "Re-Visit" : "Kunjungan Pertama");
      const alasanRevisit = store.alasanRevisit || "-";
      return [
        (store.account || "").toString().trim().toUpperCase(),
        (store.kodeToko || store.kode || "").toString().trim(),
        (store.namaToko || store.nama || "").toString().trim(),
        (crewCode || "").toString().trim(),
        (crewName || "").toString().trim(),
        rute.toString().trim(),
        cleanModule,
        statusKunjungan,
        alasanRevisit,
        nowFormatted
      ];
    });

    try {
      appendRekapToMasterDatabase(rekapRows);
      results.masterRekap = { success: true, name: "Rekap_Rute (Master)", count: rekapRows.length };
    } catch (err) {
      results.masterRekap = { success: false, error: err.toString() };
    }

    return jsonResponse({
      status: "success",
      message: `Berhasil menginput ${rowsToAdd.length} toko ke Rute ${rute} untuk ${crewName} (${cleanModule})`,
      timestamp: new Date().toISOString(),
      details: results
    });

  } catch (error) {
    return jsonResponse({
      status: "error",
      message: error.toString()
    });
  }
}

/**
 * Helper untuk append baris ke sheet tertentu
 */
function appendRowsToSheet(spreadsheetId, sheetName, rows) {
  const ss = SpreadsheetApp.openById(spreadsheetId);
  let sheet = ss.getSheetByName(sheetName);
  
  if (!sheet) {
    // Jika nama sheet tidak persis sama, gunakan sheet pertama
    sheet = ss.getSheets()[0];
  }

  const lastRow = sheet.getLastRow();
  const startRow = lastRow + 1;
  const numRows = rows.length;
  const numCols = rows[0].length;

  sheet.getRange(startRow, 1, numRows, numCols).setValues(rows);
}

/**
 * Helper untuk append rekap ke Sheet 'Rekap_Rute' di Master Database
 * Jika sheet belum ada, otomatis dibuatkan dan diberi baris header lengkap!
 */
function appendRekapToMasterDatabase(rows) {
  const ss = SpreadsheetApp.openById(CONFIG.MASTER_DATABASE_ID);
  const sheetName = "Rekap_Rute";
  let sheet = ss.getSheetByName(sheetName);

  if (!sheet) {
    // Otomatis buat tab sheet baru jika belum ada
    sheet = ss.insertSheet(sheetName);
    const headers = [
      ["ACCOUNT", "KODE TOKO", "NAMA TOKO", "KODE CREW", "NAMA CREW", "RUTE", "MODUL", "STATUS KUNJUNGAN", "ALASAN RE-VISIT", "WAKTU INPUT"]
    ];
    sheet.getRange(1, 1, 1, headers[0].length).setValues(headers);
    sheet.getRange(1, 1, 1, headers[0].length)
      .setFontWeight("bold")
      .setBackground("#4f46e5")
      .setFontColor("#ffffff");
  }

  const lastRow = sheet.getLastRow();
  const startRow = lastRow + 1;
  const numRows = rows.length;
  const numCols = rows[0].length;

  sheet.getRange(startRow, 1, numRows, numCols).setValues(rows);
}

/**
 * Sinkronisasi Tambah / Edit Toko ke Master Spreadsheet (Sheet: Master_Toko)
 */
function saveOrUpdateMasterStore(store) {
  const ss = SpreadsheetApp.openById(CONFIG.MASTER_DATABASE_ID);
  const sheet = ss.getSheetByName(SHEET_NAMES.MODULE_MASTER) || ss.getSheets()[0];
  const values = sheet.getDataRange().getValues();

  const kodeTarget = (store.kodeToko || store.kode || "").toString().trim().toUpperCase();
  if (!kodeTarget) throw new Error("Kode Toko wajib diisi");

  const headers = values[0].map(h => (h || "").toString().toLowerCase().replace(/[^a-z0-9]/g, ""));
  const codeIdx = headers.findIndex(h => h.includes("storecode") || h.includes("kodetoko") || h.includes("code"));
  const nameIdx = headers.findIndex(h => h.includes("namatoko") || h.includes("storename") || h.includes("nama"));
  const typeIdx = headers.findIndex(h => h.includes("tipe") || h.includes("account") || h.includes("type"));
  const dcIdx = headers.findIndex(h => h.includes("dcname") || h.includes("dc"));
  const kecIdx = headers.findIndex(h => h.includes("kecamatan"));
  const kotaIdx = headers.findIndex(h => h.includes("kabkota") || h.includes("kota"));
  const latIdx = headers.findIndex(h => h.includes("latitude") || h.includes("lat"));
  const lonIdx = headers.findIndex(h => h.includes("longitude") || h.includes("long") || h.includes("lon") || h.includes("lng"));

  const cIdx = codeIdx >= 0 ? codeIdx : 0;
  const nIdx = nameIdx >= 0 ? nameIdx : 3;
  const tIdx = typeIdx >= 0 ? typeIdx : 9;
  const dIdx = dcIdx >= 0 ? dcIdx : 2;
  const kIdx = kecIdx >= 0 ? kecIdx : 5;
  const ktIdx = kotaIdx >= 0 ? kotaIdx : 6;
  const ltIdx = latIdx >= 0 ? latIdx : 7;
  const lnIdx = lonIdx >= 0 ? lonIdx : 8;

  let existingRowIndex = -1;
  for (let i = 1; i < values.length; i++) {
    const rowCode = (values[i][cIdx] || "").toString().trim().toUpperCase();
    if (rowCode === kodeTarget) {
      existingRowIndex = i + 1; // 1-based index in Sheet
      break;
    }
  }

  const account = (store.account || "ALFAMART").toString().trim().toUpperCase();
  const namaToko = (store.namaToko || "").toString().trim();
  const dcName = (store.dcName || "").toString().trim();
  const kecamatan = (store.kecamatan || "").toString().trim();
  const kota = (store.kota || "").toString().trim();
  const lat = store.lat !== null && store.lat !== undefined ? store.lat.toString().replace(".", ",") : "";
  const lon = store.lon !== null && store.lon !== undefined ? store.lon.toString().replace(".", ",") : "";

  if (existingRowIndex > 0) {
    // Update existing row
    if (nIdx >= 0 && namaToko) sheet.getRange(existingRowIndex, nIdx + 1).setValue(namaToko);
    if (tIdx >= 0 && account) sheet.getRange(existingRowIndex, tIdx + 1).setValue(account);
    if (dIdx >= 0 && dcName) sheet.getRange(existingRowIndex, dIdx + 1).setValue(dcName);
    if (kIdx >= 0 && kecamatan) sheet.getRange(existingRowIndex, kIdx + 1).setValue(kecamatan);
    if (ktIdx >= 0 && kota) sheet.getRange(existingRowIndex, ktIdx + 1).setValue(kota);
    if (ltIdx >= 0 && lat) sheet.getRange(existingRowIndex, ltIdx + 1).setValue(lat);
    if (lnIdx >= 0 && lon) sheet.getRange(existingRowIndex, lnIdx + 1).setValue(lon);
    return { action: "updated", row: existingRowIndex };
  } else {
    // Append new row
    const maxCols = Math.max(cIdx, nIdx, tIdx, dIdx, kIdx, ktIdx, ltIdx, lnIdx) + 1;
    const newRow = new Array(maxCols).fill("");
    newRow[cIdx] = kodeTarget;
    newRow[nIdx] = namaToko;
    newRow[tIdx] = account;
    newRow[dIdx] = dcName;
    newRow[kIdx] = kecamatan;
    newRow[ktIdx] = kota;
    newRow[ltIdx] = lat;
    newRow[lnIdx] = lon;

    sheet.appendRow(newRow);
    return { action: "created", row: sheet.getLastRow() };
  }
}

/**
 * Sinkronisasi Tambah / Edit Crew ke Master Spreadsheet (Sheet: master_user)
 */
function saveOrUpdateMasterCrew(crew) {
  const ss = SpreadsheetApp.openById(CONFIG.MASTER_DATABASE_ID);
  const sheet = ss.getSheetByName("master_user") || ss.getSheetByName("Master_User") || ss.getSheets()[0];
  const values = sheet.getDataRange().getValues();

  const idTarget = (crew.id || crew.kodeCrew || "").toString().trim();
  const namaTarget = (crew.nama || "").toString().trim();
  const modul = (crew.modul || "LP4").toString().trim().toUpperCase();
  const account = (crew.account || "ALFAMART").toString().trim().toUpperCase();
  const jabatan = (crew.jabatan || "Merchandiser").toString().trim();

  if (!namaTarget) throw new Error("Nama crew wajib diisi");

  let existingRowIndex = -1;
  for (let i = 1; i < values.length; i++) {
    const rowId = (values[i][0] || "").toString().trim();
    const rowNama = (values[i][1] || "").toString().trim();
    if ((idTarget && rowId === idTarget) || (namaTarget && rowNama.toLowerCase() === namaTarget.toLowerCase())) {
      existingRowIndex = i + 1; // 1-based index in Sheet
      break;
    }
  }

  if (existingRowIndex > 0) {
    // Update data crew yang sudah ada
    if (idTarget) sheet.getRange(existingRowIndex, 1).setValue(idTarget);
    sheet.getRange(existingRowIndex, 2).setValue(namaTarget);
    sheet.getRange(existingRowIndex, 8).setValue(modul); // Kolom 8: MODUL
    return { action: "updated", row: existingRowIndex };
  } else {
    // Append baris crew baru di master_user: ID, NAMA, JABATAN, DIVISI, ACCOUNT, EMAIL, ROLE, MODUL
    const newRow = [
      idTarget || `MDS_${Date.now().toString().slice(-4)}`,
      namaTarget,
      jabatan,
      "Retail Operation",
      account,
      "",
      "user",
      modul
    ];
    sheet.appendRow(newRow);
    return { action: "created", row: sheet.getLastRow() };
  }
}

/**
 * Helper untuk membaca daftar crew dari master database
 */
function fetchCrewList() {
  const ss = SpreadsheetApp.openById(CONFIG.MASTER_DATABASE_ID);
  const sheet = ss.getSheets()[0]; // Sheet pertama berisi data crew
  const values = sheet.getDataRange().getValues();
  
  if (values.length < 2) return [];

  const headers = values[0].map(h => (h || "").toString().toUpperCase().trim());
  const idIdx = headers.findIndex(h => h.includes("ID"));
  const namaIdx = headers.findIndex(h => h.includes("NAMA"));
  const modulIdx = headers.findIndex(h => h.includes("MODUL"));
  const accountIdx = headers.findIndex(h => h.includes("ACCOUNT"));

  const crewList = [];
  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    const nama = row[namaIdx >= 0 ? namaIdx : 1];
    if (!nama) continue;

    crewList.push({
      id: (row[idIdx >= 0 ? idIdx : 0] || "").toString().trim(),
      nama: nama.toString().trim(),
      modul: (row[modulIdx >= 0 ? modulIdx : 7] || "").toString().trim(),
      account: (row[accountIdx >= 0 ? accountIdx : 4] || "").toString().trim()
    });
  }

  return crewList;
}

/**
 * Helper untuk membaca jadwal toko yang sudah diinput pada modul tertentu
 */
function fetchModuleSchedule(moduleName, ruteFilter, crewCodeFilter) {
  const cleanModule = moduleName.toUpperCase().replace(/\s+/g, "");
  const groupKey = cleanModule.substring(0, 2);

  const groupConfig = CONFIG[groupKey];
  if (!groupConfig || !groupConfig.MODULES[cleanModule]) {
    throw new Error(`Modul '${cleanModule}' tidak ditemukan`);
  }

  const spreadsheetId = groupConfig.MODULES[cleanModule];
  const ss = SpreadsheetApp.openById(spreadsheetId);
  const sheet = ss.getSheetByName(SHEET_NAMES.MODULE_MASTER) || ss.getSheets()[0];
  const values = sheet.getDataRange().getValues();

  if (values.length < 2) return [];

  // Format kolom standar:
  // 0: ACCOUNT | 1: KODE TOKO | 2: NAMA TOKO | 3: KODE CREW | 4: NAMA CREW | 5: RUTE
  const results = [];
  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    const account = (row[0] || "").toString().trim();
    const kodeToko = (row[1] || "").toString().trim();
    const namaToko = (row[2] || "").toString().trim();
    const kodeCrew = (row[3] || "").toString().trim();
    const namaCrew = (row[4] || "").toString().trim();
    const rute = (row[5] || "").toString().trim();

    if (!kodeToko && !namaToko) continue;

    // Filter Rute jika parameter rute diberikan
    if (ruteFilter && rute.toString() !== ruteFilter.toString()) {
      continue;
    }

    // Filter Kode Crew jika parameter crewCode diberikan
    if (crewCodeFilter && kodeCrew !== crewCodeFilter.toString().trim()) {
      continue;
    }

    results.push({
      account: account,
      kodeToko: kodeToko,
      namaToko: namaToko,
      kodeCrew: kodeCrew,
      namaCrew: namaCrew,
      rute: rute
    });
  }

  return results;
}

/**
 * Helper untuk format response JSON dengan CORS Header yang aman
 */
function jsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Scan semua spreadsheet modul (DK, LK, LP) dan kembalikan map:
 *   { [kodeToko]: [ { namaCrew, kodeCrew, modul, rute }, ... ] }
 * 
 * Array berisi SEMUA kunjungan ke toko tersebut (multi-visit support).
 * Frontend yang akan memutuskan: dikunci total (MDS lain) atau soft-block (re-visit).
 */
function fetchAllClaimedStores(ruteFilter) {
  // Map: kodeToko -> array of visit records
  const visitMap = {};

  const groups = ["DK", "LK", "LP"];

  for (const groupKey of groups) {
    const groupConfig = CONFIG[groupKey];
    if (!groupConfig || !groupConfig.MODULES) continue;

    for (const moduleName in groupConfig.MODULES) {
      const spreadsheetId = groupConfig.MODULES[moduleName];

      try {
        const ss = SpreadsheetApp.openById(spreadsheetId);
        const sheet = ss.getSheetByName(SHEET_NAMES.MODULE_MASTER) || ss.getSheets()[0];
        const values = sheet.getDataRange().getValues();

        if (values.length < 2) continue;

        // Format kolom: 0:ACCOUNT | 1:KODE TOKO | 2:NAMA TOKO | 3:KODE CREW | 4:NAMA CREW | 5:RUTE
        for (let i = 1; i < values.length; i++) {
          const row = values[i];
          const kodeToko = (row[1] || "").toString().trim();
          if (!kodeToko) continue;

          const rute = (row[5] || "").toString().trim();
          const kodeCrew = (row[3] || "").toString().trim();
          const namaCrew = (row[4] || "").toString().trim();
          const account = (row[0] || "").toString().trim();
          const namaToko = (row[2] || "").toString().trim();

          if (!visitMap[kodeToko]) visitMap[kodeToko] = [];

          visitMap[kodeToko].push({
            kodeToko: kodeToko,
            namaToko: namaToko,
            account: account,
            kodeCrew: kodeCrew,
            namaCrew: namaCrew,
            modul: moduleName,
            rute: rute
          });
        }
      } catch (err) {
        Logger.log("Skip modul " + moduleName + ": " + err.toString());
      }
    }
  }

  return visitMap;
}

/**
 * Helper untuk menghapus 1 baris toko tertentu dari spreadsheet jadwal (Modul, External, Absen)
 */
function deleteStoreFromAllSpreadsheets(moduleName, rute, crewCode, kodeToko) {
  if (!moduleName || !rute || !kodeToko) {
    throw new Error("Parameter module, rute, dan kodeToko wajib diisi");
  }

  const cleanModule = moduleName.toUpperCase().replace(/\s+/g, "");
  const groupKey = cleanModule.substring(0, 2);
  const groupConfig = CONFIG[groupKey];
  if (!groupConfig) throw new Error("Kategori modul tidak ditemukan");

  const moduleSpreadsheetId = groupConfig.MODULES[cleanModule];
  const externalSpreadsheetId = groupConfig.EXTERNAL_ID;
  const absenSpreadsheetId = groupConfig.ABSEN_ID;

  const targets = [
    { id: moduleSpreadsheetId, sheet: SHEET_NAMES.MODULE_MASTER },
    { id: externalSpreadsheetId, sheet: SHEET_NAMES.EXTERNAL_MASTER },
    { id: absenSpreadsheetId, sheet: SHEET_NAMES.ABSEN }
  ];

  const results = {};
  targets.forEach(t => {
    try {
      if (!t.id) return;
      const ss = SpreadsheetApp.openById(t.id);
      const sheet = ss.getSheetByName(t.sheet) || ss.getSheets()[0];
      const values = sheet.getDataRange().getValues();

      // Scan dari baris paling bawah ke atas agar index baris tetap valid saat di-delete
      for (let i = values.length - 1; i >= 1; i--) {
        const row = values[i];
        const rowKode = (row[1] || "").toString().trim().toUpperCase();
        const rowRute = (row[5] || "").toString().trim();
        const rowCrew = (row[3] || "").toString().trim();

        const matchKode = rowKode === kodeToko.toString().trim().toUpperCase();
        const matchRute = rowRute === rute.toString().trim();
        const matchCrew = !crewCode || rowCrew === crewCode.toString().trim();

        if (matchKode && matchRute && matchCrew) {
          sheet.deleteRow(i + 1); // deleteRow menggunakan 1-based index
        }
      }
      results[t.sheet] = true;
    } catch (e) {
      results[t.sheet] = e.toString();
    }
  });

  return results;
}

