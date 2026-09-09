/** Desktop layout regression: opening the right panel must not make Harness enter narrow mode. */
import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { PAGE_URL, createHostApi, hostRpc } from './host'

const WORKSPACE_PATH = process.env.DSH_E2E_DESKTOP_WORKSPACE
  ?? (process.env.DSH_E2E_WORKSPACE === undefined
    ? join(homedir(), 'dsh-e2e-desktop-layout-workspace')
    : `${process.env.DSH_E2E_WORKSPACE}-desktop-layout`)

let api: APIRequestContext

async function dismissOnboarding(page: Page): Promise<void> {
  await expect
    .poll(() => page.getByRole('button', { name: /^(Continue|Configure later|继续|稍后配置)$/ }).count(), { timeout: 60_000 })
    .toBeGreaterThan(0)
  for (let round = 0; round < 8; round++) {
    let dismissed = false
    for (const name of [/^(Continue|继续)$/, /^(Configure later|稍后配置)$/]) {
      const button = page.getByRole('button', { name }).first()
      if ((await button.count()) === 0) continue
      await button.click()
      dismissed = true
      await expect(button).toBeHidden()
    }
    if (!dismissed) return
  }
  throw new Error('onboarding takeovers did not settle after visible dismissal')
}

test.beforeAll(async () => {
  mkdirSync(WORKSPACE_PATH, { recursive: true })
  // Seed one workspace + one session through the host's own RPC surface (the
  // calls the UI makes) instead of driving the workspace picker: DSH 0.1.5
  // ships BOTH a browser directory dialog and an OS-native chooser and picks
  // one by platform, so a UI-driven flow only works on hosts whose chooser
  // renders in the page.
  api = await createHostApi()
  const workspace = await hostRpc<{ workspace: { workspaceId: string } }>(api, 'workspace.create', { path: WORKSPACE_PATH })
  await hostRpc(api, 'session.create', { workspaceId: workspace.value.workspace.workspaceId })
})

test.afterAll(async () => {
  await api?.dispose()
})

test('right panel keeps desktop session actions in their header positions', async ({ page }) => {
  const pageErrors: string[] = []
  const consoleErrors: string[] = []
  const requestFailures: string[] = []
  const badResponses: string[] = []
  page.on('pageerror', error => pageErrors.push(error.stack ?? error.message))
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()) })
  page.on('requestfailed', request => requestFailures.push(`${request.method()} ${request.url()} ${request.failure()?.errorText ?? 'unknown'}`))
  page.on('response', response => { if (response.status() >= 400) badResponses.push(`${response.status()} ${response.url()}`) })

  await page.goto(PAGE_URL, { waitUntil: 'domcontentloaded' })
  await dismissOnboarding(page)

  // The seeded blank session opens with its workspace already attached (the
  // chip shows the workspace title), so the hero composer is live without
  // touching the workspace picker at all. One message gives the header its
  // real actions, which this spec measures.
  const composer = page.getByRole('textbox', { name: /^(Describe what you want to build|描述你想要构建)/ })
  await expect(composer).toBeVisible()
  // DSH 0.1.5's composer is a Lexical contenteditable: fill() writes the DOM
  // but not the editor model, so the send button would stay disabled — type
  // real keys instead.
  await composer.click()
  await page.keyboard.type('Create a desktop side-card layout test session.')
  const send = page.getByRole('button', { name: /^(Send message|发送消息)$/ })
  await expect(send).toBeEnabled({ timeout: 30_000 })
  await send.click()
  const sessionLog = page.getByRole('button', { name: 'Session log', exact: true })
  const sessionLogLabel = sessionLog.getByText('Session log', { exact: true })
  await expect(sessionLogLabel, 'the desktop session-log action starts as a text button').toBeVisible({ timeout: 30_000 })

  const root = page.locator('#root')
  const frame = page.locator('#root [data-dsh-frame], #root > [data-slot="root"] > div').first()
  const appSidebarExpanded = root.getByRole('button', { name: /^(Collapse sidebar|收起侧边栏)$/ })
  const sidebar = page.locator('[data-dsh-better-sidebar]')
  await expect(appSidebarExpanded, 'the desktop frame starts with its app sidebar expanded').toBeVisible()
  const beforeRoot = await root.boundingBox()
  const beforeFrame = await frame.boundingBox()
  expect(beforeRoot).not.toBeNull()
  expect(beforeFrame).not.toBeNull()
  // The header action's own width is the baseline: the assertion below is
  // "the panel does not squeeze it", not a host-styling constant.
  const beforeSessionLog = await sessionLog.boundingBox()
  expect(beforeSessionLog).not.toBeNull()

  await sidebar.getByRole('button', { name: /^(Expand sidebar|展开侧边栏)$/ }).click()
  const panel = page.locator('[data-dsh-panel]:not([data-dsh-bottom-panel])')
  await expect(panel).toBeVisible()
  await expect
    .poll(async () => {
      const center = page.locator('#root [data-dsh-frame] > [data-pane="conversation"], #root :has(> [data-slot="conversation"])').first()
      const [centerBox, panelBox] = await Promise.all([center.boundingBox(), panel.boundingBox()])
      if (centerBox === null || panelBox === null) return Number.POSITIVE_INFINITY
      return Math.abs(centerBox.x + centerBox.width - panelBox.x)
    }, { timeout: 30_000 })
    .toBeLessThanOrEqual(2)

  const afterRoot = await root.boundingBox()
  const afterFrame = await frame.boundingBox()
  expect(afterRoot).not.toBeNull()
  expect(afterFrame).not.toBeNull()
  expect(Math.abs(afterRoot!.width - beforeRoot!.width), 'opening the plugin panel must not shrink #root').toBeLessThanOrEqual(1)
  expect(Math.abs(afterFrame!.width - beforeFrame!.width), 'opening the plugin panel must not shrink AppFrame').toBeLessThanOrEqual(1)
  await expect(appSidebarExpanded, 'a desktop window must not enter the host narrow layout').toBeVisible()
  await expect(sessionLogLabel, 'the session-log action must keep its desktop label').toBeVisible()
  expect(await sessionLog.evaluate(element => getComputedStyle(element).position), 'the session-log action must stay in the header flow').not.toBe('fixed')

  const [sessionLogBox, panelBox] = await Promise.all([sessionLog.boundingBox(), panel.boundingBox()])
  expect(sessionLogBox).not.toBeNull()
  expect(panelBox).not.toBeNull()
  expect(
    sessionLogBox!.width,
    'the desktop session-log action must keep its full button width',
  ).toBeGreaterThanOrEqual(beforeSessionLog!.width - 1)
  expect(sessionLogBox!.x + sessionLogBox!.width, 'the session-log action must not overlap the plugin panel chrome').toBeLessThanOrEqual(panelBox!.x - 8)
  expect(pageErrors).toEqual([])
  expect(consoleErrors).toEqual([])
  expect(requestFailures).toEqual([])
  expect(badResponses).toEqual([])
})
