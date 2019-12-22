let gl = null;
let glCanvas = null;
let shaderProgram = null;

// Aspect ratio and coordinate system
// details

let aspectRatio;
let currentRotation = [0, 1];
let currentScale = [1.0, 1.0];

// Vertex information

let vertexArray;
let vertexBuffer;
let vertexNumComponents;
let vertexCount;

// Rendering data shared with the
// scalers.

let uScalingFactor;
let uGlobalColor;
let uRotationVector;
let aVertexPosition;

// Animation
let currentAngle = 0.0;
let previousTime = 0.0;
let degreesPerSecond = 10.0;

window.addEventListener("load", startup, false);
window.addEventListener('resize', resize, false);

function resize() {
    let dimensions = glCanvas.getBoundingClientRect();
    glCanvas.width = dimensions.width;
    glCanvas.height = dimensions.height;
    aspectRatio = glCanvas.width/glCanvas.height;
    currentRotation = [0, 1];
    currentScale = [1.0, aspectRatio];
    return glCanvas.getContext("webgl");
}

/**
 * Positions the character vertices at location x y on screen.
 * @param {[number]} vertices
 * @param {number} x
 * @param {number} y
 */
function pos(vertices, x, y) {
    let shiftedVertices = [];
    vertices.forEach(function (value, index) {
        if(index % 2 === 0) { // is x value
            shiftedVertices.push(value - 0.99 + x * 0.02);
        } else { // is y value
            shiftedVertices.push(value - 0.01 + 1/aspectRatio - y * 0.02);
        }
    });
    return shiftedVertices;
}

function startup() {
    glCanvas = document.getElementById("glcanvas");
    gl = resize();
    const shaderSet = [
        {
            type: gl.VERTEX_SHADER,
            id: "vertex-shader"
        },
        {
            type: gl.FRAGMENT_SHADER,
            id: "fragment-shader"
        }
    ];
    shaderProgram = buildShaderProgram(shaderSet);
    vertexArray = new Float32Array(text('ABCD', 0, 0));
    vertexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertexArray, gl.STATIC_DRAW);
    vertexNumComponents = 2;
    vertexCount = vertexArray.length/vertexNumComponents;
    animateScene();
}

/**
 * Adds text vertices at character position
 * @param {string} str
 * @param {number} x
 * @param {number} y
 */
function text(str, x, y) {
    let textVertices = [];
    for (let i = 0; i < str.length; i++) {
        let charIndex = str.charCodeAt(i) - 65;
        textVertices = textVertices.concat(pos(CHARS[charIndex], x + i, y));
    }
    return textVertices;
}

function buildShaderProgram(shaderInfo) {
    let program = gl.createProgram();
    shaderInfo.forEach(function(desc) {
        let shader = compileShader(desc.id, desc.type);
        if (shader) {
            gl.attachShader(program, shader);
        }
    });
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        console.log("Error linking shader program:");
        console.log(gl.getProgramInfoLog(program));
    }
    return program;
}

function compileShader(id, type) {
    let code = document.getElementById(id).firstChild.nodeValue;
    let shader = gl.createShader(type);

    gl.shaderSource(shader, code);
    gl.compileShader(shader);

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.log(`Error compiling ${type === gl.VERTEX_SHADER ? "vertex" : "fragment"} shader:`);
        console.log(gl.getShaderInfoLog(shader));
    }
    return shader;
}

function animateScene() {
    gl.viewport(0, 0, glCanvas.width, glCanvas.height);
    gl.clearColor(0.8, 0.9, 1.0, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    let radians = currentAngle * Math.PI / 180.0;
    currentRotation[0] = Math.sin(radians);
    currentRotation[1] = Math.cos(radians);

    gl.useProgram(shaderProgram);

    uScalingFactor = gl.getUniformLocation(shaderProgram, "uScalingFactor");
    uGlobalColor = gl.getUniformLocation(shaderProgram, "uGlobalColor");
    uRotationVector = gl.getUniformLocation(shaderProgram, "uRotationVector");
    gl.uniform2fv(uScalingFactor, currentScale);
    gl.uniform2fv(uRotationVector, currentRotation);
    gl.uniform4fv(uGlobalColor, [0.53, 0.67, 1.0, 1.0]);
    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);

    aVertexPosition = gl.getAttribLocation(shaderProgram, "aVertexPosition");

    gl.enableVertexAttribArray(aVertexPosition);
    gl.vertexAttribPointer(aVertexPosition, vertexNumComponents,
        gl.FLOAT, false, 0, 0);

    gl.drawArrays(gl.TRIANGLES, 0, vertexCount);

    window.requestAnimationFrame(function(currentTime) {
        let deltaAngle = ((currentTime - previousTime) / 1000.0) * degreesPerSecond;
        currentAngle = (currentAngle + deltaAngle) % 360;
        previousTime = currentTime;
        //animateScene();
    });
}

const SQUARE = [ -0.005, 0.005, 0.005, 0.005, 0.005, -0.005,
        -0.005, 0.005, 0.005, -0.005, -0.005, -0.005 ];
const CHARS = [
    [ /* A */  0.009,-0.009, 0.000,-0.002, 0.000, 0.009, 0.000, 0.009, 0.000,-0.002,-0.009,-0.009 ],
    [ /* B */  0.007,-0.006,-0.007, 0.009,-0.007,-0.009,-0.007,-0.009,-0.007, 0.009, 0.007, 0.006 ],
    [ /* C */  0.009, 0.009, 0.002, 0.001,-0.009, 0.001,-0.009, 0.001, 0.002, 0.001, 0.009,-0.009 ],
    [ /* D */ -0.009, 0.009,-0.009,-0.009, 0.006, 0.004, 0.006, 0.004,-0.009,-0.009, 0.006,-0.004 ],
];

