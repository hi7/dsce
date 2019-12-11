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

function decodeValtype(valtype) {
    switch (valtype) {
        case 0x7f: return "i32";
        case 0x7d: return "f32";
        default: return ">>" + valtype + "<<";
    }
}

WasmOp = {
    end: 0x0b,
    get_local: 0x20,
    f32_const: 0x43,
    f32_neg: 0x8c,
    f32_add: 0x92,
    f32_sub: 0x93,
    f32_mul: 0x94,
    f32_div: 0x95,
    f32_max: 0x97,
};

function decodeWasmOp(op) {
    switch (op) {
        case 0x0b: return { op: "end", immediate: 0, paramCount: 1  };
        case 0x20: return { op: "get_local", immediate: 1, paramCount: 0 };
        case 0x43: return { op: "f32.const", immediate: 0, paramCount: 1 };
        case 0x8c: return { op: "f32.neg", immediate: 0, paramCount: 1 };
        case 0x92: return { op: "f32.add", immediate: 0, paramCount: 2 };
        case 0x93: return { op: "f32.sub", immediate: 0, paramCount: 2 };
        case 0x94: return { op: "f32.mul", immediate: 0, paramCount: 2 };
        case 0x95: return { op: "f32.div", immediate: 0, paramCount: 2 };
        case 0x97: return { op: "f32.max", immediate: 0, paramCount: 2 };
        default: return { op: ">>" + op + "<<", immediate: undefined, paramCount: undefined };
    }
}

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
 * @param {number} f32
 * @returns {Uint8Array}
 */
function ieee754 (f32) {
    let buffer = new ArrayBuffer(4);
    let bytes = new Uint8Array(buffer);
    let floatView = new Float32Array((buffer));
    floatView[0] = f32;
    return bytes;
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
 * @param {number} section
 * @param {[]} data
 */
function createSection(section, data) {
    return [section].concat(data);
}


// ******* formating ********************


function numberToString(type, value) {
    if((type === Valtype.f32) && (value % 1 === 0)) {
        return `${value}.0`
    } else {
        return `${value}`;
    }
}

// **************************** AST *********************************

class Param {
    /**
     * @param {Valtype} type
     * @param {string} name
     */
    constructor(type, name) {
        this.type = type;
        this.name = name;
    }
}

/**
 * Ast base node
 */
class AstNode extends Param {
    /**
     * @param {Valtype} type
     * @param {string} name
     * @param {[AstNode]} ast
     */
    constructor(type, name, ast) {
        super(type, name);
        this.ast = ast;
    }

    /**
     * @param {HTMLElement} target
     */
    render(target) {}
}

class AstConstant extends AstNode {
    /**
     * @param {Valtype} type
     * @param {string} name
     * @param value
     */
    constructor(type, name, value) {
        super(type, name, []);
        this.value = value;
    }

    /**
     * @param {HTMLElement} target
     */
    render(target) {
        let constant = document.createElement("span");
        constant.innerHTML = numberToString(this.type, this.value);
        target.append(constant);
    }

    code() {
        return [WasmOp.f32_const, flatten(ieee754(this.value))]
    }
}

class AstVariable extends AstNode {
    /**
     * @param {Valtype} type
     * @param {string} name
     * @param {number} index
     */
    constructor(type, name, index) {
        super(type, name, []);
        this.index = index;
    }

    /**
     * @param {HTMLElement} target
     */
    render(target) {
        let constant = document.createElement("span");
        constant.innerHTML = this.name;
        target.append(constant);
    }

    code() {
        return [WasmOp.get_local, this.index]
    }
}

class AstUnary extends AstNode {
    /**
     * @param {Valtype} type
     * @param {string} name
     * @param {[AstNode]} ast
     * @param {WasmNode} wasmNode
     */
    constructor(type, name, ast, wasmNode) {
        super(type, name, ast);
        this.wasmNode = wasmNode;
    }

    /**
     * @param {HTMLElement} target
     */
    render(target) {
        let unary = document.createElement("span");
        unary.innerHTML = this.wasmNode.symbol;

        target.append(unary);
        this.ast.forEach(function(node) {
            node.render(target);
        });
    }

    code() {
        let code = flatten(this.ast[0].code());
        code.push(this.wasmNode.wasmOp);
        return code;
    }
}

class AstBinary extends AstNode {
    /**
     * @param {Valtype} type
     * @param {string} name
     * @param {[AstNode]} ast
     * @param {WasmNode} wasmNode
     */
    constructor(type, name, ast, wasmNode) {
        super(type, name, ast);
        this.wasmNode = wasmNode;
    }

    /**
     * @param {HTMLElement} target
     */
    render(target) {
        let binary = document.createElement("span");
        binary.innerHTML = this.wasmNode.symbol;

        this.ast[0].render(target);
        target.append(binary);
        this.ast[1].render(target);
    }

    code() {
        let code = [];
        this.ast.forEach(function(node) {
            code = code.concat(flatten(node.code()));
        });
        code.push(this.wasmNode.wasmOp);
        return code;
    }
}

class AstFunc extends AstNode {
    /**
     * @param {Valtype} type
     * @param {string} name
     * @param {[AstNode]} ast
     * @param {WasmNode} wasmNode
     */
    constructor(type, name, ast, wasmNode) {
        super(type, name, ast);
        this.wasmNode = wasmNode;
    }

    graph(target) {
        target.append(createRect('1', '1', '10', '4', 'title'));
        target.append(createText('2.4', '4', 'start'));
        target.append(createLine('6', '5', '6', '7'));
        target.append(createRect('1', '7', '10', '4', 'title'));
        target.append(createText('2.9', '10', 'end'));
    }

    /**
     * @param {HTMLElement} target
     */
    render(target) {
        let binary = document.createElement("span");
        binary.innerHTML = this.wasmNode.symbol + "(";
        target.append(binary);
        let lastSeparatorIndex = this.ast.length - 1;
        this.ast.forEach(function (node, index) {
            node.render(target);
            if(index < lastSeparatorIndex) {
                let separator = document.createElement("span");
                separator.innerText = ", ";
                target.append(separator)
            }
        });
        let closeBracket = document.createElement("span");
        closeBracket.innerText = ")";
        target.append(closeBracket)
    }

    code() {
        let code = flatten(this.ast[0].code());
        code = code.concat(flatten(this.ast[1].code()));
        code.push(this.wasmNode.wasmOp);
        return code;
    }
}

/*** SVG ***
 * functions for creating SVG elements
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

function createText(x, y, label) {
    let text = document.createElementNS(SVG_NS,"text");
    text.setAttributeNS(null,"x", x);
    text.setAttributeNS(null,"y", y);
    text.textContent = label;
    //text.setAttributeNS(null,"font-size","4");
    return text;
}

function createRect(x, y, width, height) {
    let rect = document.createElementNS(SVG_NS, 'rect');
    rect.setAttribute('x', x);
    rect.setAttribute('y', y);
    rect.setAttribute('width', width);
    rect.setAttribute('height', height);
    rect.setAttribute('rx', '2');
    rect.setAttribute('class', 'title');
    return rect;
}

function createLine(x1, y1, x2, y2) {
    let line = document.createElementNS(SVG_NS, 'line');
    line.setAttribute('x1', x1);
    line.setAttribute('y1', y1);
    line.setAttribute('x2', x2);
    line.setAttribute('y2', y2);
    return line;
}

/*** End SVG ***/

class WasmNode {
    /**
     * @param {WasmOp} wasmOp
     * @param {string} symbol
     */
    constructor(wasmOp, symbol) {
        this.wasmOp = wasmOp;
        this.symbol = symbol;
    }
}

const Model = {
  funcs: [ {
      public: true,
      params: [ new Param(Valtype.f32, "a"),
          new Param(Valtype.f32, "b"),
          new Param(Valtype.f32, "c"),
      ],
      locals: [],
      returnTypes: [Valtype.f32],
      ast: [new AstFunc(Valtype.f32, "sigma", [
              new AstVariable(Valtype.f32, "a", 0),
              new AstBinary(Valtype.f32, "add", [
                  new AstVariable(Valtype.f32, "b", 1),
                  new AstVariable(Valtype.f32, "c", 2)
              ],
              new WasmNode(WasmOp.f32_add, "+"))
          ],
          new WasmNode(WasmOp.f32_add, "&sum;"),
      )]
  }, {
      public: true,
      params: [],
      locals: [],
      returnTypes: [Valtype.f32],
      ast: [ new AstConstant(Valtype.f32, "const", 42) ]
  }, {
      public: true,
      params: [ new Param(Valtype.f32, "a") ],
      locals: [],
      returnTypes: [Valtype.f32],
      ast: [new AstUnary(Valtype.f32, "neg", [
              new AstVariable(Valtype.f32, "a",0)
          ],
          new WasmNode(WasmOp.f32_neg, "-"),
      )]
  }, {
      public: true,
      params: [ new Param(Valtype.f32, "a"),
          new Param(Valtype.f32, "b"),
      ],
      locals: [],
      returnTypes: [Valtype.f32],
      ast:  [new AstBinary(Valtype.f32, "add",
          [new AstVariable(Valtype.f32, "a", 0),
          new AstVariable(Valtype.f32, "b", 1)],
          new WasmNode(WasmOp.f32_add, "+"),
      )]
  } ]
};

// *****************************************

function filterTypes(params) {
    let types = [];
    params.forEach(function (param) {
       types.push(param.type);
    });
    return types;
}

// start of user defined functions:
function functionTypes() {
    let functionBytes = [Model.funcs.length];
    Model.funcs.forEach(function(func) {
        functionBytes.push(functionType);
        functionBytes = functionBytes.concat(encodeVector(filterTypes(func.params)));
        functionBytes = functionBytes.concat(encodeVector(func.returnTypes));
    });
    return functionBytes;
}

function typeSection() {
    return createSection(Section.type, encodeVector(functionTypes()))
}

/**
 * @param {[Valtype]} locals
 */
function getLocals(locals) {
    if(locals.length === 0) return [emptyArray];
    return encodeVector(locals);
}

function addCode() {
    let code = [Model.funcs.length];
    Model.funcs.forEach(function(func) {
        let funcCode = getLocals(func.locals);
        func.ast.forEach(function (node) {
            funcCode = funcCode.concat(node.code());
        });
        funcCode.push(WasmOp.end);
        code = code.concat(encodeVector(flatten(funcCode)));
    });
    return code;
}
function functionBody() {
    return encodeVector(addCode());
}
// end of user defined functions!

function funcSection() {
    let functionTypesIndices = [];
    Model.funcs.forEach(function(func, index) {
        functionTypesIndices.push(index);
    });

    return createSection(Section.func, encodeVector(encodeVector(functionTypesIndices)))
}

function exportSection() {
    let exportBytes = [0x00]; // count of export entries
    Model.funcs.forEach(function(func, index) {
        if(func.public) {
            exportBytes[0]++;
            exportBytes = exportBytes.concat(encodeString(func.ast[0].name));
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
    const LINE_LENGTH = 40;
    let offset = 0;
    while(offset < wasm.length) {
        let indices = '';
        for(let i=offset; i<Math.min(offset+LINE_LENGTH, wasm.length); i++) {
            indices += twoDigits(i) + ' '
        }
        console.log(indices);

        let bytes = '';
        for(let i=offset; i<Math.min(offset+LINE_LENGTH, wasm.length); i++) {
            bytes += toHex(wasm[i]) + ' '
        }
        console.log(bytes);
        offset += LINE_LENGTH;
    }
}

function build() {
    let wasm = Uint8Array.from(magicModuleHeader
        .concat(moduleVersion)
        .concat(typeSection())
        .concat(funcSection())
        .concat(exportSection())
        .concat(codeSection())
    );
    //hexDump(wasm);
    WebAssembly.instantiate(wasm, importObject)
        .then(obj => {
            instance = obj.instance;
            let f = instance.exports;
            console.log(`sigma(1, 2, 3) = ${f.sigma(1, 2, 3)}`);
            console.log(f.neg(f.add(-84, f.const())));
        });
}

// RENDER

function renderCode(funcIndex) {
    let codeElement = document.getElementById('code');
    let svgElement = document.getElementById('svg');
    codeElement.innerText = '';
    Model.funcs[funcIndex].ast.forEach(function(node) {
        node.render(codeElement);
        node.graph(svgElement);
    });
}

function createFunctionOptions(funcModel, funcIndex) {
    let functions = document.getElementById("functions");
    let funcElement = document.createElement("option");
    funcElement.value = funcIndex;

    let funcNameSpan = document.createElement("span");
    funcNameSpan.innerText = funcModel.ast[0].name + ' (';
    funcElement.append(funcNameSpan);

    funcElement.append(funcNameSpan);
    funcModel.params.forEach(function(param, index, arr) {
        let funcParamNameSpan = document.createElement("span");
        funcParamNameSpan.innerHTML = decodeValtype(param.type) + "." + param.name
            + (index < arr.length - 1 ? ', ' : '');
        funcParamNameSpan.classList.add("param-name");
        funcElement.append(funcParamNameSpan);
    });

    let funcResultSpan = document.createElement("span");
    funcResultSpan.innerHTML = `) &rarr; ${decodeValtype(funcModel.returnTypes[0])}`;
    funcElement.append(funcResultSpan);


    functions.append(funcElement);
}

function render() {
    Model.funcs.forEach(function (func, index) {
        //func.ast.render(document.getElementById("code"));
        createFunctionOptions(func, index);
    });
}
