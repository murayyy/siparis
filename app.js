// app.js (ESM module) — DepoOS (Firestore + Auth) TAM DOSYA
// ✅ Excel import: Şube adı artık Excel’den ZORUNLU DEĞİL. Modal’daki “Şube Adı” inputundan alınır.
// ✅ Toplama: “Toplandı” işaretlenince pickedQty = qty olur (siparişteki miktar toplandı olarak gelir).
// ✅ Eksik Depo: Eksik çıkan kalemler missing_depot koleksiyonuna düşer, yönetici “Tamamlandı” yapar.
// ✅ Rol bazlı menü, ürünler, siparişler, toplama, yükleme, bildirim UI hook’ları içerir.
//
// Kurulum:
// 1) Firebase Console -> Project settings -> Web app config -> aşağıdaki firebaseConfig içine yapıştır
// 2) Firestore Collections:
//    - users/{uid} : { name, email, role }
//    - products/{id} : { code, name, unit, shelf, stock, note, barcode }
//    - orders/{id} : { branchName, documentNo, note, status, createdAt, createdBy, createdByEmail, assignedTo, assignedToEmail, ... }
//    - orders/{orderId}/items/{itemId} : { productCode, productName, qty, unit, note, shelf, reyon, barcode, pickedQty, pickedDone, missingFlag, missingQty, status, createdAt }
//    - missing_depot/{id} : { orderId, orderNo, branchName, itemId, productCode, productName, missingQty, status, createdAt, createdBy, resolvedAt, resolvedBy }
//    - pallets/{id} : (opsiyonel) { shipmentNo, branchName, palletNo, dock, status, loadedBy, loadedAt }
//    - users/{uid}/notifications/{id} : { title, body, createdAt, read }
//
// 3) Firestore Rules yoksa “Missing or insufficient permissions” alırsın. En altta örnek rules var.

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updateProfile,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  collection,
  query,
  where,
  orderBy,
  limit,
  getDocs,
  onSnapshot
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

/* =========================================================
   0) Firebase Config
========================================================= */
const firebaseConfig = {
   apiKey: "AIzaSyDcLQB4UggXlYA9x8AKw-XybJjcF6U_KA4",
  authDomain: "depo1-4668f.firebaseapp.com",
  projectId: "depo1-4668f",
  storageBucket: "depo1-4668f.firebasestorage.app",
  messagingSenderId: "1044254626353",
  appId: "1:1044254626353:web:148c57df2456cc3d9e3b10",
  measurementId: "G-DFGMVLK9XH"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

/* =========================================================
   1) Helpers
========================================================= */
const $ = (id) => document.getElementById(id);

function show(el) { if (el) el.classList.remove("hidden"); }
function hide(el) { if (el) el.classList.add("hidden"); }

function escapeHtml(str) {
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function showGlobalAlert(msg, type = "info") {
  const el = $("globalAlert");
  if (!el) return;

  el.classList.remove("hidden");
  el.className = "border rounded-2xl px-3 py-2 text-[11px] md:text-xs";

  const base = "border rounded-2xl px-3 py-2 text-[11px] md:text-xs";
  const styles = {
    info: "border-slate-700 bg-slate-900/70 text-slate-200",
    success: "border-emerald-700 bg-emerald-900/30 text-emerald-200",
    warning: "border-amber-700 bg-amber-900/20 text-amber-200",
    error: "border-rose-700 bg-rose-900/20 text-rose-200"
  };
  el.className = `${base} ${styles[type] || styles.info}`;
  el.innerHTML = escapeHtml(msg);

  clearTimeout(showGlobalAlert._t);
  showGlobalAlert._t = setTimeout(() => {
    el.classList.add("hidden");
  }, 4500);
}

function friendlyFirebaseError(err) {
  const msg = err?.message || String(err);
  if (/Missing or insufficient permissions/i.test(msg)) {
    return "Firestore izin hatası: Rules/Yetkiler izin vermiyor (Missing or insufficient permissions). Firebase Console > Firestore Rules tarafını düzeltmelisin.";
  }
  if (/auth\/wrong-password|auth\/invalid-credential/i.test(msg)) {
    return "E-posta veya şifre yanlış.";
  }
  if (/auth\/email-already-in-use/i.test(msg)) {
    return "Bu e-posta zaten kayıtlı.";
  }
  return msg;
}

function formatDate(ts) {
  try {
    const d = ts?.toDate ? ts.toDate() : (ts instanceof Date ? ts : null);
    if (!d) return "-";
    return d.toLocaleString("tr-TR", { dateStyle: "short", timeStyle: "short" });
  } catch {
    return "-";
  }
}

function clampNum(n, min = 0) {
  const x = Number(n);
  if (!Number.isFinite(x)) return min;
  return Math.max(min, x);
}

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

/* =========================================================
   2) Global State
========================================================= */
let currentUser = null;
let currentUserDoc = null;
let currentRole = null;

let unsubNotifications = null;

/* =========================================================
   3) Auth UI: Tabs + Forms
========================================================= */
function initAuthUI() {
  const loginTab = $("loginTab");
  const registerTab = $("registerTab");
  const loginForm = $("loginForm");
  const registerForm = $("registerForm");
  const authMessage = $("authMessage");

  function setAuthMessage(txt = "") {
    if (!authMessage) return;
    authMessage.textContent = txt;
  }

  function activateTab(which) {
    if (which === "login") {
      loginTab?.classList.add("bg-white", "shadow", "text-slate-900");
      loginTab?.classList.remove("text-slate-500");
      registerTab?.classList.remove("bg-white", "shadow", "text-slate-900");
      registerTab?.classList.add("text-slate-500");
      show(loginForm);
      hide(registerForm);
      setAuthMessage("");
    } else {
      registerTab?.classList.add("bg-white", "shadow", "text-slate-900");
      registerTab?.classList.remove("text-slate-500");
      loginTab?.classList.remove("bg-white", "shadow", "text-slate-900");
      loginTab?.classList.add("text-slate-500");
      show(registerForm);
      hide(loginForm);
      setAuthMessage("");
    }
  }

  loginTab?.addEventListener("click", () => activateTab("login"));
  registerTab?.addEventListener("click", () => activateTab("register"));

  loginForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    setAuthMessage("");

    const email = $("loginEmail")?.value?.trim();
    const pass = $("loginPassword")?.value;

    if (!email || !pass) return setAuthMessage("E-posta ve şifre gir.");

    try {
      await signInWithEmailAndPassword(auth, email, pass);
      showGlobalAlert("Giriş başarılı.", "success");
    } catch (err) {
      console.error(err);
      setAuthMessage(friendlyFirebaseError(err));
    }
  });

  registerForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    setAuthMessage("");

    const name = $("registerName")?.value?.trim();
    const email = $("registerEmail")?.value?.trim();
    const pass = $("registerPassword")?.value;
    const role = $("registerRole")?.value || "branch";

    if (!name || !email || !pass) return setAuthMessage("Ad Soyad, e-posta ve şifre zorunlu.");

    try {
      const cred = await createUserWithEmailAndPassword(auth, email, pass);
      await updateProfile(cred.user, { displayName: name });

      // users/{uid}
      await setDoc(doc(db, "users", cred.user.uid), {
        name,
        email,
        role,
        createdAt: serverTimestamp()
      }, { merge: true });

      showGlobalAlert("Kayıt başarılı. Giriş yapıldı.", "success");
    } catch (err) {
      console.error(err);
      setAuthMessage(friendlyFirebaseError(err));
    }
  });

  $("logoutBtn")?.addEventListener("click", async () => {
    try {
      await signOut(auth);
      showGlobalAlert("Çıkış yapıldı.", "info");
    } catch (err) {
      showGlobalAlert(friendlyFirebaseError(err), "error");
    }
  });
}

/* =========================================================
   4) App UI: Nav + Views
========================================================= */
function initNavUI() {
  const buttons = Array.from(document.querySelectorAll(".nav-btn"));

  function setActive(btn) {
    buttons.forEach(b => {
      b.classList.remove("bg-slate-900/70", "text-white", "border-slate-700");
      b.classList.add("bg-slate-900/30", "text-slate-300", "border-slate-700/60");
    });
    btn.classList.add("bg-slate-900/70", "text-white", "border-slate-700");
    btn.classList.remove("bg-slate-900/30", "text-slate-300", "border-slate-700/60");
  }

  function showView(viewId) {
    const views = Array.from(document.querySelectorAll(".view"));
    views.forEach(v => v.classList.add("hidden"));
    const target = $(viewId);
    if (target) target.classList.remove("hidden");
  }

  buttons.forEach(btn => {
    btn.addEventListener("click", async () => {
      const view = btn.dataset.view;
      if (!view) return;
      setActive(btn);
      showView(view);

      // view enter hooks
      if (view === "productsView") await loadProducts();
      if (view === "ordersView") await loadOrders();
      if (view === "pickingView") await loadPickingOrders();
      if (view === "loadingView") await loadLoadingTasks();
      if (view === "stockView") await loadStockMovements();
      if (view === "reportsView" || view === "dashboardView") await refreshDashboard();
      if (view === "missingView") await loadMissingDepot();
    });
  });

  // Default view dashboard
  if (buttons[0]) buttons[0].click();
}

function applyRoleToUI(role) {
  currentRole = role || "branch";
  const badge = $("roleBadge");
  if (badge) badge.textContent = `Rol: ${currentRole}`;

  // Show/hide nav buttons by data-role
  const btns = Array.from(document.querySelectorAll(".nav-btn"));
  btns.forEach(btn => {
    const allowed = (btn.dataset.role || "").split(",").map(s => s.trim()).filter(Boolean);
    const can = allowed.includes(currentRole);
    btn.classList.toggle("hidden", !can);
  });

  // If current active view is not allowed -> go to dashboard
  const activeBtn = btns.find(b => b.classList.contains("bg-slate-900/70") && !b.classList.contains("hidden"));
  if (!activeBtn) {
    const firstVisible = btns.find(b => !b.classList.contains("hidden"));
    firstVisible?.click();
  }
}

/* =========================================================
   5) Notifications (simple)
========================================================= */
function initNotificationsUI() {
  $("notificationsMarkReadBtn")?.addEventListener("click", async () => {
    if (!currentUser) return;
    try {
      const listRef = collection(db, "users", currentUser.uid, "notifications");
      const snap = await getDocs(query(listRef, orderBy("createdAt", "desc"), limit(50)));
      const updates = [];
      snap.forEach(ds => {
        const d = ds.data();
        if (d && d.read !== true) {
          updates.push(updateDoc(doc(db, "users", currentUser.uid, "notifications", ds.id), { read: true }));
        }
      });
      await Promise.all(updates);
      showGlobalAlert("Bildirimler okundu yapıldı.", "success");
    } catch (err) {
      showGlobalAlert(friendlyFirebaseError(err), "error");
    }
  });
}

function startNotificationsListener() {
  if (!currentUser) return;
  stopNotificationsListener();

  const listRef = collection(db, "users", currentUser.uid, "notifications");
  const qy = query(listRef, orderBy("createdAt", "desc"), limit(30));

  unsubNotifications = onSnapshot(qy, (snap) => {
    const ul = $("notificationsList");
    const badge = $("notificationsUnread");
    if (!ul || !badge) return;

    let unread = 0;
    const items = [];
    snap.forEach(ds => {
      const n = ds.data() || {};
      if (!n.read) unread++;
      items.push({ id: ds.id, ...n });
    });

    if (unread > 0) {
      badge.classList.remove("hidden");
      badge.textContent = String(unread);
    } else {
      badge.classList.add("hidden");
      badge.textContent = "";
    }

    if (items.length === 0) {
      ul.innerHTML = `<li class="text-[11px] text-slate-400">Henüz bildirim yok.</li>`;
      return;
    }

    ul.innerHTML = items.map(n => {
      const title = escapeHtml(n.title || "Bildirim");
      const body = escapeHtml(n.body || "");
      const t = formatDate(n.createdAt);
      const readCls = n.read ? "opacity-60" : "";
      return `
        <li class="p-2 rounded-xl border border-slate-800 bg-slate-950/40 ${readCls}">
          <div class="flex items-center justify-between">
            <p class="text-[11px] font-semibold text-slate-200">${title}</p>
            <span class="text-[10px] text-slate-500">${escapeHtml(t)}</span>
          </div>
          <p class="text-[11px] text-slate-400 mt-1">${body}</p>
        </li>
      `;
    }).join("");
  }, (err) => {
    console.error(err);
  });
}

function stopNotificationsListener() {
  if (typeof unsubNotifications === "function") unsubNotifications();
  unsubNotifications = null;
}

/* =========================================================
   6) Products CRUD
========================================================= */
function initProductModalUI() {
  const openBtn = $("openProductModalBtn");
  const modal = $("productModal");
  const closeBtn = $("closeProductModalBtn");
  const cancelBtn = $("cancelProductBtn");
  const form = $("productForm");

  function openModal(edit = null) {
    if (!modal) return;
    show(modal);

    $("productModalTitle").textContent = edit ? "Ürün Düzenle" : "Yeni Ürün";
    $("productId").value = edit?.id || "";
    $("productCode").value = edit?.code || "";
    $("productName").value = edit?.name || "";
    $("productUnit").value = edit?.unit || "";
    $("productShelf").value = edit?.shelf || "";
    $("productStock").value = edit?.stock ?? "";
    $("productNote").value = edit?.note || "";
  }

  function closeModal() { hide(modal); }

  openBtn?.addEventListener("click", () => openModal(null));
  closeBtn?.addEventListener("click", closeModal);
  cancelBtn?.addEventListener("click", closeModal);

  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      if (!currentUser) throw new Error("Giriş yapılmadı.");
      if (!["admin", "manager"].includes(currentRole)) throw new Error("Yetki yok.");

      const id = $("productId").value || null;
      const payload = {
        code: $("productCode").value.trim(),
        name: $("productName").value.trim(),
        unit: $("productUnit").value.trim(),
        shelf: $("productShelf").value.trim(),
        stock: clampNum($("productStock").value, 0),
        note: $("productNote").value.trim(),
        updatedAt: serverTimestamp()
      };

      if (!payload.code || !payload.name) throw new Error("Kod ve ürün adı zorunlu.");

      if (id) {
        await updateDoc(doc(db, "products", id), payload);
        showGlobalAlert("Ürün güncellendi.", "success");
      } else {
        await addDoc(collection(db, "products"), { ...payload, createdAt: serverTimestamp() });
        showGlobalAlert("Ürün eklendi.", "success");
      }

      closeModal();
      await loadProducts();
      await refreshDashboard();
    } catch (err) {
      showGlobalAlert(friendlyFirebaseError(err), "error");
    }
  });

  // Expose for edit buttons
  window.__openProductModal = openModal;
}

async function loadProducts() {
  try {
    if (!currentUser) return;
    const tbody = $("productsTableBody");
    const empty = $("productsEmpty");
    if (!tbody) return;

    tbody.innerHTML = "";
    const snap = await getDocs(query(collection(db, "products"), orderBy("code", "asc"), limit(1000)));
    const rows = [];
    snap.forEach(ds => rows.push({ id: ds.id, ...(ds.data() || {}) }));

    if (rows.length === 0) {
      if (empty) show(empty);
      return;
    }
    if (empty) hide(empty);

    tbody.innerHTML = rows.map(p => {
      const canEdit = ["admin", "manager"].includes(currentRole);
      return `
        <tr>
          <td class="px-3 py-2 whitespace-nowrap text-slate-200 font-mono">${escapeHtml(p.code || "")}</td>
          <td class="px-3 py-2 text-slate-200">${escapeHtml(p.name || "")}</td>
          <td class="px-3 py-2 text-slate-400">${escapeHtml(p.unit || "")}</td>
          <td class="px-3 py-2 text-slate-400">${escapeHtml(p.shelf || "")}</td>
          <td class="px-3 py-2 text-slate-300">${escapeHtml(p.stock ?? 0)}</td>
          <td class="px-3 py-2 text-right">
            ${canEdit ? `
              <button class="px-2 py-1 rounded-full bg-slate-800 hover:bg-slate-700 text-[11px]"
                data-action="edit" data-id="${p.id}">Düzenle</button>
              <button class="ml-1 px-2 py-1 rounded-full bg-rose-900/40 hover:bg-rose-900/60 border border-rose-800 text-[11px]"
                data-action="del" data-id="${p.id}">Sil</button>
            ` : `<span class="text-[11px] text-slate-500">-</span>`}
          </td>
        </tr>
      `;
    }).join("");

    // Delegate edit/del
    tbody.querySelectorAll("button[data-action='edit']").forEach(btn => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.id;
        const d = await getDoc(doc(db, "products", id));
        if (!d.exists()) return;
        window.__openProductModal({ id, ...(d.data() || {}) });
      });
    });

    tbody.querySelectorAll("button[data-action='del']").forEach(btn => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.id;
        if (!confirm("Ürün silinsin mi?")) return;
        try {
          await deleteDoc(doc(db, "products", id));
          showGlobalAlert("Ürün silindi.", "success");
          await loadProducts();
          await refreshDashboard();
        } catch (err) {
          showGlobalAlert(friendlyFirebaseError(err), "error");
        }
      });
    });

    // fill stock product select
    fillStockProductSelect(rows);

  } catch (err) {
    showGlobalAlert(friendlyFirebaseError(err), "error");
  }
}

/* =========================================================
   7) Stock Movements
========================================================= */
function initStockUI() {
  $("stockForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      if (!currentUser) throw new Error("Giriş yapılmadı.");
      if (!["admin", "manager"].includes(currentRole)) throw new Error("Yetki yok.");

      const productId = $("stockProductSelect")?.value;
      const type = $("stockType")?.value || "in";
      const qty = clampNum($("stockQty")?.value, 0);
      const unit = $("stockUnit")?.value?.trim() || "";
      const source = $("stockSourceLocation")?.value?.trim() || "";
      const target = $("stockTargetLocation")?.value?.trim() || "";
      const note = $("stockNote")?.value?.trim() || "";

      if (!productId) throw new Error("Ürün seç.");
      if (!qty || qty <= 0) throw new Error("Miktar > 0 olmalı.");

      await addDoc(collection(db, "stock_movements"), {
        productId,
        type,
        qty,
        unit,
        sourceLocation: source || null,
        targetLocation: target || null,
        note: note || null,
        createdAt: serverTimestamp(),
        createdBy: currentUser.uid,
        createdByEmail: currentUser.email
      });

      showGlobalAlert("Stok hareketi kaydedildi.", "success");
      $("stockForm")?.reset();
      await loadStockMovements();
    } catch (err) {
      showGlobalAlert(friendlyFirebaseError(err), "error");
    }
  });
}

function fillStockProductSelect(products) {
  const sel = $("stockProductSelect");
  if (!sel) return;
  sel.innerHTML = "";
  products.forEach(p => {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = `${p.code} — ${p.name}`;
    sel.appendChild(opt);
  });
}

async function loadStockMovements() {
  try {
    const list = $("stockMovementsList");
    const empty = $("stockMovementsEmpty");
    if (!list) return;

    list.innerHTML = "";
    const snap = await getDocs(query(collection(db, "stock_movements"), orderBy("createdAt", "desc"), limit(60)));
    const rows = [];
    snap.forEach(ds => rows.push({ id: ds.id, ...(ds.data() || {}) }));

    if (rows.length === 0) { if (empty) show(empty); return; }
    if (empty) hide(empty);

    list.innerHTML = rows.map(m => `
      <div class="p-3 rounded-2xl border border-slate-800 bg-slate-950/40">
        <div class="flex items-center justify-between">
          <p class="text-[11px] text-slate-200 font-semibold">
            ${escapeHtml(m.type || "-").toUpperCase()} • ${escapeHtml(m.qty ?? 0)} ${escapeHtml(m.unit || "")}
          </p>
          <span class="text-[10px] text-slate-500">${escapeHtml(formatDate(m.createdAt))}</span>
        </div>
        <p class="text-[11px] text-slate-400 mt-1">
          Ürün: <span class="font-mono">${escapeHtml(m.productId || "-")}</span>
          ${m.sourceLocation ? ` • Kaynak: ${escapeHtml(m.sourceLocation)}` : ""}
          ${m.targetLocation ? ` • Hedef: ${escapeHtml(m.targetLocation)}` : ""}
        </p>
        ${m.note ? `<p class="text-[11px] text-slate-500 mt-1">Not: ${escapeHtml(m.note)}</p>` : ""}
      </div>
    `).join("");

  } catch (err) {
    showGlobalAlert(friendlyFirebaseError(err), "error");
  }
}

/* =========================================================
   8) Orders + Excel Import
========================================================= */
function initOrderModalUI() {
  const openBtn = $("openOrderModalBtn");
  const modal = $("orderModal");
  const closeBtn = $("closeOrderModalBtn");
  const cancelBtn = $("cancelOrderBtn");
  const form = $("orderForm");

  function openModal() {
    if (!modal) return;
    show(modal);
    form?.reset();
    $("orderItemsContainer").innerHTML = "";
    show($("orderItemsEmpty"));
    $("orderExcelImportResult").innerHTML = "";
  }
  function closeModal() { hide(modal); }

  openBtn?.addEventListener("click", openModal);
  closeBtn?.addEventListener("click", closeModal);
  cancelBtn?.addEventListener("click", closeModal);

  $("addOrderItemBtn")?.addEventListener("click", () => addOrderItemRow());

  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      if (!currentUser) throw new Error("Giriş yapılmadı.");
      if (!["admin", "manager", "branch"].includes(currentRole)) throw new Error("Yetki yok.");

      const branchName = $("orderBranchName")?.value?.trim();
      const documentNo = $("orderDocumentNo")?.value?.trim() || null;
      const note = $("orderNote")?.value?.trim() || null;

      if (!branchName) throw new Error("Şube adı zorunlu.");

      const items = collectOrderItemsFromUI();
      if (items.length === 0) throw new Error("En az 1 kalem ekle.");

      const orderPayload = {
        branchName,
        documentNo,
        note,
        status: "open",
        createdAt: serverTimestamp(),
        createdBy: currentUser.uid,
        createdByEmail: currentUser.email,
        assignedTo: null,
        assignedToEmail: null,
        source: "manual",
        missingSummary: { missingLines: 0, missingQty: 0 }
      };

      const orderRef = await addDoc(collection(db, "orders"), orderPayload);

      for (const it of items) {
        await addDoc(collection(db, "orders", orderRef.id, "items"), {
          productId: it.productId || null,
          productCode: it.productCode || "",
          productName: it.productName || "",
          qty: Number(it.qty || 0),
          unit: it.unit || "",
          note: it.note || "",
          shelf: it.shelf || "",
          reyon: it.reyon || "",
          barcode: it.barcode || "",
          pickedQty: 0,
          pickedDone: false,
          missingFlag: false,
          missingQty: 0,
          status: "open",
          createdAt: serverTimestamp()
        });
      }

      showGlobalAlert("Sipariş kaydedildi.", "success");
      closeModal();
      await loadOrders();
      await refreshDashboard();
    } catch (err) {
      showGlobalAlert(friendlyFirebaseError(err), "error");
    }
  });

  $("importOrderFromExcelBtn")?.addEventListener("click", importOrderFromExcel);
  $("downloadExcelTemplateBtn")?.addEventListener("click", downloadExcelTemplate);

  // Expose
  window.closeOrderModal = closeModal;
}

function addOrderItemRow(prefill = {}) {
  const c = $("orderItemsContainer");
  const empty = $("orderItemsEmpty");
  if (!c) return;

  const rowId = crypto.randomUUID();
  const div = document.createElement("div");
  div.className = "p-2 rounded-2xl bg-slate-950/30 border border-slate-800";
  div.dataset.rowId = rowId;

  div.innerHTML = `
    <div class="grid md:grid-cols-12 gap-2 items-center">
      <input class="md:col-span-2 rounded-xl bg-slate-950 border border-slate-700 px-2 py-1.5 text-[11px] text-white"
        placeholder="Ürün Kodu" data-k="productCode" value="${escapeHtml(prefill.productCode || "")}">
      <input class="md:col-span-4 rounded-xl bg-slate-950 border border-slate-700 px-2 py-1.5 text-[11px] text-white"
        placeholder="Ürün Adı" data-k="productName" value="${escapeHtml(prefill.productName || "")}">
      <input class="md:col-span-2 rounded-xl bg-slate-950 border border-slate-700 px-2 py-1.5 text-[11px] text-white"
        placeholder="Miktar" type="number" step="0.01" data-k="qty" value="${escapeHtml(prefill.qty ?? "")}">
      <input class="md:col-span-2 rounded-xl bg-slate-950 border border-slate-700 px-2 py-1.5 text-[11px] text-white"
        placeholder="Reyon" data-k="reyon" value="${escapeHtml(prefill.reyon || "")}">
      <input class="md:col-span-2 rounded-xl bg-slate-950 border border-slate-700 px-2 py-1.5 text-[11px] text-white"
        placeholder="Barkod" data-k="barcode" value="${escapeHtml(prefill.barcode || "")}">
      <input class="md:col-span-10 rounded-xl bg-slate-950 border border-slate-700 px-2 py-1.5 text-[11px] text-white"
        placeholder="Açıklama" data-k="note" value="${escapeHtml(prefill.note || "")}">
      <button type="button" class="md:col-span-2 px-3 py-1.5 rounded-xl bg-rose-900/40 hover:bg-rose-900/60 border border-rose-800 text-[11px] text-rose-100"
        data-action="remove">Sil</button>
    </div>
  `;

  div.querySelector("[data-action='remove']")?.addEventListener("click", () => {
    div.remove();
    if (c.children.length === 0) show(empty);
  });

  c.appendChild(div);
  hide(empty);
}

function collectOrderItemsFromUI() {
  const c = $("orderItemsContainer");
  if (!c) return [];
  const rows = Array.from(c.querySelectorAll("[data-row-id]"));
  const items = [];
  rows.forEach(r => {
    const get = (k) => r.querySelector(`[data-k="${k}"]`)?.value?.trim() || "";
    const qty = Number(get("qty") || 0);
    const productCode = get("productCode");
    const productName = get("productName");
    const note = get("note");
    const reyon = get("reyon");
    const barcode = get("barcode");

    if (!productCode && !productName) return;
    if (!qty || qty <= 0) return;

    items.push({
      productId: null,
      productCode,
      productName,
      qty,
      unit: "",
      shelf: "",
      reyon,
      barcode,
      note
    });
  });
  return items;
}

/* ---------------------------------------------------------
   8.1 Excel Import Helpers
--------------------------------------------------------- */
function setExcelImportResult(msg, ok = true) {
  const el = $("orderExcelImportResult");
  if (!el) return;
  el.innerHTML = msg ? `<div class="${ok ? "text-emerald-300" : "text-red-300"}">${msg}</div>` : "";
}

async function readExcelFileToRows(file) {
  if (!file) throw new Error("Dosya seçilmedi.");
  if (typeof XLSX === "undefined") {
    throw new Error("XLSX yok. index.html içine SheetJS ekli olmalı.");
  }
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const sheetName = wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  const json = XLSX.utils.sheet_to_json(ws, { defval: "" });
  if (!json || json.length === 0) throw new Error("Excel boş görünüyor.");
  return json;
}

// ✅ Burada şube adı Excel’den okunmuyor. Modal inputundan alınıyor.
function mapExcelRowsToOrder(rows) {
  const mapped = rows.map((r) => {
    const obj = {};
    for (const k of Object.keys(r)) obj[normKey(k)] = r[k];
    return obj;
  });

  const first = mapped[0] || {};

  // Belge no Excel’de varsa al, yoksa modal inputtan alacağız (import sırasında)
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
        r["urun kodu"] ||
        r["urunkodu"] ||
        r["stok kodu"] ||
        r["stokkodu"] ||
        r["productcode"] ||
        r["kod"] ||
        "";

      const productName =
        r["urun adi"] ||
        r["urunadi"] ||
        r["stok adi"] ||
        r["stokadi"] ||
        r["productname"] ||
        r["urun"] ||
        "";

      const qtyRaw = r["miktar"] || r["adet"] || r["qty"] || r["mikt"] || "";
      const qty = Number(qtyRaw || 0);

      const note = r["aciklama"] || r["açiklama"] || r["not"] || r["note"] || r["acik"] || "";
      const reyon = r["reyon"] || r["raf"] || r["lokasyon"] || r["shelf"] || "";
      const barcode = r["barkod"] || r["barcode"] || "";

      if (!productCode && !productName) return null;

      if (!qty || qty <= 0) {
        return { _row: idx + 2, _error: "Miktar (qty) 0 veya boş", productCode, productName };
      }

      return {
        productCode: String(productCode).trim(),
        productName: String(productName).trim(),
        qty,
        note: String(note || "").trim(),
        reyon: String(reyon || "").trim(),
        barcode: String(barcode || "").trim()
      };
    })
    .filter(Boolean);

  // branchName burada DÖNMÜYOR -> importOrderFromExcel içinden alacağız
  return { documentNo: String(documentNo || "").trim(), items };
}

async function importOrderFromExcel() {
  try {
    if (!currentUser) throw new Error("Giriş yapılmadı.");

    setExcelImportResult("");

    // ✅ Şube adını modal inputtan al
    const branchName = $("orderBranchName")?.value?.trim();
    if (!branchName) throw new Error("Şube adı zorunlu. (Yukarıdaki Şube Adı alanını doldur)");

    const file = $("orderExcelFile")?.files?.[0];
    if (!file) throw new Error("Excel dosyası seçmelisin.");

    setExcelImportResult("Excel okunuyor...", true);

    const rows = await readExcelFileToRows(file);
    const { documentNo: docFromExcel, items } = mapExcelRowsToOrder(rows);

    // Belge no: Excel’de varsa onu kullan, yoksa input’tan al
    const documentNo = $("orderDocumentNo")?.value?.trim() || docFromExcel || "";

    const rowErrors = items.filter((x) => x && x._error);
    if (rowErrors.length > 0) {
      const msg = rowErrors
        .slice(0, 25)
        .map((e) => `Satır ${e._row}: ${e._error} (${escapeHtml(e.productCode || "")} ${escapeHtml(e.productName || "")})`)
        .join("<br/>");
      throw new Error("Excel’de hatalı satırlar var:<br/>" + msg);
    }

    if (!items.length) throw new Error("Excel’den hiç kalem alınamadı.");

    // Products lookup (code -> product)
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
      missingSummary: { missingLines: 0, missingQty: 0 }
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
        shelf: hit?.shelf || "",
        reyon: it.reyon || "",
        barcode: it.barcode || hit?.barcode || "",
        note: it.note || "",
        pickedQty: 0,
        pickedDone: false,
        missingFlag: false,
        missingQty: 0,
        status: "open",
        createdAt: serverTimestamp()
      });
    }

    setExcelImportResult(
      `✅ Yüklendi. Sipariş: <b>${orderRef.id.slice(-6)}</b> • Kalem: <b>${items.length}</b>`,
      true
    );

    showGlobalAlert("Excel siparişi kaydedildi.", "success");
    await loadOrders();
    await loadPickingOrders();
    await refreshDashboard();
    window.closeOrderModal?.();
  } catch (err) {
    console.error("importOrderFromExcel hata:", err);
    setExcelImportResult("❌ " + (err.message || String(err)), false);
    showGlobalAlert("Excel siparişi yüklenemedi: " + friendlyFirebaseError(err), "error");
  }
}

function downloadExcelTemplate() {
  // ✅ Şube ve belge excelde zorunlu değil; excel sadece satırları taşıyor.
  const headers = ["Ürün Kodu", "Ürün Adı", "Miktar", "Açıklama", "Reyon", "Barkod"];
  const sample = [
    ["0003", "FINDIK İÇİ", 120, "", "A1-01", "8690000000001"],
    ["0012", "SARI LEBLEBİ", 1100, "", "A1-02", "8690000000002"]
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

/* =========================================================
   9) Orders Table + Assign Picker
========================================================= */
async function loadOrders() {
  try {
    if (!currentUser) return;

    const tbody = $("ordersTableBody");
    const empty = $("ordersEmpty");
    if (!tbody) return;

    tbody.innerHTML = "";

    // Branch role: only own branchName? (Şimdilik: branch rolü tümünü görmesin -> sadece kendi adıyla)
    let qy = query(collection(db, "orders"), orderBy("createdAt", "desc"), limit(200));
    if (currentRole === "branch") {
      const branchName = (currentUserDoc?.name || $("currentUserInfo")?.textContent || "").trim();
      // En doğru: kullanıcının user doc içine branchName alanı koymak.
      // Şimdilik: orderBranchName alanına aynı isim girildiği varsayımıyla filtre:
      if (branchName) qy = query(collection(db, "orders"), where("branchName", "==", branchName), orderBy("createdAt", "desc"), limit(200));
    }

    const snap = await getDocs(qy);
    const rows = [];
    snap.forEach(ds => rows.push({ id: ds.id, ...(ds.data() || {}) }));

    if (rows.length === 0) {
      if (empty) show(empty);
      return;
    }
    if (empty) hide(empty);

    tbody.innerHTML = rows.map(o => {
      const no = o.id.slice(-6);
      const status = o.status || "-";
      const assigned = o.assignedToEmail || "-";
      const canAssign = ["admin", "manager"].includes(currentRole);
      const canOpen = ["admin", "manager", "branch"].includes(currentRole);

      return `
        <tr>
          <td class="px-3 py-2 font-mono text-slate-200">${escapeHtml(no)}</td>
          <td class="px-3 py-2 text-slate-200">${escapeHtml(o.branchName || "-")}</td>
          <td class="px-3 py-2 text-slate-300">${escapeHtml(status)}</td>
          <td class="px-3 py-2 text-slate-400">${escapeHtml(assigned)}</td>
          <td class="px-3 py-2 text-slate-500">${escapeHtml(formatDate(o.createdAt))}</td>
          <td class="px-3 py-2 text-right">
            ${canOpen ? `<button class="px-2 py-1 rounded-full bg-slate-800 hover:bg-slate-700 text-[11px]" data-action="open" data-id="${o.id}">Detay</button>` : ""}
            ${canAssign ? `<button class="ml-1 px-2 py-1 rounded-full bg-sky-900/40 hover:bg-sky-900/60 border border-sky-800 text-[11px]" data-action="assign" data-id="${o.id}">Ata</button>` : ""}
          </td>
        </tr>
      `;
    }).join("");

    tbody.querySelectorAll("button[data-action='assign']").forEach(btn => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.id;
        await assignOrderToPicker(id);
      });
    });

    tbody.querySelectorAll("button[data-action='open']").forEach(btn => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.id;
        await openOrderDetailQuick(id);
      });
    });

  } catch (err) {
    showGlobalAlert(friendlyFirebaseError(err), "error");
  }
}

// Basit Detay (alert ile)
async function openOrderDetailQuick(orderId) {
  try {
    const o = await getDoc(doc(db, "orders", orderId));
    if (!o.exists()) return;
    const data = o.data() || {};

    const itemsSnap = await getDocs(query(collection(db, "orders", orderId, "items"), orderBy("productCode", "asc"), limit(500)));
    const items = [];
    itemsSnap.forEach(ds => items.push(ds.data() || {}));

    const txt =
      `Sipariş: ${orderId.slice(-6)}\nŞube: ${data.branchName}\nDurum: ${data.status}\nKalem: ${items.length}\n\n` +
      items.slice(0, 30).map(i => `- ${i.productCode} ${i.productName} | ${i.qty} | picked:${i.pickedQty || 0}`).join("\n") +
      (items.length > 30 ? `\n... +${items.length - 30} satır` : "");

    alert(txt);
  } catch (err) {
    showGlobalAlert(friendlyFirebaseError(err), "error");
  }
}

async function assignOrderToPicker(orderId) {
  try {
    if (!["admin", "manager"].includes(currentRole)) throw new Error("Yetki yok.");

    // pickers list
    const pickersSnap = await getDocs(query(collection(db, "users"), where("role", "==", "picker"), limit(100)));
    const pickers = [];
    pickersSnap.forEach(ds => pickers.push({ uid: ds.id, ...(ds.data() || {}) }));

    if (pickers.length === 0) throw new Error("Toplayıcı kullanıcı yok. Önce picker rolüyle kullanıcı oluştur.");

    const names = pickers.map((p, i) => `${i + 1}) ${p.name || p.email || p.uid}`).join("\n");
    const sel = prompt("Toplayıcı seç (numara yaz):\n" + names);
    const idx = Number(sel) - 1;
    if (!Number.isFinite(idx) || idx < 0 || idx >= pickers.length) return;

    const p = pickers[idx];

    await updateDoc(doc(db, "orders", orderId), {
      assignedTo: p.uid,
      assignedToEmail: p.email || null,
      status: "assigned",
      assignedAt: serverTimestamp()
    });

    showGlobalAlert("Sipariş toplayıcıya atandı.", "success");
    await loadOrders();
    await loadPickingOrders();
    await refreshDashboard();

    // notify picker
    if (p.uid) {
      await addDoc(collection(db, "users", p.uid, "notifications"), {
        title: "Yeni Sipariş Atandı",
        body: `Sipariş #${orderId.slice(-6)} sana atandı.`,
        read: false,
        createdAt: serverTimestamp()
      });
    }

  } catch (err) {
    showGlobalAlert(friendlyFirebaseError(err), "error");
  }
}

/* =========================================================
   10) Picking (Toplama) — “Toplandı” checkbox davranışı
========================================================= */
function initPickingUI() {
  $("completePickingBtn")?.addEventListener("click", async () => {
    if (!window.__activePickingOrderId) return;
    await completePicking(window.__activePickingOrderId);
  });
}

async function loadPickingOrders() {
  try {
    if (!currentUser) return;

    const tbody = $("pickingTableBody");
    const empty = $("pickingEmpty");
    if (!tbody) return;

    tbody.innerHTML = "";

    // Picker: only assignedTo == me and status assigned/picking
    // Manager/Admin: show assigned/picking
    let qy = query(collection(db, "orders"), where("status", "in", ["assigned", "picking"]), orderBy("createdAt", "desc"), limit(200));

    if (currentRole === "picker") {
      qy = query(
        collection(db, "orders"),
        where("assignedTo", "==", currentUser.uid),
        where("status", "in", ["assigned", "picking"]),
        orderBy("createdAt", "desc"),
        limit(200)
      );
    }

    const snap = await getDocs(qy);
    const rows = [];
    snap.forEach(ds => rows.push({ id: ds.id, ...(ds.data() || {}) }));

    if (rows.length === 0) {
      if (empty) show(empty);
      return;
    }
    if (empty) hide(empty);

    tbody.innerHTML = rows.map(o => `
      <tr>
        <td class="px-3 py-2 font-mono text-slate-200">${escapeHtml(o.id.slice(-6))}</td>
        <td class="px-3 py-2 text-slate-200">${escapeHtml(o.branchName || "-")}</td>
        <td class="px-3 py-2 text-slate-300">${escapeHtml(o.status || "-")}</td>
        <td class="px-3 py-2 text-slate-400">${escapeHtml(o.assignedToEmail || "-")}</td>
        <td class="px-3 py-2 text-right">
          <button class="px-2 py-1 rounded-full bg-emerald-600 hover:bg-emerald-500 text-[11px] text-white"
            data-action="start" data-id="${o.id}">
            Aç
          </button>
        </td>
      </tr>
    `).join("");

    tbody.querySelectorAll("button[data-action='start']").forEach(btn => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.id;
        await openPickingDetail(id);
      });
    });

  } catch (err) {
    showGlobalAlert(friendlyFirebaseError(err), "error");
  }
}

function openPickingModal() { show($("pickingDetailModal")); }
function closePickingModal() { hide($("pickingDetailModal")); }

$("closePickingDetailModalBtn")?.addEventListener("click", closePickingModal);

async function openPickingDetail(orderId) {
  try {
    if (!currentUser) throw new Error("Giriş yapılmadı.");
    if (!["admin", "manager", "picker"].includes(currentRole)) throw new Error("Yetki yok.");

    // picker order guard
    if (currentRole === "picker") {
      const o = await getDoc(doc(db, "orders", orderId));
      if (!o.exists()) throw new Error("Sipariş bulunamadı.");
      const od = o.data() || {};
      if (od.assignedTo !== currentUser.uid) throw new Error("Bu sipariş sana atanmadı.");
    }

    // set order status picking if assigned
    const orderSnap = await getDoc(doc(db, "orders", orderId));
    const order = orderSnap.data() || {};
    if (order.status === "assigned") {
      await updateDoc(doc(db, "orders", orderId), { status: "picking", pickingStartedAt: serverTimestamp() });
    }

    const itemsSnap = await getDocs(query(collection(db, "orders", orderId, "items"), orderBy("shelf", "asc"), limit(800)));
    const items = [];
    itemsSnap.forEach(ds => items.push({ id: ds.id, ...(ds.data() || {}) }));

    window.__activePickingOrderId = orderId;

    const content = $("pickingDetailContent");
    if (!content) return;

    content.innerHTML = `
      <div class="p-3 rounded-2xl bg-slate-950/40 border border-slate-800">
        <div class="flex items-center justify-between">
          <p class="text-xs font-semibold text-slate-100">Sipariş #${escapeHtml(orderId.slice(-6))}</p>
          <span class="text-[11px] text-slate-400">Şube: <b class="text-slate-200">${escapeHtml(order.branchName || "-")}</b></span>
        </div>
        <p class="text-[11px] text-slate-500 mt-1">Not: ${escapeHtml(order.note || "-")}</p>
      </div>

      <div class="overflow-auto border border-slate-800 rounded-2xl">
        <table class="min-w-full text-[11px]">
          <thead class="bg-slate-900/90 sticky top-0">
            <tr>
              <th class="px-3 py-2 text-left text-slate-400">Raf/Reyon</th>
              <th class="px-3 py-2 text-left text-slate-400">Kod</th>
              <th class="px-3 py-2 text-left text-slate-400">Ürün</th>
              <th class="px-3 py-2 text-right text-slate-400">İstenen</th>
              <th class="px-3 py-2 text-right text-slate-400">Toplanan</th>
              <th class="px-3 py-2 text-center text-slate-400">Toplandı</th>
              <th class="px-3 py-2 text-center text-slate-400">Eksik</th>
            </tr>
          </thead>
          <tbody id="pickingItemsTbody" class="divide-y divide-slate-800"></tbody>
        </table>
      </div>

      <p class="text-[11px] text-slate-500">İpucu: “Toplandı” işaretlenince <b>Toplanan = İstenen</b> olur.</p>
    `;

    const tbody = $("pickingItemsTbody");
    tbody.innerHTML = items.map(it => {
      const loc = it.shelf || it.reyon || "-";
      const qty = Number(it.qty || 0);
      const picked = Number(it.pickedQty || 0);
      const done = !!it.pickedDone;
      const missingFlag = !!it.missingFlag;

      return `
        <tr data-item-id="${it.id}">
          <td class="px-3 py-2 text-slate-300">${escapeHtml(loc)}</td>
          <td class="px-3 py-2 font-mono text-slate-200">${escapeHtml(it.productCode || "")}</td>
          <td class="px-3 py-2 text-slate-200">${escapeHtml(it.productName || "")}</td>
          <td class="px-3 py-2 text-right text-slate-200">${escapeHtml(qty)}</td>
          <td class="px-3 py-2 text-right">
            <input type="number" step="0.01" min="0"
              class="w-20 text-right rounded-xl bg-slate-950 border border-slate-700 px-2 py-1 text-[11px] text-white"
              data-k="pickedQty" value="${escapeHtml(picked)}">
          </td>
          <td class="px-3 py-2 text-center">
            <input type="checkbox" data-k="pickedDone" ${done ? "checked" : ""}>
          </td>
          <td class="px-3 py-2 text-center">
            <button type="button"
              class="px-2 py-1 rounded-full ${missingFlag ? "bg-rose-900/50 border border-rose-800 text-rose-100" : "bg-slate-800 hover:bg-slate-700 text-slate-100"} text-[11px]"
              data-action="missing">
              Eksik
            </button>
          </td>
        </tr>
      `;
    }).join("");

    // listeners
    Array.from(tbody.querySelectorAll("tr[data-item-id]")).forEach(tr => {
      const itemId = tr.dataset.itemId;
      const pickedQtyInput = tr.querySelector("input[data-k='pickedQty']");
      const pickedDoneCb = tr.querySelector("input[data-k='pickedDone']");
      const missingBtn = tr.querySelector("button[data-action='missing']");

      // ✅ Toplandı checkbox: işaretlenince pickedQty = qty
      pickedDoneCb?.addEventListener("change", async () => {
        try {
          const itRef = doc(db, "orders", orderId, "items", itemId);
          const itSnap = await getDoc(itRef);
          if (!itSnap.exists()) return;
          const it = itSnap.data() || {};
          const qty = Number(it.qty || 0);

          if (pickedDoneCb.checked) {
            // pickedQty => qty
            pickedQtyInput.value = String(qty);
            await updateDoc(itRef, {
              pickedDone: true,
              pickedQty: qty,
              status: "picked",
              updatedAt: serverTimestamp()
            });
          } else {
            // unchecked: sadece pickedDone false bırak; pickedQty manuel kalsın
            const val = clampNum(pickedQtyInput.value, 0);
            await updateDoc(itRef, {
              pickedDone: false,
              pickedQty: val,
              status: val > 0 ? "picking" : "open",
              updatedAt: serverTimestamp()
            });
          }
        } catch (err) {
          showGlobalAlert(friendlyFirebaseError(err), "error");
        }
      });

      // pickedQty change
      pickedQtyInput?.addEventListener("change", async () => {
        try {
          const val = clampNum(pickedQtyInput.value, 0);
          const itRef = doc(db, "orders", orderId, "items", itemId);
          const itSnap = await getDoc(itRef);
          if (!itSnap.exists()) return;
          const it = itSnap.data() || {};
          const qty = Number(it.qty || 0);
          const done = val >= qty && qty > 0;

          // sync checkbox
          pickedDoneCb.checked = done;

          await updateDoc(itRef, {
            pickedQty: val,
            pickedDone: done,
            status: done ? "picked" : (val > 0 ? "picking" : "open"),
            updatedAt: serverTimestamp()
          });
        } catch (err) {
          showGlobalAlert(friendlyFirebaseError(err), "error");
        }
      });

      // ✅ Eksik: missing_depot kaydı oluştur + item missingFlag
      missingBtn?.addEventListener("click", async () => {
        try {
          const itRef = doc(db, "orders", orderId, "items", itemId);
          const itSnap = await getDoc(itRef);
          if (!itSnap.exists()) return;
          const it = itSnap.data() || {};

          const qty = Number(it.qty || 0);
          const pickedQty = clampNum(pickedQtyInput.value, 0);
          const missingQty = Math.max(0, qty - pickedQty);

          if (missingQty <= 0) {
            showGlobalAlert("Eksik yok. (Toplanan miktar isteneni karşılıyor)", "warning");
            return;
          }

          await updateDoc(itRef, {
            missingFlag: true,
            missingQty,
            updatedAt: serverTimestamp()
          });

          // missing_depot
          await addDoc(collection(db, "missing_depot"), {
            orderId,
            orderNo: orderId.slice(-6),
            branchName: order.branchName || "",
            itemId,
            productCode: it.productCode || "",
            productName: it.productName || "",
            missingQty,
            status: "waiting",
            createdAt: serverTimestamp(),
            createdBy: currentUser.uid
          });

          showGlobalAlert("Eksik depo kaydı oluşturuldu.", "success");
          // UI paint
          missingBtn.className = "px-2 py-1 rounded-full bg-rose-900/50 border border-rose-800 text-rose-100 text-[11px]";
        } catch (err) {
          showGlobalAlert(friendlyFirebaseError(err), "error");
        }
      });
    });

    openPickingModal();
    await loadPickingOrders();
    await refreshDashboard();

  } catch (err) {
    showGlobalAlert(friendlyFirebaseError(err), "error");
  }
}

async function completePicking(orderId) {
  try {
    if (!currentUser) throw new Error("Giriş yapılmadı.");
    if (!["admin", "manager", "picker"].includes(currentRole)) throw new Error("Yetki yok.");

    const itemsSnap = await getDocs(query(collection(db, "orders", orderId, "items"), limit(1000)));
    const items = [];
    itemsSnap.forEach(ds => items.push({ id: ds.id, ...(ds.data() || {}) }));

    const notDone = items.filter(i => !i.pickedDone && !i.missingFlag);
    if (notDone.length > 0) {
      const sample = notDone.slice(0, 5).map(i => `${i.productCode} ${i.productName}`).join(", ");
      throw new Error(`Tamamlamak için tüm satırlar ya “Toplandı” olmalı ya da “Eksik”e alınmalı. Eksik kalan örnek: ${sample}`);
    }

    // missing summary
    const missingLines = items.filter(i => i.missingFlag).length;
    const missingQty = items.reduce((s, i) => s + (Number(i.missingQty || 0) || 0), 0);

    await updateDoc(doc(db, "orders", orderId), {
      status: "completed",
      completedAt: serverTimestamp(),
      completedBy: currentUser.uid,
      missingSummary: { missingLines, missingQty }
    });

    showGlobalAlert("Toplama tamamlandı.", "success");
    closePickingModal();
    await loadPickingOrders();
    await loadOrders();
    await refreshDashboard();

  } catch (err) {
    showGlobalAlert(friendlyFirebaseError(err), "error");
  }
}

/* =========================================================
   11) Eksik Depo View
========================================================= */
function initMissingDepotUI() {
  $("reloadMissingBtn")?.addEventListener("click", loadMissingDepot);
  $("missingStatusFilter")?.addEventListener("change", loadMissingDepot);
}

async function loadMissingDepot() {
  try {
    if (!currentUser) return;
    if (!["admin", "manager"].includes(currentRole)) return;

    const tbody = $("missingTableBody");
    const empty = $("missingEmpty");
    if (!tbody) return;

    tbody.innerHTML = "";

    const filter = $("missingStatusFilter")?.value || "waiting";
    let qy = query(collection(db, "missing_depot"), orderBy("createdAt", "desc"), limit(400));
    if (filter !== "all") {
      qy = query(collection(db, "missing_depot"), where("status", "==", filter), orderBy("createdAt", "desc"), limit(400));
    }

    const snap = await getDocs(qy);
    const rows = [];
    snap.forEach(ds => rows.push({ id: ds.id, ...(ds.data() || {}) }));

    if (rows.length === 0) { if (empty) show(empty); return; }
    if (empty) hide(empty);

    tbody.innerHTML = rows.map(r => `
      <tr>
        <td class="px-3 py-2 font-mono text-slate-200">#${escapeHtml(r.orderNo || (r.orderId || "").slice(-6))}</td>
        <td class="px-3 py-2 text-slate-200">${escapeHtml(r.branchName || "-")}</td>
        <td class="px-3 py-2 text-slate-200">${escapeHtml(r.productCode || "")} — ${escapeHtml(r.productName || "")}</td>
        <td class="px-3 py-2 text-right text-rose-200 font-semibold">${escapeHtml(r.missingQty ?? 0)}</td>
        <td class="px-3 py-2 text-slate-300">${escapeHtml(r.status || "-")}</td>
        <td class="px-3 py-2 text-right">
          ${r.status === "waiting" ? `
            <button class="px-2 py-1 rounded-full bg-emerald-600 hover:bg-emerald-500 text-[11px] text-white"
              data-action="resolve" data-id="${r.id}">Tamamlandı</button>
          ` : `<span class="text-[11px] text-slate-500">-</span>`}
        </td>
      </tr>
    `).join("");

    tbody.querySelectorAll("button[data-action='resolve']").forEach(btn => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.id;
        await resolveMissing(id);
      });
    });

  } catch (err) {
    showGlobalAlert(friendlyFirebaseError(err), "error");
  }
}

async function resolveMissing(missingId) {
  try {
    if (!["admin", "manager"].includes(currentRole)) throw new Error("Yetki yok.");

    const ref = doc(db, "missing_depot", missingId);
    const snap = await getDoc(ref);
    if (!snap.exists()) return;

    await updateDoc(ref, {
      status: "completed",
      resolvedAt: serverTimestamp(),
      resolvedBy: currentUser.uid
    });

    showGlobalAlert("Eksik depo kaydı tamamlandı yapıldı.", "success");
    await loadMissingDepot();
  } catch (err) {
    showGlobalAlert(friendlyFirebaseError(err), "error");
  }
}

/* =========================================================
   12) Loading Tasks (pallets) — minimal
========================================================= */
function initLoadingUI() {
  $("reloadLoadingTasksBtn")?.addEventListener("click", loadLoadingTasks);
  $("loadingStatusFilter")?.addEventListener("change", loadLoadingTasks);
}

async function loadLoadingTasks() {
  try {
    if (!currentUser) return;
    if (!["admin", "manager"].includes(currentRole)) return;

    const tbody = $("loadingTasksTableBody");
    const empty = $("loadingTasksEmpty");
    if (!tbody) return;

    tbody.innerHTML = "";
    const filter = $("loadingStatusFilter")?.value || "all";

    let qy = query(collection(db, "pallets"), orderBy("createdAt", "desc"), limit(250));
    if (filter !== "all") {
      qy = query(collection(db, "pallets"), where("status", "==", filter), orderBy("createdAt", "desc"), limit(250));
    }

    const snap = await getDocs(qy);
    const rows = [];
    snap.forEach(ds => rows.push({ id: ds.id, ...(ds.data() || {}) }));

    if (rows.length === 0) { if (empty) show(empty); return; }
    if (empty) hide(empty);

    tbody.innerHTML = rows.map(p => `
      <tr>
        <td class="px-2 py-2 text-slate-200 font-mono">${escapeHtml(p.shipmentNo || p.id.slice(-6))}</td>
        <td class="px-2 py-2 text-slate-200 hidden sm:table-cell">${escapeHtml(p.branchName || "-")}</td>
        <td class="px-2 py-2 text-slate-200">${escapeHtml(p.palletNo || "-")}</td>
        <td class="px-2 py-2 text-slate-400 hidden md:table-cell">${escapeHtml(p.dock || "-")}</td>
        <td class="px-2 py-2 text-slate-300">${escapeHtml(p.status || "-")}</td>
        <td class="px-2 py-2 text-slate-400 hidden md:table-cell">${escapeHtml(p.loadedBy || "-")}</td>
        <td class="px-2 py-2 text-slate-500 hidden md:table-cell">${escapeHtml(formatDate(p.loadedAt || p.createdAt))}</td>
        <td class="px-2 py-2 text-right text-slate-500">-</td>
      </tr>
    `).join("");

  } catch (err) {
    showGlobalAlert(friendlyFirebaseError(err), "error");
  }
}

/* =========================================================
   13) Dashboard / Reports
========================================================= */
async function refreshDashboard() {
  try {
    if (!currentUser) return;

    // total products
    const prodSnap = await getDocs(query(collection(db, "products"), limit(1000)));
    let prodCount = 0;
    prodSnap.forEach(() => prodCount++);

    // orders quick stats (last 400)
    const ordersSnap = await getDocs(query(collection(db, "orders"), orderBy("createdAt", "desc"), limit(400)));
    const orders = [];
    ordersSnap.forEach(ds => orders.push(ds.data() || {}));

    const openCount = orders.filter(o => ["open", "assigned"].includes(o.status)).length;
    const pickingCount = orders.filter(o => o.status === "picking").length;
    const completedCount = orders.filter(o => o.status === "completed").length;

    if ($("cardTotalProducts")) $("cardTotalProducts").textContent = String(prodCount);
    if ($("cardOpenOrders")) $("cardOpenOrders").textContent = String(openCount);
    if ($("cardPickingOrders")) $("cardPickingOrders").textContent = String(pickingCount);
    if ($("cardCompletedOrders")) $("cardCompletedOrders").textContent = String(completedCount);

    // reports
    if ($("reportTotalProducts")) $("reportTotalProducts").textContent = `Toplam ürün: ${prodCount}`;
    if ($("reportTotalOrders")) $("reportTotalOrders").textContent = `Toplam sipariş: ${orders.length}`;
    if ($("reportCompletedOrders")) $("reportCompletedOrders").textContent = `Tamamlanan sipariş: ${completedCount}`;

    // loading summary
    if (["admin", "manager"].includes(currentRole)) {
      const palletsSnap = await getDocs(query(collection(db, "pallets"), orderBy("createdAt", "desc"), limit(200)));
      const pallets = [];
      palletsSnap.forEach(ds => pallets.push(ds.data() || {}));
      const waiting = pallets.filter(p => p.status === "waiting").length;
      const loadedToday = pallets.filter(p => {
        const d = p.loadedAt?.toDate?.() || null;
        if (!d) return false;
        const now = new Date();
        return d.toDateString() === now.toDateString();
      }).length;

      if ($("loadingWaitingSummary")) $("loadingWaitingSummary").textContent = `${waiting} palet bekliyor.`;
      if ($("loadingTodaySummary")) $("loadingTodaySummary").textContent = `Bugün ${loadedToday} palet yüklendi.`;
    }

    // picker today stats (simple)
    const pickerStats = $("pickerStatsToday");
    if (pickerStats) {
      if (currentRole === "picker") {
        pickerStats.textContent = "Toplama performansı: (demo) — Sipariş detaylarında satır satır takip ediliyor.";
      } else {
        pickerStats.textContent = "Bugün henüz tamamlanan toplama yok. (demo)";
      }
    }

  } catch (err) {
    showGlobalAlert(friendlyFirebaseError(err), "error");
  }
}

/* =========================================================
   14) App Boot
========================================================= */
function setAuthStateUI(isAuthed) {
  const authSection = $("authSection");
  const appSection = $("appSection");
  if (isAuthed) {
    hide(authSection);
    show(appSection);
  } else {
    show(authSection);
    hide(appSection);
  }
}

async function loadCurrentUserProfile(user) {
  const ref = doc(db, "users", user.uid);
  const snap = await getDoc(ref);
  if (snap.exists()) return { uid: user.uid, ...(snap.data() || {}) };

  // If no user doc, create default
  const payload = {
    name: user.displayName || "",
    email: user.email || "",
    role: "branch",
    createdAt: serverTimestamp()
  };
  await setDoc(ref, payload, { merge: true });
  return { uid: user.uid, ...payload };
}

function renderCurrentUserInfo() {
  const el = $("currentUserInfo");
  if (!el) return;
  const name = currentUserDoc?.name || currentUser?.displayName || "";
  const email = currentUser?.email || "";
  el.textContent = name ? `${name} • ${email}` : email;
}

/* =========================================================
   15) Init Everything
========================================================= */
function initAll() {
  initAuthUI();
  initNavUI();
  initNotificationsUI();
  initProductModalUI();
  initOrderModalUI();
  initStockUI();
  initPickingUI();
  initLoadingUI();
  initMissingDepotUI();
}

initAll();

onAuthStateChanged(auth, async (user) => {
  currentUser = user || null;
  currentUserDoc = null;
  currentRole = null;

  if (!user) {
    stopNotificationsListener();
    setAuthStateUI(false);
    return;
  }

  try {
    setAuthStateUI(true);
    currentUserDoc = await loadCurrentUserProfile(user);
    currentRole = currentUserDoc.role || "branch";
    applyRoleToUI(currentRole);
    renderCurrentUserInfo();
    startNotificationsListener();

    // initial data refresh
    await refreshDashboard();

  } catch (err) {
    showGlobalAlert(friendlyFirebaseError(err), "error");
  }
});

/* =========================================================
   ✅ FIRESTORE RULES (ÖRNEK) — Missing or insufficient permissions fix
   Firebase Console > Firestore Database > Rules içine koyup publish edebilirsin.
   (Bu örnek: giriş yapan herkes okuyabilir, yazma rol bazlı)
========================================================= */
/*
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    function signedIn() { return request.auth != null; }
    function isAdmin() { return signedIn() && get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role == "admin"; }
    function isManager() {
      return signedIn() && (
        get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role == "manager" ||
        get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role == "admin"
      );
    }
    function isPicker() { return signedIn() && get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role == "picker"; }
    function isBranch() { return signedIn() && get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role == "branch"; }

    match /users/{uid} {
      allow read: if signedIn();
      allow write: if request.auth.uid == uid || isAdmin();
      match /notifications/{nid} {
        allow read, write: if request.auth.uid == uid;
      }
    }

    match /products/{id} {
      allow read: if signedIn();
      allow write: if isManager();
    }

    match /stock_movements/{id} {
      allow read: if signedIn();
      allow write: if isManager();
    }

    match /orders/{orderId} {
      allow read: if signedIn();
      allow create: if signedIn();
      allow update: if isManager() || (isPicker() && request.resource.data.assignedTo == request.auth.uid) || isAdmin();
      allow delete: if isAdmin();

      match /items/{itemId} {
        allow read: if signedIn();
        allow create: if signedIn();
        allow update: if isManager() || isPicker();
        allow delete: if isAdmin();
      }
    }

    match /missing_depot/{id} {
      allow read: if isManager() || isAdmin();
      allow create: if isPicker() || isManager() || isAdmin();
      allow update: if isManager() || isAdmin();
      allow delete: if isAdmin();
    }

    match /pallets/{id} {
      allow read: if isManager() || isAdmin();
      allow write: if isManager() || isAdmin();
    }
  }
}
*/
