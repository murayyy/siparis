// app.js — STABİL (Login + Şube Sipariş + Yönetici Listeleme)

// ================= NAV (mobil menü) =================
document.getElementById("menuToggle")?.addEventListener("click", () => {
  document.getElementById("mainNav")?.classList.toggle("show");
});

// ================= FIREBASE IMPORT =================
// Not: firebase.js dosyan şu isimleri export etmeli (senin paylaştığın gibi):
// app, auth, db, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged,
// collection, doc, setDoc, getDoc, getDocs, updateDoc, addDoc, query, where, orderBy, serverTimestamp
import {
  app, auth, db,
  signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged,
  collection, doc, setDoc, getDoc, getDocs, updateDoc, addDoc,
  query, where, serverTimestamp
} from "./firebase.js";

// Excel (SheetJS) – ürün kataloğu yükleme için
import * as XLSX from "https://cdn.sheetjs.com/xlsx-0.19.3/package/xlsx.mjs";

// ================= GLOBAL =================
let currentUser = null;
let orderDraft = [];   // şube sipariş satırları

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
    console.error(err);
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
    console.error(err);
  }
});

document.getElementById("logoutBtn")?.addEventListener("click", async () => {
  try { await signOut(auth); } catch (e) { console.error(e); }
});

// Oturum durumu
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

    // rol oku (doc yoksa "sube")
    let role = "sube";
    try {
      const udoc = await getDoc(doc(db, "users", user.uid));
      if (udoc.exists() && udoc.data()?.role) role = udoc.data().role;
    } catch (e) {
      console.warn("Rol okunamadı:", e);
    }

    if      (role === "sube")     showView("view-branch");
    else if (role === "yonetici") showView("view-manager");
    else if (role === "admin")    showView("view-products");
    else                          showView("view-branch"); // diğer rolleri şubeye at

    // ürün select’ini doldur
    await refreshBranchProductSelect();
    // yöneticiyse sipariş listesini getir
    if (role === "yonetici") await loadAllOrders();
  } catch (err) {
    console.error("onAuthStateChanged:", err);
    showView("view-login");
  }
});

// ================= ÜRÜN KATALOĞU =================
async function listProductsIntoTable() {
  const tb = document.querySelector("#tbl-products tbody");
  if (!tb) return;
  tb.innerHTML = "";
  try {
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
  } catch (e) {
    console.error("Ürün listeleme hatası:", e);
  }
}

async function refreshBranchProductSelect() {
  const sel = document.getElementById("branchProduct");
  if (!sel) return;
  sel.innerHTML = `<option value="">Ürün seçin…</option>`;
  try {
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
  } catch (e) {
    console.error("Ürün select hatası:", e);
  }
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
          reyon:   row.reyon   ? String(row.reyon).trim()   : ""
        });
        count++;
      }
      alert(`Toplam ${count} ürün yüklendi.`);
      await listProductsIntoTable();
      await refreshBranchProductSelect();
    } catch (err) {
      alert("Excel okuma hatası: " + (err.message || err));
      console.error(err);
    }
  };
  reader.readAsArrayBuffer(file);
});
document.querySelector("button[data-view='view-products']")?.addEventListener("click", listProductsIntoTable);

// ================= ŞUBE SİPARİŞ =================
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
  if (!sel?.value) return alert("Ürün seçin.");
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
  if (!currentUser) return alert("Önce giriş yapın.");
  if (!name) return alert("Sipariş adı gir!");
  if (orderDraft.length === 0) return alert("Sipariş satırı ekleyin!");

  await addDoc(collection(db, "orders"), {
    name,
    warehouse,
    status: "Yeni",
    createdBy: currentUser.uid,
    createdAt: serverTimestamp(),
    lines: orderDraft.map(l => ({
      code: l.code, name: l.name, qty: l.qty,
      barcode: l.barcode || "", reyon: l.reyon || "",
      picked: 0, qc: 0
    }))
  });

  alert("Sipariş oluşturuldu!");
  orderDraft = [];
  renderOrderDraft();
  document.getElementById("orderName").value = "";
  await loadBranchOrders();
});

async function loadBranchOrders() {
  if (!currentUser) return;
  const qy = query(collection(db, "orders"), where("createdBy", "==", currentUser.uid));
  const snap = await getDocs(qy);
  const tbody = document.querySelector("#branchOrders tbody");
  if (!tbody) return;
  tbody.innerHTML = "";
  snap.forEach(docu => {
    const d = docu.data();
    tbody.innerHTML += `<tr>
      <td>${docu.id}</td><td>${d.name}</td><td>${d.warehouse || "-"}</td><td>${d.status}</td>
    </tr>`;
  });
}
document.querySelector("button[data-view='view-branch']")?.addEventListener("click", async () => {
  await refreshBranchProductSelect();
  await loadBranchOrders();
});

// ================= YÖNETİCİ (sadece listeleme) =================
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
        <td><!-- Bu sade sürümde işlem yok --></td>
      </tr>`;
  });
}
document.querySelector("button[data-view='view-manager']")?.addEventListener("click", loadAllOrders);

// ================= BAŞLANGIÇ =================
showView("view-login");
console.log("app.js (stabil) yüklendi ✓");
