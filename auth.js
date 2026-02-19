// SAGE Egypt - Authentication Module
// Uses modern Google Identity Services (GIS) + Earth Engine

var tokenClient;

function showLoading(text) {
    document.getElementById('loadingOverlay').classList.remove('hidden');
    document.getElementById('loadingText').textContent = text || 'جاري التحميل...';
}

function hideLoading() {
    document.getElementById('loadingOverlay').classList.add('hidden');
}

function initAuthClient() {
    try {
        tokenClient = google.accounts.oauth2.initTokenClient({
            client_id: CONFIG.CLIENT_ID,
            scope: CONFIG.SCOPES.join(' '),
            callback: function (response) {
                if (response.error) {
                    hideLoading();
                    console.error('Auth error:', response);
                    if (response.error === 'popup_closed_by_user') {
                        alert('تم إغلاق نافذة تسجيل الدخول.\nPlease try again and complete the login.');
                    } else {
                        alert('خطأ في تسجيل الدخول: ' + response.error + '\n' + (response.error_description || ''));
                    }
                    return;
                }

                // Set token in EE
                showLoading('جاري تهيئة Earth Engine...');
                console.log('✅ Got access token, initializing EE...');

                ee.data.setAuthToken(
                    null,
                    'Bearer',
                    response.access_token,
                    3600,
                    [],
                    null,
                    false
                );

                ee.initialize(
                    null,
                    null,
                    function () {
                        hideLoading();
                        onAuthSuccess();
                    },
                    function (err) {
                        hideLoading();
                        console.error('EE init error:', err);
                        alert('خطأ في تهيئة Earth Engine:\n' + err);
                    },
                    null,
                    CONFIG.PROJECT_ID
                );
            },
            error_callback: function (err) {
                // This handles popup blocked / popup closed errors
                hideLoading();
                console.error('Token client error:', err);
                if (err.type === 'popup_failed_to_open') {
                    alert('⚠️ المتصفح حجب النافذة المنبثقة!\n\nالحل: اسمح بالنوافذ المنبثقة (Popups) لهذا الموقع من شريط العنوان.\n\nAllow popups for this site and try again.');
                } else if (err.type === 'popup_closed') {
                    alert('تم إغلاق نافذة تسجيل الدخول. جرب مرة أخرى.');
                } else {
                    alert('خطأ: ' + (err.message || err.type || JSON.stringify(err)));
                }
            }
        });
        console.log('✅ Token client initialized');
    } catch (e) {
        console.error('Failed to init token client:', e);
        alert('خطأ في تهيئة Google Identity Services:\n' + e.message);
    }
}

function startAuth() {
    if (!tokenClient) {
        alert('Google Identity Services لم يتم تحميله بعد. أعد تحميل الصفحة.');
        return;
    }
    showLoading('جاري تسجيل الدخول...');

    // Safety timeout: hide loading after 30 seconds if nothing happens
    window._authTimeout = setTimeout(function () {
        hideLoading();
        console.warn('Auth timeout - popup may have been blocked');
    }, 30000);

    try {
        tokenClient.requestAccessToken({ prompt: 'consent' });
    } catch (e) {
        hideLoading();
        console.error('requestAccessToken error:', e);
        alert('خطأ في فتح نافذة تسجيل الدخول:\n' + e.message);
    }
}

function onAuthSuccess() {
    clearTimeout(window._authTimeout);
    document.getElementById('loginScreen').classList.add('hidden');
    document.getElementById('appContainer').classList.remove('hidden');

    initMap();
    showWelcome();

    console.log('✅ SAGE Egypt initialized successfully!');
}

// Initialize GIS client when the library loads
window.addEventListener('load', function () {
    setTimeout(function () {
        if (typeof google !== 'undefined' && google.accounts && google.accounts.oauth2) {
            initAuthClient();
        } else {
            console.warn('Waiting for Google Identity Services...');
            setTimeout(function () {
                if (typeof google !== 'undefined' && google.accounts) {
                    initAuthClient();
                } else {
                    console.error('❌ Google Identity Services failed to load!');
                    alert('فشل تحميل خدمة Google. تأكد من اتصالك بالإنترنت وأعد تحميل الصفحة.');
                }
            }, 2000);
        }
    }, 500);
});
