
// -------------------------------
// 1) Firebase Config
// -------------------------------
// Buraya kendi Firebase ayarlarını koy
const firebaseConfig = {
    apiKey: "AIzaSyDcLQB4UggXlYA9x8AKw-XybJjcF6U_KA4",
  authDomain: "depo1-4668f.firebaseapp.com",
  projectId: "depo1-4668f",
  storageBucket: "depo1-4668f.firebasestorage.app",
  messagingSenderId: "1044254626353",
  appId: "1:1044254626353:web:148c57df2456cc3d9e3b10",
  measurementId: "G-DFGMVLK9XH"
};

// -------------------------------
// 2) Firebase import (CDN modu)
// -------------------------------
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { 
    getAuth, 
    signInWithEmailAndPassword,
    onAuthStateChanged 
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";

import { 
    getFirestore,
    doc,
    getDoc 
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";


// -------------------------------
// 3) Firebase başlatma
// -------------------------------
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);


// -------------------------------
// 4) Login Fonksiyonu
// -------------------------------
async function loginUser(email, password) {
    try {
        // Firebase email + password login
        await signInWithEmailAndPassword(auth, email, password);

        return { success: true };

    } catch (error) {
        console.error("Login error:", error);
        return { success: false, message: error.message };
    }
}


// -------------------------------
// 5) Kullanıcı Rolü Alma (Firestore)
// -------------------------------
async function getUserRole(uid) {
    const ref = doc(db, "users", uid);

    const snap = await getDoc(ref);

    if (!snap.exists()) {
        throw new Error("Kullanıcı Firestore'da bulunamadı!");
    }

    return snap.data().role || "picker"; // default picker
}


// -------------------------------
// 6) Form Submit (Login Butonu)
// -------------------------------
document.getElementById("loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();

    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value.trim();
    const errBox = document.getElementById("loginError");

    errBox.textContent = ""; // eski hatayı temizle

    const result = await loginUser(email, password);

    if (!result.success) {
        errBox.textContent = "Giriş hatası: " + result.message;
        return;
    }

    // Giriş başarılı → kullanıcı UID al
    const user = auth.currentUser;

    if (!user) {
        errBox.textContent = "Giriş başarısız: kullanıcı null döndü!";
        return;
    }

    try {
        // Firestore'dan rolü çek
        const role = await getUserRole(user.uid);

        // Role göre yönlendirme
        if (role === "manager") {
            window.location.href = "manager.html";
        } 
        else if (role === "qc") {
            window.location.href = "qc.html";
        } 
        else {
            window.location.href = "picker.html";
        }

    } catch (err) {
        errBox.textContent = "Rol alma hatası: " + err.message;
    }
});


// -------------------------------
// 7) Oturum Kontrol (Sayfa açıkken login olduysa)
// -------------------------------
onAuthStateChanged(auth, async (user) => {
    if (user) {
        // Giriş yapmış kullanıcı tekrar form görmesin
        try {
            const role = await getUserRole(user.uid);

            if (role === "manager") window.location.href = "manager.html";
            else if (role === "qc") window.location.href = "qc.html";
            else window.location.href = "picker.html";

        } catch (err) {
            console.error("Oturum rol kontrolü hatası:", err);
        }
    }
});
