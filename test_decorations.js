
const tokenRegex = /((?:!.*?!)*(?:o)?(?:\[[^\]]+\]|(?:n(?=[A-Ga-g\^=_]))?[\^=_]*[A-Ga-g][,']*)|z|Z|x|X)([\d\/]*)/g;

function testParsing(barText) {
    console.log(`\n--- Testing Bar: "${barText}" ---`);
    let match;
    const tokens = [];

    while ((match = tokenRegex.exec(barText)) !== null) {
        const fullText = match[0];
        const coreContent = match[1];

        // Strip decorations for note extraction
        const cleanContent = coreContent.replace(/!.*?!/g, '');

        // Extract notes
        const notes = [];
        const notePattern = /(?:n(?=[A-Ga-g\^=_]))?([\^=_]?[A-Ga-g][,']*)/g;
        let noteMatch;
        let inner = cleanContent.replace(/[\[\]]/g, ""); // Remove brackets
        // Remove 'o' prefix if it was outside
        inner = inner.replace(/^o/, '');

        while ((noteMatch = notePattern.exec(inner)) !== null) {
            if (noteMatch[1]) {
                notes.push(noteMatch[1]);
            }
        }

        tokens.push({
            text: fullText,
            notes: notes
        });
    }

    tokens.forEach((t, i) => {
        console.log(`Token ${i}: "${t.text}" -> Notes: [${t.notes.join(', ')}]`);
    });
}

// Current behavior (broken) vs Desired behavior
console.log("Expected: Notes should NOT include 'f' from '!f!'");
testParsing("!f![ngF]");
testParsing("!>!o[ngF]");
