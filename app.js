// ================= FIREBASE IMPORT =================
import { 
  auth, db,
  signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged,
  collection, doc, setDoc, getDoc, getDocs, updateDoc, addDoc,
  query, where, orderBy, serverTimestamp
} from "./firebase.js";

// ================== GLOBAL ==================
let currentUser = null;
let scanner = null;
let qcScanner = null;

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
    if (role === "sube") showView("view-branch");
    else if (role === "yonetici") showView("view-manager");
    else if (role === "toplayici") showView("view-picker");
    else if (role === "qc") showView("view-qc");
    else if (role === "palet") showView("view-palet");
    else showView("view-dashboard");
  } else {
    currentUser = null;
    document.getElementById("logoutBtn").classList.add("hidden");
    showView("view-login");
  }
});

// ================== ŞUBE ==================
document.getElementById("createOrderBtn").addEventListener("click", async () => {
  const name = document.getElementById("orderName").value;
  if (!name) return alert("Sipariş adı gir!");
  await addDoc(collection(db, "orders"), {
    name, status: "Yeni", createdBy: currentUser.uid, createdAt: serverTimestamp()
  });
  alert("Sipariş oluşturuldu!");
  loadBranchOrders();
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

// ================== YÖNETİCİ ==================
document.getElementById("refreshOrdersBtn").addEventListener("click", loadAllOrders);

async function loadAllOrders() {
  const snap = await getDocs(collection(db, "orders"));
  const tbody = document.querySelector("#tbl-orders tbody");
  tbody.innerHTML = "";
  snap.forEach(docu => {
    const d = docu.data();
    tbody.innerHTML += `
      <tr>
        <td>${docu.id}</td><td>${d.name}</td><td>${d.status}</td>
        <td><button onclick="assignOrder('${docu.id}')">Ata</button></td>
      </tr>`;
  });
}

window.assignOrder = async function(id) {
  await updateDoc(doc(db, "orders", id), { status: "Atandı" });
  loadAllOrders();
};

// ================== TOPLAYICI ==================
document.getElementById("refreshAssignedBtn").addEventListener("click", loadAssignedOrders);
document.getElementById("openAssignedBtn").addEventListener("click", openAssigned);

async function loadAssignedOrders() {
  const q = query(collection(db, "orders"), where("status", "==", "Atandı"));
  const snap = await getDocs(q);
  const sel = document.getElementById("assignedOrders");
  sel.innerHTML = "";
  snap.forEach(docu => sel.innerHTML += `<option value="${docu.id}">${docu.data().name}</option>`);
}

async function openAssigned() {
  const id = document.getElementById("assignedOrders").value;
  if (!id) return;
  document.getElementById("pickerArea").classList.remove("hidden");
  document.getElementById("pickerTitle").innerText = "Sipariş: " + id;

  const tbody = document.querySelector("#tbl-picker-lines tbody");
  tbody.innerHTML = "";
  // DEMO ürünler
  ["U001","U002"].forEach((c,i)=>{
    tbody.innerHTML += `<tr><td>${i+1}</td><td>${c}</td><td>Ürün ${c}</td><td>10</td><td contenteditable>0</td></tr>`;
  });
}

// ==== STOK AZALTMA FONKSİYONU ====
async function decreaseStock(code, qty) {
  const ref = doc(db, "stocks", code);
  const snap = await getDoc(ref);
  if (snap.exists()) {
    let newQty = snap.data().qty - qty;
    if (newQty < 0) newQty = 0;
    await updateDoc(ref, { qty: newQty });
    if (newQty < 5) {
      alert(`⚠️ Dikkat! ${code} stok azaldı. (Mevcut: ${newQty})`);
    }
  } else {
    alert(`Stok bulunamadı: ${code}`);
  }
}

document.getElementById("finishPickBtn").addEventListener("click", async () => {
  const id = document.getElementById("assignedOrders").value;

  // Sipariş ürünlerini oku ve stoktan düş
  document.querySelectorAll("#tbl-picker-lines tbody tr").forEach(row => {
    const code = row.children[1].innerText;
    const qty = parseInt(row.children[4].innerText) || 0;
    if (qty > 0) decreaseStock(code, qty);
  });

  await updateDoc(doc(db, "orders", id), { status: "Toplandı" });
  alert("Toplama bitti ve stok güncellendi!");
});

// Barkod scanner başlat
document.getElementById("startScanBtn").addEventListener("click", () => {
  if (!scanner) {
    scanner = new Html5Qrcode("reader");
    scanner.start({facingMode:"environment"},{fps:10,qrbox:250}, code=>{
      alert("Okutulan barkod: "+code);
    });
  }
});
document.getElementById("stopScanBtn").addEventListener("click", () => {
  if (scanner) { scanner.stop(); scanner.clear(); scanner=null; }
});

// ================== QC ==================
document.getElementById("refreshQCBtn").addEventListener("click", loadQCOrders);
document.getElementById("openQCBtn").addEventListener("click", openQC);

async function loadQCOrders() {
  const q = query(collection(db, "orders"), where("status", "==", "Toplandı"));
  const snap = await getDocs(q);
  const sel = document.getElementById("qcOrders");
  sel.innerHTML = "";
  snap.forEach(docu => sel.innerHTML += `<option value="${docu.id}">${docu.data().name}</option>`);
}

async function openQC() {
  const id = document.getElementById("qcOrders").value;
  if (!id) return;
  document.getElementById("qcArea").classList.remove("hidden");
  document.getElementById("qcTitle").innerText = "Sipariş: " + id;

  const tbody = document.querySelector("#tbl-qc-lines tbody");
  tbody.innerHTML = `
    <tr>
      <td>1</td><td>U001</td><td>Ürün 1</td><td>10</td><td>10</td>
      <td><input type="checkbox"/></td><td><input type="checkbox"/></td>
    </tr>`;
}

document.getElementById("finishQCBtn").addEventListener("click", async () => {
  const id = document.getElementById("qcOrders").value;
  await updateDoc(doc(db, "orders", id), { status: "Kontrol Tamam" });
  alert("QC bitti!");
});

// QC scanner
document.getElementById("startQCScanBtn").addEventListener("click", () => {
  if (!qcScanner) {
    qcScanner = new Html5Qrcode("qcReader");
    qcScanner.start({facingMode:"environment"},{fps:10,qrbox:250}, code=>{
      alert("QC Barkod: "+code);
    });
  }
});
document.getElementById("stopQCScanBtn").addEventListener("click", () => {
  if (qcScanner) { qcScanner.stop(); qcScanner.clear(); qcScanner=null; }
});

// ================== PALET ==================
document.getElementById("refreshPaletBtn").addEventListener("click", loadPaletOrders);
document.getElementById("openPaletBtn").addEventListener("click", openPalet);
document.getElementById("createPaletBtn").addEventListener("click", createPalet);

async function loadPaletOrders() {
  const q = query(collection(db, "orders"), where("status", "==", "Kontrol Tamam"));
  const snap = await getDocs(q);
  const sel = document.getElementById("paletOrders");
  sel.innerHTML = "";
  snap.forEach(docu => sel.innerHTML += `<option value="${docu.id}">${docu.data().name}</option>`);
}

async function openPalet() {
  const id = document.getElementById("paletOrders").value;
  if (!id) return;
  document.getElementById("paletArea").classList.remove("hidden");
  document.getElementById("paletTitle").innerText = "Sipariş: " + id;

  const tbody = document.querySelector("#tbl-palet-lines tbody");
  tbody.innerHTML = `<tr><td>1</td><td>U001</td><td>Ürün 1</td><td>10</td></tr>`;
}

async function createPalet() {
  const id = document.getElementById("paletOrders").value;
  const paletNo = "PLT-" + Date.now();
  await addDoc(collection(db, "pallets"), { orderId:id, paletNo, createdAt:serverTimestamp() });
  document.getElementById("paletResult").classList.remove("hidden");
  document.getElementById("paletNo").innerText = paletNo;
  QRCode.toCanvas(document.getElementById("paletQr"), paletNo, err=>{ if(err)console.error(err); });
}

// ================== DASHBOARD ==================
async function loadStocks() {
  const snap = await getDocs(collection(db, "stocks"));
  const tbody = document.querySelector("#tbl-stocks tbody");
  tbody.innerHTML = "";
  snap.forEach(docu => {
    const d = docu.data();
    tbody.innerHTML += `<tr><td>${d.code}</td><td>${d.name}</td><td>${d.qty}</td></tr>`;
  });
}

async function loadDashboard() {
  const ordersSnap = await getDocs(collection(db, "orders"));
  const palletsSnap = await getDocs(collection(db, "pallets"));

  let total=0, completed=0, pending=0;
  ordersSnap.forEach(docu=>{
    total++;
    const st=docu.data().status;
    if(st==="Kontrol Tamam") completed++;
    else pending++;
  });

  document.getElementById("statTotalOrders").innerText=total;
  document.getElementById("statCompletedOrders").innerText=completed;
  document.getElementById("statPendingOrders").innerText=pending;
  document.getElementById("statPallets").innerText=palletsSnap.size;

  // Grafikler
  const ctx1=document.getElementById("chartOrders");
  new Chart(ctx1,{
    type:"pie",
    data:{
      labels:["Tamamlanan","Bekleyen"],
      datasets:[{data:[completed,pending],backgroundColor:["#16a34a","#f87171"]}]
    }
  });

  const ctx2=document.getElementById("chartDaily");
  new Chart(ctx2,{
    type:"bar",
    data:{
      labels:["Gün1","Gün2"],
      datasets:[{label:"Sipariş",data:[3,5]}]
    }
  });

  await loadStocks();
}

setInterval(()=>{
  const v=document.getElementById("view-dashboard");
  if(v && !v.classList.contains("hidden")) loadDashboard();
},5000);
