// Basit in-memory kullanıcılar (demo)
const users = [
  { username: "yonetici", password: "1234", role: "yonetici" },
  { username: "sube", password: "1234", role: "sube" },
  { username: "toplayici", password: "1234", role: "toplayici" },
];

// localStorage anahtarları
const LS_ORDERS = "mvp_orders";
const LS_CATALOG = "mvp_catalog";

// Basit yardımcılar
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));
const hidden = (el, v=true) => el.classList.toggle("hidden", v);

// State
let currentUser = null;
let scanner = null;
let currentOrderId = null;

// --- INIT ---
document.addEventListener("DOMContentLoaded", () => {
  bindLogin();
  bindSube();
  bindYonetici();
  bindToplayici();
  restoreSession();
});

function restoreSession(){
  const u = sessionStorage.getItem("mvp_user");
  if (u){
    currentUser = JSON.parse(u);
    $("#userInfo").textContent = `${currentUser.username} (${currentUser.role})`;
    hidden($("#userArea"), false);
    routeByRole();
  } else {
    showView("view-login");
  }
}

function routeByRole(){
  if (!currentUser) return showView("view-login");
  if (currentUser.role === "sube") showView("view-sube");
  if (currentUser.role === "yonetici") { showView("view-yonetici"); renderOrdersTable(); renderAssignUsers(); }
  if (currentUser.role === "toplayici") { showView("view-toplayici"); renderMyOrders(); }
}

function showView(id){
  $$(".view").forEach(v => hidden(v, true));
  hidden($("#" + id), false);
}

// --- LOGIN ---
function bindLogin(){
  $("#loginBtn").addEventListener("click", () => {
    const u = $("#login-username").value.trim();
    const p = $("#login-password").value.trim();
    const found = users.find(x => x.username === u && x.password === p);
    if(!found){ alert("Kullanıcı adı/şifre hatalı"); return; }
    currentUser = { username: found.username, role: found.role };
    sessionStorage.setItem("mvp_user", JSON.stringify(currentUser));
    $("#userInfo").textContent = `${currentUser.username} (${currentUser.role})`;
    hidden($("#userArea"), false);
    routeByRole();
  });
  $("#logoutBtn").addEventListener("click", () => {
    sessionStorage.removeItem("mvp_user");
    currentUser = null;
    showView("view-login");
    // Scanner kapat
    stopScanner();
  });
}

// --- SUBE (Sipariş oluştur) ---
function bindSube(){
  $("#addLineBtn")?.addEventListener("click", () => addOrderLine());
  $("#clearLinesBtn")?.addEventListener("click", () => $("#tbl-order-lines tbody").innerHTML = "");
  $("#saveOrderBtn")?.addEventListener("click", saveOrder);
  $("#catalogFile")?.addEventListener("change", loadCatalog);
  // ilk satır
  if ($("#view-sube")) addOrderLine();
}

function addOrderLine(){
  const tb = $("#tbl-order-lines tbody");
  const tr = document.createElement("tr");
  const idx = tb.children.length + 1;
  tr.innerHTML = `
    <td>${idx}</td>
    <td contenteditable="true" class="td-barkod"></td>
    <td contenteditable="true" class="td-urun"></td>
    <td contenteditable="true" class="td-miktar">1</td>
    <td><button class="btn btn-light btn-del">Sil</button></td>
  `;
  tr.querySelector(".btn-del").addEventListener("click", ()=> tr.remove());
  // barkoddan ürün adı otomatik
  tr.querySelector(".td-barkod").addEventListener("input", (e)=>{
    const code = e.target.textContent.trim();
    const cat = getCatalog();
    if (cat[code]) tr.querySelector(".td-urun").textContent = cat[code];
  });
  $("#tbl-order-lines tbody").appendChild(tr);
}

function loadCatalog(e){
  const f = e.target.files[0];
  if (!f) return;
  const reader = new FileReader();
  reader.onload = (ev)=> {
    try {
      const obj = JSON.parse(ev.target.result);
      localStorage.setItem(LS_CATALOG, JSON.stringify(obj));
      alert("Katalog yüklendi. Barkodu yazınca ürün adı otomatik gelir.");
    } catch(err){
      alert("JSON okunamadı: " + err);
    }
  };
  reader.readAsText(f, "utf-8");
}
function getCatalog(){
  try { return JSON.parse(localStorage.getItem(LS_CATALOG) || "{}"); }
  catch { return {}; }
}

function saveOrder(){
  const name = $("#order-customer").value.trim() || ("SIP-" + Date.now());
  const rows = $$("#tbl-order-lines tbody tr");
  if (rows.length === 0){ alert("Satır yok."); return; }
  const lines = [];
  for (const r of rows){
    const barkod = (r.querySelector(".td-barkod")?.textContent || "").trim();
    const urun   = (r.querySelector(".td-urun")?.textContent || "").trim();
    const miktar = parseFloat((r.querySelector(".td-miktar")?.textContent || "0").replace(",", "."));
    if (!barkod || !miktar){ alert("Barkod ve miktar zorunlu."); return; }
    lines.push({ barcode: barkod, name: urun || getCatalog()[barkod] || "Tanımsız", qty: miktar, picked: 0, missing: 0 });
  }
  const orders = getOrders();
  const id = "O" + (orders.length + 1) + "-" + Date.now();
  orders.push({
    id, name, byBranch: currentUser?.username || "sube",
    assignedTo: "", status: "Yeni", createdAt: new Date().toISOString(), lines
  });
  setOrders(orders);
  $("#tbl-order-lines tbody").innerHTML = "";
  $("#order-customer").value = "";
  addOrderLine();
  alert("Sipariş kaydedildi.");
}

// --- YONETICI (Siparişler & Atama) ---
function bindYonetici(){
  $("#refreshOrdersBtn")?.addEventListener("click", renderOrdersTable);
  $("#assignSelectedBtn")?.addEventListener("click", assignSelected);
}
function renderAssignUsers(){
  const sel = $("#assignUserSelect");
  if (!sel) return;
  sel.innerHTML = "";
  const pickers = users.filter(u => u.role === "toplayici");
  for (const p of pickers){
    const opt = document.createElement("option");
    opt.value = p.username;
    opt.textContent = `Ata: ${p.username}`;
    sel.appendChild(opt);
  }
}
function renderOrdersTable(){
  const tb = $("#tbl-orders tbody");
  if (!tb) return;
  tb.innerHTML = "";
  const orders = getOrders();
  for (const o of orders){
    const tr = document.createElement("tr");
    const linesCount = o.lines.length;
    tr.innerHTML = `
      <td><input type="checkbox" class="chk-assign" data-id="${o.id}"/></td>
      <td>${o.id}</td>
      <td>${escapeHtml(o.name)}</td>
      <td>${escapeHtml(o.byBranch)}</td>
      <td>${o.status}</td>
      <td>${o.assignedTo || "-"}</td>
      <td>${linesCount}</td>
      <td>${new Date(o.createdAt).toLocaleString()}</td>
    `;
    tb.appendChild(tr);
  }
}
function assignSelected(){
  const assignee = $("#assignUserSelect").value;
  if (!assignee){ alert("Atanacak kullanıcı seç."); return; }
  const checks = $$(".chk-assign:checked");
  if (checks.length === 0){ alert("Sipariş seç."); return; }
  const orders = getOrders();
  checks.forEach(chk => {
    const id = chk.getAttribute("data-id");
    const o = orders.find(x => x.id === id);
    if (o){
      o.assignedTo = assignee;
      if (o.status === "Yeni") o.status = "Atandı";
    }
  });
  setOrders(orders);
  renderOrdersTable();
  alert("Atama yapıldı.");
}

// --- TOPLAYICI (Picking) ---
function bindToplayici(){
  $("#refreshMyOrdersBtn")?.addEventListener("click", renderMyOrders);
  $("#openOrderBtn")?.addEventListener("click", openSelectedOrder);
  $("#startScanBtn")?.addEventListener("click", startScanner);
  $("#stopScanBtn")?.addEventListener("click", stopScanner);
  $("#manualAddBtn")?.addEventListener("click", () => {
    const code = $("#manualBarcode").value.trim();
    if (!code) return;
    handleScanned(code);
    $("#manualBarcode").value = "";
  });
  $("#exportCsvBtn")?.addEventListener("click", exportCsv);
  $("#completeOrderBtn")?.addEventListener("click", completeOrder);
}

function renderMyOrders(){
  const sel = $("#myOrdersSelect");
  if (!sel) return;
  sel.innerHTML = "";
  const orders = getOrders().filter(o => o.assignedTo === currentUser?.username);
  for (const o of orders){
    const opt = document.createElement("option");
    opt.value = o.id;
    opt.textContent = `${o.id} • ${o.name} • ${o.status}`;
    sel.appendChild(opt);
  }
}

function openSelectedOrder(){
  const id = $("#myOrdersSelect").value;
  if (!id){ alert("Sipariş seç."); return; }
  currentOrderId = id;
  const order = getOrders().find(o => o.id === id);
  $("#pickOrderTitle").textContent = `Sipariş: ${order.name} (${order.id})`;
  renderPickTable(order);
  hidden($("#pickingArea"), false);
}
function renderPickTable(order){
  const tb = $("#tbl-pick-lines tbody");
  tb.innerHTML = "";
  order.lines.forEach((ln, i) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${i+1}</td>
      <td>${ln.barcode}</td>
      <td>${escapeHtml(ln.name)}</td>
      <td>${ln.qty}</td>
      <td contenteditable="true" class="td-picked">${ln.picked || 0}</td>
      <td><input type="checkbox" class="chk-missing" ${ln.missing ? "checked":""}></td>
      <td><input type="checkbox" class="chk-done" ${ln.picked >= ln.qty ? "checked":""}></td>
    `;
    tb.appendChild(tr);
  });
}

async function startScanner(){
  if (scanner) await stopScanner();
  const readerEl = $("#reader");
  scanner = new Html5Qrcode(readerEl.id);
  try {
    await scanner.start({ facingMode: "environment" }, { fps: 10, qrbox: 250 }, (code)=> handleScanned(code));
  } catch (e){
    console.warn("Arka kamera açılmadı, ön dene", e);
    await scanner.start({ facingMode: "user" }, { fps: 10, qrbox: 250 }, (code)=> handleScanned(code));
  }
}
function stopScanner(){
  if (!scanner) return;
  return scanner.stop().then(()=> { scanner.clear(); scanner = null; });
}

function handleScanned(barcode){
  if (!currentOrderId) return;
  const orders = getOrders();
  const o = orders.find(x => x.id === currentOrderId);
  if (!o) return;
  // ilgili satırı bul
  const idx = o.lines.findIndex(ln => ln.barcode === barcode);
  if (idx === -1){ alert("Bu barkod siparişte yok: " + barcode); return; }
  const ln = o.lines[idx];
  ln.picked = (ln.picked || 0) + 1;
  if (ln.picked >= ln.qty) { ln.missing = 0; }
  setOrders(orders);
  renderPickTable(o);
  // satıra highlight
  const row = $("#tbl-pick-lines tbody").children[idx];
  row.classList.add("toplandi");
  row.scrollIntoView({ behavior:"smooth", block:"center" });
  setTimeout(()=> row.classList.remove("toplandi"), 800);
}

function exportCsv(){
  const id = $("#myOrdersSelect").value;
  if (!id){ alert("Sipariş seç."); return; }
  const o = getOrders().find(x => x.id === id);
  const rows = [["Barkod","Ürün","İstenen","Toplanan","Eksik"]];
  for (const ln of o.lines){
    rows.push([ln.barcode, ln.name, ln.qty, ln.picked || 0, ln.missing ? "Evet" : ""]);
  }
  const csv = rows.map(r => r.map(v => typeof v === "string" ? `"${v.replace(/"/g,'""')}"` : v).join(";")).join("\n");
  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `siparis_${o.id}.csv`;
  a.click();
}

function completeOrder(){
  if (!currentOrderId) return;
  // tabloda manuel güncellenen picked/missing'i state'e yaz
  const orders = getOrders();
  const o = orders.find(x => x.id === currentOrderId);
  const trs = $$("#tbl-pick-lines tbody tr");
  o.lines.forEach((ln, i) => {
    const picked = parseFloat(trs[i].querySelector(".td-picked").textContent.replace(",", ".")) || 0;
    const missing = trs[i].querySelector(".chk-missing").checked ? 1 : 0;
    const done = trs[i].querySelector(".chk-done").checked ? 1 : 0;
    ln.picked = picked;
    ln.missing = missing;
    if (done && picked >= ln.qty) ln.missing = 0;
  });
  // sipariş durumu
  const allDone = o.lines.every(ln => (ln.picked || 0) >= ln.qty || ln.missing);
  o.status = allDone ? "Tamamlandı" : "Kısmi";
  setOrders(orders);
  alert("Sipariş güncellendi: " + o.status);
}

// --- storage helpers ---
function getOrders(){
  try { return JSON.parse(localStorage.getItem(LS_ORDERS) || "[]"); }
  catch { return []; }
}
function setOrders(arr){
  localStorage.setItem(LS_ORDERS, JSON.stringify(arr));
}

// escape
function escapeHtml(s){
  return (s||"").replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
}
