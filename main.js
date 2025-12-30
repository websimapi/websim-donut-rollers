import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { Donut } from './donut.js';
import { InfiniteTerrain } from './terrain.js';

// --- Setup ---
const container = document.getElementById('game-container');
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87CEEB);
scene.fog = new THREE.Fog(0x87CEEB, 20, 100);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 200);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
container.appendChild(renderer.domElement);

// Lights
const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
scene.add(ambientLight);

const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
dirLight.position.set(10, 20, 10);
dirLight.castShadow = true;
dirLight.shadow.camera.left = -20;
dirLight.shadow.camera.right = 20;
dirLight.shadow.camera.top = 20;
dirLight.shadow.camera.bottom = -20;
scene.add(dirLight);

// Physics World
const world = new CANNON.World();
world.gravity.set(0, -9.82, 0);

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
        return source; // return so we can stop it if needed
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

// Load Sounds
loadAudio('./jump.mp3', 'jump');
loadAudio('./rolling_loop.mp3', 'roll');
loadAudio('./music_loop.mp3', 'music');

// --- Game Objects ---
const donut = new Donut(scene, world, new THREE.Vector3(0, 2, 0), assets);
const terrain = new InfiniteTerrain(scene, world);

// --- Input Handling ---
function handleInput(x) {
    // x is normalized -1 to 1 from screen center
    input.x = x;
}

window.addEventListener('touchmove', (e) => {
    e.preventDefault();
    const touchX = e.touches[0].clientX;
    handleInput((touchX / window.innerWidth) * 2 - 1);
});

window.addEventListener('mousemove', (e) => {
    if (gameState === 'PLAYING') {
        handleInput((e.clientX / window.innerWidth) * 2 - 1);
    }
});

function startGame() {
    if (gameState !== 'IDLE') return;
    
    // Resume audio context if suspended
    if (audioCtx.state === 'suspended') audioCtx.resume();
    
    gameState = 'STARTING';
    
    // UI Updates
    document.getElementById('tap-to-start').style.opacity = '0';
    setTimeout(() => {
        document.getElementById('tap-to-start').style.display = 'none';
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
window.addEventListener('touchstart', startGame);

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

    const dt = Math.min(clock.getDelta(), 0.1); // Cap dt
    const time = clock.getElapsedTime();

    // Physics Update
    if (gameState === 'PLAYING') {
        world.step(1 / 60, dt, 3);
        
        // Input Physics
        // Apply sideways force based on input
        const speed = 20;
        donut.applyForce(new CANNON.Vec3(input.x * speed, 0, 0));
        
        // Keep pushing forward (down Z)
        donut.applyForce(new CANNON.Vec3(0, 0, -10));

        // Update Score
        score = Math.floor(Math.abs(donut.getPosition().z));
        document.getElementById('score-val').innerText = score;

        // Update Terrain
        terrain.update(donut.getPosition().z);
    }

    // Object Updates
    donut.update(time, dt);

    // Camera Logic
    if (gameState === 'IDLE') {
        // Orbit around donut
        const radius = 6;
        const speed = 0.5;
        camera.position.x = Math.sin(time * speed) * radius;
        camera.position.z = Math.cos(time * speed) * radius;
        camera.position.y = 4;
        camera.lookAt(new THREE.Vector3(0, 1, 0));
    } else if (gameState === 'PLAYING') {
        // Follow Donut
        const targetPos = donut.getPosition();
        const offset = new THREE.Vector3(0, 5, 8); // Behind and up
        
        // Smooth lerp camera
        const idealPos = new THREE.Vector3().copy(targetPos).add(offset);
        camera.position.lerp(idealPos, 0.1);
        camera.lookAt(targetPos);
        
        // Follow light
        dirLight.position.z = targetPos.z + 10;
        dirLight.target.position.copy(targetPos);
        dirLight.target.updateMatrixWorld();
    }

    renderer.render(scene, camera);
}

animate();