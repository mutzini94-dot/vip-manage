// VIP 도네이터 관리 API 서버 (의존성 0 — Node 내장 http).
// 실제 운영 시엔 Express/Nest 로 교체 권장. 라우트 로직(api.js)은 그대로 재사용 가능.
import http from 'http';
import { dispatch } from './api.js';

const PORT = process.env.PORT || 4000;
const PREFIX = '/v1';
const TOKEN = process.env.API_TOKEN || 'demo-token'; // 데모용. 실제론 JWT 검증.

function send(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  });
  res.end(body);
}

const server = http.createServer((req, res) => {
  // CORS preflight
  if (req.method === 'OPTIONS') return send(res, 204, {});

  const url = new URL(req.url, `http://${req.headers.host}`);
  const query = Object.fromEntries(url.searchParams.entries());

  // health / root
  if (url.pathname === '/health') return send(res, 200, { ok: true, service: 'vip-donator-api', version: 'v1' });
  if (url.pathname === '/' || url.pathname === PREFIX) return send(res, 200, { service: 'VIP 도네이터 관리 API', version: 'v1', docs: 'API_SPEC.md', base: PREFIX });

  // 인증 (데모: Bearer 토큰 존재만 확인)
  const auth = req.headers['authorization'] || '';
  if (!auth.startsWith('Bearer ')) return send(res, 401, { error: { code: 'UNAUTHORIZED', message: 'Bearer 토큰이 필요합니다' } });
  // if (auth.slice(7) !== TOKEN) return send(res, 401, { error:{ code:'UNAUTHORIZED', message:'토큰 불일치' } });

  // /v1 prefix 제거
  if (!url.pathname.startsWith(PREFIX)) return send(res, 404, { error: { code: 'NOT_FOUND', message: 'unknown path' } });
  const path = url.pathname.slice(PREFIX.length) || '/';

  // body 수집
  let raw = '';
  req.on('data', c => { raw += c; if (raw.length > 1e6) req.destroy(); });
  req.on('end', () => {
    let body = {};
    if (raw) { try { body = JSON.parse(raw); } catch { return send(res, 400, { error: { code: 'VALIDATION_ERROR', message: 'invalid JSON body' } }); } }
    try {
      const result = dispatch(req.method, path, query, body);
      send(res, result.status, result.data);
    } catch (e) {
      send(res, 500, { error: { code: 'INTERNAL', message: e.message } });
    }
  });
});

server.listen(PORT, () => {
  console.log(`▶ VIP 도네이터 관리 API — http://localhost:${PORT}${PREFIX}`);
  console.log(`  health: http://localhost:${PORT}/health`);
});
