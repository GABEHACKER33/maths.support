const UV_CONFIG = {
    prefix: '/uv/service/',
    encodeUrl: (str) => encodeURIComponent(str),
    decodeUrl: (str) => decodeURIComponent(str)
};

self.addEventListener('install', event => {
    console.log('[UV Service Worker] Installing...');
    self.skipWaiting();
});

self.addEventListener('activate', event => {
    console.log('[UV Service Worker] Activating...');
    event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);
    
    if (!url.pathname.startsWith(UV_CONFIG.prefix)) {
        return;
    }

    const encodedUrl = url.pathname.slice(UV_CONFIG.prefix.length);
    let targetUrl;
    
    try {
        targetUrl = UV_CONFIG.decodeUrl(encodedUrl);
        
        if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
            targetUrl = 'https://' + targetUrl;
        }
    } catch (error) {
        console.error('[UV Service Worker] URL decode error:', error);
        event.respondWith(
            new Response('Invalid URL encoding', {
                status: 400,
                headers: { 'content-type': 'text/plain' }
            })
        );
        return;
    }

    console.log('[UV Service Worker] Proxying:', targetUrl);

    // Use CORS proxy
    const proxyUrl = 'https://api.allorigins.win/raw?url=' + encodeURIComponent(targetUrl);

    event.respondWith(
        fetch(proxyUrl, {
            method: 'GET',
            credentials: 'omit',
            mode: 'cors'
        })
        .then(response => {
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const headers = new Headers(response.headers);
            
            // Remove security headers
            headers.delete('content-security-policy');
            headers.delete('content-security-policy-report-only');
            headers.delete('x-frame-options');
            headers.delete('x-content-type-options');
            headers.delete('strict-transport-security');
            headers.delete('permissions-policy');
            
            // Add CORS headers
            headers.set('access-control-allow-origin', '*');
            headers.set('access-control-allow-methods', '*');
            headers.set('access-control-allow-headers', '*');

            console.log('[UV Service Worker] Successfully proxied:', targetUrl);

            return new Response(response.body, {
                status: response.status,
                statusText: response.statusText,
                headers: headers
            });
        })
        .catch(error => {
            console.error('[UV Service Worker] Fetch error:', error);
            
            const errorHtml = `
<!DOCTYPE html>
<html>
<head>
    <title>Proxy Error</title>
    <style>
        body {
            font-family: 'Segoe UI', sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            display: flex;
            align-items: center;
            justify-content: center;
            height: 100vh;
            margin: 0;
            padding: 20px;
        }
        .error-box {
            background: rgba(255,255,255,0.1);
            backdrop-filter: blur(10px);
            padding: 40px;
            border-radius: 20px;
            max-width: 600px;
            text-align: center;
            border: 1px solid rgba(255,255,255,0.2);
        }
        h1 { font-size: 48px; margin: 0 0 20px 0; }
        p { font-size: 18px; margin: 10px 0; opacity: 0.9; }
        .url { 
            background: rgba(0,0,0,0.2);
            padding: 15px;
            border-radius: 10px;
            margin: 20px 0;
            word-break: break-all;
            font-family: monospace;
        }
        .tips {
            text-align: left;
            margin-top: 30px;
            background: rgba(255,255,255,0.1);
            padding: 20px;
            border-radius: 10px;
        }
        .tips h3 { margin-top: 0; }
        .tips li { margin: 10px 0; }
        button {
            background: white;
            color: #667eea;
            border: none;
            padding: 15px 30px;
            border-radius: 10px;
            font-size: 16px;
            font-weight: bold;
            cursor: pointer;
            margin-top: 20px;
        }
        button:hover { transform: scale(1.05); }
    </style>
</head>
<body>
    <div class="error-box">
        <h1>⚠️ Proxy Error</h1>
        <p><strong>Failed to load website</strong></p>
        <div class="url">${targetUrl}</div>
        <p>Error: ${error.message}</p>
        
        <div class="tips">
            <h3>💡 Troubleshooting Tips:</h3>
            <ul>
                <li>✓ Check your internet connection</li>
                <li>✓ Try a different website to test</li>
                <li>✓ Some sites actively block proxies</li>
                <li>✓ The site may be temporarily down</li>
                <li>✓ Try the quick links on the homepage</li>
            </ul>
        </div>
        
        <button onclick="window.history.back()">← Go Back</button>
    </div>
</body>
</html>
            `;
            
            return new Response(errorHtml, {
                status: 500,
                headers: { 
                    'content-type': 'text/html',
                    'access-control-allow-origin': '*'
                }
            });
        })
    );
});

console.log('[UV Service Worker] Loaded and ready');
