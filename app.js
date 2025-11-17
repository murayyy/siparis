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
let currentUser = null;            // Firebase Auth user
let currentUserDoc = null;         // Firestore users dokümanı {displayName, role, ...}
let pickerUsers = [];              // {id, displayName, email}
let activePickerOrder = null;
let productList = [];              // Ürün kataloğu
let unsubscribeOrders = null;      // Şimdilik kullanılmıyor ama ileride onSnapshot için hazır
let unsubscribePickerOrders = null;

// ============= VIEW HELPERS =============
function showView(viewId) {
  [loginView, managerView, pickerView].forEach((v) => {
    if (!v) return;
    v.classList.add("hidden");
    v.classList.remove("active");
  });

  const target = document.getElementById(viewId);
  if (target) {
    target.classList.remove("hidden");
    target.classList.add("active");
  }
}

function setAuthUI(loggedIn) {
  if (loggedIn) {
    logoutBtn?.classList.remove("hidden");
    mainNav?.classList.remove("hidden");
  } else {
    logoutBtn?.classList.add("hidden");
    mainNav?.classList.add("hidden");
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

  // Pickercıları yükle
  await loadPickerUsers();

  // Ürün kataloğunu yükle
  await loadProductList();

  // Manager / Picker ekranını aç
  if (currentUserDoc.role === "manager") {
    showView("manager-view");
    // İlk satır yoksa, ürün listesi yüklendikten sonra ekle
    if (orderItemsContainer && orderItemsContainer.childElementCount === 0) {
      orderItemsContainer.appendChild(createOrderItemRow());
    }
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
    const qSnap = await getDocs(
      query(
        collection(db, "users"),
        where("role", "==", "picker"),
        orderBy("displayName")
      )
    );
    pickerUsers = qSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (err) {
    console.error("Picker users yüklenemedi:", err);
  }
}

// ============= PRODUCT LIST (ÜRÜN KATALOĞU) =============
async function loadProductList() {
  try {
    const snap = await getDocs(collection(db, "products"));
    productList = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

    console.log("Ürün listesi yüklendi:", productList.length, "ürün");

    // Eğer manager ise ve henüz satır eklenmemişse, burada bir satır ekleyelim
    if (
      currentUserDoc &&
      currentUserDoc.role === "manager" &&
      orderItemsContainer &&
      orderItemsContainer.childElementCount === 0
    ) {
      orderItemsContainer.appendChild(createOrderItemRow());
    }
  } catch (err) {
    console.error("Ürün listesi yüklenemedi:", err);
  }
}

// ============= MANAGER: ORDER ITEMS UI (ÜRÜN DROPDOWN) =============
function createOrderItemRow() {
  const row = document.createElement("div");
  row.className = "order-item-row";

  // Ürün dropdown seçenekleri
  let productOptions = `<option value="">Ürün seçin...</option>`;
  productList.forEach((p) => {
    const code = p.code ? ` (${p.code})` : "";
    productOptions += `<option value="${p.id}">${p.name || "İsimsiz"}${code}</option>`;
  });

  row.innerHTML = `
    <select class="item-product">
      ${productOptions}
    </select>
    <input type="text" class="item-qty" placeholder="Miktar" required />
    <input type="text" class="item-aisle" placeholder="Raf / Reyon" readonly />
    <button type="button" class="remove-item-btn">Sil</button>
  `;

  const productSelect = row.querySelector(".item-product");
  const aisleInput = row.querySelector(".item-aisle");

  // Ürün seçildiğinde raf/reyon otomatik dolsun
  productSelect.addEventListener("change", () => {
    const product = productList.find((p) => p.id === productSelect.value);
    if (product) {
      aisleInput.value = product.aisle || "";
    } else {
      aisleInput.value = "";
    }
  });

  row.querySelector(".remove-item-btn").addEventListener("click", () => {
    row.remove();
  });

  return row;
}

addItemBtn?.addEventListener("click", () => {
  orderItemsContainer.appendChild(createOrderItemRow());
});

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
    const productSelect = row.querySelector(".item-product");
    const qtyInput = row.querySelector(".item-qty");
    const aisleInput = row.querySelector(".item-aisle");

    const productId = productSelect?.value;
    const qty = qtyInput?.value.trim();
    const aisle = aisleInput?.value.trim() || "";

    if (!productId || !qty) continue;

    const product = productList.find((p) => p.id === productId);
    if (!product) continue;

    items.push({
      productId,
      name: product.name || "",
      code: product.code || "",
      unit: product.unit || "",
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
  detachListeners();
  // Sayfa ilk açıldığında mevcut filtreyle yükle
  onManagerFilterChange();
}

orderStatusFilter?.addEventListener("change", () => {
  onManagerFilterChange();
});

function onManagerFilterChange() {
  const status = orderStatusFilter?.value || "all";
  loadManagerOrders(status);
}

async function loadManagerOrders(status = "all") {
  try {
    let qRef;

    if (status === "all") {
      qRef = query(collection(db, "orders"), orderBy("createdAt", "desc"));
    } else {
      qRef = query(
        collection(db, "orders"),
        where("status", "==", status),
        orderBy("createdAt", "desc")
      );
    }

    const snap = await getDocs(qRef);
    const orders = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderManagerOrders(orders);
  } catch (err) {
    console.error("Sipariş listesi yüklenemedi:", err);
  }
}

async function renderManagerOrders(orders) {
  if (!ordersListEl) return;
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

    const status = order.status || "new";
    const statusClass = `status-${status}`;
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
            ${status}
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
          .map((it) => `${it.name} (${it.qty} ${it.unit || ""})`)
          .slice(0, 3)
          .join(", ")}${order.items.length > 3 ? "..." : ""}
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
            order.status === "completed"
              ? "completed"
              : order.status === "picking"
              ? "picking"
              : "assigned",
        });

        // Listeyi yeniden yükleyelim
        onManagerFilterChange();
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

  try {
    const qRef = query(
      collection(db, "orders"),
      where("pickerId", "==", currentUser.uid)
    );

    const snap = await getDocs(qRef);
    const orders = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderPickerOrders(orders);
  } catch (err) {
    console.error("Picker siparişleri yüklenemedi:", err);
  }
}

function renderPickerOrders(orders) {
  if (!pickerOrdersListEl) return;
  pickerOrdersListEl.innerHTML = "";

  if (!orders || !orders.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "Size atanmış sipariş yok.";
    pickerOrdersListEl.appendChild(empty);
    pickerOrderDetailEl.className = "order-detail empty-state";
    pickerOrderDetailEl.textContent = "Sipariş seçiniz.";
    return;
  }

  for (const order of orders) {
    const card = document.createElement("div");
    card.className = "order-card";

    const status = order.status || "assigned";
    const statusClass = `status-${status}`;
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
          ${status}
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

  // Varsayılan olarak ilk siparişi aç
  if (!activePickerOrder && orders.length) {
    activePickerOrder = orders[0];
    renderPickerOrderDetail();
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
                <td>${it.qty} ${it.unit || ""}</td>
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
