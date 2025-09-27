// ================= FIREBASE IMPORT =================
import { 
  auth, db,
  signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged,
  collection, doc, setDoc, getDoc, getDocs, updateDoc, addDoc,
  query, where, serverTimestamp
} from "./firebase.js";

// Excel (SheetJS)
import * as XLSX from "https://cdn.sheetjs.com/xlsx-0.19.3/package/xlsx.mjs";

// ================== GLOBAL ==================
let currentUser = null;
let scanner = null;
let qcScanner = null;

// Şube sipariş taslağı
let orderDraft = []; // {code, name, qty, barcode?, reyon?}

// ================== VIEW DEĞİŞTİR ==================
function showView(id) {
  document.querySelectorAll(".view").forEach(v => v.classList.add("hidden"));
  document.getElementById(id).classList.remove("hidden");
}
document.querySelectorAll("nav button[data-view]").forEach(btn => {
  btn.addEventListener("click", () => showView(btn.dataset.view));
});

// ================== AUTH ==================
document.getElementById("loginBtn").addEventListener("click", async () => {
  const email = document.getElementById("login-email").value;
  const pass = document.getElementById("login-pass").value;
  try {
    await signInWithEmailAndPassword(auth, email, pass);
  } catch (err) {
    alert("Giriş hatası: " + err.message);
  }
});

document.getElementById("registerBtn").addEventListener("click", async () => {
  const email = document.getElementById("reg-email").value;
  const pass = document.getElementById("reg-pass").value;
  const role = document.getElementById("reg-role").value;
  try {
    const userCred = await createUserWithEmailAndPassword(auth, email, pass);
    await setDoc(doc(db, "users", userCred.user.uid), { email, role });
    alert("Kayıt başarılı!");
  } catch (err) {
    alert("Kayıt hatası: " + err.message);
  }
});

document.getElementById("logoutBtn").addEventListener("click", async () => {
  await signOut(auth);
});

onAuthStateChanged(auth, async (user) => {
  if (user) {
    currentUser = user;
    const udoc = await getDoc(doc(db, "users", user.uid));
    const role = udoc.exists() ? udoc.data().role : "sube";
    document.getElementById("logoutBtn").classList.remove("hidden");

    // Varsayılan açılacak görünüm rolüne göre
    if (role === "sube") showView("view-branch");
    else if (role === "yonetici") showView("view-manager");
    else if (role === "toplayici") showView("view-picker");
    else if (role === "qc") showView("view-qc");
    else if (role === "palet") showView("view-palet");
    else if (role === "admin") showView("view-products");
    else showView("view-login");

    // Ürün select’ini her girişte tazele
    await refreshBranchProductSelect();
  } else {
    currentUser = null;
    document.getElementById("logoutBtn").classList.add("hidden");
    showView("view-login");
  }
});

// ================== ÜRÜN KATALOĞU (Excel, Listeleme) ==================
async function listProductsIntoTable() {
  const tb = document.querySelector("#tbl-products tbody");
  if (!tb) return;
  tb.innerHTML = "";
  const snap = await getDocs(collection(db, "products"));
  snap.forEach(d => {
    const p = d.data();
    tb.innerHTML += `<tr>
      <td>${p.code || ""}</td>
      <td>${p.name || ""}</td>
      <td>${p.barcode || ""}</td>
      <td>${p.reyon || ""}</td>
    </tr>`;
  });
}

async function refreshBranchProductSelect() {
  const sel = document.getElementById("branchProduct");
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

document.getElementById("uploadProductsBtn").addEventListener("click", async () => {
  const file = document.getElementById("excelProducts").files?.[0];
  if (!file) return alert("Excel dosyası seç!");
  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      const wb = XLSX.read(new Uint8Array(e.target.result), { type: "array" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json(sheet); // [{code,name,barcode?,reyon?}, ...]

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
    } catch (err) {
      alert("Excel okuma hatası: " + err.message);
    }
  };
  reader.readAsArrayBuffer(file);
});

// Ürünler görünümü açıldığında listeyi yükle
document.querySelector("button[data-view='view-products']").addEventListener("click", async () => {
  await listProductsIntoTable();
});

// ================== ŞUBE: Sipariş Taslağı ==================
function renderOrderDraft() {
  const tb = document.querySelector("#tbl-branch-lines tbody");
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
  // Sil butonları
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

document.getElementById("addLineBtn").addEventListener("click", () => {
  const sel = document.getElementById("branchProduct");
  const qty = parseInt(document.getElementById("branchQty").value, 10) || 0;
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
  // aynı koddaysa birleştir
  const existing = orderDraft.find(x => x.code === line.code);
  if (existing) existing.qty += qty;
  else orderDraft.push(line);
  renderOrderDraft();
});

document.getElementById("createOrderBtn").addEventListener("click", async () => {
  const name = document.getElementById("orderName").value.trim();
  if (!name) return alert("Sipariş adı gir!");
  if (orderDraft.length === 0) return alert("Sipariş satırı ekleyin!");

  await addDoc(collection(db, "orders"), {
    name,
    status: "Yeni",
    createdBy: currentUser.uid,
    createdAt: serverTimestamp(),
    lines: orderDraft.map(l => ({
      code: l.code, name: l.name, qty: l.qty, barcode: l.barcode || "", reyon: l.reyon || "", picked: 0, qc: 0
    }))
  });
  alert("Sipariş oluşturuldu!");
  orderDraft = [];
  renderOrderDraft();
  document.getElementById("orderName").value = "";
  await loadBranchOrders();
});

async function loadBranchOrders() {
  const q = query(collection(db, "orders"), where("createdBy", "==", currentUser.uid));
  const snap = await getDocs(q);
  const tbody = document.querySelector("#branchOrders tbody");
  tbody.innerHTML = "";
  snap.forEach(docu => {
    const d = docu.data();
    tbody.innerHTML += `<tr><td>${docu.id}</td><td>${d.name}</td><td>${d.status}</td></tr>`;
  });
}
document.querySelector("button[data-view='view-branch']").addEventListener("click", async () => {
  await refreshBranchProductSelect();
  await loadBranchOrders();
});

// ================== YÖNETİCİ ==================
document.getElementById("refreshOrdersBtn").addEventListener("click", loadAllOrders);

async function loadAllOrders() {
  const snap = await getDocs(collection(db, "orders"));
  const tbody = document.querySelector("#tbl-orders tbody");
  tbody.innerHTML = "";
  snap.forEach(docu => {
    const o = { id: docu.id, ...docu.data() };
    tbody.innerHTML += `
      <tr>
        <td>${o.id}</td><td>${o.name}</td><td>${o.status}</td>
        <td>
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

// ================== TOPLAYICI ==================
document.getElementById("refreshAssignedBtn").addEventListener("click", refreshAssigned);
document.getElementById("openAssignedBtn").addEventListener("click", openAssigned);
document.getElementById("startScanBtn").addEventListener("click", startPickerScanner);
document.getElementById("stopScanBtn").addEventListener("click", stopPickerScanner);
document.getElementById("finishPickBtn").addEventListener("click", finishPick);

let pickerOrder = null;

async function refreshAssigned() {
  const sel = document.getElementById("assignedOrders");
  sel.innerHTML = "";
  const qs = await getDocs(query(collection(db, "orders"), where("status", "==", "Atandı")));
  qs.forEach(d => {
    const o = { id: d.id, ...d.data() };
    const opt = document.createElement("option");
    opt.value = o.id;
    opt.textContent = `${o.id} - ${o.name}`;
    sel.appendChild(opt);
  });
}

async function openAssigned() {
  const id = document.getElementById("assignedOrders").value;
  if (!id) return;
  const ds = await getDoc(doc(db, "orders", id));
  if (!ds.exists()) return;
  pickerOrder = { id: ds.id, ...ds.data() };
  pickerOrder.lines = pickerOrder.lines.map(l => ({ ...l, picked: l.picked || 0 }));
  renderPickerLines();
  document.getElementById("pickerTitle").textContent = `Sipariş: ${pickerOrder.name}`;
  document.getElementById("pickerArea").classList.remove("hidden");
}

function renderPickerLines() {
  const tb = document.querySelector("#tbl-picker-lines tbody");
  tb.innerHTML = "";
  pickerOrder.lines.forEach((l, i) => {
    tb.innerHTML += `
      <tr>
        <td>${i + 1}</td>
        <td>${l.code}</td>
        <td>${l.name}</td>
        <td>${l.qty}</td>
        <td>${l.picked}</td>
      </tr>`;
  });
}

async function startPickerScanner() {
  if (scanner) await stopPickerScanner();
  scanner = new Html5Qrcode("reader");
  await scanner.start({ facingMode: "environment" }, { fps: 10, qrbox: 250 }, onPickerScan);
}
function stopPickerScanner() {
  if (!scanner) return;
  return scanner.stop().then(() => { scanner.clear(); scanner = null; });
}

function onPickerScan(code) {
  const idx = pickerOrder.lines.findIndex(l => (l.barcode && l.barcode === code) || l.code === code);
  if (idx === -1) {
    alert("Barkod/Kod bulunamadı: " + code);
    return;
  }
  // ürün bulundu → picked++
  pickerOrder.lines[idx].picked = (pickerOrder.lines[idx].picked || 0) + 1;
  renderPickerLines();
}

async function finishPick() {
  // stoktan düş
  for (const l of pickerOrder.lines) {
    const used = Math.min(l.picked || 0, l.qty || 0);
    if (used > 0) await decreaseStock(l.code, used);
  }
  await updateDoc(doc(db, "orders", pickerOrder.id), {
    lines: pickerOrder.lines,
    status: "Toplandı"
  });
  alert("Toplama tamamlandı ve stok güncellendi!");
}

// stok azaltma
async function decreaseStock(code, qty) {
  const ref = doc(db, "stocks", code);
  const snap = await getDoc(ref);
  if (snap.exists()) {
    let newQty = (snap.data().qty || 0) - qty;
    if (newQty < 0) newQty = 0;
    await updateDoc(ref, { qty: newQty });
    if (newQty < 5) alert(`⚠️ Dikkat! ${code} stoğu kritik seviyede (${newQty})`);
  } else {
    alert(`Stok bulunamadı: ${code}`);
  }
}

// ================== QC ==================
document.getElementById("refreshQCBtn").addEventListener("click", refreshQCOrders);
document.getElementById("openQCBtn").addEventListener("click", openQCOrder);
document.getElementById("startQCScanBtn").addEventListener("click", startQCScanner);
document.getElementById("stopQCScanBtn").addEventListener("click", stopQCScanner);
document.getElementById("finishQCBtn").addEventListener("click", finishQC);

let qcOrder = null;

async function refreshQCOrders() {
  const sel = document.getElementById("qcOrders");
  sel.innerHTML = "";
  const qs = await getDocs(query(collection(db, "orders"), where("status", "==", "Kontrol")));
  qs.forEach(d => {
    const o = { id: d.id, ...d.data() };
    const opt = document.createElement("option");
    opt.value = o.id;
    opt.textContent = `${o.id} - ${o.name}`;
    sel.appendChild(opt);
  });
}

async function openQCOrder() {
  const id = document.getElementById("qcOrders").value;
  if (!id) return;
  const ds = await getDoc(doc(db, "orders", id));
  if (!ds.exists()) return;
  qcOrder = { id: ds.id, ...ds.data() };
  qcOrder.lines = qcOrder.lines.map(l => ({ ...l, qc: l.qc || 0 }));
  renderQCLines();
  document.getElementById("qcTitle").textContent = `Sipariş: ${qcOrder.name}`;
  document.getElementById("qcArea").classList.remove("hidden");
}

function renderQCLines() {
  const tb = document.querySelector("#tbl-qc-lines tbody");
  tb.innerHTML = "";
  qcOrder.lines.forEach((l, i) => {
    tb.innerHTML += `
      <tr>
        <td>${i + 1}</td>
        <td>${l.code}</td>
        <td>${l.name}</td>
        <td>${l.qty}</td>
        <td>${l.picked || 0}</td>
        <td>${l.qc}</td>
        <td>${Math.max(0, (l.picked || 0) - l.qc)}</td>
      </tr>`;
  });
}

async function startQCScanner() {
  if (qcScanner) await stopQCScanner();
  qcScanner = new Html5Qrcode("qcReader");
  await qcScanner.start({ facingMode: "environment" }, { fps: 10, qrbox: 250 }, onQCScan);
}
function stopQCScanner() {
  if (!qcScanner) return;
  return qcScanner.stop().then(() => { qcScanner.clear(); qcScanner = null; });
}
function onQCScan(code) {
  const idx = qcOrder.lines.findIndex(l => (l.barcode && l.barcode === code) || l.code === code);
  if (idx === -1) {
    alert("Barkod yok: " + code);
    return;
  }
  qcOrder.lines[idx].qc = (qcOrder.lines[idx].qc || 0) + 1;
  renderQCLines();
}

async function finishQC() {
  await updateDoc(doc(db, "orders", qcOrder.id), {
    lines: qcOrder.lines,
    status: "Tamamlandı"
  });
  alert("QC tamamlandı!");
}

// ================== PALET ==================
document.getElementById("refreshPaletBtn").addEventListener("click", refreshPaletOrders);
document.getElementById("openPaletBtn").addEventListener("click", openPaletOrder);
document.getElementById("createPaletBtn").addEventListener("click", createPalet);
document.getElementById("printPaletBtn")?.addEventListener("click", () => window.print());

let paletOrder = null;

async function refreshPaletOrders() {
  const sel = document.getElementById("paletOrders");
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
  const id = document.getElementById("paletOrders").value;
  if (!id) return;
  const ds = await getDoc(doc(db, "orders", id));
  if (!ds.exists()) return;
  paletOrder = { id: ds.id, ...ds.data() };
  renderPaletLines();
  document.getElementById("paletTitle").textContent = `Sipariş: ${paletOrder.name}`;
  document.getElementById("paletArea").classList.remove("hidden");
}

function renderPaletLines() {
  const tb = document.querySelector("#tbl-palet-lines tbody");
  tb.innerHTML = "";
  paletOrder.lines.forEach((l, i) => {
    tb.innerHTML += `<tr><td>${i + 1}</td><td>${l.code}</td><td>${l.name}</td><td>${l.qty}</td></tr>`;
  });
}

async function createPalet() {
  const paletNo = "PLT-" + Date.now();
  await addDoc(collection(db, "pallets"), {
    id: paletNo,
    orderId: paletOrder.id,
    createdAt: serverTimestamp(),
    items: paletOrder.lines
  });
  document.getElementById("paletNo").textContent = paletNo;
  document.getElementById("paletResult").classList.remove("hidden");
  document.getElementById("paletQr").innerHTML = "";
  QRCode.toCanvas(document.getElementById("paletQr"), paletNo, { width: 128 }, (err) => {
    if (err) console.error(err);
  });
  alert("Palet oluşturuldu: " + paletNo);
}

// ================== DASHBOARD ==================
async function loadStocksTable() {
  const tb = document.querySelector("#tbl-stocks tbody");
  if (!tb) return;
  const snap = await getDocs(collection(db, "stocks"));
  tb.innerHTML = "";
  snap.forEach(docu => {
    const d = docu.data();
    tb.innerHTML += `<tr><td>${d.code}</td><td>${d.name}</td><td>${d.qty}</td></tr>`;
  });
}

async function loadDashboard() {
  const ordersSnap = await getDocs(collection(db, "orders"));
  const palletsSnap = await getDocs(collection(db, "pallets"));

  let total=0, completed=0, pending=0;
  ordersSnap.forEach(docu=>{
    total++;
    const st=docu.data().status;
    if(st==="Tamamlandı") completed++;
    else pending++;
  });

  document.getElementById("statTotalOrders").textContent = total;
  document.getElementById("statCompletedOrders").textContent = completed;
  document.getElementById("statPendingOrders").textContent = pending;
  document.getElementById("statPallets").textContent = palletsSnap.size;

  const ctx1 = document.getElementById("chartOrders");
  if (ctx1) {
    new Chart(ctx1,{ type:"pie",
      data:{ labels:["Tamamlanan","Bekleyen"],
        datasets:[{ data:[completed,pending], backgroundColor:["#16a34a","#f87171"] }]}
    });
  }
  const ctx2 = document.getElementById("chartDaily");
  if (ctx2) {
    new Chart(ctx2,{ type:"bar",
      data:{ labels:["Gün1","Gün2","Gün3","Gün4","Gün5","Gün6","Gün7"],
        datasets:[{ label:"Sipariş", data:[3,5,2,7,4,6,3] }]}
    });
  }
  await loadStocksTable();
}
setInterval(()=>{
  const v=document.getElementById("view-dashboard");
  if(v && !v.classList.contains("hidden")) loadDashboard();
},5000);

// ================== STOK YÖNETİMİ (manuel) ==================
async function loadStockManage() {
  const tbody = document.querySelector("#tbl-stock-manage tbody");
  if (!tbody) return;
  const snap = await getDocs(collection(db, "stocks"));
  tbody.innerHTML = "";
  snap.forEach(docu => {
    const d = docu.data();
    tbody.innerHTML += `<tr><td>${d.code}</td><td>${d.name}</td><td>${d.qty}</td></tr>`;
  });
}
document.querySelector("button[data-view='view-stock']").addEventListener("click", loadStockManage);

document.getElementById("btnStockIn").addEventListener("click", async () => {
  const code = document.getElementById("stockCode").value.trim();
  const name = document.getElementById("stockName").value.trim();
  const qty  = parseInt(document.getElementById("stockQty").value,10);
  if (!code || !qty) return alert("Kod ve miktar gerekli!");
  const ref = doc(db, "stocks", code);
  const snap = await getDoc(ref);
  if (snap.exists()) {
    await updateDoc(ref, { qty: (snap.data().qty || 0) + qty, name: name || snap.data().name || "" });
  } else {
    await setDoc(ref, { code, name: name || code, qty });
  }
  alert("Stok girişi yapıldı.");
  loadStockManage();
});

document.getElementById("btnStockOut").addEventListener("click", async () => {
  const code = document.getElementById("stockCode").value.trim();
  const qty  = parseInt(document.getElementById("stockQty").value,10);
  if (!code || !qty) return alert("Kod ve miktar gerekli!");
  const ref = doc(db, "stocks", code);
  const snap = await getDoc(ref);
  if (snap.exists()) {
    let newQty = (snap.data().qty || 0) - qty;
    if (newQty < 0) newQty = 0;
    await updateDoc(ref, { qty: newQty });
    if (newQty < 5) alert(`⚠️ Dikkat! ${code} stoğu kritik seviyede (${newQty})`);
  } else {
    alert("Stok bulunamadı.");
  }
  alert("Stok çıkışı yapıldı.");
  loadStockManage();
});
