import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

const loader = new GLTFLoader()
const cache = new Map()
const animCache = new Map()

function buildCenteredPivotGroup(sourceScene) {
  const content = sourceScene.clone(true)
  content.updateMatrixWorld(true)

  const box = new THREE.Box3().setFromObject(content)
  const center = new THREE.Vector3()
  const size = new THREE.Vector3()

  box.getCenter(center)
  box.getSize(size)

  const pivot = new THREE.Group()
  pivot.name = 'asset-pivot'

  // move content so pivot becomes bottom-center
  content.position.x -= center.x
  content.position.y -= box.min.y
  content.position.z -= center.z
  content.updateMatrixWorld(true)

  pivot.add(content)

  // useful metadata for snapping later if needed
  pivot.userData.bounds = {
    width: size.x,
    height: size.y,
    depth: size.z
  }

  return pivot
}

export async function loadAssetModel(path) {
  if (!cache.has(path)) {
    const gltf = await loader.loadAsync(path)
    const centered = buildCenteredPivotGroup(gltf.scene)
    cache.set(path, centered)
    animCache.set(path, gltf.animations || [])
  }

  return cache.get(path).clone(true)
}

export function getAssetAnimations(path) {
  return animCache.get(path) || []
}

export function makeGhostMaterial(object) {
  const ghost = object.clone(true)

  ghost.traverse((obj) => {
    if (!obj.isMesh) return

    obj.material = new THREE.MeshLambertMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.55
    })
  })

  return ghost
}