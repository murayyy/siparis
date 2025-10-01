// ---- SheetJS'i sadece ihtiyaç olduğunda yükle ----
let XLSX = null;
async function ensureXLSX() {
  if (XLSX) return XLSX;
  try {
    // İstersen aşağıdaki URL'yi sabit bırak; yüklenmezse zaten catch'e düşer
    XLSX = await import("https://cdn.sheetjs.com/xlsx-0.19.3/package/xlsx.mjs");
    return XLSX;
  } catch (e) {
    // Alternatif CDN denemesi (opsiyonel, istersen bırak)
    try {
      XLSX = await import("https://cdn.jsdelivr.net/npm/xlsx@0.19.3/+esm");
      return XLSX;
    } catch (e2) {
      console.error("XLSX import edilemedi:", e, e2);
      alert("Excel kütüphanesi yüklenemedi. İnternet/HTTPS/CDN erişimini kontrol et.");
      throw e2;
    }
  }
}
// ================= NAV (mobil menü) =================
document.getElementById("menuToggle")?.addEventListener("click", () => {
  document.getElementById("mainNav")?.classList.toggle("show");
});

// ================= FIREBASE IMPORT =================
// ================= FIREBASE IMPORT =================
import { 
  app, auth, db,
  signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged,
  collection, doc, setDoc, getDoc, getDocs, updateDoc, addDoc,
  query, where, orderBy, serverTimestamp
} from "./firebase.js";


// ================== GLOBAL ==================
let currentUser = null;
let scanner = null;
let lastScanAt = 0;

let orderDraft = [];   // şube sipariş satırları
let pickerOrder = null;
let qcOrder = null;
let paletOrder = null;

// ================== VIEW DEĞİŞTİR ==================
function showView(id) {
  document.querySelectorAll(".view").forEach(v => v.classList.add("hidden"));
  document.getElementById(id)?.classList.remove("hidden");
}
document.querySelectorAll("nav button[data-view]").forEach(btn => {
  btn.addEventListener("click", () => showView(btn.dataset.view));
});

// ================== AUTH ==================
document.getElementById("loginBtn")?.addEventListener("click", async () => {
  const email = document.getElementById("login-email").value;
  const pass  = document.getElementById("login-pass").value;
  try {
    await signInWithEmailAndPassword(auth, email, pass);
  } catch (err) {
    console.error(err);
    alert("Giriş hatası: " + (err?.message || err));
  }
});

document.getElementById("registerBtn")?.addEventListener("click", async () => {
  const email = document.getElementById("reg-email").value;
  const pass  = document.getElementById("reg-pass").value;
  const role  = document.getElementById("reg-role").value;
  try {
    const userCred = await createUserWithEmailAndPassword(auth, email, pass);
    const uid = userCred.user.uid;
    await setDoc(doc(db, "users", uid), {
      email, role, createdAt: serverTimestamp()
    });
    alert("Kayıt başarılı!");
  } catch (err) {
    console.error(err);
    alert("Kayıt hatası: " + (err?.message || err));
  }
});

document.getElementById("logoutBtn")?.addEventListener("click", async () => {
  try { await signOut(auth); } catch(e){ console.warn(e); }
});

// >>> BURASI SAĞLAMLAŞTIRILDI
// ================== AUTH STATE ==================
onAuthStateChanged(auth, async (user) => {
  try {
    if (!user) {
      currentUser = null;
      document.getElementById("logoutBtn")?.classList.add("hidden");
      showView("view-login");
      return;
    }

    currentUser = user;
    document.getElementById("logoutBtn")?.classList.remove("hidden");

    let role = "sube"; // default
    try {
      const udoc = await getDoc(doc(db, "users", user.uid));
      if (udoc.exists()) {
        role = udoc.data().role || "sube";
      } else {
        // Eğer hiç kayıt yoksa, varsayılan olarak sube yaz
        await setDoc(doc(db, "users", user.uid), { role: "sube", email: user.email });
      }
    } catch (err) {
      console.error("Rol okunamadı:", err);
    }

    console.log("🔑 Kullanıcı girdi:", user.email, "Rol:", role);

    // Rol bazlı yönlendirme
    switch (role) {
      case "sube":
        showView("view-branch");
        break;
      case "yonetici":
        showView("view-manager");
        break;
      case "toplayici":
        showView("view-picker");
        await refreshAssigned();
        break;
      case "qc":
        showView("view-qc");
        break;
      case "palet":
        showView("view-palet");
        break;
      case "admin":
        showView("view-products");
        await listProductsIntoTable();
        break;
      default:
        showView("view-login");
    }

    await refreshBranchProductSelect();
  } catch (err) {
    console.error("onAuthStateChanged hata:", err);
    alert("Oturum başlatılırken hata oluştu.");
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
  sel.innerHTML = '<option value="">Ürün seçin…</option>';
  const snap = await getDocs(collection(db, "products"));
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

  // Excel kütüphanesini burada yükle
  await ensureXLSX();

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
          reyon:   row.reyon   ? String(row.reyon).trim()   : ""
        });
        count++;
      }
      alert(`Toplam ${count} ürün yüklendi.`);
      await listProductsIntoTable();
      await refreshBranchProductSelect();
    } catch (err) {
      console.error(err);
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

// Kamera listesini doldur
async function populatePickerCameras() {
  const sel = document.getElementById("pickerCamera");
  if (!sel) return;
  try {
    const cams = await Html5Qrcode.getCameras(); // https şart (http: çalışmaz)
    sel.innerHTML = "";
    if (!cams || cams.length === 0) {
      sel.insertAdjacentHTML("beforeend", `<option value="">Kamera bulunamadı</option>`);
      return;
    }
    // arka kamerayı öne al
    cams.sort((a,b)=>{
      const A=(a.label||"").toLowerCase(), B=(b.label||"").toLowerCase();
      const ab=A.includes("back")||A.includes("rear")||A.includes("arka");
      const bb=B.includes("back")||B.includes("rear")||B.includes("arka");
      return (ab===bb)?0:(ab?-1:1);
    });
    cams.forEach((c,i)=>{
      sel.insertAdjacentHTML("beforeend", `<option value="${c.id}">${c.label||`Kamera ${i+1}`}</option>`);
    });
  } catch (e) {
    sel.innerHTML = `<option value="">Kamera listelenemedi</option>`;
    console.error("Kamera listesi hatası:", e);
  }
}
document.querySelector("button[data-view='view-picker']")?.addEventListener("click", populatePickerCameras);
document.addEventListener("DOMContentLoaded", populatePickerCameras);

// Tarayıcı başlat/durdur
async function startPickerScanner() {
  try {
    if (scanner) await stopPickerScanner();
    const sel = document.getElementById("pickerCamera");
    const camId = sel?.value || "";
    const config = { fps: 10, qrbox: 250, rememberLastUsedCamera: true };

    if (window.Html5QrcodeSupportedFormats) {
      config.formatsToSupport = [
        Html5QrcodeSupportedFormats.QR_CODE,
        Html5QrcodeSupportedFormats.CODE_128,
        Html5QrcodeSupportedFormats.CODE_39,
        Html5QrcodeSupportedFormats.EAN_13,
        Html5QrcodeSupportedFormats.EAN_8,
        Html5QrcodeSupportedFormats.UPC_A,
        Html5QrcodeSupportedFormats.UPC_E,
      ];
    }
    scanner = new Html5Qrcode("reader");
    const constraints = camId ? { deviceId: { exact: camId } } : { facingMode: "environment" };
    await scanner.start(constraints, config, (text) => {
      const now = Date.now();
      if (now - lastScanAt < 1200) return; // debounce
      lastScanAt = now;
      handleScannedCode(text, /*askQty*/ true);
    }, () => {});
  } catch (err) {
    console.error(err);
    alert("Kamera başlatılamadı: " + (err?.message || err));
  }
}
function stopPickerScanner() {
  if (!scanner) return;
  return scanner.stop().then(() => { scanner.clear(); scanner = null; });
}

// Barkod/kod işlensin
async function handleScannedCode(codeOrBarcode, askQty = false) {
  if (!pickerOrder) return alert("Önce bir sipariş açın.");
  let qty = 1;
  if (askQty) {
    const v = prompt(`Okunan: ${codeOrBarcode}\nMiktar?`, "1");
    qty = parseInt(v || "1", 10);
    if (!qty || qty < 1) qty = 1;
  }
  await applyPickByCodeOrBarcode(codeOrBarcode, qty);
}

// Kod/barkod’a göre “Toplanan” arttır ya da satır ekle
async function applyPickByCodeOrBarcode(codeOrBarcode, qty) {
  // 1) Sipariş satırlarında ara
  let idx = pickerOrder.lines.findIndex(
    l => (l.barcode && String(l.barcode) === String(codeOrBarcode)) || String(l.code) === String(codeOrBarcode)
  );
  if (idx !== -1) {
    pickerOrder.lines[idx].picked = (pickerOrder.lines[idx].picked || 0) + qty;
    renderPickerLines();
    return;
  }

  // 2) Ürün kataloğunda ara
  let found = null;
  try {
    const byCode = await getDoc(doc(db, "products", String(codeOrBarcode)));
    if (byCode.exists()) {
      found = byCode.data();
    } else {
      const qy = query(collection(db, "products"), where("barcode", "==", String(codeOrBarcode)));
      const snap = await getDocs(qy);
      snap.forEach(d => { if (!found) found = d.data(); });
    }
  } catch (e) {
    console.warn("Ürün arama hatası:", e);
  }

  // 3) Bulduysan ekle, bulamadıysan adını boş geç (sonra düzenlenebilir)
  const line = {
    code: found?.code || String(codeOrBarcode),
    name: found?.name || "(Ad yok)",
    qty: found ? 0 : qty,     // istenen miktar bilinmiyorsa 0
    picked: qty,
    barcode: found?.barcode || "",
    reyon: found?.reyon || ""
  };
  pickerOrder.lines.push(line);
  renderPickerLines();
}

// Toplayıcı tablosu – elle düzenleme + +/- + sil
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

// Elle toplama butonu
document.getElementById("manualAddBtn")?.addEventListener("click", async () => {
  const code = document.getElementById("manualScanCode")?.value.trim();
  let qty = parseInt(document.getElementById("manualScanQty")?.value, 10);
  if (!pickerOrder) return alert("Önce bir siparişi açın.");
  if (!code) return alert("Kod veya barkod girin.");
  if (!qty || qty < 1) qty = 1;
  await applyPickByCodeOrBarcode(code, qty);
  document.getElementById("manualScanCode").value = "";
  document.getElementById("manualScanQty").value = "1";
});

async function finishPick() {
  if (!pickerOrder) return;
  // depo bazlı stok düş
  for (const l of pickerOrder.lines) {
    const used = Math.min(l.picked || 0, l.qty || 0);
    if (used > 0) await decreaseStock(l.code, used, pickerOrder.warehouse);
  }
  await updateDoc(doc(db, "orders", pickerOrder.id), {
    lines: pickerOrder.lines,
    status: "Toplandı"
  });
  alert("Toplama tamamlandı ve stok güncellendi!");
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

// ================== QC (manuel input ile) ==================
document.getElementById("refreshQCBtn")?.addEventListener("click", refreshQCOrders);
document.getElementById("openQCBtn")?.addEventListener("click", openQCOrder);

async function refreshQCOrders() {
  const sel = document.getElementById("qcOrders");
  if (!sel) return;
  sel.innerHTML = "";
  const qs = await getDocs(query(collection(db, "orders"), where("status", "==", "Kontrol")));
  qs.forEach(d => {
    const o = { id: d.id, ...d.data() };
    sel.insertAdjacentHTML("beforeend", `<option value="${o.id}">${o.id} - ${o.name} (${o.warehouse || "-"})</option>`);
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
  if (!tb) return;
  tb.innerHTML = "";
  qcOrder.lines.forEach((l, i) => {
    tb.innerHTML += `
      <tr data-idx="${i}">
        <td>${i + 1}</td>
        <td>${l.code}</td>
        <td>${l.name}</td>
        <td>${l.qty}</td>
        <td>${l.picked || 0}</td>
        <td><input type="number" class="qc-input" value="${l.qc || 0}" min="0"></td>
        <td>${Math.max(0, (l.picked || 0) - (l.qc || 0))}</td>
      </tr>`;
  });
}
document.getElementById("finishQCBtn")?.addEventListener("click", async () => {
  document.querySelectorAll("#tbl-qc-lines tbody tr").forEach(tr => {
    const idx = parseInt(tr.dataset.idx);
    qcOrder.lines[idx].qc = parseInt(tr.querySelector(".qc-input").value) || 0;
  });
  await updateDoc(doc(db, "orders", qcOrder.id), { status: "Tamamlandı", lines: qcOrder.lines });
  alert("QC tamamlandı!");
  document.getElementById("qcArea").classList.add("hidden");
});

// ================== PALET ==================
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
    sel.insertAdjacentHTML("beforeend", `<option value="${o.id}">${o.id} - ${o.name}</option>`);
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
  (paletOrder.lines || []).forEach((l, i) => {
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
    items: paletOrder.lines || []
  });
  document.getElementById("paletNo").textContent = paletNo;
  document.getElementById("paletResult").classList.remove("hidden");
  const host = document.getElementById("paletQr");
  if (host) {
    host.innerHTML = "";
    if (window.QRCode && window.QRCode.toCanvas) {
      window.QRCode.toCanvas(host, paletNo, { width: 128 }, (err) => { if (err) console.error(err); });
    }
  }
  alert("Palet oluşturuldu: " + paletNo);
}

// ================== DASHBOARD ==================
document.getElementById("dashboardWarehouse")?.addEventListener("change", loadDashboard);

async function loadStocksTable() {
  const tb = document.querySelector("#tbl-stocks tbody");
  if (!tb) return;
  const selectedWh = document.getElementById("dashboardWarehouse")?.value || "MERKEZ";
  const snap = await getDocs(collection(db, "stocks"));
  tb.innerHTML = "";
  snap.forEach(docu => {
    const d = docu.data();
    if (d.warehouse === selectedWh) {
      tb.innerHTML += `<tr><td>${d.code}</td><td>${d.name}</td><td>${d.qty}</td><td>${d.warehouse}</td></tr>`;
    }
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

  document.getElementById("statTotalOrders")?.innerText = total;
  document.getElementById("statCompletedOrders")?.innerText = completed;
  document.getElementById("statPendingOrders")?.innerText = pending;
  document.getElementById("statPallets")?.innerText = palletsSnap.size;

  const ctx1 = document.getElementById("chartOrders");
  if (ctx1) {
    if (ctx1._chartInstance) ctx1._chartInstance.destroy();
    ctx1._chartInstance = new Chart(ctx1,{ type:"pie",
      data:{ labels:["Tamamlanan","Bekleyen"],
        datasets:[{ data:[completed,pending] }]}
    });
  }
  const ctx2 = document.getElementById("chartDaily");
  if (ctx2) {
    if (ctx2._chartInstance) ctx2._chartInstance.destroy();
    ctx2._chartInstance = new Chart(ctx2,{ type:"bar",
      data:{ labels:["Gün1","Gün2","Gün3","Gün4","Gün5","Gün6","Gün7"],
        datasets:[{ label:"Sipariş", data:[3,5,2,7,4,6,3] }]}
    });
  }
  await loadStocksTable();
}

// Dashboard açıkken periyodik yenile
setInterval(()=>{
  const v=document.getElementById("view-dashboard");
  if(v && !v.classList.contains("hidden")) loadDashboard();
},5000);

// ================== STOK YÖNETİMİ (manuel, çoklu depo) ==================
document.querySelector("button[data-view='view-stock']")?.addEventListener("click", loadStockManage);
document.getElementById("stockWarehouse")?.addEventListener("change", loadStockManage);

async function loadStockManage() {
  const tbody = document.querySelector("#tbl-stock-manage tbody");
  if (!tbody) return;
  const selectedWh = document.getElementById("stockWarehouse")?.value || "MERKEZ";
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
  const qty  = parseInt(document.getElementById("stockQty").value,10);
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
  const qty  = parseInt(document.getElementById("stockQty").value,10);
  if (!code || !qty) return alert("Kod ve miktar gerekli!");
  const ref = doc(db, "stocks", `${warehouse}_${code}`);
  const snap = await getDoc(ref);
  if (snap.exists()) {
    let newQty = (snap.data().qty || 0) - qty;
    if (newQty < 0) newQty = 0;
    await updateDoc(ref, { qty: newQty });
    if (newQty < 5) alert(`⚠️ Dikkat! ${warehouse}/${code} stoğu kritik (${newQty})`);
  } else {
    alert("Stok bulunamadı.");
  }
  alert("Stok çıkışı yapıldı.");
  loadStockManage();
});

// ================== KÜÇÜK İYİLEŞTİRMELER ==================
document.querySelector("button[data-view='view-manager']")?.addEventListener("click", loadAllOrders);
document.querySelector("button[data-view='view-dashboard']")?.addEventListener("click", loadDashboard);
document.querySelector("button[data-view='view-picker']")?.addEventListener("click", refreshAssigned);
document.querySelector("button[data-view='view-qc']")?.addEventListener("click", refreshQCOrders);
document.querySelector("button[data-view='view-palet']")?.addEventListener("click", refreshPaletOrders);

// İlk açılışta login görünümü hazır
showView("view-login");
console.log("app.js (tamamlandı) ✓");
