/** Player copy for Relay Grants refusal codes from the Worker, plus the claim flow's own failure. */
export const GRANT_API_COPY: Readonly<Record<string, string>> = {
  grants_disabled: 'Relay Grants are switched off right now. Nothing was sent.',
  grants_paused: 'Relay Grants are paused for a moment. Nothing was sent. Try again later.',
  requirement_not_met: 'This grant isn’t unlocked yet.',
  wallet_already_funded: 'Your wallet already holds enough NIM for a relay, so the Starter Baton goes to runners who need it.',
  wallet_balance_unknown: 'The relay couldn’t read your wallet balance. Nothing was sent. Try again in a moment.',
  no_device_signal: 'Relay Grants need a private device signal so each phone claims once. Nothing was sent.',
  wallet_already_claimed: 'This wallet already received this grant.',
  device_already_claimed: 'This device already received this grant with another wallet.',
  participant_cap_reached: 'You’ve reached the 5 NIM limit for Relay Grants.',
  daily_cap_reached: 'Today’s Relay Grants are all given out. Try again tomorrow.',
  global_cap_reached: 'Relay Grants have run out for now.',
  treasury_exhausted: 'The grant treasury is running low. Nothing was sent. Try again later.',
  treasury_unavailable: 'The relay can’t reach the Nimiq network right now. Nothing was sent. Try again shortly.',
  too_many_grant_claims: 'Too many claim attempts today. Try again tomorrow.',
  grant_transfer_failed: 'The grant transfer didn’t land on the Nimiq network. Your claim was released, so you can try again.',
}
