const { test, expect } = require('@playwright/test');

test.describe.configure({ mode: 'serial' });

test('real companion client invokes browser fetch with the correct receiver', async ({ page }) => {
  await page.goto('/stats/');
  const result = await page.evaluate(async () => {
    const {
      VoiceCompanionClient
    } = await import(
      './js/voice-companion-client.js'
    );
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

async function openVoiceTracker(page) {
  const databaseName = `basketball-stats-voice-${Date.now()}-${Math.random()}`;
  await page.addInitScript(name => {
    window.__STATS_DATABASE_NAME__ = name;
    window.__statsFakePlayer = {
      current: 42.4,
      playing: false,
      playCount: 0,
      pauseCount: 0,
      getCurrentSeconds() { return this.current; },
      seekTo(seconds) { this.current = seconds; },
      isPlaying() { return this.playing; },
      play() {
        this.playing = true;
        this.playCount += 1;
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
    window.__microphoneRequestCount = 0;
    window.__evaluationSamples = [];
    window.__voiceTestMode = 'success';
    window.__STATS_VOICE_CLIENT_FACTORY__ = options => {
      window.__voiceClientOptions = structuredClone(options);
      return ({
        baseUrl: options.baseUrl,
        async check() {
          if (window.__voiceTestMode === 'unavailable') {
            throw new Error('Could not reach the local voice companion.');
          }
          if (window.__voiceTestMode === 'incompatible') {
            throw new Error('The companion protocol is incompatible with this tracker.');
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
          if (window.__voiceTestMode === 'cancel-once'
            && window.__voiceCommandCount === 1) {
            return new Promise((resolve, reject) => {
              window.__rejectVoiceRequest = reject;
            });
          }
          if (window.__voiceTestMode === 'invalid') {
            return {
              protocolVersion: 1,
              requestId: context.requestId,
              transcript: 'Unknown player scores',
              events: [{
                side: 'team',
                type: 'shot',
                playerId: 'missing-player',
                shotValue: 2,
                made: true,
                confidence: 0.9
              }],
              warnings: []
            };
          }
          if (window.__voiceTestMode === 'partial-error') {
            throw Object.assign(new Error('Interpretation failed.'), {
              code: 'interpretation_failed',
              partialResult: { transcript: 'Seven assist' }
            });
          }
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
          const sample = {
            sampleId: `sample-${window.__evaluationSamples.length + 1}`,
            createdAt: new Date().toISOString(),
            originalTranscript: metadata.originalTranscript,
            correctedTranscript: metadata.correctedTranscript,
            outcome: metadata.outcome
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
      });
    };
    window.__STATS_MEDIA_DEVICES__ = {
      async enumerateDevices() {
        return [
          {
            kind: 'audioinput',
            deviceId: 'test-microphone',
            label: 'Test microphone'
          }
        ];
      },
      async getUserMedia(constraints) {
        window.__lastAudioConstraints = structuredClone(constraints);
        window.__microphoneRequestCount += 1;
        if (window.__voiceTestMode === 'microphone-denied') {
          throw new Error('Permission denied');
        }
        return {
          getTracks() {
            return [{ stop() {} }];
          }
        };
      }
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
  }, databaseName);

  await page.goto('/stats/');
  await page.waitForFunction(() => window.__statsApp?.setupController);
  await page.evaluate(() => window.__statsApp.setupController.ready);
  await page.locator('#gameTitle').fill('Voice proposal test');
  await page.locator('#opponentName').fill('Falcons');
  await page.locator('#gameVideoUrl').fill('https://youtu.be/M7lc1UVf-VE');
  await page.locator('#saveGame').click();
  await expect(page.locator('#eventLockMessage')).toBeHidden();
  await page.waitForFunction(() => Boolean(
    window.__statsApp?.eventController?.getGame()
  ));
}

async function connectVoiceCompanion(page) {
  await page.locator('#voiceConnectionSettings > summary').click();
  await page.locator('#voiceCompanionToken').fill('test-token');
  await page.locator('#voiceConnect').click();
  await expect(page.locator('#voiceConnectionStatus')).toContainText('Connected');
}

test('records and edits a voice proposal without writing game events', async ({ page }) => {
  await openVoiceTracker(page);
  await connectVoiceCompanion(page);
  await page.evaluate(() => { window.__statsFakePlayer.playing = true; });

  await page.locator('#voiceStartRecording').click();
  await expect(page.locator('#voiceRecordingStatus')).toContainText('Recording at 0:42.4');
  await expect(page.locator('#voiceStartRecording')).toBeDisabled();
  expect(await page.evaluate(() => window.__statsFakePlayer.playing)).toBe(true);
  expect(await page.evaluate(() => window.__statsFakePlayer.pauseCount)).toBe(0);
  await page.evaluate(() => { window.__statsFakePlayer.current = 99; });
  await page.locator('#voiceStopRecording').click();

  await expect(page.locator('#voiceRecordingStatus')).toContainText('2 proposed events');
  expect(await page.evaluate(() => window.__statsFakePlayer.playing)).toBe(true);
  expect(await page.evaluate(() => window.__statsFakePlayer.playCount)).toBe(0);
  await expect(page.locator('#voiceRecordingPreview')).toBeVisible();
  await expect(page.locator('#voiceTranscript')).toHaveValue('Seven assist and thirteen makes two');
  await expect(page.locator('.voice-proposal-event')).toHaveCount(2);
  await expect(page.locator('#voiceCapturedTimestamp')).toHaveText('0:42.4');
  expect((await page.evaluate(() => window.__voiceRequests[0].capturedSeconds))).toBe(42.4);
  expect(await page.evaluate(
    () => window.__voiceRequests[0].audioChannelPreference
  )).toBe('auto');
  expect(await page.evaluate(() => window.__lastAudioConstraints.audio)).toEqual({
    channelCount: 1,
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false
  });
  expect(await page.evaluate(() => window.__recorderOptions.audioBitsPerSecond)).toBe(
    128000
  );

  await page.locator('.voice-proposal-event').first().locator('[data-voice-field="type"]').selectOption('steal');
  await expect(page.locator('.voice-proposal-event').first().locator('[data-voice-field="type"]')).toHaveValue('steal');
  await page.locator('#voiceReplaceTimestamp').click();
  await expect(page.locator('#voiceCapturedTimestamp')).toHaveText('1:39.0');
  await page.locator('#voiceExpectedTranscript').fill(
    'Seven steal and thirteen makes two'
  );
  await page.locator('#voiceSaveEvaluation').click();
  await expect(page.locator('#voiceEvaluationStatus')).toContainText(
    'Saved evaluation sample'
  );
  await expect(page.locator('.voice-evaluation-item')).toHaveCount(1);

  const game = await page.evaluate(() => window.__statsApp.eventController.getGame());
  const stored = await page.evaluate(async () => (await window.__statsApp.store.listGames())[0]);
  const sample = await page.evaluate(() => window.__evaluationSamples[0]);
  expect(game.events).toEqual([]);
  expect(stored.events).toEqual([]);
  expect(sample.audioSize).toBeGreaterThan(0);
  expect(sample.metadata.originalTranscript).toBe(
    'Seven assist and thirteen makes two'
  );
  expect(sample.metadata.correctedTranscript).toBe(
    'Seven steal and thirteen makes two'
  );
  expect(sample.metadata.correctedEvents[0].type).toBe('steal');
  expect(sample.metadata.outcome).toBe('corrected');
});

test('confirms a multi-event proposal atomically and undoes the full batch', async ({ page }) => {
  await openVoiceTracker(page);
  await connectVoiceCompanion(page);

  await page.locator('#currentLineup .player-select-button').first().click();
  await page.locator('[data-event-type="assist"]').click();
  await expect.poll(async () => (
    await page.evaluate(() => window.__statsApp.eventController.getGame().events.length)
  )).toBe(1);

  await page.locator('#voiceStartRecording').click();
  await page.locator('#voiceStopRecording').click();
  await expect(page.locator('#voiceRecordingStatus')).toContainText('2 proposed events');
  await expect(page.locator('#voiceConfirmProposal')).toBeEnabled();

  await page.locator('#voiceConfirmProposal').click();
  await expect(page.locator('#voiceRecordingStatus')).toContainText(
    '2 voice events added'
  );
  await expect(page.locator('.event-list-item.voice-added-event')).toHaveCount(2);
  await expect(page.locator('#teamScore')).toHaveText('2');
  await expect(page.locator('#teamFieldGoals')).toHaveText('1/1');
  await expect(page.locator('#voiceUndoBatch')).toBeEnabled();
  await expect(
    page.locator('.voice-proposal-event select').first()
  ).toBeDisabled();

  const committed = await page.evaluate(async () => ({
    game: window.__statsApp.eventController.getGame(),
    stored: (await window.__statsApp.store.listGames())[0]
  }));
  expect(committed.game.events).toHaveLength(3);
  expect(committed.stored.events).toEqual(committed.game.events);
  expect(committed.game.events.map(event => event.sequence)).toEqual([1, 2, 3]);
  expect(committed.game.events.map(event => event.videoSeconds)).toEqual([
    42.4,
    42.4,
    42.4
  ]);
  expect(committed.game.events.slice(1).map(event => event.type)).toEqual([
    'assist',
    'shot'
  ]);
  expect(committed.game.events.slice(1).every(
    event => event.lineupIds.length === 5
  )).toBe(true);

  await page.locator('#voiceUndoBatch').click();
  await expect(page.locator('#voiceRecordingStatus')).toContainText(
    'Voice batch undone'
  );
  await expect(page.locator('.event-list-item.voice-added-event')).toHaveCount(0);
  await expect(page.locator('#teamScore')).toHaveText('0');

  const undone = await page.evaluate(async () => ({
    game: window.__statsApp.eventController.getGame(),
    stored: (await window.__statsApp.store.listGames())[0]
  }));
  expect(undone.game.events).toHaveLength(1);
  expect(undone.game.events[0].type).toBe('assist');
  expect(undone.stored.events).toEqual(undone.game.events);
});

test('rejects stale proposals after the game changes', async ({ page }) => {
  await openVoiceTracker(page);
  await connectVoiceCompanion(page);

  await page.locator('#voiceStartRecording').click();
  await page.locator('#voiceStopRecording').click();
  await expect(page.locator('#voiceRecordingStatus')).toContainText('2 proposed events');

  await page.locator('#currentLineup .player-select-button').first().click();
  await page.locator('[data-event-type="assist"]').click();
  await expect.poll(async () => (
    await page.evaluate(() => window.__statsApp.eventController.getGame().events.length)
  )).toBe(1);

  await page.locator('#voiceConfirmProposal').click();
  await expect(page.locator('#voiceRecordingStatus')).toContainText(
    'game changed after this proposal'
  );
  await expect(page.locator('#voiceRetryProcessing')).toBeEnabled();

  const game = await page.evaluate(() => window.__statsApp.eventController.getGame());
  expect(game.events).toHaveLength(1);
  expect(game.events[0].type).toBe('assist');
});

test('the normal undo control also removes the latest voice batch together', async ({ page }) => {
  await openVoiceTracker(page);
  await connectVoiceCompanion(page);

  await page.locator('#voiceStartRecording').click();
  await page.locator('#voiceStopRecording').click();
  await expect(page.locator('#voiceRecordingStatus')).toContainText('2 proposed events');
  await page.locator('#voiceConfirmProposal').click();
  await expect(page.locator('#voiceRecordingStatus')).toContainText(
    '2 voice events added'
  );

  await page.locator('#undoEvent').click();
  await expect.poll(async () => (
    await page.evaluate(() => window.__statsApp.eventController.getGame().events.length)
  )).toBe(0);
  await expect(page.locator('#voiceRecordingStatus')).toContainText(
    'Voice batch undone'
  );
  await expect(page.locator('#voiceUndoBatch')).toBeDisabled();
  const stored = await page.evaluate(async () => (
    await window.__statsApp.store.listGames()
  )[0]);
  expect(stored.events).toEqual([]);
});

test('keeps the full proposal out of memory and storage when saving fails', async ({ page }) => {
  await openVoiceTracker(page);
  await connectVoiceCompanion(page);

  await page.locator('#voiceStartRecording').click();
  await page.locator('#voiceStopRecording').click();
  await expect(page.locator('#voiceRecordingStatus')).toContainText('2 proposed events');
  await page.evaluate(() => {
    window.__originalVoiceSaveGame = window.__statsApp.store.saveGame;
    window.__statsApp.store.saveGame = async () => {
      throw new Error('Simulated voice storage failure.');
    };
  });

  await page.locator('#voiceConfirmProposal').click();
  await expect(page.locator('#voiceRecordingStatus')).toContainText(
    'Simulated voice storage failure'
  );
  await expect(page.locator('#voiceConfirmProposal')).toBeEnabled();

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
  await page.locator('#voiceConfirmProposal').click();
  await expect(page.locator('#voiceRecordingStatus')).toContainText(
    '2 voice events added'
  );
});

test('rejects the whole batch when an edited proposal event is invalid', async ({ page }) => {
  await openVoiceTracker(page);
  await connectVoiceCompanion(page);

  await page.locator('#voiceStartRecording').click();
  await page.locator('#voiceStopRecording').click();
  await expect(page.locator('#voiceRecordingStatus')).toContainText('2 proposed events');
  await page.locator('.voice-proposal-event').first()
    .locator('[data-voice-field="playerId"]')
    .selectOption('');

  await page.locator('#voiceConfirmProposal').click();
  await expect(page.locator('#voiceRecordingStatus')).toContainText(
    'player who is not on court'
  );

  const result = await page.evaluate(async () => ({
    game: window.__statsApp.eventController.getGame(),
    stored: (await window.__statsApp.store.listGames())[0]
  }));
  expect(result.game.events).toEqual([]);
  expect(result.stored.events).toEqual([]);
});

test('prevents overlapping recordings and reports microphone permission failures', async ({ page }) => {
  await openVoiceTracker(page);
  await connectVoiceCompanion(page);

  await page.locator('#voiceStartRecording').click();
  await expect(page.locator('#voiceStartRecording')).toBeDisabled();
  expect(await page.evaluate(() => window.__microphoneRequestCount)).toBe(1);
  await page.locator('#voiceStopRecording').click();
  await expect(page.locator('#voiceRecordingStatus')).toContainText('2 proposed events');

  await page.locator('#voiceDiscardProposal').click();
  await page.evaluate(() => { window.__voiceTestMode = 'microphone-denied'; });
  await page.locator('#voiceStartRecording').click();
  await expect(page.locator('#voiceRecordingStatus')).toContainText(
    'Could not start recording: Permission denied'
  );
  await expect(page.locator('#voiceStartRecording')).toBeEnabled();
});

test('optionally pauses and resumes video around recording', async ({ page }) => {
  await openVoiceTracker(page);
  await connectVoiceCompanion(page);
  await page.locator('#voiceOpenAudioSettings').click();
  await expect(page.locator('#voiceAudioSettingsDialog')).toHaveAttribute('open', '');
  await page.locator('#voiceAudioProcessing').selectOption('processed');
  await page.locator('#voiceChannelPreference').selectOption('right');
  await page.locator('#voicePauseVideoDuringRecording').check();
  await page.locator('#voiceCloseAudioSettings').click();
  await page.evaluate(() => { window.__statsFakePlayer.playing = true; });

  await page.locator('#voiceStartRecording').click();
  expect(await page.evaluate(() => window.__statsFakePlayer.playing)).toBe(false);
  expect(await page.evaluate(() => window.__statsFakePlayer.pauseCount)).toBe(1);
  expect(await page.evaluate(() => window.__lastAudioConstraints.audio)).toEqual({
    channelCount: 1,
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true
  });

  await page.locator('#voiceStopRecording').click();
  await expect(page.locator('#voiceRecordingStatus')).toContainText('2 proposed events');
  expect(await page.evaluate(() => window.__statsFakePlayer.playing)).toBe(true);
  expect(await page.evaluate(() => window.__statsFakePlayer.playCount)).toBe(1);
  expect(await page.evaluate(() => localStorage.getItem(
    'basketball-stats-voice-pause-video'
  ))).toBe('true');
  expect(await page.evaluate(() => localStorage.getItem(
    'basketball-stats-voice-audio-processing'
  ))).toBe('processed');
  expect(await page.evaluate(
    () => window.__voiceRequests[0].audioChannelPreference
  )).toBe('right');
  expect(await page.evaluate(() => localStorage.getItem(
    'basketball-stats-voice-channel-preference'
  ))).toBe('right');
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

test('cancels processing, keeps audio for retry, and disables discard while active', async ({ page }) => {
  await openVoiceTracker(page);
  await connectVoiceCompanion(page);
  await page.evaluate(() => { window.__voiceTestMode = 'cancel-once'; });

  await page.locator('#voiceStartRecording').click();
  await page.locator('#voiceStopRecording').click();
  await expect(page.locator('#voiceRecordingStatus')).toContainText('Transcribing');
  await expect(page.locator('#voiceDiscardProposal')).toBeDisabled();
  await page.locator('#voiceCancelProcessing').click();
  await expect(page.locator('#voiceRecordingStatus')).toContainText('Processing cancelled');
  await expect(page.locator('#voiceRetryProcessing')).toBeEnabled();

  await page.locator('#voiceRetryProcessing').click();
  await expect(page.locator('#voiceRecordingStatus')).toContainText('2 proposed events');
  expect(await page.evaluate(() => window.__voiceCommandCount)).toBe(2);
});

test('shows partial transcripts and rejects invalid companion proposals', async ({ page }) => {
  await openVoiceTracker(page);
  await connectVoiceCompanion(page);
  await page.evaluate(() => { window.__voiceTestMode = 'partial-error'; });

  await page.locator('#voiceStartRecording').click();
  await page.locator('#voiceStopRecording').click();
  await expect(page.locator('#voiceRecordingStatus')).toContainText('Interpretation failed');
  await expect(page.locator('#voiceTranscript')).toHaveValue('Seven assist');

  await page.evaluate(() => { window.__voiceTestMode = 'invalid'; });
  await page.locator('#voiceRetryProcessing').click();
  await expect(page.locator('#voiceRecordingStatus')).toContainText(
    'does not reference a current game player'
  );
  await expect(page.locator('.voice-proposal-event')).toHaveCount(0);

  const game = await page.evaluate(() => window.__statsApp.eventController.getGame());
  expect(game.events).toEqual([]);
});

test('reports unavailable and incompatible companions without breaking tracking', async ({ page }) => {
  await openVoiceTracker(page);
  await page.locator('#voiceConnectionSettings > summary').click();
  await page.locator('#voiceCompanionToken').fill('test-token');

  await page.evaluate(() => { window.__voiceTestMode = 'unavailable'; });
  await page.locator('#voiceConnect').click();
  await expect(page.locator('#voiceConnectionStatus')).toContainText(
    'Could not reach the local voice companion'
  );
  await expect(page.locator('#voiceStartRecording')).toBeDisabled();

  await page.evaluate(() => { window.__voiceTestMode = 'incompatible'; });
  await page.locator('#voiceConnect').click();
  await expect(page.locator('#voiceConnectionStatus')).toContainText(
    'protocol is incompatible'
  );
  await expect(page.locator('#eventEntryPanel')).toBeVisible();
  await expect(page.locator('[data-event-type="assist"]')).toBeEnabled();
});

test('connects without a token when the companion advertises tokenless mode', async ({ page }) => {
  await openVoiceTracker(page);
  await page.evaluate(() => { window.__voiceTestMode = 'tokenless'; });
  await page.locator('#voiceConnectionSettings > summary').click();
  await page.locator('#voiceConnect').click();

  await expect(page.locator('#voiceConnectionStatus')).toContainText(
    'tokenless local mode'
  );
  expect(await page.evaluate(() => window.__voiceClientOptions.token)).toBe('');
  await expect(page.locator('#voiceStartRecording')).toBeEnabled();
});

test('review mode removes the voice mutation surface', async ({ page }) => {
  await openVoiceTracker(page);
  const gameId = await page.evaluate(() => window.__statsApp.eventController.getGame().id);
  await page.goto(`/stats/?mode=review&game=${encodeURIComponent(gameId)}`);
  await expect(page.locator('#voiceCapturePanel')).toHaveCount(0);
});
