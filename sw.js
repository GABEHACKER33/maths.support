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
            if (!targetUrl.startsWith('//')) {
                targetUrl = 'https://' + targetUrl;
            }
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

    event.respondWith(
        fetch(targetUrl, {
            method: event.request.method,
            headers: createProxyHeaders(event.request.headers),
            body: event.request.method !== 'GET' && event.request.method !== 'HEAD' 
                ? event.request.body 
                : undefined,
            credentials: 'omit',
            redirect: 'follow',
            mode: 'cors'
        })
        .then(response => {
            const headers = new Headers(response.headers);
            
            // Remove security headers that block iframing
            headers.delete('content-security-policy');
            headers.delete('content-security-policy-report-only');
            headers.delete('x-frame-options');
            headers.delete('x-content-type-options');
            headers.delete('strict-transport-security');
            headers.delete('permissions-policy');
            headers.delete('cross-origin-embedder-policy');
            headers.delete('cross-origin-opener-policy');
            headers.delete('cross-origin-resource-policy');
            
            // Add CORS headers
            headers.set('access-control-allow-origin', '*');
            headers.set('access-control-allow-methods', '*');
            headers.set('access-control-allow-headers', '*');
            headers.set('access-control-expose-headers', '*');
            
            const contentType = headers.get('content-type') || '';
            
            // Handle HTML content - rewrite URLs
            if (contentType.includes('text/html')) {
                return response.text().then(html => {
                    html = rewriteHTML(html, targetUrl);
                    
                    return new Response(html, {
                        status: response.status,
                        statusText: response.statusText,
                        headers: headers
                    });
                });
            }
            
            // Handle CSS content - rewrite URLs
            if (contentType.includes('text/css')) {
                return response.text().then(css => {
                    css = rewriteCSS(css, targetUrl);
                    
                    return new Response(css, {
                        status: response.status,
                        statusText: response.statusText,
                        headers: headers
                    });
                });
            }
            
            // Handle JavaScript - inject proxy awareness
            if (contentType.includes('javascript') || contentType.includes('application/json')) {
                return response.text().then(js => {
                    // Inject proxy config for dynamic fetches
                    const injected = `
                        (function() {
                            const originalFetch = window.fetch;
                            window.fetch = function(...args) {
                                let url = args[0];
                                if (typeof url === 'string' && !url.startsWith('data:') && !url.startsWith('blob:') && !url.startsWith('${UV_CONFIG.prefix}')) {
                                    try {
                                        const absolute = new URL(url, '${targetUrl}').href;
                                        args[0] = '${UV_CONFIG.prefix}' + encodeURIComponent(absolute);
                                    } catch(e) {}
                                }
                                return originalFetch.apply(this, args);
                            };
                            
                            const originalOpen = XMLHttpRequest.prototype.open;
                            XMLHttpRequest.prototype.open = function(method, url, ...rest) {
                                if (typeof url === 'string' && !url.startsWith('data:') && !url.startsWith('blob:') && !url.startsWith('${UV_CONFIG.prefix}')) {
                                    try {
                                        const absolute = new URL(url, '${targetUrl}').href;
                                        url = '${UV_CONFIG.prefix}' + encodeURIComponent(absolute);
                                    } catch(e) {}
                                }
                                return originalOpen.call(this, method, url, ...rest);
                            };
                        })();
                    ` + js;
                    
                    return new Response(injected, {
                        status: response.status,
                        statusText: response.statusText,
                        headers: headers
                    });
                });
            }

            return new Response(response.body, {
                status: response.status,
                statusText: response.statusText,
                headers: headers
            });
        })
        .catch(error => {
            console.error('[UV Service Worker] Fetch error:', error);
            return new Response(`Proxy Error: ${error.message}\n\nTarget URL: ${targetUrl}`, {
                status: 500,
                headers: { 
                    'content-type': 'text/plain',
                    'access-control-allow-origin': '*'
                }
            });
        })
    );
});

function createProxyHeaders(originalHeaders) {
    const headers = new Headers();
    
    // Copy safe headers
    for (const [key, value] of originalHeaders.entries()) {
        const lowerKey = key.toLowerCase();
        if (!lowerKey.startsWith('sec-') && 
            lowerKey !== 'origin' && 
            lowerKey !== 'referer' &&
            lowerKey !== 'host') {
            headers.set(key, value);
        }
    }
    
    // Add standard headers
    headers.set('user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    headers.set('accept', 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8');
    headers.set('accept-language', 'en-US,en;q=0.9');
    headers.set('cache-control', 'no-cache');
    headers.set('pragma', 'no-cache');
    
    return headers;
}

function rewriteHTML(html, baseUrl) {
    // Inject base tag and proxy script
    html = html.replace(/<head[^>]*>/i, match => {
        return match + `
            <base href="${baseUrl}">
            <script>
                (function() {
                    const UV_PREFIX = '${UV_CONFIG.prefix}';
                    const BASE_URL = '${baseUrl}';
                    
                    // Override fetch
                    const originalFetch = window.fetch;
                    window.fetch = function(...args) {
                        let url = args[0];
                        if (typeof url === 'string' && !url.startsWith('data:') && !url.startsWith('blob:') && !url.startsWith(UV_PREFIX)) {
                            try {
                                const absolute = new URL(url, BASE_URL).href;
                                args[0] = UV_PREFIX + encodeURIComponent(absolute);
                            } catch(e) {}
                        }
                        return originalFetch.apply(this, args);
                    };
                    
                    // Override XMLHttpRequest
                    const originalOpen = XMLHttpRequest.prototype.open;
                    XMLHttpRequest.prototype.open = function(method, url, ...rest) {
                        if (typeof url === 'string' && !url.startsWith('data:') && !url.startsWith('blob:') && !url.startsWith(UV_PREFIX)) {
                            try {
                                const absolute = new URL(url, BASE_URL).href;
                                url = UV_PREFIX + encodeURIComponent(absolute);
                            } catch(e) {}
                        }
                        return originalOpen.call(this, method, url, ...rest);
                    };
                    
                    // Override window.open
                    const originalWindowOpen = window.open;
                    window.open = function(url, ...rest) {
                        if (url && typeof url === 'string' && !url.startsWith('data:') && !url.startsWith('blob:') && !url.startsWith(UV_PREFIX)) {
                            try {
                                const absolute = new URL(url, BASE_URL).href;
                                url = UV_PREFIX + encodeURIComponent(absolute);
                            } catch(e) {}
                        }
                        return originalWindowOpen.call(this, url, ...rest);
                    };
                })();
            </script>
        `;
    });
    
    // Rewrite href attributes
    html = html.replace(/(<a[^>]+href=["'])([^"']+)(["'])/gi, (match, prefix, url, suffix) => {
        if (url.startsWith('javascript:') || url.startsWith('#') || url.startsWith('data:') || url.startsWith('mailto:')) {
            return match;
        }
        try {
            const absolute = new URL(url, baseUrl).href;
            return prefix + UV_CONFIG.prefix + UV_CONFIG.encodeUrl(absolute) + suffix;
        } catch {
            return match;
        }
    });
    
    // Rewrite src attributes
    html = html.replace(/(<(?:script|img|iframe|embed|video|audio|source)[^>]+src=["'])([^"']+)(["'])/gi, (match, prefix, url, suffix) => {
        if (url.startsWith('data:') || url.startsWith('blob:')) {
            return match;
        }
        try {
            const absolute = new URL(url, baseUrl).href;
            return prefix + UV_CONFIG.prefix + UV_CONFIG.encodeUrl(absolute) + suffix;
        } catch {
            return match;
        }
    });
    
    // Rewrite form actions
    html = html.replace(/(<form[^>]+action=["'])([^"']+)(["'])/gi, (match, prefix, url, suffix) => {
        if (url.startsWith('javascript:')) {
            return match;
        }
        try {
            const absolute = new URL(url, baseUrl).href;
            return prefix + UV_CONFIG.prefix + UV_CONFIG.encodeUrl(absolute) + suffix;
        } catch {
            return match;
        }
    });
    
    return html;
}

function rewriteCSS(css, baseUrl) {
    // Rewrite url() in CSS
    css = css.replace(/url\(["']?([^)"']+)["']?\)/gi, (match, url) => {
        if (url.startsWith('data:') || url.startsWith('blob:')) {
            return match;
        }
        try {
            const absolute = new URL(url.trim(), baseUrl).href;
            return `url("${UV_CONFIG.prefix}${UV_CONFIG.encodeUrl(absolute)}")`;
        } catch {
            return match;
        }
    });
    
    // Rewrite @import
    css = css.replace(/@import\s+["']([^"']+)["']/gi, (match, url) => {
        try {
            const absolute = new URL(url, baseUrl).href;
            return `@import "${UV_CONFIG.prefix}${UV_CONFIG.encodeUrl(absolute)}"`;
        } catch {
            return match;
        }
    });
    
    return css;
}

console.log('[UV Service Worker] Loaded and ready');
