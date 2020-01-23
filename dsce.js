class DSC {
    constructor() {
    }
}

class Constant extends DSC {
    constructor(name) {
        super();
        this.name = name;
    }
    html() {

    }
    execute() {

    }
}

class Variable extends DSC {
    constructor(name, valueTag) {
        super();
        this.name = name;
        this.valueTag = valueTag;
    }
    html(target) {
        let line = document.createElement('div');
        line.append(createLabel('span', this.name, 'variable'));
        line.append(createLabel('span', ': ', 'variable'));
        line.append(this.valueTag);
        target.append(line);
    }
    execute() {
        vars[this.name] = this.valueTag.value;
    }
}

class VariableReference extends DSC {
    constructor(name) {
        super();
        this.name = name;
    }
    html(target) {
        target.append(createLabel('span', this.name, 'variable'));
    }
    execute() {
        return vars[this.name];
    }
}

class Print extends DSC {
    constructor(dsc) {
        super();
        this.output = dsc;
    }
    html(target) {
        let line = document.createElement('div');
        line.append(createLabel('span', 'print '));
        this.output.html(line);
        target.append(line);
    }
    execute() {
        if(this.output instanceof VariableReference) {
            console.log(vars[this.output.name]);
        } else {
            console.log(this.output.value);
        }
    }
}

function createLabel(tagName, innerText, cssClass) {
    let tag = document.createElement(tagName);
    tag.innerText = innerText;
    if(cssClass) {
        tag.classList.add(cssClass);
    }
    return tag;
}

function createTag(tagName, value, cssClass) {
    let tag = document.createElement(tagName);
    tag.value = value;
    if(cssClass) {
        tag.classList.add(cssClass);
    }
    return tag;
}

let vars = {};
const GREETING = new Variable('greeting', createTag('input', 'hello', 'variable'));
const functionModel = [
    GREETING,
    new Print(new VariableReference(GREETING.name))
];

function html(target) {
    functionModel.forEach( function (model) {
        model.html(target);
    });
}

function execute() {
    functionModel.forEach( function (model) {
        model.execute();
    });
}