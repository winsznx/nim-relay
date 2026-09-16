const PATHS = {
  world: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 0c2.4 2.3 3.6 5.3 3.6 9s-1.2 6.7-3.6 9m0-18C9.6 5.3 8.4 8.3 8.4 12s1.2 6.7 3.6 9M3.5 9h17M3.5 15h17',
  inbox: 'M4 13.5 6.2 5.8A2 2 0 0 1 8.1 4.4h7.8a2 2 0 0 1 1.9 1.4L20 13.5M4 13.5V18a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4.5M4 13.5h4.2l1.3 2.3h5l1.3-2.3H20',
  crew: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm-6 9c.4-3.3 2.9-5.5 6-5.5s5.6 2.2 6 5.5M16 4.3a3.5 3.5 0 0 1 0 6.4M18 14.8c1.8.7 2.8 2.6 3 5.2',
  profile: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7.5 8.5c.6-3.8 3.6-6.2 7.5-6.2s6.9 2.4 7.5 6.2',
  back: 'M15 5 8 12l7 7',
  close: 'M6 6l12 12M18 6 6 18',
  share: 'M12 15V3.5M7.5 8 12 3.5 16.5 8M5 12.5V18a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5.5',
  copy: 'M9 9h10v11H9zM5 15H4.5A1.5 1.5 0 0 1 3 13.5v-9A1.5 1.5 0 0 1 4.5 3h9A1.5 1.5 0 0 1 15 4.5V5',
  external: 'M14 4h6v6M20 4l-9 9M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4',
  chevron: 'M9 5l7 7-7 7',
  play: 'M8 5.5v13l10.5-6.5L8 5.5Z',
  eye: 'M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Zm9.5 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
  sound: 'M4 9.5h3.5L12 5.5v13l-4.5-4H4v-5ZM16 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11',
  muted: 'M4 9.5h3.5L12 5.5v13l-4.5-4H4v-5ZM16.5 9.5l5 5M21.5 9.5l-5 5',
  shield: 'M12 3.5 5 6v5.5c0 4.3 3 7.7 7 9 4-1.3 7-4.7 7-9V6l-7-2.5Z',
  station: 'M3.5 19.5h17M6 19.5v-5.5a6 6 0 0 1 12 0v5.5M12 8V4.5M9.5 19.5v-3h5v3',
} as const

export type IconName = keyof typeof PATHS

export function Icon({ name, size = 22, strokeWidth = 1.7 }: { name: IconName; size?: number; strokeWidth?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  )
}
