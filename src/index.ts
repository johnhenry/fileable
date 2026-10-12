export { render } from "./render.js";
export { linkTo, warn, glob, useCollection } from "./api.js";
export { markdownToHtml } from "./markdown.js";
export { File, Dir, Rm, IPFS, MarkdownHTML } from "./components.js";
// Browser-safe toFiles() + JSX-free builders (see src/browser/): same functions as "@johnhenry/fileable/browser".
export { toFiles } from "./browser/to-files.js";
export type { Files, ToFilesOptions } from "./browser/to-files.js";
export { h, dir, file, rm } from "./browser/builders.js";
export { reflect, CONTENT_MODES, BINARY_MODES } from "./eject.js";

// Individual stages are exported too so each can be tested independently,
// per the PRD's SS4 framing of the pipeline as five separately-testable stages.
export { build } from "./build.js";
export { resolve } from "./resolve.js";
export { layout } from "./layout.js";
export { hash } from "./hash.js";

export type {
  ArtifactNode,
  BaseProps,
  DeletableContext,
  DeletableFileInfo,
  DeletableFn,
  Descriptor,
  DescriptorChild,
  DirProps,
  FileProps,
  IPFSProps,
  MarkdownHTMLProps,
  HashedArtifact,
  HashResult,
  LayoutResult,
  LinkOptions,
  LinkRef,
  LockFileShape,
  RemovalSpec,
  RenderOptions,
  RenderTarget,
  RmProps,
  WriteSummary,
} from "./types.js";
export { FileableError } from "./types.js";
export type { BinaryMode, ContentMode, ContentOverride, EjectFileInfo, EjectOptions } from "./eject.js";
