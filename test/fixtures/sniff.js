// what an HLS player would do: fetch the manifest via XHR/fetch (the extension sees it on the network)
fetch('stream/master.m3u8').then(r => r.text()).then(t => fetch('stream/v720.m3u8'));
