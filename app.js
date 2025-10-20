// =====================================================
// app.js — Depo Otomasyonu (Atama geri alındı: SEÇİMSİZ atama YOK)
// =====================================================

// ================= FIREBASE IMPORT =================
import {
  app, auth, db,
  signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged,
  collection, doc, setDoc, getDoc, getDocs, updateDoc, addDoc,
  query, where, orderBy, serverTimestamp
} from "./firebase.js";

// Excel (SheetJS)
import * as XLSX from "https://cdn.sheetjs.com/xlsx-0.19.3/package/xlsx.mjs";

// ================== GLOBAL ==================
let currentUser = null;
let scanner = null;
let qcScanner = null;
let countScanner = null;

let orderDraft = [];
let pickerOrder = null;
let qcOrder = null;
let paletOrder = null;
let countSession = [];

// ================== HELPERS ==================
const $ = (id) => document.getElementById(id);
const toNum = (v) => {
  if (v === "" || v == null) return 0;
  const n = parseFloat(String(v).replace(",", "."));
  return Number.isNaN(n) ? 0 : n;
};
const clamp = (v, min, max) => Math.min(Math.max(v, min), max);

// ================== VIEW KONTROL ==================
function showView(id) {
  try {
    document.querySelectorAll(".view").forEach(v => v.classList.add("hidden"));
    const target = document.getElementById(id);
    if (target) target.classList.remove("hidden");
  } catch (err) { console.error("showView hatası:", err); }
}
window.showView = showView; // DOMContentLoaded'da çağırılıyor

// Dinamik: data-view tıklarında görünüm değiştir
document.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-view]");
  if (btn) showView(btn.dataset.view);
});

// === Mobil menü (hamburger) ===
$("menuToggle")?.addEventListener("click", () => {
  $("mainNav")?.classList.toggle("show");
});

// ================== AUTH ==================
$("loginBtn")?.addEventListener("click", async () => {
  const email = $("login-email").value.trim();
  const pass = $("login-pass").value;
  try {
    await signInWithEmailAndPassword(auth, email, pass);
  } catch (err) { alert("Giriş hatası: " + err.message); }
});

$("registerBtn")?.addEventListener("click", async () => {
  const email = $("reg-email").value.trim();
  const pass = $("reg-pass").value;
  const role = $("reg-role").value;
  try {
    const userCred = await createUserWithEmailAndPassword(auth, email, pass);
    await setDoc(doc(db, "users", userCred.user.uid), {
      email, role, createdAt: new Date()
    });
    alert("Kayıt başarılı!");
  } catch (err) { alert("Kayıt hatası: " + err.message); }
});

// Kullanıcı bilgisi
function updateUserInfo(email, role) {
  const infoEl = $("userInfo");
  if (!infoEl) return;
  if (!email) infoEl.textContent = "👤 Giriş yapılmadı";
  else infoEl.textContent = `👤 ${email} — ${role || "-"}`;
}

// Rol görünürlüğü
function applyRoleVisibility(role) {
  document.querySelectorAll("nav button[data-role]").forEach(btn => btn.style.display = "none");
  document.querySelectorAll(`nav button[data-role="${role}"], #logoutBtn`).forEach(btn => {
    btn.style.display = "inline-block";
  });
  if (role === "admin") {
    document.querySelectorAll("nav button[data-role]").forEach(btn => btn.style.display = "inline-block");
  }
}

// Çıkış
$("logoutBtn")?.addEventListener("click", async () => {
  try {
    await signOut(auth);
    currentUser = null;
    document.querySelector("header nav")?.classList.add("hidden");
    showView("view-login");
    updateUserInfo(null, null);
  } catch (err) { alert("Çıkış yapılamadı: " + err.message); }
});

// Giriş durumu
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    currentUser = null;
    $("logoutBtn")?.classList.add("hidden");
    document.querySelector("header nav")?.classList.add("hidden");
    showView("view-login");
    updateUserInfo(null, null);
    return;
  }

  currentUser = user;
  $("logoutBtn")?.classList.remove("hidden");
  document.querySelector("header nav")?.classList.remove("hidden");

  let role = "sube";
  try {
    const userSnap = await getDoc(doc(db, "users", user.uid));
    if (userSnap.exists() && userSnap.data().role) role = userSnap.data().role;
  } catch (err) { console.error("Rol alınamadı:", err); }

  applyRoleVisibility(role);
  updateUserInfo(user.email, role);

  if (role === "sube") showView("view-branch");
  else if (role === "yonetici") showView("view-manager");
  else if (role === "toplayici") { showView("view-picker"); refreshAssigned?.(); }
  else if (role === "qc") showView("view-qc");
  else if (role === "palet") showView("view-palet");
  else if (role === "admin") showView("view-products");
});

// ================== ÜRÜN KATALOĞU ==================
async function listProductsIntoTable() {
  const tb = document.querySelector("#tbl-products tbody");
  if (!tb) return;
  tb.innerHTML = "";
  const snap = await getDocs(collection(db, "products"));
  snap.forEach(d => {
    const p = d.data();
    tb.insertAdjacentHTML("beforeend", `
      <tr>
        <td>${p.code || ""}</td>
        <td>${p.name || ""}</td>
        <td>${p.barcode || ""}</td>
        <td>${p.reyon || ""}</td>
      </tr>
    `);
  });
}
async function refreshBranchProductSelect() {
  const sel = $("branchProduct");
  if (!sel) return;
  sel.innerHTML = "";
  const snap = await getDocs(collection(db, "products"));
  const def = document.createElement("option");
  def.value = "";
  def.textContent = "Ürün seçin…";
  sel.appendChild(def);
  snap.forEach(d => {
    const p = d.data();
    const opt = document.createElement("option");
    opt.value = p.code;
    opt.textContent = `${p.code} — ${p.name}`;
    opt.dataset.name = p.name || "";
    opt.dataset.barcode = p.barcode || "";
    opt.dataset.reyon = p.reyon || "";
    sel.appendChild(opt);
  });
}
$("uploadProductsBtn")?.addEventListener("click", async () => {
  const file = $("excelProducts").files?.[0];
  if (!file) return alert("Excel dosyası seç!");
  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      const wb = XLSX.read(new Uint8Array(e.target.result), { type: "array" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json(sheet);
      let count = 0;
      for (const row of json) {
        if (!row.code || !row.name) continue;
        const code = String(row.code).trim();
        await setDoc(doc(db, "products", code), {
          code,
          name: String(row.name).trim(),
          barcode: row.barcode ? String(row.barcode).trim() : "",
          reyon: row.reyon ? String(row.reyon).trim() : ""
        });
        count++;
      }
      alert(`Toplam ${count} ürün yüklendi.`);
      await listProductsIntoTable();
      await refreshBranchProductSelect();
    } catch (err) { alert("Excel okuma hatası: " + err.message); }
  };
  reader.readAsArrayBuffer(file);
});
document.querySelector("button[data-view='view-products']")?.addEventListener("click", listProductsIntoTable);

// ================== ŞUBE SİPARİŞ ==================
function renderOrderDraft() {
  const tb = document.querySelector("#tbl-branch-lines tbody");
  if (!tb) return;
  tb.innerHTML = "";
  orderDraft.forEach((l, i) => {
    tb.insertAdjacentHTML("beforeend", `
      <tr>
        <td>${i + 1}</td>
        <td>${l.code}</td>
        <td>${l.name}</td>
        <td>${l.qty}</td>
        <td>${l.barcode || ""}</td>
        <td>${l.reyon || ""}</td>
        <td><button class="danger" data-del="${i}">Sil</button></td>
      </tr>
    `);
  });
  tb.querySelectorAll("button[data-del]").forEach(btn => {
    btn.addEventListener("click", () => {
      const idx = parseInt(btn.dataset.del, 10);
      if (confirm("Bu satırı silmek istediğinize emin misiniz?")) {
        orderDraft.splice(idx, 1);
        renderOrderDraft();
      }
    });
  });
}
$("addLineBtn")?.addEventListener("click", () => {
  const sel = $("branchProduct");
  const qty = parseInt($("branchQty").value, 10) || 0;
  if (!sel.value) return alert("Ürün seçin.");
  if (!qty || qty < 1) return alert("Geçerli miktar girin.");
  const opt = sel.options[sel.selectedIndex];
  const line = {
    code: sel.value,
    name: opt.dataset.name || "",
    qty,
    barcode: opt.dataset.barcode || "",
    reyon: opt.dataset.reyon || ""
  };
  const existing = orderDraft.find(x => x.code === line.code);
  if (existing) existing.qty += qty; else orderDraft.push(line);
  renderOrderDraft();
});
$("createOrderBtn")?.addEventListener("click", async () => {
  const name = $("orderName").value.trim();
  const warehouse = $("branchWarehouse").value;
  if (!name) return alert("Sipariş adı gir!");
  if (orderDraft.length === 0) return alert("Sipariş satırı ekleyin!");
  await addDoc(collection(db, "orders"), {
    name, warehouse, status: "Yeni",
    createdBy: currentUser.uid,
    createdAt: serverTimestamp(),
    lines: orderDraft.map(l => ({
      code: l.code, name: l.name, qty: l.qty,
      barcode: l.barcode || "", reyon: l.reyon || "",
      picked: 0, qc: 0
    }))
  });
  alert("Sipariş oluşturuldu!");
  orderDraft = [];
  renderOrderDraft();
  $("orderName").value = "";
  await loadBranchOrders();
});
async function loadBranchOrders() {
  const qy = query(collection(db, "orders"), where("createdBy", "==", currentUser.uid));
  const snap = await getDocs(qy);
  const tbody = document.querySelector("#branchOrders tbody");
  if (!tbody) return;
  tbody.innerHTML = "";
  snap.forEach(docu => {
    const d = docu.data();
    tbody.insertAdjacentHTML("beforeend", `
      <tr>
        <td>${docu.id}</td>
        <td>${d.name}</td>
        <td>${d.warehouse || "-"}</td>
        <td>${d.status}</td>
      </tr>
    `);
  });
}
document.querySelector("button[data-view='view-branch']")?.addEventListener("click", async () => {
  await refreshBranchProductSelect();
  await loadBranchOrders();
});

// ================== STOK AZALTMA ==================
async function decreaseStock(code, qty, warehouse) {
  const ref = doc(db, "stocks", `${warehouse}_${code}`);
  const snap = await getDoc(ref);
  if (snap.exists()) {
    let newQty = (toNum(snap.data().qty) || 0) - toNum(qty);
    if (newQty < 0) newQty = 0;
    await updateDoc(ref, { qty: newQty });
    if (newQty < 5) alert(`⚠️ Dikkat! ${warehouse}/${code} stoğu kritik (${newQty})`);
  } else {
    alert(`Stok bulunamadı: ${warehouse} - ${code}`);
  }
}

// ================== TOPLAYICI ==================
$("refreshAssignedBtn")?.addEventListener("click", refreshAssigned);
$("openAssignedBtn")?.addEventListener("click", openAssigned);
$("startScanBtn")?.addEventListener("click", startPickerScanner);
$("stopScanBtn")?.addEventListener("click", stopPickerScanner);
$("finishPickBtn")?.addEventListener("click", finishPick);
$("manualAddBtn")?.addEventListener("click", manualAdd);
$("savePickBtn")?.addEventListener("click", savePickProgress);

async function refreshAssigned() {
  const sel = $("assignedOrders");
  if (!sel) return;
  sel.innerHTML = "";
  const qs = await getDocs(
    query(collection(db, "orders"), where("status", "in", ["Atandı", "Toplama Başladı"]))
  );
  qs.forEach(d => {
    const o = { id: d.id, ...d.data() };
    const opt = document.createElement("option");
    opt.value = o.id;
    opt.textContent = `${o.id} - ${o.name} (${o.status})`;
    sel.appendChild(opt);
  });
}
async function openAssigned() {
  const id = $("assignedOrders").value;
  if (!id) return;
  const ds = await getDoc(doc(db, "orders", id));
  if (!ds.exists()) return;
  pickerOrder = { id: ds.id, ...ds.data() };
  pickerOrder.lines = (pickerOrder.lines || []).map(l => ({ ...l, picked: toNum(l.picked) || 0 }));
  renderPickerLines();
  $("pickerTitle").textContent = `Sipariş: ${pickerOrder.name} (${pickerOrder.warehouse || "-"})`;
  $("pickerArea").classList.remove("hidden");
}
function renderPickerLines() {
  const tb = document.querySelector("#tbl-picker-lines tbody");
  if (!tb) return;
  tb.innerHTML = "";

  const paintRow = (tr, qty, picked) => {
    tr.classList.remove("not-picked", "partial-picked", "fully-picked");
    tr.classList.add(picked === 0 ? "not-picked" : picked < qty ? "partial-picked" : "fully-picked");
  };

  pickerOrder.lines.forEach((l, i) => {
    const qty = toNum(l.qty);
    const picked = toNum(l.picked);
    tb.insertAdjacentHTML("beforeend", `
      <tr data-row="${i}">
        <td>${i + 1}</td>
        <td>${l.code}</td>
        <td>${l.name || ""}</td>
        <td>${qty}</td>
        <td>
          <input
            type="number" inputmode="decimal" step="0.001" min="0"
            class="picked-input" data-idx="${i}" value="${picked}"
            style="width:100px;text-align:center;"
          />
        </td>
        <td>
          <button class="pill" data-plus="${i}">+1</button>
          <button class="pill" data-minus="${i}">-1</button>
          <button class="pill" data-del="${i}">Sil</button>
        </td>
      </tr>
    `);
    paintRow(tb.querySelector(`tr[data-row="${i}"]`), qty, picked);
  });

  tb.querySelectorAll(".picked-input").forEach(inp => {
    inp.addEventListener("input", e => {
      const idx = Number(e.target.dataset.idx);
      pickerOrder.lines[idx].picked = toNum(e.target.value);
    });
    inp.addEventListener("blur", e => {
      const idx = Number(e.target.dataset.idx);
      const line = pickerOrder.lines[idx];
      const qty = toNum(line.qty);
      let val = toNum(e.target.value);
      val = clamp(val, 0, Number.isFinite(qty) ? qty : Infinity);
      line.picked = val;
      e.target.value = val;
      const tr = tb.querySelector(`tr[data-row="${idx}"]`);
      paintRow(tr, qty, val);
    });
    inp.addEventListener("keydown", e => { if (e.key === "Enter") e.target.blur(); });
  });

  tb.querySelectorAll("button[data-plus]").forEach(btn => {
    btn.addEventListener("click", () => {
      const idx = Number(btn.dataset.plus);
      const line = pickerOrder.lines[idx];
      const qty = toNum(line.qty);
      const cur = toNum(line.picked);
      const next = clamp(cur + 1, 0, Number.isFinite(qty) ? qty : Infinity);
      line.picked = next;
      const tr = tb.querySelector(`tr[data-row="${idx}"]`);
      const inp = tr.querySelector(".picked-input");
      inp.value = next;
      paintRow(tr, qty, next);
    });
  });
  tb.querySelectorAll("button[data-minus]").forEach(btn => {
    btn.addEventListener("click", () => {
      const idx = Number(btn.dataset.minus);
      const line = pickerOrder.lines[idx];
      const cur = toNum(line.picked);
      const next = Math.max(cur - 1, 0);
      line.picked = next;
      const tr = tb.querySelector(`tr[data-row="${idx}"]`);
      const inp = tr.querySelector(".picked-input");
      inp.value = next;
      const q = toNum(line.qty);
      paintRow(tr, q, next);
    });
  });
  tb.querySelectorAll("button[data-del]").forEach(btn => {
    btn.addEventListener("click", () => {
      const i = Number(btn.dataset.del);
      if (confirm("Bu satırı listeden silmek istiyor musunuz?")) {
        pickerOrder.lines.splice(i, 1);
        renderPickerLines();
      }
    });
  });
}
async function startPickerScanner() {
  if (scanner) await stopPickerScanner();
  scanner = new Html5Qrcode("reader");
  await scanner.start({ facingMode: "environment" }, { fps: 10, qrbox: 250 }, (code) => {
    handleScannedCode(code, true);
  });
}
function stopPickerScanner() {
  if (!scanner) return;
  return scanner.stop().then(() => { scanner.clear(); scanner = null; });
}
async function handleScannedCode(codeOrBarcode, askQty = false) {
  if (!pickerOrder) return alert("Önce sipariş açın.");
  let qty = 1;
  if (askQty) {
    const v = prompt(`Okunan: ${codeOrBarcode}\nMiktar?`, "1");
    qty = parseFloat((v || "1").replace(",", "."));
    if (!qty || qty < 0) qty = 0;
  }
  let idx = pickerOrder.lines.findIndex(l =>
    (l.barcode && l.barcode === codeOrBarcode) || l.code === codeOrBarcode
  );
  if (idx !== -1) {
    const max = pickerOrder.lines[idx].qty ?? Infinity;
    pickerOrder.lines[idx].picked = Math.min((toNum(pickerOrder.lines[idx].picked) || 0) + qty, max);
  } else {
    let name = "";
    try {
      const prodSnap = await getDoc(doc(db, "products", codeOrBarcode));
      if (prodSnap.exists()) name = prodSnap.data().name || "";
    } catch {}
    pickerOrder.lines.push({ code: codeOrBarcode, name, qty: 0, picked: qty });
  }
  renderPickerLines();
}
async function manualAdd() {
  if (!pickerOrder) return alert("Önce sipariş seçin!");
  const code = $("manualScanCode").value.trim();
  let qty = toNum($("manualScanQty").value);
  if (!code) return alert("Kod veya barkod girin!");
  if (!qty || qty < 0) qty = 0;

  let idx = pickerOrder.lines.findIndex(l => l.code === code || l.barcode === code);
  if (idx !== -1) {
    const max = pickerOrder.lines[idx].qty ?? Infinity;
    pickerOrder.lines[idx].picked = Math.min((toNum(pickerOrder.lines[idx].picked) || 0) + qty, max);
  } else {
    let name = "";
    try {
      const prodSnap = await getDoc(doc(db, "products", code));
      if (prodSnap.exists()) name = prodSnap.data().name || "";
    } catch {}
    pickerOrder.lines.push({ code, name, qty: 0, picked: qty });
  }
  renderPickerLines();
  $("manualScanCode").value = "";
  $("manualScanQty").value = "1";
}
async function savePickProgress() {
  if (!pickerOrder) return alert("Önce bir sipariş açın!");
  await updateDoc(doc(db, "orders", pickerOrder.id), {
    lines: pickerOrder.lines, status: "Toplama Başladı", lastUpdate: new Date()
  });
  alert("Toplama durumu kaydedildi.");
}
async function finishPick() {
  if (!pickerOrder) return;
  for (const l of pickerOrder.lines) {
    const used = Math.min(toNum(l.picked) || 0, toNum(l.qty) || 0);
    if (used > 0) await decreaseStock(l.code, used, pickerOrder.warehouse);
  }
  await updateDoc(doc(db, "orders", pickerOrder.id), { lines: pickerOrder.lines, status: "Toplandı" });
  alert("Toplama tamamlandı!");
}

// ================== YÖNETİCİ (Siparişler & Atama) ==================
$("refreshOrdersBtn")?.addEventListener("click", loadAllOrders);
async function loadAllOrders() {
  const snap = await getDocs(collection(db, "orders"));
  const tbody = document.querySelector("#tbl-orders tbody");
  if (!tbody) return;
  tbody.innerHTML = "";
  snap.forEach(docu => {
    const o = { id: docu.id, ...docu.data() };
    tbody.insertAdjacentHTML("beforeend", `
      <tr>
        <td>${o.id}</td>
        <td>${o.name}</td>
        <td>${o.warehouse || "-"}</td>
        <td>${o.status}</td>
        <td>
          ${o.status === "Yeni"
            ? `<button class="btn-light" data-assign data-id="${o.id}" data-role="toplayici">Toplayıcıya Ata</button>` : ""}
          ${o.status === "Toplandı"
            ? `<button class="btn-light" data-assign data-id="${o.id}" data-role="qc">Kontrole Ata</button>` : ""}
        </td>
      </tr>
    `);
  });

  // Butonlara tıklayınca modal açılır (ESKİ HAL)
  tbody.querySelectorAll("button[data-assign]").forEach(btn => {
    btn.addEventListener("click", () => openAssignModal(btn.dataset.id, btn.dataset.role));
  });
}

async function openAssignModal(orderId, roleType) {
  const modal = $("assignModal");
  const title = $("assignTitle");
  const select = $("assignUserSelect");
  const confirmBtn = $("assignConfirmBtn");
  const cancelBtn = $("assignCancelBtn");

  title.textContent = roleType === "qc" ? "Kontrolcü Seç" : "Toplayıcı Seç";
  select.innerHTML = `<option value="">Yükleniyor...</option>`;
  modal.style.display = "flex";

  try {
    const usersSnap = await getDocs(collection(db, "users"));
    const list = [];
    usersSnap.forEach(u => {
      const d = u.data();
      if (d.role === roleType) list.push({ id: u.id, email: d.email || u.id });
    });
    select.innerHTML = "";
    if (list.length === 0) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = roleType === "qc" ? "QC bulunamadı" : "Toplayıcı bulunamadı";
      select.appendChild(opt);
    } else {
      list.forEach(u => {
        const opt = document.createElement("option");
        opt.value = u.id;
        opt.textContent = u.email;
        select.appendChild(opt);
      });
    }
  } catch (e) {
    alert("Kullanıcı listesi alınamadı.");
    select.innerHTML = `<option value="">Hata</option>`;
  }

  const onConfirm = async () => {
    const uid = select.value;
    if (!uid) { alert("Lütfen bir kullanıcı seçin!"); return; }
    const payload = {};
    if (roleType === "toplayici") { payload.assignedPicker = uid; payload.status = "Atandı"; }
    else if (roleType === "qc")   { payload.assignedQC    = uid; payload.status = "Kontrol"; }
    await updateDoc(doc(db, "orders", orderId), payload);
    modal.style.display = "none";
    loadAllOrders();
    alert("✅ Atama tamamlandı");
    confirmBtn.removeEventListener("click", onConfirm);
    cancelBtn.removeEventListener("click", onCancel);
  };
  const onCancel = () => {
    modal.style.display = "none";
    confirmBtn.removeEventListener("click", onConfirm);
    cancelBtn.removeEventListener("click", onCancel);
  };

  confirmBtn.addEventListener("click", onConfirm);
  cancelBtn.addEventListener("click", onCancel);
}
window.openAssignModal = openAssignModal;

// === GERİ ALINDI: Artık kullanıcı seçmeden atama YAPILMAZ ===
async function openAssignModal(orderId, roleType) {
  const modal = $("assignModal");
  const title = $("assignTitle");
  const select = $("assignUserSelect");
  const confirmBtn = $("assignConfirmBtn");
  const cancelBtn = $("assignCancelBtn");

  title.textContent = roleType === "qc" ? "Kontrolcü Seç" : "Toplayıcı Seç";
  select.innerHTML = `<option value="">Yükleniyor...</option>`;
  modal.style.display = "flex";

  try {
    const usersSnap = await getDocs(collection(db, "users"));
    const list = [];
    usersSnap.forEach(u => {
      const d = u.data();
      if (d.role === roleType) list.push({ id: u.id, email: d.email || u.id });
    });
    select.innerHTML = "";
    if (list.length === 0) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = roleType === "qc" ? "QC bulunamadı" : "Toplayıcı bulunamadı";
      select.appendChild(opt);
    } else {
      list.forEach(u => {
        const opt = document.createElement("option");
        opt.value = u.id;
        opt.textContent = u.email;
        select.appendChild(opt);
      });
    }
  } catch (e) {
    alert("Kullanıcı listesi alınamadı.");
    select.innerHTML = `<option value="">Hata</option>`;
  }

  const onConfirm = async () => {
    const uid = select.value;
    if (!uid) { alert("Lütfen bir kullanıcı seçin!"); return; }
    const payload = {};
    if (roleType === "toplayici") { payload.assignedPicker = uid; payload.status = "Atandı"; }
    else if (roleType === "qc")   { payload.assignedQC    = uid; payload.status = "Kontrol"; }
    await updateDoc(doc(db, "orders", orderId), payload);
    modal.style.display = "none";
    loadAllOrders();
    alert("✅ Atama tamamlandı");
    // Temizle
    confirmBtn.removeEventListener("click", onConfirm);
    cancelBtn.removeEventListener("click", onCancel);
  };
  const onCancel = () => {
    modal.style.display = "none";
    confirmBtn.removeEventListener("click", onConfirm);
    cancelBtn.removeEventListener("click", onCancel);
  };

  confirmBtn.addEventListener("click", onConfirm);
  cancelBtn.addEventListener("click", onCancel);
}
window.openAssignModal = openAssignModal;

// ================== QC ==================
$("refreshQCBtn")?.addEventListener("click", refreshQCOrders);
$("openQCBtn")?.addEventListener("click", openQCOrder);
$("startQCScanBtn")?.addEventListener("click", startQCScanner);
$("stopQCScanBtn")?.addEventListener("click", stopQCScanner);
$("finishQCBtn")?.addEventListener("click", finishQC);
$("saveQCBtn")?.addEventListener("click", saveQCProgress);
$("exportQCBtn")?.addEventListener("click", exportQCToExcel);

async function refreshQCOrders() {
  const sel = $("qcOrders");
  if (!sel) return;
  sel.innerHTML = "";
  const qs = await getDocs(
    query(collection(db, "orders"), where("status", "in", ["Kontrol", "Kontrol Başladı"]))
  );
  qs.forEach(d => {
    const o = { id: d.id, ...d.data() };
    const opt = document.createElement("option");
    opt.value = o.id;
    opt.textContent = `${o.id} - ${o.name || "(İsimsiz)"} (${o.status})`;
    sel.appendChild(opt);
  });
}
async function openQCOrder() {
  const id = $("qcOrders")?.value;
  if (!id) return alert("Lütfen bir sipariş seçin.");
  const ds = await getDoc(doc(db, "orders", id));
  if (!ds.exists()) return alert("Sipariş bulunamadı!");
  qcOrder = { id: ds.id, ...ds.data() };
  qcOrder.lines = (qcOrder.lines || []).map(l => ({
    ...l,
    qc: toNum(l.qc) || 0,
    picked: toNum(l.picked) || 0,
    qty: toNum(l.qty) || 0
  }));
  renderQCLines();
  $("qcTitle").textContent = `Sipariş: ${qcOrder.name}`;
  $("qcArea").classList.remove("hidden");
  await updateDoc(doc(db, "orders", qcOrder.id), { status: "Kontrol Başladı", lastUpdate: new Date() });
}
function renderQCLines() {
  const tb = document.querySelector("#tbl-qc-lines tbody");
  if (!tb) return;
  tb.innerHTML = "";

  const paintRow = (tr, picked, qc) => {
    tr.classList.remove("not-picked", "partial-picked", "fully-picked");
    tr.classList.add(qc === 0 ? "not-picked" : qc < picked ? "partial-picked" : "fully-picked");
  };

  qcOrder.lines.forEach((l, i) => {
    const picked = toNum(l.picked);
    const qc = toNum(l.qc);
    const diff = Math.max(0, picked - qc);

    tb.insertAdjacentHTML("beforeend", `
      <tr data-row="${i}">
        <td>${i + 1}</td>
        <td>${l.code || ""}</td>
        <td>${l.name || ""}</td>
        <td>${toNum(l.qty)}</td>
        <td>${picked}</td>
        <td>
          <input type="number" inputmode="decimal" step="0.001" min="0" max="${picked}"
            class="qc-input" data-idx="${i}" value="${qc}" style="width:100px;text-align:center;" />
          <div class="row" style="justify-content:center;gap:4px;margin-top:4px;">
            <button class="pill" data-qc-plus="${i}">+1</button>
            <button class="pill" data-qc-minus="${i}">-1</button>
          </div>
        </td>
        <td>${diff}</td>
      </tr>
    `);

    paintRow(tb.querySelector(`tr[data-row="${i}"]`), picked, qc);
  });

  tb.querySelectorAll(".qc-input").forEach(inp => {
    inp.addEventListener("input", e => {
      const idx = Number(e.target.dataset.idx);
      qcOrder.lines[idx].qc = toNum(e.target.value);
    });
    inp.addEventListener("blur", e => {
      const idx = Number(e.target.dataset.idx);
      const line = qcOrder.lines[idx];
      const picked = toNum(line.picked);
      let val = toNum(e.target.value);
      val = clamp(val, 0, picked);
      line.qc = val;
      e.target.value = val;
      const tr = tb.querySelector(`tr[data-row="${idx}"]`);
      paintRow(tr, picked, val);
      tr.querySelectorAll("td")[6].textContent = Math.max(0, picked - val);
    });
    inp.addEventListener("keydown", e => { if (e.key === "Enter") e.target.blur(); });
  });

  tb.querySelectorAll("button[data-qc-plus]").forEach(btn => {
    btn.addEventListener("click", () => {
      const idx = Number(btn.dataset.qcPlus);
      const line = qcOrder.lines[idx];
      const picked = toNum(line.picked);
      const next = clamp(toNum(line.qc) + 1, 0, picked);
      line.qc = next;
      const tr = tb.querySelector(`tr[data-row="${idx}"]`);
      tr.querySelector(".qc-input").value = next;
      paintRow(tr, picked, next);
      tr.querySelectorAll("td")[6].textContent = Math.max(0, picked - next);
    });
  });
  tb.querySelectorAll("button[data-qc-minus]").forEach(btn => {
    btn.addEventListener("click", () => {
      const idx = Number(btn.dataset.qcMinus);
      const line = qcOrder.lines[idx];
      const picked = toNum(line.picked);
      const next = clamp(toNum(line.qc) - 1, 0, picked);
      line.qc = next;
      const tr = tb.querySelector(`tr[data-row="${idx}"]`);
      tr.querySelector(".qc-input").value = next;
      paintRow(tr, picked, next);
      tr.querySelectorAll("td")[6].textContent = Math.max(0, picked - next);
    });
  });
}
async function startQCScanner() {
  if (typeof Html5Qrcode === "undefined") return alert("📷 Barkod kütüphanesi yüklenmemiş!");
  if (qcScanner) await stopQCScanner();
  qcScanner = new Html5Qrcode("qcReader");
  try {
    await qcScanner.start({ facingMode: "environment" }, { fps: 10, qrbox: 250 }, onQCScan);
  } catch (err) { console.error(err); alert("Tarayıcı başlatılamadı!"); }
}
function stopQCScanner() {
  if (!qcScanner) return;
  return qcScanner.stop().then(() => { qcScanner.clear(); qcScanner = null; });
}
function onQCScan(code) {
  if (!qcOrder) return;
  const idx = qcOrder.lines.findIndex(l => l.barcode === code || l.code === code);
  if (idx === -1) return alert("Barkod bulunamadı: " + code);
  const picked = toNum(qcOrder.lines[idx].picked);
  const cur = toNum(qcOrder.lines[idx].qc);
  if (cur < picked) qcOrder.lines[idx].qc = cur + 1;

  const tb = document.querySelector("#tbl-qc-lines tbody");
  const tr = tb?.querySelector(`tr[data-row="${idx}"]`);
  if (tr) {
    const inp = tr.querySelector(".qc-input");
    inp.value = qcOrder.lines[idx].qc;
    inp.dispatchEvent(new Event("blur", { bubbles: true }));
  }
}
async function saveQCProgress() {
  if (!qcOrder) return alert("Önce bir sipariş açın!");
  await updateDoc(doc(db, "orders", qcOrder.id), {
    lines: qcOrder.lines, status: "Kontrol Başladı", lastUpdate: new Date()
  });
  alert("💾 QC kaydedildi!");
}
async function finishQC() {
  if (!qcOrder) return alert("Sipariş seçilmedi!");
  await stopQCScanner();
  await updateDoc(doc(db, "orders", qcOrder.id), {
    lines: qcOrder.lines, status: "Tamamlandı", lastUpdate: new Date()
  });
  alert("✅ QC tamamlandı!");
}
async function exportQCToExcel() {
  const qcTable = document.querySelector("#tbl-qc-lines tbody");
  if (!qcTable || qcTable.rows.length === 0) {
    alert("Tabloda aktarılacak veri yok!");
    return;
  }
  const data = [["#", "Kod", "Ürün", "İstenen", "Toplanan", "QC (Kontrol)", "Eksik"]];
  [...qcTable.rows].forEach(row => {
    const cells = [...row.cells].map(td => td.innerText.trim());
    data.push(cells);
  });
  const ws = XLSX.utils.aoa_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "QC_Kontrol");
  const orderName = document.getElementById("qcTitle")?.innerText.replace("Sipariş: ", "") || "Kontrol";
  const date = new Date().toISOString().split("T")[0];
  const fileName = `QC_Kontrol_${orderName}_${date}.xlsx`;
  XLSX.writeFile(wb, fileName);
}

// ================== PALETLEME ==================
$("refreshPaletBtn")?.addEventListener("click", refreshPaletOrders);
$("openPaletBtn")?.addEventListener("click", openPaletOrder);
$("createPaletBtn")?.addEventListener("click", createPalet);
$("printPaletBtn")?.addEventListener("click", () => window.print());

async function refreshPaletOrders() {
  const sel = $("paletOrders");
  if (!sel) return;
  sel.innerHTML = "";
  const qs = await getDocs(query(collection(db, "orders"), where("status", "==", "Tamamlandı")));
  qs.forEach(d => {
    const o = { id: d.id, ...d.data() };
    const opt = document.createElement("option");
    opt.value = o.id;
    opt.textContent = `${o.id} - ${o.name}`;
    sel.appendChild(opt);
  });
}
async function openPaletOrder() {
  const id = $("paletOrders").value;
  if (!id) return;
  const ds = await getDoc(doc(db, "orders", id));
  if (!ds.exists()) return;
  paletOrder = { id: ds.id, ...ds.data() };
  renderPaletLines();
  $("paletTitle").textContent = `Sipariş: ${paletOrder.name}`;
  $("paletArea").classList.remove("hidden");
}
function renderPaletLines() {
  const tb = document.querySelector("#tbl-palet-lines tbody");
  if (!tb) return;
  tb.innerHTML = "";
  paletOrder.lines.forEach((l, i) => {
    tb.insertAdjacentHTML("beforeend", `<tr><td>${i + 1}</td><td>${l.code}</td><td>${l.name}</td><td>${l.qty}</td></tr>`);
  });
}
async function createPalet() {
  if (!paletOrder) return alert("Önce bir sipariş seçin.");
  const paletNo = "PLT-" + Date.now();
  await addDoc(collection(db, "pallets"), {
    id: paletNo, orderId: paletOrder.id, createdAt: serverTimestamp(), items: paletOrder.lines
  });
  $("paletNo").textContent = paletNo;
  $("paletResult").classList.remove("hidden");
  $("paletQr").innerHTML = "";
  if (window.QRCode) window.QRCode.toCanvas($("paletQr"), paletNo, { width: 128 });
  alert("Palet oluşturuldu: " + paletNo);
}

// ================== DASHBOARD ==================
$("dashboardWarehouse")?.addEventListener("change", loadDashboard);
async function loadDashboard() {
  const ordersSnap = await getDocs(collection(db, "orders"));
  const palletsSnap = await getDocs(collection(db, "pallets"));

  let total = 0, completed = 0, pending = 0;
  ordersSnap.forEach(docu => {
    total++;
    const st = docu.data().status;
    if (st === "Tamamlandı") completed++; else pending++;
  });

  if ($("statTotalOrders")) $("statTotalOrders").innerText = total;
  if ($("statCompletedOrders")) $("statCompletedOrders").innerText = completed;
  if ($("statPendingOrders")) $("statPendingOrders").innerText = pending;
  if ($("statPallets")) $("statPallets").innerText = palletsSnap.size;

  const ctx1 = document.getElementById("chartOrders");
  if (ctx1 && window.Chart) {
    new Chart(ctx1, {
      type: "pie",
      data: { labels: ["Tamamlanan", "Bekleyen"], datasets: [{ data: [completed, pending], backgroundColor: ["#16a34a", "#f87171"] }] }
    });
  }
  const ctx2 = document.getElementById("chartDaily");
  if (ctx2 && window.Chart) {
    new Chart(ctx2, {
      type: "bar",
      data: { labels: ["Gün1", "Gün2", "Gün3", "Gün4", "Gün5", "Gün6", "Gün7"], datasets: [{ label: "Sipariş", data: [3, 5, 2, 7, 4, 6, 3] }] }
    });
  }
}
// Dashboard auto-refresh (açıkken)
setInterval(() => {
  const v = document.getElementById("view-dashboard");
  if (v && !v.classList.contains("hidden")) loadDashboard();
}, 5000);

// ================== STOK YÖNETİMİ ==================
document.querySelector("button[data-view='view-stock']")?.addEventListener("click", loadStockManage);
$("stockWarehouse")?.addEventListener("change", loadStockManage);

async function loadStockManage() {
  const tbody = document.querySelector("#tbl-stock-manage tbody");
  if (!tbody) return;
  const selectedWh = $("stockWarehouse").value;
  const snap = await getDocs(collection(db, "stocks"));
  tbody.innerHTML = "";
  snap.forEach(docu => {
    const d = docu.data();
    if (d.warehouse === selectedWh) {
      tbody.insertAdjacentHTML("beforeend", `<tr><td>${d.code}</td><td>${d.name}</td><td>${d.qty}</td><td>${d.warehouse}</td></tr>`);
    }
  });
}
$("btnStockIn")?.addEventListener("click", async () => {
  const warehouse = $("stockWarehouse").value;
  const code = $("stockCode").value.trim();
  const name = $("stockName").value.trim();
  const qty = toNum($("stockQty").value);
  if (!code || !qty) return alert("Kod ve miktar gerekli!");
  const ref = doc(db, "stocks", `${warehouse}_${code}`);
  const snap = await getDoc(ref);
  if (snap.exists()) {
    await updateDoc(ref, { qty: (toNum(snap.data().qty) || 0) + qty, name: name || snap.data().name || "", warehouse });
  } else {
    await setDoc(ref, { code, name: name || code, qty, warehouse });
  }
  alert("Stok girişi yapıldı.");
  loadStockManage();
});
$("btnStockOut")?.addEventListener("click", async () => {
  const warehouse = $("stockWarehouse").value;
  const code = $("stockCode").value.trim();
  const qty = toNum($("stockQty").value);
  if (!code || !qty) return alert("Kod ve miktar gerekli!");
  const ref = doc(db, "stocks", `${warehouse}_${code}`);
  const snap = await getDoc(ref);
  if (snap.exists()) {
    let newQty = (toNum(snap.data().qty) || 0) - qty;
    if (newQty < 0) newQty = 0;
    await updateDoc(ref, { qty: newQty });
  } else {
    alert("Stok bulunamadı.");
  }
  alert("Stok çıkışı yapıldı.");
  loadStockManage();
});

// ================== BASİT SAYIM ==================
$("startCountScanBtn")?.addEventListener("click", startCountScanner);
$("stopCountScanBtn")?.addEventListener("click", stopCountScanner);
$("countManualAddBtn")?.addEventListener("click", countManualAdd);
$("saveCountSessionBtn")?.addEventListener("click", saveCountSession);
$("applyCountBtn")?.addEventListener("click", applyCountToStock);
$("newCountSessionBtn")?.addEventListener("click", () => { countSession = []; renderCountLines(); });
$("refreshCountSessionsBtn")?.addEventListener("click", loadLastCountSessions);

function renderCountLines() {
  const tb = document.querySelector("#tbl-count-lines tbody");
  if (!tb) return;
  tb.innerHTML = "";

  countSession.forEach((l, i) => {
    const sys = toNum(l.systemQty);
    const cnt = toNum(l.countQty);
    const diff = (cnt - sys);
    tb.insertAdjacentHTML("beforeend", `
      <tr data-row="${i}">
        <td>${i + 1}</td>
        <td>${l.code}</td>
        <td>${l.name || ""}</td>
        <td>${sys}</td>
        <td>
          <input type="number" inputmode="decimal" step="0.001" min="0"
                 class="count-input" data-idx="${i}" value="${cnt}" style="width:100px;text-align:center;"/>
        </td>
        <td>${diff}</td>
        <td><button class="pill" data-del="${i}">Sil</button></td>
      </tr>
    `);
  });

  tb.querySelectorAll(".count-input").forEach(inp => {
    inp.addEventListener("input", e => {
      const idx = Number(e.target.dataset.idx);
      countSession[idx].countQty = toNum(e.target.value);
    });
    inp.addEventListener("blur", e => {
      const idx = Number(e.target.dataset.idx);
      const row = tb.querySelector(`tr[data-row="${idx}"]`);
      const sys = toNum(countSession[idx].systemQty);
      const val = toNum(e.target.value);
      e.target.value = val;
      row.querySelectorAll("td")[5].textContent = (val - sys);
    });
    inp.addEventListener("keydown", e => { if (e.key === "Enter") e.target.blur(); });
  });

  tb.querySelectorAll("button[data-del]").forEach(btn => {
    btn.addEventListener("click", () => {
      const i = Number(btn.dataset.del);
      countSession.splice(i, 1);
      renderCountLines();
    });
  });
}
async function fetchProductAndStock(code, warehouse) {
  let name = "";
  try {
    const prodSnap = await getDoc(doc(db, "products", code));
    if (prodSnap.exists()) name = prodSnap.data().name || "";
  } catch {}
  const sref = doc(db, "stocks", `${warehouse}_${code}`);
  const ssnap = await getDoc(sref);
  const systemQty = ssnap.exists() ? toNum(ssnap.data().qty) : 0;
  return { name, systemQty };
}
async function pushCountLine(code, qty, warehouse) {
  const idx = countSession.findIndex(x => x.code === code);
  if (idx !== -1) {
    countSession[idx].countQty = toNum(countSession[idx].countQty) + toNum(qty);
  } else {
    const info = await fetchProductAndStock(code, warehouse);
    countSession.push({
      code, name: info.name, systemQty: info.systemQty, countQty: toNum(qty)
    });
  }
  renderCountLines();
}
async function startCountScanner() {
  if (countScanner) await stopCountScanner();
  countScanner = new Html5Qrcode("countReader");
  await countScanner.start({ facingMode: "environment" }, { fps: 10, qrbox: 250 }, async (code) => {
    await pushCountLine(code, 1, $("countWarehouse").value);
  });
}
function stopCountScanner() {
  if (!countScanner) return;
  return countScanner.stop().then(() => { countScanner.clear(); countScanner = null; });
}
async function countManualAdd() {
  const code = $("countManualCode").value.trim();
  let qty = toNum($("countManualQty").value);
  if (!code) return alert("Kod veya barkod girin!");
  if (!qty || qty < 0) qty = 0;
  await pushCountLine(code, qty, $("countWarehouse").value);
  $("countManualCode").value = "";
  $("countManualQty").value = "1";
}
async function saveCountSession() {
  if (countSession.length === 0) return alert("Sayım satırı yok!");
  await addDoc(collection(db, "counts"), {
    createdAt: serverTimestamp(),
    warehouse: $("countWarehouse").value,
    lines: countSession
  });
  alert("Sayım oturumu kaydedildi.");
}
async function applyCountToStock() {
  if (countSession.length === 0) return alert("Sayım satırı yok!");
  const wh = $("countWarehouse").value;
  for (const l of countSession) {
    const ref = doc(db, "stocks", `${wh}_${l.code}`);
    await setDoc(ref, { code: l.code, name: l.name || l.code, qty: toNum(l.countQty), warehouse: wh }, { merge: true });
  }
  alert("Sayım stoka uygulandı.");
}
async function loadLastCountSessions() {
  const tb = document.querySelector("#tbl-count-sessions tbody");
  if (!tb) return;
  tb.innerHTML = "";
  const qs = await getDocs(collection(db, "counts"));
  const rows = [];
  qs.forEach(d => {
    const data = d.data();
    const lines = data.lines || [];
    const totalDiff = lines.reduce((s, x) => s + (toNum(x.countQty) - toNum(x.systemQty)), 0);
    rows.push({
      date: (data.createdAt?.toDate ? data.createdAt.toDate() : new Date()).toLocaleString(),
      wh: data.warehouse || "-",
      cnt: lines.length,
      diff: totalDiff
    });
  });
  rows.sort((a,b) => (new Date(b.date)) - (new Date(a.date)));
  rows.slice(0, 20).forEach(r => {
    tb.insertAdjacentHTML("beforeend", `<tr><td>${r.date}</td><td>${r.wh}</td><td>${r.cnt}</td><td>${r.diff}</td></tr>`);
  });
}
