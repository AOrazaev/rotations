const { test, expect } = require('@playwright/test');

test.describe.configure({ mode: 'serial' });

test('real companion client invokes browser fetch with the correct receiver', async ({ page }) => {
  await page.goto('/stats/');
  const result = await page.evaluate(async () => {
    const { VoiceCompanionClient } = await import('./js/voice-companion-client.js');
    const calls = [];
    const fetchFn = function (url) {
      if (this !== window) throw new TypeError('Illegal invocation');
      calls.push(url);
      const body = url.endsWith('/v1/health')
        ? { protocolVersion: 1, status: 'ready' }
        : {
            protocolVersion: 1,
            eventInterpretation: true,
            security: { tokenRequired: false }
          };
      return Promise.resolve(new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      }));
    };
    const client = new VoiceCompanionClient({
      baseUrl: 'http://127.0.0.1:8766',
      token: '',
      fetchFn
    });
    const response = await client.check();
    return { calls, response };
  });

  expect(result.calls).toEqual([
    'http://127.0.0.1:8766/v1/health',
    'http://127.0.0.1:8766/v1/capabilities'
  ]);
  expect(result.response.capabilities.security.tokenRequired).toBe(false);
});

async function openVoiceTracker(page, { mode = 'success' } = {}) {
  const databaseName = `basketball-stats-voice-${Date.now()}-${Math.random()}`;
  await page.addInitScript(({ name, initialMode }) => {
    window.__STATS_DATABASE_NAME__ = name;
    window.__statsFakePlayer = {
      current: 42.4,
      playing: false,
      playCount: 0,
      pauseCount: 0,
      calls: [],
      getCurrentSeconds() { return this.current; },
      seekTo(seconds) {
        this.current = seconds;
        this.calls.push(['seek', seconds]);
      },
      isPlaying() { return this.playing; },
      play() {
        this.playing = true;
        this.playCount += 1;
        this.calls.push(['play']);
      },
      pause() {
        this.playing = false;
        this.pauseCount += 1;
      },
      destroy() {}
    };
    window.__STATS_PLAYER_FACTORY__ = async () => window.__statsFakePlayer;
    window.__voiceRequests = [];
    window.__voiceCommandCount = 0;
    window.__voiceCheckCount = 0;
    window.__microphoneRequestCount = 0;
    window.__microphoneEnumerateCount = 0;
    window.__trackStopCount = 0;
    window.__evaluationSamples = [];
    window.__evaluationSaveShouldFail = false;
    window.__voiceTestMode = initialMode;
    window.__activeVoiceObjectUrls = new Set();
    const createObjectUrl = URL.createObjectURL.bind(URL);
    const revokeObjectUrl = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = blob => {
      const url = createObjectUrl(blob);
      window.__activeVoiceObjectUrls.add(url);
      return url;
    };
    URL.revokeObjectURL = url => {
      window.__activeVoiceObjectUrls.delete(url);
      revokeObjectUrl(url);
    };
    window.__documentHidden = false;
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      get: () => window.__documentHidden
    });

    function successPayload(context) {
      return {
        protocolVersion: 1,
        requestId: context.requestId,
        transcript: 'Seven assist and thirteen makes two',
        events: [
          {
            side: 'team',
            type: 'assist',
            playerId: context.currentLineupIds[0],
            confidence: 0.95
          },
          {
            side: 'team',
            type: 'shot',
            playerId: context.currentLineupIds[1],
            shotValue: 2,
            made: true,
            confidence: 0.98
          }
        ],
        overallConfidence: 0.95,
        warnings: [],
        processor: {
          transcriptionModel: 'base.en',
          commandModel: 'Qwen3-4B-Q4_K_M.gguf',
          profile: 'balanced'
        },
        timingMs: { transcription: 10, interpretation: 15, total: 25 }
      };
    }

    window.__STATS_VOICE_CLIENT_FACTORY__ = options => {
      window.__voiceClientOptions = structuredClone(options);
      return {
        baseUrl: options.baseUrl,
        async check() {
          window.__voiceCheckCount += 1;
          if (window.__voiceTestMode === 'unavailable') {
            throw Object.assign(
              new Error('Could not reach the local voice companion.'),
              { code: 'companion_unavailable' }
            );
          }
          if (window.__voiceTestMode === 'incompatible') {
            throw Object.assign(
              new Error('The companion protocol is incompatible with this tracker.'),
              { code: 'incompatible_protocol' }
            );
          }
          return {
            health: { protocolVersion: 1, status: 'ready' },
            capabilities: {
              protocolVersion: 1,
              eventInterpretation: true,
              transcriptionModel: 'base.en',
              commandModel: 'Qwen3-4B-Q4_K_M.gguf',
              security: {
                loopbackOnly: true,
                tokenRequired: window.__voiceTestMode !== 'tokenless',
                originValidation: true
              }
            }
          };
        },
        async warmup() {
          return { timingMs: { total: 25 } };
        },
        async voiceCommand({ context }) {
          window.__voiceCommandCount += 1;
          window.__voiceRequests.push(structuredClone(context));
          if (window.__voiceTestMode === 'hold-first'
            && window.__voiceCommandCount === 1) {
            return new Promise((resolve, reject) => {
              window.__resolveHeldVoice = () => resolve(successPayload(context));
              window.__rejectVoiceRequest = reject;
            });
          }
          if (window.__voiceTestMode === 'cancel-once'
            && window.__voiceCommandCount === 1) {
            return new Promise((resolve, reject) => {
              window.__rejectVoiceRequest = reject;
            });
          }
          if (window.__voiceTestMode === 'invalid') {
            return {
              ...successPayload(context),
              transcript: 'Unknown player scores',
              events: [{
                side: 'team',
                type: 'shot',
                playerId: 'missing-player',
                shotValue: 2,
                made: true,
                confidence: 0.9
              }]
            };
          }
          if (window.__voiceTestMode === 'timeout') {
            return {
              ...successPayload(context),
              transcript: 'Opponent timeout.',
              events: [{
                side: 'opponent',
                type: 'timeout',
                playerId: null,
                confidence: 0.99
              }]
            };
          }
          if (window.__voiceTestMode === 'substitution') {
            const activeIds = new Set(context.currentLineupIds);
            const outgoing = context.roster.find(player => activeIds.has(player.id));
            const incoming = context.roster.find(player => !activeIds.has(player.id));
            return {
              ...successPayload(context),
              transcript: `Number ${incoming.jersey} subs for ${outgoing.jersey}.`,
              events: [{
                side: 'team',
                type: 'substitution',
                playerId: null,
                playerInId: incoming.id,
                playerOutId: outgoing.id,
                confidence: 0.99
              }]
            };
          }
          if (window.__voiceTestMode === 'partial-error') {
            throw Object.assign(new Error('Interpretation failed.'), {
              code: 'interpretation_failed',
              partialResult: { transcript: 'Seven assist' }
            });
          }
          if (window.__voiceTestMode === 'disconnect-once') {
            window.__voiceTestMode = 'success';
            throw Object.assign(
              new Error('Could not reach the local voice companion.'),
              { code: 'companion_unavailable' }
            );
          }
          return successPayload(context);
        },
        async cancel() {
          window.__rejectVoiceRequest?.(Object.assign(
            new Error('Request cancelled.'),
            { code: 'request_cancelled' }
          ));
          window.__rejectVoiceRequest = null;
          return { status: 'cancellation_requested' };
        },
        async saveEvaluationSample({ audio, metadata }) {
          if (window.__evaluationSaveShouldFail) {
            throw new Error('Simulated evaluation storage failure.');
          }
          const sample = {
            sampleId: `sample-${window.__evaluationSamples.length + 1}`,
            createdAt: new Date().toISOString(),
            originalTranscript: metadata.originalTranscript,
            correctedTranscript: metadata.correctedTranscript,
            outcome: metadata.outcome,
            collectionSource: metadata.collectionSource
          };
          window.__evaluationSamples.unshift({
            ...structuredClone(sample),
            metadata: structuredClone(metadata),
            audioSize: audio.size
          });
          return { sample };
        },
        async listEvaluationSamples() {
          return {
            samples: window.__evaluationSamples.map(({
              metadata,
              audioSize,
              ...sample
            }) => structuredClone(sample))
          };
        },
        async deleteEvaluationSample(sampleId) {
          window.__evaluationSamples = window.__evaluationSamples.filter(
            sample => sample.sampleId !== sampleId
          );
          return { sampleId, status: 'deleted' };
        },
        async exportEvaluationSample() {
          return new Blob(['evaluation-zip'], { type: 'application/zip' });
        }
      };
    };
    const mediaDeviceListeners = new Map();
    window.__STATS_MEDIA_DEVICES__ = {
      async enumerateDevices() {
        window.__microphoneEnumerateCount += 1;
        return [{
          kind: 'audioinput',
          deviceId: 'test-microphone',
          label: 'Test microphone'
        }];
      },
      async getUserMedia(constraints) {
        window.__lastAudioConstraints = structuredClone(constraints);
        window.__microphoneRequestCount += 1;
        if (window.__voiceTestMode === 'microphone-denied') {
          throw new Error('Permission denied');
        }
        const trackListeners = new Map();
        const track = {
          addEventListener(type, listener) {
            trackListeners.set(type, listener);
          },
          stop() {
            window.__trackStopCount += 1;
          }
        };
        window.__lastTrackEnd = () => trackListeners.get('ended')?.();
        return { getTracks: () => [track] };
      },
      addEventListener(type, listener) {
        mediaDeviceListeners.set(type, listener);
      },
      removeEventListener(type, listener) {
        if (mediaDeviceListeners.get(type) === listener) {
          mediaDeviceListeners.delete(type);
        }
      }
    };
    window.__dispatchMediaDeviceChange = () => {
      mediaDeviceListeners.get('devicechange')?.();
    };
    window.__STATS_MEDIA_RECORDER__ = class {
      static isTypeSupported() { return true; }
      constructor(stream, options) {
        this.stream = stream;
        this.mimeType = options?.mimeType || 'audio/webm';
        this.state = 'inactive';
        this.listeners = {};
        window.__recorderOptions = structuredClone(options);
      }
      addEventListener(type, listener) {
        this.listeners[type] = listener;
      }
      start() {
        this.state = 'recording';
      }
      stop() {
        this.state = 'inactive';
        this.listeners.dataavailable?.({
          data: new Blob(['voice'], { type: this.mimeType })
        });
        this.listeners.stop?.();
      }
    };
  }, { name: databaseName, initialMode: mode });

  await page.goto('/stats/');
  await page.waitForFunction(() => window.__statsApp?.setupController);
  await page.evaluate(() => window.__statsApp.setupController.ready);
  await page.locator('#gameTitle').fill('Voice proposal test');
  await page.locator('#opponentName').fill('Falcons');
  await page.locator('#gameVideoUrl').fill('https://youtu.be/M7lc1UVf-VE');
  await page.locator('#addSetupPlayer').click();
  await page.locator('.setup-name').last().fill('Bench player');
  await page.locator('.setup-number').last().fill('99');
  await page.locator('#saveGame').click();
  await expect(page.locator('#eventLockMessage')).toBeHidden();
  await page.waitForFunction(() => Boolean(
    window.__statsApp?.eventController?.getGame()
  ));
}

async function waitForConnection(page) {
  await expect.poll(async () => page.evaluate(
    () => window.__statsApp.voiceController.getState().connected
  )).toBe(true);
}

async function recordCommand(page) {
  const before = await page.evaluate(
    () => window.__statsApp.voiceController.getState().jobs.length
  );
  await page.locator('#voiceRecordToggle').click();
  await expect(page.locator('#voiceRecordLabel')).toContainText('Stop');
  await page.locator('#voiceRecordToggle').click();
  await expect.poll(async () => page.evaluate(
    () => window.__statsApp.voiceController.getState().jobs.length
  )).toBe(before + 1);
}

async function waitForDrafts(page, count) {
  await expect(page.locator('.voice-command-draft')).toHaveCount(count);
}

test('uses one compact microphone control and keeps drafts out of game storage', async ({ page }) => {
  await openVoiceTracker(page);
  await waitForConnection(page);
  await expect(page.locator('#voiceSettingsDialog')).not.toHaveAttribute('open', '');
  await expect(page.locator('#voiceRecordToggle')).toBeVisible();
  await expect(page.locator('.voice-command-status-row')).toBeHidden();

  await recordCommand(page);
  await expect(page.locator('.voice-command-status-row')).toBeVisible();
  await waitForDrafts(page, 1);
  const draft = page.locator('.voice-command-draft');
  await expect(draft.locator('.voice-proposal-event')).toHaveCount(2);
  await expect(draft.locator('.voice-command-details')).not.toHaveAttribute('open', '');
  await expect(draft.locator('.voice-command-event-summary-item')).toHaveCount(2);
  await expect(draft.locator('.voice-command-event-summary')).toContainText('assist');
  await expect(draft.locator('.voice-command-event-summary')).toContainText('made 2PT');
  await expect(draft.locator('[data-voice-action="confirm"]')).toHaveText('Accept');
  await expect(draft.locator('.voice-proposal-event').first()).not.toBeVisible();
  await expect(draft).toContainText('Seven assist and thirteen makes two');
  await page.evaluate(() => { window.__statsFakePlayer.calls = []; });
  await draft.locator('.voice-command-time').click();
  expect(await page.evaluate(() => window.__statsFakePlayer.calls)).toEqual([
    ['seek', 39.4],
    ['play']
  ]);
  expect(await page.evaluate(() => window.__voiceRequests[0].capturedSeconds)).toBe(42.4);
  expect(await page.evaluate(
    () => window.__voiceRequests[0].audioChannelPreference
  )).toBe('auto');

  await draft.locator('.voice-command-details > summary').click();
  await expect(draft.locator('.voice-proposal-event').first()).toBeVisible();
  await draft.locator('[data-voice-field="type"]').first().selectOption('steal');
  await expect(draft.locator('[data-voice-action="replace-timestamp"]')).toBeVisible();
  await page.evaluate(() => { window.__statsFakePlayer.current = 99; });
  await draft.locator('[data-voice-action="replace-timestamp"]').click();
  await expect(draft.locator('.voice-command-time')).toHaveText('1:39.0');
  await draft.locator('[data-voice-field="expectedTranscript"]').fill(
    'Seven steal and thirteen makes two'
  );
  await draft.locator('[data-voice-action="save-evaluation"]').click();
  await expect(draft).toContainText('Saved evaluation sample');

  const result = await page.evaluate(async () => ({
    game: window.__statsApp.eventController.getGame(),
    stored: (await window.__statsApp.store.listGames())[0],
    sample: window.__evaluationSamples[0]
  }));
  expect(result.game.events).toEqual([]);
  expect(result.stored.events).toEqual([]);
  expect(result.sample.metadata.correctedEvents[0].type).toBe('steal');
  expect(result.sample.metadata.correctedTranscript).toBe(
    'Seven steal and thirteen makes two'
  );
});

test('records another command while the first processes and sends requests sequentially', async ({ page }) => {
  await openVoiceTracker(page, { mode: 'hold-first' });
  await waitForConnection(page);

  await recordCommand(page);
  await expect(page.locator('.voice-command-processing')).toHaveCount(1);
  await page.evaluate(() => { window.__statsFakePlayer.calls = []; });
  await page.locator('.voice-command-processing .voice-command-time').click();
  expect(await page.evaluate(() => window.__statsFakePlayer.calls)).toEqual([
    ['seek', 39.4],
    ['play']
  ]);
  await page.evaluate(() => {
    window.__statsFakePlayer.current = 42.4;
    window.__statsFakePlayer.playing = false;
  });
  await recordCommand(page);
  await expect(page.locator('.voice-command-processing')).toHaveCount(1);
  await expect(page.locator('.voice-command-queued')).toHaveCount(1);
  expect(await page.evaluate(() => window.__voiceCommandCount)).toBe(1);
  await expect(page.locator('#voiceRecordToggle')).toBeEnabled();

  await page.evaluate(() => window.__resolveHeldVoice());
  await waitForDrafts(page, 2);
  expect(await page.evaluate(() => window.__voiceCommandCount)).toBe(2);
});

test('rerecords a draft in place while preserving its original timestamp', async ({ page }) => {
  await openVoiceTracker(page);
  await waitForConnection(page);
  await recordCommand(page);
  await waitForDrafts(page, 1);

  const draft = page.locator('.voice-command-draft');
  const original = await page.evaluate(
    () => window.__statsApp.voiceController.getState().jobs[0]
  );
  await draft.locator('.voice-command-details > summary').click();
  await page.evaluate(() => { window.__statsFakePlayer.current = 88; });
  await draft.locator('[data-voice-action="rerecord"]').click();
  await expect(page.locator('.voice-command-rerecording')).toHaveCount(1);
  await expect(page.locator('#voiceRecordLabel')).toContainText('Stop');
  expect(await page.evaluate(
    () => window.__statsApp.voiceController.getState().jobs.length
  )).toBe(1);

  await page.locator(
    '.voice-command-rerecording [data-voice-action="stop-rerecord"]'
  ).click();
  await waitForDrafts(page, 1);
  const rerecorded = await page.evaluate(
    () => window.__statsApp.voiceController.getState().jobs[0]
  );
  expect(rerecorded.id).toBe(original.id);
  expect(rerecorded.capturedSeconds).toBe(42.4);
  expect(rerecorded.audioUrl).not.toBe(original.audioUrl);
  expect(await page.evaluate(() => window.__voiceRequests[1].capturedSeconds)).toBe(42.4);
  await expect(page.locator('.voice-command-draft .voice-command-time')).toHaveText('0:42.4');
});

test('accepts an opponent timeout as a playerless voice event', async ({ page }) => {
  await openVoiceTracker(page, { mode: 'timeout' });
  await waitForConnection(page);
  await recordCommand(page);
  await waitForDrafts(page, 1);

  const draft = page.locator('.voice-command-draft');
  await expect(draft.locator('.voice-command-event-summary')).toContainText(
    'Opponent timeout'
  );
  expect(await page.evaluate(
    () => window.__voiceRequests[0].allowedEventTypes.includes('timeout')
  )).toBe(true);
  await draft.locator('[data-voice-action="confirm"]').click();
  await expect.poll(async () => page.evaluate(
    () => window.__statsApp.eventController.getGame().events.length
  )).toBe(1);

  const events = await page.evaluate(
    () => window.__statsApp.eventController.getGame().events
  );
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({
    side: 'opponent',
    type: 'timeout',
    playerId: null
  });
});

test('accepts a substitution-only command and rebuilds the lineup', async ({ page }) => {
  await openVoiceTracker(page, { mode: 'substitution' });
  await waitForConnection(page);
  await recordCommand(page);
  await waitForDrafts(page, 1);

  const request = await page.evaluate(() => window.__voiceRequests[0]);
  const activeIds = new Set(request.currentLineupIds);
  const outgoing = request.roster.find(player => activeIds.has(player.id));
  const incoming = request.roster.find(player => !activeIds.has(player.id));
  const playerLabel = player => player.jersey
    ? `#${player.jersey} ${player.name}`
    : player.name;
  const draft = page.locator('.voice-command-draft');
  await expect(draft.locator('.voice-command-event-summary')).toContainText(
    `${playerLabel(incoming)} in for ${playerLabel(outgoing)}`
  );
  expect(request.allowedEventTypes).toContain('substitution');

  await draft.locator('.voice-command-details > summary').click();
  await expect(draft.locator('[data-voice-field="playerOutId"]')).toHaveValue(
    outgoing.id
  );
  await expect(draft.locator('[data-voice-field="playerInId"]')).toHaveValue(
    incoming.id
  );
  await draft.locator('[data-voice-action="confirm"]').click();
  await expect.poll(async () => page.evaluate(
    () => window.__statsApp.eventController.getGame().events.length
  )).toBe(1);

  const game = await page.evaluate(
    () => window.__statsApp.eventController.getGame()
  );
  expect(game.events).toHaveLength(1);
  expect(game.events[0]).toMatchObject({
    side: 'team',
    type: 'substitution',
    playerId: null,
    playerInId: incoming.id,
    playerOutId: outgoing.id
  });
  expect(game.events[0].lineupIds).toContain(incoming.id);
  expect(game.events[0].lineupIds).not.toContain(outgoing.id);

  await page.locator('#voiceUndoLatestBatch').click();
  await expect.poll(async () => page.evaluate(
    () => window.__statsApp.eventController.getGame().events.length
  )).toBe(0);
  const restoredLineup = await page.evaluate(async seconds => {
    const { getLineupAtEventPosition } = await import(
      '/stats/js/game-model.js'
    );
    return getLineupAtEventPosition(
      window.__statsApp.eventController.getGame(),
      seconds
    );
  }, request.capturedSeconds);
  expect(restoredLineup).toEqual(request.currentLineupIds);
});

test('confirms completed drafts independently and preserves atomic batch undo', async ({ page }) => {
  await openVoiceTracker(page, { mode: 'hold-first' });
  await waitForConnection(page);
  await recordCommand(page);
  await recordCommand(page);
  await page.evaluate(() => window.__resolveHeldVoice());
  await waitForDrafts(page, 2);

  const jobIds = await page.evaluate(
    () => window.__statsApp.voiceController.getState().jobs.map(job => job.id)
  );
  const secondDraft = page.locator(`[data-voice-command-id="${jobIds[1]}"]`);
  await secondDraft.locator('[data-voice-action="confirm"]').click();
  await expect(secondDraft).toHaveCount(0);
  await expect(page.locator('.voice-command-draft')).toHaveCount(1);
  await expect(page.locator('.event-list-item.voice-added-event')).toHaveCount(2);
  await expect(page.locator('#teamScore')).toHaveText('2');

  const committed = await page.evaluate(async () => ({
    game: window.__statsApp.eventController.getGame(),
    stored: (await window.__statsApp.store.listGames())[0]
  }));
  expect(committed.game.events).toHaveLength(2);
  expect(committed.stored.events).toEqual(committed.game.events);

  await page.locator('#voiceUndoLatestBatch').click();
  await expect(page.locator('#teamScore')).toHaveText('0');
  expect(await page.evaluate(
    () => window.__statsApp.eventController.getGame().events.length
  )).toBe(0);
  await expect(page.locator('.voice-command-draft')).toHaveCount(1);
});

test('allows unrelated manual events before confirming a queued draft', async ({ page }) => {
  await openVoiceTracker(page);
  await waitForConnection(page);
  await recordCommand(page);
  await waitForDrafts(page, 1);

  await page.locator('#currentLineup .player-select-button').first().click();
  await page.locator('[data-event-type="assist"]').click();
  await expect.poll(async () => page.evaluate(
    () => window.__statsApp.eventController.getGame().events.length
  )).toBe(1);

  await page.locator('.voice-command-draft [data-voice-action="confirm"]').click();
  await expect.poll(async () => page.evaluate(
    () => window.__statsApp.eventController.getGame().events.length
  )).toBe(3);
  const game = await page.evaluate(() => window.__statsApp.eventController.getGame());
  expect(game.events).toHaveLength(3);
  expect(game.events.map(event => event.sequence)).toEqual([1, 2, 3]);
});

test('rejects confirmation when the lineup at the captured timestamp changes', async ({ page }) => {
  await openVoiceTracker(page);
  await waitForConnection(page);
  await recordCommand(page);
  await waitForDrafts(page, 1);

  await page.locator('#openSubstitution').click();
  await page.locator('#substitutionForm button[type="submit"]').click();
  await expect.poll(async () => page.evaluate(
    () => window.__statsApp.eventController.getGame().events.length
  )).toBe(1);

  const draft = page.locator('.voice-command-draft');
  await draft.locator('[data-voice-action="confirm"]').click();
  await expect(draft).toContainText('lineup at this command timestamp changed');
  expect(await page.evaluate(
    () => window.__statsApp.eventController.getGame().events.length
  )).toBe(1);
});

test('keeps every proposed event out of memory and storage when saving fails', async ({ page }) => {
  await openVoiceTracker(page);
  await waitForConnection(page);
  await recordCommand(page);
  await waitForDrafts(page, 1);
  await page.evaluate(() => {
    window.__originalVoiceSaveGame = window.__statsApp.store.saveGame;
    window.__statsApp.store.saveGame = async () => {
      throw new Error('Simulated voice storage failure.');
    };
  });

  const draft = page.locator('.voice-command-draft');
  await draft.locator('[data-voice-action="confirm"]').click();
  await expect(draft).toContainText('Simulated voice storage failure');
  const failed = await page.evaluate(async () => ({
    game: window.__statsApp.eventController.getGame(),
    stored: await window.__statsApp.store.getGame(
      window.__statsApp.eventController.getGame().id
    )
  }));
  expect(failed.game.events).toEqual([]);
  expect(failed.stored.events).toEqual([]);

  await page.evaluate(() => {
    window.__statsApp.store.saveGame = window.__originalVoiceSaveGame;
  });
  await draft.locator('[data-voice-action="confirm"]').click();
  await expect(draft).toHaveCount(0);
});

test('rejects the full batch when an edited draft event is invalid', async ({ page }) => {
  await openVoiceTracker(page);
  await waitForConnection(page);
  await recordCommand(page);
  await waitForDrafts(page, 1);

  const draft = page.locator('.voice-command-draft');
  await draft.locator('.voice-command-details > summary').click();
  await draft.locator('[data-voice-field="playerId"]').first().selectOption('');
  await draft.locator('[data-voice-action="confirm"]').click();
  await expect(draft).toContainText('player who is not on court');
  expect(await page.evaluate(
    () => window.__statsApp.eventController.getGame().events.length
  )).toBe(0);
});

test('moves connection and audio controls into the adjacent settings dialog', async ({ page }) => {
  await openVoiceTracker(page);
  await waitForConnection(page);
  await page.locator('#voiceOpenSettings').click();
  await expect(page.locator('#voiceSettingsDialog')).toHaveAttribute('open', '');
  await expect(page.locator('#voiceConnectionSettings')).toBeVisible();
  await expect(page.locator('#voiceDataCollection')).not.toBeChecked();

  await page.locator('#voiceAudioProcessing').selectOption('processed');
  await page.locator('#voiceChannelPreference').selectOption('right');
  await page.locator('#voicePauseVideoDuringRecording').check();
  await page.locator('#voiceCloseSettings').click();
  await page.evaluate(() => { window.__statsFakePlayer.playing = true; });

  await page.locator('#voiceRecordToggle').click();
  expect(await page.evaluate(() => window.__statsFakePlayer.playing)).toBe(false);
  expect(await page.evaluate(() => window.__lastAudioConstraints.audio)).toEqual({
    channelCount: 1,
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true
  });
  await page.locator('#voiceRecordToggle').click();
  await waitForDrafts(page, 1);
  expect(await page.evaluate(() => window.__statsFakePlayer.playing)).toBe(true);
  expect(await page.evaluate(
    () => window.__voiceRequests[0].audioChannelPreference
  )).toBe('right');
});

test('automatically saves accepted drafts only after local collection opt-in', async ({ page }) => {
  await openVoiceTracker(page);
  await waitForConnection(page);

  await recordCommand(page);
  await waitForDrafts(page, 1);
  await page.locator('.voice-command-draft [data-voice-action="confirm"]').click();
  await expect(page.locator('.voice-command-draft')).toHaveCount(0);
  expect(await page.evaluate(() => window.__evaluationSamples.length)).toBe(0);

  await page.locator('#voiceOpenSettings').click();
  await page.locator('#voiceDataCollection').check();
  expect(await page.evaluate(
    () => localStorage.getItem('basketball-stats-voice-data-collection')
  )).toBe('true');
  await page.locator('#voiceCloseSettings').click();

  await recordCommand(page);
  await waitForDrafts(page, 1);
  const draft = page.locator('.voice-command-draft');
  await draft.locator('.voice-command-details > summary').click();
  await draft.locator('[data-voice-field="type"]').first().selectOption('steal');
  await draft.locator('[data-voice-field="expectedTranscript"]').fill(
    'Seven steal and thirteen makes two'
  );
  await draft.locator('[data-voice-action="confirm"]').click();
  await expect(draft).toHaveCount(0);

  await expect.poll(
    async () => page.evaluate(() => window.__evaluationSamples.length)
  ).toBe(1);
  const sample = await page.evaluate(() => window.__evaluationSamples[0]);
  expect(sample.metadata.collectionSource).toBe('automatic_on_accept');
  expect(sample.metadata.outcome).toBe('corrected');
  expect(sample.metadata.correctedTranscript).toBe(
    'Seven steal and thirteen makes two'
  );
  expect(sample.metadata.correctedEvents[0].type).toBe('steal');
  await expect(page.locator('#voiceCommandStatus')).toContainText(
    'Recording saved locally as an evaluation candidate'
  );

  await page.reload();
  await expect(page.locator('#voiceDataCollection')).toBeChecked();
});

test('keeps accepted game events when automatic evaluation storage fails', async ({ page }) => {
  await openVoiceTracker(page);
  await waitForConnection(page);
  await page.locator('#voiceOpenSettings').click();
  await page.locator('#voiceDataCollection').check();
  await page.locator('#voiceCloseSettings').click();
  await page.evaluate(() => { window.__evaluationSaveShouldFail = true; });

  await recordCommand(page);
  await waitForDrafts(page, 1);
  await page.locator('.voice-command-draft [data-voice-action="confirm"]').click();
  await expect(page.locator('.voice-command-draft')).toHaveCount(0);
  await expect(page.locator('#voiceCommandStatus')).toContainText(
    'Evaluation sample was not saved: Simulated evaluation storage failure.'
  );
  expect(await page.evaluate(
    () => window.__statsApp.eventController.getGame().events.length
  )).toBe(2);
  expect(await page.evaluate(() => window.__evaluationSamples.length)).toBe(0);
});

test('cancels an active command and retries its retained recording', async ({ page }) => {
  await openVoiceTracker(page, { mode: 'cancel-once' });
  await waitForConnection(page);
  await recordCommand(page);
  await expect(page.locator('.voice-command-processing')).toHaveCount(1);
  await page.locator('.voice-command-processing [data-voice-action="cancel"]').click();
  await expect(page.locator('.voice-command-error')).toContainText('Processing cancelled');

  await page.evaluate(() => { window.__voiceTestMode = 'success'; });
  await page.locator('.voice-command-error [data-voice-action="retry"]').click();
  await waitForDrafts(page, 1);
  expect(await page.evaluate(() => window.__voiceCommandCount)).toBe(2);
});

test('reconnects after a request-time companion restart and retains audio for retry', async ({ page }) => {
  await openVoiceTracker(page, { mode: 'disconnect-once' });
  await waitForConnection(page);
  await recordCommand(page);
  await expect(page.locator('.voice-command-error')).toContainText(
    'Could not reach the local voice companion'
  );

  await expect.poll(async () => page.evaluate(
    () => window.__statsApp.voiceController.getState().connected
  )).toBe(true);
  expect(await page.evaluate(() => window.__voiceCheckCount)).toBeGreaterThan(1);

  await page.locator('.voice-command-error [data-voice-action="retry"]').click();
  await waitForDrafts(page, 1);
  expect(await page.evaluate(() => window.__voiceCommandCount)).toBe(2);
});

test('detects incompatible companion changes and reconnects after compatibility returns', async ({ page }) => {
  await openVoiceTracker(page);
  await waitForConnection(page);

  await page.evaluate(async () => {
    window.__voiceTestMode = 'incompatible';
    await window.__statsApp.voiceController.reconnect();
  });
  expect(await page.evaluate(
    () => window.__statsApp.voiceController.getState().connected
  )).toBe(false);
  await expect(page.locator('#voiceConnectionStatus')).toContainText(
    'incompatible'
  );

  await page.evaluate(async () => {
    window.__voiceTestMode = 'success';
    await window.__statsApp.voiceController.reconnect();
  });
  await waitForConnection(page);
});

test('stops recording when backgrounded and refreshes devices after hardware changes', async ({ page }) => {
  await openVoiceTracker(page);
  await waitForConnection(page);
  const enumerations = await page.evaluate(() => window.__microphoneEnumerateCount);

  await page.locator('#voiceRecordToggle').click();
  await expect(page.locator('#voiceRecordLabel')).toContainText('Stop');
  await page.evaluate(() => {
    window.__documentHidden = true;
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await waitForDrafts(page, 1);
  expect(await page.evaluate(() => window.__trackStopCount)).toBeGreaterThan(0);

  await page.evaluate(() => {
    window.__documentHidden = false;
    document.dispatchEvent(new Event('visibilitychange'));
    window.__dispatchMediaDeviceChange();
  });
  await expect.poll(async () => page.evaluate(
    () => window.__microphoneEnumerateCount
  )).toBeGreaterThan(enumerations);
});

test('discards an active recording when microphone access ends', async ({ page }) => {
  await openVoiceTracker(page);
  await waitForConnection(page);
  await page.locator('#voiceRecordToggle').click();
  await expect(page.locator('#voiceRecordLabel')).toContainText('Stop');

  await page.evaluate(() => window.__lastTrackEnd());
  await expect.poll(async () => page.evaluate(
    () => window.__statsApp.voiceController.getState().recording
  )).toBe(false);
  expect(await page.evaluate(
    () => window.__statsApp.voiceController.getState().jobs.length
  )).toBe(0);
  await expect(page.locator('#voiceCommandStatus')).toContainText(
    'Microphone access ended'
  );
});

test('cleans pending voice state on page exit', async ({ page }) => {
  await openVoiceTracker(page);
  await waitForConnection(page);
  await recordCommand(page);
  await waitForDrafts(page, 1);

  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  const state = await page.evaluate(
    () => window.__statsApp.voiceController.getState()
  );
  expect(state.connected).toBe(false);
  expect(state.recording).toBe(false);
  expect(state.jobs).toEqual([]);
});

test('releases tracks and audio URLs across repeated voice command cycles', async ({ page }) => {
  await openVoiceTracker(page);
  await waitForConnection(page);

  for (let index = 0; index < 5; index += 1) {
    await recordCommand(page);
    await waitForDrafts(page, 1);
    const beforeEvents = await page.evaluate(
      () => window.__statsApp.eventController.getGame().events.length
    );
    await page.locator(
      '.voice-command-draft [data-voice-action="confirm"]'
    ).click();
    await expect.poll(async () => page.evaluate(
      () => window.__statsApp.eventController.getGame().events.length
    )).toBe(beforeEvents + 2);
    await expect.poll(async () => page.evaluate(
      () => window.__statsApp.voiceController.getState().jobs.length
    )).toBe(0);
  }

  const resources = await page.evaluate(() => ({
    activeObjectUrls: window.__activeVoiceObjectUrls.size,
    trackStops: window.__trackStopCount,
    jobs: window.__statsApp.voiceController.getState().jobs.length
  }));
  expect(resources.activeObjectUrls).toBe(0);
  expect(resources.trackStops).toBeGreaterThanOrEqual(5);
  expect(resources.jobs).toBe(0);
});

test('keeps partial transcripts and rejects invalid companion proposals', async ({ page }) => {
  await openVoiceTracker(page, { mode: 'partial-error' });
  await waitForConnection(page);
  await recordCommand(page);
  await expect(page.locator('.voice-command-error')).toContainText('Interpretation failed');
  await expect(page.locator('.voice-command-error textarea').first()).toHaveValue('Seven assist');

  await page.evaluate(() => { window.__voiceTestMode = 'success'; });
  await page.locator('.voice-command-error .voice-command-details > summary').click();
  await page.locator('.voice-command-error [data-voice-action="rerecord"]').click();
  await expect(page.locator('.voice-command-rerecording')).toHaveCount(1);
  await page.locator(
    '.voice-command-rerecording [data-voice-action="stop-rerecord"]'
  ).click();
  await waitForDrafts(page, 1);

  await page.evaluate(() => { window.__voiceTestMode = 'invalid'; });
  await page.locator('.voice-command-draft [data-voice-action="retry"]').click();
  await expect(page.locator('.voice-command-error')).toContainText(
    'does not reference a current game player'
  );
  expect(await page.evaluate(
    () => window.__statsApp.eventController.getGame().events.length
  )).toBe(0);
});

test('opens actionable settings when the companion is unavailable', async ({ page }) => {
  await openVoiceTracker(page, { mode: 'unavailable' });
  await expect.poll(async () => page.evaluate(
    () => window.__statsApp.voiceController.getState().connected
  )).toBe(false);
  await expect(page.locator('#eventEntryPanel')).toBeVisible();
  await expect(page.locator('#voiceRecordToggle')).toBeEnabled();

  await page.locator('#voiceRecordToggle').click();
  await expect(page.locator('#voiceSettingsDialog')).toHaveAttribute('open', '');
  await expect(page.locator('#voiceConnectionStatus')).toContainText(
    'Could not reach the local voice companion'
  );
});

test('auto-connects without a token when tokenless mode is advertised', async ({ page }) => {
  await openVoiceTracker(page, { mode: 'tokenless' });
  await waitForConnection(page);
  await page.locator('#voiceOpenSettings').click();
  await expect(page.locator('#voiceConnectionStatus')).toContainText(
    'tokenless local mode'
  );
  expect(await page.evaluate(() => window.__voiceClientOptions.token)).toBe('');
});

test('classifies left, right, both, and silent channel previews', async ({ page }) => {
  await page.goto('/stats/');
  const results = await page.evaluate(async () => {
    const { classifyChannelActivity } = await import('./js/voice-capture.js');
    return [
      classifyChannelActivity(0.04, 0.00003),
      classifyChannelActivity(0.00003, 0.04),
      classifyChannelActivity(0.04, 0.02),
      classifyChannelActivity(0.0001, 0.0002)
    ];
  });
  expect(results).toEqual([
    'Left channel active',
    'Right channel active',
    'Both channels active',
    'No clear input'
  ]);
});

test('review mode removes every voice mutation and settings surface', async ({ page }) => {
  await openVoiceTracker(page);
  const gameId = await page.evaluate(
    () => window.__statsApp.eventController.getGame().id
  );
  await page.goto(`/stats/?mode=review&game=${encodeURIComponent(gameId)}`);
  await expect(page.locator('#voiceCompactControls')).toHaveCount(0);
  await expect(page.locator('#voiceSettingsDialog')).toHaveCount(0);
});
