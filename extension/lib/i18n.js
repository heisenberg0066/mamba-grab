/* Mamba Grab extension strings (EN/AR). */
(function (root) {
  'use strict';
  const S = {
    en: {
      appName: 'Mamba Grab', tagline: 'Media on this page',
      drmBlocked: 'This video is copy-protected and can\'t be downloaded.',
      drmBanner: 'This page plays copy-protected (DRM) video. It can\'t be downloaded — other files on the page are still listed.',
      sentToApp: 'Sent to the Mamba Grab app ✓', savedViaBrowser: 'Saving with the browser\'s downloads ✓',
      needAppInstall: 'Streams need the Mamba Grab app. Install MambaGrab-Setup.exe, then try again.',
      needAppRunning: 'Couldn\'t reach the Mamba Grab app. Open it and try again.',
      appOk: 'App connected', appOff: 'App not running', appMissing: 'App not installed', appChecking: 'Checking app…',
      dlThisVideo: '⬇ Download this video', dlThisAudio: '♪ Audio (MP3)', bestQuality: 'Best', quality: 'Quality', format: 'Format',
      all: 'All', video: 'Video', audio: 'Audio', image: 'Images', doc: 'Docs', archive: 'Archives', other: 'Other',
      minRes: 'Min. size', anyRes: 'Any resolution', minSize: 'Min. file size', anySize: 'Any file size', search: 'Filter by name…',
      selectAll: 'Select all', dlSelected: 'Download selected ({n})', dlAll: 'Download all ({n})', nothing: 'No media found on this page yet. Play the video or scroll the page, then reopen.',
      rescan: 'Rescan', download: 'Download', copy: 'Copy link', open: 'Open', copied: 'Copied',
      stream: 'stream', drm: 'DRM', upgraded: 'full size', blob: 'player (blob)', viaApp: 'via app', network: 'network',
      settings: 'Settings', language: 'Language', cookies: 'Use my browser session (cookies)', cookiesOff: 'Off', cookiesExt: 'Send this site\'s cookies to the app (recommended)', cookiesBrowser: 'yt-dlp --cookies-from-browser',
      cookiesHelp: 'Only for content you can already view while logged in. Off by default.', browser: 'Browser',
      autoStart: 'Start the app automatically when needed', subfolder: 'Save into "Mamba Grab/<site>/" in Downloads', hover: 'Show the "Download this video" button on videos',
      queue: 'App queue', openApp: 'Open app', noJobs: 'No downloads yet', playlist: 'Whole playlist', subs: 'Subtitles', thumb: 'Thumbnail',
      queued: 'Queued', running: 'Downloading', done: 'Done', error: 'Failed', canceled: 'Canceled', drmStatus: 'Copy-protected',
      ytdlpSite: 'This site works best through the app (yt-dlp) — use “Download this video”.',
      started: 'Started {n} download(s)', sentN: 'Sent {n} item(s) to the app', streamNeedsApp: 'Streams (HLS/DASH) are downloaded by the app.',
      checkingSizes: 'checking sizes…', help: 'Help'
    },
    ar: {
      appName: 'مامبا جراب', tagline: 'الوسائط في هذه الصفحة',
      drmBlocked: 'هذا الفيديو محمي من النسخ ولا يمكن تنزيله.',
      drmBanner: 'هذه الصفحة تعرض فيديو محميًا (DRM) ولا يمكن تنزيله — بقية الملفات في الصفحة ما زالت معروضة.',
      sentToApp: 'أُرسل إلى تطبيق مامبا جراب ✓', savedViaBrowser: 'يتم الحفظ عبر تنزيلات المتصفح ✓',
      needAppInstall: 'البث يحتاج تطبيق مامبا جراب. ثبّت MambaGrab-Setup.exe ثم حاول مجددًا.',
      needAppRunning: 'تعذّر الوصول إلى تطبيق مامبا جراب. افتحه وحاول مجددًا.',
      appOk: 'التطبيق متصل', appOff: 'التطبيق غير مشغّل', appMissing: 'التطبيق غير مثبّت', appChecking: 'جارٍ فحص التطبيق…',
      dlThisVideo: '⬇ تنزيل هذا الفيديو', dlThisAudio: '♪ صوت (MP3)', bestQuality: 'الأفضل', quality: 'الجودة', format: 'الصيغة',
      all: 'الكل', video: 'فيديو', audio: 'صوت', image: 'صور', doc: 'مستندات', archive: 'أرشيف', other: 'أخرى',
      minRes: 'أقل أبعاد', anyRes: 'أي دقة', minSize: 'أقل حجم', anySize: 'أي حجم', search: 'تصفية بالاسم…',
      selectAll: 'تحديد الكل', dlSelected: 'تنزيل المحدد ({n})', dlAll: 'تنزيل الكل ({n})', nothing: 'لم يُعثر على وسائط بعد. شغّل الفيديو أو مرّر الصفحة ثم أعد الفتح.',
      rescan: 'إعادة الفحص', download: 'تنزيل', copy: 'نسخ الرابط', open: 'فتح', copied: 'تم النسخ',
      stream: 'بث', drm: 'محمي', upgraded: 'الحجم الكامل', blob: 'مشغّل (blob)', viaApp: 'عبر التطبيق', network: 'الشبكة',
      settings: 'الإعدادات', language: 'اللغة', cookies: 'استخدام جلسة المتصفح (الكوكيز)', cookiesOff: 'إيقاف', cookiesExt: 'إرسال كوكيز هذا الموقع إلى التطبيق (مستحسن)', cookiesBrowser: 'yt-dlp --cookies-from-browser',
      cookiesHelp: 'فقط للمحتوى الذي يمكنك مشاهدته وأنت مسجّل الدخول. معطّل افتراضيًا.', browser: 'المتصفح',
      autoStart: 'تشغيل التطبيق تلقائيًا عند الحاجة', subfolder: 'الحفظ في "Mamba Grab/<الموقع>/" داخل التنزيلات', hover: 'إظهار زر "تنزيل هذا الفيديو" فوق الفيديوهات',
      queue: 'قائمة التطبيق', openApp: 'فتح التطبيق', noJobs: 'لا توجد تنزيلات بعد', playlist: 'كامل قائمة التشغيل', subs: 'الترجمات', thumb: 'الصورة المصغّرة',
      queued: 'في الانتظار', running: 'جارٍ التنزيل', done: 'اكتمل', error: 'فشل', canceled: 'أُلغي', drmStatus: 'محمي من النسخ',
      ytdlpSite: 'هذا الموقع يعمل أفضل عبر التطبيق (yt-dlp) — استخدم «تنزيل هذا الفيديو».',
      started: 'بدأ {n} تنزيل', sentN: 'أُرسل {n} عنصر إلى التطبيق', streamNeedsApp: 'البث (HLS/DASH) يُنزَّل عبر التطبيق.',
      checkingSizes: 'جارٍ فحص الأحجام…', help: 'مساعدة'
    }
  };
  function pick(lang) { if (lang === 'ar' || lang === 'en') return lang; const n = (root.navigator && navigator.language || 'en').slice(0, 2); return n === 'ar' ? 'ar' : 'en'; }
  function t(k, lang, vars) { const L = pick(lang); let s = (S[L] && S[L][k]) || S.en[k] || k; if (vars) for (const v in vars) s = s.replace('{' + v + '}', vars[v]); return s; }
  root.MambaI18n = { S, t, pick };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.MambaI18n;
})(typeof globalThis !== 'undefined' ? globalThis : this);
