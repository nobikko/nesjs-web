#![no_std]

use core::panic::PanicInfo;

#[panic_handler]
fn panic(_info: &PanicInfo<'_>) -> ! {
    loop {}
}

#[link(wasm_import_module = "env")]
unsafe extern "C" {
    fn run_frame_step_flags(max_cpu_cycles: i32, fallback_cpu_cycles: i32) -> i32;
}

static mut LAST_USED_FALLBACK: i32 = 0;
static mut LAST_NO_ADVANCE: i32 = 0;

#[unsafe(no_mangle)]
pub extern "C" fn run_frames(frame_count: i32, max_cpu_cycles: i32, fallback_cpu_cycles: i32) -> i32 {
    if frame_count <= 0 {
        unsafe {
            LAST_USED_FALLBACK = 0;
            LAST_NO_ADVANCE = 0;
        }
        return 0;
    }

    let mut ran = 0;
    let mut used_fallback = 0;
    let mut no_advance = 0;

    while ran < frame_count {
        let flags = unsafe { run_frame_step_flags(max_cpu_cycles, fallback_cpu_cycles) };
        if (flags & 0x1) != 0 {
            used_fallback += 1;
        }
        if (flags & 0x2) != 0 {
            no_advance += 1;
        }
        ran += 1;
    }

    unsafe {
        LAST_USED_FALLBACK = used_fallback;
        LAST_NO_ADVANCE = no_advance;
    }

    ran
}

#[unsafe(no_mangle)]
pub extern "C" fn get_last_used_fallback() -> i32 {
    unsafe { LAST_USED_FALLBACK }
}

#[unsafe(no_mangle)]
pub extern "C" fn get_last_no_advance() -> i32 {
    unsafe { LAST_NO_ADVANCE }
}
