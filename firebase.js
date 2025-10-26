// ======================= FIREBASE INIT =======================
import { initializeApp, getApps, getApp } 
  from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { 
  getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { 
  getFirestore, collection, doc, setDoc, getDoc, getDocs, updateDoc, addDoc,
  query, where, orderBy, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";


// ======================= KONFİGÜRASYON =======================
const firebaseConfig = {
  apiKey: "AIzaSyDcLQB4UggXlYA9x8AKw-XybJjcF6U_KA4",
  authDomain: "depo1-4668f.firebaseapp.com",
  projectId: "depo1-4668f",
  storageBucket: "depo1-4668f.appspot.com",
  messagingSenderId: "1044254626353",
  appId: "1:1044254626353:web:148c57df2456cc3d9e3b10",
  measurementId: "G-DFGMVLK9XH"
};


// ======================= GÜVENLİ BAŞLATMA =======================
let app;
try {
  // Eğer zaten başlatıldıysa tekrar başlatma
  app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
  console.log("%c✅ Firebase başarıyla başlatıldı", "color:#22c55e;font-weight:600;");
} catch (err) {
  console.error("❌ Firebase başlatılamadı:", err);
}


// ======================= SERVİSLER =======================
let auth, db;

try {
  auth = getAuth(app);
  db = getFirestore(app);
  console.log("%c📦 Firestore ve Auth yüklendi", "color:#4f7cff;");
} catch (err) {
  console.error("❌ Servis yükleme hatası:", err);
}


// ======================= HELPER METOTLAR =======================
/**
 * Aktif kullanıcıyı getirir (veya null döner)
 */
function getCurrentUser() {
  return new Promise(resolve => {
    onAuthStateChanged(auth, user => resolve(user || null));
  });
}

/**
 * Güvenli belge oluşturma – hata log’lu
 */
async function safeSetDoc(ref, data) {
  try {
    await setDoc(ref, data, { merge: true });
    console.log("%c✅ Firestore kayıt başarılı", "color:#22c55e;");
  } catch (err) {
    console.error("❌ Firestore setDoc hatası:", err);
    throw err;
  }
}


// ======================= DIŞA AKTARIM =======================
export {
  app,
  auth,
  db,
  // Auth
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  // Firestore
  collection,
  doc,
  setDoc,
  getDoc,
  getDocs,
  updateDoc,
  addDoc,
  query,
  where,
  orderBy,
  serverTimestamp,
  // Ekstra
  getCurrentUser,
  safeSetDoc
};
