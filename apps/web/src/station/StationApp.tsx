import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchMe, requestNonce, verifyLogin } from '../lib/auth-api'
import { connectAccount, isInsideNimiqPay, nimiqPayDeepLink, sendRelayHandoff, signMessage } from '../lib/nimiq'
import * as api from './api'
import { StationController } from './controller'
import { RaceView } from './RaceView'
import { mountStation } from './visuals'
import { RelayAudio } from './audio'
import './station.css'

const worlds: api.StationWorld[] = ['coast', 'alpine', 'metro', 'solar', 'ocean']
const worldNames = { coast: 'Sunbreak Coast', alpine: 'Cloudline Alps', metro: 'Midnight Metro', solar: 'Solar Frontier', ocean: 'Ocean Skyway' }
const destinations = ['global', 'daily', 'crew', 'rival', 'inbox', 'customize', 'gallery', 'rankings', 'profile', 'chronicles']
type RaceSession = { controller: StationController; issued: api.IssuedRace | null }

export function StationApp() {
  const client = useQueryClient()
  const me = useQuery({ queryKey: ['me'], queryFn: fetchMe, retry: false })
  const station = useQuery({ queryKey: ['station'], queryFn: api.loadStation, enabled: !!me.data, retry: false })
  const publicData = useQuery({ queryKey: ['station-public'], queryFn: api.publicStationSummary, retry: false })
  const [destination, setDestination] = useState<string | null>(null)
  const [world, setWorld] = useState<api.StationWorld>('coast')
  const [race, setRace] = useState<RaceSession | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [field, setField] = useState('')
  const host = useRef<HTMLDivElement>(null)
  const audio = useRef<RelayAudio | null>(null)
  useEffect(() => { audio.current = new RelayAudio(); return () => audio.current?.dispose() }, [])
  useEffect(() => { if (!host.current || race) return; return mountStation(host.current, setDestination, { ...station.data?.profile.equipped, handoffs: station.data?.global.leg ?? 0 }) }, [race, station.data?.profile.equipped, station.data?.global.leg])
  async function act(action: () => Promise<unknown>) { setBusy(true); setError(''); try { await action() } catch (cause) { setError(cause instanceof Error ? cause.message : 'Please try again.') } finally { setBusy(false) } }
  async function login() {
    await connectAccount(); const { nonce, message } = await requestNonce(); const signed = await signMessage(message)
    const result = await verifyLogin({ nonce, ...signed }); client.setQueryData(['me'], result.player)
  }
  async function start(mode: api.RaceMode = 'quick', target?: string) {
    await act(async () => {
      await audio.current?.unlock()
      const issued = me.data ? await api.issueRace({ mode, world, ...(target ? { target } : {}) }) : null
      const config = issued?.config ?? { engineVersion: '4', challenge: 'station-race', challengeVersion: '4', seed: crypto.randomUUID(), world }
      const controller = new StationController(config, issued?.ghost ? { trace: issued.ghost.inputTrace, name: issued.ghost.name } : undefined)
      setRace({ controller, issued }); setDestination(null)
    })
  }
  const data = station.data
  const global = data?.global ?? publicData.data?.global
  const rankings = data?.rankings ?? publicData.data?.rankings ?? []
  const chronicles = data?.chronicles ?? publicData.data?.chronicles ?? []
  const update = async (action: Promise<api.StationSnapshot>) => { client.setQueryData(['station'], await action); setField('') }
  if (race) return <RaceView session={race} audio={audio.current} profile={data?.profile} couriers={rankings.filter(runner => runner.id !== me.data?.id)} onExit={() => { setRace(null); void client.invalidateQueries({ queryKey: ['station'] }); void client.invalidateQueries({ queryKey: ['station-public'] }) }} />
  return <main className="station-app">
    <div className="station-scene" ref={host} aria-label="Three dimensional Relay Station" />
    <header className="station-topbar"><div className="station-brand">NIM <span>RELAY</span></div><div className="station-actions"><button className="station-pill" onClick={() => audio.current?.toggle()}>Sound</button>{me.data ? <button className="station-pill" onClick={() => setDestination('profile')}>{data?.profile.name ?? me.data.handle} · LV {data?.profile.level ?? 1}</button> : isInsideNimiqPay() ? <button className="station-pill" disabled={busy} onClick={() => void act(login)}>Connect courier</button> : <a className="station-pill" href={nimiqPayDeepLink(location.origin)}>Open in Nimiq Pay</a>}</div></header>
    <section className="station-home"><p className="station-eyebrow">THE WORLD IS YOUR RELAY</p><h1 className="station-title">One baton.<br />Endless horizons.</h1><p className="station-subtitle">Ride the line. Catch the rhythm.<br />Carry the story a little further.</p><div className="station-worlds">{worlds.map(value => <button key={value} className={world === value ? 'station-selected' : ''} onClick={() => setWorld(value)}>{worldNames[value]}</button>)}</div><button className="station-primary" disabled={busy} onClick={() => void start()}>{busy ? 'Preparing departure…' : `Ride ${worldNames[world]} →`}</button><p className="station-muted">{me.data ? 'Your next chapter starts here.' : 'Free practice · Connect to join the relay'}</p></section>
    <nav className="station-nav" aria-label="Station destinations">{destinations.map(item => <button key={item} onClick={() => { setDestination(item); setError(''); setField('') }}>{item === 'customize' ? 'Locker' : item === 'chronicles' ? 'Baton stories' : item}{item === 'inbox' && data?.inbox.length ? ` (${data.inbox.length})` : ''}</button>)}</nav>
    {error && <p className="station-error" role="alert">{error}</p>}
    {destination && <section className="station-panel"><header className="station-panel-header"><h2>{destination === 'customize' ? 'Your signature' : destination === 'global' ? 'The living relay' : destination === 'chronicles' ? 'Baton stories' : destination}</h2><button aria-label="Close panel" onClick={() => setDestination(null)}>✕</button></header>
      {destination === 'global' && <>{data?.pendingHandoff && <PendingHandoff intent={data.pendingHandoff} onVerified={() => { void client.invalidateQueries({ queryKey: ['station'] }); void client.invalidateQueries({ queryKey: ['station-public'] }) }} />}<p className="station-eyebrow">LEG {global?.leg ?? 0} · {worldNames[global?.world ?? 'coast']}</p><h3>{global?.holderName ? `${global.holderName} carries the baton` : 'A new story is waiting'}</h3><p>Every confirmed handoff adds a chapter. Ride, choose the next courier, and pass one NIM forward.</p><button className="station-primary" disabled={busy || !me.data} onClick={() => void start('global')}>Join the global relay</button></>}
      {destination === 'daily' && <><p className="station-eyebrow">{data?.daily.date ?? 'TODAY’S ROUTE'}</p><h3>{worldNames[data?.daily.world ?? 'coast']}</h3><p>One route. The same conditions. A new best to chase.</p><p>Your best: {data?.daily.best ?? 'No ride yet'}</p><button className="station-primary" disabled={busy || !me.data} onClick={() => void start('daily')}>Ride the daily</button></>}
      {(destination === 'crew' || destination === 'rival') && <><p>{destination === 'crew' ? 'Make a crew or enter an invitation code.' : 'Add a courier by handle to keep the rivalry going.'}</p><input aria-label={destination === 'crew' ? 'Crew name or invite code' : 'Courier handle'} value={field} onChange={e => setField(e.target.value)} placeholder={destination === 'crew' ? 'Crew name / invite code' : '@courier'} /><div className="station-actions"><button className="station-secondary" disabled={busy || !me.data || !field.trim()} onClick={() => void act(() => update(destination === 'crew' ? api.createCrew(field) : api.addRival(field)))}>{destination === 'crew' ? 'Create crew' : 'Add rival'}</button>{destination === 'crew' && <button className="station-secondary" disabled={busy || !me.data || !field.trim()} onClick={() => void act(() => update(api.joinCrew(field)))}>Join crew</button>}</div>{destination === 'crew' ? data?.crews.map(crew => <article className="station-card" key={crew.id}><h3>{crew.name}</h3><p>{crew.members.length} couriers · Invite {crew.code}</p><button className="station-secondary" onClick={() => void start('crew', crew.id)}>Ride together</button></article>) : data?.rivals.map(rival => <article className="station-row" key={rival.id}><span>{rival.name} · {rival.score}</span><button className="station-secondary" onClick={() => void start('rival', rival.id)}>Race ghost</button></article>)}</>}
      {destination === 'inbox' && <>{data?.inbox.length ? data.inbox.map(invite => <article className="station-card" key={invite.id}><h3>{invite.fromName} challenges you</h3><p>{invite.status}</p><button className="station-secondary" onClick={() => void start('rival', invite.id)}>Accept challenge</button></article>) : <p>Your next rivalry starts with a challenge. Invitations will arrive here.</p>}</>}
      {destination === 'customize' && <div className="station-grid">{data?.cosmetics.map(item => { const unlocked = data.profile.unlocked.includes(item.id); const equipped = data.profile.equipped[item.category] === item.id; return <article className="station-card" key={item.id}><p className="station-eyebrow">{item.category}</p><h3>{item.name}</h3><p>{unlocked ? equipped ? 'Equipped' : 'In your collection' : `${item.xp} XP to unlock`}</p><button className="station-secondary" disabled={!unlocked || equipped || busy} onClick={() => void act(() => update(api.customizeCourier({ category: item.category, cosmetic: item.id })))}>Equip</button></article> }) ?? <p>Connect your courier to build your collection.</p>}</div>}
      {destination === 'gallery' && <><h3>{global?.leg ?? 0} handoffs. One living baton.</h3><p>Each ring marks a confirmed journey. The baton in the station grows with its history.</p>{chronicles.filter(item => item.kind === 'handoff').map(item => <article className="station-card" key={item.id}><p className="station-eyebrow">HISTORY MARK · {item.leg}</p><h3>{worldNames[item.world]}</h3><p>Carried forward by {item.name}</p></article>)}{!chronicles.some(item => item.kind === 'handoff') && <p>The first history mark awaits a confirmed handoff.</p>}</>}
      {destination === 'rankings' && <>{rankings.length ? rankings.map((runner, index) => <article className="station-row" key={runner.id}><b>{index + 1}</b><span>{runner.name}</span><strong>{runner.score.toLocaleString()}</strong></article>) : <p>The departure board is clear. Set the first verified score.</p>}</>}
      {destination === 'profile' && <><h3>{data?.profile.name ?? 'Guest courier'}</h3>{data && <p>@{data.profile.handle}</p>}<p>Level {data?.profile.level ?? 1} · {data?.profile.xp ?? 0} XP · {data?.profile.seasonRank ?? 'New arrival'}</p><p>{data?.profile.runs ?? 0} rides · {data?.profile.handoffs ?? 0} handoffs</p><h3>Achievements</h3>{data?.profile.achievements.length ? data.profile.achievements.map(item => <p key={item}>{item.replaceAll('-', ' ')}</p>) : <p>Your first ride is the beginning.</p>}<input aria-label="Courier name" value={field} onChange={e => setField(e.target.value)} placeholder="Courier name" /><button className="station-secondary" disabled={busy || !me.data || !field.trim()} onClick={() => void act(() => update(api.customizeCourier({ name: field })))}>Save name</button></>}
      {destination === 'chronicles' && <>{chronicles.length ? chronicles.map(item => <article className="station-card" key={item.id}><p className="station-eyebrow">{worldNames[item.world]} · {new Date(item.at).toLocaleDateString()}</p><h3>{item.name} {item.kind === 'handoff' ? `passed leg ${item.leg}` : 'rode the line'}</h3><p>{item.score.toLocaleString()} points</p></article>) : <p>The baton’s history is written by real rides and confirmed handoffs. Be part of its first chapter.</p>}</>}
      {!me.data && !['rankings', 'chronicles', 'gallery', 'customize', 'profile'].includes(destination) && <p className="station-muted">Connect with Nimiq Pay to take part. Practice is always open.</p>}
    </section>}
  </main>
}


function PendingHandoff({ intent, onVerified }: { intent: api.HandoffIntent; onVerified: () => void }) {
  const [hash, setHash] = useState(intent.txHash ?? localStorage.getItem(`relay-transfer:${intent.id}`) ?? '')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  async function recover() {
    setBusy(true)
    try {
      const transaction = hash || await sendRelayHandoff(intent)
      setHash(transaction); localStorage.setItem(`relay-transfer:${intent.id}`, transaction)
      const result = await api.confirmHandoff(intent.id, transaction)
      if (result.status === 'verified') { localStorage.removeItem(`relay-transfer:${intent.id}`); onVerified() }
      else setMessage(result.status === 'pending' ? 'Waiting for network confirmation. Check again shortly.' : `Not verified: ${result.reason ?? 'Check your transaction.'}`)
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : 'Could not check transfer') } finally { setBusy(false) }
  }
  return <article className="station-card"><h3>Your handoff to {intent.recipientName}</h3><p>Pass {intent.value / 100000} NIM on {intent.network}. If you already approved this transfer, check its confirmation.</p><input aria-label="Transfer hash for recovery" placeholder="Transaction hash, if already sent" value={hash} onChange={event => setHash(event.target.value)} /><button className="station-primary" disabled={busy} onClick={() => void recover()}>{busy ? 'Checking…' : hash ? 'Check confirmation' : 'Approve in Nimiq Pay'}</button>{message && <p role="status">{message}</p>}</article>
}
