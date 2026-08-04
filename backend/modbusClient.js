/**
 * modbusClient.js — Faz 2: Read Bundling Optimizasyonu
 * Delta PLC Modbus TCP bağlantı ve okuma/yazma modülü.
 *
 * Faz 2 yenilikleri:
 *   readBundledRegisters(tags) — ardışık/yakın register adreslerini gruplayarak
 *   tek bir FC3 çağrısı ile toplu okur. Modbus paket trafiğini minimize eder.
 *
 * Veri tipleri (Faz 1'den):
 *   FLOAT32 — IEEE 754 Big-Endian, 2 ardışık Holding Register
 *   INT16   — Signed 16-bit (-32768..+32767)
 *   UINT16  — Unsigned 16-bit (0..65535)
 *   COIL    — M relay, FC1/FC5
 */

const ModbusRTU = require('modbus-serial');

const MODBUS_TIMEOUT_MS = 1500;
const UNIT_ID           = 1;

// ─── Maksimum adres boşluğu (bundle birleştirme eşiği) ───────────────────────
// İki tag arasındaki adres farkı bu değerden büyükse ayrı bundle oluşturulur.
const MAX_BUNDLE_GAP = 10;

// ─── IEEE 754 yardımcıları ───────────────────────────────────────────────────
function registersToFloat32(hi, lo) {
  const buf = Buffer.alloc(4);
  buf.writeUInt16BE(hi, 0);
  buf.writeUInt16BE(lo, 2);
  return buf.readFloatBE(0);
}

function float32ToRegisters(value) {
  const buf = Buffer.alloc(4);
  buf.writeFloatBE(value, 0);
  return [buf.readUInt16BE(0), buf.readUInt16BE(2)];
}

function rawToInt16(raw)  { return raw > 32767 ? raw - 65536 : raw; }
function int16ToRaw(val)  { return val < 0 ? val + 65536 : val; }

// ─── Clamping ─────────────────────────────────────────────────────────────────
function clampValue(value, min, max) {
  if (min !== undefined && value < min) return { clamped: true, value: min };
  if (max !== undefined && value > max) return { clamped: true, value: max };
  return { clamped: false, value };
}

// ─── Bundle oluşturma ─────────────────────────────────────────────────────────
/**
 * Register tag listesini ardışık adres gruplarına (bundle) ayırır.
 * Her bundle: { startAddr, count, tags[] }
 *
 * Örnek:
 *   D100 (FLOAT32, 2 reg) + D102 (INT16, 1 reg) + D104 (UINT16, 1 reg)
 *   → tek bundle: start=100, count=5
 *
 *   D100 (FLOAT32) + D200 (UINT16)  (boşluk > MAX_BUNDLE_GAP)
 *   → iki ayrı bundle
 */
function buildBundles(registerTags) {
  if (!registerTags.length) return [];

  // Adrese göre sırala
  const sorted = [...registerTags].sort((a, b) => a.address - b.address);
  const bundles = [];

  let current = null;

  for (const tag of sorted) {
    const regCount = tag.dataType === 'FLOAT32' ? 2 : 1;
    const tagEnd   = tag.address + regCount; // exclusive end

    if (!current) {
      current = { startAddr: tag.address, endAddr: tagEnd, tags: [tag] };
    } else {
      // Boşluk MAX_BUNDLE_GAP'ten küçük veya sıfırsa aynı bundle'a ekle
      if (tag.address <= current.endAddr + MAX_BUNDLE_GAP) {
        current.endAddr = Math.max(current.endAddr, tagEnd);
        current.tags.push(tag);
      } else {
        bundles.push(current);
        current = { startAddr: tag.address, endAddr: tagEnd, tags: [tag] };
      }
    }
  }
  if (current) bundles.push(current);

  // count hesapla
  return bundles.map(b => ({
    startAddr: b.startAddr,
    count:     b.endAddr - b.startAddr,
    tags:      b.tags
  }));
}

/**
 * Bundle'dan alınan raw register dizisini, her tag için doğru tipte parse eder.
 * @param {number[]} rawRegs — readHoldingRegisters'dan gelen data.data
 * @param {number}   startAddr — bundle başlangıç adresi
 * @param {object}   tag — { address, dataType }
 * @returns {number} parse edilmiş değer
 */
function parseTagFromBundle(rawRegs, startAddr, tag) {
  const offset = tag.address - startAddr;
  const dt     = (tag.dataType || 'UINT16').toUpperCase();

  if (dt === 'FLOAT32') {
    const hi = rawRegs[offset];
    const lo = rawRegs[offset + 1];
    if (hi === undefined || lo === undefined) return 0;
    const f = registersToFloat32(hi, lo);
    return isFinite(f) ? f : 0;
  }
  if (dt === 'INT16') {
    return rawToInt16(rawRegs[offset] ?? 0);
  }
  // UINT16
  return rawRegs[offset] ?? 0;
}

// ─── ModbusClient ─────────────────────────────────────────────────────────────
class ModbusClient {
  constructor(logFn) {
    this.client       = new ModbusRTU();
    this.connected    = false;
    this.ip           = null;
    this.port         = 502;
    this.log          = logFn || console.log;
    this.operationLock = false;
  }

  // ─── Bağlantı ──────────────────────────────────────────────────────────────
  async connect(ip, port = 502) {
    this.ip   = ip;
    this.port = port;

    try { if (this.client.isOpen) await this.client.close(); } catch (_) {}

    this.client = new ModbusRTU();
    this.client.setTimeout(MODBUS_TIMEOUT_MS);

    try {
      await this.client.connectTCP(ip, { port: parseInt(port, 10) });
      this.client.setID(UNIT_ID);
      this.connected = true;
      this.log(`[CONNECTED] Delta PLC @ ${ip}:${port} | Unit ID: ${UNIT_ID}`);
      return { success: true };
    } catch (err) {
      this.connected = false;
      this.log(`[ERR_CONNECT] ${ip}:${port} → ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  async disconnect() {
    try { if (this.client.isOpen) await this.client.close(); } catch (_) {}
    this.connected = false;
    this.log('[DISCONNECTED] Modbus TCP bağlantısı kapatıldı.');
  }

  // ─── Kilit yardımcıları ────────────────────────────────────────────────────
  _checkReady() {
    if (!this.connected || !this.client.isOpen) return 'NOT_CONNECTED';
    if (this.operationLock) return 'BUSY';
    return null;
  }

  _handleError(label, err) {
    this.operationLock = false;
    if (err.message && err.message.toLowerCase().includes('timeout')) {
      this.log(`[ERR_TIMEOUT] ${label} zaman aşımı (${MODBUS_TIMEOUT_MS}ms)`);
      this.connected = false;
    } else {
      this.log(`[ERR] ${label} → ${err.message}`);
    }
    return { success: false, error: err.message };
  }

  // ─── Faz 2: Read Bundling — Toplu Register Okuma ─────────────────────────
  /**
   * Holding Register tag'lerini adres gruplarına göre toplar ve her grup için
   * tek bir FC3 çağrısı yapar. Coil'ler (FC1) ayrı ayrı okunur.
   *
   * @param {object[]} tags — plcState.tags dizisi
   * @returns {object[]} — her tag için { id, success, value } içeren dizi
   */
  async readAllTags(tags) {
    const notReady = this._checkReady();
    if (notReady) {
      return tags.map(t => ({ id: t.id, success: false, error: notReady }));
    }

    const results   = [];
    const regTags   = tags.filter(t => t.type === 'register');
    const coilTags  = tags.filter(t => t.type === 'coil');

    // ── Register Bundle Okuma ───────────────────────────────────────────────
    const bundles = buildBundles(regTags);

    for (const bundle of bundles) {
      const notReady2 = this._checkReady();
      if (notReady2) {
        bundle.tags.forEach(t => results.push({ id: t.id, success: false, error: notReady2 }));
        continue;
      }

      this.operationLock = true;
      try {
        const data = await this.client.readHoldingRegisters(bundle.startAddr, bundle.count);
        this.operationLock = false;
        const rawRegs = data.data;

        for (const tag of bundle.tags) {
          const value = parseTagFromBundle(rawRegs, bundle.startAddr, tag);
          results.push({ id: tag.id, success: true, value });
        }
        // Bundle okuma logu (sadece debug'da görmek istersen açabilirsin)
        // this.log(`[BUNDLE] D${bundle.startAddr}–D${bundle.startAddr+bundle.count-1} (${bundle.count} reg, ${bundle.tags.length} tag)`);
      } catch (err) {
        this.operationLock = false;
        const errRes = this._handleError(`Bundle D${bundle.startAddr}+${bundle.count}`, err);
        bundle.tags.forEach(t => results.push({ id: t.id, ...errRes }));
      }
    }

    // ── Coil Okuma (FC1 — ayrı ayrı, her biri küçük paket) ─────────────────
    for (const tag of coilTags) {
      const notReady3 = this._checkReady();
      if (notReady3) { results.push({ id: tag.id, success: false, error: notReady3 }); continue; }

      this.operationLock = true;
      try {
        const data = await this.client.readCoils(tag.address, 1);
        this.operationLock = false;
        results.push({ id: tag.id, success: true, value: data.data[0] ? 1 : 0 });
      } catch (err) {
        results.push({ id: tag.id, ...this._handleError(`M${tag.address} coil read`, err) });
      }
    }

    return results;
  }

  // ─── Tekli okuma (geriye dönük uyumluluk & writeTagValue içi) ────────────
  async readTagValue(tag) {
    const notReady = this._checkReady();
    if (notReady) return { success: false, error: notReady };

    const addr = parseInt(tag.address, 10);
    const dt   = (tag.dataType || 'UINT16').toUpperCase();

    this.operationLock = true;
    try {
      if (tag.type === 'coil') {
        const data = await this.client.readCoils(addr, 1);
        this.operationLock = false;
        return { success: true, value: data.data[0] ? 1 : 0 };
      }
      if (dt === 'FLOAT32') {
        const data = await this.client.readHoldingRegisters(addr, 2);
        this.operationLock = false;
        const f = registersToFloat32(data.data[0], data.data[1]);
        return { success: true, value: isFinite(f) ? f : 0 };
      }
      if (dt === 'INT16') {
        const data = await this.client.readHoldingRegisters(addr, 1);
        this.operationLock = false;
        return { success: true, value: rawToInt16(data.data[0]) };
      }
      const data = await this.client.readHoldingRegisters(addr, 1);
      this.operationLock = false;
      return { success: true, value: data.data[0] };
    } catch (err) {
      return this._handleError(`D${addr}`, err);
    }
  }

  // ─── Yazma (dataType + backend clamping) ──────────────────────────────────
  async writeTagValue(tag, value) {
    const notReady = this._checkReady();
    if (notReady) return { success: false, error: notReady };

    const addr = parseInt(tag.address, 10);
    const dt   = (tag.dataType || 'UINT16').toUpperCase();

    if (tag.type === 'coil') {
      const boolVal = value === true || value === 1 || value === '1' || value === 'true';
      this.operationLock = true;
      try {
        await this.client.writeCoil(addr, boolVal);
        this.operationLock = false;
        this.log(`[COIL WRITE] M${addr} → ${boolVal ? 'ON (1)' : 'OFF (0)'}`);
        return { success: true, value: boolVal ? 1 : 0 };
      } catch (err) {
        return this._handleError(`M${addr} coil write`, err);
      }
    }

    let numVal = parseFloat(value);
    if (isNaN(numVal)) {
      this.log(`[ERR_VALIDATION] "${tag.name}" geçersiz değer: ${value}`);
      return { success: false, error: 'VALIDATION_ERROR' };
    }

    if (dt === 'INT16') {
      if (numVal < -32768 || numVal > 32767) {
        this.log(`[ERR_VALIDATION] "${tag.name}" INT16 aralık dışı: ${numVal}`);
        return { success: false, error: 'RANGE_ERROR' };
      }
      numVal = Math.round(numVal);
    } else if (dt === 'UINT16') {
      if (numVal < 0 || numVal > 65535) {
        this.log(`[ERR_VALIDATION] "${tag.name}" UINT16 aralık dışı: ${numVal}`);
        return { success: false, error: 'RANGE_ERROR' };
      }
      numVal = Math.round(numVal);
    }

    // Backend Fail-Safe Clamping
    const clamp = clampValue(numVal, tag.min, tag.max);
    if (clamp.clamped) {
      this.log(
        `[WARNING] "${tag.name}" sınırı aşıldı: ${numVal} → ${clamp.value}'e çekildi ` +
        `(Min: ${tag.min ?? '—'}, Max: ${tag.max ?? '—'})`
      );
      numVal = clamp.value;
    }

    this.operationLock = true;
    try {
      if (dt === 'FLOAT32') {
        const [hw, lw] = float32ToRegisters(numVal);
        await this.client.writeRegisters(addr, [hw, lw]);
        this.operationLock = false;
        this.log(`[WRITE SUCCESS] D${addr} (FLOAT32) = ${numVal.toFixed(4)}`);
        return { success: true, value: numVal };
      }
      if (dt === 'INT16') {
        await this.client.writeRegister(addr, int16ToRaw(numVal));
        this.operationLock = false;
        this.log(`[WRITE SUCCESS] D${addr} (INT16) = ${numVal}`);
        return { success: true, value: numVal };
      }
      await this.client.writeRegister(addr, numVal);
      this.operationLock = false;
      this.log(`[WRITE SUCCESS] D${addr} (UINT16) = ${numVal}`);
      return { success: true, value: numVal };
    } catch (err) {
      return this._handleError(`D${addr} write`, err);
    }
  }

  isConnected() { return this.connected && this.client.isOpen; }
}

module.exports = { ModbusClient, buildBundles };
