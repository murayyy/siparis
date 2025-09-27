// Firebase importları
import {
  auth, db,
  signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged,
  collection, doc, setDoc, getDoc, getDocs, query, where, addDoc, updateDoc
} from './firebase.js';

import { Html5Qrcode } from "https://unpkg.com/html5-qrcode@2.3.10/minified/html5-qrcode.min.js";

// Global değişkenler
let currentUser = null;
let currentRole = null;
let pickerScanner = null;
let qcScanner = null;
let pickerOrder = null;
let qcOrder = null;

// Sayfa kontrolü
function showView(id) {
  document.querySelectorAll(".view").forEach(v => v.classList.add("hidden"));
  document.getElementById(id).classList.remove("hidden");
}

// Login işlemleri
document.getElementById("loginBtn")?.addEventListener("click", async () => {
  const email = document.getElementById("login-email").value;
  const pass = document.getElementById("login-pass").value;
  try {
    await signInWithEmailAndPassword(auth, email, pass);
  } catch (e) {
    alert("Giriş hatası: " + e.message);
  }
});

document.getElementById("registerBtn")?.addEventListener("click", async () => {
  const email = document.getElementById("reg-email").value;
  const pass = document.getElementById("reg-pass").value;
  const role = document.getElementById("reg-role").value;
  try {
    const cred = await createUserWithEmailAndPassword(auth, email, pass);
    await setDoc(doc(db, "users", cred.user.uid), { email, role });
    alert("Kayıt başarılı!");
  } catch (e) {
    alert("Kayıt hatası: " + e.message);
  }
});

document.getElementById("logoutBtn")?.addEventListener("click", async () => {
  await signOut(auth);
});

// Kullanıcı durumu
onAuthStateChanged(auth, async (user) => {
  if (user) {
    currentUser = user;
    const udoc = await getDoc(doc(db, "users", user.uid));
    currentRole = udoc.exists() ? udoc.data().role : null;
    document.getElementById("logoutBtn").classList.remove("hidden");
    if (currentRole === "sube") showView("view-branch");
    else if (currentRole === "yonetici") showView("view-manager");
    else if (currentRole === "toplayici") showView("view-picker");
    else if (currentRole === "qc") showView("view-qc");
    else showView("view-login");
  } else {
    currentUser = null;
    currentRole = null;
    document.getElementById("logoutBtn").classList.add("hidden");
    showView("view-login");
  }
});


// ==========================
// 📦 ŞUBE – Sipariş Girişi
// ==========================
document.getElementById("createOrderBtn")?.addEventListener("click", async () => {
  const name = document.getElementById("orderName").value;
  if (!name) return alert("Sipariş adı gir!");
  await addDoc(collection(db, "orders"), {
    name,
    status: "Yeni",
    createdBy: currentUser.uid,
    lines: []
  });
  alert("Sipariş oluşturuldu!");
  loadBranchOrders();
});

async function loadBranchOrders() {
  const tbody = document.querySelector("#branchOrders tbody");
  tbody.innerHTML = "";
  const qs = await getDocs(query(collection(db, "orders"), where("createdBy", "==", currentUser.uid)));
  qs.forEach(d => {
    const o = { id: d.id, ...d.data() };
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${o.id}</td><td>${o.name}</td><td>${o.status}</td>`;
    tbody.appendChild(tr);
  });
}
document.getElementById("view-branch")?.addEventListener("click", loadBranchOrders);


// ==========================
// 👨‍💼 YÖNETİCİ – Sipariş Onay
// ==========================
document.getElementById("refreshOrdersBtn")?.addEventListener("click", loadManagerOrders);

async function loadManagerOrders() {
  const tbody = document.querySelector("#tbl-orders tbody");
  tbody.innerHTML = "";
  const qs = await getDocs(collection(db, "orders"));
  qs.forEach(d => {
    const o = { id: d.id, ...d.data() };
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${o.id}</td><td>${o.name}</td><td>${o.status}</td>
      <td>
        ${o.status === "Yeni" ? `<button onclick="assignToPicker('${o.id}')">Toplayıcıya Ata</button>` : ""}
        ${o.status === "Toplandı" ? `<button onclick="sendToQC('${o.id}')">Kontrole Gönder</button>` : ""}
      </td>`;
    tbody.appendChild(tr);
  });
}

window.assignToPicker = async (id) => {
  await updateDoc(doc(db, "orders", id), { status: "Toplama" });
  alert("Toplayıcıya atandı!");
  loadManagerOrders();
};
window.sendToQC = async (id) => {
  await updateDoc(doc(db, "orders", id), { status: "Kontrol" });
  alert("Kontrole gönderildi!");
  loadManagerOrders();
};


// ==========================
// 🧺 TOPLAYICI – Sipariş Toplama
// ==========================
document.getElementById("refreshAssignedBtn")?.addEventListener("click", refreshAssigned);
document.getElementById("openAssignedBtn")?.addEventListener("click", openAssigned);
document.getElementById("startScanBtn")?.addEventListener("click", startPickerScanner);
document.getElementById("stopScanBtn")?.addEventListener("click", stopPickerScanner);
document.getElementById("finishPickBtn")?.addEventListener("click", finishPick);

async function refreshAssigned() {
  const sel = document.getElementById("assignedOrders");
  sel.innerHTML = "";
  const qs = await getDocs(query(collection(db, "orders"), where("status", "==", "Toplama")));
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
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${i + 1}</td>
      <td>${l.code}</td>
      <td>${l.name}</td>
      <td>${l.qty}</td>
      <td>${l.picked}</td>
    `;
    tb.appendChild(tr);
  });
}

async function startPickerScanner() {
  if (pickerScanner) await stopPickerScanner();
  pickerScanner = new Html5Qrcode("reader");
  await pickerScanner.start({ facingMode: "environment" }, { fps: 10, qrbox: 250 }, onPickerScan);
}

function stopPickerScanner() {
  if (!pickerScanner) return;
  return pickerScanner.stop().then(() => {
    pickerScanner.clear();
    pickerScanner = null;
  });
}

function onPickerScan(code) {
  const idx = pickerOrder.lines.findIndex(l => l.barcode === code || l.code === code);
  if (idx === -1) {
    alert("Barkod yok: " + code);
    return;
  }
  pickerOrder.lines[idx].picked = (pickerOrder.lines[idx].picked || 0) + 1;
  renderPickerLines();
}

async function finishPick() {
  await updateDoc(doc(db, "orders", pickerOrder.id), {
    lines: pickerOrder.lines,
    status: "Toplandı"
  });
  alert("Toplama tamamlandı!");
}


// ==========================
// 🔍 QC – Kontrol
// ==========================
document.getElementById("refreshQCBtn")?.addEventListener("click", refreshQCOrders);
document.getElementById("openQCBtn")?.addEventListener("click", openQCOrder);
document.getElementById("startQCScanBtn")?.addEventListener("click", startQCScanner);
document.getElementById("stopQCScanBtn")?.addEventListener("click", stopQCScanner);
document.getElementById("finishQCBtn")?.addEventListener("click", finishQC);

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
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${i + 1}</td>
      <td>${l.code}</td>
      <td>${l.name}</td>
      <td>${l.qty}</td>
      <td>${l.picked || 0}</td>
      <td>${l.qc}</td>
      <td>${Math.max(0, (l.picked || 0) - l.qc)}</td>
    `;
    tb.appendChild(tr);
  });
}

async function startQCScanner() {
  if (qcScanner) await stopQCScanner();
  qcScanner = new Html5Qrcode("qcReader");
  await qcScanner.start({ facingMode: "environment" }, { fps: 10, qrbox: 250 }, onQCScan);
}

function stopQCScanner() {
  if (!qcScanner) return;
  return qcScanner.stop().then(() => {
    qcScanner.clear();
    qcScanner = null;
  });
}

function onQCScan(code) {
  const idx = qcOrder.lines.findIndex(l => l.barcode === code || l.code === code);
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
