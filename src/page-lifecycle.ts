import {
  CreateStartUpPageContainer,
  RebuildPageContainer,
  StartUpPageCreateResult,
  formatEvenHubPageContainerValidationError,
  validateEvenHubPageContainer,
} from '@evenrealities/even_hub_sdk'
import type { EvenAppBridge } from '@evenrealities/even_hub_sdk'

type PageBridge = Pick<EvenAppBridge, 'createStartUpPageContainer' | 'rebuildPageContainer'>

export async function initializePage(bridge: PageBridge, page: CreateStartUpPageContainer) {
  const validation = validateEvenHubPageContainer(page)
  if (!validation.valid) throw new Error(formatEvenHubPageContainerValidationError(validation))

  const result = await bridge.createStartUpPageContainer(page)
  if (result === StartUpPageCreateResult.success) return 'created'
  if (result !== StartUpPageCreateResult.invalid) {
    throw new Error(`Failed to create startup page: ${result}`)
  }

  // The host can retain the page across a Prototype-mode rescan or WebView
  // reload. Creation is one-shot; try rebuilding once, without hiding failures.
  console.warn('[page-startup] Create returned 1; attempting to rebuild the page')
  const rebuilt = await bridge.rebuildPageContainer(new RebuildPageContainer(page))
  if (!rebuilt) {
    throw new Error('Failed to create or restore startup page (create: 1, rebuild: false). Exit Prototype mode completely and reconnect G2.')
  }
  return 'rebuilt'
}
