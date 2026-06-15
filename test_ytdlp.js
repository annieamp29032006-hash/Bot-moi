const { spawn, execFile } = require('child_process');
const path = require('path');
const YTDLP_PATH = path.join(__dirname, 'yt-dlp.exe');

const url = 'https://www.youtube.com/watch?v=jNQXAC9IVRw'; // Me at the zoo

console.log('Testing ytdlpGetInfo...');
execFile(YTDLP_PATH, ['-j', '--no-playlist', url], { maxBuffer: 1024 * 1024 * 10 }, (err, stdout, stderr) => {
    if (err) {
        console.error('ytdlpGetInfo ERROR:', err.message);
        console.error('STDERR:', stderr);
    } else {
        console.log('ytdlpGetInfo SUCCESS. stdout length:', stdout.length);
        const info = JSON.parse(stdout);
        console.log('Title:', info.title);
        
        console.log('Testing ytdlpStream...');
        const ytdlp = spawn(YTDLP_PATH, [
            '-f', 'bestaudio[ext=webm]/bestaudio/best',
            '--no-playlist',
            '-q',
            '-o', '-',
            url
        ]);
        
        let bytes = 0;
        ytdlp.stdout.on('data', chunk => {
            bytes += chunk.length;
        });
        
        ytdlp.stderr.on('data', chunk => {
            console.error('ytdlpStream STDERR:', chunk.toString());
        });
        
        ytdlp.on('close', code => {
            console.log(`ytdlpStream exited with code ${code}. Total bytes: ${bytes}`);
        });
    }
});
