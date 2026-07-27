// The §8.2 compositing probe (Phase 2a, first work item): prove that a native
// GL surface can live UNDER the transparent webview inside the ONE app window —
// the settled video path for the native player. Armed only when the app is
// launched with FROG_NATIVE_PROBE=1; it draws an animated clear color on an
// NSView slid beneath the WKWebView, makes the page transparent, and floats a
// small panel in the webview on top, so one look at the window answers all
// three questions: GL visible? chrome on top? and (via the panel's readout)
// does Cache Storage work on this origin?
//
// Threading shape mirrors the real player's plan: AppKit work (creating and
// inserting the NSView) happens on the main thread; ALL glutin/GL work happens
// on a spawned render thread, which owns the context for its lifetime. If this
// probe renders, the emu thread can too.

/// Dev deep-link: FROG_NAV="/play?id=..." steers the window to a route once
/// the page is up — a headless way to drive the player without a pointer
/// (screenshots + logs become a full boot smoke).
pub fn maybe_nav(app: &mut tauri::App) {
    use tauri::Manager;
    let Ok(path) = std::env::var("FROG_NAV") else { return };
    let Some(window) = app.get_webview_window("main") else { return };
    std::thread::spawn(move || {
        // Keep asking until it sticks, and make the ask idempotent: the dev
        // server can take a while to serve its first page (a cold dependency
        // cache is tens of seconds), and a single timed navigation aimed at a
        // page that hasn't loaded yet is simply lost. Re-navigating once the
        // player is already up would reload the game, so the script checks
        // where it is first.
        let nav = format!(
            "if (!location.pathname.startsWith('/play')) location.assign({});",
            serde_json::to_string(&path).unwrap_or_default()
        );
        // FROG_AUTOSTART=1 also presses start once the player has booted — the
        // difference between smoke-testing "the core loads" and "the game runs"
        // without a hand on the mouse. Enter is the player's own start key, so
        // this drives the real path rather than a back door. It keeps offering
        // for a couple of minutes, because the start card only appears once the
        // ROM has arrived and a disc image can take a while — and it runs on its
        // OWN thread, so the navigation retries above can't delay it.
        if std::env::var("FROG_AUTOSTART").ok().as_deref() == Some("1") {
            let starter = window.clone();
            std::thread::spawn(move || {
                for _ in 0..60 {
                    std::thread::sleep(std::time::Duration::from_millis(2000));
                    let _ = starter
                        .eval("window.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter'}))");
                }
            });
        }
        for _ in 0..20 {
            std::thread::sleep(std::time::Duration::from_millis(1500));
            let _ = window.eval(&nav);
        }
    });
}

#[cfg(target_os = "macos")]
pub fn maybe_arm(app: &mut tauri::App) {
    use tauri::Manager;

    if std::env::var("FROG_NATIVE_PROBE").ok().as_deref() != Some("1") {
        return;
    }
    let window = match app.get_webview_window("main") {
        Some(w) => w,
        None => return,
    };

    // Give the webview a moment to land in the view hierarchy and the page a
    // moment to load, then do the AppKit insertion on the main thread and hand
    // the view to the render thread. Probe-grade sequencing — the real player
    // arms from an explicit load_game command instead.
    let w = window.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(2500));
        let w2 = w.clone();
        let _ = w.run_on_main_thread(move || unsafe {
            insert_gl_view(&w2);
        });
        std::thread::sleep(std::time::Duration::from_millis(500));
        let _ = w.eval(PROBE_JS);
    });
}

#[cfg(not(target_os = "macos"))]
pub fn maybe_arm(_app: &mut tauri::App) {}

#[cfg(target_os = "macos")]
unsafe fn insert_gl_view(window: &tauri::WebviewWindow) {
    use objc2::rc::Retained;
    use objc2_app_kit::{NSAutoresizingMaskOptions, NSView, NSWindowOrderingMode};
    use objc2_foundation::MainThreadMarker;

    let mtm = match MainThreadMarker::new() {
        Some(m) => m,
        None => {
            eprintln!("probe: not on the main thread, aborting");
            return;
        }
    };
    let content = match window.ns_view() {
        Ok(p) => &*(p as *mut NSView),
        Err(e) => {
            eprintln!("probe: no ns_view: {e}");
            return;
        }
    };

    let view = NSView::initWithFrame(mtm.alloc(), content.bounds());
    view.setAutoresizingMask(
        NSAutoresizingMaskOptions::ViewWidthSizable | NSAutoresizingMaskOptions::ViewHeightSizable,
    );
    #[allow(deprecated)] // NSOpenGL is deprecated-but-working; the spike proved 4.1 core
    view.setWantsBestResolutionOpenGLSurface(true);
    // Under the webview: wry adds the WKWebView as a subview of the window's
    // content view, so ordering Below puts the GL surface behind the page.
    content.addSubview_positioned_relativeTo(&view, NSWindowOrderingMode::Below, None);

    let view_ptr = Retained::as_ptr(&view) as usize;
    let size = window.inner_size().unwrap_or(tauri::PhysicalSize::new(1280, 800));
    std::thread::spawn(move || render_loop(view_ptr, size.width, size.height));
}

#[cfg(target_os = "macos")]
fn render_loop(ns_view: usize, width: u32, height: u32) {
    use glow::HasContext;
    use glutin::config::ConfigTemplateBuilder;
    use glutin::context::{ContextApi, ContextAttributesBuilder, Version};
    use glutin::display::{Display, DisplayApiPreference, GlDisplay};
    use glutin::prelude::{GlConfig, GlSurface, NotCurrentGlContext};
    use glutin::surface::{SurfaceAttributesBuilder, WindowSurface};
    use raw_window_handle::{AppKitDisplayHandle, AppKitWindowHandle, RawDisplayHandle, RawWindowHandle};
    use std::num::NonZeroU32;

    unsafe {
        let display = match Display::new(
            RawDisplayHandle::AppKit(AppKitDisplayHandle::new()),
            DisplayApiPreference::Cgl,
        ) {
            Ok(d) => d,
            Err(e) => return eprintln!("probe: display: {e}"),
        };
        let config = match display
            .find_configs(ConfigTemplateBuilder::new().build())
            .map(|mut c| c.next())
        {
            Ok(Some(c)) => c,
            _ => return eprintln!("probe: no GL config"),
        };
        let rwh = RawWindowHandle::AppKit(AppKitWindowHandle::new(
            std::ptr::NonNull::new(ns_view as *mut _).unwrap(),
        ));
        let surface = match display.create_window_surface(
            &config,
            &SurfaceAttributesBuilder::<WindowSurface>::new().build(
                rwh,
                NonZeroU32::new(width.max(1)).unwrap(),
                NonZeroU32::new(height.max(1)).unwrap(),
            ),
        ) {
            Ok(s) => s,
            Err(e) => return eprintln!("probe: surface: {e}"),
        };
        let ctx = match display
            .create_context(
                &config,
                &ContextAttributesBuilder::new()
                    .with_context_api(ContextApi::OpenGl(Some(Version::new(3, 3))))
                    .build(Some(rwh)),
            )
            .and_then(|c| Ok(c.make_current(&surface)))
        {
            Ok(Ok(c)) => c,
            Ok(Err(e)) => return eprintln!("probe: make_current: {e}"),
            Err(e) => return eprintln!("probe: context: {e}"),
        };
        let gl = glow::Context::from_loader_function(|s| {
            display.get_proc_address(&std::ffi::CString::new(s).unwrap()) as *const _
        });
        eprintln!(
            "probe: gl {:?} on {:?} (samples {})",
            gl.get_parameter_string(glow::VERSION),
            gl.get_parameter_string(glow::RENDERER),
            config.num_samples(),
        );

        // The pond breathing behind the page: a slow jade↔deep-water sweep,
        // unmistakable in a screenshot and obviously animated in person.
        let start = std::time::Instant::now();
        loop {
            let t = start.elapsed().as_secs_f32();
            let pulse = (t * 0.8).sin() * 0.5 + 0.5;
            gl.clear_color(0.02 + 0.10 * pulse, 0.35 + 0.45 * pulse, 0.30 + 0.20 * pulse, 1.0);
            gl.clear(glow::COLOR_BUFFER_BIT);
            if let Err(e) = surface.swap_buffers(&ctx) {
                return eprintln!("probe: swap: {e}");
            }
            std::thread::sleep(std::time::Duration::from_millis(16));
        }
    }
}

// Injected into the page: make the document transparent so the GL surface
// shows through, then float a chrome panel over it that (a) proves the webview
// still renders and takes clicks on top, and (b) reports whether Cache Storage
// works on this origin (the local-first save mirror depends on it).
#[cfg(target_os = "macos")]
const PROBE_JS: &str = r#"
(async () => {
  document.documentElement.style.background = 'transparent';
  document.body.style.background = 'transparent';
  const root = document.getElementById('root');
  if (root) root.style.background = 'transparent';
  for (const el of document.querySelectorAll('body > *')) {
    if (el.id !== 'frog-probe-panel') el.style.visibility = 'hidden';
  }
  let cache = 'CACHE: checking';
  try {
    const c = await caches.open('probe');
    await c.put('/probe', new Response('ok'));
    const hit = await (await c.match('/probe'))?.text();
    await caches.delete('probe');
    cache = hit === 'ok' ? 'CACHE OK' : 'CACHE MISMATCH';
  } catch (e) {
    cache = 'CACHE FAIL: ' + (e && e.name);
  }
  const p = document.createElement('div');
  p.id = 'frog-probe-panel';
  p.style.cssText = 'position:fixed;top:40%;left:50%;transform:translate(-50%,-50%);' +
    'background:rgba(4,20,16,0.82);color:#a7f3d0;border:1px solid rgba(110,231,183,0.5);' +
    'border-radius:16px;padding:24px 32px;font:600 15px system-ui;z-index:99999;' +
    'text-align:center;backdrop-filter:blur(4px)';
  p.innerHTML = '<div style="font-size:18px;margin-bottom:8px">COMPOSITING PROBE</div>' +
    '<div>webview chrome over native GL</div>' +
    '<div id="frog-probe-cache" style="margin:8px 0">' + cache + '</div>' +
    '<button id="frog-probe-btn" style="padding:8px 20px;border-radius:9999px;' +
    'border:1px solid rgba(110,231,183,0.6);background:transparent;color:#a7f3d0;' +
    'font:600 14px system-ui">click me</button>' +
    '<div id="frog-probe-clicks" style="margin-top:6px;font-size:12px">clicks: 0</div>';
  document.body.appendChild(p);
  let n = 0;
  document.getElementById('frog-probe-btn').addEventListener('click', () => {
    n += 1;
    document.getElementById('frog-probe-clicks').textContent = 'clicks: ' + n;
  });
})();
"#;
