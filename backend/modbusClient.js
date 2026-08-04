/**
 * modbusClient.js
 * Delta PLC Modbus TCP bağlantı ve okuma/yazma modülü.
 * FC3: Read Holding Registers (D registers)
 * FC16: Write Multiple Registers (D registers)
 * FC1: Read Coils (M relays)
 * FC5: Write Single Coil (M relays)
 */

const ModbusRTU = require('modbus-serial');

const MODBUS_TIMEOUT_MS = 1500;
const UNIT_ID = 1; // Delta PLC default slave ID

class ModbusClient {
  constructor(logFn) {
    this.client = new ModbusRTU();
    this.connected = false;
    this.ip = null;
    this.port = 502;
    this.log = logFn || console.log;
    this.operationLock = false; // Prevent concurrent operations
  }

  /**
   * Delta PLC D register address → Modbus holding register address
   * Delta PLC: D100 = holding register 4096 + 100 = 4196 (0-based: 4195)
   * Actually Delta DVP series: D0 = 40001 → address 0 in FC3 (1-based 40001)
   * D100 → address 100 (0-based in modbus-serial)
   */
  dRegToAddress(dNum) {
    return parseInt(dNum, 10); // D100 → address 100
  }

  /**
   * Delta PLC M relay → Coil address
   * M0 → coil 0, M10 → coil 10
   */
  mRelayToAddress(mNum) {
    return parseInt(mNum, 10); // M10 → coil 10
  }

  async connect(ip, port = 502) {
    this.ip = ip;
    this.port = port;

    try {
      if (this.client.isOpen) {
        await this.client.close();
      }
    } catch (_) { /* ignore close errors */ }

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
      if (this.client.isOpen) {
        await this.client.close();
      }
    } catch (_) { /* ignore */ }
    this.connected = false;
    this.log('[DISCONNECTED] Modbus TCP bağlantısı kapatıldı.');
  }

  /**
   * Read a single D register (Holding Register, FC3)
   */
  async readRegister(dNum) {
    if (!this.connected || !this.client.isOpen) {
      return { success: false, error: 'NOT_CONNECTED' };
    }
    if (this.operationLock) {
      return { success: false, error: 'BUSY' };
    }

    this.operationLock = true;
    try {
      const address = this.dRegToAddress(dNum);
      const data = await this.client.readHoldingRegisters(address, 1);
      this.operationLock = false;
      return { success: true, value: data.data[0] };
    } catch (err) {
      this.operationLock = false;
      if (err.message && err.message.toLowerCase().includes('timeout')) {
        this.log(`[ERR_TIMEOUT] D${dNum} okuma zaman aşımı (${MODBUS_TIMEOUT_MS}ms)`);
        this.connected = false;
      } else {
        this.log(`[ERR_READ] D${dNum} → ${err.message}`);
      }
      return { success: false, error: err.message };
    }
  }

  /**
   * Write a single D register (Holding Register, FC16)
   */
  async writeRegister(dNum, value) {
    if (!this.connected || !this.client.isOpen) {
      return { success: false, error: 'NOT_CONNECTED' };
    }

    // Input validation: 0–65535 (16-bit unsigned)
    const intVal = parseInt(value, 10);
    if (isNaN(intVal) || intVal < 0 || intVal > 65535) {
      this.log(`[ERR_VALIDATION] D${dNum} için geçersiz değer: ${value} (0-65535 arası olmalı)`);
      return { success: false, error: 'VALIDATION_ERROR' };
    }

    if (this.operationLock) {
      return { success: false, error: 'BUSY' };
    }

    this.operationLock = true;
    try {
      const address = this.dRegToAddress(dNum);
      await this.client.writeRegister(address, intVal);
      this.operationLock = false;
      this.log(`[WRITE SUCCESS] Delta Register D${dNum} set to ${intVal}`);
      return { success: true, value: intVal };
    } catch (err) {
      this.operationLock = false;
      if (err.message && err.message.toLowerCase().includes('timeout')) {
        this.log(`[ERR_TIMEOUT] D${dNum} yazma zaman aşımı (${MODBUS_TIMEOUT_MS}ms)`);
        this.connected = false;
      } else {
        this.log(`[ERR_WRITE] D${dNum} → ${err.message}`);
      }
      return { success: false, error: err.message };
    }
  }

  /**
   * Read a single M coil (FC1)
   */
  async readCoil(mNum) {
    if (!this.connected || !this.client.isOpen) {
      return { success: false, error: 'NOT_CONNECTED' };
    }
    if (this.operationLock) {
      return { success: false, error: 'BUSY' };
    }

    this.operationLock = true;
    try {
      const address = this.mRelayToAddress(mNum);
      const data = await this.client.readCoils(address, 1);
      this.operationLock = false;
      return { success: true, value: data.data[0] ? 1 : 0 };
    } catch (err) {
      this.operationLock = false;
      if (err.message && err.message.toLowerCase().includes('timeout')) {
        this.log(`[ERR_TIMEOUT] M${mNum} okuma zaman aşımı (${MODBUS_TIMEOUT_MS}ms)`);
        this.connected = false;
      } else {
        this.log(`[ERR_READ] M${mNum} → ${err.message}`);
      }
      return { success: false, error: err.message };
    }
  }

  /**
   * Write a single M coil (FC5)
   */
  async writeCoil(mNum, value) {
    if (!this.connected || !this.client.isOpen) {
      return { success: false, error: 'NOT_CONNECTED' };
    }

    const boolVal = value === true || value === 1 || value === '1' || value === 'true';

    if (this.operationLock) {
      return { success: false, error: 'BUSY' };
    }

    this.operationLock = true;
    try {
      const address = this.mRelayToAddress(mNum);
      await this.client.writeCoil(address, boolVal);
      this.operationLock = false;
      this.log(`[COIL WRITE] M${mNum} → ${boolVal ? 'ON (1)' : 'OFF (0)'}`);
      return { success: true, value: boolVal ? 1 : 0 };
    } catch (err) {
      this.operationLock = false;
      if (err.message && err.message.toLowerCase().includes('timeout')) {
        this.log(`[ERR_TIMEOUT] M${mNum} coil yazma zaman aşımı (${MODBUS_TIMEOUT_MS}ms)`);
        this.connected = false;
      } else {
        this.log(`[ERR_WRITE_COIL] M${mNum} → ${err.message}`);
      }
      return { success: false, error: err.message };
    }
  }

  isConnected() {
    return this.connected && this.client.isOpen;
  }
}

module.exports = ModbusClient;
