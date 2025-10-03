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

// Excel (SheetJS) – ürün kataloğu yükleme için
import * as XLSX from "https://cdn.sheetjs.com/xlsx-0.19.3/package/xlsx.mjs";

// ================== GLOBAL ==================
let currentUser = null;
let scanner = null;
let qcScanner = null;
let orderDraft = []; // şube sipariş satırları
let pickerOrder = null;
let qcOrder = null;
let paletOrder = null;

// ================== VIEW DEĞİŞTİR ==================
function showView(id) {
  document.querySelectorAll(".view").forEach(v => v.classList.add("hidden"));
  document.getElementById(id).classList.remove("hidden");
}
document.querySelectorAll("nav button[data-view]").forEach(btn => {
  btn.addEventListener("click", () => showView(btn.dataset.view));
});

// ================== AUTH ==================
document.getElementById("loginBtn")?.addEventListener("click", async () => {
  const email = document.getElementById("login-email").value;
  const pass = document.getElementById("login-pass").value;
  try {
    await signInWithEmailAndPassword(auth, email, pass);
  } catch (err) {
    alert("Giriş hatası: " + err.message);
  }
});

document.getElementById("registerBtn")?.addEventListener("click", async () => {
  const email = document.getElementById("reg-email").value;
  const pass = document.getElementById("reg-pass").value;
  const role = document.getElementById("reg-role").value;
  try {
    const userCred = await createUserWithEmailAndPassword(auth, email, pass);
    const uid = userCred.user.uid;
    await setDoc(doc(db, "users", uid), {
      email,
      role,
      createdAt: new Date()
    });
    alert("Kayıt başarılı!");
  } catch (err) {
    alert("Kayıt hatası: " + err.message);
  }
});

document.getElementById("logoutBtn")?.addEventListener("click", async () => {
  await signOut(auth);
});

onAuthStateChanged(auth, async (user) => {
  if (user) {
    currentUser = user;
    const udoc = await getDoc(doc(db, "users", user.uid));
    const role = udoc.exists() ? udoc.data().role : "sube";
    document.getElementById("logoutBtn").classList.remove("hidden");

    if (role === "sube") showView("view-branch");
    else if (role === "yonetici") showView("view-manager");
    else if (role === "toplayici") showView("view-picker");
    else if (role === "qc") showView("view-qc");
    else if (role === "palet") showView("view-palet");
    else if (role === "admin") showView("view-products");
    else showView("view-login");

    await refreshBranchProductSelect();
  } else {
    currentUser = null;
    document.getElementById("logoutBtn").classList.add("hidden");
    showView("view-login");
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

document.getElementById("uploadProductsBtn")?.addEventListener("click", async () => {
  const file = document.getElementById("excelProducts").files?.[0];
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
    } catch (err) {
      alert("Excel okuma hatası: " + err.message);
    }
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

document.getElementById("addLineBtn")?.addEventListener("click", () => {
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
  const existing = orderDraft.find(x => x.code === line.code);
  if (existing) existing.qty += qty;
  else orderDraft.push(line);
  renderOrderDraft();
});

document.getElementById("createOrderBtn")?.addEventListener("click", async () => {
  const name = document.getElementById("orderName").value.trim();
  const warehouse = document.getElementById("branchWarehouse").value;
  if (!name) return alert("Sipariş adı gir!");
  if (orderDraft.length === 0) return alert("Sipariş satırı ekleyin!");

  await addDoc(collection(db, "orders"), {
    name,
    warehouse,
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
    let newQty = (snap.data().qty || 0) - qty;
    if (newQty < 0) newQty = 0;
    await updateDoc(ref, { qty: newQty });
    if (newQty < 5) alert(`⚠️ Dikkat! ${warehouse}/${code} stoğu kritik (${newQty})`);
  } else {
    alert(`Stok bulunamadı: ${warehouse} - ${code}`);
  }
}

// ================== TOPLAYICI ==================
document.getElementById("refreshAssignedBtn")?.addEventListener("click", refreshAssigned);
document.getElementById("openAssignedBtn")?.addEventListener("click", openAssigned);
document.getElementById("startScanBtn")?.addEventListener("click", startPickerScanner);
document.getElementById("stopScanBtn")?.addEventListener("click", stopPickerScanner);
document.getElementById("finishPickBtn")?.addEventListener("click", finishPick);

async function refreshAssigned() {
  const sel = document.getElementById("assignedOrders");
  if (!sel) return;
  sel.innerHTML = "";
  const qs = await getDocs(query(collection(db, "orders"), where("status", "==", "Atandı")));
  qs.forEach(d => {
    const o = { id: d.id, ...d.data() };
    const opt = document.createElement("option");
    opt.value = o.id;
    opt.textContent = `${o.id} - ${o.name} (${o.warehouse || "-"})`;
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
  document.getElementById("pickerTitle").textContent = `Sipariş: ${pickerOrder.name} (${pickerOrder.warehouse})`;
  document.getElementById("pickerArea").classList.remove("hidden");
}

function renderPickerLines() {
  const tb = document.querySelector("#tbl-picker-lines tbody");
  if (!tb) return;
  tb.innerHTML = "";
  pickerOrder.lines.forEach((l, i) => {
    tb.innerHTML += `
      <tr>
        <td>${i + 1}</td>
        <td>${l.code}</td>
        <td>${l.name}</td>
        <td>${l.qty}</td>
        <td>
          <input type="number" min="0" class="picked-input" data-idx="${i}" value="${l.picked || 0}"/>
        </td>
        <td>
          <button class="pill" data-plus="${i}">+1</button>
          <button class="pill" data-minus="${i}">-1</button>
          <button class="pill" data-del="${i}">Sil</button>
        </td>
      </tr>`;
  });

  // input değişikliği
  tb.querySelectorAll(".picked-input").forEach(inp => {
    inp.addEventListener("input", e => {
      const idx = parseInt(e.target.dataset.idx, 10);
      let v = parseInt(e.target.value, 10);
      if (isNaN(v) || v < 0) v = 0;
      pickerOrder.lines[idx].picked = v;
    });
  });

  // +1 / -1 / Sil
  tb.querySelectorAll("button[data-plus]").forEach(btn => {
    btn.addEventListener("click", () => {
      const i = parseInt(btn.dataset.plus, 10);
      pickerOrder.lines[i].picked = (pickerOrder.lines[i].picked || 0) + 1;
      renderPickerLines();
    });
  });
  tb.querySelectorAll("button[data-minus]").forEach(btn => {
    btn.addEventListener("click", () => {
      const i = parseInt(btn.dataset.minus, 10);
      let v = (pickerOrder.lines[i].picked || 0) - 1;
      if (v < 0) v = 0;
      pickerOrder.lines[i].picked = v;
      renderPickerLines();
    });
  });
  tb.querySelectorAll("button[data-del]").forEach(btn => {
    btn.addEventListener("click", () => {
      const i = parseInt(btn.dataset.del, 10);
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
    qty = parseInt(v || "1", 10);
    if (!qty || qty < 1) qty = 1;
  }
  let idx = pickerOrder.lines.findIndex(l => (l.barcode && l.barcode === codeOrBarcode) || l.code === codeOrBarcode);
  if (idx !== -1) {
    pickerOrder.lines[idx].picked = (pickerOrder.lines[idx].picked || 0) + qty;
  } else {
    pickerOrder.lines.push({ code: codeOrBarcode, name: "(Yeni)", qty: 0, picked: qty });
  }
  renderPickerLines();
}
async function finishPick() {
  if (!pickerOrder) return;
  for (const l of pickerOrder.lines) {
    const used = Math.min(l.picked || 0, l.qty || 0);
    if (used > 0) await decreaseStock(l.code, used, pickerOrder.warehouse);
  }
  await updateDoc(doc(db, "orders", pickerOrder.id), {
    lines: pickerOrder.lines,
    status: "Toplandı"
  });
  alert("Toplama tamamlandı!");
}

// ================== YÖNETİCİ ==================
document.getElementById("refreshOrdersBtn")?.addEventListener("click", loadAllOrders);

async function loadAllOrders() {
  const snap = await getDocs(collection(db, "orders"));
  const tbody = document.querySelector("#tbl-orders tbody");
  if (!tbody) return;
  tbody.innerHTML = "";
  snap.forEach(docu => {
    const o = { id: docu.id, ...docu.data() };
    tbody.innerHTML += `
      <tr>
        <td>${o.id}</td>
        <td>${o.name}</td>
        <td>${o.warehouse || "-"}</td>
        <td>${o.status}</td>
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

