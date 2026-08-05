# PROJECT TECHNICAL REPORT
# Delta PLC Tabanlı İklimlendirme Web Test Bench

**Belge Versiyonu:** 1.0  
**Tarih:** 2026-08-04  
**Platform:** Node.js + Vanilla JS SPA  
**Donanım Hedefi:** Delta DVP / AS Serisi PLC — Modbus TCP  

---

## İÇİNDEKİLER

1. Proje Özeti ve Saha Amacı
2. Teknik Mimari ve Teknoloji Yığını
3. Haberleşme ve Adres Haritası
4. Ekran Akışları ve İşlevleri
5. Güvenlik, Hata Yönetimi ve Çökme Önleme (Fail-Safe)
6. Dosya Ağacı ve Çalıştırma Adımları

---

## 1. PROJE ÖZETİ VE SAHA AMACI

### 1.1 Tanım

Bu proje, iklimlendirme (HVAC) sistemlerinde kullanılan Delta PLC kontrolcülerini saha kurulumu öncesinde bilgisayar ortamında test etmek amacıyla geliştirilmiş bir Web tabanlı SCADA/HMI Test Bench uygulamasıdır. Sistem, PLC'ye Modbus TCP protokolü üzerinden Ethernet bağlantısıyla erişir; register okuma/yazma ve coil kontrol işlemlerini web arayüzü üzerinden gerçekleştirir.

### 1.2 Dry Run (Kuru Test) Mantığı

Saha kurulumu öncesinde yapılan "Dry Run" testi, gerçek iklimlendirme yükleri (kompresör, fan motoru, solenoid vana) devreye alınmadan PLC program mantığının, I/O adreslemesinin ve kontrol sıralarının doğrulanması sürecidir.

**Dry Run kapsamı:**

- D register'larına test değeri yazarak kontrol algoritmalarının tepkisini gözlemleme (SET işlemi).
- M coil'lerini ON/OFF yaparak röle çıkış mantığını doğrulama.
- Polling sırasında register değerlerinin beklenen sınırlarda kaldığını izleme.
- Master START/STOP döngüsünde fail-safe reset mekanizmasının çalışmasını teyit etme.

### 1.3 Güvenlik ve Maliyet Avantajı

| Avantaj | Açıklama |
|---------|----------|
| Ekipman koruma | Yanlış adreslenmiş bir coil çıkışı saha ekipmanını hasarlayabilir. Dry Run bu riski ortadan kaldırır. |
| Zaman tasarrufu | Saha bakım teknisyeni yerine ofis ortamında mühendis tarafından test yapılabilir. |
| Maliyet | Saha güç bağlantılarının devreye alınması gerekmeden PLC programı doğrulanır. |
| Tekrarlanabilirlik | Her yazılım güncellemesi sonrasında aynı test senaryosu yeniden çalıştırılabilir. |
| Uzaktan izleme | Web tabanlı yapı sayesinde aynı ağdaki herhangi bir bilgisayardan erişim mümkündür. |

---

## 2. TEKNİK MİMARİ VE TEKNOLOJİ YIĞINI

### 2.1 Genel Mimari

```
[Tarayıcı / HMI Terminali]
        |
        | HTTP (Static Files)
        | WebSocket (Socket.io)
        |
[Node.js Backend — localhost:3000]
        |
        | Modbus TCP (Ethernet, IP:Port)
        |
[Delta PLC — DVP/AS Serisi]
```

Uygulama, tek bir Node.js süreci üzerinde hem HTTP statik dosya sunumu hem de WebSocket iletişimi hem de Modbus TCP istemci görevini üstlenir. Frontend SPA (Single Page Application) olarak yapılandırılmıştır; sayfa yenilemesi olmadan 3 view arasında geçiş yapılır.

### 2.2 Frontend

| Bileşen | Teknoloji | Versiyon / Kaynak |
|---------|-----------|-------------------|
| Yapı | Vanilla HTML5 + JavaScript (ES6+) | — |
| Stil | Vanilla CSS — CSS Custom Properties (dual theme) | — |
| İkonlar | Lucide Icons | unpkg CDN |
| WebSocket istemci | Socket.io Client | /socket.io/socket.io.js (backend'den servis edilir) |
| SPA Router | Özel — `showView()` fonksiyonu, CSS `display` manipülasyonu | — |
| Tema | `data-theme` attribute (dark / light), `localStorage` ile kalıcılık | — |

**Frontend modül dosyaları:**

| Dosya | Sorumluluk |
|-------|------------|
| `app.js` | SPA router, tema switcher, global Socket.io başlatma |
| `login.js` | Form doğrulama, oturum yönetimi |
| `config.js` | IP/port bağlantı formu, dinamik tag tablosu (ekle/sil), simülasyon modu |
| `testbench.js` | Kart render motoru, SET işlemleri, coil toggle, master start/stop, konsol |

### 2.3 Tipografi Standartları

Saha okunabilirliği öncelikli alınmış ve iki ayrı font ailesi belirlenmiştir:

**UI Metinleri (etiketler, başlıklar, butonlar, form etiketleri):**

- Birincil: `Inter` (Google Fonts, w400/500/600/700/800)
- Yedek: `Roboto`, `Segoe UI`, `system-ui`
- CSS değişkeni: `--font-ui`

**Sayısal Değerler ve PLC Adresleri (canlı değer göstergeleri, adres etiketleri, konsol logları, input alanları):**

- Birincil: `JetBrains Mono` (Google Fonts, w400/500/600/700)
- Yedek: `Roboto Mono`, `Consolas`, `Courier New`
- CSS değişkeni: `--font-mono`

**Font ağırlığı hiyerarşisi:**

| CSS Değişkeni | Değer | Kullanım alanı |
|---------------|-------|----------------|
| `--fw-normal` | 400 | Konsol log gövdesi, placeholder |
| `--fw-medium` | 500 | Form input içeriği, adres etiketleri, tablo satırları |
| `--fw-semibold` | 600 | Konsol log SUCCESS/ERROR/WARNING vurguları |
| `--fw-bold` | 700 | Form etiketleri, kart başlıkları, tablo sütun adları |
| `--fw-extrabold` | 800 | Canlı sayısal değer (live-value), coil durumu (ON/OFF) |

`--fw-extrabold` (800) yalnızca iki kritik elemana uygulanmıştır: canlı register değeri ve coil durum metni. Bu sayede saha operatörünün bakışı otomatik olarak değişen veriye yönelir.

### 2.4 Backend

| Bileşen | Paket | Versiyon |
|---------|-------|---------|
| HTTP Sunucu | `express` | ^4.18.2 |
| WebSocket | `socket.io` | ^4.7.2 |
| Modbus TCP İstemci | `modbus-serial` | ^8.0.16 |
| CORS | `cors` | ^2.8.5 |
| Runtime | Node.js | ≥16.0.0 |

**Backend modül dosyaları:**

| Dosya | Sorumluluk |
|-------|------------|
| `server.js` | Express + Socket.io ana sunucu, REST API endpoint'leri, polling döngüsü |
| `modbusClient.js` | ModbusClient sınıfı — bağlantı, register okuma/yazma, coil okuma/yazma |
| `failSafe.js` | FailSafeManager sınıfı — auto-reconnect, fail-safe tetikleme, global hata yakalama |

### 2.5 Donanım ve Protokol

| Parametre | Değer |
|-----------|-------|
| PLC Serisi | Delta DVP / AS Serisi |
| Protokol | Modbus TCP (Master/Client modunda Node.js) |
| Varsayılan IP | 192.168.1.50 |
| Varsayılan Port | 502 |
| Slave Unit ID | 1 |
| Bağlantı türü | Ethernet Cat5e/Cat6, doğrudan veya switch üzerinden |
| PLC taraf modu | Modbus TCP Slave |

---

## 3. HABERLEŞME VE ADRES HARİTASI

### 3.1 Delta PLC Adres Eşleme Kuralı

Delta PLC'nin DVP serisi Modbus TCP adres haritası aşağıdaki kurala göre çalışır:

- `D0` → Holding Register 40001 → modbus-serial kütüphanesinde 0-bazlı adres `0`
- `D100` → Holding Register 40101 → 0-bazlı adres `100`
- `M0` → Coil 000001 → 0-bazlı adres `0`
- `M10` → Coil 000011 → 0-bazlı adres `10`

Bu projede adres dönüşümü doğrudan 1:1 uygulanmaktadır: kullanıcı `D100` girdiğinde backend `address = 100` olarak kullanır.

### 3.2 Function Code Tablosu

| İşlem | Modbus FC | Hedef | modbus-serial Metodu |
|-------|-----------|-------|----------------------|
| Register Okuma | FC3 (Read Holding Registers) | D register | `readHoldingRegisters(addr, 1)` |
| Register Yazma | FC16 (Write Multiple Registers) | D register | `writeRegister(addr, value)` |
| Coil Okuma | FC1 (Read Coils) | M relay | `readCoils(addr, 1)` |
| Coil Yazma | FC5 (Write Single Coil) | M relay | `writeCoil(addr, bool)` |

### 3.3 Varsayılan Değişken Eşleme Tablosu

| ID | Değişken Adı | Tip | PLC Adresi | Modbus Adresi (0-bazlı) | Birim | Açıklama |
|----|--------------|-----|------------|------------------------|-------|----------|
| 1 | Evaporatör Sıcaklığı | Register | D100 | 100 | °C | Evaporatör çıkış sıcaklığı |
| 2 | Kompresör Basıncı | Register | D102 | 102 | bar | Yüksek taraf basınç sensörü |
| 3 | Sıvı Vana Durumu | Coil | M10 | 10 | — | Solenoid vana açık/kapalı |
| 4 | Fan Hızı | Register | D104 | 104 | RPM | Kondenser fan motor hızı |

### 3.4 Polling Mimarisi

```
Backend (setInterval — 200ms)
  └── Her tag için sıralı okuma:
        ├── type === 'register' → readHoldingRegisters()
        └── type === 'coil'     → readCoils()
  └── Tüm tag'ler okundu → io.emit('plc:data', { tags, status, running })
  └── Frontend Socket.io listener → renderCards(tags)
```

**Önemli davranışlar:**

- Polling yalnızca `running === true` durumunda çalışır. Master STOP sonrasında polling durdurulur.
- Simülasyon modunda gerçek Modbus çağrısı yapılmaz; sunucu tarafında rastgele fakat gerçekçi sınırlarda değer üretilir.
- Bir tag okuması `NOT_CONNECTED` hatası döndürdüğünde polling döngüsü o iterasyonu keser ve auto-reconnect başlatır.

### 3.5 Simülasyon Değer Aralıkları

| Tag | Min | Max | Başlangıç | Adım (±) |
|-----|-----|-----|-----------|----------|
| D100 — Evaporatör Sıcaklığı | 15°C | 25°C | 18°C | ±0.2°C |
| D102 — Kompresör Basıncı | 10 bar | 15 bar | 12 bar | ±0.1 bar |
| D104 — Fan Hızı | 1400 RPM | 1500 RPM | 1450 RPM | ±5 RPM |
| M10 — Sıvı Vana | 0 | 1 | 0 | kullanıcı kontrolü |

---

## 4. EKRAN AKIŞLARI VE İŞLEVLERİ

### 4.1 SPA Geçiş Akışı

```
[Login View]
    │  form submit — kimlik doğrulama başarılı
    ▼
[Config View]
    │  "PLC Bağlan" veya "Simülasyon" butonu
    │  POST /api/connect
    ▼
[Test Bench View]
    │  Master START → POST /api/start → polling başlar
    │  Master STOP  → POST /api/stop  → polling durur + fail-safe
    │
    └── [Her zaman erişilebilir: Config ↔ Test Bench nav geçişi]
```

### 4.2 Login (Oturum Girişi)

- **Kimlik bilgileri:** Kullanıcı adı `admin`, Şifre `plc2024`
- **Doğrulama:** Yalnızca istemci tarafında (frontend) gerçekleşir.
- **Hata davranışı:** Yanlış giriş sonrası şifre alanı temizlenir, form elementine CSS shake animasyonu uygulanır.
- **Başarı davranışı:** `showView('config')` çağrısıyla Config View'a geçiş yapılır.

### 4.3 Config View — Bağlantı ve Tag Konfigürasyonu

**Bağlantı formu:**

| Alan | Varsayılan | Validation Kuralı |
|------|------------|-------------------|
| IP Adresi | 192.168.1.50 | IPv4 regex: `^(\d{1,3}\.){3}\d{1,3}$` |
| Port | 502 | 1 – 65535 arasında tam sayı |

**Bağlantı modları:**

- `PLC Bağlan`: Backend `modbusClient.connect(ip, port)` çağrısı yapar. Başarısız olursa `DISCONNECTED` durumuna döner.
- `Simülasyon`: Gerçek Modbus bağlantısı kurulmaz. Backend `simulationMode = true` olarak işaretler ve sahte veri üretir.

**Dinamik tag tablosu:**

- Tabloda varsayılan 4 tag önceden tanımlıdır.
- `Ekle` butonu: Ad, Tip (Register/Coil), Adres, Birim alanlarını okur. Çakışma (aynı tip + aynı adres) kontrolü yapılır. Backend'e `POST /api/tags` isteği gönderilir.
- `Sil` butonu: Event delegation ile yakalanır. `DELETE /api/tags/:id` çağrısı sonrası lokal listeden kaldırılır.

### 4.4 Test Bench View — Canlı Kontrol Paneli

**Register Kartı (D tipi tag):**

```
┌─────────────────────────────────┐
│ EVAPORATİF SICAKLIK    [D100]   │
├─────────────────────────────────┤
│  18  °C                         │
│  Modbus Holding Reg • FC3/FC16  │
│  [   değer gir   ] [ SET ]      │
└─────────────────────────────────┘
```

SET işlemi akışı:
1. Input alanı validation: boş değer, NaN kontrolü, `0 ≤ value ≤ 65535` aralığı.
2. `POST /api/write { address, value }` — backend `modbusClient.writeRegister()` çağrısı.
3. Başarı: Input temizlenir, karta CSS `flash` animasyonu uygulanır.
4. Hata: Konsola `[ERR_VALIDATION]` veya `[ERR_WRITE]` logu düşer.

**Coil Kartı (M tipi tag):**

```
┌─────────────────────────────────┐
│ SIVI VANA DURUMU       [M10]    │
├─────────────────────────────────┤
│  Modbus Coil • FC1/FC5          │
│  ● OFF      [ ON ] [ OFF ]      │
└─────────────────────────────────┘
```

ON/OFF işlemi akışı:
1. `POST /api/coil { address, value: true/false }`
2. Backend `modbusClient.writeCoil()` çağrısı.
3. Başarı: Socket.io `plc:data` eventi sonraki 200ms'de UI'ı günceller.
4. Konsola `[COIL WRITE] M10 → ON (1)` veya `[COIL WRITE] M10 → OFF (0)` logu düşer.

**Master START / STOP Toggle:**

| Durum | Buton rengi | Buton metni | Sistem durumu |
|-------|-------------|-------------|---------------|
| Sistem duruyorken | Yeşil (#10B981) | START | polling yok |
| START'a basıldı | Kırmızı (#EF4444) | STOP | `POST /api/start` → polling başlar |
| STOP'a basıldı | Yeşil (#10B981) | START | `POST /api/stop` → polling durur + fail-safe tetiklenir |

Buton işlem süresi boyunca (`disabled = true`) birden fazla tıklama engellenir.

**Canlı Log Konsolu:**

- Maksimum 200 satır saklanır; limitin üstündeki eski satırlar DOM'dan silinir.
- Satırlar otomatik scroll ile en alta gelir.
- Renk kodlaması:

| Log prefix | Renk | Font ağırlığı |
|------------|------|---------------|
| `[WRITE SUCCESS]` | #34D399 (yeşil) | 600 |
| `[COIL WRITE]` | #C4B5FD (mor) | 600 |
| `[ERR_*]` | #F87171 (kırmızı) | 600 |
| `[RECONNECT]` | #FCD34D (sarı) | 600 |
| `[MASTER]` | #FFD300 (accent) | 700 |
| `[FAIL-SAFE]` | #F87171 (kırmızı) | 700 |
| `[WS]` / `[SERVER]` | #93C5FD (mavi) | 500 |
| Diğer | #7a90a8 (gri) | 400 |

---

## 5. GÜVENLİK, HATA YÖNETİMİ VE ÇÖKME ÖNLEME (FAIL-SAFE)

### 5.1 Modbus TCP Timeout

- `modbusClient.js` içinde `this.client.setTimeout(1500)` ile 1500ms zaman aşımı tanımlanmıştır.
- Her `readHoldingRegisters`, `writeRegister`, `readCoils`, `writeCoil` çağrısı `try-catch` bloğu içinde sarmalıdır.
- Timeout hatası tespiti: `err.message.toLowerCase().includes('timeout')` koşuluyla yapılır.
- Timeout tespit edildiğinde:
  - `this.connected = false` olarak işaretlenir.
  - Konsola `[ERR_TIMEOUT] D{addr} okuma zaman aşımı (1500ms)` logu düşer.
  - Sunucu çalışmaya devam eder — exception fırlatılmaz, process kapanmaz.

### 5.2 Operasyon Kilidi (Operation Lock)

`modbusClient.js` içinde `this.operationLock` boolean alanı bulunur. Bir Modbus işlemi devam ederken ikinci bir çağrı gelirse `{ success: false, error: 'BUSY' }` döndürülür ve yeni işlem kuyruklanmaz. Bu; eş zamanlı polling ve kullanıcı komutlarından kaynaklanan Modbus çerçeve çakışmalarını (frame collision) önler.

### 5.3 Auto-Reconnect (Otomatik Yeniden Bağlanma)

`failSafe.js` içinde `FailSafeManager.startReconnect(ip, port)` metodu:

- `setInterval` ile her 3000ms'de bir `modbusClient.connect()` dener.
- Başarılı bağlantı sağlandığında `clearInterval` ile döngü durdurulur.
- Döngü boyunca frontend'e `plc:status → RECONNECTING` eventi gönderilir.
- Kullanıcı bağlantıyı manuel olarak kesmek isterse `cancelReconnect()` çağrısı ile döngü durdurulur.
- Aynı anda birden fazla reconnect döngüsü başlaması `isReconnecting` flag'iyle önlenir.

### 5.4 Input Clamping ve Validation

**Frontend (testbench.js):**

- Boş değer kontrolü.
- `parseInt()` ile sayısal dönüşüm; `NaN` kontrolü.
- `0 ≤ value ≤ 65535` aralık kontrolü (16-bit unsigned integer limiti).
- Hatalı girişte `POST /api/write` çağrısı yapılmaz; konsola `[ERR_VALIDATION]` logu düşer.

**Backend (modbusClient.js):**

```javascript
const intVal = parseInt(value, 10);
if (isNaN(intVal) || intVal < 0 || intVal > 65535) {
  this.log(`[ERR_VALIDATION] D${dNum} için geçersiz değer: ${value}`);
  return { success: false, error: 'VALIDATION_ERROR' };
}
```

Backend validation, frontend'den geçen hatalı değerleri ikinci bir katmanda yakalar. Doğrudan API çağrısı yapıldığında da sistem korunmuş olur.

### 5.5 Master STOP Fail-Safe Reset

`POST /api/stop` endpoint'i tetiklendiğinde sırayla şu işlemler gerçekleşir:

1. `plcState.running = false` — polling döngüsü bir sonraki iterasyonda durur.
2. `stopPolling()` — `clearInterval(pollTimer)`.
3. `failSafe.triggerFailSafe('MASTER_STOP')` çağrılır.
4. `triggerFailSafe()` içinde `CRITICAL_COILS = [10, 12]` listesindeki her adres için `writeCoil(addr, false)` çağrısı yapılır.
5. Konsola `[FAIL-SAFE] M{addr} → RESET (0)` loglanır.
6. Frontend'e `plc:status → STOPPED` eventi gönderilir.

PLC bağlı değilse (simülasyon modu veya bağlantı kopuk) fail-safe lokal olarak tamamlanır ve `STOPPED` durumuna geçilir; hata fırlatılmaz.

### 5.6 Global Process Error Handler

`failSafe.js` constructor'ında:

```javascript
process.on('uncaughtException', (err) => {
  this.log(`[FATAL] Yakalanmamış istisna: ${err.message}`);
  console.error('[FATAL] uncaughtException:', err);
  // process.exit() ÇAĞRILMAZ — sunucu çalışmaya devam eder
});

process.on('unhandledRejection', (reason) => {
  this.log(`[FATAL] İşlenmemiş Promise reddi: ${reason}`);
  console.error('[FATAL] unhandledRejection:', reason);
});
```

Bu iki handler, modbus-serial kütüphanesinin veya uygulama kodunun herhangi bir yerindeki işlenmeyen hata durumunda Node.js sürecinin kapanmasını engeller. Tüm exception'lar loglanarak sistemi izleme altında tutar.

---

## 6. DOSYA AĞACI VE ÇALIŞTIRMA ADIMLARI

### 6.1 Proje Dizin Yapısı

```
plc_webTestBench/
│
├── backend/
│   ├── server.js              # Ana sunucu — Express, Socket.io, REST API, polling
│   ├── modbusClient.js        # Modbus TCP istemci sınıfı (ModbusClient)
│   ├── failSafe.js            # Auto-reconnect ve fail-safe yönetici sınıfı (FailSafeManager)
│   ├── package.json           # npm bağımlılık tanımı
│   └── node_modules/          # npm tarafından yönetilen paketler (git'e dahil edilmez)
│
├── frontend/
│   ├── index.html             # SPA giriş noktası — 3 view container
│   ├── css/
│   │   └── style.css          # Tüm stiller — CSS custom properties, dual theme, bileşenler
│   └── js/
│       ├── app.js             # SPA router, tema switcher, global Socket.io başlatma
│       ├── login.js           # Login view mantığı
│       ├── config.js          # Config view — bağlantı yönetimi, tag CRUD
│       └── testbench.js       # Test Bench view — kartlar, SET, coil, konsol
│
├── SKILL.md                   # Proje tasarım standartları referans belgesi
├── README.md                  # Hızlı başlangıç kılavuzu
└── PROJECT_REPORT.md          # Bu belge
```

### 6.2 Bağımlılık Listesi

| Paket | Versiyon | Kullanım |
|-------|---------|---------|
| express | ^4.18.2 | HTTP sunucu, statik dosya servis, REST router |
| socket.io | ^4.7.2 | WebSocket sunucu, canlı veri ve log yayını |
| modbus-serial | ^8.0.16 | Modbus TCP istemci, FC1/3/5/16 desteği |
| cors | ^2.8.5 | Cross-Origin Resource Sharing başlık yönetimi |

CDN bağımlılıkları (internet bağlantısı gerektirir):

| Kaynak | Adres |
|--------|-------|
| Lucide Icons | https://unpkg.com/lucide@latest/dist/umd/lucide.min.js |
| Google Fonts | https://fonts.googleapis.com (Inter, Roboto, JetBrains Mono, Roboto Mono) |

### 6.3 Kurulum ve Çalıştırma

**1. Bağımlılık kurulumu:**

```bash
cd plc_webTestBench/backend
npm install
```

**2. Sunucu başlatma:**

```bash
node server.js
```

veya:

```bash
npm start
```

**3. Arayüze erişim:**

```
http://localhost:3000
```

**4. PLC bağlantısı için ön koşullar:**

- PLC ve bilgisayar aynı IP alt ağında olmalıdır (örn: 192.168.1.x / 255.255.255.0).
- Delta PLC'nin Modbus TCP Slave modu etkin olmalıdır.
- Firewall'da TCP 502 portu açık olmalıdır.
- Ethernet kablosu takılı ve bağlantı aktif olmalıdır.

**5. Simülasyon modu (PLC olmadan test):**

PLC bağlantısı olmaksızın arayüzü test etmek için Config ekranındaki "Simülasyon" butonuna basın. Sunucu, Modbus çağrısı yapmadan gerçekçi sınırlarda sahte veri üretir.

### 6.4 REST API Endpoint Referansı

| Method | Endpoint | İstek Gövdesi | Açıklama |
|--------|----------|---------------|----------|
| GET | `/api/state` | — | Mevcut PLC durumu, tag listesi, running flag |
| POST | `/api/connect` | `{ ip, port, tags, simulation }` | PLC bağlantısı kur veya simülasyon başlat |
| POST | `/api/disconnect` | — | Bağlantıyı kes, reconnect döngüsünü durdur |
| POST | `/api/start` | — | Master START — polling başlat |
| POST | `/api/stop` | — | Master STOP — polling durdur + fail-safe tetikle |
| POST | `/api/write` | `{ address, value }` | D register'a değer yaz (FC16) |
| POST | `/api/coil` | `{ address, value }` | M coil durumunu yaz (FC5) |
| POST | `/api/tags` | `{ name, type, address, unit }` | Yeni tag ekle |
| DELETE | `/api/tags/:id` | — | Tag sil |

### 6.5 Socket.io Event Referansı

**Sunucu → İstemci:**

| Event | Payload | Tetikleme koşulu |
|-------|---------|-----------------|
| `plc:data` | `{ tags[], status, running, simulationMode }` | Her polling iterasyonu (200ms) |
| `plc:status` | `{ status, running? }` | Durum değişikliği (bağlantı, stop, fail-safe) |
| `plc:log` | `{ message, timestamp }` | Her backend log satırı |

**Durum değerleri:**

| Değer | Anlam |
|-------|-------|
| `CONNECTED` | PLC bağlantısı aktif |
| `DISCONNECTED` | Bağlantı yok veya koptu |
| `RECONNECTING` | Auto-reconnect döngüsü çalışıyor |
| `SIMULATION` | Simülasyon modu aktif |
| `STOPPED` | Master STOP sonrası bekleme durumu |
| `FAIL_SAFE` | Fail-safe reset işlemi devam ediyor |

---

*Bu belge proje geliştirme süreci tamamlandıktan sonra oluşturulmuştur. Kod referansları `backend/` ve `frontend/` dizinlerindeki güncel dosyalarla birebir örtüşmektedir.*

## 7. FAZ 3 YEN�L�KLER�: RE�ETE, ALARM VE CSV

### 7.1 Dinamik Re�ete Motoru (Test Senaryolar�)
Kullan�c�lar�n sahada �al��acak ad�m ad�m senaryolar� tasarlamas� i�in geli�tirildi.
- **Mimari:** Backend'de \ecipes.js\ mod�l� eklendi. Re�eteler \ackend/recipes.json\ dosyas�nda kal�c� olarak saklan�r.
- **Y�r�tme:** Kullan�c� Test Bench ekran�ndan bir senaryoyu se�ip �al��t�rd���nda, Node.js backend ad�m ad�m tag de�erlerini PLC'ye yazar (SET i�lemi) ve belirtilen bekleme s�resi kadar asenkron bekler. Socket.io �zerinden \ecipe:status\ eventi ile frontend'e anl�k ad�m bilgisi iletilir.
- **API Endpoint'leri:** \/api/recipes\ (GET/POST/PUT/DELETE) ve \/api/recipes/:id/run\, \/api/recipes/stop\.

### 7.2 Ak�ll� Alarm Y�netimi
Tag konfig�rasyonu ekran�na \Alt Alarm (Low Limit)\ ve \�st Alarm (High Limit)\ alanlar� eklendi. Bu e�ikler \config.json\ dosyas�nda saklan�r.
- **Backend Loglama:** \modbusClient\ �zerinden okunan de�er limit d���na ��kt���nda konsola \[ALARM HIGH]\ veya \[ALARM LOW]\ loglar� d��er.
- **G�rsel Uyar�:** Test Bench ekran�ndaki kartlarda, limit a��m� durumunda CSS keyframes kullan�larak k�rm�z� renkte yan�p s�nme (flashing) efekti (\.card-alarm\) tetiklenir.

### 7.3 CSV Test Raporu �ndirme
Canl� izleme s�recinin belgelenmesi i�in Test Bench ekran�na CSV export butonu eklendi.
- **��lev:** T�kland���nda sistemdeki t�m g�ncel Tag de�erleri, alarm limitleri ve durumlar� i�eren veri k�mesini \data:text/csv\ format�nda kodlayarak an�nda taray�c�dan indirir. (Dosya ad� zaman damgal�d�r).

## 8. UI/UX SAHA OKUNABİLİRLİK OPTİMİZASYONU

### 8.1 Global Tipografi Artışı (%25)
Tüm UI metinleri, form etiketleri, butonlar, tablo içerikleri ve sayısal değerlerin font boyutları sahada kolay okunabilirliği sağlamak amacıyla yaklaşık %25 oranında artırıldı.
- **Baz font:** `html { font-size: 14px }` → `16px`
- **Canlı Değer (Value Display):** `30px` → `36px` (JetBrains Mono, Extra Bold 800)
- **Coil Durumu:** `22px` → `26px` (ON/OFF görsel netliği)
- **Tablo satır padding'leri:** `7px 8px` → `10px 12px`
- **Form inputları:** `padding: 8px 10px` → `10px 12px`, `font-size: 13px` → `15px`

### 8.2 Login Ekranı İyileştirmesi
- Login kutusunun maksimum genişliği `380px` → `480px` olarak artırıldı.
- Başlık, bildirim ve buton boyutları orantılı büyütüldü.
- Header/body/footer padding'leri artırılarak daha ferah bir giriş deneyimi sağlandı.

### 8.3 Adımlı Konfigürasyon Akışı (Stepped Flow)
- Delta PLC Değişken Eşleme Tablosu başlangıçta `display:none` ile gizleniyor.
- Kullanıcı "PLC Bağlan" veya "Simülasyon" butonuna tıklayıp bağlantı başarıyla sağlandığında tablo `fade-in` animasyonuyla görünür hale geliyor.
- Bağlantı kesildiğinde tablo tekrar gizleniyor.
- Bu mimari, operatörün IP/Port konfigürasyonuna odaklanmasını ve gereksiz alanlarla dikkatinin dağılmamasını sağlar.

### 8.4 Config Panelleri Genişletme
- `config-container` maksimum genişliği `1100px` → `1400px` olarak artırılarak geniş ekranlarda panellerin daha verimli kullanılması sağlandı.
- Bilgi panelindeki protokol tablosu font boyutu `12px` → `14px` olarak güncellendi.

## 9. FAZ 4: SABİT HEADER, DİNAMİK GRAFİK VE ASENKRON LOGLAMA (UI/UX & BACKEND REFACTOR)

### 9.1 Global Sabit (Fixed) Header Mimarisi
- Arayüzdeki (UI) sekmeler arası geçişte yaşanan görsel kaymayı (layout shift) önlemek amacıyla SPA (Single Page Application) mimarisi güçlendirildi.
- index.html içerisindeki her görünüme ait .topbar yapıları tek bir global <div id="app-topbar"> çatısı altına toplandı.
- CSS tarafında .topbar position: fixed yapılarak sayfanın üstüne sabitlendi, z-index yükseltildi. İçeriğin üstte kaybolmaması için görünümlere padding eklendi.
- Kontrollerin (Master Butonlar, Sim Badge vb.) gösterim mantığı aktif sekmeye göre JavaScript (pp.js) üzerinden dinamik hale getirildi.

### 9.2 Dinamik Canlı Trend Grafiği Motoru
- Test Bench ekranındaki canlı trend grafiği statik (D100 ve D102) olmaktan çıkarıldı.
- 	estbench.js içerisinde kullanıcıların izlemek istedikleri değişkenleri (Register) seçebilmeleri için dinamik bir **Checkbox Listesi** eklendi.
- Chart.js dataset'leri kullanıcının anlık seçimine göre çalışma zamanında eklenecek/çıkartılacak şekilde asenkron syncChartDatasets yapısıyla güncellendi. Kullanıcı istediği sayıda değişkeni aynı grafikte eşzamanlı çizebilir.

### 9.3 Asenkron Veri Loglama (RAM Buffer) Motoru
- Daha önce sadece client-side'da oluşturulan CSV verisi, daha kararlı ve kayıpsız olan sunucu taraflı RAM tabanlı bir logger mimarisine (ackend/logger.js) taşındı.
- Canlı okuma döngüsü (polling), her adımda veriyi RAM üzerinde biriktirir (uffer.push).
- Sistem belleğini (Memory Leak) şişirmemek ve diske yazma (I/O) darbogazını engellemek için veriler, **her 5 saniyede bir (5000ms) asenkron olarak (non-blocking)** logs/plc_log_YYYY-MM-DD.txt dosyasına Flush (Append) edilir.
- Kullanıcı Test Bench üzerindeki "CSV İndir" butonuna bastığında, tarayıcı sunucudaki güncel zaman serisi dosyasını (/api/download-log endpoint) indirir.
