/**
 * MAIN APP CONTROLLER - LEAFLET GIS MAP & MDS ROUTE MASTER
 */

// Application State
const state = {
  profile: {
    nama: "Yohandi Pratama",
    kodeCrew: "RO036",
    modul: "LP4",
    account: "ALFAMART"
  },
  currentRute: new Date().getDate(), // Default ke tanggal hari ini (1-31)
  currentView: "input", // "input" | "schedule"
  selectedStores: new Map(), // Key: kodeToko, Value: Store Object
  searchResults: [],
  scheduleStores: [],
  claimedStores: {}, // { [kodeToko]: { namaCrew, kodeCrew, modul, rute } }
  accountFilter: "ALL",
  isSyncing: false,
  userLocation: null
};

// Map & Layer State
let map = null;
let markerClusterGroup = null;
let selectedRouteMarkersLayer = null;
let routePolyline = null;
let userLocationMarker = null;

// DOM Elements Cache
const elements = {};

document.addEventListener("DOMContentLoaded", async () => {
  cacheDOMElements();
  if (window.lucide) lucide.createIcons();
  initTheme();
  setupRuteDatePicker();
  loadSavedProfile();
  initMap();
  bindEvents();
  initPwaInstall();

  await checkDatabaseStatus();
});

/**
 * Cache DOM elements
 */
function cacheDOMElements() {
  elements.userName = document.getElementById("userName");
  elements.userModule = document.getElementById("userModule");
  elements.userAvatar = document.getElementById("userAvatar");

  elements.ruteDatePicker = document.getElementById("ruteDatePicker");
  elements.routeDateDisplay = document.getElementById("routeDateDisplay");
  elements.searchInput = document.getElementById("searchInput");
  elements.btnSearchSubmit = document.getElementById("btnSearchSubmit");
  elements.searchClear = document.getElementById("searchClear");
  elements.searchResultsFloating = document.getElementById("searchResultsFloating");
  elements.filterPills = document.querySelectorAll(".filter-pill");

  elements.floatingBar = document.getElementById("floatingBar");
  elements.summaryCount = document.getElementById("summaryCount");
  elements.summaryRoute = document.getElementById("summaryRoute");
  elements.btnViewDrawer = document.getElementById("btnViewDrawer");
  elements.btnSubmitRoute = document.getElementById("btnSubmitRoute");

  // Modals & Loaders
  elements.blockingLoader = document.getElementById("blockingLoader");
  elements.loaderTitle = document.getElementById("loaderTitle");
  elements.loaderSubtitle = document.getElementById("loaderSubtitle");
  elements.loaderProgressTrack = document.getElementById("loaderProgressTrack");
  elements.loaderProgressBar = document.getElementById("loaderProgressBar");

  elements.profileModal = document.getElementById("profileModal");
  elements.drawerModal = document.getElementById("drawerModal");
  elements.settingsModal = document.getElementById("settingsModal");
  elements.historyModal = document.getElementById("historyModal");
  elements.helpModal = document.getElementById("helpModal");
  elements.toastContainer = document.getElementById("toastContainer");

  // Help & Spotlight Tour
  elements.btnOpenHelpTour = document.getElementById("btnOpenHelpTour");
  elements.btnStartInteractiveTour = document.getElementById("btnStartInteractiveTour");
  elements.tourOverlay = document.getElementById("tourOverlay");
  elements.tourSpotlight = document.getElementById("tourSpotlight");
  elements.tourTooltip = document.getElementById("tourTooltip");
  elements.tourStepBadge = document.getElementById("tourStepBadge");
  elements.tourTitle = document.getElementById("tourTitle");
  elements.tourDesc = document.getElementById("tourDesc");
  elements.tourTipBox = document.getElementById("tourTipBox");
  elements.tourTipText = document.getElementById("tourTipText");
  elements.tourBtnClose = document.getElementById("tourBtnClose");
  elements.tourBtnSkip = document.getElementById("tourBtnSkip");
  elements.tourBtnPrev = document.getElementById("tourBtnPrev");
  elements.tourBtnNext = document.getElementById("tourBtnNext");
}

/**
 * Inisialisasi Peta Leaflet (OpenStreetMap Tiles)
 */
function initMap() {
  map = L.map("map", {
    zoomControl: false,
    attributionControl: false
  }).setView([-6.2088, 106.8456], 12);

  // Official Standard OpenStreetMap (100% Free, Bersih tanpa Watermark)
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
  }).addTo(map);

  // Layer khusus untuk Pin Toko Terpilih yang Bernomor Urut (Selalu di atas cluster)
  selectedRouteMarkersLayer = L.layerGroup().addTo(map);

  // Inisialisasi Marker Cluster Group untuk Toko Umum
  markerClusterGroup = L.markerClusterGroup({
    showCoverageOnHover: false,
    maxClusterRadius: 45,
    spiderfyOnMaxZoom: true,
    disableClusteringAtZoom: 16
  });
  map.addLayer(markerClusterGroup);

  // Map Click to close floating results
  map.on("click", () => {
    if (elements.searchResultsFloating) {
      elements.searchResultsFloating.style.display = "none";
    }
  });

  // Try GPS Geolocation on start
  if ("geolocation" in navigator) {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        state.userLocation = [latitude, longitude];
        map.setView([latitude, longitude], 14);
        addUserLocationMarker(latitude, longitude);
      },
      (err) => console.log("GPS Init fallback to default view:", err.message),
      { enableHighAccuracy: true, timeout: 8000 }
    );
  }
}

/**
 * Menambahkan Marker Posisi Pengguna (GPS)
 */
function addUserLocationMarker(lat, lon) {
  if (userLocationMarker) {
    map.removeLayer(userLocationMarker);
  }

  const gpsIcon = L.divIcon({
    className: "gps-marker-custom",
    html: `<div style="width: 18px; height: 18px; background: #3b82f6; border: 3px solid white; border-radius: 50%; box-shadow: 0 0 0 6px rgba(59, 130, 246, 0.35);"></div>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9]
  });

  userLocationMarker = L.marker([lat, lon], { icon: gpsIcon }).addTo(map);
  userLocationMarker.bindTooltip("Posisi Anda", { permanent: false, direction: "top" });
}

// Helper Composite Key Toko & Cek Seleksi (Mencegah bentrok kode sama beda ritel)
function getStoreKey(storeOrCode, maybeAccount = "") {
  if (!storeOrCode) return "";
  if (typeof storeOrCode === "object") {
    const code = (storeOrCode.kodeToko || "").toString().trim().toUpperCase();
    const acc = (storeOrCode.account || "").toString().trim().toUpperCase();
    return acc ? `${code}_${acc}` : code;
  }
  const code = storeOrCode.toString().trim().toUpperCase();
  const acc = (maybeAccount || "").toString().trim().toUpperCase();
  return acc ? `${code}_${acc}` : code;
}

function isStoreSelected(kodeToko, account = "") {
  const key = getStoreKey(kodeToko, account);
  if (state.selectedStores.has(key)) return true;
  if (!account && state.selectedStores.has(kodeToko)) return true;
  for (const [k, v] of state.selectedStores.entries()) {
    if (v.kodeToko === kodeToko && (!account || (v.account || "").toUpperCase() === account.toUpperCase())) {
      return true;
    }
  }
  return false;
}

/**
 * Render marker toko di peta menggunakan Leaflet MarkerCluster
 */
function renderMapMarkers(stores, autoFit = false) {
  if (!map || !markerClusterGroup) return;
  markerClusterGroup.clearLayers();

  const validStores = stores.filter(s => s.lat && s.lon && !isNaN(s.lat) && !isNaN(s.lon));
  if (validStores.length === 0) return;

  const latLngs = [];

  validStores.forEach(store => {
    // Jika toko sudah terpilih, pin bernomor urutnya dirender di selectedRouteMarkersLayer
    if (isStoreSelected(store.kodeToko, store.account)) return;

    const brandClass = getBrandClass(store.account);
    const initial = (store.account || "T").charAt(0).toUpperCase();

    const customIcon = L.divIcon({
      className: "custom-pin-container",
      html: `<div class="custom-pin pin-${brandClass}" data-kode="${escapeHtml(store.kodeToko)}">${initial}</div>`,
      iconSize: [32, 32],
      iconAnchor: [16, 16],
      popupAnchor: [0, -18]
    });

    const marker = L.marker([store.lat, store.lon], { icon: customIcon });

    // Popup Detail Toko — gunakan getStoreVisitStatus untuk info lengkap
    const visitStatus = getStoreVisitStatus(store.kodeToko, store.account);
    const { isLockedByOther, lockedBy, isRevisitTooSoon, isRevisitAllowed, lastSelfVisit, daysSinceLastVisit } = visitStatus;

    let popupContent;
    if (isLockedByOther) {
      popupContent = `
        <div class="popup-container">
          <div class="store-badges">
            <span class="badge-code">${escapeHtml(store.kodeToko)}</span>
            <span class="badge-brand ${brandClass}">${escapeHtml(store.account || 'TOKO')}</span>
            <span style="font-size:9px; background: var(--danger); color:white; padding: 1px 5px; border-radius: 99px; font-weight:700;">🔒 TERKUNCI</span>
          </div>
          <div class="popup-title">${escapeHtml(store.namaToko)}</div>
          <div class="popup-meta" style="color: var(--danger); font-weight: 600;">
            Dikover oleh: ${escapeHtml(lockedBy.namaCrew)}<br>
            Modul: ${escapeHtml(lockedBy.modul)} – Rute ${escapeHtml(lockedBy.rute)}
          </div>
          <button type="button" class="btn-popup-toggle" style="opacity:0.5; cursor:not-allowed;" onclick="event.preventDefault()">
            <i data-lucide="lock"></i>
            <span>Toko Sudah Dikunci</span>
          </button>
        </div>
      `;
    } else if (isRevisitTooSoon) {
      popupContent = `
        <div class="popup-container">
          <div class="store-badges">
            <span class="badge-code">${escapeHtml(store.kodeToko)}</span>
            <span class="badge-brand ${brandClass}">${escapeHtml(store.account || 'TOKO')}</span>
            <span style="font-size:9px; background: var(--warning); color:white; padding: 1px 5px; border-radius: 99px; font-weight:700;">⚠️ RE-VISIT</span>
          </div>
          <div class="popup-title">${escapeHtml(store.namaToko)}</div>
          <div class="popup-meta" style="color: var(--warning); font-weight: 600;">
            Kunjungan terakhir: Rute ${escapeHtml(lastSelfVisit.rute)} (${daysSinceLastVisit} hari lalu)<br>
            Re-visit minimal 14 hari. Tetap bisa dipilih dengan konfirmasi.
          </div>
          <div style="display: flex; gap: 4px; margin-top: 4px;">
            <button type="button" class="btn-popup-toggle" style="flex:1; background: #f59e0b; color: #ffffff; font-weight: 700; border-color: #f59e0b; box-shadow: 0 2px 6px rgba(245, 158, 11, 0.4);" onclick="toggleStoreSelection('${escapeHtml(store.kodeToko)}', '${escapeHtml(store.account || '')}')">
              <i data-lucide="plus-circle"></i>
              <span>+ Pilih Re-Visit Toko</span>
            </button>
            <button type="button" class="btn-popup-toggle" style="width: 34px; background: var(--bg-main); color: var(--text-main); border: 1px solid var(--border);" onclick="editStoreByCode('${escapeHtml(store.kodeToko)}', '${escapeHtml(store.account || '')}')">
              <i data-lucide="edit-3"></i>
            </button>
          </div>
        </div>
      `;
    } else {
      const revisitInfoHtml = isRevisitAllowed
        ? `<div style="font-size:10px; color: var(--text-muted); margin-bottom: 4px;">✅ Re-visit OK (${daysSinceLastVisit} hari sejak Rute ${escapeHtml(lastSelfVisit.rute)})</div>`
        : "";
      popupContent = `
        <div class="popup-container">
          <div class="store-badges">
            <span class="badge-code">${escapeHtml(store.kodeToko)}</span>
            <span class="badge-brand ${brandClass}">${escapeHtml(store.account || 'TOKO')}</span>
          </div>
          <div class="popup-title">${escapeHtml(store.namaToko)}</div>
          <div class="popup-meta">
            <i data-lucide="map-pin" style="width: 11px; height: 11px; display: inline;"></i>
            ${escapeHtml(store.kecamatan || store.kota || 'Area Toko')}${store.provinsi ? ' • ' + escapeHtml(store.provinsi) : ''}
            ${store.crew ? `<div style="font-size:10px; color: var(--text-muted); margin-top:2px;"><i data-lucide="user" style="width: 11px; height: 11px; display: inline;"></i> Crew: ${escapeHtml(store.crew)}</div>` : ''}
          </div>
          ${revisitInfoHtml}
          <div style="display: flex; gap: 4px; margin-top: 2px;">
            <button type="button" class="btn-popup-toggle" style="flex: 1;" onclick="toggleStoreSelection('${escapeHtml(store.kodeToko)}', '${escapeHtml(store.account || '')}')">
              <i data-lucide="plus"></i>
              <span>Tambah Rute</span>
            </button>
            <button type="button" class="btn-popup-toggle" style="width: 34px; background: var(--bg-main); color: var(--text-main); border: 1px solid var(--border);" onclick="editStoreByCode('${escapeHtml(store.kodeToko)}', '${escapeHtml(store.account || '')}')">
              <i data-lucide="edit-3"></i>
            </button>
          </div>
        </div>
      `;
    }

    marker.bindPopup(popupContent);
    marker.on("popupopen", () => {
      if (window.lucide) lucide.createIcons();
    });

    markerClusterGroup.addLayer(marker);
    latLngs.push([store.lat, store.lon]);
  });

  if (autoFit && latLngs.length > 0) {
    const bounds = L.latLngBounds(latLngs);
    map.fitBounds(bounds, { padding: [80, 80], maxZoom: 15 });
  }

  // Render juga pin bernomor urut dan polyline untuk toko-toko yang terpilih
  renderSelectedRouteMarkersAndPolyline(Array.from(state.selectedStores.values()));
}

/**
 * Render Pin Toko Terpilih dengan NOMOR URUT (1, 2, 3...) & Garis Jalur Polyline
 */
function renderSelectedRouteMarkersAndPolyline(stores) {
  if (!selectedRouteMarkersLayer) return;
  selectedRouteMarkersLayer.clearLayers();

  if (routePolyline) {
    map.removeLayer(routePolyline);
    routePolyline = null;
  }

  const validStores = stores.filter(s => s.lat && s.lon && !isNaN(s.lat) && !isNaN(s.lon));
  if (validStores.length === 0) return;

  const validPoints = [];

  validStores.forEach((store, idx) => {
    const orderNumber = idx + 1;
    const brandClass = getBrandClass(store.account);

    // Custom Icon dengan Nomor Urut
    const numberedIcon = L.divIcon({
      className: "custom-pin-container",
      html: `
        <div class="custom-pin pin-${brandClass} selected-numbered-pin" data-kode="${escapeHtml(store.kodeToko)}" title="Urutan #${orderNumber}: ${escapeHtml(store.namaToko)}">
          <span class="pin-order-badge">${orderNumber}</span>
        </div>
      `,
      iconSize: [36, 36],
      iconAnchor: [18, 18],
      popupAnchor: [0, -20]
    });

    const marker = L.marker([store.lat, store.lon], {
      icon: numberedIcon,
      zIndexOffset: 1000 + orderNumber
    });

    // Popup Toko Terpilih (Membedakan Mode Input vs Mode Jadwal Terinput)
    const isScheduleMode = state.currentView === "schedule";
    const statusLabel = isScheduleMode ? `TERDAFTAR` : `DRAFT`;
    const toggleActionHtml = isScheduleMode
      ? `
        <button type="button" class="btn-popup-toggle remove" style="flex: 1;" onclick="confirmDeleteStoreFromSchedule('${escapeHtml(store.kodeToko)}', '${escapeHtml(store.namaToko)}')">
          <i data-lucide="minus-circle"></i>
          <span>Hapus dari Jadwal Rute</span>
        </button>
      `
      : `
        <button type="button" class="btn-popup-toggle remove" style="flex: 1;" onclick="toggleStoreSelection('${escapeHtml(store.kodeToko)}', '${escapeHtml(store.account || '')}')">
          <i data-lucide="minus-circle"></i>
          <span>Keluarkan dari Rute</span>
        </button>
      `;

    const popupContent = `
      <div class="popup-container">
        <div class="store-badges">
          <span class="schedule-badge-live">#${orderNumber} RUTE ${state.currentRute} (${statusLabel})</span>
          <span class="badge-brand ${brandClass}">${escapeHtml(store.account || 'TOKO')}</span>
        </div>
        <div class="popup-title">${escapeHtml(store.namaToko)}</div>
        <div class="popup-meta">
          Kode: <strong>${escapeHtml(store.kodeToko)}</strong> &bull; ${escapeHtml(store.kecamatan || store.kota || '')}
        </div>
        <div style="display: flex; gap: 4px; margin-top: 2px;">
          ${toggleActionHtml}
          <button type="button" class="btn-popup-toggle" style="width: 34px; background: var(--bg-main); color: var(--text-main); border: 1px solid var(--border);" onclick="editStoreByCode('${escapeHtml(store.kodeToko)}', '${escapeHtml(store.account || '')}')" title="Edit Data Toko">
            <i data-lucide="edit-3"></i>
          </button>
        </div>
      </div>
    `;

    marker.bindPopup(popupContent);
    marker.on("popupopen", () => {
      if (window.lucide) lucide.createIcons();
    });

    selectedRouteMarkersLayer.addLayer(marker);
    validPoints.push([store.lat, store.lon]);
  });

  // Gambar Garis Jalur Rute (Polyline)
  if (validPoints.length > 1) {
    routePolyline = L.polyline(validPoints, {
      color: "#4f46e5",
      weight: 5,
      opacity: 0.9,
      dashArray: "10, 8",
      lineJoin: "round"
    }).addTo(map);
  }
}

function getBrandClass(account) {
  const acc = (account || "").toLowerCase();
  if (acc.includes("indomaret")) return "indomaret";
  if (acc.includes("alfamidi")) return "alfamidi";
  if (acc.includes("alfamart")) return "alfamart";
  if (acc.includes("lawson")) return "lawson";
  return "other";
}

/**
 * Controller Fullscreen Blocking Loader Overlay
 */
function showBlockingLoader(title, subtitle, showProgress = false) {
  const loader = elements.blockingLoader;
  if (!loader) return;

  if (elements.loaderTitle) elements.loaderTitle.textContent = title;
  if (elements.loaderSubtitle) elements.loaderSubtitle.textContent = subtitle;

  if (elements.loaderProgressTrack) {
    elements.loaderProgressTrack.style.display = showProgress ? "block" : "none";
  }
  if (elements.loaderProgressBar) {
    elements.loaderProgressBar.style.width = "10%";
  }

  loader.classList.add("active");
}

function updateBlockingLoaderProgress(percent, subtitle) {
  if (elements.loaderProgressBar) {
    elements.loaderProgressBar.style.width = `${percent}%`;
  }
  if (subtitle && elements.loaderSubtitle) {
    elements.loaderSubtitle.textContent = subtitle;
  }
}

function hideBlockingLoader() {
  const loader = elements.blockingLoader;
  if (loader) loader.classList.remove("active");
}

/**
 * Inisialisasi Tema
 */
function initTheme() {
  const savedTheme = localStorage.getItem("mds_theme") || "light";
  document.documentElement.setAttribute("data-theme", savedTheme);
  const themeIcon = document.getElementById("themeIcon");
  const themeLabel = document.getElementById("themeLabelText");
  if (themeIcon) {
    themeIcon.setAttribute("data-lucide", savedTheme === "dark" ? "sun" : "moon");
  }
  if (themeLabel) {
    themeLabel.textContent = savedTheme === "dark" ? "Mode Terang (Light)" : "Mode Gelap (Dark)";
  }
  if (window.lucide) lucide.createIcons();
}

function toggleTheme() {
  const current = document.documentElement.getAttribute("data-theme") || "light";
  const next = current === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  localStorage.setItem("mds_theme", next);
  initTheme();
}

/**
 * Setup DatePicker Rute (Memilih Tanggal dengan Kalender, Output Tetap Angka 1-31 untuk AppSheet & GAS)
 */
function setupRuteDatePicker() {
  const dateInput = document.getElementById("ruteDatePicker");
  if (!dateInput) return;

  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const todayIso = `${year}-${month}-${day}`;

  dateInput.value = todayIso;
  state.currentRute = now.getDate(); // Angka hari (1 - 31)
  updateRouteDateDisplay(now);

  const wrapper = document.getElementById("routeDatePickerWrapper");
  if (wrapper) {
    wrapper.addEventListener("click", (e) => {
      try {
        if (typeof dateInput.showPicker === "function") {
          dateInput.showPicker();
        } else {
          dateInput.focus();
        }
      } catch (err) {
        dateInput.focus();
      }
    });
  }

  dateInput.addEventListener("click", (e) => {
    e.stopPropagation();
    try {
      if (typeof dateInput.showPicker === "function") {
        dateInput.showPicker();
      }
    } catch (err) { }
  });

  dateInput.addEventListener("change", async (e) => {
    const val = e.target.value;
    if (!val) return;

    // Parse tanggal yang dipilih (misal: "2026-09-15")
    const parts = val.split("-");
    const selectedDay = parseInt(parts[2], 10); // Ambil angka tanggalnya saja (1-31)
    const selectedDateObj = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, selectedDay);

    state.currentRute = selectedDay; // Tetap angka 1-31 murni untuk backend GAS & AppSheet!
    updateRouteDateDisplay(selectedDateObj);
    updateFloatingBar();

    if (state.currentView === "schedule") {
      await loadScheduledStores();
    } else {
      // Pulihkan draft rute yang dipilih jika ada
      restoreRouteDraft(state.currentRute);
    }
  });
}

/**
 * Format tampilan label tanggal rute (Contoh: "Rute 4")
 */
function updateRouteDateDisplay(dateObj) {
  const display = document.getElementById("routeDateDisplay");
  if (!display) return;

  const dayNum = dateObj.getDate();
  display.textContent = `Rute ${dayNum}`;
}

/**
 * Profil Handlers
 */
function loadSavedProfile() {
  const saved = localStorage.getItem("mds_crew_profile");
  if (saved) {
    try {
      state.profile = JSON.parse(saved);
      renderProfileUI();
    } catch (e) {
      openProfileModal();
    }
  } else {
    state.profile = {
      nama: "Yohandi Pratama",
      kodeCrew: "RO036",
      modul: "LP4",
      account: "ALFAMART"
    };
    localStorage.setItem("mds_crew_profile", JSON.stringify(state.profile));
    renderProfileUI();
  }
}

function renderProfileUI() {
  if (elements.userName) elements.userName.textContent = state.profile.nama || "Pilih Profil Crew";
  if (elements.userModule) elements.userModule.textContent = state.profile.modul || "LP4";

  if (elements.userAvatar) {
    const initials = (state.profile.nama || "MDS")
      .split(" ")
      .map(w => w[0])
      .slice(0, 2)
      .join("")
      .toUpperCase();
    elements.userAvatar.textContent = initials;
  }
  if (window.lucide) lucide.createIcons();
}

/**
 * Cek Status Database & Trigger Sinkronisasi Awal dengan Blocking Loader
 */
async function checkDatabaseStatus() {
  try {
    const count = await getStoresCount();
    const hasCoords = await checkIfStoresHaveCoordinates();

    if (count === 0 || !hasCoords) {
      // Data lama belum ada koordinatnya, otomatis sync ulang sekali
      await triggerMasterSyncWithOverlay();
    } else {
      // Lakukan pencarian awal untuk merender marker terdekat
      await performSearch("");
      syncMasterCrewFromSheet();
      hideBlockingLoader();
    }

    // Muat daftar toko yang sudah diklaim di background (tanpa blocker)
    loadClaimedStores();

    // Pulihkan draft rute aktif jika ada (proteksi refresh / close tab)
    restoreRouteDraft(state.currentRute);

    // Cek apakah user pertama kali membuka web absen -> luncurkan tur interaktif otomatis
    setTimeout(() => {
      const tourDone = localStorage.getItem("mds_tour_completed");
      if (!tourDone) {
        startInteractiveTour();
      }
    }, 1000);
  } catch (err) {
    console.error("DB Check error:", err);
  }
}

/**
 * Load claimed stores dari GAS dan simpan ke state.claimedStores
 */
async function loadClaimedStores() {
  try {
    const claimed = await fetchClaimedStores();
    state.claimedStores = claimed;
    const total = Object.keys(claimed).length;
    if (total > 0) {
      console.log(`[Validasi] ${total} toko sudah diklaim oleh MDS lain.`);
      // Re-render hasil pencarian untuk tampilkan badge gembok jika ada
      if (state.searchResults.length > 0) {
        renderFloatingSearchResults(state.searchResults, state.searchResults.length > 0);
      }
    }
  } catch (err) {
    console.warn("Gagal memuat claimed stores:", err.message);
  }
}

/**
 * Sinkronisasi Master Toko 34k dengan Blocking Loader Layar Penuh
 */
async function triggerMasterSyncWithOverlay() {
  if (state.isSyncing) return;
  state.isSyncing = true;

  showBlockingLoader(
    "Menyinkronkan Database Toko",
    "Mengunduh seluruh data toko & koordinat GPS terbaru dari Google Sheet...",
    true
  );

  try {
    const totalStores = await syncMasterStoresFromSheet((msg, percent) => {
      updateBlockingLoaderProgress(percent, msg);
    });

    await syncMasterCrewFromSheet();
    updateBlockingLoaderProgress(100, "Menyimpan ke IndexedDB...");

    localStorage.setItem("mds_last_store_sync", new Date().toLocaleString("id-ID"));

    setTimeout(async () => {
      hideBlockingLoader();
      showToast(`Berhasil memuat ${totalStores.toLocaleString()} master toko ke peta!`, "success");
      await performSearch("");
    }, 400);

  } catch (err) {
    hideBlockingLoader();
    showToast(`Sinkronisasi gagal: ${err.message}`, "error");
  } finally {
    state.isSyncing = false;
  }
}

/**
 * Event Bindings
 */
function bindEvents() {
  // Search Input: HANYA atur tombol clear saat mengetik (TIDAK query database di background)
  if (elements.searchInput) {
    elements.searchInput.addEventListener("input", (e) => {
      const val = e.target.value.trim();
      if (elements.searchClear) {
        elements.searchClear.classList.toggle("visible", val.length > 0);
      }
      // Jika input dikosongkan secara manual, reset hasil pencarian
      if (val.length === 0) {
        performSearch("");
      }
    });

    // Cari saat tekan tombol Enter di keyboard / HP
    elements.searchInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        elements.searchInput.blur(); // tutup keyboard di mobile
        performSearch(elements.searchInput.value);
      }
    });

    elements.searchInput.addEventListener("focus", () => {
      if (elements.searchResultsFloating && state.searchResults && state.searchResults.length > 0) {
        elements.searchResultsFloating.style.display = "flex";
      }
    });
  }

  // Tombol Cari (Submit Button)
  if (elements.btnSearchSubmit) {
    elements.btnSearchSubmit.addEventListener("click", () => {
      performSearch(elements.searchInput ? elements.searchInput.value : "");
    });
  }

  // Clear Search (Tombol X)
  if (elements.searchClear) {
    elements.searchClear.addEventListener("click", () => {
      elements.searchInput.value = "";
      elements.searchClear.classList.remove("visible");
      performSearch("");
      elements.searchInput.focus();
    });
  }

  // Filter Pills (Account)
  elements.filterPills.forEach(pill => {
    pill.addEventListener("click", () => {
      elements.filterPills.forEach(p => p.classList.remove("active"));
      pill.classList.add("active");
      state.accountFilter = pill.getAttribute("data-account") || "ALL";
      const q = elements.searchInput ? elements.searchInput.value.trim() : "";
      if (q.length > 0) {
        performSearch(q);
      }
    });
  });

  // GPS Locate Button
  document.getElementById("btnGpsLocate")?.addEventListener("click", handleGpsLocate);

  // Unified Action Menu FAB & Items
  const btnToggleMenu = document.getElementById("btnToggleMenuFab");
  const menuDropdown = document.getElementById("menuFabDropdown");
  const menuWrapper = document.getElementById("menuFabWrapper");

  if (btnToggleMenu && menuDropdown) {
    btnToggleMenu.addEventListener("click", (e) => {
      e.stopPropagation();
      const isActive = menuDropdown.classList.toggle("active");
      btnToggleMenu.classList.toggle("active", isActive);
      const iconClosed = btnToggleMenu.querySelector(".icon-fab-closed");
      const iconOpen = btnToggleMenu.querySelector(".icon-fab-open");
      if (iconClosed) iconClosed.style.display = isActive ? "none" : "block";
      if (iconOpen) iconOpen.style.display = isActive ? "block" : "none";
    });

    menuDropdown.querySelectorAll(".menu-fab-item").forEach(item => {
      item.addEventListener("click", () => {
        menuDropdown.classList.remove("active");
        btnToggleMenu.classList.remove("active");
        const iconClosed = btnToggleMenu.querySelector(".icon-fab-closed");
        const iconOpen = btnToggleMenu.querySelector(".icon-fab-open");
        if (iconClosed) iconClosed.style.display = "block";
        if (iconOpen) iconOpen.style.display = "none";
      });
    });

    document.addEventListener("click", (e) => {
      if (menuWrapper && !menuWrapper.contains(e.target)) {
        menuDropdown.classList.remove("active");
        btnToggleMenu.classList.remove("active");
        const iconClosed = btnToggleMenu.querySelector(".icon-fab-closed");
        const iconOpen = btnToggleMenu.querySelector(".icon-fab-open");
        if (iconClosed) iconClosed.style.display = "block";
        if (iconOpen) iconOpen.style.display = "none";
      }
    });
  }

  // Action Menu Handlers & Floating FABs
  document.getElementById("btnOpenMonitoring")?.addEventListener("click", openMonitoringModal);
  document.getElementById("btnEditMyProfile")?.addEventListener("click", openProfileModal);
  document.getElementById("btnSelectMdsDropdown")?.addEventListener("click", openCrewSelectModal);
  document.getElementById("btnEditProfile")?.addEventListener("click", openProfileModal);
  document.getElementById("btnOpenSettings")?.addEventListener("click", openSettingsModal);
  document.getElementById("btnFabSync")?.addEventListener("click", openSettingsModal);
  document.getElementById("btnOpenHistory")?.addEventListener("click", openHistoryModal);
  document.getElementById("btnThemeToggle")?.addEventListener("click", toggleTheme);
  document.getElementById("btnOpenHelpTour")?.addEventListener("click", openHelpModal);
  document.getElementById("btnFabGuide")?.addEventListener("click", openHelpModal);

  // Custom Store Modal Button
  document.getElementById("btnOpenCustomStore")?.addEventListener("click", openCustomStoreModal);
  document.getElementById("btnUseCurrentGps")?.addEventListener("click", handleAutofillGps);
  document.getElementById("customStoreForm")?.addEventListener("submit", handleCustomStoreSave);

  elements.btnViewDrawer?.addEventListener("click", openDrawerModal);
  elements.btnSubmitRoute?.addEventListener("click", handleDirectSubmit);

  // Schedule Buttons & Crew Inspector
  document.getElementById("btnRefreshSchedule")?.addEventListener("click", () => loadScheduledStores());
  document.getElementById("btnCopyScheduleWA")?.addEventListener("click", copyScheduleViewWA);
  document.getElementById("btnPickScheduleCrew")?.addEventListener("click", openScheduleCrewModal);
  document.getElementById("btnResetScheduleCrew")?.addEventListener("click", resetScheduleToMyProfile);
  document.getElementById("scheduleCrewSearchInput")?.addEventListener("input", (e) => {
    const val = e.target.value;
    renderScheduleCrewSearchResults(allMasterCrewsCache, val);
  });
  document.getElementById("btnToggleScheduleList")?.addEventListener("click", () => {
    const list = document.getElementById("scheduleStoreList");
    if (!list) return;
    const isHidden = list.style.display === "none" || !list.style.display;
    list.style.display = isHidden ? "flex" : "none";
  });

  // Modals close on background click
  document.querySelectorAll(".modal-backdrop").forEach(modal => {
    modal.addEventListener("click", (e) => {
      if (e.target === modal) {
        modal.classList.remove("active");
      }
    });
  });

  // Forms
  document.getElementById("profileForm")?.addEventListener("submit", handleProfileSave);
  document.getElementById("btnForceSync")?.addEventListener("click", () => {
    elements.settingsModal.classList.remove("active");
    triggerMasterSyncWithOverlay();
  });
  document.getElementById("btnHardRefreshMobile")?.addEventListener("click", async () => {
    showBlockingLoader("Membersihkan Cache...", "Menghapus cache browser HP dan memuat file terbaru...", false);
    try {
      if ("caches" in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map(k => caches.delete(k)));
      }
      localStorage.removeItem("mds_last_store_sync");
      setTimeout(() => {
        const url = new URL(window.location.href);
        url.searchParams.set("_v", Date.now().toString());
        window.location.replace(url.toString());
      }, 400);
    } catch (e) {
      window.location.reload(true);
    }
  });

  // Help Modal & Interactive Tour
  document.getElementById("btnOpenHelpTour")?.addEventListener("click", openHelpModal);
  document.getElementById("btnStartInteractiveTour")?.addEventListener("click", () => {
    closeHelpModal();
    startInteractiveTour();
  });
  elements.tourBtnClose?.addEventListener("click", endInteractiveTour);
  elements.tourBtnSkip?.addEventListener("click", endInteractiveTour);
  elements.tourBtnPrev?.addEventListener("click", prevTourStep);
  elements.tourBtnNext?.addEventListener("click", nextTourStep);

  // Drawer Action Buttons
  document.getElementById("btnClearDrawer")?.addEventListener("click", clearSelectedStores);
  document.getElementById("btnDrawerSubmit")?.addEventListener("click", handleDirectSubmit);
  document.getElementById("btnCopyWA")?.addEventListener("click", copyWhatsAppSummary);

  // Monitoring Action Buttons
  document.getElementById("btnRefreshMonitoring")?.addEventListener("click", () => {
    const sel = document.getElementById("monitoringRuteSelect");
    loadMonitoringData(sel ? sel.value : state.currentRute);
  });
  document.getElementById("btnCopyMonitoringWA")?.addEventListener("click", copyMonitoringReportWA);

  // Proteksi Tambahan: Peringatan jika tab ditutup / direfresh saat masih ada toko yang dipilih
  window.addEventListener("beforeunload", (e) => {
    if (state.selectedStores && state.selectedStores.size > 0) {
      e.preventDefault();
      e.returnValue = "";
    }
  });
}

/**
 * Handle GPS Locate Button Click
 */
function handleGpsLocate() {
  if (!("geolocation" in navigator)) {
    showToast("Fitur GPS tidak didukung di browser ini", "warning");
    return;
  }

  showToast("Mencari lokasi GPS Anda...", "warning");
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const { latitude, longitude } = pos.coords;
      state.userLocation = [latitude, longitude];
      map.flyTo([latitude, longitude], 15, { duration: 1.2 });
      addUserLocationMarker(latitude, longitude);
      showToast("Lokasi Anda berhasil ditemukan!", "success");
    },
    (err) => {
      showToast(`Gagal mendapatkan lokasi: ${err.message}`, "error");
    },
    { enableHighAccuracy: true, timeout: 10000 }
  );
}

/**
 * Switch View (Peta & Pilih Toko vs Jadwal Terinput)
 */
window.switchAppView = function (viewName) {
  state.currentView = viewName;

  const tabInput = document.getElementById("tabBtnInput");
  const tabSched = document.getElementById("tabBtnSchedule");
  const cardInput = document.getElementById("floatingSearchCard");
  const cardSched = document.getElementById("floatingScheduleCard");

  if (viewName === "input") {
    tabInput?.classList.add("active");
    tabSched?.classList.remove("active");
    if (cardInput) cardInput.style.display = "flex";
    if (cardSched) cardSched.style.display = "none";
    updateFloatingBar();
    renderMapMarkers(state.searchResults, false);
    renderSelectedRouteMarkersAndPolyline(Array.from(state.selectedStores.values()));
  } else {
    tabInput?.classList.remove("active");
    tabSched?.classList.add("active");
    if (cardInput) cardInput.style.display = "none";
    if (cardSched) cardSched.style.display = "flex";
    elements.floatingBar?.classList.remove("visible");
    loadScheduledStores();
  }
};

/**
 * Pencarian Toko di IndexedDB & Render ke Peta + Floating List
 */
async function performSearch(query) {
  const cleanQ = (query || "").trim();

  // Jika pencarian kosong, bersihkan hasil dan peta
  if (cleanQ.length === 0) {
    state.searchResults = [];
    renderFloatingSearchResults([], false);
    if (markerClusterGroup) markerClusterGroup.clearLayers();
    renderSelectedRouteMarkersAndPolyline(Array.from(state.selectedStores.values()));
    return;
  }

  const submitBtn = elements.btnSearchSubmit;

  // Aktifkan State Loading pada Tombol & Drawer
  if (submitBtn) {
    submitBtn.classList.add("is-loading");
    submitBtn.disabled = true;
    submitBtn.innerHTML = `
      <i data-lucide="loader-2" class="spin" style="width: 13px; height: 13px;"></i>
      <span>Mencari...</span>
    `;
    if (window.lucide) lucide.createIcons();
  }

  if (elements.searchResultsFloating) {
    elements.searchResultsFloating.style.display = "flex";
    elements.searchResultsFloating.innerHTML = `
      <div style="padding: 20px 12px; text-align: center; color: var(--text-muted); font-size: 12px;">
        <i data-lucide="loader-2" class="spin" style="width: 22px; height: 22px; color: var(--primary); margin-bottom: 6px;"></i>
        <div style="font-weight: 600; color: var(--text-main);">Mencari "${escapeHtml(cleanQ)}"...</div>
        <div style="font-size: 11px; color: var(--text-muted); margin-top: 3px;">Memeriksa database toko...</div>
      </div>
    `;
    if (window.lucide) lucide.createIcons();
  }

  try {
    // Beri sedikit frame delay agar animasi spinner tampak responsif di mata user
    await new Promise(r => setTimeout(r, 100));

    const results = await searchStores({
      query: cleanQ,
      accountFilter: state.accountFilter,
      limit: 60
    });

    state.searchResults = results;
    renderFloatingSearchResults(results, true);
    renderMapMarkers(results, true);

    // Jika ada hasil yang memiliki koordinat GPS, geser peta ke hasil pertama secara halus
    const firstWithGps = results.find(s => s.lat && s.lon && !isNaN(Number(s.lat)) && !isNaN(Number(s.lon)) && (Number(s.lat) !== 0 || Number(s.lon) !== 0));
    if (firstWithGps && map) {
      map.panTo([Number(firstWithGps.lat), Number(firstWithGps.lon)], { animate: true, duration: 0.8 });
    }
  } catch (err) {
    console.error("Search error:", err);
    if (elements.searchResultsFloating) {
      elements.searchResultsFloating.innerHTML = `
        <div style="padding: 14px 12px; text-align: center; color: var(--danger); font-size: 12px;">
          Gagal mencari toko: ${escapeHtml(err.message || "Error database")}
        </div>
      `;
    }
  } finally {
    // Kembalikan Tombol ke State Normal
    if (submitBtn) {
      submitBtn.classList.remove("is-loading");
      submitBtn.disabled = false;
      submitBtn.innerHTML = `
        <i data-lucide="search" style="width: 13px; height: 13px;"></i>
        <span>Cari</span>
      `;
      if (window.lucide) lucide.createIcons();
    }
  }
}

/**
 * Render Hasil Pencarian Floating
 */
function renderFloatingSearchResults(stores, showContainer = true) {
  const container = elements.searchResultsFloating;
  if (!container) return;

  if (!showContainer) {
    container.style.display = "none";
    return;
  }

  if (stores.length === 0) {
    container.innerHTML = `
      <div style="padding: 12px; text-align: center; color: var(--text-muted); font-size: 12px;">
        Tidak ada toko ditemukan
      </div>
    `;
    container.style.display = "flex";
    return;
  }

  container.style.display = "flex";
  let html = "";

  stores.slice(0, 15).forEach(store => {
    const isSelected = isStoreSelected(store.kodeToko, store.account);
    const brandClass = getBrandClass(store.account);

    // Pakai getStoreVisitStatus untuk validasi lengkap dengan account
    const visitStatus = getStoreVisitStatus(store.kodeToko, store.account);
    const { isLockedByOther, lockedBy, isRevisitTooSoon, isRevisitAllowed, lastSelfVisit, daysSinceLastVisit } = visitStatus;

    // Badge status
    let statusBadgeHtml = "";
    let actionButtonHtml = "";
    let extraCardClass = "";

    if (isLockedByOther) {
      extraCardClass = "locked";
      statusBadgeHtml = `
        <span style="font-size:9px; background: var(--danger); color:white; padding: 1px 5px; border-radius: 99px; font-weight:700;">🔒 TERKUNCI</span>
      `;
      statusBadgeHtml += `
        <div style="font-size: 10px; color: var(--danger); font-weight: 700; display: flex; align-items: center; gap: 3px; margin-top: 2px;">
          <i data-lucide="lock" style="width: 11px; height: 11px;"></i>
          Dikover: ${escapeHtml(lockedBy.namaCrew)} (${escapeHtml(lockedBy.modul)})
        </div>
      `;
      actionButtonHtml = `
        <button type="button" class="btn-icon-mini" disabled title="Toko dikunci" style="opacity:0.4; cursor:not-allowed;">
          <i data-lucide="lock" style="width: 14px; height: 14px; color: var(--danger);"></i>
        </button>
      `;
    } else if (isRevisitTooSoon) {
      extraCardClass = "revisit-soon";
      statusBadgeHtml = `
        <span style="font-size:9px; background: var(--warning); color:white; padding: 1px 5px; border-radius: 99px; font-weight:700;">⚠️ RE-VISIT</span>
      `;
      statusBadgeHtml += `
        <div style="font-size: 10px; color: var(--warning); font-weight: 700; margin-top: 2px;">
          Kunjungan: Rute ${escapeHtml(lastSelfVisit.rute)} (${daysSinceLastVisit} hari lalu). Klik (+) untuk pilih.
        </div>
      `;
      if (isSelected) {
        actionButtonHtml = `
          <button type="button" class="btn-icon-mini" onclick="event.stopPropagation(); toggleStoreSelection('${escapeHtml(store.kodeToko)}', '${escapeHtml(store.account || '')}')" title="Hapus dari rute" style="background: rgba(16, 185, 129, 0.18); color: #059669; border: 1.5px solid #10b981;">
            <i data-lucide="check" style="width: 14px; height: 14px; stroke-width: 2.5;"></i>
          </button>
        `;
      } else {
        actionButtonHtml = `
          <button type="button" class="btn-icon-mini" onclick="event.stopPropagation(); toggleStoreSelection('${escapeHtml(store.kodeToko)}', '${escapeHtml(store.account || '')}')" title="Pilih Re-visit (Bisa ditambahkan ke rute)" style="background: rgba(245, 158, 11, 0.18); color: #d97706; border: 1.5px solid #f59e0b;">
            <i data-lucide="plus" style="width: 14px; height: 14px; stroke-width: 2.5;"></i>
          </button>
        `;
      }
    } else if (isRevisitAllowed) {
      statusBadgeHtml = `
        <div style="font-size: 10px; color: var(--text-muted); margin-top: 2px;">
          ✅ Re-visit OK (${daysSinceLastVisit} hari sejak Rute ${escapeHtml(lastSelfVisit.rute)})
        </div>
      `;
      actionButtonHtml = `
        <button type="button" class="btn-icon-mini" onclick="event.stopPropagation(); toggleStoreSelection('${escapeHtml(store.kodeToko)}', '${escapeHtml(store.account || '')}')" title="${isSelected ? 'Hapus dari rute' : 'Tambah ke rute'}">
          <i data-lucide="${isSelected ? 'check' : 'plus'}" style="width: 14px; height: 14px; color: var(--${isSelected ? 'success' : 'primary'});"></i>
        </button>
      `;
    } else {
      actionButtonHtml = `
        <button type="button" class="btn-icon-mini" onclick="event.stopPropagation(); toggleStoreSelection('${escapeHtml(store.kodeToko)}', '${escapeHtml(store.account || '')}')" title="${isSelected ? 'Hapus dari rute' : 'Tambah ke rute'}">
          <i data-lucide="${isSelected ? 'check' : 'plus'}" style="width: 14px; height: 14px; color: var(--${isSelected ? 'success' : 'primary'});"></i>
        </button>
      `;
    }

    const hasGps = store.lat !== null && store.lat !== undefined && store.lon !== null && store.lon !== undefined && !isNaN(Number(store.lat)) && !isNaN(Number(store.lon)) && (Number(store.lat) !== 0 || Number(store.lon) !== 0);
    const noGpsBadgeHtml = !hasGps ? `<span style="font-size:9px; background: rgba(148, 163, 184, 0.2); color: var(--text-muted); padding: 1px 5px; border-radius: 99px; font-weight: 600;">📍 No GPS</span>` : '';

    html += `
      <div class="store-card-compact ${isSelected ? 'selected' : ''} ${extraCardClass}" onclick="flyToStoreOnMap('${escapeHtml(store.kodeToko)}', '${escapeHtml(store.account || '')}', '${escapeHtml(store.namaToko || '')}')">
        <div style="flex: 1; min-width: 0;">
          <div class="store-badges">
            <span class="badge-code">${escapeHtml(store.kodeToko)}</span>
            <span class="badge-brand ${brandClass}">${escapeHtml(store.account)}</span>
            ${noGpsBadgeHtml}
            ${statusBadgeHtml.split('\n')[0]}
          </div>
          <div style="font-size: 12px; font-weight: 700; color: var(--text-main); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
            ${escapeHtml(store.namaToko)}
          </div>
          <div style="font-size: 10px; color: var(--text-muted); margin-top: 1px;">
            ${escapeHtml(store.kecamatan || store.kota || 'Area Toko')}${store.provinsi ? ' • ' + escapeHtml(store.provinsi) : ''}${store.crew ? ' • 👤 ' + escapeHtml(store.crew) : ''}
          </div>
          ${statusBadgeHtml.split('\n').slice(1).join('\n')}
        </div>
        <div style="display: flex; align-items: center; gap: 3px;">
          <button type="button" class="btn-icon-mini" onclick="event.stopPropagation(); editStoreByCode('${escapeHtml(store.kodeToko)}', '${escapeHtml(store.account || '')}')" title="Edit Data Toko">
            <i data-lucide="edit-3" style="width: 13px; height: 13px;"></i>
          </button>
          ${actionButtonHtml}
        </div>
      </div>
    `;
  });

  container.innerHTML = html;
  if (window.lucide) lucide.createIcons();
}

/**
 * Edit Data Toko by Kode Toko (Buka Modal dengan Data Terisi)
 */
window.editStoreByCode = async function (kodeToko, account = "") {
  if (!kodeToko) return;
  const storeKey = getStoreKey(kodeToko, account);

  let store = state.searchResults.find(s => s.kodeToko === kodeToko && (!account || (s.account || '').toUpperCase() === account.toUpperCase()))
    || state.scheduleStores.find(s => s.kodeToko === kodeToko && (!account || (s.account || '').toUpperCase() === account.toUpperCase()))
    || state.selectedStores.get(storeKey)
    || state.searchResults.find(s => s.kodeToko === kodeToko)
    || state.scheduleStores.find(s => s.kodeToko === kodeToko);

  if (!store) {
    store = await getStoreByCode(kodeToko, account);
  }

  if (store) {
    openCustomStoreModal(store);
  } else {
    openCustomStoreModal({ kodeToko, account });
  }
};

/**
 * Fly-to Store di Peta saat diklik dari list
 */
window.flyToStoreOnMap = async function (kodeToko, account = "", namaToko = "") {
  const storeKey = getStoreKey(kodeToko, account);
  let store = state.searchResults.find(s => s.kodeToko === kodeToko && (!account || (s.account || '').toUpperCase() === account.toUpperCase()))
    || state.scheduleStores.find(s => s.kodeToko === kodeToko && (!account || (s.account || '').toUpperCase() === account.toUpperCase()))
    || state.selectedStores.get(storeKey)
    || state.searchResults.find(s => s.kodeToko === kodeToko)
    || state.scheduleStores.find(s => s.kodeToko === kodeToko);

  // Jika di memori sementara belum ada koordinat, coba ambil langsung dari IndexedDB (dengan strict account)
  if (!store || !store.lat || !store.lon) {
    const fromDb = await getStoreByCode(kodeToko, account, namaToko || (store ? store.namaToko : ""));
    if (fromDb && fromDb.lat && fromDb.lon) {
      if (store) {
        store.lat = fromDb.lat;
        store.lon = fromDb.lon;
        store.kecamatan = fromDb.kecamatan || store.kecamatan;
        store.kota = fromDb.kota || store.kota;
      } else {
        store = fromDb;
      }
    }
  }

  const hasValidGps = store && store.lat !== null && store.lat !== undefined && store.lon !== null && store.lon !== undefined && !isNaN(Number(store.lat)) && !isNaN(Number(store.lon)) && (Number(store.lat) !== 0 || Number(store.lon) !== 0);

  if (!hasValidGps) {
    showToast("Toko belum ada titik peta, tapi TETAP BISA dipilih ke rute via tombol (+)", "info");
    return;
  }

  map.flyTo([Number(store.lat), Number(store.lon)], 17, { duration: 1.2 });
  if (elements.searchResultsFloating) {
    elements.searchResultsFloating.style.display = "none";
  }
};

/**
 * Toggle Tambah/Hapus Toko dari Rute
 */
window.toggleStoreSelection = function (kodeToko, account = "") {
  let targetStore = state.searchResults.find(s => s.kodeToko === kodeToko && (!account || (s.account || '').toUpperCase() === account.toUpperCase()))
    || state.scheduleStores.find(s => s.kodeToko === kodeToko && (!account || (s.account || '').toUpperCase() === account.toUpperCase()))
    || state.searchResults.find(s => s.kodeToko === kodeToko)
    || state.scheduleStores.find(s => s.kodeToko === kodeToko);

  const acc = account || (targetStore ? targetStore.account : "");
  const storeKey = getStoreKey(targetStore || { kodeToko, account: acc });

  if (state.selectedStores.has(storeKey)) {
    // Hapus dari rute
    state.selectedStores.delete(storeKey);
    saveCurrentRouteDraft();

    const selectedArray = Array.from(state.selectedStores.values());
    renderMapMarkers(state.searchResults, false);
    renderSelectedRouteMarkersAndPolyline(selectedArray);
    renderFloatingSearchResults(state.searchResults, state.searchResults && state.searchResults.length > 0);
    updateFloatingBar();
    map.closePopup();
    return;
  }

  // --- Validasi sebelum menambahkan ---
  const visitStatus = getStoreVisitStatus(kodeToko, acc);

  if (visitStatus.isLockedByOther) {
    // HARD BLOCK: dikover MDS lain
    showToast(`🔒 Toko dikover oleh ${visitStatus.lockedBy.namaCrew} (${visitStatus.lockedBy.modul} – Rute ${visitStatus.lockedBy.rute}). Tidak bisa dipilih!`, "error");
    map.closePopup();
    return;
  }

  let isRevisit = false;
  let statusKunjungan = "Kunjungan Pertama";
  let revisitReason = "-";

  if (visitStatus.isRevisitTooSoon) {
    // SOFT BLOCK: re-visit < 14 hari — minta konfirmasi & alasan
    const lastVisit = visitStatus.lastSelfVisit;
    const dayGap = visitStatus.daysSinceLastVisit;
    const promptInput = prompt(
      `⚠️ RE-VISIT TERLALU CEPAT\n\nToko ini sudah Anda kunjungi pada Rute ${lastVisit.rute} (${dayGap} hari lalu, min. 14 hari).\n\nMasukkan alasan re-visit (akan dicatat ke Rekap Spreadsheet):`,
      "Wilayah minim toko"
    );

    if (promptInput === null) {
      // User klik Batal
      map.closePopup();
      return;
    }

    isRevisit = true;
    statusKunjungan = `Re-Visit (< 14 Hari)`;
    revisitReason = promptInput.trim() || "Wilayah minim toko";
    showToast(`⚠️ Re-visit dicatat: "${revisitReason}" (${dayGap} hari sejak Rute ${lastVisit.rute})`, "warning");
  } else if (visitStatus.isRevisitAllowed) {
    // Re-visit >= 14 hari — boleh
    const lastVisit = visitStatus.lastSelfVisit;
    const dayGap = visitStatus.daysSinceLastVisit;
    isRevisit = true;
    statusKunjungan = `Re-Visit (≥ 14 Hari)`;
    revisitReason = "Jadwal berkala rutin";
    showToast(`ℹ️ Re-visit OK: ${dayGap} hari sejak kunjungan terakhir (Rute ${lastVisit.rute})`, "warning");
  }

  // Tambahkan ke rute
  targetStore = targetStore || { kodeToko, account: acc };
  targetStore.isRevisit = isRevisit;
  targetStore.statusKunjungan = statusKunjungan;
  targetStore.alasanRevisit = revisitReason;

  state.selectedStores.set(storeKey, targetStore);
  saveCurrentRouteDraft();

  const selectedArray = Array.from(state.selectedStores.values());
  const currentCount = selectedArray.length;

  renderMapMarkers(state.searchResults, false);
  renderSelectedRouteMarkersAndPolyline(selectedArray);
  renderFloatingSearchResults(state.searchResults, state.searchResults && state.searchResults.length > 0);
  updateFloatingBar();
  map.closePopup();

  if (!visitStatus.isRevisitTooSoon && !visitStatus.isRevisitAllowed) {
    showToast(`Urutan #${currentCount}: ${targetStore.namaToko || targetStore.kodeToko} masuk Rute ${state.currentRute}`, "success");
  }
};

/**
 * Analisis status kunjungan toko berdasarkan data claimedStores
 * 
 * Returns:
 *   { isLockedByOther, lockedBy, isRevisitTooSoon, isRevisitAllowed, lastSelfVisit, daysSinceLastVisit }
 */
function getStoreVisitStatus(kodeToko, account = "") {
  const REVISIT_MIN_DAYS = 14;
  let visits = state.claimedStores[kodeToko]; // array or undefined
  const myCrewCode = (state.profile.kodeCrew || "").trim();
  const currentRute = parseInt(state.currentRute) || new Date().getDate();

  const result = {
    isLockedByOther: false,
    lockedBy: null,
    isRevisitTooSoon: false,
    isRevisitAllowed: false,
    lastSelfVisit: null,
    daysSinceLastVisit: null
  };

  if (!visits || !Array.isArray(visits) || visits.length === 0) return result;

  // Filter jika account diberikan agar Alfa dan Indomaret dengan kode sama tidak saling mengunci
  const cleanAcc = (account || "").toString().trim().toUpperCase();
  if (cleanAcc) {
    visits = visits.filter(v => (v.account || "").toString().trim().toUpperCase() === cleanAcc);
    if (visits.length === 0) return result;
  }

  // Pisahkan kunjungan MDS lain dan kunjungan sendiri
  const otherVisits = visits.filter(v => v.kodeCrew && v.kodeCrew !== myCrewCode);
  const selfVisits = visits.filter(v => v.kodeCrew === myCrewCode);

  // Cek apakah ada MDS lain yang sudah mengkover toko ini
  if (otherVisits.length > 0) {
    // Ambil kunjungan MDS lain yang paling baru (rute terbesar = paling akhir di bulan ini)
    const latestOther = otherVisits.reduce((a, b) =>
      (parseInt(b.rute) || 0) > (parseInt(a.rute) || 0) ? b : a
    );
    result.isLockedByOther = true;
    result.lockedBy = latestOther;
    return result;
  }

  // Cek kunjungan sendiri (re-visit)
  if (selfVisits.length > 0) {
    // Ambil kunjungan terakhir dari kode crew sendiri (rute terbesar)
    const lastSelf = selfVisits.reduce((a, b) =>
      (parseInt(b.rute) || 0) > (parseInt(a.rute) || 0) ? b : a
    );

    const lastRute = parseInt(lastSelf.rute) || 0;
    const dayGap = currentRute - lastRute; // selisih hari dalam bulan yang sama

    result.lastSelfVisit = lastSelf;
    result.daysSinceLastVisit = dayGap;

    if (dayGap < REVISIT_MIN_DAYS) {
      result.isRevisitTooSoon = true;
    } else {
      result.isRevisitAllowed = true;
    }
  }

  return result;
}

/* ===================================================
   AUTO-SAVE DRAFT & RECOVERY SYSTEM
   Menjaga toko yang dipilih tetap aman jika browser ter-refresh / ter-close
   =================================================== */

function saveCurrentRouteDraft() {
  try {
    const rute = state.currentRute;
    const stores = Array.from(state.selectedStores.values());
    const key = `mds_draft_rute_${rute}`;

    if (stores.length > 0) {
      localStorage.setItem(key, JSON.stringify({
        rute: rute,
        timestamp: new Date().toISOString(),
        stores: stores
      }));
    } else {
      localStorage.removeItem(key);
    }
  } catch (e) {
    console.warn("Gagal menyimpan draft rute:", e);
  }
}

function restoreRouteDraft(rute) {
  try {
    const key = `mds_draft_rute_${rute}`;
    const raw = localStorage.getItem(key);

    if (!raw) {
      state.selectedStores.clear();
      renderSelectedRouteMarkersAndPolyline([]);
      renderMapMarkers(state.searchResults, false);
      renderFloatingSearchResults(state.searchResults, false);
      updateFloatingBar();
      return;
    }

    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.stores) && parsed.stores.length > 0) {
      state.selectedStores.clear();
      parsed.stores.forEach(st => {
        const sKey = getStoreKey(st);
        state.selectedStores.set(sKey, st);
      });

      const selectedArray = Array.from(state.selectedStores.values());
      renderSelectedRouteMarkersAndPolyline(selectedArray);
      renderMapMarkers(state.searchResults, false);
      renderFloatingSearchResults(state.searchResults, false);
      updateFloatingBar();

      showToast(`💾 Draft Rute ${rute} berhasil dipulihkan (${selectedArray.length} toko)!`, "info");
    }
  } catch (e) {
    console.warn("Gagal memulihkan draft rute:", e);
  }
}

function clearRouteDraft(rute) {
  try {
    localStorage.removeItem(`mds_draft_rute_${rute}`);
  } catch (e) {
    console.warn("Gagal menghapus draft:", e);
  }
}

/**
 * Update Tampilan Floating Bottom Action Bar
 */
function updateFloatingBar() {
  const count = state.selectedStores.size;
  const bar = elements.floatingBar;

  if (count > 0 && state.currentView === "input") {
    bar.classList.add("visible");
    if (elements.summaryCount) {
      elements.summaryCount.innerHTML = `<i data-lucide="shopping-bag" style="width: 15px; height: 15px; color: var(--primary);"></i> ${count} Toko Dipilih`;
    }
    if (elements.summaryRoute) {
      elements.summaryRoute.textContent = `Siap masuk ke Rute ${state.currentRute}`;
    }
  } else {
    bar.classList.remove("visible");
  }
  if (window.lucide) lucide.createIcons();
}

/**
 * Buka Drawer Review Toko Terpilih
 */
function openDrawerModal() {
  const modal = elements.drawerModal;
  const container = document.getElementById("drawerStoreList");
  const countBadge = document.getElementById("drawerCountBadge");
  const routeBadge = document.getElementById("drawerRouteBadge");

  if (countBadge) countBadge.textContent = `${state.selectedStores.size} Toko`;
  if (routeBadge) routeBadge.textContent = `Rute ${state.currentRute}`;

  if (state.selectedStores.size === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 24px; color: var(--text-muted); font-size: 13px;">
        Belum ada toko yang dipilih di Rute ${state.currentRute}
      </div>
    `;
  } else {
    let html = "";
    let idx = 1;
    state.selectedStores.forEach((store, storeKey) => {
      html += `
        <div style="background: var(--bg-main); border: 1px solid var(--border); border-radius: var(--radius-md); padding: 8px 10px; display: flex; align-items: center; justify-content: space-between; gap: 8px;">
          <div style="flex: 1; min-width: 0;">
            <div style="font-size: 10px; color: var(--text-muted); font-weight: 700;">
              #${idx++} &bull; ${escapeHtml(store.account || 'TOKO')} &bull; ${escapeHtml(store.kodeToko)}
            </div>
            <div style="font-size: 12px; font-weight: 700; color: var(--text-main); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
              ${escapeHtml(store.namaToko || store.kodeToko)}
            </div>
          </div>
          <button type="button" class="btn-icon-mini" onclick="removeStoreFromDrawer('${escapeHtml(storeKey)}')" title="Hapus" style="color: var(--danger);">
            <i data-lucide="trash-2" style="width: 14px; height: 14px;"></i>
          </button>
        </div>
      `;
    });
    container.innerHTML = html;
  }

  if (window.lucide) lucide.createIcons();
  modal.classList.add("active");
}

window.removeStoreFromDrawer = function (storeKey) {
  state.selectedStores.delete(storeKey);
  saveCurrentRouteDraft();
  const selectedArray = Array.from(state.selectedStores.values());
  renderMapMarkers(state.searchResults, false);
  renderSelectedRouteMarkersAndPolyline(selectedArray);
  renderFloatingSearchResults(state.searchResults, false);
  updateFloatingBar();
  openDrawerModal();
};

async function clearSelectedStores() {
  if (state.selectedStores.size === 0) return;
  const ok = await showCustomConfirm({
    title: "Kosongkan Keranjang Rute?",
    message: `Seluruh ${state.selectedStores.size} toko yang telah Anda pilih untuk Rute ${state.currentRute} akan dibatalkan dari daftar hari ini.`,
    type: "danger",
    icon: "trash-2",
    okText: "Ya, Kosongkan",
    cancelText: "Batal"
  });

  if (ok) {
    state.selectedStores.clear();
    saveCurrentRouteDraft();
    elements.drawerModal.classList.remove("active");
    renderMapMarkers(state.searchResults, false);
    renderSelectedRouteMarkersAndPolyline([]);
    renderFloatingSearchResults(state.searchResults, false);
    updateFloatingBar();
    showToast("Keranjang rute berhasil dikosongkan", "info");
  }
}

/**
 * Handle Submit Rute ke Cloud dengan Blocking Loader Overlay
 */
async function handleDirectSubmit() {
  if (state.selectedStores.size === 0) {
    showToast("Pilih minimal 1 toko untuk diinput!", "warning");
    return;
  }

  const storesArray = Array.from(state.selectedStores.values());

  // Tampilkan Blocking Loader Layar Penuh
  showBlockingLoader(
    "Mengirim Jadwal Rute...",
    `Mendistribusikan ${storesArray.length} toko ke 3 spreadsheet tujuan (Modul ${state.profile.modul}, Data External, dan Absen)...`,
    false
  );

  // Proteksi Simulasi Tutorial (Tidak kirim ke server asli)
  if (state.isTourMode) {
    setTimeout(() => {
      hideBlockingLoader();
      showToast("[Simulasi Tutorial] Jadwal berhasil diproses! (Data dummy tidak dikirim ke Google Sheet)", "success");
      nextTourStep();
    }, 700);
    return;
  }

  try {
    const result = await submitRouteAttendance({
      module: state.profile.modul,
      crewCode: state.profile.kodeCrew,
      crewName: state.profile.nama,
      rute: state.currentRute,
      stores: storesArray
    });

    hideBlockingLoader();
    showToast(result.message, "success");

    // Kosongkan keranjang & hapus draft rute yang sudah sukses terkirim
    state.selectedStores.clear();
    clearRouteDraft(state.currentRute);

    elements.drawerModal.classList.remove("active");
    updateFloatingBar();
    renderMapMarkers(state.searchResults, false);
    renderSelectedRouteMarkersAndPolyline([]);
    renderFloatingSearchResults(state.searchResults, false);

  } catch (err) {
    hideBlockingLoader();
    showToast(`Pengiriman gagal: ${err.message}`, "error");
  }
}

/**
 * Muat Jadwal Toko Terinput & Render ke Peta
 */
async function loadScheduledStores(targetCrew = null) {
  const container = document.getElementById("scheduleStoreList");
  const title = document.getElementById("scheduleViewTitle");
  const countLabel = document.getElementById("scheduleTotalStores");
  const crewLabel = document.getElementById("scheduleCrewLabel");
  const crewNameEl = document.getElementById("scheduleCrewName");
  const crewAvatarEl = document.getElementById("scheduleCrewAvatar");
  const btnReset = document.getElementById("btnResetScheduleCrew");

  if (targetCrew !== null) {
    state.inspectingCrew = targetCrew;
  }

  // Tentukan apakah sedang melihat jadwal saya atau rekan lain
  const isInspectingOther = state.inspectingCrew && 
    (state.inspectingCrew.id || state.inspectingCrew.kodeCrew) !== (state.profile.kodeCrew || 'RO036');

  const activeCrew = isInspectingOther ? state.inspectingCrew : state.profile;
  const activeCrewName = activeCrew.nama || "MDS";
  const activeCrewCode = activeCrew.id || activeCrew.kodeCrew || state.profile.kodeCrew;
  const activeCrewModul = activeCrew.modul || state.profile.modul || "LP4";

  if (title) title.textContent = `Jadwal Rute ${state.currentRute}`;
  
  if (crewNameEl) crewNameEl.textContent = `${activeCrewName} (${activeCrewModul})`;
  if (crewAvatarEl) {
    const initials = activeCrewName.split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase();
    crewAvatarEl.textContent = initials;
  }

  if (isInspectingOther) {
    if (crewLabel) {
      crewLabel.textContent = "👀 Jadwal Rekan (Read-Only):";
      crewLabel.style.color = "var(--primary)";
    }
    if (btnReset) btnReset.style.display = "inline-flex";
  } else {
    if (crewLabel) {
      crewLabel.textContent = "Melihat Jadwal Saya:";
      crewLabel.style.color = "var(--text-muted)";
    }
    if (btnReset) btnReset.style.display = "none";
  }

  // Tampilkan Fullscreen Blocking Loader saat menarik data jadwal
  showBlockingLoader(
    `Memuat Jadwal Rute ${state.currentRute}`,
    `Mengambil data kunjungan ${activeCrewName} dari Google Sheet modul ${activeCrewModul}...`,
    false
  );

  if (container) {
    container.innerHTML = `
      <div style="text-align: center; padding: 20px; color: var(--text-muted); font-size: 12px;">
        <i data-lucide="loader-2" class="spin" style="width: 20px; height: 20px; margin-bottom: 6px;"></i>
        <div>Memuat jadwal rute ${escapeHtml(activeCrewName)}...</div>
      </div>
    `;
    if (window.lucide) lucide.createIcons();
  }

  try {
    const stores = await fetchSavedSchedule({
      module: activeCrewModul,
      rute: state.currentRute,
      crewCode: activeCrewCode
    });

    // Cari koordinat GPS (lat & lon) dari database lokal IndexedDB untuk setiap toko yang terinput
    for (let i = 0; i < stores.length; i++) {
      const st = stores[i];
      if (!st.lat || !st.lon) {
        const localDetail = await getStoreByCode(st.kodeToko, st.account, st.namaToko);
        if (localDetail) {
          st.lat = localDetail.lat;
          st.lon = localDetail.lon;
          st.kecamatan = localDetail.kecamatan || st.kecamatan;
          st.kota = localDetail.kota || st.kota;
        }
      }
    }

    state.scheduleStores = stores;
    if (countLabel) countLabel.textContent = `${stores.length} Toko`;

    if (stores.length === 0) {
      if (container) {
        container.innerHTML = `
          <div style="text-align: center; padding: 20px; color: var(--text-muted); font-size: 12px;">
            Belum ada jadwal toko di Rute ${state.currentRute} untuk ${escapeHtml(activeCrewName)}
          </div>
        `;
      }
      if (selectedRouteMarkersLayer) selectedRouteMarkersLayer.clearLayers();
      if (routePolyline) map.removeLayer(routePolyline);
    } else {
      let html = "";
      stores.forEach((st, idx) => {
        const brandClass = getBrandClass(st.account);
        const actionHtml = isInspectingOther 
          ? `<span style="font-size: 10px; font-weight: 700; color: var(--text-muted); background: var(--bg-card); border: 1px solid var(--border); padding: 2px 6px; border-radius: var(--radius-sm);">Terkunci</span>`
          : `<button type="button" class="btn-icon-mini" onclick="event.stopPropagation(); confirmDeleteStoreFromSchedule('${escapeHtml(st.kodeToko)}', '${escapeHtml(st.namaToko)}')" title="Hapus dari Jadwal Rute Ini">
               <i data-lucide="trash-2" style="color: var(--danger); width: 14px; height: 14px;"></i>
             </button>`;

        html += `
          <div class="store-card-compact" onclick="flyToStoreOnMap('${escapeHtml(st.kodeToko)}', '${escapeHtml(st.account || '')}', '${escapeHtml(st.namaToko || '')}')">
            <div style="flex: 1; min-width: 0;">
              <div class="store-badges">
                <span class="badge-code">#${idx + 1} &bull; ${escapeHtml(st.kodeToko)}</span>
                <span class="badge-brand ${brandClass}">${escapeHtml(st.account)}</span>
              </div>
              <div style="font-size: 12px; font-weight: 700; color: var(--text-main); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                ${escapeHtml(st.namaToko)}
              </div>
              <div style="font-size: 10px; color: var(--text-muted);">
                ${escapeHtml(st.kecamatan || st.kota || '')} &bull; MDS: ${escapeHtml(st.namaCrew || activeCrewName)}
              </div>
            </div>
            <div style="display: flex; align-items: center; gap: 4px; flex-shrink: 0;">
              ${actionHtml}
            </div>
          </div>
        `;
      });
      if (container) container.innerHTML = html;

      // Render pin bernomor urut khusus (1, 2, 3...) dan garis polyline di peta
      renderSelectedRouteMarkersAndPolyline(stores);

      const validPoints = stores.filter(s => s.lat && s.lon && !isNaN(s.lat) && !isNaN(s.lon)).map(s => [s.lat, s.lon]);
      if (validPoints.length > 0) {
        const bounds = L.latLngBounds(validPoints);
        map.fitBounds(bounds, { padding: [120, 120], maxZoom: 16 });
      }
    }
    if (window.lucide) lucide.createIcons();
  } catch (err) {
    if (container) {
      container.innerHTML = `
        <div style="padding: 16px; text-align: center; color: var(--danger); font-size: 12px;">
          ${escapeHtml(err.message)}
        </div>
      `;
    }
    showToast(`Gagal memuat jadwal: ${err.message}`, "error");
    if (window.lucide) lucide.createIcons();
  } finally {
    hideBlockingLoader();
  }
}

/**
 * Modal Pemilih MDS untuk Mode Lihat Jadwal Read-Only
 */
async function openScheduleCrewModal() {
  const modal = document.getElementById("scheduleCrewModal");
  if (!modal) return;
  modal.classList.add("active");

  const searchInput = document.getElementById("scheduleCrewSearchInput");
  if (searchInput) searchInput.value = "";

  try {
    const crews = allMasterCrewsCache.length > 0 ? allMasterCrewsCache : await getAllCrew();
    renderScheduleCrewSearchResults(crews, "");
  } catch (e) {
    console.error(e);
  }
  if (window.lucide) lucide.createIcons();
}

function renderScheduleCrewSearchResults(crews, query = "") {
  const container = document.getElementById("scheduleCrewSearchResultsList");
  if (!container) return;

  const q = (query || "").trim().toLowerCase();
  let filtered = crews || [];
  if (q) {
    filtered = filtered.filter(c => {
      const matchNama = (c.nama || "").toLowerCase().includes(q);
      const matchId = (c.id || "").toLowerCase().includes(q);
      const matchMod = (c.modul || "").toLowerCase().includes(q);
      return matchNama || matchId || matchMod;
    });
  }

  if (filtered.length === 0) {
    container.innerHTML = `
      <div style="padding: 14px; text-align: center; color: var(--text-muted); font-size: 11.5px;">
        Tidak ada MDS yang cocok dengan "${escapeHtml(query)}"
      </div>
    `;
    return;
  }

  let html = "";
  filtered.forEach(c => {
    const initials = (c.nama || "MDS").split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase();
    const isCurrentActive = (c.id || "") === (state.profile.kodeCrew || "") && (c.nama || "") === (state.profile.nama || "");
    const cleanModul = (c.modul || "LP4").replace(/\s+/g, "").toUpperCase();

    html += `
      <div class="crew-item-card" onclick="selectScheduleCrewToInspect('${escapeHtml(c.nama)}', '${escapeHtml(c.id || '')}', '${escapeHtml(cleanModul)}', '${escapeHtml(c.account || 'ALFAMART')}')">
        <div style="display: flex; align-items: center; gap: 8px; min-width: 0;">
          <div class="crew-item-avatar">${initials}</div>
          <div style="min-width: 0;">
            <div style="font-weight: 700; font-size: 12px; color: var(--text-main); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
              ${escapeHtml(c.nama)} ${isCurrentActive ? '<span style="font-size: 9px; background: var(--primary-light); color: var(--primary); padding: 1px 5px; border-radius: 99px;">(Profil Saya)</span>' : ''}
            </div>
            <div style="font-size: 10.5px; color: var(--text-muted);">
              ID: ${escapeHtml(c.id || '-')} &bull; ${escapeHtml(c.account || 'ALFAMART')}
            </div>
          </div>
        </div>
        <div style="display: flex; align-items: center; gap: 6px; flex-shrink: 0;">
          <span style="font-size: 10px; font-weight: 800; background: var(--bg-main); border: 1px solid var(--border); padding: 2px 6px; border-radius: var(--radius-sm); color: var(--primary);">
            ${escapeHtml(cleanModul)}
          </span>
          <i data-lucide="eye" style="width: 14px; height: 14px; color: var(--primary);"></i>
        </div>
      </div>
    `;
  });

  container.innerHTML = html;
  if (window.lucide) lucide.createIcons();
}

window.selectScheduleCrewToInspect = function (nama, id, modul, account) {
  document.getElementById("scheduleCrewModal")?.classList.remove("active");
  const selected = { nama, id, kodeCrew: id, modul, account };
  loadScheduledStores(selected);
  showToast(`Melihat jadwal rute ${nama} (${modul}) [Read-Only]`, "info");
};

function resetScheduleToMyProfile() {
  state.inspectingCrew = null;
  loadScheduledStores(null);
  showToast("Kembali ke Jadwal Rute Saya", "success");
}

/**
 * Konfirmasi & Eksekusi Hapus 1 Toko dari Jadwal di Google Spreadsheet
 */
window.confirmDeleteStoreFromSchedule = async function (kodeToko, namaToko) {
  const ok = await showCustomConfirm({
    title: "Batalkan dari Jadwal Rute?",
    message: `Toko "${namaToko}" (${kodeToko}) akan dibatalkan dari Jadwal Rute ${state.currentRute} (${state.profile.modul}).\n\nToko ini akan bebas kembali untuk dijadwalkan ulang.`,
    type: "danger",
    icon: "trash-2",
    okText: "Ya, Batalkan",
    cancelText: "Kembali"
  });

  if (!ok) return;

  showBlockingLoader(
    "Menghapus dari Jadwal",
    `Menghapus ${namaToko} dari jadwal Rute ${state.currentRute}...`,
    false
  );

  try {
    await deleteScheduledStoreFromCloud({
      module: state.profile.modul,
      rute: state.currentRute,
      crewCode: state.profile.kodeCrew,
      kodeToko: kodeToko
    });

    showToast(`Toko ${namaToko} (${kodeToko}) berhasil dihapus dari jadwal Rute ${state.currentRute}!`, "success");

    // Auto-reload jadwal dari Google Sheet
    await loadScheduledStores();
  } catch (err) {
    showToast(`Gagal menghapus toko: ${err.message}`, "error");
  } finally {
    hideBlockingLoader();
    if (map) map.closePopup();
  }
};

/**
 * Utility: Bulletproof Copy to Clipboard (Works on HTTPS, HTTP LAN, and all Mobile devices)
 */
function safeCopyToClipboard(text, successMsg = "Teks berhasil disalin ke clipboard!") {
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text).then(() => {
      showToast(successMsg, "success");
    }).catch(() => {
      fallbackExecCommandCopy(text, successMsg);
    });
    return;
  }
  fallbackExecCommandCopy(text, successMsg);
}

function fallbackExecCommandCopy(text, successMsg) {
  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    textarea.style.top = "-9999px";
    textarea.style.opacity = "0";
    textarea.setAttribute("readonly", "");
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    textarea.setSelectionRange(0, textarea.value.length);

    const successful = document.execCommand("copy");
    document.body.removeChild(textarea);

    if (successful) {
      showToast(successMsg, "success");
    } else {
      showToast("Gagal menyalin ke clipboard", "warning");
    }
  } catch (err) {
    console.error("Copy failed:", err);
    showToast("Gagal menyalin ke clipboard", "error");
  }
}

/**
 * Generator Salin Format WhatsApp
 */
function copyWhatsAppSummary() {
  if (state.selectedStores.size === 0) {
    showToast("Tidak ada toko untuk disalin!", "warning");
    return;
  }

  const dateStr = new Date().toLocaleDateString('id-ID', {
    day: '2-digit',
    month: 'long',
    year: 'numeric'
  });

  let text = `*LAPORAN JADWAL RUTE MDS*\n`;
  text += `👤 *Nama Crew*: ${state.profile.nama}\n`;
  text += `🆔 *Kode Crew*: ${state.profile.kodeCrew || '-'}\n`;
  text += `📍 *Modul*: ${state.profile.modul}\n`;
  text += `📅 *Rute*: Rute ${state.currentRute} (${dateStr})\n`;
  text += `🏪 *Total Toko*: ${state.selectedStores.size} Toko\n\n`;
  text += `*DAFTAR KUNJUNGAN TOKO:*\n`;

  let idx = 1;
  state.selectedStores.forEach((store) => {
    text += `${idx++}. [${store.account}] ${store.kodeToko} - ${store.namaToko}\n`;
  });

  text += `\n_Tercatat via Retail Ops Rute Master_`;

  safeCopyToClipboard(text, "Format laporan WA berhasil disalin ke clipboard!");
}

function copyScheduleViewWA() {
  if (!state.scheduleStores || state.scheduleStores.length === 0) {
    showToast(`Tidak ada toko terjadwal di Rute ${state.currentRute}!`, "warning");
    return;
  }

  let text = `*JADWAL KUNJUNGAN MDS (TERJADWAL)*\n`;
  text += `👤 *Nama Crew*: ${state.profile.nama}\n`;
  text += `🆔 *Kode Crew*: ${state.profile.kodeCrew || '-'}\n`;
  text += `📍 *Modul*: ${state.profile.modul}\n`;
  text += `📅 *Rute*: Rute ${state.currentRute}\n`;
  text += `🏪 *Total Toko*: ${state.scheduleStores.length} Toko\n\n`;
  text += `*DAFTAR TOKO TERJADWAL:*\n`;

  state.scheduleStores.forEach((st, idx) => {
    text += `${idx + 1}. [${st.account}] ${st.kodeToko} - ${st.namaToko}\n`;
  });

  text += `\n_Laporan Jadwal Retail Ops Rute Master_`;

  safeCopyToClipboard(text, `Jadwal Rute ${state.currentRute} berhasil disalin ke clipboard!`);
}

/**
 * Modal Tambah / Edit Toko Handlers
 */
function openCustomStoreModal(initialData = null) {
  const modal = document.getElementById("customStoreModal");
  if (!modal) return;

  const modalTitle = modal.querySelector(".modal-title span");
  const accountInput = document.getElementById("customStoreAccount");
  const codeInput = document.getElementById("customStoreCode");
  const nameInput = document.getElementById("customStoreName");
  const cityInput = document.getElementById("customStoreCity");
  const distInput = document.getElementById("customStoreDistrict");
  const latInput = document.getElementById("customStoreLat");
  const lonInput = document.getElementById("customStoreLon");

  if (initialData && initialData.kodeToko) {
    if (modalTitle) modalTitle.textContent = `Edit Toko: ${initialData.namaToko || initialData.kodeToko}`;
    if (accountInput) accountInput.value = (initialData.account || "ALFAMART").toUpperCase();
    if (codeInput) codeInput.value = initialData.kodeToko || "";
    if (nameInput) nameInput.value = initialData.namaToko || "";
    if (cityInput) cityInput.value = initialData.kota || "";
    if (distInput) distInput.value = initialData.kecamatan || "";
    if (latInput) latInput.value = initialData.lat ? initialData.lat.toString() : "";
    if (lonInput) lonInput.value = initialData.lon ? initialData.lon.toString() : "";
  } else {
    if (modalTitle) modalTitle.textContent = "Tambah Toko Baru";
    document.getElementById("customStoreForm")?.reset();
    if (state.userLocation && latInput && lonInput) {
      latInput.value = state.userLocation[0].toFixed(6);
      lonInput.value = state.userLocation[1].toFixed(6);
    }
  }

  // Auto-detect jika user mengetik kode toko yang sudah ada
  if (codeInput) {
    codeInput.onblur = async () => {
      const val = codeInput.value.trim().toUpperCase();
      if (val && (!nameInput.value || nameInput.value === "")) {
        const selectedAcc = accountInput ? accountInput.value.trim().toUpperCase() : "";
        const existing = await getStoreByCode(val, selectedAcc);
        if (existing) {
          if (modalTitle) modalTitle.textContent = `Edit Toko: ${existing.namaToko}`;
          if (accountInput) accountInput.value = existing.account || "ALFAMART";
          if (nameInput) nameInput.value = existing.namaToko || "";
          if (cityInput) cityInput.value = existing.kota || "";
          if (distInput) distInput.value = existing.kecamatan || "";
          if (latInput && existing.lat) latInput.value = existing.lat;
          if (lonInput && existing.lon) lonInput.value = existing.lon;
          showToast(`Data toko ${existing.namaToko} ditemukan dan dimuat untuk diedit`, "warning");
        }
      }
    };
  }

  modal.classList.add("active");
}

function handleAutofillGps() {
  if (!("geolocation" in navigator)) {
    showToast("Fitur GPS tidak didukung di perangkat ini", "warning");
    return;
  }

  showToast("Mengambil titik koordinat GPS Anda...", "warning");
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const { latitude, longitude } = pos.coords;
      const latInput = document.getElementById("customStoreLat");
      const lonInput = document.getElementById("customStoreLon");

      if (latInput) latInput.value = latitude.toFixed(6);
      if (lonInput) lonInput.value = longitude.toFixed(6);

      showToast("Titik GPS berhasil disalin ke form!", "success");
    },
    (err) => {
      showToast(`Gagal membaca GPS: ${err.message}`, "error");
    },
    { enableHighAccuracy: true, timeout: 8000 }
  );
}

async function handleCustomStoreSave(e) {
  e.preventDefault();

  const account = document.getElementById("customStoreAccount").value.trim();
  const kodeToko = document.getElementById("customStoreCode").value.trim().toUpperCase();
  const namaToko = document.getElementById("customStoreName").value.trim();
  const kota = document.getElementById("customStoreCity").value.trim();
  const kecamatan = document.getElementById("customStoreDistrict").value.trim();
  const latVal = document.getElementById("customStoreLat").value.trim();
  const lonVal = document.getElementById("customStoreLon").value.trim();
  const autoAdd = document.getElementById("customStoreAutoAdd").checked;

  if (!kodeToko || !namaToko) {
    showToast("Kode Toko dan Nama Toko wajib diisi!", "warning");
    return;
  }

  // Proteksi Simulasi Tutorial (Tidak simpan ke DB server)
  if (state.isTourMode) {
    document.getElementById("customStoreModal")?.classList.remove("active");
    showToast(`[Simulasi Tutorial] Toko ${namaToko} (${kodeToko}) berhasil disimpan!`, "success");
    nextTourStep();
    return;
  }

  try {
    const savedStore = await saveCustomStore({
      kodeToko,
      namaToko,
      account,
      kota,
      kecamatan,
      lat: latVal ? parseFloat(latVal) : null,
      lon: lonVal ? parseFloat(lonVal) : null
    });

    document.getElementById("customStoreModal").classList.remove("active");

    if (autoAdd) {
      const sKey = getStoreKey(savedStore);
      state.selectedStores.set(sKey, savedStore);
      saveCurrentRouteDraft();
      const selectedArray = Array.from(state.selectedStores.values());
      renderSelectedRouteMarkersAndPolyline(selectedArray);
      updateFloatingBar();

      if (savedStore.lat && savedStore.lon) {
        map.flyTo([savedStore.lat, savedStore.lon], 16, { duration: 1.0 });
      }
      showToast(`Toko ${namaToko} (${kodeToko}) disimpan & masuk Rute ${state.currentRute}! (Disinkronkan ke Master)`, "success");
    } else {
      showToast(`Toko ${namaToko} (${kodeToko}) disimpan & disinkronkan ke Master Spreadsheet!`, "success");
    }

    // Sinkronkan ke Google Spreadsheet Master di background!
    syncCustomStoreToCloud(savedStore);

    await performSearch(elements.searchInput ? elements.searchInput.value : "");

  } catch (err) {
    showToast(`Gagal menyimpan toko: ${err.message}`, "error");
  }
}

/**
 * Modal Profil Handler - Edit Profil Pribadi & Live Searchable Master Crew
 */
let allMasterCrewsCache = [];

/**
 * 1. Buka Modal Edit Profil Pribadi (Khusus Tombol M)
 */
async function openProfileModal() {
  const modal = document.getElementById("profileModal");
  if (!modal) return;

  const nameInput = document.getElementById("profileNameInput");
  const codeInput = document.getElementById("profileCodeInput");
  const moduleSelect = document.getElementById("profileModuleSelect");

  if (nameInput) nameInput.value = state.profile.nama || "";
  if (codeInput) codeInput.value = state.profile.kodeCrew || "";
  if (moduleSelect) moduleSelect.value = state.profile.modul || "LP4";

  modal.classList.add("active");
  if (window.lucide) lucide.createIcons();
}

/**
 * 2. Buka Modal Cari & Pilih MDS dari Master Crew (Khusus Dropdown Nama di Top Bar)
 */
async function openCrewSelectModal() {
  const modal = document.getElementById("crewSelectModal");
  if (!modal) return;

  const searchInput = document.getElementById("crewSearchInput");
  const listContainer = document.getElementById("crewSearchResultsList");

  if (searchInput) searchInput.value = "";
  modal.classList.add("active");

  try {
    // 1. Tampilkan data dari IndexedDB lokal langsung agar instan tanpa lag
    allMasterCrewsCache = await getAllCrew();
    renderCrewSearchResults(allMasterCrewsCache, "");

    // 2. Selalu update dari Google Spreadsheet di background secara otomatis
    syncMasterCrewFromSheet().then((freshCrews) => {
      if (freshCrews && freshCrews.length > 0) {
        allMasterCrewsCache = freshCrews;
        const currentQ = document.getElementById("crewSearchInput")?.value || "";
        renderCrewSearchResults(allMasterCrewsCache, currentQ);
      }
    });
  } catch (err) {
    console.warn("Could not load crews:", err);
    if (listContainer) {
      listContainer.innerHTML = `<div style="padding: 12px; text-align: center; color: var(--danger); font-size: 11px;">Gagal memuat master crew</div>`;
    }
  }

  // Bind live search input
  if (searchInput && !searchInput.dataset.bound) {
    searchInput.dataset.bound = "true";
    searchInput.addEventListener("input", (e) => {
      const q = e.target.value.toLowerCase().trim();
      renderCrewSearchResults(allMasterCrewsCache, q);
    });
  }

  if (window.lucide) lucide.createIcons();
}

window.manualRefreshCrewList = async function () {
  const listContainer = document.getElementById("crewSearchResultsList");
  const btn = document.getElementById("btnSyncCrewModal");
  if (btn) btn.classList.add("spin");

  showBlockingLoader(
    "Menarik Master Crew...",
    "Mengunduh data user terbaru dari master spreadsheet...",
    true
  );
  updateBlockingLoaderProgress(40, "Sinkronisasi akun MDS...");

  try {
    const freshCrews = await syncMasterCrewFromSheet();
    updateBlockingLoaderProgress(100, "Selesai!");
    if (freshCrews && freshCrews.length > 0) {
      allMasterCrewsCache = freshCrews;
      const currentQ = document.getElementById("crewSearchInput")?.value || "";
      renderCrewSearchResults(allMasterCrewsCache, currentQ);
      showToast(`Berhasil menarik ${freshCrews.length} crew dari Google Sheet!`, "success");
    } else {
      showToast("Data crew di spreadsheet tidak ditemukan", "warning");
    }
  } catch (err) {
    showToast(`Gagal menarik data crew: ${err.message}`, "error");
  } finally {
    hideBlockingLoader();
    if (btn) btn.classList.remove("spin");
  }
};

function renderCrewSearchResults(crews, query) {
  const listContainer = document.getElementById("crewSearchResultsList");
  if (!listContainer) return;

  const cleanQuery = (query || "").toLowerCase().trim();
  let filtered = crews;

  if (cleanQuery) {
    const tokens = cleanQuery.split(/\s+/).filter(t => t.length > 0);
    filtered = crews.filter(c => {
      const searchStr = `${c.nama || ''} ${c.id || ''} ${c.modul || ''} ${c.account || ''}`.toLowerCase();
      return tokens.every(tok => searchStr.includes(tok));
    });
  }

  if (filtered.length === 0) {
    listContainer.innerHTML = `
      <div style="padding: 14px; text-align: center; color: var(--text-muted); font-size: 11.5px;">
        Tidak ada MDS yang cocok dengan "${escapeHtml(cleanQuery)}"
      </div>
    `;
    return;
  }

  const currentSelectedName = (state.profile.nama || "").toLowerCase().trim();

  let html = "";
  filtered.slice(0, 40).forEach(c => {
    const initials = (c.nama || "MDS")
      .split(" ")
      .map(w => w[0])
      .slice(0, 2)
      .join("")
      .toUpperCase();

    const cleanModul = (c.modul || "LP4").replace(/\s+/g, "").toUpperCase();
    const isCurrentActive = c.nama && c.nama.toLowerCase().trim() === currentSelectedName;

    html += `
      <div class="crew-item-card ${isCurrentActive ? 'active' : ''}" onclick="selectCrewFromList('${escapeHtml(c.nama)}', '${escapeHtml(c.id || '')}', '${escapeHtml(cleanModul)}', '${escapeHtml(c.account || 'ALFAMART')}')">
        <div style="display: flex; align-items: center; gap: 8px; min-width: 0;">
          <div class="crew-item-avatar">${initials}</div>
          <div style="min-width: 0;">
            <div style="font-size: 12px; font-weight: 700; color: var(--text-main); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
              ${escapeHtml(c.nama)} ${isCurrentActive ? '<span style="font-size: 9.5px; color: var(--primary); font-weight: 800;">(Aktif)</span>' : ''}
            </div>
            <div style="font-size: 10px; color: var(--text-muted);">
              ID: <strong>${escapeHtml(c.id || '-')}</strong> &bull; ${escapeHtml(c.account || 'ALFAMART')}
            </div>
          </div>
        </div>
        <div style="display: flex; align-items: center; gap: 6px; flex-shrink: 0;">
          <span style="font-size: 10px; font-weight: 800; background: var(--primary-light); color: var(--primary); padding: 2px 6px; border-radius: 99px;">
            ${escapeHtml(cleanModul)}
          </span>
          ${isCurrentActive ? '<i data-lucide="check-circle" style="width: 15px; height: 15px; color: var(--success);"></i>' : '<i data-lucide="chevron-right" style="width: 14px; height: 14px; color: var(--text-muted);"></i>'}
        </div>
      </div>
    `;
  });

  listContainer.innerHTML = html;
  if (window.lucide) lucide.createIcons();
}

window.selectCrewFromList = function (nama, code, modul, account) {
  state.profile = {
    nama: nama,
    kodeCrew: code || "",
    modul: modul || "LP4",
    account: account || "ALFAMART"
  };

  localStorage.setItem("mds_crew_profile", JSON.stringify(state.profile));
  renderProfileUI();

  document.getElementById("crewSelectModal")?.classList.remove("active");
  showToast(`MDS Terpilih: ${nama} (${modul})`, "success");

  // Jika sedang di tab jadwal terinput, otomatis muat jadwal rute untuk MDS terpilih
  if (state.currentView === "schedule") {
    loadScheduledStores();
  }
};

async function handleProfileSave(e) {
  e.preventDefault();
  const nama = document.getElementById("profileNameInput").value.trim();
  const kodeCrew = document.getElementById("profileCodeInput").value.trim();
  const modul = document.getElementById("profileModuleSelect").value.trim();

  if (!nama || !modul) {
    showToast("Nama dan Modul wajib diisi!", "warning");
    return;
  }

  state.profile = { nama, kodeCrew, modul };
  localStorage.setItem("mds_crew_profile", JSON.stringify(state.profile));
  renderProfileUI();
  elements.profileModal.classList.remove("active");
  showToast(`Profil aktif: ${nama} (${modul})`, "success");

  // Sinkronkan data crew/user ke Master Spreadsheet di background!
  syncCrewToCloud(state.profile);

  // Jika sedang berada di tab Jadwal Terinput -> otomatis reload jadwal MDS baru dari spreadsheet!
  if (state.currentView === "schedule") {
    await loadScheduledStores();
  } else {
    // Mode Input -> refresh validasi status toko (lock / revisit) untuk MDS yang baru dipilih
    if (state.searchResults.length > 0) {
      renderFloatingSearchResults(state.searchResults, state.searchResults.length > 0);
    }
    renderMapMarkers(state.searchResults, false);
  }
}

/**
 * Modal Settings Handler
 */
async function openSettingsModal() {
  const modal = elements.settingsModal;

  // Tampilkan jumlah toko dinamis dan waktu sinkronisasi terakhir
  try {
    const count = await getStoresCount();
    const badge = document.getElementById("dbStatusBadge");
    const lastSync = document.getElementById("dbLastSyncText");
    const lastSyncTime = localStorage.getItem("mds_last_store_sync") || "Belum pernah";

    if (badge) badge.textContent = `${count.toLocaleString()} Toko`;
    if (lastSync) lastSync.textContent = `Terakhir disinkronkan: ${lastSyncTime}`;
  } catch (e) {
    console.warn("Gagal membaca status DB:", e);
  }

  modal.classList.add("active");
}

/**
 * Modal Riwayat Handler
 */
async function openHistoryModal() {
  const modal = elements.historyModal;
  const container = document.getElementById("historyListContainer");

  try {
    const history = await getHistoryEntries(20);
    if (!history || history.length === 0) {
      container.innerHTML = `
        <div style="padding: 24px; text-align: center; color: var(--text-muted); font-size: 13px;">
          Belum ada riwayat penginputan rute
        </div>
      `;
    } else {
      let html = "";
      history.forEach(item => {
        const timeStr = new Date(item.timestamp).toLocaleString('id-ID', {
          dateStyle: 'medium',
          timeStyle: 'short'
        });

        html += `
          <div style="background: var(--bg-main); border: 1px solid var(--border); border-radius: var(--radius-md); padding: 10px 12px; display: flex; flex-direction: column; gap: 3px;">
            <div style="display: flex; align-items: center; justify-content: space-between;">
              <span style="font-weight: 700; font-size: 13px; color: var(--primary);">Rute ${item.rute} (${item.module})</span>
              <span style="font-size: 10px; color: var(--text-muted);">${timeStr}</span>
            </div>
            <div style="font-size: 11px; color: var(--text-main); font-weight: 600;">
              ${item.storeCount} Toko &bull; Crew: ${escapeHtml(item.crewName)} (${escapeHtml(item.crewCode || '-')})
            </div>
            <div style="font-size: 10px; color: var(--success); font-weight: 700;">
              ${escapeHtml(item.status || 'Terkirim')}
            </div>
          </div>
        `;
      });
      container.innerHTML = html;
    }
    if (window.lucide) lucide.createIcons();
    modal.classList.add("active");
  } catch (err) {
    showToast("Gagal memuat riwayat", "error");
  }
}

/**
 * Helper Toast Notification
 */
function showToast(message, type = "success") {
  const container = elements.toastContainer;
  if (!container) return;

  const toast = document.createElement("div");
  toast.className = `toast ${type}`;

  const iconMap = {
    success: 'check-circle-2',
    error: 'alert-circle',
    warning: 'alert-triangle'
  };

  toast.innerHTML = `
    <i data-lucide="${iconMap[type] || 'info'}" style="color: var(--${type === 'warning' ? 'warning' : type}); width: 16px; height: 16px;"></i>
    <span style="flex: 1;">${escapeHtml(message)}</span>
  `;

  container.appendChild(toast);
  if (window.lucide) lucide.createIcons();

  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translate(-50%, -10px)";
    setTimeout(() => toast.remove(), 250);
  }, 4000);
}

function escapeHtml(str) {
  if (!str) return "";
  return str.toString()
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/* ===================================================
   HELP MODAL & SPOTLIGHT INTERACTIVE TOUR CONTROLLER
   =================================================== */

function openHelpModal() {
  const modal = elements.helpModal;
  if (!modal) return;
  modal.classList.add("active");
  if (window.lucide) lucide.createIcons();
}

function closeHelpModal() {
  const modal = elements.helpModal;
  if (modal) modal.classList.remove("active");
}

// Data Dummy Khusus Simulasi Tur Interaktif
const DUMMY_TOUR_STORES = [
  {
    kodeToko: "1V01",
    account: "ALFAMART",
    namaToko: "ALFAMART SUDIRMAN",
    kota: "JAKARTA PUSAT",
    kecamatan: "TANAH ABANG",
    lat: -6.2088,
    lon: 106.8200
  },
  {
    kodeToko: "TYQZ",
    account: "INDOMARET",
    namaToko: "INDOMARET AHMAD YANI",
    kota: "JAKARTA PUSAT",
    kecamatan: "CEMPAKA PUTIH",
    lat: -6.1850,
    lon: 106.8450
  }
];

let savedRealSelectedStores = null;

function closeAllModalsForTour() {
  document.querySelectorAll(".modal-backdrop").forEach(m => m.classList.remove("active"));
}

function setupTourDummyStores() {
  state.selectedStores.clear();
  DUMMY_TOUR_STORES.forEach(st => {
    state.selectedStores.set(getStoreKey(st), { ...st });
  });
  renderSelectedRouteMarkersAndPolyline(Array.from(state.selectedStores.values()));
  updateFloatingBar();
}

// Konfigurasi Langkah-Langkah Tur Interaktif (Lengkap & Terperinci untuk MDS)
const TOUR_STEPS = [
  {
    target: "#btnSelectMdsDropdown",
    title: "👤 1. Pilih MDS & Tombol Edit Profil",
    desc: "• Tombol Ikon Orang (👤): Klik untuk mengedit Profil Anda (Nama, ID & Modul Wilayah Kerja).\n• Bar Nama MDS: Klik untuk mencari & memilih rekan MDS lain dari Master Crew jika ingin melihat rute mereka.",
    tip: "Data akun Anda aman dan tidak akan tertimpa saat memilih atau mengintip jadwal rekan.",
    action: () => {
      closeAllModalsForTour();
      switchAppView("input");
    }
  },
  {
    target: "#routeDatePickerWrapper",
    title: "📅 2. Kalender Tanggal Rute (1 - 31)",
    desc: "Klik tombol kalender ini untuk memilih tanggal kunjungan kerja Anda. Sistem otomatis mengambil angka tanggalnya (Rute 1 - 31) agar sesuai dengan database Google Spreadsheet.",
    tip: "Aplikasi otomatis memilih tanggal hari ini saat dibuka.",
    action: () => {
      closeAllModalsForTour();
      switchAppView("input");
    }
  },
  {
    target: "#searchInput",
    title: "🔍 3. Cari Toko di Database",
    desc: "Ketik min. 4 huruf nama toko, kode toko, atau nama kecamatan. Daftar toko yang cocok akan otomatis muncul di bawah kotak pencarian.",
    tip: "Gunakan tombol filter brand di bawahnya (Indomaret, Alfamart, Alfamidi, Lawson) untuk menyaring hasil pencarian.",
    action: () => {
      closeAllModalsForTour();
      switchAppView("input");
    }
  },
  {
    target: "#floatingBar",
    title: "➕ 4. Cara Menambah Toko ke Rute",
    desc: "Ada 2 cara mudah:\n1. Klik tombol (+) biru/hijau di sebelah kanan nama toko pada hasil pencarian.\n2. Atau klik Pin toko di peta lalu pilih 'Masukkan ke Rute'.\nToko otomatis masuk ke keranjang rute bawah ini dan mendapat nomor urut (#1, #2, dst).",
    tip: "Contoh simulasi: 2 toko dummy (#1 Alfamart Sudirman & #2 Indomaret Ahmad Yani) telah dimasukkan ke rute Anda.",
    action: () => {
      closeAllModalsForTour();
      switchAppView("input");
      setupTourDummyStores();
      elements.floatingBar?.classList.add("visible");
    }
  },
  {
    target: "#drawerModal .modal-dialog",
    title: "📋 5. Review & Cek Urutan Rute",
    desc: "Klik tombol 'Review' di bar bawah untuk membuka daftar toko terpilih ini. Di sini Anda bisa memeriksa nomor urut toko, rincian lokasi, atau menyalin teks laporan WhatsApp.",
    tip: "Tombol 'Salin WA' akan menghasilkan format rekap rute rapi siap kirim ke grup WhatsApp supervisor.",
    action: () => {
      setupTourDummyStores();
      openDrawerModal();
    }
  },
  {
    target: "#drawerStoreList",
    title: "🗑️ 6. Hapus / Batalkan Toko dari Rute",
    desc: "Jika salah memilih toko, Anda cukup klik ikon tong sampah merah (🗑️) di review drawer ini, atau klik 'Keluarkan dari Rute' pada popup pin toko di peta.",
    tip: "⚠️ PENTING: Ini HANYA membatalkan toko dari jadwal rute hari ini, BUKAN menghapus data toko dari master Google Sheet!",
    action: () => {
      setupTourDummyStores();
      openDrawerModal();
    }
  },
  {
    target: "#customStoreModal .modal-dialog",
    title: "✍️ 7. Tambah Toko Baru (Bisa dari Mana Saja)",
    desc: "Jika ada toko yang belum terdaftar di database, Anda bisa menambahkannya KAPAN SAJA (dari rumah/kantor). Cukup isi Akun, Kode Toko & Nama Toko. Alamat & Titik GPS BOLEH DIKOSONGKAN (opsional) jika belum tahu!",
    tip: "💡 Jika pas sedang berada di depan tokonya, barulah Anda bisa klik tombol 'Gunakan Lokasi GPS Saya' untuk mengambil koordinat otomatis.",
    action: () => {
      closeAllModalsForTour();
      switchAppView("input");
      openCustomStoreModal({
        account: "INDOMARET",
        kodeToko: "IDM999",
        namaToko: "INDOMARET BARU DUMMY",
        kota: "KOTA JAKARTA",
        kecamatan: "GAMBIR",
        lat: "",
        lon: ""
      });
    }
  },
  {
    target: "#customStoreModal .modal-dialog",
    title: "✏️ 8. Tombol Edit (Pensil) pada Toko",
    desc: "Pada setiap toko hasil pencarian dan popup peta ada tombol pensil (✏️ Edit). Klik tombol pensil ini kapan saja jika Anda ingin memperbaiki titik koordinat peta yang melenceng atau mengubah nama toko.",
    tip: "Setelah disimpan, posisi pin toko di peta Anda akan langsung berpindah ke titik yang benar.",
    action: () => {
      closeAllModalsForTour();
      switchAppView("input");
      openCustomStoreModal({
        account: "ALFAMART",
        kodeToko: "1V01",
        namaToko: "ALFAMART SUDIRMAN",
        kota: "JAKARTA PUSAT",
        kecamatan: "TANAH ABANG",
        lat: -6.2088,
        lon: 106.8200
      });
    }
  },
  {
    target: "#btnSubmitRoute",
    title: "🚀 9. Kirim Jadwal ke 3 Google Spreadsheet",
    desc: "Setelah rute selesai disusun, klik tombol 'Kirim' di bar bawah. Sistem otomatis mendistribusikan data ke 3 Google Sheet: Spreadsheet Modul Anda, Data External, dan Sheet Absen.",
    tip: "Data selama simulasi tutorial ini 100% dummy dan tidak akan dikirim ke server.",
    action: () => {
      closeAllModalsForTour();
      switchAppView("input");
      setupTourDummyStores();
      elements.floatingBar?.classList.add("visible");
    }
  },
  {
    target: "#tabBtnSchedule",
    title: "👁️ 10. Beralih ke Mode 'Jadwal Saya'",
    desc: "Klik tombol bulat mata (👁️) di kanan bawah untuk melihat jadwal rute yang sudah tersimpan di Google Sheet. Toko yang terkirim akan ditandai pin bernomor dan garis rute di peta.",
    tip: "Klik tombol (+) di atasnya kapan saja untuk kembali ke mode input / pencarian toko.",
    action: () => {
      closeAllModalsForTour();
      switchAppView("schedule");
    }
  },
  {
    target: "#btnRefreshSchedule",
    title: "🔄 11. Tombol 'Refresh Jadwal' Rute",
    desc: "Tombol putar kecil (🔄) di kartu jadwal ini untuk menyegarkan / menarik ulang jadwal rute hari ini dari Google Sheet.\n\n💡 Kapan dipakai? Jika Anda baru saja input dari HP rekan, atau ingin melihat jadwal rute yang baru diupdate tanpa harus keluar-masuk web.",
    tip: "Tombol ini HANYA menyegarkan jadwal rute hari ini (proses sangat kilat dalam 1 detik).",
    action: () => {
      closeAllModalsForTour();
      switchAppView("schedule");
    }
  },
  {
    target: "#btnForceSync",
    title: "📦 12. Tombol 'Sync Master Toko'",
    desc: "Ada di menu 'Pengaturan & Sync'. Tombol ini untuk mengunduh ulang seluruh database master toko terbaru dari Google Sheet pusat ke memori HP Anda.\n\n💡 Kapan dipakai? HANYA jika ada puluhan toko baru yang baru ditambahkan di master pusat dan belum muncul saat dicari di HP Anda.",
    tip: "Cukup dijalankan sesekali saat ada update master toko besar dari koordinator.",
    action: () => {
      closeAllModalsForTour();
      openSettingsModal();
    }
  },
  {
    target: "#btnHardRefreshMobile",
    title: "⚡ 13. Bersihkan Cache & Hard Refresh HP",
    desc: "Gunakan tombol petir (⚡) ini jika web di HP Anda terasa lambat/hang, tombol tidak merespon, atau tampilan web belum terupdate setelah perbaikan sistem.\n\n💡 Cara Kerja: Menghapus cache file lama di browser HP dan memuat ulang file aplikasi paling segar dari server secara otomatis.",
    tip: "Solusi kilat nomor 1 jika web di HP Anda mengalami kendala tampilan atau lag!",
    action: () => {
      closeAllModalsForTour();
      openSettingsModal();
    }
  },
  {
    target: "#btnSettingsInstallPwa",
    title: "📲 14. Install Aplikasi ke HP (PWA)",
    desc: "Aplikasi ini adalah PWA (Progressive Web App) yang bisa di-install langsung ke layar utama HP Android Anda!\n\n• Caranya: Klik tombol 'Install Aplikasi ke HP' ini atau buka titik-3 Chrome dan pilih 'Tambahkan ke Layar Utama'.\n• Keuntungan: Muncul di homescreen dengan ikon keren, berjalan fullscreen tanpa URL bar, dan jauh lebih hemat kuota!",
    tip: "Setelah di-install, cukup klik ikon 'Web Absen' di menu HP untuk langsung bekerja!",
    action: () => {
      closeAllModalsForTour();
      openSettingsModal();
    }
  }
];

let currentTourStep = 0;

function startInteractiveTour() {
  currentTourStep = 0;
  if (!elements.tourOverlay) return;
  savedRealSelectedStores = new Map(state.selectedStores);
  state.isTourMode = true;
  elements.tourOverlay.style.display = "block";
  renderTourStep(currentTourStep);
}

function endInteractiveTour() {
  closeAllModalsForTour();
  if (elements.tourOverlay) elements.tourOverlay.style.display = "none";
  localStorage.setItem("mds_tour_completed", "true");
  state.isTourMode = false;

  // Restore real user state
  state.selectedStores = savedRealSelectedStores ? new Map(savedRealSelectedStores) : new Map();
  switchAppView("input");
  renderMapMarkers(state.searchResults, false);
  renderSelectedRouteMarkersAndPolyline(Array.from(state.selectedStores.values()));
  renderFloatingSearchResults(state.searchResults, false);
  updateFloatingBar();
}

function nextTourStep() {
  if (currentTourStep < TOUR_STEPS.length - 1) {
    currentTourStep++;
    renderTourStep(currentTourStep);
  } else {
    endInteractiveTour();
    showToast("Selamat bertugas! Anda siap menggunakan Web Absen MDS 🚀", "success");
  }
}

function prevTourStep() {
  if (currentTourStep > 0) {
    currentTourStep--;
    renderTourStep(currentTourStep);
  }
}

function renderTourStep(index) {
  const step = TOUR_STEPS[index];
  if (!step) return;

  // Jalankan aksi simulasi per langkah (buka modal, pasang toko dummy, dsb)
  if (typeof step.action === "function") {
    step.action();
  }

  const spotlight = elements.tourSpotlight;
  const tooltip = elements.tourTooltip;

  // Step Badge
  if (elements.tourStepBadge) {
    elements.tourStepBadge.textContent = `Langkah ${index + 1} / ${TOUR_STEPS.length}`;
  }

  // Content
  if (elements.tourTitle) elements.tourTitle.textContent = step.title;
  if (elements.tourDesc) elements.tourDesc.textContent = step.desc;

  // Tip
  if (step.tip && elements.tourTipBox && elements.tourTipText) {
    elements.tourTipText.textContent = step.tip;
    elements.tourTipBox.style.display = "flex";
  } else if (elements.tourTipBox) {
    elements.tourTipBox.style.display = "none";
  }

  // Buttons
  if (elements.tourBtnPrev) {
    elements.tourBtnPrev.style.display = index === 0 ? "none" : "inline-flex";
  }
  if (elements.tourBtnNext) {
    elements.tourBtnNext.innerHTML = index === TOUR_STEPS.length - 1
      ? `<span>Selesai</span> <i data-lucide="check" style="width: 14px; height: 14px;"></i>`
      : `<span>Lanjut</span> <i data-lucide="chevron-right" style="width: 14px; height: 14px;"></i>`;
  }

  if (window.lucide) lucide.createIcons();

  // Position Spotlight & Tooltip with requestAnimationFrame for rendered DOM
  requestAnimationFrame(() => {
    const targetEl = document.querySelector(step.target);
    if (targetEl && spotlight && tooltip) {
      const rect = targetEl.getBoundingClientRect();
      const pad = 6;

      // Spotlight rect
      spotlight.style.top = `${Math.max(0, rect.top - pad)}px`;
      spotlight.style.left = `${Math.max(0, rect.left - pad)}px`;
      spotlight.style.width = `${rect.width + (pad * 2)}px`;
      spotlight.style.height = `${rect.height + (pad * 2)}px`;

      // Tooltip position calculation (anti-overflow & anti-clipping)
      const windowWidth = window.innerWidth;
      const windowHeight = window.innerHeight;
      const tooltipHeight = tooltip.offsetHeight || 260;
      const tooltipWidth = Math.min(320, windowWidth - 32);

      let tooltipLeft = Math.max(16, Math.min(rect.left + (rect.width / 2) - (tooltipWidth / 2), windowWidth - tooltipWidth - 16));
      let tooltipTop;

      const spaceBelow = windowHeight - (rect.bottom + pad);
      const spaceAbove = rect.top - pad;

      if (spaceBelow >= tooltipHeight + 16) {
        tooltipTop = rect.bottom + pad + 10;
      } else if (spaceAbove >= tooltipHeight + 16) {
        tooltipTop = rect.top - pad - tooltipHeight - 10;
      } else {
        tooltipTop = Math.max(12, (windowHeight - tooltipHeight) / 2);
      }

      // Pastikan tidak pernah kepotong di bagian atas ataupun bawah layar
      tooltipTop = Math.max(12, Math.min(tooltipTop, windowHeight - tooltipHeight - 12));

      tooltip.style.top = `${tooltipTop}px`;
      tooltip.style.left = `${tooltipLeft}px`;

      targetEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  });
}

/* ===================================================
   REALTIME MDS INPUT MONITORING MODULE
   =================================================== */
let monitoringState = {
  rute: null,
  data: null,
  activeTab: 'pending', // 'pending' | 'submitted'
  modulFilter: 'ALL',
  searchQuery: ''
};

async function openMonitoringModal() {
  const modal = document.getElementById("monitoringModal");
  if (!modal) return;

  const select = document.getElementById("monitoringRuteSelect");
  if (select && select.options.length === 0) {
    for (let i = 1; i <= 31; i++) {
      const opt = document.createElement("option");
      opt.value = i;
      opt.textContent = `Rute ${i} ${i === state.currentRute ? '(Hari Ini)' : ''}`;
      select.appendChild(opt);
    }
    select.value = state.currentRute;
    select.addEventListener("change", (e) => {
      loadMonitoringData(e.target.value);
    });
  } else if (select) {
    select.value = state.currentRute;
  }

  // Bind monitoring search input
  const monSearchInput = document.getElementById("monitoringSearchInput");
  if (monSearchInput && !monSearchInput.dataset.bound) {
    monSearchInput.dataset.bound = "true";
    monSearchInput.addEventListener("input", (e) => {
      monitoringState.searchQuery = e.target.value.toLowerCase().trim();
      renderMonitoringList();
    });
  }

  modal.classList.add("active");
  if (window.lucide) lucide.createIcons();

  await loadMonitoringData(select ? select.value : state.currentRute);
}

async function loadMonitoringData(rute) {
  monitoringState.rute = rute;
  const listContainer = document.getElementById("monitoringListContainer");
  const refreshBtn = document.getElementById("btnRefreshMonitoring");
  if (refreshBtn) refreshBtn.classList.add("spin");

  showBlockingLoader(
    `Memeriksa Monitoring Rute ${rute}...`,
    "Menghubungkan ke seluruh Google Spreadsheet modul...",
    true
  );
  updateBlockingLoaderProgress(35, "Scanning jadwal modul DK, LK, LP...");

  if (listContainer) {
    listContainer.innerHTML = `
      <div style="text-align: center; padding: 24px; color: var(--text-muted); font-size: 11.5px;">
        <i data-lucide="loader-2" class="spin" style="width: 20px; height: 20px; margin-bottom: 6px; color: var(--primary);"></i>
        <div>Memeriksa status input Rute ${rute} di seluruh modul...</div>
      </div>
    `;
    if (window.lucide) lucide.createIcons();
  }

  try {
    updateBlockingLoaderProgress(70, "Mencocokkan data MDS terdaftar...");
    const data = await fetchMdsMonitoringStatus(rute);

    // Filter out Admin / ID RO036 dari KPI & Rekap Monitoring Lapangan
    data.pending = (data.pending || []).filter(c => {
      const cleanId = (c.id || '').toString().trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
      const cleanNama = (c.nama || '').toLowerCase();
      return cleanId !== 'RO036' && !cleanNama.includes('yohandi');
    });
    data.submitted = (data.submitted || []).filter(c => {
      const cleanId = (c.id || '').toString().trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
      const cleanNama = (c.nama || '').toLowerCase();
      return cleanId !== 'RO036' && !cleanNama.includes('yohandi');
    });
    data.totalCrew = data.pending.length + data.submitted.length;
    data.pendingCount = data.pending.length;
    data.submittedCount = data.submitted.length;
    data.percentage = data.totalCrew > 0 ? Math.round((data.submittedCount / data.totalCrew) * 100) : 0;

    monitoringState.data = data;
    updateBlockingLoaderProgress(100, "Selesai!");

    // Update numbers
    const totalEl = document.getElementById("monTotalCrew");
    const subEl = document.getElementById("monSubmittedCount");
    const pendEl = document.getElementById("monPendingCount");
    const percLabel = document.getElementById("monPercentageLabel");
    const progBar = document.getElementById("monProgressBar");
    const tabPendingText = document.getElementById("monTabPendingText");
    const tabSubmittedText = document.getElementById("monTabSubmittedText");

    if (totalEl) totalEl.textContent = data.totalCrew;
    if (subEl) subEl.textContent = data.submittedCount;
    if (pendEl) pendEl.textContent = data.pendingCount;
    if (percLabel) percLabel.textContent = `${data.percentage}%`;
    if (progBar) progBar.style.width = `${data.percentage}%`;
    if (tabPendingText) tabPendingText.textContent = `Belum Input (${data.pendingCount})`;
    if (tabSubmittedText) tabSubmittedText.textContent = `Sudah Input (${data.submittedCount})`;

    renderMonitoringList();
    showToast(`Data monitoring Rute ${rute} berhasil dimuat!`, "success");
  } catch (err) {
    if (listContainer) {
      listContainer.innerHTML = `
        <div style="text-align: center; padding: 20px; color: var(--danger); font-size: 11.5px;">
          Gagal memuat monitoring: ${escapeHtml(err.message)}
        </div>
      `;
    }
    showToast(`Gagal memuat monitoring: ${err.message}`, "error");
  } finally {
    hideBlockingLoader();
    if (refreshBtn) refreshBtn.classList.remove("spin");
  }
}

function renderMonitoringList() {
  const listContainer = document.getElementById("monitoringListContainer");
  if (!listContainer || !monitoringState.data) return;

  const isPending = monitoringState.activeTab === 'pending';
  let list = isPending ? monitoringState.data.pending : monitoringState.data.submitted;

  // Filter modul group (DK, LK, LP)
  if (monitoringState.modulFilter && monitoringState.modulFilter !== 'ALL') {
    list = list.filter(c => (c.modul || '').toUpperCase().startsWith(monitoringState.modulFilter));
  }

  // Filter search query
  if (monitoringState.searchQuery) {
    const q = monitoringState.searchQuery;
    list = list.filter(c => {
      const str = `${c.nama || ''} ${c.id || ''} ${c.modul || ''} ${c.account || ''}`.toLowerCase();
      return str.includes(q);
    });
  }

  if (list.length === 0) {
    listContainer.innerHTML = `
      <div style="text-align: center; padding: 20px; color: var(--text-muted); font-size: 11.5px;">
        ${isPending ? '🎉 Semua MDS di kategori ini sudah input rute!' : 'Belum ada MDS yang input rute di kategori ini'}
      </div>
    `;
    return;
  }

  let html = "";
  list.forEach((c, idx) => {
    const initials = (c.nama || "MDS")
      .split(" ")
      .map(w => w[0])
      .slice(0, 2)
      .join("")
      .toUpperCase();

    const cleanModul = (c.modul || "MODUL").replace(/\s+/g, "").toUpperCase();

    if (isPending) {
      html += `
        <div class="mon-crew-card pending">
          <div style="display: flex; align-items: center; gap: 8px; min-width: 0;">
            <div class="crew-item-avatar" style="background: linear-gradient(135deg, #ef4444, #f97316);">${initials}</div>
            <div style="min-width: 0;">
              <div style="font-size: 12px; font-weight: 700; color: var(--text-main); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                ${idx + 1}. ${escapeHtml(c.nama)}
              </div>
              <div style="font-size: 10px; color: var(--text-muted);">
                ID: <strong>${escapeHtml(c.id || '-')}</strong> &bull; ${escapeHtml(c.account || 'ALFAMART')}
              </div>
            </div>
          </div>
          <div style="display: flex; align-items: center; gap: 6px; flex-shrink: 0;">
            <span style="font-size: 10px; font-weight: 800; background: var(--danger-light); color: var(--danger); padding: 2px 8px; border-radius: 99px;">
              ${escapeHtml(cleanModul)}
            </span>
            <span style="font-size: 10px; font-weight: 700; color: var(--danger);">⏳ Belum</span>
          </div>
        </div>
      `;
    } else {
      html += `
        <div class="mon-crew-card submitted">
          <div style="display: flex; align-items: center; gap: 8px; min-width: 0;">
            <div class="crew-item-avatar" style="background: linear-gradient(135deg, #10b981, #059669);">${initials}</div>
            <div style="min-width: 0;">
              <div style="font-size: 12px; font-weight: 700; color: var(--text-main); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                ${idx + 1}. ${escapeHtml(c.nama)}
              </div>
              <div style="font-size: 10px; color: var(--text-muted);">
                ID: <strong>${escapeHtml(c.id || '-')}</strong> &bull; ${escapeHtml(c.account || 'ALFAMART')}
              </div>
            </div>
          </div>
          <div style="display: flex; align-items: center; gap: 6px; flex-shrink: 0;">
            <span style="font-size: 10px; font-weight: 800; background: var(--primary-light); color: var(--primary); padding: 2px 8px; border-radius: 99px;">
              ${escapeHtml(cleanModul)}
            </span>
            <span style="font-size: 10px; font-weight: 800; background: var(--success-light); color: var(--success); padding: 2px 8px; border-radius: 99px;">
              ✅ ${c.storeCount} Toko
            </span>
          </div>
        </div>
      `;
    }
  });

  listContainer.innerHTML = html;
  if (window.lucide) lucide.createIcons();
}

window.switchMonitoringTab = function (tab) {
  monitoringState.activeTab = tab;
  const btnPending = document.getElementById("btnMonTabPending");
  const btnSubmitted = document.getElementById("btnMonTabSubmitted");

  if (tab === 'pending') {
    btnPending?.classList.add("active");
    btnSubmitted?.classList.remove("active");
  } else {
    btnSubmitted?.classList.add("active");
    btnPending?.classList.remove("active");
  }

  renderMonitoringList();
};

window.filterMonitoringByModule = function (modulGroup) {
  monitoringState.modulFilter = modulGroup;
  document.querySelectorAll(".chip-filter").forEach(chip => {
    if (chip.dataset.modul === modulGroup) {
      chip.classList.add("active");
    } else {
      chip.classList.remove("active");
    }
  });

  renderMonitoringList();
};

function copyMonitoringReportWA() {
  if (!monitoringState.data) {
    showToast("Data monitoring belum dimuat!", "warning");
    return;
  }

  const data = monitoringState.data;
  const nowStr = new Date().toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' });

  let text = `📊 *MONITORING REALTIME INPUT RUTE MDS*\n`;
  text += `📅 *Rute*: Rute ${data.rute} (${nowStr})\n`;
  text += `👥 *Total MDS*: ${data.totalCrew} Orang\n`;
  text += `✅ *Sudah Input*: ${data.submittedCount} Orang (${data.percentage}%)\n`;
  text += `⏳ *Belum Input*: ${data.pendingCount} Orang\n\n`;

  text += `━━━━━━━━━━━━━━━━━━━━━\n`;
  text += `⏳ *DAFTAR MDS BELUM INPUT (${data.pendingCount} Orang):*\n`;
  if (data.pending.length === 0) {
    text += `(Semua MDS sudah selesai input rute 🎉)\n`;
  } else {
    data.pending.forEach((c, idx) => {
      const cleanModul = (c.modul || "MODUL").replace(/\s+/g, "").toUpperCase();
      text += `${idx + 1}. [${cleanModul}] ${c.id || '-'} - ${c.nama}\n`;
    });
  }

  text += `\n━━━━━━━━━━━━━━━━━━━━━\n`;
  text += `✅ *DAFTAR MDS SUDAH INPUT (${data.submittedCount} Orang):*\n`;
  if (data.submitted.length === 0) {
    text += `(Belum ada MDS yang input)\n`;
  } else {
    data.submitted.forEach((c, idx) => {
      const cleanModul = (c.modul || "MODUL").replace(/\s+/g, "").toUpperCase();
      text += `${idx + 1}. [${cleanModul}] ${c.nama} (${c.storeCount} Toko)\n`;
    });
  }

  text += `\n_Diupdate otomatis via Web Absen MDS_ 🚀`;

  safeCopyToClipboard(text, "📋 Format Rekap Monitoring berhasil disalin ke clipboard!");
}

/* ===================================================
   MODERN CUSTOM CONFIRM & DIALOG HELPER
   =================================================== */
function showCustomConfirm({
  title = "Konfirmasi Tindakan",
  message = "Apakah Anda yakin ingin melanjutkan?",
  icon = "alert-triangle",
  type = "warning", // "warning" | "danger" | "info"
  okText = "Ya, Lanjutkan",
  cancelText = "Batal"
} = {}) {
  return new Promise((resolve) => {
    const modal = document.getElementById("customConfirmModal");
    const titleEl = document.getElementById("confirmTitle");
    const msgEl = document.getElementById("confirmMessage");
    const iconContainer = document.getElementById("confirmIconContainer");
    const iconEl = document.getElementById("confirmIcon");
    const btnOk = document.getElementById("btnConfirmOk");
    const btnCancel = document.getElementById("btnConfirmCancel");
    const okTextEl = document.getElementById("confirmOkText");

    if (!modal) {
      resolve(true);
      return;
    }

    if (titleEl) titleEl.textContent = title;
    if (msgEl) msgEl.textContent = message;
    if (okTextEl) okTextEl.textContent = okText;
    if (btnCancel) {
      const cancelSpan = btnCancel.querySelector("span");
      if (cancelSpan) cancelSpan.textContent = cancelText;
    }

    if (iconContainer) {
      iconContainer.className = `confirm-icon-box ${type}`;
    }
    if (iconEl) {
      iconEl.setAttribute("data-lucide", icon);
    }

    if (btnOk) {
      if (type === "danger") {
        btnOk.className = "btn-primary btn-danger-confirm";
      } else {
        btnOk.className = "btn-primary";
      }
    }

    if (window.lucide) lucide.createIcons();
    modal.classList.add("active");

    const cleanup = () => {
      modal.classList.remove("active");
      btnOk?.removeEventListener("click", onOk);
      btnCancel?.removeEventListener("click", onCancel);
    };

    const onOk = () => {
      cleanup();
      resolve(true);
    };

    const onCancel = () => {
      cleanup();
      resolve(false);
    };

    btnOk?.addEventListener("click", onOk);
    btnCancel?.addEventListener("click", onCancel);
  });
}

/* ===================================================
   PROGRESSIVE WEB APP (PWA) INSTALL & OFFLINE ENGINE
   =================================================== */
let deferredPwaPrompt = null;

function initPwaInstall() {
  // 1. Registrasi Service Worker
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./sw.js").then((reg) => {
        console.log("[PWA] Service Worker aktif:", reg.scope);
      }).catch((err) => {
        console.warn("[PWA] Service Worker gagal registrasi:", err);
      });
    });
  }

  // 2. Tangkap event prompt install dari browser Android Chrome
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPwaPrompt = e;

    const btnInstallMenu = document.getElementById("btnInstallPwa");
    const groupInstall = document.getElementById("pwaInstallGroup");

    if (btnInstallMenu) btnInstallMenu.style.display = "flex";
    if (groupInstall) groupInstall.style.display = "block";
  });

  // 3. Deteksi apakah sudah terinstall sebagai Standalone PWA atau masih di browser biasa
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  
  if (!isStandalone) {
    // Jika masih di browser biasa, tampilkan modal ajakan pasang aplikasi ke homescreen
    const dismissedSession = sessionStorage.getItem("mds_pwa_gate_dismissed");
    if (!dismissedSession) {
      setTimeout(() => {
        const gateModal = document.getElementById("pwaInstallGateModal");
        if (gateModal && !state.isTourMode) {
          gateModal.classList.add("active");
          if (window.lucide) lucide.createIcons();
        }
      }, 1500);
    }
  }

  // 4. Handler Tombol Install
  const handleInstallClick = async () => {
    const gateModal = document.getElementById("pwaInstallGateModal");
    if (gateModal) gateModal.classList.remove("active");

    if (!deferredPwaPrompt) {
      showToast("💡 Buka menu titik 3 (⋮) di Chrome HP Anda lalu pilih 'Tambahkan ke Layar Utama' / 'Install Aplikasi'", "info");
      return;
    }
    deferredPwaPrompt.prompt();
    const { outcome } = await deferredPwaPrompt.userChoice;
    if (outcome === "accepted") {
      showToast("Terima kasih! Retail Ops Rute Master berhasil dipasang di HP Anda 🚀", "success");
      const btnInstallMenu = document.getElementById("btnInstallPwa");
      const groupInstall = document.getElementById("pwaInstallGroup");
      if (btnInstallMenu) btnInstallMenu.style.display = "none";
      if (groupInstall) groupInstall.style.display = "none";
    }
    deferredPwaPrompt = null;
  };

  document.getElementById("btnInstallPwa")?.addEventListener("click", handleInstallClick);
  document.getElementById("btnSettingsInstallPwa")?.addEventListener("click", handleInstallClick);
  document.getElementById("btnGateInstallNow")?.addEventListener("click", handleInstallClick);

  document.getElementById("btnGateDismiss")?.addEventListener("click", () => {
    document.getElementById("pwaInstallGateModal")?.classList.remove("active");
    sessionStorage.setItem("mds_pwa_gate_dismissed", "true");
    showToast("💡 Jangan lupa pasang di homescreen agar tidak perlu minta link web lagi!", "warning");
  });

  window.addEventListener("appinstalled", () => {
    showToast("Retail Ops Rute Master berhasil dipasang di layar utama HP!", "success");
    document.getElementById("pwaInstallGateModal")?.classList.remove("active");
    deferredPwaPrompt = null;
  });
}


