'use strict';

let gl;                         // The webgl context.
let surface;                    // The surface model.
let shProgram;                  // A shader program.
let spaceball;                  // TrackballRotator.
let uSlider, vSlider;           // Sliders for granularity.
let uGranularity = 30, vGranularity = 60; // Initial granularity.

let texDiffuse, texSpecular, texNormal; // textures

// ----------------- PARAMS -----------------
const SCALE = 0.35;

// Domain for parameters p1, p2
const P_MIN = -Math.PI / 2;
const P_MAX =  Math.PI / 2;

// Draw both ± branches for each solved coordinate
const DRAW_BOTH_SIGNS = true;

// ----------------- CORE MATH -----------------
// (Keep solveThird and mapXYZ as they are)
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
    this.texCoordBuffer = gl.createBuffer(); 
    this.tangentBuffer = gl.createBuffer();
    this.count = 0;
    this.uvs = []; 
    this.tangents = [];

    this.BufferData = function(vertices, normals, uvs, tangents, indices) {
        gl.bindBuffer(gl.ARRAY_BUFFER, this.iVertexBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.iNormalBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(normals), gl.STATIC_DRAW);

        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.iIndexBuffer);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(indices), gl.STATIC_DRAW);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.texCoordBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(uvs), gl.STATIC_DRAW);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.tangentBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(tangents), gl.STATIC_DRAW);

        this.count = indices.length;
    };

    this.Draw = function() {        

        // a_vertex
        gl.bindBuffer(gl.ARRAY_BUFFER, this.iVertexBuffer);
        gl.vertexAttribPointer(shProgram.iAttribVertex, 3, gl.FLOAT, false, 0, 0);
        gl.enableVertexAttribArray(shProgram.iAttribVertex);

        // a_normal
        gl.bindBuffer(gl.ARRAY_BUFFER, this.iNormalBuffer);
        gl.vertexAttribPointer(shProgram.iAttribNormal, 3, gl.FLOAT, false, 0, 0);
        gl.enableVertexAttribArray(shProgram.iAttribNormal);

        // a_texCoord (vec2)
        gl.bindBuffer(gl.ARRAY_BUFFER, this.texCoordBuffer);
        gl.vertexAttribPointer(shProgram.iAttribTexCoord, 2, gl.FLOAT, false, 0, 0);
        gl.enableVertexAttribArray(shProgram.iAttribTexCoord);

        // a_tangent (vec4)
        gl.bindBuffer(gl.ARRAY_BUFFER, this.tangentBuffer);
        gl.vertexAttribPointer(shProgram.iAttribTangent, 4, gl.FLOAT, false, 0, 0);
        gl.enableVertexAttribArray(shProgram.iAttribTangent);

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
    let uvs = [];
    let tangents = [];

    
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
                    const u = (p1 + Math.PI/2) / Math.PI;
                    const v = (p2 + Math.PI/2) / Math.PI;

                    if (third === null) {
                        vertices.push(NaN, NaN, NaN);
                        uvs.push(u, v);               // <-- обов'язково, щоб uv було на кожну вершину
                    } else {
                        const [x, y, z] = mapXYZ(patchType, p1, p2, third);
                        vertices.push(x * SCALE, y * SCALE, z * SCALE);
                        uvs.push((p1 + Math.PI/2) / Math.PI, (p2 + Math.PI/2) / Math.PI);
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



    // 3. Calculate tangents
    (function computeTangents() {
        const EPS = 1e-8;

        const tan1 = new Float32Array(numVertices * 3); // gathering T
        const tan2 = new Float32Array(numVertices * 3); // gathering B

        const normalize3 = (x, y, z) => {
            const len = Math.hypot(x, y, z);
            if (len < EPS) return [0, 0, 0];
            return [x / len, y / len, z / len];
        };
        const dot3 = (ax, ay, az, bx, by, bz) => ax*bx + ay*by + az*bz;
        const cross3 = (ax, ay, az, bx, by, bz) => ([
            ay*bz - az*by,
            az*bx - ax*bz,
            ax*by - ay*bx
        ]);

        for (let f = 0; f < indices.length; f += 3) {
            const i0 = indices[f], i1 = indices[f + 1], i2 = indices[f + 2];

            const p0 = i0 * 3, p1 = i1 * 3, p2 = i2 * 3;
            const w0 = i0 * 2, w1 = i1 * 2, w2 = i2 * 2;

            const x0 = vertices[p0],     y0 = vertices[p0 + 1],     z0 = vertices[p0 + 2];
            const x1 = vertices[p1],     y1 = vertices[p1 + 1],     z1 = vertices[p1 + 2];
            const x2 = vertices[p2],     y2 = vertices[p2 + 1],     z2 = vertices[p2 + 2];

            // Skip invalid triangles
            if (isNaN(x0) || isNaN(x1) || isNaN(x2)) continue;

            const u0 = uvs[w0],     v0 = uvs[w0 + 1];
            const u1 = uvs[w1],     v1 = uvs[w1 + 1];
            const u2 = uvs[w2],     v2 = uvs[w2 + 1];

            const dx1 = x1 - x0, dy1 = y1 - y0, dz1 = z1 - z0;
            const dx2 = x2 - x0, dy2 = y2 - y0, dz2 = z2 - z0;

            const du1 = u1 - u0, dv1 = v1 - v0;
            const du2 = u2 - u0, dv2 = v2 - v0;

            const denom = du1 * dv2 - du2 * dv1;
            if (Math.abs(denom) < EPS) continue;

            const r = 1.0 / denom;

            // tangent (from U direction in UV)
            const tx = (dx1 * dv2 - dx2 * dv1) * r;
            const ty = (dy1 * dv2 - dy2 * dv1) * r;
            const tz = (dz1 * dv2 - dz2 * dv1) * r;

            // bitangent (from V direction in UV)
            const bx = (dx2 * du1 - dx1 * du2) * r;
            const by = (dy2 * du1 - dy1 * du2) * r;
            const bz = (dz2 * du1 - dz1 * du2) * r;

            // accumulate per-vertex
            tan1[p0]     += tx; tan1[p0 + 1] += ty; tan1[p0 + 2] += tz;
            tan1[p1]     += tx; tan1[p1 + 1] += ty; tan1[p1 + 2] += tz;
            tan1[p2]     += tx; tan1[p2 + 1] += ty; tan1[p2 + 2] += tz;

            tan2[p0]     += bx; tan2[p0 + 1] += by; tan2[p0 + 2] += bz;
            tan2[p1]     += bx; tan2[p1 + 1] += by; tan2[p1 + 2] += bz;
            tan2[p2]     += bx; tan2[p2 + 1] += by; tan2[p2 + 2] += bz;
        }

        // Final tan(vec3) + w
        tangents = new Float32Array(numVertices * 4);

        for (let i = 0; i < numVertices; i++) {
            const p = i * 3;

            // If vertex is invalid, set default tangent
            if (isNaN(vertices[p])) {
                tangents[i*4 + 0] = 1;
                tangents[i*4 + 1] = 0;
                tangents[i*4 + 2] = 0;
                tangents[i*4 + 3] = 1;
                continue;
            }

            // N
            let nx = normals[p], ny = normals[p + 1], nz = normals[p + 2];
            [nx, ny, nz] = normalize3(nx, ny, nz);

            // T gathered
            let tx = tan1[p], ty = tan1[p + 1], tz = tan1[p + 2];

            // Gram–Schmidt: PRIORITIZE NORMAL OVER TANGENT
            const dotNT = dot3(nx, ny, nz, tx, ty, tz);
            tx -= dotNT * nx;
            ty -= dotNT * ny;
            tz -= dotNT * nz;

            [tx, ty, tz] = normalize3(tx, ty, tz);
            if (Math.hypot(tx, ty, tz) < EPS) {
                // fallback if tangent is broken
                tx = 1; ty = 0; tz = 0;
            }

            // w (handedness) from B direction
            const bx = tan2[p], by = tan2[p + 1], bz = tan2[p + 2];
            const cx = cross3(nx, ny, nz, tx, ty, tz); // cross(N, T)
            const w = (dot3(cx[0], cx[1], cx[2], bx, by, bz) < 0.0) ? -1.0 : 1.0;

            tangents[i*4 + 0] = tx;
            tangents[i*4 + 1] = ty;
            tangents[i*4 + 2] = tz;
            tangents[i*4 + 3] = w;
        }
    })();


    
    return { vertices, normals, uvs, tangents, indices };

}

function resizeCanvasToDisplaySize(canvas) {
    const dpr = window.devicePixelRatio || 1;
    const displayWidth  = Math.floor(canvas.clientWidth  * dpr);
    const displayHeight = Math.floor(canvas.clientHeight * dpr);

    if (canvas.width !== displayWidth || canvas.height !== displayHeight) {
        canvas.width  = displayWidth;
        canvas.height = displayHeight;
        return true;
    }
    return false;
}


let lightAngle = 0;

function draw() {
    resizeCanvasToDisplaySize(gl.canvas);
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);

    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);


    const aspect = gl.canvas.clientWidth / gl.canvas.clientHeight;
    const projection = m4.perspective(Math.PI / 8, aspect, 0.1, 100.0);
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
    gl.uniformMatrix4fv(shProgram.iModelViewMatrix, false, modelViewMatrix);
    gl.uniformMatrix4fv(shProgram.iProjectionMatrix, false, projection);
    gl.uniformMatrix4fv(shProgram.iNormalMatrix, false, normalMatrix); // mat4
    gl.uniform3fv(shProgram.iLightPos, lightEyePos);

    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texDiffuse);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, texSpecular);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, texNormal);


    surface.Draw();
}

function frame() {
    lightAngle += 0.01;
    draw();
    requestAnimationFrame(frame);
}

function updateSurface() {
    const data = CreateSurfaceData(uGranularity, vGranularity);
    surface.BufferData(data.vertices, data.normals, data.uvs, data.tangents, data.indices);

    draw();
}


function loadTexture(url) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);

    // Temporary 1x1 pixel while image loads
    gl.texImage2D(
        gl.TEXTURE_2D, 0, gl.RGBA,
        1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE,
        new Uint8Array([128, 128, 128, 255])
    );

    const img = new Image();
    img.onload = () => {
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
        gl.generateMipmap(gl.TEXTURE_2D);
    };
    img.onerror = () => console.error("Texture failed to load:", url);
    img.src = url;

    return tex;
}

    
function initGL() {
    let prog = createProgram(gl, vertexShaderSource, fragmentShaderSource);

    texDiffuse  = loadTexture("textures/diffuse.jpg");
    texSpecular = loadTexture("textures/specular.jpg");
    texNormal   = loadTexture("textures/normal.jpg");



    shProgram = new ShaderProgram('Basic', prog);
    shProgram.Use();

    shProgram.iAttribVertex   = gl.getAttribLocation(prog, "a_vertex");
    shProgram.iAttribNormal   = gl.getAttribLocation(prog, "a_normal");
    shProgram.iAttribTexCoord = gl.getAttribLocation(prog, "a_texCoord");
    shProgram.iAttribTangent  = gl.getAttribLocation(prog, "a_tangent");

    shProgram.iModelViewMatrix  = gl.getUniformLocation(prog, "u_modelViewMatrix");
    shProgram.iProjectionMatrix = gl.getUniformLocation(prog, "u_projectionMatrix");
    shProgram.iNormalMatrix     = gl.getUniformLocation(prog, "u_normalMatrix");

    shProgram.iLightPos      = gl.getUniformLocation(prog, "u_lightPos");
    shProgram.iAmbientColor  = gl.getUniformLocation(prog, "u_ambientColor");
    shProgram.iDiffuseColor  = gl.getUniformLocation(prog, "u_diffuseColor");
    shProgram.iSpecularColor = gl.getUniformLocation(prog, "u_specularColor");
    shProgram.iShininess     = gl.getUniformLocation(prog, "u_shininess");

    shProgram.iDiffuseTex  = gl.getUniformLocation(prog, "u_diffuseTex");
    shProgram.iSpecularTex = gl.getUniformLocation(prog, "u_specularTex");
    shProgram.iNormalTex   = gl.getUniformLocation(prog, "u_normalTex");

    gl.uniform1i(shProgram.iDiffuseTex, 0);
    gl.uniform1i(shProgram.iSpecularTex, 1);
    gl.uniform1i(shProgram.iNormalTex, 2);


    // --- material / light params (PA3)
    gl.uniform3fv(shProgram.iAmbientColor,  [0.12, 0.12, 0.12]);
    gl.uniform3fv(shProgram.iDiffuseColor,  [1.00, 1.00, 1.00]);
    gl.uniform3fv(shProgram.iSpecularColor, [1.00, 1.00, 1.00]);
    gl.uniform1f(shProgram.iShininess, 64.0);




    surface = new Model('Surface');    
    gl.enable(gl.DEPTH_TEST);
    updateSurface();

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
