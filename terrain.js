import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { randomRange } from './utils.js';

export class InfiniteTerrain {
    constructor(scene, world) {
        this.scene = scene;
        this.world = world;
        this.chunks = [];
        this.chunkSize = 100;
        this.chunkWidth = 100;
        this.lastChunkZ = 0;
        
        // Physics material
        this.mat = new CANNON.Material();
        this.mat.friction = 0.3;

        // Initial platform
        this.createChunk(0, true);
        this.createChunk(-this.chunkSize, false);
        this.createChunk(-this.chunkSize * 2, false);
    }

    createChunk(zPosition, isStartPlatform) {
        // Visual Mesh
        const geometry = new THREE.PlaneGeometry(this.chunkWidth, this.chunkSize, 20, 20);
        
        // Modify height for slopes
        const posAttribute = geometry.attributes.position;
        const cannonShapeData = [];
        
        for (let i = 0; i < posAttribute.count; i++) {
            const x = posAttribute.getX(i);
            const y = posAttribute.getY(i);
            // Z in PlaneGeometry is actually Y in world space before rotation
            // We will rotate -90 deg X later.
            
            let zHeight = 0;

            if (!isStartPlatform) {
                // Generate noise/hills
                // Simple sine waves for "rolling hills"
                // Add global slope downward
                const globalZ = zPosition + y; // y runs from +50 to -50 relative to center
                
                // Downward slope equation: y = x * slope
                // We want to roll down -Z. So height should decrease as Z decreases.
                // But here we are manipulating local Z (height) of the plane.
                
                // Noise
                zHeight += Math.sin(x * 0.1) * 2; 
                zHeight += Math.sin((globalZ) * 0.1) * 2;
                
                // Bowl shape to keep player in center
                zHeight += Math.pow(Math.abs(x) / 10, 2); 
            }
            
            posAttribute.setZ(i, zHeight);
        }

        geometry.computeVertexNormals();

        // Texture
        const canvas = document.createElement('canvas');
        canvas.width = 128;
        canvas.height = 128;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#4CAF50'; // Grass
        ctx.fillRect(0,0,128,128);
        ctx.fillStyle = '#388E3C';
        for(let k=0; k<50; k++) {
            ctx.fillRect(Math.random()*128, Math.random()*128, 4, 4);
        }
        
        const texture = new THREE.CanvasTexture(canvas);
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        texture.repeat.set(10, 10);

        const material = new THREE.MeshStandardMaterial({ 
            map: texture,
            side: THREE.DoubleSide
        });

        const mesh = new THREE.Mesh(geometry, material);
        mesh.rotation.x = -Math.PI / 2;
        mesh.position.set(0, -2, zPosition - (this.chunkSize/2)); // Adjust pivot
        
        // Tilt the whole chunk for the hill effect
        // Instead of tilting mesh, we built slope into the height data relative to global Z? 
        // Actually, easiest way is to rotate the mesh slightly.
        const slopeAngle = 0.2; // Radians down
        mesh.rotation.x -= slopeAngle;
        
        // Adjust Y position so it connects to previous
        // This is tricky with rotation.
        // Simplification: Just step down Y based on Z
        mesh.position.y = (zPosition * Math.sin(slopeAngle));
        
        this.scene.add(mesh);
        mesh.receiveShadow = true;

        // Physics Body (Heightfield or Trimesh)
        // For dynamic terrain, Trimesh is often easier to position than Heightfield in Cannon
        
        // Convert Three geometry to Cannon Trimesh
        const vertices = [];
        const indices = [];
        
        for (let i = 0; i < posAttribute.count; i++) {
            vertices.push(posAttribute.getX(i), posAttribute.getY(i), posAttribute.getZ(i));
        }
        
        // Plane geometry faces are indexed
        for (let i = 0; i < geometry.index.count; i++) {
            indices.push(geometry.index.array[i]);
        }
        
        const shape = new CANNON.Trimesh(vertices, indices);
        const body = new CANNON.Body({ mass: 0, material: this.mat });
        body.addShape(shape);
        
        // Align physics body with visual mesh
        body.position.copy(mesh.position);
        body.quaternion.copy(mesh.quaternion);
        
        this.world.addBody(body);

        this.chunks.push({ mesh, body, z: zPosition });
        this.lastChunkZ = zPosition - this.chunkSize;
    }

    update(playerZ) {
        // Remove old chunks
        if (this.chunks.length > 0 && this.chunks[0].z > playerZ + this.chunkSize) {
            const chunk = this.chunks.shift();
            this.scene.remove(chunk.mesh);
            this.world.removeBody(chunk.body);
            chunk.mesh.geometry.dispose();
            chunk.mesh.material.dispose();
        }

        // Add new chunks
        if (this.chunks[this.chunks.length - 1].z > playerZ - (this.chunkSize * 2)) {
            this.createChunk(this.lastChunkZ, false);
        }
    }
}