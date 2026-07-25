fn main() {
    #[cfg(target_os = "macos")]
    {
        use std::path::PathBuf;

        let manifest_dir = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap());
        let plist = manifest_dir.join("Info.plist");
        println!("cargo:rerun-if-changed={}", plist.display());
        println!("cargo:rerun-if-changed=src/voice/macos_speech.m");
        println!("cargo:rustc-link-lib=framework=Speech");
        println!("cargo:rustc-link-lib=framework=AVFoundation");
        println!("cargo:rustc-link-lib=framework=Foundation");

        // Embed usage descriptions into the Mach-O so `tauri dev` (unpackaged
        // binary) does not get SIGABRT by TCC when requesting mic / speech.
        println!(
            "cargo:rustc-link-arg=-Wl,-sectcreate,__TEXT,__info_plist,{}",
            plist.display()
        );

        cc::Build::new()
            .file("src/voice/macos_speech.m")
            .flag("-fobjc-arc")
            .compile("yinzhan_macos_speech");
    }

    tauri_build::build()
}
