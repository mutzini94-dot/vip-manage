// 최소 WebSocket 서버 (RFC 6455) — 의존성 0, 텍스트 프레임 전용.
// 운영 시엔 `ws` 패키지 권장. 여기선 핸드셰이크 + 프레임 인/디코드만 직접 구현.
import crypto from 'crypto';
import { EventEmitter } from 'events';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

// http 'upgrade' 이벤트에서 호출 → 핸드셰이크 후 WsConn 반환
export function accept(req, socket) {
  const key = req.headers['sec-websocket-key'];
  if (!key) { socket.destroy(); return null; }
  const acceptKey = crypto.createHash('sha1').update(key + GUID).digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    `Sec-WebSocket-Accept: ${acceptKey}\r\n\r\n`
  );
  return new WsConn(socket);
}

// 서버→클라이언트 프레임(마스킹 없음)
function encode(str) {
  const payload = Buffer.from(str, 'utf8');
  const len = payload.length;
  let header;
  if (len < 126) header = Buffer.from([0x81, len]);
  else if (len < 65536) { header = Buffer.alloc(4); header[0] = 0x81; header[1] = 126; header.writeUInt16BE(len, 2); }
  else { header = Buffer.alloc(10); header[0] = 0x81; header[1] = 127; header.writeBigUInt64BE(BigInt(len), 2); }
  return Buffer.concat([header, payload]);
}

class WsConn extends EventEmitter {
  constructor(socket) {
    super();
    this.socket = socket;
    this.buf = Buffer.alloc(0);
    this.open = true;
    socket.on('data', d => { this.buf = Buffer.concat([this.buf, d]); this._parse(); });
    socket.on('close', () => { this.open = false; this.emit('close'); });
    socket.on('error', () => { this.open = false; this.emit('close'); });
  }
  send(obj) {
    if (!this.open) return;
    try { this.socket.write(encode(typeof obj === 'string' ? obj : JSON.stringify(obj))); } catch {}
  }
  close() { if (this.open) { try { this.socket.end(Buffer.from([0x88, 0x00])); } catch {} this.open = false; } }
  _parse() {
    while (this.buf.length >= 2) {
      const b0 = this.buf[0], b1 = this.buf[1];
      const opcode = b0 & 0x0f;
      const masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f;
      let offset = 2;
      if (len === 126) { if (this.buf.length < 4) return; len = this.buf.readUInt16BE(2); offset = 4; }
      else if (len === 127) { if (this.buf.length < 10) return; len = Number(this.buf.readBigUInt64BE(2)); offset = 10; }
      let maskKey;
      if (masked) { if (this.buf.length < offset + 4) return; maskKey = this.buf.slice(offset, offset + 4); offset += 4; }
      if (this.buf.length < offset + len) return; // 프레임 미완성 → 대기
      let payload = this.buf.slice(offset, offset + len);
      if (masked) { const out = Buffer.alloc(len); for (let i = 0; i < len; i++) out[i] = payload[i] ^ maskKey[i & 3]; payload = out; }
      this.buf = this.buf.slice(offset + len);
      if (opcode === 0x8) { this.close(); return; }              // close
      else if (opcode === 0x9) { try { this.socket.write(Buffer.from([0x8a, 0x00])); } catch {} } // ping→pong
      else if (opcode === 0x1 || opcode === 0x0) { this.emit('message', payload.toString('utf8')); } // text
    }
  }
}
