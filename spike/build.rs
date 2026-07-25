fn main() {
    cc::Build::new().file("src/log_shim.c").compile("logshim");
}
