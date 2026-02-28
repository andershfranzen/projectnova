import { Scene } from '@babylonjs/core/scene';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { SpawnsFile } from '@projectrs/shared';

export class SpawnMarkers {
  private scene: Scene;
  private markers: Mesh[] = [];
  private npcMat: StandardMaterial;
  private objMat: StandardMaterial;

  constructor(scene: Scene) {
    this.scene = scene;

    this.npcMat = new StandardMaterial('npcMarkerMat', scene);
    this.npcMat.diffuseColor = new Color3(0.8, 0.2, 0.2);
    this.npcMat.emissiveColor = new Color3(0.3, 0.05, 0.05);

    this.objMat = new StandardMaterial('objMarkerMat', scene);
    this.objMat.diffuseColor = new Color3(0.2, 0.8, 0.3);
    this.objMat.emissiveColor = new Color3(0.05, 0.3, 0.08);
  }

  rebuild(spawns: SpawnsFile, getHeight: (x: number, z: number) => number): void {
    this.dispose();

    for (const npc of spawns.npcs) {
      const marker = MeshBuilder.CreateBox(`npc_${npc.npcId}_${npc.x}_${npc.z}`, { width: 0.4, height: 1.2, depth: 0.4 }, this.scene);
      marker.material = this.npcMat;
      const y = getHeight(npc.x, npc.z);
      marker.position.set(npc.x, y + 0.6, npc.z);
      marker.isPickable = false;
      this.markers.push(marker);
    }

    for (const obj of (spawns.objects ?? [])) {
      const marker = MeshBuilder.CreateBox(`obj_${obj.objectId}_${obj.x}_${obj.z}`, { width: 0.5, height: 0.5, depth: 0.5 }, this.scene);
      marker.material = this.objMat;
      const y = getHeight(obj.x, obj.z);
      marker.position.set(obj.x, y + 0.25, obj.z);
      marker.isPickable = false;
      this.markers.push(marker);
    }
  }

  dispose(): void {
    for (const m of this.markers) m.dispose();
    this.markers = [];
  }
}
