import {
  auth, db,
  signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged,
  collection, doc, setDoc, getDoc, getDocs, query, where, addDoc, updateDoc, serverTimestamp, orderBy
} from './firebase.js';

import * as XLSX from "https://cdn.sheetjs.com/xlsx-0.19.3/package/xlsx.mjs";

const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const hidden = (el, v = true) => el.classList.toggle("hidden", v);

let currentUser = null;
let currentRole = null;

// Sayfa açıldığında
document.addEventListener("DOMContentLoaded", () => {
  bindLogin();
  bindBranch();
  bindManager();
  bindPicker();
  bindAdmin();
  onAuthStateChanged(auth, onAuthChange);
});

// 🔑 Giriş / Kayıt
function bindLogin() {
  $("#loginBtn")?.addEventListener("click", async () => {
    const email = $("#login-email").value.trim();
    const pass = $("#login-pass").value.trim();
    try {
      await signInWithEmailAndPassword(auth, email, pass);
    } catch (err) {
      alert("Hata: " + err.message);
    }
  });

  $("#registerBtn")?.addEventListener("click", async () => {
    const email = $("#reg-email").value.trim();
    const pass = $("#reg-pass").value.trim();
    const role = $("#reg-role").value;
    try {
      const cred = await createUserWithEmailAndPassword(auth, email, pass);
      await setDoc(doc(db, "users", cred.user.uid), {
        email,
        role,
        createdAt: serverTimestamp()
      });
      alert("Kullanıcı oluşturuldu!");
    } catch (err) {
      alert("Hata: " + err.message);
    }
  });

  $("#logoutBtn")?.addEventListener("click", async () => {
    await signOut(auth);
  });
}

// 🔄 Kullanıcı login olunca
async function onAuthChange(user) {
  if (!user) {
    showView("view-login");
    currentUser = null;
    return;
  }
  currentUser = user;

  const snap = await getDoc(doc(db, "users", user.uid));
  currentRole = snap.exists() ? snap.data().role : null;

  if (!currentRole) {
    alert("Rol atanmamış. Admin kullanıcı ataması yapmalı!");
    return;
  }

  if (currentRole === "sube") showView("view-branch");
  if (currentRole === "yonetici") { showView("view-manager"); refreshOrders(); }
  if (currentRole === "toplayici") { showView("view-picker"); refreshMyOrders(); }
  if (currentRole === "admin") showView("view-dashboard");
}

// Sayfa gösterme
function showView(id) {
  $$(".view").forEach(v => hidden(v, true));
  hidden($("#" + id), false);
}

// 🏪 Şube – Sipariş oluşturma
function bindBranch() {
  $("#saveOrderBtn")?.addEventListener("click", async () => {
    const name = $("#order-name").value.trim() || "SIP-" + Date.now();
    const rows = $$("#tbl-order-lines tbody tr");
    const lines = [];
    for (const r of rows) {
      const code = r.querySelector("td:nth-child(1)")?.textContent.trim();
      const pname = r.querySelector("td:nth-child(2)")?.textContent.trim();
      const qty = parseInt(r.querySelector("td:nth-child(3)")?.textContent.trim()) || 0;
      if (code) lines.push({ code, name: pname, qty });
    }
    await addDoc(collection(db, "orders"), {
      name,
      branch: currentUser.email,
      status: "Yeni",
      assignedTo: "",
      lines,
      createdAt: serverTimestamp()
    });
    alert("Sipariş kaydedildi!");
  });
}

// 👨‍💼 Yönetici – Siparişleri görme & atama
function bindManager() {
  $("#assignBtn")?.addEventListener("click", assignSelected);
}

async function refreshOrders() {
  const tb = $("#tbl-orders tbody");
  tb.innerHTML = "";
  const snap = await getDocs(query(collection(db, "orders"), orderBy("createdAt", "desc")));
  snap.forEach(docu => {
    const o = { id: docu.id, ...docu.data() };
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><input type="checkbox" data-id="${o.id}"/></td>
      <td>${o.id}</td>
      <td>${o.name}</td>
      <td>${o.branch}</td>
      <td>${o.status}</td>
      <td>${o.assignedTo || "-"}</td>
    `;
    tb.appendChild(tr);
  });
}

async function assignSelected() {
  const sel = $("#assignUser").value;
  const checked = $$("#tbl-orders tbody input:checked");
  for (const c of checked) {
    await updateDoc(doc(db, "orders", c.dataset.id), {
      assignedTo: sel,
      status: "Atandı"
    });
  }
  refreshOrders();
}

// 👷 Toplayıcı – Sipariş toplama
function bindPicker() {
  $("#completeBtn")?.addEventListener("click", completeOrder);
}

async function refreshMyOrders() {
  const sel = $("#myOrders");
  sel.innerHTML = "";
  const snap = await getDocs(query(collection(db, "orders"), where("assignedTo", "==", currentUser.uid)));
  snap.forEach(d => {
    const o = { id: d.id, ...d.data() };
    const opt = document.createElement("option");
    opt.value = o.id;
    opt.textContent = `${o.id} - ${o.name} (${o.status})`;
    sel.appendChild(opt);
  });
}

async function completeOrder() {
  const id = $("#myOrders").value;
  if (!id) return;
  await updateDoc(doc(db, "orders", id), { status: "Tamamlandı" });
  alert("Sipariş tamamlandı!");
}

// 🛠 Admin – Excel'den ürün yükleme
function bindAdmin() {
  $("#uploadProductsBtn")?.addEventListener("click", () => {
    const file = $("#excelProducts").files[0];
    if (!file) return alert("Excel dosyası seç!");

    const reader = new FileReader();
    reader.onload = async (e) => {
      const data = new Uint8Array(e.target.result);
      const workbook = XLSX.read(data, { type: "array" });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json(sheet);

      for (const row of json) {
        if (!row.code || !row.name) continue;
        await setDoc(doc(db, "products", row.code), {
          code: row.code,
          name: row.name,
          barcode: row.barcode || "",
          reyon: row.reyon || ""
        });
      }
      alert("Excel ürünleri Firestore’a yüklendi!");
    };
    reader.readAsArrayBuffer(file);
  });
}
