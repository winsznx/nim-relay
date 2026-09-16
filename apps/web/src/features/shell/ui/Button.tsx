import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from 'react'
import { linkProps } from '../router'

type Variant = 'primary' | 'secondary' | 'quiet' | 'danger'
type Size = 'sm' | 'md' | 'lg'

interface Look {
  variant?: Variant | undefined
  size?: Size | undefined
  block?: boolean | undefined
}

function className(look: Look, extra?: string): string {
  return ['nr-button', `nr-button--${look.variant ?? 'secondary'}`, look.size && look.size !== 'md' ? `nr-button--${look.size}` : '', look.block ? 'nr-button--block' : '', extra ?? '']
    .filter(Boolean)
    .join(' ')
}

export interface ButtonProps extends Look, ButtonHTMLAttributes<HTMLButtonElement> {
  /** Shows progress and blocks repeat presses while an action runs. */
  busy?: boolean
  children: ReactNode
}

export function Button({ variant, size, block, busy = false, className: extra, children, disabled, type = 'button', ...rest }: ButtonProps) {
  return (
    <button {...rest} type={type} className={className({ variant, size, block }, extra)} disabled={disabled || busy} aria-busy={busy || undefined}>
      {busy && <span className="nr-button__spinner" aria-hidden="true" />}
      {children}
    </button>
  )
}

export interface LinkButtonProps extends Look, Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> {
  to: string
  children: ReactNode
}

/** A link styled as a button that navigates in-app and still opens normally in a new tab. */
export function LinkButton({ variant, size, block, to, className: extra, children, ...rest }: LinkButtonProps) {
  return (
    <a {...rest} {...linkProps(to)} className={className({ variant, size, block }, extra)}>
      {children}
    </a>
  )
}

/** Plain external link styled as a button, for Nimiq Pay deep links and explorers. */
export function ExternalButton({ variant, size, block, href, className: extra, children, ...rest }: Look & AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; children: ReactNode }) {
  return (
    <a {...rest} href={href} className={className({ variant, size, block }, extra)}>
      {children}
    </a>
  )
}
