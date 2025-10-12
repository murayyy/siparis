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
  if (!user) { 
    // ❌ Kullanıcı giriş yapmamış
    currentUser = null;
    document.getElementById("logoutBtn")?.classList.add("hidden");
    document.querySelector("header nav").classList.add("hidden");  
    showView("view-login");   // 🔑 Sadece login ekranı görünsün
    return;
  }

  // ✅ Kullanıcı giriş yapmış
  currentUser = user;
  document.getElementById("logoutBtn")?.classList.remove("hidden");
  document.querySelector("header nav").classList.remove("hidden"); 

  // 🔑 Rol oku
  let role = "sube";
  try {
    const udoc = await getDoc(doc(db, "users", user.uid));
    if (udoc.exists() && udoc.data().role) {
      role = udoc.data().role;
    }
  } catch (e) { 
    console.warn("Rol okunamadı:", e); 
  }

  // 🎯 Kullanıcı giriş yaptıktan SONRA yönlendirme
  if (role === "sube") showView("view-branch");
  else if (role === "yonetici") showView("view-manager");
  else if (role === "toplayici") { 
    showView("view-picker"); 
    refreshAssigned(); 
  }
  else if (role === "qc") showView("view-qc");
  else if (role === "palet") showView("view-palet");
  else if (role === "admin") showView("view-products");
  else showView("view-branch");
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
document.getElementById("manualAddBtn")?.addEventListener("click", manualAdd); // ✅ elle ekleme
document.getElementById("savePickBtn")?.addEventListener("click", savePickProgress); // 💾 kaydet

// ================== GÖREVLER ==================
async function refreshAssigned() {
  const sel = document.getElementById("assignedOrders");
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
  const id = document.getElementById("assignedOrders").value;
  if (!id) return;
  const ds = await getDoc(doc(db, "orders", id));
  if (!ds.exists()) return;
  pickerOrder = { id: ds.id, ...ds.data() };
  pickerOrder.lines = (pickerOrder.lines || []).map(l => ({ ...l, picked: l.picked || 0 }));
  renderPickerLines();
  document.getElementById("pickerTitle").textContent = `Sipariş: ${pickerOrder.name} (${pickerOrder.warehouse || "-"})`;
  document.getElementById("pickerArea").classList.remove("hidden");
}

function renderPickerLines() {
  const tb = document.querySelector("#tbl-picker-lines tbody");
  if (!tb) return;
  tb.innerHTML = "";

  const toNum = (v) => {
    if (v === "" || v == null) return 0;
    const n = parseFloat(String(v).replace(",", ".")); // TR virgül -> nokta
    return Number.isNaN(n) ? 0 : n;
  };
  const clamp = (v, min, max) => Math.min(Math.max(v, min), max);

  // Sadece ilgili satırı boyayan yardımcı
  const paintRow = (tr, qty, picked) => {
    tr.classList.remove("not-picked", "partial-picked", "fully-picked");
    tr.classList.add(
      picked === 0 ? "not-picked" : picked < qty ? "partial-picked" : "fully-picked"
    );
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
            type="number"
            inputmode="decimal"
            step="0.001"
            min="0"
            class="picked-input"
            data-idx="${i}"
            value="${picked}"
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
    // İlk boyama
    const tr = tb.querySelector(`tr[data-row="${i}"]`);
    paintRow(tr, qty, picked);
  });

  // Elle yazma (input): değeri modele koy; blur/enter’da normalize + boya
  tb.querySelectorAll(".picked-input").forEach(inp => {
    inp.addEventListener("input", e => {
      const idx = Number(e.target.dataset.idx);
      const raw = e.target.value;
      const val = toNum(raw);
      pickerOrder.lines[idx].picked = val; // ara değer (kullanıcı yazarken)
    });

    inp.addEventListener("blur", e => {
      const idx = Number(e.target.dataset.idx);
      const line = pickerOrder.lines[idx];
      const qty = toNum(line.qty);
      let val = toNum(e.target.value);

      // Üst sınır: sadece istenen miktar gerçekten pozitifse uygula
      const hardMax = (Number.isFinite(qty) && qty > 0) ? qty : Infinity;
      val = clamp(val, 0, hardMax);

      line.picked = val;
      e.target.value = val; // normalize et (virgül/gereksiz karakterler gider)
      const tr = tb.querySelector(`tr[data-row="${idx}"]`);
      paintRow(tr, qty, val);
    });

    inp.addEventListener("keydown", e => {
      if (e.key === "Enter") e.target.blur();
    });
  });

  // +1 / -1 / Sil
  tb.querySelectorAll("button[data-plus]").forEach(btn => {
    btn.addEventListener("click", () => {
      const idx = Number(btn.dataset.plus);
      const line = pickerOrder.lines[idx];
      const qty = toNum(line.qty);
      const cur = toNum(line.picked);

      const hardMax = (Number.isFinite(qty) && qty > 0) ? qty : Infinity;
      const next = clamp(cur + 1, 0, hardMax);
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
      const qty = toNum(line.qty);
      const cur = toNum(line.picked);

      const next = Math.max(cur - 1, 0);
      line.picked = next;

      const tr = tb.querySelector(`tr[data-row="${idx}"]`);
      const inp = tr.querySelector(".picked-input");
      inp.value = next;
      paintRow(tr, qty, next);
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

// ================== BARKOD OKUTMA ==================
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

// ✅ Barkodla veya elle okunan ürünü Firestore'dan bulup ekler
async function handleScannedCode(codeOrBarcode, askQty = false) {
  if (!pickerOrder) return alert("Önce sipariş açın.");
  let qty = 1;
  if (askQty) {
    const v = prompt(`Okunan: ${codeOrBarcode}\nMiktar?`, "1");
    qty = parseFloat(String(v || "1").replace(",", ".")); // ondalık & TR desteği
    if (!qty || qty < 0) qty = 0;
  }

  let idx = pickerOrder.lines.findIndex(l => (l.barcode && l.barcode === codeOrBarcode) || l.code === codeOrBarcode);
  if (idx !== -1) {
    const line = pickerOrder.lines[idx];
    const req = parseFloat(String(line.qty ?? 0));
    const hardMax = (Number.isFinite(req) && req > 0) ? req : Infinity;
    const cur = parseFloat(String(line.picked ?? 0)) || 0;
    line.picked = Math.min(cur + qty, hardMax);
  } else {
    let name = "";
    try {
      const prodSnap = await getDoc(doc(db, "products", codeOrBarcode));
      if (prodSnap.exists()) {
        name = prodSnap.data().name || "";
      }
    } catch (e) {
      console.warn("Ürün bulunamadı:", e);
    }
    // Yeni eklenende istenen 0 (ad-hoc), picked taranan miktar
    pickerOrder.lines.push({ code: codeOrBarcode, name, qty: 0, picked: qty });
  }

  renderPickerLines();
}

// ================== ELLE EKLEME ==================
async function manualAdd() {
  if (!pickerOrder) return alert("Önce sipariş seçin!");
  const code = document.getElementById("manualScanCode").value.trim();
  let qty = parseFloat(String(document.getElementById("manualScanQty").value).replace(",", "."));
  if (!code) return alert("Kod veya barkod girin!");
  if (!qty || qty < 0) qty = 0;

  let idx = pickerOrder.lines.findIndex(l => l.code === code || l.barcode === code);
  if (idx !== -1) {
    const line = pickerOrder.lines[idx];
    const req = parseFloat(String(line.qty ?? 0));
    const hardMax = (Number.isFinite(req) && req > 0) ? req : Infinity;
    const cur = parseFloat(String(line.picked ?? 0)) || 0;
    line.picked = Math.min(cur + qty, hardMax);
  } else {
    let name = "";
    try {
      const prodSnap = await getDoc(doc(db, "products", code));
      if (prodSnap.exists()) {
        name = prodSnap.data().name || "";
      }
    } catch (e) {
      console.warn("Elle eklenen ürün bulunamadı:", e);
    }
    pickerOrder.lines.push({ code, name, qty: 0, picked: qty });
  }

  renderPickerLines();
  document.getElementById("manualScanCode").value = "";
  document.getElementById("manualScanQty").value = "1";
}

// ================== TOPLAMA KAYDET ==================
async function savePickProgress() {
  if (!pickerOrder) return alert("Önce bir sipariş açın!");
  await updateDoc(doc(db, "orders", pickerOrder.id), {
    lines: pickerOrder.lines,
    status: "Toplama Başladı",
    lastUpdate: new Date()
  });
  alert("Toplama durumu kaydedildi. Daha sonra devam edebilirsin!");
}

// ================== TOPLAMA TAMAMLAMA ==================
async function finishPick() {
  if (!pickerOrder) return;
  const toNum = (v) => {
    if (v === "" || v == null) return 0;
    const n = parseFloat(String(v).replace(",", "."));
    return Number.isNaN(n) ? 0 : n;
  };
  for (const l of pickerOrder.lines) {
    const used = Math.min(toNum(l.picked), toNum(l.qty));
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

// ================== QC (KONTROL) ==================
console.log("✅ QC Modülü Yüklendi");

// Durumlar
let qcOrder = null;
let qcScanner = null;

// Kısa seçici
const $ = (id) => document.getElementById(id);

// 🔗 Buton bağla
$("refreshQCBtn")?.addEventListener("click", refreshQCOrders);
$("openQCBtn")?.addEventListener("click", openQCOrder);
$("startQCScanBtn")?.addEventListener("click", startQCScanner);
$("stopQCScanBtn")?.addEventListener("click", stopQCScanner);
$("finishQCBtn")?.addEventListener("click", finishQC);
$("saveQCBtn")?.addEventListener("click", saveQCProgress);

// Küçük yardımcılar
const toNum = (v) => {
  if (v === "" || v == null) return 0;
  const n = parseFloat(String(v).replace(",", ".")); // TR virgül desteği
  return Number.isNaN(n) ? 0 : n;
};
const clamp = (v, min, max) => Math.min(Math.max(v, min), max);

// ================== QC SİPARİŞLERİNİ LİSTELE ==================
async function refreshQCOrders() {
  const sel = $("qcOrders");
  if (!sel) return;

  sel.innerHTML = "";
  const qs = await getDocs(
    query(collection(db, "orders"), where("status", "in", ["Kontrol", "Kontrol Başladı"]))
  );
  qs.forEach((d) => {
    const o = { id: d.id, ...d.data() };
    const opt = document.createElement("option");
    opt.value = o.id;
    opt.textContent = `${o.id} - ${o.name || "(İsimsiz)"} (${o.status})`;
    sel.appendChild(opt);
  });
}

// ================== QC SİPARİŞİ AÇ ==================
async function openQCOrder() {
  const id = $("qcOrders")?.value;
  if (!id) return alert("Lütfen bir sipariş seçin.");

  const ds = await getDoc(doc(db, "orders", id));
  if (!ds.exists()) return alert("Sipariş bulunamadı!");

  qcOrder = { id: ds.id, ...ds.data() };
  qcOrder.lines = (qcOrder.lines || []).map((l) => ({
    ...l,
    picked: toNum(l.picked || 0),
    qc: toNum(l.qc || 0),
    qty: toNum(l.qty || 0),
  }));

  renderQCLines();
  $("qcTitle").textContent = `Sipariş: ${qcOrder.name}`;
  $("qcArea").classList.remove("hidden");

  await updateDoc(doc(db, "orders", qcOrder.id), {
    status: "Kontrol Başladı",
    lastUpdate: new Date(),
  });
}

// ================== QC TABLOSUNU GÖSTER ==================
function renderQCLines() {
  const tb = document.querySelector("#tbl-qc-lines tbody");
  if (!tb || !qcOrder) return;
  tb.innerHTML = "";

  // Satır boyama
  const paintRow = (tr, picked, qc) => {
    tr.classList.remove("not-picked", "partial-picked", "fully-picked");
    tr.classList.add(qc === 0 ? "not-picked" : qc < picked ? "partial-picked" : "fully-picked");
  };

  qcOrder.lines.forEach((l, i) => {
    const picked = toNum(l.picked);
    const qc = clamp(toNum(l.qc), 0, picked);
    const diff = Math.max(0, picked - qc);

    tb.insertAdjacentHTML(
      "beforeend",
      `
      <tr data-row="${i}">
        <td>${i + 1}</td>
        <td>${l.code || ""}</td>
        <td>${l.name || ""}</td>
        <td>${toNum(l.qty)}</td>
        <td>${picked}</td>
        <td>
          <input
            type="number"
            inputmode="decimal"
            step="0.001"
            min="0"
            class="qc-input"
            data-idx="${i}"
            value="${qc}"
            style="width:100px;text-align:center;"
          />
        </td>
        <td>${diff}</td>
      </tr>`
    );

    // İlk boyama
    const tr = tb.querySelector(`tr[data-row="${i}"]`);
    paintRow(tr, picked, qc);
  });

  // Elle yazma: ara değeri modele koy; blur/enter’da clamp + boya
  tb.querySelectorAll(".qc-input").forEach((inp) => {
    inp.addEventListener("input", (e) => {
      const idx = Number(e.target.dataset.idx);
      const raw = e.target.value;
      const val = toNum(raw);
      qcOrder.lines[idx].qc = val; // ara değer (imeç zıplamasın)
    });

    inp.addEventListener("blur", (e) => {
      const idx = Number(e.target.dataset.idx);
      const line = qcOrder.lines[idx];
      const picked = toNum(line.picked);
      let val = clamp(toNum(e.target.value), 0, picked);
      line.qc = val;
      e.target.value = val; // normalize
      const tr = tb.querySelector(`tr[data-row="${idx}"]`);
      paintRow(tr, picked, val);
      // Eksik kolonu da güncelle:
      tr.querySelector("td:last-child").textContent = Math.max(0, picked - val);
    });

    inp.addEventListener("keydown", (e) => {
      if (e.key === "Enter") e.target.blur();
    });
  });
}

// ================== QC SCANNER ==================
async function startQCScanner() {
  if (typeof Html5Qrcode === "undefined") return alert("📷 Barkod kütüphanesi yüklenmemiş!");
  if (qcScanner) await stopQCScanner();

  qcScanner = new Html5Qrcode("qcReader");
  try {
    await qcScanner.start({ facingMode: "environment" }, { fps: 10, qrbox: 250 }, onQCScan);
    console.log("✅ QC Tarayıcı başlatıldı");
  } catch (err) {
    console.error(err);
    alert("Tarayıcı başlatılamadı!");
  }
}

function stopQCScanner() {
  if (!qcScanner) return;
  return qcScanner.stop().then(() => {
    qcScanner.clear();
    qcScanner = null;
    console.log("⛔ QC Tarayıcı durduruldu");
  });
}

function onQCScan(code) {
  if (!qcOrder) return;
  const idx = qcOrder.lines.findIndex((l) => l.barcode === code || l.code === code);
  if (idx === -1) return alert("Barkod bulunamadı: " + code);

  const picked = toNum(qcOrder.lines[idx].picked);
  const cur = toNum(qcOrder.lines[idx].qc);
  if (cur < picked) {
    qcOrder.lines[idx].qc = cur + 1; // istersen 0.1 artır: cur + 0.1
  }

  // Sadece bu satırı ekranda güncelle
  const tb = document.querySelector("#tbl-qc-lines tbody");
  const input = tb?.querySelector(`.qc-input[data-idx="${idx}"]`);
  if (input) {
    input.value = qcOrder.lines[idx].qc;
    input.dispatchEvent(new Event("blur", { bubbles: true })); // clamp + boyama
  }
}

// ================== QC KAYDET & BİTİR ==================
async function saveQCProgress() {
  if (!qcOrder) return alert("Önce bir sipariş açın!");
  await updateDoc(doc(db, "orders", qcOrder.id), {
    lines: qcOrder.lines,
    status: "Kontrol Başladı",
    lastUpdate: new Date(),
  });
  alert("💾 QC kaydedildi!");
}

async function finishQC() {
  if (!qcOrder) return alert("Sipariş seçilmedi!");
  await stopQCScanner();
  await updateDoc(doc(db, "orders", qcOrder.id), {
    lines: qcOrder.lines,
    status: "Tamamlandı",
    lastUpdate: new Date(),
  });
  alert("✅ QC tamamlandı!");
}


// ================== PALETLEME ==================
document.getElementById("refreshPaletBtn")?.addEventListener("click", refreshPaletOrders);
document.getElementById("openPaletBtn")?.addEventListener("click", openPaletOrder);
document.getElementById("createPaletBtn")?.addEventListener("click", createPalet);
document.getElementById("printPaletBtn")?.addEventListener("click", () => window.print());

async function refreshPaletOrders() {
  const sel = document.getElementById("paletOrders");
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
    id: paletNo,
    orderId: paletOrder.id,
    createdAt: serverTimestamp(),
    items: paletOrder.lines
  });
  document.getElementById("paletNo").textContent = paletNo;
  document.getElementById("paletResult").classList.remove("hidden");
  document.getElementById("paletQr").innerHTML = "";
  if (window.QRCode) {
    window.QRCode.toCanvas(document.getElementById("paletQr"), paletNo, { width: 128 });
  }
  alert("Palet oluşturuldu: " + paletNo);
}

// ================== DASHBOARD ==================
document.getElementById("dashboardWarehouse")?.addEventListener("change", loadDashboard);

async function loadDashboard() {
  const ordersSnap = await getDocs(collection(db, "orders"));
  const palletsSnap = await getDocs(collection(db, "pallets"));

  let total = 0, completed = 0, pending = 0;
  ordersSnap.forEach(docu => {
    total++;
    const st = docu.data().status;
    if (st === "Tamamlandı") completed++;
    else pending++;
  });

  document.getElementById("statTotalOrders").innerText = total;
  document.getElementById("statCompletedOrders").innerText = completed;
  document.getElementById("statPendingOrders").innerText = pending;
  document.getElementById("statPallets").innerText = palletsSnap.size;

  const ctx1 = document.getElementById("chartOrders");
  if (ctx1) {
    new Chart(ctx1, {
      type: "pie",
      data: {
        labels: ["Tamamlanan", "Bekleyen"],
        datasets: [{ data: [completed, pending], backgroundColor: ["#16a34a", "#f87171"] }]
      }
    });
  }
  const ctx2 = document.getElementById("chartDaily");
  if (ctx2) {
    new Chart(ctx2, {
      type: "bar",
      data: {
        labels: ["Gün1", "Gün2", "Gün3", "Gün4", "Gün5", "Gün6", "Gün7"],
        datasets: [{ label: "Sipariş", data: [3, 5, 2, 7, 4, 6, 3] }]
      }
    });
  }
}

// Dashboard otomatik yenile (5 sn)
setInterval(() => {
  const v = document.getElementById("view-dashboard");
  if (v && !v.classList.contains("hidden")) loadDashboard();
}, 5000);

// ================== STOK YÖNETİMİ ==================
document.querySelector("button[data-view='view-stock']")?.addEventListener("click", loadStockManage);
document.getElementById("stockWarehouse")?.addEventListener("change", loadStockManage);

async function loadStockManage() {
  const tbody = document.querySelector("#tbl-stock-manage tbody");
  if (!tbody) return;
  const selectedWh = document.getElementById("stockWarehouse").value;
  const snap = await getDocs(collection(db, "stocks"));
  tbody.innerHTML = "";
  snap.forEach(docu => {
    const d = docu.data();
    if (d.warehouse === selectedWh) {
      tbody.innerHTML += `<tr><td>${d.code}</td><td>${d.name}</td><td>${d.qty}</td><td>${d.warehouse}</td></tr>`;
    }
  });
}

document.getElementById("btnStockIn")?.addEventListener("click", async () => {
  const warehouse = document.getElementById("stockWarehouse").value;
  const code = document.getElementById("stockCode").value.trim();
  const name = document.getElementById("stockName").value.trim();
  const qty = parseInt(document.getElementById("stockQty").value, 10);
  if (!code || !qty) return alert("Kod ve miktar gerekli!");
  const ref = doc(db, "stocks", `${warehouse}_${code}`);
  const snap = await getDoc(ref);
  if (snap.exists()) {
    await updateDoc(ref, { qty: (snap.data().qty || 0) + qty, name: name || snap.data().name || "", warehouse });
  } else {
    await setDoc(ref, { code, name: name || code, qty, warehouse });
  }
  alert("Stok girişi yapıldı.");
  loadStockManage();
});

document.getElementById("btnStockOut")?.addEventListener("click", async () => {
  const warehouse = document.getElementById("stockWarehouse").value;
  const code = document.getElementById("stockCode").value.trim();
  const qty = parseInt(document.getElementById("stockQty").value, 10);
  if (!code || !qty) return alert("Kod ve miktar gerekli!");
  const ref = doc(db, "stocks", `${warehouse}_${code}`);
  const snap = await getDoc(ref);
  if (snap.exists()) {
    let newQty = (snap.data().qty || 0) - qty;
    if (newQty < 0) newQty = 0;
    await updateDoc(ref, { qty: newQty });
  } else {
    alert("Stok bulunamadı.");
  }
  alert("Stok çıkışı yapıldı.");
  loadStockManage();
});
