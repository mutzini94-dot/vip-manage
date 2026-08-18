# VIP 도네이터 관리 — REST API 명세서 (v1)

현재 프론트엔드(`vip-donator-manager.html`)가 사용하는 데이터 모델을 기준으로 설계한 백엔드 API 규격입니다.
프론트엔드는 지금 `localStorage`(키 `toon_vip_v1`)를 직접 읽지만, 아래 API로 교체하면 실제 서버 연동이 가능합니다.

---

## 1. 아키텍처

```
┌────────────────┐     REST/JSON      ┌─────────────────┐        ┌────────────┐
│  프론트엔드     │  ───────────────▶  │   API 서버       │  ────▶ │  Database  │
│ (관리 화면)     │  ◀───────────────  │  (Node/Spring…)  │        │ (Postgres) │
└────────────────┘                    └─────────────────┘        └────────────┘
        ▲                                    ▲   ▲
        │ WebSocket(라이브)                   │   │ Webhook(수신)
        │                                    │   │
   실시간 이벤트 ◀───────────────────────────┘   └──── 투네이션 후원/로그인 이벤트
```

- **데이터 어댑터 패턴**: 프론트는 `ApiClient` 추상화를 통해 접근하며, 두 어댑터를 교체 가능
  - `MockAdapter` — 브라우저 `localStorage` 기반 (오프라인/데모, 통합 API 관리자에 내장)
  - `HttpAdapter` — 실제 REST 서버 호출
- **수신(Webhook)**: 투네이션의 실제 후원·로그인 이벤트가 `POST /webhooks/*`로 들어와 누적 집계·등급 재분류·자동화 발동을 트리거
- **실시간(WebSocket)**: 라이브 방송 중 접속/후원/랭킹은 `wss://…/live` 스트림으로 push

---

## 2. 공통 규약

| 항목 | 값 |
|------|-----|
| Base URL | `https://api.toonation.example/v1` |
| 인증 | `Authorization: Bearer <ACCESS_TOKEN>` (크리에이터 단위) |
| 요청/응답 | `Content-Type: application/json; charset=utf-8` |
| 금액 단위 | 정수(캐시/원), 소수점 없음 |
| 날짜 | `YYYY-MM-DD`, 일시 `YYYY-MM-DD HH:mm:ss` (KST) |
| ID | 문자열 (`g_vvip`, `t_gold`, 또는 서버 생성 UUID) |

### 페이지네이션 (목록 공통)
```
GET /donators?page=1&limit=20
→ { "data": [ ... ], "meta": { "page": 1, "limit": 20, "total": 137 } }
```

### 에러 포맷
```json
{ "error": { "code": "NOT_FOUND", "message": "donator not found", "field": null } }
```
| 상태 | 코드 | 의미 |
|------|------|------|
| 400 | `VALIDATION_ERROR` | 요청 값 오류 |
| 401 | `UNAUTHORIZED` | 토큰 없음/만료 |
| 403 | `FORBIDDEN` | 권한 없음 |
| 404 | `NOT_FOUND` | 리소스 없음 |
| 409 | `CONFLICT` | 중복(예: 등급명) |
| 422 | `RULE_ERROR` | 규칙 위반(예: 최소>최대) |
| 422 | `INSUFFICIENT_CREDIT` | 알림톡 발송 건수 부족(충전 필요) |
| 422 | `CONSENT_REQUIRED` | 알림톡 수신 미동의 도네이터에게 발송 시도 |
| 429 | `RATE_LIMITED` | 과도한 요청 |

---

## 3. 데이터 모델

### Grade (등급)
```json
{ "id": "g_vvip", "name": "VVIP", "cls": "vvip", "color": "#ffcb45",
  "mode": "over", "min": 300000, "max": 0 }
```
- `mode`: `"over"`(이상) | `"range"`(범위). `range`일 때 `max` 사용, `over`면 `max:0`
- 등급은 **누적 후원 금액**으로 자동 분류(저장하지 않고 서버가 계산)

### Donator (도네이터)
```json
{ "id": "id7x…", "name": "톰하디", "alias": "톰", "cash": 464100, "count": 105,
  "grade": { "id": "g_vvip", "name": "VVIP" },
  "tags": ["단골","게임팬"], "memo": "게임 좋아함",
  "awards": ["t_bday"], "blocked": false, "blockReason": null, "blockedAt": null,
  "join": "2023-05-11", "last": "2024-10-31",
  "types": ["text","voice"], "nudged": false, "celebrated": false,
  "reengaged": false, "reengagedAt": null, "alimConsent": true,
  "gauge": { "top": false, "next": {"id":"g_vvip","name":"VVIP"}, "remaining": 12000, "pct": 92 },
  "fanTemperature": { "temp": 78, "level": "warm", "cooling": false, "r": 90, "f": 74, "m": 82, "e": 55 },
  "perks": [ { "id":"pk1", "name":"전용 이모티콘", "icon":"😎" } ],
  "history": [ { "time":"2024-10-10 10:00:00", "kind":"텍스트", "amt":1000, "msg":"후원합니다!" } ] }
```
- `grade`·`gauge`·`fanTemperature`·`perks`는 서버 계산 필드(읽기 전용). `types`: `text|signature|voice|quest`
- **`alimConsent`**: 알림톡 수신 동의. `false`면 발송 계열 API(`nudge`·`reengage`·`celebrate`·`thanks`·자동화 `kakao_send`)에서 **발송 제외/차단**
- **`reengagedAt`**: 마지막 복귀 유도 발송 시각(ms). 복귀 유도는 재발송 가능
- **`fanTemperature`**(관계 온도): RFM+ 점수(0~100°)와 레벨(`hot|warm|mild|cool|cold`), `cooling`(평소 주기보다 뜸함). `r/f/m/e`=최근성·빈도·금액·소통 백분위

### Title (칭호)
```json
{ "id": "t_gold", "name": "골드 서포터", "icon": "👑", "color": "#ffcb45",
  "rule": { "type": "cumulative", "n": 300000 } }
```
- `rule.type`: `cumulative`(누적금액≥n) | `count`(건수≥n) | `single`(단일후원≥n) | `grade`(특정등급도달, `grade`=gradeId) | `manual`(수동수여)

### Automation (자동화)
```json
{ "id":"a1", "on": true, "situ": "amount",
  "amt": { "mode":"range", "min":10000, "max":100000 },
  "targetMode": "class", "classes": ["g_vvip"], "picks": [],
  "actions": [ {"type":"widget","cfg":{"widget":"팡파르"}}, {"type":"tts","cfg":{"voice":"ara"}} ],
  "cooldown": { "on":true, "scope":"donator", "minutes":10, "dailyCap":3 },
  "schedule": { "on":false, "days":[1,2,3,4,5], "start":"20:00", "end":"23:00", "from":"", "to":"" } }
```
- `situ`(상황): `login`(방송시작) | `first`(첫후원) | `donate`(특정도네이터) | `amount`(특정금액) | `promote`(등급승급) | `anniv`(가입기념일)
- `actions[].type`: `kakao_send` | `kakao_recv` | `remote` | `widget` | `tts`
- `targetMode`: `class`(등급분류) | `pick`(직접선택). `cooldown.scope`: `donator` | `global`. `schedule.days`: 0(일)~6(토)

### AutomationLog (실행 로그)
```json
{ "when":"10-31 21:14", "situ":"amount", "name":"톰하디", "grade":"VVIP", "action":"widget", "amt":30000 }
```

### MessageCredit (알림톡 발송 건수 · 크레딧)
```json
{ "balance": 300, "sent": 12,
  "log": [ { "ts":"08-14 14:03", "type":"recharge", "amount":300, "balance":598 } ] }
```
- **복귀 유도(reengage)·승급 넛지(nudge)·감사(thanks)** 알림톡이 공용으로 사용하는 발송 건수 풀. 기본 300건
- 발송 1건당 `balance` 1 차감, `sent` 1 증가. `balance<=0`이면 발송 차단(`422 INSUFFICIENT_CREDIT`)
- 크리에이터가 충전하면 `balance` 증가 + `log`에 이력 기록

### Perk (전용 혜택)
```json
{ "id":"pk1", "name":"디스코드 VIP 롤", "icon":"💬", "desc":"디스코드 전용 채널·롤 지급",
  "grades":["g_vvip"] }
```
- `grades`에 속한 등급의 도네이터에게 **자동 부여**(별도 저장 없이 등급으로 계산)

### Outreach (복귀 유도·넛지 발송 이력)
```json
{ "id":"or1", "donatorId":"id7x…", "type":"reengage", "ts":1723600000000,
  "result":"converted", "resultAt":1723800000000, "amount":30000 }
```
- `type`: `reengage` | `nudge`. `result`: `converted`(복귀/후원 전환) | `none`(무응답) | `pending`(대기)
- `amount`: 전환 시 발생한 후원 캐시(추정). 전환율은 `pending` 제외한 확정 건 기준

### AutomationRun (자동화 발동·전환 이력)
```json
{ "id":"ar1", "autoId":"a1", "donatorId":"id7x…", "ts":1723600000000,
  "result":"converted", "convAmount":12000 }
```
- 자동화 발동 1건당 1레코드. `result`로 발동 후 후원 전환 추적

### Settings (설정)
```json
{ "annivAuto": true, "milestoneNudge": false, "toonUnreadAlert": true,
  "creatorName":"크리에이터", "channelName":"", "broadcastUrl":"",
  "churnDays":30, "nudgeAmount":50000 }
```
- `creatorName`은 메시지 치환자 `{크리에이터}`에 반영. `churnDays`·`nudgeAmount`는 이탈/승급 기준 기본값
- 인증(로그인) 자격증명은 별도 보관하며 **응답에 노출하지 않음**

---

## 4. 엔드포인트

### 4.1 등급 Grades
| 메서드 | 경로 | 설명 |
|--------|------|------|
| GET | `/grades` | 등급 목록(누적금액 desc) + 각 등급 인원수 |
| POST | `/grades` | 등급 생성 `{name,color,mode,min,max}` |
| GET | `/grades/{id}` | 단건 |
| PUT | `/grades/{id}` | 수정 |
| DELETE | `/grades/{id}` | 삭제(해당 인원 재분류) |

### 4.2 도네이터 Donators
| 메서드 | 경로 | 설명 |
|--------|------|------|
| GET | `/donators` | 목록. query: `q`(닉/별칭/태그/메모 검색), `status`(active·blocked·all), `sort`(cash·count), `order`, `grade`, `page`, `limit` |
| GET | `/donators/{id}` | 상세(프로필: grade·gauge·titles·history 포함) |
| PATCH | `/donators/{id}` | `alias`·`memo` 수정 |
| POST | `/donators/{id}/tags` | 태그 추가 `{tag}` |
| DELETE | `/donators/{id}/tags/{tag}` | 태그 삭제 |
| POST | `/donators/{id}/block` | 차단 `{reason}` |
| POST | `/donators/{id}/unblock` | 차단 해제 |
| GET | `/donators/{id}/titles` | 획득 칭호(규칙 자동 + 수동) |
| POST | `/donators/{id}/awards/{titleId}` | 수동 칭호 수여 |
| DELETE | `/donators/{id}/awards/{titleId}` | 수동 칭호 회수 |
| POST | `/donators/bulk` | 일괄 작업 `{ids:[], action:"tag\|block\|unblock", tag?}` |
| GET | `/donators/export.csv` | CSV 내보내기(UTF-8 BOM) |

**예시** `GET /donators?status=active&sort=cash&order=desc&limit=2`
```json
{ "data": [
  { "id":"id7x…","name":"톰하디","cash":464100,"count":105,"grade":{"id":"g_vvip","name":"VVIP"} },
  { "id":"id3a…","name":"치킨마요","cash":451400,"count":62,"grade":{"id":"g_vvip","name":"VVIP"} }
], "meta": { "page":1,"limit":2,"total":29 } }
```

### 4.3 칭호 Titles
| 메서드 | 경로 | 설명 |
|--------|------|------|
| GET | `/titles` | 목록 + 보유 인원수 |
| POST | `/titles` | 생성 `{name,icon,color,rule}` |
| PUT | `/titles/{id}` | 수정 |
| DELETE | `/titles/{id}` | 삭제 |
| GET | `/titles/{id}/holders` | 보유 도네이터 목록 |

### 4.4 자동화 Automations
| 메서드 | 경로 | 설명 |
|--------|------|------|
| GET | `/automations` | 목록 |
| POST | `/automations` | 생성 |
| PUT | `/automations/{id}` | 수정 |
| PATCH | `/automations/{id}` | 토글 `{on}` |
| DELETE | `/automations/{id}` | 삭제 |
| GET | `/automations/templates` | 추천 템플릿 프리셋 |
| POST | `/automations/{id}/test` | 테스트 발동(시뮬레이션 결과 반환) |
| GET | `/automations/{id}/runs` | 발동 이력 + 성과(발동수·전환수·전환율·전환후원) |

> 자동화 `kakao_send` 액션은 **수신 미동의(`alimConsent:false`) 도네이터에게는 발송 생략**(위젯·TTS 등 화면 효과는 유지).

### 4.5 자동화 로그 Automation Logs
| 메서드 | 경로 | 설명 |
|--------|------|------|
| GET | `/automation-logs?limit=50` | 실행 이력 |
| DELETE | `/automation-logs` | 전체 삭제 |

### 4.6 인사이트 Insights (읽기 전용 집계)
| 메서드 | 경로 | 설명 |
|--------|------|------|
| GET | `/insights/summary` | KPI(총후원·활성VIP·이번달·이탈위험 수) |
| GET | `/insights/trend?months=6` | 월별 후원 추이 |
| GET | `/insights/grade-distribution` | 등급별 매출 비중 |
| GET | `/insights/pareto` | 상위 후원자 기여도 |
| GET | `/insights/churn?days=30` | 이탈 위험 VIP(무후원 N일↑, 차단 제외) |
| GET | `/insights/upgrade-candidates?within=50000` | 승급 임박 VIP(넛지 대상) |
| GET | `/insights/anniversaries?within=30` | 다가오는 가입 기념일 |
| GET | `/insights/hall-of-fame?scope=total` | 명예의 전당 랭킹·시상대·전용 뱃지 |
| GET | `/insights/outreach` | 복귀 유도·넛지 성과(유형별 발송·전환·전환율·유도후원) |
| GET | `/insights/fan-temperature` | 관계 온도(팬 건강 스코어) 분포 + 식어가는 단골·뜨거운 팬 |

**예시** `GET /insights/summary`
```json
{ "totalCash": 6120000, "activeVip": 26, "thisMonth": 612000, "trendDeltaPct": 26, "churnCount": 23 }
```
**예시** `GET /insights/outreach`
```json
{ "reengage": { "sent":10, "converted":6, "rate":60, "cash":298200, "pending":1 },
  "nudge": { "sent":10, "converted":6, "rate":60, "cash":202900, "pending":1 },
  "totalCash": 501100 }
```

### 4.7 전용 혜택 Perks
| 메서드 | 경로 | 설명 |
|--------|------|------|
| GET | `/perks` | 혜택 목록(+ 등급 기준 보유 인원수) |
| POST | `/perks` | 생성 `{name,icon,desc,grades}` |
| PUT | `/perks/{id}` | 수정 |
| DELETE | `/perks/{id}` | 삭제 |
| GET | `/donators/{id}/perks` | 해당 도네이터가 등급으로 받는 혜택 |

### 4.8 알림 발송 Actions (카카오 알림톡 등)
| 메서드 | 경로 | 설명 |
|--------|------|------|
| POST | `/donators/{id}/nudge` | 승급 넛지 발송 `{message}` (치환자 `{닉네임}{다음등급}{남은금액}` 지원) |
| POST | `/donators/{id}/reengage` | 이탈 복귀 유도 발송 `{message}` (재발송 가능) |
| POST | `/donators/{id}/celebrate` | 기념일 축하 발송 `{message}` |
| POST | `/donators/thanks` | 감사 메시지 **일괄 발송** `{ids:[], message}` → 동의자에게만 발송 |

응답 예: `{ "sent": true, "channel": "kakao_alimtalk", "to": "톰하디", "at": "2026-08-10 14:03:00", "creditRemaining": 299 }`

> **수신 동의 필수:** `alimConsent:false`인 도네이터는 위 발송이 **차단**(`422 CONSENT_REQUIRED`). 일괄 발송(`thanks`)은 미동의자를 제외하고 동의자에게만 발송하며 발송 수만큼 크레딧 차감.

> **발송 건수(크레딧):** `nudge`·`reengage`는 발송 시 **발송 건수 1건을 차감**하고 응답에 `creditRemaining`을 포함합니다. 잔여 건수가 없으면 `422 INSUFFICIENT_CREDIT`. `celebrate`는 차감하지 않습니다. 조회·충전은 §4.11 참고.

### 4.9 라이브 Live (방송)
| 메서드 | 경로 | 설명 |
|--------|------|------|
| POST | `/live/start` | 방송 시작 |
| POST | `/live/stop` | 방송 종료 |
| GET | `/live/state` | 현재 접속 VIP·피드·랭킹·세션후원·해피아워 |
| POST | `/live/happy-hour` | 해피아워 시작 `{mult:2\|3, minutes:10\|20\|30}` |
| DELETE | `/live/happy-hour` | 해피아워 종료 |
| POST | `/live/greet` | 인사 `{donatorId}` |
| WS | `/live/events` | 실시간 이벤트 스트림(입장·후원·퇴장·랭킹 갱신) |

WebSocket 이벤트 예:
```json
{ "type":"donation", "donator":{"id":"id7x…","name":"톰하디","grade":"VVIP"},
  "amount":30000, "boost":3, "rankTop5":[ … ], "sessionTotal":420000 }
```

### 4.10 방송 스케줄 Schedules
| 메서드 | 경로 | 설명 |
|--------|------|------|
| GET | `/schedules?status=upcoming` | 일정 목록(+ `next` 다음 방송). status: upcoming·live·done·cancelled |
| POST | `/schedules` | 일정 생성 `{title,date,start,end,category,repeat,days,visible,notify,memo}` (repeat=weekly면 8회 자동 생성) |
| PUT | `/schedules/{id}` | 수정 |
| DELETE | `/schedules/{id}` | 삭제 |
| POST | `/schedules/{id}/remind` | 예정 알림톡 발송(활성 VIP 대상) → `{recipients}` |
| GET | `/schedules/export.ics` | **iCal(.ics)** 내보내기 (`text/calendar`) — 구글/애플 캘린더 구독 |

### 4.11 방송 Broadcasts
| 메서드 | 경로 | 설명 |
|--------|------|------|
| POST | `/broadcasts/start` | 방송 시작 → **login 트리거 자동화 발동** → `{firedCount, matches, next}` |
| POST | `/broadcasts/prestart` | **방송 예정(사전) 알림 자동화 발동**(ON인 것만) → `{firedCount, active}` |

> `situ='prestart'` 자동화는 `lead`(방송 N시간 전) 필드를 가집니다. 모든 자동화는 `PATCH /automations/{id} {on}`으로 **ON/OFF** 가능.

### 4.12 설정 Settings
| 메서드 | 경로 | 설명 |
|--------|------|------|
| GET | `/settings` | 설정 조회(자동화 기본값 + 크리에이터 프로필) |
| PUT | `/settings` | 설정 갱신 `{annivAuto,milestoneNudge,toonUnreadAlert,creatorName,channelName,broadcastUrl,churnDays,nudgeAmount}` |
| GET | `/settings/credits` | 알림톡 발송 건수 조회 → `{ balance, sent }` |
| POST | `/settings/credits/recharge` | 발송 건수 충전 `{amount}` → `{ balance, added }` |

---

## 5. 웹훅 Webhooks (투네이션 → 우리 서버, 수신)

실제 후원·로그인 이벤트를 받아 **누적 집계·등급 재분류·자동화 발동**을 수행합니다.
서명 검증 헤더 `X-Toon-Signature`(HMAC) 권장.

### `POST /webhooks/donation`
```json
// 요청
{ "donatorId": "id7x…", "name": "톰하디", "amount": 30000, "type": "text", "message": "후원합니다!" }
// 응답
{ "donator": { "id":"id7x…","cash":494100,"count":106,"grade":{"id":"g_vvip","name":"VVIP"} },
  "gradeChanged": false,
  "firedAutomations": [ { "id":"a2","situ":"amount","actions":["widget","tts"] } ] }
```
- `donatorId`가 없으면 `name`으로 매칭/신규 생성 → `first`(첫 후원) 트리거 발동
- `amount`가 등급 문턱을 넘기면 `gradeChanged:true` + `promote` 트리거 발동

### `POST /webhooks/login`
```json
{ "donatorId": "id7x…" }
→ { "online": true, "firedAutomations": [ {"id":"a1","situ":"login","actions":["kakao_send"]} ] }
```

---

## 6. 서버 구현 가이드 (권장 스택)

- **런타임**: Node.js(Express/Nest) 또는 Spring Boot
- **DB 테이블**: `grades`, `donators`(+`alim_consent`), `titles`, `donator_awards`(N:M), `automations`, `automation_logs`, `automation_runs`, `perks`(+`perk_grades`), `outreach`, `message_credits`, `schedules`, `settings`
- **계산 필드**(grade/gauge/insights)는 쿼리 시 계산하거나 머티리얼라이즈드 뷰로 캐싱
- **자동화 엔진**: 웹훅 수신 → 활성 자동화 매칭 → 쿨다운/스케줄 게이트 → 액션 실행 → 로그 적재
- **알림 발송**: 카카오 알림톡 API 연동(발송 이력 테이블 기록)
- **실시간**: Redis Pub/Sub + WebSocket 게이트웨이

---

## 7. 통합 API 관리자

`api-console.html`(별도 파일)에서 위 모든 엔드포인트를 **브라우저에서 바로 테스트**하고,
**Mock 모드**로 실제 데이터를 주입하면 프론트엔드 화면(`vip-donator-manager.html`)이 그 데이터로 렌더링됩니다.
자세한 사용법은 관리자 상단 도움말 참고.
