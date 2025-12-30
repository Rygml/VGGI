'use strict';

let gl;                         // The webgl context.
let surfaceU;                   // U polylines (1st vertex set)
let surfaceV;                   // V polylines (2nd vertex set)
let shProgram;                  // A shader program
let spaceball;                  // TrackballRotator

// ----------------- PARAMS -----------------
const SCALE = 0.35;

// Domain for parameters p1, p2
const P_MIN = -Math.PI / 2;
const P_MAX =  Math.PI / 2;

// Grid density
const LINES = 30;      // how many polylines per family per patch
const SAMPLES = 60;    // how many points along each polyline

// Draw both ± branches for each solved coordinate
const DRAW_BOTH_SIGNS = true;

// ----------------- CORE MATH -----------------
// Solve cos(third) = -3 (cos a + cos b) / (3 + 4 cos a cos b)
// third = ± arccos(...)
function solveThird(a, b, sign) {
    const ca = Math.cos(a), cb = Math.cos(b);
    const denom = 3.0 + 4.0 * ca * cb;
    if (Math.abs(denom) < 1e-6) return null;

    const arg = -3.0 * (ca + cb) / denom;
    if (arg < -1.0 || arg > 1.0) return null;

    const t = Math.acos(arg);
    return (sign > 0) ? t : -t;
}

// Map (p1,p2,third) to xyz depending on which coordinate we solved for.
function mapXYZ(patchType, p1, p2, third) {
    // patchType:
    // 'Z' => x=p1, y=p2, z=third
    // 'X' => y=p1, z=p2, x=third
    // 'Y' => x=p1, z=p2, y=third
    if (patchType === 'Z') return [p1, p2, third];
    if (patchType === 'X') return [third, p1, p2];
    if (patchType === 'Y') return [p1, third, p2];
    return [0, 0, 0];
}

// Constructor
function Model(name) {
    this.name = name;
    this.iVertexBuffer = gl.createBuffer();
    this.count = 0;
    this.segments = [];

    this.BufferData = function(vertices, segments) {
        gl.bindBuffer(gl.ARRAY_BUFFER, this.iVertexBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);

        this.count = vertices.length / 3;
        this.segments = (segments && segments.length) ? segments : [{ start: 0, count: this.count }];
    };

    this.Draw = function() {
        gl.bindBuffer(gl.ARRAY_BUFFER, this.iVertexBuffer);
        gl.vertexAttribPointer(shProgram.iAttribVertex, 3, gl.FLOAT, false, 0, 0);
        gl.enableVertexAttribArray(shProgram.iAttribVertex);

        for (const seg of this.segments) {
            if (seg.count >= 2) gl.drawArrays(gl.LINE_STRIP, seg.start, seg.count);
        }
    };
}

// Constructor
function ShaderProgram(name, program) {

    this.name = name;
    this.prog = program;

    // Location of the attribute variable in the shader program.
    this.iAttribVertex = -1;
    // Location of the uniform specifying a color for the primitive.
    this.iColor = -1;
    // Location of the uniform matrix representing the combined transformation.
    this.iModelViewProjectionMatrix = -1;

    this.Use = function() {
        gl.useProgram(this.prog);
    }
}

// ----------------- SURFACE DATA (U + V) -----------------
function CreateSurfaceData() {
    // We will build TWO global sets:
    //  U set: "first parameter const, second varying" for all patches
    //  V set: "second parameter const, first varying" for all patches
    const U = { vertices: [], segments: [] };
    const V = { vertices: [], segments: [] };

    const signs = DRAW_BOTH_SIGNS ? [+1, -1] : [+1];
    const patches = ['Z', 'X', 'Y']; // solve Z, solve X, solve Y

    function appendPolyline(target, points) {
        // points: array of [x,y,z] already filtered (>=2)
        const start = target.vertices.length / 3;
        for (const p of points) {
            target.vertices.push(p[0] * SCALE, p[1] * SCALE, p[2] * SCALE);
        }
        target.segments.push({ start, count: points.length });
    }

    function buildFamilyForPatch(target, patchType, sign, isUFamily) {
        // isUFamily:
        //  true  => p1 = const, p2 varies
        //  false => p2 = const, p1 varies
        for (let li = 0; li < LINES; li++) {
            const tLine = (LINES === 1) ? 0 : li / (LINES - 1);
            const cVal = P_MIN + (P_MAX - P_MIN) * tLine;

            let current = [];

            for (let si = 0; si < SAMPLES; si++) {
                const tS = (SAMPLES === 1) ? 0 : si / (SAMPLES - 1);
                const sVal = P_MIN + (P_MAX - P_MIN) * tS;

                const p1 = isUFamily ? cVal : sVal;
                const p2 = isUFamily ? sVal : cVal;

                const third = solveThird(p1, p2, sign);
                if (third === null) {
                    // break segment
                    if (current.length >= 2) appendPolyline(target, current);
                    current = [];
                    continue;
                }

                const xyz = mapXYZ(patchType, p1, p2, third);
                current.push(xyz);
            }

            if (current.length >= 2) appendPolyline(target, current);
        }
    }

    // Build all 6 sheets: for each patch type (Z/X/Y) and sign (+/-)
    for (const patchType of patches) {
        for (const sgn of signs) {
            // U set: p1 const, p2 varies
            buildFamilyForPatch(U, patchType, sgn, true);
            // V set: p2 const, p1 varies
            buildFamilyForPatch(V, patchType, sgn, false);
        }
    }

    return { U, V };
}

/* Draws a colored cube, along with a set of coordinate axes.
 * (Note that the use of the above drawPrimitive function is not an efficient
 * way to draw with WebGL.  Here, the geometry is so simple that it doesn't matter.)
 */
function draw() {
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    let projection = m4.perspective(Math.PI / 8, 1, 8, 12);

    let modelView = spaceball.getViewMatrix();

    let rotateToPointZero = m4.axisRotation([0.707, 0.707, 0], 0.7);
    let translateToPointZero = m4.translation(0, 0, -10);

    let matAccum0 = m4.multiply(rotateToPointZero, modelView);
    let matAccum1 = m4.multiply(translateToPointZero, matAccum0);

    let modelViewProjection = m4.multiply(projection, matAccum1);
    gl.uniformMatrix4fv(shProgram.iModelViewProjectionMatrix, false, modelViewProjection);

    // U family
    gl.uniform4fv(shProgram.iColor, [1, 1, 0, 1]); // yellow
    surfaceU.Draw();

    // V family
    gl.uniform4fv(shProgram.iColor, [0, 1, 1, 1]);  // cyan
    surfaceV.Draw();
}

/* Initialize the WebGL context. Called from init() */
function initGL() {
    let prog = createProgram(gl, vertexShaderSource, fragmentShaderSource);

    shProgram = new ShaderProgram('Basic', prog);
    shProgram.Use();

    shProgram.iAttribVertex              = gl.getAttribLocation(prog, "vertex");
    shProgram.iModelViewProjectionMatrix = gl.getUniformLocation(prog, "ModelViewProjectionMatrix");
    shProgram.iColor                     = gl.getUniformLocation(prog, "color");

    // Build TWO sets of vertices: U and V
    const data = CreateSurfaceData();

    surfaceU = new Model('SurfaceU');
    surfaceU.BufferData(data.U.vertices, data.U.segments);

    surfaceV = new Model('SurfaceV');
    surfaceV.BufferData(data.V.vertices, data.V.segments);

    gl.enable(gl.DEPTH_TEST);
}

/* Creates a program for use in the WebGL context gl, and returns the
 * identifier for that program.  If an error occurs while compiling or
 * linking the program, an exception of type Error is thrown.  The error
 * string contains the compilation or linking error.  If no error occurs,
 * the program identifier is the return value of the function.
 * The second and third parameters are strings that contain the
 * source code for the vertex shader and for the fragment shader.
 */
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

/**
 * initialization function that will be called when the page has loaded
 */
function init() {
    let canvas;
    try {
        canvas = document.getElementById("webglcanvas");
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

    spaceball = new TrackballRotator(canvas, draw, 0);
    draw();
}
