import { createRoot, type Root } from 'react-dom/client'
import type { ContentScriptContext } from 'wxt/utils/content-script-context'
import { createShadowRootUi } from 'wxt/utils/content-script-ui/shadow-root'
import { logger as rootLogger } from '@/shared/logging'
import { CommandPalette, type CommandPaletteProps } from './CommandPalette'
import './CommandPalette.css'

const logger = rootLogger.child({ scope: "commandPalette.mount" })

export interface CommandPaletteUi {
  mount: () => void
  remove: () => void
  render: (props: CommandPaletteProps) => void
}

export const mountCommandPaletteUi = async (
  ctx: ContentScriptContext,
): Promise<CommandPaletteUi> => {
  let props: CommandPaletteProps | null = null
  let root: Root | null = null
  const ui = await createShadowRootUi<Root>(ctx, {
    name: 'mergelens-command-palette',
    // Keep the host in normal document flow. WXT's modal wrapper itself is
    // full-screen even when React renders a closed palette.
    position: 'inline',
    isolateEvents: ['click', 'keydown'],
    onMount: (container) => {
      root = createRoot(container)
      if (props) {
        root.render(<CommandPalette {...props} />)
      }
      logger.info('Mounted command palette Shadow UI')
      return root
    },
    onRemove: (mountedRoot) => {
      mountedRoot?.unmount()
      root = null
      logger.info('Removed command palette Shadow UI')
    },
  })

  return {
    mount: () => ui.mount(),
    remove: () => ui.remove(),
    render: (nextProps) => {
      props = nextProps
      root?.render(<CommandPalette {...nextProps} />)
      logger.debug('Rendered command palette state', {
        isOpen: nextProps.isOpen,
      })
    },
  }
}
