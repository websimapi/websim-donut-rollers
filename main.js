import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { Donut } from './donut.js';
import { InfiniteTerrain } from './terrain.js';

// --- Setup ---
const container = document.getElementById('game-container');
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87CEEB);
// Increased fog distance for "expansive" feel
// Using a slightly different fog color to debug vs background if needed, but keeping it pretty
scene.fog = new THREE.Fog(0x87CEEB, 20, 300);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
container.appendChild(renderer.domElement);

// Lights
const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
scene.add(ambientLight);

const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
dirLight.position.set(50, 100, 50);
dirLight.castShadow = true;
// Increase shadow frustum to cover terrain
dirLight.shadow.camera.left = -50;
dirLight.shadow.camera.right = 50;
dirLight.shadow.camera.top = 50;
dirLight.shadow.camera.bottom = -50;
dirLight.shadow.camera.near = 1;
dirLight.shadow.camera.far = 300;
dirLight.shadow.mapSize.width = 2048;
dirLight.shadow.mapSize.height = 2048;
scene.add(dirLight);

// Physics World
const world = new CANNON.World();
world.gravity.set(0, -25, 0); // Strong, realistic gravity pull to ensure slope adherence
world.solver.iterations = 30; // High iterations for stable heightfield collisions
world.defaultContactMaterial.friction = 0.3; // Lower default friction to prevent sticky "glitches"
world.defaultContactMaterial.restitution = 0.2;

// --- Game State ---
let gameState = 'IDLE'; // IDLE, STARTING, PLAYING, GAME_OVER
let input = { x: 0 }; // -1 to 1
let stoppedTime = 0; // how long we've been basically stopped

// --- Audio System ---
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
const assets = {
    sounds: {},
    playSound: (id) => {
        if (!assets.sounds[id]) return;
        const source = audioCtx.createBufferSource();
        source.buffer = assets.sounds[id];
        source.connect(audioCtx.destination);
        source.start(0);
    },
    playLoop: (id) => {
        if (!assets.sounds[id]) return;
        const source = audioCtx.createBufferSource();
        source.buffer = assets.sounds[id];
        source.connect(audioCtx.destination);
        source.loop = true;
        source.start(0);
        return source; 
    }
};

async function loadAudio(url, id) {
    try {
        const response = await fetch(url);
        const arrayBuffer = await response.arrayBuffer();
        const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
        assets.sounds[id] = audioBuffer;
    } catch(e) {
        console.warn("Audio load failed", e);
    }
}

loadAudio('./jump.mp3', 'jump');
loadAudio('./rolling_loop.mp3', 'roll');
loadAudio('./music_loop.mp3', 'music');

// --- Game Objects ---
const terrain = new InfiniteTerrain(scene, world);

// Calculate start height based on terrain at 0,0
// Start much higher to prevent initial clipping
// Ensure initial height is safe and definitely above terrain
const startY = terrain.getHeightAt(0, 0) + 5; 
const donut = new Donut(scene, world, new THREE.Vector3(0, startY, 0), assets);

// --- Input Handling ---
function handleInput(x) {
    // Direct steering mapping: Right drag (+x) = Right force (+x)
    input.x = x;
}

window.addEventListener('touchmove', (e) => {
    // Only prevent default if it's the game interaction
    if (e.target.id === 'game-container' || e.target.tagName === 'BODY') {
        e.preventDefault();
    }
    const touchX = e.touches[0].clientX;
    handleInput((touchX / window.innerWidth) * 2 - 1);
}, { passive: false });

window.addEventListener('mousemove', (e) => {
    if (gameState === 'PLAYING') {
        handleInput((e.clientX / window.innerWidth) * 2 - 1);
    }
});

function startGame() {
    if (gameState !== 'IDLE') return;
    
    if (audioCtx.state === 'suspended') audioCtx.resume();
    
    gameState = 'STARTING';
    
    // UI Updates
    const startText = document.getElementById('tap-to-start');
    document.getElementById('title-screen').style.display = 'none';
    startText.style.opacity = '0';
    setTimeout(() => {
        startText.style.display = 'none';
        document.getElementById('score-display').classList.remove('hidden');
        document.getElementById('controls-hint').classList.remove('hidden');
    }, 500);

    // Start Music
    assets.playLoop('music');

    // Trigger Donut Action
    donut.startRolling();
    gameState = 'PLAYING';
}

window.addEventListener('click', startGame);
window.addEventListener('touchstart', (e) => {
    // Prevent default touch behaviors on canvas
    if(e.target.tagName !== 'BUTTON') {
       startGame();
    }
}, { passive: false });

// --- Resize ---
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

// --- Main Loop ---
const clock = new THREE.Clock();
let score = 0;

function animate() {
    requestAnimationFrame(animate);

    const dt = Math.min(clock.getDelta(), 0.1); 
    const time = clock.getElapsedTime();

    // Step physics whenever the donut is active in the world
    if (gameState === 'PLAYING' || gameState === 'GAME_OVER') {
        world.step(1 / 60, dt, 5);
    }

    if (gameState === 'PLAYING') {
        // Input Physics
        // Move sideways (Direct mapping)
        const sidewaysForce = 60; 
        donut.applyForce(new CANNON.Vec3(input.x * sidewaysForce, 0, 0));
        
        // Pure Physics: We do not touch velocity manually.
        // Gravity and Terrain slope provide all acceleration.
        // This removes any "artificial force" feel.

        const vel = donut.body.velocity;

        // Update Score (distance travelled downhill)
        const zPos = donut.meshGroup.position.z;
        score = Math.floor(Math.max(0, zPos));
        document.getElementById('score-val').innerText = score;

        // Update Terrain
        terrain.update(zPos);
        
        // --- Game Over Logic ---
        const pos = donut.getPosition();
        const terrainY = terrain.getHeightAt(pos.x, pos.z);
        const dy = pos.y - terrainY;
        const speedSq = vel.x * vel.x + vel.y * vel.y + vel.z * vel.z;

        // If we are close to the ground and very slow, start counting "stopped" time
        if (dy < 2 && speedSq < 1 * 1) {
            stoppedTime += dt;
        } else {
            stoppedTime = 0;
        }

        // Game over if we've been stopped for a bit
        if (stoppedTime > 2) {
            gameState = 'GAME_OVER';
        }

        // Game over immediately if we fall significantly below the surface
        if (pos.y < terrainY - 5) {
            gameState = 'GAME_OVER';
        }
    } else if (gameState === 'IDLE') {
        // Stick physics body to visual start position so it doesn't drift in void
        donut.resetPhysicsPosition();
    }

    // Object Updates
    donut.update(time, dt);

    // Camera Logic
    if (gameState === 'IDLE') {
        const radius = 10;
        camera.position.x = Math.sin(time * 0.3) * radius;
        camera.position.z = Math.cos(time * 0.3) * radius;
        if (!isNaN(donut.meshGroup.position.y)) {
             camera.position.y = donut.meshGroup.position.y + 5;
             camera.lookAt(donut.meshGroup.position);
        }
    } else if (gameState === 'PLAYING' || gameState === 'GAME_OVER') {
        const targetPos = donut.meshGroup.position;
        
        // Safety check to prevent camera NaN bugs causing black/blue screen
        if (targetPos && !isNaN(targetPos.x) && !isNaN(targetPos.y) && !isNaN(targetPos.z)) {
            // Offset camera relative to slope (Behind is -Z, since we move +Z)
            const offset = new THREE.Vector3(0, 12, -18); 
            
            // Smooth follow
            const idealPos = new THREE.Vector3().copy(targetPos).add(offset);
            
            // Use stiffer lerp to prevent losing the player at high speeds
            camera.position.lerp(idealPos, 0.2);
            camera.lookAt(targetPos);
            
            // Update Light
            dirLight.position.set(targetPos.x + 20, targetPos.y + 30, targetPos.z + 20);
            dirLight.target.position.copy(targetPos);
            dirLight.target.updateMatrixWorld();
        }
    }

    renderer.render(scene, camera);
}

animate();