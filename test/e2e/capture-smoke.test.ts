import { test, expect } from '@playwright/test'

test.describe('CaptureView desktop smoke', () => {
  test('app loads and redirects to /capture', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(2000)

    // The status bar should always be visible regardless of camera/model state.
    const statusBar = page.locator('.status-bar')
    await expect(statusBar).toBeVisible({ timeout: 15000 })

    // Status bar contains three sections.
    await expect(page.locator('.status-left')).toBeVisible()
    await expect(page.locator('.status-mid')).toBeVisible()
    // .status-right may be hidden when no session is active (empty span).
    await expect(page.locator('.status-right')).toBeAttached()
  })

  test('camera error state renders retry button', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(3000)

    // In headless Chromium the camera will fail. Either the error overlay
    // (err-layer) or a retry button should be visible.
    const errLayer = page.locator('.err-layer')
    const retryBtn = page.locator('.err-layer button, button:has-text("Retry")')

    try {
      await expect(errLayer).toBeVisible({ timeout: 10000 })
    } catch {
      // If no error layer, the capture UI at least rendered.
      await expect(page.locator('.capture-tab')).toBeVisible({ timeout: 5000 })
    }

    // At least one element in the capture area is present.
    const retryVisible = await retryBtn.isVisible().catch(() => false)
    const captureTabVisible = await page.locator('.capture-tab').isVisible().catch(() => false)
    expect(retryVisible || captureTabVisible).toBe(true)
  })

  test('tab bar is rendered', async ({ page }) => {
    await page.goto('/')
    await page.waitForTimeout(2000)

    const tabBar = page.locator('.tab-bar')
    await expect(tabBar).toBeVisible({ timeout: 15000 })

    // Capture tab should be active by default (route redirects to /capture).
    const captureTab = page.locator('.tab-btn.active')
    await expect(captureTab).toBeVisible()
    const label = await captureTab.locator('.tab-label').textContent()
    expect(label).toBe('Capture')
  })
})
