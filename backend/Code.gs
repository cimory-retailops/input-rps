const CONFIG = {
  MASTER_DATABASE_ID: "16cokFfnQFIajmTd553TKy-CfkNFc1Gg7ElkhAer81QA",
  UNIFIED_PIPELINE_ID: "1XqZgR70C1eqfkkKbM9jO2FhSi6-g3I9AskuhsSh7Mzs"
};

const SHEET_NAMES = {
  MASTER_DATABASE_TOKO: "master_toko",
  CREW: "master_user",
  REKAP: "Rekap_Rute",
  TARGET_ROUTE_SHEET: "Master_Toko"
};

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
      const ruteParam = e.parameter.rute;
      const claimed = fetchAllClaimedStores(ruteParam);
      return jsonResponse({
        status: "success",
        total: Object.keys(claimed).length,
        data: claimed
      });
    }

    if (action === "get_monitoring_status" || action === "get_mds_input_status") {
      const ruteParam = e.parameter.rute;
      const monitoringData = fetchMdsInputStatus(ruteParam);
      return jsonResponse({
        status: "success",
        data: monitoringData
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

    if (payload.action === "save_store" || payload.action === "save_custom_store") {
      const storeData = payload.store || payload;
      const res = saveOrUpdateMasterStore(storeData);
      return jsonResponse({
        status: "success",
        message: `Toko ${storeData.namaToko} (${storeData.kodeToko}) berhasil disinkronkan ke Master Spreadsheet!`,
        details: res
      });
    }

    if (payload.action === "save_crew" || payload.action === "save_user") {
      const crewData = payload.crew || payload;
      const res = saveOrUpdateMasterCrew(crewData);
      return jsonResponse({
        status: "success",
        message: `Data crew ${crewData.nama} berhasil disinkronkan ke Master Spreadsheet!`,
        details: res
      });
    }

    if (payload.action === "delete_scheduled_store" || payload.action === "delete_store_schedule") {
      const { module, rute, crewCode, kodeToko } = payload;
      const res = deleteStoreFromAllSpreadsheets(module, rute, crewCode, kodeToko);
      return jsonResponse({
        status: "success",
        message: `Toko ${kodeToko} berhasil dihapus dari jadwal Rute ${rute} di Google Sheet!`,
        details: res
      });
    }

    const { module, crewCode, crewName, rute, stores } = payload;

    if (!module || !crewName || !rute || !stores || !stores.length) {
      throw new Error("Data input tidak lengkap. Harap periksa modul, crew, rute, dan daftar toko.");
    }

    const cleanModule = module.toUpperCase().replace(/\s+/g, "");

    const results = {
      pipelineTarget: { success: false, name: `Unified Pipeline (${SHEET_NAMES.TARGET_ROUTE_SHEET})`, count: 0 }
    };

    try {
      const appendedCount = appendRouteToUnifiedPipeline(cleanModule, crewCode, crewName, rute, stores);
      results.pipelineTarget.success = true;
      results.pipelineTarget.count = appendedCount;
    } catch (err) {
      results.pipelineTarget.error = err.toString();
    }

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
      message: `Berhasil menginput ${stores.length} toko ke Rute ${rute} untuk ${crewName} (${cleanModule}) [1 Pintu]`,
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

function appendRouteToUnifiedPipeline(moduleName, crewCode, crewName, rute, stores) {
  const ss = SpreadsheetApp.openById(CONFIG.UNIFIED_PIPELINE_ID);
  let sheet = ss.getSheetByName(SHEET_NAMES.TARGET_ROUTE_SHEET) || ss.getSheets()[0];

  const values = sheet.getDataRange().getValues();
  let headers = [];
  if (values.length > 0) {
    headers = values[0].map(h => (h || "").toString().toLowerCase().replace(/[^a-z0-9]/g, ""));
  }

  const modIdx = headers.findIndex(h => h.includes("modul") || h.includes("module"));
  const accIdx = headers.findIndex(h => h.includes("account") || h.includes("tipe") || h.includes("type"));
  const codeIdx = headers.findIndex(h => h.includes("kodetoko") || h.includes("storecode") || h === "code" || h.includes("kode"));
  const nameIdx = headers.findIndex(h => h.includes("namatoko") || h.includes("storename") || h.includes("nama"));
  const crewCodeIdx = headers.findIndex(h => h.includes("kodecrew") || h.includes("crewcode") || h.includes("idcrew"));
  const crewNameIdx = headers.findIndex(h => h.includes("namacrew") || h.includes("crewname") || (h.includes("crew") && !h.includes("kode")));
  const ruteIdx = headers.findIndex(h => h.includes("rute") || h.includes("route"));

  const rowsToAppend = stores.map(store => {
    const account = (store.account || "ALFAMART").toString().trim().toUpperCase();
    const kode = (store.kodeToko || store.kode || "").toString().trim().toUpperCase();
    const nama = (store.namaToko || store.nama || "").toString().trim();
    const cleanRute = rute.toString().trim();
    const cleanCrewCode = (crewCode || "").toString().trim();
    const cleanCrewName = (crewName || "").toString().trim();

    if (headers.length >= 6) {
      const numCols = Math.max(headers.length, 7);
      const row = new Array(numCols).fill("");

      if (modIdx >= 0) row[modIdx] = moduleName;
      if (accIdx >= 0) row[accIdx] = account;
      if (codeIdx >= 0) row[codeIdx] = kode;
      if (nameIdx >= 0) row[nameIdx] = nama;
      if (crewCodeIdx >= 0) row[crewCodeIdx] = cleanCrewCode;
      if (crewNameIdx >= 0) row[crewNameIdx] = cleanCrewName;
      if (ruteIdx >= 0) row[ruteIdx] = cleanRute;

      return row;
    } else {
      return [
        moduleName,
        account,
        kode,
        nama,
        cleanCrewCode,
        cleanCrewName,
        cleanRute
      ];
    }
  });

  const lastRow = sheet.getLastRow();
  const startRow = lastRow + 1;
  const numRows = rowsToAppend.length;
  const numCols = rowsToAppend[0].length;

  sheet.getRange(startRow, 1, numRows, numCols).setValues(rowsToAppend);
  return numRows;
}

function appendRekapToMasterDatabase(rows) {
  const ss = SpreadsheetApp.openById(CONFIG.MASTER_DATABASE_ID);
  const sheetName = "Rekap_Rute";
  let sheet = ss.getSheetByName(sheetName);

  if (!sheet) {
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

function saveOrUpdateMasterStore(store) {
  const ss = SpreadsheetApp.openById(CONFIG.MASTER_DATABASE_ID);
  const sheet = ss.getSheetByName(SHEET_NAMES.MASTER_DATABASE_TOKO) || ss.getSheetByName("master_toko") || ss.getSheetByName("Master_Toko") || ss.getSheets()[0];
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
      existingRowIndex = i + 1;
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
    if (nIdx >= 0 && namaToko) sheet.getRange(existingRowIndex, nIdx + 1).setValue(namaToko);
    if (tIdx >= 0 && account) sheet.getRange(existingRowIndex, tIdx + 1).setValue(account);
    if (dIdx >= 0 && dcName) sheet.getRange(existingRowIndex, dIdx + 1).setValue(dcName);
    if (kIdx >= 0 && kecamatan) sheet.getRange(existingRowIndex, kIdx + 1).setValue(kecamatan);
    if (ktIdx >= 0 && kota) sheet.getRange(existingRowIndex, ktIdx + 1).setValue(kota);
    if (ltIdx >= 0 && lat) sheet.getRange(existingRowIndex, ltIdx + 1).setValue(lat);
    if (lnIdx >= 0 && lon) sheet.getRange(existingRowIndex, lnIdx + 1).setValue(lon);
    return { action: "updated", row: existingRowIndex };
  } else {
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
      existingRowIndex = i + 1;
      break;
    }
  }

  if (existingRowIndex > 0) {
    if (idTarget) sheet.getRange(existingRowIndex, 1).setValue(idTarget);
    sheet.getRange(existingRowIndex, 2).setValue(namaTarget);
    sheet.getRange(existingRowIndex, 8).setValue(modul);
    return { action: "updated", row: existingRowIndex };
  } else {
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

function fetchCrewList() {
  const ss = SpreadsheetApp.openById(CONFIG.MASTER_DATABASE_ID);
  const sheet = ss.getSheets()[0];
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

function fetchModuleSchedule(moduleName, ruteFilter, crewCodeFilter) {
  const cleanModule = (moduleName || "").toUpperCase().replace(/\s+/g, "");

  const ss = SpreadsheetApp.openById(CONFIG.UNIFIED_PIPELINE_ID);
  const sheet = ss.getSheetByName(SHEET_NAMES.TARGET_ROUTE_SHEET) || ss.getSheets()[0];
  const values = sheet.getDataRange().getValues();

  if (values.length < 2) return [];

  const headers = values[0].map(h => (h || "").toString().toLowerCase().replace(/[^a-z0-9]/g, ""));
  const modIdx = headers.findIndex(h => h.includes("modul") || h.includes("module"));
  const accIdx = headers.findIndex(h => h.includes("account") || h.includes("tipe") || h.includes("type"));
  const codeIdx = headers.findIndex(h => h.includes("kodetoko") || h.includes("storecode") || h === "code" || h.includes("kode"));
  const nameIdx = headers.findIndex(h => h.includes("namatoko") || h.includes("storename") || h.includes("nama"));
  const crewCodeIdx = headers.findIndex(h => h.includes("kodecrew") || h.includes("crewcode") || h.includes("idcrew"));
  const crewNameIdx = headers.findIndex(h => h.includes("namacrew") || h.includes("crewname") || (h.includes("crew") && !h.includes("kode")));
  const ruteIdx = headers.findIndex(h => h.includes("rute") || h.includes("route"));

  const cMod = modIdx >= 0 ? modIdx : 0;
  const cAcc = accIdx >= 0 ? accIdx : 1;
  const cCode = codeIdx >= 0 ? codeIdx : 2;
  const cName = nameIdx >= 0 ? nameIdx : 3;
  const cCrewCode = crewCodeIdx >= 0 ? crewCodeIdx : 4;
  const cCrewName = crewNameIdx >= 0 ? crewNameIdx : 5;
  const cRute = ruteIdx >= 0 ? ruteIdx : 6;

  const results = [];
  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    const rowModul = (row[cMod] || "").toString().trim().toUpperCase().replace(/\s+/g, "");
    const account = (row[cAcc] || "").toString().trim();
    const kodeToko = (row[cCode] || "").toString().trim();
    const namaToko = (row[cName] || "").toString().trim();
    const kodeCrew = (row[cCrewCode] || "").toString().trim();
    const namaCrew = (row[cCrewName] || "").toString().trim();
    const rute = (row[cRute] || "").toString().trim().replace(/^rute\s*/i, "");

    if (!kodeToko && !namaToko) continue;

    if (cleanModule && rowModul && rowModul !== cleanModule) {
      continue;
    }

    if (ruteFilter && rute.toString() !== ruteFilter.toString().replace(/^rute\s*/i, "")) {
      continue;
    }

    if (crewCodeFilter && kodeCrew !== crewCodeFilter.toString().trim()) {
      continue;
    }

    results.push({
      modul: rowModul,
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

function jsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function fetchAllClaimedStores(ruteFilter) {
  const visitMap = {};
  const targetRute = ruteFilter ? ruteFilter.toString().trim().replace(/^rute\s*/i, "") : null;

  try {
    const ss = SpreadsheetApp.openById(CONFIG.UNIFIED_PIPELINE_ID);
    const sheet = ss.getSheetByName(SHEET_NAMES.TARGET_ROUTE_SHEET) || ss.getSheets()[0];
    const values = sheet.getDataRange().getValues();

    if (values.length < 2) return visitMap;

    const headers = values[0].map(h => (h || "").toString().toLowerCase().replace(/[^a-z0-9]/g, ""));
    const modIdx = headers.findIndex(h => h.includes("modul") || h.includes("module"));
    const accIdx = headers.findIndex(h => h.includes("account") || h.includes("tipe") || h.includes("type"));
    const codeIdx = headers.findIndex(h => h.includes("kodetoko") || h.includes("storecode") || h === "code" || h.includes("kode"));
    const nameIdx = headers.findIndex(h => h.includes("namatoko") || h.includes("storename") || h.includes("nama"));
    const crewCodeIdx = headers.findIndex(h => h.includes("kodecrew") || h.includes("crewcode") || h.includes("idcrew"));
    const crewNameIdx = headers.findIndex(h => h.includes("namacrew") || h.includes("crewname") || (h.includes("crew") && !h.includes("kode")));
    const ruteIdx = headers.findIndex(h => h.includes("rute") || h.includes("route"));

    const cMod = modIdx >= 0 ? modIdx : 0;
    const cAcc = accIdx >= 0 ? accIdx : 1;
    const cCode = codeIdx >= 0 ? codeIdx : 2;
    const cName = nameIdx >= 0 ? nameIdx : 3;
    const cCrewCode = crewCodeIdx >= 0 ? crewCodeIdx : 4;
    const cCrewName = crewNameIdx >= 0 ? crewNameIdx : 5;
    const cRute = ruteIdx >= 0 ? ruteIdx : 6;

    for (let i = 1; i < values.length; i++) {
      const row = values[i];
      const kodeToko = (row[cCode] || "").toString().trim().toUpperCase();
      if (!kodeToko) continue;

      const rute = (row[cRute] || "").toString().trim().replace(/^rute\s*/i, "");
      if (targetRute && rute !== targetRute) continue;

      const modul = (row[cMod] || "").toString().trim();
      const account = (row[cAcc] || "").toString().trim();
      const namaToko = (row[cName] || "").toString().trim();
      const kodeCrew = (row[cCrewCode] || "").toString().trim();
      const namaCrew = (row[cCrewName] || "").toString().trim();

      if (!visitMap[kodeToko]) visitMap[kodeToko] = [];

      visitMap[kodeToko].push({
        kodeToko: kodeToko,
        namaToko: namaToko,
        account: account,
        kodeCrew: kodeCrew,
        namaCrew: namaCrew,
        modul: modul,
        rute: rute
      });
    }
  } catch (err) {
    Logger.log("Error reading claimed stores from unified pipeline: " + err.toString());
  }

  return visitMap;
}

function deleteStoreFromAllSpreadsheets(moduleName, rute, crewCode, kodeToko) {
  if (!kodeToko) {
    throw new Error("Parameter kodeToko wajib diisi");
  }

  const cleanModule = moduleName ? moduleName.toUpperCase().replace(/\s+/g, "") : "";
  const targetRute = rute ? rute.toString().trim().replace(/^rute\s*/i, "") : "";
  const targetKode = kodeToko.toString().trim().toUpperCase();
  const targetCrew = crewCode ? crewCode.toString().trim() : "";

  const results = {};

  try {
    const ss = SpreadsheetApp.openById(CONFIG.UNIFIED_PIPELINE_ID);
    const sheet = ss.getSheetByName(SHEET_NAMES.TARGET_ROUTE_SHEET) || ss.getSheets()[0];
    const values = sheet.getDataRange().getValues();

    const headers = values[0].map(h => (h || "").toString().toLowerCase().replace(/[^a-z0-9]/g, ""));
    const modIdx = headers.findIndex(h => h.includes("modul") || h.includes("module"));
    const codeIdx = headers.findIndex(h => h.includes("kodetoko") || h.includes("storecode") || h === "code" || h.includes("kode"));
    const crewCodeIdx = headers.findIndex(h => h.includes("kodecrew") || h.includes("crewcode") || h.includes("idcrew"));
    const ruteIdx = headers.findIndex(h => h.includes("rute") || h.includes("route"));

    const cMod = modIdx >= 0 ? modIdx : 0;
    const cCode = codeIdx >= 0 ? codeIdx : 2;
    const cCrewCode = crewCodeIdx >= 0 ? crewCodeIdx : 4;
    const cRute = ruteIdx >= 0 ? ruteIdx : 6;

    for (let i = values.length - 1; i >= 1; i--) {
      const row = values[i];
      const rowKode = (row[cCode] || "").toString().trim().toUpperCase();
      const rowRute = (row[cRute] || "").toString().trim().replace(/^rute\s*/i, "");
      const rowCrew = (row[cCrewCode] || "").toString().trim();
      const rowMod = (row[cMod] || "").toString().trim().toUpperCase().replace(/\s+/g, "");

      const matchKode = rowKode === targetKode;
      const matchRute = !targetRute || rowRute === targetRute;
      const matchCrew = !targetCrew || rowCrew === targetCrew;
      const matchMod = !cleanModule || rowMod === cleanModule;

      if (matchKode && matchRute && matchCrew && matchMod) {
        sheet.deleteRow(i + 1);
      }
    }
    results.pipeline = true;
  } catch (e) {
    results.pipeline = e.toString();
  }

  try {
    const ssMaster = SpreadsheetApp.openById(CONFIG.MASTER_DATABASE_ID);
    const rekapSheet = ssMaster.getSheetByName("Rekap_Rute");
    if (rekapSheet) {
      const values = rekapSheet.getDataRange().getValues();
      for (let i = values.length - 1; i >= 1; i--) {
        const row = values[i];
        const rowKode = (row[1] || "").toString().trim().toUpperCase();
        const rowCrew = (row[3] || "").toString().trim();
        const rowRute = (row[5] || "").toString().trim().replace(/^rute\s*/i, "");

        if (rowKode === targetKode && (!targetRute || rowRute === targetRute) && (!targetCrew || rowCrew === targetCrew)) {
          rekapSheet.deleteRow(i + 1);
        }
      }
      results.rekap = true;
    }
  } catch (e) {
    results.rekap = e.toString();
  }

  return results;
}

function fetchMdsInputStatus(ruteFilter) {
  const targetRute = (ruteFilter || new Date().getDate()).toString().trim().replace(/^rute\s*/i, "");
  
  const allCrews = fetchCrewList().filter(c => {
    const id = (c.id || "").toString().trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
    const nama = (c.nama || "").toLowerCase();
    const jabatan = (c.jabatan || "").toLowerCase();
    if (id === "RO036" || nama.includes("yohandi") || (jabatan.includes("admin") && !jabatan.includes("merchandiser"))) {
      return false;
    }
    return true;
  });

  const validCrewIdSet = new Set(allCrews.map(c => c.id.toString().trim().toUpperCase()));
  const validCrewNameMap = new Map();
  allCrews.forEach(c => {
    if (c.nama) validCrewNameMap.set(c.nama.toString().trim().toLowerCase(), c);
  });

  const submissionMap = {};
  const seenStoreVisitSet = new Set();

  try {
    const ss = SpreadsheetApp.openById(CONFIG.UNIFIED_PIPELINE_ID);
    const sheet = ss.getSheetByName(SHEET_NAMES.TARGET_ROUTE_SHEET) || ss.getSheets()[0];
    const values = sheet.getDataRange().getValues();

    if (values.length >= 2) {
      const headers = values[0].map(h => (h || "").toString().toLowerCase().replace(/[^a-z0-9]/g, ""));
      const modIdx = headers.findIndex(h => h.includes("modul") || h.includes("module"));
      const codeIdx = headers.findIndex(h => h.includes("kodetoko") || h.includes("storecode") || h === "code" || h.includes("kode"));
      const nameIdx = headers.findIndex(h => h.includes("namatoko") || h.includes("storename") || h.includes("nama"));
      const crewCodeIdx = headers.findIndex(h => h.includes("kodecrew") || h.includes("crewcode") || h.includes("idcrew"));
      const crewNameIdx = headers.findIndex(h => h.includes("namacrew") || h.includes("crewname") || (h.includes("crew") && !h.includes("kode")));
      const ruteIdx = headers.findIndex(h => h.includes("rute") || h.includes("route"));

      const cMod = modIdx >= 0 ? modIdx : 0;
      const cCode = codeIdx >= 0 ? codeIdx : 2;
      const cName = nameIdx >= 0 ? nameIdx : 3;
      const cCrewCode = crewCodeIdx >= 0 ? crewCodeIdx : 4;
      const cCrewName = crewNameIdx >= 0 ? crewNameIdx : 5;
      const cRute = ruteIdx >= 0 ? ruteIdx : 6;

      for (let i = 1; i < values.length; i++) {
        const row = values[i];
        const rute = (row[cRute] || "").toString().trim().replace(/^rute\s*/i, "");
        if (rute !== targetRute) continue;

        const kodeCrew = (row[cCrewCode] || "").toString().trim().toUpperCase();
        const namaCrew = (row[cCrewName] || "").toString().trim();
        const kodeToko = (row[cCode] || "").toString().trim().toUpperCase();
        const namaToko = (row[cName] || "").toString().trim();
        const modul = (row[cMod] || "").toString().trim();

        if (kodeCrew === "RO036" || namaCrew.toLowerCase().includes("yohandi")) continue;
        if (!kodeToko) continue;

        let matchedCrew = null;
        if (validCrewIdSet.has(kodeCrew)) {
          matchedCrew = allCrews.find(c => c.id.toString().trim().toUpperCase() === kodeCrew);
        } else if (validCrewNameMap.has(namaCrew.toLowerCase())) {
          matchedCrew = validCrewNameMap.get(namaCrew.toLowerCase());
        }

        const crewKey = matchedCrew ? matchedCrew.id : (kodeCrew || namaCrew.toLowerCase());
        if (!crewKey) continue;

        const visitKey = `${kodeToko}_${rute}_${crewKey}`;
        if (seenStoreVisitSet.has(visitKey)) continue;
        seenStoreVisitSet.add(visitKey);

        if (!submissionMap[crewKey]) {
          submissionMap[crewKey] = {
            kodeCrew: matchedCrew ? matchedCrew.id : kodeCrew,
            namaCrew: matchedCrew ? matchedCrew.nama : namaCrew,
            modul: matchedCrew ? matchedCrew.modul : modul,
            storeCount: 0,
            stores: []
          };
        }

        submissionMap[crewKey].storeCount += 1;
        submissionMap[crewKey].stores.push({ kodeToko, namaToko });
      }
    }
  } catch (err) {
    Logger.log("Error reading monitoring from Unified Pipeline: " + err.toString());
  }

  const submitted = [];
  const pending = [];

  allCrews.forEach(crew => {
    const keyById = crew.id ? crew.id : "";
    const keyByName = crew.nama ? crew.nama.toLowerCase() : "";

    const sub = (keyById && submissionMap[keyById]) || (keyByName && submissionMap[keyByName]);

    if (sub && sub.storeCount > 0) {
      submitted.push({
        id: crew.id,
        nama: crew.nama,
        modul: crew.modul || sub.modul,
        account: crew.account || "",
        storeCount: sub.storeCount,
        stores: sub.stores
      });
    } else {
      pending.push({
        id: crew.id,
        nama: crew.nama,
        modul: crew.modul || "",
        account: crew.account || ""
      });
    }
  });

  submitted.sort((a, b) => (a.modul + a.nama).localeCompare(b.modul + b.nama));
  pending.sort((a, b) => (a.modul + a.nama).localeCompare(b.modul + b.nama));

  const totalCrew = allCrews.length;
  const submittedCount = submitted.length;
  const pendingCount = pending.length;
  const percentage = totalCrew > 0 ? Math.round((submittedCount / totalCrew) * 100) : 0;

  return {
    rute: targetRute,
    totalCrew: totalCrew,
    submittedCount: submittedCount,
    pendingCount: pendingCount,
    percentage: percentage,
    submitted: submitted,
    pending: pending
  };
}

function testMonitoringMds() {
  const targetRute = "3";
  const result = fetchMdsInputStatus(targetRute);
  Logger.log(JSON.stringify(result, null, 2));
}

function syncAllModuleInputsToRekap() {
  const allCrews = fetchCrewList().filter(c => {
    const id = (c.id || "").toString().trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
    const nama = (c.nama || "").toLowerCase();
    if (id === "RO036" || nama.includes("yohandi")) return false;
    return true;
  });

  const validCrewIdSet = new Set(allCrews.map(c => c.id.toString().trim().toUpperCase()));
  const validCrewNameMap = new Map();
  allCrews.forEach(c => {
    if (c.nama) validCrewNameMap.set(c.nama.toString().trim().toLowerCase(), c);
  });

  const ssMaster = SpreadsheetApp.openById(CONFIG.MASTER_DATABASE_ID);
  const sheetName = "Rekap_Rute";
  let sheetRekap = ssMaster.getSheetByName(sheetName);

  if (!sheetRekap) {
    sheetRekap = ssMaster.insertSheet(sheetName);
    const headers = [
      ["ACCOUNT", "KODE TOKO", "NAMA TOKO", "KODE CREW", "NAMA CREW", "RUTE", "MODUL", "STATUS KUNJUNGAN", "ALASAN RE-VISIT", "WAKTU INPUT"]
    ];
    sheetRekap.getRange(1, 1, 1, headers[0].length).setValues(headers);
    sheetRekap.getRange(1, 1, 1, headers[0].length)
      .setFontWeight("bold")
      .setBackground("#4f46e5")
      .setFontColor("#ffffff");
  }

  const existingValues = sheetRekap.getDataRange().getValues();
  const existingKeys = new Set();
  for (let i = 1; i < existingValues.length; i++) {
    const row = existingValues[i];
    const kode = (row[1] || "").toString().trim().toUpperCase();
    const rute = (row[5] || "").toString().trim().replace(/^rute\s*/i, "");
    const crew = (row[3] || row[4] || "").toString().trim().toUpperCase();
    if (kode && rute && crew) {
      existingKeys.add(`${kode}_${rute}_${crew}`);
    }
  }

  const rowsToInsert = [];
  const nowFormatted = Utilities.formatDate(new Date(), "Asia/Jakarta", "yyyy-MM-dd HH:mm:ss");

  try {
    const ssMod = SpreadsheetApp.openById(CONFIG.UNIFIED_PIPELINE_ID);
    const sheetMod = ssMod.getSheetByName(SHEET_NAMES.TARGET_ROUTE_SHEET) || ssMod.getSheets()[0];
    const values = sheetMod.getDataRange().getValues();

    if (values.length >= 2) {
      const headers = values[0].map(h => (h || "").toString().toLowerCase().replace(/[^a-z0-9]/g, ""));
      const modIdx = headers.findIndex(h => h.includes("modul") || h.includes("module"));
      const accIdx = headers.findIndex(h => h.includes("account") || h.includes("tipe") || h.includes("type"));
      const codeIdx = headers.findIndex(h => h.includes("kodetoko") || h.includes("storecode") || h === "code" || h.includes("kode"));
      const nameIdx = headers.findIndex(h => h.includes("namatoko") || h.includes("storename") || h.includes("nama"));
      const crewCodeIdx = headers.findIndex(h => h.includes("kodecrew") || h.includes("crewcode") || h.includes("idcrew"));
      const crewNameIdx = headers.findIndex(h => h.includes("namacrew") || h.includes("crewname") || (h.includes("crew") && !h.includes("kode")));
      const ruteIdx = headers.findIndex(h => h.includes("rute") || h.includes("route"));

      const cMod = modIdx >= 0 ? modIdx : 0;
      const cAcc = accIdx >= 0 ? accIdx : 1;
      const cCode = codeIdx >= 0 ? codeIdx : 2;
      const cName = nameIdx >= 0 ? nameIdx : 3;
      const cCrewCode = crewCodeIdx >= 0 ? crewCodeIdx : 4;
      const cCrewName = crewNameIdx >= 0 ? crewNameIdx : 5;
      const cRute = ruteIdx >= 0 ? ruteIdx : 6;

      for (let i = 1; i < values.length; i++) {
        const row = values[i];
        const rowModul = (row[cMod] || "").toString().trim().toUpperCase().replace(/\s+/g, "");
        const account = (row[cAcc] || "ALFAMART").toString().trim().toUpperCase();
        const kodeToko = (row[cCode] || "").toString().trim().toUpperCase();
        const namaToko = (row[cName] || "").toString().trim();
        const kodeCrew = (row[cCrewCode] || "").toString().trim().toUpperCase();
        const namaCrew = (row[cCrewName] || "").toString().trim();
        const rute = (row[cRute] || "").toString().trim().replace(/^rute\s*/i, "");

        if (!kodeToko || !rute) continue;
        if (kodeCrew === "RO036" || namaCrew.toLowerCase().includes("yohandi")) continue;

        let matchedCrew = null;
        if (validCrewIdSet.has(kodeCrew)) {
          matchedCrew = allCrews.find(c => c.id.toString().trim().toUpperCase() === kodeCrew);
        } else if (validCrewNameMap.has(namaCrew.toLowerCase())) {
          matchedCrew = validCrewNameMap.get(namaCrew.toLowerCase());
        }

        const finalCrewId = matchedCrew ? matchedCrew.id : kodeCrew;
        const finalCrewName = matchedCrew ? matchedCrew.nama : namaCrew;
        const finalModul = matchedCrew ? matchedCrew.modul : rowModul;

        const key = `${kodeToko}_${rute}_${finalCrewId}`;
        if (existingKeys.has(key)) continue;

        existingKeys.add(key);
        rowsToInsert.push([
          account,
          kodeToko,
          namaToko,
          finalCrewId,
          finalCrewName,
          rute,
          finalModul,
          "Kunjungan Pertama",
          "-",
          nowFormatted
        ]);
      }
    }
  } catch (err) {
    Logger.log("Error reading Unified Pipeline: " + err.toString());
  }

  if (rowsToInsert.length > 0) {
    const lastRow = sheetRekap.getLastRow();
    sheetRekap.getRange(lastRow + 1, 1, rowsToInsert.length, rowsToInsert[0].length).setValues(rowsToInsert);
  }
}

function cleanAndResyncRekapRute() {
  const ssMaster = SpreadsheetApp.openById(CONFIG.MASTER_DATABASE_ID);
  const sheetRekap = ssMaster.getSheetByName("Rekap_Rute");
  
  if (sheetRekap && sheetRekap.getLastRow() > 1) {
    sheetRekap.deleteRows(2, sheetRekap.getLastRow() - 1);
  }
  
  syncAllModuleInputsToRekap();
}
