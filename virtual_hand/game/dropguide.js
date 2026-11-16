// Shows where a held object will land: a dashed line straight down to the table and a ring on the table.
// Grey while you are not over the target, green when opening the hand now would be a success.
import * as THREE from 'three';

export class DropGuide {
  constructor(parent, tableY = -0.09) {
    this.tableY = tableY;
    const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, -1, 0)]);
    this.mat = new THREE.LineDashedMaterial({ color: 0x8a8f98, dashSize: 0.008, gapSize: 0.006, transparent: true, opacity: 0.9 });
    this.line = new THREE.Line(g, this.mat);
    this.ringMat = new THREE.MeshBasicMaterial({ color: 0x8a8f98, transparent: true, opacity: 0.85, side: THREE.DoubleSide });
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.014, 0.019, 32), this.ringMat);
    this.ring.rotation.x = -Math.PI / 2;
    this.group = new THREE.Group(); this.group.add(this.line, this.ring); this.group.visible = false;
    parent.add(this.group);
  }

  // the line goes from the held object to a landing spot on the target row (the targets lie at one depth,
  // the hand can not move in depth, so the ring is drawn on that row: what you see is what counts)
  showTo(pos, land, near) {
    const a = this.line.geometry.attributes.position;
    this.line.position.copy(pos);
    a.setXYZ(1, land.x - pos.x, land.y - pos.y, land.z - pos.z); a.needsUpdate = true;
    this.line.computeLineDistances();
    this.ring.position.set(land.x, land.y + 0.001, land.z);
    const c = near ? 0x1baf7a : 0x8a8f98;
    this.mat.color.setHex(c); this.ringMat.color.setHex(c);
    this.ring.scale.setScalar(near ? 1.25 : 1);
    this.group.visible = true;
  }

  // pos: bottom of the held object (world), floorY: where it would land (table or top of the tower)
  show(pos, floorY, near) {
    this.line.geometry.attributes.position.setXYZ(1, 0, -1, 0);
    const y0 = pos.y, y1 = Math.min(y0, floorY);
    this.line.position.set(pos.x, y0, pos.z);
    const a = this.line.geometry.attributes.position;
    a.setY(1, -Math.max(0.001, y0 - y1)); a.needsUpdate = true;
    this.line.computeLineDistances();
    this.ring.position.set(pos.x, y1 + 0.001, pos.z);
    const c = near ? 0x1baf7a : 0x8a8f98;
    this.mat.color.setHex(c); this.ringMat.color.setHex(c);
    this.ring.scale.setScalar(near ? 1.25 : 1);
    this.group.visible = true;
  }

  hide() { this.group.visible = false; }
}

// Is the object over the target AS YOU SEE IT on the screen? Compares the screen position of the object with the
// screen position of the target centre (left/right). Returns the distance in metres along the target row, or null.
export function screenDx(camera, objPos, targetPos) {
  if (!camera) return objPos.x - targetPos.x;
  const o = objPos.clone().project(camera), t = targetPos.clone().project(camera);
  const t2 = targetPos.clone().add(new THREE.Vector3(0.05, 0, 0)).project(camera);   // 5 cm on the row -> screen units
  const per = (t2.x - t.x) / 0.05 || 1;
  return (o.x - t.x) / per;
}
