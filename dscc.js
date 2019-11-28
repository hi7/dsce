function flatten(array) {
    return [].concat.apply([], array);
}

let memory = new WebAssembly.Memory({initial:10, maximum:100});
let importObject = { js: { mem: memory } };
let instance;

Section = {
   custom: 0,
   type: 1,
   import: 2,
   func: 3,
   table: 4,
   memory: 5,
   global: 6,
   export: 7,
   start: 8,
   element: 9,
   code: 10,
   data: 11
};

Valtype = {
    i32: 0x7f,
    f32: 0x7d
};

function valtypeToString(valtype) {
    switch (valtype) {
        case 0x7f: return "i32";
        case 0x7d: return "f32";
        default: return ">>" + valtype + "<<";
    }
}

Op = {
    end: 0x0b,
    get_local: 0x20,
    f32_neg: 0x8c,
    f32_add: 0x92,
    f32_max: 0x97,
};

ExportType = {
    func: 0x00,
    table: 0x01,
    mem: 0x02,
    global: 0x03
};

const functionType = 0x60;
const emptyArray = 0x0;
const magicModuleHeader = [0x00, 0x61, 0x73, 0x6d];
const moduleVersion = [0x01, 0x00, 0x00, 0x00];

/**
 *
 * @param {number} n
 * @returns {Uint8Array}
 */
function ieee754 (n) {
    const buf = Buffer.allocUnsafe(4);
    buf.writeFloatLE(n, 0);
    return Uint8Array.from(buf);
}

/**
 *
 * @param {string} str
 */
function encodeString (str) {
    return [
        str.length,
        ...str.split("").map(s => s.charCodeAt(0))
    ];
}

/**
 *
 * @param {number} n
 * @returns {[]}
 */
function signedLEB128 (n) {
    const buffer = [];
    let more = true;
    while (more) {
        let byte = n & 0x7f;
        n >>>= 7;
        if ((n === 0 && (byte & 0x40) === 0) || (n === -1 && (byte & 0x40) !== 0)) {
            more = false;
        } else {
            byte |= 0x80;
        }
        buffer.push(byte);
    }
    return buffer;
}

/**
 *
 * @param {number} n
 * @returns {[]}
 */
function unsignedLEB128(n) {
    const buffer = [];
    do {
        let byte = n & 0x7f;
        n >>>= 7;
        if (n !== 0) {
            byte |= 0x80;
        }
        buffer.push(byte);
    } while (n !== 0);
    return buffer;
}

/**
 * build wasm vector by starting with byte size followed by content
 * @param {[]} array
 * @returns {[]}
 */
function encodeVector(array) {
    return unsignedLEB128(array.length).concat(flatten(array));
}

/**
 *
 * @param {number} section
 * @param {[]} data
 */
function createSection(section, data) {
    return [section].concat(data);
}

Model = {
    functions: [ {
        name: "add",
        export: true,
        params: [ { name: "a", type: Valtype.f32 }, { name: "b", type: Valtype.f32 }],
        ret: [Valtype.f32],
        code: [emptyArray,
            Op.get_local, unsignedLEB128(0),
            Op.get_local, unsignedLEB128(1),
            Op.f32_add,
            Op.end
        ]
    }, {
        name: "neg",
        export: true,
        params: [ { name: "number", type: Valtype.f32 } ],
        ret: [Valtype.f32],
        code: [emptyArray,
            Op.get_local, unsignedLEB128(0),
            Op.f32_neg,
            Op.end
        ]
    }]
};

function filterTypes(params) {
    let types = [];
    params.forEach(function (param) {
       types.push(param.type);
    });
    return types;
}

// start of user defined functions:
function functionTypes() {
    let functionBytes = [Model.functions.length];
    Model.functions.forEach(function(func) {
        functionBytes.push(functionType);
        functionBytes = functionBytes.concat(encodeVector(filterTypes(func.params)));
        functionBytes = functionBytes.concat(encodeVector(func.ret));
    });
    return functionBytes;
}

function typeSection() {
    return createSection(Section.type, encodeVector(functionTypes()))
}

function addCode() {
    let code = [Model.functions.length];
    Model.functions.forEach(function(func) {
        code = code.concat(encodeVector(flatten(func.code)));
    });
    return code;
}
function functionBody() {
    return encodeVector(addCode());
}
// end of user defined functions!

function funcSection() {
    let functionTypesIndices = [];
    Model.functions.forEach(function(func, index) {
        functionTypesIndices.push(index);
    });

    return createSection(Section.func, encodeVector(encodeVector(functionTypesIndices)))
}

function exportSection() {
    let exportBytes = [0x00]; // count of export entries
    Model.functions.forEach(function(func, index) {
        if(func.export) {
            exportBytes[0]++;
            exportBytes = exportBytes.concat(encodeString(func.name));
            exportBytes.push(ExportType.func);
            exportBytes.push(index); // function index
        }
    });
    return createSection(Section.export, encodeVector(exportBytes))
}

function codeSection() {
    return createSection(Section.code, functionBody())
}

function twoDigits(numberString) {
    return ('0' + numberString).slice(-2);
}

/**
 * converts number to 2 digit hex string
 * @param {number} n
 * @returns {string}
 */
function toHex(n) {
    return twoDigits(n.toString(16));
}

/**
 * logs an array as hexadecimal numbers
 * @param {[]} bytes
 */
function logHex(bytes) {
    let output = '';
    for(let i=0; i<bytes.length; i++) {
        output += toHex(bytes[i]) + ' '
    }
    console.log(output);
}

/**
 * logs wasm bytes as hex number to console
 * @param {Uint8Array} wasm
 */
function hexDump(wasm) {
    let indices = '';
    for(let i=0; i<wasm.length; i++) {
        indices += twoDigits(i) + ' '
    }
    console.log(indices);

    let bytes = '';
    for(let i=0; i<wasm.length; i++) {
        bytes += toHex(wasm[i]) + ' '
    }
    console.log(bytes);
}

function build() {
    let wasm = Uint8Array.from(magicModuleHeader
        .concat(moduleVersion)
        .concat(typeSection())
        .concat(funcSection())
        .concat(exportSection())
        .concat(codeSection())
    );
    hexDump(wasm);
    WebAssembly.instantiate(wasm, importObject)
        .then(obj => {
            instance = obj.instance;
            let func = instance.exports;
            console.log(func);
            console.log(func.neg(func.add(21.25, 20.75)));
        });
}

// RENDER

function renderCode(funcIndex) {
    console.log(Model.functions[funcIndex].code);
    let codeElement = document.getElementById('code');
}

function renderFunction(funcModel, funcIndex) {
    let functions = document.getElementById("functions");
    let funcElement = document.createElement("option");
    funcElement.value = funcIndex;

    let funcNameSpan = document.createElement("span");
    funcNameSpan.innerText = funcModel.name + ' (';
    funcElement.append(funcNameSpan);

    funcElement.append(funcNameSpan);
    funcModel.params.forEach(function(param, index, arr) {
        let funcParamNameSpan = document.createElement("span");
        funcParamNameSpan.innerHTML = param.name + ':' + valtypeToString(param.type)
            + (index < arr.length - 1 ? ', ' : `) &rarr; ${valtypeToString(funcModel.ret[0])}`);
        funcParamNameSpan.classList.add("param-name");
        funcElement.append(funcParamNameSpan);
    });

    functions.append(funcElement);
}

function render() {
    Model.functions.forEach(function (func, index) {
        renderFunction(func, index);
    });
}
