import { Component, type ReactNode } from 'react'

interface TourBoundaryProps {
  onError(error: unknown): void
  children: ReactNode
}

/** A tour that fails to render disappears and hands the error to the controller, which closes the tour. */
export class TourBoundary extends Component<TourBoundaryProps, { failed: boolean }> {
  override state = { failed: false }

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }

  override componentDidCatch(error: unknown): void {
    this.props.onError(error)
  }

  override render(): ReactNode {
    return this.state.failed ? null : this.props.children
  }
}
