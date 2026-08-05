# Delta PLC Tabanli Iklimlendirme Web Test Bench Standartlari

## 1. UI/UX & Tasarim Prensipleri
- **Yapay Zeka Urunu Gibi Durmama Kurali:** Tasarim pazarlama amacli suslu bir AI web sitesi gibi DEGIL, sahada kullanilan profesyonel bir endustriyel SCADA / HMI kontrol paneli gorunumunde olmalidir.
- **Kompaktlik & Yuksek Kontrast:** Asiri bosluklar (padding/margin), buyuk yumusak koseler (rounded-full) ve efektli gradient'lar YASAK. Ekran derli toplu, siki grid ve yuksek okunabilirlikte olmalidir.
- **Header & Navigasyon Sabitligi:** Ust Header paneli (Logo, Konfigurasyon ve Test Bench butonlari) `position: fixed` olarak sabitlenmeli, sayfalar veya sekmeler arasi gecislerde butonlarin yeri KESINLIKLE KAYMAMALIDIR.
- **Renk Paleti:**
  - Canli Sari: `#FFD300` (Ana aksan, aktif sekmeler, SET butonlari)
  - Derin Siyah: `#090C11` (Koyu tema arka plani, yuksek kontrastli metinler)
  - Koyu Komur Gri: `#262B32` (Koyu tema kart arka planlari, border'lar)
  - Orta Gri: `#757B81` (Pasif elemanlar, birimler, ikincil etiketler)
  - Yesil (`#10B981`) & Kirmizi (`#EF4444`): Master Toggle START / STOP Durumlari
  - Beyaz: `#FFFFFF` (Acik tema kart arka planlari, metinler)
- **Cift Tema (Dual Theme) Destegi:** Sag ust kosedeki butonla Acik (Light) ve Koyu (Dark) temalar arasinda dinamik gecis yapilabilmelidir.
- **Tipografi ve Okunabilirlik Standartlari:**
  - **Ana Font Ailesi:** `Inter`, `Roboto`, `Segoe UI`, `sans-serif` (Metinler, butonlar ve etiketler icin font boyutlari %20-30 oraninda buyutulerek saha okunabilirligi saglanmalidir).
  - **Sayisal Deger & PLC Adres Fontu:** `JetBrains Mono`, `Roboto Mono`, `Consolas`, `monospace` (Tum sayisal veriler, input alanlari ve PLC adresleri icin).
  - **Saha Sartlari Icin Harf Araligi ve Agirlik:**
    - Basliklar ve Degerler: `font-bold` (Bold / Semi-Bold).
    - Etiketler: Kucuk harf yerine `UPPERCASE` (BUYUK HARF) ve hafif genisletilmis harf araligi (`tracking-wider`).
    - Karakter Caksimasi Karsiti: Karistirilabilecek karakterlerin (`0` ile `O`, `1` ile `l`) net ayirt edildigi acik tipografi CSS kurallari uygulanmalidir.

## 2. Mimari ve Modul Yapisi
Uygulama 3 ana gorunumden (SPA - Single Page Application) olusur:
1. **Oturum Girisi (Login):** Yetkili operator dogrulama ekrani. Kart yapisi genis, net okunabilir ve dikey dolgulari rahat tiklanabilir olmalidir.
2. **Baglanti & Konfigurasyon (Asamali Akis - Step-by-Step Flow):**
   - Ust Yarim: Modbus TCP Ethernet baglanti parametreleri (IP Adresi, Port) ve Adres Haritasi rehberi yer almalidir.
   - Dynamic Flow: "PLC Baglan" veya "Simulasyon" butonuna basilip baglanti dogrulanana kadar Delta PLC Degisken Esleme Tablosu gizli veya pasif kalmali; baglanti saglandiktan sonra yumusak bir animasyonla belirmelidir.
   - Form Duzeni: Yeni Degisken Ekleme Formu tek bir dar satir yerine; Temel Bilgiler, Emniyet Sinirlari (Min/Max) ve Alarm Esikleri (Alt/Ust Alarm) seklinde coklu satir (Multi-row Grid) yapisinda ferah gruplandirilmalidir.
3. **Canli Test Bench & Kontrol Paneli:**
   - Anlik verilerin izlendigi ve yanindaki **SET** butonlariyla deger enjekte edilebildigi (Holding Register / Data Write) kartlar.
   - **ON / OFF** butonlariyla Bit (Coil) durumunun degistirilmesi.
   - Tepe barda **Master Toggle START/STOP Butonu**:
     - Sistem dururken: Yesil renkli **START** butonu gorunur.
     - Tiklandiginda: Simulasyon baslar, buton kirmizi renkli **STOP** butonuna donusur.
     - Tekrar tiklandiginda: Simulasyon durur ve tekrar yesil **START** durumuna doner.
   - Alt tarafta canli akan **PLC Modbus TCP Log Konsolu** (Polling: 200ms).

## 3. Haberlesme & Backend Standartlari
- **Protokol:** Delta PLC Modbus TCP (Master/Client modunda).
- **Adres Haritasi:**
  - `D` Register'lari (D100, D102 vb.) -> Holding Register (FC3 / FC16)
  - `M` Relay'leri (M10, M12 vb.) -> Coil (FC1 / FC5)
- **Canli Veri:** Backend servisi ile Frontend arasinda WebSocket (`Socket.io`) baglantisi kurulmali, milisaniyelik veri akisi ve log kaydi saglanmalidir.

## 4. Guvenlik, Hata Yonetimi & Cokme Onleme (Fail-Safe)
- **Modbus Timeout:** PLC cagrilarinda max 1500ms zaman asimi uygulanmali; yanit gelmezse uygulama cokmeyip `[ERR_TIMEOUT]` logu basmali ve durumu 'DISCONNECTED' yapmalidir.
- **Auto-Reconnect (Otomatik Yeniden Baglanma):** Ethernet kablosu cikarildiginda veya hat koptugunda backend cokmeden her 3 saniyede bir otomatik baglanmayi denemelidir.
- **Input Clamping & Validation:** Sayisal veri girislerinde aralik ve veri tipi kontrolu yapilmali, hatali veri girislerinde backend islemi reddetmelidir.
- **Fail-Safe Master STOP:** Master STOP butonuna basildiginda veya baglanti koptugunda kritik adresler (ornegin M10 ana bit) otomatik olarak guvenli sifir durumuna (`0` / Reset) cekilmelidir.
- **Global Error Handler:** Node.js/Backend katmaninda yakalanmayan hicbir asenkron hata sunucunun kapanmasina (crash) neden olmamalidir (`try-catch` ve `process.on('uncaughtException')` onlemleri).

## 5. Faz 1: Gelismis Veri Tipleri ve Input Clamping (Emniyet Sinirlari)
- **Desteklenen Veri Tipleri:**
  - `FLOAT32`: Ondalikli ve hassas veriler icin ardisik 2 adet D register'i kullanir (IEEE 754 Big-Endians).
  - `INT16`: Negatif degerler (sogutma dereceleri vb.) icin Signed 16-bit (-32768 .. +32767).
  - `UINT16`: Standart Unsigned 16-bit (0 .. 65535).
  - `COIL`: M bitleri (FC1/FC5).
- **Tag Bazli Min/Max Sinir Kontrolu (Input Clamping):**
  - Konfigurasyon ekraninda her tag icin istege bagli veya zorunlu Min ve Max deger sinirlari tanimlanabilmelidir.
  - **Frontend Clamping:** Kullanici tanimli Min/Max sinirlari disinda bir deger girdiginde frontend uyaracak ve degeri otomatik olarak izin verilen Min veya Max sinirina sabitleyecektir (clamp).
  - **Backend Fail-Safe Clamping:** Backend `modbusClient.js` gelen degeri PLC'ye yazmadan once tekrar Min/Max kontrolunden gecirmeli; sinir disi degerleri guvenli limite cekip konsola `[WARNING] Tag siniri asildi, degere cekildi` uyarisi basmalidir.

## 6. Faz 2: Performans, Veri Kaliciligi ve Dinamik Canlı Trend Grafikleri
- **Read Bundling (Toplu Okuma):** `modbusClient.js` icinde ardisik veya yakin PLC adresleri tek bir `readHoldingRegisters` cagrisi ile toplu okunmali, Modbus paket trafigi optimize edilmelidir.
- **Kalicı Konfigurasyon (Persistence):** IP/Port ve Tag tanimlamalari sunucu tarafinda bir JSON dosyasinda (`config.json`) saklanmali; sunucu yeniden baslatildiginda mevcut yapi korunmalidir.
- **Dinamik Secilebilir Canli Trend Grafiği (Chart.js):**
  - Test Bench ekraninda kullanicinin istedigi degiskenleri secebilecegi dinamik bir alan (Checkboxes / Multi-select) yer almalidir.
  - Kullanici tek bir degiskeni veya sectigi birden fazla degiskeni ayni anda canli cizgi grafikte (Live Line Chart) zamansal degisimleriyle izleyebilmelidir.

## 7. Otomatik Dokumantasyon ve Rapor Guncelleme Kuralı
- **Proje Raporu Senkronizasyonu:** Uygulamada yapilan her yeni gelistirme, mimari degisiklik, eklenen yeni fonksiyonellik veya refactor isleminden sonra `PROJECT_REPORT.md` dosyasi OTOMATIK olarak guncellenmelidir.
- Guncellenecek Alanlar:
  - Eklenen yeni teknoloji veya kutuphaneler (Teknoloji Yigini bolumu).
  - Yapilan performans optimizasyonlari ve guvenlik onlemleri.
  - Degisen veya eklenen REST API ve Socket.io event'leri.
  - Surum versiyonu ve son guncelleme tarihi.

## 8. Faz 3: Dinamik Recete Motoru, Akillı Alarm Yonetimi ve Zaman Serisi Loglama
- **Dinamik Recete Motoru (Dynamic Test Scripting):**
  - Baslangicta hazir/gombulu senaryo bulunmamalidir (Liste bos baslar).
  - Kullanici arayuz uzerinden adim adim (Adres, Deger, Bekleme Suresi ms) yeni test senaryolari olusturabilmeli, bunlari isimlendirip `backend/recipes.json` dosyasina kalici olarak kaydedebilmelidir.
  - Kayitli senaryolar icin Ekle (Create), Duzenle (Update), Sil (Delete) ve Calistir/Iptal Et (Play/Abort) islevleri sunulmalidir.
- **Dinamik Alarm ve Esik Yonetimi (Alarm Management):**
  - Esik degerleri kodda sabit olmamali; Tag konfigurasyon ekraninda her tag icin `Alt Alarm (Low Limit)` ve `Ust Alarm (High Limit)` alanlari tanimlanabilmelidir.
  - Canli veri bu limitlerin disina ciktiginda UI kartinda visual flashing (gorsel yanip sonme), sesli uyari imkani ve konsolda `[ALARM HIGH]` / `[ALARM LOW]` loglama yapilmalidir.
- **Optimize Zaman Serisi Loglama ve TXT/CSV Indirme:**
  - Canli okunan Modbus verileri sistemi yavaslatmamak adina arka planda RAM bellekte (In-memory Buffer) zaman damgali (timestamp) olarak biriktirilmelidir.
  - Biriken veriler asenkron (async) akis ile `logs/plc_log_YYYY-MM-DD.txt` veya `.csv` dosyasina yazilmalidir.
  - Test Bench ekranina "Canli Kayit Raporu Indir (.TXT / .CSV)" butonu eklenmeli, tiklandiginda baglanti boyunca biriken zaman serisi canlı verileri metin dosyasi olarak bilgisayara indirilmelidir.