/* =========================================================
   ApiClient — 프론트엔드용 API 어댑터
   ---------------------------------------------------------
   사용:
     import { ApiClient, HttpAdapter } from './apiClient.js';
     const api = new ApiClient(new HttpAdapter({
       baseUrl: 'http://localhost:4000/v1',
       token: 'demo-token',
     }));
     const { data, meta } = await api.donators.list({ status:'active', sort:'cash', limit:20 });
     const profile = await api.donators.get(id);
     await api.webhooks.donation({ donatorId:id, amount:30000, type:'text' });

   어댑터를 교체하면 오프라인(Mock)/실서버(HTTP)를 전환할 수 있습니다.
   기존 화면의 동기 load()/save(localStorage) 코드를 아래 메서드 호출로 점진 교체하세요.
   ========================================================= */

export class HttpAdapter {
  constructor({ baseUrl, token = '', fetchImpl } = {}) {
    this.baseUrl = (baseUrl || '').replace(/\/$/, '');
    this.token = token;
    this.fetch = fetchImpl || (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : null);
  }
  async request(method, path, { query, body } = {}) {
    const qs = query && Object.keys(query).length ? '?' + new URLSearchParams(query) : '';
    const opt = {
      method,
      headers: { 'Content-Type': 'application/json', ...(this.token ? { Authorization: 'Bearer ' + this.token } : {}) },
    };
    if (method !== 'GET' && method !== 'DELETE' && body != null) opt.body = JSON.stringify(body);
    const res = await this.fetch(this.baseUrl + path + qs, opt);
    let data;
    try { data = await res.json(); } catch { data = null; }
    if (!res.ok) {
      const e = new Error((data && data.error && data.error.message) || res.statusText);
      e.status = res.status; e.code = data && data.error && data.error.code; e.body = data;
      throw e;
    }
    return data;
  }
}

/* 브라우저 전용: 통합 API 관리자(api-console.html)의 내장 mockApi 를 어댑터로 감쌀 때 사용.
   window.mockApi(method, path, {query, body}) → {status, data} 가 있을 때 동작. */
export class MockAdapter {
  constructor(mockApi = (typeof window !== 'undefined' ? window.mockApi : null)) { this.mockApi = mockApi; }
  async request(method, path, { query, body } = {}) {
    const r = this.mockApi(method, path, { query: query || {}, body: body || {} });
    if (r.status >= 400) { const e = new Error((r.data.error && r.data.error.message) || 'error'); e.status = r.status; e.code = r.data.error && r.data.error.code; throw e; }
    return r.data;
  }
}

export class ApiClient {
  constructor(adapter) {
    this.a = adapter;
    const req = (m, p, o) => this.a.request(m, p, o);

    this.grades = {
      list:   ()            => req('GET', '/grades'),
      get:    (id)          => req('GET', `/grades/${id}`),
      create: (body)        => req('POST', '/grades', { body }),
      update: (id, body)    => req('PUT', `/grades/${id}`, { body }),
      remove: (id)          => req('DELETE', `/grades/${id}`),
    };
    this.donators = {
      list:    (query)          => req('GET', '/donators', { query }),
      get:     (id)             => req('GET', `/donators/${id}`),
      update:  (id, body)       => req('PATCH', `/donators/${id}`, { body }),
      addTag:  (id, tag)        => req('POST', `/donators/${id}/tags`, { body: { tag } }),
      removeTag:(id, tag)       => req('DELETE', `/donators/${id}/tags/${encodeURIComponent(tag)}`),
      block:   (id, reason)     => req('POST', `/donators/${id}/block`, { body: { reason } }),
      unblock: (id)             => req('POST', `/donators/${id}/unblock`),
      titles:  (id)             => req('GET', `/donators/${id}/titles`),
      grant:   (id, titleId)    => req('POST', `/donators/${id}/awards/${titleId}`),
      revoke:  (id, titleId)    => req('DELETE', `/donators/${id}/awards/${titleId}`),
      bulk:    (ids, action, tag)=> req('POST', '/donators/bulk', { body: { ids, action, tag } }),
      nudge:   (id, message)    => req('POST', `/donators/${id}/nudge`, { body: { message } }),
      reengage:(id, message)    => req('POST', `/donators/${id}/reengage`, { body: { message } }),
      celebrate:(id, message)   => req('POST', `/donators/${id}/celebrate`, { body: { message } }),
    };
    this.titles = {
      list:    ()            => req('GET', '/titles'),
      create:  (body)        => req('POST', '/titles', { body }),
      update:  (id, body)    => req('PUT', `/titles/${id}`, { body }),
      remove:  (id)          => req('DELETE', `/titles/${id}`),
      holders: (id)          => req('GET', `/titles/${id}/holders`),
    };
    this.automations = {
      list:      ()          => req('GET', '/automations'),
      create:    (body)      => req('POST', '/automations', { body }),
      update:    (id, body)  => req('PUT', `/automations/${id}`, { body }),
      toggle:    (id, on)    => req('PATCH', `/automations/${id}`, { body: { on } }),
      remove:    (id)        => req('DELETE', `/automations/${id}`),
      test:      (id)        => req('POST', `/automations/${id}/test`),
      templates: ()          => req('GET', '/automations/templates'),
      logs:      (query)     => req('GET', '/automation-logs', { query }),
      clearLogs: ()          => req('DELETE', '/automation-logs'),
    };
    this.insights = {
      summary:            ()      => req('GET', '/insights/summary'),
      trend:              (months)=> req('GET', '/insights/trend', { query: { months } }),
      gradeDistribution:  ()      => req('GET', '/insights/grade-distribution'),
      pareto:             ()      => req('GET', '/insights/pareto'),
      churn:              (days)  => req('GET', '/insights/churn', { query: { days } }),
      upgradeCandidates:  (within)=> req('GET', '/insights/upgrade-candidates', { query: { within } }),
      anniversaries:      (within)=> req('GET', '/insights/anniversaries', { query: { within } }),
    };
    this.settings = {
      get:    ()      => req('GET', '/settings'),
      update: (body)  => req('PUT', '/settings', { body }),
    };
    this.schedules = {
      list:   (status) => req('GET', '/schedules', { query: status ? { status } : undefined }),
      create: (body)   => req('POST', '/schedules', { body }),
      update: (id, body) => req('PUT', `/schedules/${id}`, { body }),
      remove: (id)     => req('DELETE', `/schedules/${id}`),
      remind: (id)     => req('POST', `/schedules/${id}/remind`),
      icsUrl: ()       => `${this.a.baseUrl || ''}/schedules/export.ics`, // 브라우저에서 직접 열기/다운로드
    };
    this.broadcasts = {
      start:    () => req('POST', '/broadcasts/start'),    // login 트리거 자동화 발동
      prestart: () => req('POST', '/broadcasts/prestart'), // 방송 예정(사전) 알림 자동화 발동
    };
    this.webhooks = {
      donation: (body) => req('POST', '/webhooks/donation', { body }),
      login:    (body) => req('POST', '/webhooks/login', { body }),
    };
  }
}

export default ApiClient;
