import path from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';

const executablePath = String(process.env.SAWA_INSTALLER_UI_EXE || '').trim();

test('l assistant d installation empaquete affiche bien la version 5.0.1', async () => {
  test.skip(!executablePath, 'Definir SAWA_INSTALLER_UI_EXE pour tester l assistant empaquete.');
  let application = null;
  try {
    application = await electron.launch({ executablePath: path.resolve(executablePath) });
    const page = await application.firstWindow();
    await expect(page.locator('.nsis-window')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/Sawa Manga Library/i).first()).toBeVisible();
    await expect(page.getByText(/v\s*5\.0\.1/i).first()).toBeVisible();
    await expect(page.getByRole('button', { name: /Suivant/i })).toBeEnabled();
  } finally {
    await application?.close().catch(() => {});
  }
});
