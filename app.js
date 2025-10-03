// app.js — STABİL (Login + Şube Sipariş + Yönetici Listeleme + Toplayıcı)

// ================= NAV (mobil menü) =================
document.getElementById("menuToggle")?.addEventListener("click", () => {
  document.getElementById("mainNav")?.classList.toggle("show");
});

// ================= FIREBASE IMPORT =================
import {
  app, auth, db,
  signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged,
  collection, doc, setDoc, getDoc, getDocs, updateDoc, addDoc,
  query, where, serverTimestamp
} from "./firebase.js";

// ================= GLOBAL =================
let currentUser = null;
let orderDraft = [];     // şube sipariş satırları
let pickerOrder = null;  // toplayıcı sipariş

// ================= VIEW DEĞİŞTİR =================
function showView(id) {
  document.querySelectorAll(".view").forEach(v => v.classList.add("hidden"));
  document.getElementById(id)?.classList.remove("hidden");
}
document.querySelectorAll("nav button[data-view]").forEach(btn => {
  btn.addEventListener("click", () => showView(btn.dataset.view));
});

// ================= AUTH =================
document.getElementById("loginBtn")?.addEventListener("click", async () => {
  const email = document.getElementById("login-email").value;
  const pass  = document.getElementById("login-pass").value;
  try {
    await signInWithEmailAndPassword(auth, email, pass);
  } catch (err) {
    alert("Giriş hatası: " + (err.message || err));
  }
});

document.getElementById("registerBtn")?.addEventListener("click", async () => {
  const email = document.getElementById("reg-email").value;
  const pass  = document.getElementById("reg-pass").value;
  const role  = document.getElementById("reg-role").value;
  try {
    const userCred = await createUserWithEmailAndPassword(auth, email, pass);
    await setDoc(doc(db, "users", userCred.user.uid), {
      email, role, createdAt: serverTimestamp()
    });
    alert("Kayıt başarılı!");
  } catch (err) {
    alert("Kayıt hatası: " + (err.message || err));
  }
});

document.getElementById("logoutBtn")?.addEventListener("click", async () => {
  try { await signOut(auth); } catch (e) { console.error(e); }
});

// Oturum kontrol
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    currentUser = null;
    showView("view-login");
    return;
  }
  currentUser = user;

  let role = "sube";
  try {
    const udoc = await getDoc(doc(db, "users", user.uid));
    if (udoc.exists() && udoc.data()?.role) role = udoc.data().role;
  } catch (e) { console.warn("Rol okunamadı:", e); }

  if (role === "sube")      showView("view-branch");
  else if (role === "yonetici") { showView("view-manager"); loadAllOrders(); }
  else if (role === "toplayici") { showView("view-picker"); refreshAssigned(); }
  else                       showView("view-branch");
});

// ================= ŞUBE SİPARİŞ =================
function renderOrderDraft() {
  const tb = document.querySelector("#tbl-branch-lines tbody");
  if (!tb) return;
  tb.innerHTML = "";
  orderDraft.forEach((l, i) => {
    tb.innerHTML += `<tr>
      <td>${i + 1}</td><td>${l.code}</td><td>${l.name}</td><td>${l.qty}</td>
      <td><button class="danger" data-del="${i}">Sil</button></td>
    </tr>`;
  });
  tb.querySelectorAll("button[data-del]").forEach(btn => {
    btn.addEventListener("click", () => {
      const idx = parseInt(btn.dataset.del, 10);
      orderDraft.splice(idx, 1);
      renderOrderDraft();
    });
  });
}

document.getElementById("addLineBtn")?.addEventListener("click", () => {
  const code = document.getElementById("branchCode").value;
  const name = document.getElementById("branchName").value;
  const qty  = parseInt(document.getElementById("branchQty").value,10)||0;
  if (!code || qty<1) return alert("Kod ve miktar gerekli!");
  orderDraft.push({code,name,qty});
  renderOrderDraft();
});

document.getElementById("createOrderBtn")?.addEventListener("click", async ()=>{
  const name = document.getElementById("orderName").value;
  if (!name || orderDraft.length===0) return alert("Sipariş adı/satır eksik");
  await addDoc(collection(db,"orders"),{
    name,
    status:"Yeni",
    createdBy: currentUser.uid,
    createdAt: serverTimestamp(),
    lines: orderDraft.map(l=>({...l,picked:0}))
  });
  orderDraft=[];
  renderOrderDraft();
  alert("Sipariş oluşturuldu");
  loadBranchOrders();
});

async function loadBranchOrders() {
  if (!currentUser) return;
  const qy=query(collection(db,"orders"),where("createdBy","==",currentUser.uid));
  const snap=await getDocs(qy);
  const tb=document.querySelector("#branchOrders tbody");
  if(!tb) return;
  tb.innerHTML="";
  snap.forEach(d=>{
    const o=d.data();
    tb.innerHTML+=`<tr><td>${d.id}</td><td>${o.name}</td><td>${o.status}</td></tr>`;
  });
}

// ================= YÖNETİCİ =================
async function loadAllOrders() {
  const snap=await getDocs(collection(db,"orders"));
  const tb=document.querySelector("#tbl-orders tbody");
  if(!tb) return;
  tb.innerHTML="";
  snap.forEach(d=>{
    const o={id:d.id,...d.data()};
    tb.innerHTML+=`<tr>
      <td>${o.id}</td><td>${o.name}</td><td>${o.status}</td>
      <td>${o.status==="Yeni"?`<button onclick="assignOrder('${o.id}')">Ata</button>`:""}</td>
    </tr>`;
  });
}
window.assignOrder=async(id)=>{
  await updateDoc(doc(db,"orders",id),{status:"Atandı"});
  loadAllOrders();
};

// ================= TOPLAYICI =================
document.getElementById("refreshAssignedBtn")?.addEventListener("click",refreshAssigned);
document.getElementById("openAssignedBtn")?.addEventListener("click",openAssigned);
document.getElementById("manualAddBtn")?.addEventListener("click",manualAdd);
document.getElementById("finishPickBtn")?.addEventListener("click",finishPick);

async function refreshAssigned(){
  const sel=document.getElementById("assignedOrders");
  if(!sel) return;
  sel.innerHTML="";
  const qs=await getDocs(query(collection(db,"orders"),where("status","==","Atandı")));
  qs.forEach(d=>{
    const o={id:d.id,...d.data()};
    sel.insertAdjacentHTML("beforeend",`<option value="${o.id}">${o.id} - ${o.name}</option>`);
  });
}
async function openAssigned(){
  const id=document.getElementById("assignedOrders").value;
  if(!id) return;
  const ds=await getDoc(doc(db,"orders",id));
  if(!ds.exists()) return;
  pickerOrder={id:ds.id,...ds.data()};
  renderPickerLines();
}
function renderPickerLines(){
  const tb=document.querySelector("#tbl-picker-lines tbody");
  if(!tb) return;
  tb.innerHTML="";
  (pickerOrder.lines||[]).forEach((l,i)=>{
    tb.innerHTML+=`<tr>
      <td>${l.code}</td><td>${l.name}</td><td>${l.qty}</td>
      <td><input type="number" value="${l.picked||0}" data-idx="${i}" class="picked-input"/></td>
      <td><button data-plus="${i}">+1</button><button data-minus="${i}">-1</button><button data-del="${i}">Sil</button></td>
    </tr>`;
  });

  tb.querySelectorAll(".picked-input").forEach(inp=>{
    inp.addEventListener("input",e=>{
      const i=parseInt(e.target.dataset.idx,10);
      pickerOrder.lines[i].picked=parseInt(e.target.value,10)||0;
    });
  });
  tb.querySelectorAll("button[data-plus]").forEach(btn=>{
    btn.addEventListener("click",()=>{
      const i=parseInt(btn.dataset.plus,10);
      pickerOrder.lines[i].picked=(pickerOrder.lines[i].picked||0)+1;
      renderPickerLines();
    });
  });
  tb.querySelectorAll("button[data-minus]").forEach(btn=>{
    btn.addEventListener("click",()=>{
      const i=parseInt(btn.dataset.minus,10);
      let v=(pickerOrder.lines[i].picked||0)-1;
      if(v<0) v=0;
      pickerOrder.lines[i].picked=v;
      renderPickerLines();
    });
  });
  tb.querySelectorAll("button[data-del]").forEach(btn=>{
    btn.addEventListener("click",()=>{
      const i=parseInt(btn.dataset.del,10);
      pickerOrder.lines.splice(i,1);
      renderPickerLines();
    });
  });
}
async function manualAdd(){
  const code=document.getElementById("manualScanCode").value.trim();
  let qty=parseInt(document.getElementById("manualScanQty").value,10);
  if(!pickerOrder) return alert("Önce sipariş aç");
  if(!code) return;
  if(!qty||qty<1) qty=1;
  pickerOrder.lines.push({code,name:"(Elle)",qty, picked:qty});
  renderPickerLines();
}
async function finishPick(){
  if(!pickerOrder) return;
  await updateDoc(doc(db,"orders",pickerOrder.id),{
    status:"Toplandı",
    lines: pickerOrder.lines
  });
  alert("Toplama tamamlandı!");
}

// ================= BAŞLANGIÇ =================
showView("view-login");
console.log("app.js (stabil) yüklendi ✓");
