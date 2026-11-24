use serde::Serialize;
use std::path::PathBuf;
use tauri::Manager;

/// Returns the per-user application data directory (created on demand).
fn data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("앱 데이터 폴더를 찾을 수 없습니다: {e}"))?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("앱 데이터 폴더 생성 실패: {e}"))?;
    Ok(dir)
}

fn secret_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(data_dir(app)?.join("gemini-api-key.bin"))
}

#[derive(Serialize)]
struct SecretStatus {
    exists: bool,
    /// "dpapi" on Windows, "file-dev" on non-Windows development builds.
    method: String,
    path: String,
}

#[cfg(target_os = "windows")]
mod dpapi {
    use std::ffi::c_void;

    #[repr(C)]
    struct Blob {
        cb_data: u32,
        pb_data: *mut u8,
    }

    #[link(name = "crypt32")]
    extern "system" {
        fn CryptProtectData(
            p_data_in: *const Blob,
            sz_data_descr: *const u16,
            p_optional_entropy: *const Blob,
            pv_reserved: *mut c_void,
            p_prompt_struct: *mut c_void,
            dw_flags: u32,
            p_data_out: *mut Blob,
        ) -> i32;
        fn CryptUnprotectData(
            p_data_in: *const Blob,
            ppsz_data_descr: *mut *mut u16,
            p_optional_entropy: *const Blob,
            pv_reserved: *mut c_void,
            p_prompt_struct: *mut c_void,
            dw_flags: u32,
            p_data_out: *mut Blob,
        ) -> i32;
    }

    #[link(name = "kernel32")]
    extern "system" {
        fn LocalFree(h_mem: *mut c_void) -> *mut c_void;
    }

    // CRYPTPROTECT_UI_FORBIDDEN: never show a Windows prompt.
    const UI_FORBIDDEN: u32 = 0x1;

    pub fn protect(plain: &[u8]) -> Result<Vec<u8>, String> {
        unsafe {
            let mut input = Blob {
                cb_data: plain.len() as u32,
                pb_data: plain.as_ptr() as *mut u8,
            };
            let mut output = Blob {
                cb_data: 0,
                pb_data: std::ptr::null_mut(),
            };
            let ok = CryptProtectData(
                &input,
                std::ptr::null(),
                std::ptr::null(),
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                UI_FORBIDDEN,
                &mut output,
            );
            if ok == 0 {
                return Err("Windows DPAPI 암호화에 실패했습니다.".into());
            }
            let bytes = std::slice::from_raw_parts(output.pb_data, output.cb_data as usize).to_vec();
            LocalFree(output.pb_data as *mut c_void);
            Ok(bytes)
        }
    }

    pub fn unprotect(data: &[u8]) -> Result<Vec<u8>, String> {
        unsafe {
            let mut input = Blob {
                cb_data: data.len() as u32,
                pb_data: data.as_ptr() as *mut u8,
            };
            let mut output = Blob {
                cb_data: 0,
                pb_data: std::ptr::null_mut(),
            };
            let ok = CryptUnprotectData(
                &input,
                std::ptr::null_mut(),
                std::ptr::null(),
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                UI_FORBIDDEN,
                &mut output,
            );
            if ok == 0 {
                return Err("DPAPI 복호화에 실패했습니다. 저장된 키를 삭제 후 다시 입력해 주세요.".into());
            }
            let bytes = std::slice::from_raw_parts(output.pb_data, output.cb_data as usize).to_vec();
            LocalFree(output.pb_data as *mut c_void);
            Ok(bytes)
        }
    }
}

/// Saves the Gemini API key. On Windows it is encrypted with DPAPI so that only
/// the current Windows user account can decrypt it.
#[tauri::command]
fn secret_save(app: tauri::AppHandle, key: String) -> Result<(), String> {
    let trimmed = key.trim();
    if trimmed.is_empty() {
        return Err("API 키가 비어 있습니다.".into());
    }
    let path = secret_path(&app)?;
    #[cfg(target_os = "windows")]
    let bytes = dpapi::protect(trimmed.as_bytes())?;
    #[cfg(not(target_os = "windows"))]
    let bytes = trimmed.as_bytes().to_vec();
    std::fs::write(&path, bytes).map_err(|e| format!("API 키 저장 실패: {e}"))?;
    Ok(())
}

#[tauri::command]
fn secret_read(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let path = secret_path(&app)?;
    if !path.exists() {
        return Ok(None);
    }
    let raw = std::fs::read(&path).map_err(|e| format!("API 키 읽기 실패: {e}"))?;
    if raw.is_empty() {
        return Ok(None);
    }
    #[cfg(target_os = "windows")]
    let plain = dpapi::unprotect(&raw)?;
    #[cfg(not(target_os = "windows"))]
    let plain = raw;
    String::from_utf8(plain)
        .map(Some)
        .map_err(|_| "저장된 API 키 형식이 올바르지 않습니다.".to_string())
}

#[tauri::command]
fn secret_delete(app: tauri::AppHandle) -> Result<(), String> {
    let path = secret_path(&app)?;
    if path.exists() {
        std::fs::remove_file(&path).map_err(|e| format!("API 키 삭제 실패: {e}"))?;
    }
    Ok(())
}

#[tauri::command]
fn secret_status(app: tauri::AppHandle) -> Result<SecretStatus, String> {
    let path = secret_path(&app)?;
    Ok(SecretStatus {
        exists: path.exists(),
        method: if cfg!(target_os = "windows") {
            "dpapi".into()
        } else {
            "file-dev".into()
        },
        path: path.to_string_lossy().to_string(),
    })
}

/// Absolute path of the folder where projects and assets are kept by default.
#[tauri::command]
fn workspace_dir(app: tauri::AppHandle) -> Result<String, String> {
    let dir = data_dir(&app)?.join("projects");
    std::fs::create_dir_all(&dir).map_err(|e| format!("프로젝트 폴더 생성 실패: {e}"))?;
    Ok(dir.to_string_lossy().to_string())
}

#[tauri::command]
fn read_text_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| format!("파일을 읽을 수 없습니다: {e}"))
}

#[tauri::command]
fn write_text_file(path: String, contents: String) -> Result<(), String> {
    if let Some(parent) = std::path::Path::new(&path).parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("폴더 생성 실패: {e}"))?;
    }
    std::fs::write(&path, contents).map_err(|e| format!("파일 저장 실패: {e}"))
}

fn encode_base64(data: &[u8]) -> String {
    const CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(data.len().div_ceil(3) * 4);
    for chunk in data.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = *chunk.get(1).unwrap_or(&0) as u32;
        let b2 = *chunk.get(2).unwrap_or(&0) as u32;
        let n = (b0 << 16) | (b1 << 8) | b2;
        out.push(CHARS[((n >> 18) & 63) as usize] as char);
        out.push(CHARS[((n >> 12) & 63) as usize] as char);
        out.push(if chunk.len() > 1 {
            CHARS[((n >> 6) & 63) as usize] as char
        } else {
            '='
        });
        out.push(if chunk.len() > 2 {
            CHARS[(n & 63) as usize] as char
        } else {
            '='
        });
    }
    out
}

/// Reads any file (used for image/PDF attachments) as base64.
#[tauri::command]
fn read_binary_file_base64(path: String) -> Result<String, String> {
    let bytes = std::fs::read(&path).map_err(|e| format!("파일을 읽을 수 없습니다: {e}"))?;
    Ok(encode_base64(&bytes))
}

fn decode_base64(input: &str) -> Result<Vec<u8>, String> {
    let mut out = Vec::with_capacity(input.len() * 3 / 4 + 3);
    let mut buffer: u32 = 0;
    let mut bits: u32 = 0;
    for byte in input.bytes() {
        let value = match byte {
            b'A'..=b'Z' => byte - b'A',
            b'a'..=b'z' => byte - b'a' + 26,
            b'0'..=b'9' => byte - b'0' + 52,
            b'+' | b'-' => 62,
            b'/' | b'_' => 63,
            b'=' | b'\n' | b'\r' | b' ' | b'\t' => continue,
            _ => return Err("잘못된 base64 데이터입니다.".into()),
        } as u32;
        buffer = (buffer << 6) | value;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((buffer >> bits) as u8);
        }
    }
    Ok(out)
}

/// Writes a binary file (PNG export) from base64 data.
#[tauri::command]
fn write_binary_file_base64(path: String, data: String) -> Result<(), String> {
    let bytes = decode_base64(&data)?;
    if let Some(parent) = std::path::Path::new(&path).parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("폴더 생성 실패: {e}"))?;
    }
    std::fs::write(&path, bytes).map_err(|e| format!("파일 저장 실패: {e}"))
}

#[tauri::command]
fn path_exists(path: String) -> bool {
    std::path::Path::new(&path).exists()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            secret_save,
            secret_read,
            secret_delete,
            secret_status,
            workspace_dir,
            read_text_file,
            read_binary_file_base64,
            write_text_file,
            write_binary_file_base64,
            path_exists
        ])
        .run(tauri::generate_context!())
        .expect("error while running Qexam Teacher");
}
