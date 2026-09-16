/**
 * Country display anchors. A stop is drawn only when the server reports a
 * consented, network-observed country, and then only at that country's label
 * point: never a runner's position.
 */

export interface CountryShape {
  code: string
  name: string
  lat: number
  lon: number
  rings: number[][][]
}

export interface Anchor {
  lat: number
  lon: number
}

/**
 * Natural Earth 1:110m omits small states and territories. These are their
 * approximate label points, so a consented country never falls off the map.
 */
const SMALL_TERRITORIES: Record<string, readonly [number, number]> = {
  AD: [42.55, 1.6], AG: [17.07, -61.8], AI: [18.22, -63.07], AS: [-14.27, -170.7], AW: [12.52, -69.97], AX: [60.18, 19.92],
  BB: [13.19, -59.54], BH: [26.07, 50.55], BL: [17.9, -62.83], BM: [32.32, -64.76], BQ: [12.18, -68.24], CC: [-12.16, 96.87],
  CK: [-21.24, -159.78], CV: [15.12, -23.61], CW: [12.17, -68.99], CX: [-10.49, 105.62], DM: [15.41, -61.37], FM: [6.92, 158.16],
  FO: [62.0, -6.79], GD: [12.12, -61.68], GF: [3.93, -53.13], GG: [49.46, -2.59], GI: [36.14, -5.35], GP: [16.27, -61.55],
  GS: [-54.43, -36.59], GU: [13.44, 144.79], HK: [22.32, 114.17], IM: [54.24, -4.55], IO: [-7.33, 72.42], JE: [49.21, -2.13],
  KI: [1.45, 172.98], KM: [-11.88, 43.87], KN: [17.33, -62.75], KY: [19.31, -81.25], LC: [13.91, -60.98], LI: [47.16, 9.55],
  MC: [43.74, 7.42], MF: [18.08, -63.05], MH: [7.13, 171.18], MO: [22.2, 113.54], MP: [15.1, 145.67], MQ: [14.64, -61.02],
  MS: [16.74, -62.19], MT: [35.9, 14.45], MU: [-20.25, 57.55], MV: [3.2, 73.22], NF: [-29.04, 167.95], NR: [-0.52, 166.93],
  NU: [-19.05, -169.87], PF: [-17.68, -149.41], PM: [46.94, -56.27], PN: [-24.37, -128.32], PW: [7.51, 134.58], RE: [-21.12, 55.54],
  SC: [-4.68, 55.49], SG: [1.35, 103.82], SH: [-15.96, -5.71], SJ: [78.22, 15.65], SM: [43.94, 12.46], ST: [0.19, 6.61],
  SX: [18.04, -63.05], TC: [21.69, -71.8], TK: [-9.2, -171.85], TO: [-21.18, -175.2], TV: [-8.52, 179.2], VA: [41.9, 12.45],
  VC: [13.25, -61.2], VG: [18.42, -64.64], VI: [18.34, -64.9], WF: [-13.77, -177.16], WS: [-13.76, -172.1], YT: [-12.83, 45.17],
}

let countriesRequest: Promise<CountryShape[]> | null = null

export function loadCountries(): Promise<CountryShape[]> {
  countriesRequest ??= fetch('/assets/earth-countries.json').then(response => {
    if (!response.ok) throw new Error(`Earth geography unavailable (${response.status})`)
    return response.json() as Promise<CountryShape[]>
  })
  countriesRequest.catch(() => {
    countriesRequest = null
  })
  return countriesRequest
}

export function anchorLookup(countries: readonly CountryShape[]): (code: string | null) => Anchor | null {
  const anchors = new Map<string, Anchor>()
  // Some Natural Earth entries share a code (for example disputed areas); the first, primary shape wins.
  for (const country of countries) if (!anchors.has(country.code)) anchors.set(country.code, { lat: country.lat, lon: country.lon })
  for (const [code, [lat, lon]] of Object.entries(SMALL_TERRITORIES)) if (!anchors.has(code)) anchors.set(code, { lat, lon })
  return code => (code ? (anchors.get(code.toUpperCase()) ?? null) : null)
}
