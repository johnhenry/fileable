import { test } from "node:test";
import assert from "node:assert/strict";
import { layout } from "../src/layout.js";
import { FileableError } from "../src/types.js";
import type { Descriptor, LinkRef } from "../src/types.js";

function linkRef(target: Descriptor | string): LinkRef {
  return { __fileableRef: "link", target };
}

test("generic markup tags render boolean-true props as bare attributes and skip false/null/undefined ones", () => {
  const input: Descriptor = {
    tag: "input",
    props: { type: "checkbox", disabled: true, checked: false, value: null, placeholder: undefined },
    children: [],
  };
  const root: Descriptor = { tag: "file", props: { name: "page.html" }, children: [input] };
  const result = layout([root]);
  assert.equal(result.artifacts[0].content, '<input type="checkbox" disabled />');
});

test("nameless inlining: file nested in file becomes a content fragment, not a path", () => {
  const header: Descriptor = { tag: "file", props: {}, children: ["HEADER"] };
  const root: Descriptor = { tag: "file", props: { name: "post.html" }, children: [header, "BODY"] };
  const result = layout([root]);
  assert.equal(result.artifacts.length, 1);
  assert.equal(result.artifacts[0].outputPath, "post.html");
  assert.equal(result.artifacts[0].content, "HEADERBODY");
});

test("nameless inlining: dir nested in file flattens every descendant file into fragments", () => {
  const a: Descriptor = { tag: "file", props: { name: "a.html" }, children: ["A"] };
  const b: Descriptor = { tag: "file", props: { name: "b.html" }, children: ["B"] };
  const dir: Descriptor = { tag: "dir", props: { name: "docs" }, children: [a, b] };
  const wrapper: Descriptor = { tag: "file", props: { name: "single.html" }, children: [dir] };
  const result = layout([wrapper]);
  assert.equal(result.artifacts.length, 1);
  assert.equal(result.artifacts[0].content, "AB");
});

test("as=\"loose\" writes real paths; as=\"archive\" nests under a .zip", () => {
  const inner = (): Descriptor => ({ tag: "file", props: { name: "x.txt" }, children: ["X"] });

  const loose = layout([{ tag: "dir", props: { name: "out", as: "loose" }, children: [inner()] }]);
  const looseFile = loose.artifacts.find((a) => a.kind === "file")!;
  assert.equal(looseFile.outputPath, "out/x.txt");
  assert.equal(looseFile.target, "loose");

  const archive = layout([{ tag: "dir", props: { name: "out", as: "archive" }, children: [inner()] }]);
  const archiveRoot = archive.artifacts.find((a) => a.kind === "dir")!;
  assert.equal(archiveRoot.archivePath, "out.zip");
  const archiveFile = archive.artifacts.find((a) => a.kind === "file")!;
  assert.equal(archiveFile.outputPath, "x.txt");
  assert.equal(archiveFile.target, "archive");
  assert.equal(archiveFile.archivePath, "out.zip");
});

test("link() to a target inlined in the same artifact emits an in-page anchor", () => {
  const target: Descriptor = { tag: "file", props: {}, children: ["TARGET"] };
  const root: Descriptor = {
    tag: "file",
    props: { name: "page.html" },
    children: [target, "ref:", linkRef(target)],
  };
  const result = layout([root]);
  const content = result.artifacts[0].content as string;
  assert.match(content, /<span id="([^"]+)"><\/span>TARGET/);
  const anchorId = /<span id="([^"]+)">/.exec(content)![1];
  assert.equal(content.includes(`ref:#${anchorId}`), true);
});

test("link() to a target in a different artifact emits a relative path", () => {
  const other: Descriptor = { tag: "file", props: { name: "other.html" }, children: ["OTHER"] };
  const index: Descriptor = { tag: "file", props: { name: "index.html" }, children: ["link:", linkRef(other)] };
  const site: Descriptor = { tag: "dir", props: { name: "site" }, children: [other, index] };
  const result = layout([site]);
  const indexArtifact = result.artifacts.find((a) => a.outputPath === "site/index.html")!;
  assert.equal(indexArtifact.content, "link:other.html");
});

test("link() used as an attribute value on a plain markup tag (e.g. <a href={link(...)}>) is substituted", () => {
  const other: Descriptor = { tag: "file", props: { name: "other.html" }, children: ["OTHER"] };
  const anchor: Descriptor = { tag: "a", props: { href: linkRef(other) }, children: ["Other"] };
  const li: Descriptor = { tag: "li", props: {}, children: [anchor] };
  const index: Descriptor = { tag: "file", props: { name: "index.html" }, children: [li] };
  const site: Descriptor = { tag: "dir", props: { name: "site" }, children: [other, index] };
  const result = layout([site]);
  const indexArtifact = result.artifacts.find((a) => a.outputPath === "site/index.html")!;
  assert.equal(indexArtifact.content, '<li><a href="other.html">Other</a></li>');
});

test("link() with format:\"markdown\" returns [text](path)", () => {
  const other: Descriptor = { tag: "file", props: { name: "other.md" }, children: ["OTHER"] };
  const ref: LinkRef = { __fileableRef: "link", target: other, options: { format: "markdown", text: "Other" } };
  const index: Descriptor = { tag: "file", props: { name: "index.md" }, children: [ref] };
  const result = layout([{ tag: "dir", props: { name: "site" }, children: [other, index] }]);
  const indexArtifact = result.artifacts.find((a) => a.outputPath === "site/index.md")!;
  assert.equal(indexArtifact.content, "[Other](other.md)");
});

test("symlink on a loose target resolves a relative path", () => {
  const target: Descriptor = { tag: "file", props: { name: "hello.html" }, children: ["HELLO"] };
  const link: Descriptor = { tag: "file", props: { name: "latest", symlink: target }, children: [] };
  const result = layout([{ tag: "dir", props: { name: "site" }, children: [target, link] }]);
  const linkArtifact = result.artifacts.find((a) => a.outputPath === "site/latest")!;
  assert.equal(linkArtifact.symlinkTo, "hello.html");
  assert.equal(linkArtifact.symlinkDegraded, undefined);
});

test("symlink on an archive target degrades to a copy with a warning", () => {
  const target: Descriptor = { tag: "file", props: { name: "hello.html" }, children: ["HELLO"] };
  const link: Descriptor = { tag: "file", props: { name: "latest", symlink: target }, children: [] };
  const result = layout([{ tag: "dir", props: { name: "site", as: "archive" }, children: [target, link] }]);
  const linkArtifact = result.artifacts.find((a) => a.outputPath === "latest")!;
  assert.equal(linkArtifact.symlinkDegraded, true);
  assert.equal(linkArtifact.content, "HELLO");
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /materialized as a copy/);
});

test("strict:true promotes a symlink degrade to a thrown error", () => {
  const target: Descriptor = { tag: "file", props: { name: "hello.html" }, children: ["HELLO"] };
  const link: Descriptor = { tag: "file", props: { name: "latest", symlink: target }, children: [] };
  assert.throws(
    () => layout([{ tag: "dir", props: { name: "site", as: "archive" }, children: [target, link] }], { strict: true }),
    FileableError,
  );
});

test("symlink also accepts a plain string target (not just a Descriptor)", () => {
  const link: Descriptor = { tag: "file", props: { name: "latest", symlink: "../elsewhere/hello.html" }, children: [] };
  const result = layout([{ tag: "dir", props: { name: "site" }, children: [link] }]);
  const linkArtifact = result.artifacts.find((a) => a.outputPath === "site/latest")!;
  assert.equal(linkArtifact.symlinkTo, "../elsewhere/hello.html");
});

test("symlink targeting a descriptor absent from the tree throws", () => {
  const orphan: Descriptor = { tag: "file", props: { name: "orphan.html" }, children: [] };
  const link: Descriptor = { tag: "file", props: { name: "latest", symlink: orphan }, children: [] };
  assert.throws(() => layout([{ tag: "dir", props: { name: "site" }, children: [link] }]), FileableError);
});

test("link() also accepts a plain string target (not just a Descriptor)", () => {
  const index: Descriptor = { tag: "file", props: { name: "index.html" }, children: [linkRef("https://example.com/")] };
  const result = layout([index]);
  assert.equal(result.artifacts[0].content, "https://example.com/");
});

test("link() targeting a descriptor absent from the tree throws", () => {
  const orphan: Descriptor = { tag: "file", props: { name: "orphan.html" }, children: [] };
  const index: Descriptor = { tag: "file", props: { name: "index.html" }, children: [linkRef(orphan)] };
  assert.throws(() => layout([index]), FileableError);
});

test("link() across different render targets (loose <-> archive) falls back to the target's bare outputPath", () => {
  const archived: Descriptor = { tag: "file", props: { name: "archived.html" }, children: ["ARCHIVED"] };
  const archiveDir: Descriptor = { tag: "dir", props: { name: "docs", as: "archive" }, children: [archived] };
  const index: Descriptor = { tag: "file", props: { name: "index.html" }, children: [linkRef(archived)] };
  const result = layout([{ tag: "dir", props: { name: "site" }, children: [archiveDir, index] }]);
  const indexArtifact = result.artifacts.find((a) => a.outputPath === "site/index.html")!;
  assert.equal(indexArtifact.content, "archived.html");
});

test("two artifacts resolving to the same output path throw instead of silently colliding (last-write-wins)", () => {
  const a: Descriptor = { tag: "file", props: { name: "same.txt" }, children: ["A"] };
  const b: Descriptor = { tag: "file", props: { name: "same.txt" }, children: ["B"] };
  assert.throws(
    () => layout([{ tag: "dir", props: { name: "site" }, children: [a, b] }]),
    (error: unknown) => {
      assert.ok(error instanceof FileableError);
      assert.match(error.message, /duplicate output path "site\/same\.txt"/);
      return true;
    },
  );
});

test("<dir>/<file> without a name at the top level throws", () => {
  assert.throws(() => layout([{ tag: "dir", props: {}, children: [] }]), FileableError);
  assert.throws(() => layout([{ tag: "file", props: {}, children: [] }]), FileableError);
});

test("join=\"dom-merge\" merges nested full-document fragments into one document", () => {
  const header: Descriptor = {
    tag: "file",
    props: {},
    children: ["<html><head><title>T</title></head><body><header>H</header></body></html>"],
  };
  const footer: Descriptor = {
    tag: "file",
    props: {},
    children: ["<html><head></head><body><footer>F</footer></body></html>"],
  };
  const root: Descriptor = {
    tag: "file",
    props: { name: "page.html", join: "dom-merge" },
    children: [header, "<main>M</main>", footer],
  };
  const result = layout([root]);
  const content = result.artifacts[0].content as string;
  assert.match(content, /<title>T<\/title>/);
  assert.match(content, /<header>H<\/header>/);
  assert.match(content, /<main>M<\/main>/);
  assert.match(content, /<footer>F<\/footer>/);
});
