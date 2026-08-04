/**
 * failSafe.js
 * Auto-reconnect mekanizması ve Fail-Safe yönetimi.
 * Master STOP veya bağlantı kopması → kritik coil'leri sıfırlar.
 */

const RECONNECT_INTERVAL_MS = 3000;
const CRITICAL_COILS = [10, 12]; // M10, M12 — fail-safe'de sıfırlanacak coil'ler
const CRITICAL_REGISTERS = [];   // Gerekirse kritik register'lar buraya eklenir

class FailSafeManager {
  constructor(modbusClient, io, logFn) {
    this.client = modbusClient;
    this.io = io;
    this.log = logFn || console.log;
    this.reconnectTimer = null;
    this.isReconnecting = false;
    this.shouldReconnect = false;
    this.targetIp = null;
    this.targetPort = 502;

    // Global hata yakalama — sunucunun çökmesini önler
    process.on('uncaughtException', (err) => {
      this.log(`[FATAL] Yakalanmamış istisna: ${err.message}`);
      console.error('[FATAL] uncaughtException:', err);
    });

    process.on('unhandledRejection', (reason) => {
      this.log(`[FATAL] İşlenmemiş Promise reddi: ${reason}`);
      console.error('[FATAL] unhandledRejection:', reason);
    });
  }

  /**
   * Auto-reconnect döngüsünü başlatır.
   */
  startReconnect(ip, port) {
    if (this.isReconnecting) return;
    this.targetIp = ip;
    this.targetPort = port;
    this.shouldReconnect = true;
    this.isReconnecting = true;

    this.log(`[RECONNECT] Bağlantı koptu. ${RECONNECT_INTERVAL_MS / 1000}s aralıklarla yeniden denenecek...`);
    this._emitStatus('RECONNECTING');

    this.reconnectTimer = setInterval(async () => {
      if (!this.shouldReconnect) {
        this._stopReconnect();
        return;
      }

      this.log(`[RECONNECT] Deneniyor → ${this.targetIp}:${this.targetPort}`);
      const result = await this.client.connect(this.targetIp, this.targetPort);

      if (result.success) {
        this.log(`[RECONNECT] Başarılı! PLC bağlantısı yeniden kuruldu.`);
        this._stopReconnect();
        this._emitStatus('CONNECTED');
      } else {
        this._emitStatus('RECONNECTING');
      }
    }, RECONNECT_INTERVAL_MS);
  }

  /**
   * Auto-reconnect döngüsünü durdurur.
   */
  _stopReconnect() {
    this.shouldReconnect = false;
    this.isReconnecting = false;
    if (this.reconnectTimer) {
      clearInterval(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  /**
   * Manuel olarak reconnect'i iptal eder (örn. kullanıcı bağlantıyı kesti).
   */
  cancelReconnect() {
    this.shouldReconnect = false;
    this._stopReconnect();
    this.log('[RECONNECT] Otomatik yeniden bağlanma iptal edildi.');
  }

  /**
   * Fail-Safe: Kritik coil ve register'ları sıfırlar.
   * Master STOP veya bağlantı kopması durumunda çağrılır.
   */
  async triggerFailSafe(reason = 'MANUAL_STOP') {
    this.log(`[FAIL-SAFE] Tetiklendi → Neden: ${reason}`);
    this._emitStatus('FAIL_SAFE');

    if (!this.client.isConnected()) {
      this.log('[FAIL-SAFE] PLC bağlı değil, lokal sıfırlama yapıldı.');
      this._emitStatus('STOPPED');
      return;
    }

    // Kritik coil'leri sıfırla
    for (const coilNum of CRITICAL_COILS) {
      try {
        await this.client.writeCoil(coilNum, false);
        this.log(`[FAIL-SAFE] M${coilNum} → RESET (0)`);
      } catch (err) {
        this.log(`[FAIL-SAFE ERR] M${coilNum} sıfırlanamadı: ${err.message}`);
      }
    }

    // Kritik register'ları sıfırla (gerekirse)
    for (const regNum of CRITICAL_REGISTERS) {
      try {
        await this.client.writeRegister(regNum, 0);
        this.log(`[FAIL-SAFE] D${regNum} → RESET (0)`);
      } catch (err) {
        this.log(`[FAIL-SAFE ERR] D${regNum} sıfırlanamadı: ${err.message}`);
      }
    }

    this.log('[FAIL-SAFE] Güvenli sıfırlama tamamlandı.');
    this._emitStatus('STOPPED');
  }

  _emitStatus(status) {
    if (this.io) {
      this.io.emit('plc:status', { status, timestamp: new Date().toISOString() });
    }
  }
}

module.exports = FailSafeManager;
