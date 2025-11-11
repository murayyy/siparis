/*
 app.js — Depo Otomasyonu (Web) — TAM SÜRÜM (tek dosya)
 ---------------------------------------------------------------------
 Bu dosya, Firebase (Auth + Firestore) üzerinde çalışan kapsamlı bir depo
 otomasyonu uyg.
 
 Özellikler (özet):
  - Firebase Auth e‑posta/şifre girişi
  - Rol bazlı görünüm (manager, picker, qc) — kullanıcı profili belgesinden
  - Firestore koleksiyonları: users, orders, order_items, ek_depo, logs
  - Sipariş CRUD (oluşturma, güncelleme, silme, arşivleme)
  - Toplayıcı akışı: ata → picking → picked
  - QC akışı: picked → qc/approved → completed
  - Ek Depo (eksik ürünlerin yönetimi ve kontrole aktarma)
  - Offline queue (net yokken yerel kuyruk ve yeniden gönderim)
  - Yerel cache (IndexedDB üzerinden basit anahtar/değer)
  - CSV/Excel dışa aktarma, yazdırma fişi
  - Kamera ile barkod/QR okuma (getUserMedia + BarcodeDetector fallback)
  - Bildirim (Notification API), sesli uyarı
  - Basit RBAC (manager görür, picker sadece kendi atanan siparişleri görür)
  - Hata günlüğü ve olay loglama (logs)
  - PWA kancaları (manifest + service worker bekler)
  - UI bağlayıcıları: index.html’deki id’ler ile tam uyum

 Notlar:
  - Firebase modülünü (firebase.js) v9 modular importlarıyla dışa aktaracak
    şekilde hazırladığın varsayılır.
  - Koleksiyon isimleri: 'users', 'orders', 'order_items', 'ek_depo', 'logs'
  - Güvenlik için Firestore rules düzenlenmelidir (örnek ayrı dosyada olmalı).
  - Kod büyük; üretimde parçalara ayırman tavsiye edilir.
 ---------------------------------------------------------------------
*/

// =============================
//  Firebase Modül İçe Aktarım
// =============================
import {
  auth, db,
  signInWithEmailAndPassword, signOut, onAuthStateChanged,
  collection, doc, addDoc, getDoc, getDocs, updateDoc, deleteDoc,
  serverTimestamp, query, where, orderBy, limit,
} from './firebase.js';

// =============================
//  Yardımcı Kısa Seçiciler
// =============================
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

function el(tag, attrs = {}, ...children){
  const e = document.createElement(tag);
  Object.entries(attrs).forEach(([k,v]) => {
    if (k.startsWith('on') && typeof v === 'function') {
      e.addEventListener(k.substring(2).toLowerCase(), v);
    } else if (k === 'className') {
      e.className = v;
    } else if (v !== undefined && v !== null) {
      e.setAttribute(k, v);
    }
  });
  for (const c of children){
    if (Array.isArray(c)) c.forEach((x)=>e.append(x));
    else if (c instanceof Node) e.append(c);
    else if (c !== undefined && c !== null) e.append(String(c));
  }
  return e;
}

// =============================
//  Global Durum
// =============================
const state = {
  user: null,           // Firebase user
  userDoc: null,        // users koleksiyonundaki profil {role, displayName, ...}
  unsubOrders: null,    // snapshot listener temizleyici (gelecek genişleme)
  cache: new Map(),     // hızlı bellek önbelleği
  online: navigator.onLine,
  pendingQueue: [],     // offline işlemler kuyruğu
  scanner: null,        // camera scanner handle
};

// =============================
//  UI Köprüleri (index.html id’leri)
// =============================
const ui = {
  loginSection: $('#loginSection'),
  ordersSection: $('#ordersSection'),
  loginMsg: $('#loginMsg'),
  orderList: $('#orderList'),
  email: $('#email'),
  password: $('#password'),
  signinBtn: $('#signinBtn'),
  btnLogin: $('#btnLogin'),
  btnLogout: $('#btnLogout'),
  btnNewOrder: $('#btnNewOrder'),
  orderModal: $('#orderModal'),
  branchInput: $('#branchInput'),
  productInput: $('#productInput'),
  qtyInput: $('#qtyInput'),
  saveOrderBtn: $('#saveOrderBtn'),
  cancelOrderBtn: $('#cancelOrderBtn'),
};

// =============================
//  Basit Logger ve Hata Yakalama
// =============================
function logInfo(message, data){
  console.info('[INFO]', message, data||'');
  writeLog({level:'info', message, data}).catch(console.error);
}
function logError(message, err){
  console.error('[ERROR]', message, err);
  writeLog({level:'error', message, data:String(err)}).catch(()=>{});
}

async function writeLog(entry){
  try{
    const colRef = collection(db, 'logs');
    await addDoc(colRef, {...entry, ts: serverTimestamp(), uid: state.user?.uid||null});
  }catch(e){
    // offline ise sessize al
  }
}

// =============================
//  Offline Kuyruk & Basit Cache
// =============================
const cacheStore = (()=>{
  // Basit IndexedDB KV-store
  const DB = 'depo_cache_db';
  const STORE = 'kv';
  let dbi = null;

  function open(){
    return new Promise((resolve, reject)=>{
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = ()=>{
        const db = req.result;
        if(!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      req.onsuccess = ()=>{ dbi = req.result; resolve(); };
      req.onerror = ()=> reject(req.error);
    });
  }
  async function ready(){ if(!dbi) await open(); }
  async function set(key, val){
    await ready();
    return new Promise((resolve, reject)=>{
      const tx = dbi.transaction(STORE,'readwrite');
      tx.objectStore(STORE).put(val, key);
      tx.oncomplete = ()=>resolve(); tx.onerror = ()=>reject(tx.error);
    });
  }
  async function get(key){
    await ready();
    return new Promise((resolve, reject)=>{
      const tx = dbi.transaction(STORE,'readonly');
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = ()=>resolve(req.result);
      req.onerror = ()=>reject(req.error);
    });
  }
  return { set, get };
})();

function enqueue(op){
  state.pendingQueue.push(op);
  cacheStore.set('pendingQueue', state.pendingQueue).catch(()=>{});
}

async function flushQueue(){
  if(!state.online || state.pendingQueue.length===0) return;
  const copy = [...state.pendingQueue];
  state.pendingQueue.length = 0;
  for(const op of copy){
    try{ await op(); }
    catch(e){ logError('Kuyruk görevi başarısız, tekrar kuyruğa alınıyor', e); enqueue(op); }
  }
  cacheStore.set('pendingQueue', state.pendingQueue).catch(()=>{});
}

window.addEventListener('online', ()=>{ state.online = true; flushQueue(); });
window.addEventListener('offline', ()=>{ state.online = false; });

// =============================
//  RBAC & Yardımcılar
// =============================
const ROLES = { MANAGER: 'manager', PICKER: 'picker', QC: 'qc' };

function isManager(){ return state.userDoc?.role === ROLES.MANAGER; }
function isPicker(){ return state.userDoc?.role === ROLES.PICKER; }
function isQC(){ return state.userDoc?.role === ROLES.QC; }

function show(elem){ elem?.classList?.remove('hidden'); }
function hide(elem){ elem?.classList?.add('hidden'); }

function toast(msg){
  // basit toast
  const t = el('div', {className:'card', style:'position:fixed;right:12px;bottom:12px;z-index:9999'} , msg);
  document.body.append(t);
  setTimeout(()=>t.remove(), 2200);
}

function formatTs(ts){
  try{ return new Date(ts?.seconds? ts.seconds*1000: ts).toLocaleString(); }catch{ return '-'; }
}

// =============================
//  Auth Akışı
// =============================
ui.signinBtn?.addEventListener('click', async ()=>{
  const email = ui.email.value.trim();
  const pass = ui.password.value;
  if(!email || !pass){ ui.loginMsg.textContent = 'E‑posta ve şifre zorunlu.'; return; }
  ui.signinBtn.disabled = true; ui.loginMsg.textContent = 'Giriş yapılıyor...';
  try{
    await signInWithEmailAndPassword(auth, email, pass);
  }catch(e){
    ui.loginMsg.textContent = 'Giriş hatası: '+ (e?.message||e);
  } finally{ ui.signinBtn.disabled = false; }
});

ui.btnLogout?.addEventListener('click', async ()=>{
  await signOut(auth).catch(()=>{});
});

onAuthStateChanged(auth, async (user)=>{
  state.user = user;
  if(!user){
    hide(ui.btnLogout); show(ui.btnLogin);
    show(ui.loginSection); hide(ui.ordersSection);
    ui.loginMsg.textContent = '';
    return;
  }
  show(ui.btnLogout); hide(ui.btnLogin);
  hide(ui.loginSection); show(ui.ordersSection);
  await bootstrapUserProfile();
  await restoreQueue();
  await loadOrders();
});

async function bootstrapUserProfile(){
  try{
    const ref = doc(db, 'users', state.user.uid);
    const snap = await getDoc(ref);
    state.userDoc = snap.exists()? snap.data(): { role: ROLES.MANAGER, displayName: state.user.email };
  }catch(e){ logError('Kullanıcı profili okunamadı', e); }
}

async function restoreQueue(){
  try{
    const saved = await cacheStore.get('pendingQueue');
    if(Array.isArray(saved)) state.pendingQueue = saved; // not: fonksiyonlar serileşmez; bu sadece placeholder
  }catch{}
}

// =============================
//  Sipariş Veri Modeli
// =============================
const STATUS = {
  CREATED: 'created', ASSIGNED: 'assigned', PICKING: 'picking',
  PICKED: 'picked', QC: 'qc', COMPLETED: 'completed', ARCHIVED:'archived'
};

function orderCard(o){
  const top = el('div', {className:'card'});
  const title = el('div', {style:'display:flex;justify-content:space-between;gap:8px;align-items:center;'},
    el('div',{},
      el('b',{}, `${o.id||'(yeni)'} • ${o.branch}`), ' ',
      el('span',{style:'color:#666'}, `Durum: ${o.status} | Kalem: ${o.items?.length||0}`)
    ),
    el('div',{},
      isManager() && el('button', {className:'btn btn-secondary', onClick:()=>assignToSelf(o)}, 'Ata'),
      ' ',
      el('button', {className:'btn', onClick:()=>openOrderDetail(o)}, 'Detay')
    )
  );
  top.append(title);
  return top;
}

function renderOrders(list){
  ui.orderList.innerHTML = '';
  list.forEach(o=> ui.orderList.append(orderCard(o)) );
}

// =============================
//  Firestore Yardımcıları
// =============================
const colOrders = () => collection(db, 'orders');
const colOrderItems = (orderId) => collection(db, 'orders', orderId, 'items');
const colEkDepo = () => collection(db, 'ek_depo');

async function loadOrders(){
  try{
    let qref;
    if(isManager()){
      qref = query(colOrders(), orderBy('createdAt','desc'), limit(50));
    } else if (isPicker()){
      qref = query(colOrders(), where('assignedTo','==', state.user.uid), orderBy('createdAt','desc'), limit(50));
    } else {
      // QC
      qref = query(colOrders(), where('status','in',[STATUS.PICKED, STATUS.QC]), orderBy('createdAt','desc'), limit(50));
    }
    const snap = await getDocs(qref);
    const orders = [];
    for(const d of snap.docs){
      const data = d.data();
      const itemsSnap = await getDocs(colOrderItems(d.id));
      const items = itemsSnap.docs.map((x)=> ({id:x.id, ...x.data()}));
      orders.push({ id:d.id, ...data, items });
    }
    renderOrders(orders);
  }catch(e){ logError('Siparişler yüklenemedi', e); toast('Siparişler yüklenemedi'); }
}

async function createOrder({branch, items}){
  const base = {
    branch,
    status: STATUS.CREATED,
    createdAt: serverTimestamp(),
    createdBy: state.user.uid,
    assignedTo: null,
  };
  const doCreate = async ()=>{
    const d = await addDoc(colOrders(), base);
    for(const it of items){
      await addDoc(colOrderItems(d.id), it);
    }
    logInfo('Yeni sipariş oluşturuldu', {orderId:d.id});
  };
  if(state.online) return doCreate();
  enqueue(doCreate); toast('Çevrimdışı: sipariş sıraya alındı');
}

async function updateOrder(orderId, patch){
  const fn = ()=> updateDoc(doc(db,'orders', orderId), patch);
  if(state.online) return fn(); enqueue(fn);
}

async function archiveOrder(orderId){
  await updateOrder(orderId, {status: STATUS.ARCHIVED});
  toast('Sipariş arşive taşındı');
}

async function assignToSelf(order){
  if(!isManager()) return;
  await updateOrder(order.id, {assignedTo: state.user.uid, status: STATUS.ASSIGNED});
  toast('Sipariş sana atandı');
  await loadOrders();
}

async function startPicking(orderId){
  await updateOrder(orderId, {status: STATUS.PICKING});
}

async function setPickedQty(orderId, itemId, picked){
  const fn = ()=> updateDoc(doc(db, 'orders', orderId, 'items', itemId), {picked});
  if(state.online) return fn(); enqueue(fn);
}

async function sendToQC(orderId){
  await updateOrder(orderId, {status: STATUS.PICKED});
}

async function qcApprove(orderId){
  await updateOrder(orderId, {status: STATUS.COMPLETED, qcBy: state.user.uid});
}

async function markMissing(orderId, item, missingQty, note){
  const payload = {
    orderId,
    code: item.code,
    name: item.name,
    aisle: item.aisle,
    quantity: missingQty,
    note: note||'',
    createdAt: serverTimestamp(),
  };
  const fn = ()=> addDoc(colEkDepo(), payload);
  if(state.online) return fn(); enqueue(fn);
}

// =============================
//  UI — Yeni Sipariş Modal ve İşlevler
// =============================
ui.btnNewOrder?.addEventListener('click', ()=> show(ui.orderModal));
ui.cancelOrderBtn?.addEventListener('click', ()=> hide(ui.orderModal));
ui.saveOrderBtn?.addEventListener('click', async ()=>{
  const branch = ui.branchInput.value.trim();
  const product = ui.productInput.value.trim();
  const qty = parseInt(ui.qtyInput.value,10)||0;
  if(!branch || !product || qty<=0){ return alert('Alanlar zorunlu ve miktar > 0 olmalı'); }
  await createOrder({
    branch,
    items: [{code: slug(product), name: product, aisle: 'A-01', quantity: qty, picked: 0}]
  });
  hide(ui.orderModal);
  ui.branchInput.value = ui.productInput.value = ui.qtyInput.value = '';
  await loadOrders();
});

function slug(s){ return s.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,''); }

// =============================
//  Detay Diyaloğu — Toplayıcı & QC Akışı
// =============================
function openOrderDetail(order){
  const modal = buildOrderDetailModal(order);
  document.body.append(modal);
}

function buildOrderDetailModal(order){
  const wrap = el('div',{id:'modalDetail', style:'position:fixed;inset:0;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;z-index:10000'});
  const card = el('div',{className:'card', style:'width:95%;max-width:850px;max-height:90vh;overflow:auto'});

  const header = el('div',{style:'display:flex;justify-content:space-between;align-items:center;gap:8px'},
    el('div',{}, el('h3',{}, `Sipariş • ${order.id} • ${order.branch}`), el('div',{style:'color:#666'}, `Durum: ${order.status}`)),
    el('div',{},
      el('button',{className:'btn', onClick:()=>wrap.remove()},'Kapat')
    )
  );

  const itemsBox = el('div',{});
  (order.items||[]).forEach(it=> itemsBox.append(itemRow(order, it)) );

  const actions = el('div',{style:'display:flex;gap:8px;flex-wrap:wrap;margin-top:12px'},
    isPicker() && el('button',{className:'btn btn-secondary', onClick:()=>{startPicking(order.id).then(()=>toast('Toplamaya başlandı'));}},'Toplamaya Başla'),
    isPicker() && el('button',{className:'btn btn-primary', onClick:()=>{sendToQC(order.id).then(()=>{toast('QC'ye gönderildi'); wrap.remove(); loadOrders();});}},'QC'ye Gönder'),
    isManager() && el('button',{className:'btn', onClick:()=>{archiveOrder(order.id).then(()=>{wrap.remove(); loadOrders();});}},'Arşivle'),
    isQC() && el('button',{className:'btn btn-primary', onClick:()=>{qcApprove(order.id).then(()=>{toast('QC Onaylandı'); wrap.remove(); loadOrders();});}},'QC Onayla'),
  );

  card.append(header, itemsBox, actions);
  wrap.append(card);
  return wrap;
}

function itemRow(order, it){
  const r = el('div',{className:'card'},
    el('div',{style:'display:flex;justify-content:space-between;align-items:center;gap:8px'},
      el('div',{}, el('b',{}, `${it.name}`), ' ', el('span',{style:'color:#666'}, `${it.code} • Raf: ${it.aisle}`)),
      el('div',{}, `Istenen: ${it.quantity} • Toplanan: ${it.picked||0}`)
    ),
    el('div',{style:'display:flex;gap:8px;flex-wrap:wrap;margin-top:8px'},
      isPicker() && el('button',{className:'btn', onClick:async()=>{
        const v = await promptNumber('Toplanan miktar', it.picked||0, 0, it.quantity);
        if(v==null) return; await setPickedQty(order.id, it.id, v); toast('Güncellendi');
      }}, 'Toplananı Ayarla'),
      isPicker() && el('button',{className:'btn', onClick:async()=>{
        const miss = await promptNumber('Eksik miktar', 1, 0, it.quantity-(it.picked||0));
        if(miss==null || miss<=0) return; const note = prompt('Not (opsiyonel)')||''; await markMissing(order.id, it, miss, note); toast('Ek Depo'ya eklendi');
      }}, 'Eksik İşaretle'),
      el('button',{className:'btn', onClick:()=> openScannerForItem(order, it)}, 'Barkod Tara')
    )
  );
  return r;
}

function promptNumber(title, def, min, max){
  return new Promise((resolve)=>{
    const w = el('div',{style:'position:fixed;inset:0;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;zIndex:10001'});
    const c = el('div',{className:'card', style:'width:95%;max-width:340px'},
      el('h3',{}, title),
      el('input',{type:'number', id:'pn', value:def, min, max}),
      el('div',{style:'display:flex;gap:8px;justify-content:flex-end;margin-top:8px'},
        el('button',{className:'btn', onClick:()=>{w.remove(); resolve(null);} }, 'İptal'),
        el('button',{className:'btn btn-primary', onClick:()=>{ const v = parseInt($('#pn').value,10); w.remove(); resolve(isNaN(v)?null:v); }}, 'Kaydet'),
      )
    );
    w.append(c); document.body.append(w);
    $('#pn').focus();
  });
}

// =============================
//  Barkod/QR Okuma
// =============================
async function openScannerForItem(order, it){
  const wrap = el('div',{style:'position:fixed;inset:0;background:rgba(0,0,0,.8);display:flex;align-items:center;justify-content:center;z-index:10002'});
  const box = el('div',{className:'card', style:'width:95%;max-width:520px;color:#111'},
    el('h3',{},'Barkod/QR Tara'),
    el('video',{id:'cam', autoplay:true, playsinline:true, style:'width:100%;border-radius:8px;background:#000'}),
    el('div',{style:'display:flex;gap:8px;justify-content:flex-end;margin-top:8px'},
      el('button',{className:'btn', onClick:()=>{stopCam(); wrap.remove();}},'Kapat')
    )
  );
  wrap.append(box); document.body.append(wrap);

  const stream = await navigator.mediaDevices.getUserMedia({video:{facingMode:'environment'}});
  const video = $('#cam'); video.srcObject = stream; await video.play();

  let detector = null;
  if('BarcodeDetector' in window){
    try{ detector = new window.BarcodeDetector({formats:['ean_13','ean_8','code_128','qr_code']}); }catch{}
  }

  let raf;
  async function tick(){
    try{
      if(detector){
        const codes = await detector.detect(video);
        if(codes?.length){
          const code = codes[0].rawValue;
          await onScanSuccess(code);
          stopCam(); wrap.remove(); return;
        }
      }
      // fallback: nothing
    }catch{}
    raf = requestAnimationFrame(tick);
  }
  raf = requestAnimationFrame(tick);

  async function onScanSuccess(code){
    toast('Okundu: '+code);
    // örnek: kod eşleşirse picked++
    if(code?.toLowerCase().includes((it.code||'').toLowerCase().slice(0,4))){
      const next = Math.min((it.picked||0)+1, it.quantity);
      await setPickedQty(order.id, it.id, next);
      await loadOrders();
    }
  }

  function stopCam(){
    cancelAnimationFrame(raf);
    stream.getTracks().forEach(t=>t.stop());
  }
}

// =============================
//  Dışa Aktarma & Yazdırma
// =============================
async function exportOrdersToCSV(){
  try{
    const qref = query(colOrders(), orderBy('createdAt','desc'), limit(200));
    const snap = await getDocs(qref);
    const rows = [['ID','Branch','Status','CreatedAt','AssignedTo']];
    for(const d of snap.docs){
      const o = d.data();
      rows.push([d.id, o.branch, o.status, o.createdAt?.seconds||'', o.assignedTo||'']);
    }
    const csv = rows.map(r=> r.map(x=>`"${String(x).replaceAll('"','""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], {type:'text/csv;charset=utf-8;'});
    const a = el('a',{href:URL.createObjectURL(blob), download:'orders.csv'}); a.click();
  }catch(e){ logError('CSV dışa aktarma hatası', e); }
}

function printOrderSlip(order){
  const w = window.open('', '_blank');
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Fiş ${order.id}</title>
  <style>body{font-family:Arial;padding:16px} h2{margin:0 0 12px} table{border-collapse:collapse;width:100%} td,th{border:1px solid #ddd;padding:8px}</style>
  </head><body>`);
  w.document.write(`<h2>Sipariş • ${order.id}</h2><div>Şube: ${order.branch} — Durum: ${order.status}</div>`);
  w.document.write('<table><thead><tr><th>Ürün</th><th>Kod</th><th>Raf</th><th>İstenen</th><th>Toplanan</th></tr></thead><tbody>');
  (order.items||[]).forEach(it=>{
    w.document.write(`<tr><td>${it.name}</td><td>${it.code}</td><td>${it.aisle}</td><td>${it.quantity}</td><td>${it.picked||0}</td></tr>`);
  });
  w.document.write('</tbody></table>');
  w.document.write('</body></html>');
  w.document.close();
  w.focus();
  w.print();
}

// =============================
//  Bildirimler
// =============================
async function ensureNotificationPerm(){
  if(!('Notification' in window)) return false;
  if(Notification.permission==='granted') return true;
  if(Notification.permission!=='denied'){
    const p = await Notification.requestPermission();
    return p==='granted';
  }
  return false;
}

async function notifyNewOrder(orderId){
  if(await ensureNotificationPerm()) new Notification('Yeni Sipariş', { body: `ID: ${orderId}` });
  // basit sesli uyarı
  try{ const a = new Audio('data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQgAAAA='); a.play(); }catch{}
}

// =============================
//  Gelişmiş Filtre/Arama (İsteğe bağlı genişletme)
// =============================
// İleride: şube filtresi, durum filtresi, tarih aralığı vb. UI eklenebilir

// =============================
//  PWA Hazırlığı (opsiyon)
// =============================
// navigator.serviceWorker?.register('/sw.js').catch(()=>{});

// =============================
//  Global Kısa Yol Tuşları
// =============================
window.addEventListener('keydown', (e)=>{
  if(e.key==='F9'){ exportOrdersToCSV(); }
});

// =============================
//  DEBUG Yardım
// =============================
window.__depo__ = { state, loadOrders, exportOrdersToCSV };

// =============================
//  İlk Mesaj
// =============================
logInfo('app.js yüklendi');


/* =============================
   EK: Servis Katmanı, Repo, Utils, Undo/Redo, İçe/Dışa Aktarım, Virtual List, Ayarlar, İstatistikler
   Not: Bu bölüm işlevselliği genişletir ve büyük kurumsal tek-dosya uygulama yapısına örnektir.
   ============================= */

// -----------------------------
// Settings / Preferences (IndexedDB)
// -----------------------------
const prefs = (()=>{
  const NS = 'prefs:';
  async function set(key, val){ await cacheStore.set(NS+key, val); }
  async function get(key){ return await cacheStore.get(NS+key); }
  return { set, get };
})();

// Tema ve dil tercihleri
(async ()=>{
  const theme = await prefs.get('theme') || 'light';
  document.documentElement.dataset.theme = theme;
})();

// -----------------------------
// Repository — Veri Erişim Katmanı
// -----------------------------
const repo = {
  async listOrders({forRole}){
    let qref;
    if(forRole===ROLES.MANAGER){
      qref = query(colOrders(), orderBy('createdAt','desc'), limit(100));
    } else if (forRole===ROLES.PICKER){
      qref = query(colOrders(), where('assignedTo','==', state.user.uid), orderBy('createdAt','desc'), limit(100));
    } else {
      qref = query(colOrders(), where('status','in',[STATUS.PICKED, STATUS.QC]), orderBy('createdAt','desc'), limit(100));
    }
    const snap = await getDocs(qref);
    const out = [];
    for(const d of snap.docs){
      const items = (await getDocs(colOrderItems(d.id))).docs.map(x=>({id:x.id, ...x.data()}));
      out.push({id:d.id, ...d.data(), items});
    }
    return out;
  },
  async getOrder(orderId){
    const d = await getDoc(doc(db,'orders',orderId));
    const items = (await getDocs(colOrderItems(orderId))).docs.map(x=>({id:x.id, ...x.data()}));
    return {id: d.id, ...d.data(), items};
  },
  async addOrder(order){
    const d = await addDoc(colOrders(), order);
    return d.id;
  },
  async addOrderItem(orderId, item){ await addDoc(colOrderItems(orderId), item); },
  async patchOrder(orderId, patch){ await updateDoc(doc(db,'orders',orderId), patch); },
  async patchItem(orderId, itemId, patch){ await updateDoc(doc(db,'orders',orderId,'items',itemId), patch); },
  async log(entry){ await writeLog(entry); }
};

// -----------------------------
// Undo / Redo (basit stack)
// -----------------------------
const historyStack = { undo: [], redo: [] };
function pushUndo(action){ historyStack.undo.push(action); historyStack.redo.length=0; }
async function doUndo(){
  const act = historyStack.undo.pop();
  if(!act) return; await act.undo(); historyStack.redo.push(act); toast('Geri alındı');
}
async function doRedo(){
  const act = historyStack.redo.pop();
  if(!act) return; await act.redo(); historyStack.undo.push(act); toast('Yinele');
}

window.addEventListener('keydown', (e)=>{
  if((e.ctrlKey||e.metaKey) && e.key.toLowerCase()==='z'){ e.preventDefault(); doUndo(); }
  if((e.ctrlKey||e.metaKey) && e.key.toLowerCase()==='y'){ e.preventDefault(); doRedo(); }
});

// Örnek kullanım: setPickedQty ile
const _origSetPickedQty = setPickedQty;
setPickedQty = async function(orderId, itemId, picked){
  const before = await getDoc(doc(db,'orders',orderId,'items',itemId));
  await _origSetPickedQty(orderId, itemId, picked);
  pushUndo({
    undo: async()=> repo.patchItem(orderId, itemId, {picked: before.data().picked||0}),
    redo: async()=> repo.patchItem(orderId, itemId, {picked}),
  });
};

// -----------------------------
// Excel/CSV İçe Aktarma (SheetJS olmadan basit CSV)
// -----------------------------
function parseCSV(text){
  const lines = text.split(/\r?\n/).filter(Boolean);
  const rows = lines.map(l=> l.split(',').map(s=> s.replace(/^\"|\"$/g,'').replace(/\"\"/g,'\"')));
  const [hdr,...data] = rows;
  return data.map(r=> Object.fromEntries(hdr.map((h,i)=>[h.trim(), r[i]])));
}

async function importOrdersFromCSV(file){
  const txt = await file.text();
  const rows = parseCSV(txt);
  for(const row of rows){
    const id = await repo.addOrder({
      branch: row.Branch||row.branch||'Bilinmeyen',
      status: STATUS.CREATED,
      createdAt: serverTimestamp(),
      createdBy: state.user.uid,
      assignedTo: null,
    });
    await repo.addOrderItem(id, {
      code: row.Code||row.code||'GEN',
      name: row.Name||row.name||'Ürün',
      aisle: row.Aisle||row.aisle||'A-01',
      quantity: Number(row.Qty||row.quantity||1),
      picked: 0,
    });
  }
  toast('CSV içe aktarma tamam');
  await loadOrders();
}

// -----------------------------
// Virtual List (uzun listeler için performans)
// -----------------------------
function virtualize(container, items, renderer, rowH=76){
  container.innerHTML = '';
  const viewport = el('div',{style:'position:relative;overflow:auto;max-height:70vh;border:1px solid #eee;border-radius:8px;background:#fff'});
  const spacer = el('div',{style:`height:${items.length*rowH}px;position:relative;`});
  viewport.append(spacer); container.append(viewport);

  const pool = new Map();
  function render(){
    const top = viewport.scrollTop; const h = viewport.clientHeight;
    const start = Math.max(0, Math.floor(top/rowH)-5);
    const end = Math.min(items.length, Math.ceil((top+h)/rowH)+5);
    // temizle
    for(const [i,node] of pool){ if(i<start||i>end){ node.remove(); pool.delete(i); } }
    for(let i=start;i<end;i++){
      if(pool.has(i)) continue;
      const node = el('div',{style:`position:absolute;left:0;right:0;top:${i*rowH}px;height:${rowH}px;padding:8px;`});
      node.append(renderer(items[i], i));
      spacer.append(node); pool.set(i,node);
    }
  }
  viewport.addEventListener('scroll', render); render();
}

// Yönetici için sanal liste kullanımı (opsiyon)
async function renderManagerVirtual(){
  const items = await repo.listOrders({forRole:ROLES.MANAGER});
  virtualize(ui.orderList, items, (o)=>orderCard(o));
}

// -----------------------------
// İstatistikler / Dashboard
// -----------------------------
async function computeStats(){
  const orders = await repo.listOrders({forRole: isManager()?ROLES.MANAGER: (isPicker()?ROLES.PICKER:ROLES.QC)});
  const byStatus = orders.reduce((acc,o)=>{ acc[o.status]=(acc[o.status]||0)+1; return acc; },{});
  const totalLines = orders.reduce((s,o)=> s + (o.items?.length||0), 0);
  return {count: orders.length, totalLines, byStatus};
}

async function showStats(){
  const s = await computeStats();
  const card = el('div',{className:'card'},
    el('h3',{},'Özet'),
    el('div',{}, `Sipariş: ${s.count} | Toplam Kalem: ${s.totalLines}`),
    el('pre',{}, JSON.stringify(s.byStatus,null,2))
  );
  ui.orderList.prepend(card);
}

// -----------------------------
// Ayarlar Paneli (tema, dil)
// -----------------------------
function openSettings(){
  const w = el('div',{style:'position:fixed;inset:0;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;z-index:10010'});
  const c = el('div',{className:'card',style:'max-width:400px;width:90%'},
    el('h3',{},'Ayarlar'),
    el('label',{},'Tema'),
    (function(){
      const sel = el('select',{}, el('option',{value:'light'},'Light'), el('option',{value:'dark'},'Dark'));
      sel.value = document.documentElement.dataset.theme||'light';
      sel.addEventListener('change', async ()=>{
        document.documentElement.dataset.theme = sel.value;
        await prefs.set('theme', sel.value);
      });
      return sel;
    })(),
    el('div',{style:'display:flex;gap:8px;justify-content:flex-end;margin-top:12px'},
      el('button',{className:'btn', onClick:()=>w.remove()},'Kapat')
    )
  );
  w.append(c); document.body.append(w);
}

// Hızlı menü tuşu
window.addEventListener('keydown', (e)=>{ if(e.key==='F1'){ e.preventDefault(); openSettings(); } });

// -----------------------------
// Test Verisi Üretici (Yalnızca Geliştirme)
// -----------------------------
async function seedFakeData(n=20){
  const branches = ['Konyaaltı','Kepez','Muratpaşa','Aksu','Döşemealtı'];
  for(let i=0;i<n;i++){
    const id = await repo.addOrder({
      branch: branches[i%branches.length],
      status: STATUS.CREATED,
      createdAt: serverTimestamp(),
      createdBy: state.user.uid,
      assignedTo: null,
    });
    const lines = Math.floor(Math.random()*4)+1;
    for(let k=0;k<lines;k++){
      await repo.addOrderItem(id, {
        code: `PRD-${String(Math.random()).slice(2,6)}`,
        name: `Ürün ${k+1}`,
        aisle: `A-${String(Math.floor(Math.random()*10)).padStart(2,'0')}`,
        quantity: Math.floor(Math.random()*12)+1,
        picked: 0,
      });
    }
  }
  await loadOrders();
}

window.__seed__ = seedFakeData;

// -----------------------------
// Basit WebSocket/Signal Kanalı (placeholder)
// -----------------------------
let ws;
function connectWS(){
  try{
    ws = new WebSocket('wss://example.invalid/depo');
    ws.onopen = ()=> logInfo('WS open');
    ws.onmessage = (ev)=> logInfo('WS message', ev.data);
    ws.onclose = ()=> logInfo('WS closed');
  }catch{}
}
// connectWS(); // kapalı bırakıldı

// -----------------------------
// Arama Kutusu (opsiyonel UI)
// -----------------------------
(function addSearchBox(){
  const box = el('div',{className:'card'},
    el('input',{id:'q', placeholder:'Ara: şube, ürün, kod...'}),
    el('div',{style:'font-size:12px;color:#666'},'İpucu: F9 → CSV dışa aktarım, F1 → Ayarlar, Ctrl+Z/Y → Geri/İleri')
  );
  ui.ordersSection?.prepend(box);
  $('#q')?.addEventListener('input', async (e)=>{
    const q = e.target.value.toLowerCase();
    const list = await repo.listOrders({forRole: isManager()?ROLES.MANAGER: (isPicker()?ROLES.PICKER:ROLES.QC)});
    const filt = list.filter(o=> o.branch.toLowerCase().includes(q) || (o.items||[]).some(it=> it.name.toLowerCase().includes(q)||String(it.code).toLowerCase().includes(q)) );
    renderOrders(filt);
  });
})();

// -----------------------------
// Gelişmiş Yazdırma Şablonu (HTML template)
// -----------------------------
function printA4PickingList(order){
  const rows = (order.items||[]).map(it=> `<tr><td>${it.name}</td><td>${it.code}</td><td>${it.aisle}</td><td>${it.quantity}</td><td>${it.picked||0}</td><td></td></tr>`).join('');
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Picking ${order.id}</title>
  <style>@page{size:A4;margin:14mm} body{font-family:Arial} h1{font-size:18px} table{border-collapse:collapse;width:100%} th,td{border:1px solid #444;padding:6px;font-size:12px} .muted{color:#666;font-size:12px}</style>
  </head><body>
    <h1>Toplama Listesi — ${order.id}</h1>
    <div class="muted">Şube: ${order.branch} • Durum: ${order.status}</div>
    <table><thead><tr><th>Ürün</th><th>Kod</th><th>Raf</th><th>İstenen</th><th>Toplanan</th><th>İmza</th></tr></thead><tbody>${rows}</tbody></table>
  </body></html>`;
  const w = window.open('', '_blank'); w.document.write(html); w.document.close(); w.focus(); w.print();
}

// -----------------------------
// Yönetici Kısa Eylemler (UI bağlama)
// -----------------------------
(function addManagerToolbar(){
  if(!ui.ordersSection) return;
  const bar = el('div',{className:'card'},
    el('button',{className:'btn', onClick:()=>loadOrders()},'Yenile'),
    ' ',
    el('button',{className:'btn', onClick:()=>exportOrdersToCSV()},'CSV Dışa Aktar'),
    ' ',
    el('label', {className:'btn'},
      el('input',{type:'file', accept:'.csv', style:'display:none', onChange:(e)=>{ const f=e.target.files[0]; if(f) importOrdersFromCSV(f); }}),
      'CSV İçe Aktar'
    ),
  );
  ui.ordersSection.prepend(bar);
})();
