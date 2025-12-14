// app.js
// DepoOS – Firebase + Firestore + Tek Sayfa Depo Otomasyonu (SON GÜNCEL / TEK PARÇA)
// Not: "Yeni Sipariş" artık Excel'den yükleme + (istersen manuel ekleme da duruyor, eksiltmedim)

// --------------------------------------------------------
// 1. Firebase Config & Init
// --------------------------------------------------------
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  collection,
  getDocs,
  query,
  where,
  orderBy,
  serverTimestamp,
  onSnapshot,
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDcLQB4UggXlYA9x8AKw-XybJjcF6U_KA4",
  authDomain: "depo1-4668f.firebaseapp.com",
  projectId: "depo1-4668f",
  storageBucket: "depo1-4668f.firebasestorage.app",
  messagingSenderId: "1044254626353",
  appId: "1:1044254626353:web:148c57df2456cc3d9e3b10",
  measurementId: "G-DFGMVLK9XH",
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// --------------------------------------------------------
// 2. Global State
// --------------------------------------------------------
let currentUser = null;
let currentUserProfile = null;

let pickingDetailOrderId = null;
let pickingDetailItems = [];
let pickingDetailOrderDoc = null;

let notificationsUnsub = null;

// --------------------------------------------------------
// 3. Helpers
// --------------------------------------------------------
function $(id) {
  return document.getElementById(id);
}

function showAuthMessage(msg, isError = true) {
  const el = $("authMessage");
  if (!el) return;
  el.textContent = msg || "";
  el.classList.toggle("text-red-500", isError);
  el.classList.toggle("text-emerald-600", !isError);
}

function showGlobalAlert(msg, type = "info") {
  const el = $("globalAlert");
  if (!el) return;

  if (!msg) {
    el.classList.add("hidden");
    el.textContent = "";
    return;
  }

  el.classList.remove("hidden");
  el.textContent = msg;

  el.classList.remove(
    "bg-amber-50",
    "border-amber-300",
    "text-amber-800",
    "bg-emerald-50",
    "border-emerald-300",
    "text-emerald-800"
  );

  if (type === "success") {
    el.classList.add("bg-emerald-50", "border-emerald-300", "text-emerald-800");
  } else {
    el.classList.add("bg-amber-50", "border-amber-300", "text-amber-800");
  }

  setTimeout(() => el.classList.add("hidden"), 4000);
}

// Rolü Türkçe label ile gösterelim
function getRoleLabel(role) {
  const r = (role || "").toLowerCase();
  if (r === "branch") return "şube";
  if (r === "picker") return "toplayıcı";
  if (r === "manager") return "depo yöneticisi";
  if (r === "admin") return "admin";
  return role || "-";
}

function setRoleBadge(role) {
  const el = $("roleBadge");
  if (!el) return;
  el.textContent = `Rol: ${getRoleLabel(role)}`;
}

function setCurrentUserInfo(user, profile) {
  const el = $("currentUserInfo");
  if (!el) return;

  if (!user || !profile) {
    el.textContent = "";
    return;
  }

  el.textContent = `${profile.fullName || user.email} • ${getRoleLabel(profile.role)}`;
}

// --------------------------------------------------------
// 3.1 Toplama Rotası / Lokasyon Helpers
// --------------------------------------------------------

// "A1-01-01" → { zone: "A", aisle: 1, rack: 1, level: 1 }
function parseLocationCode(code) {
  if (!code || typeof code !== "string") {
    return { zone: "", aisle: 0, rack: 0, level: 0 };
  }

  const parts = code.split("-");
  let zone = "";
  let aisle = 0;
  let rack = 0;
  let level = 0;

  if (parts.length >= 1) {
    const m = parts[0].match(/^([A-Za-z]+)(\d+)?$/);
    if (m) {
      zone = m[1];
      aisle = m[2] ? Number(m[2]) || 0 : 0;
    } else {
      zone = parts[0];
    }
  }
  if (parts.length >= 2) rack = Number(parts[1]) || 0;
  if (parts.length >= 3) level = Number(parts[2]) || 0;

  return { zone, aisle, rack, level };
}

// Lokasyon kodu sıralama (rota)
function compareLocationCode(a, b) {
  const pa = parseLocationCode(a || "");
  const pb = parseLocationCode(b || "");

  if (pa.zone < pb.zone) return -1;
  if (pa.zone > pb.zone) return 1;
  if (pa.aisle < pb.aisle) return -1;
  if (pa.aisle > pb.aisle) return 1;
  if (pa.rack < pb.rack) return -1;
  if (pa.rack > pb.rack) return 1;
  if (pa.level < pb.level) return -1;
  if (pa.level > pb.level) return 1;
  return 0;
}

// Sipariş kalemlerini locationStocks ile zenginleştirir (rota + stok kontrol)
async function enrichItemsWithLocation(items) {
  const result = [];

  for (const it of items) {
    let bestLoc = null;

    try {
      if (it.productId) {
        const locSnap = await getDocs(
          query(collection(db, "locationStocks"), where("productId", "==", it.productId))
        );

        locSnap.forEach((ds) => {
          const d = ds.data();
          if (!d.locationCode) return;

          if (!bestLoc) {
            bestLoc = { id: ds.id, ...d };
          } else if (compareLocationCode(d.locationCode, bestLoc.locationCode) < 0) {
            bestLoc = { id: ds.id, ...d };
          }
        });
      }
    } catch (err) {
      console.error("Lokasyon okunurken hata:", err);
    }

    const needed = Number(it.qty || 0);
    const available = bestLoc ? Number(bestLoc.qty || 0) : 0;

    result.push({
      ...it,
      locationCode: bestLoc?.locationCode || null,
      locationId: bestLoc?.locationId || bestLoc?.id || null,
      locationAvailableQty: available,
      locationShortage: needed > 0 && available < needed,
    });
  }

  return result;
}

// Toplama tamamlandığında locationStocks qty güncelle
async function applyPickingToLocationStocks(orderId, itemsWithPicked) {
  for (const it of itemsWithPicked) {
    if (!it.productId || !it.locationId) continue;

    try {
      const locRef = doc(db, "locationStocks", it.locationId);
      const snap = await getDoc(locRef);
      if (!snap.exists()) continue;

      const data = snap.data();
      const currentQty = Number(data.qty || 0);
      const picked = Number(it._pickedQty ?? it.pickedQty ?? 0);
      const newQty = Math.max(0, currentQty - picked);

      await updateDoc(locRef, {
        qty: newQty,
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      console.error("applyPickingToLocationStocks hata:", err);
    }
  }
}

// --------------------------------------------------------
// 3.2 Rol Bazlı UI
// --------------------------------------------------------
function normalizeRole(role) {
  if (!role) return "";
  const r = role.toString().toLowerCase().trim();

  if (r === "sube") return "branch";
  if (r === "toplayici") return "picker";
  if (r === "yonetici" || r === "depo" || r === "depo_yoneticisi") return "manager";
  if (r === "admin") return "admin";

  if (r === "branch" || r === "picker" || r === "manager") return r;
  return r;
}

function applyRoleBasedMenu(role) {
  const menuButtons = document.querySelectorAll("nav button[data-role]");
  if (!menuButtons) return;

  const normRole = normalizeRole(role);

  menuButtons.forEach((btn) => {
    const allowedRoles = btn.dataset.role
      ? btn.dataset.role
          .split(",")
          .map((r) => r.trim().toLowerCase())
      : [];

    if (!allowedRoles.includes(normRole)) btn.classList.add("hidden");
    else btn.classList.remove("hidden");
  });
}

function setupRoleBasedUI(profile) {
  const role = normalizeRole(profile?.role || "");

  applyRoleBasedMenu(role);

  const newOrderBtn = $("openOrderModalBtn");
  if (newOrderBtn) {
    const canCreateOrder = role === "branch" || role === "manager" || role === "admin";
    newOrderBtn.classList.toggle("hidden", !canCreateOrder);
  }
}

// --------------------------------------------------------
// 3.3 Bildirimler
// --------------------------------------------------------
async function createNotification({ userId, type, title, message, orderId, extra }) {
  if (!userId) return;
  try {
    await addDoc(collection(db, "notifications"), {
      userId,
      type: type || "info",
      title: title || "",
      message: message || "",
      orderId: orderId || null,
      extra: extra || null,
      read: false,
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    console.error("Bildirim oluşturulurken hata:", err);
  }
}

function startNotificationListener() {
  const listEl = $("notificationsList");
  const badgeEl = $("notificationsUnread");

  if (!currentUser || !listEl) return;

  if (notificationsUnsub) {
    notificationsUnsub();
    notificationsUnsub = null;
  }

  const qRef = query(
    collection(db, "notifications"),
    where("userId", "==", currentUser.uid),
    orderBy("createdAt", "desc")
  );

  notificationsUnsub = onSnapshot(
    qRef,
    (snap) => {
      listEl.innerHTML = "";
      let unread = 0;

      if (snap.empty) {
        listEl.innerHTML = '<li class="text-[11px] text-slate-400">Henüz bildirim yok.</li>';
      } else {
        snap.forEach((docSnap) => {
          const d = docSnap.data();
          if (!d.read) unread++;

          const li = document.createElement("li");
          li.className = "flex justify-between items-start text-xs border-b border-slate-100 py-1";
          li.innerHTML = `
            <div class="pr-2">
              <p class="font-semibold text-slate-700">${d.title || "-"}</p>
              <p class="text-[11px] text-slate-500">${d.message || ""}</p>
            </div>
            <span class="text-[10px] text-slate-400">
              ${
                d.createdAt?.toDate
                  ? d.createdAt.toDate().toLocaleTimeString("tr-TR", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })
                  : ""
              }
            </span>
          `;
          listEl.appendChild(li);
        });
      }

      if (badgeEl) {
        if (unread > 0) {
          badgeEl.textContent = unread;
          badgeEl.classList.remove("hidden");
        } else {
          badgeEl.classList.add("hidden");
        }
      }
    },
    (err) => {
      console.error("Bildirim dinleyici hata:", err);
    }
  );
}

async function markNotificationsAsRead() {
  if (!currentUser) return;
  try {
    const snap = await getDocs(
      query(
        collection(db, "notifications"),
        where("userId", "==", currentUser.uid),
        where("read", "==", false)
      )
    );

    const tasks = [];
    snap.forEach((docSnap) => {
      tasks.push(updateDoc(doc(db, "notifications", docSnap.id), { read: true }));
    });

    await Promise.all(tasks);
  } catch (err) {
    console.error("Bildirimler okunmuş işaretlenirken hata:", err);
  }
}

// --------------------------------------------------------
// 3.4 Excel Import (XLSX) -> Firestore Orders + Items
// --------------------------------------------------------
function normKey(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replaceAll("ı", "i")
    .replaceAll("İ", "i")
    .replaceAll("ğ", "g")
    .replaceAll("ü", "u")
    .replaceAll("ş", "s")
    .replaceAll("ö", "o")
    .replaceAll("ç", "c")
    .replace(/\s+/g, " ")
    .replace(/[^\w\s.-]/g, "");
}

function setExcelImportResult(msg, ok = true) {
  const el = $("orderExcelImportResult");
  if (!el) return;
  el.innerHTML = msg ? `<div class="${ok ? "text-emerald-300" : "text-red-300"}">${msg}</div>` : "";
}

async function readExcelFileToRows(file) {
  if (!file) throw new Error("Dosya seçilmedi.");
  if (typeof XLSX === "undefined") {
    throw new Error(
      "XLSX kütüphanesi yok. index.html <head> içine SheetJS script ekle: <script src='https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js'></script>"
    );
  }

  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const sheetName = wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  const json = XLSX.utils.sheet_to_json(ws, { defval: "" });

  if (!json || json.length === 0) throw new Error("Excel boş görünüyor.");
  return json;
}

function mapExcelRowsToOrder(rows) {
  const mapped = rows.map((r) => {
    const obj = {};
    for (const k of Object.keys(r)) obj[normKey(k)] = r[k];
    return obj;
  });

  const first = mapped[0];

  const branchName =
    first["sube"] ||
    first["şube"] ||
    first["branch"] ||
    first["branchname"] ||
    first["sube adi"] ||
    first["subeadi"] ||
    "";

  const documentNo =
    first["belge no"] ||
    first["belgeno"] ||
    first["documentno"] ||
    first["evrak no"] ||
    first["evrakno"] ||
    "";

  const items = mapped
    .map((r, idx) => {
      const productCode =
        r["stok kodu"] ||
        r["stokkodu"] ||
        r["productcode"] ||
        r["kod"] ||
        r["urun kodu"] ||
        r["urunkodu"] ||
        "";

      const productName =
        r["stok adi"] ||
        r["stokadi"] ||
        r["productname"] ||
        r["urun"] ||
        r["urun adi"] ||
        r["urunadi"] ||
        "";

      const qtyRaw = r["miktar"] || r["adet"] || r["qty"] || r["mikt"] || "";
      const qty = Number(qtyRaw || 0);

      const note =
        r["aciklama"] ||
        r["açiklama"] ||
        r["not"] ||
        r["note"] ||
        r["acik"] ||
        "";

      if (!productCode && !productName) return null;

      if (!qty || qty <= 0) {
        return {
          _row: idx + 2,
          _error: "Miktar (qty) 0 veya boş",
          productCode,
          productName,
        };
      }

      return {
        productCode: String(productCode).trim(),
        productName: String(productName).trim(),
        qty,
        note: String(note || "").trim(),
      };
    })
    .filter(Boolean);

  return {
    branchName: String(branchName || "").trim(),
    documentNo: String(documentNo || "").trim(),
    items,
  };
}

async function importOrderFromExcel() {
  try {
    if (!currentUser) throw new Error("Giriş yapılmadı.");

    setExcelImportResult("");
    const file = $("orderExcelFile")?.files?.[0];
    if (!file) throw new Error("Excel dosyası seçmelisin.");

    setExcelImportResult("Excel okunuyor...", true);

    const rows = await readExcelFileToRows(file);
    const { branchName, documentNo, items } = mapExcelRowsToOrder(rows);

    const rowErrors = items.filter((x) => x && x._error);
    if (rowErrors.length > 0) {
      const msg = rowErrors
        .slice(0, 25)
        .map(
          (e) =>
            `Satır ${e._row}: ${e._error} (${e.productCode || ""} ${e.productName || ""})`
        )
        .join("<br/>");
      throw new Error("Excel’de hatalı satırlar var:<br/>" + msg);
    }

    if (!branchName) {
      throw new Error("Excel’de Şube adı yok (sube/şube/branchName kolonunu kontrol et).");
    }
    if (!items.length) throw new Error("Excel’den hiç kalem alınamadı.");

    // products koleksiyonu ile eşleştir (kod -> product)
    const productsSnap = await getDocs(collection(db, "products"));
    const codeToProduct = new Map();
    productsSnap.forEach((ds) => {
      const p = ds.data();
      if (p?.code) codeToProduct.set(String(p.code).trim(), { id: ds.id, ...p });
    });

    const orderPayload = {
      branchName,
      documentNo: documentNo || null,
      note: null,
      status: "open",
      createdAt: serverTimestamp(),
      createdBy: currentUser.uid,
      createdByEmail: currentUser.email,
      assignedTo: null,
      assignedToEmail: null,
      source: "excel",
      sourceFileName: file.name,
    };

    const orderRef = await addDoc(collection(db, "orders"), orderPayload);

    for (const it of items) {
      const hit = codeToProduct.get(String(it.productCode || "").trim());

      await addDoc(collection(db, "orders", orderRef.id, "items"), {
        productId: hit?.id || null,
        productCode: it.productCode || hit?.code || "",
        productName: it.productName || hit?.name || "",
        qty: Number(it.qty || 0),
        unit: hit?.unit || "",
        note: it.note || "",
        pickedQty: 0,
        status: "open",
        createdAt: serverTimestamp(),
      });
    }

    setExcelImportResult(
      `✅ Yüklendi. Sipariş: <b>${orderRef.id.slice(-6)}</b> • Kalem: <b>${items.length}</b>`,
      true
    );

    showGlobalAlert("Excel siparişi kaydedildi.", "success");
    await loadOrders();
    await loadPickingOrders();
    closeOrderModal();
  } catch (err) {
    console.error("importOrderFromExcel hata:", err);
    setExcelImportResult("❌ " + (err.message || String(err)), false);
    showGlobalAlert("Excel siparişi yüklenemedi: " + (err.message || err));
  }
}

// Basit şablon indir (TSV) — Excel açar
function downloadExcelTemplate() {
  const headers = ["sube", "belgeNo", "stokKodu", "stokAdi", "miktar", "aciklama"];
  const sample = [
    ["Emek", "2025-001", "0003", "FINDIK İÇİ", 120, ""],
    ["Emek", "2025-001", "0012", "SARI LEBLEBİ", 1100, ""],
  ];
  const lines = [headers.join("\t"), ...sample.map((r) => r.join("\t"))].join("\n");

  const blob = new Blob([lines], { type: "text/tab-separated-values;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = "DepoOS_Siparis_Sablon.tsv";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// --------------------------------------------------------
// 4. Auth UI
// --------------------------------------------------------
function switchAuthTab(tab) {
  const loginTab = $("loginTab");
  const registerTab = $("registerTab");
  const loginForm = $("loginForm");
  const registerForm = $("registerForm");

  if (!loginTab || !registerTab || !loginForm || !registerForm) return;

  if (tab === "login") {
    loginTab.classList.add("bg-white", "shadow", "text-slate-900");
    registerTab.classList.remove("bg-white", "shadow", "text-slate-900");
    registerTab.classList.add("text-slate-500");
    loginForm.classList.remove("hidden");
    registerForm.classList.add("hidden");
  } else {
    registerTab.classList.add("bg-white", "shadow", "text-slate-900");
    loginTab.classList.remove("bg-white", "shadow", "text-slate-900");
    loginTab.classList.add("text-slate-500");
    registerForm.classList.remove("hidden");
    loginForm.classList.add("hidden");
  }
}

// --------------------------------------------------------
// 5. View Routing
// --------------------------------------------------------
const viewLoaders = {
  dashboardView: async () => {
    await updateDashboardCounts();
    await updateReportSummary();
    await loadLoadingTasks();
    await updatePickerDashboardStats();
  },
  productsView: async () => {
    await loadProducts();
  },
  stockView: async () => {
    await loadProducts();
    await loadStockMovements();
  },
  ordersView: async () => {
    await loadOrders();
  },
  pickingView: async () => {
    await loadPickingOrders();
    await updatePickerDashboardStats();
  },
  loadingView: async () => {
    await loadLoadingTasks();
  },
  reportsView: async () => {
    await updateReportSummary();
  },
};

function showView(viewId) {
  const views = document.querySelectorAll(".view");
  views.forEach((v) => {
    if (v.id === viewId) v.classList.remove("hidden");
    else v.classList.add("hidden");
  });

  const navBtns = document.querySelectorAll(".nav-btn");
  navBtns.forEach((btn) => {
    const target = btn.getAttribute("data-view");
    btn.classList.toggle("bg-slate-900/70", target === viewId);
    btn.classList.toggle("text-white", target === viewId);
  });

  const loader = viewLoaders[viewId];
  if (loader) loader().catch((err) => console.error("View loader hata:", viewId, err));
}

// --------------------------------------------------------
// 6. Products
// --------------------------------------------------------
async function loadProducts() {
  const tbody = $("productsTableBody");
  const emptyMsg = $("productsEmpty");
  const productSelect = $("stockProductSelect");
  if (!tbody || !emptyMsg || !productSelect) return;

  tbody.innerHTML = "";
  productSelect.innerHTML = "";

  try {
    const snapshot = await getDocs(collection(db, "products"));

    if (snapshot.empty) emptyMsg.classList.remove("hidden");
    else emptyMsg.classList.add("hidden");

    snapshot.forEach((docSnap) => {
      const data = docSnap.data();

      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td class="px-3 py-2 text-xs">${data.code || ""}</td>
        <td class="px-3 py-2 text-xs">${data.name || ""}</td>
        <td class="px-3 py-2 text-xs">${data.unit || ""}</td>
        <td class="px-3 py-2 text-xs">${data.shelf || ""}</td>
        <td class="px-3 py-2 text-xs">${data.stock ?? 0}</td>
        <td class="px-3 py-2 text-right space-x-1">
          <button class="text-[11px] px-2 py-1 rounded-full bg-sky-100 text-sky-700 hover:bg-sky-200" data-edit="${docSnap.id}">Düzenle</button>
          <button class="text-[11px] px-2 py-1 rounded-full bg-red-100 text-red-700 hover:bg-red-200" data-delete="${docSnap.id}">Sil</button>
        </td>
      `;
      tbody.appendChild(tr);

      const opt = document.createElement("option");
      opt.value = docSnap.id;
      opt.textContent = `${data.code || ""} - ${data.name || ""}`;
      productSelect.appendChild(opt);
    });

    tbody.querySelectorAll("button[data-edit]").forEach((btn) => {
      btn.addEventListener("click", () => openProductModal(btn.getAttribute("data-edit")));
    });

    tbody.querySelectorAll("button[data-delete]").forEach((btn) => {
      btn.addEventListener("click", () => deleteProduct(btn.getAttribute("data-delete")));
    });
  } catch (err) {
    console.error("loadProducts hata:", err);
    showGlobalAlert("Ürünler okunamadı: " + err.message);
  }
}

async function openProductModal(productId = null) {
  const modal = $("productModal");
  if (!modal) return;

  $("productForm")?.reset();
  $("productId").value = productId || "";
  $("productModalTitle").textContent = productId ? "Ürün Düzenle" : "Yeni Ürün";
  modal.classList.remove("hidden");

  if (!productId) return;

  try {
    const ref = doc(db, "products", productId);
    const snap = await getDoc(ref);
    if (snap.exists()) {
      const data = snap.data();
      $("productCode").value = data.code || "";
      $("productName").value = data.name || "";
      $("productUnit").value = data.unit || "";
      $("productShelf").value = data.shelf || "";
      $("productStock").value = data.stock ?? 0;
      $("productNote").value = data.note || "";
    }
  } catch (err) {
    console.error("openProductModal hata:", err);
  }
}

function closeProductModal() {
  $("productModal")?.classList.add("hidden");
}

async function saveProduct(evt) {
  evt.preventDefault();

  const id = $("productId").value || null;
  const code = $("productCode").value.trim();
  const name = $("productName").value.trim();
  const unit = $("productUnit").value.trim();
  const shelf = $("productShelf").value.trim();
  const stock = Number($("productStock").value || 0);
  const note = $("productNote").value.trim();

  const payload = {
    code,
    name,
    unit,
    shelf,
    stock,
    note,
    updatedAt: serverTimestamp(),
  };

  try {
    if (!id) {
      payload.createdAt = serverTimestamp();
      await addDoc(collection(db, "products"), payload);
    } else {
      await updateDoc(doc(db, "products", id), payload);
    }

    closeProductModal();
    showGlobalAlert("Ürün kaydedildi.", "success");
    await loadProducts();
  } catch (err) {
    console.error("saveProduct hata:", err);
    showGlobalAlert("Ürün kaydedilemedi: " + err.message);
  }
}

async function deleteProduct(id) {
  if (!id) return;
  if (!confirm("Bu ürünü silmek istediğine emin misin?")) return;

  try {
    await deleteDoc(doc(db, "products", id));
    showGlobalAlert("Ürün silindi.", "success");
    await loadProducts();
  } catch (err) {
    console.error("deleteProduct hata:", err);
    showGlobalAlert("Ürün silinemedi: " + err.message);
  }
}

// --------------------------------------------------------
// 7. Stock Movements + locationStocks
// --------------------------------------------------------
async function loadStockMovements() {
  const container = $("stockMovementsList");
  const empty = $("stockMovementsEmpty");
  if (!container || !empty) return;

  container.innerHTML = "";

  try {
    const qSnap = await getDocs(query(collection(db, "stockMovements"), orderBy("createdAt", "desc")));
    let count = 0;

    qSnap.forEach((docSnap) => {
      if (count >= 10) return;
      const d = docSnap.data();

      const typeLabel = d.type === "in" ? "Giriş" : d.type === "out" ? "Çıkış" : "Transfer";

      const div = document.createElement("div");
      div.className =
        "border border-slate-100 rounded-xl px-3 py-2 flex justify-between items-center bg-white/70 backdrop-blur";
      div.innerHTML = `
        <div>
          <p class="font-semibold text-slate-800 text-xs">${d.productName || "-"}</p>
          <p class="text-[11px] text-slate-500">
            ${typeLabel} • ${d.qty} ${d.unit || ""} • ${d.sourceLocation || "-"} ➜ ${d.targetLocation || "-"}
          </p>
        </div>
        <span class="text-[11px] text-slate-400">
          ${d.createdAt?.toDate ? d.createdAt.toDate().toLocaleString("tr-TR") : ""}
        </span>
      `;
      container.appendChild(div);
      count++;
    });

    if (count === 0) empty.classList.remove("hidden");
    else empty.classList.add("hidden");
  } catch (err) {
    console.error("loadStockMovements hata:", err);
    showGlobalAlert("Stok hareketleri okunamadı: " + err.message);
  }
}

async function adjustLocationStock({ productId, productData, locationCode, deltaQty, unitOverride }) {
  if (!productId || !locationCode || !deltaQty) return;

  try {
    const qRef = query(
      collection(db, "locationStocks"),
      where("productId", "==", productId),
      where("locationCode", "==", locationCode)
    );
    const snap = await getDocs(qRef);

    let currentQty = 0;
    let targetDocRef = null;

    if (!snap.empty) {
      const ds = snap.docs[0];
      targetDocRef = ds.ref;
      const d = ds.data();
      currentQty = Number(d.qty || 0);
    }

    if (!targetDocRef && deltaQty < 0) return;

    let newQty = currentQty + deltaQty;
    if (newQty < 0) newQty = 0;

    const basePayload = {
      productId,
      productCode: productData?.code || "",
      productName: productData?.name || "",
      locationId: null,
      locationCode,
      unit: unitOverride || productData?.unit || "",
      qty: newQty,
      updatedAt: serverTimestamp(),
    };

    if (targetDocRef) {
      await updateDoc(targetDocRef, basePayload);
    } else {
      await addDoc(collection(db, "locationStocks"), {
        ...basePayload,
        createdAt: serverTimestamp(),
      });
    }
  } catch (err) {
    console.error("adjustLocationStock hata:", err);
  }
}

async function saveStockMovement(evt) {
  evt.preventDefault();

  const productId = $("stockProductSelect").value;
  const type = $("stockType").value;
  const qty = Number($("stockQty").value || 0);
  const unit = $("stockUnit").value.trim() || "";
  const sourceLocation = $("stockSourceLocation").value.trim() || "";
  const targetLocation = $("stockTargetLocation").value.trim() || "";
  const note = $("stockNote").value.trim() || "";

  if (!productId || qty <= 0) {
    showGlobalAlert("Ürün ve miktar zorunludur.");
    return;
  }

  try {
    const productRef = doc(db, "products", productId);
    const productSnap = await getDoc(productRef);
    if (!productSnap.exists()) {
      showGlobalAlert("Ürün bulunamadı.");
      return;
    }
    const productData = productSnap.data();

    let newStock = Number(productData.stock || 0);
    if (type === "in") newStock += qty;
    else if (type === "out") {
      newStock -= qty;
      if (newStock < 0) newStock = 0;
    }

    const movementPayload = {
      productId,
      productCode: productData.code || "",
      productName: productData.name || "",
      type,
      qty,
      unit: unit || productData.unit || "",
      sourceLocation,
      targetLocation,
      note,
      createdAt: serverTimestamp(),
      createdBy: currentUser?.uid || null,
      createdByEmail: currentUser?.email || null,
    };

    await addDoc(collection(db, "stockMovements"), movementPayload);
    await updateDoc(productRef, { stock: newStock, updatedAt: serverTimestamp() });

    const commonArgs = { productId, productData, unitOverride: unit || productData.unit || "" };

    if (type === "in" && targetLocation) {
      await adjustLocationStock({ ...commonArgs, locationCode: targetLocation, deltaQty: qty });
    } else if (type === "out" && sourceLocation) {
      await adjustLocationStock({ ...commonArgs, locationCode: sourceLocation, deltaQty: -qty });
    } else if (type === "transfer") {
      if (sourceLocation) {
        await adjustLocationStock({ ...commonArgs, locationCode: sourceLocation, deltaQty: -qty });
      }
      if (targetLocation) {
        await adjustLocationStock({ ...commonArgs, locationCode: targetLocation, deltaQty: qty });
      }
    }

    $("stockForm").reset();
    await loadProducts();
    await loadStockMovements();
    showGlobalAlert("Stok hareketi kaydedildi.", "success");
  } catch (err) {
    console.error("saveStockMovement hata:", err);
    showGlobalAlert("Stok hareketi kaydedilemedi: " + err.message);
  }
}

  

// --------------------------------------------------------
// 9. Picking (Toplayıcı Ekranı + Rota) – PROFESYONEL UI (FIXED)
// --------------------------------------------------------
async function openPickingDetailModal(orderId, fromPicking) {
  pickingDetailOrderId = orderId;

  const container = $("pickingDetailContent");
  const modal = $("pickingDetailModal");
  if (!container || !modal) return;

  container.innerHTML = "";

  try {
    const orderRef = doc(db, "orders", orderId);
    const orderSnap = await getDoc(orderRef);

    if (!orderSnap.exists()) {
      showGlobalAlert("Sipariş bulunamadı.");
      return;
    }

    pickingDetailOrderDoc = orderSnap;
    const orderData = orderSnap.data();

    // Toplayıcı ekranından açıldıysa statüyü "picking" yap
    if (fromPicking && orderData.status !== "completed" && orderData.status !== "picking") {
      try {
        await updateDoc(orderRef, {
          status: "picking",
          pickingStartedAt: serverTimestamp(),
          pickingStartedBy: currentUser?.uid || null,
          pickingStartedByEmail: currentUser?.email || null,
        });
        orderData.status = "picking";
      } catch (err) {
        console.error("Statü picking yapılırken hata:", err);
      }
    }

    // Kalemler
    const itemsSnap = await getDocs(collection(db, "orders", orderId, "items"));
    const items = [];
    itemsSnap.forEach((docSnap) => items.push({ id: docSnap.id, ...docSnap.data() }));

    // Lokasyon ve rota
    const itemsWithLoc = await enrichItemsWithLocation(items);
    itemsWithLoc.sort((a, b) => compareLocationCode(a.locationCode || "", b.locationCode || ""));
    pickingDetailItems = itemsWithLoc;

    const totalLines = itemsWithLoc.length;
    const totalQty = itemsWithLoc.reduce((sum, it) => sum + Number(it.qty || 0), 0);
    const uniqueLocations = new Set(itemsWithLoc.map((it) => it.locationCode || "Lokasyon yok")).size;

    // Durum badge class
    const statusClass =
      orderData.status === "completed"
        ? "bg-emerald-500/10 text-emerald-300 border border-emerald-500/40"
        : orderData.status === "picking"
        ? "bg-sky-500/10 text-sky-300 border border-sky-500/40"
        : "bg-amber-500/10 text-amber-300 border border-amber-500/40";

    const headerHtml = `
      <div class="border border-slate-700/70 rounded-2xl p-4 text-xs bg-slate-900/80 text-slate-100">
        <div class="grid md:grid-cols-4 gap-3">
          <div>
            <p class="text-[11px] text-slate-400">Şube</p>
            <p class="font-semibold text-slate-100">${orderData.branchName || "-"}</p>
          </div>
          <div>
            <p class="text-[11px] text-slate-400">Belge No</p>
            <p class="font-semibold text-slate-100">${orderData.documentNo || "-"}</p>
          </div>
          <div>
            <p class="text-[11px] text-slate-400">Durum</p>
            <span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ${statusClass}">
              ${orderData.status || "-"}
            </span>
          </div>
          <div>
            <p class="text-[11px] text-slate-400">Toplayıcı</p>
            <p class="font-semibold text-slate-100">${orderData.assignedToEmail || "-"}</p>
          </div>
        </div>

        <div class="mt-3 flex flex-col md:flex-row md:items-center md:justify-between gap-2">
          <p class="text-[11px] text-slate-300 flex items-center gap-1">
            <span class="text-sky-400">🧭</span>
            Toplama rotası:
            <span class="font-semibold text-slate-100 ml-1">
              ${uniqueLocations} lokasyonda ${totalLines} kalem, toplam ${totalQty} birim.
            </span>
          </p>
          ${
            itemsWithLoc.some((it) => it.locationShortage)
              ? `<p class="text-[11px] text-amber-300 flex items-center gap-1">
                  <span>⚠</span>
                  Bazı lokasyonlarda istenen miktardan az stok var
                  <span class="hidden sm:inline">(kırmızı satırlar).</span>
                </p>`
              : `<p class="text-[11px] text-emerald-300 flex items-center gap-1">
                  <span>✅</span>
                  Tüm lokasyonlarda istenen miktar kadar stok görünüyor.
                </p>`
          }
        </div>
      </div>
    `;

    const rowsHtml = itemsWithLoc
      .map((it, index) => {
        const shortage = it.locationShortage;

        const shortageBadge = shortage
          ? `<span class="ml-2 inline-flex items-center px-2 py-[2px] rounded-full text-[10px] font-semibold bg-red-500/10 text-red-200 border border-red-500/40">Eksik</span>`
          : "";

        const rowClass = shortage
          ? "bg-red-950/50 text-red-50 hover:bg-red-900/50"
          : "bg-slate-950/20 text-slate-100 hover:bg-slate-900/60";

        return `
          <tr class="border-b border-slate-800/80 ${rowClass}">
            <td class="px-3 py-2 text-[11px] text-slate-400">${index + 1}</td>
            <td class="px-3 py-2 text-[11px] font-mono">${it.locationCode || "-"}</td>
            <td class="px-3 py-2 text-[11px] font-mono">${it.productCode || ""}</td>
            <td class="px-3 py-2 text-[11px]">${it.productName || ""}</td>
            <td class="px-3 py-2 text-[11px]">
              <span class="font-semibold">${it.qty}</span> ${it.unit || ""}
              <span class="ml-2 text-[10px] text-slate-400">(Lokasyondaki: ${it.locationAvailableQty ?? "-"})</span>
              ${shortageBadge}
            </td>
            <td class="px-3 py-2 text-[11px]">
              ${
                fromPicking
                  ? `<input
                      type="number"
                      min="0"
                      value="${it.pickedQty ?? it.qty}"
                      data-item="${it.id}"
                      class="w-20 rounded-lg border border-slate-600 bg-slate-900/70 px-2 py-1 text-[11px] text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                    />`
                  : `<span class="text-[11px]">${it.pickedQty ?? 0}</span>`
              }
            </td>
            <td class="px-3 py-2 text-[11px] text-slate-300">${it.note || ""}</td>
          </tr>
        `;
      })
      .join("");

    const tableHtml = `
      <div class="mt-3 border border-slate-800/80 rounded-2xl overflow-hidden bg-slate-950/60">
        <table class="min-w-full text-xs">
          <thead class="bg-slate-900/80">
            <tr>
              <th class="px-3 py-2 text-left text-[11px] font-semibold text-slate-300 uppercase tracking-wide">#</th>
              <th class="px-3 py-2 text-left text-[11px] font-semibold text-slate-300 uppercase tracking-wide">Lokasyon</th>
              <th class="px-3 py-2 text-left text-[11px] font-semibold text-slate-300 uppercase tracking-wide">Kod</th>
              <th class="px-3 py-2 text-left text-[11px] font-semibold text-slate-300 uppercase tracking-wide">Ürün</th>
              <th class="px-3 py-2 text-left text-[11px] font-semibold text-slate-300 uppercase tracking-wide">İstenen</th>
              <th class="px-3 py-2 text-left text-[11px] font-semibold text-slate-300 uppercase tracking-wide">Toplanan</th>
              <th class="px-3 py-2 text-left text-[11px] font-semibold text-slate-300 uppercase tracking-wide">Not</th>
            </tr>
          </thead>
          <tbody>
            ${
              rowsHtml ||
              `<tr><td colspan="7" class="px-3 py-3 text-center text-[11px] text-slate-400">Kalem yok.</td></tr>`
            }
          </tbody>
        </table>
      </div>
    `;

    container.innerHTML = headerHtml + tableHtml;

    // MODALI AÇ
    modal.classList.remove("hidden");

    // Buton durumu
    const completeBtn = $("completePickingBtn");
    if (completeBtn) {
      completeBtn.disabled = !fromPicking;
      completeBtn.classList.toggle("opacity-50", !fromPicking);
      completeBtn.classList.toggle("cursor-not-allowed", !fromPicking);
    }
  } catch (err) {
    console.error("openPickingDetailModal hata:", err);
    showGlobalAlert("Sipariş detayları yüklenemedi: " + err.message);
  }
}

function closePickingDetailModal() {
  const modal = $("pickingDetailModal");
  if (modal) modal.classList.add("hidden");

  pickingDetailOrderId = null;
  pickingDetailItems = [];
  pickingDetailOrderDoc = null;
}

// --------------------------------------------------------
// 9.1 Picking List (Toplayıcı ekranı listesi)
// --------------------------------------------------------
async function loadPickingOrders() {
  const tbody = $("pickingTableBody");
  const empty = $("pickingEmpty");
  if (!tbody || !empty) return;

  tbody.innerHTML = "";

  try {
    const role = normalizeRole(currentUserProfile?.role || "");
    let qRef = query(collection(db, "orders"), orderBy("createdAt", "desc"));

    // Picker ise sadece kendine atananlar öncelikli
    if (role === "picker") {
      qRef = query(
        collection(db, "orders"),
        where("assignedTo", "==", currentUser.uid),
        orderBy("createdAt", "desc")
      );
    }

    const snap = await getDocs(qRef);
    if (snap.empty) {
      empty.classList.remove("hidden");
      return;
    }
    empty.classList.add("hidden");

    snap.forEach((ds) => {
      const d = ds.data();

      // Picking ekranında completed göstermeyelim (istersen gösteririz)
      if (d.status === "completed") return;

      const statusLabel =
        d.status === "assigned" ? "Atandı" : d.status === "picking" ? "Toplanıyor" : "Açık";

      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td class="px-3 py-2 text-xs">${ds.id.slice(-6)}</td>
        <td class="px-3 py-2 text-xs">${d.branchName || "-"}</td>
        <td class="px-3 py-2 text-xs">${statusLabel}</td>
        <td class="px-3 py-2 text-[11px]">${d.assignedToEmail || "-"}</td>
        <td class="px-3 py-2 text-[11px]">${d.createdAt?.toDate ? d.createdAt.toDate().toLocaleString("tr-TR") : ""}</td>
        <td class="px-3 py-2 text-right">
          <button class="text-[11px] px-3 py-1.5 rounded-full bg-slate-900 text-white hover:bg-slate-800" data-pick="${ds.id}">
            Aç / Topla
          </button>
        </td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error("loadPickingOrders hata:", err);
    showGlobalAlert("Toplayıcı ekranı yüklenemedi: " + err.message);
  }
}

// --------------------------------------------------------
// 9.2 Picking Complete (Toplamayı bitir)
// --------------------------------------------------------
async function completePicking() {
  if (!pickingDetailOrderId || !pickingDetailOrderDoc) {
    showGlobalAlert("Sipariş seçili değil.");
    return;
  }

  try {
    // modal içindeki inputlardan pickedQty topla
    const inputs = $("pickingDetailContent")?.querySelectorAll("input[data-item]");
    const pickedMap = new Map();
    if (inputs) {
      inputs.forEach((inp) => {
        const itemId = inp.getAttribute("data-item");
        const val = Number(inp.value || 0);
        if (itemId) pickedMap.set(itemId, val);
      });
    }

    // items yeniden çek
    const itemsSnap = await getDocs(collection(db, "orders", pickingDetailOrderId, "items"));
    const items = [];
    itemsSnap.forEach((ds) => items.push({ id: ds.id, ...ds.data() }));

    // picked qty update + log için hesapla
    let totalLines = 0;
    let totalQty = 0;

    for (const it of items) {
      const picked = Number(pickedMap.get(it.id) ?? it.qty ?? 0);
      totalLines++;
      totalQty += picked;

      await updateDoc(doc(db, "orders", pickingDetailOrderId, "items", it.id), {
        pickedQty: picked,
        updatedAt: serverTimestamp(),
      });

      it._pickedQty = picked;
    }

    // locationStocks düş
    const itemsWithLoc = await enrichItemsWithLocation(items);
    await applyPickingToLocationStocks(pickingDetailOrderId, itemsWithLoc);

    // order status completed
    await updateDoc(doc(db, "orders", pickingDetailOrderId), {
      status: "completed",
      completedAt: serverTimestamp(),
      completedBy: currentUser?.uid || null,
      completedByEmail: currentUser?.email || null,
    });

    // pickingLogs
    await addDoc(collection(db, "pickingLogs"), {
      orderId: pickingDetailOrderId,
      pickerId: currentUser?.uid || null,
      pickerEmail: currentUser?.email || null,
      totalLines,
      totalQty,
      completedAt: serverTimestamp(),
    });

    // bildirim (siparişi açan şubeye)
    const orderData = pickingDetailOrderDoc.data();
    if (orderData?.createdBy) {
      await createNotification({
        userId: orderData.createdBy,
        type: "orderCompleted",
        orderId: pickingDetailOrderId,
        title: "Sipariş tamamlandı",
        message: `${pickingDetailOrderId.slice(-6)} no'lu sipariş tamamlandı.`,
      });
    }

    showGlobalAlert("Toplama tamamlandı.", "success");
    closePickingDetailModal();
    await loadOrders();
    await loadPickingOrders();
    await updateDashboardCounts();
    await updateReportSummary();
    await updatePickerDashboardStats();
  } catch (err) {
    console.error("completePicking hata:", err);
    showGlobalAlert("Toplama tamamlanamadı: " + err.message);
  }
}

// --------------------------------------------------------
// 10. Dashboard & Reports
// --------------------------------------------------------
async function updateDashboardCounts() {
  try {
    const ordersSnap = await getDocs(collection(db, "orders"));
    let open = 0;
    let picking = 0;
    let completed = 0;

    ordersSnap.forEach((docSnap) => {
      const s = docSnap.data().status;
      if (s === "open" || s === "assigned") open++;
      else if (s === "picking") picking++;
      else if (s === "completed") completed++;
    });

    const productsSnap = await getDocs(collection(db, "products"));
    const totalProducts = productsSnap.size;

    if ($("cardTotalProducts")) $("cardTotalProducts").textContent = totalProducts;
    if ($("cardOpenOrders")) $("cardOpenOrders").textContent = open;
    if ($("cardPickingOrders")) $("cardPickingOrders").textContent = picking;
    if ($("cardCompletedOrders")) $("cardCompletedOrders").textContent = completed;
  } catch (err) {
    console.error("updateDashboardCounts hata:", err);
  }
}

async function updateReportSummary() {
  try {
    const ordersSnap = await getDocs(collection(db, "orders"));
    let totalOrders = 0;
    let completedOrders = 0;
    ordersSnap.forEach((docSnap) => {
      totalOrders++;
      if (docSnap.data().status === "completed") completedOrders++;
    });

    const productsSnap = await getDocs(collection(db, "products"));
    const totalProducts = productsSnap.size;

    if ($("reportTotalProducts")) $("reportTotalProducts").textContent = `Toplam ürün: ${totalProducts}`;
    if ($("reportTotalOrders")) $("reportTotalOrders").textContent = `Toplam sipariş: ${totalOrders}`;
    if ($("reportCompletedOrders"))
      $("reportCompletedOrders").textContent = `Tamamlanan sipariş: ${completedOrders}`;
  } catch (err) {
    console.error("updateReportSummary hata:", err);
  }
}

async function updatePickerDashboardStats() {
  if (!currentUser) return;

  const el = $("pickerStatsToday");
  if (!el) return;

  try {
    const snap = await getDocs(query(collection(db, "pickingLogs"), where("pickerId", "==", currentUser.uid)));

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    let totalOrders = 0;
    let totalLines = 0;
    let totalQty = 0;

    snap.forEach((docSnap) => {
      const d = docSnap.data();
      const dt = d.completedAt?.toDate ? d.completedAt.toDate() : null;
      if (!dt) return;
      if (dt >= today && dt < tomorrow) {
        totalOrders++;
        totalLines += Number(d.totalLines || 0);
        totalQty += Number(d.totalQty || 0);
      }
    });

    if (totalOrders === 0) el.textContent = "Bugün henüz tamamlanan toplama yok.";
    else el.textContent = `Bugün ${totalOrders} siparişte, ${totalLines} kalem, toplam ${totalQty} birim toplandı.`;
  } catch (err) {
    console.error("Picker dashboard stats hata:", err);
  }
}

// --------------------------------------------------------
// 10.2 Loading Tasks (Sevk / Yükleme basit modül)
// --------------------------------------------------------
async function loadLoadingTasks() {
  const tbody = $("loadingTasksTableBody");
  const empty = $("loadingTasksEmpty");
  const filter = $("loadingStatusFilter");
  if (!tbody || !empty) return;

  tbody.innerHTML = "";

  try {
    let qRef = query(collection(db, "loadingTasks"), orderBy("createdAt", "desc"));
    const snap = await getDocs(qRef);

    if (snap.empty) {
      empty.classList.remove("hidden");
      return;
    }
    empty.classList.add("hidden");

    const statusFilter = filter?.value || "all";

    snap.forEach((ds) => {
      const d = ds.data();
      if (statusFilter !== "all" && d.status !== statusFilter) return;

      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td class="px-3 py-2 text-xs">${ds.id.slice(-6)}</td>
        <td class="px-3 py-2 text-xs">${d.title || "-"}</td>
        <td class="px-3 py-2 text-xs">${d.status || "-"}</td>
        <td class="px-3 py-2 text-[11px]">${d.createdAt?.toDate ? d.createdAt.toDate().toLocaleString("tr-TR") : ""}</td>
        <td class="px-3 py-2 text-right space-x-1">
          <button class="text-[11px] px-2 py-1 rounded-full bg-sky-100 text-sky-700 hover:bg-sky-200" data-loading-start="${ds.id}">Başlat</button>
          <button class="text-[11px] px-2 py-1 rounded-full bg-emerald-100 text-emerald-700 hover:bg-emerald-200" data-loading-complete="${ds.id}">Tamamla</button>
        </td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error("loadLoadingTasks hata:", err);
    showGlobalAlert("Yükleme işleri okunamadı: " + err.message);
  }
}

async function setLoadingTaskStatus(taskId, status) {
  try {
    await updateDoc(doc(db, "loadingTasks", taskId), {
      status,
      updatedAt: serverTimestamp(),
      updatedBy: currentUser?.uid || null,
      updatedByEmail: currentUser?.email || null,
    });
    showGlobalAlert("Durum güncellendi.", "success");
    await loadLoadingTasks();
  } catch (err) {
    console.error("setLoadingTaskStatus hata:", err);
    showGlobalAlert("Durum güncellenemedi: " + err.message);
  }
}

// --------------------------------------------------------
// 11. Auth Handlers
// --------------------------------------------------------
async function handleRegister(evt) {
  evt.preventDefault();
  const fullName = $("registerName").value.trim();
  const role = $("registerRole").value;
  const email = $("registerEmail").value.trim();
  const password = $("registerPassword").value;

  try {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    const uid = cred.user.uid;
    const normRole = normalizeRole(role) || "branch";
    await setDoc(doc(db, "users", uid), {
      fullName,
      role: normRole,
      email,
      createdAt: serverTimestamp(),
    });
    showAuthMessage("Kayıt başarılı, giriş yapıldı.", false);
  } catch (err) {
    console.error("handleRegister hata:", err);
    showAuthMessage("Kayıt hatası: " + err.message);
  }
}

async function handleLogin(evt) {
  evt.preventDefault();
  const email = $("loginEmail").value.trim();
  const password = $("loginPassword").value;

  try {
    await signInWithEmailAndPassword(auth, email, password);
    showAuthMessage("");
  } catch (err) {
    console.error("handleLogin hata:", err);
    showAuthMessage("Giriş hatası: " + err.message);
  }
}

async function handleLogout() {
  try {
    await signOut(auth);
  } catch (err) {
    console.error("handleLogout hata:", err);
  }
}

// --------------------------------------------------------
// 12. Auth State Listener
// --------------------------------------------------------
onAuthStateChanged(auth, async (user) => {
  currentUser = user;

  if (!user) {
    if (notificationsUnsub) {
      notificationsUnsub();
      notificationsUnsub = null;
    }

    $("authSection")?.classList.remove("hidden");
    $("appSection")?.classList.add("hidden");
    showAuthMessage("");
    currentUserProfile = null;
    setCurrentUserInfo(null, null);
    setRoleBadge("-");
    return;
  }

  try {
    const userRef = doc(db, "users", user.uid);
    const snap = await getDoc(userRef);

    if (snap.exists()) {
      const data = snap.data();
      const rawRole = data.role || "branch";
      const normRole = normalizeRole(rawRole) || "branch";

      currentUserProfile = { ...data, role: normRole };

      if (normRole !== rawRole) await updateDoc(userRef, { role: normRole });
    } else {
      const normRole = "branch";
      currentUserProfile = {
        fullName: user.email,
        role: normRole,
        email: user.email,
        createdAt: serverTimestamp(),
      };
      await setDoc(userRef, currentUserProfile);
    }

    setCurrentUserInfo(user, currentUserProfile);
    setRoleBadge(currentUserProfile.role);
    setupRoleBasedUI(currentUserProfile);

    $("authSection")?.classList.add("hidden");
    $("appSection")?.classList.remove("hidden");

    showView("dashboardView");
    startNotificationListener();
  } catch (err) {
    console.error("onAuthStateChanged hata:", err);
  }
});

// --------------------------------------------------------
// 13. DOM Ready & Event Binding
// --------------------------------------------------------
document.addEventListener("DOMContentLoaded", () => {
  // Auth tabs & forms
  $("loginTab")?.addEventListener("click", () => switchAuthTab("login"));
  $("registerTab")?.addEventListener("click", () => switchAuthTab("register"));

  $("registerForm")?.addEventListener("submit", handleRegister);
  $("loginForm")?.addEventListener("submit", handleLogin);
  $("logoutBtn")?.addEventListener("click", handleLogout);

  // Navigation
  document.querySelectorAll(".nav-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const viewId = btn.getAttribute("data-view");
      if (!viewId) return;
      showView(viewId);
    });
  });

  // Product modal
  $("openProductModalBtn")?.addEventListener("click", () => openProductModal());
  $("closeProductModalBtn")?.addEventListener("click", closeProductModal);
  $("cancelProductBtn")?.addEventListener("click", closeProductModal);
  $("productForm")?.addEventListener("submit", saveProduct);

  // Stock movements
  $("stockForm")?.addEventListener("submit", saveStockMovement);

  // Order modal
  $("openOrderModalBtn")?.addEventListener("click", async () => {
    await prepareOrderModal();
    openOrderModal();
  });
  $("closeOrderModalBtn")?.addEventListener("click", closeOrderModal);
  $("cancelOrderBtn")?.addEventListener("click", closeOrderModal);
  $("orderForm")?.addEventListener("submit", saveOrder);

  // Excel import
  $("importOrderFromExcelBtn")?.addEventListener("click", importOrderFromExcel);
  $("downloadExcelTemplateBtn")?.addEventListener("click", downloadExcelTemplate);

  // Orders table delegation
  const ordersTableBody = $("ordersTableBody");
  if (ordersTableBody) {
    ordersTableBody.addEventListener("click", (e) => {
      const detailBtn = e.target.closest("button[data-detail]");
      if (detailBtn) {
        const id = detailBtn.getAttribute("data-detail");
        openPickingDetailModal(id, false);
        return;
      }

      const assignBtn = e.target.closest("button[data-assign]");
      if (assignBtn) {
        const id = assignBtn.getAttribute("data-assign");
        assignOrderToPicker(id);
      }
    });
  }

  // Picking table delegation
  const pickingTableBody = $("pickingTableBody");
  if (pickingTableBody) {
    pickingTableBody.addEventListener("click", (e) => {
      const pickBtn = e.target.closest("button[data-pick]");
      if (pickBtn) {
        const id = pickBtn.getAttribute("data-pick");
        openPickingDetailModal(id, true);
      }
    });
  }

  // Picking detail modal – KAPATMA (X butonu)
  const closePickingBtn = $("closePickingDetailModalBtn");
  if (closePickingBtn) {
    closePickingBtn.addEventListener("click", (e) => {
      e.preventDefault();
      closePickingDetailModal();
    });
  }

  // Arka plan tıklayınca kapat (BU SAYEDE "AÇILIYOR AMA KAPATAMIYORUZ" BİTER)
  const pickingModal = $("pickingDetailModal");
  if (pickingModal) {
    pickingModal.addEventListener("click", (e) => {
      if (e.target === pickingModal) closePickingDetailModal();
    });
  }

  $("completePickingBtn")?.addEventListener("click", completePicking);

  // Loading tasks filters & buttons
  $("reloadLoadingTasksBtn")?.addEventListener("click", loadLoadingTasks);
  $("loadingStatusFilter")?.addEventListener("change", loadLoadingTasks);

  const loadingTasksTableBody = $("loadingTasksTableBody");
  if (loadingTasksTableBody) {
    loadingTasksTableBody.addEventListener("click", (e) => {
      const startBtn = e.target.closest("button[data-loading-start]");
      const completeBtn = e.target.closest("button[data-loading-complete]");

      if (startBtn) {
        const id = startBtn.getAttribute("data-loading-start");
        setLoadingTaskStatus(id, "loading");
        return;
      }
      if (completeBtn) {
        const id = completeBtn.getAttribute("data-loading-complete");
        setLoadingTaskStatus(id, "loaded");
      }
    });
  }
});
