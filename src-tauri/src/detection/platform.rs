#[cfg(target_os = "macos")]
use std::{
    cell::RefCell,
    ffi::c_char,
    ptr::NonNull,
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
    time::Duration,
};

#[cfg(target_os = "macos")]
use block2::RcBlock;
#[cfg(target_os = "macos")]
use core_foundation::{
    base::{CFType, TCFType},
    data::CFData,
    number::CFNumber,
    string::CFString,
};
#[cfg(target_os = "macos")]
use core_foundation_sys::{
    base::{kCFAllocatorDefault, CFAllocatorRef, CFTypeRef},
    dictionary::CFMutableDictionaryRef,
    string::CFStringRef,
};
#[cfg(target_os = "macos")]
use objc2::{
    rc::Retained,
    runtime::{NSObjectProtocol, ProtocolObject},
};
#[cfg(target_os = "macos")]
use objc2_app_kit::{
    NSRunningApplication, NSWorkspace, NSWorkspaceApplicationKey,
    NSWorkspaceDidActivateApplicationNotification, NSWorkspaceDidWakeNotification,
    NSWorkspaceWillSleepNotification,
};
#[cfg(target_os = "macos")]
use objc2_foundation::NSNotification;
use tauri::{AppHandle, Manager, Wry};

#[cfg(target_os = "macos")]
use crate::detection::{execute_runtime_effects, DetectionState};

#[cfg(target_os = "macos")]
const IDLE_POLL_INTERVAL: Duration = Duration::from_secs(5);

#[cfg(target_os = "macos")]
const SYSTEM_UI_BUNDLE_IDS: &[&str] = &[
    "com.apple.Spotlight",
    "com.apple.notificationcenterui",
    "com.apple.controlcenter",
    "com.apple.screensaver",
];

#[cfg(target_os = "macos")]
static IDLE_POLL_ERROR_REPORTED: AtomicBool = AtomicBool::new(false);
#[cfg(target_os = "macos")]
static DETECTION_STATE_LOCK_POISONED: AtomicBool = AtomicBool::new(false);

#[cfg(target_os = "macos")]
thread_local! {
    static MACOS_MONITOR: RefCell<Option<MacOsMonitor>> = const { RefCell::new(None) };
}

#[cfg(target_os = "macos")]
struct MacOsMonitor {
    _observer_tokens: Vec<Retained<ProtocolObject<dyn NSObjectProtocol>>>,
    _observer_blocks: Vec<RcBlock<dyn Fn(NonNull<NSNotification>)>>,
}

pub fn setup(app: &AppHandle<Wry>) {
    #[cfg(target_os = "macos")]
    setup_macos(app);
}

#[cfg(target_os = "macos")]
fn setup_macos(app: &AppHandle<Wry>) {
    MACOS_MONITOR.with(|slot| {
        if slot.borrow().is_some() {
            return;
        }

        *slot.borrow_mut() = Some(MacOsMonitor::new(app.clone()));
    });

    spawn_idle_polling(app.clone());
}

#[cfg(target_os = "macos")]
impl MacOsMonitor {
    fn new(app: AppHandle<Wry>) -> Self {
        let workspace = NSWorkspace::sharedWorkspace();
        let center = workspace.notificationCenter();

        let activation_block = RcBlock::new({
            let app = app.clone();

            move |notification: NonNull<NSNotification>| {
                let notification = unsafe { notification.as_ref() };
                handle_activation_notification(&app, notification);
            }
        });

        let wake_block = RcBlock::new({
            let app = app.clone();

            move |_notification: NonNull<NSNotification>| {
                if let Some(effects) =
                    with_detection_state(&app, |state| state.clear_app_switches())
                {
                    if let Err(error) = execute_runtime_effects(&app, effects) {
                        error_log(&format!("failed to execute detection effects: {error}"));
                    }
                }

                debug_log("cleared sliding window after wake");
            }
        });

        let will_sleep_block = RcBlock::new(move |_notification: NonNull<NSNotification>| {
            debug_log("received system sleep notification");
        });

        let observer_tokens = vec![
            unsafe {
                center.addObserverForName_object_queue_usingBlock(
                    Some(NSWorkspaceDidActivateApplicationNotification),
                    None,
                    None,
                    &activation_block,
                )
            },
            unsafe {
                center.addObserverForName_object_queue_usingBlock(
                    Some(NSWorkspaceDidWakeNotification),
                    None,
                    None,
                    &wake_block,
                )
            },
            unsafe {
                center.addObserverForName_object_queue_usingBlock(
                    Some(NSWorkspaceWillSleepNotification),
                    None,
                    None,
                    &will_sleep_block,
                )
            },
        ];

        Self {
            _observer_tokens: observer_tokens,
            _observer_blocks: vec![activation_block, wake_block, will_sleep_block],
        }
    }
}

#[cfg(target_os = "macos")]
fn spawn_idle_polling(app: AppHandle<Wry>) {
    tauri::async_runtime::spawn(async move {
        let mut interval = tokio::time::interval(IDLE_POLL_INTERVAL);

        loop {
            interval.tick().await;

            match read_idle_seconds() {
                Ok(idle_seconds) => {
                    clear_idle_poll_error();
                    if let Some(effects) =
                        with_detection_state(&app, |state| state.update_idle_seconds(idle_seconds))
                    {
                        if let Err(error) = execute_runtime_effects(&app, effects) {
                            error_log(&format!("failed to execute detection effects: {error}"));
                        }
                    }
                }
                Err(error) => log_idle_poll_error(&error),
            }
        }
    });
}

#[cfg(target_os = "macos")]
fn handle_activation_notification(app: &AppHandle<Wry>, notification: &NSNotification) {
    let bundle_id = extract_bundle_id(notification);

    if bundle_id
        .as_deref()
        .is_some_and(|bundle_id| SYSTEM_UI_BUNDLE_IDS.contains(&bundle_id))
    {
        debug_log("filtered system UI activation event");
        return;
    }

    if let Some(effects) =
        with_detection_state(app, |state| state.record_app_switch(bundle_id.as_deref()))
    {
        if let Err(error) = execute_runtime_effects(app, effects) {
            error_log(&format!("failed to execute detection effects: {error}"));
        }
    }
}

#[cfg(target_os = "macos")]
fn extract_bundle_id(notification: &NSNotification) -> Option<String> {
    let user_info = notification.userInfo()?;
    let running_app = unsafe { user_info.objectForKey_unchecked(NSWorkspaceApplicationKey) }?
        .downcast_ref::<NSRunningApplication>()?;

    running_app
        .bundleIdentifier()
        .map(|bundle_id| bundle_id.to_string())
}

#[cfg(target_os = "macos")]
fn with_detection_state<T>(
    app: &AppHandle<Wry>,
    handler: impl FnOnce(&mut DetectionState) -> T,
) -> Option<T> {
    let state = app.state::<Mutex<DetectionState>>();
    let lock = state.lock();

    match lock {
        Ok(mut state) => Some(handler(&mut state)),
        Err(_) => {
            log_lock_poisoned();
            None
        }
    }
}

#[cfg(target_os = "macos")]
fn read_idle_seconds() -> Result<u64, String> {
    let service = unsafe {
        IOServiceGetMatchingService(
            kIOMainPortDefault,
            IOServiceMatching(b"IOHIDSystem\0".as_ptr().cast()),
        )
    };

    if service == 0 {
        return Err("IOHIDSystem service not found".to_string());
    }

    let property = unsafe {
        IORegistryEntryCreateCFProperty(
            service,
            CFString::from_static_string("HIDIdleTime").as_concrete_TypeRef(),
            kCFAllocatorDefault,
            0,
        )
    };

    unsafe {
        IOObjectRelease(service);
    }

    if property.is_null() {
        return Err("HIDIdleTime property unavailable".to_string());
    }

    let property = unsafe { CFType::wrap_under_create_rule(property) };

    if let Some(number) = property.downcast::<CFNumber>() {
        return number
            .to_i64()
            .map(|nanoseconds| (nanoseconds as u64) / 1_000_000_000)
            .ok_or_else(|| "HIDIdleTime CFNumber conversion failed".to_string());
    }

    if let Some(data) = property.downcast::<CFData>() {
        let bytes = data.bytes();

        if bytes.len() < std::mem::size_of::<u64>() {
            return Err("HIDIdleTime CFData payload too small".to_string());
        }

        let mut raw = [0u8; std::mem::size_of::<u64>()];
        raw.copy_from_slice(&bytes[..std::mem::size_of::<u64>()]);
        return Ok(u64::from_ne_bytes(raw) / 1_000_000_000);
    }

    Err("HIDIdleTime returned unsupported Core Foundation type".to_string())
}

#[cfg(target_os = "macos")]
fn debug_log(_message: &str) {
    #[cfg(debug_assertions)]
    eprintln!("[detection/platform] {_message}");
}

#[cfg(target_os = "macos")]
fn error_log(message: &str) {
    eprintln!("[detection/platform] {message}");
}

#[cfg(target_os = "macos")]
fn log_idle_poll_error(error: &str) {
    if !IDLE_POLL_ERROR_REPORTED.swap(true, Ordering::Relaxed) {
        error_log(&format!("idle polling failed: {error}"));
    }
}

#[cfg(target_os = "macos")]
fn clear_idle_poll_error() {
    if IDLE_POLL_ERROR_REPORTED.swap(false, Ordering::Relaxed) {
        error_log("idle polling recovered");
    }
}

#[cfg(target_os = "macos")]
fn log_lock_poisoned() {
    if !DETECTION_STATE_LOCK_POISONED.swap(true, Ordering::Relaxed) {
        error_log("detection state lock is poisoned");
    }
}

#[cfg(target_os = "macos")]
type IoObject = u32;
#[cfg(target_os = "macos")]
type IoRegistryEntry = IoObject;
#[cfg(target_os = "macos")]
type IoService = IoObject;
#[cfg(target_os = "macos")]
type MachPort = u32;

#[cfg(target_os = "macos")]
#[link(name = "IOKit", kind = "framework")]
unsafe extern "C" {
    static kIOMainPortDefault: MachPort;

    fn IOObjectRelease(object: IoObject) -> i32;
    fn IOServiceGetMatchingService(
        main_port: MachPort,
        matching: CFMutableDictionaryRef,
    ) -> IoService;
    fn IORegistryEntryCreateCFProperty(
        entry: IoRegistryEntry,
        key: CFStringRef,
        allocator: CFAllocatorRef,
        options: u32,
    ) -> CFTypeRef;
    fn IOServiceMatching(name: *const c_char) -> CFMutableDictionaryRef;
}
