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
        const geometry = new THREE.TorusGeometry(1, 0.45, 16, 50);
        
        // Material setup
        const texture = new THREE.TextureLoader().load('./donut_texture.png');
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        // Rotate texture to align frosting on top (approximate adjustment)
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
        
        // Position eyes on the ring dough, not in the hole
        const leftEye = new THREE.Mesh(eyeGeo, eyeMat);
        leftEye.position.set(-0.35, 0.8, 0.05);
        const rightEye = new THREE.Mesh(eyeGeo, eyeMat);
        rightEye.position.set(0.35, 0.8, 0.05);
        
        // Shine in eyes
        const shineGeo = new THREE.SphereGeometry(0.04, 8, 8);
        const shineMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
        const leftShine = new THREE.Mesh(shineGeo, shineMat);
        leftShine.position.set(-0.04, 0.04, 0.1);
        const rightShine = new THREE.Mesh(shineGeo, shineMat);
        rightShine.position.set(-0.04, 0.04, 0.1);
        
        leftEye.add(leftShine);
        rightEye.add(rightShine);
        
        this.eyesGroup.add(leftEye);
        this.eyesGroup.add(rightEye);
        // Position eyes on the front surface of the torus
        this.eyesGroup.position.z = 0.5; // Touch the surface (radius 0.45 + offset)
        this.eyesGroup.position.y = 0;
        this.meshGroup.add(this.eyesGroup);

        // 3. Limbs (Arms and Legs)
        this.limbsGroup = new THREE.Group();
        const limbMat = new THREE.MeshStandardMaterial({ color: 0xd2b48c }); // Dough color
        const limbGeo = new THREE.CapsuleGeometry(0.1, 0.6, 4, 8);
        
        // Legs
        this.legL = new THREE.Mesh(limbGeo, limbMat);
        this.legL.position.set(-0.4, -1.2, 0);
        this.legR = new THREE.Mesh(limbGeo, limbMat);
        this.legR.position.set(0.4, -1.2, 0);
        
        // Arms
        this.armL = new THREE.Mesh(limbGeo, limbMat);
        this.armL.position.set(-1.2, 0, 0);
        this.armL.rotation.z = Math.PI / 4;
        
        this.armR = new THREE.Mesh(limbGeo, limbMat);
        this.armR.position.set(1.2, 0, 0);
        this.armR.rotation.z = -Math.PI / 4;

        this.limbsGroup.add(this.legL, this.legR, this.armL, this.armR);
        this.meshGroup.add(this.limbsGroup);

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

        // Don't add body to world yet (waiting for start)
    }

    startRolling() {
        this.isRolling = true;
        this.world.addBody(this.body);
        
        // Initial push
        this.body.velocity.set(0, 5, -10);
        this.body.angularVelocity.set(5, 0, 0);

        // Play sounds
        this.assets.playSound('jump');
        this.assets.playLoop('roll');
    }

    update(time, dt) {
        if (!this.isRolling) {
            // Idle Animation
            const bounce = Math.sin(time * 3) * 0.1;
            this.meshGroup.position.y = this.body.position.y + bounce;
            
            // Swing arms
            this.armL.rotation.z = (Math.PI / 4) + Math.sin(time * 4) * 0.1;
            this.armR.rotation.z = (-Math.PI / 4) - Math.sin(time * 4) * 0.1;
            
            // Swing legs
            this.legL.rotation.x = Math.sin(time * 4) * 0.2;
            this.legR.rotation.x = Math.cos(time * 4) * 0.2;
        } else {
            // Rolling Logic
            
            // Sync visual to physics
            this.meshGroup.position.copy(this.body.position);
            
            // For the visual rotation:
            // The torus lies flat (hole along Z) by default. 
            // We want it to roll like a wheel.
            // We need to orient the torus so it stands up (rotate X 90) then apply physics rotation.
            
            // Actually, simpler: Let's just create a temporary quaternion for the visual mesh
            // that represents the rolling. 
            // The physics body is a sphere, so it has a rotation.
            this.meshGroup.quaternion.copy(this.body.quaternion);

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
    
    applyForce(vec) {
        this.body.applyForce(vec, this.body.position);
    }
}