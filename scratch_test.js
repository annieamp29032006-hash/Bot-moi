const play = require('play-dl');
const ytdl = require('ytdl-core'); // maybe?
const { spawn } = require('child_process');

async function test() {
    const url = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
    try {
        console.log('Testing play-dl...');
        const stream = await play.stream(url);
        console.log('play-dl success:', stream.type);
    } catch (e) {
        console.error('play-dl error:', e.message);
    }

    try {
        console.log('Testing yt-dlp...');
        const ytdlp = spawn('yt-dlp', ['-g', url]);
        ytdlp.stdout.on('data', d => console.log('yt-dlp stdout:', d.toString().trim()));
        ytdlp.stderr.on('data', d => console.error('yt-dlp stderr:', d.toString().trim()));
    } catch (e) {
        console.error('yt-dlp spawn error:', e.message);
    }
}
test();
