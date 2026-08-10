# VIP 도네이터 관리 API 서버 (스캐폴드)

`API_SPEC.md`의 REST API를 구현한 **의존성 0** Node 서버입니다. 그대로 실행되며,
운영 전환 시 Express/Nest + 실 DB로 교체해도 도메인 로직(`src/domain.js`)·라우트(`src/api.js`)는 재사용됩니다.

## 실행

```bash
cd server
npm start          # http://localhost:4000/v1  (node src/server.js)
# 또는 자동 재시작
npm run dev
```

- 데이터는 `server/data.json`에 영속화됩니다(최초 실행 시 시드 생성). 초기화: `npm run reset`
- 인증: 모든 `/v1/*` 요청에 `Authorization: Bearer <token>` 헤더 필요(데모는 토큰 값 검증 생략)
- 환경변수: `PORT`(기본 4000), `API_TOKEN`

## 구조

```
server/
  src/
    server.js   # http 서버 (CORS·인증·바디파싱 → dispatch)
    api.js      # 라우트 테이블 + 디스패처 (메서드+경로 → 핸들러)
    domain.js   # 등급/게이지/칭호/인사이트/자동화 엔진 (순수 함수)
    store.js    # 시드 + data.json 영속화
  data.json     # 런타임 데이터 (git 제외)
```

## 빠른 확인

```bash
curl http://localhost:4000/health
curl -H "Authorization: Bearer demo-token" http://localhost:4000/v1/insights/summary
# 후원 이벤트 주입 → 누적·등급·자동화 발동
curl -X POST http://localhost:4000/v1/webhooks/donation \
  -H "Authorization: Bearer demo-token" -H "Content-Type: application/json" \
  -d '{"name":"톰하디","amount":30000,"type":"text","message":"후원합니다!"}'
```

## 프론트엔드 연동

`client/apiClient.js`의 `ApiClient` + `HttpAdapter`를 사용합니다.

```js
import { ApiClient, HttpAdapter } from '../client/apiClient.js';
const api = new ApiClient(new HttpAdapter({ baseUrl:'http://localhost:4000/v1', token:'demo-token' }));
const { data, meta } = await api.donators.list({ status:'active', sort:'cash', limit:20 });
```

**통합 API 관리자**(`api-console.html`) 상단에서 모드를 **HTTP**로 바꾸고 Base URL을
`http://localhost:4000/v1`로 지정하면, 콘솔이 이 서버로 실제 요청을 보냅니다(CORS 허용됨).

## 다음 단계 (운영 전환)

- `store.js` → PostgreSQL 등 실 DB 레포지토리로 교체 (테이블: grades, donators, titles, donator_awards, automations, automation_logs, settings)
- `server.js` → Express/Nest, JWT 인증, 요청 검증(zod/joi), 레이트리밋
- 웹훅 서명 검증(`X-Toon-Signature` HMAC)
- 라이브 이벤트용 WebSocket 게이트웨이(+Redis Pub/Sub)
- 알림 발송(`kakao_send` 등) → 카카오 알림톡 API 연동 + 발송 이력 테이블
