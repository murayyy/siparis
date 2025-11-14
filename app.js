// app.js — Depo Otomasyonu (Firebase v10 Modular ile uyumlu)

// ======================= IMPORTLAR =======================
import {
  auth,
  db,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  collection,
  doc,
  getDoc,
  getDocs,
  updateDoc,
  addDoc,
  query,
  where,
  orderBy,
  serverTimestamp
} from "./firebase.js";


// ======================= KISA SEÇİCİLER =======================
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const k in attrs) {
    const v = attrs[k];
    if (k === "className") n.className = v;
    else if (k.startsWith("on") && typeof v === "function")
      n.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v != null) n.setAttribute(k, v);
  }
  for (const k of kids) {
    if (k == null) continue;
    if (k instanceof Node) n.append(k);
    else n.append(document.createTextNode(String(k)));
  }
  return n;
}

function show(x) {
  x?.classList?.remove("hidden");
}
function hide(x) {
  x?.classList?.add("hidden");
}

function toast(msg) {
  const t = el(
    "div",
    {
      style:
        "position:fixed;right:12px;bottom:12px;background:#111827;color:#fff;padding:8px 12px;border-radius:999px;z-index:9999;font-size:13px;box-shadow:0 10px 25px rgba(15,23,42,.5)"
    },
    msg
  );
  document.body.append(t);
  setTimeout(() => t.remove(), 2000);
}

function logInfo(msg, data) {
  console.log("[INFO]", msg, data || "");
}
function logError(msg, err) {
  console.error("[ERROR]", msg, err);
}

function formatTs(ts) {
  try {
    if (!ts) return "";
    if (ts.seconds) return new Date(ts.seconds * 1000).toLocaleString();
    return new Date(ts).toLocaleString();
  } catch {
    return "";
  }
}

// ======================= SABİTLER =======================
const ROLES = {
  MANAGER: "manager",
  PICKER: "picker",
  QC: "qc"
};

const STATUS = {
  CREATED: "created",
  ASSIGNED: "assigned",
  PICKING: "picking",
  PICKED: "picked",
  QC: "qc",
  COMPLETED: "completed",
  ARCHIVED: "archived"
};

const state = {
  user: null,
  userDoc: null,
  online: navigator.onLine
};

window.addEventListener("online", () => {
  state.online = true;
  flushQueue();
});
window.addEventListener("offline", () => {
  state.online = false;
});

// ======================= UI REFERANSLARI =======================
const ui = {
  loginSection: $("#loginSection"),
  ordersSection: $("#ordersSection"),
  loginMsg: $("#loginMsg"),
  email: $("#email"),
  password: $("#password"),
  signinBtn: $("#signinBtn"),
  btnLogin: $("#btnLogin"),
  btnLogout: $("#btnLogout"),
  orderList: $("#orderList"),
  userName: $("#userName"),
  userRole: $("#userRole"),
  searchInput: $("#searchInput"),
  btnRefresh: $("#btnRefresh"),
  btnExportCsv: $("#btnExportCsv"),
  btnNewOrder: $("#btnNewOrder"),
  orderModal: $("#orderModal"),
  branchInput: $("#branchInput"),
  productInput: $("#productInput"),
  qtyInput: $("#qtyInput"),
  saveOrderBtn: $("#saveOrderBtn"),
  cancelOrderBtn: $("#cancelOrderBtn")
};

// ======================= OFFLINE KUYRUK =======================
const queue = [];
function enqueue(fn) {
  queue.push(fn);
}
async function flushQueue() {
  if (!state.online || !queue.length) return;
  const copy = [...queue];
  queue.length = 0;
  for (const fn of copy) {
    try {
      await fn();
    } catch (e) {
      logError("queue failed", e);
      enqueue(fn);
    }
  }
}

// ======================= AUTH =======================
ui.signinBtn?.addEventListener("click", async () => {
  const email = ui.email.value.trim();
  const pass = ui.password.value;
  if (!email || !pass) {
    ui.loginMsg.textContent = "E-posta ve şifre zorunlu.";
    return;
  }
  ui.signinBtn.disabled = true;
  ui.loginMsg.textContent = "Giriş yapılıyor...";

  try {
    // 🔴 ÖNEMLİ: Modular çağrı
    await signInWithEmailAndPassword(auth, email, pass);
  } catch (e) {
    ui.loginMsg.textContent = "Giriş hatası: " + (e?.message || e);
  } finally {
    ui.signinBtn.disabled = false;
  }
});

ui.btnLogout?.addEventListener("click", () => {
  signOut(auth).catch(() => {});
});

// 🔴 ÖNEMLİ: Modular onAuthStateChanged
onAuthStateChanged(auth, async (user) => {
  state.user = user || null;
  if (!user) {
    show(ui.loginSection);
    hide(ui.ordersSection);
    show(ui.btnLogin);
    hide(ui.btnLogout);
    ui.loginMsg.textContent = "";
    ui.userName.textContent = "";
    ui.userRole.textContent = "";
    return;
  }

  hide(ui.loginSection);
  show(ui.ordersSection);
  hide(ui.btnLogin);
  show(ui.btnLogout);

  await bootstrapUser();
  await loadOrders();
  await flushQueue();
});

async function bootstrapUser() {
  try {
    const ref = doc(db, "users", state.user.uid);
    const snap = await getDoc(ref);
    state.userDoc = snap.exists()
      ? snap.data()
      : { role: ROLES.MANAGER, displayName: state.user.email };
  } catch (e) {
    logError("userDoc error", e);
    state.userDoc = { role: ROLES.MANAGER, displayName: state.user.email };
  }

  ui.userName.textContent = state.userDoc.displayName || state.user.email;
  ui.userRole.textContent = state.userDoc.role || "manager";
}

function isManager() {
  return state.userDoc?.role === ROLES.MANAGER;
}
function isPicker() {
  return state.userDoc?.role === ROLES.PICKER;
}
function isQC() {
  return state.userDoc?.role === ROLES.QC;
}

// ======================= FIRESTORE HELPERS =======================
const colOrders = () => collection(db, "orders");
const colOrderItems = (orderId) => collection(db, "orders", orderId, "items");

// ======================= SİPARİŞ API =======================
async function createOrder({ branch, items }) {
  const base = {
    branch,
    status: STATUS.CREATED,
    createdAt: serverTimestamp(),
    createdBy: state.user?.uid || "sys",
    assignedTo: null
  };

  const run = async () => {
    const ref = await addDoc(colOrders(), base);
    for (const it of items) {
      await addDoc(colOrderItems(ref.id), it);
    }
    logInfo("order created", { id: ref.id });
    toast("Sipariş oluşturuldu");
  };

  if (state.online) return run();
  enqueue(run);
  toast("Çevrimdışı: sipariş kuyruğa alındı");
}

async function updateOrder(orderId, patch) {
  const run = () => updateDoc(doc(db, "orders", orderId), patch);
  if (state.online) return run();
  enqueue(run);
}

async function setPickedQty(orderId, itemId, picked) {
  const run = () =>
    updateDoc(doc(db, "orders", orderId, "items", itemId), { picked });
  if (state.online) return run();
  enqueue(run);
}

async function archiveOrder(orderId) {
  await updateOrder(orderId, { status: STATUS.ARCHIVED });
  toast("Sipariş arşive taşındı");
  loadOrders();
}

async function assignToSelf(order) {
  if (!isManager()) return;
  await updateOrder(order.id, {
    assignedTo: state.user.uid,
    status: STATUS.ASSIGNED
  });
  toast("Sipariş sana atandı");
  loadOrders();
}

async function startPicking(orderId) {
  await updateOrder(orderId, { status: STATUS.PICKING });
}

async function sendToQC(orderId) {
  await updateOrder(orderId, { status: STATUS.PICKED });
}

async function qcApprove(orderId) {
  await updateOrder(orderId, {
    status: STATUS.COMPLETED,
    qcBy: state.user.uid
  });
  toast("QC onaylandı");
  loadOrders();
}

// ======================= LİSTELEME & ARAMA =======================
let lastOrders = [];

async function loadOrders() {
  try {
    let qRef;
    if (isManager()) {
      qRef = query(colOrders(), orderBy("createdAt", "desc"));
    } else if (isPicker()) {
      qRef = query(
        colOrders(),
        where("assignedTo", "==", state.user.uid),
        orderBy("createdAt", "desc")
      );
    } else {
      qRef = query(
        colOrders(),
        where("status", "in", [STATUS.PICKED, STATUS.QC]),
        orderBy("createdAt", "desc")
      );
    }

    const snap = await getDocs(qRef);
    const orders = [];

    for (const d of snap.docs) {
      const o = d.data();
      const itemsSnap = await getDocs(colOrderItems(d.id));
      const items = itemsSnap.docs.map((x) => ({ id: x.id, ...x.data() }));
      orders.push({ id: d.id, ...o, items });
    }

    lastOrders = orders;
    renderOrders(orders);
  } catch (e) {
    logError("loadOrders", e);
    toast("Siparişler yüklenemedi");
  }
}

function renderOrders(list) {
  ui.orderList.innerHTML = "";
  if (!list.length) {
    ui.orderList.append(el("div", { className: "card muted" }, "Kayıt yok"));
    return;
  }
  list.forEach((o) => ui.orderList.append(orderCard(o)));
}

function orderCard(o) {
  const head = el(
    "div",
    { className: "card" },
    el(
      "div",
      {
        style:
          "display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap"
      },
      el(
        "div",
        {},
        el("b", {}, `${o.id} • ${o.branch}`),
        " ",
        el(
          "span",
          { className: "muted" },
          `Durum: ${o.status} • Kalem: ${o.items?.length || 0}`
        ),
        el(
          "div",
          { className: "muted small" },
          "Tarih: ",
          formatTs(o.createdAt)
        )
      ),
      el(
        "div",
        {},
        isManager() &&
          el(
            "button",
            { className: "btn btn-light", onClick: () => assignToSelf(o) },
            "Ata"
          ),
        " ",
        el(
          "button",
          { className: "btn btn-primary", onClick: () => openOrderDetail(o) },
          "Detay"
        )
      )
    )
  );
  return head;
}

// Arama
ui.searchInput?.addEventListener("input", () => {
  const q = ui.searchInput.value.toLowerCase().trim();
  if (!q) {
    renderOrders(lastOrders);
    return;
  }
  const filtered = lastOrders.filter((o) => {
    if (o.branch?.toLowerCase().includes(q)) return true;
    return (o.items || []).some(
      (it) =>
        it.name?.toLowerCase().includes(q) ||
        String(it.code || "").toLowerCase().includes(q)
    );
  });
  renderOrders(filtered);
});

ui.btnRefresh?.addEventListener("click", () => {
  loadOrders();
});

// ======================= DETAY MODAL =======================
function openOrderDetail(order) {
  const wrap = el("div", {
    style:
      "position:fixed;inset:0;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;z-index:10000"
  });
  const card = el("div", {
    className: "card",
    style: "width:95%;max-width:900px;max-height:90vh;overflow:auto"
  });

  const header = el(
    "div",
    {
      style:
        "display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap"
    },
    el(
      "div",
      {},
      el("h3", {}, `Sipariş ${order.id} • ${order.branch}`),
      el(
        "div",
        { className: "muted small" },
        `Durum: ${order.status} • ${formatTs(order.createdAt)}`
      )
    ),
    el(
      "div",
      {},
      el(
        "button",
        { className: "btn", onClick: () => wrap.remove() },
        "Kapat"
      )
    )
  );

  const table = el("table", {});
  const thead = el(
    "thead",
    {},
    el(
      "tr",
      {},
      el("th", {}, "Ürün"),
      el("th", {}, "Kod"),
      el("th", {}, "Raf"),
      el("th", {}, "İstenen"),
      el("th", {}, "Toplanan"),
      el("th", {}, "Aksiyon")
    )
  );
  const tbody = el("tbody", {});

  for (const it of order.items || []) {
    const input = el("input", {
      type: "number",
      value: String(it.picked || 0),
      min: "0",
      style: "width:80px"
    });

    const row = el(
      "tr",
      {},
      el("td", {}, it.name || "-"),
      el("td", {}, it.code || "-"),
      el("td", {}, it.aisle || "-"),
      el("td", {}, String(it.quantity || 0)),
      el("td", {}, input),
      el(
        "td",
        {},
        el(
          "button",
          {
            className: "btn btn-light",
            onClick: () => openScannerForItem(order, it)
          },
          "Tara"
        ),
        " ",
        el(
          "button",
          {
            className: "btn btn-primary",
            onClick: async () => {
              const v = parseInt(input.value, 10) || 0;
              await setPickedQty(order.id, it.id, v);
              toast("Güncellendi");
            }
          },
          "Kaydet"
        )
      )
    );
    tbody.append(row);
  }

  table.append(thead, tbody);

  const actions = el(
    "div",
    { style: "display:flex;gap:8px;flex-wrap:wrap;margin-top:12px" },
    isPicker() &&
      el(
        "button",
        {
          className: "btn btn-light",
          onClick: () => {
            startPicking(order.id);
            toast("Toplamaya başlandı");
          }
        },
        "Toplamaya Başla"
      ),
    isPicker() &&
      el(
        "button",
        {
          className: "btn btn-primary",
          onClick: () => {
            sendToQC(order.id);
            toast("QC'ye gönderildi");
            wrap.remove();
            loadOrders();
          }
        },
        "QC'ye Gönder"
      ),
    isManager() &&
      el(
        "button",
        {
          className: "btn",
          onClick: () => {
            archiveOrder(order.id);
            wrap.remove();
          }
        },
        "Arşivle"
      ),
    isQC() &&
      el(
        "button",
        {
          className: "btn btn-primary",
          onClick: () => {
            qcApprove(order.id);
            wrap.remove();
          }
        },
        "QC Onayla"
      )
  );

  card.append(header, table, actions);
  wrap.append(card);
  document.body.append(wrap);
}

// ======================= BARKOD / QR =======================
async function openScannerForItem(order, it) {
  const layer = el("div", {
    style:
      "position:fixed;inset:0;background:rgba(0,0,0,.8);display:flex;align-items:center;justify-content:center;z-index:10002"
  });

  const box = el(
    "div",
    { className: "card", style: "width:95%;max-width:520px;color:#111" },
    el("h3", {}, "Barkod / QR Tara"),
    el("video", {
      id: "cam",
      autoplay: true,
      playsinline: true,
      style: "width:100%;border-radius:8px;background:#000"
    }),
    el(
      "div",
      {
        style:
          "display:flex;gap:8px;justify-content:flex-end;margin-top:8px;flex-wrap:wrap"
      },
      el(
        "button",
        {
          className: "btn",
          onclick: () => {
            stop();
            layer.remove();
          }
        },
        "Kapat"
      )
    )
  );

  layer.append(box);
  document.body.append(layer);

  let stream = null;
  let raf = null;
  let detector = null;
  const video = $("#cam");

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment" }
    });
    video.srcObject = stream;
    await video.play();
  } catch (e) {
    logError("camera error", e);
  }

  if ("BarcodeDetector" in window) {
    try {
      detector = new window.BarcodeDetector({
        formats: ["ean_13", "ean_8", "code_128", "qr_code"]
      });
    } catch (e) {
      detector = null;
    }
  }

  async function tick() {
    try {
      if (detector) {
        const codes = await detector.detect(video);
        if (codes && codes.length) {
          const code = codes[0].rawValue;
          await onCode(code);
          return;
        }
      }
    } catch (e) {}
    raf = requestAnimationFrame(tick);
  }

  async function onCode(code) {
    toast("Okundu: " + code);
    const next = Math.min((it.picked || 0) + 1, it.quantity);
    await setPickedQty(order.id, it.id, next);
    await loadOrders();
    stop();
    layer.remove();
  }

  function stop() {
    try {
      if (raf) cancelAnimationFrame(raf);
      if (stream) stream.getTracks().forEach((t) => t.stop());
    } catch {}
  }

  raf = requestAnimationFrame(tick);

  // BarcodeDetector yoksa fallback → manuel
  setTimeout(async () => {
    if (!detector) {
      const code = prompt("Barkod / QR kodu:", it.code || "");
      if (code != null) {
        await onCode(code);
      }
    }
  }, 700);
}

// ======================= CSV EXPORT (F9) =======================
async function exportOrdersToCSV() {
  try {
    const qRef = query(colOrders(), orderBy("createdAt", "desc"));
    const snap = await getDocs(qRef);
    const rows = [["ID", "Branch", "Status", "Lines", "CreatedAt"]];

    for (const d of snap.docs) {
      const o = d.data();
      const itemsSnap = await getDocs(colOrderItems(d.id));
      rows.push([
        d.id,
        o.branch || "",
        o.status || "",
        itemsSnap.size,
        o.createdAt?.seconds || ""
      ]);
    }

    const csv = rows
      .map((r) =>
        r.map((x) => `"${String(x).replace(/"/g, '""')}"`).join(",")
      )
      .join("\n");

    const blob = new Blob([csv], {
      type: "text/csv;charset=utf-8;"
    });
    const a = el("a", {
      href: URL.createObjectURL(blob),
      download: "orders.csv"
    });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 400);
  } catch (e) {
    logError("csv export", e);
    toast("CSV oluşturulamadı");
  }
}

ui.btnExportCsv?.addEventListener("click", exportOrdersToCSV);

// F9 kısayolu
window.addEventListener("keydown", (e) => {
  if (e.key === "F9") {
    e.preventDefault();
    exportOrdersToCSV();
  }
});

// ======================= YENİ SİPARİŞ MODALI =======================
ui.btnNewOrder?.addEventListener("click", () => {
  if (ui.orderModal?.showModal) ui.orderModal.showModal();
  else show(ui.orderModal);
});

ui.cancelOrderBtn?.addEventListener("click", () => {
  if (ui.orderModal?.close) ui.orderModal.close();
  hide(ui.orderModal);
});

ui.saveOrderBtn?.addEventListener("click", async () => {
  const branch = (ui.branchInput?.value || "").trim();
  const product = (ui.productInput?.value || "").trim();
  const qty = parseInt(ui.qtyInput?.value || "0", 10) || 0;

  if (!branch || !product || qty <= 0) {
    alert("Şube, ürün ve miktar zorunlu.");
    return;
  }

  await createOrder({
    branch,
    items: [
      {
        code: slug(product),
        name: product,
        aisle: "A-01",
        quantity: qty,
        picked: 0
      }
    ]
  });

  ui.branchInput.value = "";
  ui.productInput.value = "";
  ui.qtyInput.value = "1";

  if (ui.orderModal?.close) ui.orderModal.close();
  hide(ui.orderModal);
  await loadOrders();
});

function slug(s) {
  return String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

// ======================= DEBUG API =======================
window.depoApp = {
  state,
  ROLES,
  STATUS,
  loadOrders,
  createOrder,
  setPickedQty,
  exportOrdersToCSV
};

logInfo("app.js (modular Firebase) yüklendi");
