/**
 * Builds the v5 courier bodies from CC0 Quaternius assets.
 *
 *   node scripts/assets/build-courier-v5.mjs <assets-staging-dir>
 *
 * Inputs (Universal Base Characters + Universal Animation Library, CC0 1.0):
 *   characters/quaternius-universal-base-characters/Superhero_{Male,Female}_FullBody.gltf
 *   characters/quaternius-universal-animation-library/UAL{1,2}_Standard.glb
 *
 * Outputs:
 *   apps/web/public/assets/courier-v5.glb         male body, skeleton and the race clips
 *   apps/web/public/assets/courier-v5-female.glb  female body and skeleton (clips bind by bone name)
 *
 * The race dresses the body in a procedural suit, so hair, eyes, textures and
 * unused vertex attributes are dropped. Clips keep bone rotations only (plus
 * pelvis height, rescaled to the body) so the library mannequin's proportions
 * never leak into the courier.
 */
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { dedup, meshopt, prune, resample, weld } from '@gltf-transform/functions'
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer'
import { statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const repo = path.resolve(here, '../..')
if (!process.argv[2]) {
  console.error('usage: node scripts/assets/build-courier-v5.mjs <assets-staging-dir>')
  process.exit(1)
}
const staging = path.resolve(process.argv[2])
const characters = path.join(staging, 'characters')
const outputDir = path.join(repo, 'apps/web/public/assets')

/** Clip name in the library -> name used by the race. */
const CLIPS = new Map([
  ['Idle_Loop', 'idle'],
  ['Crouch_Idle_Loop', 'ride'],
  ['NinjaJump_Start', 'jump-start'],
  ['NinjaJump_Idle_Loop', 'air'],
  ['NinjaJump_Land', 'land'],
  ['Slide_Start', 'slide-start'],
  ['Slide_Loop', 'slide'],
  ['Hit_Chest', 'hit'],
  ['OverhandThrow', 'throw'],
  ['Yes', 'victory'],
])

/** Hair and eyes sit under the helmet. */
const DROP_MATERIALS = /hair|eye/i
const KEEP_ATTRIBUTES = new Set(['POSITION', 'NORMAL', 'JOINTS_0', 'WEIGHTS_0'])

await MeshoptEncoder.ready
await MeshoptDecoder.ready
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder })

function nodeByName(document, name) {
  return document.getRoot().listNodes().find(node => node.getName() === name) ?? null
}

/** Strips everything the procedural suit replaces. */
function slimBody(document) {
  const root = document.getRoot()
  for (const node of root.listNodes()) {
    const mesh = node.getMesh()
    if (mesh && mesh.listPrimitives().every(primitive => DROP_MATERIALS.test(primitive.getMaterial()?.getName() ?? ''))) node.dispose()
  }
  for (const mesh of root.listMeshes()) {
    for (const primitive of mesh.listPrimitives()) {
      for (const semantic of primitive.listSemantics()) {
        if (!KEEP_ATTRIBUTES.has(semantic)) primitive.setAttribute(semantic, null)
      }
      const material = primitive.getMaterial()
      if (material) {
        material.setBaseColorTexture(null).setNormalTexture(null).setMetallicRoughnessTexture(null)
        material.setName('suit')
      }
    }
    mesh.setName('courier-body')
  }
  for (const texture of root.listTextures()) texture.dispose()
}

function copyAccessor(target, source) {
  return target
    .createAccessor()
    .setType(source.getType())
    .setArray(source.getArray().slice())
    .setNormalized(source.getNormalized())
}

/** Copies the race clips from an animation library onto the body's skeleton, rotations only. */
function copyClips(body, library, restPelvisHeight) {
  const libraryPelvis = nodeByName(library, 'pelvis')
  const pelvisScale = restPelvisHeight / libraryPelvis.getTranslation()[2]
  let copied = 0
  for (const animation of library.getRoot().listAnimations()) {
    const name = CLIPS.get(animation.getName())
    if (!name) continue
    const clip = body.createAnimation(name)
    for (const channel of animation.listChannels()) {
      const targetName = channel.getTargetNode()?.getName()
      const pathName = channel.getTargetPath()
      if (!targetName || targetName.includes('_leaf')) continue
      const keepTranslation = pathName === 'translation' && targetName === 'pelvis'
      if (pathName !== 'rotation' && !keepTranslation) continue
      const node = nodeByName(body, targetName)
      if (!node) continue
      const sourceSampler = channel.getSampler()
      const output = copyAccessor(body, sourceSampler.getOutput())
      if (keepTranslation) {
        const values = output.getArray()
        for (let i = 0; i < values.length; i++) values[i] *= pelvisScale
        output.setArray(values)
      }
      const sampler = body
        .createAnimationSampler()
        .setInput(copyAccessor(body, sourceSampler.getInput()))
        .setOutput(output)
        .setInterpolation(sourceSampler.getInterpolation())
      clip.addSampler(sampler)
      clip.addChannel(body.createAnimationChannel().setTargetNode(node).setTargetPath(pathName).setSampler(sampler))
    }
    copied++
  }
  return copied
}

async function finalize(document, file) {
  await document.transform(
    weld(),
    resample({ tolerance: 0.0008 }),
    prune({ keepLeaves: true, keepAttributes: false }),
    dedup(),
    meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
  )
  await io.write(file, document)
  return statSync(file).size
}

async function buildMale() {
  const body = await io.read(path.join(characters, 'quaternius-universal-base-characters/Superhero_Male_FullBody.gltf'))
  slimBody(body)
  const restPelvisHeight = nodeByName(body, 'pelvis').getTranslation()[2]
  let clips = 0
  for (const library of ['UAL1_Standard.glb', 'UAL2_Standard.glb']) {
    clips += copyClips(body, await io.read(path.join(characters, 'quaternius-universal-animation-library', library)), restPelvisHeight)
  }
  if (clips !== CLIPS.size) throw new Error(`Expected ${CLIPS.size} clips, copied ${clips}`)
  const file = path.join(outputDir, 'courier-v5.glb')
  return { file, size: await finalize(body, file), clips }
}

async function buildFemale() {
  const body = await io.read(path.join(characters, 'quaternius-universal-base-characters/Superhero_Female_FullBody.gltf'))
  slimBody(body)
  const file = path.join(outputDir, 'courier-v5-female.glb')
  return { file, size: await finalize(body, file) }
}

const male = await buildMale()
const female = await buildFemale()
for (const result of [male, female]) {
  console.log(`${path.relative(repo, result.file)}  ${(result.size / 1024).toFixed(1)} KiB`)
}
