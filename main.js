'use strict';

let gl;                         // The webgl context.
let surface;                    // The surface model.
let shProgram;                  // A shader program.
let spaceball;                  // TrackballRotator.
let uSlider, vSlider;           // Sliders for granularity.
let uGranularity = 30, vGranularity = 60; // Initial granularity.

// ----------------- PARAMS -----------------
const SCALE = 0.35;

// Domain for parameters p1, p2
const P_MIN = -Math.PI / 2;
const P_MAX =  Math.PI / 2;

// Draw both ± branches for each solved coordinate
const DRAW_BOTH_SIGNS = true;

// ----------------- CORE MATH -----------------
function solveThird(a, b, sign) {
    const ca = Math.cos(a), cb = Math.cos(b);
    const denom = 3.0 + 4.0 * ca * cb;
    if (Math.abs(denom) < 1e-6) return null;

    const arg = -3.0 * (ca + cb) / denom;
    if (arg < -1.0 || arg > 1.0) return null;

    const t = Math.acos(arg);
    return (sign > 0) ? t : -t;
}

function mapXYZ(patchType, p1, p2, third) {
    if (patchType === 'Z') return [p1, p2, third];
    if (patchType === 'X') return [third, p1, p2];
    if (patchType === 'Y') return [p1, third, p2];
    return [0, 0, 0];
}

// ----------------- MODEL and SHADER -----------------
function Model(name) {
    this.name = name;
    this.iVertexBuffer = gl.createBuffer();
    this.iIndexBuffer = gl.createBuffer();
    this.iNormalBuffer = gl.createBuffer();
    this.count = 0;

    this.BufferData = function(vertices, normals, indices) {
        gl.bindBuffer(gl.ARRAY_BUFFER, this.iVertexBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.iNormalBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(normals), gl.STATIC_DRAW);

        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.iIndexBuffer);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(indices), gl.STATIC_DRAW);

        this.count = indices.length;
    };

    this.Draw = function() {
        gl.bindBuffer(gl.ARRAY_BUFFER, this.iVertexBuffer);
        gl.vertexAttribPointer(shProgram.iAttribVertex, 3, gl.FLOAT, false, 0, 0);
        gl.enableVertexAttribArray(shProgram.iAttribVertex);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.iNormalBuffer);
        gl.vertexAttribPointer(shProgram.iAttribNormal, 3, gl.FLOAT, false, 0, 0);
        gl.enableVertexAttribArray(shProgram.iAttribNormal);

        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.iIndexBuffer);
        gl.drawElements(gl.TRIANGLES, this.count, gl.UNSIGNED_SHORT, 0);
    };
}

function ShaderProgram(name, program) {
    this.name = name;
    this.prog = program;
    this.iAttribVertex = -1;
    this.iAttribNormal = -1;
    this.iModelViewProjectionMatrix = -1;
    this.iModelViewMatrix = -1;
    this.iNormalMatrix = -1;
    this.iLightPos = -1;
    this.Use = function() {
        gl.useProgram(this.prog);
    };
}

// ----------------- SURFACE DATA -----------------
function CreateSurfaceData(uLines, vSamples) {
    let vertices = [];
    let indices = [];
    
    const signs = DRAW_BOTH_SIGNS ? [+1, -1] : [+1];
    const patches = ['Z', 'X', 'Y'];

    for (const patchType of patches) {
        for (const sgn of signs) {
            const patchStartIndex = vertices.length / 3;

            for (let i = 0; i < uLines; i++) {
                const p1 = P_MIN + (P_MAX - P_MIN) * i / (uLines - 1);
                for (let j = 0; j < vSamples; j++) {
                    const p2 = P_MIN + (P_MAX - P_MIN) * j / (vSamples - 1);

                    const third = solveThird(p1, p2, sgn);
                    if (third === null) {
                        vertices.push(NaN, NaN, NaN); // Invalid vertex marker
                    } else {
                        const [x, y, z] = mapXYZ(patchType, p1, p2, third);
                        vertices.push(x * SCALE, y * SCALE, z * SCALE);
                    }
                }
            }

            for (let i = 0; i < uLines - 1; i++) {
                for (let j = 0; j < vSamples - 1; j++) {
                    const i0 = patchStartIndex + i * vSamples + j;
                    const i1 = i0 + 1;
                    const i2 = i0 + vSamples;
                    const i3 = i2 + 1;
                    
                    if (isNaN(vertices[i0*3]) || isNaN(vertices[i1*3]) || isNaN(vertices[i2*3]) || isNaN(vertices[i3*3])) {
                        continue;
                    }

                    indices.push(i0, i1, i2);
                    indices.push(i1, i3, i2);
                }
            }
        }
    }

    // ----- Calculate Normals (Facet Angle Weighted Average) -----

    const numVertices = vertices.length / 3;
    let normals = new Array(numVertices * 3).fill(0);
    let vertexFaces = Array.from({ length: numVertices }, () => []);

    // 1. Find all faces adjacent to each vertex
    for (let i = 0; i < indices.length; i += 3) {
        const i0 = indices[i];
        const i1 = indices[i+1];
        const i2 = indices[i+2];
        vertexFaces[i0].push(i);
        vertexFaces[i1].push(i);
        vertexFaces[i2].push(i);
    }
    
    // 2. Calculate weighted normals
    for (let i = 0; i < numVertices; i++) {
        let totalNormal = [0, 0, 0];

        if (isNaN(vertices[i*3])) continue; // Skip invalid vertices

        // For each adjacent face...
        for (const faceIndex of vertexFaces[i]) {
            const i0 = indices[faceIndex];
            const i1 = indices[faceIndex + 1];
            const i2 = indices[faceIndex + 2];
            
            const v0 = vertices.slice(i0 * 3, i0 * 3 + 3);
            const v1 = vertices.slice(i1 * 3, i1 * 3 + 3);
            const v2 = vertices.slice(i2 * 3, i2 * 3 + 3);

            // Find which vertex in the triangle corresponds to the current vertex `i`
            let p, a, b;
            if (i0 === i) { p = v0; a = v1; b = v2; }
            else if (i1 === i) { p = v1; a = v0; b = v2; }
            else { p = v2; a = v0; b = v1; }

            // Calculate face normal and corner angle
            const edge1 = m4.subtractVectors(a, p);
            const edge2 = m4.subtractVectors(b, p);

            const faceNormal = m4.cross(edge1, edge2); // Not normalized

            const normEdge1 = m4.normalize(edge1);
            const normEdge2 = m4.normalize(edge2);
            let cosAngle = m4.dot(normEdge1, normEdge2);
            cosAngle = Math.max(-1.0, Math.min(1.0, cosAngle)); // Clamp for safety
            const angle = Math.acos(cosAngle);

            // Add weighted normal
            totalNormal = m4.addVectors(totalNormal, m4.scaleVector(faceNormal, angle));
        }
        
        const finalNormal = m4.normalize(totalNormal);
        normals[i * 3]     = finalNormal[0];
        normals[i * 3 + 1] = finalNormal[1];
        normals[i * 3 + 2] = finalNormal[2];
    }
    
    return { vertices, normals, indices };
}


let lightAngle = 0;

function draw() {
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    const projection = m4.perspective(Math.PI / 8, 1, 8, 12);
    const camera = spaceball.getViewMatrix();
    const rotateToPointZero = m4.axisRotation([0.707, 0.707, 0], 0.7);
    const translateToPointZero = m4.translation(0, 0, -10);

    const modelMatrix = m4.multiply(rotateToPointZero, m4.identity());

    // --- Model-view and projection matrices
    const modelViewMatrix = m4.multiply(translateToPointZero, m4.multiply(camera, modelMatrix));
    const modelViewProjection = m4.multiply(projection, modelViewMatrix);
    
    // --- Normal Matrix
    const normalMatrix = m4.transpose(m4.inverse(modelViewMatrix));
    const normalMatrix3 = [
        normalMatrix[0], normalMatrix[1], normalMatrix[2],
        normalMatrix[4], normalMatrix[5], normalMatrix[6],
        normalMatrix[8], normalMatrix[9], normalMatrix[10]
    ];

    // --- Light Position
    const lightRadius = 4.0;
    const lightWorldPos = [
        Math.cos(lightAngle) * lightRadius, 
        2.0, 
        Math.sin(lightAngle) * lightRadius
    ];
    // The light position in the shader is in eye space, so we need to transform it.
    // The "camera" matrix transforms world to eye space.
    const lightEyePos = m4.transformPoint(m4.multiply(translateToPointZero, camera), lightWorldPos);
    
    // --- Set Uniforms
    gl.uniformMatrix4fv(shProgram.iModelViewProjectionMatrix, false, modelViewProjection);
    gl.uniformMatrix4fv(shProgram.iModelViewMatrix, false, modelViewMatrix);
    gl.uniformMatrix3fv(shProgram.iNormalMatrix, false, normalMatrix3);
    gl.uniform3fv(shProgram.iLightPos, lightEyePos);

    surface.Draw();
}

function frame() {
    lightAngle += 0.01;
    draw();
    requestAnimationFrame(frame);
}

function updateSurface() {
    const data = CreateSurfaceData(uGranularity, vGranularity);
    surface.BufferData(data.vertices, data.normals, data.indices);
    draw();
}

function initGL() {
    let prog = createProgram(gl, vertexShaderSource, fragmentShaderSource);

    shProgram = new ShaderProgram('Basic', prog);
    shProgram.Use();

    shProgram.iAttribVertex = gl.getAttribLocation(prog, "vertex");
    shProgram.iAttribNormal = gl.getAttribLocation(prog, "normal");
    shProgram.iModelViewProjectionMatrix = gl.getUniformLocation(prog, "ModelViewProjectionMatrix");
    shProgram.iModelViewMatrix = gl.getUniformLocation(prog, "ModelViewMatrix");
    shProgram.iNormalMatrix = gl.getUniformLocation(prog, "NormalMatrix");
    shProgram.iLightPos = gl.getUniformLocation(prog, "lightPos");

    surface = new Model('Surface');
    updateSurface();

    gl.enable(gl.DEPTH_TEST);
}


function createProgram(gl, vShader, fShader) {
    let vsh = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vsh, vShader);
    gl.compileShader(vsh);
    if (!gl.getShaderParameter(vsh, gl.COMPILE_STATUS)) {
        throw new Error("Error in vertex shader:  " + gl.getShaderInfoLog(vsh));
    }

    let fsh = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fsh, fShader);
    gl.compileShader(fsh);
    if (!gl.getShaderParameter(fsh, gl.COMPILE_STATUS)) {
        throw new Error("Error in fragment shader:  " + gl.getShaderInfoLog(fsh));
    }

    let prog = gl.createProgram();
    gl.attachShader(prog, vsh);
    gl.attachShader(prog, fsh);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        throw new Error("Link error in program:  " + gl.getProgramInfoLog(prog));
    }
    return prog;
}


function init() {
    uSlider = document.getElementById("u-slider");
    vSlider = document.getElementById("v-slider");
    const uValue = document.getElementById("u-value");
    const vValue = document.getElementById("v-value");

    uSlider.addEventListener("input", () => {
        uGranularity = parseInt(uSlider.value);
        uValue.textContent = uGranularity;
        updateSurface();
    });
    vSlider.addEventListener("input", () => {
        vGranularity = parseInt(vSlider.value);
        vValue.textContent = vGranularity;
        updateSurface();
    });

    let canvas;
    try {
        canvas = document.getElementById("webglcanvas");
        spaceball = new TrackballRotator(canvas, draw, 0); // Initialize spaceball early
        gl = canvas.getContext("webgl");
        if (!gl) throw "Browser does not support WebGL";
    }
    catch (e) {
        document.getElementById("canvas-holder").innerHTML =
            "<p>Sorry, could not get a WebGL graphics context.</p>";
        return;
    }

    try {
        initGL();
    }
    catch (e) {
        document.getElementById("canvas-holder").innerHTML =
            "<p>Sorry, could not initialize the WebGL graphics context: " + e + "</p>";
        return;
    }
    
    frame(); // Start the animation
}
