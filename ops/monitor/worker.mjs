export const MINUTE = 60_000, DAY = 24 * 60 * MINUTE;
export function problems(state, now) {
  return {
    api: (state.apiFailures ?? 0) >= 3,
    host: !state.heartbeatAt || now - state.heartbeatAt > 10 * MINUTE,
    backup: !state.snapshotAt || now - state.snapshotAt > DAY || Boolean(state.backupFailed),
  };
}
export function transition(state, signals, now, uuid = () => crypto.randomUUID()) {
  state.incidents ??= {}; state.outbox ??= [];
  for (const [kind, failing] of Object.entries(signals)) {
    const incident = state.incidents[kind];
    if (failing && !incident) {
      const id = uuid(); state.incidents[kind] = { id, openedAt: now };
      state.outbox.push({ id: `${id}-failure`, kind, recovery: false, createdAt: now });
    } else if (!failing && incident) {
      delete state.incidents[kind];
      const unsent = state.outbox.find(item => item.id === `${incident.id}-failure` && !item.firstAttemptAt);
      if (unsent) state.outbox = state.outbox.filter(item => item !== unsent);
      else state.outbox.push({ id: `${incident.id}-recovery`, kind, recovery: true, createdAt: now });
    }
  }
  return state;
}
export async function healthy(fetcher = fetch) {
  return (await probeHealth(fetcher)).ok;
}
export async function probeHealth(fetcher = fetch) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    // Cloudflare supports manual/follow; manual also rejects an unexpected redirect.
    const result = await fetcher('https://api.m8itwork.com/health', { signal: controller.signal, redirect: 'manual', headers: { 'user-agent': 'm8itwork-uptime/1.0', accept: 'application/json' } });
    if (!result.ok) return {ok:false,code:`HTTP_${result.status}`};
    const value = await result.json();
    return value.status === 'ok' && value.recovery === false ? {ok:true,code:'OK'} : {ok:false,code:'HEALTH_OR_RECOVERY'};
  } catch {
    return {ok:false,code:controller.signal.aborted?'TIMEOUT':'REQUEST_OR_RESPONSE_FAILED'};
  }
  finally {clearTimeout(timeout);}
}
async function authorized(request, secret) {
  if (!secret || secret.length < 32) return false;
  const input = request.headers.get('authorization') ?? '';
  if (input.length > 512) return false;
  const encode = new TextEncoder();
  const [a, b] = await Promise.all([input, `Bearer ${secret}`].map(value => crypto.subtle.digest('SHA-256', encode.encode(value))));
  let difference = 0;
  const left = new Uint8Array(a), right = new Uint8Array(b);
  for (let i = 0; i < left.length; i++) difference |= left[i] ^ right[i];
  return difference === 0;
}
const descriptions = { api: 'API or database health', host: 'Backup host heartbeat', backup: 'Encrypted backup freshness', probe: 'Controlled operating alert test' };
const actions = {
  api: 'Check Railway API/database service status and logs. Pause new collection if availability or consistency is uncertain.',
  host: 'Check that the Docker host is awake and online, and start the operations container if stopped.',
  backup: 'Check private operations logs, free disk space and the newest encrypted archive. Do not delete the last good copy.',
  probe: 'This is a controlled alert-delivery check; production availability has not been changed.',
};
export class Monitor {
  constructor(ctx, env) { this.ctx = ctx; this.env = env; this.queue = Promise.resolve(); }
  serialize(task) {
    const result = this.queue.then(task);
    this.queue = result.catch(() => {});
    return result;
  }
  fetch(request) { return this.serialize(() => this.handle(request)); }
  async handle(request) {
    const url = new URL(request.url);
    // Internal cron is unreachable through the public proxy.
    if (url.pathname === '/tick') { await this.tick(); return new Response('ok'); }
    if (!(await authorized(request, this.env.HEARTBEAT_TOKEN))) return new Response('Unauthorized', { status: 401 });
    const state = await this.ctx.storage.get('state') ?? {};
    if (request.method === 'POST' && url.pathname === '/heartbeat') {
      if (Number(request.headers.get('content-length') ?? 0) > 1024) return new Response('Too large', { status: 413 });
      const text = await request.text();
      if (text.length > 1024) return new Response('Too large', { status: 413 });
      let value; try { value = JSON.parse(text); } catch { return new Response('Invalid', { status: 400 }); }
      const now = Date.now();
      if (!value || typeof value.backupFailed !== 'boolean' ||
          !Number.isFinite(value.reportedAt) || value.reportedAt < now - 2 * MINUTE || value.reportedAt > now + MINUTE ||
          (value.snapshotAt !== null && (!Number.isFinite(value.snapshotAt) || value.snapshotAt <= 0 || value.snapshotAt > now + MINUTE)))
        return new Response('Invalid', { status: 400 });
      if (value.reportedAt <= (state.reportedAt ?? 0)) return new Response('Superseded');
      state.reportedAt = value.reportedAt;
      state.heartbeatAt = now; state.snapshotAt = value.snapshotAt; state.backupFailed = value.backupFailed;
      await this.ctx.storage.put('state', state);
      return new Response('ok');
    }
    if (request.method === 'GET' && url.pathname === '/status') return Response.json({
      heartbeatAt: state.heartbeatAt ?? null, snapshotAt: state.snapshotAt ?? null,
      lastHealthCheckAt: state.lastHealthCheckAt ?? null, apiFailures: state.apiFailures ?? 0,
      apiCode: state.apiCode ?? null,
      incidents: state.incidents ?? {}, pendingAlerts: state.outbox?.length ?? 0,
      uncertainAlerts: state.uncertain ?? [], alertsEnabled: this.env.ALERTS_ENABLED === 'true',
    });
    if (request.method === 'POST' && url.pathname === '/probe') {
      if (this.env.ALERTS_ENABLED !== 'true') return new Response('Alerts disabled', { status: 409 });
      // Safe fixed alert pair; never changes production health or fetch destination.
      state.outbox ??= [];
      const id = crypto.randomUUID(), createdAt = Date.now();
      state.outbox.push({id:`${id}-failure`,kind:'probe',recovery:false,createdAt},
        {id:`${id}-recovery`,kind:'probe',recovery:true,createdAt});
      await this.ctx.storage.put('state', state); return new Response('Queued');
    }
    return new Response('Not found', { status: 404 });
  }
  async tick() {
    const state = await this.ctx.storage.get('state') ?? {}, now = Date.now();
    const probe = await probeHealth();
    state.apiCode = probe.code;
    state.apiFailures = probe.ok ? 0 : (state.apiFailures ?? 0) + 1;
    state.lastHealthCheckAt = Date.now();
    transition(state, problems(state, now), now);
    await this.ctx.storage.put('state', state);
    if (this.env.ALERTS_ENABLED !== 'true') return;
    for (const item of [...state.outbox].slice(0, 2)) {
      // Provider idempotency expires after 24h. Ambiguous attempts need inspection.
      if (item.firstAttemptAt && now - item.firstAttemptAt > 23 * 60 * MINUTE) {
        state.uncertain ??= []; state.uncertain.push(item.id);
        state.outbox = state.outbox.filter(entry => entry.id !== item.id);
        await this.ctx.storage.put('state', state); continue;
      }
      item.firstAttemptAt ??= now;
      item.payload ??= { from: this.env.ALERT_FROM, to: [this.env.ALERT_TO],
        subject: `m8itwork: ${descriptions[item.kind]} ${item.recovery ? 'recovered' : 'needs attention'}`,
        text: `${descriptions[item.kind]} ${item.recovery ? 'has recovered' : 'needs attention'}. ${actions[item.kind]} Follow docs/OPERATING_ACCEPTANCE.md for protected independent status. No customer data is included in this alert.`,
      };
      await this.ctx.storage.put('state', state);
      try {
        const result = await fetch('https://api.resend.com/emails', { method: 'POST',
          signal: AbortSignal.timeout(10_000), headers: { authorization: `Bearer ${this.env.RESEND_API_KEY}`,
            'content-type': 'application/json', 'idempotency-key': `m8-ops-${item.id}` }, body: JSON.stringify(item.payload),
        });
        if (!result.ok || typeof (await result.json()).id !== 'string') break;
        state.outbox = state.outbox.filter(entry => entry.id !== item.id);
        await this.ctx.storage.put('state', state);
      } catch { break; }
    }
  }
}
export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (!['/heartbeat', '/status', '/probe'].includes(path)) return new Response('Not found', { status: 404 });
    return env.MONITOR.get(env.MONITOR.idFromName('production')).fetch(request);
  },
  async scheduled(_controller, env) {
    await env.MONITOR.get(env.MONITOR.idFromName('production')).fetch('https://internal/tick');
  },
};
