/* Variadic C shim for retro_log_printf_t — stable Rust can't define a C-variadic
 * function, so the log callback lands here and forwards to stderr. */
#include <stdarg.h>
#include <stdio.h>

void frog_spike_log(unsigned level, const char *fmt, ...)
{
    va_list ap;
    va_start(ap, fmt);
    fprintf(stderr, "  [core:%u] ", level);
    vfprintf(stderr, fmt, ap);
    va_end(ap);
}
