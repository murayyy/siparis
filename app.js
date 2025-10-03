// ================== NAV ==================
function showView(id) {
  document.querySelectorAll(".view").forEach(v => v.classList.add("hidden"));
  document.getElementById(id)?.classList.remove("hidden");
}
document.querySelectorAll("nav button[data-view]").forEach(btn => {
  btn.addEventListener("click", () => showView(btn.dataset.view));
});

// ================= FIREBASE IMPORT =================
import {
  auth, db,
  signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged,
  collection, doc, setDoc, getDoc, getDocs, updateDoc, addDoc,
  query, where, serverTimestamp
} from "./firebase.js";

// ================== GLOBAL ==================
let currentUser = null;
let orderDraft = [];

// ================== AUTH ==================
document.getElementById("loginBtn")?.addEventListener("click", async () => {
  const email = document.getElementById("login-email").value;
  const pass  = document.getElementById("login-pass").value;
  try {
    await signInWithEmailAndPassword(auth, email, pass);
  } catch (err) {
    alert("Giriş hatası: " + err.message);
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
    alert("Kayıt hatası: " + err.message);
  }
});

document.getElementById("logoutBtn")?.addEventListener("click", async () => {
  await signOut(auth);
  showView("view-login");
});

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    currentUser = null;
    showView("view-login");
    return;
  }
  currentUser = user;

  let role = "sube";
  const udoc = await getDoc(doc(db, "users", user.uid));
  if (udoc.exists() && udoc.data().role) role = udoc.data().role;

  if      (role === "sube")     { showView("view-branch"); loadBranchOrders(); }
  else if (role === "yonetici") { showView("view-manager"); loadAllOrders(); }
  else                          showView("view-login");
});

// ================== ŞUBE SİPARİŞ ==================
function renderOrderDraft() {
  const tb = document.querySelector("#tbl-branch-lines tbody");
  tb.innerHTML = "";
  orderDraft.forEach((l, i) => {
    tb.innerHTML += `<tr>
      <td>${i + 1}</td><td>${l.code}</td><td>${l.name}</td><td>${l.qty}</td>
      <td><button data-del="${i}">Sil</button></td>
    </tr>`;
  });
  tb.querySelectorAll("button[data-del]").forEach(btn => {
    btn.addEventListener("click", () => {
      orderDraft.splice(btn.dataset.del, 1);
      renderOrderDraft();
    });
  });
}

document.getElementById("addLineBtn")?.addEventListener("click", () => {
  const sel = document.getElementById("branchProduct");
  const qty  = parseInt(document.getElementById("branchQty").value, 10);
  if (!sel.value || !qty) return alert("Ürün ve miktar gir!");
  const opt = sel.options[sel.selectedIndex];
  orderDraft.push({ code: sel.value, name: opt.textContent, qty });
  renderOrderDraft();
});

document.getElementById("createOrderBtn")?.addEventListener("click", async () => {
  if (orderDraft.length === 0) return alert("Satır ekleyin!");
  await addDoc(collection(db, "orders"), {
    lines: orderDraft,
    status: "Yeni",
    createdBy: currentUser.uid,
    createdAt: serverTimestamp()
  });
  alert("Sipariş kaydedildi!");
  orderDraft = [];
  renderOrderDraft();
  loadBranchOrders();
});

async function loadBranchOrders() {
  if (!currentUser) return;
  const qy = query(collection(db, "orders"), where("createdBy", "==", currentUser.uid));
  const snap = await getDocs(qy);
  const tbody = document.querySelector("#branchOrders tbody");
  tbody.innerHTML = "";
  snap.forEach(docu => {
    const d = docu.data();
    tbody.innerHTML += `<tr><td>${docu.id}</td><td>${d.status}</td></tr>`;
  });
}

// ================== YÖNETİCİ ==================
async function loadAllOrders() {
  const snap = await getDocs(collection(db, "orders"));
  const tb = document.querySelector("#tbl-orders tbody");
  tb.innerHTML = "";
  snap.forEach(d => {
    const o = d.data();
    tb.innerHTML += `<tr>
      <td>${d.id}</td><td>${o.status}</td>
    </tr>`;
  });
}
document.querySelector("button[data-view='view-manager']")?.addEventListener("click", loadAllOrders);

// ================== INIT ==================
showView("view-login");
console.log("✅ Hatasız çalışan app.js yüklendi");
