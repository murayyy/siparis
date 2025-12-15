// app.js
// DepoOS – Firebase + Firestore + Tek Sayfa Depo Otomasyonu (GÜNCEL / TEK PARÇA)
// - Orders: Excel import + manuel sipariş oluşturma (eksiltmedim)
// - Picking: "Toplandı" checkbox (işaretlenince pickedQty = qty), "Eksik" checkbox (eksikse pickedQty=0)
// - Eksik ürün özeti order içine yazılır (missingSummary)
// - Manager/Admin: toplayıcı atama (basit seçim UI)

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

// --------------------------------------------------------
// 1. Firebase Config & Init
// --------------------------------------------------------
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
      ? btn.dataset.role.split(",").map((r) => r.trim().toLowerCase())
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
          li.className = "flex justify-between items-start text-xs border-b border-slate-800 py-1";
          li.innerHTML = `
            <div class="pr-2">
              <p class="font-semibold text-slate-200">${d.title || "-"}</p>
              <p class="text-[11px] text-slate-400">${d.message || ""}</p>
            </div>
            <span class="text-[10px] text-slate-500">
              ${
                d.createdAt?.toDate
                  ? d.createdAt.toDate().toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })
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
    (err) => console.error("Bildirim dinleyici hata:", err)
  );
}

async function markNotificationsAsRead() {
  if (!currentUser) return;
  try {
    const snap = await getDocs(
      query(collection(db, "notifications"), where("userId", "==", currentUser.uid), where("read", "==", false))
    );

    const tasks = [];
    snap.forEach((docSnap) => tasks.push(updateDoc(doc(db, "notifications", docSnap.id), { read: true })));
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
      "XLSX yok. index.html <head> içine SheetJS ekli olmalı: https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js"
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

      const note = r["aciklama"] || r["açiklama"] || r["not"] || r["note"] || r["acik"] || "";

      if (!productCode && !productName) return null;

      if (!qty || qty <= 0) {
        return { _row: idx + 2, _error: "Miktar (qty) 0 veya boş", productCode, productName };
      }

      return {
        productCode: String(productCode).trim(),
        productName: String(productName).trim(),
        qty,
        note: String(note || "").trim(),
      };
    })
    .filter(Boolean);

  return { branchName: String(branchName || "").trim(), documentNo: String(documentNo || "").trim(), items };
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
        .map((e) => `Satır ${e._row}: ${e._error} (${e.productCode || ""} ${e.productName || ""})`)
        .join("<br/>");
      throw new Error("Excel’de hatalı satırlar var:<br/>" + msg);
    }

    if (!branchName) throw new Error("Excel’de Şube adı yok (sube/şube/branchName kolonunu kontrol et).");
    if (!items.length) throw new Error("Excel’den hiç kalem alınamadı.");

    const productsSnap = await getDocs(collection(db, "products"));
    const codeToProduct = new Map();
    productsSnap.forEach((ds) => {
      const p = ds.data();
      if (p?.code) codeToProduct.set(String(p.code).trim(), { id: ds.id, ...p });
    });

    const orderPayload = {
      branchName,
      documentNo: documentNo || null,
      note: $("orderNote")?.value?.trim() || null,
      status: "open",
      createdAt: serverTimestamp(),
      createdBy: currentUser.uid,
      createdByEmail: currentUser.email,
      assignedTo: null,
      assignedToEmail: null,
      source: "excel",
      sourceFileName: file.name,
      missingSummary: { missingLines: 0, missingQty: 0 },
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
        pickedDone: false,
        missingFlag: false,
        missingQty: 0,
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
  productsView: async () => loadProducts(),
  stockView: async () => {
    await loadProducts();
    await loadStockMovements();
  },
  ordersView: async () => loadOrders(),
  pickingView: async () => {
    await loadPickingOrders();
    await updatePickerDashboardStats();
  },
  loadingView: async () => loadLoadingTasks(),
  reportsView: async () => updateReportSummary(),
};

function showView(viewId) {
  const views = document.querySelectorAll(".view");
  views.forEach((v) => (v.id === viewId ? v.classList.remove("hidden") : v.classList.add("hidden")));

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

    snapshot.empty ? emptyMsg.classList.remove("hidden") : emptyMsg.classList.add("hidden");

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

  const payload = { code, name, unit, shelf, stock, note, updatedAt: serverTimestamp() };

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
        "border border-slate-800 rounded-xl px-3 py-2 flex justify-between items-center bg-slate-950/40";
      div.innerHTML = `
        <div>
          <p class="font-semibold text-slate-200 text-xs">${d.productName || "-"}</p>
          <p class="text-[11px] text-slate-400">
            ${typeLabel} • ${d.qty} ${d.unit || ""} • ${d.sourceLocation || "-"} ➜ ${d.targetLocation || "-"}
          </p>
        </div>
        <span class="text-[11px] text-slate-500">
          ${d.createdAt?.toDate ? d.createdAt.toDate().toLocaleString("tr-TR") : ""}
        </span>
      `;
      container.appendChild(div);
      count++;
    });

    count === 0 ? empty.classList.remove("hidden") : empty.classList.add("hidden");
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
      await addDoc(collection(db, "locationStocks"), { ...basePayload, createdAt: serverTimestamp() });
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
      if (sourceLocation) await adjustLocationStock({ ...commonArgs, locationCode: sourceLocation, deltaQty: -qty });
      if (targetLocation) await adjustLocationStock({ ...commonArgs, locationCode: targetLocation, deltaQty: qty });
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
// 8. Orders (Manuel + Atama)
// --------------------------------------------------------
function openOrderModal() {
  $("orderModal")?.classList.remove("hidden");
}
function closeOrderModal() {
  $("orderModal")?.classList.add("hidden");
}

function createOrderItemRow(productsMap) {
  // productsMap: id -> data
  const wrapper = document.createElement("div");
  wrapper.className = "grid md:grid-cols-12 gap-2 items-center border border-slate-800/80 bg-slate-950/40 rounded-2xl p-2";

  const optionsHtml = Array.from(productsMap.entries())
    .map(([id, p]) => `<option value="${id}">${(p.code || "").trim()} - ${(p.name || "").trim()}</option>`)
    .join("");

  wrapper.innerHTML = `
    <div class="md:col-span-5">
      <select class="orderItemProduct w-full rounded-xl bg-slate-900 border border-slate-700 px-3 py-2 text-[11px] text-slate-100">
        <option value="">Ürün seç...</option>
        ${optionsHtml}
      </select>
    </div>

    <div class="md:col-span-2">
      <input type="number" min="0" step="0.01" placeholder="Miktar"
        class="orderItemQty w-full rounded-xl bg-slate-900 border border-slate-700 px-3 py-2 text-[11px] text-slate-100" />
    </div>

    <div class="md:col-span-4">
      <input type="text" placeholder="Açıklama / Not"
        class="orderItemNote w-full rounded-xl bg-slate-900 border border-slate-700 px-3 py-2 text-[11px] text-slate-100" />
    </div>

    <div class="md:col-span-1 flex justify-end">
      <button type="button"
        class="orderItemRemove px-3 py-2 rounded-xl bg-red-500/10 border border-red-500/30 text-red-200 text-[11px] hover:bg-red-500/20">
        Sil
      </button>
    </div>
  `;

  wrapper.querySelector(".orderItemRemove").addEventListener("click", () => wrapper.remove());
  return wrapper;
}

async function prepareOrderModal() {
  $("orderForm")?.reset();

  const container = $("orderItemsContainer");
  const empty = $("orderItemsEmpty");
  if (container) container.innerHTML = "";
  if (empty) empty.classList.remove("hidden");

  if ($("orderExcelFile")) $("orderExcelFile").value = "";
  setExcelImportResult("");

  const productsSnap = await getDocs(collection(db, "products"));
  const productsMap = new Map();
  productsSnap.forEach((docSnap) => productsMap.set(docSnap.id, docSnap.data()));

  const addBtn = $("addOrderItemBtn");
  if (addBtn) {
    addBtn.onclick = () => {
      const row = createOrderItemRow(productsMap);
      container.appendChild(row);
      empty.classList.add("hidden");
    };
  }
}

async function saveOrder(evt) {
  evt.preventDefault();
  try {
    if (!currentUser) throw new Error("Giriş yapılmadı.");

    const branchName = $("orderBranchName")?.value?.trim() || "";
    const documentNo = $("orderDocumentNo")?.value?.trim() || "";
    const note = $("orderNote")?.value?.trim() || "";

    if (!branchName) throw new Error("Şube adı zorunlu.");

    const container = $("orderItemsContainer");
    const rows = container ? Array.from(container.children) : [];

    if (rows.length === 0) throw new Error("En az 1 satır eklemelisin (veya Excel yüklemelisin).");

    const items = [];
    for (const r of rows) {
      const productId = r.querySelector(".orderItemProduct")?.value || "";
      const qty = Number(r.querySelector(".orderItemQty")?.value || 0);
      const rowNote = r.querySelector(".orderItemNote")?.value?.trim() || "";

      if (!productId) continue;
      if (!qty || qty <= 0) throw new Error("Manuel satırlarda miktar 0 olamaz.");

      const pSnap = await getDoc(doc(db, "products", productId));
      const p = pSnap.exists() ? pSnap.data() : {};

      items.push({
        productId,
        productCode: p.code || "",
        productName: p.name || "",
        qty,
        unit: p.unit || "",
        note: rowNote,
      });
    }

    if (items.length === 0) throw new Error("Geçerli satır bulunamadı.");

    const orderPayload = {
      branchName,
      documentNo: documentNo || null,
      note: note || null,
      status: "open",
      createdAt: serverTimestamp(),
      createdBy: currentUser.uid,
      createdByEmail: currentUser.email,
      assignedTo: null,
      assignedToEmail: null,
      source: "manual",
      missingSummary: { missingLines: 0, missingQty: 0 },
    };

    const orderRef = await addDoc(collection(db, "orders"), orderPayload);

    for (const it of items) {
      await addDoc(collection(db, "orders", orderRef.id, "items"), {
        ...it,
        pickedQty: 0,
        pickedDone: false,
        missingFlag: false,
        missingQty: 0,
        status: "open",
        createdAt: serverTimestamp(),
      });
    }

    showGlobalAlert("Sipariş kaydedildi.", "success");
    await loadOrders();
    await loadPickingOrders();
    closeOrderModal();
  } catch (err) {
    console.error("saveOrder hata:", err);
    showGlobalAlert("Sipariş kaydedilemedi: " + (err.message || err));
  }
}

async function loadOrders() {
  const tbody = $("ordersTableBody");
  const empty = $("ordersEmpty");
  if (!tbody || !empty) return;

  tbody.innerHTML = "";

  try {
    const qSnap = await getDocs(query(collection(db, "orders"), orderBy("createdAt", "desc")));
    let hasAny = false;

    for (const docSnap of qSnap.docs) {
      hasAny = true;
      const d = docSnap.data();

      const statusLabel =
        d.status === "open"
          ? "Açık"
          : d.status === "assigned"
          ? "Atandı"
          : d.status === "picking"
          ? "Toplanıyor"
          : d.status === "completed"
          ? "Tamamlandı"
          : d.status || "-";

      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td class="px-3 py-2 text-xs">${docSnap.id.slice(-6)}</td>
        <td class="px-3 py-2 text-xs">${d.branchName || "-"}</td>
        <td class="px-3 py-2 text-xs">${statusLabel}</td>
        <td class="px-3 py-2 text-[11px]">${d.assignedToEmail || "-"}</td>
        <td class="px-3 py-2 text-[11px]">${d.createdAt?.toDate ? d.createdAt.toDate().toLocaleString("tr-TR") : ""}</td>
        <td class="px-3 py-2 text-right space-x-1">
          <button class="text-[11px] px-2 py-1 rounded-full bg-slate-900 text-slate-100 hover:bg-slate-800" data-detail="${docSnap.id}">Detay</button>
          ${
            normalizeRole(currentUserProfile?.role) === "manager" || normalizeRole(currentUserProfile?.role) === "admin"
              ? `<button class="text-[11px] px-2 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-200 hover:bg-emerald-500/20" data-assign="${docSnap.id}">Toplayıcı Ata</button>`
              : ""
          }
        </td>
      `;
      tbody.appendChild(tr);
    }

    hasAny ? empty.classList.add("hidden") : empty.classList.remove("hidden");
  } catch (err) {
    console.error("loadOrders hata:", err);
    showGlobalAlert("Siparişler okunamadı: " + err.message);
  }
}

async function assignOrderToPicker(orderId) {
  try {
    const role = normalizeRole(currentUserProfile?.role || "");
    if (!(role === "manager" || role === "admin")) {
      showGlobalAlert("Bu işlem için yetkin yok.");
      return;
    }

    // picker listesi
    const snap = await getDocs(query(collection(db, "users"), where("role", "==", "picker")));
    const pickers = [];
    snap.forEach((ds) => pickers.push({ id: ds.id, ...ds.data() }));

    if (pickers.length === 0) {
      showGlobalAlert("Toplayıcı bulunamadı. Önce picker kullanıcı ekle.");
      return;
    }

    const menu = pickers.map((p, i) => `${i + 1}) ${p.fullName || p.email} (${p.email})`).join("\n");
    const ans = prompt("Toplayıcı seç (numara yaz):\n\n" + menu);
    const idx = Number(ans || 0) - 1;
    if (idx < 0 || idx >= pickers.length) return;

    const chosen = pickers[idx];

    await updateDoc(doc(db, "orders", orderId), {
      assignedTo: chosen.id,
      assignedToEmail: chosen.email || null,
      status: "assigned",
      assignedAt: serverTimestamp(),
      assignedBy: currentUser?.uid || null,
      assignedByEmail: currentUser?.email || null,
    });

    // picker'a bildirim
    await createNotification({
      userId: chosen.id,
      type: "orderAssigned",
      orderId,
      title: "Yeni toplama görevi",
      message: `${orderId.slice(-6)} no'lu sipariş sana atandı.`,
    });

    showGlobalAlert("Toplayıcı atandı.", "success");
    await loadOrders();
    await loadPickingOrders();
  } catch (err) {
    console.error("assignOrderToPicker hata:", err);
    showGlobalAlert("Toplayıcı atanamadı: " + err.message);
  }
}

// --------------------------------------------------------
// 9. Picking (Toplayıcı Ekranı + Rota) – "Toplandı" + "Eksik"
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

    const itemsSnap = await getDocs(collection(db, "orders", orderId, "items"));
    const items = [];
    itemsSnap.forEach((docSnap) => items.push({ id: docSnap.id, ...docSnap.data() }));

    const itemsWithLoc = await enrichItemsWithLocation(items);
    itemsWithLoc.sort((a, b) => compareLocationCode(a.locationCode || "", b.locationCode || ""));
    pickingDetailItems = itemsWithLoc;

    const totalLines = itemsWithLoc.length;
    const totalQty = itemsWithLoc.reduce((sum, it) => sum + Number(it.qty || 0), 0);
    const uniqueLocations = new Set(itemsWithLoc.map((it) => it.locationCode || "Lokasyon yok")).size;

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
                  Bazı lokasyonlarda istenen miktardan az stok var (kırmızı satırlar).
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

        const rowClass = shortage
          ? "bg-red-950/40 text-red-50 hover:bg-red-900/40"
          : "bg-slate-950/20 text-slate-100 hover:bg-slate-900/60";

        const defaultPicked = Number(it.pickedQty ?? it.qty ?? 0);
        const pickedDone = !!it.pickedDone;

        return `
          <tr class="border-b border-slate-800/80 ${rowClass}">
            <td class="px-3 py-2 text-[11px] text-slate-400">${index + 1}</td>
            <td class="px-3 py-2 text-[11px] font-mono">${it.locationCode || "-"}</td>
            <td class="px-3 py-2 text-[11px] font-mono">${it.productCode || ""}</td>
            <td class="px-3 py-2 text-[11px]">${it.productName || ""}</td>

            <td class="px-3 py-2 text-[11px]">
              <span class="font-semibold">${it.qty}</span> ${it.unit || ""}
              <span class="ml-2 text-[10px] text-slate-400">(Lokasyondaki: ${it.locationAvailableQty ?? "-"})</span>
            </td>

            <!-- TOPLANDI -->
            <td class="px-3 py-2 text-[11px]">
              ${
                fromPicking
                  ? `<label class="inline-flex items-center gap-2">
                      <input type="checkbox" class="pickDoneChk" data-item="${it.id}" ${pickedDone ? "checked" : ""} />
                      <span class="text-[11px]">Toplandı</span>
                    </label>`
                  : `<span class="text-[11px]">${pickedDone ? "✅" : "-"}</span>`
              }
            </td>

            <!-- EKSİK -->
            <td class="px-3 py-2 text-[11px]">
              ${
                fromPicking
                  ? `<label class="inline-flex items-center gap-2">
                      <input type="checkbox" class="missingChk" data-item="${it.id}" ${it.missingFlag ? "checked" : ""} />
                      <span class="text-[11px]">Eksik</span>
                    </label>`
                  : `<span class="text-[11px]">${it.missingFlag ? "⚠" : "-"}</span>`
              }
            </td>

            <!-- TOPLANAN MİKTAR -->
            <td class="px-3 py-2 text-[11px]">
              ${
                fromPicking
                  ? `<input
                      type="number"
                      min="0"
                      value="${defaultPicked}"
                      data-item="${it.id}"
                      class="pickedQtyInput w-24 rounded-lg border border-slate-600 bg-slate-900/70 px-2 py-1 text-[11px] text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                    />`
                  : `<span class="text-[11px]">${Number(it.pickedQty ?? 0)}</span>`
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
              <th class="px-3 py-2 text-left text-[11px] font-semibold text-slate-300 uppercase tracking-wide">Toplandı</th>
              <th class="px-3 py-2 text-left text-[11px] font-semibold text-slate-300 uppercase tracking-wide">Eksik</th>
              <th class="px-3 py-2 text-left text-[11px] font-semibold text-slate-300 uppercase tracking-wide">Toplanan</th>
              <th class="px-3 py-2 text-left text-[11px] font-semibold text-slate-300 uppercase tracking-wide">Not</th>
            </tr>
          </thead>
          <tbody>
            ${
              rowsHtml ||
              `<tr><td colspan="9" class="px-3 py-3 text-center text-[11px] text-slate-400">Kalem yok.</td></tr>`
            }
          </tbody>
        </table>
      </div>
    `;

    container.innerHTML = headerHtml + tableHtml;

    // Modal aç
    modal.classList.remove("hidden");

    // Toplandı checkbox davranışı:
    // - işaretlenince: pickedQty = qty ve input disable
    // - kaldırınca: input enable
    const content = $("pickingDetailContent");
    if (fromPicking && content) {
      const qtyInputs = content.querySelectorAll(".pickedQtyInput");
      const doneChks = content.querySelectorAll(".pickDoneChk");
      const missChks = content.querySelectorAll(".missingChk");

      function setInputState(itemId) {
        const item = itemsWithLoc.find((x) => x.id === itemId);
        const inp = content.querySelector(`.pickedQtyInput[data-item="${itemId}"]`);
        const done = content.querySelector(`.pickDoneChk[data-item="${itemId}"]`);
        const miss = content.querySelector(`.missingChk[data-item="${itemId}"]`);
        if (!inp || !item) return;

        // Eksik seçilirse: picked=0 ve disable
        if (miss && miss.checked) {
          inp.value = "0";
          inp.disabled = true;
          if (done) done.checked = false;
          return;
        }

        // Toplandı seçilirse: picked=qty ve disable
        if (done && done.checked) {
          inp.value = String(Number(item.qty || 0));
          inp.disabled = true;
          if (miss) miss.checked = false;
          return;
        }

        // hiçbiri değilse: enable
        inp.disabled = false;
      }

      doneChks.forEach((c) => {
        const id = c.getAttribute("data-item");
        setInputState(id);
        c.addEventListener("change", () => setInputState(id));
      });

      missChks.forEach((c) => {
        const id = c.getAttribute("data-item");
        setInputState(id);
        c.addEventListener("change", () => setInputState(id));
      });

      // inputlara manuel girince topandı/exik flaglerini kapat
      qtyInputs.forEach((inp) => {
        const id = inp.getAttribute("data-item");
        inp.addEventListener("input", () => {
          const done = content.querySelector(`.pickDoneChk[data-item="${id}"]`);
          const miss = content.querySelector(`.missingChk[data-item="${id}"]`);
          if (done) done.checked = false;
          if (miss) miss.checked = false;
          inp.disabled = false;
        });
      });
    }

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

async function loadPickingOrders() {
  const tbody = $("pickingTableBody");
  const empty = $("pickingEmpty");
  if (!tbody || !empty) return;

  tbody.innerHTML = "";

  try {
    const role = normalizeRole(currentUserProfile?.role || "");
    let qRef = query(collection(db, "orders"), orderBy("createdAt", "desc"));

    if (role === "picker") {
      qRef = query(collection(db, "orders"), where("assignedTo", "==", currentUser.uid), orderBy("createdAt", "desc"));
    }

    const snap = await getDocs(qRef);
    if (snap.empty) {
      empty.classList.remove("hidden");
      return;
    }
    empty.classList.add("hidden");

    snap.forEach((ds) => {
      const d = ds.data();
      if (d.status === "completed") return;

      const statusLabel = d.status === "assigned" ? "Atandı" : d.status === "picking" ? "Toplanıyor" : "Açık";

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

async function completePicking() {
  if (!pickingDetailOrderId || !pickingDetailOrderDoc) {
    showGlobalAlert("Sipariş seçili değil.");
    return;
  }

  try {
    const content = $("pickingDetailContent");
    const qtyInputs = content ? content.querySelectorAll(".pickedQtyInput[data-item]") : [];
    const doneChks = content ? content.querySelectorAll(".pickDoneChk[data-item]") : [];
    const missChks = content ? content.querySelectorAll(".missingChk[data-item]") : [];

    const pickedMap = new Map();
    const doneMap = new Map();
    const missMap = new Map();

    qtyInputs.forEach((inp) => {
      const itemId = inp.getAttribute("data-item");
      const val = Number(inp.value || 0);
      if (itemId) pickedMap.set(itemId, val);
    });
    doneChks.forEach((c) => {
      const id = c.getAttribute("data-item");
      if (id) doneMap.set(id, !!c.checked);
    });
    missChks.forEach((c) => {
      const id = c.getAttribute("data-item");
      if (id) missMap.set(id, !!c.checked);
    });

    const itemsSnap = await getDocs(collection(db, "orders", pickingDetailOrderId, "items"));
    const items = [];
    itemsSnap.forEach((ds) => items.push({ id: ds.id, ...ds.data() }));

    let totalLines = 0;
    let totalPickedQty = 0;

    let missingLines = 0;
    let missingQtySum = 0;

    for (const it of items) {
      const requested = Number(it.qty || 0);
      let picked = Number(pickedMap.get(it.id) ?? it.pickedQty ?? requested);

      const done = !!doneMap.get(it.id);
      const missingFlag = !!missMap.get(it.id);

      if (missingFlag) picked = 0; // eksik seçilince 0 (istersen kısmi toplayı da serbest bırakırız)
      if (done) picked = requested; // toplandı seçilince full

      const missingQty = Math.max(0, requested - picked);
      if (missingQty > 0) {
        missingLines++;
        missingQtySum += missingQty;
      }

      totalLines++;
      totalPickedQty += picked;

      await updateDoc(doc(db, "orders", pickingDetailOrderId, "items", it.id), {
        pickedQty: picked,
        pickedDone: done,
        missingFlag,
        missingQty,
        status: missingQty > 0 ? "missing" : "picked",
        updatedAt: serverTimestamp(),
      });

      it._pickedQty = picked;
    }

    const itemsWithLoc = await enrichItemsWithLocation(items);
    await applyPickingToLocationStocks(pickingDetailOrderId, itemsWithLoc);

    await updateDoc(doc(db, "orders", pickingDetailOrderId), {
      status: "completed",
      completedAt: serverTimestamp(),
      completedBy: currentUser?.uid || null,
      completedByEmail: currentUser?.email || null,
      missingSummary: { missingLines, missingQty: missingQtySum },
    });

    await addDoc(collection(db, "pickingLogs"), {
      orderId: pickingDetailOrderId,
      pickerId: currentUser?.uid || null,
      pickerEmail: currentUser?.email || null,
      totalLines,
      totalQty: totalPickedQty,
      missingLines,
      missingQty: missingQtySum,
      completedAt: serverTimestamp(),
    });

    const orderData = pickingDetailOrderDoc.data();
    if (orderData?.createdBy) {
      await createNotification({
        userId: orderData.createdBy,
        type: "orderCompleted",
        orderId: pickingDetailOrderId,
        title: "Sipariş tamamlandı",
        message:
          missingQtySum > 0
            ? `${pickingDetailOrderId.slice(-6)} tamamlandı. Eksik: ${missingLines} kalem / ${missingQtySum} adet.`
            : `${pickingDetailOrderId.slice(-6)} no'lu sipariş eksiksiz tamamlandı.`,
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
    if ($("reportCompletedOrders")) $("reportCompletedOrders").textContent = `Tamamlanan sipariş: ${completedOrders}`;
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

    el.textContent =
      totalOrders === 0
        ? "Bugün henüz tamamlanan toplama yok."
        : `Bugün ${totalOrders} siparişte, ${totalLines} kalem, toplam ${totalQty} birim toplandı.`;
  } catch (err) {
    console.error("Picker dashboard stats hata:", err);
  }
}

// --------------------------------------------------------
// 10.2 Loading Tasks (Sevk / Yükleme)
// --------------------------------------------------------
async function loadLoadingTasks() {
  const tbody = $("loadingTasksTableBody");
  const empty = $("loadingTasksEmpty");
  const filter = $("loadingStatusFilter");
  if (!tbody || !empty) return;

  tbody.innerHTML = "";

  try {
    const snap = await getDocs(query(collection(db, "loadingTasks"), orderBy("createdAt", "desc")));

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
          <button class="text-[11px] px-2 py-1 rounded-full bg-sky-500/10 border border-sky-500/30 text-sky-200 hover:bg-sky-500/20" data-loading-start="${ds.id}">Başlat</button>
          <button class="text-[11px] px-2 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-200 hover:bg-emerald-500/20" data-loading-complete="${ds.id}">Tamamla</button>
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
    await setDoc(doc(db, "users", uid), { fullName, role: normRole, email, createdAt: serverTimestamp() });
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
      currentUserProfile = { fullName: user.email, role: normRole, email: user.email, createdAt: serverTimestamp() };
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

  // Notifications
  $("notificationsMarkReadBtn")?.addEventListener("click", markNotificationsAsRead);

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

  // Picking detail modal close
  $("closePickingDetailModalBtn")?.addEventListener("click", (e) => {
    e.preventDefault();
    closePickingDetailModal();
  });

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
