#!/usr/bin/env python3
"""
Patch rumahl-supervisor/src/main.rs to fix 9 known compile errors.
Safe to re-run (idempotent checks on each edit).

Run:
    python3 patch-rumahl-supervisor.py /path/to/backend/rumahl-supervisor/src/main.rs
"""
import re
import sys
import pathlib

def main():
    if len(sys.argv) != 2:
        print("Usage: patch-rumahl-supervisor.py <path-to-main.rs>", file=sys.stderr)
        sys.exit(2)
    p = pathlib.Path(sys.argv[1])
    src = p.read_text()
    orig = src
    changes = []

    # ── Fix 1: PortTypeEnum.as_str() (two occurrences, lines ~268 and ~1262) ──
    # `p.typ.as_ref().map(|s| s.as_str()).unwrap_or("tcp")` → Debug-based
    needle_a = 'p.typ.as_ref().map(|s| s.as_str()).unwrap_or("tcp")'
    repl_a = 'p.typ.as_ref().map(|s| format!("{:?}", s).to_lowercase()).unwrap_or_else(|| "tcp".to_string())'
    n = src.count(needle_a)
    if n:
        src = src.replace(needle_a, repl_a)
        changes.append(f"fix1: PortTypeEnum.as_str (x{n})")

    # Alternate form without outer parens: `.map(|s| s.as_str()).unwrap_or("tcp"))`
    # (e.g. in a longer expression chain — the needle above already covers it)

    # ── Fix 2: disk.file_system() returns OsStr, not &[u8] (line ~531) ──
    # `String::from_utf8_lossy(disk.file_system()).to_string()`
    needle_b = 'String::from_utf8_lossy(disk.file_system()).to_string()'
    repl_b = 'disk.file_system().to_string_lossy().into_owned()'
    if needle_b in src:
        src = src.replace(needle_b, repl_b)
        changes.append("fix2: disk.file_system() OsStr")

    # ── Fix 3: BuildImageOptions has no field `target` (line ~1017) ──
    # Drop the entire `target: "...",` line.
    src2 = re.sub(r'\n\s*target:\s*"rumahl-developer-app"\s*,\s*\n', '\n', src)
    if src2 != src:
        changes.append("fix3: BuildImageOptions.target removed")
        src = src2

    # ── Fix 4: E0034 try_next ambiguity (line ~1208) ──
    # `.stats(...).try_next()` → disambiguate with fully qualified call
    # We look for the ambiguous pattern and wrap the receiver.
    # Original: `&mut data.docker.stats(&container_id, Some(StatsOptions { ... })))`
    #          followed by `.try_next()`
    # Replace `.try_next()` ONLY when the nearby context is a Docker stats stream.
    src2 = re.sub(
        r'data\.docker\.stats\((?P<args>[^;]*?)\)\s*\.try_next\(\)',
        lambda m: f'futures_util::stream::TryStreamExt::try_next(&mut data.docker.stats({m.group("args")}))',
        src,
        flags=re.DOTALL,
    )
    if src2 != src:
        changes.append("fix4: try_next disambiguated (stats)")
        src = src2

    # Also handle already-taken &mut + .try_next():
    src2 = re.sub(
        r'\(&mut\s+(data\.docker\.stats\([^;]*?\))\)\s*\.try_next\(\)',
        r'futures_util::stream::TryStreamExt::try_next(&mut \1)',
        src,
        flags=re.DOTALL,
    )
    if src2 != src:
        changes.append("fix4b: try_next disambiguated (mut ref form)")
        src = src2

    # ── Fix 5+6+7+8+9: stream_logs + stream_metrics ──
    # Two issues per handler:
    #  (a) `async_stream::stream! { yield Event::... }` → Sse needs Result<Event, _>
    #       Fix: change yields to `yield Ok::<_, actix_web::Error>(Event::...)`
    #  (b) `return response;` of HttpResponse conflicts with final Sse<...> expression
    #       Fix: wrap return type in actix_web::Either<HttpResponse, Sse<...>>
    #
    # Strategy: for each of the two handler functions, rewrite the body to use Either.

    # Ensure `use actix_web::Either;` is imported.
    if 'use actix_web::Either' not in src and 'actix_web::Either' not in src:
        # Add alongside existing actix_web import if possible, else standalone.
        m = re.search(r'use\s+actix_web::\{[^}]*\};', src)
        if m:
            block = m.group(0)
            if 'Either' not in block:
                new_block = block[:-2] + ', Either};' if block.endswith('};') else block.replace('};', ', Either};', 1)
                src = src.replace(block, new_block, 1)
                changes.append("fix5a: added Either to actix_web use")
        else:
            # insert a standalone line near the top
            src = re.sub(
                r'(use\s+actix_web::[^\n]+;\n)',
                r'\1use actix_web::Either;\n',
                src,
                count=1,
            )
            changes.append("fix5a: added standalone use actix_web::Either")

    # Patch stream_logs and stream_metrics: wrap `return response;` branches and the final
    # Sse::from_stream expression with Either::Left / Either::Right.
    # Also rewrite `yield Event::` to `yield Ok::<_, actix_web::Error>(Event::`.
    # We do this handler-by-handler.

    for handler in ('stream_logs', 'stream_metrics'):
        # Match the whole fn body from `async fn <handler>` up to matching outer `}`.
        # Use a crude brace counter via regex is unsafe — instead, find the signature,
        # then scan.
        sig_re = re.compile(rf'(async\s+fn\s+{handler}\s*\([^)]*\)\s*->\s*impl\s+Responder\s*)\{{', re.DOTALL)
        m = sig_re.search(src)
        if not m:
            continue
        body_start = m.end() - 1  # position of '{'
        # Find matching '}' by counting.
        depth = 0
        i = body_start
        while i < len(src):
            c = src[i]
            if c == '{':
                depth += 1
            elif c == '}':
                depth -= 1
                if depth == 0:
                    body_end = i + 1
                    break
            i += 1
        else:
            continue

        body = src[body_start:body_end]
        new_body = body

        # (a) wrap `return response;` → `return Either::Left(response);`
        if 'return Either::Left(response)' not in new_body:
            new_body = re.sub(
                r'return\s+response\s*;',
                'return Either::Left(response);',
                new_body,
            )

        # (b) change every `yield Event::` inside to `yield Ok::<_, actix_web::Error>(Event::`
        #     and close the extra paren before the trailing `;`
        def yield_fix(mm):
            # mm.group(0) is like `yield Event::Data(...)`
            inner = mm.group(1)
            return f'yield Ok::<_, actix_web::Error>(Event::{inner})'
        new_body = re.sub(
            r'yield\s+Event::([A-Za-z_][A-Za-z_0-9]*\s*\([^;]*?\))',
            yield_fix,
            new_body,
            flags=re.DOTALL,
        )

        # Also handle `yield sse::Event::` form
        def yield_fix_sse(mm):
            inner = mm.group(1)
            return f'yield Ok::<_, actix_web::Error>(sse::Event::{inner})'
        new_body = re.sub(
            r'yield\s+sse::Event::([A-Za-z_][A-Za-z_0-9]*\s*\([^;]*?\))',
            yield_fix_sse,
            new_body,
            flags=re.DOTALL,
        )

        # (c) wrap `Sse::from_stream(<var>)` (no trailing semicolon, expression) with Either::Right
        # Match the LAST occurrence of `Sse::from_stream(<ident>)` in the body.
        last = None
        for mm in re.finditer(r'Sse::from_stream\(([A-Za-z_][A-Za-z_0-9]*)\)', new_body):
            last = mm
        if last and 'Either::Right(Sse::from_stream' not in new_body:
            new_body = (
                new_body[:last.start()]
                + f'Either::Right(Sse::from_stream({last.group(1)}))'
                + new_body[last.end():]
            )

        if new_body != body:
            src = src[:body_start] + new_body + src[body_end:]
            changes.append(f"fix5-9: {handler} → Either<HttpResponse, Sse<..>> + yield Ok()")

    # Also change the return type annotation from `impl Responder` to something actix
    # knows how to respond with — `impl Responder` works fine with `Either<A, B>`
    # where both A and B are Responder, so we leave the signature alone.

    if src == orig:
        print("[ok] no changes needed (already patched or patterns not found)")
        return

    backup = p.with_suffix(p.suffix + '.bak')
    backup.write_text(orig)
    p.write_text(src)
    print(f"[ok] patched {p} (backup: {backup})")
    for c in changes:
        print(f"  - {c}")

if __name__ == '__main__':
    main()
