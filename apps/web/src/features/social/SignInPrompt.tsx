import { useRequireRunner } from '../shell/session'
import { Button } from '../shell/ui/Button'
import { EmptyState } from '../shell/ui/primitives'

/** Shown in place of personal content for visitors; opens the one sign-in ceremony on request. */
export function SignInPrompt({ title, body, reason, tour }: { title: string; body: string; reason: string; tour?: string }) {
  const requireRunner = useRequireRunner()
  return (
    <EmptyState title={title} body={body} {...(tour ? { tour } : {})}>
      <Button variant="primary" onClick={() => requireRunner(reason, () => undefined)}>
        Set up my runner
      </Button>
    </EmptyState>
  )
}
