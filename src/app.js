import { fragmentShader, vertexShader } from './shaders.js';

const THREE = window.THREE;
const Hands = window.Hands;
const MediaPipeCamera = window.Camera;

const particleCount = 30000;
const defaultImage = './rice.png';
const idleMorphFactor = 0.58;
const morphInputAlpha = 0.28;
const disturbPointAlpha = 0.36;
const disturbStrengthAlpha = 0.32;
const freqGrowth = [110, 130.81, 146.83, 164.81, 196, 220];
const freqScatter = [440, 523, 659, 783, 880, 1046];
const urlParams = new URLSearchParams(window.location.search);
const benchmarkMode = urlParams.has('benchmark');

const benchmark = {
    appStartMs: performance.now(),
    particleCount,
    frameDeltas: [],
    status: 'booting',
    audioEvents: 0,
    events: {}
};

let scene;
let camera;
let renderer;
let geometry;
let material;
let handsInstance = null;
let audioCtx;
let masterGain;
let muted = false;
let morphFactor = 0;
let targetMorphFactor = idleMorphFactor;
let disturbStrength = 0;
let pointerStrength = 0;
let pointerActiveUntil = 0;
let lastHandSeen = 0;

const disturbPoint = new THREE.Vector3(999, 999, 999);
const pointerPoint = new THREE.Vector3(999, 999, 999);
const rawGesturePoint = new THREE.Vector3(999, 999, 999);
const gestureFilter = {
    initialized: false,
    morph: idleMorphFactor,
    disturbStrength: 0,
    disturbPoint: new THREE.Vector3(999, 999, 999)
};

const ui = {
    overlay: document.getElementById('overlay'),
    start: document.getElementById('start-btn'),
    loading: document.getElementById('loading-msg'),
    upload: document.getElementById('image-upload'),
    size: document.getElementById('size-slider'),
    mute: document.getElementById('mute-btn'),
    reset: document.getElementById('reset-btn'),
    status: document.getElementById('status-line'),
    video: document.getElementById('video-preview')
};

function updateStatus(text) {
    ui.status.textContent = text;
    benchmark.status = text;
}

function hash01(seed) {
    const x = Math.sin(seed * 12.9898) * 43758.5453123;
    return x - Math.floor(x);
}

function screenToWorld(clientX, clientY) {
    const x = (clientX / window.innerWidth - 0.5) * 25;
    const y = (0.5 - clientY / window.innerHeight) * 20 + 2;
    return new THREE.Vector3(x, y, 2);
}

function lerpScalar(current, target, alpha) {
    return current + (target - current) * alpha;
}

function resetGestureFilter() {
    gestureFilter.initialized = false;
    gestureFilter.morph = idleMorphFactor;
    gestureFilter.disturbStrength = 0;
    gestureFilter.disturbPoint.set(999, 999, 999);
}

function applyGestureFilter(rawMorph, rawDisturbPoint, rawDisturbStrength) {
    if (!gestureFilter.initialized) {
        gestureFilter.initialized = true;
        gestureFilter.morph = rawMorph;
        gestureFilter.disturbStrength = rawDisturbStrength;
        gestureFilter.disturbPoint.copy(rawDisturbPoint);
    } else {
        gestureFilter.morph = lerpScalar(gestureFilter.morph, rawMorph, morphInputAlpha);
        gestureFilter.disturbStrength = lerpScalar(
            gestureFilter.disturbStrength,
            rawDisturbStrength,
            disturbStrengthAlpha
        );

        if (rawDisturbStrength > 0) {
            gestureFilter.disturbPoint.lerp(rawDisturbPoint, disturbPointAlpha);
        }
    }

    targetMorphFactor = gestureFilter.morph;
    disturbStrength = gestureFilter.disturbStrength;
    if (disturbStrength > 0.02) {
        disturbPoint.copy(gestureFilter.disturbPoint);
    } else {
        disturbPoint.set(999, 999, 999);
    }
}

function renderOnce() {
    if (!renderer || !scene || !camera || !material) return;
    material.uniforms.uMorph.value = morphFactor;
    material.uniforms.uDisturbStrength.value = disturbStrength;
    renderer.render(scene, camera);
}

function percentile(values, p) {
    if (values.length === 0) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
    return sorted[index];
}

function buildBenchmarkMetrics() {
    const frameDeltas = benchmark.frameDeltas.slice(10);
    const meanFrameMs = frameDeltas.length
        ? frameDeltas.reduce((sum, value) => sum + value, 0) / frameDeltas.length
        : null;

    return {
        status: benchmark.status,
        ready: Boolean(benchmark.events.defaultImageReadyMs),
        particleCount,
        viewport: {
            width: window.innerWidth,
            height: window.innerHeight,
            devicePixelRatio: window.devicePixelRatio
        },
        timingsMs: {
            appStart: benchmark.appStartMs,
            seedGeometry: benchmark.events.seedGeometryDurationMs ?? null,
            threeReady: benchmark.events.threeReadyMs ?? null,
            defaultImageLoad: benchmark.events.defaultImageLoadDurationMs ?? null,
            imageSampling: benchmark.events.imageSamplingDurationMs ?? null,
            particleAssignment: benchmark.events.particleAssignmentDurationMs ?? null,
            defaultReadyFromAppStart: benchmark.events.defaultImageReadyMs
                ? benchmark.events.defaultImageReadyMs - benchmark.appStartMs
                : null
        },
        image: benchmark.image ?? null,
        frames: {
            measuredFrames: frameDeltas.length,
            meanFrameMs,
            p95FrameMs: percentile(frameDeltas, 95),
            meanFps: meanFrameMs ? 1000 / meanFrameMs : null
        },
        audioEvents: benchmark.audioEvents,
        webgl: renderer
            ? {
                antialias: renderer.getContext().getContextAttributes().antialias,
                version: renderer.capabilities.isWebGL2 ? 'webgl2' : 'webgl1'
            }
            : null
    };
}

window.FloraPulseBenchmark = {
    version: '0.1.0',
    isEnabled: () => benchmarkMode,
    isReady: () => Boolean(benchmark.events.defaultImageReadyMs),
    getMetrics: buildBenchmarkMetrics
};

function createSeedGeometry() {
    const positions = new Float32Array(particleCount * 3);
    const targets = new Float32Array(particleCount * 3);
    const colors = new Float32Array(particleCount * 3);
    const randoms = new Float32Array(particleCount);

    for (let i = 0; i < particleCount; i += 1) {
        const r = hash01(i + 1);
        const angle = hash01(i + 17) * Math.PI * 2;
        const radius = Math.sqrt(hash01(i + 31)) * 4.2;

        positions[i * 3] = Math.cos(angle) * radius;
        positions[i * 3 + 1] = -5.5 + hash01(i + 47) * 1.2;
        positions[i * 3 + 2] = Math.sin(angle) * radius * 0.35;
        randoms[i] = r;

        const phi = Math.acos(-1 + (2 * i) / particleCount);
        const theta = Math.sqrt(particleCount * Math.PI) * phi;
        targets[i * 3] = 5.0 * Math.cos(theta) * Math.sin(phi);
        targets[i * 3 + 1] = 5.0 * Math.sin(theta) * Math.sin(phi) + 1.5;
        targets[i * 3 + 2] = 5.0 * Math.cos(phi);

        const colorBand = hash01(i + 79);
        if (colorBand < 0.3) {
            colors[i * 3] = 0.05 + hash01(i + 83) * 0.15;
            colors[i * 3 + 1] = 0.25 + hash01(i + 89) * 0.35;
            colors[i * 3 + 2] = 0.1 + hash01(i + 97) * 0.2;
        } else if (colorBand < 0.6) {
            colors[i * 3] = 0.1 + hash01(i + 101) * 0.2;
            colors[i * 3 + 1] = 0.3 + hash01(i + 103) * 0.3;
            colors[i * 3 + 2] = 0.2 + hash01(i + 107) * 0.3;
        } else {
            colors[i * 3] = 0.15 + hash01(i + 109) * 0.25;
            colors[i * 3 + 1] = 0.35 + hash01(i + 113) * 0.25;
            colors[i * 3 + 2] = 0.05 + hash01(i + 127) * 0.15;
        }
    }

    const bufferGeometry = new THREE.BufferGeometry();
    bufferGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    bufferGeometry.setAttribute('aRandom', new THREE.BufferAttribute(randoms, 1));
    bufferGeometry.setAttribute('targetPosition', new THREE.BufferAttribute(targets, 3));
    bufferGeometry.setAttribute('targetColor', new THREE.BufferAttribute(colors, 3));
    return bufferGeometry;
}

function initThree() {
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 1.8, 18);

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setClearColor(0x000000, 0);
    document.body.appendChild(renderer.domElement);

    const geometryStart = performance.now();
    geometry = createSeedGeometry();
    benchmark.events.seedGeometryDurationMs = performance.now() - geometryStart;
    material = new THREE.ShaderMaterial({
        uniforms: {
            uTime: { value: 0 },
            uSize: { value: 2.2 },
            uMorph: { value: 0 },
            uDisturbPoint: { value: disturbPoint },
            uDisturbStrength: { value: 0 }
        },
        vertexShader,
        fragmentShader,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false
    });

    scene.add(new THREE.Points(geometry, material));
    benchmark.events.threeReadyMs = performance.now();
}

async function initAudio() {
    if (audioCtx) return;
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    masterGain = audioCtx.createGain();
    masterGain.gain.value = muted ? 0 : 0.18;

    const delayNode = audioCtx.createDelay(1.0);
    delayNode.delayTime.value = 0.5;
    const feedback = audioCtx.createGain();
    feedback.gain.value = 0.4;
    delayNode.connect(feedback);
    feedback.connect(delayNode);
    masterGain.connect(audioCtx.destination);
    masterGain.connect(delayNode);
    delayNode.connect(audioCtx.destination);

    const bufferSize = 2 * audioCtx.sampleRate;
    const noiseBuffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i += 1) output[i] = Math.random() * 2 - 1;

    const windNoise = audioCtx.createBufferSource();
    const windFilter = audioCtx.createBiquadFilter();
    const windGain = audioCtx.createGain();
    windNoise.buffer = noiseBuffer;
    windNoise.loop = true;
    windFilter.type = 'lowpass';
    windFilter.frequency.value = 400;
    windGain.gain.value = 0.05;
    windNoise.connect(windFilter);
    windFilter.connect(windGain);
    windGain.connect(masterGain);
    windNoise.start();
}

function playSynth(freqs, height, type = 'sine', vol = 0.1) {
    if (!audioCtx || muted) return;
    benchmark.audioEvents += 1;
    const idx = Math.floor((1 - height) * freqs.length);
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freqs[idx] || 220, audioCtx.currentTime);
    gain.gain.setValueAtTime(0, audioCtx.currentTime);
    gain.gain.linearRampToValueAtTime(vol, audioCtx.currentTime + 0.1);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 2.0);
    osc.connect(gain);
    gain.connect(masterGain);
    osc.start();
    osc.stop(audioCtx.currentTime + 2.0);
}

function onHandResults(results) {
    if (!results.multiHandLandmarks || results.multiHandLandmarks.length === 0) {
        resetGestureFilter();
        disturbStrength = 0;
        disturbPoint.set(999, 999, 999);
        targetMorphFactor = idleMorphFactor;
        updateStatus('idle growth · move hand or pointer');
        return;
    }

    lastHandSeen = performance.now();
    updateStatus('hand detected · gesture mode');
    let rawMorphTarget = idleMorphFactor;
    let rawDisturbStrength = 0;
    rawGesturePoint.set(999, 999, 999);

    results.multiHandLandmarks.forEach((hand, idx) => {
        const label = results.multiHandedness[idx].label;
        const singleHand = results.multiHandLandmarks.length === 1;

        if (label === 'Left' || singleHand) {
            const distance = Math.hypot(hand[4].x - hand[8].x, hand[4].y - hand[8].y);
            rawMorphTarget = Math.min(1.0, distance * 3.5);
            if (rawMorphTarget > 0.6 && Math.random() > 0.97) {
                playSynth(freqGrowth, hand[8].y, 'triangle', 0.08);
            }
        }

        if (!singleHand && label === 'Right') {
            const x = (0.5 - hand[8].x) * 25;
            const y = (0.5 - hand[8].y) * 20 + 2;
            rawGesturePoint.set(x, y, 2);
            rawDisturbStrength = 1.0;
            if (Math.random() > 0.94) {
                playSynth(freqScatter, hand[8].y, 'sine', 0.05);
            }
        }
    });

    applyGestureFilter(rawMorphTarget, rawGesturePoint, rawDisturbStrength);
}

async function startCameraMode() {
    ui.start.style.display = 'none';
    ui.loading.hidden = false;
    updateStatus('requesting camera');

    try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        ui.video.srcObject = stream;

        handsInstance = new Hands({
            locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
        });
        handsInstance.setOptions({
            maxNumHands: 2,
            modelComplexity: 1,
            minDetectionConfidence: 0.5
        });
        handsInstance.onResults(onHandResults);

        const cameraFeed = new MediaPipeCamera(ui.video, {
            onFrame: async () => {
                if (handsInstance) await handsInstance.send({ image: ui.video });
            },
            width: 640,
            height: 480
        });
        cameraFeed.start();
        await initAudio();
        ui.overlay.remove();
        updateStatus('camera ready · waiting for hand');
    } catch (error) {
        await initAudio().catch(() => {});
        ui.overlay.remove();
        updateStatus('camera unavailable · pointer fallback active');
    }
}

function sampleImageToTargets(img) {
    const sampleStart = performance.now();
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const sampleSize = 160;
    const imageWorldSize = 12.2;

    canvas.width = sampleSize;
    canvas.height = sampleSize;
    ctx.clearRect(0, 0, sampleSize, sampleSize);

    const scale = Math.min(sampleSize / img.width, sampleSize / img.height);
    const drawW = img.width * scale;
    const drawH = img.height * scale;
    const drawX = (sampleSize - drawW) * 0.5;
    const drawY = (sampleSize - drawH) * 0.5;
    ctx.drawImage(img, drawX, drawY, drawW, drawH);

    const data = ctx.getImageData(0, 0, sampleSize, sampleSize).data;
    const points = [];
    for (let i = 0; i < data.length; i += 4) {
        const alpha = data[i + 3] / 255;
        const r = data[i] / 255;
        const g = data[i + 1] / 255;
        const b = data[i + 2] / 255;
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        const saturation = max === 0 ? 0 : (max - min) / max;
        const brightness = (r + g + b) / 3;
        const isBackgroundWhite = brightness > 0.965 && saturation < 0.08;

        if (alpha > 0.28 && !isBackgroundWhite) {
            const idx = i / 4;
            const px = idx % sampleSize;
            const py = Math.floor(idx / sampleSize);
            const luma = r * 0.2126 + g * 0.7152 + b * 0.0722;
            points.push({
                x: (px / sampleSize - 0.5) * imageWorldSize,
                y: (0.5 - py / sampleSize) * imageWorldSize + 1.5,
                luma,
                r,
                g,
                b
            });
        }
    }
    benchmark.events.imageSamplingDurationMs = performance.now() - sampleStart;
    benchmark.image = {
        sourceWidth: img.width,
        sourceHeight: img.height,
        sampleSize,
        acceptedPixels: points.length
    };
    return points;
}

function processImage(img) {
    const points = sampleImageToTargets(img);
    if (points.length === 0) {
        resetToSphere();
        updateStatus('image had no usable pixels · sphere fallback');
        return;
    }

    const assignmentStart = performance.now();
    const targetPositions = new Float32Array(particleCount * 3);
    const targetColors = new Float32Array(particleCount * 3);
    for (let i = 0; i < particleCount; i += 1) {
        const p = points[Math.floor(hash01(i + 101) * points.length)];
        const jitterX = (hash01(i + 203) - 0.5) * 0.055;
        const jitterY = (hash01(i + 307) - 0.5) * 0.055;
        targetPositions[i * 3] = p.x + jitterX;
        targetPositions[i * 3 + 1] = p.y + jitterY;
        targetPositions[i * 3 + 2] = (hash01(i + 409) - 0.5) * 0.85 + (p.luma - 0.5) * 0.32;
        targetColors[i * 3] = p.r;
        targetColors[i * 3 + 1] = p.g;
        targetColors[i * 3 + 2] = p.b;
    }

    geometry.attributes.targetPosition.array.set(targetPositions);
    geometry.attributes.targetColor.array.set(targetColors);
    geometry.attributes.targetPosition.needsUpdate = true;
    geometry.attributes.targetColor.needsUpdate = true;
    benchmark.events.particleAssignmentDurationMs = performance.now() - assignmentStart;
    targetMorphFactor = Math.max(targetMorphFactor, idleMorphFactor);
    updateStatus('botanical form loaded · gesture ready');

    if (new URLSearchParams(window.location.search).has('demo')) {
        morphFactor = Math.max(morphFactor, 0.82);
        renderOnce();
    }
}

function resetToSphere() {
    const targetPositions = new Float32Array(particleCount * 3);
    for (let i = 0; i < particleCount; i += 1) {
        const phi = Math.acos(-1 + (2 * i) / particleCount);
        const theta = Math.sqrt(particleCount * Math.PI) * phi;
        targetPositions[i * 3] = 5.0 * Math.cos(theta) * Math.sin(phi);
        targetPositions[i * 3 + 1] = 5.0 * Math.sin(theta) * Math.sin(phi) + 1.5;
        targetPositions[i * 3 + 2] = 5.0 * Math.cos(phi);
    }
    geometry.attributes.targetPosition.array.set(targetPositions);
    geometry.attributes.targetPosition.needsUpdate = true;
    resetGestureFilter();
    targetMorphFactor = idleMorphFactor;
    updateStatus('sphere field restored');
}

function loadDefaultImage() {
    const img = new Image();
    const loadStart = performance.now();
    img.onload = () => {
        benchmark.events.defaultImageLoadDurationMs = performance.now() - loadStart;
        processImage(img);
        benchmark.events.defaultImageReadyMs = performance.now();
        updateStatus('default rice loaded · gesture ready');
    };
    img.onerror = () => updateStatus('default rice missing · sphere fallback');
    img.src = defaultImage;
}

function toggleMute() {
    muted = !muted;
    if (masterGain) {
        masterGain.gain.setTargetAtTime(muted ? 0 : 0.18, audioCtx.currentTime, 0.05);
    }
    ui.mute.textContent = muted ? '开声' : '静音';
    updateStatus(muted ? 'sound muted' : 'sound enabled');
}

function activatePointer(clientX, clientY) {
    pointerPoint.copy(screenToWorld(clientX, clientY));
    pointerStrength = 0.82;
    pointerActiveUntil = performance.now() + 260;
    updateStatus('pointer fallback · botanical field responding');
}

function enableDemoModeIfRequested() {
    const params = new URLSearchParams(window.location.search);
    if (!params.has('demo')) return;

    setTimeout(() => {
        ui.overlay?.remove();
        targetMorphFactor = 0.82;
        morphFactor = Math.max(morphFactor, 0.72);
        renderOnce();
        updateStatus('demo mode · pointer interaction active');
    }, 500);
}

function animate() {
    requestAnimationFrame(animate);
    const now = performance.now();
    if (benchmark.lastFrameMs) {
        benchmark.frameDeltas.push(now - benchmark.lastFrameMs);
        if (benchmark.frameDeltas.length > 900) benchmark.frameDeltas.shift();
    }
    benchmark.lastFrameMs = now;
    const time = now * 0.001;
    material.uniforms.uTime.value = time;

    if (now < pointerActiveUntil && now - lastHandSeen > 700) {
        disturbPoint.copy(pointerPoint);
        disturbStrength = pointerStrength;
        targetMorphFactor = Math.max(targetMorphFactor, 0.72);
    } else if (now - lastHandSeen > 700 && disturbStrength > 0) {
        disturbStrength *= 0.92;
        if (disturbStrength < 0.02) {
            disturbStrength = 0;
            disturbPoint.set(999, 999, 999);
        }
    }

    morphFactor += (targetMorphFactor - morphFactor) * 0.015;
    material.uniforms.uMorph.value = morphFactor;
    material.uniforms.uDisturbStrength.value = disturbStrength;
    renderer.render(scene, camera);
}

function bindEvents() {
    ui.start.addEventListener('click', startCameraMode);
    ui.size.addEventListener('input', (event) => {
        material.uniforms.uSize.value = event.target.value;
    });
    ui.mute.addEventListener('click', toggleMute);
    ui.reset.addEventListener('click', resetToSphere);
    ui.upload.addEventListener('change', (event) => {
        const file = event.target.files[0];
        if (!file) return;

        updateStatus('loading uploaded plant image');
        const reader = new FileReader();
        reader.onload = (readerEvent) => {
            const img = new Image();
            img.onload = () => processImage(img);
            img.src = readerEvent.target.result;
        };
        reader.readAsDataURL(file);
    });

    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    });
    window.addEventListener('pointermove', (event) => activatePointer(event.clientX, event.clientY));
    window.addEventListener('touchmove', (event) => {
        const touch = event.touches[0];
        if (touch) activatePointer(touch.clientX, touch.clientY);
    }, { passive: true });
}

initThree();
loadDefaultImage();
bindEvents();
enableDemoModeIfRequested();
animate();
