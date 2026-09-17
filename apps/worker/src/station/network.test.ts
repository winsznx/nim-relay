import { SELF } from 'cloudflare:test'
import { describe, expect, it, vi } from 'vitest'
import { getAuthStore } from '../auth/store'
import { createSessionToken } from '../auth/session'
import { NimiqRpcClient } from '@nim-relay/relay-protocol'
import type { Env } from '../env'
import type { IssuedRace, StationSnapshot, SubmittedRace, BatonDetail, NetworkSnapshot, NetworkHandoffIntent } from '@nim-relay/shared'
import { finishingTrace, IDLE_TRACE } from './network/testing'
async function player() {
  const store = getAuthStore(undefined)
  const p = await store.createPlayer({ walletAddress: `NQ${crypto.randomUUID().replaceAll('-', '')}`, walletPublicKey: '00'.repeat(32) })
  const session = await store.createSession({ playerId: p.id, deviceHash: null, expiresAt: Date.now() + 60000 })
  const token = await createSessionToken({ SESSION_SECRET: 'test-session-secret' } as Env, { sessionId: session.id, playerId: p.id })
  return { p, cookie: `nr_session=${token}` }
}
function api(cookie: string, path = '', body?: unknown) { return SELF.fetch(`https://example.com/api/station${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }) }
describe('relay network custody', () => {
  it('shows a crew join code only to its members', async () => {
    const owner = await player(), outsider = await player()
    const created = await (await api(owner.cookie, '/network/crew/create', { name: 'Invite secret crew' })).json() as NetworkSnapshot
    const own = created.crews.find(crew => crew.name === 'Invite secret crew')
    expect(own?.code).toMatch(/^[A-Z0-9]+$/)
    const publicView = await (await api('', '/network/public')).json() as NetworkSnapshot
    expect(publicView.crews.find(crew => crew.id === own?.id)?.code).toBeNull()
    const outsiderView = await (await api(outsider.cookie, '/network')).json() as NetworkSnapshot
    expect(outsiderView.crews.find(crew => crew.id === own?.id)?.code).toBeNull()
  })
  it('keeps practice out of records and limits official Daily issuance', async () => {
    const a = await player()
    const before = await (await api(a.cookie)).json() as StationSnapshot
    const practice = await (await api(a.cookie, '/network/issue', { daily: true, practice: true })).json() as IssuedRace
    const result = await (await api(a.cookie, '/submit', { issued: practice, inputTrace: IDLE_TRACE })).json() as SubmittedRace
    expect(result.profile.xp).toBe(before.profile.xp)
    expect(result.profile.runs).toBe(before.profile.runs)
    const official = await (await api(a.cookie, '/network/issue', { daily: true })).json() as IssuedRace
    // v6: the official attempt races the practice course without the tether save and the ghostline practice rides get.
    expect(official.config).toEqual({ ...practice.config, tetherSaves: 0, ghostline: null })
    expect((await api(a.cookie, '/network/issue', { daily: true })).status).toBe(409)
    expect((await api(a.cookie, '/submit', { issued: {...practice, practice: false}, inputTrace: IDLE_TRACE })).status).toBe(401)
  })
  it('moves custody once, binds the next ghost, and protects attempted transfers', async () => {
    const a = await player(), b = await player()
    await api(b.cookie, '/network')
    const journey = await (await api(a.cookie, '/network/create', {mode:'global', title:'Custody test journey'})).json() as BatonDetail
    expect(journey.baton.holder.id).toBe(a.p.id)
    expect((await api(b.cookie, '/network/issue', {batonId:journey.baton.id})).status).toBe(403)
    const issued = await (await api(a.cookie, '/network/issue', {batonId:journey.baton.id})).json() as IssuedRace
    expect((await api(a.cookie, '/submit', {issued,inputTrace:finishingTrace(issued.config)})).status).toBe(200)
    const intent = await (await api(a.cookie, '/network/handoff/prepare', {runId:issued.runId,recipient:b.p.id})).json() as NetworkHandoffIntent
    expect(intent.data).toContain(journey.baton.code)
    expect((await api(b.cookie, '/network/handoff/attempt', {id:intent.id})).status).toBe(404)
    const hash = 'd'.repeat(64)
    expect((await api(a.cookie, '/network/handoff/confirm', {id:intent.id,txHash:hash})).status).toBe(409)
    expect((await api(a.cookie, '/network/handoff/attempt', {id:intent.id})).status).toBe(200)
    expect((await api(a.cookie, '/network/handoff/cancel', {id:intent.id})).status).toBe(409)
    const lookup = vi.spyOn(NimiqRpcClient.prototype, 'getTransactionByHash')
    try {
      const transaction = {hash,sender:intent.sender,recipient:intent.recipient,value:'100000',data:intent.data,network:'TestAlbatross',blockNumber:100,confirmations:1,executionResult:true}
      lookup.mockResolvedValue(transaction)
      const pending = await (await api(a.cookie, '/network/handoff/confirm', {id:intent.id,txHash:hash})).json() as {status:string}
      expect(pending.status).toBe('pending')
      const unchanged = await (await api('', `/network/batons/${journey.baton.code}`)).json() as BatonDetail
      expect(unchanged.baton.holder.id).toBe(a.p.id)
      lookup.mockResolvedValue({...transaction,confirmations:2})
      const verified = await (await api(a.cookie, '/network/handoff/confirm', {id:intent.id,txHash:hash})).json() as {status:string}
      expect(verified.status).toBe('verified')
      await api(a.cookie, '/network/handoff/confirm', {id:intent.id,txHash:hash})
      const after = await (await api('', `/network/batons/${journey.baton.code}`)).json() as BatonDetail
      expect(after.baton.holder.id).toBe(b.p.id)
      expect(after.handoffs).toHaveLength(1)
      expect(after.ghost?.runId).toBe(issued.runId)
      const next = await (await api(b.cookie, '/network/issue', {batonId:journey.baton.id})).json() as IssuedRace
      // v6 legs share the sector course; opening FLOW is inherited from the previous run and the ghostline derived from it.
      expect({...next.config, openingFlow: 0, ghostline: null}).toEqual({...issued.config, openingFlow: 0})
      expect(next.ghost?.runId).toBe(issued.runId)
      expect(next.config.engineVersion === '6' && next.config.ghostline !== null).toBe(true)
      const inbox = await (await api(b.cookie, '/network')).json() as NetworkSnapshot
      expect(inbox.inbox.some(n=>n.type==='incoming_baton'&&n.batonId===journey.baton.id)).toBe(true)
      expect((await api(a.cookie, '/network/issue', {batonId:journey.baton.id})).status).toBe(403)
    } finally { lookup.mockRestore() }
  })
  it('keeps invite secrets out of snapshots and reserves the claimed recipient', async () => {
    const a=await player(), b=await player(), c=await player()
    await api(b.cookie,'/network');await api(c.cookie,'/network')
    const journey=await (await api(a.cookie,'/network/create',{mode:'global',title:'Private invitation'})).json() as BatonDetail
    const invite=await (await api(a.cookie,'/network/invite',{batonId:journey.baton.id})).json() as {token:string}
    expect(invite.token).toHaveLength(64)
    const snapshot=await (await api(a.cookie,'/network')).text()
    expect(snapshot).not.toContain(invite.token)
    expect((await api('',`/network/invites/${invite.token}`)).status).toBe(200)
    expect((await api(b.cookie,'/network/invite/claim',{token:invite.token})).status).toBe(200)
    expect((await api(c.cookie,'/network/invite/claim',{token:invite.token})).status).toBe(409)
  })
  // Relay legs inherit opening FLOW from the previous run, so identical traces no longer guarantee tied rounds.
  // Round outcomes come from the server-replayed scores; the tie rule itself is covered in network/rules.test.ts.
  it('settles a best-of-three from verified round scores and returns the baton to its origin', async () => {
    const a=await player(),b=await player();await api(b.cookie,'/network')
    const journey=await (await api(a.cookie,'/network/create',{mode:'quick',title:'Three fair rounds',recipient:b.p.id,bestOf:3})).json() as BatonDetail
    const lookup=vi.spyOn(NimiqRpcClient.prototype,'getTransactionByHash')
    const wins={[a.p.id]:0,[b.p.id]:0}
    let rounds=0,openingScore=0,leg=0
    try {
      while(rounds<3&&wins[a.p.id]!<2&&wins[b.p.id]!<2){
        const from=leg%2===0?a:b,to=leg%2===0?b:a
        const issued=await (await api(from.cookie,'/network/issue',{batonId:journey.baton.id})).json() as IssuedRace
        const submitted=await api(from.cookie,'/submit',{issued,inputTrace:finishingTrace(issued.config)})
        expect(submitted.status).toBe(200)
        const {result}=await submitted.json() as SubmittedRace
        const intent=await (await api(from.cookie,'/network/handoff/prepare',{runId:issued.runId,recipient:to.p.id})).json() as NetworkHandoffIntent
        await api(from.cookie,'/network/handoff/attempt',{id:intent.id})
        const hash=(leg+1).toString(16).repeat(64)
        lookup.mockResolvedValue({hash,sender:intent.sender,recipient:intent.recipient,value:'100000',data:intent.data,network:'TestAlbatross',blockNumber:100+leg,confirmations:2,executionResult:true})
        const confirmation=await (await api(from.cookie,'/network/handoff/confirm',{id:intent.id,txHash:hash})).json() as {status:string}
        expect(confirmation.status).toBe('verified')
        if(leg%2===0)openingScore=result.score
        else{rounds++;if(openingScore>result.score)wins[a.p.id]!++;else if(result.score>openingScore)wins[b.p.id]!++}
        leg++
      }
      const expectedWinner=wins[a.p.id]===wins[b.p.id]?null:wins[a.p.id]!>wins[b.p.id]!?a.p.id:b.p.id
      const final=await (await api('',`/network/batons/${journey.baton.id}`)).json() as BatonDetail
      expect(final.baton.status).toBe('completed')
      expect(final.baton.holder.id).toBe(a.p.id)
      expect(final.baton.quick?.rounds).toBe(rounds)
      expect(final.baton.quick?.winnerId).toBe(expectedWinner)
      expect(final.handoffs).toHaveLength(rounds*2)
    }finally{lookup.mockRestore()}
  })

  it('qualifies crew passes between members and completes two independent rival routes', async () => {
    const a=await player(),b=await player(),outsider=await player()
    await api(b.cookie,'/network');await api(outsider.cookie,'/network')
    const crewState=await (await api(a.cookie,'/network/crew/create',{name:'Continuity crew'})).json() as NetworkSnapshot
    const crew=crewState.crews.find(c=>c.members.some(m=>m.id===a.p.id))!
    await api(b.cookie,'/network/crew/join',{code:crew.code})
    const journey=await (await api(a.cookie,'/network/create',{mode:'crew',title:'Crew continuity',crewId:crew.id})).json() as BatonDetail
    const lookup=vi.spyOn(NimiqRpcClient.prototype,'getTransactionByHash')
    let number=80
    async function pass(batonId:string,from:Awaited<ReturnType<typeof player>>,to:Awaited<ReturnType<typeof player>>) {
      const issued=await (await api(from.cookie,'/network/issue',{batonId})).json() as IssuedRace
      await api(from.cookie,'/submit',{issued,inputTrace:finishingTrace(issued.config)})
      if(batonId===journey.baton.id)expect((await api(from.cookie,'/network/handoff/prepare',{runId:issued.runId,recipient:outsider.p.id})).status).toBe(400)
      const intent=await (await api(from.cookie,'/network/handoff/prepare',{runId:issued.runId,recipient:to.p.id})).json() as NetworkHandoffIntent
      await api(from.cookie,'/network/handoff/attempt',{id:intent.id})
      const hash=(number++).toString(16).repeat(32)
      lookup.mockResolvedValue({hash,sender:intent.sender,recipient:intent.recipient,value:'100000',data:intent.data,network:'TestAlbatross',blockNumber:200,confirmations:2,executionResult:true})
      const confirmation=await (await api(from.cookie,'/network/handoff/confirm',{id:intent.id,txHash:hash})).json() as {status:string}
      expect(confirmation.status).toBe('verified')
    }
    try {
      await pass(journey.baton.id,a,b)
      const state=await (await api(a.cookie,'/network')).json() as NetworkSnapshot
      const current=state.crews.find(c=>c.id===crew.id)!
      expect(current.streak).toBe(1);expect(current.todayHandoffs).toBe(1);expect(current.contributions[a.p.id]).toBe(1)
      const rivalry=await (await api(a.cookie,'/network/rival/create',{title:'Independent routes',opponent:b.p.id,target:2})).json() as NetworkSnapshot
      const rival=rivalry.rivals.find(r=>r.title==='Independent routes')!
      expect(rival.batonIds[0]).not.toBe(rival.batonIds[1])
      await pass(rival.batonIds[0],a,b);await pass(rival.batonIds[0],b,a)
      const finished=await (await api(a.cookie,'/network')).json() as NetworkSnapshot
      expect(finished.rivals.find(r=>r.id===rival.id)?.scores).toEqual([2,0])
      expect(finished.rivals.find(r=>r.id===rival.id)?.winnerId).toBe(rival.batonIds[0])
      expect(finished.batons.find(b=>b.id===rival.batonIds[1])?.holder.id).toBe(b.p.id)
    }finally{lookup.mockRestore()}
  })

})
