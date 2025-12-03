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

// Init
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

// --------------------------------------------------------
// 3. Helper Functions
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

  setTimeout(() => {
    el.classList.add("hidden");
  }, 4000);
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
// 3.1 Location Helpers - Toplama Rotası
// --------------------------------------------------------

// "A1-01-01" gibi kodu parçalayıp sayıya çevirir
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

// İki lokasyon kodunu kıyaslar (rota sırası)
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

// Her ürün için en uygun lokasyonu bulur (şimdilik en küçük lokasyonCode)
async function enrichItemsWithLocation(items) {
  const result = [];

  for (const it of items) {
    let bestLocationCode = null;
    let bestLocationId = null;

    try {
      if (it.productId) {
        const qSnap = await getDocs(
          query(
            collection(db, "locationStocks"),
            where("productId", "==", it.productId)
          )
        );

        let best = null;
        qSnap.forEach((docSnap) => {
          const d = docSnap.data();
          if (!d.locationCode) return;
          if (!best) {
            best = { id: docSnap.id, ...d };
          } else if (
            compareLocationCode(d.locationCode, best.locationCode) < 0
          ) {
            best = { id: docSnap.id, ...d };
          }
        });

        if (best) {
          bestLocationCode = best.locationCode;
          bestLocationId = best.locationId || best.id;
        }
      }
    } catch (err) {
      console.error("Lokasyon okunurken hata:", err);
    }

    result.push({
      ...it,
      locationCode: bestLocationCode,
      locationId: bestLocationId,
    });
  }

  return result;
}

// --------------------------------------------------------
// 4. Auth UI Control
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
function showView(viewId) {
  const views = document.querySelectorAll(".view");
  views.forEach((v) => {
    if (v.id === viewId) {
      v.classList.remove("hidden");
    } else {
      v.classList.add("hidden");
    }
  });

  const navBtns = document.querySelectorAll(".nav-btn");
  navBtns.forEach((btn) => {
    const target = btn.getAttribute("data-view");
    if (target === viewId) {
      btn.classList.add("bg-slate-800");
    } else {
      btn.classList.remove("bg-slate-800");
    }
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
  if (snapshot.empty) {
    emptyMsg?.classList.remove("hidden");
  } else {
    emptyMsg?.classList.add("hidden");
  }

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

  // Edit/Delete events
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
  const modal = $("productModal");
  if (!modal) return;
  modal.classList.remove("hidden");

  $("productForm")?.reset();
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
  const modal = $("productModal");
  if (!modal) return;
  modal.classList.add("hidden");
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

  if (count === 0) {
    empty?.classList.remove("hidden");
  } else {
    empty?.classList.add("hidden");
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
  if (type === "in") {
    newStock += qty;
  } else if (type === "out") {
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

  $("stockForm")?.reset();
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
    if (container && container.children.length === 0) {
      $("orderItemsEmpty")?.classList.remove("hidden");
    }
  });

  row.appendChild(select);
  row.appendChild(qtyInput);
  row.appendChild(noteInput);
  row.appendChild(removeBtn);
  return row;
}

async function prepareOrderModal() {
  $("orderForm")?.reset();
  const container = $("orderItemsContainer");
  if (!container) return;

  container.innerHTML = "";
  $("orderItemsEmpty")?.classList.remove("hidden");

  const productsSnap = await getDocs(collection(db, "products"));
  const productsMap = new Map();
  productsSnap.forEach((docSnap) => {
    productsMap.set(docSnap.id, docSnap.data());
  });

  $("addOrderItemBtn").onclick = () => {
    const row = createOrderItemRow(productsMap);
    container.appendChild(row);
    $("orderItemsEmpty")?.classList.add("hidden");
  };
}

function openOrderModal() {
  $("orderModal")?.classList.remove("hidden");
}

function closeOrderModal() {
  $("orderModal")?.classList.add("hidden");
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
  if (!container || container.children.length === 0) {
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
    assignedToEmail: null,
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
    const tr = document.createElement("tr");
    const statusLabel =
      d.status === "open"
        ? "Açık"
        : d.status === "assigned"
        ? "Atandı"
        : d.status === "picking"
        ? "Toplanıyor"
        : "Tamamlandı";

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

  if (!hasAny) {
    empty?.classList.remove("hidden");
  } else {
    empty?.classList.add("hidden");
  }

  updateDashboardCounts();
  updateReportSummary();
}

// Toplayıcıya atama
async function assignOrderToPicker(orderId) {
  if (
    currentUserProfile?.role !== "manager" &&
    currentUserProfile?.role !== "admin"
  ) {
    showGlobalAlert("Bu işlem için yetkin yok.");
    return;
  }

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
  console.log("Toplayıcı ata tıklandı:", orderId);

  await updateDoc(doc(db, "orders", orderId), {
    assignedTo: picker.id,
    assignedToEmail: picker.email,
    status: "assigned",
  });

  showGlobalAlert("Sipariş toplayıcıya atandı.", "success");
  loadOrders();
  loadPickingOrders();
}

// --------------------------------------------------------
// 9. Picking (Toplayıcı Ekranı)
// --------------------------------------------------------
async function loadPickingOrders() {
  const tbody = $("pickingTableBody");
  const empty = $("pickingEmpty");
  if (!tbody || !currentUser || !currentUserProfile) return;

  tbody.innerHTML = "";

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

  if (!hasAny) {
    empty?.classList.remove("hidden");
  } else {
    empty?.classList.add("hidden");
  }
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

  // Sipariş kalemlerini oku
  const itemsSnap = await getDocs(collection(db, "orders", orderId, "items"));
  const items = [];
  itemsSnap.forEach((docSnap) => {
    items.push({ id: docSnap.id, ...docSnap.data() });
  });

  // 🔥 Toplama rotası: her kalemi lokasyonla zenginleştir + sırala
  const itemsWithLocation = await enrichItemsWithLocation(items);

  itemsWithLocation.sort((a, b) => {
    const aCode = a.locationCode || "";
    const bCode = b.locationCode || "";
    return compareLocationCode(aCode, bCode);
  });

  pickingDetailItems = itemsWithLocation;

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
      <p class="mt-1 text-[11px] text-slate-500">
        🔁 Toplama rotası: lokasyon koduna göre (bölge > koridor > raf > seviye) otomatik sıralandı.
      </p>
    </div>
  `;

  const rowsHtml = itemsWithLocation
    .map(
      (it, index) => `
    <tr class="border-b border-slate-100">
      <td class="px-2 py-1 text-xs">${index + 1}</td>
      <td class="px-2 py-1 text-xs">${it.locationCode || "-"}</td>
      <td class="px-2 py-1 text-xs">${it.productCode || ""}</td>
      <td class="px-2 py-1 text-xs">${it.productName || ""}</td>
      <td class="px-2 py-1 text-xs">${it.qty} ${it.unit || ""}</td>
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
  `
    )
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
  $("pickingDetailModal")?.classList.add("hidden");
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
  }

  await updateDoc(doc(db, "orders", pickingDetailOrderId), {
    status: "completed",
    completedAt: serverTimestamp(),
    completedBy: currentUser?.uid || null,
    completedByEmail: currentUser?.email || null,
  });

  closePickingDetailModal();
  showGlobalAlert("Sipariş toplaması tamamlandı.", "success");
  loadOrders();
  loadPickingOrders();
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

// --------------------------------------------------------
// 12. Auth State Listener
// --------------------------------------------------------
onAuthStateChanged(auth, async (user) => {
  currentUser = user;
  if (!user) {
    $("authSection")?.classList.remove("hidden");
    $("appSection")?.classList.add("hidden");
    showAuthMessage("");
    currentUserProfile = null;
    setCurrentUserInfo(null, null);
    setRoleBadge("-");
    return;
  }

  const userRef = doc(db, "users", user.uid);
  const snap = await getDoc(userRef);
  if (snap.exists()) {
    currentUserProfile = snap.data();
  } else {
    currentUserProfile = {
      fullName: user.email,
      role: "branch",
      email: user.email,
    };
    await setDoc(userRef, currentUserProfile);
  }

  setCurrentUserInfo(user, currentUserProfile);
  setRoleBadge(currentUserProfile.role);

  $("authSection")?.classList.add("hidden");
  $("appSection")?.classList.remove("hidden");
  showView("dashboardView");

  await loadProducts();
  await loadStockMovements();
  await loadOrders();
  await loadPickingOrders();
});

// --------------------------------------------------------
// 13. DOM Ready & Event Bindings
// --------------------------------------------------------
document.addEventListener("DOMContentLoaded", () => {
  // Auth tabları
  $("loginTab")?.addEventListener("click", () => switchAuthTab("login"));
  $("registerTab")?.addEventListener("click", () => switchAuthTab("register"));

  // Auth forms
  $("registerForm")?.addEventListener("submit", handleRegister);
  $("loginForm")?.addEventListener("submit", handleLogin);
  $("logoutBtn")?.addEventListener("click", handleLogout);

  // Nav buttons
  document.querySelectorAll(".nav-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const viewId = btn.getAttribute("data-view");
      showView(viewId);
      if (viewId === "productsView") loadProducts();
      if (viewId === "stockView") {
        loadProducts();
        loadStockMovements();
      }
      if (viewId === "ordersView") loadOrders();
      if (viewId === "pickingView") loadPickingOrders();
      if (viewId === "reportsView") updateReportSummary();
    });
  });

  // Products modal
  $("openProductModalBtn")?.addEventListener("click", () => openProductModal());
  $("closeProductModalBtn")?.addEventListener("click", closeProductModal);
  $("cancelProductBtn")?.addEventListener("click", closeProductModal);
  $("productForm")?.addEventListener("submit", saveProduct);

  // Stock form
  $("stockForm")?.addEventListener("submit", saveStockMovement);

  // Order modal
  $("openOrderModalBtn")?.addEventListener("click", async () => {
    await prepareOrderModal();
    openOrderModal();
  });
  $("closeOrderModalBtn")?.addEventListener("click", closeOrderModal);
  $("cancelOrderBtn")?.addEventListener("click", closeOrderModal);
  $("orderForm")?.addEventListener("submit", saveOrder);

  // Şube Siparişleri tablosu: Detay & Toplayıcı Ata (event delegation)
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
        return;
      }
    });
  }

  // Toplama tablosu: Topla butonu (event delegation)
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

  // Picking detail modal
  $("closePickingDetailModalBtn")?.addEventListener(
    "click",
    closePickingDetailModal
  );
  $("completePickingBtn")?.addEventListener("click", completePicking);
});
