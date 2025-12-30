import * as THREE from 'three';
import * as CANNON from 'cannon-es';

export class Donut {
    constructor(scene, world, position, assets) {
        this.scene = scene;
        this.world = world;
        this.assets = assets;
        
        // State
        this.isRolling = false;
        
        // --- Visuals ---
        this.meshGroup = new THREE.Group();
        this.meshGroup.position.copy(position);
        
        // 1. Torus (Visual Body)
        // Rotate geometry so the torus "hole" aligns with the X axis.
        const geometry = new THREE.TorusGeometry(1, 0.45, 16, 40);
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

        // 2. Character Features (Eyes & Limbs)
        this._addCharacterFeatures();

        // Orient the whole group to face camera initially (Idle state)
        // Camera looks at Z-. Donut face (X+) should point to Z+.
        // So rotate Y -90.
        this.meshGroup.rotation.y = -Math.PI / 2;

        scene.add(this.meshGroup);

        // --- Physics ---
        // Using a Cylinder for "Penny" physics (Rolling Wheel)
        // Radius = 1.45 (1 + 0.45)
        // Width = 0.9 (0.45 * 2)
        const radius = 1.45;
        const width = 0.9;
        
        // CANNON.Cylinder axis is along Y. 
        const cylinderShape = new CANNON.Cylinder(radius, radius, width, 24);
        
        // We want the rolling axis to be the Body's Local X axis.
        // Rotating the shape -90 degrees around Z axis aligns the Cylinder Y axis with Body X axis.
        const q = new CANNON.Quaternion();
        q.setFromAxisAngle(new CANNON.Vec3(0,0,1), -Math.PI / 2);
        
        this.body = new CANNON.Body({
            mass: 12, // Sufficient mass for momentum
            material: new CANNON.Material({ friction: 0.5, restitution: 0.2 })
        });
        
        // Add shape with offset rotation
        this.body.addShape(cylinderShape, new CANNON.Vec3(0,0,0), q);
        
        this.body.position.copy(position);
        
        // Damping starts low for rolling
        this.body.linearDamping = 0.02;
        this.body.angularDamping = 0.02;

        // Continuous Collision Detection
        this.body.ccdSpeedThreshold = 1;
        this.body.ccdIterations = 5;
    }

    _addCharacterFeatures() {
        // Eyes
        this.eyesGroup = new THREE.Group();
        const eyeGeo = new THREE.SphereGeometry(0.12, 16, 16);
        const eyeMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
        
        const leftEye = new THREE.Mesh(eyeGeo, eyeMat);
        leftEye.position.set(0, 0.3, -0.35);
        const rightEye = new THREE.Mesh(eyeGeo, eyeMat);
        rightEye.position.set(0, 0.3, 0.35);
        
        const shineGeo = new THREE.SphereGeometry(0.04, 8, 8);
        const shineMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
        const leftShine = new THREE.Mesh(shineGeo, shineMat);
        leftShine.position.set(0.1, 0.04, -0.04);
        const rightShine = new THREE.Mesh(shineGeo, shineMat);
        rightShine.position.set(0.1, 0.04, -0.04);
        
        leftEye.add(leftShine);
        rightEye.add(rightShine);
        
        this.eyesGroup.add(leftEye, rightEye);
        this.eyesGroup.position.set(0.42, 0, 0); // On the face
        this.meshGroup.add(this.eyesGroup);

        // Limbs
        this.limbsGroup = new THREE.Group();
        const limbMat = new THREE.MeshStandardMaterial({ color: 0xd2b48c }); 
        const limbGeo = new THREE.CapsuleGeometry(0.1, 0.6, 4, 8);
        
        this.legL = new THREE.Mesh(limbGeo, limbMat);
        this.legL.position.set(0, -1.3, -0.4);
        this.legR = new THREE.Mesh(limbGeo, limbMat);
        this.legR.position.set(0, -1.3, 0.4);
        
        this.armL = new THREE.Mesh(limbGeo, limbMat);
        this.armL.position.set(0, 0, -1.2);
        this.armL.rotation.x = -Math.PI / 4;
        
        this.armR = new THREE.Mesh(limbGeo, limbMat);
        this.armR.position.set(0, 0, 1.2);
        this.armR.rotation.x = Math.PI / 4;

        this.limbsGroup.add(this.legL, this.legR, this.armL, this.armR);
        this.meshGroup.add(this.limbsGroup);
    }

    startRolling() {
        this.isRolling = true;
        
        // Sync Physics to Visual Start
        this.meshGroup.rotation.set(0, 0, 0); // Reset visual to identity (aligned with physics body)
        
        if (!isNaN(this.meshGroup.position.y)) {
            this.body.position.copy(this.meshGroup.position);
        } else {
            this.body.position.set(0, 10, 0);
        }
        
        this.world.addBody(this.body);
        
        // Launch Physics
        // Forward is +Z
        this.body.velocity.set(0, 0, 15);
        // Angular Velocity +X (Forward Roll)
        this.body.angularVelocity.set(10, 0, 0);

        // Sounds
        this.assets.playSound('jump');
        this.assets.playLoop('roll');
    }

    update(time, dt) {
        if (!this.isRolling) {
            // Idle Animation
            const bounce = Math.sin(time * 3) * 0.1;
            this.meshGroup.position.y = this.body.position.y + bounce;
            
            // Limb swing
            this.armL.rotation.x = (-Math.PI / 4) + Math.sin(time * 4) * 0.1;
            this.armR.rotation.x = (Math.PI / 4) - Math.sin(time * 4) * 0.1;
            this.legL.rotation.z = Math.sin(time * 4) * 0.2;
            this.legR.rotation.z = Math.cos(time * 4) * 0.2;
        } else {
            // --- Penny Physics Logic ---
            const speed = this.body.velocity.length();
            
            // Calculate Tilt (Deviation from upright rolling)
            // Body X axis is the axle.
            const axle = new CANNON.Vec3(1, 0, 0);
            this.body.quaternion.vmult(axle, axle);
            
            // Dot product with World Up (0,1,0)
            // 0 = Upright, 1 = Flat
            const tilt = Math.abs(axle.dot(new CANNON.Vec3(0, 1, 0)));
            
            // 1. Stabilization at High Speed
            if (speed > 8) {
                // If reasonably upright, keep damping low
                this.body.angularDamping = 0.05;
                
                // Note: Cylinder shape naturally stabilizes somewhat due to gyroscopic moments 
                // if the timestep is small enough, but we rely on speed here.
            }
            
            // 2. Fall Transition (Wobble)
            if (speed < 6) {
                // If slowing down, increase damping based on tilt to simulate side friction/scraping
                const frictionFactor = tilt * tilt; // Quadratic curve
                this.body.angularDamping = 0.1 + (frictionFactor * 0.8);
                this.body.linearDamping = 0.05 + (frictionFactor * 0.5);
                
                // If perfectly upright but slow, initiate fall (unstable equilibrium)
                if (tilt < 0.05 && speed < 3) {
                    const destabilize = (Math.random() - 0.5) * 5;
                    this.body.applyTorque(new CANNON.Vec3(0, 0, destabilize));
                }
            }

            // Sync Visuals
            if (!isNaN(this.body.position.x)) {
                 this.meshGroup.position.copy(this.body.position);
                 this.meshGroup.quaternion.copy(this.body.quaternion);
            }

            // Hide limbs smoothly
            if (this.limbsGroup.visible) {
                const s = Math.max(0, this.limbsGroup.scale.x - dt * 5);
                this.limbsGroup.scale.set(s, s, s);
                if (s <= 0) this.limbsGroup.visible = false;
            }
        }
    }

    getPosition() {
        return this.body.position;
    }

    resetPhysicsPosition() {
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