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
        this.mat.friction = 0.6;
        this.mat.restitution = 0.0; // No bounce (squishy/inelastic)

        // Initialize with chunks behind and ahead
        // Player starts at Z=0.
        // We want chunks covering Z=-200 up to Z=600 initially for +Z travel
        this.createChunk(-this.chunkLength);   // Z center -200 (Backdrop)
        this.createChunk(0);                   // Z center 0 (Start)
        this.createChunk(this.chunkLength);    // Z center 200 (Ahead)
        this.createChunk(this.chunkLength*2);  // Z center 400 (Far Ahead)
    }

    // Mathematical definition of the mountain shape
    getHeightAt(x, z) {
        // 1. Z-Axis Profile: Alternating Steep Drops and Flat Straightaways
        // We use a math function where the derivative (slope) oscillates.
        // Base slope is linear descent, Sine wave modulates it.
        // y = -A*z + B*sin(f*z)
        // Slope = -A + B*f*cos(f*z)
        // We want Slope to range from roughly -1.0 (steep) to -0.05 (almost flat).
        
        const freq = 0.015; // Wavelength ~ 420 units
        // To get flat spots, the positive cosine part must almost cancel the negative constant.
        // constant = -0.5
        // cosine amp = 0.45
        // slope range: [-0.95, -0.05] (Always downhill, never uphill)
        // Amplitude B = 0.45 / freq = 30
        
        let y = -0.5 * z + 30 * Math.sin(z * freq);

        // 2. X-Axis Profile: "Pipe" or "Bowl" shape
        // Keeps player centered.
        // Gentle quadratic curve.
        y += Math.pow(x / 15, 2) * 1.5;

        // 3. Banking/Camber
        // Bank turns slightly based on the terrain waviness to keep it interesting visually
        y += Math.cos(z * 0.02) * Math.sin(x * 0.05) * 2;

        return y;
    }

    createChunk(zCenter) {
        // Use CANNON.Heightfield for solid terrain (no falling through)
        // Must align Visual Grid with Physics Grid
        const elementSize = 5; 
        const segmentsW = Math.round(this.chunkWidth / elementSize); // 150 / 5 = 30
        const segmentsH = Math.round(this.chunkLength / elementSize); // 200 / 5 = 40

        // 1. Generate Height Data
        // Cannon Heightfield data[i][j] where i=x, j=y
        // We rotate body -90 X. 
        // Local X -> World X
        // Local Y -> World -Z (Front)
        // Local Z -> World Y (Height)
        
        const data = [];
        
        for (let i = 0; i <= segmentsW; i++) {
            const row = [];
            for (let j = 0; j <= segmentsH; j++) {
                // Map Grid indices to World Coordinates
                // Local X = i * elementSize. Center offset = -width/2
                const worldX = (i * elementSize) - (this.chunkWidth / 2);
                
                // Local Y = j * elementSize. 
                // Local Y maps to World -Z. 
                // Origin of body (j=0) will be at World Z Max (Front of chunk)
                // World Z Max for chunk = zCenter + length/2
                // World Z = (zCenter + length/2) - (j * elementSize)
                const worldZ = (zCenter + this.chunkLength/2) - (j * elementSize);
                
                const h = this.getHeightAt(worldX, worldZ);
                row.push(h);
            }
            data.push(row);
        }

        // Physics Body
        const hfShape = new CANNON.Heightfield(data, {
            elementSize: elementSize
        });
        
        const body = new CANNON.Body({ mass: 0, material: this.mat });
        body.addShape(hfShape);
        
        // Position Body
        // X: centered (-width/2)
        // Y: 0 (heights are added to this)
        // Z: Front edge (zCenter + length/2)
        body.position.set(-this.chunkWidth/2, 0, zCenter + this.chunkLength/2);
        
        // Rotate -90 X to align heightfield Z with World Y
        const q = new CANNON.Quaternion();
        q.setFromAxisAngle(new CANNON.Vec3(1,0,0), -Math.PI/2);
        body.quaternion.copy(q);
        
        this.world.addBody(body);

        // 2. Visual Mesh - Align with Physics Data
        const geometry = new THREE.PlaneGeometry(this.chunkWidth, this.chunkLength, segmentsW, segmentsH);
        const posAttribute = geometry.attributes.position;
        
        for (let k = 0; k < posAttribute.count; k++) {
            const lx = posAttribute.getX(k);
            const ly = posAttribute.getY(k);
            
            // Map Vertex to Grid Index
            // lx ranges [-width/2, width/2]
            const i = Math.round((lx + this.chunkWidth/2) / elementSize);
            
            // ly ranges [length/2, -length/2] (Top to Bottom)
            // Top (ly=length/2) maps to Back (World Z Min)
            // Bottom (ly=-length/2) maps to Front (World Z Max)
            // Our HF j=0 is Front. So ly=-length/2 corresponds to j=0.
            // j = (ly + length/2) / elementSize
            const j = Math.round((ly + this.chunkLength/2) / elementSize);
            
            if (data[i] && data[i][j] !== undefined) {
                posAttribute.setZ(k, data[i][j]);
            }
        }
        
        geometry.computeVertexNormals();

        // Texture
        if (!this.sharedTexture) {
             const canvas = document.createElement('canvas');
             canvas.width = 256;
             canvas.height = 256;
             const ctx = canvas.getContext('2d');
             ctx.fillStyle = '#68a045'; 
             ctx.fillRect(0,0,256,256);
             for(let k=0; k<1000; k++) {
                 ctx.fillStyle = Math.random() > 0.5 ? '#7cb356' : '#558b35';
                 ctx.fillRect(Math.random()*256, Math.random()*256, 4, 4);
             }
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
            flatShading: true
        });

        const mesh = new THREE.Mesh(geometry, material);
        mesh.rotation.x = -Math.PI / 2;
        mesh.position.set(0, 0, zCenter);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        this.scene.add(mesh);

        this.chunks.push({ mesh, body, z: zCenter });
    }

    update(playerZ) {
        // Add new chunks ahead (Positive Z)
        // Current highest Z chunk is at the end of the array
        const lastChunk = this.chunks[this.chunks.length - 1];
        
        // If player is within 1 chunk length of the edge
        if (playerZ > lastChunk.z - this.chunkLength) { 
            // Player is approaching the end of the known world
            // Generate next chunk at lastChunk.z + chunkLength
            this.createChunk(lastChunk.z + this.chunkLength);
        }

        // Remove old chunks (Low Z, behind player)
        // First chunk in array is lowest Z
        if (this.chunks[0].z < playerZ - this.chunkLength * 2) {
            const chunk = this.chunks.shift();
            this.scene.remove(chunk.mesh);
            this.world.removeBody(chunk.body);
            chunk.mesh.geometry.dispose();
            // Don't dispose texture as it is shared
        }
    }
}