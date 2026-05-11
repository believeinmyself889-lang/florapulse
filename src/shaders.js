export const vertexShader = `
    uniform float uTime;
    uniform float uMorph;
    uniform float uSize;
    uniform vec3 uDisturbPoint;
    uniform float uDisturbStrength;

    attribute float aRandom;
    attribute vec3 targetPosition;
    attribute vec3 targetColor;

    varying vec3 vColor;
    varying float vAlpha;

    void main() {
        vColor = mix(vec3(0.01), targetColor, uMorph);
        float rnd = aRandom;

        vec3 initialPos = position;
        initialPos.y = -15.0 + position.y * 0.1;
        initialPos.x += sin(uTime * 0.5 + rnd * 6.28) * 3.0 * (1.0 - uMorph);

        float growth = smoothstep(0.0, 1.0, uMorph);
        float birth = smoothstep(rnd * 0.34, 0.98, uMorph);
        vec3 pos = mix(initialPos, targetPosition, growth);

        float dist = distance(pos, uDisturbPoint);
        if (dist < 5.0) {
            float force = (1.0 - dist / 5.0) * uDisturbStrength;
            vec3 dir = normalize(pos - uDisturbPoint + vec3(0.001));
            pos += dir * force * 3.0;
        }

        float swayX = sin(uTime * 0.4 + pos.y * 0.5 + rnd * 4.0) * 0.5 * uMorph;
        float swayZ = cos(uTime * 0.3 + pos.x * 0.5 + rnd * 3.0) * 0.3 * uMorph;
        pos.x += swayX;
        pos.z += swayZ;

        vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
        gl_PointSize = uSize * (300.0 / -mvPosition.z);
        float depthFactor = clamp((mvPosition.z + 20.0) / 40.0, 0.3, 1.0);
        gl_PointSize *= depthFactor;
        gl_PointSize *= (0.8 + 0.2 * sin(uTime * 2.0 + rnd * 10.0));
        gl_PointSize *= (0.5 + 0.5 * uMorph);

        gl_Position = projectionMatrix * mvPosition;
        vAlpha = smoothstep(-40.0, -1.0, mvPosition.z) * (0.3 + 0.7 * uMorph) * birth;
    }
`;

export const fragmentShader = `
    varying vec3 vColor;
    varying float vAlpha;

    void main() {
        float dist = distance(gl_PointCoord, vec2(0.5));
        if (dist > 0.5) discard;

        float strength = pow(1.0 - dist * 2.0, 2.0);
        vec3 lightDir = normalize(vec3(0.5, 0.5, 1.0));
        vec3 normal = normalize(vec3(gl_PointCoord - vec2(0.5), 0.8));
        float lighting = max(0.3, dot(normal, lightDir));
        float highlight = pow(max(0.0, dot(normal, lightDir)), 8.0);
        vec3 finalColor = vColor * lighting + vec3(highlight * 0.5);
        float glow = pow(1.0 - dist * 1.5, 3.0);

        gl_FragColor = vec4(finalColor, (strength * 0.7 + glow * 0.3) * vAlpha);
    }
`;
