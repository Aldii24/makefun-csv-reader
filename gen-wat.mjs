// Generates csv.wat: csv-reader 1.0.0's reading over JSON-escaped bytes, mirroring bytes.js's solveCase.
const strs = {
  codeHead: '{"code":"', stray: 'stray_cr', junk: 'quote_junk', unterm: 'unterminated_quote',
  short: 'short_row', long: 'long_row', lineK: '","line":', rowK: ',"row":', nul: 'null',
  fieldsK: ',"fields":', extraK: ',"extra":[',
};
let off = 16; const at = {}; let data = '';
for (const [k, v] of Object.entries(strs)) { at[k] = [off, v.length]; data += v; off += v.length; }
const S = (k) => `(i32.const ${at[k][0]}) (i32.const ${at[k][1]})`;
const SIMD = process.argv[2] !== 'scalar';
const runUnq = SIMD ? `
          (block $sd (loop $sl
            (br_if $sd (i32.gt_u (i32.add (local.get $p) (i32.const 16)) (local.get $e)))
            (local.set $v (v128.load (local.get $p)))
            (local.set $m (i8x16.bitmask (v128.or (i8x16.eq (local.get $v) (v128.const i8x16 44 44 44 44 44 44 44 44 44 44 44 44 44 44 44 44))
                                                  (i8x16.eq (local.get $v) (v128.const i8x16 92 92 92 92 92 92 92 92 92 92 92 92 92 92 92 92)))))
            (v128.store (local.get $w) (local.get $v))
            (if (i32.eqz (local.get $m)) (then
              (local.set $p (i32.add (local.get $p) (i32.const 16)))
              (local.set $w (i32.add (local.get $w) (i32.const 16)))
              (local.set $added (i32.const 1))
              (br $sl)))
            (local.set $k (i32.ctz (local.get $m)))
            (if (local.get $k) (then (local.set $added (i32.const 1))))
            (local.set $p (i32.add (local.get $p) (local.get $k)))
            (local.set $w (i32.add (local.get $w) (local.get $k)))
            (br $rd)))` : '';
const runQ = SIMD ? `
                (block $sd (loop $sl
                  (br_if $sd (i32.gt_u (i32.add (local.get $p) (i32.const 16)) (local.get $e)))
                  (local.set $v (v128.load (local.get $p)))
                  (local.set $m (i8x16.bitmask (i8x16.eq (local.get $v) (v128.const i8x16 92 92 92 92 92 92 92 92 92 92 92 92 92 92 92 92))))
                  (v128.store (local.get $w) (local.get $v))
                  (if (i32.eqz (local.get $m)) (then
                    (local.set $p (i32.add (local.get $p) (i32.const 16)))
                    (local.set $w (i32.add (local.get $w) (i32.const 16)))
                    (br $sl)))
                  (local.set $k (i32.ctz (local.get $m)))
                  (local.set $p (i32.add (local.get $p) (local.get $k)))
                  (local.set $w (i32.add (local.get $w) (local.get $k)))
                  (br $rd)))` : '';
const wat = `(module
  (memory (export "mem") 1)
  (data (i32.const 16) "${data.replace(/"/g, '\\"')}")
  (global $W (export "W") (mut i32) (i32.const 0))
  (global $EO (export "EO") (mut i32) (i32.const 0))
  (global $ELIM (mut i32) (i32.const 0))
  (global $NERR (mut i32) (i32.const 0))
  (global $COLE (export "COLE") (mut i32) (i32.const 0))
  (global $HASCOLS (export "HASCOLS") (mut i32) (i32.const 0))

  (func $hexv (param $b i32) (result i32)
    (if (i32.lt_u (i32.sub (local.get $b) (i32.const 48)) (i32.const 10)) (then (return (i32.sub (local.get $b) (i32.const 48)))))
    (local.set $b (i32.or (local.get $b) (i32.const 32)))
    (if (i32.lt_u (i32.sub (local.get $b) (i32.const 97)) (i32.const 6)) (then (return (i32.sub (local.get $b) (i32.const 87)))))
    unreachable)
  ;; escape at p: code | len << 16
  (func $escp (param $p i32) (result i32) (local $b i32)
    (local.set $b (i32.load8_u offset=1 (local.get $p)))
    (if (i32.eq (local.get $b) (i32.const 110)) (then (return (i32.const 131082))))
    (if (i32.eq (local.get $b) (i32.const 34)) (then (return (i32.const 131106))))
    (if (i32.eq (local.get $b) (i32.const 114)) (then (return (i32.const 131085))))
    (if (i32.eq (local.get $b) (i32.const 92)) (then (return (i32.const 131164))))
    (if (i32.eq (local.get $b) (i32.const 117)) (then
      (return (i32.or (i32.const 393216)
        (i32.or (i32.or (i32.shl (call $hexv (i32.load8_u offset=2 (local.get $p))) (i32.const 12))
                        (i32.shl (call $hexv (i32.load8_u offset=3 (local.get $p))) (i32.const 8)))
                (i32.or (i32.shl (call $hexv (i32.load8_u offset=4 (local.get $p))) (i32.const 4))
                        (call $hexv (i32.load8_u offset=5 (local.get $p)))))))))
    (if (i32.eq (local.get $b) (i32.const 116)) (then (return (i32.const 131081))))
    (if (i32.eq (local.get $b) (i32.const 47)) (then (return (i32.const 131119))))
    (if (i32.eq (local.get $b) (i32.const 98)) (then (return (i32.const 131080))))
    (if (i32.eq (local.get $b) (i32.const 102)) (then (return (i32.const 131084))))
    unreachable)
  (func $chp (param $p i32) (result i32) (local $b i32)
    (local.set $b (i32.load8_u (local.get $p)))
    (if (result i32) (i32.eq (local.get $b) (i32.const 92))
      (then (call $escp (local.get $p)))
      (else (i32.or (local.get $b) (i32.const 65536)))))
  (func $put (param $off i32) (param $len i32)
    (memory.copy (global.get $EO) (local.get $off) (local.get $len))
    (global.set $EO (i32.add (global.get $EO) (local.get $len))))
  (func $putc (param $c i32)
    (i32.store8 (global.get $EO) (local.get $c))
    (global.set $EO (i32.add (global.get $EO) (i32.const 1))))
  (func $itoa (param $v i32) (local $t i32) (local $n i32) (local $q i32)
    ;; digits count
    (local.set $t (local.get $v)) (local.set $n (i32.const 1))
    (block $d (loop $l (br_if $d (i32.lt_u (local.get $t) (i32.const 10)))
      (local.set $t (i32.div_u (local.get $t) (i32.const 10))) (local.set $n (i32.add (local.get $n) (i32.const 1))) (br $l)))
    (local.set $q (i32.add (global.get $EO) (local.get $n)))
    (global.set $EO (local.get $q))
    (loop $w
      (local.set $q (i32.sub (local.get $q) (i32.const 1)))
      (i32.store8 (local.get $q) (i32.add (i32.const 48) (i32.rem_u (local.get $v) (i32.const 10))))
      (local.set $v (i32.div_u (local.get $v) (i32.const 10)))
      (br_if $w (local.get $v))))
  ;; error head; returns 1 when the errors region is short
  (func $err (param $off i32) (param $len i32) (param $line i32) (param $row i32) (result i32)
    (if (i32.gt_u (i32.add (global.get $EO) (i32.const 160)) (global.get $ELIM)) (then (return (i32.const 1))))
    (if (global.get $NERR) (then (call $putc (i32.const 44))))
    (global.set $NERR (i32.add (global.get $NERR) (i32.const 1)))
    (call $put ${S('codeHead')})
    (call $put (local.get $off) (local.get $len))
    (call $put ${S('lineK')})
    (call $itoa (local.get $line))
    (call $put ${S('rowK')})
    (if (i32.lt_s (local.get $row) (i32.const 0)) (then (call $put ${S('nul')})) (else (call $itoa (local.get $row))))
    (i32.const 0))

${SIMD ? `  (func (export "strEnd") (param $p i32) (param $lim i32) (result i32) (local $m i32) (local $k i32) (local $q i32) (local $carry i32) (local $v v128)
    (block $no (loop $l
      (br_if $no (i32.ge_u (local.get $p) (local.get $lim)))
      (local.set $v (v128.load (local.get $p)))
      (local.set $m (i8x16.bitmask (v128.or
        (i8x16.eq (local.get $v) (i8x16.splat (i32.const 34)))
        (i8x16.eq (local.get $v) (i8x16.splat (i32.const 92))))))
      (local.set $m (i32.and (local.get $m) (i32.xor (local.get $carry) (i32.const -1))))
      (local.set $carry (i32.const 0))
      (block $nx (loop $in
        (br_if $nx (i32.eqz (local.get $m)))
        (local.set $k (i32.ctz (local.get $m)))
        (local.set $q (i32.add (local.get $p) (local.get $k)))
        (br_if $no (i32.ge_u (local.get $q) (local.get $lim)))
        (if (i32.eq (i32.load8_u (local.get $q)) (i32.const 34)) (then (return (local.get $q))))
        (if (i32.eq (local.get $k) (i32.const 15)) (then (local.set $carry (i32.const 1)) (br $nx)))
        (local.set $m (i32.and (local.get $m) (i32.shl (i32.const -1) (i32.add (local.get $k) (i32.const 2)))))
        (br $in)))
      (local.set $p (i32.add (local.get $p) (i32.const 16)))
      (br $l)))
    (i32.const -1))
` : `  (func (export "strEnd") (param $p i32) (param $lim i32) (result i32) (local $b i32)
    (block $no (loop $l
      (br_if $no (i32.ge_u (local.get $p) (local.get $lim)))
      (local.set $b (i32.load8_u (local.get $p)))
      (if (i32.eq (local.get $b) (i32.const 34)) (then (return (local.get $p))))
      (local.set $p (i32.add (local.get $p) (select (i32.const 2) (i32.const 1) (i32.eq (local.get $b) (i32.const 92)))))
      (br $l)))
    (i32.const -1))
`}  (func (export "solve") (param $s i32) (param $e i32) (param $header i32) (param $w i32) (param $outLim i32)
        (param $errBase i32) (param $errLim i32) (param $colBase i32) (param $colLim i32) (param $fst i32) (param $fstCap i32)
        (result i32)
    (local $p i32) (local $line i32) (local $rowsN i32) (local $width i32) (local $pending i32)
    (local $recLine i32) (local $recRow i32) (local $recStart i32) (local $nf i32) (local $quoted i32)
    (local $ended i32) (local $junk i32) (local $added i32) (local $x i32) (local $c i32) (local $L i32)
    (local $open i32) (local $openLine i32) (local $mark i32) (local $closed i32) (local $y i32) (local $k i32)
    (local $qL i32) (local $xs i32) (local $len i32) (local $v v128) (local $m i32)
    (local.set $p (local.get $s))
    (global.set $EO (local.get $errBase)) (global.set $ELIM (local.get $errLim)) (global.set $NERR (i32.const 0))
    (global.set $COLE (local.get $colBase)) (global.set $HASCOLS (i32.const 0))
    ;; a leading U+FEFF
    (if (i32.ge_u (i32.sub (local.get $e) (local.get $s)) (i32.const 3)) (then
      (if (i32.and (i32.and (i32.eq (i32.load8_u (local.get $p)) (i32.const 0xef)) (i32.eq (i32.load8_u offset=1 (local.get $p)) (i32.const 0xbb)))
                   (i32.eq (i32.load8_u offset=2 (local.get $p)) (i32.const 0xbf)))
        (then (local.set $p (i32.add (local.get $p) (i32.const 3))))
        (else
          (if (i32.ge_u (i32.sub (local.get $e) (local.get $s)) (i32.const 6)) (then
            (if (i32.and (i32.eq (i32.load8_u (local.get $p)) (i32.const 92)) (i32.eq (i32.load8_u offset=1 (local.get $p)) (i32.const 117))) (then
              (if (i32.eq (i32.and (call $escp (local.get $p)) (i32.const 0xffff)) (i32.const 0xfeff))
                (then (local.set $p (i32.add (local.get $p) (i32.const 6)))))))))))))
    (local.set $line (i32.const 1))
    (local.set $width (i32.const -1))
    (local.set $pending (local.get $header))
    (block $fail
      (block $done
        (loop $records
          ;; lines with no characters are no records
          (block $sk (loop $skl
            (br_if $sk (i32.ge_u (local.get $p) (local.get $e)))
            (local.set $x (call $chp (local.get $p)))
            (local.set $c (i32.and (local.get $x) (i32.const 0xffff)))
            (if (i32.eq (local.get $c) (i32.const 10)) (then
              (local.set $p (i32.add (local.get $p) (i32.shr_u (local.get $x) (i32.const 16))))
              (local.set $line (i32.add (local.get $line) (i32.const 1)))
              (br $skl)))
            (if (i32.eq (local.get $c) (i32.const 13)) (then
              (local.set $L (i32.shr_u (local.get $x) (i32.const 16)))
              (if (i32.lt_u (i32.add (local.get $p) (local.get $L)) (local.get $e)) (then
                (local.set $x (call $chp (i32.add (local.get $p) (local.get $L))))
                (if (i32.eq (i32.and (local.get $x) (i32.const 0xffff)) (i32.const 10)) (then
                  (local.set $p (i32.add (i32.add (local.get $p) (local.get $L)) (i32.shr_u (local.get $x) (i32.const 16))))
                  (local.set $line (i32.add (local.get $line) (i32.const 1)))
                  (br $skl)))))))
            (br $sk)))
          (br_if $done (i32.ge_u (local.get $p) (local.get $e)))

          (local.set $recLine (local.get $line))
          (local.set $recRow (select (i32.const -1) (local.get $rowsN) (local.get $pending)))
          (local.set $recStart (local.get $w))
          (if (local.get $rowsN) (then (i32.store8 (local.get $w) (i32.const 44)) (local.set $w (i32.add (local.get $w) (i32.const 1)))))
          (i32.store8 (local.get $w) (i32.const 91)) (local.set $w (i32.add (local.get $w) (i32.const 1)))
          (local.set $nf (i32.const 0))
          (loop $fields
            (br_if $fail (i32.gt_u (i32.add (i32.add (local.get $w) (i32.sub (local.get $e) (local.get $p))) (i32.const 64)) (local.get $outLim)))
            (if (local.get $nf) (then (i32.store8 (local.get $w) (i32.const 44)) (local.set $w (i32.add (local.get $w) (i32.const 1)))))
            (br_if $fail (i32.ge_u (local.get $nf) (local.get $fstCap)))
            (i32.store (i32.add (local.get $fst) (i32.shl (local.get $nf) (i32.const 2))) (local.get $w))
            (i32.store8 (local.get $w) (i32.const 34)) (local.set $w (i32.add (local.get $w) (i32.const 1)))
            (local.set $junk (i32.const 0))
            (local.set $quoted (i32.const 0))
            (block $fe
              (block $unq
                (br_if $unq (i32.ge_u (local.get $p) (local.get $e)))
                (br_if $unq (i32.ne (i32.load8_u (local.get $p)) (i32.const 92)))
                (local.set $x (call $escp (local.get $p)))
                (br_if $unq (i32.ne (i32.and (local.get $x) (i32.const 0xffff)) (i32.const 34)))
                ;; a quoted field
                (local.set $quoted (i32.const 1))
                (local.set $qL (i32.shr_u (local.get $x) (i32.const 16)))
                (local.set $open (local.get $p)) (local.set $openLine (local.get $line)) (local.set $mark (local.get $w))
                (local.set $p (i32.add (local.get $p) (local.get $qL)))
                (local.set $closed (i32.const 0))
                (block $qx (loop $q
                  (block $rd ${runQ}
                    (loop $r
                      (br_if $rd (i32.ge_u (local.get $p) (local.get $e)))
                      (local.set $y (i32.load8_u (local.get $p)))
                      (br_if $rd (i32.eq (local.get $y) (i32.const 92)))
                      (i32.store8 (local.get $w) (local.get $y))
                      (local.set $w (i32.add (local.get $w) (i32.const 1)))
                      (local.set $p (i32.add (local.get $p) (i32.const 1)))
                      (br $r)))
                  (br_if $qx (i32.ge_u (local.get $p) (local.get $e)))
                  (local.set $x (call $escp (local.get $p)))
                  (local.set $c (i32.and (local.get $x) (i32.const 0xffff)))
                  (local.set $L (i32.shr_u (local.get $x) (i32.const 16)))
                  (if (i32.eq (local.get $c) (i32.const 34)) (then
                    (if (i32.lt_u (i32.add (local.get $p) (local.get $L)) (local.get $e)) (then
                      (local.set $x (call $chp (i32.add (local.get $p) (local.get $L))))
                      (if (i32.eq (i32.and (local.get $x) (i32.const 0xffff)) (i32.const 34)) (then
                        (local.set $p (i32.add (i32.add (local.get $p) (local.get $L)) (i32.shr_u (local.get $x) (i32.const 16))))
                        (i32.store16 (local.get $w) (i32.const 8796)) ;; \\"
                        (local.set $w (i32.add (local.get $w) (i32.const 2)))
                        (br $q)))))
                    (local.set $p (i32.add (local.get $p) (local.get $L)))
                    (local.set $closed (i32.const 1))
                    (br $qx)))
                  (if (i32.eq (local.get $c) (i32.const 13)) (then
                    (i32.store16 (local.get $w) (i32.const 28252)) ;; \\n
                    (local.set $w (i32.add (local.get $w) (i32.const 2)))
                    (local.set $line (i32.add (local.get $line) (i32.const 1)))
                    (local.set $p (i32.add (local.get $p) (local.get $L)))
                    (if (i32.lt_u (local.get $p) (local.get $e)) (then
                      (local.set $x (call $chp (local.get $p)))
                      (if (i32.eq (i32.and (local.get $x) (i32.const 0xffff)) (i32.const 10)) (then
                        (local.set $p (i32.add (local.get $p) (i32.shr_u (local.get $x) (i32.const 16))))))))
                    (br $q)))
                  (if (i32.eq (local.get $c) (i32.const 10)) (then (local.set $line (i32.add (local.get $line) (i32.const 1)))))
                  (memory.copy (local.get $w) (local.get $p) (local.get $L))
                  (local.set $w (i32.add (local.get $w) (local.get $L)))
                  (local.set $p (i32.add (local.get $p) (local.get $L)))
                  (br $q)))
                (if (local.get $closed) (then
                  (if (i32.ge_u (local.get $p) (local.get $e)) (then (local.set $ended (i32.const 2)) (br $fe)))
                  (local.set $x (call $chp (local.get $p)))
                  (local.set $c (i32.and (local.get $x) (i32.const 0xffff)))
                  (local.set $L (i32.shr_u (local.get $x) (i32.const 16)))
                  (if (i32.eq (local.get $c) (i32.const 44)) (then
                    (local.set $p (i32.add (local.get $p) (local.get $L))) (local.set $ended (i32.const 0)) (br $fe)))
                  (if (i32.eq (local.get $c) (i32.const 10)) (then
                    (local.set $p (i32.add (local.get $p) (local.get $L))) (local.set $line (i32.add (local.get $line) (i32.const 1)))
                    (local.set $ended (i32.const 1)) (br $fe)))
                  (if (i32.eq (local.get $c) (i32.const 13)) (then
                    (if (i32.lt_u (i32.add (local.get $p) (local.get $L)) (local.get $e)) (then
                      (local.set $x (call $chp (i32.add (local.get $p) (local.get $L))))
                      (if (i32.eq (i32.and (local.get $x) (i32.const 0xffff)) (i32.const 10)) (then
                        (local.set $p (i32.add (i32.add (local.get $p) (local.get $L)) (i32.shr_u (local.get $x) (i32.const 16))))
                        (local.set $line (i32.add (local.get $line) (i32.const 1)))
                        (local.set $ended (i32.const 1)) (br $fe)))))))
                  (local.set $junk (i32.const 1)))
                (else
                  ;; never closes: a literal quote, the rest read again as unquoted
                  (local.set $p (i32.add (local.get $open) (local.get $qL)))
                  (local.set $line (local.get $openLine))
                  (local.set $w (local.get $mark))
                  (i32.store16 (local.get $w) (i32.const 8796))
                  (local.set $w (i32.add (local.get $w) (i32.const 2)))
                  (br_if $fail (call $err ${S('unterm')} (local.get $recLine) (local.get $recRow)))
                  (call $putc (i32.const 125)))))
              ;; unquoted characters up to the next comma or line break
              (local.set $added (i32.const 0))
              (block $ue (loop $u
                (block $rd ${runUnq}
                  (loop $r
                    (br_if $rd (i32.ge_u (local.get $p) (local.get $e)))
                    (local.set $y (i32.load8_u (local.get $p)))
                    (br_if $rd (i32.or (i32.eq (local.get $y) (i32.const 44)) (i32.eq (local.get $y) (i32.const 92))))
                    (i32.store8 (local.get $w) (local.get $y))
                    (local.set $w (i32.add (local.get $w) (i32.const 1)))
                    (local.set $p (i32.add (local.get $p) (i32.const 1)))
                    (local.set $added (i32.const 1))
                    (br $r)))
                (if (i32.ge_u (local.get $p) (local.get $e)) (then (local.set $ended (i32.const 2)) (br $ue)))
                (if (i32.eq (i32.load8_u (local.get $p)) (i32.const 44)) (then
                  (local.set $p (i32.add (local.get $p) (i32.const 1))) (local.set $ended (i32.const 0)) (br $ue)))
                (local.set $x (call $escp (local.get $p)))
                (local.set $c (i32.and (local.get $x) (i32.const 0xffff)))
                (local.set $L (i32.shr_u (local.get $x) (i32.const 16)))
                (if (i32.eq (local.get $c) (i32.const 10)) (then
                  (local.set $p (i32.add (local.get $p) (local.get $L))) (local.set $line (i32.add (local.get $line) (i32.const 1)))
                  (local.set $ended (i32.const 1)) (br $ue)))
                (if (i32.eq (local.get $c) (i32.const 13)) (then
                  (if (i32.lt_u (i32.add (local.get $p) (local.get $L)) (local.get $e)) (then
                    (local.set $x (call $chp (i32.add (local.get $p) (local.get $L))))
                    (if (i32.eq (i32.and (local.get $x) (i32.const 0xffff)) (i32.const 10)) (then
                      (local.set $p (i32.add (i32.add (local.get $p) (local.get $L)) (i32.shr_u (local.get $x) (i32.const 16))))
                      (local.set $line (i32.add (local.get $line) (i32.const 1)))
                      (local.set $ended (i32.const 1)) (br $ue)))))
                  (br_if $fail (call $err ${S('stray')} (local.get $recLine) (local.get $recRow)))
                  (call $putc (i32.const 125))
                  (local.set $p (i32.add (local.get $p) (local.get $L)))
                  (br $u)))
                (if (i32.eq (local.get $c) (i32.const 44)) (then
                  (local.set $p (i32.add (local.get $p) (local.get $L))) (local.set $ended (i32.const 0)) (br $ue)))
                (memory.copy (local.get $w) (local.get $p) (local.get $L))
                (local.set $w (i32.add (local.get $w) (local.get $L)))
                (local.set $p (i32.add (local.get $p) (local.get $L)))
                (local.set $added (i32.const 1))
                (br $u)))
              (if (i32.and (local.get $junk) (local.get $added)) (then
                (br_if $fail (call $err ${S('junk')} (local.get $recLine) (local.get $recRow)))
                (call $putc (i32.const 125)))))
            ;; the field ends
            (i32.store8 (local.get $w) (i32.const 34)) (local.set $w (i32.add (local.get $w) (i32.const 1)))
            (local.set $nf (i32.add (local.get $nf) (i32.const 1)))
            (br_if $fields (i32.eqz (local.get $ended))))

          ;; the record ends
          (if (i32.and (i32.and (i32.eq (local.get $nf) (i32.const 1)) (i32.eqz (local.get $quoted)))
                       (i32.eq (local.get $w) (i32.add (i32.load (local.get $fst)) (i32.const 2)))) (then
            (local.set $w (local.get $recStart))
            (br $records)))
          (if (i32.lt_s (local.get $width) (i32.const 0)) (then (local.set $width (local.get $nf))))
          (if (local.get $pending) (then
            (local.set $len (i32.sub (local.get $w) (i32.add (local.get $recStart) (i32.const 1))))
            (br_if $fail (i32.gt_u (i32.add (local.get $colBase) (local.get $len)) (local.get $colLim)))
            (memory.copy (local.get $colBase) (i32.add (local.get $recStart) (i32.const 1)) (local.get $len))
            (global.set $COLE (i32.add (local.get $colBase) (local.get $len)))
            (global.set $HASCOLS (i32.const 1))
            (local.set $w (local.get $recStart))
            (local.set $pending (i32.const 0))
            (br $records)))
          (if (i32.lt_u (local.get $nf) (local.get $width)) (then
            (br_if $fail (call $err ${S('short')} (local.get $recLine) (local.get $recRow)))
            (call $put ${S('fieldsK')})
            (call $itoa (local.get $nf))
            (call $putc (i32.const 125))
            (br_if $fail (i32.gt_u (i32.add (i32.add (local.get $w) (i32.mul (i32.sub (local.get $width) (local.get $nf)) (i32.const 3))) (i32.const 16)) (local.get $outLim)))
            (loop $pad
              (i32.store8 (local.get $w) (i32.const 44))
              (i32.store16 offset=1 (local.get $w) (i32.const 8738)) ;; ""
              (local.set $w (i32.add (local.get $w) (i32.const 3)))
              (local.set $nf (i32.add (local.get $nf) (i32.const 1)))
              (br_if $pad (i32.lt_u (local.get $nf) (local.get $width)))))
          (else
            (if (i32.gt_u (local.get $nf) (local.get $width)) (then
              (br_if $fail (call $err ${S('long')} (local.get $recLine) (local.get $recRow)))
              (call $put ${S('extraK')})
              (local.set $xs (i32.load (i32.add (local.get $fst) (i32.shl (local.get $width) (i32.const 2)))))
              (local.set $len (i32.sub (local.get $w) (local.get $xs)))
              (br_if $fail (i32.gt_u (i32.add (i32.add (global.get $EO) (local.get $len)) (i32.const 16)) (local.get $errLim)))
              (memory.copy (global.get $EO) (local.get $xs) (local.get $len))
              (global.set $EO (i32.add (global.get $EO) (local.get $len)))
              (call $putc (i32.const 93))
              (call $putc (i32.const 125))
              (local.set $w (i32.sub (local.get $xs) (i32.const 1)))))))
          (i32.store8 (local.get $w) (i32.const 93)) (local.set $w (i32.add (local.get $w) (i32.const 1)))
          (local.set $rowsN (i32.add (local.get $rowsN) (i32.const 1)))
          (br $records)))
      (global.set $W (local.get $w))
      (return (i32.const 0)))
    (i32.const 1))
)`;
import { writeFileSync } from 'fs';
writeFileSync(process.argv[3] || 'csv.wat', wat);
