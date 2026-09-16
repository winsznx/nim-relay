import { linkProps, pathFor } from '../shell/router'
import { SectionHeader } from '../shell/ui/primitives'
import { Screen } from '../shell/ui/Screen'
import './social.css'

export function PrivacyScreen({ entryKey }: { entryKey: string }) {
  return (
    <Screen title="Privacy" entryKey={entryKey} parent={pathFor('profile')}>
      <div className="nr-prose">
        <SectionHeader title="Your wallet stays yours" />
        <p>Your Nimiq keys never leave Nimiq Pay. Every transfer needs your approval, and NIM Relay can’t move or recover funds from any holder, including one who stops playing.</p>

        <SectionHeader title="What we keep" />
        <ul>
          <li>Your linked wallet address and runner profile.</li>
          <li>The inputs of your verified rides, so the server can replay them.</li>
          <li>Public handoff transactions and session records.</li>
          <li>If you allow the fair-play signal, a hashed device identifier. The raw identifier is never stored.</li>
        </ul>
        <p>We don’t store raw IP addresses.</p>

        <SectionHeader title="Countries" />
        <p>Showing your country on relay routes is optional and off until you turn it on in your profile. It comes from your network connection, so a VPN can change it, and it is never an exact location. Runners who don’t share appear as “Location not shared”.</p>

        <SectionHeader title="What we can’t change" />
        <p>Transactions on the Nimiq blockchain are public and permanent. A wallet isn’t proof of a unique person, and testnet activity is always reported separately from mainnet usage.</p>

        <p className="nr-note">
          <a {...linkProps(pathFor('proof'))}>See public proof and how each metric is measured</a>
        </p>
      </div>
    </Screen>
  )
}
