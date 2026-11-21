#![no_std]
// csv-reader 1.0.0's reading, streamed: the case's text is read straight from cases.json's JSON-escaped bytes, a
// record at a time, and each answer's rows are written as JSON bytes (input escapes copied as they stand).
use core::arch::wasm32::*;

#[panic_handler]
fn panic(_: &core::panic::PanicInfo) -> ! {
    core::arch::wasm32::unreachable()
}

// The memory (16 MiB, its initial size): the input window (up to 4 MiB), the errors, the first record and the head
// (the hole's bytes), then the output window last, so that a row too long for it traps rather than overwrites.
pub const IN0: usize = 1 << 20;
pub const ERR0: usize = 5 << 20; // error structs (8 x u32)
pub const ERR_CAP: usize = (1 << 20) / 32;
pub const EXT0: usize = 6 << 20; // long_row extra JSON
pub const EXT_CAP: usize = 2 << 20;
pub const REC10: usize = 8 << 20; // first record JSON
pub const REC1_CAP: usize = (1 << 20) - 4096;
pub const HOLE0: usize = 9 << 20; // the head, filled at finish
pub const OUT0: usize = 10 << 20; // output window, to the memory's end
pub const MEM_END: usize = 16 << 20;

static mut W: usize = OUT0;
static mut LINE: u32 = 1;
static mut K: u32 = 0;
static mut WIDTH: u32 = 0;
static mut REC1_LEN: usize = 0;
static mut NERR: usize = 0;
static mut EXTW: usize = 0;
static mut RETP: usize = 0;
static mut AT_START: bool = true;
static mut HOLE_AT: usize = 0; // out address of the hole (0: none made in this window yet / consumed)
static mut HOLE_LEN: usize = 0;
static mut FLUSH_AT: usize = 256 << 10;

const NEED: i32 = 0;
const ENDED: i32 = 1;
const FLUSH: i32 = 2;
const ABORT: i32 = 3;
const ONE_DONE: i32 = 4;

// field endings
const F_COMMA: i32 = 0;
const F_LB: i32 = 1;
const F_END: i32 = 2;
const F_NEED: i32 = 3;
const F_ABORT: i32 = 4;

const E_STRAY: u32 = 0;
const E_JUNK: u32 = 1;
const E_UNTERM: u32 = 2;
const E_SHORT: u32 = 3;
const E_LONG: u32 = 4;

#[inline(always)]
unsafe fn rd(p: usize) -> u8 {
    *(p as *const u8)
}
#[inline(always)]
unsafe fn wr(p: usize, b: u8) {
    *(p as *mut u8) = b;
}
#[inline(always)]
unsafe fn put(b: u8) {
    wr(W, b);
    W += 1;
}
#[inline(always)]
unsafe fn copy(dst: usize, src: usize, n: usize) {
    core::ptr::copy(src as *const u8, dst as *mut u8, n);
}

static mut REC_LINE: u32 = 0;
static mut REC_K: u32 = 0;
static mut EOF: bool = false;


unsafe fn push_err(code: u32, aux: u32, aux2: u32) -> bool {
    if NERR >= ERR_CAP {
        return false;
    }
    let p = (ERR0 + NERR * 32) as *mut u32;
    *p = code;
    *p.add(1) = REC_LINE;
    *p.add(2) = REC_K;
    *p.add(3) = aux;
    *p.add(4) = aux2;
    NERR += 1;
    true
}

#[inline(always)]
fn hexv(b: u8) -> i32 {
    match b {
        b'0'..=b'9' => (b - b'0') as i32,
        b'a'..=b'f' => (b - b'a' + 10) as i32,
        b'A'..=b'F' => (b - b'A' + 10) as i32,
        _ => -1,
    }
}

/// A \uXXXX escape at p (p points at the backslash): 0 ok (copy 6 bytes), 1 need more, 2 abort.
#[inline(never)]
unsafe fn check_u(p: usize, e: usize) -> i32 {
    if p + 6 > e {
        return 1;
    }
    let mut v: i32 = 0;
    for i in 2..6 {
        let h = hexv(rd(p + i));
        if h < 0 {
            return 2;
        }
        v = v * 16 + h;
    }
    if v == 0x0a || v == 0x0d || v == 0x22 || v == 0x2c || v == 0xfeff {
        return 2;
    }
    0
}


macro_rules! need {
    ($pp:ident, $ww:ident, $p:expr, $w:expr) => {{
        *$pp = $p;
        *$ww = $w;
        return F_NEED;
    }};
}

/// Unquoted characters appended at *ww up to the next comma, line break or the text's end. Sets *added when any is kept.
#[inline(always)]
unsafe fn unquoted<const MULTI: bool>(pp: &mut usize, ww: &mut usize, line: &mut u32, e: usize, added: &mut bool, nf: &mut u32, wpos: &mut usize, width: u32) -> i32 {
    let mut p = *pp;
    let mut w = *ww;
    let comma = u8x16_splat(b',');
    let bs = u8x16_splat(b'\\');
    let qt = u8x16_splat(b'"');
    loop {
        if p >= e {
            need!(pp, ww, p, w);
        }
        let v = v128_load(p as *const v128);
        let mut m = i8x16_bitmask(v128_or(v128_or(i8x16_eq(v, comma), i8x16_eq(v, bs)), i8x16_eq(v, qt))) as u32;
        let avail = e - p;
        if avail < 16 {
            m |= 1u32 << avail;
        }
        v128_store(w as *mut v128, v);
        if m == 0 {
            w += 16;
            p += 16;
            *added = true;
            continue;
        }
        let t = m.trailing_zeros() as usize;
        if t > 0 {
            *added = true;
        }
        w += t;
        p += t;
        if p >= e {
            need!(pp, ww, p, w);
        }
        let b = rd(p);
        if b == b',' {
            if MULTI {
                if p + 2 >= e {
                    need!(pp, ww, p, w);
                }
                if !(rd(p + 1) == b'\\' && rd(p + 2) == b'"') {
                    if *nf == width {
                        *wpos = w + 1;
                    }
                    *(w as *mut u32) = 0x0022_2c22;
                    w += 3;
                    *nf += 1;
                    p += 1;
                    continue;
                }
            }
            *pp = p + 1;
            *ww = w;
            return F_COMMA;
        }
        if b == b'"' {
            *pp = p;
            *ww = w;
            return F_END;
        }
        if p + 1 >= e {
            need!(pp, ww, p, w);
        }
        let c = rd(p + 1);
        if c == b'n' {
            *line += 1;
            *pp = p + 2;
            *ww = w;
            return F_LB;
        }
        if c == b'r' {
            if p + 3 >= e {
                need!(pp, ww, p, w);
            }
            if rd(p + 2) == b'\\' && rd(p + 3) == b'n' {
                *line += 1;
                *pp = p + 4;
                *ww = w;
                return F_LB;
            }
            if !push_err(E_STRAY, 0, 0) {
                return F_ABORT;
            }
            p += 2;
            continue;
        }
        if c == b'u' {
            let r = check_u(p, e);
            if r == 1 {
                need!(pp, ww, p, w);
            }
            if r == 2 {
                return F_ABORT;
            }
            copy(w, p, 6);
            w += 6;
            p += 6;
            *added = true;
            continue;
        }
        wr(w, b'\\');
        wr(w + 1, c);
        w += 2;
        p += 2;
        *added = true;
    }
}

/// A quoted field whose opening quote (\") is at *pp; its value (between the output's quotes) is written at *ww.
#[inline(always)]
unsafe fn quoted(pp: &mut usize, ww: &mut usize, line: &mut u32, e: usize) -> i32 {
    let open = *pp;
    let open_line = *line;
    let vstart = *ww;
    let mut w = vstart;
    let mut p = open + 2;
    let bs = u8x16_splat(b'\\');
    let qt = u8x16_splat(b'"');
    loop {
        if p >= e {
            return F_NEED;
        }
        let v = v128_load(p as *const v128);
        let mut m = i8x16_bitmask(v128_or(i8x16_eq(v, bs), i8x16_eq(v, qt))) as u32;
        let avail = e - p;
        if avail < 16 {
            m |= 1u32 << avail;
        }
        v128_store(w as *mut v128, v);
        if m == 0 {
            w += 16;
            p += 16;
            continue;
        }
        let t = m.trailing_zeros() as usize;
        w += t;
        p += t;
        if p >= e {
            return F_NEED;
        }
        let b = rd(p);
        if b == b'"' {
            // the text ends inside: the quote never closes
            w = vstart;
            wr(w, b'\\');
            wr(w + 1, b'"');
            w += 2;
            *line = open_line;
            if !push_err(E_UNTERM, 0, 0) {
                return F_ABORT;
            }
            let mut q = open + 2;
            let mut added = false;
            let mut d1 = 0u32;
            let mut d2 = 0usize;
            let r = unquoted::<false>(&mut q, &mut w, line, e, &mut added, &mut d1, &mut d2, 0);
            *pp = q;
            *ww = w;
            return r;
        }
        if p + 1 >= e {
            return F_NEED;
        }
        let c = rd(p + 1);
        if c == b'"' {
            if p + 2 >= e {
                return F_NEED;
            }
            if rd(p + 2) == b'\\' {
                if p + 3 >= e {
                    return F_NEED;
                }
                if rd(p + 3) == b'"' {
                    wr(w, b'\\');
                    wr(w + 1, b'"');
                    w += 2;
                    p += 4;
                    continue;
                }
            }
            p += 2;
            break;
        }
        if c == b'r' {
            if p + 3 >= e {
                return F_NEED;
            }
            wr(w, b'\\');
            wr(w + 1, b'n');
            w += 2;
            *line += 1;
            if rd(p + 2) == b'\\' && rd(p + 3) == b'n' {
                p += 4;
            } else {
                p += 2;
            }
            continue;
        }
        if c == b'n' {
            wr(w, b'\\');
            wr(w + 1, b'n');
            w += 2;
            *line += 1;
            p += 2;
            continue;
        }
        if c == b'u' {
            let r = check_u(p, e);
            if r == 1 {
                return F_NEED;
            }
            if r == 2 {
                return F_ABORT;
            }
            copy(w, p, 6);
            w += 6;
            p += 6;
            continue;
        }
        wr(w, b'\\');
        wr(w + 1, c);
        w += 2;
        p += 2;
    }
    // after the closing quote
    if p >= e {
        return F_NEED;
    }
    let b = rd(p);
    if b == b',' {
        *pp = p + 1;
        *ww = w;
        return F_COMMA;
    }
    if b == b'"' {
        *pp = p;
        *ww = w;
        return F_END;
    }
    if b == b'\\' {
        if p + 1 >= e {
            return F_NEED;
        }
        let c = rd(p + 1);
        if c == b'n' {
            *line += 1;
            *pp = p + 2;
            *ww = w;
            return F_LB;
        }
        if c == b'r' {
            if p + 3 >= e {
                return F_NEED;
            }
            if rd(p + 2) == b'\\' && rd(p + 3) == b'n' {
                *line += 1;
                *pp = p + 4;
                *ww = w;
                return F_LB;
            }
        }
    }
    let mut added = false;
    let mut q = p;
    let mut d1 = 0u32;
            let mut d2 = 0usize;
            let r = unquoted::<false>(&mut q, &mut w, line, e, &mut added, &mut d1, &mut d2, 0);
    if r == F_NEED || r == F_ABORT {
        return r;
    }
    if added && !push_err(E_JUNK, 0, 0) {
        return F_ABORT;
    }
    *pp = q;
    *ww = w;
    r
}

#[no_mangle]
pub unsafe extern "C" fn begin() {
    LINE = 1;
    K = 0;
    WIDTH = 0;
    REC1_LEN = 0;
    NERR = 0;
    EXTW = 0;
    AT_START = true;
    HOLE_AT = 0;
    HOLE_LEN = 0;
}

#[no_mangle]
pub unsafe extern "C" fn set_flush(n: usize) {
    FLUSH_AT = n;
}

/// Reads records from [p, e) (e: the window's end, `eof` when the file ends there). Returns NEED (RETP: the first
/// byte not read, a record's start), ENDED (RETP: the text's closing quote), FLUSH (the output window is full,
/// RETP as for NEED) or ABORT.
/// The per-field reader: records from p0 (all of them, or with `one` the first only, then RETP and ONE_DONE).
#[inline(never)]
unsafe fn slow(p0: usize, e: usize, one: bool) -> i32 {
    let mut p = p0;
    let mut w = W;
    let mut line = LINE;
    macro_rules! out {
        ($r:expr) => {{
            W = w;
            LINE = line;
            return $r;
        }};
    }
    if AT_START {
        if p + 3 > e {
            RETP = p;
            out!(if EOF { ABORT } else { NEED });
        }
        if rd(p) == 0xEF && rd(p + 1) == 0xBB && rd(p + 2) == 0xBF {
            p += 3;
        }
        AT_START = false;
    }
    let width = WIDTH;
    let flush_at = OUT0 + FLUSH_AT;
    loop {
        if w >= flush_at {
            RETP = p;
            out!(FLUSH);
        }
        loop {
            if p >= e {
                RETP = p;
                out!(if EOF { ABORT } else { NEED });
            }
            let b = rd(p);
            if b == b'"' {
                RETP = p;
                out!(ENDED);
            }
            if b == b'\\' {
                if p + 1 >= e {
                    RETP = p;
                    out!(if EOF { ABORT } else { NEED });
                }
                let c = rd(p + 1);
                if c == b'n' {
                    p += 2;
                    line += 1;
                    continue;
                }
                if c == b'r' {
                    if p + 3 >= e {
                        RETP = p;
                        out!(if EOF { ABORT } else { NEED });
                    }
                    if rd(p + 2) == b'\\' && rd(p + 3) == b'n' {
                        p += 4;
                        line += 1;
                        continue;
                    }
                }
            }
            break;
        }
        let rec_p = p;
        let save_w = w;
        let save_nerr = NERR;
        let save_line = line;
        REC_LINE = line;
        REC_K = K;
        if K >= 2 {
            wr(w, b',');
            w += 1;
        }
        let rec_start = w;
        wr(w, b'[');
        w += 1;
        let mut nf: u32 = 0;
        let mut wpos: usize = 0;
        let mut last_quoted;
        let mut last_empty;
        loop {
            if nf > 0 {
                if nf == width {
                    wpos = w;
                }
                wr(w, b',');
                w += 1;
            }
            nf += 1;
            if p + 1 >= e {
                w = save_w;
                NERR = save_nerr;
                line = save_line;
                RETP = rec_p;
                out!(if EOF { ABORT } else { NEED });
            }
            wr(w, b'"');
            w += 1;
            last_quoted = rd(p) == b'\\' && rd(p + 1) == b'"';
            let r = if last_quoted {
                quoted(&mut p, &mut w, &mut line, e)
            } else {
                let mut added = false;
                unquoted::<true>(&mut p, &mut w, &mut line, e, &mut added, &mut nf, &mut wpos, width)
            };
            if r >= F_NEED {
                w = save_w;
                NERR = save_nerr;
                line = save_line;
                RETP = rec_p;
                if r == F_ABORT || EOF {
                    out!(ABORT);
                }
                out!(NEED);
            }
            last_empty = w == rec_start + 2;
            wr(w, b'"');
            w += 1;
            if r != F_COMMA {
                break;
            }
        }
        if nf == 1 && last_empty && !last_quoted {
            w = save_w;
            if one {
                RETP = p;
                out!(ONE_DONE);
            }
            continue;
        }
        wr(w, b']');
        w += 1;
        if K == 0 {
            if WIDTH == 0 {
                WIDTH = nf;
            }
            let len = w - rec_start;
            if len > REC1_CAP {
                out!(ABORT);
            }
            copy(REC10, rec_start, len);
            REC1_LEN = len;
            w = save_w;
            HOLE_AT = w;
            HOLE_LEN = 25 + len;
            w += HOLE_LEN;
            K = 1;
            W = w;
            LINE = line;
            if one {
                RETP = p;
                return ONE_DONE;
            }
            return slow(p, e, false); // WIDTH is known from here on
        }
        if nf < width {
            w -= 1;
            let mut i = nf;
            while i < width {
                wr(w, b',');
                wr(w + 1, b'"');
                wr(w + 2, b'"');
                w += 3;
                i += 1;
            }
            wr(w, b']');
            w += 1;
            if !push_err(E_SHORT, nf, 0) {
                out!(ABORT);
            }
        } else if nf > width {
            let xs = wpos + 1;
            let xl = w - 1 - xs;
            if EXTW + xl > EXT_CAP {
                out!(ABORT);
            }
            copy(EXT0 + EXTW, xs, xl);
            if !push_err(E_LONG, EXTW as u32, xl as u32) {
                out!(ABORT);
            }
            EXTW += xl;
            w = wpos;
            wr(w, b']');
            w += 1;
        }
        K += 1;
        if one {
            RETP = p;
            out!(ONE_DONE);
        }
    }
}


#[inline(always)]
unsafe fn seg(w: usize, src: usize, n: usize) {
    v128_store(w as *mut v128, v128_load(src as *const v128));
    v128_store((w + 16) as *mut v128, v128_load((src + 16) as *const v128));
    if n > 32 {
        let mut i = 32;
        loop {
            v128_store((w + i) as *mut v128, v128_load((src + i) as *const v128));
            i += 16;
            if i >= n {
                break;
            }
        }
    }
}


/// A row whose field count is not the width: padded (short_row) or cut (long_row). Returns the new w, 0 to abort.
#[inline(never)]
unsafe fn fix_row(mut w: usize, nf: u32, wpos: usize) -> usize {
    let width = WIDTH;
    if nf < width {
        w -= 1;
        let mut i = nf;
        while i < width {
            *(w as *mut u32) = 0x0022_222c;
            w += 3;
            i += 1;
        }
        wr(w, b']');
        w += 1;
        if !push_err(E_SHORT, nf, 0) {
            return 0;
        }
    } else {
        let xs = wpos + 1;
        let xl = w - 1 - xs;
        if EXTW + xl > EXT_CAP {
            return 0;
        }
        copy(EXT0 + EXTW, xs, xl);
        if !push_err(E_LONG, EXTW as u32, xl as u32) {
            return 0;
        }
        EXTW += xl;
        w = wpos;
        wr(w, b']');
        w += 1;
    }
    w
}

/// The output offset of the `,` that ends the record's `width`-th field: `q` is just past the record's `["`.
/// Fields are JSON strings, so a field ends at the first `"` not escaped by a backslash.
#[inline(never)]
unsafe fn find_wpos(mut q: usize, width: u32) -> usize {
    let mut n = 0u32;
    loop {
        let b = rd(q);
        if b == b'\\' {
            q += 2;
            continue;
        }
        if b == b'"' {
            n += 1;
            if n == width {
                return q + 1;
            }
            q += 3; // `","`
            continue;
        }
        q += 1;
    }
}

/// One record by the per-field reader (with `W`, `LINE` as the step's): ONE_DONE with RETP after it, or a step status.
#[inline(never)]
unsafe fn slow_one(p: usize, w: usize, line: u32, e: usize) -> i32 {
    W = w;
    LINE = line;
    if AT_START {
        let mut p = p;
        if p + 3 > e {
            RETP = p;
            return if EOF { ABORT } else { NEED };
        }
        if rd(p) == 0xEF && rd(p + 1) == 0xBB && rd(p + 2) == 0xBF {
            p += 3;
        }
        AT_START = false;
        return slow(p, e, true);
    }
    slow(p, e, true)
}

/// Reads records from [p, e) (e: the window's end, `eof` when the file ends there). Returns NEED (RETP: the first
/// byte not read, a record's start), ENDED (RETP: the text's closing quote), FLUSH (the output window is full,
/// RETP as for NEED) or ABORT. Plain records are read 64 bytes at a time, one record after another in the same
/// blocks; the first record and any record with anything rare in it (a stray CR, quote junk, a quote that never
/// closes, a \\u escape, the window's end) are read by `slow`.
#[no_mangle]
pub unsafe extern "C" fn step(p0: usize, e: usize, eof: i32) -> i32 {
    EOF = eof != 0;
    let mut p = p0;
    let mut w = W;
    let mut line = LINE;
    let flush_at = OUT0 + FLUSH_AT;
    let safe_e = e - 8;
    let comma = u8x16_splat(b',');
    let bs = u8x16_splat(b'\\');
    let qt = u8x16_splat(b'"');
    'outer: loop {
        if w >= flush_at {
            W = w;
            LINE = line;
            RETP = p;
            return FLUSH;
        }
        if K == 0 || p + 64 > safe_e {
            let r = slow_one(p, w, line, e);
            if r != ONE_DONE {
                return r;
            }
            p = RETP;
            w = W;
            line = LINE;
            continue 'outer;
        }
        // lines with no characters are no records
        loop {
            let b = rd(p);
            if b == b'\\' {
                let c = rd(p + 1);
                if c == b'n' {
                    p += 2;
                    line += 1;
                    continue;
                }
                if c == b'r' && rd(p + 2) == b'\\' && rd(p + 3) == b'n' {
                    p += 4;
                    line += 1;
                    continue;
                }
            } else if b == b'"' {
                W = w;
                LINE = line;
                RETP = p;
                return ENDED;
            }
            break;
        }
        if p + 64 > safe_e {
            continue 'outer;
        }
        let width = WIDTH;
        let mut kk = K;
        let mut rec_p = p;
        let mut save_w = w;
        let mut save_line = line;
        if kk >= 2 {
            wr(w, b',');
            w += 1;
        }
        *(w as *mut u16) = 0x225b; // ["
        w += 2;
        let mut nf: u32 = 1;
        let mut wpos: usize = 0;
        let mut quoted = false;
        let mut last = p; // the next input byte not yet copied
        let mut skip = p; // specials before this are read already
        let mut base = p;
        let mut carry: u64 = 0;
        'blocks: while base < safe_e {
            let mut cm: u64 = 0;
            let mut bm: u64 = 0;
            let mut qm: u64 = 0;
            let mut k = 0;
            while k < 4 {
                let v = v128_load((base + 16 * k) as *const v128);
                cm |= (i8x16_bitmask(i8x16_eq(v, comma)) as u64) << (16 * k);
                bm |= (i8x16_bitmask(i8x16_eq(v, bs)) as u64) << (16 * k);
                qm |= (i8x16_bitmask(i8x16_eq(v, qt)) as u64) << (16 * k);
                k += 1;
            }
            let prevbs = (bm << 1) | carry;
            carry = bm >> 63;
            if bm & prevbs == 0 {
                qm &= !prevbs; // a quote right after a backslash is that escape's own
            }
            let mut om = bm | qm;
            if base + 64 > safe_e {
                let lm = (1u64 << (safe_e - base)) - 1;
                cm &= lm;
                om &= lm;
            }
            if skip > base {
                let d = skip - base;
                let keep = if d >= 64 { 0 } else { !0u64 << d };
                cm &= keep;
                om &= keep;
            }
            // specials before x are read already: off the masks (and off the next block's, past this one)
            macro_rules! clr {
                ($x:expr) => {{
                    let x = $x;
                    skip = x;
                    let d = x - base;
                    let keep = if d >= 64 { 0 } else { !0u64 << d };
                    cm &= keep;
                    om &= keep;
                }};
            }
            loop {
                if !quoted {
                    let below = if om == 0 { !0u64 } else { (om & om.wrapping_neg()) - 1 };
                    let mut c = cm & below;
                    cm &= !below;
                    nf += c.count_ones();
                    while c != 0 {
                        let t = base + c.trailing_zeros() as usize;
                        c &= c - 1;
                        seg(w, last, t - last);
                        w += t - last;
                        *(w as *mut u32) = 0x0022_2c22;
                        w += 3;
                        last = t + 1;
                    }
                }
                if om == 0 {
                    break;
                }
                let t = base + om.trailing_zeros() as usize;
                om &= om - 1;
                let b = rd(t);
                // the record's end: endq where its line break (or the text's end) starts, next after it
                let endq: usize;
                let next: usize;
                if b == b'"' {
                    if quoted {
                        break 'blocks; // the quote never closes
                    }
                    endq = t;
                    next = t;
                } else {
                    let c = rd(t + 1);
                    if !quoted {
                        if c == b'n' {
                            endq = t;
                            next = t + 2;
                        } else if c == b'r' {
                            if rd(t + 2) == b'\\' && rd(t + 3) == b'n' {
                                endq = t;
                                next = t + 4;
                            } else {
                                break 'blocks; // stray CR
                            }
                        } else {
                            if c == b'"' && t == last {
                                // a field opening with a quote
                                quoted = true;
                                last = t + 2;
                            } else if c == b'u' {
                                break 'blocks;
                            }
                            clr!(t + 2);
                            continue;
                        }
                    } else if c == b'"' {
                        if rd(t + 2) == b'\\' && rd(t + 3) == b'"' {
                            seg(w, last, t + 2 - last);
                            w += t + 2 - last;
                            last = t + 4;
                            clr!(t + 4);
                            continue;
                        }
                        // the closing quote: a comma, a line break or the text's end must follow
                        seg(w, last, t - last);
                        w += t - last;
                        last = t;
                        let q = t + 2;
                        let x = rd(q);
                        if x == b',' {
                            quoted = false;
                            *(w as *mut u32) = 0x0022_2c22;
                            w += 3;
                            nf += 1;
                            last = q + 1;
                            clr!(q + 1);
                            continue;
                        }
                        if x == b'"' {
                            endq = t;
                            next = q;
                        } else if x == b'\\' && rd(q + 1) == b'n' {
                            endq = t;
                            next = q + 2;
                        } else if x == b'\\' && rd(q + 1) == b'r' && rd(q + 2) == b'\\' && rd(q + 3) == b'n' {
                            endq = t;
                            next = q + 4;
                        } else {
                            break 'blocks; // quote junk
                        }
                    } else if c == b'n' {
                        line += 1;
                        continue;
                    } else if c == b'r' {
                        seg(w, last, t - last);
                        w += t - last;
                        *(w as *mut u16) = 0x6e5c; // \\n
                        w += 2;
                        line += 1;
                        last = if rd(t + 2) == b'\\' && rd(t + 3) == b'n' { t + 4 } else { t + 2 };
                        clr!(last);
                        continue;
                    } else if c == b'u' {
                        break 'blocks;
                    } else {
                        clr!(t + 2);
                        continue;
                    }
                }
                // the record ends
                seg(w, last, endq - last);
                w += endq - last;
                *(w as *mut u16) = 0x5d22; // "]
                w += 2;
                if next != endq {
                    line += 1;
                }
                if nf == 1 && !quoted && w == save_w + (if kk >= 2 { 5 } else { 4 }) {
                    break 'blocks; // only stray CRs?
                }
                if nf != width {
                    REC_LINE = save_line;
                    REC_K = kk;
                    if nf > width {
                        wpos = find_wpos(save_w + (if kk >= 2 { 3 } else { 2 }), width);
                    }
                    w = fix_row(w, nf, wpos);
                    if w == 0 {
                        return ABORT;
                    }
                }
                kk += 1;
                K = kk;
                p = next;
                if w >= flush_at {
                    continue 'outer;
                }
                // the next record, in the same blocks
                loop {
                    if p + 64 > safe_e {
                        continue 'outer;
                    }
                    let b = rd(p);
                    if b == b'\\' {
                        let c = rd(p + 1);
                        if c == b'n' {
                            p += 2;
                            line += 1;
                            continue;
                        }
                        if c == b'r' && rd(p + 2) == b'\\' && rd(p + 3) == b'n' {
                            p += 4;
                            line += 1;
                            continue;
                        }
                    } else if b == b'"' {
                        continue 'outer;
                    }
                    break;
                }
                rec_p = p;
                save_w = w;
                save_line = line;
                wr(w, b',');
                *((w + 1) as *mut u16) = 0x225b; // ["
                w += 3;
                nf = 1;
                wpos = 0;
                quoted = false;
                last = p;
                if p >= base + 64 {
                    base = p;
                    skip = p;
                    carry = 0;
                    continue 'blocks;
                }
                clr!(p);
            }
            base += 64;
        }
        // the window ended first, or something rare: the per-field reader reads this record again
        w = save_w;
        line = save_line;
        let r = slow_one(rec_p, w, line, e);
        if r != ONE_DONE {
            return r;
        }
        p = RETP;
        w = W;
        line = LINE;
    }
}

unsafe fn put_bytes(s: &[u8]) {
    copy(W, s.as_ptr() as usize, s.len());
    W += s.len();
}

unsafe fn put_num(mut n: u32) {
    let mut buf = [0u8; 10];
    let mut i = 10;
    loop {
        i -= 1;
        buf[i] = b'0' + (n % 10) as u8;
        n /= 10;
        if n == 0 {
            break;
        }
    }
    put_bytes(&buf[i..]);
}

/// Ends the case's answer at W (the rows' close, the errors, the object's close) and fills the hole's head at HOLE0.
/// Returns the hole's length (0: none, the head was written at W).
#[no_mangle]
pub unsafe extern "C" fn finish(header: i32) -> usize {
    let header = header != 0;
    if K == 0 {
        if header {
            put_bytes(b"{\"columns\":[],\"rows\":[");
        } else {
            put_bytes(b"{\"columns\":null,\"rows\":[");
        }
    }
    put_bytes(b"],\"errors\":[");
    let mut i = 0;
    while i < NERR {
        let p = (ERR0 + i * 32) as *const u32;
        if i > 0 {
            put(b',');
        }
        let code = *p;
        put_bytes(match code {
            E_STRAY => b"{\"code\":\"stray_cr\",\"line\":" as &[u8],
            E_JUNK => b"{\"code\":\"quote_junk\",\"line\":",
            E_UNTERM => b"{\"code\":\"unterminated_quote\",\"line\":",
            E_SHORT => b"{\"code\":\"short_row\",\"line\":",
            _ => b"{\"code\":\"long_row\",\"line\":",
        });
        put_num(*p.add(1));
        put_bytes(b",\"row\":");
        let k = *p.add(2);
        if header {
            if k == 0 {
                put_bytes(b"null");
            } else {
                put_num(k - 1);
            }
        } else {
            put_num(k);
        }
        if code == E_SHORT {
            put_bytes(b",\"fields\":");
            put_num(*p.add(3));
        } else if code == E_LONG {
            put_bytes(b",\"extra\":[");
            let xs = *p.add(3) as usize;
            let xl = *p.add(4) as usize;
            copy(W, EXT0 + xs, xl);
            W += xl;
            put(b']');
        }
        put(b'}');
        i += 1;
    }
    put_bytes(b"]}");
    if K == 0 {
        return 0;
    }
    // the head
    let save = W;
    W = HOLE0;
    if header {
        put_bytes(b"{\"columns\":");
        copy(W, REC10, REC1_LEN);
        W += REC1_LEN;
        put_bytes(b",\"rows\":[");
    } else {
        put_bytes(b"{\"columns\":null,\"rows\":[");
        copy(W, REC10, REC1_LEN);
        W += REC1_LEN;
    }
    while W < HOLE0 + HOLE_LEN {
        put(b' ');
    }
    if !header && K >= 2 {
        wr(HOLE0 + HOLE_LEN - 1, b',');
    }
    W = save;
    HOLE_LEN
}

#[no_mangle]
pub unsafe extern "C" fn get_w() -> usize {
    W
}
#[no_mangle]
pub unsafe extern "C" fn set_w(w: usize) {
    W = w;
}
#[no_mangle]
pub unsafe extern "C" fn retp() -> usize {
    RETP
}
/// The hole's out address when one was made since the last call (then forgotten), else 0.
#[no_mangle]
pub unsafe extern "C" fn take_hole() -> usize {
    let h = HOLE_AT;
    HOLE_AT = 0;
    h
}

