import { ONE } from '../fixed-point'

/** Authoring conversions from whole units to Q16.16. Truncates toward zero. */
export const centimetres = (cm: number): number => Math.trunc(cm * ONE / 100)
export const millimetres = (mm: number): number => Math.trunc(mm * ONE / 1000)
export const percent = (p: number): number => Math.trunc(p * ONE / 100)
