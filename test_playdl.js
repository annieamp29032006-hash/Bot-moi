const play = require('play-dl');

async function test() {
    try {
        const url = 'https://www.youtube.com/watch?v=jNQXAC9IVRw';
        const stream = await play.stream(url);
        console.log('Stream Type:', stream.type);
        console.log('play-dl success!');
    } catch (e) {
        console.error('play-dl error:', e);
    }
}
test();
