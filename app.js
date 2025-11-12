/*
 app.js — Depo Otomasyonu (SADE SÜRÜM)
 ---------------------------------------------------------------
 Netlify üzerinde, mevcut index.html ile birebir uyumlu, sade ve stabil
 tek dosya. Gereksiz modül yok; yalnızca ihtiyaç duyulan çekirdek akışlar:
  - Firebase Auth (email+password)
  - Rol: manager/picker/qc (users/{uid}.role)
  - Orders + Items CRUD (created → assigned → picking → picked → qc → completed → archived)
  - Basit offline kuyruk (yeniden dene)
  - Barkod/QR okuma (BarcodeDetector varsa, yoksa manuel giriş)
  - CSV dışa aktarma
  - Basit toast, log, render
 ---------------------------------------------------------------
*/

// =============== Firebase (modular) ===============
import {
  auth, db,
  signInWithEmailAndPassword, signOut, onAuthStateChanged,
  collection, doc, addDoc, getDoc, getDocs, updateDoc, deleteDoc,
  serverTimestamp, query, where, orderBy, limit
} from './firebase.js';

// =============== Mini yardımcılar ===============
const $ = (s,r=document)=> r.querySelector(s); const $$ = (s,r=document)=> Array.from(r.querySelectorAll(s));
function el(tag, attrs={}, ...kids){ const n=document.createElement(tag); for(const k in attrs){ const v=attrs[k]; if(k==='className') n.className=v; else if(k.startsWith('on')&&typeof v==='function') n.addEventListener(k.slice(2),v); else if(v!=null) n.setAttribute(k,v);} for(const k of kids){ if(k==null) continue; if(k instanceof Node) n.append(k); else n.append(document.createTextNode(String(k))); } return n; }
function show(x){ x?.classList?.remove('hidden'); } function hide(x){ x?.classList?.add('hidden'); }
function toast(msg){ const t=el('div',{style:'position:fixed;right:12px;bottom:12px;background:#111;color:#fff;padding:8px 12px;border-radius:12px;z-index:9999;opacity:.95'}, msg); document.body.append(t); setTimeout(()=>t.remove(),1800); }
function logInfo(m,d){ console.log('[INFO]',m,d||''); } function logError(m,e){ console.error('[ERR]',m,e); }
function ts(d){ try{ return (d?.seconds? new Date(d.seconds*1000): new Date()).toLocaleString(); }catch{ return ''; } }

// =============== Global durum ===============
const ROLES={ MANAGER:'manager', PICKER:'picker', QC:'qc' };
const STATUS={ CREATED:'created', ASSIGNED:'assigned', PICKING:'picking', PICKED:'picked', QC:'qc', COMPLETED:'completed', ARCHIVED:'archived' };
const state={ user:null, userDoc:null, online:navigator.onLine };
window.addEventListener('online',()=>{state.online=true; flushQueue();});
window.addEventListener('offline',()=>{state.online=false;});

// =============== UI köprüleri ===============
const ui={
  loginSection: $('#loginSection'),
  ordersSection: $('#ordersSection'),
  loginMsg: $('#loginMsg'),
  email: $('#email'), password: $('#password'), signinBtn: $('#signinBtn'),
  btnLogin: $('#btnLogin'), btnLogout: $('#btnLogout'),
  orderList: $('#orderList'),
  // Yeni sipariş modalı (index’te farklı id kullanıyorsan burada güncelle)
  btnNewOrder: $('#btnNewOrder'),
  orderModal: $('#orderModal')||$('#dlgOrder')||$('#orderDialog'),
  branchInput: $('#branchInput')||$('#dlgBranch'),
  productInput: $('#productInput')||$('#dlgProduct'),
  qtyInput: $('#qtyInput')||$('#dlgQty'),
  saveOrderBtn: $('#saveOrderBtn')||$('#dlgSave'),
  cancelOrderBtn: $('#cancelOrderBtn')||$('#dlgCancel')
};

// =============== Firestore kol yardımcıları ===============
const colOrders = ()=> collection(db,'orders');
const colOrderItems = (id)=> collection(db,'orders', id, 'items');
const colUsers = ()=> collection(db,'users');

// =============== Offline kuyruk (çok basit) ===============
const queue=[]; function enqueue(fn){ queue.push(fn); }
async function flushQueue(){ if(!state.online||!queue.length) return; const copy=[...queue]; queue.length=0; for(const fn of copy){ try{ await fn(); }catch(e){ logError('queue',e); enqueue(fn);} } }

// =============== Auth akışı ===============
ui.signinBtn?.addEventListener('click', async()=>{
  const e=ui.email.value.trim(), p=ui.password.value; if(!e||!p){ ui.loginMsg.textContent='E‑posta ve şifre zorunlu'; return; }
  ui.signinBtn.disabled=true; ui.loginMsg.textContent='Giriş yapılıyor...';
  try{ await signInWithEmailAndPassword(auth, e, p); } catch(err){ ui.loginMsg.textContent='Giriş hatası: '+(err?.message||err); } finally{ ui.signinBtn.disabled=false; }
});
ui.btnLogout?.addEventListener('click', ()=> signOut(auth).catch(()=>{}));

onAuthStateChanged(auth, async (u)=>{
  state.user=u||null;
  if(!u){ show(ui.loginSection); hide(ui.ordersSection); show(ui.btnLogin); hide(ui.btnLogout); ui.loginMsg.textContent=''; return; }
  hide(ui.loginSection); show(ui.ordersSection); hide(ui.btnLogin); show(ui.btnLogout);
  await bootstrapUser(); await loadOrders(); await flushQueue();
});

async function bootstrapUser(){ try{ const s=await getDoc(doc(db,'users', state.user.uid)); state.userDoc = s.exists()? s.data(): {role:ROLES.MANAGER, displayName:state.user.email}; }catch(e){ logError('userDoc',e); state.userDoc={role:ROLES.MANAGER}; } }
function isManager(){ return state.userDoc?.role===ROLES.MANAGER; } function isPicker(){ return state.userDoc?.role===ROLES.PICKER; } function isQC(){ return state.userDoc?.role===ROLES.QC; }

// =============== Sipariş API ===============
async function createOrder({branch, items}){
  const base={ branch, status:STATUS.CREATED, createdAt:serverTimestamp(), createdBy:state.user?.uid||'sys', assignedTo:null };
  const run=async()=>{ const ref=await addDoc(colOrders(), base); for(const it of items){ await addDoc(colOrderItems(ref.id), it); } toast('Sipariş oluşturuldu'); };
  if(state.online) return run(); enqueue(run); toast('Çevrimdışı—kuyruğa alındı');
}
async function updateOrder(id, patch){ const run=()=> updateDoc(doc(db,'orders',id), patch); if(state.online) return run(); enqueue(run); }
async function setPickedQty(orderId, itemId, picked){ const run=()=> updateDoc(doc(db,'orders',orderId,'items',itemId), {picked}); if(state.online) return run(); enqueue(run); }
async function archiveOrder(orderId){ await updateOrder(orderId, {status:STATUS.ARCHIVED}); toast('Arşivlendi'); loadOrders(); }
async function assignToSelf(order){ if(!isManager()) return; await updateOrder(order.id, {assignedTo: state.user.uid, status:STATUS.ASSIGNED}); toast('Sipariş sana atandı'); loadOrders(); }
async function startPicking(orderId){ await updateOrder(orderId, {status:STATUS.PICKING}); }
async function sendToQC(orderId){ await updateOrder(orderId, {status:STATUS.PICKED}); }
async function qcApprove(orderId){ await updateOrder(orderId, {status:STATUS.COMPLETED, qcBy: state.user.uid}); }

// =============== Listeleme/Render ===============
async function loadOrders(){
  try{
    let qref;
    if(isManager()) qref = query(colOrders(), orderBy('createdAt','desc'), limit(100));
    else if(isPicker()) qref = query(colOrders(), where('assignedTo','==', state.user.uid), orderBy('createdAt','desc'), limit(100));
    else qref = query(colOrders(), where('status','in',[STATUS.PICKED, STATUS.QC]), orderBy('createdAt','desc'), limit(100));
    const snap = await getDocs(qref);
    const orders=[];
    for(const d of snap.docs){ const items=(await getDocs(colOrderItems(d.id))).docs.map(x=>({id:x.id, ...x.data()})); orders.push({id:d.id, ...d.data(), items}); }
    renderOrders(orders);
  }catch(e){ logError('loadOrders',e); toast('Siparişler yüklenemedi'); }
}

function orderCard(o){
  const head = el('div',{className:'card'},
    el('div',{style:'display:flex;justify-content:space-between;align-items:center;gap:8px'},
      el('div',{}, el('b',{}, `${o.id} • ${o.branch}`), ' ', el('span',{style:'color:#666'}, `Durum: ${o.status} • Kalem: ${o.items?.length||0}`)),
      el('div',{}, isManager()&&el('button',{className:'btn btn-secondary', onClick:()=>assignToSelf(o)},'Ata'), ' ', el('button',{className:'btn', onClick:()=>openOrderDetail(o)}, 'Detay'))
    )
  );
  return head;
}
function renderOrders(list){ ui.orderList.innerHTML=''; list.forEach(o=> ui.orderList.append(orderCard(o))); }

// =============== Detay Modal ===============
function openOrderDetail(order){
  const wrap = el('div',{style:'position:fixed;inset:0;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;z-index:10000'});
  const card = el('div',{className:'card', style:'width:95%;max-width:860px;max-height:90vh;overflow:auto'});
  const header = el('div',{style:'display:flex;justify-content:space-between;align-items:center;gap:8px'},
    el('div',{}, el('h3',{}, `Sipariş ${order.id} • ${order.branch}`), el('div',{style:'color:#666'}, `Durum: ${order.status}`)),
    el('div',{}, el('button',{className:'btn', onClick:()=>wrap.remove()},'Kapat'))
  );
  const table = el('table',{className:'table'});
  const thead = el('thead',{}, el('tr',{}, el('th',{},'Ürün'), el('th',{},'Kod'), el('th',{},'Raf'), el('th',{},'İstenen'), el('th',{},'Toplanan'), el('th',{},'Aksiyon')));
  const tbody = el('tbody',{});
  for(const it of (order.items||[])){
    const inp = el('input',{type:'number', value:String(it.picked||0), style:'width:80px'});
    const tr = el('tr',{},
      el('td',{}, it.name||'-'), el('td',{}, it.code||'-'), el('td',{}, it.aisle||'-'),
      el('td',{}, String(it.quantity||0)), el('td',{}, inp),
      el('td',{}, el('button',{className:'btn', onClick:()=> openScannerForItem(order,it)},'Tara'), ' ', el('button',{className:'btn', onClick:async()=>{ await setPickedQty(order.id, it.id, Number(inp.value)||0); toast('Güncellendi'); }},'Kaydet'))
    );
    tbody.append(tr);
  }
  table.append(thead,tbody);
  const actions = el('div',{style:'display:flex;gap:8px;flex-wrap:wrap;margin-top:12px'},
    isPicker()&&el('button',{className:'btn btn-secondary', onClick:()=>{startPicking(order.id); toast('Toplamaya başlandı');}},'Toplamaya Başla'),
    isPicker()&&el('button',{className:'btn btn-primary', onClick:()=>{sendToQC(order.id); toast("QC'ye gönderildi"); wrap.remove(); loadOrders();}},"QC'ye Gönder"),
    isManager()&&el('button',{className:'btn', onClick:()=>{archiveOrder(order.id); wrap.remove();}},'Arşivle'),
    isQC()&&el('button',{className:'btn btn-primary', onClick:()=>{qcApprove(order.id); toast('QC onaylandı'); wrap.remove(); loadOrders();}},'QC Onayla')
  );
  card.append(header, table, actions); wrap.append(card); document.body.append(wrap);
}

// =============== Barkod/QR Tarama ===============
async function openScannerForItem(order, it){
  const layer = el('div',{style:'position:fixed;inset:0;background:rgba(0,0,0,.8);display:flex;align-items:center;justify-content:center;z-index:10002'});
  const box = el('div',{className:'card', style:'width:95%;max-width:520px;color:#111'},
    el('h3',{},'Barkod/QR Tara'),
    el('video',{id:'cam', autoplay:true, playsinline:true, style:'width:100%;border-radius:8px;background:#000'}),
    el('div',{style:'display:flex;gap:8px;justify-content:flex-end;margin-top:8px'}, el('button',{className:'btn', onClick:()=>{stop(); layer.remove();}},'Kapat'))
  ); layer.append(box); document.body.append(layer);
  let stream=null, raf=null, detector=null; const video=$('#cam');
  try{ stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'environment'}}); video.srcObject=stream; await video.play(); }catch{}
  if('BarcodeDetector' in window){ try{ detector=new window.BarcodeDetector({formats:['ean_13','ean_8','code_128','qr_code']}); }catch{} }
  async function tick(){ try{ if(detector){ const codes=await detector.detect(video); if(codes?.length){ const code=codes[0].rawValue; await onCode(code); return; } } }catch{} raf=requestAnimationFrame(tick); }
  async function onCode(code){ toast('Okundu: '+code); const next=Math.min((it.picked||0)+1, it.quantity); await setPickedQty(order.id, it.id, next); await loadOrders(); stop(); layer.remove(); }
  function stop(){ try{ cancelAnimationFrame(raf); stream?.getTracks()?.forEach(t=>t.stop()); }catch{} }
  raf=requestAnimationFrame(tick);
  // fallback manuel
  setTimeout(async()=>{ if(!detector){ const code=prompt('Barkod/QR kodu:', it.code||''); if(code!=null){ await onCode(code); } } }, 600);
}

// =============== CSV Dışa Aktarma ===============
async function exportOrdersToCSV(){
  try{
    const snap = await getDocs(query(colOrders(), orderBy('createdAt','desc'), limit(300)));
    const rows = [['ID','Branch','Status','Lines','CreatedAt']];
    for(const d of snap.docs){ const o=d.data(); const items = await getDocs(colOrderItems(d.id)); rows.push([d.id, o.branch, o.status, items.size, o.createdAt?.seconds||'']); }
    const csv = rows.map(r=> r.map(x=>`"${String(x).replace(/"/g,'""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], {type:'text/csv;charset=utf-8;'}); const a = el('a',{href:URL.createObjectURL(blob), download:'orders.csv'}); a.click(); setTimeout(()=>URL.revokeObjectURL(a.href), 400);
  }catch(e){ logError('csv',e); toast('CSV oluşturulamadı'); }
}

// =============== Yeni Sipariş Modal bağlama ===============
ui.btnNewOrder?.addEventListener('click', ()=> show(ui.orderModal));
ui.cancelOrderBtn?.addEventListener('click', ()=> hide(ui.orderModal));
ui.saveOrderBtn?.addEventListener('click', async()=>{
  const branch=(ui.branchInput?.value||'').trim();
  const product=(ui.productInput?.value||'').trim();
  const qty=parseInt(ui.qtyInput?.value||'0',10)||0;
  if(!branch||!product||qty<=0) return alert('Şube, ürün ve miktar zorunlu.');
  await createOrder({ branch, items:[{ code:slug(product), name:product, aisle:'A-01', quantity:qty, picked:0 }] });
  hide(ui.orderModal); ui.branchInput.value=''; ui.productInput.value=''; ui.qtyInput.value=''; await loadOrders();
});
function slug(s){ return s.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,''); }

// =============== Kısayollar ===============
window.addEventListener('keydown',(e)=>{ if(e.key==='F9'){ e.preventDefault(); exportOrdersToCSV(); } });

// =============== Dışa aktarılacak minimal API (opsiyon) ===============
Object.assign(window,{ state, ROLES, STATUS, loadOrders, createOrder, setPickedQty, exportOrdersToCSV });

logInfo('SADE app.js yüklendi');
