// app.js
// Firebase + Depo Otomasyonu SPA

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
  onSnapshot
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

// --------------------------------------------------------
// 1. Firebase Config
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
let notificationsUnsub = null;   // ← bildirim dinleyici

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

function setRoleBadge(role) {
  const el = $("roleBadge");
  if (!el) return;
  el.textContent = `Rol: ${role || "-"}`;
}

function setCurrentUserInfo(user, profile) {
  const el = $("currentUserInfo");
  if (!el) return;
  if (!user || !profile) {
    el.textContent = "";
    return;
  }
  el.textContent = `${profile.fullName || user.email} • ${profile.role || "?"}`;
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
          query(
            collection(db, "locationStocks"),
            where("productId", "==", it.productId)
          )
        );
        locSnap.forEach((ds) => {
          const d = ds.data();
          if (!d.locationCode) return;
          if (!bestLoc) {
            bestLoc = { id: ds.id, ...d };
          } else if (
            compareLocationCode(d.locationCode, bestLoc.locationCode) < 0
          ) {
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
      const picked = Number(it._pickedQty || it.pickedQty || 0);
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
// 3.2 Rol Bazlı UI (branch sadece sipariş toplama görsün vb.)
// --------------------------------------------------------
function setupRoleBasedUI(profile) {
  const role = profile?.role || "";

  // Şube kullanıcıları için: ürün / stok ekranlarını gizle
  const productsNavBtn = document.querySelector('button[data-view="productsView"]');
  const stockNavBtn = document.querySelector('button[data-view="stockView"]');

  if (productsNavBtn) {
    productsNavBtn.classList.toggle("hidden", role === "branch");
  }
  if (stockNavBtn) {
    stockNavBtn.classList.toggle("hidden", role === "branch");
  }

  // Yeni sipariş butonu: şube, manager, admin görebilsin
  const newOrderBtn = $("openOrderModalBtn");
  if (newOrderBtn) {
    const canCreateOrder =
      role === "branch" || role === "manager" || role === "admin";
    newOrderBtn.classList.toggle("hidden", !canCreateOrder);
  }
}
// --------------------------------------------------------
// 3.3 Bildirimler (notifications)
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

  // Eski listener varsa kapat
  if (notificationsUnsub) {
    notificationsUnsub();
    notificationsUnsub = null;
  }

  const qRef = query(
    collection(db, "notifications"),
    where("userId", "==", currentUser.uid),
    orderBy("createdAt", "desc")
  );

  notificationsUnsub = onSnapshot(qRef, (snap) => {
    listEl.innerHTML = "";
    let unread = 0;

    if (snap.empty) {
      listEl.innerHTML =
        `<li class="text-[11px] text-slate-400">Henüz bildirim yok.</li>`;
    } else {
      snap.forEach((docSnap) => {
        const d = docSnap.data();
        if (!d.read) unread++;

        const li = document.createElement("li");
        li.className =
          "flex justify-between items-start text-xs border-b border-slate-100 py-1";
        li.innerHTML = `
          <div class="pr-2">
            <p class="font-semibold text-slate-700">${d.title || "-"}</p>
            <p class="text-[11px] text-slate-500">${d.message || ""}</p>
          </div>
          <span class="text-[10px] text-slate-400">
            ${
              d.createdAt?.toDate
                ? d.createdAt
                    .toDate()
                    .toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })
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
  });
}

// Bildirimleri okundu işaretle (isteğe bağlı)
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

    const promises = [];
    snap.forEach((docSnap) => {
      promises.push(
        updateDoc(doc(db, "notifications", docSnap.id), { read: true })
      );
    });
    await Promise.all(promises);
  } catch (err) {
    console.error("Bildirimler okunmuş işaretlenirken hata:", err);
  }
}

// --------------------------------------------------------
// 4. Auth UI
// --------------------------------------------------------
function switchAuthTab(tab) {
  const loginTab = $("loginTab");
  const registerTab = $("registerTab");
  const loginForm = $("loginForm");
  const registerForm = $("registerForm");

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
function showView(viewId) {
  const views = document.querySelectorAll(".view");
  views.forEach((v) => {
    v.classList.toggle("hidden", v.id !== viewId);
  });

  document.querySelectorAll(".nav-btn").forEach((btn) => {
    const target = btn.getAttribute("data-view");
    btn.classList.toggle("bg-slate-800", target === viewId);
  });
}

// --------------------------------------------------------
// 6. Products
// --------------------------------------------------------
async function loadProducts() {
  const tbody = $("productsTableBody");
  const emptyMsg = $("productsEmpty");
  const productSelect = $("stockProductSelect");
  if (!tbody || !productSelect) return;

  tbody.innerHTML = "";
  productSelect.innerHTML = "";

  const snapshot = await getDocs(collection(db, "products"));

  if (snapshot.empty) emptyMsg.classList.remove("hidden");
  else emptyMsg.classList.add("hidden");

  snapshot.forEach((docSnap) => {
    const data = docSnap.data();
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="px-3 py-2">${data.code || ""}</td>
      <td class="px-3 py-2">${data.name || ""}</td>
      <td class="px-3 py-2">${data.unit || ""}</td>
      <td class="px-3 py-2">${data.shelf || ""}</td>
      <td class="px-3 py-2">${data.stock ?? 0}</td>
      <td class="px-3 py-2 text-right space-x-1">
        <button class="text-xs px-2 py-1 rounded bg-sky-100 text-sky-700 hover:bg-sky-200" data-edit="${docSnap.id}">
          Düzenle
        </button>
        <button class="text-xs px-2 py-1 rounded bg-red-100 text-red-700 hover:bg-red-200" data-delete="${docSnap.id}">
          Sil
        </button>
      </td>
    `;
    tbody.appendChild(tr);

    const opt = document.createElement("option");
    opt.value = docSnap.id;
    opt.textContent = `${data.code || ""} - ${data.name || ""}`;
    productSelect.appendChild(opt);
  });

  tbody.querySelectorAll("button[data-edit]").forEach((btn) => {
    btn.addEventListener("click", () =>
      openProductModal(btn.getAttribute("data-edit"))
    );
  });
  tbody.querySelectorAll("button[data-delete]").forEach((btn) => {
    btn.addEventListener("click", () =>
      deleteProduct(btn.getAttribute("data-delete"))
    );
  });
}

async function openProductModal(productId = null) {
  $("productModal").classList.remove("hidden");
  $("productForm").reset();
  $("productId").value = productId || "";
  $("productModalTitle").textContent = productId ? "Ürün Düzenle" : "Yeni Ürün";

  if (productId) {
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
  }
}

function closeProductModal() {
  $("productModal").classList.add("hidden");
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

  if (!id) {
    payload.createdAt = serverTimestamp();
    await addDoc(collection(db, "products"), payload);
  } else {
    await updateDoc(doc(db, "products", id), payload);
  }

  closeProductModal();
  showGlobalAlert("Ürün kaydedildi.", "success");
  loadProducts();
}

async function deleteProduct(id) {
  if (!confirm("Bu ürünü silmek istediğine emin misin?")) return;
  await deleteDoc(doc(db, "products", id));
  showGlobalAlert("Ürün silindi.", "success");
  loadProducts();
}

// --------------------------------------------------------
// 7. Stock Movements
// --------------------------------------------------------
async function loadStockMovements() {
  const container = $("stockMovementsList");
  const empty = $("stockMovementsEmpty");
  if (!container) return;
  container.innerHTML = "";

  const qSnap = await getDocs(
    query(collection(db, "stockMovements"), orderBy("createdAt", "desc"))
  );

  let count = 0;
  qSnap.forEach((docSnap) => {
    if (count >= 10) return;
    const d = docSnap.data();
    const typeLabel =
      d.type === "in" ? "Giriş" : d.type === "out" ? "Çıkış" : "Transfer";

    const div = document.createElement("div");
    div.className =
      "border border-slate-100 rounded-lg px-3 py-2 flex justify-between items-center";
    div.innerHTML = `
      <div>
        <p class="font-semibold text-slate-700 text-xs">${d.productName || "-"}</p>
        <p class="text-[11px] text-slate-500">
          ${typeLabel} • ${d.qty} ${d.unit || ""} • ${d.sourceLocation || "-"} ➜ ${
      d.targetLocation || "-"
    }
        </p>
      </div>
      <span class="text-[11px] text-slate-400">
        ${
          d.createdAt?.toDate
            ? d.createdAt.toDate().toLocaleString("tr-TR")
            : ""
        }
      </span>
    `;
    container.appendChild(div);
    count++;
  });

  if (count === 0) empty.classList.remove("hidden");
  else empty.classList.add("hidden");
}

// 🔥 7.1 locationStocks güncelleme helper’ı
async function adjustLocationStock({
  productId,
  productData,
  locationCode,
  deltaQty,
  unitOverride,
}) {
  // Lokasyon veya ürün yoksa ya da değişim 0 ise boşver
  if (!productId || !locationCode || !deltaQty) return;

  try {
    // aynı productId + locationCode için kayıt var mı?
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

    // negatif başlayıp eksiye düşürmeye çalışma
    if (!targetDocRef && deltaQty < 0) {
      return;
    }

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

  // 🔥 7.2 locationStocks senkronizasyonu
  try {
    const commonArgs = {
      productId,
      productData,
      unitOverride: unit || productData.unit || "",
    };

    if (type === "in") {
      // GİRİŞ: hedef lokasyona qty ekle
      if (targetLocation) {
        await adjustLocationStock({
          ...commonArgs,
          locationCode: targetLocation,
          deltaQty: qty,
        });
      }
    } else if (type === "out") {
      // ÇIKIŞ: kaynak lokasyondan qty düş
      if (sourceLocation) {
        await adjustLocationStock({
          ...commonArgs,
          locationCode: sourceLocation,
          deltaQty: -qty,
        });
      }
    } else if (type === "transfer") {
      // TRANSFER: kaynaktan düş, hedefe ekle
      if (sourceLocation) {
        await adjustLocationStock({
          ...commonArgs,
          locationCode: sourceLocation,
          deltaQty: -qty,
        });
      }
      if (targetLocation) {
        await adjustLocationStock({
          ...commonArgs,
          locationCode: targetLocation,
          deltaQty: qty,
        });
      }
    }
  } catch (err) {
    console.error("locationStocks senkronizasyon hata:", err);
  }

  $("stockForm").reset();
  loadProducts();
  loadStockMovements();
  showGlobalAlert("Stok hareketi kaydedildi.", "success");
}

// --------------------------------------------------------
// 8. Orders (Şube Siparişleri)
// --------------------------------------------------------
function createOrderItemRow(productsMap) {
  const row = document.createElement("div");
  row.className =
    "grid grid-cols-5 gap-2 items-center border border-slate-100 rounded-lg px-2 py-1";

  const select = document.createElement("select");
  select.className =
    "col-span-2 rounded-lg border border-slate-300 px-2 py-1 text-xs";
  select.required = true;

  select.innerHTML = `<option value="">Ürün seç</option>`;
  productsMap.forEach((p, id) => {
    const opt = document.createElement("option");
    opt.value = id;
    opt.textContent = `${p.code} - ${p.name}`;
    select.appendChild(opt);
  });

  const qtyInput = document.createElement("input");
  qtyInput.type = "number";
  qtyInput.min = "1";
  qtyInput.value = "1";
  qtyInput.className =
    "col-span-1 rounded-lg border border-slate-300 px-2 py-1 text-xs";
  qtyInput.required = true;

  const noteInput = document.createElement("input");
  noteInput.type = "text";
  noteInput.placeholder = "Not";
  noteInput.className =
    "col-span-1 rounded-lg border border-slate-300 px-2 py-1 text-xs";

  const removeBtn = document.createElement("button");
  removeBtn.type = "button";
  removeBtn.textContent = "X";
  removeBtn.className =
    "col-span-1 text-[11px] px-2 py-1 rounded bg-red-100 text-red-700 hover:bg-red-200";

  removeBtn.addEventListener("click", () => {
    row.remove();
    const container = $("orderItemsContainer");
    if (container.children.length === 0) {
      $("orderItemsEmpty").classList.remove("hidden");
    }
  });

  row.appendChild(select);
  row.appendChild(qtyInput);
  row.appendChild(noteInput);
  row.appendChild(removeBtn);
  return row;
}

async function prepareOrderModal() {
  $("orderForm").reset();
  const container = $("orderItemsContainer");
  container.innerHTML = "";
  $("orderItemsEmpty").classList.remove("hidden");

  const productsSnap = await getDocs(collection(db, "products"));
  const productsMap = new Map();
  productsSnap.forEach((docSnap) => {
    productsMap.set(docSnap.id, docSnap.data());
  });

  $("addOrderItemBtn").onclick = () => {
    const row = createOrderItemRow(productsMap);
    container.appendChild(row);
    $("orderItemsEmpty").classList.add("hidden");
  };
}

function openOrderModal() {
  $("orderModal").classList.remove("hidden");
}

function closeOrderModal() {
  $("orderModal").classList.add("hidden");
}

async function saveOrder(evt) {
  evt.preventDefault();
  const branchName = $("orderBranchName").value.trim();
  const documentNo = $("orderDocumentNo").value.trim();
  const note = $("orderNote").value.trim();
  const container = $("orderItemsContainer");

  if (!branchName) {
    showGlobalAlert("Şube adı zorunludur.");
    return;
  }
  if (container.children.length === 0) {
    showGlobalAlert("En az bir ürün satırı eklemelisin.");
    return;
  }

  const items = [];
  const productsMap = new Map();
  const productsSnap = await getDocs(collection(db, "products"));
  productsSnap.forEach((docSnap) => {
    productsMap.set(docSnap.id, docSnap.data());
  });

  for (const row of container.children) {
    const selects = row.getElementsByTagName("select");
    const inputs = row.getElementsByTagName("input");
    if (selects.length === 0 || inputs.length < 2) continue;

    const productId = selects[0].value;
    const qty = Number(inputs[0].value || 0);
    const itemNote = inputs[1].value || "";
    if (!productId || qty <= 0) continue;

    const p = productsMap.get(productId);
    items.push({
      productId,
      productCode: p?.code || "",
      productName: p?.name || "",
      qty,
      unit: p?.unit || "",
      note: itemNote,
      pickedQty: 0,
      status: "open",
    });
  }

  if (items.length === 0) {
    showGlobalAlert("Geçerli satır yok. Ürün ve miktar girilmelidir.");
    return;
  }

  const orderPayload = {
    branchName,
    documentNo: documentNo || null,
    note: note || null,
    status: "open", // open, assigned, picking, completed
    createdAt: serverTimestamp(),
    createdBy: currentUser?.uid || null,
    createdByEmail: currentUser?.email || null,
    assignedTo: null,
  };

  const orderRef = await addDoc(collection(db, "orders"), orderPayload);

  for (const item of items) {
    await addDoc(collection(db, "orders", orderRef.id, "items"), {
      ...item,
      createdAt: serverTimestamp(),
    });
  }

  closeOrderModal();
  showGlobalAlert("Sipariş kaydedildi.", "success");
  loadOrders();
  loadPickingOrders();
}

async function loadOrders() {
  const tbody = $("ordersTableBody");
  const empty = $("ordersEmpty");
  if (!tbody) return;
  tbody.innerHTML = "";

  const qSnap = await getDocs(
    query(collection(db, "orders"), orderBy("createdAt", "desc"))
  );

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
        : "Tamamlandı";

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="px-3 py-2">${docSnap.id.slice(-6)}</td>
      <td class="px-3 py-2">${d.branchName || "-"}</td>
      <td class="px-3 py-2">${statusLabel}</td>
      <td class="px-3 py-2 text-xs">${d.assignedToEmail || "-"}</td>
      <td class="px-3 py-2 text-xs">
        ${
          d.createdAt?.toDate
            ? d.createdAt.toDate().toLocaleString("tr-TR")
            : ""
        }
      </td>
      <td class="px-3 py-2 text-right space-x-1">
        <button class="text-xs px-2 py-1 rounded bg-sky-100 text-sky-700 hover:bg-sky-200" data-detail="${
          docSnap.id
        }">Detay</button>
        ${
          currentUserProfile?.role === "manager" ||
          currentUserProfile?.role === "admin"
            ? `<button class="text-xs px-2 py-1 rounded bg-emerald-100 text-emerald-700 hover:bg-emerald-200" data-assign="${docSnap.id}">
                Toplayıcı Ata
              </button>`
            : ""
        }
      </td>
    `;
    tbody.appendChild(tr);
  }

  if (!hasAny) empty.classList.remove("hidden");
  else empty.classList.add("hidden");

  updateDashboardCounts();
  updateReportSummary();
}

async function assignOrderToPicker(orderId) {
  if (
    currentUserProfile?.role !== "manager" &&
    currentUserProfile?.role !== "admin"
  ) {
    showGlobalAlert("Bu işlem için yetkin yok.");
    return;
  }

  // Önce siparişi okuyalım (şube / belge bilgisi için)
  const orderRef = doc(db, "orders", orderId);
  const orderSnap = await getDoc(orderRef);
  const orderData = orderSnap.exists() ? orderSnap.data() : {};

  const usersSnap = await getDocs(
    query(collection(db, "users"), where("role", "==", "picker"))
  );
  if (usersSnap.empty) {
    showGlobalAlert("Kayıtlı toplayıcı yok.");
    return;
  }

  const pickers = [];
  usersSnap.forEach((docSnap) => {
    pickers.push({ id: docSnap.id, ...docSnap.data() });
  });

  const pickerEmailList = pickers
    .map((p, idx) => `${idx + 1}) ${p.fullName} - ${p.email}`)
    .join("\n");
  const input = prompt("Toplayıcı seç (numara ile):\n" + pickerEmailList);
  if (!input) return;
  const index = Number(input) - 1;
  if (index < 0 || index >= pickers.length) {
    showGlobalAlert("Geçersiz seçim.");
    return;
  }

  const picker = pickers[index];

  await updateDoc(orderRef, {
    assignedTo: picker.id,
    assignedToEmail: picker.email,
    status: "assigned",
  });

  // 🔔 Toplayıcıya bildirim
  await createNotification({
    userId: picker.id,
    type: "orderAssigned",
    orderId,
    title: "Yeni sipariş atandı",
    message: `${orderId.slice(-6)} no'lu (${orderData.branchName || "-"}) siparişi sana atandı.`,
  });

  // 🔔 Şube kullanıcısına (siparişi oluşturan) bilgi
  if (orderData.createdBy) {
    await createNotification({
      userId: orderData.createdBy,
      type: "orderStatus",
      orderId,
      title: "Sipariş durumu güncellendi",
      message: `${orderId.slice(-6)} no'lu sipariş toplayıcıya atandı.`,
    });
  }

  showGlobalAlert("Sipariş toplayıcıya atandı.", "success");
  loadOrders();
  loadPickingOrders();
}

// --------------------------------------------------------
// 9. Picking (Toplayıcı Ekranı + Rota)
// --------------------------------------------------------
async function loadPickingOrders() {
  const tbody = $("pickingTableBody");
  const empty = $("pickingEmpty");
  if (!tbody) return;
  tbody.innerHTML = "";

  if (!currentUser || !currentUserProfile) return;

  let qRef;
  if (currentUserProfile.role === "picker") {
    qRef = query(
      collection(db, "orders"),
      where("assignedTo", "==", currentUser.uid)
    );
  } else if (
    currentUserProfile.role === "manager" ||
    currentUserProfile.role === "admin"
  ) {
    qRef = collection(db, "orders");
  } else {
    qRef = query(
      collection(db, "orders"),
      where("createdBy", "==", currentUser.uid)
    );
  }

  const qSnap = await getDocs(qRef);
  let hasAny = false;

  for (const docSnap of qSnap.docs) {
    const d = docSnap.data();
    const statusLabel =
      d.status === "open"
        ? "Açık"
        : d.status === "assigned"
        ? "Atandı"
        : d.status === "picking"
        ? "Toplanıyor"
        : "Tamamlandı";

    hasAny = true;
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="px-3 py-2">${docSnap.id.slice(-6)}</td>
      <td class="px-3 py-2">${d.branchName || "-"}</td>
      <td class="px-3 py-2">${statusLabel}</td>
      <td class="px-3 py-2 text-xs">${d.assignedToEmail || "-"}</td>
      <td class="px-3 py-2 text-right">
        <button class="text-xs px-2 py-1 rounded bg-sky-100 text-sky-700 hover:bg-sky-200" data-pick="${
          docSnap.id
        }">Topla</button>
      </td>
    `;
    tbody.appendChild(tr);
  }

  if (!hasAny) empty.classList.remove("hidden");
  else empty.classList.add("hidden");
}

async function openPickingDetailModal(orderId, fromPicking) {
  pickingDetailOrderId = orderId;
  const container = $("pickingDetailContent");
  if (!container) return;
  container.innerHTML = "";

  const orderRef = doc(db, "orders", orderId);
  const orderSnap = await getDoc(orderRef);
  if (!orderSnap.exists()) {
    showGlobalAlert("Sipariş bulunamadı.");
    return;
  }
  pickingDetailOrderDoc = orderSnap;
  const orderData = orderSnap.data();

  // 🔥 Toplayıcı ekrandan açıyorsa statüyü "picking" yap
  if (
    fromPicking &&
    orderData.status !== "completed" &&
    orderData.status !== "picking"
  ) {
    try {
      await updateDoc(orderRef, {
        status: "picking",
        pickingStartedAt: serverTimestamp(),
        pickingStartedBy: currentUser?.uid || null,
        pickingStartedByEmail: currentUser?.email || null,
      });
      orderData.status = "picking"; // ekranda da güncel gözüksün
    } catch (err) {
      console.error("Statü picking yapılırken hata:", err);
    }
  }

  // Sipariş kalemlerini oku
  const itemsSnap = await getDocs(collection(db, "orders", orderId, "items"));
  const items = [];
  itemsSnap.forEach((docSnap) => {
    items.push({ id: docSnap.id, ...docSnap.data() });
  });

  // 🔥 Lokasyonla zenginleştir + rota sırası
  const itemsWithLoc = await enrichItemsWithLocation(items);
  itemsWithLoc.sort((a, b) =>
    compareLocationCode(a.locationCode || "", b.locationCode || "")
  );
  pickingDetailItems = itemsWithLoc;

  const totalLines = itemsWithLoc.length;
  const totalQty = itemsWithLoc.reduce(
    (sum, it) => sum + Number(it.qty || 0),
    0
  );
  const uniqueLocations = new Set(
    itemsWithLoc.map((it) => it.locationCode || "Lokasyon yok")
  ).size;

  const headerHtml = `
    <div class="border border-slate-200 rounded-lg p-3 text-xs">
      <p><span class="font-semibold">Şube:</span> ${orderData.branchName || "-"}</p>
      <p><span class="font-semibold">Belge No:</span> ${
        orderData.documentNo || "-"
      }</p>
      <p><span class="font-semibold">Durum:</span> ${orderData.status || "-"}</p>
      <p><span class="font-semibold">Toplayıcı:</span> ${
        orderData.assignedToEmail || "-"
      }</p>
      <p class="mt-1 text-[11px] text-slate-600">
        🔁 Toplama rotası: ${uniqueLocations} lokasyonda ${totalLines} kalem, toplam ${totalQty} birim.
      </p>
      <p class="mt-1 text-[11px] text-amber-700">
        ${
          itemsWithLoc.some((it) => it.locationShortage)
            ? "⚠ Bazı lokasyonlarda istenen miktardan az stok var (kırmızı satırlar)."
            : ""
        }
      </p>
    </div>
  `;

  const rowsHtml = itemsWithLoc
    .map((it, index) => {
      const shortage = it.locationShortage;
      const shortageBadge = shortage
        ? `<span class="ml-1 inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-red-100 text-red-700">Eksik</span>`
        : "";
      const rowClass = shortage ? "bg-red-50" : "";
      return `
      <tr class="border-b border-slate-100 ${rowClass}">
        <td class="px-2 py-1 text-xs">${index + 1}</td>
        <td class="px-2 py-1 text-xs">${it.locationCode || "-"}</td>
        <td class="px-2 py-1 text-xs">${it.productCode || ""}</td>
        <td class="px-2 py-1 text-xs">${it.productName || ""}</td>
        <td class="px-2 py-1 text-xs">
          ${it.qty} ${it.unit || ""} 
          <span class="text-[10px] text-slate-500">(Lokasyondaki: ${
            it.locationAvailableQty ?? "-"
          })</span>
          ${shortageBadge}
        </td>
        <td class="px-2 py-1 text-xs">
          ${
            fromPicking
              ? `<input type="number" min="0" value="${
                  it.pickedQty ?? it.qty
                }" data-item="${it.id}" class="w-20 border border-slate-300 rounded px-1 py-0.5 text-xs" />`
              : `${it.pickedQty ?? 0}`
          }
        </td>
        <td class="px-2 py-1 text-xs">${it.note || ""}</td>
      </tr>
    `;
    })
    .join("");

  const tableHtml = `
    <div class="mt-3 border border-slate-200 rounded-lg overflow-hidden">
      <table class="min-w-full text-xs">
        <thead class="bg-slate-50">
          <tr>
            <th class="px-2 py-1 text-left">#</th>
            <th class="px-2 py-1 text-left">Lokasyon</th>
            <th class="px-2 py-1 text-left">Kod</th>
            <th class="px-2 py-1 text-left">Ürün</th>
            <th class="px-2 py-1 text-left">İstenen</th>
            <th class="px-2 py-1 text-left">Toplanan</th>
            <th class="px-2 py-1 text-left">Not</th>
          </tr>
        </thead>
        <tbody>
          ${
            rowsHtml ||
            `<tr><td colspan="7" class="px-2 py-2 text-center text-slate-400">Kalem yok.</td></tr>`
          }
        </tbody>
      </table>
    </div>
  `;

  container.innerHTML = headerHtml + tableHtml;
  $("pickingDetailModal")?.classList.remove("hidden");

  const completeBtn = $("completePickingBtn");
  if (completeBtn) {
    completeBtn.disabled = !fromPicking;
    completeBtn.classList.toggle("opacity-50", !fromPicking);
    completeBtn.classList.toggle("cursor-not-allowed", !fromPicking);
  }
}
function closePickingDetailModal() {
  const modal = $("pickingDetailModal");
  if (modal) modal.classList.add("hidden");
  pickingDetailOrderId = null;
  pickingDetailItems = [];
  pickingDetailOrderDoc = null;
}

async function completePicking() {
  if (!pickingDetailOrderId || !pickingDetailItems.length) return;

  const container = $("pickingDetailContent");
  if (!container) return;
  const inputs = container.querySelectorAll("input[data-item]");
  const newPickedMap = new Map();
  inputs.forEach((inp) => {
    const id = inp.getAttribute("data-item");
    const val = Number(inp.value || 0);
    newPickedMap.set(id, val);
  });

  const updatedItems = [];

  for (const item of pickingDetailItems) {
    const picked = newPickedMap.has(item.id)
      ? newPickedMap.get(item.id)
      : item.pickedQty || 0;

    await updateDoc(
      doc(db, "orders", pickingDetailOrderId, "items", item.id),
      {
        pickedQty: picked,
        status: picked >= item.qty ? "completed" : "partial",
      }
    );

    updatedItems.push({ ...item, _pickedQty: picked });
  }

  // Sipariş statüsünü tamamlandı yap
  await updateDoc(doc(db, "orders", pickingDetailOrderId), {
    status: "completed",
    completedAt: serverTimestamp(),
    completedBy: currentUser?.uid || null,
    completedByEmail: currentUser?.email || null,
  });

  // 🔥 Lokasyon stoklarını güncelle
  await applyPickingToLocationStocks(pickingDetailOrderId, updatedItems);

  // 🔥 picker performans log'u
  try {
    const orderData =
      pickingDetailOrderDoc && pickingDetailOrderDoc.data
        ? pickingDetailOrderDoc.data()
        : {};

    const totalLines = updatedItems.length;
    const totalQty = updatedItems.reduce(
      (sum, it) => sum + Number(it._pickedQty || it.pickedQty || 0),
      0
    );

    await addDoc(collection(db, "pickingLogs"), {
      orderId: pickingDetailOrderId,
      branchName: orderData.branchName || null,
      pickerId: currentUser?.uid || null,
      pickerEmail: currentUser?.email || null,
      totalLines,
      totalQty,
      completedAt: serverTimestamp(),
    });
  } catch (err) {
    console.error("pickingLogs yazılırken hata:", err);
  }
  // 🔔 Şube kullanıcısına "sipariş tamamlandı" bildirimi
  try {
    const orderData =
      pickingDetailOrderDoc && pickingDetailOrderDoc.data
        ? pickingDetailOrderDoc.data()
        : {};

    if (orderData.createdBy) {
      await createNotification({
        userId: orderData.createdBy,
        type: "orderCompleted",
        orderId: pickingDetailOrderId,
        title: "Sipariş tamamlandı",
        message: `${pickingDetailOrderId.slice(-6)} no'lu siparişin toplanması tamamlandı.`,
      });
    }
  } catch (err) {
    console.error("Sipariş tamamlandı bildirimi hata:", err);
  }

  closePickingDetailModal();
  showGlobalAlert("Sipariş toplaması tamamlandı.", "success");
  await loadOrders();
  await loadPickingOrders();
  await updatePickerDashboardStats(); // dashboard'taki günlük özet güncellensin
}
// --------------------------------------------------------
// 9.1 Araç Yükleme & Sevk (pallets üzerinden)
// --------------------------------------------------------
async function loadLoadingTasks() {
  const tbody = $("loadingTasksTableBody");
  const empty = $("loadingTasksEmpty");
  const statusFilter = $("loadingStatusFilter");

  if (!tbody) return;

  tbody.innerHTML = "";

  // Artık pallets koleksiyonu üzerinden çalışıyoruz
  let qRef = collection(db, "pallets");

  // Filtre uygulanacaksa
  if (statusFilter && statusFilter.value && statusFilter.value !== "all") {
    qRef = query(
      collection(db, "pallets"),
      where("status", "==", statusFilter.value)
    );
  }

  const snap = await getDocs(
    query(qRef, orderBy("createdAt", "desc"))
  );

  let hasAny = false;
  let waitingCount = 0;
  let todayLoadedCount = 0;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  snap.forEach((docSnap) => {
    hasAny = true;
    const d = docSnap.data();

    if (d.status === "waiting") waitingCount++;
    if (d.status === "loaded") {
      const dt = d.loadedAt?.toDate ? d.loadedAt.toDate() : null;
      if (dt && dt >= today && dt < tomorrow) {
        todayLoadedCount++;
      }
    }

    const statusLabel =
      d.status === "waiting"
        ? "Bekliyor"
        : d.status === "loading"
        ? "Yükleniyor"
        : "Yüklendi";

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="px-2 py-1">${d.shipmentNo || d.shipmentId || "-"}</td>
      <td class="px-2 py-1 hidden sm:table-cell">${d.branchName || "-"}</td>
      <td class="px-2 py-1">${d.palletNo || "-"}</td>
      <td class="px-2 py-1 hidden md:table-cell">${d.dockLocationId || "-"}</td>
      <td class="px-2 py-1">${statusLabel}</td>
      <td class="px-2 py-1 hidden md:table-cell">${d.loadedByEmail || "-"}</td>
      <td class="px-2 py-1 hidden md:table-cell">
        ${
          d.loadedAt?.toDate
            ? d.loadedAt
                .toDate()
                .toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })
            : "-"
        }
      </td>
      <td class="px-2 py-1 text-right space-x-1">
        ${
          d.status !== "loaded"
            ? `
          <button
            class="text-[11px] px-2 py-1 rounded bg-amber-100 text-amber-800 hover:bg-amber-200"
            data-loading-start="${docSnap.id}">
            Yüklemeye Başla
          </button>
          <button
            class="text-[11px] px-2 py-1 rounded bg-emerald-100 text-emerald-800 hover:bg-emerald-200"
            data-loading-complete="${docSnap.id}">
            Yüklendi
          </button>
          `
            : ""
        }
      </td>
    `;
    tbody.appendChild(tr);
  });

  if (!hasAny) empty.classList.remove("hidden");
  else empty.classList.add("hidden");

  // Özet kutularını güncelle
  const waitingEl = $("loadingWaitingSummary");
  const todayEl = $("loadingTodaySummary");
  if (waitingEl)
    waitingEl.textContent = `${waitingCount} palet bekliyor.`;
  if (todayEl)
    todayEl.textContent = `Bugün ${todayLoadedCount} palet yüklendi.`;
}

async function setLoadingTaskStatus(taskId, newStatus) {
  try {
    // pallets koleksiyonundaki palet kaydı
    const ref = doc(db, "pallets", taskId);

    const payload = {
      status: newStatus,
    };

    if (newStatus === "loading") {
      payload.loadingStartedAt = serverTimestamp();
      payload.loadingStartedBy = currentUser?.uid || null;
      payload.loadingStartedByEmail = currentUser?.email || null;
    }

    if (newStatus === "loaded") {
      payload.loadedAt = serverTimestamp();
      payload.loadedBy = currentUser?.uid || null;
      payload.loadedByEmail = currentUser?.email || null;
    }

    await updateDoc(ref, payload);
    showGlobalAlert("Yükleme durumu güncellendi.", "success");

    await loadLoadingTasks();
  } catch (err) {
    console.error("Yükleme durumu güncellenirken hata:", err);
    showGlobalAlert("Yükleme durumu güncellenemedi: " + err.message);
  }
}

// --------------------------------------------------------
// 10. Dashboard & Reports
// --------------------------------------------------------
async function updateDashboardCounts() {
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

  $("cardTotalProducts").textContent = totalProducts;
  $("cardOpenOrders").textContent = open;
  $("cardPickingOrders").textContent = picking;
  $("cardCompletedOrders").textContent = completed;
}

async function updateReportSummary() {
  const ordersSnap = await getDocs(collection(db, "orders"));
  let totalOrders = 0;
  let completedOrders = 0;
  ordersSnap.forEach((docSnap) => {
    totalOrders++;
    if (docSnap.data().status === "completed") completedOrders++;
  });

  const productsSnap = await getDocs(collection(db, "products"));
  const totalProducts = productsSnap.size;

  $("reportTotalProducts").textContent = `Toplam ürün: ${totalProducts}`;
  $("reportTotalOrders").textContent = `Toplam sipariş: ${totalOrders}`;
  $("reportCompletedOrders").textContent = `Tamamlanan sipariş: ${completedOrders}`;
}
// --------------------------------------------------------
// 10.1 Picker günlük performans özeti
// --------------------------------------------------------
async function updatePickerDashboardStats() {
  if (!currentUser) return;

  const el = $("pickerStatsToday");
  if (!el) return; // HTML'e eklemezsen sessizce geçer

  try {
    const snap = await getDocs(
      query(collection(db, "pickingLogs"), where("pickerId", "==", currentUser.uid))
    );

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

    if (totalOrders === 0) {
      el.textContent = "Bugün henüz tamamlanan toplama yok.";
    } else {
      el.textContent = `Bugün ${totalOrders} siparişte, ${totalLines} kalem, toplam ${totalQty} birim toplandı.`;
    }
  } catch (err) {
    console.error("Picker dashboard stats hata:", err);
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
    await setDoc(doc(db, "users", uid), {
      fullName,
      role,
      email,
      createdAt: serverTimestamp(),
    });
    showAuthMessage("Kayıt başarılı, giriş yapıldı.", false);
  } catch (err) {
    console.error(err);
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
    console.error(err);
    showAuthMessage("Giriş hatası: " + err.message);
  }
}

async function handleLogout() {
  await signOut(auth);
}

onAuthStateChanged(auth, async (user) => {
  currentUser = user;

  // Kullanıcı yoksa (logout / login değilse)
  if (!user) {
    // Bildirim listener'ını da kapat
    if (notificationsUnsub) {
      notificationsUnsub();
      notificationsUnsub = null;
    }


    $("authSection").classList.remove("hidden");
    $("appSection").classList.add("hidden");
    showAuthMessage("");
    currentUserProfile = null;
    setCurrentUserInfo(null, null);
    setRoleBadge("-");
    return;
  }

  // Kullanıcı varsa profilini çek
  const userRef = doc(db, "users", user.uid);
  const snap = await getDoc(userRef);
  if (snap.exists()) {
    currentUserProfile = snap.data();
  } else {
    currentUserProfile = {
      fullName: user.email,
      role: "branch",
      email: user.email,
      createdAt: serverTimestamp(),
    };
    await setDoc(userRef, currentUserProfile);
  }

  setCurrentUserInfo(user, currentUserProfile);
  setRoleBadge(currentUserProfile.role);
  setupRoleBasedUI(currentUserProfile);

  $("authSection").classList.add("hidden");
  $("appSection").classList.remove("hidden");
  showView("dashboardView");
  await loadLoadingTasks();  // araç yükleme özetleri
  // 🔔 Bildirim dinleyicisini başlat
  startNotificationListener();

  await loadProducts();
  await loadStockMovements();
  await loadOrders();
  await loadPickingOrders();
  await loadLoadingTasks();
});


// --------------------------------------------------------
// 12. DOM Ready & Events
// --------------------------------------------------------
document.addEventListener("DOMContentLoaded", () => {
  $("loginTab").addEventListener("click", () => switchAuthTab("login"));
  $("registerTab").addEventListener("click", () => switchAuthTab("register"));

  $("registerForm").addEventListener("submit", handleRegister);
  $("loginForm").addEventListener("submit", handleLogin);
  $("logoutBtn").addEventListener("click", handleLogout);

  document.querySelectorAll(".nav-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const viewId = btn.getAttribute("data-view");
      showView(viewId);
      if (viewId === "productsView") loadProducts();
      if (viewId === "stockView") {
        loadProducts();
        loadStockMovements();
      }
      // Araç Yükleme view'i açıldığında kayıtları getir
      const loadingStatusFilter = $("loadingStatusFilter");
      const reloadLoadingTasksBtn = $("reloadLoadingTasksBtn");

      if (reloadLoadingTasksBtn) {
        reloadLoadingTasksBtn.addEventListener("click", loadLoadingTasks);
      }
      if (loadingStatusFilter) {
        loadingStatusFilter.addEventListener("change", loadLoadingTasks);
      }

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
            return;
          }
        });
      }

      if (viewId === "ordersView") loadOrders();
      if (viewId === "pickingView") loadPickingOrders();
      if (viewId === "reportsView") updateReportSummary();
    });
  });

  $("openProductModalBtn").addEventListener("click", () => openProductModal());
  $("closeProductModalBtn").addEventListener("click", closeProductModal);
  $("cancelProductBtn").addEventListener("click", closeProductModal);
  $("productForm").addEventListener("submit", saveProduct);

  $("stockForm").addEventListener("submit", saveStockMovement);

  $("openOrderModalBtn").addEventListener("click", async () => {
    await prepareOrderModal();
    openOrderModal();
  });
  $("closeOrderModalBtn").addEventListener("click", closeOrderModal);
  $("cancelOrderBtn").addEventListener("click", closeOrderModal);
  $("orderForm").addEventListener("submit", saveOrder);

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

  $("closePickingDetailModalBtn").addEventListener(
    "click",
    closePickingDetailModal
  );
  $("completePickingBtn").addEventListener("click", completePicking);
});
