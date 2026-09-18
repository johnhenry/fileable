/**
 * Type-level assertions, checked as part of `tsc` (this file is `include`d
 * in tsconfig.json) rather than run by node:test -- `@ts-expect-error` on a
 * line that *doesn't* actually error is itself a compile error ("unused
 * '@ts-expect-error' directive"), so a passing `npm run build` is the
 * assertion. No `expect-type`/`tsd` dependency needed for this.
 */

// <rm> requires `target` -- omitting it must fail to typecheck.
// @ts-expect-error
const missingRmTarget = <rm />;

// A valid <rm> for contrast (would itself fail if the type were wrong).
const validRm = <rm target="*.draft.html" />;

// `as` only accepts "loose" | "archive".
// @ts-expect-error
const badAs = <dir name="out" as="zip" />;

// `join` only accepts "concat" | "dom-merge".
// @ts-expect-error
const badJoin = <file name="out.html" join="merge-everything" />;

// `symlink` accepts a Descriptor or a string, not an arbitrary object.
// @ts-expect-error
const badSymlink = <file name="latest" symlink={{ notADescriptor: true }} />;

void missingRmTarget;
void validRm;
void badAs;
void badJoin;
void badSymlink;
