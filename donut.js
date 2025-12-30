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
        this.flattenFactor = 0;
        
        // Boost tracking - following swipe path
        this.boostActive = false;
        this.boostDirection = new CANNON.Vec3();
        this.boostMagnitude = 0;
        this.boostDuration = 0;
        this.boostElapsed = 0;
        
        // --- Visuals ---
        this.meshGroup = new THREE.Group();
        this.meshGroup.position.copy(position);
        
        // 1. Torus (Visual Body)
        const geometry = new THREE.TorusGeometry(1, 0.45, 16, 40);
        geometry.rotateY(Math.PI / 2); 

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

        this._addCharacterFeatures();
        
        // Orient the whole group to face camera initially (Idle state)
        this.meshGroup.rotation.y = -Math.PI / 2;

        scene.add(this.meshGroup);

        // --- Physics ---
        const radius = 1.45;
        const width = 0.9;
        
        const cylinderShape = new CANNON.Cylinder(radius, radius, width, 24);
        const q = new CANNON.Quaternion();
        q.setFromAxisAngle(new CANNON.Vec3(0,0,1), -Math.PI / 2);
        
        this.body = new CANNON.Body({
            mass: 40,
            material: new CANNON.Material({ friction: 0.1, restitution: 0.0 })
        });
        
        this.body.addShape(cylinderShape, new CANNON.Vec3(0,0,0), q);
        this.body.position.copy(position);
        
        this.body.linearDamping = 0.0;
        this.body.angularDamping = 0.05;
        this.body.ccdSpeedThreshold = 0.5;
        this.body.ccdIterations = 10;
    }

    _addCharacterFeatures() {
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
        this.eyesGroup.position.set(0.42, 0, 0);
        this.meshGroup.add(this.eyesGroup);

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
        
        this.meshGroup.rotation.set(0, 0, 0); 
        
        if (!isNaN(this.meshGroup.position.y)) {
            this.body.position.copy(this.meshGroup.position);
        } else {
            this.body.position.set(0, 10, 0);
        }
        
        this.world.addBody(this.body);
        this.body.velocity.set(0, 0, 25);
        this.body.angularVelocity.set(15, 0, 0);

        this.assets.playSound('jump');
        this.assets.playLoop('roll');
    }

    // New boost system - no cooldown, follows swipe path
    boostWithDirection(vx, vy) {
        if (!this.isRolling) return;
        
        // Map screen space to world (x: Right, -y (Up): Forward)
        const inputDir = new CANNON.Vec3(vx, 0, -vy);
        const strength = inputDir.length();
        
        // Minimum threshold for tap
        if (strength < 0.1) return;
        
        inputDir.normalize();

        // Calculate boost based on swipe length
        // Longer swipe = longer boost duration and stronger magnitude
        const maxBoostDuration = 0.8; // Max 0.8 seconds
        const minBoostDuration = 0.15; // Min for tap
        this.boostDuration = minBoostDuration + (strength * (maxBoostDuration - minBoostDuration));
        
        // Boost magnitude scales with swipe length
        const baseBoost = 15; // Small boost
        const maxBoost = 35; // Max boost for longest swipe
        this.boostMagnitude = baseBoost + (strength * (maxBoost - baseBoost));
        
        // Set boost direction
        this.boostDirection.copy(inputDir);
        
        // Activate boost
        this.boostActive = true;
        this.boostElapsed = 0;
        
        // Gentle orientation correction (not a snap)
        const currentDir = new THREE.Vector3(
            this.body.velocity.x,
            0,
            this.body.velocity.z
        ).normalize();
        
        // If we have existing velocity, blend with it
        if (currentDir.length() > 0.1) {
            const targetDir = new THREE.Vector3(inputDir.x, 0, inputDir.z);
            // Blend 30% new direction, 70% current
            currentDir.lerp(targetDir, 0.3).normalize();
            this.boostDirection.set(currentDir.x, 0, currentDir.z);
        }

        // Reset instability on boost
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
            
            this.armL.rotation.x = (-Math.PI / 4) + Math.sin(time * 4) * 0.1;
            this.armR.rotation.x = (Math.PI / 4) - Math.sin(time * 4) * 0.1;
            this.legL.rotation.z = Math.sin(time * 4) * 0.2;
            this.legR.rotation.z = Math.cos(time * 4) * 0.2;
        } else {
            // --- Active Boost Application ---
            if (this.boostActive) {
                this.boostElapsed += dt;
                
                // Apply boost force along the swipe path direction
                const progress = this.boostElapsed / this.boostDuration;
                
                if (progress < 1.0) {
                    // Smooth boost curve (ease out)
                    const eased = 1 - Math.pow(1 - progress, 3);
                    const currentBoost = this.boostMagnitude * (1 - eased);
                    
                    // Apply force in boost direction
                    const force = this.boostDirection.clone().scale(currentBoost * this.body.mass);
                    this.body.applyForce(force, this.body.position);
                    
                    // Apply corresponding angular velocity for rolling
                    const speed = this.body.velocity.length();
                    const omegaMag = speed / 1.45;
                    
                    // Calculate rolling axis (perpendicular to velocity and up)
                    const velDir = new CANNON.Vec3(
                        this.body.velocity.x,
                        0,
                        this.body.velocity.z
                    );
                    if (velDir.length() > 0.1) {
                        velDir.normalize();
                        const up = new CANNON.Vec3(0, 1, 0);
                        const rollAxis = new CANNON.Vec3();
                        velDir.cross(up, rollAxis);
                        rollAxis.normalize();
                        
                        // Blend with current angular velocity
                        const targetOmega = rollAxis.scale(omegaMag);
                        this.body.angularVelocity.x = this.body.angularVelocity.x * 0.7 + targetOmega.x * 0.3;
                        this.body.angularVelocity.y = this.body.angularVelocity.y * 0.7 + targetOmega.y * 0.3;
                        this.body.angularVelocity.z = this.body.angularVelocity.z * 0.7 + targetOmega.z * 0.3;
                    }
                } else {
                    this.boostActive = false;
                }
            }
            
            // --- Orientation & Stability Check ---
            const axle = new CANNON.Vec3(1, 0, 0);
            this.body.quaternion.vmult(axle, axle);
            const up = new CANNON.Vec3(0, 1, 0);
            const tilt = Math.abs(axle.dot(up));
            
            // Only consider unstable at higher threshold (30 degrees)
            this.isUnstable = tilt > 0.5;
            
            // --- Flattening Logic (Only when truly stopped) ---
            const angSpeed = this.body.angularVelocity.length();
            const linearSpeed = this.body.velocity.length();
            
            // Only flatten if BOTH slow rotation AND slow movement AND unstable
            if (this.isUnstable && angSpeed < 5 && linearSpeed < 3) {
                this.isFlattening = true;
            } else {
                // Quick recovery from flatten state when moving
                this.isFlattening = false;
            }
            
            if (this.isFlattening) {
                this.flattenFactor = Math.min(1, this.flattenFactor + dt * 0.4);
                
                // Gradual damping increase
                this.body.linearDamping = 0.05 + (this.flattenFactor * 0.3);
                this.body.angularDamping = 0.05 + (this.flattenFactor * 0.4);
            } else {
                this.flattenFactor = Math.max(0, this.flattenFactor - dt * 2);
                this.body.linearDamping = 0.0;
                this.body.angularDamping = 0.05;
            }

            // --- Steering ---
            const controlStr = this.isFlattening ? (1 - this.flattenFactor * 0.5) : 1;
            if (Math.abs(this.steeringInput) > 0.01 && controlStr > 0) {
                const sidewaysForce = 50 * controlStr;
                this.body.applyForce(
                    new CANNON.Vec3(this.steeringInput * sidewaysForce, 0, 0),
                    this.body.position
                );
            }

            // --- Light Air Resistance ---
            const vel = this.body.velocity;
            const speed = vel.length();
            if (speed > 1) {
                const dragFactor = 0.001; // Reduced drag
                const dragMagnitude = speed * speed * dragFactor;
                const dragForce = vel.clone().scale(-dragMagnitude / speed);
                this.body.applyForce(dragForce, this.body.position);
            }

            // --- Gentle Stabilization (Only when rolling well) ---
            if (speed > 15 && tilt < 0.3 && !this.isFlattening && !this.boostActive) {
                // Gentle upright torque
                const heading = new CANNON.Vec3();
                axle.cross(up, heading);
                heading.normalize();
                
                const correction = -axle.y * 20; // Reduced correction force
                this.body.torque.vadd(heading.scale(correction), this.body.torque);
            }

            // --- Safety: Prevent wild tumbling ---
            const spin = this.body.angularVelocity;
            const spinAlongAxle = spin.dot(axle);
            const spinVecAlongAxle = axle.clone().scale(spinAlongAxle);
            const spinPerp = spin.vsub(spinVecAlongAxle);
            const offAxisSpin = spinPerp.length();

            // Only intervene on extreme tumbling
            if (offAxisSpin > 15) {
                // Apply counter-torque
                this.body.torque.vadd(spinPerp.scale(-10), this.body.torque);
                // Don't apply heavy damping - let physics work
            }

            // --- Reasonable Speed Cap ---
            if (speed > 100) {
                vel.scale(100 / speed);
                this.body.velocity.copy(vel);
            }

            // --- Sync Visuals ---
            if (!isNaN(this.body.position.x)) {
                this.meshGroup.position.copy(this.body.position);
                this.meshGroup.quaternion.copy(this.body.quaternion);
            }
            
            // Visual squish feedback (subtle)
            let squish = 0;
            if (this.isFlattening) {
                squish = 0.15 * this.flattenFactor;
            }

            const targetScaleY = 1.0 - squish;
            const targetScaleXZ = 1.0 + (squish * 0.3);
            this.meshGroup.scale.lerp(
                new THREE.Vector3(targetScaleXZ, targetScaleY, targetScaleXZ),
                0.1
            );

            // Visual feedback
            if (this.isUnstable && this.isFlattening) {
                this.meshGroup.children[0].material.color.setHex(0xffcccc);
            } else {
                this.meshGroup.children[0].material.color.setHex(0xffffff);
            }

            // Hide limbs during roll
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