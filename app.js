import {
  auth, db,
  signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged,
  collection, doc, setDoc, getDoc, getDocs, query, where, addDoc, updateDoc, serverTimestamp, orderBy
} from './firebase.js';

const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const hidden = (el, v = true) => el.classList.toggle("hidden", v);

let currentUser = null;
let currentRole = null;
let productsCache = {}; // code -> {code,name,barcode,reyon}
let barcodeIndex = {};  // barcode -> code
let scanner = null;
let currentOrder = null;

// nav
document.addEventListener("click", (e)=>{
  const btn = e.target.closest("button[data-view]");
  if(!btn) return;
  showView(btn.getAttribute("data-view"));
});

document.addEventListener("DOMContentLoaded", () => {
  bindLogin();
  bindBranch();
  bindManager();
  bindPicker();
  onAuthStateChanged(auth, onAuthChange);
});

function showView(id){
  $$(".view").forEach(v => v.classList.add("hidden"));
  $("#"+id)?.classList.remove("hidden");
}

// Login
function bindLogin(){
  $("#loginBtn")?.addEventListener("click", async ()=>{
    const email = $("#login-email").value.trim();
    const pass = $("#login-pass").value.trim();
    try{ await signInWithEmailAndPassword(auth, email, pass); }catch(e){ alert(e.message); }
  });
  $("#registerBtn")?.addEventListener("click", async ()=>{
    const email = $("#reg-email").value.trim();
    const pass = $("#reg-pass").value.trim();
    const role = $("#reg-role").value;
    try{
      const cred = await createUserWithEmailAndPassword(auth, email, pass);
      await setDoc(doc(db,"users",cred.user.uid), { email, role, createdAt: serverTimestamp() });
      alert("Kullanıcı oluşturuldu");
    }catch(e){ alert(e.message); }
  });
  $("#logoutBtn")?.addEventListener("click", async ()=>{ await signOut(auth); });
}

async function onAuthChange(user){
  if(!user){ showView("view-login"); currentUser=null; return; }
  currentUser = user;
  const u = await getDoc(doc(db,"users",user.uid));
  currentRole = u.exists()? u.data().role : null;
  if(!currentRole){ alert("Rol atanmamış"); return; }

  await loadProductsCache();

  if(currentRole==="sube") showView("view-branch");
  if(currentRole==="yonetici") { showView("view-manager"); refreshOrders(); loadPickers(); }
  if(currentRole==="toplayici") { showView("view-picker"); refreshMyOrders(); }
  $("#logoutBtn").classList.remove("hidden");
}

// Products cache
async function loadProductsCache(){
  productsCache = {}; barcodeIndex = {};
  const snap = await getDocs(collection(db,"products"));
  snap.forEach(d=>{
    const p = d.data();
    productsCache[p.code] = {code:p.code, name:p.name||"", barcode:p.barcode||"", reyon:p.reyon||""};
    if(p.barcode) barcodeIndex[p.barcode] = p.code;
  });
  // branch search list
  const dl = $("#productsList"); if(dl){
    dl.innerHTML = "";
    Object.values(productsCache).forEach(p=>{
      const opt = document.createElement("option");
      opt.value = `${p.code} - ${p.name}`;
      dl.appendChild(opt);
    });
  }
}

// Branch
function bindBranch(){
  $("#addProductBtn")?.addEventListener("click", ()=>{
    const val = $("#productSearch").value.trim();
    const qty = Math.max(1, parseInt($("#productQty").value)||0);
    if(!val) return alert("Ürün seç");
    const code = val.split(" - ")[0];
    const p = productsCache[code];
    if(!p) return alert("Ürün bulunamadı");
    // merge same code
    const rows = $$("#tbl-order-lines tbody tr");
    const exist = Array.from(rows).find(r => r.children[1].textContent.trim()===code);
    if(exist){
      const cell = exist.children[3];
      cell.textContent = String((parseInt(cell.textContent)||0)+qty);
    }else{
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${rows.length+1}</td><td>${p.code}</td><td>${p.name}</td><td contenteditable="true">${qty}</td><td><button class="btn-light btn-del">Sil</button></td>`;
      tr.querySelector(".btn-del").addEventListener("click", ()=>{
        if(!confirm("Silmek istediğine emin misin?")) return;
        tr.remove(); renumberRows();
      });
      $("#tbl-order-lines tbody").appendChild(tr);
    }
    $("#productSearch").value=""; $("#productQty").value="1";
  });

  $("#clearLinesBtn")?.addEventListener("click", ()=>{
    if(!confirm("Tüm satırlar silinsin mi?")) return;
    $("#tbl-order-lines tbody").innerHTML="";
  });

  $("#saveOrderBtn")?.addEventListener("click", async ()=>{
    const name = $("#order-name").value.trim() || ("SIP-"+Date.now());
    const rows = $$("#tbl-order-lines tbody tr");
    if(!rows.length) return alert("Satır yok");
    const lines = [];
    rows.forEach(r=>{
      const code = r.children[1].textContent.trim();
      const p = productsCache[code]||{};
      const qty = parseFloat(r.children[3].textContent.replace(",","."))||0;
      lines.push({ code, name:p.name||"", qty, barcode:p.barcode||"", reyon:p.reyon||"" });
    });
    await addDoc(collection(db,"orders"), { name, branch: currentUser.email, status:"Yeni", assignedTo:"", lines, createdAt: serverTimestamp() });
    $("#tbl-order-lines tbody").innerHTML=""; $("#order-name").value="";
    alert("Sipariş kaydedildi");
  });
}

function renumberRows(){
  const rows = $$("#tbl-order-lines tbody tr");
  rows.forEach((r,i)=> r.children[0].textContent = String(i+1));
}

// Manager
function bindManager(){
  $("#refreshOrdersBtn")?.addEventListener("click", refreshOrders);
  $("#assignBtn")?.addEventListener("click", assignSelected);
  $("#moveToQCBtn")?.addEventListener("click", moveToQC);
  $("#markDoneBtn")?.addEventListener("click", markDoneSelected);
}

async function refreshOrders(){
  const tb = $("#tbl-orders tbody"); tb.innerHTML="";
  const qs = await getDocs(query(collection(db,"orders"), orderBy("createdAt","desc")));
  qs.forEach(d=>{
    const o = {id:d.id, ...d.data()};
    const tr = document.createElement("tr");
    tr.innerHTML = `<td><input type="checkbox" data-id="${o.id}"/></td>
      <td>${o.id}</td><td>${o.name}</td><td>${o.branch}</td><td>${o.status}</td><td>${o.assignedTo||"-"}</td>
      <td>${o.lines?.length||0}</td><td>${o.createdAt?.toDate?.().toLocaleString?.()||""}</td>`;
    tb.appendChild(tr);
  });
}

async function loadPickers(){
  const sel = $("#assignUser"); sel.innerHTML="";
  const qs = await getDocs(query(collection(db,"users"), where("role","==","toplayici")));
  qs.forEach(u=>{
    const opt = document.createElement("option");
    opt.value = u.id; opt.textContent = u.data().email;
    sel.appendChild(opt);
  });
}

async function assignSelected(){
  const uid = $("#assignUser").value;
  const checks = $$("#tbl-orders tbody input:checked");
  if(!uid || !checks.length) return alert("Toplayıcı ve sipariş seç");
  for (const c of checks){
    await updateDoc(doc(db,"orders", c.dataset.id), { assignedTo: uid, status: "Atandı" });
  }
  await refreshOrders();
}

async function moveToQC(){
  const checks = $$("#tbl-orders tbody input:checked");
  for (const c of checks){
    await updateDoc(doc(db,"orders", c.dataset.id), { status: "Kontrol" });
  }
  await refreshOrders();
}

async function markDoneSelected(){
  const checks = $$("#tbl-orders tbody input:checked");
  for (const c of checks){
    await updateDoc(doc(db,"orders", c.dataset.id), { status: "Tamamlandı" });
  }
  await refreshOrders();
}

// Picker
function bindPicker(){
  $("#refreshMyBtn")?.addEventListener("click", refreshMyOrders);
  $("#openOrderBtn")?.addEventListener("click", openSelectedOrder);
  $("#startScanBtn")?.addEventListener("click", startScanner);
  $("#stopScanBtn")?.addEventListener("click", stopScanner);
  $("#manualAddBtn")?.addEventListener("click", ()=>{
    const v = $("#manualBarcode").value.trim();
    if(!v) return;
    onScan(v); $("#manualBarcode").value="";
  });
  $("#exportCsvBtn")?.addEventListener("click", exportCsv);
  $("#completeBtn")?.addEventListener("click", completePicking);
}

async function refreshMyOrders(){
  const sel = $("#myOrders"); sel.innerHTML="";
  const qs = await getDocs(query(collection(db,"orders"), where("assignedTo","==", currentUser?.uid||"")));
  qs.forEach(d=>{
    const o = {id:d.id, ...d.data()};
    const opt = document.createElement("option");
    opt.value = o.id; opt.textContent = `${o.id} • ${o.name} • ${o.status}`;
    sel.appendChild(opt);
  });
}

async function openSelectedOrder(){
  const id = $("#myOrders").value; if(!id) return alert("Sipariş seç");
  const ds = await getDoc(doc(db,"orders", id));
  if(!ds.exists()) return alert("Bulunamadı");
  currentOrder = { id: ds.id, ...ds.data() };
  // status 'Toplanıyor'
  if(currentOrder.status==="Atandı"){
    await updateDoc(doc(db,"orders", id), { status: "Toplanıyor" });
    currentOrder.status = "Toplanıyor";
  }
  // enrich lines
  currentOrder.lines = currentOrder.lines.map(ln=>{
    const p = productsCache[ln.code]||{};
    return { ...ln, name: ln.name||p.name||"", barcode: ln.barcode||p.barcode||"", reyon: ln.reyon||p.reyon||"", picked: ln.picked||0 };
  });
  renderPickTable();
  $("#pickTitle").textContent = `Sipariş: ${currentOrder.name} (${currentOrder.id})`;
  $("#pickingArea").classList.remove("hidden");
}

function renderPickTable(){
  const tb = $("#tbl-pick-lines tbody"); tb.innerHTML="";
  const parseReyon = (s)=>{ const m=(s||"").match(/([A-Za-z]+)(\d+)\.(\d+)/); return m?[m[1],+m[2],+m[3]]:[s||"",0,0]; };
  currentOrder.lines.sort((a,b)=>{
    const A=parseReyon(a.reyon), B=parseReyon(b.reyon);
    if(A[0]!==B[0]) return A[0].localeCompare(B[0]); if(A[1]!==B[1]) return A[1]-B[1]; return A[2]-B[2];
  });
  currentOrder.lines.forEach((ln,i)=>{
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${i+1}</td><td>${ln.code}</td><td>${ln.name}</td><td>${ln.reyon||""}</td>
      <td>${ln.qty}</td>
      <td class="picked">${ln.picked||0}</td>
      <td class="miss">${(ln.qty> (ln.picked||0))? (ln.qty-(ln.picked||0)) : 0}</td>
      <td>
        <button class="btn-light btn-plus" data-i="${i}">+</button>
        <button class="btn-light btn-minus" data-i="${i}">-</button>
      </td>`;
    tb.appendChild(tr);
  });
  tb.addEventListener("click", (e)=>{
    const b = e.target.closest(".btn-plus, .btn-minus");
    if(!b) return;
    const i = +b.dataset.i;
    if(b.classList.contains("btn-plus")) currentOrder.lines[i].picked = (currentOrder.lines[i].picked||0)+1;
    if(b.classList.contains("btn-minus")) currentOrder.lines[i].picked = Math.max(0,(currentOrder.lines[i].picked||0)-1);
    // update row
    const row = tb.children[i];
    row.querySelector(".picked").textContent = currentOrder.lines[i].picked;
    row.querySelector(".miss").textContent = Math.max(0, currentOrder.lines[i].qty - currentOrder.lines[i].picked);
    row.classList.add("toplandi"); setTimeout(()=>row.classList.remove("toplandi"), 600);
  }, { once:true });
}

async function startScanner(){
  if(scanner) await stopScanner();
  const el = $("#reader"); scanner = new Html5Qrcode(el.id);
  try{
    await scanner.start({ facingMode:"environment" }, { fps:10, qrbox:250 }, onScan);
  }catch(e){
    await scanner.start({ facingMode:"user" }, { fps:10, qrbox:250 }, onScan);
  }
}
function stopScanner(){ if(!scanner) return; return scanner.stop().then(()=>{ scanner.clear(); scanner=null; }); }

function onScan(text){
  if(!currentOrder) return;
  const barcode = String(text).trim();
  // match barcode -> line
  let idx = currentOrder.lines.findIndex(ln => ln.barcode && ln.barcode===barcode);
  if(idx===-1 && barcodeIndex[barcode]){
    const code = barcodeIndex[barcode];
    idx = currentOrder.lines.findIndex(ln => ln.code===code);
  }
  if(idx===-1){ alert("Barkod siparişte yok: "+barcode); return; }
  currentOrder.lines[idx].picked = (currentOrder.lines[idx].picked||0)+1;
  // update UI
  const row = $("#tbl-pick-lines tbody").children[idx];
  row.querySelector(".picked").textContent = currentOrder.lines[idx].picked;
  row.querySelector(".miss").textContent = Math.max(0, currentOrder.lines[idx].qty - currentOrder.lines[idx].picked);
  row.classList.add("toplandi"); setTimeout(()=>row.classList.remove("toplandi"), 600);
}

async function completePicking(){
  if(!currentOrder) return;
  // status → Kontrol (yönetici butonundan da yapılabilir)
  await updateDoc(doc(db,"orders", currentOrder.id), { lines: currentOrder.lines, status: "Kontrol" });
  alert("Toplama bitti, sipariş Kontrol aşamasına alındı");
}

function exportCsv(){
  if(!currentOrder) return;
  const rows = [["Kod","Ürün","Reyon","İstenen","Toplanan","Eksik"]];
  currentOrder.lines.forEach(ln=> rows.push([ln.code, ln.name, ln.reyon||"", ln.qty, ln.picked||0, Math.max(0, ln.qty-(ln.picked||0))]));
  const csv = rows.map(r => r.map(v => typeof v === "string" ? `"${v.replace(/"/g,'""')}"` : v).join(";")).join("\n");
  const blob = new Blob(["\ufeff"+csv], {type:"text/csv;charset=utf-8;"});
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `siparis_${currentOrder.id}.csv`; a.click();
}
