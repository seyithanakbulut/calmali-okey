# Çalmalı 101

Taş çalmanın serbest olduğu (ya da dürüst) online 101 okey. Node.js + Express + Socket.IO.

## Bilgisayarda çalıştırma

```
npm install
npm start
```

Tarayıcıda `http://localhost:3000` adresine gir.

## Canlıya alma (Render, ücretsiz)

1. **GitHub'a yükle**
   - github.com'da yeni bir depo aç (ör. `calmali-okey`).
   - Bu klasörde:
     ```
     git init
     git add .
     git commit -m "ilk sürüm"
     git branch -M main
     git remote add origin https://github.com/KULLANICI_ADIN/calmali-okey.git
     git push -u origin main
     ```
   - `node_modules` klasörü `.gitignore` sayesinde yüklenmez, yüklenmemeli.

2. **Render'da servis aç**
   - render.com'a GitHub hesabınla gir.
   - **New → Web Service**, depoyu seç.
   - Ayarlar:
     - Runtime: **Node**
     - Build Command: `npm install`
     - Start Command: `npm start`
     - Instance Type: **Free**
   - **Create Web Service**. Birkaç dakika sonra `https://calmali-okey.onrender.com` gibi bir adres verir.

3. **Güncelleme**
   - Kodu değiştirince `git add . && git commit -m "..." && git push` yeterli, Render kendiliğinden yeniden kurar.

## Bilinmesi gerekenler (ücretsiz paket)

- 15 dakika kimse girmezse sunucu uyur. İlk giren yaklaşık 1 dakika bekler, sonra normal açılır. Oyun oynanırken uyumaz.
- Sunucu yeniden başlayınca (güncelleme, uyku) açık masalar ve oyunlar silinir. Puanlar şimdilik hafızada tutuluyor.
- Kalıcı kullanıcı, sıralama, istatistik gibi şeyler için ileride bir veritabanı (ör. MongoDB Atlas ya da Supabase ücretsiz paketi) eklenir.

## Ayarlar

Tüm kural sayıları `game.js` içindeki `CONFIG`'de. Değiştirince kurallar penceresi de kendiliğinden güncellenir.
