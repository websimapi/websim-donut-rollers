import * as THREE from 'three';
import * as CANNON from 'cannon-es';

export class Donut {
    constructor(scene, world, position, assets) {
        this.scene = scene;
        this.world = world;
        this.assets = assets;
        
        // State
        this.isRolling = false;
        this.jumpTimer = 0;

        // --- Visuals ---
        this.meshGroup = new THREE.Group();
        this.meshGroup.position.copy(position);
        
        // 1. The Torus (Body)
        // Rotate geometry so the torus stands up like a wheel (Hole along X axis)
        const geometry = new THREE.TorusGeometry(1, 0.45, 16, 50);
        geometry.rotateY(Math.PI / 2); 

        // Material setup
        const texture = new THREE.TextureLoader().load('./donut_texture.png');
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        texture.rotation = Math.PI / 2; 
        
        const material = new THREE.MeshStandardMaterial({ 
            map: texture,
            roughness: 0.2,
            metalness: 0.1
        });

        this.torus = new THREE.Mesh(geometry, material);
        this.torus.castShadow = true;
        this.meshGroup.add(this.torus);

        // 2. Eyes (Cute face)
        this.eyesGroup = new THREE.Group();
        const eyeGeo = new THREE.SphereGeometry(0.12, 16, 16);
        const eyeMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
        
        // Position eyes on the face of the donut (which is now facing X+ / X-)
        // We'll put them on X+ side
        const leftEye = new THREE.Mesh(eyeGeo, eyeMat);
        leftEye.position.set(0, 0.3, -0.35); // Relative to eyesGroup
        const rightEye = new THREE.Mesh(eyeGeo, eyeMat);
        rightEye.position.set(0, 0.3, 0.35);
        
        // Shine in eyes
        const shineGeo = new THREE.SphereGeometry(0.04, 8, 8);
        const shineMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
        const leftShine = new THREE.Mesh(shineGeo, shineMat);
        leftShine.position.set(0.1, 0.04, -0.04);
        const rightShine = new THREE.Mesh(shineGeo, shineMat);
        rightShine.position.set(0.1, 0.04, -0.04);
        
        leftEye.add(leftShine);
        rightEye.add(rightShine);
        
        this.eyesGroup.add(leftEye);
        this.eyesGroup.add(rightEye);
        
        // Position eyesGroup on the surface
        this.eyesGroup.position.set(0.42, 0, 0); 
        this.meshGroup.add(this.eyesGroup);

        // 3. Limbs (Arms and Legs)
        this.limbsGroup = new THREE.Group();
        const limbMat = new THREE.MeshStandardMaterial({ color: 0xd2b48c }); 
        const limbGeo = new THREE.CapsuleGeometry(0.1, 0.6, 4, 8);
        
        // Legs (Bottom)
        this.legL = new THREE.Mesh(limbGeo, limbMat);
        this.legL.position.set(0, -1.3, -0.4);
        this.legR = new THREE.Mesh(limbGeo, limbMat);
        this.legR.position.set(0, -1.3, 0.4);
        
        // Arms (Sides)
        this.armL = new THREE.Mesh(limbGeo, limbMat);
        this.armL.position.set(0, 0, -1.2);
        this.armL.rotation.x = -Math.PI / 4;
        
        this.armR = new THREE.Mesh(limbGeo, limbMat);
        this.armR.position.set(0, 0, 1.2);
        this.armR.rotation.x = Math.PI / 4;

        this.limbsGroup.add(this.legL, this.legR, this.armL, this.armR);
        this.meshGroup.add(this.limbsGroup);

        // Orient the whole group to face camera initially (Idle state)
        // Camera looks at Z-. Donut face is X+. 
        // Rotate Y -90 makes X+ become Z+. Faces camera.
        this.meshGroup.rotation.y = -Math.PI / 2;

        scene.add(this.meshGroup);

        // --- Physics ---
        // We use a Sphere for rolling physics because it handles slopes best
        // The visual torus will rotate to match logic
        // Visual radius = 1 (major) + 0.45 (tube) = 1.45
        const radius = 1.45; 
        const mass = 10;
        this.body = new CANNON.Body({
            mass: mass,
            shape: new CANNON.Sphere(radius),
            position: new CANNON.Vec3(position.x, position.y, position.z),
            material: new CANNON.Material({ friction: 0.1, restitution: 0.5 })
        });
        this.body.linearDamping = 0.1;
        this.body.angularDamping = 0.1;

        // Enable CCD to prevent tunneling
        this.body.ccdSpeedThreshold = 1;
        this.body.ccdIterations = 10;

        // Don't add body to world yet (waiting for start)
    }

    startRolling() {
        this.isRolling = true;
        
        // Reset Visual Rotation so physics can take over
        this.meshGroup.rotation.set(0,0,0);

        // Ensure body is at the current visual position before adding
        // Check for validity
        if (!isNaN(this.meshGroup.position.y)) {
            this.body.position.copy(this.meshGroup.position);
        } else {
            console.error("Donut start position is NaN!");
            this.body.position.set(0, 10, 0);
        }
        
        this.world.addBody(this.body);
        
        // Initial push - reduced speed to prevent immediate clipping
        this.body.velocity.set(0, 2, -10);
        this.body.angularVelocity.set(5, 0, 0);

        // Play sounds
        this.assets.playSound('jump');
        this.assets.playLoop('roll');
    }

    update(time, dt) {
        if (!this.isRolling) {
            // Idle Animation
            const bounce = Math.sin(time * 3) * 0.1;
            // Use local base Y from constructor logic, body isn't active yet
            // body.position.y is the spawn height
            this.meshGroup.position.y = this.body.position.y + bounce;
            
            // Swing arms (New axis due to rotation)
            this.armL.rotation.x = (-Math.PI / 4) + Math.sin(time * 4) * 0.1;
            this.armR.rotation.x = (Math.PI / 4) - Math.sin(time * 4) * 0.1;
            
            // Swing legs
            this.legL.rotation.z = Math.sin(time * 4) * 0.2;
            this.legR.rotation.z = Math.cos(time * 4) * 0.2;
        } else {
            // Rolling Logic
            
            // Sync visual to physics
            if (!isNaN(this.body.position.x)) {
                 this.meshGroup.position.copy(this.body.position);
                 this.meshGroup.quaternion.copy(this.body.quaternion);
            }

            // Hide limbs smoothly
            if (this.limbsGroup.scale.x > 0.01) {
                const s = Math.max(0, this.limbsGroup.scale.x - dt * 5);
                this.limbsGroup.scale.set(s, s, s);
            } else {
                this.limbsGroup.visible = false;
            }

            // Keep eyes attached but maybe rotate them? 
            // Actually, if the torus rolls, the eyes roll with it, which is physically correct but dizzying.
            // Let's keep them rolling.
        }
    }

    getPosition() {
        return this.body.position;
    }

    resetPhysicsPosition() {
        // Sync body to mesh when not playing
        if (!isNaN(this.meshGroup.position.y)) {
            this.body.position.copy(this.meshGroup.position);
            this.body.velocity.set(0,0,0);
            this.body.angularVelocity.set(0,0,0);
        }
    }
    
    applyForce(vec) {
        this.body.applyForce(vec, this.body.position);
    }
}