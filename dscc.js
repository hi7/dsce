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

/**
 * Ast base node
 */
class AstNode {
    /**
     * @param {Valtype} type
     */
    constructor(type) {
        this.type = type;
    }

    /**
     * @param {HTMLElement} target
     */
    render(target) {}
}

class AstConstant extends AstNode {
    /**
     * @param {Valtype} type
     * @param value
     */
    constructor(type, value) {
        super(type);
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
        return [WasmOp.f32_const, unsignedLEB128(this.value)]
    }
}

class AstVariable extends AstNode {
    /**
     * @param {Valtype} type
     * @param {number} index
     * @param {string} name
     */
    constructor(type, index, name) {
        super(type);
        this.index = index;
        this.name = name;
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
     * @param {WasmNode} wasmNode
     * @param {AstNode} node
     */
    constructor(type, wasmNode, node) {
        super(type);
        this.wasmNode = wasmNode;
        this.node = node;
    }

    params() {
        return [ { name: "a", type: this.type } ];
    }

    /**
     * @param {HTMLElement} target
     */
    render(target) {
        let unary = document.createElement("span");
        unary.innerHTML = this.wasmNode.symbol;

        target.append(unary);
        this.node.render(target);
    }

    code() {
        let code = flatten(this.node.code());
        code.push(this.wasmNode.wasmOp);
        return code;
    }
}

class AstBinary extends AstNode {
    /**
     * @param {Valtype} type
     * @param {WasmNode} wasmNode
     * @param {AstNode} lNode
     * @param {AstNode} rNode
     */
    constructor(type, wasmNode, lNode, rNode) {
        super(type);
        this.wasmNode = wasmNode;
        this.lNode = lNode;
        this.rNode = rNode;
    }

    params() {
        return [ { name: "a", type: this.type }, { name: "b", type: this.type } ];
    }

    /**
     * @param {HTMLElement} target
     */
    render(target) {
        let binary = document.createElement("span");
        binary.innerHTML = this.wasmNode.symbol;

        this.lNode.render(target);
        target.append(binary);
        this.rNode.render(target);
    }

    code() {
        let code = flatten(this.lNode.code());
        code = code.concat(flatten(this.rNode.code()));
        code.push(this.wasmNode.wasmOp);
        return code;
    }
}

class WasmNode {
    /**
     * @param {Valtype} wasmType
     * @param {WasmOp} wasmOp
     * @param {string} symbol
     */
    constructor(wasmType, wasmOp, symbol) {
        this.wasmType = wasmType;
        this.wasmOp = wasmOp;
        this.symbol = symbol;
    }
}

const Model = {
  funcs: [ {
      name: "neg",
      public: true,
      returnTypes: [Valtype.f32],
      ast: new AstUnary(Valtype.f32, new WasmNode(Valtype.f32, WasmOp.f32_neg, "-"),
          new AstVariable(Valtype.f32, 0, "a"),
      )
  }, {
      name: "add",
      public: true,
      returnTypes: [Valtype.f32],
      ast:  new AstBinary(Valtype.f32, new WasmNode(Valtype.f32, WasmOp.f32_add, "+"),
          new AstVariable(Valtype.f32, 0, "a"),
          new AstVariable(Valtype.f32, 1, "b")
      )
  }, {
      name: "sub",
      public: true,
      returnTypes: [Valtype.f32],
      ast: new AstBinary(Valtype.f32, new WasmNode(Valtype.f32, WasmOp.f32_sub, "-"),
          new AstVariable(Valtype.f32, 0, "a"),
          new AstVariable(Valtype.f32, 1, "b")
      )
  }, {
      name: "mul",
      public: true,
      returnTypes: [Valtype.f32],
      ast: new AstBinary(Valtype.f32, new WasmNode(Valtype.f32, WasmOp.f32_mul, "&sdot;"),
          new AstVariable(Valtype.f32, 0, "a"),
          new AstVariable(Valtype.f32, 1, "b")
      )
  }, {
      name: "div",
      public: true,
      returnTypes: [Valtype.f32],
      ast: new AstBinary(Valtype.f32, new WasmNode(Valtype.f32, WasmOp.f32_div, "&divide;"),
          new AstVariable(Valtype.f32, 0, "a"),
          new AstVariable(Valtype.f32, 1, "b")
      )
  }, {
      name: "max",
      public: true,
      returnTypes: [Valtype.f32],
      ast: new AstBinary(Valtype.f32, new WasmNode(Valtype.f32, WasmOp.f32_max, "max"),
          new AstVariable(Valtype.f32, 0, "a"),
          new AstVariable(Valtype.f32, 1, "b")
      )
  } ]
};
    new AstBinary(Valtype.f32, new WasmNode(Valtype.f32, WasmOp.f32_add, "+"),
        new AstVariable(Valtype.f32, 0, "a"),
        new AstVariable(Valtype.f32, 1, "b")
    );

// *****************************************
class UnaryOp {
    constructor(name, opSymbol, exp, params, ret, code) {
        this.name = name;
        this.opSymbol = opSymbol;
        this.export = exp;
        this.params = params;
        this.ret = ret;
        this.code = code;
    }
    renderLocals() {
        if(this.code[0] > emptyArray) {
            let localsElement = document.createElement('div');
            localsElement.innerText = 'multiple locals: not implemented!';
            target.append(localsElement);
        }
    }
    render(target) { // postfix
        target.innerHTML = this.opSymbol + this.params[0].name;
    }
    renderWasm(target) {
        target.innerText = '';
        for(let i=0; i<this.code.length; i++) {
            if(i === 0) {
                this.renderLocals();
            }
            if(i > 0) {
                let lineElement = document.createElement('div');
                let decoded = decodeWasmOp(this.code[i]);
                if(decoded.op !== 'end') {
                    let lineText = decoded.op;
                    for(let j=0; j<decoded.immediate; j++) {
                        lineText += ' ' + this.code[++i];
                    }
                    lineElement.innerText = lineText;
                    target.append(lineElement);
                }
            }
        }
    }
}

class BinaryOp extends UnaryOp {
    constructor(name, opSymbol, exp, params, ret, code) {
        super(name, opSymbol, exp, params, ret, code);
    }
    render(target) { // infix
        target.innerHTML = this.params[0].name + this.opSymbol + this.params[1].name;
    }
}

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
        functionBytes = functionBytes.concat(encodeVector(filterTypes(func.ast.params())));
        functionBytes = functionBytes.concat(encodeVector(func.returnTypes));
    });
    return functionBytes;
}

function typeSection() {
    return createSection(Section.type, encodeVector(functionTypes()))
}

function addCode() {
    let code = [Model.funcs.length];
    Model.funcs.forEach(function(func) {
        let funcCode = [emptyArray];
        funcCode = funcCode.concat(func.ast.code());
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
    const LINE_LENGTH = 50;
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
    hexDump(wasm);
    WebAssembly.instantiate(wasm, importObject)
        .then(obj => {
            instance = obj.instance;
            let f = instance.exports;
            console.log(f);
            console.log(f.neg(f.mul(2, f.add(-10.25, -10.75))));
        });
}

// RENDER

function renderCode(funcIndex) {
    let codeElement = document.getElementById('code');
    codeElement.innerText = '';
    Model.funcs[funcIndex].ast.render(codeElement);
}

function renderFunctionOptions(funcModel, funcIndex) {
    let functions = document.getElementById("functions");
    let funcElement = document.createElement("option");
    funcElement.value = funcIndex;

    let funcNameSpan = document.createElement("span");
    funcNameSpan.innerText = funcModel.name + ' (';
    funcElement.append(funcNameSpan);

    funcElement.append(funcNameSpan);
    funcModel.ast.params().forEach(function(param, index, arr) {
        let funcParamNameSpan = document.createElement("span");
        funcParamNameSpan.innerHTML = param.name + ':' + decodeValtype(param.type)
            + (index < arr.length - 1 ? ', ' : `) &rarr; ${decodeValtype(funcModel.returnTypes[0])}`);
        funcParamNameSpan.classList.add("param-name");
        funcElement.append(funcParamNameSpan);
    });

    functions.append(funcElement);
}

function render() {
    Model.funcs.forEach(function (func, index) {
        //func.ast.render(document.getElementById("code"));
        renderFunctionOptions(func, index);
    });
}
