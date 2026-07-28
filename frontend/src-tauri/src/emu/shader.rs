// The display filter, natively.
//
// The web player borrows EmulatorJS's shader collection; the native host has to
// bring its own. The contract is the frontend's SHADER_LEVELS — Off, CRT,
// CRT curve, Smooth — because the pause menu is shared and a filter picked on
// the couch should mean the same thing in either player.
//
// Two of those four need no shader at all: "Off" and "Smooth" are the existing
// framebuffer blit with NEAREST or LINEAR sampling, which is both cheaper and
// sharper than faking it in a fragment shader. Only the two CRT looks draw a
// textured quad through the program below.

use glow::HasContext;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Filter {
    Off,
    Smooth,
    Crt,
    CrtCurve,
}

impl Filter {
    /// Map the frontend's shader id onto what this host can actually draw. An
    /// id we don't know falls back to Off rather than to something arbitrary —
    /// same rule as the web player's clampShader.
    pub fn from_id(id: &str) -> Filter {
        match id {
            "crt-easymode.glslp" => Filter::Crt,
            "crt-geom.glslp" => Filter::CrtCurve,
            "bicubic" => Filter::Smooth,
            _ => Filter::Off,
        }
    }

    /// Off and Smooth are just the blit with different sampling — no program.
    pub fn needs_shader(self) -> bool {
        matches!(self, Filter::Crt | Filter::CrtCurve)
    }
}

const VERT: &str = r#"#version 330 core
// A fullscreen triangle from gl_VertexID — no vertex buffer, no attributes.
out vec2 uv;
void main() {
    vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
    uv = p;
    gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
"#;

const FRAG: &str = r#"#version 330 core
in vec2 uv;
out vec4 color;
uniform sampler2D src;
uniform vec2 src_size;   // the game's pixels, for scanline pitch
uniform int mode;        // 1 = scanlines, 2 = scanlines + curved glass
uniform int flip;        // 1 when the source's row 0 is the image top

void main() {
    vec2 t = uv;
    if (flip == 1) t.y = 1.0 - t.y;

    // Curved glass: push the sample point out from the centre, and let the
    // corners fall off the edge into black the way a tube's do.
    float vignette = 1.0;
    if (mode == 2) {
        vec2 c = t * 2.0 - 1.0;
        c *= 1.0 + 0.06 * dot(c.yx, c.yx);
        if (abs(c.x) > 1.0 || abs(c.y) > 1.0) {
            color = vec4(0.0, 0.0, 0.0, 1.0);
            return;
        }
        t = c * 0.5 + 0.5;
        vignette = 1.0 - 0.25 * dot(c, c) * 0.5;
    }

    vec3 rgb = texture(src, t).rgb;

    // The scanline itself: darken every other source row. Pitch follows the
    // GAME's height, not the window's, so the lines stay put as you resize.
    float line = sin(t.y * src_size.y * 3.14159265);
    rgb *= 0.82 + 0.18 * line * line;

    // A shadow-mask hint — a gentle per-column tint, the cheapest thing that
    // reads as a tube rather than as a dimmed image.
    float col = mod(gl_FragCoord.x, 3.0);
    vec3 mask = col < 1.0 ? vec3(1.05, 0.98, 0.98)
              : col < 2.0 ? vec3(0.98, 1.05, 0.98)
                          : vec3(0.98, 0.98, 1.05);
    rgb *= mask * vignette;

    // Scanlines eat light; give some back so the picture isn't just darker.
    color = vec4(clamp(rgb * 1.12, 0.0, 1.0), 1.0);
}
"#;

pub struct FilterStage {
    program: glow::Program,
    vao: glow::VertexArray,
    u_src_size: Option<glow::UniformLocation>,
    u_mode: Option<glow::UniformLocation>,
    u_flip: Option<glow::UniformLocation>,
}

impl FilterStage {
    /// Compile once, on the emu thread that owns the context. Returns None if
    /// the driver refuses — the caller then just keeps blitting, which is a
    /// missing filter rather than a black screen.
    pub fn new(gl: &glow::Context) -> Option<FilterStage> {
        unsafe {
            let program = gl.create_program().ok()?;
            for (kind, src) in [(glow::VERTEX_SHADER, VERT), (glow::FRAGMENT_SHADER, FRAG)] {
                let sh = gl.create_shader(kind).ok()?;
                gl.shader_source(sh, src);
                gl.compile_shader(sh);
                if !gl.get_shader_compile_status(sh) {
                    eprintln!("[emu] filter shader failed: {}", gl.get_shader_info_log(sh));
                    return None;
                }
                gl.attach_shader(program, sh);
                gl.delete_shader(sh);
            }
            gl.link_program(program);
            if !gl.get_program_link_status(program) {
                eprintln!("[emu] filter link failed: {}", gl.get_program_info_log(program));
                return None;
            }
            let vao = gl.create_vertex_array().ok()?; // core profile: required, even empty
            Some(FilterStage {
                u_src_size: gl.get_uniform_location(program, "src_size"),
                u_mode: gl.get_uniform_location(program, "mode"),
                u_flip: gl.get_uniform_location(program, "flip"),
                program,
                vao,
            })
        }
    }

    /// Draw the game through the filter, into the letterboxed rect.
    #[allow(clippy::too_many_arguments)]
    pub unsafe fn draw(
        &self,
        gl: &glow::Context,
        texture: glow::Texture,
        filter: Filter,
        (fw, fh): (i32, i32),
        (dx, dy, dw, dh): (i32, i32, i32, i32),
        flip: bool,
    ) {
        gl.use_program(Some(self.program));
        gl.bind_vertex_array(Some(self.vao));
        gl.viewport(dx, dy, dw, dh);
        gl.active_texture(glow::TEXTURE0);
        gl.bind_texture(glow::TEXTURE_2D, Some(texture));
        // Linear here: the CRT looks want the source resampled smoothly before
        // the scanlines go on top, or the lines beat against the pixel grid.
        gl.tex_parameter_i32(glow::TEXTURE_2D, glow::TEXTURE_MIN_FILTER, glow::LINEAR as i32);
        gl.tex_parameter_i32(glow::TEXTURE_2D, glow::TEXTURE_MAG_FILTER, glow::LINEAR as i32);
        gl.uniform_2_f32(self.u_src_size.as_ref(), fw as f32, fh as f32);
        gl.uniform_1_i32(self.u_mode.as_ref(), if filter == Filter::CrtCurve { 2 } else { 1 });
        gl.uniform_1_i32(self.u_flip.as_ref(), i32::from(flip));
        gl.draw_arrays(glow::TRIANGLES, 0, 3);
        gl.bind_vertex_array(None);
        gl.use_program(None);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_frontends_shader_ids_map_onto_what_the_host_can_draw() {
        // These ids come from lib/playerSettings.js SHADER_LEVELS — the pause
        // menu is shared, so a filter picked in either player must mean the
        // same thing in both.
        assert_eq!(Filter::from_id("disabled"), Filter::Off);
        assert_eq!(Filter::from_id("crt-easymode.glslp"), Filter::Crt);
        assert_eq!(Filter::from_id("crt-geom.glslp"), Filter::CrtCurve);
        assert_eq!(Filter::from_id("bicubic"), Filter::Smooth);
    }

    #[test]
    fn an_unknown_id_falls_back_to_off() {
        assert_eq!(Filter::from_id("crt-royale-kurozumi.glslp"), Filter::Off);
        assert_eq!(Filter::from_id(""), Filter::Off);
    }

    #[test]
    fn only_the_crt_looks_need_a_program() {
        assert!(!Filter::Off.needs_shader());
        assert!(!Filter::Smooth.needs_shader());
        assert!(Filter::Crt.needs_shader());
        assert!(Filter::CrtCurve.needs_shader());
    }
}
