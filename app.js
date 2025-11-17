// app.js
import {
  auth,
  db,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  collection,
  doc,
  getDoc,
  getDocs,
  addDoc,
  updateDoc,
  query,
  where,
  orderBy,
  serverTimestamp,
} from "./firebase.js";

// ============= DOM =============
const loginView = document.getElementById("login-view");
const managerView = document.getElementById("manager-view");
const pickerView = document.getElementById("picker-view");
const mainNav = document.getElementById("mainNav");

const loginForm = document.getElementById("loginForm");
const logoutBtn = document.getElementById("logoutBtn");
const userInfoEl = document.getElementById("userInfo");

const createOrderForm = document.getElementById("createOrderForm");
const branchNameInput = document.getElementById("branchName");
const orderItemsContainer = document.getElementById("orderItemsContainer");
const addItemBtn = document.getElementById("addItemBtn");
const ordersListEl = document.getElementById("ordersList");
const orderStatusFilter = document.getElementById("orderStatusFilter");

const pickerOrdersListEl = document.getElementById("pickerOrdersList");
const pickerOrderDetailEl = document.getElementById("pickerOrderDetail");

const navButtons = document.querySelectorAll(".nav-btn");

// ============= GLOBAL STATE =============
let currentUser = null; // auth user
let currentUserDoc = null; // Firestore users dokümanı {displayName, role, ...}
let pickerUsers = []; // {id, displayName, email}
let activePickerOrder = null;
let unsubscribeOrders = null;
let unsubscribePickerOrders = null;

// ============= VIEW HELPERS =============
function showView(viewId) {
  [loginView, managerView, pickerView].forEach((v) => v.classList.add("hidden"));
  document.getElementById(viewId)?.classList.remove("hidden");
  document.getElementById(viewId)?.classList.add("active");
}

function setAuthUI(loggedIn) {
  if (loggedIn) {
    logoutBtn.classList.remove("hidden");
    mainNav.classList.remove("hidden");
  } else {
    logoutBtn.classList.add("hidden");
    mainNav.classList.add("hidden");
  }
}

// ============= LOGIN =============
loginForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = document.getElementById("loginEmail").value.trim();
  const password = document.getElementById("loginPassword").value.trim();

  try {
    const cred = await signInWithEmailAndPassword(auth, email, password);
    console.log("Giriş başarılı:", cred.user.uid);
  } catch (err) {
    console.error("Giriş hatası:", err);
    alert("Giriş başarısız: " + err.message);
  }
});

logoutBtn?.addEventListener("click", async () => {
  try {
    await signOut(auth);
  } catch (err) {
    console.error("Çıkış hatası:", err);
  }
});

// ============= AUTH STATE =============
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    currentUser = null;
    currentUserDoc = null;
    userInfoEl.textContent = "";
    setAuthUI(false);
    showView("login-view");
    detachListeners();
    return;
  }

  currentUser = user;
  setAuthUI(true);

  // Firestore'dan user doc çek
  const userRef = doc(db, "users", user.uid);
  const snap = await getDoc(userRef);

  if (!snap.exists()) {
    alert("Bu kullanıcı için Firestore'da 'users' dokümanı bulunamadı.");
    console.warn("users koleksiyonunda yok:", user.uid);
    currentUserDoc = { displayName: user.email, role: "picker" };
  } else {
    currentUserDoc = snap.data();
  }

  userInfoEl.textContent = `${currentUserDoc.displayName || user.email} · ${
    currentUserDoc.role
  }`;

  await loadPickerUsers();

  if (currentUserDoc.role === "manager") {
    showView("manager-view");
    attachManagerListeners();
  } else if (currentUserDoc.role === "picker") {
    showView("picker-view");
    attachPickerListeners();
  } else {
    // default
    showView("picker-view");
    attachPickerListeners();
  }
});

// ============= USERS / PICKERS =============
async function loadPickerUsers() {
  try {
    const q = query(
      collection(db, "users"),
      where("role", "==", "picker"),
      orderBy("displayName")
    );
    const snap = await getDocs(q);
    pickerUsers = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (err) {
    console.error("Picker users yüklenemedi:", err);
  }
}

// ============= MANAGER: ORDER ITEMS UI =============
function createOrderItemRow() {
  const row = document.createElement("div");
  row.className = "order-item-row";

  row.innerHTML = `
    <input type="text" class="item-name" placeholder="Ürün adı" required />
    <input type="text" class="item-qty" placeholder="Miktar" required />
    <input type="text" class="item-aisle" placeholder="Raf / Reyon" />
    <button type="button" class="remove-item-btn">Sil</button>
  `;

  const removeBtn = row.querySelector(".remove-item-btn");
  removeBtn.addEventListener("click", () => {
    row.remove();
  });

  return row;
}

addItemBtn?.addEventListener("click", () => {
  orderItemsContainer.appendChild(createOrderItemRow());
});

// İlk satırı otomatik ekle
if (orderItemsContainer && orderItemsContainer.childElementCount === 0) {
  orderItemsContainer.appendChild(createOrderItemRow());
}

// ============= MANAGER: SİPARİŞ OLUŞTURMA =============
createOrderForm?.addEventListener("submit", async (e) => {
  e.preventDefault();

  const branchName = branchNameInput.value.trim();
  if (!branchName) {
    alert("Şube adı boş olamaz.");
    return;
  }

  const rows = Array.from(
    orderItemsContainer.querySelectorAll(".order-item-row")
  );

  if (!rows.length) {
    alert("En az bir ürün satırı ekleyin.");
    return;
  }

  const items = [];
  for (const row of rows) {
    const name = row.querySelector(".item-name").value.trim();
    const qty = row.querySelector(".item-qty").value.trim();
    const aisle = row.querySelector(".item-aisle").value.trim();

    if (!name || !qty) continue;

    items.push({
      name,
      qty,
      aisle,
      picked: false,
    });
  }

  if (!items.length) {
    alert("Boş ürün listesi kaydedilemez.");
    return;
  }

  try {
    await addDoc(collection(db, "orders"), {
      branchName,
      status: "new", // new | assigned | picking | completed
      createdAt: serverTimestamp(),
      createdBy: currentUser?.uid || null,
      createdByName: currentUserDoc?.displayName || currentUser?.email || "",
      pickerId: null,
      pickerName: "",
      items,
    });

    // formu temizle
    branchNameInput.value = "";
    orderItemsContainer.innerHTML = "";
    orderItemsContainer.appendChild(createOrderItemRow());

    alert("Sipariş kaydedildi.");
  } catch (err) {
    console.error("Sipariş kaydedilemedi:", err);
    alert("Sipariş kaydedilirken hata oluştu.");
  }
});

// ============= MANAGER: SİPARİŞ LİSTESİ =============
function attachManagerListeners() {
  // Eski listener'lar varsa kapat
  detachListeners();

  const baseQuery = query(
    collection(db, "orders"),
    orderBy("createdAt", "desc")
  );

  unsubscribeOrders = listenOrders(baseQuery, renderManagerOrders);

  orderStatusFilter?.addEventListener("change", onManagerFilterChange);
}

function onManagerFilterChange() {
  const val = orderStatusFilter.value;
  let qBase = query(
    collection(db, "orders"),
    orderBy("createdAt", "desc")
  );

  if (val !== "all") {
    qBase = query(
      collection(db, "orders"),
      where("status", "==", val),
      orderBy("createdAt", "desc")
    );
  }

  if (unsubscribeOrders) unsubscribeOrders();
  unsubscribeOrders = listenOrders(qBase, renderManagerOrders);
}

// Order snapshot dinle
function listenOrders(q, callback) {
  return firebase.firestore.onSnapshot
    ? null
    : (() => {
        // Firestore v9'da onSnapshot import etmedik, bu nedenle
        // burada sadece getDocs ile "polling" gibi çalışacağız istersen.
        // Ama Murat için gerçek zamanlı gerekliyse istersen onSnapshot'lı
        // versiyonu ayrıca yazarız.
        console.warn(
          "Gerçek zamanlı onSnapshot eklenmedi. Mevcut sürüm getDocs ile manuel yenileme kullanıyor."
        );
        // basit bir kez yükle
        loadOnce(q, callback);
        return () => {};
      })();
}

// Basit: getDocs ile bir defa çek
async function loadOnce(q, callback) {
  const snap = await getDocs(q);
  callback(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
}

async function renderManagerOrders(orders) {
  ordersListEl.innerHTML = "";

  if (!orders || !orders.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "Henüz sipariş yok.";
    ordersListEl.appendChild(empty);
    return;
  }

  for (const order of orders) {
    const card = document.createElement("div");
    card.className = "order-card";

    const createdAt =
      order.createdAt && order.createdAt.toDate
        ? order.createdAt.toDate()
        : null;
    const createdStr = createdAt
      ? createdAt.toLocaleString("tr-TR")
      : "Tarih yok";

    const statusClass = `status-${order.status || "new"}`;
    const pickerName = order.pickerName || "Atanmamış";

    card.innerHTML = `
      <div class="order-card-header">
        <div>
          <div><strong>${order.branchName || "Şube yok"}</strong></div>
          <div class="order-meta">
            <span class="badge-pill">ID: ${order.id}</span>
          </div>
        </div>
        <div>
          <div class="order-badge ${statusClass}">
            ${order.status || "new"}
          </div>
        </div>
      </div>
      <div class="order-meta">
        Oluşturan: ${order.createdByName || "-"} · ${createdStr}
      </div>
      <div class="order-meta">
        Toplayıcı: ${pickerName}
      </div>
      <div class="order-items-preview">
        ${order.items
          .map((it) => `${it.name} (${it.qty})`)
          .slice(0, 3)
          .join(", ")}${
      order.items.length > 3 ? "..." : ""
    }
      </div>
    `;

    const actions = document.createElement("div");
    actions.className = "order-actions";

    // Picker seçimi
    const select = document.createElement("select");
    select.className = "input";
    const defaultOpt = document.createElement("option");
    defaultOpt.value = "";
    defaultOpt.textContent = "Toplayıcı seç";
    select.appendChild(defaultOpt);

    pickerUsers.forEach((p) => {
      const opt = document.createElement("option");
      opt.value = p.id;
      opt.textContent = p.displayName || p.email;
      if (order.pickerId === p.id) opt.selected = true;
      select.appendChild(opt);
    });

    const assignBtn = document.createElement("button");
    assignBtn.className = "btn-secondary small";
    assignBtn.textContent = "Ata / Güncelle";

    assignBtn.addEventListener("click", async (ev) => {
      ev.stopPropagation();
      const pickerId = select.value;
      if (!pickerId) {
        alert("Toplayıcı seçmediniz.");
        return;
      }
      const picker = pickerUsers.find((p) => p.id === pickerId);

      try {
        await updateDoc(doc(db, "orders", order.id), {
          pickerId,
          pickerName: picker?.displayName || picker?.email || "",
          status:
            order.status === "completed" ? "completed" : order.status === "picking" ? "picking" : "assigned",
        });
      } catch (err) {
        console.error("Atama hatası:", err);
        alert("Toplayıcı atanırken hata oluştu.");
      }
    });

    actions.appendChild(select);
    actions.appendChild(assignBtn);

    card.appendChild(actions);

    ordersListEl.appendChild(card);
  }
}

// ============= PICKER: SİPARİŞLERİM =============
function attachPickerListeners() {
  detachListeners();

  loadPickerOrdersOnce();
}

async function loadPickerOrdersOnce() {
  if (!currentUser) return;

  const q = query(
    collection(db, "orders"),
    where("pickerId", "==", currentUser.uid)
  );

  const snap = await getDocs(q);
  const orders = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  renderPickerOrders(orders);
}

function renderPickerOrders(orders) {
  pickerOrdersListEl.innerHTML = "";

  if (!orders || !orders.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "Size atanmış sipariş yok.";
    pickerOrdersListEl.appendChild(empty);
    return;
  }

  for (const order of orders) {
    const card = document.createElement("div");
    card.className = "order-card";

    const statusClass = `status-${order.status || "assigned"}`;
    const createdAt =
      order.createdAt && order.createdAt.toDate
        ? order.createdAt.toDate()
        : null;
    const createdStr = createdAt
      ? createdAt.toLocaleString("tr-TR")
      : "Tarih yok";

    card.innerHTML = `
      <div class="order-card-header">
        <div>
          <div><strong>${order.branchName || "Şube yok"}</strong></div>
          <div class="order-meta">
            <span class="badge-pill">${order.items.length} kalem</span>
          </div>
        </div>
        <div class="order-badge ${statusClass}">
          ${order.status || "assigned"}
        </div>
      </div>
      <div class="order-meta">
        ${createdStr}
      </div>
    `;

    card.addEventListener("click", () => {
      activePickerOrder = order;
      renderPickerOrderDetail();
    });

    pickerOrdersListEl.appendChild(card);
  }
}

function renderPickerOrderDetail() {
  const order = activePickerOrder;
  if (!order) {
    pickerOrderDetailEl.className = "order-detail empty-state";
    pickerOrderDetailEl.textContent = "Sipariş seçiniz.";
    return;
  }

  pickerOrderDetailEl.className = "order-detail";
  const allPicked = order.items.every((it) => !!it.picked);

  pickerOrderDetailEl.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
      <div>
        <strong>${order.branchName}</strong>
        <div class="order-meta">ID: ${order.id}</div>
      </div>
      <span class="order-badge status-${order.status}">${order.status}</span>
    </div>
    <table class="order-items-table">
      <thead>
        <tr>
          <th>#</th>
          <th>Ürün</th>
          <th>Miktar</th>
          <th>Raf</th>
          <th>Toplandı</th>
        </tr>
      </thead>
      <tbody>
        ${order.items
          .map((it, idx) => {
            const checked = it.picked ? "checked" : "";
            return `
              <tr>
                <td>${idx + 1}</td>
                <td>${it.name}</td>
                <td>${it.qty}</td>
                <td>${it.aisle || "-"}</td>
                <td>
                  <input type="checkbox" data-index="${idx}" class="item-picked" ${checked} />
                </td>
              </tr>
            `;
          })
          .join("")}
      </tbody>
    </table>
    <div style="margin-top:10px;display:flex;justify-content:flex-end;gap:8px;">
      <button type="button" id="refreshOrderBtn" class="btn-secondary small">Yenile</button>
      <button type="button" id="completeOrderBtn" class="btn-primary small" ${
        allPicked ? "" : "disabled style='opacity:0.5;cursor:not-allowed;'"
      }>
        Siparişi Tamamla
      </button>
    </div>
  `;

  // Checkbox eventleri
  pickerOrderDetailEl
    .querySelectorAll(".item-picked")
    .forEach((checkbox) => {
      checkbox.addEventListener("change", async (e) => {
        const idx = parseInt(e.target.dataset.index, 10);
        order.items[idx].picked = e.target.checked;
        await updateOrderItemsPicked(order);
        // sadece UI'de güncelle
        renderPickerOrderDetail();
      });
    });

  // Yenile butonu
  document
    .getElementById("refreshOrderBtn")
    .addEventListener("click", async () => {
      const snap = await getDoc(doc(db, "orders", order.id));
      if (snap.exists()) {
        activePickerOrder = { id: snap.id, ...snap.data() };
        renderPickerOrderDetail();
      }
    });

  // Tamamla butonu
  document
    .getElementById("completeOrderBtn")
    .addEventListener("click", async () => {
      const allPickedNow = order.items.every((it) => !!it.picked);
      if (!allPickedNow) {
        alert("Tüm kalemleri topladı olarak işaretleyin.");
        return;
      }

      try {
        await updateDoc(doc(db, "orders", order.id), {
          status: "completed",
        });
        alert("Sipariş tamamlandı.");
        activePickerOrder = null;
        pickerOrderDetailEl.className = "order-detail empty-state";
        pickerOrderDetailEl.textContent = "Sipariş seçiniz.";
        await loadPickerOrdersOnce();
      } catch (err) {
        console.error("Tamamlama hatası:", err);
        alert("Sipariş tamamlama sırasında hata oluştu.");
      }
    });
}

async function updateOrderItemsPicked(order) {
  try {
    await updateDoc(doc(db, "orders", order.id), {
      items: order.items,
      status: order.items.every((it) => !!it.picked)
        ? "completed"
        : "picking",
    });
  } catch (err) {
    console.error("Picked güncelleme hatası:", err);
  }
}

// ============= NAV BUTONLARI =============
navButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    const view = btn.dataset.view;
    if (!view) return;
    showView(view);
    if (view === "picker-view") {
      loadPickerOrdersOnce();
    } else if (view === "manager-view") {
      onManagerFilterChange();
    }
  });
});

// ============= EVENT CLEANUP =============
function detachListeners() {
  // Şimdi sadece snapshot/polling yok, ama ileride onSnapshot eklersen
  // burada unsubscribe edersin.
  if (unsubscribeOrders) {
    unsubscribeOrders();
    unsubscribeOrders = null;
  }
  if (unsubscribePickerOrders) {
    unsubscribePickerOrders();
    unsubscribePickerOrders = null;
  }
}

// ============= SERVICE WORKER =============
if ("serviceWorker" in navigator) {
  navigator.serviceWorker
    .register("./sw.js")
    .then(() => console.log("Service worker kaydedildi."))
    .catch((err) => console.error("SW kayıt hatası:", err));
}
