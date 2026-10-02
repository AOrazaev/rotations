const { test, expect } = require('@playwright/test');

test('workbench checks service and processes an audio file', async ({ page }) => {
  await page.goto('/');
  await page.locator('#token').fill('checkpoint-zero-token');
  await page.locator('#checkConnection').click();

  await expect(page.locator('#connectionResult')).toContainText('"status": "ready"');
  await expect(page.locator('#connectionResult')).toContainText('"eventInterpretation": true');
  await expect(page.locator('#serviceStatus')).toHaveText('ready');
  await expect(page.locator('#protocolStatus')).toHaveText('v1');
  await expect(page.locator('#transcriptionStatus')).toHaveText('fixture');
  await expect(page.locator('#interpretationStatus')).toHaveText('fixture');

  await page.locator('#videoSeconds').fill('42.5');
  await page.locator('#audioFile').setInputFiles({
    name: 'sample.webm',
    mimeType: 'audio/webm',
    buffer: Buffer.from('fixture audio')
  });
  await page.locator('#processFile').click();

  await expect(page.locator('#requestResult')).toContainText(
    'Seven assist and thirteen makes two in transition'
  );
  await expect(page.locator('#requestResult')).toContainText('"type": "shot"');
  await expect(page.locator('#requestResult')).toContainText('"profile": "spike"');
  await expect(page.locator('#proposalResult')).toContainText('team shot');

  await page.locator('#interpretTranscript').click();
  await expect(page.locator('#requestResult')).toContainText(
    '"commandModel": "fixture"'
  );
  await expect(page.locator('#proposalResult')).toContainText('player p13');
});
