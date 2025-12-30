import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { randomRange } from './utils.js';

export class InfiniteTerrain {
    constructor(scene, world) {
        this.scene = scene;
        this.world = world;
        this.chunks = [];
        this.chunkLength = 200; // Longer chunks
        this.chunkWidth = 150;  // Wider terrain
        
        // Physics material
        this.mat = new CANNON.Material();
        this.mat.friction = 0.3;

        // Initialize with chunks behind and ahead
        // Player starts at Z=0.
        // We want chunks covering Z=100 down to Z=-500 initially
        this.createChunk(this.chunkLength);    // Z center +200 (Backdrop)
        this.createChunk(0);                   // Z center 0 (Start)
        this.createChunk(-this.chunkLength);   // Z center -200 (Ahead)
        this.createChunk(-this.chunkLength*2); // Z center -400 (Far Ahead)
    }

    // Mathematical definition of the mountain shape
    getHeightAt(x, z) {
        // Base Slope: Downhill as Z decreases
        // We want Z decreasing to go DOWN.
        let y = z * 0.4;

        // Flatten the start area slightly to ensure a safe landing pad
        if (z > -10 && z < 10) {
            // Slight smoothing around origin
            y = (z * 0.4) * 0.5; // Flatter slope at start
        }

        // Add a "bowl" shape so the player stays in the middle naturally
        y += Math.pow(Math.abs(x) / 15, 2.5);

        // Add noise/hills
        y += Math.sin(z * 0.05) * 2;
        y += Math.cos(x * 0.1) * 1;
        
        // High frequency roughness
        y += Math.sin(z * 0.2) * 0.5;
        
        return y;
    }

    createChunk(zCenter) {
        // zCenter is the center of this chunk along Z axis
        
        const segmentsW = 30;
        const segmentsH = 30;
        const geometry = new THREE.PlaneGeometry(this.chunkWidth, this.chunkLength, segmentsW, segmentsH);
        
        const posAttribute = geometry.attributes.position;
        // Vertices for physics (local to the body/mesh)
        const vertices = [];
        const indices = [];

        // Deform Plane
        // We want to modify the Local Z of the plane (which becomes World Y after rotation).
        // Mapping: 
        // Mesh Rotation X = -90 degrees (-PI/2)
        // Mesh Position = (0, 0, zCenter)
        //
        // Local (lx, ly, lz) -> World
        // RotX(-90) * (lx, ly, lz) = (lx, lz, -ly) (approx, verifying below)
        // With +Y (up in plane) mapping to -Z (forward in world)
        // Local Y+ is "Top" of plane. Rotated -90X, it points to -Z (Away/Forward).
        //
        // So:
        // WorldX = lx
        // WorldZ = zCenter - ly  (If ly is positive (top), it maps to zCenter - ly (lower z))
        
        for (let i = 0; i < posAttribute.count; i++) {
            const lx = posAttribute.getX(i);
            const ly = posAttribute.getY(i); 
            
            // Calculate corresponding World X/Z to sample noise
            const worldX = lx;
            const worldZ = zCenter - ly; 
            
            // Get Height
            const height = this.getHeightAt(worldX, worldZ);
            
            // Set Local Z to height
            posAttribute.setZ(i, height);
            
            // Store Local Vertex for Physics Trimesh
            vertices.push(lx, ly, height);
        }

        geometry.computeVertexNormals();

        // Texture - simple grid/checker or noise
        if (!this.sharedTexture) {
             const canvas = document.createElement('canvas');
             canvas.width = 256;
             canvas.height = 256;
             const ctx = canvas.getContext('2d');
             // Base Grass
             ctx.fillStyle = '#68a045'; 
             ctx.fillRect(0,0,256,256);
             // Noise
             for(let k=0; k<1000; k++) {
                 ctx.fillStyle = Math.random() > 0.5 ? '#7cb356' : '#558b35';
                 ctx.fillRect(Math.random()*256, Math.random()*256, 4, 4);
             }
             // Grid lines
             ctx.strokeStyle = 'rgba(255,255,255,0.1)';
             ctx.lineWidth = 2;
             ctx.beginPath();
             for(let i=0; i<=256; i+=32) {
                 ctx.moveTo(i, 0); ctx.lineTo(i, 256);
                 ctx.moveTo(0, i); ctx.lineTo(256, i);
             }
             ctx.stroke();
             
             this.sharedTexture = new THREE.CanvasTexture(canvas);
             this.sharedTexture.wrapS = THREE.RepeatWrapping;
             this.sharedTexture.wrapT = THREE.RepeatWrapping;
             this.sharedTexture.repeat.set(this.chunkWidth/10, this.chunkLength/10);
        }

        const material = new THREE.MeshStandardMaterial({ 
            map: this.sharedTexture,
            roughness: 0.8,
            metalness: 0.1,
            side: THREE.DoubleSide,
            flatShading: true // Low poly look
        });

        const mesh = new THREE.Mesh(geometry, material);
        // Align Mesh
        mesh.rotation.x = -Math.PI / 2;
        mesh.position.set(0, 0, zCenter);
        
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        this.scene.add(mesh);

        // Physics Body
        // Trimesh indices
        for (let i = 0; i < geometry.index.count; i++) {
            indices.push(geometry.index.array[i]);
        }

        // Create Trimesh from LOCAL vertices
        const shape = new CANNON.Trimesh(vertices, indices);
        const body = new CANNON.Body({ mass: 0, material: this.mat });
        body.addShape(shape);
        
        // Align Body EXACTLY like Mesh
        body.position.copy(mesh.position);
        body.quaternion.copy(mesh.quaternion);
        
        this.world.addBody(body);

        this.chunks.push({ mesh, body, z: zCenter });
    }

    update(playerZ) {
        // Add new chunks ahead
        // Current lowest Z chunk
        const lastChunk = this.chunks[this.chunks.length - 1];
        if (playerZ < lastChunk.z + this.chunkLength) { 
            // Player is approaching the end of the known world
            // Generate next chunk at lastChunk.z - chunkLength
            this.createChunk(lastChunk.z - this.chunkLength);
        }

        // Remove old chunks
        if (this.chunks[0].z > playerZ + this.chunkLength * 2) {
            const chunk = this.chunks.shift();
            this.scene.remove(chunk.mesh);
            this.world.removeBody(chunk.body);
            chunk.mesh.geometry.dispose();
            // Don't dispose texture as it is shared
        }
    }
}