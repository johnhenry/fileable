/**
 * Type-level assertions, checked as part of `tsc` (this file is `include`d
 * in tsconfig.json) rather than run by node:test -- `@ts-expect-error` on a
 * line that *doesn't* actually error is itself a compile error ("unused
 * '@ts-expect-error' directive"), so a passing `npm run build` is the
 * assertion. No `expect-type`/`tsd` dependency needed for this.
 *
 * Uses `<Rm>`/`<Dir>`/`<File>` (not the lowercase tags) for the prop-shape
 * assertions below, since the lowercase tags are deliberately untyped
 * (fall through to a loose index signature) -- typed props only exist on
 * the imported components now, matching what's enforced at runtime.
 */
import { Dir, File, Rm } from "../src/components.js";

// <rm>/<Rm> requires `target` -- omitting it must fail to typecheck.
// @ts-expect-error
const missingRmTarget = <Rm />;

// A valid <Rm> for contrast (would itself fail if the type were wrong).
const validRm = <Rm target="*.draft.html" />;

// `as` only accepts "loose" | "archive".
// @ts-expect-error
const badAs = <Dir name="out" as="zip" />;

// `join` only accepts "concat" | "dom-merge".
// @ts-expect-error
const badJoin = <File name="out.html" join="merge-everything" />;

// `symlink` accepts a Descriptor or a string, not an arbitrary object.
// @ts-expect-error
const badSymlink = <File name="latest" symlink={{ notADescriptor: true }} />;

// The bare lowercase tags are reserved -- they type-check (loose index
// signature) but throw at runtime (see jsx-runtime.test.ts), so there's no
// type-level assertion for them here; runtime is where that's enforced.

void missingRmTarget;
void validRm;
void badAs;
void badJoin;
void badSymlink;
