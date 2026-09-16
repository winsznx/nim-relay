import { LinkButton } from '../shell/ui/Button'
import { EmptyState } from '../shell/ui/primitives'
import { Screen } from '../shell/ui/Screen'

export function NotFoundScreen({ entryKey }: { entryKey: string }) {
  return (
    <Screen title="Page not found" entryKey={entryKey}>
      <EmptyState title="This page isn’t part of the relay" body="The link may be mistyped or from an older version of NIM Relay. Live relays are one tap away.">
        <LinkButton variant="primary" to="/">
          Go to the world
        </LinkButton>
      </EmptyState>
    </Screen>
  )
}
