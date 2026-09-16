import type { ReactNode } from 'react'
import { useAction } from '../../shell/use-action'
import { Button, type ButtonProps } from '../../shell/ui/Button'
import { Icon } from '../../shell/ui/Icon'
import type { ShareCard } from './layout'
import { shareCard } from './share'

interface ShareCardButtonProps extends Pick<ButtonProps, 'variant' | 'size' | 'block'> {
  card: ShareCard
  children: ReactNode
}

/** Draws and shares a card. The card's data must already be loaded, so the share sheet opens inside the tap. */
export function ShareCardButton({ card, children, variant = 'secondary', size, block }: ShareCardButtonProps) {
  const action = useAction()
  return (
    <Button variant={variant} size={size} block={block} busy={action.pending} onClick={() => action.run(() => shareCard(card))}>
      <Icon name="share" size={18} />
      {children}
    </Button>
  )
}
