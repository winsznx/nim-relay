/**
 * Earth geography for drawing land. Nothing on the globe is placed by country: relays travel between Relay Atlas
 * stations, which are game-world destinations and never where a runner is.
 */

export interface CountryShape {
  code: string
  name: string
  lat: number
  lon: number
  rings: number[][][]
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
