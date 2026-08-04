/**
 * modbusClient.js — Faz 1 Refactor
 * Delta PLC Modbus TCP bağlantı ve okuma/yazma modülü.
 *
 * Desteklenen veri tipleri (SKILL.md §5):
 *   FLOAT32 — IEEE 754 Big-Endian, 2 ardışık Holding Register (FC3/FC16)
 *   INT16   — Signed 16-bit (-32768..+32767), 1 Holding Register
 *   UINT16  — Unsigned 16-bit (0..65535), 1 Holding Register
 *   COIL    — M relay, FC1 okuma / FC5 yazma
 */

const ModbusRTU = require('modbus-serial');

const MODBUS_TIMEOUT_MS = 1500;
const UNIT_ID = 1; // Delta PLC default slave ID

// ─── IEEE 754 FLOAT32 yardımcı fonksiyonlar ──────────────────────────────────

/**
 * İki adet 16-bit Modbus register (Big-Endian Word order) → JavaScript float
 * Delta PLC FLOAT32: Word[0] = High Word, Word[1] = Low Word
 */
function registersToFloat32(highWord, lowWord) {
  const buf = Buffer.alloc(4);
  buf.writeUInt16BE(highWord, 0);
  buf.writeUInt16BE(lowWord, 2);
  return buf.readFloatBE(0);
}

/**
 * JavaScript float → İki adet 16-bit register [highWord, lowWord]
 */
function float32ToRegisters(value) {
  const buf = Buffer.alloc(4);
  buf.writeFloatBE(value, 0);
  return [buf.readUInt16BE(0), buf.readUInt16BE(2)];
}

/**
 * Unsigned 16-bit raw değeri → Signed INT16
 * (Modbus, negatif sayıları two's complement olarak iletir)
 */
function rawToInt16(raw) {
  return raw > 32767 ? raw - 65536 : raw;
}

/**
 * Signed INT16 → Unsigned 16-bit Modbus raw değeri
 */
function int16ToRaw(val) {
  return val < 0 ? val + 65536 : val;
}

// ─── Clamping yardımcısı ──────────────────────────────────────────────────────
function clampValue(value, min, max) {
  if (min !== undefined && value < min) return { clamped: true, value: min };
  if (max !== undefined && value > max) return { clamped: true, value: max };
  return { clamped: false, value };
}

// ─── ModbusClient sınıfı ─────────────────────────────────────────────────────
class ModbusClient {
  constructor(logFn) {
    this.client = new ModbusRTU();
    this.connected = false;
    this.ip = null;
    this.port = 502;
    this.log = logFn || console.log;
    this.operationLock = false;
  }

  // ─── Bağlantı ──────────────────────────────────────────────────────────────
  async connect(ip, port = 502) {
    this.ip = ip;
    this.port = port;

    try {
      if (this.client.isOpen) await this.client.close();
    } catch (_) { /* ignore */ }

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
    try {
      if (this.client.isOpen) await this.client.close();
    } catch (_) { /* ignore */ }
    this.connected = false;
    this.log('[DISCONNECTED] Modbus TCP bağlantısı kapatıldı.');
  }

  // ─── Kilit yardımcısı ──────────────────────────────────────────────────────
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

  // ─── Birleşik okuma (tag nesnesine göre) ─────────────────────────────────
  /**
   * Tag nesnesine bakarak doğru Modbus okuma metodunu seçer.
   * tag: { type, dataType, address }
   */
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
        // 2 ardışık register oku
        const data = await this.client.readHoldingRegisters(addr, 2);
        this.operationLock = false;
        const floatVal = registersToFloat32(data.data[0], data.data[1]);
        return { success: true, value: isFinite(floatVal) ? floatVal : 0 };
      }

      if (dt === 'INT16') {
        const data = await this.client.readHoldingRegisters(addr, 1);
        this.operationLock = false;
        return { success: true, value: rawToInt16(data.data[0]) };
      }

      // UINT16 (default)
      const data = await this.client.readHoldingRegisters(addr, 1);
      this.operationLock = false;
      return { success: true, value: data.data[0] };

    } catch (err) {
      return this._handleError(`${tag.type === 'coil' ? 'M' : 'D'}${addr}`, err);
    }
  }

  // ─── Birleşik yazma (tag nesnesine göre, clamping dahil) ─────────────────
  /**
   * Tag nesnesine ve min/max sınırlarına göre doğru Modbus yazma metodunu seçer.
   * Backend fail-safe clamping bu metotta gerçekleşir.
   * tag: { type, dataType, address, min, max, name }
   */
  async writeTagValue(tag, value) {
    const notReady = this._checkReady();
    if (notReady) return { success: false, error: notReady };

    const addr = parseInt(tag.address, 10);
    const dt   = (tag.dataType || 'UINT16').toUpperCase();

    // ── Coil yazma ──────────────────────────────────────────────────────────
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

    // ── Numerik değer parse ─────────────────────────────────────────────────
    let numVal = parseFloat(value);
    if (isNaN(numVal)) {
      this.log(`[ERR_VALIDATION] "${tag.name}" için geçersiz değer: ${value}`);
      return { success: false, error: 'VALIDATION_ERROR' };
    }

    // ── Tip bazlı ham sınır kontrolü ────────────────────────────────────────
    if (dt === 'INT16') {
      if (numVal < -32768 || numVal > 32767) {
        this.log(`[ERR_VALIDATION] "${tag.name}" INT16 aralık dışı: ${numVal} (−32768..+32767)`);
        return { success: false, error: 'RANGE_ERROR' };
      }
      numVal = Math.round(numVal);
    } else if (dt === 'UINT16') {
      if (numVal < 0 || numVal > 65535) {
        this.log(`[ERR_VALIDATION] "${tag.name}" UINT16 aralık dışı: ${numVal} (0..65535)`);
        return { success: false, error: 'RANGE_ERROR' };
      }
      numVal = Math.round(numVal);
    }
    // FLOAT32 için ham tip sınırı uygulanmaz; sadece tag min/max clamping devreye girer.

    // ── Backend Fail-Safe Clamping (SKILL.md §5) ────────────────────────────
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
        // FC16 ile 2 register yaz
        await this.client.writeRegisters(addr, [hw, lw]);
        this.operationLock = false;
        this.log(`[WRITE SUCCESS] D${addr} (FLOAT32) = ${numVal.toFixed(4)}`);
        return { success: true, value: numVal };
      }

      if (dt === 'INT16') {
        const raw = int16ToRaw(numVal);
        await this.client.writeRegister(addr, raw);
        this.operationLock = false;
        this.log(`[WRITE SUCCESS] D${addr} (INT16) = ${numVal}`);
        return { success: true, value: numVal };
      }

      // UINT16
      await this.client.writeRegister(addr, numVal);
      this.operationLock = false;
      this.log(`[WRITE SUCCESS] D${addr} (UINT16) = ${numVal}`);
      return { success: true, value: numVal };

    } catch (err) {
      return this._handleError(`D${addr} write`, err);
    }
  }

  // ─── Geriye dönük uyumluluk wrapper'ları ─────────────────────────────────
  // server.js'deki eski çağrılar (readRegister, writeRegister, readCoil, writeCoil)
  // kaldırılmıştır; bunların yerine readTagValue / writeTagValue kullanılır.

  isConnected() {
    return this.connected && this.client.isOpen;
  }
}

module.exports = ModbusClient;
