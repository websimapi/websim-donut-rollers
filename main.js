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
world.gravity.set(0, -9.82 * 2, 0); // Heavier gravity for snappier feeling
world.solver.iterations = 20; // Reduce tunneling through terrain

// --- Game State ---
let gameState = 'IDLE'; // IDLE, STARTING, PLAYING
let input = { x: 0 }; // -1 to 1

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

    if (gameState === 'PLAYING') {
        // Physics
        world.step(1 / 60, dt, 5);
        
        // Input Physics
        // Move sideways
        const sidewaysForce = 30;
        donut.applyForce(new CANNON.Vec3(input.x * sidewaysForce, 0, 0));
        
        // Always push forward (downhill is negative Z)
        // If speed is low, boost it
        const vel = donut.body.velocity;
        if (vel.z > -40) { // Max speed cap / acceleration limit
             donut.applyForce(new CANNON.Vec3(0, 0, -15));
        }

        // Update Score
        const zPos = donut.meshGroup.position.z;
        score = Math.floor(Math.abs(zPos));
        document.getElementById('score-val').innerText = score;

        // Update Terrain
        terrain.update(zPos);
        
        // Fail state (fall off world)
        if (donut.getPosition().y < zPos * 0.4 - 50) {
            // Player fell way below terrain line
            // Reset? For now just log
        }
    } else {
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
        camera.position.y = donut.meshGroup.position.y + 5;
        camera.lookAt(donut.meshGroup.position);
    } else if (gameState === 'PLAYING') {
        const targetPos = donut.meshGroup.position;
        
        // Safety check to prevent camera NaN bugs causing black/blue screen
        if (targetPos && !isNaN(targetPos.x) && !isNaN(targetPos.y) && !isNaN(targetPos.z)) {
            // Check for falling off world
            if (targetPos.y < -500) {
                // Respawn logic or just cap camera?
                // For now, let's keep camera looking at something sane
            }

            // Offset camera relative to slope
            // Looking down from behind
            // As we speed up, pull back?
            const offset = new THREE.Vector3(0, 10, 15); 
            
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