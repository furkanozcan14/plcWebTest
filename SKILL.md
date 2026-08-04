# Delta PLC Tabanlı İklimlendirme Web Test Bench Standartları

## 1. UI/UX & Tasarım Prensipleri
- **Yapay Zeka Ürünü Gibi Durmama Kuralı:** Tasarım pazarlama amaçlı süslü bir AI web sitesi gibi DEĞİL, sahada kullanılan profesyonel bir endüstriyel SCADA / HMI kontrol paneli görünümünde olmalıdır.
- **Kompaktlık & Yüksek Kontrast:** Aşırı boşluklar (padding/margin), büyük yumuşak köşeler (rounded-full) ve efektli gradient'lar YASAK. Ekran derli toplu, sıkı grid ve yüksek okunabilirlikte olmalıdır.
- **Renk Paleti:**
  - Canlı Sarı: `#FFD300` (Ana aksan, aktif sekmeler, SET butonları)
  - Derin Siyah: `#090C11` (Koyu tema arka planı, yüksek kontrastlı metinler)
  - Koyu Kömür Gri: `#262B32` (Koyu tema kart arka planları, border'lar)
  - Orta Gri: `#757B81` (Pasif elemanlar, birimler, ikincil etiketler)
  - Yeşil (`#10B981`) & Kırmızı (`#EF4444`): Master Toggle START / STOP Durumları
  - Beyaz: `#FFFFFF` (Açık tema kart arka planları, metinler)
- **Çift Tema (Dual Theme) Desteği:** Sağ üst köşedeki butonla Açık (Light) ve Koyu (Dark) temalar arasında dinamik geçiş yapılabilmelidir.
- **Tipografi ve Okunabilirlik Standartları:**
  - **Ana Font Ailesi:** `Inter`, `Roboto`, `Segoe UI`, `sans-serif` (Metinler, butonlar ve etiketler için).
  - **Sayısal Değer & PLC Adres Fontu:** `JetBrains Mono`, `Roboto Mono`, `Consolas`, `monospace` (Tüm sayısal veriler, input alanları ve PLC adresleri için).
  - **Saha Şartları İçin Harf Aralığı ve Ağırlık:** 
    - Başlıklar ve Değerler: `font-bold` (Bold / Semi-Bold).
    - Etiketler: Küçük harf yerine `UPPERCASE` (BÜYÜK HARF) ve hafif genişletilmiş harf aralığı (`tracking-wider`).
    - Karakter Çakışması Karşıtı: Karıştırılabilecek karakterlerin (`0` ile `O`, `1` ile `l`) net ayırt edildiği açık tipografi CSS kuralları uygulanmalıdır.

## 2. Mimari ve Modül Yapısı
Uygulama 3 ana görünümden (SPA - Single Page Application) oluşur:
1. **Oturum Girişi (Login):** Yetkili operatör doğrulama ekranı.
2. **Bağlantı & Konfigürasyon:** 
   - Modbus TCP Ethernet bağlantı parametreleri: IP adresi ve değiştirilebilir Port (Varsayılan `502`, ancak PLC özel bir port dinliyorsa dinamik port girmeye uygun).
   - Delta PLC Değişken (Tag) ve Adres Tanımlama Tablosu (Dinamik Ekle/Sil destekli).
3. **Canlı Test Bench & Kontrol Paneli:**
   - Anlık verilerin izlendiği ve yanındaki **SET** butonlarıyla değer enjekte edilebildiği (Holding Register / Data Write) kartlar.
   - **ON / OFF** butonlarıyla Bit (Coil) durumunun değiştirilmesi.
   - Tepe barda **Master Toggle START/STOP Butonu**:
     - Sistem dururken: Yeşil renkli **START** butonu görünür.
     - Tıklandığında: Simülasyon başlar, buton kırmızı renkli **STOP** butonuna dönüşür.
     - Tekrar tıklandığında: Simülasyon durur ve tekrar yeşil **START** durumuna döner.
   - Alt tarafta canlı akan **PLC Modbus TCP Log Konsolu** (Polling: 200ms).

## 3. Haberleşme & Backend Standartları
- **Protokol:** Delta PLC Modbus TCP (Master/Client modunda).
- **Adres Haritası:**
  - `D` Register'ları (D100, D102 vb.) -> Holding Register (FC3 / FC16)
  - `M` Relay'leri (M10, M12 vb.) -> Coil (FC1 / FC5)
- **Canlı Veri:** Backend servisi ile Frontend arasında WebSocket (`Socket.io`) bağlantısı kurulmalı, milisaniyelik veri akışı ve log kaydı sağlanmalıdır.

## 4. Güvenlik, Hata Yönetimi & Çökme Önleme (Fail-Safe)
- **Modbus Timeout:** PLC çağrılarında max 1500ms zaman aşımı uygulanmalı; yanıt gelmezse uygulama çökmeyip `[ERR_TIMEOUT]` logu basmalı ve durumu 'DISCONNECTED' yapmalıdır.
- **Auto-Reconnect (Otomatik Yeniden Bağlanma):** Ethernet kablosu çıkarıldığında veya hat koptuğunda backend çökmeden her 3 saniyede bir otomatik bağlanmayı denemelidir.
- **Input Clamping & Validation:** Sayısal veri girişlerinde aralık ve veri tipi kontrolü yapılmalı, hatalı veri girişlerinde backend işlemi reddetmelidir.
- **Fail-Safe Master STOP:** Master STOP butonuna basıldığında veya bağlantı koptuğunda kritik adresler (örneğin M10 ana bit) otomatik olarak güvenli sıfır durumına (`0` / Reset) çekilmelidir.
- **Global Error Handler:** Node.js/Backend katmanında yakalanmayan hiçbir asenkron hata sunucunun kapanmasına (crash) neden olmamalıdır (`try-catch` ve `process.on('uncaughtException')` önlemleri).

## 5. Faz 1: Gelişmiş Veri Tipleri ve Input Clamping (Emniyet Sınırları)
- **Desteklenen Veri Tipleri:**
  - `FLOAT32`: Ondalıklı ve hassas veriler için ardışık 2 adet D register'ı kullanır (IEEE 754 Big-Endians).
  - `INT16`: Negatif değerler (soğutma dereceleri vb.) için Signed 16-bit (-32768 .. +32767).
  - `UINT16`: Standart Unsigned 16-bit (0 .. 65535).
  - `COIL`: M bitleri (FC1/FC5).
- **Tag Bazlı Min/Max Sınır Kontrolü (Input Clamping):**
  - Konfigürasyon ekranında her tag için isteğe bağlı veya zorunlu Min ve Max değer sınırları tanımlanabilmelidir.
  - **Frontend Clamping:** Kullanıcı tanımlı Min/Max sınırları dışında bir değer girdiğinde frontend uyaracak ve değeri otomatik olarak izin verilen Min veya Max sınırına sabitleyecektir (clamp).
  - **Backend Fail-Safe Clamping:** Backend `modbusClient.js` gelen değeri PLC'ye yazmadan önce tekrar Min/Max kontrolünden geçirmeli; sınır dışı değerleri güvenli limite çekip konsola `[WARNING] Tag sınırı aşıldı, değere çekildi` uyarısı basmalıdır.