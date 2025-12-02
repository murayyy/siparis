# Depo Otomasyon Sistemi (Firebase + Netlify)

Bu proje, Firebase üzerinde çalışan, rollere göre ayrılmış (admin, manager, picker, branch) bir depo otomasyon sistemidir.

## Özellikler

- Firebase Authentication ile giriş / kayıt
- Kullanıcı rolleri: admin, manager, picker, branch
- Ürün yönetimi:
  - Ürün ekleme / düzenleme / silme
  - Stok alanı
  - Raf kodu, birim, açıklama
- Stok hareketleri:
  - Giriş / Çıkış / Transfer
  - Son 10 hareket listesi
  - Hareket sonrası ürün stok güncelleme
- Şube siparişleri:
  - Şube kullanıcıları yeni sipariş açar
  - Birden çok ürün satırı ekleme
- Sipariş atama:
  - Manager / Admin, siparişi toplayıcıya atar
- Toplayıcı ekranı:
  - Kendisine atanmış siparişleri görür
  - Her satır için toplanan miktarı girer
  - Siparişi "tamamlandı" yapar
- Dashboard:
  - Toplam ürün / açık sipariş / toplanan / tamamlanan
- Basit rapor ekranı:
  - Toplam ürün, toplam sipariş, tamamlanan sipariş özetleri

## Kurulum

1. Bu klasörü GitHub reposu yap.
2. Firebase projesinde:
   - Authentication → Email/Password aktif olmalı.
   - Firestore etkin olmalı.
3. `app.js` içindeki `firebaseConfig` senin projenle uyumlu (şu an senin verdiğin config).
4. Netlify:
   - New site from Git → GitHub reposunu seç
   - Build command boş bırak (static site)
   - Publish directory: `.` (root)
5. Deploy et, site açıldığında:
   - Önce "Kayıt Ol" sekmesinden bir admin veya manager kullanıcı oluştur.
   - Sonra giriş yapıp ürünleri ekle, stok hareketleri ve sipariş akışını kullan.

