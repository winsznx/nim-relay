import type { RunnerOption } from '../leg/runner-groups'
import { RunnerAvatar } from '../shell/ui/RunnerAvatar'
import { HoloCard } from './holo'

interface RunnerHeroProps {
  runner: RunnerOption
  status: 'ready' | 'invited'
  notice: string | null
  onPrepare(): void
  /** Only when the relay's rules let the baton go to someone else. */
  onChooseOther: (() => void) | null
}

/** Long names step down a size so they wrap between words instead of inside them. */
function nameSize(name: string): 'large' | 'medium' | 'small' {
  if (name.length <= 9) return 'large'
  return name.length <= 16 ? 'medium' : 'small'
}

/** One runner is waiting for this baton: the handoff is theirs to receive. */
export function RunnerHero({ runner, status, notice, onPrepare, onChooseOther }: RunnerHeroProps) {
  return (
    <HoloCard className="handoff-hero" labelledBy="handoff-hero-title">
      <div className="handoff-hero__identity">
        <span className="handoff-halo" aria-hidden="true">
          <RunnerAvatar name={runner.name} wallet={runner.wallet} country={runner.country} size={64} />
        </span>
        <div className="handoff-hero__text">
          <h2 id="handoff-hero-title" className="handoff-hero__title">
            <span className="handoff-eyebrow">Handoff to</span>{' '}
            <span className="handoff-hero__name" data-size={nameSize(runner.name)}>
              {runner.name}
            </span>
          </h2>
          <p className="handoff-hero__context">{runner.context}</p>
          <p className="handoff-readiness" data-status={status}>
            <span className="handoff-readiness__dot" aria-hidden="true" />
            {status === 'ready' ? 'Ready' : 'Not accepted'}
          </p>
        </div>
      </div>
      {notice && (
        <p className="handoff-notice" role="alert">
          {notice}
        </p>
      )}
      <button type="button" className="handoff-primary" onClick={onPrepare}>
        Prepare handoff
      </button>
      {onChooseOther && (
        <button type="button" className="handoff-quiet" onClick={onChooseOther}>
          Choose someone else
        </button>
      )}
    </HoloCard>
  )
}
