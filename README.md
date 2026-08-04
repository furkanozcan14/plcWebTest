# Delta PLC Tabanlı İklimlendirme Web Test Bench

Profesyonel SCADA/HMI kontrol paneli. Delta PLC ile Modbus TCP üzerinden haberleşir.

## Hızlı Başlangıç

```bash
cd backend
npm install
node server.js
```

Tarayıcıda **http://localhost:3000** adresini açın.

## Giriş Bilgileri

| Alan | Değer |
|------|-------|
| Kullanıcı | `admin` |
| Şifre | `plc2024` |

## Kullanım Akışı

1. **Login** → `admin / plc2024` ile giriş
2. **Konfigürasyon** → IP/Port girin, PLC Bağlan veya Simülasyon seçin
3. **Test Bench** → Canlı veri izleyin, SET/ON/OFF ile komut gönderin

## Özellikler

- ✅ Modbus TCP (Delta DVP serisi PLC)
- ✅ Simülasyon modu (PLC olmadan test)
- ✅ 200ms canlı polling
- ✅ Master START/STOP toggle (Fail-Safe)
- ✅ Auto-reconnect (3 saniye)
- ✅ Çift tema (Dark/Light)
- ✅ Canlı log konsolu

## Dosya Yapısı

```
backend/
  server.js        — Express + Socket.io sunucu
  modbusClient.js  — Modbus TCP client
  failSafe.js      — Auto-reconnect & Fail-Safe

frontend/
  index.html       — SPA
  css/style.css    — SCADA/HMI stiller
  js/app.js        — Router & Tema
  js/login.js      — Login mantığı
  js/config.js     — Konfigürasyon
  js/testbench.js  — Canlı Test Bench
```
