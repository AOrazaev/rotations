export class VoiceCompanionClientError extends Error {
  constructor(message, {
    code = 'request_failed',
    status = null,
    stage = null,
    partialResult = null,
    cause = null
  } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'VoiceCompanionClientError';
    this.code = code;
    this.status = status;
    this.stage = stage;
    this.partialResult = partialResult;
  }
}

export function normalizeLoopbackUrl(value) {
  let url;
  try {
    url = new URL(String(value || '').trim());
  } catch {
    throw new VoiceCompanionClientError('Enter a valid companion URL.', {
      code: 'invalid_url'
    });
  }
  if (url.protocol !== 'http:'
    || !['127.0.0.1', 'localhost'].includes(url.hostname)
    || url.username
    || url.password
    || !url.port
    || !['', '/'].includes(url.pathname)
    || url.search
    || url.hash) {
    throw new VoiceCompanionClientError(
      'The companion URL must be an HTTP loopback origin such as http://127.0.0.1:8766.',
      { code: 'invalid_url' }
    );
  }
  return url.origin;
}

export class VoiceCompanionClient {
  constructor({
    baseUrl,
    token,
    fetchFn = globalThis.fetch
  }) {
    this.baseUrl = normalizeLoopbackUrl(baseUrl);
    this.token = String(token || '');
    if (typeof fetchFn !== 'function') {
      throw new VoiceCompanionClientError('Fetch is unavailable in this browser.', {
        code: 'fetch_unavailable'
      });
    }
    this.fetch = fetchFn.bind(globalThis);
  }

  async request(path, options = {}) {
    let response;
    try {
      response = await this.fetch(`${this.baseUrl}${path}`, {
        ...options,
        headers: {
          ...(this.token ? { 'X-Bask-Voice-Token': this.token } : {}),
          ...(options.headers || {})
        }
      });
    } catch (error) {
      throw new VoiceCompanionClientError(
        'Could not reach the local voice companion.',
        { code: 'companion_unavailable', cause: error }
      );
    }

    let payload;
    try {
      payload = await response.json();
    } catch (error) {
      throw new VoiceCompanionClientError(
        `The companion returned an unreadable HTTP ${response.status} response.`,
        {
          code: 'invalid_response',
          status: response.status,
          cause: error
        }
      );
    }
    if (!response.ok) {
      throw new VoiceCompanionClientError(
        payload.error?.message || `Companion request failed with HTTP ${response.status}.`,
        {
          code: payload.error?.code || 'request_failed',
          status: response.status,
          stage: payload.error?.stage || null,
          partialResult: payload.partialResult || null
        }
      );
    }
    return payload;
  }

  async check() {
    const [health, capabilities] = await Promise.all([
      this.request('/v1/health'),
      this.request('/v1/capabilities')
    ]);
    if (health.protocolVersion !== 1 || capabilities.protocolVersion !== 1) {
      throw new VoiceCompanionClientError(
        'The companion protocol is incompatible with this tracker.',
        { code: 'incompatible_protocol' }
      );
    }
    if (!capabilities.eventInterpretation) {
      throw new VoiceCompanionClientError(
        'The companion does not support event interpretation.',
        { code: 'interpretation_unavailable' }
      );
    }
    return { health, capabilities };
  }

  warmup() {
    return this.request('/v1/warmup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    });
  }

  voiceCommand({ audio, context }) {
    const form = new FormData();
    form.append(
      'context',
      new Blob([JSON.stringify(context)], { type: 'application/json' })
    );
    const extension = audio.type.includes('ogg') ? 'ogg' : 'webm';
    form.append('audio', audio, `voice-command.${extension}`);
    return this.request('/v1/voice-command', {
      method: 'POST',
      body: form
    });
  }

  cancel(requestId) {
    return this.request('/v1/cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestId })
    });
  }
}
