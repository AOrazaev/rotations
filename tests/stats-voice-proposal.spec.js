const { test, expect } = require('@playwright/test');

test.describe.configure({ mode: 'serial' });

async function openVoiceTracker(page) {
  const databaseName = `basketball-stats-voice-${Date.now()}-${Math.random()}`;
  await page.addInitScript(name => {
    window.__STATS_DATABASE_NAME__ = name;
    window.__statsFakePlayer = {
      current: 42.4,
      getCurrentSeconds() { return this.current; },
      seekTo(seconds) { this.current = seconds; },
      play() {},
      pause() {},
      destroy() {}
    };
    window.__STATS_PLAYER_FACTORY__ = async () => window.__statsFakePlayer;
    window.__voiceRequests = [];
    window.__voiceCommandCount = 0;
    window.__microphoneRequestCount = 0;
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
        }
      });
    };
    window.__STATS_MEDIA_DEVICES__ = {
      async getUserMedia() {
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
}

async function connectVoiceCompanion(page) {
  await page.locator('.voice-connection-settings > summary').click();
  await page.locator('#voiceCompanionToken').fill('test-token');
  await page.locator('#voiceConnect').click();
  await expect(page.locator('#voiceConnectionStatus')).toContainText('Connected');
}

test('records and edits a voice proposal without writing game events', async ({ page }) => {
  await openVoiceTracker(page);
  await connectVoiceCompanion(page);

  await page.locator('#voiceStartRecording').click();
  await expect(page.locator('#voiceRecordingStatus')).toContainText('Recording at 0:42.4');
  await expect(page.locator('#voiceStartRecording')).toBeDisabled();
  await page.evaluate(() => { window.__statsFakePlayer.current = 99; });
  await page.locator('#voiceStopRecording').click();

  await expect(page.locator('#voiceRecordingStatus')).toContainText('2 proposed events');
  await expect(page.locator('#voiceTranscript')).toHaveValue('Seven assist and thirteen makes two');
  await expect(page.locator('.voice-proposal-event')).toHaveCount(2);
  await expect(page.locator('#voiceCapturedTimestamp')).toHaveText('0:42.4');
  expect((await page.evaluate(() => window.__voiceRequests[0].capturedSeconds))).toBe(42.4);

  await page.locator('.voice-proposal-event').first().locator('[data-voice-field="type"]').selectOption('steal');
  await expect(page.locator('.voice-proposal-event').first().locator('[data-voice-field="type"]')).toHaveValue('steal');
  await page.locator('#voiceReplaceTimestamp').click();
  await expect(page.locator('#voiceCapturedTimestamp')).toHaveText('1:39.0');

  const game = await page.evaluate(() => window.__statsApp.eventController.getGame());
  const stored = await page.evaluate(async () => (await window.__statsApp.store.listGames())[0]);
  expect(game.events).toEqual([]);
  expect(stored.events).toEqual([]);
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
  await page.locator('.voice-connection-settings > summary').click();
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
  await page.locator('.voice-connection-settings > summary').click();
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
