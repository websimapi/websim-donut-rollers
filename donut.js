import * as THREE from 'three';
import * as CANNON from 'cannon-es';

export class Donut {
    constructor(scene, world, position, assets) {
        this.scene = scene;
        this.world = world;
        this.assets = assets;
        
        // State
        this.isRolling = false;
        this.steeringInput = 0;
        this.isUnstable = false;
        this.isFlattening = false;
        this.flattenFactor = 0; // 0 to 1
        this.lastBoostTime = 0;
        this.boostCooldown = 6000; // 6 seconds ms
        
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
            mass: 30, // Heavier mass for more stable simulation
            material: new CANNON.Material({ friction: 0.1, restitution: 0.1 }) // Low friction for smooth rolling
        });
        
        // Add shape with offset rotation
        this.body.addShape(cylinderShape, new CANNON.Vec3(0,0,0), q);
        
        this.body.position.copy(position);
        
        // Low damping for gravity physics, but enough to prevent infinite energy glitch
        this.body.linearDamping = 0.0;
        this.body.angularDamping = 0.1;

        // Continuous Collision Detection
        this.body.ccdSpeedThreshold = 0.5;
        this.body.ccdIterations = 10;
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
        this.isUnstable = false;
        this.isFlattening = false;
        
        // Sync Physics to Visual Start
        this.meshGroup.rotation.set(0, 0, 0); 
        
        if (!isNaN(this.meshGroup.position.y)) {
            this.body.position.copy(this.meshGroup.position);
        } else {
            this.body.position.set(0, 10, 0);
        }
        
        this.world.addBody(this.body);
        
        // Launch Physics
        this.body.velocity.set(0, 0, 25);
        this.body.angularVelocity.set(15, 0, 0);

        // Sounds
        this.assets.playSound('jump');
        this.assets.playLoop('roll');
    }

    // --- New Mechanics ---

    boostWithDirection(vx, vy) {
        // vx, vy are screen space vectors (x: Right, y: Down)
        // Map to World: +x -> +WorldX, -y (Up) -> +WorldZ (Forward)
        
        if (!this.isRolling) return;

        // Cooldown check
        const now = performance.now();
        if (now - this.lastBoostTime < this.boostCooldown) {
            return;
        }
        this.lastBoostTime = now;

        const inputDir = new CANNON.Vec3(vx, 0, -vy);
        const strength = inputDir.length();
        if (strength < 0.1) return;
        
        inputDir.normalize();

        // 1. Force Auto-Align Orientation
        // We want Body Local Z (Rolling Dir) to face inputDir
        // We want Body Local X (Axle) to be perpendicular
        // We want Body Local Y (Radial) to be Up
        
        const targetZ = new THREE.Vector3(inputDir.x, inputDir.y, inputDir.z);
        const targetY = new THREE.Vector3(0, 1, 0);
        const targetX = new THREE.Vector3().crossVectors(targetY, targetZ).normalize();
        
        // Re-orthogonalize Z to ensure valid rotation matrix
        targetZ.crossVectors(targetX, targetY).normalize();

        const tM = new THREE.Matrix4();
        tM.makeBasis(targetX, targetY, targetZ);
        const tQ = new THREE.Quaternion();
        tQ.setFromRotationMatrix(tM);

        // Snap orientation to new direction (Auto-correct)
        this.body.quaternion.set(tQ.x, tQ.y, tQ.z, tQ.w);
        this.body.angularVelocity.set(0,0,0); // Reset spin to prevent gyroscope fighting

        // 2. Apply Velocity
        const currentSpeed = this.body.velocity.length();
        const boostSpeed = 40 * strength;
        const newSpeed = Math.max(currentSpeed, 20) + boostSpeed;
        
        const newVel = inputDir.scale(newSpeed);
        // Important: Preserve existing vertical velocity so gravity isn't cancelled
        newVel.y = this.body.velocity.y; 
        this.body.velocity.copy(newVel);

        // 3. Apply Spin compatible with new velocity
        // Omega = V / R. Axis = Local X (which is now targetX)
        const omegaMag = newSpeed / 1.45; 
        const omega = new CANNON.Vec3(targetX.x, targetX.y, targetX.z).scale(omegaMag);
        this.body.angularVelocity.copy(omega);

        // Reset instability flags on correction
        this.isUnstable = false;
        this.isFlattening = false;
        this.flattenFactor = 0;

        this.assets.playSound('jump');
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
            // --- Physics & Mechanics ---
            
            // 1. Calculate Orientation & Stability
            const axle = new CANNON.Vec3(1, 0, 0);
            this.body.quaternion.vmult(axle, axle);
            const up = new CANNON.Vec3(0, 1, 0);
            
            // Tilt: 0 = Vertical, 1 = Flat
            const tilt = Math.abs(axle.dot(up));
            
            // Stability Threshold (approx 17 degrees -> 0.3 dot product)
            const wasUnstable = this.isUnstable;
            this.isUnstable = tilt > 0.3;
            
            // 2. Flattening Logic
            const angSpeed = this.body.angularVelocity.length();
            
            // If unstable and slow spinning -> Start flattening sequence
            if (this.isUnstable && angSpeed < 10) {
                this.isFlattening = true;
            }
            
            if (this.isFlattening) {
                this.flattenFactor = Math.min(1, this.flattenFactor + dt * 0.5);
                
                // Exponential drag
                this.body.linearDamping = 0.1 + (this.flattenFactor * 0.8);
                this.body.angularDamping = 0.1 + (this.flattenFactor * 0.8);
                
                // Tipping Torque: Push it over!
                // Apply torque perpendicular to axle and up (Heading axis) to increase tilt
                // If Axle.y > 0, we want to increase Axle.y.
                // We need a torque that rotates around Heading.
                // If Axle.y > 0, tilt is same direction as Up.
                const heading = new CANNON.Vec3();
                axle.cross(up, heading);
                heading.normalize();
                
                // Direction to tip:
                // If we are tilting Left, push further Left.
                // Determining sign is tricky, so let's just push towards the ground.
                // Cross(Axle, Velocity) gives a vector pointing roughly Down or Up.
                // Let's just dampen stability.
            } else {
                this.flattenFactor = Math.max(0, this.flattenFactor - dt);
                this.body.linearDamping = 0.0;
                this.body.angularDamping = 0.01;
            }

            // 3. Apply Steering
            // If flattening, reduce control
            const controlStr = this.isFlattening ? (1 - this.flattenFactor) : 1;
            if (Math.abs(this.steeringInput) > 0.01 && controlStr > 0) {
                 const sidewaysForce = 60 * controlStr;
                 // Apply force relative to heading
                 // Actually, World X is fine for side-to-side on this terrain
                 this.body.applyForce(new CANNON.Vec3(this.steeringInput * sidewaysForce, 0, 0), this.body.position);
            }

            // 4. Air Resistance / Drag
            const vel = this.body.velocity;
            const speed = vel.length();
            if (speed > 1) {
                const dragFactor = 0.002;
                const dragMagnitude = speed * speed * dragFactor;
                const dragForce = vel.clone().scale(-dragMagnitude / speed);
                this.body.applyForce(dragForce, this.body.position);
            }

            // 5. Hard Falling Friction (Penny Stop)
            if (tilt > 0.5) {
                // If extremely tilted (falling flat like a penny), increase friction significantly
                this.body.angularDamping = 0.8;
                this.body.linearDamping = 0.8;
                
                // If spinning rapidly while flat (top-spin glitch), kill rotation immediately
                if (this.body.angularVelocity.length() > 15) {
                    this.body.angularDamping = 0.99;
                }
            }

            // --- Glitch Prevention & Stabilization ---
            // Detect tumbling/propeller spin (rotation NOT matching the wheel axle)
            // This catches "spinning out of control" when airborne or glitching
            const spin = this.body.angularVelocity;
            const spinAlongAxle = spin.dot(axle);
            const spinVecAlongAxle = axle.clone().scale(spinAlongAxle);
            const spinPerp = spin.vsub(spinVecAlongAxle);
            const offAxisSpin = spinPerp.length();

            if (offAxisSpin > 10) { 
                // We are tumbling wildly. Stabilize.
                this.body.linearDamping = 0.9; 
                this.body.angularDamping = 0.9; 
                
                // Apply counter-torque to stop the tumbling
                this.body.torque.vadd(spinPerp.scale(-20), this.body.torque);

                // Pull back down strongly if this happens in the air (prevents flying out of map)
                this.body.applyForce(new CANNON.Vec3(0, -100 * this.body.mass, 0), this.body.position);
            }

            // Absolute Safety: Cap vertical velocity only slightly to prevent infinite energy bugs
            // But assume Gravity is the main downward force.
            if (this.body.velocity.y > 50) {
                 this.body.velocity.y = 50; 
            }
            // Removed artificial downward force to respect true gravity physics
            
            // Auto-stabilization (Assist)
            // If going fast and reasonably upright, apply torque to keep upright
            if (speed > 15 && tilt < 0.3 && !this.isFlattening) {
                // Torque to align Axle with Horizon
                // Axis of rotation required is Heading
                const heading = new CANNON.Vec3();
                axle.cross(up, heading);
                heading.normalize();
                
                // We want Axle.y to be 0.
                // If Axle.y > 0, we need Negative Torque around Heading (Right Hand Rule?)
                // Let's try proportional feedback
                const correction = -axle.y * 50; 
                this.body.torque.vadd(heading.scale(correction), this.body.torque);
            }

            // Speed Cap
            if (speed > 80) {
                vel.scale(80 / speed);
                this.body.velocity.copy(vel);
            }

            // Sync Visuals
            if (!isNaN(this.body.position.x)) {
                 this.meshGroup.position.copy(this.body.position);
                 this.meshGroup.quaternion.copy(this.body.quaternion);
            }
            
            // Visual feedback for Instability
            if (this.isUnstable) {
                this.meshGroup.children[0].material.color.setHex(0xffcccc); // Red tint
            } else {
                this.meshGroup.children[0].material.color.setHex(0xffffff);
            }

            // Hide limbs
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
}