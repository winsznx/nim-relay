import { useEffect, useEffectEvent, useState, useSyncExternalStore, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import type { RelayNote } from '@nim-relay/shared'
import type { HandoffRoster, OpenRoster } from '../leg/runner-groups'
import { useRunnerWallets } from '../relays/data'
import { chooseNoticeCopy, failureCopy, formatNim, sceneStateFor, verificationCopy, type CeremonySceneState } from './copy'
import { HoloCard } from './holo'
import { LaunchPad } from './LaunchPad'
import type { HandoffOrchestrator, HandoffStage } from './machine'
import { NoteStep } from './NoteStep'
import { OpenRelay, useInviteLink } from './OpenRelay'
import { RecoveryPanel } from './RecoveryPanel'
import { RelayNoteQuote } from './RelayNoteQuote'
import { RunnerHero } from './RunnerHero'
import { RunnerPicker } from './RunnerPicker'
import './handoff.css'

type ConfirmedStage = Extract<HandoffStage, { stage: 'confirmed' }>

interface HandoffCeremonyProps {
  machine: HandoffOrchestrator
  /** Who can take the baton; null until the relay network has loaded. */
  roster: HandoffRoster | null
  batonName: string
  /** Baton value in Luna. */
  value: number
  /** Creates an invite link for this baton and resolves with its URL. */
  createInvite(): Promise<string>
  onSceneState(state: CeremonySceneState): void
  /** Called once the launch cinematic has played after server verification. */
  onDeparted(stage: ConfirmedStage): void
  /** Leave the handoff zone while keeping the baton. */
  onKeepBaton(): void
}

/** Launch cinematic length before the world takes over. */
const DEPARTURE_MS = 2600
const TITLE_ID = 'handoff-stage-title'

interface Plates {
  /** Plates with the same key stay up while their content changes; a new key swaps the whole projection. */
  key: string
  content: ReactNode
}

/**
 * The handoff after a verified leg, projected into the finish scene: who takes the baton, an optional note,
 * the throw, Nimiq Pay approval and the network's confirmation.
 */
export function HandoffCeremony({ machine, roster, batonName, value, createInvite, onSceneState, onDeparted, onKeepBaton }: HandoffCeremonyProps) {
  const stage = useSyncExternalStore(machine.subscribe, machine.getSnapshot)
  const sceneState = sceneStateFor(stage.stage)
  const wallets = useRunnerWallets()
  const invite = useInviteLink(createInvite)
  const [browsingOthers, setBrowsingOthers] = useState(false)

  useEffect(() => {
    onSceneState(sceneState)
  }, [sceneState, onSceneState])

  // The cinematic timer belongs to the confirmed stage. A new onDeparted identity (every network refresh
  // re-renders the host) must not restart it, or a busy network holds the ceremony on "confirmed".
  const depart = useEffectEvent(onDeparted)
  useEffect(() => {
    if (stage.stage !== 'confirmed') return
    const timer = window.setTimeout(() => depart(stage), DEPARTURE_MS)
    return () => window.clearTimeout(timer)
  }, [stage])

  const amount = formatNim(value)
  const othersAllowed = roster !== null && (roster.kind === 'open' || roster.others !== null)
  const keepBaton = (
    <button type="button" className="handoff-keep" onClick={onKeepBaton}>
      Keep the baton for now
    </button>
  )

  const picker = (open: OpenRoster, notice: string | null, back: ReactNode): Plates => ({
    key: 'choose-picker',
    content: (
      <>
        <RunnerPicker roster={open} notice={notice} onSelect={runner => machine.select(runner)} />
        {open.invite && <OpenRelay batonName={batonName} invite={invite} />}
        <div className="handoff-footer">
          {back}
          {keepBaton}
        </div>
      </>
    ),
  })

  const plates = ((): Plates => {
    switch (stage.stage) {
      case 'choose': {
        const notice = stage.notice ? chooseNoticeCopy(stage.notice) : null
        if (!roster) {
          return {
            key: 'choose-loading',
            content: (
              <>
                <HoloCard labelledBy={TITLE_ID}>
                  <p className="handoff-eyebrow">Handoff zone</p>
                  <h2 id={TITLE_ID} className="handoff-title">
                    Finding runners
                  </h2>
                  <p className="handoff-status" role="status">
                    Reading the relay network
                  </p>
                </HoloCard>
                <div className="handoff-footer">{keepBaton}</div>
              </>
            ),
          }
        }
        if (roster.kind === 'open') return picker(roster, notice, null)
        if (browsingOthers && roster.others) {
          const back = (
            <button type="button" className="handoff-keep" onClick={() => setBrowsingOthers(false)}>
              Back to {roster.runner.name}
            </button>
          )
          return picker(roster.others, notice, back)
        }
        return {
          key: 'choose-hero',
          content: (
            <>
              <RunnerHero
                runner={roster.runner}
                status={roster.status}
                notice={notice}
                onPrepare={() => machine.select(roster.runner)}
                onChooseOther={roster.others ? () => setBrowsingOthers(true) : null}
              />
              <div className="handoff-footer">{keepBaton}</div>
            </>
          ),
        }
      }
      case 'note':
        return {
          key: 'note',
          content: (
            <NoteStep
              recipient={stage.recipient}
              wallet={wallets.get(stage.recipient.id) ?? null}
              draft={stage.draft}
              refusal={stage.refusal}
              onAttach={note => machine.attachNote(note)}
              onChangeRunner={() => machine.changeRunner()}
            />
          ),
        }
      case 'aiming':
        return {
          key: 'aim',
          content: (
            <HoloCard className="handoff-aim" labelledBy={TITLE_ID}>
              <div className="handoff-plate-head">
                <p className="handoff-eyebrow">Launch platform</p>
                <button type="button" className="handoff-quiet handoff-quiet--inline" onClick={() => machine.changeRunner()}>
                  {othersAllowed ? 'Change runner' : 'Back'}
                </button>
              </div>
              <h2 id={TITLE_ID} className="handoff-title">
                Passing {amount} <span>to {stage.recipient.name}</span>
              </h2>
              {stage.note && <NoteLine note={stage.note} onEdit={() => machine.editNote()} />}
              <LaunchPad onThrow={launch => void machine.throwBaton(launch)} />
            </HoloCard>
          ),
        }
      case 'preparing':
      case 'armed':
      case 'wallet': {
        // Before the server answers, the pass is what the holder chose; after, it is the locked intent.
        const pass =
          stage.stage === 'preparing'
            ? { amount, recipientName: stage.recipient.name, note: stage.note }
            : { amount: formatNim(stage.intent.value), recipientName: stage.intent.recipientName, note: stage.intent.note }
        return {
          key: 'freeze',
          content: (
            <HoloCard className="handoff-freeze" labelledBy={TITLE_ID}>
              {stage.stage === 'armed' && <p className="handoff-eyebrow">Pass locked</p>}
              <h2 id={TITLE_ID} className="handoff-title handoff-title--freeze">
                Passing {pass.amount} <span>to {pass.recipientName}</span>
              </h2>
              {pass.note && <RelayNoteQuote text={pass.note.text} visibility={pass.note.visibility} />}
              {stage.stage === 'armed' ? (
                <div className="handoff-actions handoff-actions--settle">
                  <button type="button" className="handoff-primary" onClick={() => void machine.launch()}>
                    Approve in Nimiq Pay
                  </button>
                  <button type="button" className="handoff-quiet" onClick={() => void machine.cancelUnattempted()}>
                    Choose a different runner
                  </button>
                </div>
              ) : (
                <p className="handoff-status" role="status">
                  {stage.stage === 'preparing' ? 'Locking the pass…' : 'Approve the pass in Nimiq Pay'}
                </p>
              )}
            </HoloCard>
          ),
        }
      }
      case 'paused':
        return {
          key: 'retry',
          content: (
            <HoloCard labelledBy={TITLE_ID}>
              <h2 id={TITLE_ID} className="handoff-title">
                Pass paused
              </h2>
              <p className="handoff-body">The baton is still with you.</p>
              <button type="button" className="handoff-primary" onClick={() => void machine.launch()}>
                Approve again
              </button>
              <button type="button" className="handoff-quiet" onClick={() => void machine.cancelUnattempted()}>
                Choose a different runner
              </button>
            </HoloCard>
          ),
        }
      case 'insufficient':
        return {
          key: 'retry',
          content: (
            <>
              <HoloCard labelledBy={TITLE_ID}>
                <h2 id={TITLE_ID} className="handoff-title">
                  This relay requires {formatNim(stage.intent.value)}
                </h2>
                <p className="handoff-body">Add NIM to your wallet, then approve again. The baton is still with you.</p>
                <button type="button" className="handoff-primary" onClick={() => void machine.launch()}>
                  Approve again
                </button>
              </HoloCard>
              <div className="handoff-footer">{keepBaton}</div>
            </>
          ),
        }
      case 'checking':
        return {
          key: 'checking',
          content: (
            <HoloCard labelledBy={TITLE_ID}>
              <p className="handoff-eyebrow">Nimiq network</p>
              <h2 id={TITLE_ID} className="handoff-title">
                Checking for your pass
              </h2>
              <p className="handoff-status" role="status">
                Looking for a transfer to {stage.intent.recipientName}
              </p>
            </HoloCard>
          ),
        }
      case 'recovery':
        return {
          key: 'recovery',
          content: (
            <HoloCard tone="alert" labelledBy={TITLE_ID}>
              <RecoveryPanel
                titleId={TITLE_ID}
                invalidHash={stage.invalidHash}
                recipientName={stage.intent.recipientName}
                onSubmit={hash => void machine.submitRecoveredHash(hash)}
                onNothingSent={() => void machine.confirmNothingSent()}
                onLeave={onKeepBaton}
              />
            </HoloCard>
          ),
        }
      case 'in-flight':
        return {
          key: 'flight',
          content: (
            <HoloCard tone="live" className="handoff-flight" labelledBy={TITLE_ID}>
              <p className="handoff-eyebrow handoff-eyebrow--live">Nimiq network</p>
              <h2 id={TITLE_ID} className="handoff-title">
                Handoff in flight
              </h2>
              <div className="handoff-flight__trail" aria-hidden="true" />
              <p className="handoff-body">
                {stage.slow
                  ? 'Confirmation is taking longer than usual. You can leave; the relay keeps checking and confirms it automatically.'
                  : `Waiting for the network to confirm your pass to ${stage.intent.recipientName}.`}
              </p>
              {stage.slow && (
                <button type="button" className="handoff-secondary" onClick={() => void machine.checkAgain()}>
                  Check again
                </button>
              )}
            </HoloCard>
          ),
        }
      case 'not-verified':
        return {
          key: 'stopped',
          content: (
            <HoloCard tone="alert" labelledBy={TITLE_ID}>
              <h2 id={TITLE_ID} className="handoff-title">
                Handoff not verified
              </h2>
              <p className="handoff-body">{verificationCopy(stage.reason)}</p>
              <p className="handoff-muted">The baton stays with you until a matching transfer is verified.</p>
              <button type="button" className="handoff-quiet" onClick={onKeepBaton}>
                Back to the journey
              </button>
            </HoloCard>
          ),
        }
      case 'confirmed':
        return {
          key: 'confirmed',
          content: (
            <HoloCard tone="live" className="handoff-confirmed" labelledBy={TITLE_ID}>
              <p className="handoff-eyebrow handoff-eyebrow--live">Verified on Nimiq</p>
              <h2 id={TITLE_ID} className="handoff-title">
                Handoff confirmed
              </h2>
              <p className="handoff-confirmed__to">{stage.intent.recipientName} takes it from here</p>
            </HoloCard>
          ),
        }
      case 'failed':
        return {
          key: 'stopped',
          content: (
            <HoloCard tone="alert" labelledBy={TITLE_ID}>
              <h2 id={TITLE_ID} className="handoff-title">
                Pass not locked
              </h2>
              <p className="handoff-body">{failureCopy(stage.message)}</p>
              <button type="button" className="handoff-quiet" onClick={onKeepBaton}>
                Back to the journey
              </button>
            </HoloCard>
          ),
        }
    }
  })()

  // popLayout lifts the leaving plates out of the flow, so a beat that lasts only a moment, such as locking the pass,
  // still renders instead of waiting behind the previous projection's exit.
  return (
    <div className="handoff" data-stage={stage.stage}>
      <AnimatePresence mode="popLayout">
        <motion.div key={plates.key} className="handoff__plates" exit={{ opacity: 0, transition: { duration: 0.18 } }}>
          {plates.content}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}

function NoteLine({ note, onEdit }: { note: RelayNote; onEdit(): void }) {
  return (
    <div className="handoff-noteline">
      <RelayNoteQuote text={note.text} visibility={note.visibility} />
      <button type="button" className="handoff-quiet handoff-quiet--inline" onClick={onEdit}>
        Edit note
      </button>
    </div>
  )
}
