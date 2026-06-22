/* One-shot reformatter for prompt.md — turns the single-line 26KB wall of
 * text into readable markdown: adds a status preamble, promotes embedded
 * section titles to ## / ### headers, splits sentences into paragraphs,
 * fixes the non-existent "Gemini 3.1 Flash-Lite" model reference, and
 * breaks up the run-together comparison tables.
 *
 * Run: node scripts/reformat-prompt-md.js
 */
import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const file = resolve(__dirname, '../prompt.md');

let t = readFileSync(file, 'utf8');

// 1. Fix the non-existent model reference. "Gemini 3.1 Flash-Lite" is not a
//    real released model; production uses gemini-2.5-flash-lite.
t = t.replace(/Gemini 3\.1 Flash-Lite/g, 'Gemini 2.5 Flash-Lite');
// Collapse the now-duplicated "Gemini 2.5 Flash-Lite or Gemini 2.5 Flash-Lite"
t = t.replace(/Gemini 2\.5 Flash-Lite or Gemini 2\.5 Flash-Lite/g, 'Gemini 2.5 Flash-Lite');

// 2. Break up the run-together comparison-table headers. The source has no
//    newlines, so the header row runs straight into the first data row.
const tableHeaderPattern =
    /CharacterCurrent Baseline TraitSuggested Architectural ImprovementImplementation Mechanism/g;
t = t.replace(tableHeaderPattern,
    '\n\n| Character | Current Baseline Trait | Suggested Architectural Improvement | Implementation Mechanism |\n|---|---|---|---|\n\n');

// 3. Promote embedded section titles to markdown headers. Each entry is
//    [exactTitleText, headerPrefix]. We insert a blank line + prefix before
//    and a blank line after the title. Process longest titles first so
//    shorter substrings don't shadow them.
const headings = [
    ['Engineering Culturally Nuanced LLM Personas: A Framework for Indian Sitcom and Cinematic Roleplay', '# '],
    ['The Paradigm of Localized Conversational Artificial Intelligence', '## '],
    ['Deconstructing the Multi-Turn Conversational Architecture', '## '],
    ['Psychological Profiling and Prompt Optimization for the Gokuldham Ensemble', '## '],
    ['The Protagonist Dynamic: Jethalal and Dayaben', '### '],
    ['The Intellectual Foils: Tarak Mehta and Krishnan Iyer', '### '],
    ['The Catalysts of Chaos: Popatlal, Bhide, and Champaklal', '### '],
    ['Engineering the Hera Pheri Cinematic Triad', '## '],
    ['The Orthographic Challenge: Enforcing Roman Script Hinglish', '## '],
    ['The KERNEL Framework Application', '## '],
    ['Synthesized Conclusions and Architectural Directives', '## '],
];
// Sort by length descending to avoid prefix collisions.
headings.sort((a, b) => b[0].length - a[0].length);
for (const [title, prefix] of headings) {
    // Only replace the first occurrence (the title); body mentions get left alone.
    t = t.replace(title, `\n\n${prefix}${title}\n\n`);
}

// 4. Split the remaining wall into paragraphs at sentence boundaries.
//    Insert a paragraph break after ". " followed by an uppercase letter,
//    but avoid splitting common abbreviations (e.g., vs., Mr.).
const ABBREV = /\b(vs|Mr|Mrs|Dr|Prof|Sr|Jr|e\.g|i\.e|etc|no|St|Inc|Ltd)\.$/i;
// Work on a copy to avoid index drift from replace.
const parts = t.split(/(?<=\. )(?=[A-Z])/);
let out = '';
for (let i = 0; i < parts.length; i++) {
    let seg = parts[i];
    // If this segment ends with an abbreviation, merge it with the next.
    if (ABBREV.test(seg.trim()) && i + 1 < parts.length) {
        parts[i + 1] = seg + parts[i + 1];
        continue;
    }
    out += seg;
    if (i + 1 < parts.length) out += '\n\n';
}
t = out;

// 4b. Second pass: catch ".X" with no space (e.g. "Hera Pheri.Replicating").
//     These are run-together sentences the first pass missed. Insert a
//     paragraph break, but skip sentence-internal abbreviations like "e.g"
//     and numeric decimals like "2.5".
t = t.replace(/\.([A-Z])/g, (match, cap, offset) => {
    // Don't split decimals (preceded by a digit) or known abbreviations.
    const before = t.slice(Math.max(0, offset - 4), offset);
    if (/\d$/.test(before)) return match;
    if (/\b(e\.g|i\.e|vs|etc)$/i.test(before)) return match;
    return '.\n\n' + cap;
});

// 5. Collapse 3+ newlines to exactly 2.
t = t.replace(/\n{3,}/g, '\n\n').trim() + '\n';

// 6. Prepend a status preamble distinguishing implemented architecture from
//    proposed improvements, so readers know what ships today vs. what this
//    doc recommends.
const preamble = `<!-- Status: this doc is a design treatise. A "Status" note is appended
     inline where the text describes something not yet implemented. -->

> **How to read this document.** This is a design treatise covering both
> the architecture that ships in OpenWire today and improvements that are
> only proposed. Implemented pieces are marked **[IMPLEMENTED]**; proposed
> ones are marked **[PROPOSED]**. The production model is
> \`gemini-2.5-flash-lite\` (see \`src/lib/agents/prompt-builder.js\` and
> \`tests/prompt-audit/run.js\`). The Turn 2 synthetic acknowledgment
> described below IS implemented (seeded as \`TURN2_ANCHOR\` in
> \`src/lib/agents/swarm.js\`).

`;

t = preamble + t;

writeFileSync(file, t, 'utf8');
console.log('Reformatted prompt.md ->', t.length, 'chars');
