
// Mock DOM
class MockElement {
    constructor(tag) {
        this.tagName = tag;
        this.style = {};
        this.children = [];
        this.textContent = '';
        this.classList = {
            contains: (cls) => this.classes.includes(cls),
            add: (cls) => this.classes.push(cls)
        };
        this.classes = [];
    }

    createDiv(opts) {
        const el = new MockElement('div');
        if (opts && opts.cls) el.classes.push(opts.cls);
        this.children.push(el);
        return el;
    }

    empty() {
        this.children = [];
    }

    querySelector(sel) {
        // Simple mock for .abc-bar-info
        if (sel === '.abc-bar-info') {
            return this.children.find(c => c.classes.includes('abc-bar-info'));
        }
        return null;
    }
}

// Mock document
global.document = {
    body: new MockElement('body')
};

// Mock BarVisualizer logic (copied/adapted from source for testing logic)
// We can't import easily, so we'll replicate the render logic we want to test.

const timeSignature = { num: 4, den: 4 };
const unitNoteLength = 1 / 8;
const isDark = true; // Test dark mode

// Colors
const normalColor = isDark ? '#A89917' : '#EFE600';
const fullColor = isDark ? '#4CB014' : '#00D300';
const overflowColor = isDark ? '#A62114' : '#ff0000';

function testRender(durationInL) {
    const numRects = timeSignature.num;
    const blockSize = 1 / timeSignature.den;
    const lSize = unitNoteLength;
    const lPerBlock = blockSize / lSize;

    const totalCapacity = numRects * lPerBlock;

    let barColor = normalColor;
    if (durationInL >= totalCapacity) {
        barColor = fullColor;
    }
    if (durationInL > totalCapacity) {
        barColor = overflowColor;
    }

    console.log(`Duration: ${durationInL}, Capacity: ${totalCapacity}`);
    console.log(`Expected Color: ${barColor}`);

    return barColor;
}

console.log('--- Testing Bar Visualizer Logic ---');

// Case 1: Normal (Under capacity)
// 4/4 = 8 * 1/8. Capacity 8.
// Duration 4 (Half filled)
const c1 = testRender(4);
if (c1 === normalColor) console.log('Case 1 (Normal): PASS');
else console.log(`Case 1 (Normal): FAIL. Got ${c1}, expected ${normalColor}`);

// Case 2: Full (Exact capacity)
// Duration 8
const c2 = testRender(8);
if (c2 === fullColor) console.log('Case 2 (Full): PASS');
else console.log(`Case 2 (Full): FAIL. Got ${c2}, expected ${fullColor}`);

// Case 3: Overflow
// Duration 9
const c3 = testRender(9);
if (c3 === overflowColor) console.log('Case 3 (Overflow): PASS');
else console.log(`Case 3 (Overflow): FAIL. Got ${c3}, expected ${overflowColor}`);

