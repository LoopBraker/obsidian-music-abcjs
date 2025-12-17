
// Updated regex from src/drum_grid.ts
const tokenRegex = /((?:!.*?!)*(?:o)?(?:\[[^\]]+\]|(?:n(?=[A-Ga-g\^=_]))?[\^=_]*[A-Ga-g][,']*)|z|Z|x|X|"[^"]*")([\d\/]*)/g;

function testParsing(barText) {
    console.log(`\n--- Testing Bar: '${barText}' ---`);
    let match;
    const tokens = [];

    while ((match = tokenRegex.exec(barText)) !== null) {
        const fullText = match[0];
        const coreContent = match[1];

        // Simulate duration logic
        let duration = 0;
        if (coreContent.startsWith('"')) {
            console.log(`  -> Detected quoted string: "${coreContent}", setting duration to 0`);
            duration = 0;
        } else {
            duration = 1; // Simplify default
        }

        tokens.push({
            text: fullText,
            index: match.index,
            duration: duration
        });
    }

    tokens.forEach((t, i) => {
        console.log(`Token ${i}: "${t.text}" at index ${t.index}, duration: ${t.duration}`);
    });
}

console.log("Hypothesis: 'c' in quotes is matched as a whole token with 0 duration.");
testParsing('"c"[ngF]');
testParsing('"v"[ngF]');
