import { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { Vector3, Color3, Color4 } from '@babylonjs/core/Maths/math';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { MAP_SIZE, TILE_SIZE } from '@projectrs/shared';

// Get canvas and create engine
const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
const engine = new Engine(canvas, true, { antialias: true });

// Create scene
const scene = new Scene(engine);
scene.clearColor = new Color4(0.4, 0.6, 0.9, 1.0); // Sky blue

// Camera — isometric-style orbit camera looking down at the world
const camera = new ArcRotateCamera(
  'camera',
  -Math.PI / 4,    // alpha (horizontal rotation)
  Math.PI / 3,     // beta (vertical angle — ~60 degrees from top)
  30,              // radius (zoom distance)
  new Vector3(MAP_SIZE / 2, 0, MAP_SIZE / 2), // target center of map
  scene
);
camera.lowerBetaLimit = 0.3;
camera.upperBetaLimit = Math.PI / 2.5;
camera.lowerRadiusLimit = 10;
camera.upperRadiusLimit = 60;
camera.attachControl(canvas, true);

// Lighting
const ambientLight = new HemisphericLight('ambient', new Vector3(0, 1, 0), scene);
ambientLight.intensity = 0.5;
ambientLight.groundColor = new Color3(0.3, 0.3, 0.35);

const sunLight = new DirectionalLight('sun', new Vector3(-0.5, -1, -0.3), scene);
sunLight.intensity = 0.8;

// Ground plane — green grass
const ground = MeshBuilder.CreateGround(
  'ground',
  { width: MAP_SIZE * TILE_SIZE, height: MAP_SIZE * TILE_SIZE },
  scene
);
ground.position.x = MAP_SIZE / 2;
ground.position.z = MAP_SIZE / 2;

const groundMat = new StandardMaterial('groundMat', scene);
groundMat.diffuseColor = new Color3(0.3, 0.55, 0.2); // Green grass
groundMat.specularColor = new Color3(0, 0, 0); // No specular shine
ground.material = groundMat;

// Grid lines for tile visibility (debug helper)
const gridMat = new StandardMaterial('gridMat', scene);
gridMat.diffuseColor = new Color3(0.25, 0.5, 0.18);
gridMat.specularColor = new Color3(0, 0, 0);
gridMat.wireframe = true;

const gridGround = MeshBuilder.CreateGround(
  'grid',
  {
    width: MAP_SIZE * TILE_SIZE,
    height: MAP_SIZE * TILE_SIZE,
    subdivisions: MAP_SIZE,
  },
  scene
);
gridGround.position.x = MAP_SIZE / 2;
gridGround.position.z = MAP_SIZE / 2;
gridGround.position.y = 0.01; // Slightly above ground to avoid z-fighting
gridGround.material = gridMat;

// Placeholder player — simple box for now (will be billboard sprite later)
const player = MeshBuilder.CreateBox('player', { width: 0.6, height: 1.5, depth: 0.6 }, scene);
player.position = new Vector3(MAP_SIZE / 2, 0.75, MAP_SIZE / 2);

const playerMat = new StandardMaterial('playerMat', scene);
playerMat.diffuseColor = new Color3(0.2, 0.4, 0.9); // Blue
playerMat.specularColor = new Color3(0, 0, 0);
player.material = playerMat;

// Render loop
engine.runRenderLoop(() => {
  scene.render();
});

// Handle resize
window.addEventListener('resize', () => {
  engine.resize();
});

console.log('ProjectRS client initialized');
