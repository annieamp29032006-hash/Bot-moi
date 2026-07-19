const fs = require('fs');

const idxPath = 'd:\\Bot moi\\index.js';
let content = fs.readFileSync(idxPath, 'utf8');

// The lines we want to replace start from:
// if (cid.startsWith('ww_join_') || cid.startsWith('ww_start_') || cid.startsWith('ww_cancel_')) {
// and end right before:
// // === XỬ LÝ NÚT NGÂN HÀNG ===

const startMarker = "if (cid.startsWith('ww_join_') || cid.startsWith('ww_start_') || cid.startsWith('ww_cancel_')) {";
const endMarker = "// === XỬ LÝ NÚT NGÂN HÀNG ===";

const startIndex = content.indexOf(startMarker);
const endIndex = content.indexOf(endMarker);

if (startIndex !== -1 && endIndex !== -1) {
    const replacement = `if (cid.startsWith('ww_')) {
            return WW.handleInteraction(interaction);
        }

        `;
    
    content = content.substring(0, startIndex) + replacement + content.substring(endIndex);
    fs.writeFileSync(idxPath, content, 'utf8');
    console.log('Successfully patched index.js interaction listener for ww_');
} else {
    console.log('Markers not found!');
    if (startIndex === -1) console.log('Start marker not found');
    if (endIndex === -1) console.log('End marker not found');
}
