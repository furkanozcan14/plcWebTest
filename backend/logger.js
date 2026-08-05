const fs = require('fs');
const path = require('path');

class DataLogger {
  constructor(flushIntervalMs = 5000) {
    this.buffer = [];
    this.flushIntervalMs = flushIntervalMs;
    this.timer = null;
    this.logsDir = path.join(__dirname, '..', 'logs');
    
    // Ensure logs directory exists
    if (!fs.existsSync(this.logsDir)) {
      fs.mkdirSync(this.logsDir, { recursive: true });
    }
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.flush(), this.flushIntervalMs);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.flush(); // Flush remaining data
  }

  append(tags, status, simulationMode) {
    const timestamp = new Date().toISOString();
    
    // Create a compact row for this poll
    const record = {
      timestamp,
      status,
      sim: simulationMode ? 1 : 0,
      data: {}
    };

    tags.forEach(t => {
      // Log address instead of name to keep file size small
      const prefix = t.type === 'register' ? 'D' : 'M';
      record.data[`${prefix}${t.address}`] = t.value;
    });

    this.buffer.push(record);
  }

  getTodayFilename() {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return path.join(this.logsDir, `plc_log_${yyyy}-${mm}-${dd}.txt`);
  }

  flush() {
    if (this.buffer.length === 0) return;

    const dataToWrite = this.buffer.slice(); // Copy buffer
    this.buffer = []; // Clear current buffer

    const filePath = this.getTodayFilename();
    const lines = dataToWrite.map(r => JSON.stringify(r) + '\n').join('');

    // Asynchronously append to file to avoid blocking the event loop
    fs.appendFile(filePath, lines, (err) => {
      if (err) {
        console.error('[LOGGER_ERR] Canlı kayıt dosyaya yazılamadı:', err.message);
      }
    });
  }
}

module.exports = { DataLogger };
