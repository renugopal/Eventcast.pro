const run = async () => {
    const res = await fetch('https://raw.githubusercontent.com/renugopal/Eventcast.pro/main/events/another-test-wedding/index.html');
    const text = await res.text();
    console.log('Has livestream section:', text.includes('id="livestream"'));
    console.log('Has youtube-player div:', text.includes('id="youtube-player"'));
    console.log('Has plyr CSS:', text.includes('plyr.css'));
    console.log('Has hls.js script:', text.includes('hls.js'));
    console.log('Has plyr script:', text.includes('plyr.polyfilled.js'));
    
    // Find livestream section
    const idx = text.indexOf('livestream');
    if (idx !== -1) {
        console.log('\nLivestream section snippet:');
        console.log(text.substring(idx - 5, idx + 300));
    }
};
run().catch(console.error);
