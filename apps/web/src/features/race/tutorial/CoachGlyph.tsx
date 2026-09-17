import type { ReactNode } from 'react'
import type { CoachInput, TutorialStepId } from './steps'

interface CoachGlyphProps {
  step: TutorialStepId
  input: CoachInput
}

/**
 * The picture beside a prompt: the gesture a thumb makes on a touch screen (a guide, a gold thumb that
 * travels it, a chevron where it ends), the key to press on a keyboard, or the thing on the road the
 * prompt is about. The edge glyph is drawn for the left edge; the card mirrors it for the right.
 */
export function CoachGlyph({ step, input }: CoachGlyphProps) {
  return (
    <svg className="leg-coach__glyph" viewBox="0 0 48 48" aria-hidden="true">
      {drawing(step, input)}
    </svg>
  )
}

function drawing(step: TutorialStepId, input: CoachInput): ReactNode {
  switch (step) {
    case 'lane':
      return input === 'touch' ? <SwipeAcross /> : <ArrowKeys />
    case 'jump':
      return input === 'touch' ? <SwipeAlong direction="up" /> : <ArrowKey direction="up" />
    case 'slide':
      return input === 'touch' ? <SwipeAlong direction="down" /> : <ArrowKey direction="down" />
    case 'ghostline':
      return <GhostlineDrawing />
    case 'edge':
      return <EdgeDrawing input={input} />
    case 'flow':
      return <FlowDrawing />
  }
}

/** Where the thumb touches down stays marked while the thumb itself flicks away from it. */
function Thumb({ motion }: { motion: 'across' | 'along' | 'inward' }) {
  return (
    <>
      <circle className={`coach-thumb__origin coach-thumb--${motion}-origin`} cx="24" cy="24" r="8" />
      <g className={`coach-thumb coach-thumb--${motion}`}>
        <circle className="coach-thumb__dot" cx="24" cy="24" r="4.5" />
      </g>
    </>
  )
}

function SwipeAcross() {
  return (
    <>
      <path className="coach-guide" d="M 10 24 H 38" />
      <path className="coach-chevron coach-chevron--left" d="M 13 17 L 6 24 L 13 31" />
      <path className="coach-chevron coach-chevron--right" d="M 35 17 L 42 24 L 35 31" />
      <Thumb motion="across" />
    </>
  )
}

function SwipeAlong({ direction }: { direction: 'up' | 'down' }) {
  return (
    <g transform={direction === 'down' ? 'rotate(180 24 24)' : undefined}>
      <path className="coach-guide" d="M 24 40 V 12" />
      <path className="coach-chevron coach-chevron--ahead" d="M 17 13 L 24 6 L 31 13" />
      <Thumb motion="along" />
    </g>
  )
}

const ARROWS = {
  left: 'M 19 24 H 29 M 23 19 L 18 24 L 23 29',
  right: 'M 29 24 H 19 M 25 19 L 30 24 L 25 29',
  up: 'M 24 29 V 19 M 19 23 L 24 18 L 29 23',
  down: 'M 24 19 V 29 M 19 25 L 24 30 L 29 25',
} as const

/** A key cap. The press animates the inner group, since a CSS transform would replace the placement attribute. */
function Key({ arrow, x, order }: { arrow: keyof typeof ARROWS; x: number; order: 'first' | 'second' }) {
  return (
    <g transform={`translate(${x} 0)`}>
      <g className={`coach-key coach-key--${order}`}>
        <rect className="coach-key__cap" x="11" y="11" width="26" height="26" rx="6" />
        <path className="coach-key__arrow" d={ARROWS[arrow]} />
      </g>
    </g>
  )
}

function ArrowKeys() {
  return (
    <g transform="translate(24 24) scale(0.82) translate(-24 -24)">
      <Key arrow="left" x={-14.5} order="first" />
      <Key arrow="right" x={14.5} order="second" />
    </g>
  )
}

function ArrowKey({ direction }: { direction: 'up' | 'down' }) {
  return <Key arrow={direction} x={0} order="first" />
}

function GhostlineDrawing() {
  const line = 'M 24 44 C 24 32 33 26 33 16 C 33 10 30 7 28 4'
  return (
    <>
      <path className="coach-ghostline" d={line} />
      <path className="coach-ghostline__shimmer" d={line} pathLength={100} />
      <circle className="coach-courier" cx="24" cy="38" r="4" />
    </>
  )
}

function EdgeDrawing({ input }: { input: CoachInput }) {
  return (
    <>
      <path className="coach-edge" d="M 6 6 V 42" />
      {input === 'touch' ? (
        <>
          <path className="coach-guide" d="M 14 24 H 36" />
          <path className="coach-chevron coach-chevron--right" d="M 33 17 L 40 24 L 33 31" />
          <Thumb motion="inward" />
        </>
      ) : (
        <Key arrow="right" x={5} order="first" />
      )}
    </>
  )
}

/** The FLOW meter in miniature: a half arc filling past its middle mark, where the mid tier starts. */
function FlowDrawing() {
  const arc = 'M 8 34 A 16 16 0 0 1 40 34'
  return (
    <>
      <path className="coach-flow__track" d={arc} />
      <path className="coach-flow__fill" d={arc} pathLength={100} />
      <path className="coach-flow__mark" d="M 24 13 V 23" />
    </>
  )
}
