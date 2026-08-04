/**
 * configStore.js — Faz 2: Kalıcı Konfigürasyon Yönetimi
 * IP, Port ve Tag listesini backend/config.json dosyasında saklar.
 * Sunucu yeniden başlatıldığında mevcut yapıyı geri yükler.
 */

const fs   = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, 'config.json');

// Varsayılan fabrika konfigürasyonu (config.json yoksa kullanılır)
const FACTORY_DEFAULT = {
  ip:        '192.168.1.50',
  port:      502,
  nextTagId: 5,
  tags: [
    { id: 1, name: 'Evaporatör Sıcaklığı', type: 'register', dataType: 'FLOAT32', address: 100, unit: '°C',  min: -50,      max: 150,  value: 0 },
    { id: 2, name: 'Kompresör Basıncı',    type: 'register', dataType: 'INT16',   address: 102, unit: 'bar', min: 0,        max: 50,   value: 0 },
    { id: 3, name: 'Sıvı Vana Durumu',     type: 'coil',     dataType: 'COIL',    address: 10,  unit: '',    min: undefined, max: undefined, value: 0 },
    { id: 4, name: 'Fan Hızı',             type: 'register', dataType: 'UINT16',  address: 104, unit: 'RPM', min: 0,        max: 3000, value: 0 },
  ]
};

/**
 * Kaydedilmiş konfigürasyonu dosyadan okur.
 * Dosya yoksa veya bozuksa fabrika varsayılanlarını döndürür.
 */
function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const raw  = fs.readFileSync(CONFIG_PATH, 'utf8');
      const data = JSON.parse(raw);

      // Temel alan kontrolü
      if (!Array.isArray(data.tags)) throw new Error('tags dizisi bekleniyor');

      // Tag değerleri her zman sıfırdan başlar (runtime verisi)
      data.tags = data.tags.map(t => ({ ...t, value: 0 }));

      console.log(`[CONFIG] config.json yüklendi — ${data.tags.length} tag, IP: ${data.ip}:${data.port}`);
      return data;
    }
  } catch (err) {
    console.warn(`[CONFIG] config.json okunamadı (${err.message}), fabrika varsayılanları kullanılıyor.`);
  }

  // İlk çalıştırmada dosyayı oluştur
  saveConfig(FACTORY_DEFAULT);
  return JSON.parse(JSON.stringify(FACTORY_DEFAULT));
}

/**
 * Mevcut konfigürasyonu config.json'a yazar.
 * Değerleri (runtime) kaydetmez — sadece yapı bilgisi saklanır.
 */
function saveConfig(cfg) {
  try {
    const toSave = {
      ip:        cfg.ip        || '192.168.1.50',
      port:      cfg.port      || 502,
      nextTagId: cfg.nextTagId || 1,
      // Runtime value'ları sıfırla, sadece yapıyı sakla
      tags: (cfg.tags || []).map(t => ({
        id:       t.id,
        name:     t.name,
        type:     t.type,
        dataType: t.dataType || 'UINT16',
        address:  t.address,
        unit:     t.unit  || '',
        min:      t.min,
        max:      t.max,
        value:    0        // runtime değeri kaydetme
      }))
    };
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(toSave, null, 2), 'utf8');
  } catch (err) {
    console.error(`[CONFIG] config.json yazılamadı: ${err.message}`);
  }
}

module.exports = { loadConfig, saveConfig, CONFIG_PATH };
