import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route, Link, Navigate, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { v4 as uuidv4 } from "uuid";
import { saveAs } from "file-saver";
import { CSVLink } from "react-csv";
import { QRCodeSVG } from "qrcode.react";
import { Download, LogOut, Package2, Plus, Printer, QrCode, Search, Settings, ShoppingCart, Upload, User, Warehouse, X, Bell, Camera, CheckCircle2, ClipboardCheck, Boxes, History, Shield, Users2, AlertTriangle, FileSpreadsheet, Filter, ArrowRight, ArrowLeft, Trash2, Edit3, Save, Send, CircleCheck } from "lucide-react";

/************************************************************
 * DEPO OTOMASYONU — TEK DOSYALIK REACT UYGULAMASI (V1)
 * ------------------------------------------------------
 * Bu dosya, depo otomasyonu için tek dosyalık (single-file)
 * bir React uygulamasıdır. Şu modüller içerir:
 *  - Kimlik doğrulama (rol bazlı: admin, manager, picker, branch)
 *  - Ürün kataloğu, stok, reyon/raf kodları ve barkod
 *  - Şube sipariş oluşturma, düzenleme, PDF/CSV dışa aktarım
 *  - Depo toplayıcı ekranı (barkod/QR kamera ile okuma destekli)
 *  - Sipariş kontrol (QC) ve eksik ürün yönetimi (Ek Depo)
 *  - Arşiv ve geçmiş siparişler
 *  - Basit bildirim sistemi (in-app), offline-first önbellek
 *  - PWA davranışlarına hazırlık (manifest/service worker kancaları)
 *
 * Notlar:
 *  - Gerçek sunucu yoktur, LocalStorage üzerinden çalışır.
 *  - Mikro Yazılım/SQL entegrasyonu için API katmanı iskeleti eklendi.
 *  - Tasarım Tailwind sınıflarıyla yapılmıştır.
 *  - Gerekirse bu tek dosya modüler projeye bölünebilir.
 ************************************************************/

/****************************
 * Yardımcı Türler ve Sabitler
 ****************************/
const ROLES = {
  ADMIN: "admin",
  MANAGER: "manager",
  PICKER: "picker",
  BRANCH: "branch",
};

const ORDER_STATUS = {
  DRAFT: "Taslak",
  SUBMITTED: "Gönderildi",
  ASSIGNED: "Toplayıcıya Atandı",
  PICKING: "Toplanıyor",
  PICKED: "Toplandı",
  QC: "Kontrol (QC)",
  PARTIAL: "Kısmi",
  COMPLETED: "Tamamlandı",
  ARCHIVED: "Arşivlendi",
};

const STORAGE_KEYS = {
  USERS: "depo_users",
  SESSION: "depo_session",
  PRODUCTS: "depo_products",
  ORDERS: "depo_orders",
  NOTIFS: "depo_notifications",
  SETTINGS: "depo_settings",
};

const DEFAULT_BRANCHES = [
  { id: "S1", name: "Merkez" },
  { id: "S2", name: "Çayyolu" },
  { id: "S3", name: "İncek" },
  { id: "S4", name: "Kızılay" },
  { id: "S5", name: "Etimesgut" },
];

const DEFAULT_AISLES = [
  { code: "A01", name: "Kuruyemiş" },
  { code: "A02", name: "Kuru Meyve" },
  { code: "A03", name: "Çikolata" },
  { code: "A04", name: "Lokum" },
  { code: "A05", name: "Paketli Atıştırmalık" },
];

/****************************
 * Basit LocalStorage DB
 ****************************/
const db = {
  get(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      console.error("LocalStorage get error", e);
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      console.error("LocalStorage set error", e);
    }
  },
};

/****************************
 * Mock Başlangıç Verileri
 ****************************/
function seedIfEmpty() {
  const users = db.get(STORAGE_KEYS.USERS, null);
  if (!users) {
    db.set(STORAGE_KEYS.USERS, [
      { id: uuidv4(), email: "admin@depo.app", password: "1234", role: ROLES.ADMIN, name: "Admin" },
      { id: uuidv4(), email: "yonetici@depo.app", password: "1234", role: ROLES.MANAGER, name: "Yönetici" },
      { id: uuidv4(), email: "toplayici@depo.app", password: "1234", role: ROLES.PICKER, name: "Toplayıcı" },
      { id: uuidv4(), email: "sube@depo.app", password: "1234", role: ROLES.BRANCH, name: "Şube Kullanıcı", branchId: "S2" },
    ]);
  }

  const products = db.get(STORAGE_KEYS.PRODUCTS, null);
  if (!products) {
    const demo = [
      { id: uuidv4(), code: "STO-1001", name: "Kavrulmuş Badem 500g", barcode: "86900001001", aisle: "A01", stock: 120, unit: "paket" },
      { id: uuidv4(), code: "STO-1002", name: "Kaju 500g", barcode: "86900001002", aisle: "A01", stock: 85, unit: "paket" },
      { id: uuidv4(), code: "STO-2001", name: "Kuru İncir 1kg", barcode: "86900002001", aisle: "A02", stock: 65, unit: "kg" },
      { id: uuidv4(), code: "STO-3001", name: "Bitter Çikolata Draje", barcode: "86900003001", aisle: "A03", stock: 210, unit: "kg" },
      { id: uuidv4(), code: "STO-4001", name: "Sade Lokum 1kg", barcode: "86900004001", aisle: "A04", stock: 44, unit: "kg" },
    ];
    db.set(STORAGE_KEYS.PRODUCTS, demo);
  }

  const orders = db.get(STORAGE_KEYS.ORDERS, null);
  if (!orders) {
    db.set(STORAGE_KEYS.ORDERS, []);
  }

  const settings = db.get(STORAGE_KEYS.SETTINGS, null);
  if (!settings) {
    db.set(STORAGE_KEYS.SETTINGS, {
      company: "Tuğlubey / Cookcerez",
      warehouses: [ { id: "D1", name: "Merkez Depo" } ],
      branches: DEFAULT_BRANCHES,
      aisles: DEFAULT_AISLES,
      ekDepoPolicy: { autoNotifyBranch: true },
    });
  }

  const notifications = db.get(STORAGE_KEYS.NOTIFS, null);
  if (!notifications) db.set(STORAGE_KEYS.NOTIFS, []);
}
seedIfEmpty();

/****************************
 * Basit Event Bus (Bildirimler)
 ****************************/
const listeners = new Set();
function notify(event) {
  for (const l of listeners) l(event);
}
function useBus() {
  const [, setTick] = useState(0);
  useEffect(() => {
    const fn = () => setTick((t) => t + 1);
    listeners.add(fn);
    return () => listeners.delete(fn);
  }, []);
}

/****************************
 * Kimlik Doğrulama Kancası
 ****************************/
function useSession() {
  const [session, setSession] = useState(() => db.get(STORAGE_KEYS.SESSION, null));
  const login = (email, password) => {
    const users = db.get(STORAGE_KEYS.USERS, []);
    const u = users.find((x) => x.email === email && x.password === password);
    if (!u) throw new Error("E-posta ya da şifre hatalı");
    const s = { uid: u.id, role: u.role, name: u.name, branchId: u.branchId };
    db.set(STORAGE_KEYS.SESSION, s);
    setSession(s);
  };
  const logout = () => {
    db.set(STORAGE_KEYS.SESSION, null);
    setSession(null);
  };
  return { session, login, logout };
}

/****************************
 * Uygulama Durumu Kancaları
 ****************************/
function useProducts() {
  const [products, setProducts] = useState(() => db.get(STORAGE_KEYS.PRODUCTS, []));
  const refresh = () => setProducts(db.get(STORAGE_KEYS.PRODUCTS, []));
  const add = (p) => {
    const list = db.get(STORAGE_KEYS.PRODUCTS, []);
    list.push({ ...p, id: uuidv4() });
    db.set(STORAGE_KEYS.PRODUCTS, list);
    refresh();
  };
  const update = (id, patch) => {
    const list = db.get(STORAGE_KEYS.PRODUCTS, []);
    const idx = list.findIndex((x) => x.id === id);
    if (idx >= 0) {
      list[idx] = { ...list[idx], ...patch };
      db.set(STORAGE_KEYS.PRODUCTS, list);
      refresh();
    }
  };
  const remove = (id) => {
    const list = db.get(STORAGE_KEYS.PRODUCTS, []);
    db.set(STORAGE_KEYS.PRODUCTS, list.filter((x) => x.id !== id));
    refresh();
  };
  return { products, add, update, remove };
}

function useOrders() {
  const [orders, setOrders] = useState(() => db.get(STORAGE_KEYS.ORDERS, []));
  const refresh = () => setOrders(db.get(STORAGE_KEYS.ORDERS, []));

  const createOrder = ({ branchId, createdBy, note }) => {
    const o = {
      id: uuidv4(),
      code: `ORD-${Math.floor(Math.random() * 999999)}`,
      branchId,
      createdBy,
      createdAt: new Date().toISOString(),
      status: ORDER_STATUS.DRAFT,
      items: [],
      pickerId: null,
      qcBy: null,
      note: note || "",
      history: [{ at: new Date().toISOString(), by: createdBy, action: "Oluşturuldu" }],
      ekDepoItems: [],
    };
    const list = db.get(STORAGE_KEYS.ORDERS, []);
    list.unshift(o);
    db.set(STORAGE_KEYS.ORDERS, list);
    refresh();
    pushNotif({ title: "Yeni sipariş", message: `${o.code} oluşturuldu`, type: "info" });
    return o;
  };

  const updateOrder = (id, patch, who) => {
    const list = db.get(STORAGE_KEYS.ORDERS, []);
    const idx = list.findIndex((x) => x.id === id);
    if (idx >= 0) {
      list[idx] = { ...list[idx], ...patch };
      if (who && patch?.status) list[idx].history.push({ at: new Date().toISOString(), by: who, action: `Durum: ${patch.status}` });
      db.set(STORAGE_KEYS.ORDERS, list);
      refresh();
    }
  };

  const addItem = (id, item, who) => {
    const list = db.get(STORAGE_KEYS.ORDERS, []);
    const o = list.find((x) => x.id === id);
    if (!o) return;
    const ex = o.items.find((x) => x.productId === item.productId);
    if (ex) ex.qty += item.qty; else o.items.push(item);
    o.history.push({ at: new Date().toISOString(), by: who, action: `Kalem eklendi: ${item.name} x${item.qty}` });
    db.set(STORAGE_KEYS.ORDERS, list);
    refresh();
  };

  const assignPicker = (id, pickerId, who) => {
    updateOrder(id, { pickerId, status: ORDER_STATUS.ASSIGNED }, who);
  };

  const markPicking = (id, who) => updateOrder(id, { status: ORDER_STATUS.PICKING }, who);
  const markPicked = (id, who) => updateOrder(id, { status: ORDER_STATUS.PICKED }, who);
  const moveToQC = (id, who) => updateOrder(id, { status: ORDER_STATUS.QC }, who);
  const markPartial = (id, who) => updateOrder(id, { status: ORDER_STATUS.PARTIAL }, who);
  const complete = (id, who) => updateOrder(id, { status: ORDER_STATUS.COMPLETED }, who);
  const archive = (id, who) => updateOrder(id, { status: ORDER_STATUS.ARCHIVED }, who);

  const addEkDepo = (id, ekItem, who) => {
    const list = db.get(STORAGE_KEYS.ORDERS, []);
    const o = list.find((x) => x.id === id);
    if (!o) return;
    o.ekDepoItems.push({ ...ekItem, id: uuidv4(), createdAt: new Date().toISOString() });
    o.history.push({ at: new Date().toISOString(), by: who, action: `Ek Depo: ${ekItem.name} x${ekItem.qty}` });
    db.set(STORAGE_KEYS.ORDERS, list);
    refresh();

    const settings = db.get(STORAGE_KEYS.SETTINGS, {});
    if (settings?.ekDepoPolicy?.autoNotifyBranch) {
      pushNotif({ title: "Ek Depo", message: `${o.code} için ek depo girdisi oluştu`, type: "warning" });
    }
  };

  const removeOrder = (id) => {
    const list = db.get(STORAGE_KEYS.ORDERS, []);
    db.set(STORAGE_KEYS.ORDERS, list.filter((x) => x.id !== id));
    refresh();
  };

  return {
    orders,
    refresh,
    createOrder,
    updateOrder,
    addItem,
    assignPicker,
    markPicking,
    markPicked,
    moveToQC,
    markPartial,
    complete,
    archive,
    addEkDepo,
    removeOrder,
  };
}

/****************************
 * Bildirimler
 ****************************/
function pushNotif({ title, message, type = "info" }) {
  const list = db.get(STORAGE_KEYS.NOTIFS, []);
  const n = { id: uuidv4(), title, message, type, at: new Date().toISOString(), read: false };
  list.unshift(n);
  db.set(STORAGE_KEYS.NOTIFS, list);
  notify({ type: "notif", data: n });
}

function useNotifications() {
  useBus();
  const [list, setList] = useState(() => db.get(STORAGE_KEYS.NOTIFS, []));
  useEffect(() => {
    const i = setInterval(() => setList(db.get(STORAGE_KEYS.NOTIFS, [])), 500);
    return () => clearInterval(i);
  }, []);
  const markRead = (id) => {
    const arr = db.get(STORAGE_KEYS.NOTIFS, []);
    const idx = arr.findIndex((x) => x.id === id);
    if (idx >= 0) arr[idx].read = true;
    db.set(STORAGE_KEYS.NOTIFS, arr);
    setList([...arr]);
  };
  const clear = () => {
    db.set(STORAGE_KEYS.NOTIFS, []);
    setList([]);
  };
  return { list, markRead, clear };
}

/****************************
 * Servis Katmanı İskeleti (API)
 ****************************/
const api = {
  // Mikro/SQL tarafına bağlamak için burada gerçek istekler yazılacak.
  // Şimdilik localStorage verilerini döndürüyoruz.
  async listProducts() { return db.get(STORAGE_KEYS.PRODUCTS, []); },
  async listOrders() { return db.get(STORAGE_KEYS.ORDERS, []); },
  async listUsers() { return db.get(STORAGE_KEYS.USERS, []); },
  // --- Mikro SQL entegrasyon iskeleti ---
  async pushOrderToMikro(order) {
    // Örnek: kendi FastAPI/Node API’nize POST atın
    // return fetch("/api/mikro/orders", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify(order) });
    console.info("[API] pushOrderToMikro (mock)", order.code);
    return { ok: true };
  },
  async pullStocksFromMikro() {
    // Örnek: Mikro SQL’den stok çekme
    // const res = await fetch("/api/mikro/stocks");
    // const json = await res.json();
    // db.set(STORAGE_KEYS.PRODUCTS, json);
    console.info("[API] pullStocksFromMikro (mock)");
    return db.get(STORAGE_KEYS.PRODUCTS, []);
  },
};

/****************************
 * UI — Ortak Bileşenler
 ****************************/
const Card = ({ className = "", children }) => (
  <div className={`bg-white rounded-2xl shadow p-5 ${className}`}>{children}</div>
);

const Tag = ({ children, color = "gray" }) => (
  <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium bg-${color}-100 text-${color}-800`}>{children}</span>
);

const Toolbar = ({ title, children, right }) => (
  <div className="flex items-center justify-between mb-4">
    <div className="flex items-center gap-3">
      <h2 className="text-xl font-semibold">{title}</h2>
      {children}
    </div>
    <div className="flex items-center gap-2">{right}</div>
  </div>
);

const SearchInput = ({ value, onChange, placeholder = "Ara..." }) => (
  <div className="relative">
    <input className="border rounded-xl pl-9 pr-3 py-2 w-72 focus:outline-none focus:ring focus:border-blue-400" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    <Search className="absolute left-2 top-2.5 w-4 h-4 opacity-60" />
  </div>
);

function StatusBadge({ status }) {
  const map = {
    [ORDER_STATUS.DRAFT]: "bg-gray-100 text-gray-800",
    [ORDER_STATUS.SUBMITTED]: "bg-blue-100 text-blue-800",
    [ORDER_STATUS.ASSIGNED]: "bg-violet-100 text-violet-800",
    [ORDER_STATUS.PICKING]: "bg-amber-100 text-amber-800",
    [ORDER_STATUS.PICKED]: "bg-emerald-100 text-emerald-800",
    [ORDER_STATUS.QC]: "bg-indigo-100 text-indigo-800",
    [ORDER_STATUS.PARTIAL]: "bg-orange-100 text-orange-800",
    [ORDER_STATUS.COMPLETED]: "bg-green-100 text-green-800",
    [ORDER_STATUS.ARCHIVED]: "bg-slate-100 text-slate-700",
  };
  return <span className={`text-xs px-2.5 py-1 rounded-full ${map[status]}`}>{status}</span>;
}

/****************************
 * Layout & Navigasyon
 ****************************/
function useNow() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

function Layout({ onLogout, session }) {
  const now = useNow();
  const nav = useNavigate();
  const [open, setOpen] = useState(true);
  const role = session?.role;

  const links = [
    { to: "/", label: "Panel", icon: <Warehouse className="w-4 h-4" /> },
    { to: "/products", label: "Ürünler", icon: <Boxes className="w-4 h-4" /> },
    { to: "/orders", label: "Siparişler", icon: <ShoppingCart className="w-4 h-4" /> },
    { to: "/picking", label: "Toplama", icon: <ClipboardCheck className="w-4 h-4" /> },
    { to: "/qc", label: "Kontrol", icon: <CheckCircle2 className="w-4 h-4" /> },
    { to: "/archive", label: "Arşiv", icon: <History className="w-4 h-4" /> },
    { to: "/settings", label: "Ayarlar", icon: <Settings className="w-4 h-4" /> },
  ];

  const filtered = links.filter((l) => {
    if (role === ROLES.BRANCH && ["/picking", "/qc"].includes(l.to)) return false;
    if (role === ROLES.PICKER && ["/settings", "/products"].includes(l.to)) return false;
    return true;
  });

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="sticky top-0 z-40 bg-white border-b">
        <div className="max-w-7xl mx-auto p-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button className="p-2 rounded-xl hover:bg-slate-100" onClick={() => setOpen(!open)}>
              {open ? <ArrowLeft className="w-5 h-5" /> : <ArrowRight className="w-5 h-5" />}
            </button>
            <Link to="/" className="flex items-center gap-2 font-semibold">
              <Package2 className="w-5 h-5" /> Depo Otomasyonu
            </Link>
            <span className="text-xs text-slate-500 hidden md:inline">{now.toLocaleString()}</span>
          </div>
          <div className="flex items-center gap-2">
            <NotifsBell />
            <div className="px-3 py-1 rounded-full bg-slate-100 text-slate-700 text-sm flex items-center gap-2">
              <User className="w-4 h-4" /> {session?.name} <span className="text-xs opacity-60">({session?.role})</span>
            </div>
            <button className="btn" onClick={() => { onLogout(); nav("/login"); }}>
              <LogOut className="w-4 h-4" /> Çıkış
            </button>
          </div>
        </div>
      </header>
      <div className="max-w-7xl mx-auto grid grid-cols-12 gap-4 p-4">
        <aside className={`col-span-12 md:col-span-3 lg:col-span-2 transition-all ${open ? "" : "-ml-64 md:ml-0"}`}>
          <Card>
            <nav className="flex flex-col gap-1">
              {filtered.map((l) => (
                <Link key={l.to} to={l.to} className="flex items-center gap-2 px-3 py-2 rounded-xl hover:bg-slate-100">
                  {l.icon} {l.label}
                </Link>
              ))}
            </nav>
          </Card>
          <Card className="mt-4">
            <p className="text-sm text-slate-600">Şube/Saha QR</p>
            <div className="mt-2 flex justify-center">
              <QRCodeSVG value="cookcerez://branch/S2" size={128} />
            </div>
          </Card>
        </aside>
        <main className="col-span-12 md:col-span-9 lg:col-span-10">
          <Routes>
            <Route index element={<Dashboard />} />
            <Route path="/products" element={<ProductsPage />} />
            <Route path="/orders" element={<OrdersPage />} />
            <Route path="/picking" element={<PickingPage />} />
            <Route path="/qc" element={<QCPage />} />
            <Route path="/archive" element={<ArchivePage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/" />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}

/****************************
 * Bildirim Çanı
 ****************************/
function NotifsBell() {
  const { list, markRead, clear } = useNotifications();
  const [open, setOpen] = useState(false);
  const unread = list.filter((x) => !x.read).length;
  return (
    <div className="relative">
      <button className="p-2 rounded-xl hover:bg-slate-100 relative" onClick={() => setOpen((o) => !o)}>
        <Bell className="w-5 h-5" />
        {unread > 0 && <span className="absolute -top-1 -right-1 bg-red-500 text-white rounded-full w-5 h-5 text-xs grid place-items-center">{unread}</span>}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} className="absolute right-0 mt-2 w-96 bg-white rounded-2xl shadow-xl border p-3">
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-semibold">Bildirimler</h3>
              <button className="text-xs text-slate-500 hover:underline" onClick={clear}>Temizle</button>
            </div>
            <div className="max-h-80 overflow-auto flex flex-col gap-2">
              {list.length === 0 && <p className="text-sm text-slate-500">Bildirim yok</p>}
              {list.map((n) => (
                <div key={n.id} className="p-2 rounded-xl border hover:bg-slate-50">
                  <div className="flex items-center justify-between">
                    <div className="font-medium">{n.title}</div>
                    <button className="text-xs text-blue-600" onClick={() => markRead(n.id)}>okundu</button>
                  </div>
                  <div className="text-sm text-slate-600">{n.message}</div>
                  <div className="text-[10px] text-slate-400">{new Date(n.at).toLocaleString()}</div>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/****************************
 * Sayfalar — Dashboard
 ****************************/
function Dashboard() {
  const { products } = useProducts();
  const { orders } = useOrders();
  const completed = orders.filter((o) => o.status === ORDER_STATUS.COMPLETED).length;
  const picking = orders.filter((o) => [ORDER_STATUS.PICKING, ORDER_STATUS.ASSIGNED].includes(o.status)).length;
  const pending = orders.filter((o) => [ORDER_STATUS.SUBMITTED].includes(o.status)).length;
  const lowStock = products.filter((p) => p.stock < 50).length;

  return (
    <div className="grid grid-cols-12 gap-4">
      <div className="col-span-12 lg:col-span-8">
        <Card>
          <Toolbar title="Özet">
            <Tag color="blue">Son 7 gün</Tag>
          </Toolbar>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Kpi title="Tamamlanan" value={completed} icon={<CircleCheck className="w-5 h-5" />} />
            <Kpi title="Toplamda" value={orders.length} icon={<ShoppingCart className="w-5 h-5" />} />
            <Kpi title="Bekleyen" value={pending} icon={<AlertTriangle className="w-5 h-5" />} />
            <Kpi title="Toplanıyor" value={picking} icon={<ClipboardCheck className="w-5 h-5" />} />
          </div>
        </Card>

        <Card className="mt-4">
          <Toolbar title="Düşük Stoklar" right={<Link className="btn" to="/products"><Boxes className="w-4 h-4" /> Ürünlere Git</Link>}>
            <Tag color="red">{lowStock} ürün</Tag>
          </Toolbar>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-500">
                <th className="py-2">Ürün</th>
                <th>Raf</th>
                <th>Stok</th>
              </tr>
            </thead>
            <tbody>
              {products.filter((p) => p.stock < 50).slice(0, 6).map((p) => (
                <tr key={p.id} className="border-t">
                  <td className="py-2">{p.name}</td>
                  <td>{p.aisle}</td>
                  <td>{p.stock}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
      <div className="col-span-12 lg:col-span-4">
        <Card>
          <Toolbar title="Hızlı İşlemler" />
          <div className="grid grid-cols-2 gap-3">
            <Link to="/orders" className="btn"><Plus className="w-4 h-4" /> Yeni Sipariş</Link>
            <Link to="/picking" className="btn"><QrCode className="w-4 h-4" /> Toplama</Link>
            <Link to="/qc" className="btn"><CheckCircle2 className="w-4 h-4" /> Kontrol</Link>
            <Link to="/archive" className="btn"><History className="w-4 h-4" /> Arşiv</Link>
          </div>
        </Card>
      </div>
    </div>
  );
}

function Kpi({ title, value, icon }) {
  return (
    <div className="p-4 rounded-2xl border bg-gradient-to-b from-white to-slate-50">
      <div className="text-xs text-slate-500">{title}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
      <div className="mt-3 opacity-60">{icon}</div>
    </div>
  );
}

/****************************
 * Sayfalar — Ürünler
 ****************************/
function ProductsPage() {
  const { products, add, update, remove } = useProducts();
  const [q, setQ] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [edit, setEdit] = useState(null);

  const filtered = products.filter((p) => [p.name, p.code, p.barcode, p.aisle].join(" ").toLowerCase().includes(q.toLowerCase()));

  return (
    <div>
      <Toolbar title="Ürünler" right={
        <div className="flex gap-2">
          <CSVLink data={products} filename="urunler.csv" className="btn"><FileSpreadsheet className="w-4 h-4" /> CSV</CSVLink>
          <button className="btn" onClick={() => { setEdit(null); setShowForm(true); }}><Plus className="w-4 h-4" /> Yeni Ürün</button>
        </div>
      }>
        <SearchInput value={q} onChange={setQ} placeholder="Ad/kod/barkod/raf..." />
      </Toolbar>
      <Card>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-slate-500">
              <th className="py-2">Ad</th>
              <th>Kod</th>
              <th>Barkod</th>
              <th>Raf</th>
              <th>Stok</th>
              <th>Birim</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((p) => (
              <tr key={p.id} className="border-t">
                <td className="py-2">{p.name}</td>
                <td>{p.code}</td>
                <td>{p.barcode}</td>
                <td>{p.aisle}</td>
                <td>{p.stock}</td>
                <td>{p.unit}</td>
                <td className="text-right">
                  <button className="icon-btn" onClick={() => { setEdit(p); setShowForm(true); }}><Edit3 className="w-4 h-4" /></button>
                  <button className="icon-btn" onClick={() => remove(p.id)}><Trash2 className="w-4 h-4" /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <AnimatePresence>
        {showForm && (
          <Modal onClose={() => setShowForm(false)}>
            <ProductForm initial={edit} onSubmit={(vals) => {
              if (edit) update(edit.id, vals); else add(vals);
              setShowForm(false);
            }} />
          </Modal>
        )}
      </AnimatePresence>
    </div>
  );
}

function ProductForm({ initial, onSubmit }) {
  const [form, setForm] = useState(() => initial || { name: "", code: "", barcode: "", aisle: "A01", stock: 0, unit: "paket" });
  return (
    <div className="space-y-3">
      <h3 className="text-lg font-semibold">{initial ? "Ürün Düzenle" : "Yeni Ürün"}</h3>
      <div className="grid grid-cols-2 gap-2">
        <Input label="Ad" value={form.name} onChange={(v) => setForm({ ...form, name: v })} />
        <Input label="Kod" value={form.code} onChange={(v) => setForm({ ...form, code: v })} />
        <Input label="Barkod" value={form.barcode} onChange={(v) => setForm({ ...form, barcode: v })} />
        <Input label="Raf (Aisle)" value={form.aisle} onChange={(v) => setForm({ ...form, aisle: v })} />
        <Input label="Stok" type="number" value={form.stock} onChange={(v) => setForm({ ...form, stock: Number(v) })} />
        <Input label="Birim" value={form.unit} onChange={(v) => setForm({ ...form, unit: v })} />
      </div>
      <div className="flex justify-end gap-2">
        <button className="btn-secondary" onClick={() => onSubmit(form)}><Save className="w-4 h-4" /> Kaydet</button>
      </div>
    </div>
  );
}

/****************************
 * Sayfalar — Siparişler
 ****************************/
function OrdersPage() {
  const { session } = React.useContext(SessionCtx);
  const { orders, createOrder, addItem, updateOrder, removeOrder } = useOrders();
  const { products } = useProducts();
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState(null);
  const [showNew, setShowNew] = useState(false);
  const [branchId, setBranchId] = useState(session?.branchId || DEFAULT_BRANCHES[0].id);

  const filtered = orders.filter((o) => [o.code, o.status, o.branchId, o.note].join(" ").toLowerCase().includes(q.toLowerCase()) && o.status !== ORDER_STATUS.ARCHIVED);

  const exportCsv = (o) => {
    const rows = o.items.map((i) => ({ code: i.code, name: i.name, qty: i.qty, unit: i.unit, aisle: i.aisle, barcode: i.barcode }));
    const blob = new Blob(["code,name,qty,unit,aisle,barcode
" + rows.map((r) => `${r.code},${r.name},${r.qty},${r.unit},${r.aisle},${r.barcode}`).join("
")], { type: "text/csv;charset=utf-8" });
    saveAs(blob, `${o.code}.csv`);
  };

  const exportXlsx = async (o) => {
    const rows = o.items.map((i) => ({ Kod: i.code, Ürün: i.name, Adet: i.qty, Birim: i.unit, Raf: i.aisle, Barkod: i.barcode }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, o.code);
    const out = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    const blob = new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    saveAs(blob, `${o.code}.xlsx`);
  };

  const printOrder = (o) => {
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${o.code}</title>
      <style> body{font-family:system-ui,Segoe UI,Roboto,Arial;padding:24px;} table{width:100%;border-collapse:collapse} th,td{border:1px solid #ddd;padding:8px;font-size:12px} th{background:#f6f8fa;text-align:left} h1{font-size:18px} .muted{color:#6b7280;font-size:12px}</style>
      </head><body>
      <h1>Sipariş: ${o.code}</h1>
      <div class="muted">Şube: ${o.branchId} &nbsp; | &nbsp; Durum: ${o.status} &nbsp; | &nbsp; Kalem: ${o.items.length}</div>
      <table><thead><tr><th>#</th><th>Kod</th><th>Ürün</th><th>Adet</th><th>Birim</th><th>Raf</th><th>Barkod</th></tr></thead><tbody>
      ${o.items.map((i,idx)=>`<tr><td>${idx+1}</td><td>${i.code}</td><td>${i.name}</td><td>${i.qty}</td><td>${i.unit}</td><td>${i.aisle}</td><td>${i.barcode}</td></tr>`).join("")}
      </tbody></table>
      <script>window.onload=()=>window.print()</script>
      </body></html>`;
    const w = window.open("", "_blank");
    if (w) { w.document.write(html); w.document.close(); }
  };

  const pushToMikro = async (o) => {
    const res = await api.pushOrderToMikro(o);
    pushNotif({ title: "Mikro Gönderimi", message: `${o.code} gönderim sonucu: ${res.ok?"başarılı":"hata"}`, type: res.ok?"info":"warning" });
  };

  return (
    <div>
      <Toolbar title="Siparişler" right={
        <div className="flex gap-2">
          <button className="btn" onClick={() => setShowNew(true)}><Plus className="w-4 h-4" /> Yeni</button>
        </div>
      }>
        <SearchInput value={q} onChange={setQ} placeholder="Kod/durum/şube/not..." />
      </Toolbar>
      <div className="grid grid-cols-12 gap-4">
        <div className="col-span-12 lg:col-span-7">
          <Card>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-500">
                  <th className="py-2">Kod</th>
                  <th>Şube</th>
                  <th>Durum</th>
                  <th>Kalem</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((o) => (
                  <tr key={o.id} className="border-t hover:bg-slate-50">
                    <td className="py-2">{o.code}</td>
                    <td>{o.branchId}</td>
                    <td><StatusBadge status={o.status} /></td>
                    <td>{o.items.length}</td>
                    <td className="text-right">
                      <button className="icon-btn" onClick={() => setSelected(o)}><ArrowRight className="w-4 h-4" /></button>
                      <button className="icon-btn" onClick={() => exportCsv(o)}><Download className="w-4 h-4" /></button>
                      <button className="icon-btn" onClick={() => exportXlsx(o)}><FileSpreadsheet className="w-4 h-4" /></button>
                      <button className="icon-btn" onClick={() => printOrder(o)}><Printer className="w-4 h-4" /></button>
                      <button className="icon-btn" onClick={() => pushToMikro(o)}><Upload className="w-4 h-4" /></button>
                      <button className="icon-btn" onClick={() => removeOrder(o.id)}><Trash2 className="w-4 h-4" /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>
        <div className="col-span-12 lg:col-span-5">
          <Card>
            {selected ? (
              <OrderDetail
                order={selected}
                onClose={() => setSelected(null)}
                onSubmitItem={(it) => addItem(selected.id, it, "orders-page")}
                onChange={(patch) => { updateOrder(selected.id, patch, "orders-page"); setSelected({ ...selected, ...patch }); }}
              />
            ) : (
              <div className="text-slate-500">Soldan bir sipariş seçin.</div>
            )}
          </Card>
        </div>
      </div>

      <AnimatePresence>
        {showNew && (
          <Modal onClose={() => setShowNew(false)}>
            <div className="space-y-3">
              <h3 className="text-lg font-semibold">Yeni Sipariş</h3>
              <div className="grid grid-cols-2 gap-2">
                <Select label="Şube" value={branchId} onChange={setBranchId} options={DEFAULT_BRANCHES.map(b => ({ label: `${b.id} — ${b.name}`, value: b.id }))} />
                <Input label="Not" placeholder="(Opsiyonel)" onChange={() => {}} />
              </div>
              <div className="flex justify-end">
                <button className="btn" onClick={() => { const o = createOrder({ branchId, createdBy: "orders-page" }); setShowNew(false); }}><Save className="w-4 h-4" /> Oluştur</button>
              </div>
            </div>
          </Modal>
        )}
      </AnimatePresence>
    </div>
  );
}

function OrderDetail({ order, onClose, onSubmitItem, onChange }) {
  const { products } = useProducts();
  const [q, setQ] = useState("");
  const [qty, setQty] = useState(1);
  const [sel, setSel] = useState(null);

  const prodList = products.filter((p) => [p.name, p.code, p.barcode, p.aisle].join(" ").toLowerCase().includes(q.toLowerCase()));

  const addSelected = () => {
    if (!sel) return;
    onSubmitItem({ productId: sel.id, code: sel.code, name: sel.name, qty, unit: sel.unit, aisle: sel.aisle, barcode: sel.barcode });
  };

  return (
    <div>
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">{order.code} — <StatusBadge status={order.status} /></h3>
        <button className="icon-btn" onClick={onClose}><X className="w-4 h-4" /></button>
      </div>
      <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
        <Card className="bg-slate-50 border">
          <div className="flex items-center justify-between mb-2">
            <div className="font-medium">Ürün Kataloğu</div>
            <SearchInput value={q} onChange={setQ} placeholder="Ürün ara..." />
          </div>
          <div className="max-h-64 overflow-auto">
            {prodList.map((p) => (
              <div key={p.id} className={`p-2 rounded-xl border mb-2 ${sel?.id===p.id?"bg-blue-50 border-blue-300":""}`}>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium">{p.name}</div>
                    <div className="text-xs text-slate-500">{p.code} • {p.barcode} • Raf {p.aisle}</div>
                  </div>
                  <button className="btn" onClick={() => setSel(p)}><Plus className="w-4 h-4" /> Seç</button>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-2 flex items-center gap-2">
            <Input label="Adet" type="number" value={qty} onChange={(v) => setQty(Number(v))} />
            <button className="btn" onClick={addSelected}><ShoppingCart className="w-4 h-4" /> Ekle</button>
          </div>
        </Card>
        <Card className="bg-slate-50 border">
          <div className="font-medium mb-2">Sipariş Kalemleri</div>
          <div className="max-h-64 overflow-auto">
            {order.items.length === 0 && <div className="text-sm text-slate-500">Henüz kalem yok.</div>}
            {order.items.map((i, idx) => (
              <div key={idx} className="p-2 rounded-xl border mb-2">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium">{i.name}</div>
                    <div className="text-xs text-slate-500">{i.code} • Raf {i.aisle}</div>
                  </div>
                  <div className="text-sm">x{i.qty} {i.unit}</div>
                </div>
              </div>
            ))}
          </div>
          <div className="flex justify-end gap-2 mt-2">
            <button className="btn-secondary" onClick={() => onChange({ status: ORDER_STATUS.SUBMITTED })}><Send className="w-4 h-4" /> Gönder</button>
          </div>
        </Card>
      </div>
      <div className="mt-3">
        <div className="text-xs text-slate-500">Geçmiş</div>
        <div className="max-h-32 overflow-auto text-xs mt-1 space-y-1">
          {order.history.map((h, i) => (
            <div key={i} className="text-slate-600">{new Date(h.at).toLocaleString()} — {h.by}: {h.action}</div>
          ))}
        </div>
      </div>
    </div>
  );
}

/****************************
 * Sayfalar — Toplama (Picker)
 ****************************/
function PickingPage() {
  const { session } = React.useContext(SessionCtx);
  const { orders, assignPicker, markPicking, markPicked, moveToQC } = useOrders();
  const [active, setActive] = useState(null);
  const [scannerOn, setScannerOn] = useState(false);
  const videoRef = useRef(null);
  const [scanValue, setScanValue] = useState("");
  const [lastDetected, setLastDetected] = useState("");
  const [supported, setSupported] = useState(false);

  const myOrders = orders.filter((o) => [ORDER_STATUS.SUBMITTED, ORDER_STATUS.ASSIGNED, ORDER_STATUS.PICKING].includes(o.status));

  useEffect(() => {
    setSupported("BarcodeDetector" in window);
  }, []);

  useEffect(() => {
    let stream;
    let raf;
    let detector;
    const start = async () => {
      if (!scannerOn) return;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        if ("BarcodeDetector" in window) {
          detector = new window.BarcodeDetector({ formats: ["qr_code", "ean_13", "code_128"] });
          const detect = async () => {
            if (videoRef.current && !videoRef.current.paused) {
              try {
                const codes = await detector.detect(videoRef.current);
                if (codes && codes[0]) {
                  const val = codes[0].rawValue;
                  if (val && val !== lastDetected) {
                    setLastDetected(val);
                    setScanValue(val);
                    pushNotif({ title: "Barkod", message: `Okundu: ${val}`, type: "info" });
                  }
                }
              } catch {}
            }
            raf = requestAnimationFrame(detect);
          };
          raf = requestAnimationFrame(detect);
        }
      } catch (e) {
        console.warn("Kamera açılamadı", e);
      }
    };
    start();
    return () => {
      if (raf) cancelAnimationFrame(raf);
      if (stream) stream.getTracks().forEach(t => t.stop());
    };
  }, [scannerOn]);

  const handleAssign = (o) => assignPicker(o.id, session?.uid || "picker", "picking-page");
  const handleStart = (o) => markPicking(o.id, "picking-page");
  const handlePicked = (o) => markPicked(o.id, "picking-page");
  const handleToQC = (o) => moveToQC(o.id, "picking-page");

  return (
    <div>
      <Toolbar title="Toplama" right={<button className={`btn ${scannerOn?"bg-emerald-600 hover:bg-emerald-700":""}`} onClick={() => setScannerOn((s) => !s)}>{scannerOn? <Camera className="w-4 h-4" />: <QrCode className="w-4 h-4" />} {scannerOn? "Kamera Açık": "Kamera"}</button>}>
        <span className="text-sm text-slate-500">Toplayıcı: siz</span>
      </Toolbar>

      <div className="grid grid-cols-12 gap-4">
        <div className="col-span-12 lg:col-span-6">
          <Card>
            <div className="font-medium mb-2">Bekleyen/Görevde Siparişler</div>
            <div className="space-y-2 max-h-96 overflow-auto">
              {myOrders.map((o) => (
                <div key={o.id} className={`p-3 rounded-2xl border ${active?.id===o.id?"bg-blue-50 border-blue-300":""}`}>
                  <div className="flex items-center justify-between">
                    <div className="font-semibold">{o.code} — <StatusBadge status={o.status} /></div>
                    <div className="flex gap-2">
                      {o.status === ORDER_STATUS.SUBMITTED && <button className="btn-secondary" onClick={() => handleAssign(o)}><Users2 className="w-4 h-4" /> Al</button>}
                      {[ORDER_STATUS.ASSIGNED, ORDER_STATUS.SUBMITTED].includes(o.status) && <button className="btn" onClick={() => handleStart(o)}><PlayIcon /> Başlat</button>}
                      {o.status === ORDER_STATUS.PICKING && <button className="btn" onClick={() => handlePicked(o)}><CircleCheck className="w-4 h-4" /> Bitti</button>}
                      {o.status === ORDER_STATUS.PICKED && <button className="btn" onClick={() => handleToQC(o)}><Shield className="w-4 h-4" /> QC</button>}
                      <button className="btn" onClick={() => setActive(o)}><ArrowRight className="w-4 h-4" /> Detay</button>
                    </div>
                  </div>
                  <div className="text-xs text-slate-500">Kalem: {o.items.length} • Şube: {o.branchId}</div>
                </div>
              ))}
            </div>
          </Card>
        </div>
        <div className="col-span-12 lg:col-span-6">
          <Card>
            {active ? (
              <div>
                <div className="flex items-center justify-between">
                  <div className="font-semibold">{active.code} — Toplama</div>
                  <button className="icon-btn" onClick={() => setActive(null)}><X className="w-4 h-4" /></button>
                </div>
                <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="p-3 rounded-2xl border bg-slate-50">
                    <div className="font-medium">Kalemler (Raf Sırasına Göre)</div>
                    <div className="text-xs text-slate-500">Topla ve "okundu" gibi işaretle</div>
                    <div className="max-h-64 overflow-auto mt-2">
                      {active.items.map((i, idx) => (
                        <div key={idx} className="p-2 rounded-xl border mb-2 flex items-center justify-between">
                          <div>
                            <div className="font-medium">{i.name}</div>
                            <div className="text-xs text-slate-500">Raf {i.aisle} • {i.code}</div>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-sm">x{i.qty}</span>
                            <button className="btn-secondary"><ClipboardCheck className="w-4 h-4" /> Toplandı</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="p-3 rounded-2xl border bg-slate-50">
                    <div className="font-medium flex items-center gap-2"><QrCode className="w-4 h-4" /> Barkod/QR</div>
                    <div className="text-xs text-slate-500">{supported ? "Cihazınız BarcodeDetector destekliyor." : "Tarayıcı desteklemiyorsa manuel giriş kullanın."}</div>
                    <input className="mt-2 border rounded-xl px-3 py-2 w-full" placeholder="Barkod/QR" value={scanValue} onChange={(e) => setScanValue(e.target.value)} />
                    <button className="btn mt-2" onClick={() => setScanValue("")}>Okut</button>
                    {scannerOn && (
                      <div className="mt-3">
                        <video ref={videoRef} className="w-full rounded-xl bg-black aspect-video"/>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-slate-500">Soldan bir sipariş seçin.</div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

const PlayIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4"><path d="M8 5v14l11-7z"/></svg>
);

/****************************
 * Sayfalar — QC (Kontrol)
 ****************************/
function QCPage() {
  const { orders, markPartial, complete } = useOrders();
  const [active, setActive] = useState(null);
  const list = orders.filter((o) => [ORDER_STATUS.PICKED, ORDER_STATUS.QC].includes(o.status));

  return (
    <div>
      <Toolbar title="Kontrol (QC)" />
      <div className="grid grid-cols-12 gap-4">
        <div className="col-span-12 lg:col-span-6">
          <Card>
            <div className="font-medium mb-2">QC Bekleyen</div>
            <div className="space-y-2 max-h-96 overflow-auto">
              {list.map((o) => (
                <div key={o.id} className={`p-3 rounded-2xl border ${active?.id===o.id?"bg-blue-50 border-blue-300":""}`}>
                  <div className="flex items-center justify-between">
                    <div className="font-semibold">{o.code} — <StatusBadge status={o.status} /></div>
                    <div className="flex gap-2">
                      <button className="btn" onClick={() => setActive(o)}><ArrowRight className="w-4 h-4" /> Aç</button>
                    </div>
                  </div>
                  <div className="text-xs text-slate-500">Kalem: {o.items.length} • Şube: {o.branchId}</div>
                </div>
              ))}
            </div>
          </Card>
        </div>
        <div className="col-span-12 lg:col-span-6">
          <Card>
            {active ? (
              <div>
                <div className="flex items-center justify-between">
                  <div className="font-semibold">{active.code} — QC</div>
                  <button className="icon-btn" onClick={() => setActive(null)}><X className="w-4 h-4" /></button>
                </div>
                <div className="mt-3">
                  <div className="text-sm text-slate-600">Toplanan kalem sayısı: {active.items.length}</div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-2">
                    <button className="btn" onClick={() => complete(active.id, "qc-page") }><CircleCheck className="w-4 h-4" /> Onayla (Tamam)</button>
                    <button className="btn-secondary" onClick={() => markPartial(active.id, "qc-page") }><AlertTriangle className="w-4 h-4" /> Kısmi</button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-slate-500">Soldan bir sipariş seçin.</div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

/****************************
 * Sayfalar — Arşiv
 ****************************/
function ArchivePage() {
  const { orders, archive } = useOrders();
  const list = orders.filter((o) => [ORDER_STATUS.COMPLETED, ORDER_STATUS.PARTIAL, ORDER_STATUS.ARCHIVED].includes(o.status));
  return (
    <div>
      <Toolbar title="Arşiv" />
      <Card>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-slate-500">
              <th className="py-2">Kod</th>
              <th>Durum</th>
              <th>Şube</th>
              <th>Kalem</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {list.map((o) => (
              <tr key={o.id} className="border-t">
                <td className="py-2">{o.code}</td>
                <td><StatusBadge status={o.status} /></td>
                <td>{o.branchId}</td>
                <td>{o.items.length}</td>
                <td className="text-right">
                  {o.status !== ORDER_STATUS.ARCHIVED && <button className="btn-secondary" onClick={() => archive(o.id, "archive-page")}><History className="w-4 h-4" /> Arşivle</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

/****************************
 * Sayfalar — Ayarlar
 ****************************/
function SettingsPage() {
  const [settings, setSettings] = useState(() => db.get(STORAGE_KEYS.SETTINGS, {}));
  const save = () => { db.set(STORAGE_KEYS.SETTINGS, settings); pushNotif({ title: "Ayarlar", message: "Kaydedildi", type: "info" }); };

  return (
    <div>
      <Toolbar title="Ayarlar" />
      <div className="grid grid-cols-12 gap-4">
        <div className="col-span-12 lg:col-span-6">
          <Card>
            <div className="font-semibold">Firma</div>
            <Input label="Ad" value={settings.company} onChange={(v) => setSettings({ ...settings, company: v })} />
          </Card>
          <Card className="mt-4">
            <div className="font-semibold">Ek Depo Politikası</div>
            <label className="mt-2 flex items-center gap-2 text-sm">
              <input type="checkbox" checked={settings.ekDepoPolicy?.autoNotifyBranch} onChange={(e) => setSettings({ ...settings, ekDepoPolicy: { ...settings.ekDepoPolicy, autoNotifyBranch: e.target.checked } })} />
              Kalem eklendiğinde şubeye otomatik bildirim
            </label>
          </Card>
          <div className="mt-4 flex justify-end">
            <button className="btn" onClick={save}><Save className="w-4 h-4" /> Kaydet</button>
          </div>
        </div>
        <div className="col-span-12 lg:col-span-6">
          <Card>
            <div className="font-semibold">Şubeler</div>
            <div className="text-xs text-slate-500">Sabit demo listesi. Mikro SQL ile senkronize edilebilir.</div>
            <ul className="mt-2 list-disc list-inside text-sm">
              {settings.branches?.map((b) => <li key={b.id}>{b.id} — {b.name}</li>)}
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}

/****************************
 * Ortak: Modal, Input, Select
 ****************************/
function Modal({ children, onClose }) {
  return (
    <AnimatePresence>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/30 grid place-items-center p-4 z-50">
        <motion.div initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 20, opacity: 0 }} className="bg-white rounded-2xl shadow-xl p-4 w-full max-w-2xl relative">
          <button className="icon-btn absolute right-3 top-3" onClick={onClose}><X className="w-4 h-4" /></button>
          {children}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

function Input({ label, value, onChange, type = "text", placeholder }) {
  return (
    <label className="block text-sm">
      <span className="text-slate-600">{label}</span>
      <input value={value} onChange={(e) => onChange?.(e.target.value)} type={type} placeholder={placeholder}
             className="mt-1 border rounded-xl px-3 py-2 w-full focus:outline-none focus:ring" />
    </label>
  );
}

function Select({ label, value, onChange, options }) {
  return (
    <label className="block text-sm">
      <span className="text-slate-600">{label}</span>
      <select value={value} onChange={(e) => onChange?.(e.target.value)} className="mt-1 border rounded-xl px-3 py-2 w-full focus:outline-none focus:ring">
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}

/****************************
 * Kimlik Doğrulama Sayfası
 ****************************/
const SessionCtx = React.createContext({ session: null });

function LoginPage() {
  const { login } = React.useContext(SessionCtx);
  const nav = useNavigate();
  const [email, setEmail] = useState("admin@depo.app");
  const [pass, setPass] = useState("1234");
  const [err, setErr] = useState("");

  const submit = () => {
    try {
      login(email, pass);
      nav("/");
    } catch (e) {
      setErr(e.message);
    }
  };

  return (
    <div className="min-h-screen grid place-items-center bg-slate-50 p-4">
      <Card className="w-full max-w-md">
        <div className="flex items-center gap-2 text-xl font-semibold"><Package2 className="w-5 h-5" /> Depo Otomasyonu</div>
        <p className="text-sm text-slate-500 mt-1">Rol bazlı giriş (admin@depo.app / 1234)</p>
        <div className="mt-4 space-y-3">
          <Input label="E-posta" value={email} onChange={setEmail} />
          <Input label="Şifre" value={pass} onChange={setPass} type="password" />
          {err && <div className="text-sm text-red-600">{err}</div>}
          <button className="btn w-full" onClick={submit}><LogOut className="w-4 h-4" /> Giriş</button>
        </div>
      </Card>
    </div>
  );
}

/****************************
 * Stil Yardımcıları (buton vb.)
 ****************************/
const base = "inline-flex items-center gap-2 px-3 py-2 rounded-2xl border shadow-sm hover:shadow transition-all";
const btn = `${base} bg-blue-600 text-white hover:bg-blue-700`;
const btnSecondary = `${base} bg-white hover:bg-slate-50`;
const iconBtn = "p-2 rounded-xl hover:bg-slate-100";

function injectStyles() {
  const style = document.createElement("style");
  style.innerHTML = `
    .btn{ ${css(btn)} }
    .btn-secondary{ ${css(btnSecondary)} }
    .icon-btn{ ${css(iconBtn)} }
  `;
  document.head.appendChild(style);
}

function css(classes) { return classes.split(" ").map(c => `@apply ${c};`).join(" "); }

/****************************
 * PWA Hazırlık (opsiyonel)
 ****************************/
function usePwa() {
  useEffect(() => {
    // Basit manifest ekleme (isteğe bağlı)
    const link = document.createElement("link");
    link.rel = "manifest";
    link.href = "/manifest.webmanifest"; // dışarıda yoksa sorun değil; PWA kaydı yine de çalışır
    if (!document.querySelector('link[rel="manifest"]')) document.head.appendChild(link);

    // Service Worker kaydı (offline cache için)
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(console.warn);
    }
  }, []);
}, []);
}

/****************************
 * Kök — App
 ****************************/
function App() {
  const auth = useSession();
  usePwa();
  useEffect(() => injectStyles(), []);

  return (
    <SessionCtx.Provider value={{ ...auth, session: auth.session }}>
      <BrowserRouter>
        {auth.session ? (
          <Layout onLogout={auth.logout} session={auth.session} />
        ) : (
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="*" element={<Navigate to="/login" />} />
          </Routes>
        )}
      </BrowserRouter>
    </SessionCtx.Provider>
  );
}

export default App;

/****************************
 * Mount (Preview için)
 ****************************/
const rootEl = document.getElementById("root");
if (rootEl) {
  const root = createRoot(rootEl);
  root.render(<App />);
}
