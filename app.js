// Menü Toggle (mobil)
document.getElementById("menuToggle")?.addEventListener("click", () => {
  document.getElementById("mainNav")?.classList.toggle("show");
});

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
let scanner = null;      // picker
let qcScanner = null;    // qc
let countScanner = null; // count
let orderDraft = [];     // şube sipariş satırları
let pickerOrder = null;
let qcOrder = null;
let paletOrder = null;
let countSession = [];   // sayım satırları

// ================== HELPERS ==================
const $ = (id) => document.getElementById(id);
const toNum = (v) => {
  if (v === "" || v == null) return 0;
  const n = parseFloat(String(v).replace(",", "."));
  return Number.isNaN(n) ? 0 : n;
};
const clamp = (v, min, max) => Math.min(Math.max(v, min), max);

// ================== VIEW DEĞİŞTİR ==================
function showView(id) {
  document.querySelectorAll(".view").forEach(v => v.classList.add("hidden"));
  document.getElementById(id).classList.remove("hidden");
}
document.querySelectorAll("nav button[data-view], section#view-manager button[data-view]").forEach(btn => {
  btn.addEventListener("click", () => showView(btn.dataset.view));
});

// ================== AUTH ==================
$("loginBtn")?.addEventListener("click", async () => {
  const email = $("login-email").value;
  const pass = $("login-pass").value;
  try {
    await signInWithEmailAndPassword(auth, email, pass);
  } catch (err) { alert("Giriş hatası: " + err.message); }
});

$("registerBtn")?.addEventListener("click", async () => {
  const email = $("reg-email").value;
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

$("logoutBtn")?.addEventListener("click", async () => { await signOut(auth); });

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    currentUser = null;
    $("logoutBtn")?.classList.add("hidden");
    document.querySelector("header nav").classList.add("hidden");
    showView("view-login");
    return;
  }

  currentUser = user;
  $("logoutBtn")?.classList.remove("hidden");
  const nav = document.querySelector("header nav");
  nav.classList.remove("hidden");

  // Kullanıcı rolünü al
  let role = "sube";
  try {
    const udoc = await getDoc(doc(db, "users", user.uid));
    if (udoc.exists() && udoc.data().role) role = udoc.data().role;
  } catch {}

  // Tüm butonları gizle
  nav.querySelectorAll("button[data-role]").forEach(btn => btn.classList.add("hidden"));

  // Role göre menüyü aç
  if (role === "sube") {
    nav.querySelectorAll("button[data-role='sube']").forEach(btn => btn.classList.remove("hidden"));
    showView("view-branch");
  } 
  else if (role === "yonetici") {
    nav.querySelectorAll("button[data-role='yonetici']").forEach(btn => btn.classList.remove("hidden"));
    showView("view-manager");
  } 
  else if (role === "toplayici") {
    nav.querySelectorAll("button[data-role='toplayici']").forEach(btn => btn.classList.remove("hidden"));
    showView("view-picker");
    refreshAssigned();
  } 
  else if (role === "qc") {
    nav.querySelectorAll("button[data-role='qc']").forEach(btn => btn.classList.remove("hidden"));
    showView("view-qc");
  } 
  else if (role === "palet") {
    nav.querySelectorAll("button[data-role='palet']").forEach(btn => btn.classList.remove("hidden"));
    showView("view-palet");
  } 
  else if (role === "admin") {
    nav.querySelectorAll("button[data-role]").forEach(btn => btn.classList.remove("hidden"));
    showView("view-dashboard");
  } 
  else {
    showView("view-branch");
  }
});


// ================== ÜRÜN KATALOĞU ==================
async function listProductsIntoTable() {
  const tb = document.querySelector("#tbl-products tbody");
  if (!tb) return;
  tb.innerHTML = "";

  const snap = await getDocs(collection(db, "products"));
  snap.forEach(d => {
    const p = d.data();
    tb.innerHTML += `
      <tr>
        <td>${p.code || ""}</td>
        <td>${p.name || ""}</td>
        <td>${p.barcode || ""}</td>
        <td>${p.reyon || ""}</td>
        <td>${p.unit || ""}</td>
        <td><button class="danger" data-del="${d.id}">Sil</button></td>
      </tr>
    `;
  });

  // Silme event'leri
  tb.querySelectorAll("button[data-del]").forEach(btn => {
    btn.addEventListener("click", async () => {
      if (!confirm("Bu ürünü silmek istediğinize emin misiniz?")) return;
      await deleteDoc(doc(db, "products", btn.dataset.del));
      alert("Ürün silindi!");
      await listProductsIntoTable();
    });
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
$("addProductBtn")?.addEventListener("click", async () => {
  const code = $("manualCode").value.trim();
  const name = $("manualName").value.trim();
  if (!code || !name) return alert("Kod ve ad zorunludur!");

  const data = {
    code,
    name,
    barcode: $("manualBarcode").value.trim() || "",
    reyon: $("manualReyon").value.trim() || "",
    unit: $("manualUnit").value.trim() || ""
  };

  await setDoc(doc(db, "products", code), data);
  alert("Ürün eklendi!");
  $("manualCode").value = "";
  $("manualName").value = "";
  $("manualBarcode").value = "";
  $("manualReyon").value = "";
  $("manualUnit").value = "";
  await listProductsIntoTable();
});

// ================== ŞUBE SİPARİŞ ==================
function renderOrderDraft() {
  const tb = document.querySelector("#tbl-branch-lines tbody");
  if (!tb) return;
  tb.innerHTML = "";
  orderDraft.forEach((l, i) => {
    tb.innerHTML += `<tr>
      <td>${i + 1}</td>
      <td>${l.code}</td>
      <td>${l.name}</td>
      <td>${l.qty}</td>
      <td>${l.barcode || ""}</td>
      <td>${l.reyon || ""}</td>
      <td><button class="danger" data-del="${i}">Sil</button></td>
    </tr>`;
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
    tbody.innerHTML += `<tr><td>${docu.id}</td><td>${d.name}</td><td>${d.warehouse || "-"}</td><td>${d.status}</td></tr>`;
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
  const qs = await getDocs(query(collection(db, "orders"), where("status", "in", ["Atandı", "Toplama Başladı"])));
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
  const table = document.getElementById("tbl-picker-lines");
  if (!table) return;

  // Tablo başlığı
  table.innerHTML = `
    <thead>
      <tr>
        <th>#</th>
        <th>Kod</th>
        <th>Ürün</th>
        <th>İstenen</th>
        <th>Reyon</th>
        <th>Toplanan</th>
        <th>Toplandı</th>
        <th>Eksik</th>
        <th>İşlem</th>
      </tr>
    </thead>
    <tbody></tbody>
  `;

  const tb = table.querySelector("tbody");
  tb.innerHTML = "";

  const paintRow = (tr, qty, picked) => {
    tr.classList.remove("not-picked", "partial-picked", "fully-picked", "over-picked");
    if (picked === 0) tr.classList.add("not-picked");
    else if (picked < qty) tr.classList.add("partial-picked");
    else if (picked === qty) tr.classList.add("fully-picked");
    else tr.classList.add("over-picked");
  };

  pickerOrder.lines.forEach((l, i) => {
    const qty = toNum(l.qty);
    const picked = toNum(l.picked);

   tb.insertAdjacentHTML("beforeend", `
  <tr data-row="${i}">
    <td data-label="#">${i + 1}</td>
    <td data-label="Kod">${l.code}</td>
    <td data-label="Ürün">${l.name || ""}</td>
    <td data-label="İstenen">${qty}</td>
    <td data-label="Reyon">${l.reyon || "-"}</td>
    <td data-label="Toplanan">
      <input type="number" inputmode="decimal" step="0.001" min="0"
             class="picked-input" data-idx="${i}" value="${picked}"
             style="width:80px;text-align:center;"/>
    </td>
    <td data-label="Toplandı" style="text-align:center;">
      <input type="checkbox" class="chk-picked" data-idx="${i}" ${picked >= qty ? "checked" : ""}/>
    </td>
    <td data-label="Eksik" style="text-align:center;">
      <input type="checkbox" class="chk-missing" data-idx="${i}" ${picked < qty ? "checked" : ""}/>
    </td>
    <td data-label="İşlem">
      <button class="pill" data-plus="${i}">+1</button>
      <button class="pill" data-minus="${i}">-1</button>
      <button class="pill danger" data-del="${i}">Sil</button>
    </td>
  </tr>
`);
  });

  // Renk boyama
  pickerOrder.lines.forEach((l, i) => {
    const tr = tb.querySelector(`tr[data-row="${i}"]`);
    paintRow(tr, toNum(l.qty), toNum(l.picked));
  });

  // Miktar girişi
  tb.querySelectorAll(".picked-input").forEach(inp => {
    inp.addEventListener("input", e => {
      const idx = Number(e.target.dataset.idx);
      pickerOrder.lines[idx].picked = toNum(e.target.value);
      const line = pickerOrder.lines[idx];
      const tr = tb.querySelector(`tr[data-row="${idx}"]`);
      paintRow(tr, toNum(line.qty), toNum(line.picked));
      tr.querySelector(".chk-picked").checked = line.picked >= line.qty;
      tr.querySelector(".chk-missing").checked = line.picked < line.qty;
    });
  });

  // +1 / -1 butonları
  tb.querySelectorAll("button[data-plus]").forEach(btn => {
    btn.addEventListener("click", () => {
      const idx = Number(btn.dataset.plus);
      const line = pickerOrder.lines[idx];
      line.picked = (toNum(line.picked) || 0) + 1; // fazla toplanabilir
      const tr = tb.querySelector(`tr[data-row='${idx}']`);
      tr.querySelector(".picked-input").value = line.picked;
      paintRow(tr, toNum(line.qty), toNum(line.picked));
      tr.querySelector(".chk-picked").checked = line.picked >= line.qty;
      tr.querySelector(".chk-missing").checked = line.picked < line.qty;
    });
  });

  tb.querySelectorAll("button[data-minus]").forEach(btn => {
    btn.addEventListener("click", () => {
      const idx = Number(btn.dataset.minus);
      const line = pickerOrder.lines[idx];
      line.picked = Math.max((toNum(line.picked) || 0) - 1, 0);
      const tr = tb.querySelector(`tr[data-row='${idx}']`);
      tr.querySelector(".picked-input").value = line.picked;
      paintRow(tr, toNum(line.qty), toNum(line.picked));
      tr.querySelector(".chk-picked").checked = line.picked >= line.qty;
      tr.querySelector(".chk-missing").checked = line.picked < line.qty;
    });
  });

  // Silme
  tb.querySelectorAll("button[data-del]").forEach(btn => {
    btn.addEventListener("click", () => {
      const i = Number(btn.dataset.del);
      if (confirm("Bu satırı silmek istiyor musunuz?")) {
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
    qty = parseFloat((v || "1").replace(",", ".")); // ondalık destek
    if (!qty || qty < 0) qty = 0;
  }
  let idx = pickerOrder.lines.findIndex(l => (l.barcode && l.barcode === codeOrBarcode) || l.code === codeOrBarcode);
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

// ================== YÖNETİCİ ==================
$("refreshOrdersBtn")?.addEventListener("click", loadAllOrders);
async function loadAllOrders() {
  const snap = await getDocs(collection(db, "orders"));
  const tbody = document.querySelector("#tbl-orders tbody");
  if (!tbody) return;
  tbody.innerHTML = "";

  snap.forEach(docu => {
    const o = { id: docu.id, ...docu.data() };

    // Durum rengi
    const colorMap = {
      "Yeni": "#3b82f6",
      "Atandı": "#f59e0b",
      "Toplama Başladı": "#eab308",
      "Toplandı": "#10b981",
      "Kontrol": "#a855f7",
      "Kontrol Başladı": "#9333ea",
      "Tamamlandı": "#16a34a"
    };
    const color = colorMap[o.status] || "#ccc";

    tbody.innerHTML += `
      <tr>
        <td>${o.id}</td>
        <td>${o.name || "-"}</td>
        <td>${o.warehouse || "-"}</td>
        <td><span style="color:${color};font-weight:bold;">${o.status}</span></td>
        <td>
          <button onclick="viewOrderDetails('${o.id}')">Aç</button>
          ${o.status === "Yeni" ? `<button onclick="assignOrder('${o.id}')">Toplayıcıya Ata</button>` : ""}
          ${o.status === "Toplandı" ? `<button onclick="sendToQC('${o.id}')">Kontrole Gönder</button>` : ""}
        </td>
      </tr>`;
  });
}

window.assignOrder = async function(id) {
  await updateDoc(doc(db, "orders", id), { status: "Atandı" });
  loadAllOrders();
};
window.sendToQC = async function(id) {
  await updateDoc(doc(db, "orders", id), { status: "Kontrol" });
  loadAllOrders();
};
window.viewOrderDetails = async function(id) {
  const ref = doc(db, "orders", id);
  const snap = await getDoc(ref);
  if (!snap.exists()) return alert("Sipariş bulunamadı!");

  const d = snap.data();
  let html = `
    <h3>Sipariş: <b>${d.name || "(İsimsiz)"}</b></h3>
    <p><b>Depo:</b> ${d.warehouse || "-"}<br>
       <b>Durum:</b> ${d.status}<br>
       <b>Oluşturan:</b> ${d.createdBy || "-"}<br>
       <b>Tarih:</b> ${(d.createdAt?.toDate?.() || new Date()).toLocaleString()}</p>
    <table style="width:100%;border-collapse:collapse;margin-top:10px;">
      <thead>
        <tr style="background:#222;color:#fff;">
          <th style="padding:5px;">Kod</th>
          <th style="padding:5px;">Ürün</th>
          <th style="padding:5px;">İstenen</th>
          <th style="padding:5px;">Toplanan</th>
          <th style="padding:5px;">QC</th>
          <th style="padding:5px;">Reyon</th>
        </tr>
      </thead>
      <tbody>
  `;
  (d.lines || []).forEach(l => {
    html += `
      <tr style="background:#111;color:#ddd;">
        <td style="padding:5px;">${l.code}</td>
        <td style="padding:5px;">${l.name}</td>
        <td style="padding:5px;text-align:center;">${l.qty}</td>
        <td style="padding:5px;text-align:center;">${l.picked ?? "-"}</td>
        <td style="padding:5px;text-align:center;">${l.qc ?? "-"}</td>
        <td style="padding:5px;text-align:center;">${l.reyon || "-"}</td>
      </tr>
    `;
  });
  html += `</tbody></table>`;

  // Basit popup (modal)
  const modal = document.createElement("div");
  modal.classList.add("modal-overlay");
  modal.style = `
    position: fixed; top: 0; left: 0; width: 100%; height: 100%;
    background: rgba(0,0,0,0.75); display: flex; align-items: center; justify-content: center;
    z-index: 9999; padding:20px;
  `;
  modal.innerHTML = `
    <div style="background:#1e1e2e;color:#fff;padding:20px;border-radius:12px;max-width:700px;width:100%;max-height:80%;overflow:auto;">
      ${html}
      <div style="text-align:right;margin-top:15px;">
       <button onclick="this.closest('.modal-overlay').remove()">Kapat</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
};

// ================== QC (KONTROL) ==================
console.log("✅ QC Modülü Yüklendi");
// Butonlar
$("refreshQCBtn")?.addEventListener("click", refreshQCOrders);
$("openQCBtn")?.addEventListener("click", openQCOrder);
$("startQCScanBtn")?.addEventListener("click", startQCScanner);
$("stopQCScanBtn")?.addEventListener("click", stopQCScanner);
$("finishQCBtn")?.addEventListener("click", finishQC);
$("saveQCBtn")?.addEventListener("click", saveQCProgress);

async function refreshQCOrders() {
  const sel = $("qcOrders");
  if (!sel) return;
  sel.innerHTML = "";
  const qs = await getDocs(query(collection(db, "orders"), where("status", "in", ["Kontrol", "Kontrol Başladı"])));
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
  qcOrder.lines = (qcOrder.lines || []).map(l => ({ ...l, qc: toNum(l.qc) || 0, picked: toNum(l.picked) || 0, qty: toNum(l.qty) || 0 }));
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
          <input
            type="number" inputmode="decimal" step="0.001" min="0" max="${picked}"
            class="qc-input" data-idx="${i}" value="${qc}"
            style="width:100px;text-align:center;"
          />
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

  // INPUT serbest yazım + blur normalize
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
      // diff hücresini güncelle
      tr.querySelectorAll("td")[6].textContent = Math.max(0, picked - val);
    });
    inp.addEventListener("keydown", e => { if (e.key === "Enter") e.target.blur(); });
  });

  // +1 / -1
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
  // inputu güncelle
  const tb = document.querySelector("#tbl-qc-lines tbody");
  const tr = tb?.querySelector(`tr[data-row="${idx}"]`);
  if (tr) {
    const inp = tr.querySelector(".qc-input");
    inp.value = qcOrder.lines[idx].qc;
    inp.dispatchEvent(new Event("blur", { bubbles: true })); // normalize & boya
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
// ================== QC EXCEL'E AKTAR ==================
$("exportQCExcelBtn")?.addEventListener("click", exportQCToExcel);

async function exportQCToExcel() {
  if (!qcOrder) return alert("Önce bir sipariş açın!");
  const data = (qcOrder.lines || []).map((l, i) => ({
    "#": i + 1,
    Kod: l.code || "",
    Ürün: l.name || "",
    İstenen: toNum(l.qty),
    Toplanan: toNum(l.picked),
    "QC (Kontrol)": toNum(l.qc),
    Eksik: Math.max(0, toNum(l.picked) - toNum(l.qc)),
    Reyon: l.reyon || "-"
  }));

  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "QC_Kontrol");
  const fileName = `QC_${qcOrder.name || "kontrol"}.xlsx`;
  XLSX.writeFile(wb, fileName);

  alert("Excel dosyası oluşturuldu: " + fileName);
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
    tb.innerHTML += `<tr><td>${i + 1}</td><td>${l.code}</td><td>${l.name}</td><td>${l.qty}</td></tr>`;
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
  $("statTotalOrders").innerText = total;
  $("statCompletedOrders").innerText = completed;
  $("statPendingOrders").innerText = pending;
  $("statPallets") && ( $("statPallets").innerText = palletsSnap.size );

  const ctx1 = document.getElementById("chartOrders");
  if (ctx1) {
    new Chart(ctx1, {
      type: "pie",
      data: { labels: ["Tamamlanan", "Bekleyen"], datasets: [{ data: [completed, pending], backgroundColor: ["#16a34a", "#f87171"] }] }
    });
  }
  const ctx2 = document.getElementById("chartDaily");
  if (ctx2) {
    new Chart(ctx2, {
      type: "bar",
      data: { labels: ["Gün1", "Gün2", "Gün3", "Gün4", "Gün5", "Gün6", "Gün7"], datasets: [{ label: "Sipariş", data: [3, 5, 2, 7, 4, 6, 3] }] }
    });
  }
}
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
      tbody.innerHTML += `<tr><td>${d.code}</td><td>${d.name}</td><td>${d.qty}</td><td>${d.warehouse}</td></tr>`;
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

// ================== BASİT SAYIM (Cycle Count) ==================
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

  // input & sil
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
  // ürün adı
  let name = "";
  try {
    const prodSnap = await getDoc(doc(db, "products", code));
    if (prodSnap.exists()) name = prodSnap.data().name || "";
  } catch {}
  // stok
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
    // doğrudan sayım miktarını stok olarak yaz
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
